"""CORR5 regressions for the CORR4.IV1 findings.

No benchmark scenario body runs. No real provider is contacted.
The Next topology runs only when ACADEMY_CORR5_TOPOLOGY=1.
Focused tests write only to a temporary directory.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

# CORR6 MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("corr5")

from execution_infrastructure.attempt_binding import (  # noqa: E402
    _QUARANTINE,
    begin_attempt,
    collected_evidence,
    finish_attempt,
    publish_generic_infra_failure,
    publish_lifecycle_report,
    publish_timeout_evidence,
)
from execution_infrastructure.constants import CHATBOT_TEST_BASE  # noqa: E402
from execution_infrastructure.next_authority import (  # noqa: E402
    current_capability,
    default_focused_output_root,
    launch_controlled_next,
    refuse_persistent_artifact_root,
    resolve_next_binary,
)
from execution_infrastructure.next_runtime_identity import (  # noqa: E402
    attest_replica_next_runtime,
    authority_relative_paths,
    trusted_node_modules,
)
from execution_infrastructure.pd_f04_provider_evidence import AttemptProviderObserver  # noqa: E402
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.product_capability import (  # noqa: E402
    ProductBindingRequired,
    clear_product_authority,
    install_product_authority,
    is_product_backed,
    mint_accepted_authority,
)

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []
UNIT: dict = {}
CORR4_CANONICAL = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
    "ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR4"
)
FAKE_NEXT = """#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const cmd = process.argv[2];
if (cmd === "build") {
  process.stdout.write("Creating an optimized production build\\nCompiled successfully\\n");
  fs.mkdirSync(".next", { recursive: true });
  fs.writeFileSync(".next/BUILD_ID", "fake-build\\n");
  process.exit(0);
}
if (cmd === "start") {
  process.title = "next-server (v16.3.5)";
  const port = Number(process.env.PORT || 3000);
  http.createServer((req, res) => {
    res.end(JSON.stringify({ ok: true, preload: true }));
  }).listen(port, "127.0.0.1");
}
"""
SECRETS = (
    "Bearer SUPERSECRETVALUE",
    "Authorization: Basic dXNlcjpwYXNz",
    "sb_secret_benchmark_placeholder",
    "sk-abcdefghijklmnopqrstuvwxyz",
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
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _copy_authority(replica: Path) -> None:
    """CORR6: the frozen surface is the full node_modules tree. Clone it.

    The clone is copy-on-write. Writing to a cloned file never changes the
    origin bytes.
    """
    origin = trusted_node_modules()
    replica.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cp", "-cR", str(origin), str(replica / "node_modules")], check=True)
    shutil.copy2(origin.parent / "package-lock.json", replica / "package-lock.json")
    if len(authority_relative_paths()) < 1000:
        raise AssertionError("frozen surface is not the full tree")


def _allow_runner():
    import harness.runner as runner_mod

    original = runner_mod._controlled_execution_gate

    def allow(*_args, **_kwargs):
        return None

    runner_mod._controlled_execution_gate = allow
    return runner_mod, original


def _spec(scenario_id: str, adapter_id: str) -> dict:
    from adapters.corr4_producers import corr4_spec

    return corr4_spec(scenario_id, adapter_id)


@test("CORR5.fake_next_runtime_is_rejected_before_mint")
def fake_next() -> None:
    replica = Path(tempfile.mkdtemp(prefix="academy-corr5-fake-next-"))
    _copy_authority(replica)
    entry = replica / "node_modules" / "next" / "dist" / "bin" / "next"
    entry.unlink()
    entry.write_text(FAKE_NEXT, encoding="utf-8")
    entry.chmod(0o755)
    if "next-server (v16.3.5)" not in FAKE_NEXT or "BUILD_ID" not in FAKE_NEXT:
        raise AssertionError("fake next does not reproduce the observable class")
    resolved = resolve_next_binary(replica)
    if resolved.name != "next":
        raise AssertionError(resolved)
    attestation = attest_replica_next_runtime(replica)
    if attestation.get("classification") != "NEXT_RUNTIME_IDENTITY_MISMATCH":
        raise AssertionError(attestation.get("classification"))
    if "next/dist/bin/next" not in (attestation.get("mismatches") or []):
        raise AssertionError(attestation.get("mismatches"))
    try:
        launch_controlled_next(
            replica=replica,
            profile_path=replica / "missing.sb",
            port=9,
            env={},
            build_log=replica / "build.log",
            start_log=replica / "start.log",
            state_path=replica / "state.json",
            ledger_path=replica / "ledger.json",
            preload_path=replica / "preload.cjs",
        )
        raise AssertionError("fake next launched")
    except PermissionError as exc:
        if "NEXT_RUNTIME_IDENTITY_MISMATCH" not in str(exc):
            raise
    if current_capability() is not None:
        raise AssertionError("capability was minted for a fake next runtime")
    if (replica / ".next" / "BUILD_ID").exists():
        raise AssertionError("fake build ran before attestation")
    UNIT["fake_next_runtime_rejected"] = True
    UNIT["path_suffix_is_not_runtime_identity"] = True


@test("CORR5.genuine_next_bytes_match_trusted_origin")
def genuine_next_bytes() -> None:
    replica = Path(tempfile.mkdtemp(prefix="academy-corr5-real-next-"))
    _copy_authority(replica)
    attestation = attest_replica_next_runtime(replica)
    if attestation.get("ok") is not True:
        raise AssertionError({
            "classification": attestation.get("classification"),
            "mismatches": attestation.get("mismatches"),
        })
    if attestation.get("next_version") != "16.3.5":
        raise AssertionError(attestation.get("next_version"))
    from execution_infrastructure.frozen_next_authority import FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256

    if attestation.get("authority") != "FROZEN_NEXT_RUNTIME_AUTHORITY":
        raise AssertionError(attestation.get("authority"))
    if attestation.get("frozen_authority_sha256") != FROZEN_NEXT_RUNTIME_AUTHORITY_SHA256:
        raise AssertionError(attestation.get("frozen_authority_sha256"))
    if attestation.get("origin_is_replica") is not False:
        raise AssertionError("origin and replica were the same directory")
    if int(attestation.get("file_count") or 0) != int(attestation.get("expected_entry_count") or -1):
        raise AssertionError(attestation.get("file_count"))
    same = attest_replica_next_runtime(trusted_node_modules().parent)
    if same.get("origin_is_replica") is not True or same.get("ok") is not False:
        raise AssertionError("the authority root was allowed to attest itself")
    UNIT["genuine_next_bytes_accepted"] = True
    UNIT["trusted_origin"] = "FROZEN_NEXT_RUNTIME_AUTHORITY"
    UNIT["next_version"] = attestation.get("next_version")
    UNIT["identity_sha256"] = attestation.get("frozen_authority_sha256")
    UNIT["file_count"] = attestation.get("file_count")


@test("CORR5.product_capability_requires_binding")
def product_capability() -> None:
    from adapters.corr5_producers import (
        CalibrationWrapAlexey,
        CalibrationWrapLebedev,
        CalibrationWrapNavigator,
        corr5_registry,
    )
    from adapters.product import AlexeyUserTurnAdapter, NavigatorL2ChatAdapter
    from harness.factory import FactoryRejected, LANE_CALIBRATION, create_calibration_adapter
    from harness.execution_request import build_execution_request

    class Renamed(AlexeyUserTurnAdapter):
        lane_label = "SYNTHETIC"

    for cls in (CalibrationWrapAlexey, CalibrationWrapNavigator, CalibrationWrapLebedev, Renamed, NavigatorL2ChatAdapter):
        if not is_product_backed(cls):
            raise AssertionError(cls.__name__)
    saved = {key: os.environ.get(key) for key in ("NAVIGATOR_TEST_ROOT", "TIKHON_TEST_ROOT")}
    os.environ.pop("NAVIGATOR_TEST_ROOT", None)
    os.environ.pop("TIKHON_TEST_ROOT", None)
    from execution_infrastructure.pd_f06_product_lifecycle import install_rebind_hook

    install_rebind_hook()
    clear_product_authority()
    CalibrationWrapAlexey.executed = False
    CalibrationWrapNavigator.executed = False
    CalibrationWrapLebedev.executed = False
    runner_mod, original = _allow_runner()
    registry = corr5_registry()
    try:
        for adapter_id in ("corr5_wrap_alexey", "corr5_wrap_navigator", "corr5_wrap_lebedev"):
            outcome = runner_mod.run_scenario_once(
                _spec("CORR5-UNBOUND", adapter_id),
                run_id="corr5-unbound",
                attempt=1,
                evidence_root=tempfile.mkdtemp(prefix="academy-corr5-unbound-"),
                lane=LANE_CALIBRATION,
                calibration_registry=registry,
            )
            if outcome.verdict.value == "PASS":
                raise AssertionError(adapter_id)
            if "PRODUCT_BINDING_REQUIRED" not in (outcome.verdict_reason or ""):
                raise AssertionError({
                    "adapter": adapter_id,
                    "verdict": outcome.verdict.value,
                    "reason": outcome.verdict_reason,
                })
        if CalibrationWrapAlexey.executed or CalibrationWrapNavigator.executed or CalibrationWrapLebedev.executed:
            raise AssertionError("product code ran without a binding")
        request = build_execution_request(
            _spec("CORR5-FACTORY", "corr5_wrap_alexey"),
            adapter_id="corr5_wrap_alexey",
            run_id="corr5-factory",
            attempt=1,
            scenario_sha256="a" * 64,
            navigator_test_root=tempfile.mkdtemp(prefix="academy-corr5-nav-"),
            tikhon_test_root=tempfile.mkdtemp(prefix="academy-corr5-tikhon-"),
        )
        try:
            create_calibration_adapter(request, registry)
            raise AssertionError("calibration factory accepted a product wrapper")
        except FactoryRejected as exc:
            if "CALIBRATION_LABEL_CANNOT_DOWNGRADE_PRODUCT_REQUIREMENT" not in str(exc):
                raise
        try:
            AlexeyUserTurnAdapter().execute(request)
            raise AssertionError("unbound Alexey execute ran")
        except ProductBindingRequired:
            pass
        try:
            import data_engine.lebedev_adapter  # noqa: F401
            raise AssertionError("unbound lebedev import ran")
        except ProductBindingRequired:
            pass
    finally:
        runner_mod._controlled_execution_gate = original
        clear_product_authority()
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    UNIT["product_capability_requires_binding"] = True
    UNIT["calibration_cannot_wrap_product_unbound"] = True


@test("CORR5.wrong_product_identity_is_rejected")
def wrong_identity() -> None:
    from datetime import datetime, timezone

    from harness.factory import BINDING_TOKEN_SCHEMA_VERSION, BindingToken
    from harness.seams.sut_binding import EXPECTED_NAVIGATOR, EXPECTED_TIKHON

    clear_product_authority()
    try:
        install_product_authority(object())
        raise AssertionError("non-token was installed")
    except ProductBindingRequired:
        pass
    root = CHATBOT_TEST_BASE.resolve()
    document = json.loads((root / "tests" / "_testbase" / "accepted-byte-state.json").read_text(encoding="utf-8"))
    # CORR6: public self-mint is not authority. Runner-bound positive and
    # negative identity matrices run in the CORR6 suite and topology.
    try:
        mint_accepted_authority("corr5-good-identity")
        raise AssertionError("public self-mint produced product authority")
    except ProductBindingRequired:
        pass
    if document.get("manifest_sha256") != "dbe494af1aaf47df8409ba9b570c250022e310c9f89e8cfae92a98675b5b92b4":
        raise AssertionError("accepted manifest digest changed")
    clear_product_authority()
    wrong_root = BindingToken(
        schema_version=BINDING_TOKEN_SCHEMA_VERSION,
        navigator_expected=dict(EXPECTED_NAVIGATOR),
        tikhon_expected=dict(EXPECTED_TIKHON),
        navigator_root=str(root),
        tikhon_root=str(Path(tempfile.mkdtemp(prefix="academy-corr5-wrong-root-"))),
        navigator_manifest_sha256=None,
        tikhon_manifest_sha256=document.get("manifest_sha256"),
        created_at_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        run_id="corr5-wrong-root",
    )
    try:
        install_product_authority(wrong_root)
        raise AssertionError("wrong TEST_BASE was installed")
    except ProductBindingRequired:
        pass
    wrong_sha = BindingToken(
        schema_version=BINDING_TOKEN_SCHEMA_VERSION,
        navigator_expected=dict(EXPECTED_NAVIGATOR),
        tikhon_expected=dict(EXPECTED_TIKHON),
        navigator_root=str(root.parent),
        tikhon_root=str(root),
        navigator_manifest_sha256=None,
        tikhon_manifest_sha256="0" * 64,
        created_at_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        run_id="corr5-wrong-sha",
    )
    try:
        install_product_authority(wrong_sha)
        raise AssertionError("wrong byte-state was installed")
    except ProductBindingRequired:
        pass
    clear_product_authority()
    UNIT["wrong_identity_rejected"] = True


@test("CORR5.internal_cancelled_error_reaches_verdict")
def internal_cancel() -> None:
    from harness.factory import LANE_CALIBRATION

    from adapters.corr5_producers import corr5_registry

    runner_mod, original = _allow_runner()
    try:
        outcome = runner_mod.run_scenario_once(
            _spec("CORR5-CANCEL", "corr5_internal_cancel"),
            run_id="corr5-cancel",
            attempt=1,
            evidence_root=tempfile.mkdtemp(prefix="academy-corr5-cancel-"),
            lane=LANE_CALIBRATION,
            calibration_registry=corr5_registry(),
        )
    finally:
        runner_mod._controlled_execution_gate = original
        try:
            finish_attempt()
        except Exception:
            pass
    state = outcome.derivation_state or {}
    stored = collected_evidence("CORR5-CANCEL", 1) or {}
    sources = [
        item.get("source")
        for item in (stored.get("generic_infra_failure") or [])
        if isinstance(item, dict)
    ]
    if outcome.verdict.value == "PASS":
        raise AssertionError("cancellation returned PASS")
    if outcome.verdict.value not in ("INFRA_FAILURE", "TIMEOUT"):
        raise AssertionError(outcome.verdict.value)
    if state.get("continue_to_next_scenario") is not False:
        raise AssertionError(state.get("continue_to_next_scenario"))
    if state.get("cancelled_error_contained") is not True:
        raise AssertionError(state)
    if not ((stored.get("lifecycle") or {}).get("cancelled_error_contained")):
        raise AssertionError(stored.get("lifecycle"))
    if "LIFECYCLE_CANCELLATION" not in sources:
        raise AssertionError(sources)
    UNIT["product_cancelled_error_reaches_verdict"] = True
    UNIT["cancelled_error_cannot_escape_runner"] = True


@test("CORR5.request_start_attribution_matrix")
def attribution_matrix() -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    import threading

    observer = AttemptProviderObserver()
    observer.install()
    loopback = LoopbackSupabaseDouble()
    from execution_infrastructure.attempt_binding import register_active_loopback

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            return None

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            body = b'{"armed":{}}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, name="academy-harness-matrix-control", daemon=True)
    thread.start()
    state = Path(tempfile.mkdtemp(prefix="academy-corr5-matrix-")) / "state.json"
    state.write_text(json.dumps({"port": server.server_address[1]}), encoding="utf-8")
    previous = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state)
    register_active_loopback(loopback)
    loopback.start()
    try:
        finish_attempt()
        before = len(_QUARANTINE)
        observer.begin_request_capture()
        idle = observer.observe_synthetic_transport(
            http_status=500,
            note="matrix-a",
        )
        process_a = [
            item for item in _QUARANTINE[before:]
            if item.get("classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"
        ]
        if idle.get("accepted") is True or not process_a:
            raise AssertionError("matrix A was not process level")

        observer.begin_request_capture()
        begin_attempt("CORR5-MATRIX-B", 1, require_product=False)
        try:
            during_b = observer.observe_synthetic_transport(http_status=500, note="matrix-b")
            stored_b = collected_evidence("CORR5-MATRIX-B", 1) or {}
        finally:
            finish_attempt()
        b_classes = [item.get("classification") for item in (stored_b.get("quarantine") or [])]
        b_records = [
            (item.get("record") or {}).get("request_start_classification")
            for item in (stored_b.get("quarantine") or [])
            if isinstance(item, dict)
        ]
        if during_b.get("accepted") is True:
            raise AssertionError("matrix B was accepted onto attempt B")
        if "NO_ACTIVE_ATTEMPT_AT_REQUEST_START" in b_records or "UNARMED_INFRA_EVENT" in b_classes and "matrix-b" in repr(stored_b.get("quarantine")):
            if any(
                (item.get("record") or {}).get("note") == "matrix-b"
                for item in (stored_b.get("quarantine") or [])
                if isinstance(item, dict)
            ):
                raise AssertionError(b_classes)
        process_b = [
            item for item in _QUARANTINE
            if item.get("classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"
            and ((item.get("record") or {}).get("note") == "matrix-b")
        ]
        if not process_b:
            raise AssertionError("matrix B did not stay process level")

        begin_attempt("CORR5-MATRIX-C-A", 1, require_product=False)
        try:
            observer.bind_attempt("CORR5-MATRIX-C-A", 1, 1)
            observer.begin_request_capture()
        finally:
            finish_attempt()
        begin_attempt("CORR5-MATRIX-C-B", 1, require_product=False)
        try:
            observer.bind_attempt("CORR5-MATRIX-C-B", 1, 1)
            stale = observer.observe_synthetic_transport(http_status=500, note="matrix-c")
            stored_c = collected_evidence("CORR5-MATRIX-C-B", 1) or {}
        finally:
            finish_attempt()
        c_classes = [item.get("classification") for item in (stored_c.get("quarantine") or [])]
        c_scenarios = [
            (item.get("record") or {}).get("scenario_id")
            for item in (stored_c.get("quarantine") or [])
            if isinstance(item, dict)
        ]
        if stale.get("accepted") is True or "STALE_OR_MISMATCHED_INFRA_EVENT" not in c_classes:
            raise AssertionError(c_classes)
        if "CORR5-MATRIX-C-A" not in c_scenarios:
            raise AssertionError(c_scenarios)

        begin_attempt("CORR5-MATRIX-D", 1, require_product=False)
        try:
            observer.bind_attempt("OTHER", 9, 1)
            observer.begin_request_capture()
            unarmed = observer.observe_synthetic_transport(http_status=500, note="matrix-d")
            stored_d = collected_evidence("CORR5-MATRIX-D", 1) or {}
        finally:
            finish_attempt()
        d_classes = [item.get("classification") for item in (stored_d.get("quarantine") or [])]
        if unarmed.get("accepted") is True or "UNARMED_INFRA_EVENT" not in d_classes:
            raise AssertionError(d_classes)

        begin_attempt("CORR5-MATRIX-E", 1, require_product=False)
        try:
            from execution_infrastructure.attempt_binding import arm_request_identity

            arm_request_identity("CORR5-MATRIX-E", 1, 1, "levels-of-consciousness")
            observer.bind_attempt("CORR5-MATRIX-E", 1, 1)
            observer.begin_request_capture()
            armed = observer.observe_synthetic_transport(http_status=500, note="matrix-e")
            stored_e = collected_evidence("CORR5-MATRIX-E", 1) or {}
        finally:
            finish_attempt()
        owned = [
            item.get("scenario_id")
            for item in (stored_e.get("provider_evidence") or [])
            if isinstance(item, dict)
        ]
        if armed.get("accepted") is not True or "CORR5-MATRIX-E" not in owned:
            raise AssertionError({"accepted": armed.get("accepted"), "owned": owned})
    finally:
        loopback.stop()
        server.shutdown()
        server.server_close()
        if previous is None:
            os.environ.pop("ACADEMY_EXECUTION_PRELOAD_STATE", None)
        else:
            os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = previous
        try:
            finish_attempt()
        except Exception:
            pass
    UNIT["no_attempt_start_never_misattributed"] = True
    UNIT["stale_completion_visible"] = True


@test("CORR5.raw_attempt_store_redacts_secrets")
def raw_redaction() -> None:
    begin_attempt("CORR5-REDACT", 1, require_product=False)
    try:
        publish_generic_infra_failure({
            "source": "GENERIC",
            "note": SECRETS[0],
            "authorization": SECRETS[1],
            "detail": SECRETS[2] + " " + SECRETS[3],
            "host": "secret-host.example",
        })
        publish_timeout_evidence({
            "reason": SECRETS[0],
            "model": "sk-abcdefghijklmnopqrstuvwxyz",
            "thread": "worker-secret-timeout",
        })
        publish_lifecycle_report({
            "status": "LIFECYCLE_FAIL_CLOSED",
            "still_alive_tasks": ["task-secret-worker", "Bearer SUPERSECRETVALUE"],
            "still_alive_threads": ["thread-sb_secret_benchmark_placeholder"],
            "remaining_task_count": 2,
            "cancelled_error_contained": False,
            "fail_closed": True,
        })
        finish_attempt()
        stored = collected_evidence("CORR5-REDACT", 1) or {}
    finally:
        try:
            finish_attempt()
        except Exception:
            pass
    blob = json.dumps(stored, ensure_ascii=False, default=str)
    for secret in SECRETS:
        if secret in blob:
            raise AssertionError("secret survived raw attempt storage")
    if "secret-host.example" in blob or "task-secret-worker" in blob or "worker-secret-timeout" in blob:
        raise AssertionError("secret-shaped name survived raw attempt storage")
    generic = stored.get("generic_infra_failure") or []
    timeout = stored.get("timeout_evidence") or []
    lifecycle = stored.get("lifecycle") or {}
    if not generic or not timeout:
        raise AssertionError("redaction dropped the evidence records")
    if "still_alive_tasks" not in json.dumps(lifecycle):
        raise AssertionError("lifecycle names were dropped instead of redacted")
    UNIT["raw_generic_infra_redacted"] = True
    UNIT["raw_timeout_evidence_redacted"] = True
    UNIT["raw_lifecycle_names_redacted"] = True


@test("CORR5.symlink_dotdot_credential_bypass_is_closed")
def dotdot() -> None:
    from adapters.corr5_producers import MARKER, credential_dotdot_probe

    proof = credential_dotdot_probe()
    if proof.get("closed") is not True:
        raise AssertionError({
            "cases": proof.get("cases"),
            "safe_opened": proof.get("safe_opened"),
            "leaked_events": proof.get("leaked_events"),
        })
    if MARKER in json.dumps({key: value for key, value in proof.items() if key != "root"}):
        raise AssertionError("marker was copied into the probe result")
    UNIT["symlink_dotdot_closed"] = True


@test("CORR5.finalized_artifact_root_is_immutable")
def artifact_immutability() -> None:
    fresh = default_focused_output_root("academy-corr5-focused-")
    if not str(fresh).startswith(tempfile.gettempdir()) and "/var/folders/" not in str(fresh) and "/tmp/" not in str(fresh):
        raise AssertionError(fresh)
    refuse_persistent_artifact_root(fresh)
    claimed = Path(tempfile.mkdtemp(prefix="academy-corr5-claimed-"))
    (claimed / "IMPLEMENTATION_1_CORR5_MANIFEST.json").write_text("{}\n", encoding="utf-8")
    try:
        refuse_persistent_artifact_root(claimed)
        raise AssertionError("finalized root was writable")
    except PermissionError as exc:
        if "FINALIZED_ARTIFACT_ROOT_IMMUTABLE" not in str(exc):
            raise
    sidecar = Path(tempfile.mkdtemp(prefix="academy-corr5-sidecar-"))
    (sidecar / "IMPLEMENTATION_9_MANIFEST.sha256").write_text("abc\n", encoding="utf-8")
    try:
        refuse_persistent_artifact_root(sidecar)
        raise AssertionError("sidecar root was writable")
    except PermissionError as exc:
        if "FINALIZED_ARTIFACT_ROOT_IMMUTABLE" not in str(exc):
            raise
    nonempty = Path(tempfile.mkdtemp(prefix="academy-corr5-nonempty-"))
    (nonempty / "CORR4_UNIT_PROOF.json").write_text("{}\n", encoding="utf-8")
    try:
        refuse_persistent_artifact_root(nonempty)
        raise AssertionError("non-empty root was writable")
    except PermissionError as exc:
        if "FINALIZED_ARTIFACT_ROOT_IMMUTABLE" not in str(exc):
            raise
    copy = Path(tempfile.mkdtemp(prefix="academy-corr5-corr4-copy-"))
    for name in (
        "IMPLEMENTATION_1_CORR4_MANIFEST.json",
        "IMPLEMENTATION_1_CORR4_MANIFEST.sha256",
        "CORR4_UNIT_PROOF.json",
    ):
        shutil.copy2(CORR4_CANONICAL / name, copy / name)
    before = _sha(copy / "CORR4_UNIT_PROOF.json")
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["ACADEMY_CORR4_TOPOLOGY"] = "1"
    env["ACADEMY_CORR4_ARTIFACT_ROOT"] = str(copy)
    env.pop("ACADEMY_CORR5_TOPOLOGY", None)
    completed = subprocess.run(
        [sys.executable, "-B", "tests/execution_infrastructure_implementation_1_corr4.py"],
        cwd=str(BENCH),
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    after = _sha(copy / "CORR4_UNIT_PROOF.json")
    if before != after:
        raise AssertionError("CORR4 unit proof bytes changed")
    if completed.returncode == 0:
        raise AssertionError("documented CORR4 command overwrote a finalized root")
    if "FINALIZED_ARTIFACT_ROOT_IMMUTABLE" not in (completed.stdout + completed.stderr):
        raise AssertionError(completed.stdout[-500:] + completed.stderr[-500:])
    UNIT["finalized_artifact_root_immutable"] = True
    UNIT["focused_test_default_temp_only"] = True
    UNIT["corr4_rerun_refused"] = True
    UNIT["corr4_unit_proof_sha256"] = before


@test("CORR5.real_topology")
def real_topology() -> None:
    if os.environ.get("ACADEMY_CORR5_TOPOLOGY") != "1":
        UNIT["topology_skipped"] = True
        return
    from execution_infrastructure.corr5_topology import run_corr5_topology

    proof = run_corr5_topology()
    UNIT["topology"] = {
        "ok": proof.get("ok"),
        "reason": proof.get("reason"),
        "checks": proof.get("checks"),
        "proof_path": proof.get("proof_path"),
        "scenarios_executed": proof.get("scenarios_executed"),
    }
    if proof.get("ok") is not True:
        raise AssertionError(proof.get("reason") or proof.get("checks"))
    UNIT["topology_ok"] = True


def main() -> int:
    sys.dont_write_bytecode = True
    raw_root = os.environ.get("ACADEMY_CORR5_ARTIFACT_ROOT")
    if raw_root and os.environ.get("ACADEMY_CORR5_TOPOLOGY") != "1":
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
        "unit": UNIT,
        "results": [
            {"name": name, "pass": ok, "detail": detail}
            for name, ok, detail in RESULTS
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
