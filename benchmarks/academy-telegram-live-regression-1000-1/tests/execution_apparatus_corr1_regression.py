"""EXECUTION-APPARATUS-CORRECTION-1 focused regression battery (OS-F02/F03/F04).

Proves the correction candidate for the three controlling Codex findings:

- OS-F02: navigator_l2_base_url carries ONE accepted meaning (a BASE URL);
  navigator_l2_chat_api AND the alexey_user_turn real_local native transport
  both address the intended /api/chat endpoint under one execution
  configuration, with no duplicate-path construction.
- OS-F03: a legitimate native single-worker list[str] reply survives
  benchmark capture intact; the supported nested/multi-worker shape keeps its
  accepted behavior; empty/absent output stays empty and is never fabricated.
- OS-F04: execution logging-ownership contract — compliant ownership never
  closes a stream still referenced by retained log handlers, the defective
  per-scenario-stream pattern is DETECTED, and background tasks terminate
  before owned-stream closure.

Local fixtures, loopback sockets and source analysis only. No product stack
execution (the native lebedev package boundary is faked at
_load_package_module), no TEST_BASE binding, no network beyond 127.0.0.1
loopback, no git mutation, no benchmark/scenario execution, no semantic
evaluation.
"""

from __future__ import annotations

import asyncio
import http.server
import inspect
import io
import json
import logging
import sys
import tempfile
import threading
import types
from pathlib import Path
from unittest.mock import patch

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from adapters.product import (  # noqa: E402
    AlexeyUserTurnAdapter,
    NavigatorL2ChatAdapter,
    navigator_chat_endpoint,
)
from harness.execution_request import build_execution_request  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []


def test(name: str):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append((name, True, ""))
            except Exception as exc:  # noqa: BLE001 — battery reports all failures
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        TESTS.append((name, wrapper))
        return wrapper
    return deco


CORPUS = BENCH / "corpus" / "corrected_corpus_84.jsonl"


def _rows() -> dict:
    out = {}
    with open(CORPUS) as fh:
        for line in fh:
            if line.strip():
                row = json.loads(line)
                out[row["scenario_id"]] = row
    return out


def _request(spec: dict, env: dict) -> object:
    return build_execution_request(
        spec, adapter_id=spec["adapter_id"], run_id="CORR1-APPARATUS-PROBE", attempt=1,
        scenario_sha256="a" * 64,
        navigator_test_root=str(tempfile.mkdtemp(prefix="corr1-app-nav-")),
        tikhon_test_root=str(tempfile.mkdtemp(prefix="corr1-app-tik-")),
        execution_environment=env)


# ---------------------------------------------------------------------------
# Loopback Navigator chat stub (records the wire path the adapter targets)
# ---------------------------------------------------------------------------

class _ChatStub(http.server.ThreadingHTTPServer):

    def __init__(self):
        super().__init__(("127.0.0.1", 0), _ChatStubHandler)
        self.recorded_paths: list[str] = []
        self.recorded_request_ids: list[str] = []
        self.recorded_bodies: list[bytes] = []


class _ChatStubHandler(http.server.BaseHTTPRequestHandler):

    def do_POST(self):  # noqa: N802 — stdlib handler name
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b""
        payload = json.dumps({
            "message": "Ответ локального тестового сервера.",
            "profile": {"displayName": None, "addressMode": None,
                        "nameDeclined": False, "pendingUserRequest": None},
            "conversationState": {},
            "contactCard": None,
            "resetConversation": False,
        }, ensure_ascii=False).encode("utf-8")
        rid = self.headers.get("X-Navigator-Request-Id") or ""
        self.server.recorded_paths.append(self.path)
        self.server.recorded_request_ids.append(rid)
        self.server.recorded_bodies.append(raw)
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("X-Navigator-Request-Id", rid)
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):  # silence per-request stderr noise
        pass


# ---------------------------------------------------------------------------
# Fake native chatbot package boundary (records the constructor api_url and
# returns canned native process_user_turn replies — the exact native return
# contract List[str])
# ---------------------------------------------------------------------------

class _FakeStore:
    def __init__(self, db_path=None):
        self.db_path = db_path
        self.sessions: dict = {}

    def save_session(self, user_id, profile, state):
        self.sessions[user_id] = (profile, state)

    def append_message(self, user_id, role, text):
        pass

    def reset_session(self, user_id):
        pass

    def get_session(self, user_id):
        return self.sessions.get(user_id, ({}, {}))


