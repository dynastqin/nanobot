"""Shared loguru format and patcher for the nanobot CLI.

Imported by ``commands.py`` (module-level setup) and ``gateway.py``
(verbose-mode handler).  Keep this module free of heavy imports so it
can be loaded early without circular-import issues.
"""

from __future__ import annotations

LOG_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: <5}</level> | "
    "<cyan>{extra[channel]}</cyan> | "
    "<yellow>[{extra[filepath]}:{line}]</yellow> | "
    "<level>{message}</level>\n"
)


def log_patcher(record) -> None:
    """Populate ``extra`` fields expected by :data:`LOG_FORMAT`."""
    module_path = record["name"]
    if module_path == "__main__":
        record["extra"]["filepath"] = record["file"]
    else:
        record["extra"]["filepath"] = module_path.replace(".", "/") + ".py"
    record["extra"].setdefault("channel", "-")
