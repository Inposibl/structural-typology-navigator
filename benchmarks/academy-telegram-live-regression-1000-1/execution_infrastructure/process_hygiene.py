"""Suite and probe process hygiene.

install_suite_hygiene() gives one invocation:

- a private temporary root (TMPDIR and tempfile.tempdir), so state, ledger,
  control, and evidence files from parallel invocations never share a path;
- its own process group, so a child that loses its parent still carries a
  group id this invocation owns;
- a record of every subprocess.Popen it starts, including the session and
  group of children started with start_new_session;
- an exit reaper that terminates every surviving tracked child, every
  process in a tracked group, and every process left in the invocation
  group, then verifies that none is alive.

The report is written to ACADEMY_SUITE_HYGIENE_REPORT when that variable
names a file.
"""

from __future__ import annotations

import atexit
import json
import os
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

_STATE: dict[str, Any] = {}
_LOCK = threading.Lock()


def _ps_rows() -> list[tuple[int, int, int]]:
    try:
        out = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,pgid="],
            capture_output=True, text=True, check=False, timeout=10,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    rows = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 3 and all(item.lstrip("-").isdigit() for item in parts):
            rows.append((int(parts[0]), int(parts[1]), int(parts[2])))
    return rows


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        waited, _status = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return False
    except ChildProcessError:
        pass
    except OSError:
        pass
    return True


def _descendants(rows: list[tuple[int, int, int]], roots: set[int]) -> set[int]:
    found: set[int] = set()
    frontier = set(roots)
    while frontier:
        nxt = {pid for pid, ppid, _ in rows if ppid in frontier and pid not in found}
        found |= nxt
        frontier = nxt
    return found


def owned_processes() -> list[int]:
    """Live processes this invocation owns, excluding itself."""
    me = os.getpid()
    rows = _ps_rows()
    groups = set(_STATE.get("tracked_groups") or set())
    # The invocation group is swept only when this process leads it. A
    # group inherited from a shell also holds the shell and its siblings.
    if _STATE.get("own_group") and os.getpgrp() == me:
        groups.add(int(_STATE["own_group"]))
    try:
        groups.discard(os.getpgid(os.getppid()))
    except OSError:
        pass
    tracked = {pid for pid in (_STATE.get("tracked_pids") or set()) if _alive(pid)}
    owned = {pid for pid, _ppid, pgid in rows if pgid in groups}
    owned |= tracked
    owned |= _descendants(rows, {me} | tracked)
    owned.discard(me)
    owned.discard(os.getppid())
    return sorted(pid for pid in owned if _alive(pid))


def _terminate(pids: list[int]) -> list[int]:
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and any(_alive(pid) for pid in pids):
        time.sleep(0.05)
    for pid in pids:
        if _alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline and any(_alive(pid) for pid in pids):
        time.sleep(0.05)
    return [pid for pid in pids if _alive(pid)]


def reap(reason: str = "exit") -> dict[str, Any]:
    survivors_before = owned_processes()
    remaining = _terminate(survivors_before) if survivors_before else []
    after = owned_processes()
    report = {
        "suite": _STATE.get("name"),
        "reason": reason,
        "pid": os.getpid(),
        "own_group": _STATE.get("own_group"),
        "own_group_created": _STATE.get("own_group_created"),
        "temp_root": _STATE.get("temp_root"),
        "tracked_child_count": len(_STATE.get("tracked_pids") or ()),
        "tracked_group_count": len(_STATE.get("tracked_groups") or ()),
        "survivors_at_exit": survivors_before,
        "unkillable": remaining,
        "alive_after_reap": after,
        "no_child_process_left": not after,
    }
    _STATE["last_report"] = report
    target = os.environ.get("ACADEMY_SUITE_HYGIENE_REPORT")
    if target and reason == "exit":
        path = Path(target)
        staging = path.with_name(path.name + f".{os.getpid()}.tmp")
        staging.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.replace(staging, path)
    return report


def _track_popen() -> None:
    original = subprocess.Popen.__init__
    if getattr(original, "_academy_tracked", False):
        return

    def tracked(self: subprocess.Popen, *args: Any, **kwargs: Any) -> None:
        original(self, *args, **kwargs)
        pid = getattr(self, "pid", None)
        if not pid:
            return
        with _LOCK:
            _STATE.setdefault("tracked_pids", set()).add(int(pid))
            try:
                group = os.getpgid(int(pid))
            except OSError:
                group = None
            if group and group != _STATE.get("own_group") and group != os.getpgrp():
                _STATE.setdefault("tracked_groups", set()).add(int(group))
            elif kwargs.get("start_new_session") or kwargs.get("preexec_fn") is not None:
                # The child may not have called setsid yet. Its pid is its
                # future group id.
                _STATE.setdefault("tracked_groups", set()).add(int(pid))

    tracked._academy_tracked = True  # type: ignore[attr-defined]
    subprocess.Popen.__init__ = tracked  # type: ignore[method-assign]


def install_suite_hygiene(name: str) -> dict[str, Any]:
    """Idempotent. Call before the suite starts any child or temp file."""
    if _STATE.get("installed"):
        return dict(_STATE)
    temp_root = tempfile.mkdtemp(prefix=f"academy-{name}-")
    os.environ["TMPDIR"] = temp_root
    tempfile.tempdir = temp_root
    created = False
    try:
        if os.getpgrp() != os.getpid():
            os.setpgid(0, 0)
            created = True
    except OSError:
        created = False
    _STATE.update({
        "installed": True,
        "name": name,
        "temp_root": temp_root,
        "own_group": os.getpgrp(),
        "own_group_created": created,
        "tracked_pids": set(),
        "tracked_groups": set(),
    })
    _track_popen()
    atexit.register(reap, "exit")
    return {"name": name, "temp_root": temp_root, "own_group": os.getpgrp(), "own_group_created": created}


def hygiene_state() -> dict[str, Any]:
    return {
        "name": _STATE.get("name"),
        "temp_root": _STATE.get("temp_root"),
        "own_group": _STATE.get("own_group"),
        "tracked_child_count": len(_STATE.get("tracked_pids") or ()),
        "last_report": _STATE.get("last_report"),
    }
