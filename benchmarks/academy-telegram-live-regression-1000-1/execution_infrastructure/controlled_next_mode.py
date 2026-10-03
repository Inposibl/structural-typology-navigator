"""Controlled Navigator server mode.

Future benchmark execution must be `next build` followed by `next start`.
`next dev` fails closed. This module records and checks that evidence. It
does not launch a server.
"""

from __future__ import annotations

from typing import Any

from .constants import CONTROLLED_NEXT_MODE

STOP_CLASS = "CONTROLLED_NEXT_MODE_FAILURE"


def _is_next(argv: list[str]) -> bool:
    for token in argv:
        name = token.rsplit("/", 1)[-1]
        if name in {"next", "next-server"} or name.startswith("next"):
            return True
    return False


def _phase(argv: list[str]) -> str | None:
    if not _is_next(argv):
        return None
    for token in argv:
        if token in {"dev", "build", "start"}:
            return token
    return None


def evaluate_commands(commands: list[list[str]]) -> dict[str, Any]:
    saw_build = False
    saw_start = False
    for argv in commands:
        phase = _phase(argv)
        if phase == "dev":
            return {
                "ok": False,
                "mode": "NEXT_DEV",
                "next_dev_for_controlled_run": True,
                "stop_class": STOP_CLASS,
                "reason": "next dev is not the controlled execution mode",
            }
        if phase == "build":
            saw_build = True
        elif phase == "start":
            saw_start = True
    if saw_build and saw_start:
        return {
            "ok": True,
            "mode": CONTROLLED_NEXT_MODE,
            "next_dev_for_controlled_run": False,
            "stop_class": None,
            "reason": "next build followed by next start",
        }
    return {
        "ok": False,
        "mode": "NOT_NEXT_BUILD_PLUS_NEXT_START",
        "next_dev_for_controlled_run": False,
        "stop_class": STOP_CLASS,
        "reason": "controlled execution requires next build and next start",
    }
