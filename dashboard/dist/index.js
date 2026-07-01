/**
 * Better Hermes File Explorer — dashboard plugin
 *
 * A drop-in "Files" tab for the Hermes dashboard: browse the managed file
 * tree, preview files inline (Markdown rendering, images, raw text), search
 * filenames across the whole tree, and deep-link to any folder or file by URL.
 *
 * No build step — plain IIFE using the Hermes Plugin SDK globals.
 * Reads the core file API (/api/files, /api/files/read, /api/files/download).
 */
(function () {
  "use strict";
  var SDK = window.__HERMES_PLUGIN_SDK__;
  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState, useEffect = SDK.hooks.useEffect, useRef = SDK.hooks.useRef, useMemo = SDK.hooks.useMemo;

  var accent = "var(--primary, #6366f1)";
  var borderC = "var(--border, #2a2a2a)";
  var muted = "var(--muted-foreground, #9ca3af)";
  var cardBg = "var(--card, #111214)";
  var bgMuted = "var(--muted, rgba(255,255,255,.04))";

  function basePath() { return (typeof window !== "undefined" && window.__HERMES_BASE_PATH__) || ""; }
  function sessionTok() { return (typeof window !== "undefined" && window.__HERMES_SESSION_TOKEN__) || ""; }
  function authFetch(p, opts) { opts = opts || {}; var headers = Object.assign({}, opts.headers || {}); var t = sessionTok(); if (t) headers["X-Hermes-Session-Token"] = t; opts.headers = headers; opts.credentials = "same-origin"; return fetch(basePath() + p, opts); }
  function filesGet(pq) { var t = sessionTok(); var opts = t ? { headers: { "Authorization": "Bearer " + t } } : {}; return authFetch(pq, opts).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function readFile(p) { return filesGet("/api/files/read?path=" + encodeURIComponent(p)); }
  function listDir(rel) { return filesGet("/api/files" + (rel ? ("?path=" + encodeURIComponent(rel)) : "")); }
  function filesDownloadHref(p) { var clean = String(p).replace(/^\/+/, ""); return basePath() + "/api/files/download?path=" + encodeURIComponent(clean) + (sessionTok() ? "&token=" + encodeURIComponent(sessionTok()) : ""); }

  // ── write endpoints (from the built-in explorer's network capture) ──
  // mkdir: POST /api/files/mkdir   (application/json)          body: {"path": "<ABSOLUTE path>"}
  // upload: POST /api/files/upload-stream  (multipart/form-data)  fields below.
  // NOTE: the two upload field names are inferred from the mkdir "path" convention.
  //       If the network capture (upload-stream → Request → form-data) shows other
  //       names, just change these two constants — nothing else needs to change.
  var MKDIR_URL = "/api/files/mkdir";
  var UPLOAD_URL = "/api/files/upload-stream";
  var FILES_URL = "/api/files"; // DELETE here: JSON body {path, recursive}
  var UPLOAD_FIELD_PATH = "path"; // absolute destination path (dir + filename)
  var UPLOAD_FIELD_FILE = "file"; // the binary
  function writeHeaders(extra) { var hh = Object.assign({}, extra || {}); var t = sessionTok(); if (t) { hh["X-Hermes-Session-Token"] = t; hh["Authorization"] = "Bearer " + t; } return hh; }
  function apiErr(j) { if (!j) return null; if (typeof j.error === "string") return j.error; if (typeof j.detail === "string") return j.detail; if (Array.isArray(j.detail)) return j.detail.map(function (d) { return d && d.msg ? d.msg : (typeof d === "string" ? d : JSON.stringify(d)); }).join("; "); if (typeof j.message === "string") return j.message; return null; }
  function joinAbs(root, rel) { root = String(root || "").replace(/\/+$/, ""); rel = String(rel || "").replace(/^\/+/, ""); return rel ? (root + "/" + rel) : root; }
  function dirnameOf(p) { return String(p || "").replace(/\/+$/, "").split("/").slice(0, -1).join("/"); }
  function basenameOf(p) { return String(p || "").replace(/\/+$/, "").split("/").pop(); }
  function splitExt(name) { var m = /^(.*?)(\.[^.\/]+)$/.exec(name); return m ? { base: m[1], ext: m[2] } : { base: name, ext: "" }; }
  function uniqueName(name, existingSet) { if (!existingSet || !existingSet[name.toLowerCase()]) return name; var p = splitExt(name), i = 1, cand; do { cand = p.base + " (" + i + ")" + p.ext; i++; } while (existingSet[cand.toLowerCase()] && i < 9999); return cand; }
  function mkdirReq(absPath) {
    return fetch(basePath() + MKDIR_URL, { method: "POST", credentials: "same-origin", headers: writeHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ path: absPath }) })
      .then(function (r) { return r.text().then(function (tx) { var j = null; try { j = JSON.parse(tx); } catch (e) {} if (!r.ok) throw new Error(apiErr(j) || ("HTTP " + r.status)); return j || {}; }); });
  }
  function deleteReq(absPath, recursive) {
    return fetch(basePath() + FILES_URL, { method: "DELETE", credentials: "same-origin", headers: writeHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ path: absPath, recursive: !!recursive }) })
      .then(function (r) { return r.text().then(function (tx) { var j = null; try { j = JSON.parse(tx); } catch (e) {} if (!r.ok) throw new Error(apiErr(j) || ("HTTP " + r.status)); return j || {}; }); });
  }
  function uploadReq(absPath, file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", basePath() + UPLOAD_URL, true);
      xhr.withCredentials = true; // same-origin session cookie
      var t = sessionTok(); if (t) { xhr.setRequestHeader("X-Hermes-Session-Token", t); xhr.setRequestHeader("Authorization", "Bearer " + t); }
      if (xhr.upload) xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) { var j = null; try { j = JSON.parse(xhr.responseText); } catch (e) {} resolve(j || { ok: true }); } else { var je = null; try { je = JSON.parse(xhr.responseText); } catch (e) {} reject(new Error(apiErr(je) || ("HTTP " + xhr.status))); } };
      xhr.onerror = function () { reject(new Error("network error")); };
      xhr.onabort = function () { reject(new Error("aborted")); };
      var fd = new FormData();
      fd.append(UPLOAD_FIELD_PATH, absPath);          // do NOT set Content-Type — FormData sets the multipart boundary
      fd.append(UPLOAD_FIELD_FILE, file, file.name);
      xhr.send(fd);
    });
  }
  function fmtBytes(n) { if (n == null) return ""; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(1) + " GB"; }
  function fmtTime(t) { if (!t) return ""; try { var d = new Date(t * 1000); return d.toLocaleString(); } catch (e) { return ""; } }
  function isFilePath(p) { return /\.[A-Za-z0-9]{1,8}$/.test(String(p).split("/").pop()); }

  // ── icons ──
  function ic(paths, sz, extra) { return h("svg", Object.assign({ width: sz || 16, height: sz || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, extra || {}), paths.map(function (d, i) { return h("path", { key: i, d: d }); })); }
  function FolderIcon(sz) { return h("svg", { width: sz || 18, height: sz || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" })); }
  function FileIcon(sz) { return h("svg", { width: sz || 18, height: sz || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), h("path", { d: "M14 2v6h6" })); }
  function SearchIcon(sz) { return h("svg", { width: sz || 16, height: sz || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("circle", { cx: 11, cy: 11, r: 8 }), h("path", { d: "M21 21l-4.3-4.3" })); }
  function XIcon(sz) { return h("svg", { width: sz || 18, height: sz || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M18 6 6 18" }), h("path", { d: "m6 6 12 12" })); }
  function UploadIcon(sz) { return ic(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"], sz || 15); }
  function FolderPlusIcon(sz) { return ic(["M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M12 11v6", "M9 14h6"], sz || 15); }
  function UploadFolderIcon(sz) { return ic(["M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M12 17v-6", "M9.5 13.5 12 11l2.5 2.5"], sz || 15); }
  function DownloadIcon(sz) { return ic(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"], sz || 15); }
  function TrashIcon(sz) { return ic(["M3 6h18", "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M10 11v6", "M14 11v6"], sz || 15); }

  // ── markdown renderer (same engine as the file viewer) ──
  function mdCodeStyle() { return { fontFamily: "var(--font-courier, monospace)", fontSize: "0.9em", background: "rgba(128,128,128,.18)", border: "1px solid rgba(128,128,128,.28)", borderRadius: 4, padding: "0.5px 5px", color: "inherit" }; }
  function mdInline(s, onOpen) {
    var out = [], rest = String(s == null ? "" : s), key = 0;
    function pstate(cand, isFile) { if (!onOpen || !onOpen.known) return "valid"; var st = onOpen.known(cand); if (st === undefined) { if (onOpen.ensure) onOpen.ensure(cand, isFile); return "pending"; } return st; }
    function panchor(cand, label, style, kk) { return h("a", { key: kk, href: (onOpen.hrefFor ? onOpen.hrefFor(cand) : filesDownloadHref(cand)), target: "_blank", rel: "noopener noreferrer", title: "Open " + cand, onClick: function (e) { e.preventDefault(); e.stopPropagation(); onOpen(cand); }, style: style }, label); }
    var pats = [
      { re: /`([^`]+)`/, mk: function (m) { var inner = m[1]; var pp = inner.trim(); if (onOpen && /^(?:[\w.\-]+\/)+[\w.\-]+\.[A-Za-z0-9]{1,8}$/.test(pp) && pstate(pp, true) === "valid") return panchor(pp, inner, Object.assign({}, mdCodeStyle(), { color: accent, textDecoration: "underline", cursor: "pointer", wordBreak: "break-all" }), "cl" + (key++)); return h("code", { key: "c" + (key++), style: mdCodeStyle() }, inner); } },
      { re: /((?:https?:\/\/|www\.)[^\s<>()\[\]]+)/, mk: function (m) { var raw = m[1].replace(/[.,;:!?]+$/, ""); var href = /^www\./i.test(raw) ? ("https://" + raw) : raw; return h("a", { key: "u" + (key++), href: href, target: "_blank", rel: "noopener noreferrer", onClick: function (e) { e.stopPropagation(); }, style: { color: accent, textDecoration: "underline", wordBreak: "break-all" } }, raw); } },
      { re: /\*\*([^*]+)\*\*/, mk: function (m) { return h("strong", { key: "b" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /__([^_]+)__/, mk: function (m) { return h("strong", { key: "b" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /\*([^*]+)\*/, mk: function (m) { return h("em", { key: "i" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /~~([^~]+)~~/, mk: function (m) { return h("del", { key: "s" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /\[([^\]]+)\]\(([^)\s]+)\)/, mk: function (m) { return h("a", { key: "l" + (key++), href: m[2], target: "_blank", rel: "noopener noreferrer", onClick: function (e) { e.stopPropagation(); }, style: { color: accent, textDecoration: "underline" } }, m[1]); } }
    ];
    if (onOpen) pats.push({ re: /((?:[\w.\-]+\/)+[\w.\-]+\.[A-Za-z0-9]{1,8})/, mk: function (m) { var pp = m[1]; if (pstate(pp, true) === "valid") return panchor(pp, pp, { color: accent, textDecoration: "underline", wordBreak: "break-all", cursor: "pointer" }, "fp" + (key++)); return pp; } });
    if (onOpen && onOpen.folders) pats.push({ re: /((?:[\w.\-]+\/){2,}[\w.\-]+)(?![\w.\-]*\.[A-Za-z0-9])/, mk: function (m) { var raw = m[1]; var pp = raw.replace(/[.,;:!?]+$/, "").replace(/\/+$/, ""); var tail = raw.slice(pp.length); if (pstate(pp, false) === "valid") return h(React.Fragment, { key: "df" + (key++) }, panchor(pp, pp, { color: accent, textDecoration: "underline", wordBreak: "break-all", cursor: "pointer" }, "dp" + (key++)), tail); return raw; } });
    var guard = 0;
    while (rest && guard++ < 5000) {
      var best = null;
      for (var p = 0; p < pats.length; p++) { pats[p].re.lastIndex = 0; var m = pats[p].re.exec(rest); if (m && (best === null || m.index < best.m.index)) best = { p: pats[p], m: m }; }
      if (!best) { out.push(rest); break; }
      if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
      out.push(best.p.mk(best.m));
      rest = rest.slice(best.m.index + best.m[0].length);
    }
    return out;
  }
  function mdHeadingStyle(lvl) { var sizes = [21, 17.5, 15.5, 14, 13, 12.5]; return { margin: lvl <= 2 ? "18px 0 8px" : "14px 0 6px", fontSize: sizes[lvl - 1] || 13, fontWeight: 700, lineHeight: 1.3, borderBottom: lvl <= 2 ? "1px solid rgba(128,128,128,.28)" : "none", paddingBottom: lvl <= 2 ? 5 : 0 }; }
  function mdCells(l) { var t = l.trim().replace(/^\|/, "").replace(/\|$/, ""); return t.split("|").map(function (c) { return c.trim(); }); }
  function mdList(lines, k, onOpen) {
    var indents = lines.map(function (l) { return /^(\s*)/.exec(l)[1].length; });
    var minI = Math.min.apply(null, indents);
    var ordered = new RegExp("^\\s{" + minI + "}\\d+\\.\\s+").test(lines[0]);
    var items = [], cur = null;
    lines.forEach(function (l) {
      var indent = /^(\s*)/.exec(l)[1].length;
      var m = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(l);
      if (indent <= minI && m) { if (cur) items.push(cur); cur = { text: m[1], children: [] }; }
      else if (cur) cur.children.push(l);
    });
    if (cur) items.push(cur);
    return h(ordered ? "ol" : "ul", { key: "L" + k, style: { margin: "0 0 10px", paddingLeft: 22, lineHeight: 1.6 } }, items.map(function (it, idx) {
      var kids = it.children.length ? mdBlocks(it.children.map(function (c) { return c.replace(new RegExp("^\\s{0," + (minI + 2) + "}"), ""); }).join("\n"), onOpen) : null;
      return h("li", { key: idx, style: { marginBottom: 3 } }, mdInline(it.text, onOpen), kids);
    }));
  }
  function mdBlocks(md, onOpen) {
    var lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
    var blocks = [], i = 0, key = 0;
    function para(buf) { if (buf.length) blocks.push(h("p", { key: "p" + (key++), style: { margin: "0 0 10px", lineHeight: 1.65 } }, mdInline(buf.join(" "), onOpen))); }
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*```/.test(line)) { var code = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; } i++; blocks.push(h("pre", { key: "pre" + (key++), style: { margin: "0 0 12px", background: "rgba(128,128,128,.14)", border: "1px solid rgba(128,128,128,.28)", borderRadius: 8, padding: "10px 12px", overflow: "auto" } }, h("code", { style: { fontFamily: "var(--font-courier, monospace)", fontSize: 12, whiteSpace: "pre", color: "inherit" } }, code.join("\n")))); continue; }
      var hd = /^(#{1,6})\s+(.*)$/.exec(line);
      if (hd) { var lvl = hd[1].length; blocks.push(h("h" + Math.min(lvl, 6), { key: "h" + (key++), style: mdHeadingStyle(lvl) }, mdInline(hd[2].replace(/\s+#+\s*$/, ""), onOpen))); i++; continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(h("hr", { key: "hr" + (key++), style: { border: "none", borderTop: "1px solid rgba(128,128,128,.28)", margin: "14px 0" } })); i++; continue; }
      if (/^\s*>\s?/.test(line)) { var qb = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qb.push(lines[i].replace(/^\s*>\s?/, "")); i++; } blocks.push(h("blockquote", { key: "bq" + (key++), style: { margin: "0 0 10px", padding: "2px 12px", borderLeft: "3px solid rgba(128,128,128,.4)", opacity: .85 } }, mdBlocks(qb.join("\n"), onOpen))); continue; }
      if (/\|/.test(line) && i + 1 < lines.length && /\|/.test(lines[i + 1]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        var header = line; i += 2; var rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") { rows.push(lines[i]); i++; }
        var head = mdCells(header);
        blocks.push(h("div", { key: "tw" + (key++), style: { overflow: "auto", margin: "0 0 12px" } }, h("table", { style: { borderCollapse: "collapse", fontSize: 12.5, width: "100%" } },
          h("thead", null, h("tr", null, head.map(function (c, ci) { return h("th", { key: ci, style: { border: "1px solid rgba(128,128,128,.28)", padding: "6px 9px", textAlign: "left", background: "rgba(128,128,128,.12)" } }, mdInline(c, onOpen)); }))),
          h("tbody", null, rows.map(function (r, ri) { var cs = mdCells(r); return h("tr", { key: ri }, cs.map(function (c, ci) { return h("td", { key: ci, style: { border: "1px solid rgba(128,128,128,.28)", padding: "6px 9px", verticalAlign: "top" } }, mdInline(c, onOpen)); })); }))))); continue;
      }
      if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) { var ll = []; while (i < lines.length && (/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && ll.length))) { ll.push(lines[i]); i++; } blocks.push(mdList(ll, key++, onOpen)); continue; }
      if (/^\s*$/.test(line)) { i++; continue; }
      var buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      para(buf);
    }
    return blocks;
  }

  function parseRead(dispPath, r) {
    var du = r && r.data_url; var mime = (r && r.mime_type) || ""; var text = null;
    var isText = /^text\//.test(mime) || /(json|markdown|xml|yaml|x-yaml|javascript|typescript|csv|x-sh|x-python|toml)/i.test(mime) || /\.(md|markdown|txt|log|json|ya?ml|csv|tsv|py|js|jsx|ts|tsx|sh|bash|zsh|toml|ini|cfg|conf|env|html?|css|scss|sql|go|rs|rb|java|c|cpp|h|xml)$/i.test((r && r.name) || dispPath);
    if (du && isText) { var b64 = String(du).split(",")[1] || ""; try { text = decodeURIComponent(escape(atob(b64))); } catch (e) { try { text = atob(b64); } catch (_) { text = null; } } }
    return { name: r && r.name, mime: mime, size: r && r.size, dataUrl: du, text: text };
  }

  var SKIP = { "node_modules": 1, ".git": 1, "__pycache__": 1, "site-packages": 1, ".venv": 1, "venv": 1, ".cache": 1, ".npm": 1, ".mypy_cache": 1, "dist": 1, ".next": 1, "build": 1 };

  // Directed search: resolve a (possibly prefix-missing) relative path to a real file.
  function resolveFilePath(relRaw, cacheRef) {
    var rel = String(relRaw).replace(/^\/+/, "");
    if (cacheRef.current && (rel in cacheRef.current)) return Promise.resolve(cacheRef.current[rel]);
    var segs = rel.split("/"); var base = segs[segs.length - 1];
    var firstDir = segs.length > 1 ? segs[0] : null; var restAfterFirst = segs.slice(1).join("/");
    var relDirSet = {}; segs.slice(0, -1).forEach(function (s) { relDirSet[s] = 1; });
    var rootPath = null, listings = 0, MAX = 600, MAX_DEPTH = 14;
    var pq = [], nq = [], seen = { "": 1 }; nq.push({ d: "", depth: 0 });
    var basenameHits = [], directTried = {};
    function relOf(e) { if (rootPath && e.path && e.path.indexOf(rootPath) === 0) return e.path.slice(rootPath.length).replace(/^\/+/, ""); return e.name; }
    function enqueue(d, depth) { if (seen[d]) return; seen[d] = 1; var nm = d.split("/").pop(); (relDirSet[nm] ? pq : nq).push({ d: d, depth: depth }); }
    function tryDirect(c) { if (directTried[c]) return Promise.resolve(null); directTried[c] = 1; return readFile(c).then(function () { return c; }).catch(function () { return null; }); }
    function loop() {
      if ((!pq.length && !nq.length) || listings >= MAX) return Promise.resolve(null);
      var wave = []; while ((pq.length || nq.length) && wave.length < 8 && listings < MAX) { wave.push(pq.length ? pq.shift() : nq.shift()); listings++; }
      return Promise.all(wave.map(function (item) {
        return listDir(item.d).catch(function () { return null; }).then(function (r) {
          if (!r) return null; if (rootPath == null && r.root) rootPath = r.root;
          var found = null, cands = [];
          (r.entries || []).forEach(function (e) {
            var rr = relOf(e);
            if (e.is_directory) { if (firstDir && e.name === firstDir) cands.push(restAfterFirst ? (rr + "/" + restAfterFirst) : rr); if (item.depth < MAX_DEPTH && !SKIP[e.name]) enqueue(rr, item.depth + 1); }
            else { if (rr === rel || (rr.length > rel.length && rr.slice(-(rel.length + 1)) === "/" + rel)) found = rr; else if (e.name === base) basenameHits.push(rr); }
          });
          if (found) return found;
          if (cands.length) return Promise.all(cands.map(tryDirect)).then(function (rs) { return rs.filter(Boolean)[0] || null; });
          return null;
        });
      })).then(function (results) { var hit = results.filter(Boolean)[0]; return hit ? hit : loop(); });
    }
    return loop().then(function (hit) {
      var pick = hit;
      if (!pick && basenameHits.length) { if (basenameHits.length === 1) pick = basenameHits[0]; else { var lastDir = segs.slice(-2)[0]; var better = basenameHits.filter(function (p) { return lastDir && p.indexOf("/" + lastDir + "/") !== -1; }); if (better.length === 1) pick = better[0]; } }
      if (cacheRef.current) cacheRef.current[rel] = pick || false;
      return pick || false;
    });
  }

  // Directed BFS for a *directory* whose relative path ends with `relRaw` (folder equivalent of resolveFilePath).
  function resolveFolderPath(relRaw, cacheRef) {
    var rel = String(relRaw).replace(/^\/+/, "");
    if (cacheRef.current && (rel in cacheRef.current)) return Promise.resolve(cacheRef.current[rel]);
    var segs = rel.split("/"); var firstDir = segs[0]; var restAfterFirst = segs.slice(1).join("/");
    var relDirSet = {}; segs.forEach(function (s) { relDirSet[s] = 1; });
    var rootPath = null, listings = 0, MAX = 600, MAX_DEPTH = 14;
    var pq = [], nq = [], seen = { "": 1 }; nq.push({ d: "", depth: 0 });
    var directTried = {};
    function relOf(e) { if (rootPath && e.path && e.path.indexOf(rootPath) === 0) return e.path.slice(rootPath.length).replace(/^\/+/, ""); return e.name; }
    function enqueue(d, depth) { if (seen[d]) return; seen[d] = 1; var nm = d.split("/").pop(); (relDirSet[nm] ? pq : nq).push({ d: d, depth: depth }); }
    function tryDirect(c) { if (directTried[c]) return Promise.resolve(null); directTried[c] = 1; return listDir(c).then(function () { return c; }).catch(function () { return null; }); }
    function loop() {
      if ((!pq.length && !nq.length) || listings >= MAX) return Promise.resolve(null);
      var wave = []; while ((pq.length || nq.length) && wave.length < 8 && listings < MAX) { wave.push(pq.length ? pq.shift() : nq.shift()); listings++; }
      return Promise.all(wave.map(function (item) {
        return listDir(item.d).catch(function () { return null; }).then(function (r) {
          if (!r) return null; if (rootPath == null && r.root) rootPath = r.root;
          var found = null, cands = [];
          (r.entries || []).forEach(function (e) {
            if (!e.is_directory) return; var rr = relOf(e);
            if (rr === rel || (rr.length > rel.length && rr.slice(-(rel.length + 1)) === "/" + rel)) found = rr;
            if (firstDir && e.name === firstDir) cands.push(restAfterFirst ? (rr + "/" + restAfterFirst) : rr);
            if (item.depth < MAX_DEPTH && !SKIP[e.name]) enqueue(rr, item.depth + 1);
          });
          if (found) return found;
          if (cands.length) return Promise.all(cands.map(tryDirect)).then(function (rs) { return rs.filter(Boolean)[0] || null; });
          return null;
        });
      })).then(function (results) { var hit = results.filter(Boolean)[0]; return hit ? hit : loop(); });
    }
    return loop().then(function (hit) { if (cacheRef.current) cacheRef.current[rel] = hit || false; return hit || false; });
  }

  // Build a full (bounded) file index for search.
  function buildIndex() {
    var files = [], rootPath = null, listings = 0, MAX = 1200, MAX_DEPTH = 16;
    var queue = [{ d: "", depth: 0 }], seen = { "": 1 };
    function relOf(e) { if (rootPath && e.path && e.path.indexOf(rootPath) === 0) return e.path.slice(rootPath.length).replace(/^\/+/, ""); return e.name; }
    function step() {
      if (!queue.length || listings >= MAX) return Promise.resolve();
      var wave = []; while (queue.length && wave.length < 10 && listings < MAX) { wave.push(queue.shift()); listings++; }
      return Promise.all(wave.map(function (item) {
        return listDir(item.d).catch(function () { return null; }).then(function (r) {
          if (!r) return; if (rootPath == null && r.root) rootPath = r.root;
          (r.entries || []).forEach(function (e) {
            var rr = relOf(e);
            if (e.is_directory) { if (item.depth < MAX_DEPTH && !SKIP[e.name] && !seen[rr]) { seen[rr] = 1; queue.push({ d: rr, depth: item.depth + 1 }); } }
            else files.push({ rel: rr, name: e.name, size: e.size, mtime: e.mtime });
          });
        });
      })).then(step);
    }
    return step().then(function () { return { files: files, partial: listings >= MAX }; });
  }

  // Walk a DataTransfer item list (drag&drop) into a flat [{file, sub}] list.
  // `sub` is the path relative to the drop (incl. any dropped folder name), e.g. "myfolder/a/b.txt".
  function readEntry(entry, base, out) {
    return new Promise(function (resolve) {
      if (!entry) return resolve();
      if (entry.isFile) { entry.file(function (f) { out.push({ file: f, sub: base + f.name }); resolve(); }, function () { resolve(); }); }
      else if (entry.isDirectory) {
        var reader = entry.createReader(), gathered = [];
        (function readBatch() {
          reader.readEntries(function (ents) {
            if (!ents || !ents.length) { Promise.all(gathered.map(function (e) { return readEntry(e, base + entry.name + "/", out); })).then(function () { resolve(); }); return; }
            gathered = gathered.concat(Array.prototype.slice.call(ents)); readBatch();
          }, function () { resolve(); });
        })();
      } else resolve();
    });
  }
  function collectDropItems(dtItems) {
    var out = [], jobs = [];
    for (var i = 0; i < dtItems.length; i++) {
      var it = dtItems[i];
      var entry = it && (it.webkitGetAsEntry ? it.webkitGetAsEntry() : (it.getAsEntry ? it.getAsEntry() : null));
      if (entry) jobs.push(readEntry(entry, "", out));
      else if (it && it.kind === "file") { var f = it.getAsFile(); if (f) out.push({ file: f, sub: f.name }); }
    }
    return Promise.all(jobs).then(function () { return out; });
  }

  // ── minimal ZIP writer: DEFLATE via native CompressionStream when available, else STORE ──
  var CRC_TABLE = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function deflateRaw(bytes) {
    try {
      if (typeof CompressionStream === "undefined" || typeof Response === "undefined") return Promise.resolve(null);
      var cs = new CompressionStream("deflate-raw");
      return new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function _u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function _u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
  function dataUrlToBytes(dataUrl) { var b64 = String(dataUrl || "").split(",")[1] || ""; var bin = atob(b64); var arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr; }
  // entries: [{name, data:Uint8Array}] → Promise<Blob>
  function buildZip(entries) {
    var enc = new TextEncoder(), chunks = [], central = [], offset = 0;
    var seq = entries.reduce(function (p, ent) {
      return p.then(function () {
        var nameBytes = enc.encode(ent.name), crc = crc32(ent.data), uncomp = ent.data.length;
        return deflateRaw(ent.data).then(function (def) {
          var method = 0, data = ent.data;
          if (def && def.length < uncomp) { method = 8; data = def; }
          var comp = data.length, flags = 0x0800;
          var local = [].concat(_u32(0x04034b50), _u16(20), _u16(flags), _u16(method), _u16(0), _u16(0), _u32(crc), _u32(comp), _u32(uncomp), _u16(nameBytes.length), _u16(0));
          var localHead = new Uint8Array(local);
          chunks.push(localHead, nameBytes, data);
          var localOffset = offset; offset += localHead.length + nameBytes.length + data.length;
          var cen = [].concat(_u32(0x02014b50), _u16(20), _u16(20), _u16(flags), _u16(method), _u16(0), _u16(0), _u32(crc), _u32(comp), _u32(uncomp), _u16(nameBytes.length), _u16(0), _u16(0), _u16(0), _u16(0), _u32(0), _u32(localOffset));
          central.push({ head: new Uint8Array(cen), name: nameBytes });
        });
      });
    }, Promise.resolve());
    return seq.then(function () {
      var cdStart = offset, cdSize = 0;
      central.forEach(function (c) { chunks.push(c.head, c.name); cdSize += c.head.length + c.name.length; });
      chunks.push(new Uint8Array([].concat(_u32(0x06054b50), _u16(0), _u16(0), _u16(central.length), _u16(central.length), _u32(cdSize), _u32(cdStart), _u16(0))));
      return new Blob(chunks, { type: "application/zip" });
    });
  }
  // Recursively list every file under a folder (bounded). Returns {files:[{rel,size}], partial}.
  function collectFolderFiles(startRel) {
    startRel = String(startRel || "").replace(/^\/+|\/+$/g, "");
    var files = [], rootPath = null, listings = 0, MAX = 2500, MAX_DEPTH = 24;
    var queue = [{ d: startRel, depth: 0 }], seen = {}; seen[startRel] = 1;
    function relOf(e) { if (rootPath && e.path && e.path.indexOf(rootPath) === 0) return e.path.slice(rootPath.length).replace(/^\/+/, ""); return (startRel ? startRel + "/" : "") + e.name; }
    function step() {
      if (!queue.length || listings >= MAX) return Promise.resolve();
      var wave = []; while (queue.length && wave.length < 10 && listings < MAX) { wave.push(queue.shift()); listings++; }
      return Promise.all(wave.map(function (item) {
        return listDir(item.d).catch(function () { return null; }).then(function (r) {
          if (!r) return; if (rootPath == null && r.root) rootPath = r.root;
          (r.entries || []).forEach(function (e) {
            var rr = relOf(e);
            if (e.is_directory) { if (item.depth < MAX_DEPTH && !SKIP[e.name] && !seen[rr]) { seen[rr] = 1; queue.push({ d: rr, depth: item.depth + 1 }); } }
            else files.push({ rel: rr, size: e.size });
          });
        });
      })).then(step);
    }
    return step().then(function () { return { files: files, partial: listings >= MAX }; });
  }

  function Explorer() {
    var s;
    s = useState(""); var cwd = s[0], setCwd = s[1];
    s = useState(null); var dir = s[0], setDir = s[1];               // {entries, path, parent} of cwd
    s = useState(false); var dirLoading = s[0], setDirLoading = s[1];
    s = useState(null); var dirErr = s[0], setDirErr = s[1];
    s = useState(""); var query = s[0], setQuery = s[1];
    s = useState(null); var results = s[0], setResults = s[1];        // search results (array) or null
    s = useState(false); var searching = s[0], setSearching = s[1];
    s = useState(null); var filePreview = s[0], setFilePreview = s[1];
    s = useState(false); var previewRaw = s[0], setPreviewRaw = s[1];
    s = useState([]); var stack = s[0], setStack = s[1];
    s = useState([]); var uploads = s[0], setUploads = s[1];          // [{id,name,rel,pct,status,error}]
    s = useState(false); var dragOver = s[0], setDragOver = s[1];
    s = useState(false); var mkdirOpen = s[0], setMkdirOpen = s[1];
    s = useState(""); var mkdirName = s[0], setMkdirName = s[1];
    s = useState(null); var mkdirErr = s[0], setMkdirErr = s[1];
    s = useState(false); var mkdirBusy = s[0], setMkdirBusy = s[1];
    s = useState(null); var conflict = s[0], setConflict = s[1];      // {name,dir,resolve} | null
    s = useState(null); var del = s[0], setDel = s[1];                // {rel,name,isDir} | null
    s = useState(false); var delBusy = s[0], setDelBusy = s[1];
    s = useState(null); var delErr = s[0], setDelErr = s[1];
    s = useState(null); var zip = s[0], setZip = s[1];               // {name,phase,done,total,skipped,partial,error} | null

    var resolveCacheRef = useRef({});
    var folderCacheRef = useRef({});
    var pathValidRef = useRef({});
    var searchChainRef = useRef(Promise.resolve());
    var pvSt = useState(0); var pathV = pvSt[0], setPathV = pvSt[1];
    var indexRef = useRef(null);
    var fpRef = useRef(null); fpRef.current = filePreview;
    var stackRef = useRef([]); stackRef.current = stack;
    var cwdRef = useRef(""); cwdRef.current = cwd;
    var didInit = useRef(false);
    var rootRef = useRef(""); if (dir && dir.root) rootRef.current = dir.root;   // absolute managed root, e.g. /opt/data
    var fileInputRef = useRef(null);
    var folderInputRef = useRef(null);
    var conflictRef = useRef(null); conflictRef.current = conflict;
    var bulkRef = useRef(null);          // remembered conflict decision for "apply to all"
    var dragDepthRef = useRef(0);        // nested dragenter/leave counter

    // ── URL deep-linking ──
    function currentPluginPath() { return (typeof window !== "undefined" && window.location ? window.location.pathname : "") || (basePath() + "/file-explorer"); }
    function syncURL() {
      if (typeof window === "undefined" || !window.history) return;
      var qs;
      if (fpRef.current && fpRef.current.path) qs = "?file=" + encodeURIComponent(String(fpRef.current.path).replace(/^\/+/, ""));
      else qs = cwdRef.current ? ("?path=" + encodeURIComponent(cwdRef.current)) : "";
      try { window.history.replaceState(null, "", currentPluginPath() + qs); } catch (e) {}
    }

    function loadDir(rel) {
      rel = String(rel || "").replace(/^\/+/, "");
      setDirLoading(true); setDirErr(null);
      listDir(rel).then(function (r) {
        setDir(r); setDirLoading(false);
      }).catch(function (e) { setDir({ entries: [] }); setDirErr((e && e.message) || "could not list folder"); setDirLoading(false); });
    }

    // viewer
    function loadFilePreview(path) {
      var clean = String(path).replace(/^\/+/, "");
      setPreviewRaw(false); setFilePreview({ path: path, loading: true });
      readFile(clean).then(function (r) { setFilePreview(Object.assign({ path: clean, loading: false }, parseRead(clean, r))); })
        .catch(function () {
          setFilePreview({ path: path, loading: true, searching: true });
          resolveFilePath(clean, resolveCacheRef).then(function (resolved) {
            if (resolved && resolved !== clean) { setCwd(dirOf(resolved)); readFile(resolved).then(function (r) { setFilePreview(Object.assign({ path: resolved, orig: path, loading: false }, parseRead(resolved, r))); }).catch(function (e) { setFilePreview({ path: path, loading: false, err: (e && e.message) || "not found" }); }); }
            else setFilePreview({ path: path, loading: false, err: "not found", searchedNoMatch: true });
          }).catch(function () { setFilePreview({ path: path, loading: false, err: "not found" }); });
        });
    }
    function openViewer(path) { setStack([]); loadFilePreview(path); }
    function navViewer(path) { var cur = fpRef.current; if (cur) setStack(function (st) { return st.concat([cur]); }); loadFilePreview(path); }
    function backViewer() { var st = stackRef.current || []; if (!st.length) { setFilePreview(null); return; } var prev = st[st.length - 1]; setStack(st.slice(0, -1)); setPreviewRaw(false); setFilePreview(prev); }
    function closeViewer() { setFilePreview(null); setStack([]); }

    // path handler for markdown inside previewed files: files open in viewer, folders navigate the browser
    // Paths only become links once the target is verified to exist (direct check or bounded tree search); cached per candidate.
    function serialSearch(fn) { var pr = searchChainRef.current.then(fn, fn); searchChainRef.current = pr.catch(function () {}); return pr; }
    function validatePath(cand, isFile) {
      var clean = String(cand).replace(/^\/+/, "");
      function search() { return serialSearch(function () { return resolveFilePath(clean, resolveCacheRef); }).then(function (res) { return res ? { valid: true, resolved: res } : { valid: false }; }); }
      function searchDir() { return serialSearch(function () { return resolveFolderPath(clean, folderCacheRef); }).then(function (res) { return res ? { valid: true, resolved: res } : { valid: false }; }); }
      if (isFile) {
        var parts = clean.split("/"); var b = parts.pop(); var parent = parts.join("/");
        return listDir(parent).then(function (r) {
          if (r && r.entries && r.entries.some(function (e) { return !e.is_directory && e.name === b; })) return { valid: true, resolved: clean };
          return search();
        }).catch(function () { return readFile(clean).then(function () { return { valid: true, resolved: clean }; }).catch(search); });
      }
      var fparts = clean.split("/"); var fb = fparts.pop(); var fparent = fparts.join("/");
      return listDir(fparent).then(function (r) { if (r && r.entries && r.entries.some(function (e) { return e.is_directory && e.name === fb; })) return { valid: true, resolved: clean }; return searchDir(); }).catch(searchDir);
    }
    function navPathHandler(path) {
      var t = navPathHandler.resolvedOf(path);
      if (isFilePath(t)) navViewer(t);
      else { closeViewer(); setQuery(""); setResults(null); setCwd(String(t).replace(/^\/+/, "")); }
    }
    navPathHandler.folders = true;
    navPathHandler.known = function (cand) { var e = pathValidRef.current[cand]; return e ? e.state : undefined; };
    navPathHandler.ensure = function (cand, isF) { if (pathValidRef.current[cand]) return; pathValidRef.current[cand] = { state: "pending" }; validatePath(cand, isF).then(function (res) { pathValidRef.current[cand] = res.valid ? { state: "valid", resolved: res.resolved } : { state: "invalid" }; setPathV(function (v) { return v + 1; }); }).catch(function () { pathValidRef.current[cand] = { state: "invalid" }; setPathV(function (v) { return v + 1; }); }); };
    navPathHandler.resolvedOf = function (cand) { var e = pathValidRef.current[cand]; return (e && e.resolved) || cand; };
    navPathHandler.hrefFor = function (p) { var t = navPathHandler.resolvedOf(p); return isFilePath(t) ? filesDownloadHref(t) : (currentPluginPath() + "?path=" + encodeURIComponent(String(t).replace(/^\/+/, ""))); };

    function openEntry(e) {
      var rel = (dir && dir.root && e.path && e.path.indexOf(dir.root) === 0) ? e.path.slice(dir.root.length).replace(/^\/+/, "") : (cwd ? (cwd + "/" + e.name) : e.name);
      if (e.is_directory) { setQuery(""); setResults(null); setCwd(rel); }
      else openViewer(rel);
    }

    function runSearch(q) {
      q = String(q || "").trim();
      if (!q) { setResults(null); setSearching(false); return; }
      setSearching(true);
      var go = function (idx) {
        var ql = q.toLowerCase();
        // "*" acts as a wildcard (any run of chars, incl. none). No "*" → plain substring (unchanged).
        var re = null;
        if (ql.indexOf("*") !== -1) {
          try { re = new RegExp("^" + ql.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); } catch (e) { re = null; }
        }
        var test = re
          ? function (f) { return re.test(f.name.toLowerCase()) || re.test(f.rel.toLowerCase()); }
          : function (f) { return f.rel.toLowerCase().indexOf(ql) !== -1; };
        var matches = idx.files.filter(test);
        matches.sort(function (a, b) { var an = a.name.toLowerCase() === ql, bn = b.name.toLowerCase() === ql; if (an !== bn) return an ? -1 : 1; return a.rel.length - b.rel.length; });
        setResults({ q: q, items: matches.slice(0, 500), total: matches.length, partial: idx.partial });
        setSearching(false);
      };
      if (indexRef.current) go(indexRef.current);
      else buildIndex().then(function (idx) { indexRef.current = idx; go(idx); }).catch(function () { setResults({ q: q, items: [], total: 0 }); setSearching(false); });
    }

    // ── create folder ──
    function existingNamesInCwd() { var set = {}; ((dir && dir.entries) || []).forEach(function (e) { set[String(e.name).toLowerCase()] = 1; }); return set; }
    function submitMkdir() {
      var name = String(mkdirName || "").trim().replace(/^\/+|\/+$/g, "");
      if (!name) { setMkdirErr("Bitte einen Namen eingeben."); return; }
      if (/[\\]/.test(name) || name === "." || name === "..") { setMkdirErr("Ung\u00fcltiger Ordnername."); return; }
      if (existingNamesInCwd()[name.toLowerCase()]) { setMkdirErr("Ein Eintrag mit diesem Namen existiert bereits."); return; }
      var absDir = joinAbs(rootRef.current, (cwd ? cwd + "/" : "") + name);
      setMkdirBusy(true); setMkdirErr(null);
      mkdirReq(absDir).then(function () {
        setMkdirBusy(false); setMkdirOpen(false); setMkdirName(""); indexRef.current = null; loadDir(cwd);
      }).catch(function (e) { setMkdirBusy(false); setMkdirErr("Konnte Ordner nicht erstellen: " + ((e && e.message) || "Fehler")); });
    }

    // ── uploads ──
    function askConflict(name, dirRel) {
      if (bulkRef.current) return Promise.resolve(bulkRef.current);
      return new Promise(function (resolve) {
        setConflict({ name: name, dir: dirRel || "/", resolve: resolve });
      });
    }
    function resolveConflict(decision, applyAll) {
      var c = conflictRef.current; if (!c) return;
      if (applyAll) bulkRef.current = decision;
      setConflict(null);
      c.resolve(decision);
    }
    // load (cached) set of names for a relative dir, to detect overwrite conflicts
    function namesForDir(cacheRef, relDir) {
      relDir = String(relDir || "").replace(/^\/+|\/+$/g, "");
      if (cacheRef[relDir]) return Promise.resolve(cacheRef[relDir]);
      return listDir(relDir).then(function (r) { var set = {}; ((r && r.entries) || []).forEach(function (e) { set[String(e.name).toLowerCase()] = 1; }); cacheRef[relDir] = set; return set; })
        .catch(function () { var set = {}; cacheRef[relDir] = set; return set; });
    }
    function upsertUpload(id, patch) { setUploads(function (list) { var found = false, next = list.map(function (u) { if (u.id === id) { found = true; return Object.assign({}, u, patch); } return u; }); if (!found) next = next.concat([Object.assign({ id: id }, patch)]); return next; }); }

    // items: [{file, sub}] where sub = path relative to cwd (may contain subdirs)
    function runUpload(items) {
      if (!items || !items.length) return;
      bulkRef.current = null;
      var root = rootRef.current;
      if (!root) { // ensure we know the absolute root
        listDir(cwd).then(function (r) { if (r && r.root) rootRef.current = r.root; runUpload(items); });
        return;
      }
      var namesCache = {};
      // pre-register rows
      var rows = items.map(function (it, i) {
        var rel = (cwd ? cwd + "/" : "") + it.sub.replace(/^\/+/, "");
        return { id: "u" + Date.now() + "_" + i, file: it.file, sub: it.sub, rel: rel, dirRel: dirnameOf(rel) };
      });
      rows.forEach(function (r) { upsertUpload(r.id, { name: basenameOf(r.rel), rel: r.rel, pct: 0, status: "queued" }); });

      // 1) create needed sub-directories (parents first), ignore "already exists"
      var dirs = {}; rows.forEach(function (r) { if (r.dirRel) dirs[r.dirRel] = 1; });
      var dirList = Object.keys(dirs).sort(function (a, b) { return a.split("/").length - b.split("/").length; });
      var mkChain = dirList.reduce(function (p, d) { return p.then(function () { return mkdirReq(joinAbs(root, d)).catch(function () {}); }); }, Promise.resolve());

      // 2) sequentially resolve conflicts + upload
      mkChain.then(function () {
        return rows.reduce(function (p, r) {
          return p.then(function () {
            return namesForDir(namesCache, r.dirRel).then(function (names) {
              var targetName = basenameOf(r.rel);
              if (names[targetName.toLowerCase()]) {
                return askConflict(targetName, r.dirRel).then(function (decision) {
                  if (decision === "skip") { upsertUpload(r.id, { status: "skipped" }); return null; }
                  if (decision === "keep") { targetName = uniqueName(targetName, names); r.rel = (r.dirRel ? r.dirRel + "/" : "") + targetName; upsertUpload(r.id, { name: targetName, rel: r.rel }); }
                  // overwrite → same name, server replaces
                  names[targetName.toLowerCase()] = 1;
                  return doOne(r, root);
                });
              }
              names[targetName.toLowerCase()] = 1;
              return doOne(r, root);
            });
          });
        }, Promise.resolve());
      }).then(function () { indexRef.current = null; loadDir(cwd); });

      function doOne(r, rootAbs) {
        upsertUpload(r.id, { status: "uploading", pct: 0 });
        var abs = joinAbs(rootAbs, r.rel);
        return uploadReq(abs, r.file, function (frac) { upsertUpload(r.id, { pct: Math.round(frac * 100) }); })
          .then(function () { upsertUpload(r.id, { status: "done", pct: 100 }); })
          .catch(function (e) { upsertUpload(r.id, { status: "error", error: (e && e.message) || "Fehler" }); });
      }
    }

    function onPickFiles(ev) { var fl = ev.target.files; if (!fl || !fl.length) return; var items = Array.prototype.map.call(fl, function (f) { return { file: f, sub: f.webkitRelativePath || f.name }; }); ev.target.value = ""; runUpload(items); }
    function onDrop(ev) {
      ev.preventDefault(); ev.stopPropagation(); dragDepthRef.current = 0; setDragOver(false);
      var dt = ev.dataTransfer; if (!dt) return;
      if (dt.items && dt.items.length && (dt.items[0].webkitGetAsEntry || dt.items[0].getAsEntry)) {
        collectDropItems(dt.items).then(function (items) { if (items.length) runUpload(items); });
      } else if (dt.files && dt.files.length) {
        runUpload(Array.prototype.map.call(dt.files, function (f) { return { file: f, sub: f.name }; }));
      }
    }
    function onDragEnter(ev) { ev.preventDefault(); dragDepthRef.current++; if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], "Files") !== -1) setDragOver(true); }
    function onDragOver(ev) { ev.preventDefault(); if (ev.dataTransfer) { try { ev.dataTransfer.dropEffect = "copy"; } catch (e) {} } }
    function onDragLeave(ev) { dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) setDragOver(false); }
    function clearFinishedUploads() { setUploads(function (list) { return list.filter(function (u) { return u.status === "uploading" || u.status === "queued"; }); }); }

    // ── delete ──
    function askDelete(rel, name, isDir) { setDelErr(null); setDel({ rel: rel, name: name, isDir: !!isDir }); }
    function submitDelete() {
      var d = del; if (!d) return;
      var absPath = joinAbs(rootRef.current, d.rel);
      setDelBusy(true); setDelErr(null);
      deleteReq(absPath, d.isDir).then(function () {
        setDelBusy(false); setDel(null);
        // if the deleted file is open in the viewer, close it
        var fp = fpRef.current; if (fp && fp.path && String(fp.path).replace(/^\/+/, "") === String(d.rel).replace(/^\/+/, "")) closeViewer();
        indexRef.current = null; loadDir(cwd); if (query) runSearch(query);
      }).catch(function (e) { setDelBusy(false); setDelErr("Konnte nicht l\u00f6schen: " + ((e && e.message) || "Fehler")); });
    }

    // ── download a whole folder as a .zip (client-side) ──
    function downloadFolder(folderRel, folderName) {
      folderRel = String(folderRel).replace(/^\/+|\/+$/g, "");
      var stripLen = dirnameOf(folderRel).length ? (dirnameOf(folderRel).length + 1) : 0; // keep folderName/... in the zip
      setZip({ name: folderName, phase: "listing", done: 0, total: 0 });
      collectFolderFiles(folderRel).then(function (res) {
        var list = res.files;
        if (!list.length) { setZip({ name: folderName, phase: "error", error: "Ordner ist leer oder nicht lesbar." }); return; }
        setZip({ name: folderName, phase: "reading", done: 0, total: list.length, partial: res.partial });
        var entries = [], skipped = 0, done = 0;
        var seq = list.reduce(function (p, f) {
          return p.then(function () {
            return readFile(f.rel).then(function (r) {
              entries.push({ name: f.rel.slice(stripLen), data: dataUrlToBytes(r && r.data_url) });
            }).catch(function () { skipped++; }).then(function () { done++; setZip(function (z) { return (z && z.name === folderName) ? Object.assign({}, z, { done: done }) : z; }); });
          });
        }, Promise.resolve());
        seq.then(function () {
          if (!entries.length) { setZip({ name: folderName, phase: "error", error: "Keine Datei lesbar (evtl. zu gro\u00df)." }); return; }
          setZip(function (z) { return (z && z.name === folderName) ? Object.assign({}, z, { phase: "packing" }) : z; });
          buildZip(entries).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a"); a.href = url; a.download = folderName + ".zip"; document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
            setZip({ name: folderName, phase: "done", done: entries.length, total: list.length, skipped: skipped, partial: res.partial });
            setTimeout(function () { setZip(function (z) { return (z && z.phase === "done" && z.name === folderName) ? null : z; }); }, 5000);
          }).catch(function (e) { setZip({ name: folderName, phase: "error", error: (e && e.message) || "ZIP fehlgeschlagen" }); });
        });
      }).catch(function (e) { setZip({ name: folderName, phase: "error", error: (e && e.message) || "Fehler beim Auslesen" }); });
    }


    // init from URL once
    useEffect(function () {
      if (didInit.current) return; didInit.current = true;
      var sp = null; try { sp = new URLSearchParams(window.location.search || ""); } catch (e) {}
      var f = sp && sp.get("file"); var pth = sp && sp.get("path");
      if (f) { setCwd(dirOf(f)); openViewer(f); }
      else if (pth) setCwd(String(pth).replace(/^\/+/, ""));
    }, []); // eslint-disable-line
    function dirOf(p) { var x = String(p || "").replace(/^\/+/, "").split("/"); x.pop(); return x.join("/"); }

    // load directory when cwd changes
    useEffect(function () { loadDir(cwd); }, [cwd]); // eslint-disable-line
    // sync URL when cwd or open file changes
    useEffect(function () { syncURL(); }, [cwd, filePreview]); // eslint-disable-line
    // debounced search
    useEffect(function () { var t = setTimeout(function () { runSearch(query); }, 220); return function () { clearTimeout(t); }; }, [query]); // eslint-disable-line
    // esc closes viewer / goes back
    useEffect(function () {
      function onKey(e) { if (e.key === "Escape") { if (fpRef.current) { if (stackRef.current && stackRef.current.length) backViewer(); else closeViewer(); } } }
      window.addEventListener("keydown", onKey); return function () { window.removeEventListener("keydown", onKey); };
    }, []); // eslint-disable-line

    // ── breadcrumb ──
    function crumb() {
      var parts = cwd ? cwd.split("/") : [];
      var nodes = [h("button", { key: "root", onClick: function () { setQuery(""); setResults(null); setCwd(""); }, style: crumbBtn(!cwd) }, "root")];
      var acc = "";
      parts.forEach(function (p, i) { acc = acc ? (acc + "/" + p) : p; var target = acc; nodes.push(h("span", { key: "sep" + i, style: { color: muted, margin: "0 2px" } }, "/")); nodes.push(h("button", { key: "c" + i, onClick: function () { setQuery(""); setResults(null); setCwd(target); }, style: crumbBtn(i === parts.length - 1) }, p)); });
      return h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, fontSize: 13, fontFamily: "var(--font-courier, monospace)" } }, nodes);
    }
    function crumbBtn(active) { return { background: "transparent", border: "none", color: active ? "inherit" : accent, cursor: "pointer", padding: "2px 4px", borderRadius: 5, fontSize: 13, fontFamily: "inherit", fontWeight: active ? 700 : 400 }; }

    function rowStyle() { return { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid " + borderC, cursor: "pointer", textDecoration: "none", color: "inherit" }; }

    // ── directory listing ──
    function goUp() {
      var parent = cwd ? cwd.split("/").slice(0, -1).join("/") : "";
      setQuery(""); setResults(null); setCwd(parent);
    }
    function upRow() {
      if (!cwd) return null; // already at root — nothing above
      return h("div", { key: "__up__", onClick: goUp, title: "Up to parent folder", style: rowStyle(), onMouseEnter: function (ev) { ev.currentTarget.style.background = bgMuted; }, onMouseLeave: function (ev) { ev.currentTarget.style.background = "transparent"; } },
        h("span", { style: { color: accent, display: "inline-flex", flex: "0 0 auto" } }, ic(["M9 14 4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"], 18)),
        h("span", { style: { flex: "1 1 auto", minWidth: 0, fontSize: 13.5, fontFamily: "var(--font-courier, monospace)", color: muted } }, ".."));
    }
    function relOfEntry(e) { return (dir && dir.root && e.path && e.path.indexOf(dir.root) === 0) ? e.path.slice(dir.root.length).replace(/^\/+/, "") : (cwd ? (cwd + "/" + e.name) : e.name); }
    function actionBtnStyle(c) { return { display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: c || muted, textDecoration: "none", cursor: "pointer", padding: 5, borderRadius: 7 }; }
    function rowActions(rel, name, isDir) {
      return h("span", { style: { flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 1 } },
        isDir
          ? h("button", { title: "Ordner als ZIP herunterladen", onClick: function (ev) { ev.stopPropagation(); downloadFolder(rel, name); }, style: actionBtnStyle(muted), onMouseEnter: function (ev) { ev.currentTarget.style.color = accent; }, onMouseLeave: function (ev) { ev.currentTarget.style.color = muted; } }, DownloadIcon(16))
          : h("a", { href: filesDownloadHref(rel), target: "_blank", rel: "noopener noreferrer", title: "Download", onClick: function (ev) { ev.stopPropagation(); }, style: actionBtnStyle(muted), onMouseEnter: function (ev) { ev.currentTarget.style.color = accent; }, onMouseLeave: function (ev) { ev.currentTarget.style.color = muted; } }, DownloadIcon(16)),
        h("button", { title: isDir ? "Ordner l\u00f6schen" : "Datei l\u00f6schen", onClick: function (ev) { ev.stopPropagation(); askDelete(rel, name, isDir); }, style: actionBtnStyle(muted), onMouseEnter: function (ev) { ev.currentTarget.style.color = "#f87171"; }, onMouseLeave: function (ev) { ev.currentTarget.style.color = muted; } }, TrashIcon(16)));
    }
    function listView() {
      if (dirLoading && !dir) return h("div", { style: { padding: 20, color: muted, fontSize: 13 } }, "Loading\u2026");
      if (dirErr) return h("div", { style: { padding: 20, color: "#f87171", fontSize: 13 } }, "Could not open folder: " + dirErr);
      var entries = (dir && dir.entries) || [];
      var up = upRow();
      if (!entries.length) return h("div", null, up, h("div", { style: { padding: 20, color: muted, fontSize: 13 } }, "This folder is empty."));
      return h("div", null, up, entries.map(function (e, i) {
        var isDir = e.is_directory;
        return h("div", { key: i, onClick: function () { openEntry(e); }, style: rowStyle(), onMouseEnter: function (ev) { ev.currentTarget.style.background = bgMuted; }, onMouseLeave: function (ev) { ev.currentTarget.style.background = "transparent"; } },
          h("span", { style: { color: isDir ? accent : muted, display: "inline-flex", flex: "0 0 auto" } }, isDir ? FolderIcon(18) : FileIcon(18)),
          h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5 } }, e.name),
          h("span", { style: { flex: "0 0 auto", color: muted, fontSize: 11.5 } }, isDir ? "" : fmtBytes(e.size)),
          h("span", { style: { flex: "0 0 auto", color: muted, fontSize: 11.5, minWidth: 120, textAlign: "right" } }, fmtTime(e.mtime)),
          rowActions(relOfEntry(e), e.name, isDir));
      }));
    }

    // ── search results ──
    function resultsView() {
      if (searching) return h("div", { style: { padding: 20, color: muted, fontSize: 13 } }, "Searching the file tree\u2026");
      if (!results) return null;
      if (!results.items.length) return h("div", { style: { padding: 20, color: muted, fontSize: 13 } }, "No files matching \u201c" + results.q + "\u201d" + (results.partial ? " (index was truncated \u2014 tree is very large)." : "."));
      return h("div", null,
        h("div", { style: { padding: "8px 12px", color: muted, fontSize: 11.5, borderBottom: "1px solid " + borderC } }, results.total + " match" + (results.total === 1 ? "" : "es") + (results.total > results.items.length ? " (showing first " + results.items.length + ")" : "")),
        results.items.map(function (f, i) {
          return h("div", { key: i, onClick: function () { openViewer(f.rel); }, style: rowStyle(), onMouseEnter: function (ev) { ev.currentTarget.style.background = bgMuted; }, onMouseLeave: function (ev) { ev.currentTarget.style.background = "transparent"; } },
            h("span", { style: { color: muted, display: "inline-flex", flex: "0 0 auto" } }, FileIcon(16)),
            h("span", { style: { flex: "1 1 auto", minWidth: 0 } },
              h("div", { style: { fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.name),
              h("div", { style: { fontSize: 11, color: muted, fontFamily: "var(--font-courier, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.rel)),
            h("span", { style: { flex: "0 0 auto", color: muted, fontSize: 11.5 } }, fmtBytes(f.size)),
            rowActions(f.rel, f.name, false));
        }));
    }

    // ── viewer modal ──
    function viewer() {
      if (!filePreview) return null;
      var fp = filePreview;
      var isMd = /markdown/i.test(fp.mime || "") || /\.(md|markdown)$/i.test(fp.name || fp.path || "");
      var isImg = /^image\//i.test(fp.mime || "") || /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(fp.name || fp.path || "");
      var body = fp.loading ? h("div", { style: { color: muted, fontSize: 13 } }, fp.searching ? "File not at that path \u2014 searching the file tree\u2026" : "Loading\u2026")
        : fp.err ? h("div", { style: { color: "#f87171", fontSize: 13, lineHeight: 1.6 } }, "Could not open file: " + fp.err + (fp.searchedNoMatch ? " (no match found by searching either)" : "") + ". You can still try the Download button.")
        : (isImg && fp.dataUrl) ? h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10 } },
            h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", borderRadius: 10, padding: 14, background: "repeating-conic-gradient(rgba(128,128,128,.14) 0% 25%, transparent 0% 50%) 50% / 20px 20px" } },
              h("img", { src: fp.dataUrl, alt: fp.name || fp.path, style: { maxWidth: "100%", maxHeight: "70vh", height: "auto", objectFit: "contain", borderRadius: 6, boxShadow: "0 4px 18px rgba(0,0,0,.35)" } })),
            h("div", { style: { fontSize: 11, color: muted } }, (fp.mime || "image") + (fp.size ? " \u00b7 " + fmtBytes(fp.size) : "")))
        : (fp.text != null) ? ((isMd && !previewRaw) ? h("div", { style: { fontSize: 13.5, lineHeight: 1.65, wordBreak: "break-word" } }, mdBlocks(fp.text, navPathHandler)) : h("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-courier, monospace)", fontSize: 12.5, lineHeight: 1.65 } }, fp.text))
        : h("div", { style: { color: muted, fontSize: 13 } }, "No inline preview for this file type (" + (fp.mime || "unknown") + "). Use the Download button to open it.");
      var mdToggle = (isMd && fp.text != null) ? h("button", { onClick: function () { setPreviewRaw(!previewRaw); }, style: { flex: "0 0 auto", background: "transparent", color: muted, border: "1px solid " + borderC, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer" } }, previewRaw ? "Rendered" : "Raw") : null;
      return h("div", { onClick: function () { closeViewer(); }, style: { position: "fixed", inset: 0, zIndex: 2147483300, background: "rgba(0,0,0,.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 2vw" } },
        h("div", { onClick: function (e) { e.stopPropagation(); }, style: { width: "min(920px, 96vw)", height: "86vh", background: cardBg, border: "1px solid " + borderC, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.6)", display: "flex", flexDirection: "column", overflow: "hidden" } },
          h("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: "1px solid " + borderC, flex: "0 0 auto" } },
            stack.length ? h("button", { onClick: function () { backViewer(); }, title: "Back (Esc)", style: { flex: "0 0 auto", background: "transparent", color: "inherit", border: "1px solid " + borderC, borderRadius: 8, padding: "7px 10px", fontSize: 12.5, cursor: "pointer" } }, "\u2190 Back") : null,
            h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
              h("div", { style: { fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, fp.name || fp.path),
              h("div", { style: { fontSize: 11, color: muted, fontFamily: "var(--font-courier, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: fp.path }, fp.path),
              fp.orig ? h("div", { style: { fontSize: 10.5, color: muted, marginTop: 1 } }, "auto-resolved from \u201c" + fp.orig + "\u201d") : null),
            mdToggle,
            h("a", { href: filesDownloadHref(fp.path), target: "_blank", rel: "noopener noreferrer", style: { flex: "0 0 auto", textDecoration: "none", color: accent, border: "1px solid " + borderC, borderRadius: 8, padding: "7px 13px", fontSize: 12.5 } }, "Download"),
            h("button", { onClick: function () { closeViewer(); }, title: "Close (Esc)", style: { flex: "0 0 auto", background: "transparent", color: muted, border: "1px solid " + borderC, borderRadius: 9, padding: 8, cursor: "pointer", display: "inline-flex" } }, XIcon(20))),
          h("div", { style: { flex: "1 1 auto", overflow: "auto", padding: "18px 22px" } }, body)));
    }

    // ── action bar / upload UI ──
    function toolBtn() { return { flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6, background: bgMuted, color: "inherit", border: "1px solid " + borderC, borderRadius: 9, padding: "8px 12px", fontSize: 12.5, cursor: "pointer" }; }
    function actionBar() {
      return h("div", { style: { display: "inline-flex", alignItems: "center", gap: 8, flex: "0 0 auto", flexWrap: "wrap" } },
        h("input", { ref: fileInputRef, type: "file", multiple: true, onChange: onPickFiles, style: { display: "none" } }),
        h("input", { ref: function (el) { folderInputRef.current = el; if (el) { try { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); el.setAttribute("mozdirectory", ""); } catch (e) {} } }, type: "file", multiple: true, onChange: onPickFiles, style: { display: "none" } }),
        h("button", { onClick: function () { if (fileInputRef.current) fileInputRef.current.click(); }, title: "Dateien hochladen", style: toolBtn() }, UploadIcon(15), "Dateien"),
        h("button", { onClick: function () { if (folderInputRef.current) folderInputRef.current.click(); }, title: "Ordner hochladen \u2014 Struktur bleibt erhalten", style: toolBtn() }, UploadFolderIcon(15), "Ordner"),
        h("button", { onClick: function () { setMkdirName(""); setMkdirErr(null); setMkdirOpen(true); }, title: "Neuen Ordner erstellen", style: toolBtn() }, FolderPlusIcon(15), "Neuer Ordner"));
    }
    function dropOverlay() {
      return h("div", { style: { position: "absolute", inset: 0, zIndex: 20, background: "rgba(99,102,241,.10)", border: "2px dashed " + accent, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, pointerEvents: "none", backdropFilter: "blur(1px)" } },
        h("span", { style: { color: accent, display: "inline-flex" } }, UploadIcon(30)),
        h("div", { style: { fontSize: 14, fontWeight: 700 } }, "Dateien oder Ordner hier ablegen"),
        h("div", { style: { fontSize: 12, color: muted, fontFamily: "var(--font-courier, monospace)" } }, "Upload nach /" + (cwd || "")));
    }
    function uploadPanel() {
      if (!uploads.length) return null;
      var active = uploads.filter(function (u) { return u.status === "uploading" || u.status === "queued"; }).length;
      var done = uploads.filter(function (u) { return u.status === "done"; }).length;
      var errs = uploads.filter(function (u) { return u.status === "error"; }).length;
      return h("div", { style: { border: "1px solid " + borderC, borderRadius: 12, background: cardBg, marginBottom: 10, overflow: "hidden", flex: "0 0 auto" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid " + borderC, fontSize: 12.5 } },
          h("span", { style: { fontWeight: 700 } }, active ? ("L\u00e4dt hoch \u2026 " + active + " offen") : "Uploads"),
          h("span", { style: { color: muted } }, done + " fertig" + (errs ? (" \u00b7 " + errs + " Fehler") : "")),
          h("span", { style: { flex: 1 } }),
          active ? null : h("button", { onClick: clearFinishedUploads, style: { background: "transparent", border: "1px solid " + borderC, color: muted, borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" } }, "Ausblenden")),
        h("div", { style: { maxHeight: 190, overflow: "auto" } }, uploads.map(function (u) {
          var col = u.status === "done" ? "#22c55e" : u.status === "error" ? "#f87171" : u.status === "skipped" ? muted : accent;
          return h("div", { key: u.id, style: { padding: "7px 12px", borderBottom: "1px solid " + borderC } },
            h("div", { style: { display: "flex", gap: 8, fontSize: 12 } },
              h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: u.rel }, u.rel || u.name),
              h("span", { style: { flex: "0 0 auto", color: col } }, u.status === "done" ? "fertig" : u.status === "error" ? (u.error || "Fehler") : u.status === "skipped" ? "\u00fcbersprungen" : ((u.pct || 0) + "%"))),
            (u.status === "uploading" || u.status === "queued" || u.status === "done") ? h("div", { style: { height: 4, background: bgMuted, borderRadius: 3, marginTop: 5, overflow: "hidden" } }, h("div", { style: { height: "100%", width: (u.pct || 0) + "%", background: col, transition: "width .15s" } })) : null);
        })));
    }
    function zipIndicator() {
      if (!zip) return null;
      var pct = zip.total ? Math.round((zip.done / zip.total) * 100) : 0;
      var label = zip.phase === "listing" ? "Ordner wird gelesen \u2026"
        : zip.phase === "reading" ? ("Lese Dateien \u2026 " + zip.done + "/" + zip.total)
        : zip.phase === "packing" ? "Packe ZIP \u2026"
        : zip.phase === "done" ? ("\u201e" + zip.name + ".zip\u201c heruntergeladen" + (zip.skipped ? (" \u00b7 " + zip.skipped + " \u00fcbersprungen") : "") + (zip.partial ? " \u00b7 Ordner sehr gro\u00df, evtl. unvollst\u00e4ndig" : ""))
        : zip.phase === "error" ? ("ZIP fehlgeschlagen: " + (zip.error || "Fehler")) : "";
      var col = zip.phase === "error" ? "#f87171" : zip.phase === "done" ? "#22c55e" : accent;
      return h("div", { style: { border: "1px solid " + borderC, borderRadius: 12, background: cardBg, marginBottom: 10, overflow: "hidden", flex: "0 0 auto" } },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", fontSize: 12.5 } },
          h("span", { style: { color: col, display: "inline-flex", flex: "0 0 auto" } }, DownloadIcon(15)),
          h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
          (zip.phase === "done" || zip.phase === "error") ? h("button", { onClick: function () { setZip(null); }, style: { background: "transparent", border: "1px solid " + borderC, color: muted, borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" } }, "Ausblenden") : null),
        (zip.phase === "reading") ? h("div", { style: { height: 4, background: bgMuted, overflow: "hidden" } }, h("div", { style: { height: "100%", width: pct + "%", background: col, transition: "width .15s" } })) : null);
    }
    function mkdirModal() {
      if (!mkdirOpen) return null;
      return h("div", { onClick: function () { if (!mkdirBusy) setMkdirOpen(false); }, style: { position: "fixed", inset: 0, zIndex: 2147483500, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
        h("div", { onClick: function (e) { e.stopPropagation(); }, style: { width: "min(440px, 94vw)", background: cardBg, border: "1px solid " + borderC, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.6)", padding: 18 } },
          h("div", { style: { fontSize: 15, fontWeight: 700, marginBottom: 4 } }, "Neuer Ordner"),
          h("div", { style: { fontSize: 12, color: muted, marginBottom: 12, fontFamily: "var(--font-courier, monospace)" } }, "in /" + (cwd || "")),
          h("input", { autoFocus: true, value: mkdirName, onChange: function (e) { setMkdirName(e.target.value); setMkdirErr(null); }, onKeyDown: function (e) { if (e.key === "Enter") submitMkdir(); else if (e.key === "Escape" && !mkdirBusy) setMkdirOpen(false); }, placeholder: "Ordnername", style: { width: "100%", boxSizing: "border-box", padding: "9px 11px", background: bgMuted, border: "1px solid " + (mkdirErr ? "#f87171" : borderC), borderRadius: 9, color: "inherit", fontSize: 13.5, outline: "none" } }),
          mkdirErr ? h("div", { style: { color: "#f87171", fontSize: 12, marginTop: 7 } }, mkdirErr) : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 } },
            h("button", { onClick: function () { if (!mkdirBusy) setMkdirOpen(false); }, style: { background: "transparent", border: "1px solid " + borderC, color: muted, borderRadius: 9, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" } }, "Abbrechen"),
            h("button", { onClick: submitMkdir, style: { background: accent, border: "1px solid " + accent, color: "#fff", borderRadius: 9, padding: "8px 16px", fontSize: 12.5, cursor: "pointer", opacity: mkdirBusy ? .7 : 1 } }, mkdirBusy ? "\u2026" : "Erstellen"))));
    }
    function cbtn(c) { return { background: "transparent", border: "1px solid " + borderC, color: c, borderRadius: 9, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" }; }
    function applyAllChecked() { var el = (typeof document !== "undefined") ? document.getElementById("__bhfe_applyall") : null; return !!(el && el.checked); }
    function conflictModal() {
      if (!conflict) return null;
      return h("div", { style: { position: "fixed", inset: 0, zIndex: 2147483500, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
        h("div", { style: { width: "min(470px, 94vw)", background: cardBg, border: "1px solid " + borderC, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.6)", padding: 18 } },
          h("div", { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, "Datei existiert bereits"),
          h("div", { style: { fontSize: 13, lineHeight: 1.55, marginBottom: 14 } }, "\u201e", h("b", null, conflict.name), "\u201c existiert bereits in ", h("span", { style: { fontFamily: "var(--font-courier, monospace)", color: muted } }, "/" + (conflict.dir || "")), ". Was m\u00f6chtest du tun?"),
          h("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: muted, marginBottom: 14, cursor: "pointer" } },
            h("input", { type: "checkbox", id: "__bhfe_applyall" }), "F\u00fcr alle weiteren Konflikte \u00fcbernehmen"),
          h("div", { style: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 } },
            h("button", { onClick: function () { resolveConflict("skip", applyAllChecked()); }, style: cbtn(muted) }, "\u00dcberspringen"),
            h("button", { onClick: function () { resolveConflict("keep", applyAllChecked()); }, style: cbtn("inherit") }, "Beide behalten"),
            h("button", { onClick: function () { resolveConflict("overwrite", applyAllChecked()); }, style: Object.assign(cbtn("#fff"), { background: accent, borderColor: accent }) }, "\u00dcberschreiben"))));
    }

    function deleteModal() {
      if (!del) return null;
      return h("div", { onClick: function () { if (!delBusy) setDel(null); }, style: { position: "fixed", inset: 0, zIndex: 2147483500, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 } },
        h("div", { onClick: function (e) { e.stopPropagation(); }, style: { width: "min(460px, 94vw)", background: cardBg, border: "1px solid " + borderC, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.6)", padding: 18 } },
          h("div", { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, del.isDir ? "Ordner l\u00f6schen?" : "Datei l\u00f6schen?"),
          h("div", { style: { fontSize: 13, lineHeight: 1.55, marginBottom: 4 } }, "\u201e", h("b", null, del.name), "\u201c", del.isDir ? " und der gesamte Inhalt werden dauerhaft gel\u00f6scht." : " wird dauerhaft gel\u00f6scht.", " Das kann nicht r\u00fcckg\u00e4ngig gemacht werden."),
          h("div", { style: { fontSize: 11.5, color: muted, fontFamily: "var(--font-courier, monospace)", marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: "/" + del.rel }, "/" + del.rel),
          delErr ? h("div", { style: { color: "#f87171", fontSize: 12, marginBottom: 12 } }, delErr) : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
            h("button", { onClick: function () { if (!delBusy) setDel(null); }, style: { background: "transparent", border: "1px solid " + borderC, color: muted, borderRadius: 9, padding: "8px 14px", fontSize: 12.5, cursor: "pointer" } }, "Abbrechen"),
            h("button", { onClick: submitDelete, style: { background: "#ef4444", border: "1px solid #ef4444", color: "#fff", borderRadius: 9, padding: "8px 16px", fontSize: 12.5, cursor: "pointer", opacity: delBusy ? .7 : 1 } }, delBusy ? "\u2026" : "L\u00f6schen"))));
    }

    return h("div", { style: { display: "flex", flexDirection: "column", height: "100%", fontFamily: "inherit" } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 4px 14px", flexWrap: "wrap" } },
        h("div", { style: { flex: "1 1 auto", minWidth: 160 } }, crumb()),
        actionBar(),
        h("div", { style: { flex: "0 0 auto", position: "relative", display: "inline-flex", alignItems: "center" } },
          h("span", { style: { position: "absolute", left: 10, color: muted, display: "inline-flex", pointerEvents: "none" } }, SearchIcon(15)),
          h("input", { value: query, onChange: function (e) { setQuery(e.target.value); }, placeholder: "Search files\u2026  (* = wildcard)", style: { width: 260, maxWidth: "60vw", padding: "8px 30px 8px 32px", background: bgMuted, border: "1px solid " + borderC, borderRadius: 9, color: "inherit", fontSize: 13, outline: "none" } }),
          query ? h("button", { onClick: function () { setQuery(""); setResults(null); }, title: "Clear", style: { position: "absolute", right: 6, background: "transparent", border: "none", color: muted, cursor: "pointer", display: "inline-flex", padding: 2 } }, XIcon(15)) : null)),
      uploadPanel(),
      zipIndicator(),
      h("div", { onDragEnter: onDragEnter, onDragOver: onDragOver, onDragLeave: onDragLeave, onDrop: onDrop, style: { flex: "1 1 auto", position: "relative", overflow: "auto", border: "1px solid " + borderC, borderRadius: 12, background: cardBg, minHeight: 0 } },
        query ? resultsView() : listView(),
        dragOver ? dropOverlay() : null),
      viewer(), mkdirModal(), conflictModal(), deleteModal());
  }

  window.__HERMES_PLUGINS__.register("fileexplorer", Explorer);
})();
