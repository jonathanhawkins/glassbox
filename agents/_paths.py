"""Path bootstrap so `from contract.events import ...` resolves.

Import this module (``from agents import _paths``) or call ``ensure_repo_root()``
at the top of any agents module before importing ``contract.*``. It inserts the
repo root onto sys.path and loads the .env file once.
"""
from __future__ import annotations

import sys
from pathlib import Path

# agents/_paths.py -> agents/ -> repo root
REPO_ROOT = Path(__file__).resolve().parent.parent


def ensure_repo_root() -> Path:
    """Insert the repo root onto sys.path (idempotent) and return it."""
    root = str(REPO_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    return REPO_ROOT


def load_env() -> None:
    """Load the repo .env once. Safe to call repeatedly."""
    try:
        from dotenv import load_dotenv
    except Exception:
        return
    load_dotenv(REPO_ROOT / ".env")


ensure_repo_root()
