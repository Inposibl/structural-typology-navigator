"""CORR4 regressions for the CORR3.IV1 findings.

No benchmark scenario body runs. No real provider is contacted.
The Next topology runs only when ACADEMY_CORR4_TOPOLOGY=1.
Unit tests write only to a temporary directory.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

# CORR6 MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("corr4")

from execution_infrastructure.attempt_binding import (  # noqa: E402
    _QUARANTINE,
    begin_attempt,
    collected_evidence,
    finish_attempt,
    publish_provider_evidence,
)
from execution_infrastructure.constants import (  # noqa: E402
    CHATBOT_TEST_BASE,
    PRELOAD_PATH,
    SUPABASE_SECRET_PLACEHOLDER,
)
from execution_infrastructure.controlled_context import (  # noqa: E402
    REQUIRED_PROOFS,
    clear_controlled_context,
    mint_controlled_context,
    require_controlled_context,
)
from execution_infrastructure.next_authority import (  # noqa: E402
    OrchestratorRunCapability,
    _SEAL,
    canonical_artifact_root,
    classify_build_argv,
    current_capability,
    install_capability,
)
from execution_infrastructure.pd_f04_provider_evidence import (  # noqa: E402
    AttemptProviderObserver,
    redact,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.pd_f06_isolation import (  # noqa: E402
    install_import_guard,
    is_credential_path,
)
from execution_infrastructure.pd_f06_lifecycle import AttemptBoundary  # noqa: E402
from execution_infrastructure import next_authority  # noqa: E402
from execution_infrastructure import startup_proofs  # noqa: E402
from execution_infrastructure.startup_proofs import (  # noqa: E402
    LiveRunRecord,
    _issue,
    begin_generation,
    clear_live_run,
    current_generation,
    issue_inprocess_proofs,
    prove_next_build_and_start,
    register_live_next_run,
)

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []
UNIT: dict = {}
SECRET = "SUPERSECRETVALUE"
CANONICAL_CORR3 = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
    "ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR3"
)
PROFILE = (
    "(version 1)\n(allow default)\n(deny network*)\n"
    "(allow network-outbound (remote ip \"localhost:*\"))\n"
    "(allow network-inbound (local ip \"localhost:*\"))\n"
    "(allow network-bind (local ip \"localhost:*\"))\n"
)


def test(name: str):
    def wrap(fn):
        def run() -> None:
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 — the suite records the failure
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
                return
            RESULTS.append((name, True, ""))
        TESTS.append(run)
        return run
    return wrap


def _sha(path: Path) -> str:
    if not path.is_file():
        return ""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _reset_authority() -> None:
    clear_controlled_context()
    clear_live_run()
    next_authority._CURRENT = None


class _FakeControl(BaseHTTPRequestHandler):
    body = {
        "ok": True,
        "next_server": True,
        "pid": os.getpid(),
        "harness_sentinel": "CORR2-SENTINEL-1",
        "fetch_patched": True,
        "__nextPatched": True,
    }

    def log_message(self, fmt: str, *args) -> None:
        return None

    def _send(self, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        self._send(dict(self.body))

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        if self.path.endswith("/ledger"):
            self._send({"events": [{"reason": "DEFAULT_DENY", "decision": "deny"}], "provider_events": []})
            return
        self._send(dict(self.body))


def _serve_fake() -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeControl)
    thread = threading.Thread(target=server.serve_forever, name="academy-harness-fake-next", daemon=True)
    thread.start()
    port = int(server.server_address[1])
    return server, f"http://127.0.0.1:{port}"


@test("CORR4.build_token_only_rejected")
def build_token_only() -> None:
    token = ["sandbox-exec", "-f", "profile.sb", "/usr/bin/true", "build"]
    echo = ["echo", "build"]
    if classify_build_argv(token) != "TOKEN_ONLY":
        raise AssertionError(classify_build_argv(token))
    if classify_build_argv(echo) != "TOKEN_ONLY":
        raise AssertionError(classify_build_argv(echo))
    completed = subprocess.CompletedProcess(args=token, returncode=0)
    try:
        prove_next_build_and_start(completed, "http://127.0.0.1:9/")
        raise AssertionError("token build minted a proof")
    except PermissionError as exc:
        if "BUILD_TOKEN_ONLY_REJECTED" not in str(exc):
            raise
    UNIT["build_token_only_rejected"] = True


@test("CORR4.fake_python_and_copied_sentinel_cannot_mint")
def fake_python_server() -> None:
    _reset_authority()
    server, url = _serve_fake()
    loopback = LoopbackSupabaseDouble()
    try:
        loopback.start()
        try:
            proofs = issue_inprocess_proofs(loopback, url, PROFILE)
            mint_controlled_context(proofs)
            raise AssertionError("fake python server minted a context")
        except PermissionError:
            pass
        if require_controlled_context() is not None:
            raise AssertionError("context remained after fake python server")
        begin_generation()
        register_live_next_run(
            generation=current_generation(),
            nonce="copied-sentinel",
            pid=os.getpid(),
            port=9,
            build_id="copied",
            replica_identity="copied",
            control_url=url,
        )
        try:
            mint_controlled_context({name: True for name in REQUIRED_PROOFS})
            raise AssertionError("copied health JSON minted")
        except PermissionError:
            pass
        if require_controlled_context() is not None:
            raise AssertionError("context remained after copied sentinel")
    finally:
        _reset_authority()
        loopback.stop()
        server.shutdown()
        server.server_close()
    UNIT["fake_python_rejected"] = True
    UNIT["copied_sentinel_rejected"] = True


@test("CORR4.public_register_and_private_issue_cannot_mint")
def public_and_private() -> None:
    _reset_authority()
    try:
        install_capability()
        raise AssertionError("public capability install succeeded")
    except PermissionError as exc:
        if "PUBLIC_CAPABILITY_INSTALL_FORBIDDEN" not in str(exc):
            raise
    begin_generation()
    register_live_next_run(
        generation=current_generation(),
        nonce="public-register",
        pid=os.getpid(),
        port=9,
        build_id="not-a-next-build",
        replica_identity="public",
        control_url="http://127.0.0.1:9",
    )
    try:
        _issue("CONTROLLED_NEXT_MODE", {"kind": "FORGED"})
        try:
            mint_controlled_context({name: True for name in REQUIRED_PROOFS})
            raise AssertionError("private _issue minted")
        except PermissionError:
            pass
    finally:
        _reset_authority()
    if require_controlled_context() is not None:
        raise AssertionError("context remained after private issue")
    cap = OrchestratorRunCapability(_SEAL)
    next_authority._CURRENT = cap
    try:
        begin_generation()
        try:
            register_live_next_run(
                generation=current_generation(),
                nonce="during-capability",
                pid=1,
                port=1,
                build_id="x",
                replica_identity="x",
                control_url="http://127.0.0.1:1",
            )
            raise AssertionError("public registration during a capability succeeded")
        except PermissionError as exc:
            if "PUBLIC_REGISTRATION_FORBIDDEN" not in str(exc):
                raise
    finally:
        next_authority._CURRENT = None
        cap.consumed = True
        _reset_authority()
    UNIT["private_issue_rejected"] = True
    UNIT["public_registration_rejected"] = True


@test("CORR4.replayed_capability_rejected")
def replayed_capability() -> None:
    _reset_authority()
    cap = OrchestratorRunCapability(_SEAL)
    cap.minted = True
    cap.generation = 1
    next_authority._CURRENT = cap
    startup_proofs._ACTIVE_RUN = LiveRunRecord(
        startup_proofs._SEAL, 1, cap.nonce, os.getpid(), 9, "build", "replica", "http://127.0.0.1:9",
    )
    startup_proofs._ACTIVE_RUN.orchestrator_capability_id = cap.capability_id
    try:
        mint_controlled_context({name: True for name in REQUIRED_PROOFS})
        raise AssertionError("replayed capability minted")
    except PermissionError as exc:
        if "REPLAYED_CAPABILITY_REJECTED" not in str(exc):
            raise
    finally:
        next_authority._CURRENT = None
        cap.consumed = True
        _reset_authority()
    if require_controlled_context() is not None:
        raise AssertionError("context remained after replay")
    if current_capability() is not None:
        raise AssertionError("capability remained current")
    UNIT["replayed_capability_rejected"] = True


@test("CORR4.next_server_title_requires_spawned_process")
def next_server_title_requires_spawned_process() -> None:
    cap = OrchestratorRunCapability(_SEAL)
    cap.sandbox_pid = 424242
    cap.sandbox_lstart = "birth-captured-at-spawn"
    cap.next_binary = "/tmp/academy-corr4/node_modules/next/dist/bin/next"
    title = "next-server (v16.3.5)"
    if next_authority.spawned_process_is_owned_next(cap, 424242, title, "other-birth"):
        raise AssertionError("title with a different birth was accepted")
    if next_authority.spawned_process_is_owned_next(cap, 1, title, cap.sandbox_lstart):
        raise AssertionError("title on another pid was accepted")
    if not next_authority.spawned_process_is_owned_next(cap, 424242, title, cap.sandbox_lstart):
        raise AssertionError("spawned next-server title was rejected")
    if next_authority.spawned_process_is_owned_next(
        cap, 424242, "/usr/bin/python3 -m http.server", cap.sandbox_lstart,
    ):
        raise AssertionError("python process was accepted")
    if next_authority.command_is_owned_next("node /tmp/fake/next start -p 9", cap.next_binary):
        raise AssertionError("argv token next start was accepted")
    if next_authority.command_is_owned_next(title, cap.next_binary):
        raise AssertionError("title alone was treated as a next start command")
    cap.consumed = True
    UNIT["next_server_title_requires_spawn"] = True


@test("CORR4.ten_second_work_is_not_cleanup_bounded")
def ten_second_work() -> None:
    async def work() -> str:
        await asyncio.sleep(10)
        return "done"

    boundary = AttemptBoundary()
    boundary.work_budget_s = 30.0
    boundary.cleanup_budget_s = 1.0
    boundary.join_timeout = 1.0
    boundary.begin()
    started = time.monotonic()
    try:
        result = asyncio.run(work())
        elapsed = time.monotonic() - started
        report = boundary.finish(join_timeout=1.0)
    finally:
        if not boundary._finished:
            boundary.finish(join_timeout=0.2)
    if result != "done":
        raise AssertionError(result)
    if elapsed < 9 or elapsed > 20:
        raise AssertionError(elapsed)
    if boundary.deadline_expired or boundary.cancelled_error_contained:
        raise AssertionError((boundary.deadline_expired, boundary.cancelled_error_contained))
    if report.get("deadline_expired") is True:
        raise AssertionError(report)
    UNIT["normal_10s_completes"] = True
    UNIT["elapsed_s"] = round(elapsed, 3)
    UNIT["cleanup_separate"] = True


@test("CORR4.cleanup_swallower_stays_bounded")
def cleanup_swallower() -> None:
    async def swallower() -> None:
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                await asyncio.sleep(30)

    async def main() -> None:
        asyncio.create_task(swallower())
        await asyncio.sleep(0.05)

    boundary = AttemptBoundary()
    boundary.work_budget_s = 5.0
    boundary.cleanup_budget_s = 0.4
    boundary.join_timeout = 0.4
    boundary.begin()
    started = time.monotonic()
    try:
        asyncio.run(main())
        elapsed = time.monotonic() - started
        report = boundary.finish(join_timeout=0.4)
    finally:
        if not boundary._finished:
            boundary.finish(join_timeout=0.2)
    if elapsed >= 3:
        raise AssertionError(elapsed)
    if report.get("fail_closed") is not True:
        raise AssertionError(report)
    UNIT["swallower_elapsed_s"] = round(elapsed, 3)
    UNIT["swallower_bounded"] = True


@test("CORR4.cancelled_error_stays_inside_asyncio_run")
def cancelled_inside_run() -> None:
    async def boom() -> None:
        raise asyncio.CancelledError()

    boundary = AttemptBoundary()
    boundary.work_budget_s = 5.0
    boundary.cleanup_budget_s = 0.5
    boundary.begin()
    try:
        result = asyncio.run(boom())
    finally:
        if not boundary._finished:
            boundary.finish(join_timeout=0.2)
    if result is not None:
        raise AssertionError(result)
    if boundary.cancelled_error_contained is not True:
        raise AssertionError("CancelledError escaped the bounded runner")
    UNIT["cancelled_error_contained_in_lifecycle"] = True


@test("CORR4.unarmed_event_dominates_and_idle_event_is_not_attributed")
def unarmed_policy() -> None:
    finish_attempt()
    publish_provider_evidence({
        "http_status": 500,
        "raw_infrastructure_outcome": "PROVIDER_HTTP_5XX",
        "note": "idle",
    })
    idle = [item for item in _QUARANTINE if item.get("classification") == "NO_ACTIVE_ATTEMPT"]
    if not idle:
        raise AssertionError("idle event was not process-level")
    begin_attempt("CORR4-UNARMED-UNIT", 1, require_product=False)
    try:
        accepted = publish_provider_evidence({
            "http_status": 500,
            "raw_infrastructure_outcome": "PROVIDER_HTTP_5XX",
        })
        stored = collected_evidence("CORR4-UNARMED-UNIT", 1) or {}
    finally:
        finish_attempt()
    if accepted:
        raise AssertionError("unarmed event was accepted as attempt identity")
    classes = [item.get("classification") for item in (stored.get("quarantine") or [])]
    if "UNARMED_INFRA_EVENT" not in classes or stored.get("infra_failure") is not True:
        raise AssertionError({"classes": classes, "infra": stored.get("infra_failure")})
    if "NO_ACTIVE_ATTEMPT" in classes:
        raise AssertionError("idle classification was copied onto the attempt")
    UNIT["unarmed_dominates"] = True
    UNIT["idle_not_attributed"] = True


@test("CORR4.identity_is_captured_at_request_start")
def identity_at_start() -> None:
    observer = AttemptProviderObserver()
    observer.install()
    begin_attempt("CORR4-START-A", 1, require_product=False)
    try:
        observer.bind_attempt("CORR4-START-A", 1, 1)
        observer.begin_request_capture()
    finally:
        finish_attempt()
    begin_attempt("CORR4-START-B", 1, require_product=False)
    try:
        observer.bind_attempt("CORR4-START-B", 1, 1)
        result = observer.observe_synthetic_transport(http_status=500)
        stored = collected_evidence("CORR4-START-B", 1) or {}
    finally:
        finish_attempt()
    if result.get("accepted") is True:
        raise AssertionError("late completion was stamped as the active attempt")
    classes = [item.get("classification") for item in (stored.get("quarantine") or [])]
    scenarios = [
        (item.get("record") or {}).get("scenario_id")
        for item in (stored.get("quarantine") or [])
        if isinstance(item, dict)
    ]
    owned = [item.get("scenario_id") for item in (stored.get("provider_evidence") or []) if isinstance(item, dict)]
    if "STALE_OR_MISMATCHED_INFRA_EVENT" not in classes:
        raise AssertionError(classes)
    if "CORR4-START-A" not in scenarios:
        raise AssertionError(scenarios)
    if "CORR4-START-B" in owned:
        raise AssertionError(owned)
    UNIT["identity_at_start"] = True
    UNIT["stale_visible"] = True


@test("CORR4.secrets_are_redacted_before_storage")
def redaction_before_storage() -> None:
    note = (
        f"Bearer {SECRET} Basic dXNlcjpwYXNz "
        f"sb_secret_{SECRET} sk-abcdefghijklmnopqrstuvwxyz"
    )
    begin_attempt("CORR4-REDACT", 1, require_product=False)
    try:
        publish_provider_evidence({
            "scenario_id": "CORR4-REDACT",
            "attempt_number": 1,
            "http_status": 200,
            "model": f"secret-model-{SECRET}",
            "host": f"secret-host-{SECRET}",
            "thread": f"secret-thread-{SECRET}",
            "note": note,
            "authorization": f"Bearer {SECRET}",
        })
        stored = collected_evidence("CORR4-REDACT", 1) or {}
    finally:
        finish_attempt()
    blob = json.dumps(stored, ensure_ascii=False)
    for marker in (SECRET, "sb_secret_", "Bearer ", "Basic dXNlcjpwYXNz", "sk-abcdefghijklmnopqrstuvwxyz"):
        if marker in blob:
            raise AssertionError(marker)
    stamped = redact({"note": note, "model": f"secret-model-{SECRET}"})
    if SECRET in json.dumps(stamped):
        raise AssertionError(stamped)
    UNIT["raw_attempt_store_redacted"] = True
    UNIT["proof_summary_redacted"] = True


@test("CORR4.node_ledger_redacts_before_flush")
def node_ledger_redaction() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="academy-corr4-ledger-"))
    ledger = tmp / "node-ledger.json"
    script = tmp / "redact.cjs"
    script.write_text(
        "const preload = require(process.env.PRELOAD);\n"
        "preload.recordProviderObservation({\n"
        "  scenario_id: 'CORR4-NODE',\n"
        "  attempt_number: 1,\n"
        "  http_status: 500,\n"
        "  model: 'secret-model-' + process.env.SECRET,\n"
        "  host: 'secret-host-' + process.env.SECRET,\n"
        "  thread: 'secret-thread-' + process.env.SECRET,\n"
        "  note: 'Bearer ' + process.env.SECRET + ' Basic dXNlcjpwYXNz sb_secret_' + process.env.SECRET + ' sk-abcdefghijklmnopqrstuvwxyz',\n"
        "  authorization: 'Bearer ' + process.env.SECRET\n"
        "});\n"
        "preload.flushLedger();\n"
        "process.exit(0);\n",
        encoding="utf-8",
    )
    env = os.environ.copy()
    env["PRELOAD"] = str(PRELOAD_PATH)
    env["ACADEMY_NODE_LEDGER_PATH"] = str(ledger)
    env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
    env["SECRET"] = SECRET
    completed = subprocess.run(
        ["node", str(script)],
        cwd=str(tmp),
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr[-500:])
    blob = ledger.read_text(encoding="utf-8")
    for marker in (SECRET, "sb_secret_", "Bearer ", "Basic dXNlcjpwYXNz", "sk-abcdefghijklmnopqrstuvwxyz"):
        if marker in blob:
            raise AssertionError(marker)
    UNIT["node_ledger_redacted"] = True


@test("CORR4.multilevel_credential_symlink_denied")
def multilevel_symlink() -> None:
    install_import_guard()
    root = Path(tempfile.mkdtemp(prefix="academy-corr4-links-"))
    staging = root / "staging-gcp.json"
    staging.write_text(f"SECRET-BYTES-{SECRET}\n", encoding="utf-8")
    credentials = root / "credentials"
    credentials.mkdir()
    staging.rename(credentials / "gcp.json")
    linkdir = root / "linkdir"
    link2 = root / "link2"
    linkdir.symlink_to(credentials, target_is_directory=True)
    link2.symlink_to(linkdir, target_is_directory=True)
    chained = link2 / "gcp.json"
    if is_credential_path(chained) is not True:
        raise AssertionError("two-level link was not denied")
    try:
        open(chained, "r", encoding="utf-8").read()
        raise AssertionError("two-level link was read")
    except PermissionError as exc:
        if "CREDENTIAL_DISCOVERY_DENIED" not in str(exc) or SECRET in str(exc):
            raise
    longer = root / "l4"
    (root / "l3").symlink_to(link2, target_is_directory=True)
    longer.symlink_to(root / "l3", target_is_directory=True)
    if is_credential_path(longer / "gcp.json") is not True:
        raise AssertionError("four-level link was not denied")
    cycle_a = root / "cycle-a"
    cycle_b = root / "cycle-b"
    cycle_a.symlink_to(cycle_b, target_is_directory=True)
    cycle_b.symlink_to(cycle_a, target_is_directory=True)
    if is_credential_path(cycle_a / "gcp.json") is not True:
        raise AssertionError("symlink cycle failed open")
    try:
        open(cycle_a / "gcp.json", "r", encoding="utf-8").read()
        raise AssertionError("cycle was read")
    except PermissionError as exc:
        if SECRET in str(exc):
            raise
    UNIT["multilevel_symlink_denied"] = True
    UNIT["credential_values_read"] = False


@test("CORR4.calibration_label_cannot_downgrade_product")
def calibration_label() -> None:
    from harness.execution_request import ExecutionRequest
    from harness.factory import FactoryRejected, create_calibration_adapter

    def _request(adapter_id: str) -> ExecutionRequest:
        return ExecutionRequest(
            scenario_id="CORR4-CAL",
            scenario_sha256="b" * 64,
            track="ALEXEY_INBOUND",
            execution_level="L2",
            adapter_id=adapter_id,
            run_id="corr4-cal",
            attempt=1,
        )

    def _registry(adapter_id: str, implementation: str) -> dict:
        return {"adapters": {adapter_id: {
            "lane": "CALIBRATION",
            "implementation_class": implementation,
            "provenance_class": "SYNTHETIC_CALIBRATION",
            "native_observables": ["act"],
        }}}

    for adapter_id, implementation in (
        ("alexey_user_turn", "adapters.product.AlexeyUserTurnAdapter"),
        ("navigator_l2_chat", "adapters.product.NavigatorL2ChatAdapter"),
    ):
        try:
            create_calibration_adapter(_request(adapter_id), _registry(adapter_id, implementation))
            raise AssertionError(adapter_id)
        except FactoryRejected as exc:
            if "CALIBRATION_LABEL_CANNOT_DOWNGRADE_PRODUCT_REQUIREMENT" not in str(exc):
                raise
    adapter, _spec = create_calibration_adapter(
        _request("corr4_clean"),
        _registry("corr4_clean", "adapters.corr4_producers.CleanSyntheticAdapter"),
    )
    if adapter.__class__.__name__ != "CleanSyntheticAdapter":
        raise AssertionError(type(adapter).__name__)
    UNIT["calibration_label_cannot_downgrade"] = True


@test("CORR4.freeze_errors_return_verdicts")
def freeze_errors_return_verdicts() -> None:
    import harness.runner as runner_mod
    from adapters.corr4_producers import CleanSyntheticAdapter, corr4_registry, corr4_spec
    from harness.evidence import EvidenceImmutableViolation, EvidencePathError, RawCapture
    from harness.factory import LANE_CALIBRATION

    original_gate = runner_mod._controlled_execution_gate
    original_freeze = runner_mod.freeze_evidence
    original_execute = CleanSyntheticAdapter.execute
    errors = (
        PermissionError("freeze denied"),
        OSError("freeze os"),
        TypeError("freeze type"),
        ValueError("freeze value"),
        RuntimeError("freeze runtime"),
        EvidencePathError("freeze path"),
        EvidenceImmutableViolation("freeze immutable"),
    )
    seen: list[str] = []

    def allow(*_args, **_kwargs):
        return None

    def publishing_execute(self, request):
        publish_provider_evidence({
            "http_status": 500,
            "raw_infrastructure_outcome": "PROVIDER_HTTP_5XX",
        })
        return RawCapture(
            values={"act": "OUT_OF_SCOPE", "output": "synthetic-ok"},
            transcripts={"turn": {"role": "assistant", "content": "synthetic-ok"}},
            sut_path="tests/execution_infrastructure_implementation_1_corr4.py",
            sut_symbol="freeze",
            outcome_class="OUT_OF_SCOPE",
        )

    runner_mod._controlled_execution_gate = allow
    try:
        for index, exc in enumerate(errors):
            def freeze(*_args, _exc=exc, **_kwargs):
                raise _exc

            runner_mod.freeze_evidence = freeze
            if isinstance(exc, PermissionError):
                CleanSyntheticAdapter.execute = publishing_execute
            else:
                CleanSyntheticAdapter.execute = original_execute
            outcome = runner_mod.run_scenario_once(
                corr4_spec(f"CORR4-FREEZE-{index}", "corr4_clean"),
                run_id=f"corr4-freeze-{index}",
                attempt=1,
                evidence_root=tempfile.mkdtemp(prefix="academy-corr4-freeze-"),
                lane=LANE_CALIBRATION,
                calibration_registry=corr4_registry(),
            )
            state = outcome.derivation_state or {}
            if state.get("freeze_failure") != type(exc).__name__:
                raise AssertionError({
                    "expected": type(exc).__name__,
                    "freeze_failure": state.get("freeze_failure"),
                    "verdict": outcome.verdict.value,
                })
            if outcome.verdict.value not in ("INFRA_FAILURE", "BENCHMARK_DEFECT", "TIMEOUT"):
                raise AssertionError(outcome.verdict.value)
            if isinstance(exc, PermissionError):
                if outcome.verdict.value != "INFRA_FAILURE":
                    raise AssertionError(outcome.verdict.value)
                if state.get("continue_to_next_scenario") is not False:
                    raise AssertionError(state.get("continue_to_next_scenario"))
                if state.get("raw_evidence_path") is not None:
                    raise AssertionError(state.get("raw_evidence_path"))
                if (state.get("infrastructure_precedence") or {}).get("dominates") is not True:
                    raise AssertionError(state.get("infrastructure_precedence"))
            seen.append(type(exc).__name__)
    finally:
        runner_mod._controlled_execution_gate = original_gate
        runner_mod.freeze_evidence = original_freeze
        CleanSyntheticAdapter.execute = original_execute
        try:
            finish_attempt()
        except Exception:
            pass
    if seen != [type(item).__name__ for item in errors]:
        raise AssertionError(seen)
    UNIT["permission_error_freeze_preserves_precedence"] = True
    UNIT["all_freeze_errors_return_verdict"] = True


@test("CORR4.real_local_arm_runs_before_native_transport")
def real_local_arm_order() -> None:
    """CORR6: the arm-order property needs a real Alexey turn, and a real
    turn needs runner-owned product authority. This unit process has no
    controlled context, so the turn must fail closed before the native
    transport. The positive arm-before-transport proof runs through the
    runner-bound CORR6 topology (real_local_arm_bound)."""
    import adapters.product as product
    from execution_infrastructure.product_capability import (
        ProductBindingRequired,
        mint_accepted_authority,
    )
    from harness.execution_request import build_execution_request

    observed: list[dict] = []
    real_load = product._load_package_module

    def wrapped_load(root, package, module):
        mod, err = real_load(root, package, module)
        if err is None and module == "lebedev_adapter":
            async def stub(self, *args, **kwargs):
                observed.append({"reached": True})
                return {"message": "local-synthetic", "profile": {}, "conversationState": {}}

            mod.LebedevNavigatorAdapter.call_navigator_core = stub
        return mod, err

    product._load_package_module = wrapped_load
    rejected = False
    try:
        begin_attempt("CORR4-ARM", 1, require_product=False)
        spec = {
            "scenario_id": "CORR4-ARM",
            "track": "ALEXEY_INBOUND",
            "execution_level": "L2",
            "adapter_id": "alexey_user_turn",
            "turns": [{"role": "user", "content": "arm order probe"}],
            "preconditions": {
                "navigator_transport": "real_local",
                "user_id": 701001,
                "message_id": 1,
            },
            "state_setup": {},
            "fault_schedule": [],
        }
        request = build_execution_request(
            spec,
            adapter_id="alexey_user_turn",
            run_id="corr4-arm",
            attempt=1,
            scenario_sha256="d" * 64,
            navigator_test_root=str(tempfile.mkdtemp(prefix="academy-corr4-nav-")),
            tikhon_test_root=str(CHATBOT_TEST_BASE),
            execution_environment={"navigator_l2_base_url": "http://127.0.0.1:9"},
        )
        from adapters.product import AlexeyUserTurnAdapter

        try:
            mint_accepted_authority("corr4-arm")
            raise AssertionError("public self-mint produced product authority")
        except ProductBindingRequired:
            pass
        try:
            AlexeyUserTurnAdapter().execute(request)
        except ProductBindingRequired:
            rejected = True
    finally:
        product._load_package_module = real_load
        try:
            finish_attempt()
        except Exception:
            pass
    if not rejected:
        raise AssertionError("unbound real_local Alexey turn was not rejected")
    if observed:
        raise AssertionError("native transport was reached without product authority")
    UNIT["real_local_arm_before_transport"] = "PROVEN_BY_RUNNER_BOUND_CORR6_TOPOLOGY"
    UNIT["real_local_unbound_fail_closed"] = True


@test("CORR4.focused_writer_does_not_touch_canonical_proofs")
def canonical_writer() -> None:
    targets = [
        CANONICAL_CORR3 / "ASYNC_LIFECYCLE_REAL_RUN_PROOF.json",
        CANONICAL_CORR3 / "NETWORK_CREDENTIAL_RESIDUAL_PROOF.json",
        CANONICAL_CORR3 / "REAL_TOPOLOGY_CORR3_PROOF.json",
    ]
    before = {str(path): _sha(path) for path in targets}
    from tests.execution_infrastructure_implementation_1_corr3 import _write_unit_artifacts

    _write_unit_artifacts()
    after = {str(path): _sha(path) for path in targets}
    if before != after:
        raise AssertionError({"before": before, "after": after})
    if not canonical_artifact_root(CANONICAL_CORR3):
        raise AssertionError("canonical root was not recognized")
    previous = os.environ.get("ACADEMY_AUTHOR_ARTIFACT_ROOT")
    os.environ["ACADEMY_AUTHOR_ARTIFACT_ROOT"] = str(CANONICAL_CORR3)
    try:
        try:
            _write_unit_artifacts()
            raise AssertionError("canonical author root was accepted")
        except PermissionError as exc:
            if "CANONICAL_ARTIFACT_ROOT_REFUSED" not in str(exc):
                raise
    finally:
        if previous is None:
            os.environ.pop("ACADEMY_AUTHOR_ARTIFACT_ROOT", None)
        else:
            os.environ["ACADEMY_AUTHOR_ARTIFACT_ROOT"] = previous
    producers = (BENCH / "adapters" / "corr4_producers.py").read_text(encoding="utf-8")
    if "publish_provider_evidence" in producers or "publish_retrieval_evidence" in producers:
        raise AssertionError("corr4 adapters publish evidence directly")
    UNIT["focused_tests_write_temp_only"] = True


@test("CORR4.real_topology")
def real_topology() -> None:
    if os.environ.get("ACADEMY_CORR4_TOPOLOGY") != "1":
        UNIT["topology_skipped"] = True
        return
    from execution_infrastructure.corr4_topology import run_corr4_topology

    proof = run_corr4_topology()
    UNIT["topology"] = {
        "ok": proof.get("ok"),
        "reason": proof.get("reason"),
        "checks": proof.get("checks"),
        "proof_path": proof.get("proof_path"),
        "scenarios_executed": proof.get("scenarios_executed"),
        "async_elapsed_s": ((proof.get("async_10s") or {}).get("ten_second") or {}).get("elapsed_s"),
        "async_verdict": (proof.get("async_10s") or {}).get("verdict"),
        "cancelled_contained": (proof.get("cancelled") or {}).get("cancelled_error_contained"),
        "minted": proof.get("minted"),
        "build_pass": proof.get("build_pass"),
        "build_marker": proof.get("build_marker"),
    }
    if proof.get("ok") is not True:
        raise AssertionError(proof.get("reason") or proof.get("checks"))
    UNIT["topology_ok"] = True


def _write_author_proofs(exit_code: int) -> None:
    raw = os.environ.get("ACADEMY_CORR4_ARTIFACT_ROOT")
    if not raw:
        return
    from execution_infrastructure.next_authority import (
        finalized_artifact_root,
        hardcoded_artifact_root,
    )

    root = Path(raw).resolve()
    if hardcoded_artifact_root(root):
        raise PermissionError("CANONICAL_ARTIFACT_ROOT_REFUSED")
    if finalized_artifact_root(root):
        raise PermissionError("FINALIZED_ARTIFACT_ROOT_IMMUTABLE")
    target = root / "CORR4_UNIT_PROOF.json"
    if target.exists():
        raise PermissionError("FINALIZED_ARTIFACT_ROOT_IMMUTABLE")
    root.mkdir(parents=True, exist_ok=True)
    payload = {
        "act": "IMPLEMENTATION-1.CORR4",
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "exit_code": int(exit_code),
        "unit": UNIT,
        "results": [{"name": name, "pass": ok, "detail": detail} for name, ok, detail in RESULTS],
    }
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    sys.dont_write_bytecode = True
    raw_root = os.environ.get("ACADEMY_CORR4_ARTIFACT_ROOT")
    if raw_root:
        from execution_infrastructure.next_authority import refuse_persistent_artifact_root

        try:
            refuse_persistent_artifact_root(Path(raw_root))
        except PermissionError as exc:
            print(json.dumps({
                "refused": True,
                "reason": str(exc),
                "artifact_root": str(Path(raw_root).resolve()),
                "provider_contact": "NONE",
                "benchmark_scenarios_executed": 0,
            }))
            return 2
    for fn in TESTS:
        fn()
    passed = sum(1 for _name, ok, _detail in RESULTS if ok)
    failed = len(RESULTS) - passed
    exit_code = 0 if failed == 0 else 1
    summary = {
        "focused_tests_total": len(RESULTS),
        "focused_tests_pass": passed,
        "focused_tests_fail": failed,
        "exit_code": exit_code,
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "results": [
            {"name": name, "pass": ok, "detail": detail}
            for name, ok, detail in RESULTS
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    _write_author_proofs(exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