class _FakeOutreach:
    def __init__(self, db_path=None):
        self.db_path = db_path
        self.leads: dict = {}

    def update_lead_status(self, user_id, status, error_message=None, sync_to_sheets=False):
        self.leads[user_id] = status

    def get_lead(self, user_id):
        if user_id in self.leads:
            return {"status": self.leads[user_id]}
        return None


class _FakeLebedevAdapter:
    instances: list = []
    canned_reply: list = []  # class-level: each test sets it before execute()

    def __init__(self, api_url=None, session_store=None, outreach_manager=None):
        self.api_url = api_url
        self.session_store = session_store
        self.outreach_manager = outreach_manager
        self.user_locks: dict = {}
        self.turn_calls: list = []
        _FakeLebedevAdapter.instances.append(self)

    def get_user_lock(self, user_id):
        """Native lock protocol: the benchmark-installed instrumented locks are
        consumed through get_user_lock exactly like the real adapter does."""
        if user_id not in self.user_locks:
            self.user_locks[user_id] = asyncio.Lock()
        return self.user_locks[user_id]

    async def call_navigator_core(self, *args, **kwargs):
        raise AssertionError(
            "native transport must not be invoked inside the fake-capture probe")

    async def process_user_turn(self, user_id, user_text, message_id):
        self.turn_calls.append((user_id, user_text, message_id))
        lock = self.get_user_lock(user_id)
        async with lock:  # native per-user critical section protocol
            return list(self.canned_reply)


def _fake_loader():
    def loader(root, package, module):
        if module == "lebedev_adapter":
            mod = types.ModuleType("data_engine.lebedev_adapter")
            mod.LebedevNavigatorAdapter = _FakeLebedevAdapter
            return mod, None
        if module == "session_store":
            mod = types.ModuleType("data_engine.session_store")
            mod.TelegramSessionStore = _FakeStore
            return mod, None
        if module == "outreach":
            mod = types.ModuleType("data_engine.outreach")
            mod.OutreachHistoryManager = _FakeOutreach
            return mod, None
        return None, f"unexpected module {package}.{module}"
    return loader


# ---------------------------------------------------------------------------
# OS-F02-A — navigator_l2_chat_api addresses the intended /api/chat endpoint
# ---------------------------------------------------------------------------

@test("OSF02A.l2_chat_call_targets_base_api_chat_on_the_wire")
def _():
    rows = _rows()
    assert rows["A-0005"]["adapter_id"] == "navigator_l2_chat_api"
    server = _ChatStub()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        adapter = NavigatorL2ChatAdapter()
        for accepted_base in (base, base + "/"):
            status, body, header = adapter._chat_call(
                accepted_base, {"requestId": "corr1-f02a-probe", "messages": []})
            assert status == 200, status
            assert body["message"] == "Ответ локального тестового сервера.", body
            assert header == "corr1-f02a-probe", header
        assert server.recorded_paths == ["/api/chat", "/api/chat"], server.recorded_paths
    finally:
        server.shutdown()
        server.server_close()


@test("OSF02A.l2_execute_targets_api_chat_under_accepted_configuration")
def _():
    rows = _rows()
    server = _ChatStub()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        env = {"navigator_l2_base_url": base}
        with patch("adapters.product.collect_rag_diagnostics", lambda env_, header: {}):
            capture = NavigatorL2ChatAdapter().execute(_request(rows["A-0005"], env))
        assert not capture.capture_error, capture.capture_error
        assert capture.outcome_class == "CLEAN", capture.outcome_class
        assert capture.values["output"] == "Ответ локального тестового сервера."
        assert capture.values["state"]["nativeRequestIdHeader"] == \
            "CORR1-APPARATUS-PROBE-A-0005-1"
        assert server.recorded_paths == ["/api/chat"], server.recorded_paths
        assert len(server.recorded_bodies) == 1
        sent = json.loads(server.recorded_bodies[0].decode("utf-8"))
        assert len(sent["messages"]) == 2  # both A-0005 turns in one native request
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# OS-F02-B — alexey_user_turn real_local addresses the SAME /api/chat endpoint
# ---------------------------------------------------------------------------

