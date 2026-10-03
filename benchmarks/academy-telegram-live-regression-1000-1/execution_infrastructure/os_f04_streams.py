"""OS-F04 process-lifetime stdout, stderr, and logging-handler contract.

stdout and stderr are not replaced and are not closed per scenario. Owned
handlers are flushed, removed, and closed only after owned background work
has reached a terminal state. A logging-error marker stops the apparatus.
"""

from __future__ import annotations

import io
import logging
import os
import sys
import threading
import time
from typing import Any

from .constants import LOGGING_STOP_CLASS
from .pd_f06_lifecycle import AttemptBoundary

MARKERS = (
    "--- Logging error ---",
    "ValueError: I/O operation on closed file",
)

_STDERR_CHUNKS: list[str] = []
_STDERR_TEE_INSTALLED = False
_FD2_BUFFER = bytearray()
_FD2_LOCK = threading.Lock()
_FD2_INSTALLED = False
_FD2_SEQ = 0


def fd2_cursor() -> int:
    with _FD2_LOCK:
        return len(_FD2_BUFFER)


def fd2_text_since(cursor: int) -> str:
    with _FD2_LOCK:
        blob = bytes(_FD2_BUFFER[max(0, cursor):])
    return blob.decode("utf-8", "replace")


def drain_fd2(timeout: float = 1.0) -> bool:
    """Wait until bytes already written to fd 2 have been copied into the buffer.

    A unique token is written after the caller's bytes. The pipe is ordered,
    so the token appearing means the earlier bytes were copied too.
    """
    global _FD2_SEQ
    if not _FD2_INSTALLED:
        return False
    _FD2_SEQ += 1
    token = f"__ACADEMY_FD2_DRAIN_{os.getpid()}_{_FD2_SEQ}__".encode("ascii")
    try:
        os.write(2, token)
    except OSError:
        return False
    needle = token.decode("ascii")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if needle in fd2_text_since(0):
            return True
        time.sleep(0.005)
    return False


