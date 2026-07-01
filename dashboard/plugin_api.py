"""Better Hermes File Explorer — backend for the path-resolution cache.

The dashboard resolves file/folder paths written inside Markdown (often with a
missing prefix) by searching the managed file tree. That search is expensive,
so its result — "does this slash-path point at a real file/folder, and if so
what is its resolved path" — is persisted here, server-side, keyed by the path
string as written.

This makes an expensive tree search run **at most once** across all browsers,
users and page reloads instead of on every load.

Fully self-contained: this plugin owns its own SQLite DB
(``$HERMES_HOME/fileexplorer/pathcache.db``) and never reads any other plugin's
data. It works whether or not the Tasklist plugin is installed.

The dashboard declares ``"api": "plugin_api.py"`` in its manifest; Hermes imports
this file and mounts ``router`` at ``/api/plugins/fileexplorer/``.
"""

from __future__ import annotations

import os
import time
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# TTLs: keep positive resolutions long; re-check "not found" sooner so a file
# created after a negative lookup becomes linkable again without manual clears.
_PC_TTL_VALID = 7 * 24 * 3600
_PC_TTL_INVALID = 3600
_PC_MAX_ROWS = 5000


def _hermes_home() -> Path:
    h = os.environ.get("HERMES_HOME")
    return Path(h) if h else (Path.home() / ".hermes")


def _db_path() -> Path:
    d = _hermes_home() / "fileexplorer"
    d.mkdir(parents=True, exist_ok=True)
    return d / "pathcache.db"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(_db_path()), check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(
        "CREATE TABLE IF NOT EXISTS path_cache ("
        "  cand TEXT PRIMARY KEY,"          # path string as written in text
        "  state TEXT NOT NULL,"            # 'valid' | 'invalid'
        "  resolved TEXT,"                  # real relative path when resolved
        "  updated_at INTEGER NOT NULL)"
    )
    return c


class PathCachePut(BaseModel):
    cand: str
    state: str                             # 'valid' | 'invalid'
    resolved: Optional[str] = None


@router.get("/pathcache")
def get_path_cache():
    """Return all still-fresh cache entries as {cand: {state, resolved}}."""
    now = int(time.time())
    c = _conn()
    try:
        c.execute(
            "DELETE FROM path_cache WHERE (state='valid' AND updated_at < ?) "
            "OR (state<>'valid' AND updated_at < ?)",
            (now - _PC_TTL_VALID, now - _PC_TTL_INVALID),
        )
        c.commit()
        rows = c.execute("SELECT cand, state, resolved FROM path_cache").fetchall()
        entries = {r["cand"]: {"state": r["state"], "resolved": r["resolved"]} for r in rows}
        return {"entries": entries}
    finally:
        c.close()


@router.put("/pathcache")
def put_path_cache(body: PathCachePut):
    """Upsert one decision. state must be 'valid' or 'invalid'."""
    if not body.cand or body.state not in ("valid", "invalid"):
        raise HTTPException(status_code=400, detail="cand + state('valid'|'invalid') required")
    now = int(time.time())
    c = _conn()
    try:
        c.execute(
            "INSERT INTO path_cache (cand, state, resolved, updated_at) VALUES (?,?,?,?) "
            "ON CONFLICT(cand) DO UPDATE SET state=excluded.state, "
            "  resolved=excluded.resolved, updated_at=excluded.updated_at",
            (body.cand, body.state, body.resolved, now),
        )
        n = c.execute("SELECT COUNT(*) AS n FROM path_cache").fetchone()["n"]
        if n > _PC_MAX_ROWS:
            c.execute(
                "DELETE FROM path_cache WHERE cand IN ("
                "  SELECT cand FROM path_cache ORDER BY updated_at ASC LIMIT ?)",
                (n - _PC_MAX_ROWS,),
            )
        c.commit()
        return {"ok": True}
    finally:
        c.close()


@router.delete("/pathcache")
def clear_path_cache():
    """Clear the whole cache (force a re-check, e.g. after creating files)."""
    c = _conn()
    try:
        n = c.execute("SELECT COUNT(*) AS n FROM path_cache").fetchone()["n"]
        c.execute("DELETE FROM path_cache")
        c.commit()
        return {"ok": True, "cleared": n}
    finally:
        c.close()