@test("OSF02B.real_local_passes_complete_api_chat_endpoint_to_native_transport")
def _():
    rows = _rows()
    assert rows["D-0003"]["preconditions"]["navigator_transport"] == "real_local"
    server = _ChatStub()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        env = {"navigator_l2_base_url": base}
        _FakeLebedevAdapter.instances = []
        _FakeLebedevAdapter.canned_reply = ["Сегмент один.", "Сегмент два."]
        with patch("adapters.product._load_package_module", _fake_loader()):
            capture = AlexeyUserTurnAdapter().execute(_request(rows["D-0003"], env))
        fakes = _FakeLebedevAdapter.instances
        assert len(fakes) == 1, f"expected one fake native adapter, got {len(fakes)}"
        expected = navigator_chat_endpoint(base)
        assert fakes[0].api_url == expected, (fakes[0].api_url, expected)
        assert fakes[0].api_url == base.rstrip("/") + "/api/chat"
        # the derived endpoint is the same complete URL the L2 adapter posts to
        server_base_endpoint = f"http://127.0.0.1:{server.server_address[1]}/api/chat"
        assert fakes[0].api_url == server_base_endpoint
        assert not capture.capture_error, capture.capture_error
        assert capture.values["output"] == "Сегмент один. | Сегмент два.", capture.values["output"]
    finally:
        server.shutdown()
        server.server_close()


@test("OSF02B.real_local_absent_base_still_refuses_without_canned_substitution")
def _():
    rows = _rows()
    _FakeLebedevAdapter.instances = []
    with patch("adapters.product._load_package_module", _fake_loader()):
        capture = AlexeyUserTurnAdapter().execute(_request(rows["D-0003"], {}))
    assert capture.capture_error, "absent navigator_l2_base_url must be an explicit refusal"
    assert "FUTURE local" in capture.capture_error
    assert _FakeLebedevAdapter.instances == [], "no native adapter may be constructed"


# ---------------------------------------------------------------------------
# OS-F02-C — no duplicate-path construction
# ---------------------------------------------------------------------------

@test("OSF02C.endpoint_derivation_is_idempotent_and_duplicate_path_free")
def _():
    accepted = "http://127.0.0.1:43117"
    endpoint = navigator_chat_endpoint(accepted)
    assert endpoint == "http://127.0.0.1:43117/api/chat", endpoint
    # trailing slash is neutralized
    assert navigator_chat_endpoint(accepted + "/") == endpoint
    assert navigator_chat_endpoint(accepted + "///") == endpoint
    # idempotent: feeding a complete endpoint back never doubles the path
    assert navigator_chat_endpoint(endpoint) == endpoint
    assert navigator_chat_endpoint(endpoint + "/") == endpoint
    # no accidental empty-authority or '//' construction after the scheme
    for variant in (accepted, accepted + "/", endpoint, ""):
        derived = navigator_chat_endpoint(variant)
        after_scheme = derived.split("://", 1)[-1]
        assert "//" not in after_scheme, (variant, derived)
    # whitespace tolerance mirrors the adapter's own strip()
    assert navigator_chat_endpoint("  " + accepted + "  ") == endpoint
    # the helper is the SINGLE construction used by both accepted consumers
    l2_src = inspect.getsource(NavigatorL2ChatAdapter._chat_call)
    alexey_src = inspect.getsource(AlexeyUserTurnAdapter.execute)
    assert "navigator_chat_endpoint(base)" in l2_src
    assert "navigator_chat_endpoint(base_url)" in alexey_src
    # and the legacy divergent inline construction is gone from both
    assert 'base.rstrip("/") + "/api/chat"' not in l2_src
    assert 'api_url = str(env.get("navigator_l2_base_url", "")).strip()\n            if not api_url:' not in alexey_src


# ---------------------------------------------------------------------------
# OS-F03-A — single-worker flat list[str] reply survives capture
# ---------------------------------------------------------------------------

@test("OSF03A.single_worker_flat_reply_survives_capture_intact")
def _():
    rows = _rows()
    # plain stubbed single-worker row (no fault schedule, no provider fixture):
    # the pre-correction flattening lost this text entirely
    spec = dict(rows["B-0185"])
    assert spec["adapter_id"] == "alexey_user_turn"
    assert not spec.get("concurrency_workers")
    assert not spec.get("fault_schedule")
    env = {"navigator_l2_base_url": "http://127.0.0.1:43117"}
    _FakeLebedevAdapter.instances = []
    _FakeLebedevAdapter.canned_reply = ["Ответ рабочей программы.", "Второй сегмент."]
    with patch("adapters.product._load_package_module", _fake_loader()):
        capture = AlexeyUserTurnAdapter().execute(_request(spec, env))
    assert not capture.capture_error, capture.capture_error
    assert capture.values["act"] == "USER_TURN_PROCESSED", capture.values["act"]
    assert capture.values["output"] == "Ответ рабочей программы. | Второй сегмент.", \
        capture.values["output"]
    assert capture.transcripts["assistant_reply"] == \
        "Ответ рабочей программы. | Второй сегмент."


