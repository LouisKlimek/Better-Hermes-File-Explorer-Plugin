# Better Hermes File Explorer

A drop-in **Files** tab for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) dashboard.

Browse the managed file tree, preview files inline, search filenames (with `*`
wildcards) across the whole tree, **upload files and whole folders**, **download
folders as a `.zip`**, **create and delete folders/files**, and deep-link to any
folder or file by URL — all without leaving the dashboard. It talks to the
built-in core file API (`/api/files`), so there is **no backend to install** and
nothing new to authenticate: it uses your existing dashboard session.

<p align="center">
  <img src="docs/screenshot-explorer.png" alt="Better Hermes File Explorer" width="820">
</p>

## Features

- **Folder browser** — walk the managed file root (`/opt/data` in the hosted
  layout) like a normal file manager: folders first, sizes, modified times, a
  clickable breadcrumb, and click-to-open. A **`..` row** at the top of every
  sub-folder jumps up to the parent. Each row has quick actions on the right: a
  **download** button (files download directly; **folders download as a `.zip`**)
  and a **delete** (trash) button.
- **Download folders as ZIP** — the download button on a folder recursively reads
  every file underneath it and packs them into a `.zip` **entirely in the
  browser** (real DEFLATE compression via the native `CompressionStream` API,
  falling back to a stored/uncompressed zip where that isn't available). A small
  progress indicator shows read/pack status. Files the core can't read inline
  (oversized) are skipped and reported; very large trees are bounded.
- **File-type icons** — each file shows a colour-coded badge icon with its
  extension (`PY`, `JS`, `TS`, `MD`, `PNG`, `JSON`, `ZIP`, …), so types are
  distinguishable at a glance. Unknown extensions fall back to the extension text
  on a neutral badge; the set is a simple data map that's easy to extend.
- **Delete** — the per-row trash button removes a file or folder after a
  **confirmation prompt** (folders are deleted recursively, with the contents
  clearly called out in the prompt). The open viewer closes automatically if the
  file it was showing is deleted.
- **Upload** — add files without leaving the dashboard:
  - **Drag & drop** anywhere onto the listing, or use the **Dateien** (files)
    button.
  - **Whole-folder upload** — the **Ordner** button (and dropping a folder)
    recreates the complete directory structure at the target, files in the right
    places. Needed sub-folders are created automatically.
  - **Per-file progress bars** (real upload progress) plus an overall
    done / error summary.
  - **Overwrite handling** — if a file already exists at the target you get a
    prompt: **Overwrite**, **Keep both** (auto-renames to `name (1).ext`), or
    **Skip** — with an *apply to all remaining conflicts* option.
- **Create folder** — the **Neuer Ordner** button creates a directory in the
  current folder, with a name-collision check before it calls the core.
- **Rich inline file viewer**
  - **Markdown** rendered properly (headings, bold/italic, inline & fenced code,
    lists incl. nesting, tables, blockquotes, links) with a **Raw / Rendered**
    toggle.
  - **Images** (`png`, `jpg`, `gif`, `webp`, `svg`, …) shown inline on a
    transparency-checker background.
  - **JSON** is **beautified by default** — pretty-printed with indentation and
    syntax highlighting (keys, strings, numbers, booleans, `null` colour-coded).
    A header toggle switches between **Beautified** and **Original**; invalid
    JSON falls back to the raw view automatically.
  - **Text / code / YAML** shown as readable monospace.
  - **Download** button for anything (uses the core download endpoint).
- **Clickable paths inside files** — file paths written inside a Markdown file
  become links that open the target *in the same viewer*, with a **← Back**
  button to return to the previous file. Folder paths open in the browser.
  Web URLs (`https://…`, `www.…`) open in a new tab.
- **Smart path resolution** — agents often write paths relative to their working
  directory (e.g. `feasibility-reviews/x.md` when the file really lives at
  `strategy-lab/pending/feasibility-reviews/x.md`). The viewer searches the tree
  and resolves the real path automatically, showing an "auto-resolved from …"
  note. When it resolves, the browser behind the viewer follows to the file's
  **real folder**, so closing the viewer lands you in the right place (not on the
  original, non-existent path).
- **Filename search with `*` wildcards** — a search box that indexes the tree and
  finds files by substring anywhere in their path. Add `*` to match any run of
  characters: `*.md` finds everything ending in `.md`, `test*abc` matches names
  that start with `test` and end with `abc`. Without a `*` it stays a plain
  substring match. The full relative path is shown for every hit.
- **Deep-linking** — the current folder or open file is reflected in the URL:
  - `…/file-explorer?path=strategy-lab/research` opens a folder
  - `…/file-explorer?file=strategy-lab/research/proof.md` opens a file
  These URLs are shareable and reload-safe.

## Install

Hermes discovers dashboard plugins from `plugins/<name>/dashboard/manifest.json`
under any of its plugin roots (user: `~/.hermes/plugins/`, bundled, or project).

**Via git (recommended):**

```bash
hermes plugin install https://github.com/LouisKlimek/Better-Hermes-File-Explorer-Plugin
```

**Manual:** copy this repository into a plugin directory so the layout is:

```
~/.hermes/plugins/fileexplorer/
  dashboard/
    manifest.json
    dist/index.js
```

Then refresh the dashboard's plugin list (Settings → rescan plugins, or hit
`/api/dashboard/plugins/rescan`) and reload the page. A **Files** tab appears at `/file-explorer`.

