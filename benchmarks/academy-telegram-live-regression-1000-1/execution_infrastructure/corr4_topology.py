"""CORR4 real topology.

One sanitized Navigator replica. Context is minted only from the
orchestrator-owned Next process. No benchmark scenario body and no real
provider contact.
"""

from __future__ import annotations

import json
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

from adapters.corr4_producers import (  # noqa: E402
    TEN_SECOND,
    StaleWindowAdapter,
    corr4_registry,
    corr4_spec,
)
from execution_infrastructure.attempt_binding import (  # noqa: E402
    arm_request_identity,
    begin_attempt,
    collected_evidence,
    finish_attempt,
)
from execution_infrastructure.pd_f06_lifecycle import note_harness_thread  # noqa: E402
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
from execution_infrastructure.next_authority import (  # noqa: E402
    finalized_artifact_root,
    issue_controlled_proofs,
    launch_controlled_next,
    refuse_persistent_artifact_root,
)
from execution_infrastructure.orchestrator import (  # noqa: E402
    SANDBOX_PROFILE,
    _free_port,
    _stop_process,
    build_sanitized_replica,
    claim_evidence_directory,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.startup_proofs import clear_live_run  # noqa: E402
from harness.factory import LANE_CALIBRATION  # noqa: E402
from harness.runner import run_scenario_once  # noqa: E402


def _select_root() -> Path:
    raw = os.environ.get("ACADEMY_CORR4_ARTIFACT_ROOT")
    if raw:
        path = Path(raw).resolve()
        refuse_persistent_artifact_root(path)
    else:
        path = Path(tempfile.mkdtemp(prefix="academy-corr4-topology-"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _run(
    scenario_id: str,
    adapter_id: str,
    root: Path,
    *,
    wall_budget_s: float = 60.0,
    registry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    root.mkdir(parents=True, exist_ok=True)
    outcome = run_scenario_once(
        corr4_spec(scenario_id, adapter_id),
        run_id=f"corr4-{scenario_id.lower()}",
        attempt=1,
        evidence_root=str(root),
        lane=LANE_CALIBRATION,
        calibration_registry=registry or corr4_registry(),
        wall_budget_s=wall_budget_s,
    )
    summary = _summarize(outcome, scenario_id, 1)
    summary["cancelled_error_contained"] = bool((outcome.derivation_state or {}).get("cancelled_error_contained"))
    return summary


def _stale_during_b(control: str, attempts: Path) -> dict[str, Any]:
    """Start a delayed provider call as attempt A. Complete it during B."""
    begin_attempt("CORR4-STALE-A", 1, require_product=False)
    try:
        arm_request_identity("CORR4-STALE-A", 1, 1, "levels-of-consciousness")
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
                    "body": {"model": "local-stub", "messages": [{"role": "user", "content": "stale-a"}]},
                }, timeout=8)
            except Exception as exc:  # noqa: BLE001 — the attempt evidence is the record
                holder["error"] = f"{type(exc).__name__}: {exc}"

        thread = threading.Thread(target=fire, name="academy-harness-stale-a-request", daemon=False)
        note_harness_thread(thread)
        StaleWindowAdapter.holder = {"thread": thread}
        thread.start()
        time.sleep(0.5)
    finally:
        finish_attempt()
    stored_a = collected_evidence("CORR4-STALE-A", 1) or {}
    summary_b = _run("CORR4-STALE-B", "corr4_stale_window", attempts / "stale-b")
    providers_b = []
    stored_b = collected_evidence("CORR4-STALE-B", 1) or {}
    for item in (stored_b.get("provider_evidence") or []):
        if isinstance(item, dict):
            providers_b.append(item.get("scenario_id"))
    quarantine = [item for item in (stored_b.get("quarantine") or []) if isinstance(item, dict)]
    stale_records = [
        item.get("record") or {}
        for item in quarantine
        if item.get("classification") == "STALE_OR_MISMATCHED_INFRA_EVENT"
    ]
    return {
        "b": summary_b,
        "a_provider_count": len(stored_a.get("provider_evidence") or []),
        "b_provider_scenario_ids": providers_b,
        "stale_scenario_ids": [item.get("scenario_id") for item in stale_records if isinstance(item, dict)],
        "classifications": [item.get("classification") for item in quarantine],
        "request_error": StaleWindowAdapter.holder.get("error") if isinstance(StaleWindowAdapter.holder, dict) else None,
        "visible_stale": "STALE_OR_MISMATCHED_INFRA_EVENT" in (summary_b.get("quarantine_classifications") or []),
        "b_not_stamped_with_a_as_own": "CORR4-STALE-A" not in providers_b,
    }


def _checks(proof: dict[str, Any]) -> dict[str, bool]:
    clean = proof.get("clean") or {}
    http500 = proof.get("armed_http500") or {}
    retrieval = proof.get("armed_retrieval") or {}
    deny = proof.get("unarmed_deny") or {}
    unarmed_http = proof.get("unarmed_http500") or {}
    stale = proof.get("stale") or {}
    async_row = proof.get("async_10s") or {}
    cancelled = proof.get("cancelled") or {}
    retrieval_row = (retrieval.get("retrieval") or [{}])[0]
    raw = {
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
        and deny.get("continue_to_next_scenario") is False
        and "UNARMED_INFRA_EVENT" in (deny.get("quarantine_classifications") or [])
        and "DEFAULT_DENY" in (deny.get("node_deny_reasons") or []),
        "unarmed_http500": unarmed_http.get("verdict") == "INFRA_FAILURE"
        and unarmed_http.get("continue_to_next_scenario") is False
        and "UNARMED_INFRA_EVENT" in (unarmed_http.get("quarantine_classifications") or []),
        "stale_visible": stale.get("visible_stale") is True and stale.get("b_not_stamped_with_a_as_own") is True
        and "CORR4-STALE-A" in (stale.get("stale_scenario_ids") or [])
        and (stale.get("b") or {}).get("verdict") == "INFRA_FAILURE",
        "async_10s": float((async_row.get("ten_second") or {}).get("elapsed_s") or 0) >= 9.0
        and async_row.get("cancelled_error_contained") is not True
        and async_row.get("verdict") not in (None, ""),
        "cancelled_contained": cancelled.get("verdict") == "INFRA_FAILURE"
        and cancelled.get("cancelled_error_contained") is True,
        "freeze_permission": (proof.get("freeze") or {}).get("verdict") == "INFRA_FAILURE"
        and (proof.get("freeze") or {}).get("freeze_failure") == "PermissionError"
        and (proof.get("freeze") or {}).get("raw_evidence_path") is None
        and (proof.get("freeze") or {}).get("dominates") is True
        and (proof.get("freeze") or {}).get("continue_to_next_scenario") is False,
        "no_scenarios": proof.get("scenarios_executed") == 0,
        "provider_contact_none": proof.get("provider_contact") == "NONE",
    }
    return {key: bool(value) for key, value in raw.items()}


def run_corr4_topology() -> dict[str, Any]:
    root = _select_root()
    replica = root / "navigator-replica"
    proof: dict[str, Any] = {
        "ok": False,
        "act": "IMPLEMENTATION-1.CORR4",
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "scenarios_executed": 0,
        "chatbot_test_base": str(CHATBOT_TEST_BASE),
        "artifact_root": str(root),
    }
    loopback: LoopbackSupabaseDouble | None = None
    stub: _LocalProviderStub | None = None
    process = None
    claimed = False
    saved_env = {
        key: os.environ.get(key)
        for key in ("NAVIGATOR_TEST_ROOT", "TIKHON_TEST_ROOT")
    }
    os.environ["NAVIGATOR_TEST_ROOT"] = (
        "/Users/entp_psyche/Desktop/InvestProjects2026/"
        "test-bases/ACADEMY_TELEGRAM_LIVE_REGRESSION_1000_1/navigator"
    )
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
        proof["replica_identity"] = cap.replica_identity
        proof["preload_instance_id"] = None
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
        proof["proof_generation"] = ctx.proof_identity.get("generation")
        permit_scenario_body()
        attempts = root / "attempts"
        proof["clean"] = _run("CORR4-CLEAN", "corr4_clean", attempts / "clean")
        proof["armed_http500"] = _run("CORR4-ARMED-500", "corr4_armed_http500", attempts / "armed-500")
        proof["armed_retrieval"] = _run("CORR4-ARMED-RETRIEVAL", "corr4_armed_retrieval", attempts / "retrieval")
        proof["unarmed_deny"] = _run("CORR4-UNARMED-DENY", "corr4_unarmed_deny", attempts / "unarmed-deny")
        proof["unarmed_http500"] = _run("CORR4-UNARMED-500", "corr4_unarmed_http500", attempts / "unarmed-500")
        proof["stale"] = _stale_during_b(cap.control_url, attempts)
        proof["async_10s"] = _run("CORR4-ASYNC-10S", "corr4_ten_second", attempts / "async-10s", wall_budget_s=30.0)
        proof["async_10s"]["ten_second"] = dict(TEN_SECOND)
        proof["cancelled"] = _run("CORR4-CANCELLED", "corr4_cancelled", attempts / "cancelled")
        freeze_root = attempts / "freeze-denied"
        freeze_root.mkdir(parents=True, exist_ok=True)
        os.chmod(freeze_root, 0o555)
        try:
            freeze_outcome = run_scenario_once(
                corr4_spec("CORR4-FREEZE-PERMISSION", "corr4_unarmed_deny"),
                run_id="corr4-freeze-permission",
                attempt=1,
                evidence_root=str(freeze_root),
                lane=LANE_CALIBRATION,
                calibration_registry=corr4_registry(),
            )
            proof["freeze"] = _summarize(freeze_outcome, "CORR4-FREEZE-PERMISSION", 1)
        finally:
            os.chmod(freeze_root, 0o755)
        proof["scenarios_executed"] = ctx.scenarios_executed
        proof["scenario_body_permitted"] = ctx.scenario_body_permitted
        checks = _checks(proof)
        proof["checks"] = checks
        proof["ok"] = all(checks.values())
        if not proof["ok"]:
            proof["reason"] = "topology checks failed: " + ",".join(name for name, ok in checks.items() if not ok)
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
            target = root / "REAL_TOPOLOGY_CORR4_PROOF.json"
            if not target.exists():
                target.write_text(
                    json.dumps(proof, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
                proof["proof_path"] = str(target)
    return proof