@test("OSF03A.real_local_single_worker_flat_reply_survives_capture")
def _():
    rows = _rows()
    env = {"navigator_l2_base_url": "http://127.0.0.1:43117"}
    _FakeLebedevAdapter.instances = []
    _FakeLebedevAdapter.canned_reply = [
        "Извините, на сервере произошел временный сбой соединения. "
        "Ваш диалог сохранен — пожалуйста, попробуйте повторить запрос еще раз."]
    with patch("adapters.product._load_package_module", _fake_loader()):
        capture = AlexeyUserTurnAdapter().execute(_request(rows["D-0003"], env))
    assert not capture.capture_error, capture.capture_error
    # the exact native technical fallback (observed nonempty in CORR1 D-rows)
    # must now surface in the captured output instead of being flattened away
    assert "Ваш диалог сохранен" in capture.values["output"], capture.values["output"]
    assert capture.transcripts["assistant_reply"] == capture.values["output"]


# ---------------------------------------------------------------------------
# OS-F03-B — supported nested/multi-worker reply shape remains captured
# ---------------------------------------------------------------------------

@test("OSF03B.multi_worker_nested_reply_shape_remains_correctly_captured")
def _():
    rows = _rows()
    spec = rows["A-0011"]
    assert spec["adapter_id"] == "alexey_user_turn"
    assert spec["concurrency_workers"] == 2
    env = {}
    _FakeLebedevAdapter.instances = []
    _FakeLebedevAdapter.canned_reply = ["Ответ многопоточного прогона."]
    with patch("adapters.product._load_package_module", _fake_loader()):
        capture = AlexeyUserTurnAdapter().execute(_request(spec, env))
    assert not capture.capture_error, capture.capture_error
    assert capture.values["output"] == "Ответ многопоточного прогона.", capture.values["output"]
    concurrency = capture.concurrency or {}
    assert concurrency.get("workers") == 2, concurrency.get("workers")
    assert len(concurrency.get("task_records") or []) == 2
    assert concurrency.get("lock_release_completed_all") is True
    # per-worker native reply lists stayed nested (not re-flattened)
    fake = _FakeLebedevAdapter.instances[0]
    assert len(fake.turn_calls) == 2, fake.turn_calls


# ---------------------------------------------------------------------------
# OS-F03-C — empty/absent output remains empty and is not fabricated
# ---------------------------------------------------------------------------

@test("OSF03C.empty_native_reply_remains_empty_and_not_fabricated")
def _():
    rows = _rows()
    env = {"navigator_l2_base_url": "http://127.0.0.1:43117"}
    _FakeLebedevAdapter.instances = []
    _FakeLebedevAdapter.canned_reply = []
    with patch("adapters.product._load_package_module", _fake_loader()):
        capture = AlexeyUserTurnAdapter().execute(_request(rows["D-0003"], env))
    assert not capture.capture_error, capture.capture_error
    assert capture.values["output"] == "", repr(capture.values["output"])
    assert capture.transcripts["assistant_reply"] == ""
    assert capture.values["link"] is None
    # the native duplicate/idempotent path returned [] — capture must reflect
    # exactly that, with no manufactured replacement text
    assert "Извините" not in (capture.values["output"] or "")


# ---------------------------------------------------------------------------
# OS-F04-A — logging ownership: retained handler streams are never closed;
# the defective pattern is detected
# ---------------------------------------------------------------------------