> This plugin is **frontend-only** — it has no `api` field, so a plugin rescan /
> asset reload is enough; no `docker restart` is required. Upload and folder
> creation use the core's own write endpoints, so they need no extra backend
> either.

Confirm it's live: `GET /api/dashboard/plugins` should list `"name":
"fileexplorer"` with the current `version`.

## How it works

The plugin is a single no-build IIFE (`dashboard/dist/index.js`) that registers
itself through the Hermes Plugin SDK (`window.__HERMES_PLUGINS__.register`). All
data comes from the core managed-files endpoints:

| Endpoint | Used for |
| --- | --- |
| `GET /api/files?path=<dir>` | directory listing + tree walk (search / resolve) |
| `GET /api/files/read?path=<file>` | inline preview (returns a base64 `data_url`) |
| `GET /api/files/download?path=<file>&token=<t>` | the Download button |
| `POST /api/files/mkdir` | create folder — JSON body `{"path": "<absolute path>"}` |
| `POST /api/files/upload-stream` | upload — `multipart/form-data`, one file per request |
| `DELETE /api/files` | delete — JSON body `{"path": "<absolute path>", "recursive": <bool>}` |

The core works in **absolute** paths under the managed root (e.g.
`/opt/data/…`); the plugin works internally in paths relative to that root and
prefixes the root (read from any listing's `root` field) when it writes.

Auth is handled the same way the rest of the dashboard does it: requests carry
the same-origin session cookie plus an `Authorization: Bearer` token, which the
core `auth_middleware` accepts. Uploads use `XMLHttpRequest` so real progress can
be reported.

> **Upload field names.** The `upload-stream` multipart field names are defined
> as two constants at the top of `dashboard/dist/index.js`
> (`UPLOAD_FIELD_PATH` / `UPLOAD_FIELD_FILE`, defaulting to `path` / `file`). If a
> future core build uses different names, change those two constants — nothing
> else needs to change.

## Works great with Hermes-Tasklist-Plugin

If you also run the
[Hermes-Tasklist-Plugin](https://github.com/LouisKlimek/Hermes-Tasklist-Plugin),
it will **detect this plugin automatically**. When the File Explorer is
installed, clickable file *and folder* paths inside task descriptions, results,
run summaries and comments deep-link straight into this Explorer
(`…/file-explorer?file=…` / `…/file-explorer?path=…`) instead of the tasklist's built-in mini
viewer. If the Explorer isn't installed, the tasklist falls back to its own
in-app viewer — no configuration needed either way.

## Configuration

None required. Optional manifest fields you can tweak in
`dashboard/manifest.json`:

- `label` — the tab title (default **Files**).
- `icon` — a lucide icon name (default `FolderOpen`).
- `tab.path` — the route the tab lives at (default `/file-explorer`).
- `tab.position` — where the tab sits (default `after:skills`).

## Compatibility & notes

- The tree walk used by search and path-resolution is **bounded** (it skips
  heavy directories like `node_modules`, `.git`, `dist`, `site-packages`, and
  caps how many folders it lists) so it stays fast on large roots. On a very
  large tree the search index may be truncated; the UI says so when that happens.
  The index is rebuilt after an upload or folder creation so new files show up in
  search.
- Folder upload uses the browser's directory-picker (`webkitdirectory`) and, for
  drag & drop, the `webkitGetAsEntry` filesystem API. Both are supported in
  current Chromium and Firefox.
- `GET /api/files/read` is size-limited by Hermes; oversized files can't be
  previewed inline — use **Download**.
- Tested against the Hermes dashboard plugin SDK (React, no build step).

## License

MIT — see [LICENSE](LICENSE).
