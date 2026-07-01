# Better Hermes File Explorer

A drop-in **Files** tab for the [Hermes Agent](https://github.com/NousResearch/Hermes) dashboard.

Browse the managed file tree, preview files inline, search filenames across the
whole tree, and deep-link to any folder or file by URL — all without leaving the
dashboard. It talks to the built-in core file API (`/api/files`), so there is
**no backend to install** and nothing new to authenticate: it uses your existing
dashboard session.

<p align="center">
  <img src="docs/screenshot-explorer.png" alt="Better Hermes File Explorer" width="820">
</p>

## Features

- **Folder browser** — walk the managed file root (`/opt/data` in the hosted
  layout) like a normal file manager: folders first, sizes, modified times, a
  clickable breadcrumb, and click-to-open.
- **Rich inline file viewer**
  - **Markdown** rendered properly (headings, bold/italic, inline & fenced code,
    lists incl. nesting, tables, blockquotes, links) with a **Raw / Rendered**
    toggle.
  - **Images** (`png`, `jpg`, `gif`, `webp`, `svg`, …) shown inline on a
    transparency-checker background.
  - **Text / code / JSON / YAML** shown as readable monospace.
  - **Download** button for anything (uses the core download endpoint).
- **Clickable paths inside files** — file paths written inside a Markdown file
  become links that open the target *in the same viewer*, with a **← Back**
  button to return to the previous file. Folder paths open in the browser.
  Web URLs (`https://…`, `www.…`) open in a new tab.
- **Smart path resolution** — agents often write paths relative to their working
  directory (e.g. `feasibility-reviews/x.md` when the file really lives at
  `strategy-lab/pending/feasibility-reviews/x.md`). The viewer searches the tree
  and resolves the real path automatically, showing an "auto-resolved from …"
  note.
- **Filename search** — a search box that indexes the tree and finds files by
  substring anywhere in their path, with the full relative path shown.
- **Deep-linking** — the current folder or open file is reflected in the URL:
  - `…/files?path=strategy-lab/research` opens a folder
  - `…/files?file=strategy-lab/research/proof.md` opens a file
  These URLs are shareable and reload-safe.

## Install

Hermes discovers dashboard plugins from `plugins/<name>/dashboard/manifest.json`
under any of its plugin roots (user: `~/.hermes/plugins/`, bundled, or project).

**Via git (recommended):**

```bash
hermes plugin install https://github.com/LouisKlimek/Better-Hermes-File-Explorer
```

**Manual:** copy this repository into a plugin directory so the layout is:

```
~/.hermes/plugins/fileexplorer/
  dashboard/
    manifest.json
    dist/index.js
```

Then refresh the dashboard's plugin list (Settings → rescan plugins, or hit
`/api/dashboard/plugins/rescan`) and reload the page. A **Files** tab appears.

> This plugin is **frontend-only** — it has no `api` field, so a plugin rescan /
> asset reload is enough; no `docker restart` is required.

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

Auth is handled the same way the rest of the dashboard does it: requests carry
the same-origin session cookie plus an `Authorization: Bearer` token, which the
core `auth_middleware` accepts.

## Works great with Hermes-Tasklist-Plugin

If you also run the
[Hermes-Tasklist-Plugin](https://github.com/LouisKlimek/Hermes-Tasklist-Plugin),
it will **detect this plugin automatically**. When the File Explorer is
installed, clickable file *and folder* paths inside task descriptions, results,
run summaries and comments deep-link straight into this Explorer
(`…/files?file=…` / `…/files?path=…`) instead of the tasklist's built-in mini
viewer. If the Explorer isn't installed, the tasklist falls back to its own
in-app viewer — no configuration needed either way.

## Configuration

None required. Optional manifest fields you can tweak in
`dashboard/manifest.json`:

- `label` — the tab title (default **Files**).
- `icon` — a lucide icon name (default `FolderOpen`).
- `tab.path` — the route the tab lives at (default `/files`).
- `tab.position` — where the tab sits (default `after:skills`).

## Compatibility & notes

- The tree walk used by search and path-resolution is **bounded** (it skips
  heavy directories like `node_modules`, `.git`, `dist`, `site-packages`, and
  caps how many folders it lists) so it stays fast on large roots. On a very
  large tree the search index may be truncated; the UI says so when that happens.
- `GET /api/files/read` is size-limited by Hermes; oversized files can't be
  previewed inline — use **Download**.
- Tested against the Hermes dashboard plugin SDK (React, no build step).

## License

MIT — see [LICENSE](LICENSE).
