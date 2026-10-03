"""CORR5 fresh real topology.

One new sanitized Navigator replica. The CORR4 replica is not reused.
Context is minted only after the trusted Next runtime attestation, the
sandboxed build and start, process ownership, and the live sentinel.
No benchmark scenario body and no real provider contact.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
import traceback
from pathlib import Path
from typing import Any

BENCH = Path(__file__).resolve().parents[1]
if str(BENCH) not in sys.path:
    sys.path.insert(0, str(BENCH))

from adapters.corr4_producers import TEN_SECOND  # noqa: E402
from adapters.corr5_producers import corr5_registry, credential_dotdot_probe  # noqa: E402
from execution_infrastructure.attempt_binding import (  # noqa: E402
    _QUARANTINE,
    begin_attempt,
    collected_evidence,
    finish_attempt,
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
)
from execution_infrastructure.corr3_topology import (  # noqa: E402
    _LocalProviderStub,
    _get_json,
    _post_json,
    _summarize,
)
from execution_infrastructure.corr4_topology import _run, _stale_during_b  # noqa: E402
from execution_infrastructure.next_authority import (  # noqa: E402
    finalized_artifact_root,
    issue_controlled_proofs,
    launch_controlled_next,
    refuse_persistent_artifact_root,
)
from execution_infrastructure.next_runtime_identity import attest_replica_next_runtime  # noqa: E402
from execution_infrastructure.orchestrator import (  # noqa: E402
    SANDBOX_PROFILE,
    _free_port,
    _probe_chain,
    _stop_process,
    build_sanitized_replica,
    claim_evidence_directory,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.pd_f06_lifecycle import note_harness_thread  # noqa: E402
from execution_infrastructure.startup_proofs import clear_live_run  # noqa: E402

NAVIGATOR_TEST_ROOT = (
    "/Users/entp_psyche/Desktop/InvestProjects2026/"
    "test-bases/ACADEMY_TELEGRAM_LIVE_REGRESSION_1000_1/navigator"
)


def _select_root() -> Path:
    raw = os.environ.get("ACADEMY_CORR5_ARTIFACT_ROOT")
    if raw:
        path = Path(raw).resolve()
        refuse_persistent_artifact_root(path)
    else:
        path = Path(tempfile.mkdtemp(prefix="academy-corr5-topology-"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _no_attempt_during_b(control: str) -> dict[str, Any]:
    """A request that starts with no attempt must stay process-level during B."""
    before = len(_QUARANTINE)
    holder: dict[str, Any] = {}

    def fire() -> None:
        try:
            holder["body"] = _post_json(control + "/probe-fetch", {
                "url": "https://api.deepseek.com/chat/completions",
                "method": "POST",
                "headers": {
                    "content-type": "application/json",
                    "x-academy-local-mode": "delay",
                },
                "body": {"model": "local-stub", "messages": [{"role": "user", "content": "no-attempt"}]},
            }, timeout=8)
        except Exception as exc:  # noqa: BLE001 — the ledger is the record
            holder["error"] = f"{type(exc).__name__}: {exc}"

    thread = threading.Thread(target=fire, name="academy-harness-no-attempt-start", daemon=False)
    note_harness_thread(thread)
    thread.start()
    time.sleep(0.4)
    begin_attempt("CORR5-NOATTEMPT-B", 1, require_product=False)
    try:
        thread.join(timeout=8)
    finally:
        finish_attempt()
    stored = collected_evidence("CORR5-NOATTEMPT-B", 1) or {}
    quarantine = [item for item in (stored.get("quarantine") or []) if isinstance(item, dict)]
    misattributed = [
        item for item in quarantine
        if (item.get("record") or {}).get("request_start_classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"
        or (
            item.get("classification") == "UNARMED_INFRA_EVENT"
            and (item.get("record") or {}).get("request_start_classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"
        )
    ]
    process = [
        item for item in _QUARANTINE[before:]
        if item.get("classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"
    ]
    providers = [
        item for item in (stored.get("provider_evidence") or [])
        if isinstance(item, dict)
        and item.get("request_start_classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"
    ]
    return {
        "process_level": bool(process),
        "misattributed_to_b": bool(misattributed or providers),
        "joined": not thread.is_alive(),
        "error": holder.get("error"),
    }


def _checks(proof: dict[str, Any]) -> dict[str, bool]:
    attestation = proof.get("runtime_attestation") or {}
    identity = proof.get("next_runtime_identity") or {}
    clean = proof.get("clean") or {}
    http500 = proof.get("armed_http500") or {}
    retrieval = proof.get("armed_retrieval") or {}
    deny = proof.get("unarmed_deny") or {}
    stale = proof.get("stale") or {}
    no_attempt = proof.get("no_attempt_start") or {}
    async_row = proof.get("async_10s") or {}
    cancelled = proof.get("cancelled") or {}
    probe = proof.get("a0005") or {}
    dotdot = proof.get("credential_dotdot") or {}
    retrieval_row = (retrieval.get("retrieval") or [{}])[0]
    raw = {
        "trusted_runtime": attestation.get("ok") is True
        and attestation.get("classification") == "TRUSTED_NEXT_RUNTIME"
        and identity.get("classification") == "TRUSTED_NEXT_RUNTIME"
        and attestation.get("origin_is_replica") is False,
        "minted": proof.get("minted") is True and (proof.get("next_health") or {}).get("next_server") is True,
        "build_controlled": proof.get("build_pass") is True and proof.get("build_marker") not in ("", None),
        "clean_pass": clean.get("verdict") == "PASS" and clean.get("continue_to_next_scenario") is True,
        "armed_http500": http500.get("verdict") == "INFRA_FAILURE"
        and "PROVIDER_HTTP_5XX" in (http500.get("provider_raw") or [])
        and http500.get("continue_to_next_scenario") is False,
        "armed_retrieval": retrieval.get("verdict") == "INFRA_FAILURE"
        and retrieval_row.get("classification") == "RETRIEVAL_INFRA_FAILURE"
        and retrieval.get("continue_to_next_scenario") is False,
        "unarmed_deny": deny.get("verdict") == "INFRA_FAILURE"
        and "UNARMED_INFRA_EVENT" in (deny.get("quarantine_classifications") or []),
        "no_attempt_not_b": no_attempt.get("process_level") is True
        and no_attempt.get("misattributed_to_b") is False
        and no_attempt.get("joined") is True,
        "stale_visible": stale.get("visible_stale") is True
        and stale.get("b_not_stamped_with_a_as_own") is True
        and "CORR4-STALE-A" in (stale.get("stale_scenario_ids") or []),
        "bound_10s": float((async_row.get("ten_second") or {}).get("elapsed_s") or 0) >= 9.0
        and async_row.get("cancelled_error_contained") is not True
        and async_row.get("verdict") not in (None, "")
        and (async_row.get("ten_second") or {}).get("capture_error") in (None, ""),
        "cancelled_reaches_verdict": cancelled.get("verdict") in ("INFRA_FAILURE", "TIMEOUT")
        and cancelled.get("cancelled_error_contained") is True
        and cancelled.get("continue_to_next_scenario") is False,
        "a0005": probe.get("vector_sha_equal") is True and probe.get("scenario_id") == "A-0005",
        "dotdot_closed": dotdot.get("closed") is True,
        "no_scenarios": proof.get("scenarios_executed") == 0,
        "provider_contact_none": proof.get("provider_contact") == "NONE",
    }
    return {key: bool(value) for key, value in raw.items()}


def run_corr5_topology() -> dict[str, Any]:
    root = _select_root()
    replica = root / "navigator-replica"
    proof: dict[str, Any] = {
        "ok": False,
        "act": "IMPLEMENTATION-1.CORR5",
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "scenarios_executed": 0,
        "chatbot_test_base": str(CHATBOT_TEST_BASE),
        "artifact_root": str(root),
        "replica_reused_from_corr4": False,
    }
    loopback: LoopbackSupabaseDouble | None = None
    stub: _LocalProviderStub | None = None
    process = None
    claimed = False
    saved_env = {
        key: os.environ.get(key)
        for key in ("NAVIGATOR_TEST_ROOT", "TIKHON_TEST_ROOT")
    }
    os.environ["NAVIGATOR_TEST_ROOT"] = NAVIGATOR_TEST_ROOT
    os.environ["TIKHON_TEST_ROOT"] = str(CHATBOT_TEST_BASE)
    try:
        try:
            claim_evidence_directory(root)
            claimed = True
        except FileExistsError as exc:
            proof["reason"] = str(exc)
            return proof
        profile_path = root / "network-deny.sb"
        profile_path.write_text(SANDBOX_PROFILE, encoding="utf-8")
        replica_info = build_sanitized_replica(replica)
        proof["replica"] = replica_info.get("replica")
        proof["env_files_copied"] = replica_info.get("env_files_copied")
        attestation = attest_replica_next_runtime(replica)
        proof["runtime_attestation"] = {
            "ok": attestation.get("ok"),
            "classification": attestation.get("classification"),
            "authority": attestation.get("authority"),
            "origin_root": attestation.get("origin_root"),
            "replica_root": attestation.get("replica_root"),
            "origin_is_replica": attestation.get("origin_is_replica"),
            "next_version": attestation.get("next_version"),
            "file_count": attestation.get("file_count"),
            "identity_sha256": attestation.get("identity_sha256"),
            "mismatch_count": attestation.get("mismatch_count"),
            "mismatches": attestation.get("mismatches"),
        }
        if attestation.get("ok") is not True:
            proof["reason"] = "NEXT_RUNTIME_IDENTITY_MISMATCH"
            return proof
        loopback = LoopbackSupabaseDouble()
        from execution_infrastructure.attempt_binding import register_active_loopback

        register_active_loopback(loopback)
        loopback_url = loopback.start()
        stub = _LocalProviderStub()
        stub_url = stub.start()
        ledger_path = root / "node-ledger.json"
        state_path = root / "preload-state.json"
        port = _free_port()
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(root / "empty-home"),
            "TMPDIR": str(root),
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
        cap = launch_controlled_next(
            replica=replica,
            profile_path=profile_path,
            port=port,
            env=env,
            build_log=root / "next-build.log",
            start_log=root / "next-start.log",
            state_path=state_path,
            ledger_path=ledger_path,
            preload_path=PRELOAD_PATH,
        )
        process = cap.start_process
        proof["build_returncode"] = cap.build_process.returncode if cap.build_process else None
        proof["build_pass"] = bool(cap.build_process and cap.build_process.returncode == 0)
        proof["build_marker"] = cap.build_marker
        proof["next_build_seconds"] = round(time.monotonic() - started, 3)
        proof["capability_id"] = cap.capability_id
        proof["node_pid"] = cap.node_pid
        proof["build_id"] = cap.build_id
        proof["next_runtime_attested"] = cap.next_runtime_attested
        proof["next_runtime_identity"] = dict(cap.next_runtime_identity)
        os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state_path)
        os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(ledger_path)
        os.environ["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        os.environ["ACADEMY_CORR4_LOOPBACK_URL"] = loopback_url
        os.environ["ACADEMY_LOCAL_PROVIDER_STUB"] = stub_url
        health = _get_json(cap.control_url + "/health")
        proof["next_health"] = {
            "next_server": health.get("next_server"),
            "pid": health.get("pid"),
            "argv_has_start": health.get("argv_has_start"),
            "fetch_patched": health.get("fetch_patched"),
        }
        proofs = issue_controlled_proofs(cap, loopback)
        clear_controlled_context()
        ctx = mint_controlled_context(proofs)
        proof["minted"] = True
        proof["preload_instance_id"] = cap.preload_instance_id
        proof["ledger_instance_id"] = cap.ledger_instance_id
        permit_scenario_body()
        attempts = root / "attempts"
        registry = corr5_registry()
        proof["clean"] = _run("CORR5-CLEAN", "corr4_clean", attempts / "clean", registry=registry)
        proof["armed_http500"] = _run(
            "CORR5-ARMED-500", "corr4_armed_http500", attempts / "armed-500", registry=registry,
        )
        proof["armed_retrieval"] = _run(
            "CORR5-ARMED-RETRIEVAL", "corr4_armed_retrieval", attempts / "retrieval", registry=registry,
        )
        proof["unarmed_deny"] = _run(
            "CORR5-UNARMED-DENY", "corr4_unarmed_deny", attempts / "unarmed-deny", registry=registry,
        )
        proof["no_attempt_start"] = _no_attempt_during_b(cap.control_url)
        proof["stale"] = _stale_during_b(cap.control_url, attempts)
        proof["async_10s"] = _run(
            "CORR5-ASYNC-10S",
            "corr4_ten_second",
            attempts / "async-10s",
            wall_budget_s=180.0,
            registry=registry,
        )
        proof["async_10s"]["ten_second"] = dict(TEN_SECOND)
        proof["cancelled"] = _run(
            "CORR5-CANCELLED",
            "corr5_internal_cancel",
            attempts / "cancelled",
            registry=registry,
        )
        proof["a0005"] = _probe_chain(cap.control_url, loopback_url, "A-0005")
        dotdot = credential_dotdot_probe(root / "credential-dotdot-probe")
        proof["credential_dotdot"] = {
            "closed": dotdot.get("closed"),
            "safe_opened": dotdot.get("safe_opened"),
            "safe_classified": dotdot.get("safe_classified"),
            "leaked_events": dotdot.get("leaked_events"),
            "cases": dotdot.get("cases"),
        }
        proof["scenarios_executed"] = ctx.scenarios_executed
        proof["scenario_body_permitted"] = ctx.scenario_body_permitted
        checks = _checks(proof)
        proof["checks"] = checks
        proof["ok"] = all(checks.values())
        if not proof["ok"]:
            proof["reason"] = "topology checks failed: " + ",".join(
                name for name, ok in checks.items() if not ok
            )
    except Exception as exc:  # noqa: BLE001 — record the failure and still stop the process
        proof["ok"] = False
        proof["reason"] = f"{type(exc).__name__}: {exc}"
        proof["traceback"] = traceback.format_exc()[-4000:]
    finally:
        clear_controlled_context()
        clear_live_run()
        if process is not None:
            _stop_process(process)
        if stub is not None:
            stub.stop()
        if loopback is not None:
            loopback.stop()
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        if claimed and not finalized_artifact_root(root):
            target = root / "REAL_TOPOLOGY_CORR5_PROOF.json"
            if not target.exists():
                import json

                target.write_text(
                    json.dumps(proof, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                proof["proof_path"] = str(target)
    return proof
