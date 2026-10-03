"""Subprocess probe. Prints one JSON object. Does not print file contents."""

from __future__ import annotations

import json
import os
import sys

from execution_infrastructure.pd_f06_isolation import (
    credential_candidates,
    install_import_guard,
    install_network_guard,
)


def main() -> int:
    install_import_guard()
    install_network_guard()
    operator = os.environ["ACADEMY_OPERATOR_SENTINEL_DIR"]
    denied_operator = False
    try:
        open(os.path.join(operator, ".env"), "r", encoding="utf-8")
    except PermissionError:
        denied_operator = True
    parent_denied = False
    cursor = os.getcwd()
    for _ in range(6):
        parent = os.path.dirname(cursor)
        if parent == cursor:
            break
        candidate = os.path.join(parent, ".env")
        if os.path.lexists(candidate):
            try:
                open(candidate, "r", encoding="utf-8")
            except PermissionError:
                parent_denied = True
            break
        cursor = parent
    google_denied = False
    try:
        import socket
        socket.create_connection(("sheets.googleapis.com", 443), timeout=0.2)
    except PermissionError:
        google_denied = True
    visible = []
    spec = {
        "cwd": os.getcwd(),
        "home": os.environ.get("HOME", ""),
    }
    for path in credential_candidates({"cwd": spec["cwd"], "home": spec["home"]}):
        if path.exists():
            visible.append(path.name)
    sys.stdout.write(json.dumps({
        "denied_operator_env": denied_operator,
        "parent_env_denied": parent_denied,
        "google_denied": google_denied,
        "visible_credential_names": visible,
        "home_is_operator": os.path.realpath(os.environ.get("HOME", "")) == os.path.realpath(operator),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