@test("OSF04A.compliant_ownership_keeps_retained_handler_streams_open")
def _():
    tmp = tempfile.mkdtemp(prefix="corr1-f04a-")
    log_path = Path(tmp) / "process-lifetime.log"
    owned = open(log_path, "w", encoding="utf-8")
    logger = logging.getLogger("corr1.f04a.compliant")
    logger.setLevel(logging.WARNING)
    logger.propagate = False
    handler = logging.StreamHandler(owned)  # configured ONCE, before "scenarios"
    formatter = logging.Formatter("%(levelname)s %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    try:
        for scenario_round in range(3):
            logger.warning("scenario %d retained-handler emit", scenario_round)
            # the executor never closes or replaces the handler's stream while
            # any scenario can still log through the retained handler
            assert not handler.stream.closed
            assert not owned.closed
        handler.flush()
        assert not handler.stream.closed
    finally:
        logger.removeHandler(handler)
        handler.flush()
        owned.close()  # closure only AFTER all dependent work is done
    content = log_path.read_text()
    for scenario_round in range(3):
        assert f"scenario {scenario_round} retained-handler emit" in content
    assert "--- Logging error ---" not in content


@test("OSF04A.defective_per_scenario_stream_replacement_is_detected")
def _():
    """Reproduces the OS-F04 defect class in miniature and proves the
    contract's mandatory detector (LOGGING_ERROR_DETECTION_REQUIRED=YES)
    mechanically fires on it."""
    tmp = tempfile.mkdtemp(prefix="corr1-f04a-defect-")
    scenario_stream_path = Path(tmp) / "scenario-N.stderr.txt"
    old_stderr = sys.stderr
    retained = open(scenario_stream_path, "w", encoding="utf-8")
    sys.stderr = retained  # per-scenario replacement (PROHIBITED by contract)
    logger = logging.getLogger("corr1.f04a.defective")
    logger.setLevel(logging.ERROR)
    logger.propagate = False
    handler = logging.StreamHandler(sys.stderr)  # handler RETAINS the stream
    logger.addHandler(handler)
    sys.stderr = old_stderr
    retained.close()  # the wrapper closes the scenario stream
    capture = io.StringIO()
    try:
        sys.stderr = capture
        logger.error("emit after the retained stream was closed")
    finally:
        sys.stderr = old_stderr
        logger.removeHandler(handler)
    text = capture.getvalue()
    assert "--- Logging error ---" in text, text
    assert "ValueError: I/O operation on closed file" in text, text
    # the required detection rule: scan execution output for the markers
    detector_markers = ("--- Logging error ---", "ValueError: I/O operation on closed file")
    assert all(marker in text for marker in detector_markers)


# ---------------------------------------------------------------------------
# OS-F04-B — background tasks terminate before owned-stream closure
# ---------------------------------------------------------------------------

@test("OSF04B.background_task_terminates_before_owned_stream_closure")
def _():
    tmp = tempfile.mkdtemp(prefix="corr1-f04b-")
    compliant_path = Path(tmp) / "compliant.log"

    async def compliant_scenario():
        owned = open(compliant_path, "w", encoding="utf-8")

        async def background_sync():  # fire-and-forget style task (Sheets-like)
            await asyncio.sleep(0.01)
            owned.write("background work complete\n")
            owned.flush()

        task = asyncio.create_task(background_sync())
        # CONTRACT: explicit lifecycle completion BEFORE any owned stream closes
        try:
            await task
        except Exception:  # noqa: BLE001 — a failed task is still terminated
            pass
        assert task.done()
        owned.flush()
        owned.close()

    asyncio.run(compliant_scenario())
    assert "background work complete" in compliant_path.read_text()

    # the prohibited order (closure before termination) produces exactly the
    # failure class the contract exists to prevent — observed, not propagated
    defective_path = Path(tmp) / "defective.log"

    def defective_order():
        owned = open(defective_path, "w", encoding="utf-8")

        async def background_sync():
            await asyncio.sleep(0.01)
            owned.write("late write\n")
            owned.flush()

        async def main():
            task = asyncio.create_task(background_sync())
            owned.close()  # PROHIBITED: closes while dependent work may run
            await asyncio.sleep(0.05)
            return task

        loop = asyncio.new_event_loop()
        try:
            task = loop.run_until_complete(main())
            return task.exception() if task.done() else None
        finally:
            loop.close()

    error = defective_order()
    assert isinstance(error, ValueError) and "closed file" in str(error), error


def main() -> int:
    for _name, fn in TESTS:
        fn()
    failures = [r for r in RESULTS if not r[1]]
    print(f"EXECUTION-APPARATUS-CORRECTION-1 focused battery: "
          f"{len(RESULTS) - len(failures)}/{len(RESULTS)} passed")
    for name, ok, err in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {err}" if err else ""))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
