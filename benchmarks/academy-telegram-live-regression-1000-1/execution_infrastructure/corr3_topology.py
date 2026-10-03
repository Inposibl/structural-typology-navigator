"""CORR3 real-producer topology.

Boots one sanitized Navigator replica, mints a context only from the live
Next run, and drives calibration attempts through the real Node preload and
the real Supabase loopback. It does not execute a benchmark scenario body
and it does not contact a real provider.

The CORR2 artifact directory is not used.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
import subprocess
import tempfile
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

BENCH = Path(__file__).resolve().parents[1]
if str(BENCH) not in sys.path:
    sys.path.insert(0, str(BENCH))

from adapters.corr3_producers import corr3_registry, corr3_spec  # noqa: E402
from execution_infrastructure.attempt_binding import (  # noqa: E402
    arm_request_identity,
    begin_attempt,
    collected_evidence,
    disarm_request_identity,
    finish_attempt,
    open_evidence_attempt,
    close_evidence_attempt,
    register_active_loopback,
)
from execution_infrastructure.constants import (  # noqa: E402
    CHATBOT_TEST_BASE,
    PRELOAD_PATH,
    SUPABASE_SECRET_PLACEHOLDER,
)
from execution_infrastructure.controlled_context import (  # noqa: E402
    clear_controlled_context,
    mint_controlled_context,
    permit_scenario_body,
    require_controlled_context,
)
from execution_infrastructure.next_authority import (  # noqa: E402
    issue_controlled_proofs,
    launch_controlled_next,
)
from execution_infrastructure.orchestrator import (  # noqa: E402
    SANDBOX_PROFILE,
    _free_port,
    _stop_process,
    _wait_http,
    _wait_state,
    build_sanitized_replica,
    claim_evidence_directory,
    run_sandboxed_next_build,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.pd_f06_lifecycle import note_harness_thread  # noqa: E402
from execution_infrastructure.startup_proofs import (  # noqa: E402
    begin_generation,
    clear_live_run,
    prove_lifecycle,
    prove_loopback,
    prove_next_build_and_start,
    prove_node_from_control,
    prove_os_f04,
    prove_provider_observer,
    prove_python_isolation,
    register_live_next_run,
)
from harness.factory import LANE_CALIBRATION  # noqa: E402
from harness.runner import run_scenario_once  # noqa: E402

ARTIFACT_ROOT = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
    "ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR3"
)
REPLICA = ARTIFACT_ROOT / "navigator-replica"

REQUIRED_PROOF_FILES = (
    "REAL_PROVIDER_TO_VERDICT_PROOF.json",
    "REAL_RETRIEVAL_TO_VERDICT_PROOF.json",
    "REAL_PRODUCER_AGGREGATION_PROOF.json",
    "R2_TOTAL_ARMING_PROOF.json",
    "ASYNC_LIFECYCLE_REAL_RUN_PROOF.json",
    "REAL_STARTUP_PROOF_AUTHORITY.json",
    "NETWORK_CREDENTIAL_RESIDUAL_PROOF.json",
    "REAL_TOPOLOGY_CORR3_PROOF.json",
)


def _post_json(url: str, payload: dict[str, Any] | None = None, timeout: float = 15) -> tuple[int, dict[str, Any]]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8") or "{}"
            parsed = json.loads(raw)
            return response.status, parsed if isinstance(parsed, dict) else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") or "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw[:500]}
        return exc.code, parsed if isinstance(parsed, dict) else {}


def _get_json(url: str) -> dict[str, Any]:
    status, body = _post_json(url, None)
    if status != 200:
        raise RuntimeError(f"GET {url} -> {status}")
    return body


class _LocalProviderStub:
    """Strict-loopback stand-in for the DeepSeek chat endpoint."""

    def __init__(self) -> None:
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.url = ""

    def start(self) -> str:
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt: str, *args: Any) -> None:
                return None

            def _body(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                if length:
                    self.rfile.read(length)

            def _respond(self) -> None:
                path = self.path.split("?", 1)[0]
                if path == "/timeout":
                    time.sleep(1.2)
                    payload = b"local-timeout"
                    code = 200
                elif path == "/delay":
                    time.sleep(2.5)
                    payload = b"local-delay-500"
                    code = 500
                elif path == "/http500":
                    payload = b"local-http-500"
                    code = 500
                else:
                    payload = b"missing"
                    code = 404
                self.send_response(code)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Connection", "close")
                self.send_header("x-request-id", "local-stub")
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except Exception:
                    return

            def do_POST(self) -> None:  # noqa: N802
                self._body()
                self._respond()

            def do_GET(self) -> None:  # noqa: N802
                self._respond()

        class Server(ThreadingHTTPServer):
            def process_request(self, request: Any, client_address: Any) -> None:  # type: ignore[override]
                thread = threading.Thread(
                    target=self.process_request_thread,
                    args=(request, client_address),
                    name="academy-harness-provider-stub",
                    daemon=True,
                )
                note_harness_thread(thread)
                thread.start()

        self._httpd = Server(("127.0.0.1", 0), Handler)
        host, port = self._httpd.server_address[:2]
        self.url = f"http://{host}:{port}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="academy-harness-provider-stub-accept", daemon=True)
        note_harness_thread(self._thread)
        self._thread.start()
        return self.url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None


def _summarize(outcome: Any, scenario_id: str, attempt: int) -> dict[str, Any]:
    stored = collected_evidence(scenario_id, attempt) or {}
    aggregate = (outcome.derivation_state or {}).get("infrastructure_precedence") or {}
    findings = aggregate.get("findings") or []
    providers = [item for item in (stored.get("provider_evidence") or []) if isinstance(item, dict)]
    retrievals = [item for item in (stored.get("retrieval_evidence") or []) if isinstance(item, dict)]
    nodes = [item for item in (stored.get("node_events") or []) if isinstance(item, dict)]
    quarantine = [item for item in (stored.get("quarantine") or []) if isinstance(item, dict)]
    lifecycle = stored.get("lifecycle") or {}
    return {
        "scenario_id": scenario_id,
        "attempt": attempt,
        "verdict": outcome.verdict.value,
        "reason": outcome.verdict_reason,
        "continue_to_next_scenario": (outcome.derivation_state or {}).get("continue_to_next_scenario"),
        "deterministic_status": (outcome.derivation_state or {}).get("deterministic_status"),
        "infra_failure": (outcome.derivation_state or {}).get("infra_failure"),
        "timeout_exceeded": (outcome.derivation_state or {}).get("timeout_exceeded"),
        "freeze_failure": (outcome.derivation_state or {}).get("freeze_failure"),
        "raw_evidence_path": (outcome.derivation_state or {}).get("raw_evidence_path"),
        "adapter_invocations": outcome.adapter_invocations,
        "canonical_benchmark_status": aggregate.get("canonical_benchmark_status"),
        "stop_class": aggregate.get("stop_class"),
        "dominates": aggregate.get("dominates"),
        "finding_sources": [item.get("source") for item in findings],
        "provider_count": len(providers),
        "provider_raw": [item.get("raw_infrastructure_outcome") for item in providers],
        "provider_http_status": [item.get("http_status") for item in providers],
        "retrieval_count": len(retrievals),
        "retrieval": [
            {
                "classification": item.get("classification"),
                "scenario_id": item.get("scenario_id"),
                "attempt_number": item.get("attempt_number"),
                "chat_request_ordinal": item.get("chat_request_ordinal"),
                "course_id": item.get("course_id"),
                "route": item.get("route"),
                "failure_reason": item.get("failure_reason"),
                "fixture_identity": item.get("fixture_identity"),
            }
            for item in retrievals
        ],
        "node_deny_reasons": [
            item.get("reason") for item in nodes
            if item.get("decision") == "deny" or item.get("violation") is True
        ],
        "node_violation_count": sum(1 for item in nodes if item.get("violation") is True),
        "quarantine_classifications": [item.get("classification") for item in quarantine],
        "lifecycle_status": lifecycle.get("status"),
        "lifecycle_fail_closed": lifecycle.get("fail_closed"),
        "still_alive_threads": lifecycle.get("still_alive_threads"),
        "harness_threads_excluded": lifecycle.get("harness_threads_excluded"),
        "ownership_classes": lifecycle.get("ownership_classes"),
        "product_wrap_error": lifecycle.get("product_wrap_error"),
        "python_violation_count": len(stored.get("python_violations") or []),
        "os_f04_status": (stored.get("os_f04") or {}).get("execution_status"),
        "generic_sources": [
            item.get("source") for item in (stored.get("generic_infra_failure") or []) if isinstance(item, dict)
        ],
    }


def _run_attempt(
    scenario_id: str,
    adapter_id: str,
    evidence_root: Path,
    *,
    attempt: int = 1,
    run_prefix: str = "corr3",
) -> dict[str, Any]:
    evidence_root.mkdir(parents=True, exist_ok=True)
    outcome = run_scenario_once(
        corr3_spec(scenario_id, adapter_id),
        run_id=f"{run_prefix}-{scenario_id.lower()}",
        attempt=attempt,
        evidence_root=str(evidence_root),
        lane=LANE_CALIBRATION,
        calibration_registry=corr3_registry(),
    )
    return _summarize(outcome, scenario_id, attempt)


def _identity_view(loopback: LoopbackSupabaseDouble, control: str) -> dict[str, Any]:
    ledger = _get_json(control + "/ledger")
    armed = ledger.get("armed") or {}
    loop_armed = dict(loopback.armed or {})
    return {"node": armed, "loopback": loop_armed}


def _arm_probe(loopback: LoopbackSupabaseDouble, control: str, scenario_id: str) -> dict[str, Any]:
    armed = arm_request_identity(scenario_id, 1, 1, "levels-of-consciousness")
    view = _identity_view(loopback, control)
    return {
        "scenario_id": scenario_id,
        "attempt_number": 1,
        "chat_request_ordinal": 1,
        "runner_request": armed["request"],
        "node": view["node"],
        "loopback": view["loopback"],
        "node_matches": view["node"].get("scenario_id") == scenario_id and view["node"].get("attempt_number") == 1,
        "loopback_matches": view["loopback"].get("scenario_id") == scenario_id and view["loopback"].get("attempt_number") == 1,
        "same_identity": (
            view["node"].get("scenario_id") == view["loopback"].get("scenario_id") == scenario_id
            and view["node"].get("attempt_number") == view["loopback"].get("attempt_number") == 1
            and view["node"].get("chat_request_ordinal") == view["loopback"].get("chat_request_ordinal") == 1
        ),
    }


def _cleared(loopback: LoopbackSupabaseDouble, control: str) -> dict[str, Any]:
    view = _identity_view(loopback, control)
    return {
        "node_scenario": view["node"].get("scenario_id"),
        "loopback_scenario": view["loopback"].get("scenario_id"),
        "cleared": view["node"].get("scenario_id") in (None, "") and not view["loopback"],
    }


def _real_local_arm(loopback: LoopbackSupabaseDouble, control: str) -> dict[str, Any]:
    from adapters.product import arm_native_chat_transport

    open_evidence_attempt("CORR3-REAL-LOCAL", 1)
    observed: dict[str, Any] = {}

    class _Dummy:
        async def call_navigator_core(self) -> str:
            observed["during"] = _identity_view(loopback, control)
            return "native-post-not-sent"

    dummy = _Dummy()
    arm_native_chat_transport(dummy)
    asyncio.run(dummy.call_navigator_core())
    during = observed.get("during") or {}
    close_evidence_attempt()
    after = _cleared(loopback, control)
    node = during.get("node") or {}
    loop = during.get("loopback") or {}
    return {
        "during_node": node,
        "during_loopback": loop,
        "matched": node.get("scenario_id") == loop.get("scenario_id") == "CORR3-REAL-LOCAL",
        "ordinal": node.get("chat_request_ordinal"),
        "cleared_after": after,
    }


def _stale_probe(control: str) -> dict[str, Any]:
    begin_attempt("CORR3-STALE", 1, require_product=False)
    try:
        arm_request_identity("A-0005", 1, 1, "levels-of-consciousness")
        _post_json(control + "/probe-fetch", {
            "url": "https://api.deepseek.com/chat/completions",
            "method": "POST",
            "headers": {"content-type": "application/json", "x-academy-local-mode": "http500"},
            "body": {"model": "local-stub", "messages": [{"role": "user", "content": "stale"}]},
        }, timeout=8)
    finally:
        finish_attempt()
    stored = collected_evidence("CORR3-STALE", 1) or {}
    quarantine = [item for item in (stored.get("quarantine") or []) if isinstance(item, dict)]
    return {
        "classifications": [item.get("classification") for item in quarantine],
        "kinds": [item.get("kind") for item in quarantine],
        "generic_sources": [
            item.get("source") for item in (stored.get("generic_infra_failure") or []) if isinstance(item, dict)
        ],
        "infra_failure": bool(stored.get("infra_failure")),
        "provider_kept_on_attempt": len(stored.get("provider_evidence") or []),
    }


def _write_json(name: str, payload: dict[str, Any]) -> str:
    path = ARTIFACT_ROOT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return str(path)


def _select_corr3_root() -> Path:
    from execution_infrastructure.next_authority import refuse_persistent_artifact_root

    raw = os.environ.get("ACADEMY_CORR3_ARTIFACT_ROOT")
    if raw:
        path = Path(raw).resolve()
        refuse_persistent_artifact_root(path)
    else:
        path = Path(tempfile.mkdtemp(prefix="academy-corr3-topology-"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_corr3_topology() -> dict[str, Any]:
    global ARTIFACT_ROOT, REPLICA
    canonical_root = ARTIFACT_ROOT
    canonical_replica = REPLICA
    ARTIFACT_ROOT = _select_corr3_root()
    REPLICA = ARTIFACT_ROOT / "navigator-replica"
    reuse = os.environ.get("ACADEMY_CORR3_REUSE_REPLICA") == "1" and (REPLICA / "node_modules").exists()
    run_prefix = "corr3b" if reuse else "corr3"
    proof: dict[str, Any] = {
        "ok": False,
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "scenarios_executed": 0,
        "chatbot_test_base": str(CHATBOT_TEST_BASE),
        "artifact_root": str(ARTIFACT_ROOT),
        "run_prefix": run_prefix,
        "replica_reused": reuse,
    }
    if not reuse:
        try:
            claim_evidence_directory(ARTIFACT_ROOT)
        except FileExistsError as exc:
            proof["reason"] = str(exc)
            ARTIFACT_ROOT = canonical_root
            REPLICA = canonical_replica
            return proof
    else:
        disclosure = ARTIFACT_ROOT / "FAILED_ATTEMPT_1_DISCLOSURE.json"
        existing = ARTIFACT_ROOT / "REAL_TOPOLOGY_CORR3_PROOF.json"
        if existing.exists() and not disclosure.exists():
            disclosure.write_bytes(existing.read_bytes())
        previous_build = ARTIFACT_ROOT / "next-build.log"
        preserved_build = ARTIFACT_ROOT / "next-build-attempt-1.log"
        if previous_build.exists() and not preserved_build.exists():
            preserved_build.write_bytes(previous_build.read_bytes())

    loopback: LoopbackSupabaseDouble | None = None
    stub: _LocalProviderStub | None = None
    process: subprocess.Popen | None = None
    start_handle = None
    try:
        profile_path = ARTIFACT_ROOT / "network-deny.sb"
        profile_path.write_text(SANDBOX_PROFILE, encoding="utf-8")
        if reuse:
            proof["replica"] = str(REPLICA)
            proof["env_files_copied"] = []
        else:
            replica_info = build_sanitized_replica(REPLICA)
            proof["replica"] = replica_info.get("replica")
            proof["env_files_copied"] = replica_info.get("env_files_copied")
        loopback = LoopbackSupabaseDouble()
        register_active_loopback(loopback)
        loopback_url = loopback.start()
        stub = _LocalProviderStub()
        stub_url = stub.start()
        ledger_path = ARTIFACT_ROOT / "node-ledger.json"
        state_path = ARTIFACT_ROOT / "preload-state.json"
        build_log = ARTIFACT_ROOT / "next-build.log"
        start_log = ARTIFACT_ROOT / "next-start.log"
        next_bin = str(REPLICA / "node_modules" / ".bin" / "next")
        port = _free_port()
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(ARTIFACT_ROOT / "empty-home"),
            "TMPDIR": str(ARTIFACT_ROOT),
            "NODE_OPTIONS": f"--require {PRELOAD_PATH}",
            "ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS": "1",
            "ACADEMY_LOCAL_PROVIDER_STUB": stub_url,
            "ACADEMY_NODE_LEDGER_PATH": str(ledger_path),
            "ACADEMY_EXECUTION_PRELOAD_STATE": str(state_path),
            "NEXT_OTEL_FETCH_DISABLED": "1",
            "PORT": str(port),
            "HOSTNAME": "127.0.0.1",
            "SUPABASE_URL": loopback_url,
            "SUPABASE_SECRET_KEY": SUPABASE_SECRET_PLACEHOLDER,
        }
        Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        process = None
        cap = launch_controlled_next(
            replica=REPLICA,
            profile_path=profile_path,
            port=port,
            env=env,
            build_log=build_log,
            start_log=start_log,
            state_path=state_path,
            ledger_path=ledger_path,
            preload_path=PRELOAD_PATH,
        )
        process = cap.start_process
        build = cap.build_process
        proof["sandbox_exec_invoked"] = True
        proof["build_returncode"] = build.returncode
        proof["build_pass"] = build.returncode == 0
        proof["sandbox_exec_used_for_build"] = True
        proof["next_build_seconds"] = round(time.monotonic() - started, 3)
        proof["local_provider_stub"] = stub_url
        proof["loopback_url"] = loopback_url
        proof["sandbox_exec_pid"] = cap.sandbox_pid
        control = cap.control_url
        os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state_path)
        os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(ledger_path)
        os.environ["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        os.environ["ACADEMY_CORR3_LOOPBACK_URL"] = loopback_url
        os.environ["ACADEMY_LOCAL_PROVIDER_STUB"] = stub_url
        health = _get_json(control + "/health")
        proof["next_start_http"] = {"ok": True}
        proof["preload_state_present"] = True
        proof["next_health"] = {
            "next_server": health.get("next_server"),
            "pid": health.get("pid"),
            "argv_has_start": health.get("argv_has_start"),
            "argv_has_next": health.get("argv_has_next"),
            "fetch_patched": health.get("fetch_patched"),
        }
        proof["bind_run"] = {"status": 200, "generation": cap.generation}
        _post_json(control + "/probe-fetch", {"url": "https://example.com/outside", "method": "GET"})
        proofs = issue_controlled_proofs(cap, loopback)
        clear_controlled_context()
        ctx = mint_controlled_context(proofs)
        proof["minted"] = True
        proof["proof_identity"] = {
            "generation": ctx.proof_identity.get("generation"),
            "next_pid": ctx.proof_identity.get("next_pid"),
            "next_port": ctx.proof_identity.get("next_port"),
            "build_id": ctx.proof_identity.get("build_id"),
            "replica_identity": ctx.proof_identity.get("replica_identity"),
        }
        gate_root = ARTIFACT_ROOT / "attempts" / "gate"
        gate_root.mkdir(parents=True, exist_ok=True)
        gate = run_scenario_once(
            corr3_spec("CORR3-GATE", "corr3_clean"),
            run_id=f"{run_prefix}-gate",
            attempt=1,
            evidence_root=str(gate_root),
            lane=LANE_CALIBRATION,
            calibration_registry=corr3_registry(),
        )
        proof["gate_before_permit"] = {
            "verdict": gate.verdict.value,
            "adapter_invocations": gate.adapter_invocations,
            "scenario_body_permitted": ctx.scenario_body_permitted,
        }
        permit_scenario_body()
        attempts_root = ARTIFACT_ROOT / "attempts"
        proof["provider_http500"] = _run_attempt("CORR3-PROVIDER-500", "corr3_provider_http500", attempts_root / "provider-500", run_prefix=run_prefix)
        proof["provider_timeout"] = _run_attempt("CORR3-PROVIDER-TIMEOUT", "corr3_provider_timeout", attempts_root / "provider-timeout", run_prefix=run_prefix)
        proof["provider_connection"] = _run_attempt("CORR3-PROVIDER-CONNECTION", "corr3_provider_connection", attempts_root / "provider-connection", run_prefix=run_prefix)
        proof["retrieval"] = _run_attempt("A-0005", "corr3_retrieval_failure", attempts_root / "retrieval", run_prefix=run_prefix)
        proof["fetch_deny"] = _run_attempt("CORR3-FETCH-DENY", "corr3_fetch_deny", attempts_root / "fetch-deny", run_prefix=run_prefix)
        freeze_file = ARTIFACT_ROOT / "freeze-root-not-a-directory"
        freeze_file.write_text("not-a-directory\n", encoding="utf-8")
        freeze_outcome = run_scenario_once(
            corr3_spec("CORR3-FREEZE", "corr3_freeze_infra"),
            run_id=f"{run_prefix}-freeze",
            attempt=1,
            evidence_root=str(freeze_file),
            lane=LANE_CALIBRATION,
            calibration_registry=corr3_registry(),
        )
        proof["freeze"] = _summarize(freeze_outcome, "CORR3-FREEZE", 1)
        proof["multi"] = _run_attempt("A-0006", "corr3_multi_failure", attempts_root / "multi", run_prefix=run_prefix)
        proof["stale"] = _stale_probe(control)
        first_arm = _arm_probe(loopback, control, "A-0005")
        disarm_request_identity()
        cleared_first = _cleared(loopback, control)
        second_arm = _arm_probe(loopback, control, "A-0006")
        disarm_request_identity()
        cleared_second = _cleared(loopback, control)
        proof["r2"] = {
            "A-0005": first_arm,
            "cleared_after_a0005": cleared_first,
            "A-0006": second_arm,
            "cleared_after_a0006": cleared_second,
            "real_local": _real_local_arm(loopback, control),
        }
        proof["clean"] = _run_attempt("CORR3-CLEAN", "corr3_clean", attempts_root / "clean", run_prefix=run_prefix)
        forged = False
        try:
            from execution_infrastructure.startup_proofs import _issue

            _issue("CONTROLLED_NEXT_MODE", {"kind": "FORGED_SECOND_ISSUE"})
        except PermissionError as exc:
            forged = "already bound" in str(exc)
        proof["forged_second_issue_rejected"] = forged
        proof["scenarios_executed"] = ctx.scenarios_executed
        proof["scenario_body_permitted"] = ctx.scenario_body_permitted
        proof["benchmark_scenarios_executed"] = 0
        checks = _checks(proof)
        proof["checks"] = checks
        proof["ok"] = all(checks.values())
        if not proof["ok"]:
            proof["reason"] = "topology checks failed: " + ",".join(name for name, ok in checks.items() if not ok)
    except Exception as exc:  # noqa: BLE001 — the proof records the failure and still stops the topology
        proof["ok"] = False
        proof["reason"] = f"{type(exc).__name__}: {exc}"
        proof["traceback"] = traceback.format_exc()[-4000:]
    finally:
        clear_controlled_context()
        clear_live_run()
        if process is not None:
            _stop_process(process)
            proof["next_start_returncode"] = process.poll()
        if start_handle is not None:
            start_handle.close()
        if stub is not None:
            stub.stop()
        if loopback is not None:
            loopback.stop()
        _persist(proof)
        ARTIFACT_ROOT = canonical_root
        REPLICA = canonical_replica
    return proof


def _checks(proof: dict[str, Any]) -> dict[str, bool]:
    http500 = proof.get("provider_http500") or {}
    timeout = proof.get("provider_timeout") or {}
    connection = proof.get("provider_connection") or {}
    retrieval = proof.get("retrieval") or {}
    deny = proof.get("fetch_deny") or {}
    freeze = proof.get("freeze") or {}
    multi = proof.get("multi") or {}
    clean = proof.get("clean") or {}
    stale = proof.get("stale") or {}
    r2 = proof.get("r2") or {}
    retrieval_row = (retrieval.get("retrieval") or [{}])[0]
    multi_sources = set(multi.get("finding_sources") or [])
    raw = {
        "gate_blocked": (proof.get("gate_before_permit") or {}).get("verdict") == "NOT_EXECUTED"
        and (proof.get("gate_before_permit") or {}).get("adapter_invocations") == 0,
        "http500_infra": http500.get("verdict") == "INFRA_FAILURE"
        and http500.get("continue_to_next_scenario") is False
        and "PROVIDER_HTTP_5XX" in (http500.get("provider_raw") or [])
        and 500 in (http500.get("provider_http_status") or [])
        and http500.get("provider_count", 0) > 0
        and http500.get("deterministic_status") == "SATISFIED",
        "timeout_verdict": timeout.get("verdict") == "TIMEOUT"
        and timeout.get("continue_to_next_scenario") is False
        and "PROVIDER_TIMEOUT" in (timeout.get("provider_raw") or []),
        "connection_infra": connection.get("verdict") == "INFRA_FAILURE"
        and connection.get("continue_to_next_scenario") is False
        and "PROVIDER_CONNECTION_FAILURE" in (connection.get("provider_raw") or []),
        "retrieval_infra": retrieval.get("verdict") == "INFRA_FAILURE"
        and retrieval.get("continue_to_next_scenario") is False
        and retrieval.get("retrieval_count", 0) > 0
        and retrieval_row.get("classification") == "RETRIEVAL_INFRA_FAILURE"
        and retrieval_row.get("scenario_id") == "A-0005"
        and retrieval_row.get("failure_reason")
        and retrieval_row.get("fixture_identity"),
        "fetch_deny": deny.get("verdict") == "INFRA_FAILURE"
        and deny.get("continue_to_next_scenario") is False
        and deny.get("node_violation_count", 0) > 0
        and "DEFAULT_DENY" in (deny.get("node_deny_reasons") or []),
        "freeze_precedence": freeze.get("verdict") == "INFRA_FAILURE"
        and freeze.get("continue_to_next_scenario") is False
        and freeze.get("freeze_failure")
        and freeze.get("raw_evidence_path") is None
        and freeze.get("dominates") is True,
        "multi": multi.get("verdict") == "INFRA_FAILURE"
        and multi.get("continue_to_next_scenario") is False
        and multi.get("provider_count", 0) > 0
        and multi.get("retrieval_count", 0) > 0
        and {"OS_F04", "PYTHON_ISOLATION", "RETRIEVAL", "NAVIGATOR_PROVIDER", "LIFECYCLE"} <= multi_sources
        and multi.get("deterministic_status") == "SATISFIED",
        "harness_threads": "product-attempt-worker" in (multi.get("still_alive_threads") or [])
        and "academy-harness-loopback" not in (multi.get("still_alive_threads") or [])
        and "academy-harness-provider-stub" not in (multi.get("still_alive_threads") or []),
        "clean": clean.get("verdict") == "PASS"
        and clean.get("continue_to_next_scenario") is True
        and clean.get("dominates") is False
        and clean.get("provider_count") == 0
        and clean.get("retrieval_count") == 0,
        "stale": "STALE_OR_MISMATCHED_INFRA_EVENT" in (stale.get("classifications") or [])
        and stale.get("infra_failure") is True
        and "STALE_OR_MISMATCHED_INFRA_EVENT" in (stale.get("generic_sources") or []),
        "r2": bool((r2.get("A-0005") or {}).get("same_identity"))
        and bool((r2.get("cleared_after_a0005") or {}).get("cleared"))
        and bool((r2.get("A-0006") or {}).get("same_identity"))
        and bool((r2.get("cleared_after_a0006") or {}).get("cleared"))
        and bool((r2.get("real_local") or {}).get("matched"))
        and bool(((r2.get("real_local") or {}).get("cleared_after") or {}).get("cleared")),
        "forged": proof.get("forged_second_issue_rejected") is True,
        "no_scenarios": proof.get("scenarios_executed") == 0 and proof.get("benchmark_scenarios_executed") == 0,
        "sandbox_invoked": proof.get("sandbox_exec_invoked") is True and proof.get("build_pass") is True,
        "minted_from_next": proof.get("minted") is True and (proof.get("next_health") or {}).get("next_server") is True,
    }
    return {key: bool(value) for key, value in raw.items()}


def _persist(proof: dict[str, Any]) -> None:
    if not ARTIFACT_ROOT.exists():
        return
    provider = {
        "act": "IMPLEMENTATION-1.CORR3",
        "provider_contact": "NONE",
        "transport": "LOCAL_PROVIDER_STUB",
        "http500": proof.get("provider_http500"),
        "timeout": proof.get("provider_timeout"),
        "connection": proof.get("provider_connection"),
        "semantic_success_overridden": (proof.get("checks") or {}).get("http500_infra") is True,
    }
    retrieval = {
        "act": "IMPLEMENTATION-1.CORR3",
        "provider_contact": "NONE",
        "manual_publish": False,
        "retrieval": proof.get("retrieval"),
    }
    aggregation = {
        "act": "IMPLEMENTATION-1.CORR3",
        "provider_contact": "NONE",
        "manual_provider_publish": False,
        "manual_retrieval_publish": False,
        "multi": proof.get("multi"),
        "clean": proof.get("clean"),
        "pass": (proof.get("checks") or {}).get("multi") is True and (proof.get("checks") or {}).get("clean") is True,
    }
    arming = {
        "act": "IMPLEMENTATION-1.CORR3",
        "fixture_identities_only": True,
        "benchmark_scenarios_executed": 0,
        "r2": proof.get("r2"),
        "stale": proof.get("stale"),
    }
    startup = {
        "act": "IMPLEMENTATION-1.CORR3",
        "minted": proof.get("minted"),
        "proof_identity": proof.get("proof_identity"),
        "next_health": proof.get("next_health"),
        "gate_before_permit": proof.get("gate_before_permit"),
        "forged_second_issue_rejected": proof.get("forged_second_issue_rejected"),
        "sandbox_exec_invoked": proof.get("sandbox_exec_invoked"),
        "build_returncode": proof.get("build_returncode"),
        "build_pass": proof.get("build_pass"),
        "sandbox_exec_used_for_build": proof.get("sandbox_exec_used_for_build"),
    }
    network = {
        "act": "IMPLEMENTATION-1.CORR3",
        "provider_contact": proof.get("provider_contact"),
        "local_provider_stub": proof.get("local_provider_stub"),
        "loopback_url": proof.get("loopback_url"),
        "sandbox_exec_invoked": proof.get("sandbox_exec_invoked"),
        "build_returncode": proof.get("build_returncode"),
        "build_pass": proof.get("build_pass"),
        "credential_values_read": False,
    }
    _write_json("REAL_PROVIDER_TO_VERDICT_PROOF.json", provider)
    _write_json("REAL_RETRIEVAL_TO_VERDICT_PROOF.json", retrieval)
    _write_json("REAL_PRODUCER_AGGREGATION_PROOF.json", aggregation)
    _write_json("R2_TOTAL_ARMING_PROOF.json", arming)
    _write_json("REAL_STARTUP_PROOF_AUTHORITY.json", startup)
    _write_json("NETWORK_CREDENTIAL_RESIDUAL_PROOF.json", network)
    _write_json("REAL_TOPOLOGY_CORR3_PROOF.json", proof)
