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
  function fmtBytes(n) { if (n == null) return ""; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(1) + " GB"; }
  function fmtTime(t) { if (!t) return ""; try { var d = new Date(t * 1000); return d.toLocaleString(); } catch (e) { return ""; } }
  function isFilePath(p) { return /\.[A-Za-z0-9]{1,8}$/.test(String(p).split("/").pop()); }

  // ── icons ──
  function ic(paths, sz, extra) { return h("svg", Object.assign({ width: sz || 16, height: sz || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, extra || {}), paths.map(function (d, i) { return h("path", { key: i, d: d }); })); }
  function FolderIcon(sz) { return h("svg", { width: sz || 18, height: sz || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M4 4h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" })); }
  function FileIcon(sz) { return h("svg", { width: sz || 18, height: sz || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), h("path", { d: "M14 2v6h6" })); }
  function SearchIcon(sz) { return h("svg", { width: sz || 16, height: sz || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("circle", { cx: 11, cy: 11, r: 8 }), h("path", { d: "M21 21l-4.3-4.3" })); }
  function XIcon(sz) { return h("svg", { width: sz || 18, height: sz || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, h("path", { d: "M18 6 6 18" }), h("path", { d: "m6 6 12 12" })); }

  // ── markdown renderer (same engine as the file viewer) ──
  function mdCodeStyle() { return { fontFamily: "var(--font-courier, monospace)", fontSize: "0.9em", background: "rgba(128,128,128,.18)", border: "1px solid rgba(128,128,128,.28)", borderRadius: 4, padding: "0.5px 5px", color: "inherit" }; }
  function mdInline(s, onOpen) {
    var out = [], rest = String(s == null ? "" : s), key = 0;
    var pats = [
      { re: /`([^`]+)`/, mk: function (m) { var inner = m[1]; var pp = inner.trim(); if (onOpen && /^(?:[\w.\-]+\/)+[\w.\-]+\.[A-Za-z0-9]{1,8}$/.test(pp)) { return h("a", { key: "cl" + (key++), href: (onOpen.hrefFor ? onOpen.hrefFor(pp) : filesDownloadHref(pp)), target: "_blank", rel: "noopener noreferrer", title: "Open " + pp, onClick: function (e) { e.preventDefault(); e.stopPropagation(); onOpen(pp); }, style: Object.assign({}, mdCodeStyle(), { color: accent, textDecoration: "underline", cursor: "pointer", wordBreak: "break-all" }) }, inner); } return h("code", { key: "c" + (key++), style: mdCodeStyle() }, inner); } },
      { re: /((?:https?:\/\/|www\.)[^\s<>()\[\]]+)/, mk: function (m) { var raw = m[1].replace(/[.,;:!?]+$/, ""); var href = /^www\./i.test(raw) ? ("https://" + raw) : raw; return h("a", { key: "u" + (key++), href: href, target: "_blank", rel: "noopener noreferrer", onClick: function (e) { e.stopPropagation(); }, style: { color: accent, textDecoration: "underline", wordBreak: "break-all" } }, raw); } },
      { re: /\*\*([^*]+)\*\*/, mk: function (m) { return h("strong", { key: "b" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /__([^_]+)__/, mk: function (m) { return h("strong", { key: "b" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /\*([^*]+)\*/, mk: function (m) { return h("em", { key: "i" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /~~([^~]+)~~/, mk: function (m) { return h("del", { key: "s" + (key++) }, mdInline(m[1], onOpen)); } },
      { re: /\[([^\]]+)\]\(([^)\s]+)\)/, mk: function (m) { return h("a", { key: "l" + (key++), href: m[2], target: "_blank", rel: "noopener noreferrer", onClick: function (e) { e.stopPropagation(); }, style: { color: accent, textDecoration: "underline" } }, m[1]); } }
    ];
    if (onOpen) pats.push({ re: /((?:[\w.\-]+\/)+[\w.\-]+\.[A-Za-z0-9]{1,8})/, mk: function (m) { var pp = m[1]; return h("a", { key: "fp" + (key++), href: (onOpen.hrefFor ? onOpen.hrefFor(pp) : filesDownloadHref(pp)), target: "_blank", rel: "noopener noreferrer", title: "Open " + pp, onClick: function (e) { e.preventDefault(); e.stopPropagation(); onOpen(pp); }, style: { color: accent, textDecoration: "underline", wordBreak: "break-all", cursor: "pointer" } }, pp); } });
    if (onOpen && onOpen.folders) pats.push({ re: /((?:[\w.\-]+\/){2,}[\w.\-]+)(?![\w.\-]*\.[A-Za-z0-9])/, mk: function (m) { var pp = m[1].replace(/\/+$/, ""); return h("a", { key: "dp" + (key++), href: (onOpen.hrefFor ? onOpen.hrefFor(pp) : "#"), target: "_blank", rel: "noopener noreferrer", title: "Open folder " + pp, onClick: function (e) { e.preventDefault(); e.stopPropagation(); onOpen(pp); }, style: { color: accent, textDecoration: "underline", wordBreak: "break-all", cursor: "pointer" } }, m[1]); } });
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

    var resolveCacheRef = useRef({});
    var indexRef = useRef(null);
    var fpRef = useRef(null); fpRef.current = filePreview;
    var stackRef = useRef([]); stackRef.current = stack;
    var cwdRef = useRef(""); cwdRef.current = cwd;
    var didInit = useRef(false);

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
            if (resolved && resolved !== clean) { readFile(resolved).then(function (r) { setFilePreview(Object.assign({ path: resolved, orig: path, loading: false }, parseRead(resolved, r))); }).catch(function (e) { setFilePreview({ path: path, loading: false, err: (e && e.message) || "not found" }); }); }
            else setFilePreview({ path: path, loading: false, err: "not found", searchedNoMatch: true });
          }).catch(function () { setFilePreview({ path: path, loading: false, err: "not found" }); });
        });
    }
    function openViewer(path) { setStack([]); loadFilePreview(path); }
    function navViewer(path) { var cur = fpRef.current; if (cur) setStack(function (st) { return st.concat([cur]); }); loadFilePreview(path); }
    function backViewer() { var st = stackRef.current || []; if (!st.length) { setFilePreview(null); return; } var prev = st[st.length - 1]; setStack(st.slice(0, -1)); setPreviewRaw(false); setFilePreview(prev); }
    function closeViewer() { setFilePreview(null); setStack([]); }

    // path handler for markdown inside previewed files: files open in viewer, folders navigate the browser
    function navPathHandler(path) {
      if (isFilePath(path)) navViewer(path);
      else { closeViewer(); setQuery(""); setResults(null); setCwd(String(path).replace(/^\/+/, "")); }
    }
    navPathHandler.folders = true;
    navPathHandler.hrefFor = function (p) { return isFilePath(p) ? filesDownloadHref(p) : (currentPluginPath() + "?path=" + encodeURIComponent(String(p).replace(/^\/+/, ""))); };

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
        var matches = idx.files.filter(function (f) { return f.rel.toLowerCase().indexOf(ql) !== -1; });
        matches.sort(function (a, b) { var an = a.name.toLowerCase() === ql, bn = b.name.toLowerCase() === ql; if (an !== bn) return an ? -1 : 1; return a.rel.length - b.rel.length; });
        setResults({ q: q, items: matches.slice(0, 500), total: matches.length, partial: idx.partial });
        setSearching(false);
      };
      if (indexRef.current) go(indexRef.current);
      else buildIndex().then(function (idx) { indexRef.current = idx; go(idx); }).catch(function () { setResults({ q: q, items: [], total: 0 }); setSearching(false); });
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
    function listView() {
      if (dirLoading && !dir) return h("div", { style: { padding: 20, color: muted, fontSize: 13 } }, "Loading\u2026");
      var entries = (dir && dir.entries) || [];
      if (dirErr) return h("div", { style: { padding: 20, color: "#f87171", fontSize: 13 } }, "Could not open folder: " + dirErr);
      if (!entries.length) return h("div", { style: { padding: 20, color: muted, fontSize: 13 } }, "This folder is empty.");
      return h("div", null, entries.map(function (e, i) {
        var isDir = e.is_directory;
        return h("div", { key: i, onClick: function () { openEntry(e); }, style: rowStyle(), onMouseEnter: function (ev) { ev.currentTarget.style.background = bgMuted; }, onMouseLeave: function (ev) { ev.currentTarget.style.background = "transparent"; } },
          h("span", { style: { color: isDir ? accent : muted, display: "inline-flex", flex: "0 0 auto" } }, isDir ? FolderIcon(18) : FileIcon(18)),
          h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5 } }, e.name),
          h("span", { style: { flex: "0 0 auto", color: muted, fontSize: 11.5 } }, isDir ? "" : fmtBytes(e.size)),
          h("span", { style: { flex: "0 0 auto", color: muted, fontSize: 11.5, minWidth: 140, textAlign: "right" } }, fmtTime(e.mtime)));
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
            h("span", { style: { flex: "0 0 auto", color: muted, fontSize: 11.5 } }, fmtBytes(f.size)));
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

    return h("div", { style: { display: "flex", flexDirection: "column", height: "100%", fontFamily: "inherit" } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 4px 14px", flexWrap: "wrap" } },
        h("div", { style: { flex: "1 1 auto", minWidth: 0 } }, crumb()),
        h("div", { style: { flex: "0 0 auto", position: "relative", display: "inline-flex", alignItems: "center" } },
          h("span", { style: { position: "absolute", left: 10, color: muted, display: "inline-flex", pointerEvents: "none" } }, SearchIcon(15)),
          h("input", { value: query, onChange: function (e) { setQuery(e.target.value); }, placeholder: "Search files\u2026", style: { width: 260, maxWidth: "60vw", padding: "8px 30px 8px 32px", background: bgMuted, border: "1px solid " + borderC, borderRadius: 9, color: "inherit", fontSize: 13, outline: "none" } }),
          query ? h("button", { onClick: function () { setQuery(""); setResults(null); }, title: "Clear", style: { position: "absolute", right: 6, background: "transparent", border: "none", color: muted, cursor: "pointer", display: "inline-flex", padding: 2 } }, XIcon(15)) : null)),
      h("div", { style: { flex: "1 1 auto", overflow: "auto", border: "1px solid " + borderC, borderRadius: 12, background: cardBg } }, query ? resultsView() : listView()),
      viewer());
  }

  window.__HERMES_PLUGINS__.register("fileexplorer", Explorer);
})();