def install_fd2_capture() -> None:
    """Copy fd 2 into a process-lifetime buffer without replacing sys.stderr.

    A direct os.write(2, ...) is visible. The Python stream object stays the
    same object and stays open. Installed once.
    """
    global _FD2_INSTALLED
    if _FD2_INSTALLED:
        return
    saved = os.dup(2)
    read_fd, write_fd = os.pipe()
    os.dup2(write_fd, 2)
    os.close(write_fd)

    def reader() -> None:
        while True:
            try:
                chunk = os.read(read_fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            with _FD2_LOCK:
                _FD2_BUFFER.extend(chunk)
            try:
                os.write(saved, chunk)
            except OSError:
                pass

    threading.Thread(target=reader, name="academy-fd2-tee", daemon=True).start()
    _FD2_INSTALLED = True


def install_process_stderr_tee() -> None:
    """Capture stderr writes without replacing the process stream object.

    Installed once for the controlled process. Later scenario installs do not
    replace it. The original stream object stays in place and stays open.
    """
    global _STDERR_TEE_INSTALLED
    install_fd2_capture()
    if _STDERR_TEE_INSTALLED:
        return
    original_write = sys.stderr.write
    original_writelines = sys.stderr.writelines

    def tee_write(data: str) -> int:
        _STDERR_CHUNKS.append(str(data))
        return original_write(data)

    def tee_writelines(lines: Any) -> None:
        for line in lines:
            _STDERR_CHUNKS.append(str(line))
        return original_writelines(lines)

    sys.stderr.write = tee_write  # type: ignore[method-assign]
    sys.stderr.writelines = tee_writelines  # type: ignore[method-assign]
    _STDERR_TEE_INSTALLED = True


def stderr_chunk_count() -> int:
    return len(_STDERR_CHUNKS)


def stderr_text_since(cursor: int) -> str:
    return "".join(_STDERR_CHUNKS[cursor:])


class _MemoryHandler(logging.Handler):
    def __init__(self, bucket: list[str], events: list[str]) -> None:
        super().__init__(level=logging.INFO)
        self.bucket = bucket
        self.events = events
        self.stream = io.StringIO()
        self.setFormatter(logging.Formatter("%(name)s %(levelname)s %(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        if self.stream.closed:
            raise ValueError("I/O operation on closed file")
        line = self.format(record)
        self.stream.write(line + "\n")
        self.bucket.append(line)

    def close(self) -> None:
        if not self.stream.closed:
            self.stream.flush()
            self.stream.close()
        super().close()


class ProcessLifetimeStreams:
    def __init__(self) -> None:
        self.stdout_identity = id(sys.stdout)
        self.stderr_identity = id(sys.stderr)
        self.bucket: list[str] = []
        self.events: list[str] = []
        self.owned: list[tuple[logging.Logger, logging.Handler]] = []
        self.installed = False
        self.execution_status = "READY"
        self.continue_to_next_scenario = True
        self.stop_record: dict[str, Any] | None = None
        self._previous_root_level: int | None = None
        self._stderr_cursor = 0
        self._fd2_cursor = 0

    def install(self) -> None:
        install_process_stderr_tee()
        self._stderr_cursor = stderr_chunk_count()
        self._fd2_cursor = fd2_cursor()
        if self.installed:
            return
        root = logging.getLogger()
        self._previous_root_level = root.level
        if root.level > logging.INFO:
            root.setLevel(logging.INFO)
        handler = _MemoryHandler(self.bucket, self.events)
        root.addHandler(handler)
        self.owned.append((root, handler))
        self.installed = True
        self.events.append("capture-installed")

    def enumerate_handlers(self) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = []
        owned_ids = {id(handler) for _logger, handler in self.owned}
        root = logging.getLogger()
        for handler in root.handlers:
            found.append({
                "logger": "root",
                "handler_class": type(handler).__name__,
                "owned": id(handler) in owned_ids,
            })
        if logging.lastResort is not None:
            found.append({
                "logger": "lastResort",
                "handler_class": type(logging.lastResort).__name__,
                "owned": False,
            })
        for name, candidate in logging.Logger.manager.loggerDict.items():
            if not isinstance(candidate, logging.Logger):
                continue
            for handler in candidate.handlers:
                found.append({
                    "logger": name,
                    "handler_class": type(handler).__name__,
                    "owned": id(handler) in owned_ids,
                })
        return found

    def captured_text(self) -> str:
        parts = list(self.bucket)
        for _logger, handler in self.owned:
            stream = getattr(handler, "stream", None)
            if isinstance(stream, io.StringIO) and not stream.closed:
                parts.append(stream.getvalue())
        return "\n".join(parts)

    def captured_stderr(self) -> str:
        return stderr_text_since(self._stderr_cursor)

    def scan_markers(self) -> list[str]:
        drain_fd2()
        text = "\n".join((
            self.captured_text(),
            self.captured_stderr(),
            fd2_text_since(self._fd2_cursor),
        ))
        return [marker for marker in MARKERS if marker in text]

    def streams_intact(self) -> bool:
        return (
            id(sys.stdout) == self.stdout_identity
            and id(sys.stderr) == self.stderr_identity
            and not getattr(sys.stdout, "closed", False)
            and not getattr(sys.stderr, "closed", False)
        )

    def note_background_terminated(self) -> None:
        self.events.append("tasks-terminated")

    def inject_synthetic_marker(self, marker: str) -> None:
        self.bucket.append(marker)

    def shutdown(self, *, scenario_ordinal: int | None = None) -> dict[str, Any]:
        """Flush and remove owned handlers only. Do not close process streams."""
        self.events.append("handlers-flushed")
        for _logger, handler in self.owned:
            handler.flush()
        self.events.append("handlers-removed")
        for logger, handler in self.owned:
            logger.removeHandler(handler)
        self.events.append("handlers-closed")
        for _logger, handler in self.owned:
            handler.close()
        self.owned.clear()
        self.events.append("final-flush")
        self.events.append("scan")
        markers = self.scan_markers()
        if markers:
            self.execution_status = LOGGING_STOP_CLASS
            self.continue_to_next_scenario = False
            self.stop_record = {
                "execution_status": LOGGING_STOP_CLASS,
                "scenario_ordinal": scenario_ordinal,
                "markers": markers,
                "retry": False,
            }
        else:
            self.execution_status = "STREAMS_CLOSED_CLEAN"
        if self._previous_root_level is not None:
            logging.getLogger().setLevel(self._previous_root_level)
        self.installed = False
        return {
            "execution_status": self.execution_status,
            "continue_to_next_scenario": self.continue_to_next_scenario,
            "markers": markers,
            "streams_intact": self.streams_intact(),
            "events": list(self.events),
            "stop_record": self.stop_record,
            "last_resort_closed": bool(getattr(logging.lastResort, "stream", None) and getattr(getattr(logging.lastResort, "stream", None), "closed", False)),
        }


def os_f04_report_since(*, stderr_cursor: int, fd2_at: int) -> dict[str, Any]:
    """Markers written since the cursors, including a direct write to fd 2."""
    drain_fd2()
    text = stderr_text_since(stderr_cursor) + "\n" + fd2_text_since(fd2_at)
    markers = [marker for marker in MARKERS if marker in text]
    if markers:
        return {
            "execution_status": LOGGING_STOP_CLASS,
            "continue_to_next_scenario": False,
            "markers": markers,
            "fd2_captured": True,
        }
    return {
        "execution_status": "STREAMS_CLOSED_CLEAN",
        "continue_to_next_scenario": True,
        "markers": [],
        "fd2_captured": True,
    }


def run_attempt_with_streams(scenario, *, join_timeout: float = 2.0, scenario_ordinal: int = 1) -> dict[str, Any]:
    """One attempt inside the process-lifetime capture. Does not swap stdio."""
    streams = ProcessLifetimeStreams()
    streams.install()
    boundary = AttemptBoundary()
    boundary.begin()
    scenario_error = None
    try:
        scenario()
    except Exception as exc:  # noqa: BLE001 — preserved as apparatus evidence
        scenario_error = type(exc).__name__
    thread_report = boundary.finish(join_timeout=join_timeout)
    streams.note_background_terminated()
    shutdown = streams.shutdown(scenario_ordinal=scenario_ordinal)
    if thread_report["fail_closed"]:
        shutdown["continue_to_next_scenario"] = False
        streams.continue_to_next_scenario = False
        if shutdown["execution_status"] != LOGGING_STOP_CLASS:
            shutdown["execution_status"] = thread_report["status"]
            shutdown["stop_record"] = {
                "execution_status": thread_report["status"],
                "scenario_ordinal": scenario_ordinal,
                "markers": shutdown.get("markers") or [],
                "unterminated_threads": thread_report.get("still_alive_threads") or [],
                "retry": False,
            }
    return {
        "thread_report": thread_report,
        "shutdown": shutdown,
        "scenario_error": scenario_error,
        "captured_text": streams.captured_text(),
        "streams": streams,
    }
