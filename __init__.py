"""Better Hermes File Explorer — plugin package.

This plugin is **dashboard-only**: all of its functionality lives in the
frontend bundle at ``dashboard/dist/index.js`` (registered with the Hermes
dashboard via ``window.__HERMES_PLUGINS__.register``). It talks directly to the
built-in core file API (``/api/files``, ``/api/files/read``,
``/api/files/download``) using your existing dashboard session, so there is no
agent-side component, no backend routes, and no lifecycle hooks to wire up.

This module exists only so the plugin is a well-formed, importable Python
package (some plugin loaders import ``__init__.py`` and call ``register`` at
agent start-up). ``register`` is intentionally a no-op — installing/enabling the
plugin has no effect on agent behaviour; it simply makes the **Files** tab
appear in the dashboard.
"""

from __future__ import annotations

import logging
from typing import Any

__all__ = ["register"]

logger = logging.getLogger("fileexplorer")


def register(ctx: Any) -> None:
    """No-op agent-side registration.

    The File Explorer has no agent hooks. Accepts the standard ``ctx`` argument
    for loader compatibility and does nothing. The user-facing feature is the
    dashboard **Files** tab defined in ``dashboard/``.
    """
    logger.debug(
        "Better Hermes File Explorer: dashboard-only plugin; no agent hooks to register."
    )
    return None
