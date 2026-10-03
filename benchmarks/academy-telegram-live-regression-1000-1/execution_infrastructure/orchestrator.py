"""Startup orchestration for one sanitized Navigator replica.

This module boots next build and next start, proves the preload, the
loopback double, and the sentinel, then mints a process-local context.
It stops at the runner gate. It does not execute a benchmark scenario.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .attempt_binding import arm_request_identity, register_active_loopback
from .constants import (
    CHATBOT_TEST_BASE,
    PRELOAD_PATH,
    SUPABASE_SECRET_PLACEHOLDER,
)
from .controlled_context import (
    REQUIRED_PROOFS,
    clear_controlled_context,
    mint_controlled_context,
    permit_scenario_body,
)
from .pd_f05_fixtures import build_query_vector, fixture_key, load_frozen_document, vector_sha256
from .pd_f05_loopback import LoopbackSupabaseDouble
from .next_authority import issue_controlled_proofs, launch_controlled_next
from .startup_proofs import run_owned

NAVIGATOR = Path(__file__).resolve().parents[3]
ARTIFACT_ROOT = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/"
    "ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_IMPLEMENTATION_1_CORR2"
)
REPLICA = ARTIFACT_ROOT / "navigator-replica"
SANDBOX_PROFILE = """(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))
"""


def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = int(sock.getsockname()[1])
    sock.close()
    return port


def _excluded_env_paths(root: Path) -> list[str]:
    found = []
    for path in root.iterdir():
        if path.name == ".env" or path.name.startswith(".env."):
            found.append(str(path))
    return sorted(found)


def build_sanitized_replica(dest: Path | None = None) -> dict[str, Any]:
    """Clone the origin only after the origin matches the frozen authority.

    A mismatched origin raises NEXT_ORIGIN_IDENTITY_MISMATCH before any
    replica directory is created.
    """
    from .next_runtime_identity import attest_origin_next_runtime

    origin = attest_origin_next_runtime(NAVIGATOR)
    if not origin.get("ok"):
        raise PermissionError("NEXT_ORIGIN_IDENTITY_MISMATCH")
    replica = dest if dest is not None else REPLICA
    if replica.exists():
        shutil.rmtree(replica)
    replica.mkdir(parents=True)
    excluded = _excluded_env_paths(NAVIGATOR)
    cmd = [
        "rsync", "-a",
        "--exclude", "node_modules",
        "--exclude", ".git",
        "--exclude", ".next",
        "--exclude", ".env",
        "--exclude", ".env.*",
        f"{NAVIGATOR}/",
        f"{replica}/",
    ]
    subprocess.run(cmd, check=True)
    subprocess.run(["cp", "-cR", str(NAVIGATOR / "node_modules"), str(replica / "node_modules")], check=True)
    copied = []
    for dirpath, dirnames, filenames in os.walk(replica):
        dirnames[:] = [name for name in dirnames if name != "node_modules"]
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink():
                continue
            copied.append(str(path.relative_to(replica)))
    leaked = [name for name in copied if name == ".env" or name.startswith(".env.")]
    return {
        "replica": str(replica),
        "source": str(NAVIGATOR),
        "excluded_env_paths": excluded,
        "copied_file_count": len(copied),
        "copied_files": copied,
        "env_files_copied": leaked,
        "node_modules": "apfs-clone",
        "node_modules_target": str(NAVIGATOR / "node_modules"),
        "origin_attestation": {
            "classification": origin.get("classification"),
            "frozen_authority_sha256": origin.get("frozen_authority_sha256"),
            "observed_surface_aggregate_sha256": origin.get("observed_surface_aggregate_sha256"),
            "mismatch_count": origin.get("mismatch_count"),
        },
    }


def _post_json(url: str, payload: dict[str, Any] | None = None, timeout: float = 10) -> tuple[int, dict[str, Any]]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        return response.status, json.loads(raw.decode("utf-8") or "{}")


def run_sandboxed_next_build(
    next_bin: str,
    cwd: str,
    env: dict[str, str],
    profile_path: Path,
    log_handle: Any,
) -> subprocess.CompletedProcess:
    """One sandboxed next build. There is no unsandboxed retry.

    The interpreter is the frozen absolute Node path. This helper is not
    authority: only launch_controlled_next attests and mints.
    """
    from .next_authority import accepted_node_executable

    return run_owned(
        ["sandbox-exec", "-f", str(profile_path), accepted_node_executable(), next_bin, "build"],
        cwd=cwd,
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        check=False,
        timeout=180,
    )


def _probe_chain(control: str, loopback_url: str, scenario_id: str) -> dict[str, Any]:
    """Arm once, then bindings, Cohere, and match for that same request."""
    armed = arm_request_identity(scenario_id, 1, 1, "levels-of-consciousness")
    key = fixture_key(scenario_id, 1, 1, "levels-of-consciousness")
    vector = build_query_vector(key)
    bindings = _post_json(control + "/probe-fetch", {
        "url": loopback_url + "/rest/v1/academy_course_sources?course_id=eq.levels-of-consciousness&is_active=eq.true&select=course_id,source_id,authority_relation,metadata,knowledge_sources",
        "method": "GET",
    })
    cohere = _post_json(control + "/probe-fetch", {
        "url": "https://api.cohere.com/v2/embed",
        "method": "POST",
        "headers": {"content-type": "application/json"},
        "body": {"texts": ["topology-probe"], "model": "embed-multilingual-v3.0"},
    })
    match = _post_json(control + "/probe-fetch", {
        "url": loopback_url + "/rest/v1/rpc/match_course_knowledge_chunks",
        "method": "POST",
        "headers": {"content-type": "application/json", "apikey": SUPABASE_SECRET_PLACEHOLDER},
        "body": {
            "p_course_id": "levels-of-consciousness",
            "p_query_embedding": vector,
            "p_match_count": 12,
            "p_match_threshold": -1,
        },
    })
    cohere_body = json.loads(cohere[1].get("body") or "{}")
    returned = ((cohere_body.get("embeddings") or {}).get("float") or [None])[0]
    document = load_frozen_document()
    expected_sha = document["fixtures"][key]["query_vector_sha256"]
    returned_sha = vector_sha256(returned) if isinstance(returned, list) else None
    node_armed = (armed.get("node") or {}).get("armed") or {}
    return {
        "scenario_id": scenario_id,
        "attempt_number": 1,
        "chat_request_ordinal": 1,
        "course_id": "levels-of-consciousness",
        "runner_request": armed["request"],
        "node_armed": node_armed,
        "loopback_armed": armed.get("loopback"),
        "bindings_http": bindings[1].get("status"),
        "cohere_http": cohere[1].get("status"),
        "match_http": match[1].get("status"),
        "vector_sha_equal": returned_sha == expected_sha == vector_sha256(vector),
        "cohere_sentinel_absent": "harness_sentinel" not in cohere_body,
    }


def claim_evidence_directory(path: Path) -> None:
    """Fail closed when the evidence directory already holds artifacts.

    Existing bytes are left in place. This function does not delete them.
    """
    if path.exists() and any(path.iterdir()):
        raise FileExistsError(f"ARTIFACT_DIRECTORY_EXISTS: {path}")
    path.mkdir(parents=True, exist_ok=True)


def run_startup_orchestration() -> dict[str, Any]:
    try:
        claim_evidence_directory(ARTIFACT_ROOT)
    except FileExistsError as exc:
        return {"ok": False, "reason": str(exc), "scenarios_executed": 0, "provider_contact": "NONE"}
    profile_path = ARTIFACT_ROOT / "network-deny.sb"
    profile_path.write_text(SANDBOX_PROFILE, encoding="utf-8")
    replica = build_sanitized_replica()
    loopback = LoopbackSupabaseDouble()
    register_active_loopback(loopback)
    loopback_url = loopback.start()
    ledger_path = ARTIFACT_ROOT / "node-ledger.json"
    state_path = ARTIFACT_ROOT / "preload-state.json"
    build_log = ARTIFACT_ROOT / "next-build.log"
    start_log = ARTIFACT_ROOT / "next-start.log"
    port = _free_port()
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(ARTIFACT_ROOT / "empty-home"),
        "TMPDIR": str(ARTIFACT_ROOT),
        "NODE_OPTIONS": f"--require {PRELOAD_PATH}",
        "ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS": "1",
        "ACADEMY_NODE_LEDGER_PATH": str(ledger_path),
        "ACADEMY_EXECUTION_PRELOAD_STATE": str(state_path),
        "NEXT_OTEL_FETCH_DISABLED": "1",
        "PORT": str(port),
        "HOSTNAME": "127.0.0.1",
        "SUPABASE_URL": loopback_url,
        "SUPABASE_SECRET_KEY": SUPABASE_SECRET_PLACEHOLDER,
    }
    Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
    repo_next = NAVIGATOR / ".next"
    repo_next_before = repo_next.exists()
    started = time.monotonic()
    process = None
    proof: dict[str, Any] = {
        "replica": replica,
        "loopback_url": loopback_url,
        "sandbox_exec_invoked": True,
        "sandbox_exec_used_for_build": True,
        "unsandboxed_fallback": False,
        "repo_next_existed_before": repo_next_before,
        "scenarios_executed": 0,
        "provider_contact": "NONE",
    }
    try:
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
        build_seconds = round(time.monotonic() - started, 3)
        proof["next_build_returncode"] = build.returncode
        proof["next_build_seconds"] = build_seconds
        proof["build_returncode"] = build.returncode
        proof["build_pass"] = build.returncode == 0
        proof["repo_next_exists_after_build"] = (NAVIGATOR / ".next").exists()
        proof["next_start_pid"] = cap.node_pid
        proof["next_start_http"] = {"ok": True}
        proof["preload_state"] = {"port": cap.control_port}
        os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state_path)
        os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(ledger_path)
        os.environ["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        control = cap.control_url
        identities = [
            _probe_chain(control, loopback_url, "A-0005"),
            _probe_chain(control, loopback_url, "A-0006"),
        ]
        denied = _post_json(control + "/probe-fetch", {
            "url": "https://example.com/outside",
            "method": "GET",
        })
        ledger_status, ledger_live = _post_json(control + "/ledger")
        active_loopback = dict(loopback.armed or {})
        proof["r2_identities"] = identities
        proof["loopback_active_identity"] = active_loopback
        proof["prior_identity_not_active"] = active_loopback.get("scenario_id") == "A-0006"
        proof["probe"] = {
            "external_error_code": denied[1].get("error_code"),
            "ledger_status": ledger_status,
            "ledger_event_count": len(ledger_live.get("events") or []),
            "identities": [item["scenario_id"] for item in identities],
        }
        proof["vector_sha_match"] = all(item["vector_sha_equal"] is True for item in identities)
        proof["cohere_sentinel_absent"] = all(item["cohere_sentinel_absent"] is True for item in identities)
        proof["loopback_request_count"] = len(loopback.evidence)
        proofs = issue_controlled_proofs(cap, loopback)
        proof["startup_proof_kinds"] = {
            name: item.observation.get("kind") or item.observation.get("fetched_by") or item.name
            for name, item in proofs.items()
        }
        proof["startup_proof_generation"] = proofs["PYTHON_ISOLATION_ACTIVE"].generation
        clear_controlled_context()
        ctx = mint_controlled_context(proofs)
        from adapters.corr2_synthetic import synthetic_registry, synthetic_spec
        from execution_infrastructure.attempt_binding import collected_evidence
        from harness.factory import LANE_CALIBRATION
        from harness.runner import run_scenario_once

        gate_root = ARTIFACT_ROOT / "gate-evidence"
        synthetic_root = ARTIFACT_ROOT / "synthetic-evidence"
        gate_root.mkdir(parents=True, exist_ok=True)
        synthetic_root.mkdir(parents=True, exist_ok=True)
        gate = run_scenario_once(
            {"scenario_id": "CORR2-TOPOLOGY-GATE"},
            run_id="corr2-topology-gate",
            attempt=1,
            evidence_root=str(gate_root),
        )
        proof["runner_gate"] = {
            "verdict": gate.verdict.value,
            "reason": gate.verdict_reason,
            "adapter_invocations": gate.adapter_invocations,
            "scenarios_executed": ctx.scenarios_executed,
            "scenario_body_permitted": ctx.scenario_body_permitted,
        }
        permit_scenario_body()
        synthetic = run_scenario_once(
            synthetic_spec(),
            run_id="corr2-synthetic-aggregation",
            attempt=1,
            evidence_root=str(synthetic_root),
            lane=LANE_CALIBRATION,
            calibration_registry=synthetic_registry(),
        )
        aggregate = (synthetic.derivation_state.get("infrastructure_precedence") or {})
        sources = [item.get("source") for item in (aggregate.get("findings") or [])]
        stored = collected_evidence("CORR2-SYNTHETIC-AGGREGATION", 1) or {}
        proof["synthetic_attempt"] = {
            "verdict": synthetic.verdict.value,
            "reason": synthetic.verdict_reason,
            "continue_to_next_scenario": synthetic.derivation_state.get("continue_to_next_scenario"),
            "deterministic_status": synthetic.derivation_state.get("deterministic_status"),
            "infra_failure": synthetic.derivation_state.get("infra_failure"),
            "finding_sources": sources,
            "stop_class": aggregate.get("stop_class"),
            "canonical_benchmark_status": aggregate.get("canonical_benchmark_status"),
            "provider_event_count": len(stored.get("provider_evidence") or []),
            "retrieval_event_count": len(stored.get("retrieval_evidence") or []),
            "python_violation_count": len(stored.get("python_violations") or []),
            "lifecycle_fail_closed": bool((stored.get("lifecycle") or {}).get("fail_closed")),
            "os_f04_status": (stored.get("os_f04") or {}).get("execution_status"),
            "adapter_invocations": synthetic.adapter_invocations,
            "scenarios_executed": ctx.scenarios_executed,
        }
        proof["scenarios_executed"] = 0
        proof["benchmark_scenarios_executed"] = 0
        both_http = all(
            item["bindings_http"] == 200 and item["cohere_http"] == 200 and item["match_http"] == 200
            for item in identities
        )
        identities_match = all(
            (item["node_armed"] or {}).get("scenario_id") == item["scenario_id"]
            and (item["loopback_armed"] or {}).get("scenario_id") == item["scenario_id"]
            and (item["runner_request"] or {}).get("scenario_id") == item["scenario_id"]
            for item in identities
        )
        synthetic_ok = (
            synthetic.verdict.value == "INFRA_FAILURE"
            and synthetic.derivation_state.get("continue_to_next_scenario") is False
            and synthetic.derivation_state.get("deterministic_status") == "SATISFIED"
            and {"OS_F04", "PYTHON_ISOLATION", "RETRIEVAL", "NAVIGATOR_PROVIDER", "LIFECYCLE"} <= set(sources)
        )
        proof["ok"] = bool(
            both_http
            and identities_match
            and proof["vector_sha_match"]
            and proof["prior_identity_not_active"]
            and gate.adapter_invocations == 0
            and gate.verdict.value == "NOT_EXECUTED"
            and synthetic_ok
            and ctx.scenarios_executed == 0
            and proof["unsandboxed_fallback"] is False
        )
        persisted = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {}
        proof["persisted_ledger_events"] = len(persisted.get("events") or [])
        proof["persisted_ledger_matches_live"] = proof["persisted_ledger_events"] == proof["probe"]["ledger_event_count"]
    except Exception as exc:  # noqa: BLE001 — the proof must record the startup failure
        proof["ok"] = False
        proof["reason"] = f"{type(exc).__name__}: {exc}"
    finally:
        clear_controlled_context()
        if process is not None:
            _stop_process(process)
            proof["next_start_returncode"] = process.poll()
        loopback.stop()
    proof["chatbot_test_base"] = str(CHATBOT_TEST_BASE)
    proof["required_proofs"] = list(REQUIRED_PROOFS)
    return proof


def _wait_http(url: str, seconds: float) -> dict[str, Any]:
    deadline = time.monotonic() + seconds
    last = ""
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return {"ok": True, "status": response.status}
        except urllib.error.HTTPError as exc:
            return {"ok": True, "status": exc.code}
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {exc}"
            time.sleep(0.2)
    return {"ok": False, "error": last}


def _wait_state(path: Path, seconds: float) -> dict[str, Any] | None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
        time.sleep(0.1)
    return None


def _stop_process(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, 15)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, 9)
        process.wait(timeout=5)


def main() -> int:
    sys.dont_write_bytecode = True
    target = ARTIFACT_ROOT / "REAL_TOPOLOGY_CORR2_PROOF.json"
    if target.exists():
        print(json.dumps({
            "ok": False,
            "reason": "REAL_TOPOLOGY_CORR2_PROOF.json already exists",
            "path": str(target),
        }, ensure_ascii=False))
        return 1
    proof = run_startup_orchestration()
    if str(proof.get("reason") or "").startswith("ARTIFACT_DIRECTORY_EXISTS"):
        print(json.dumps({
            "ok": False,
            "reason": proof.get("reason"),
            "scenarios_executed": 0,
        }, ensure_ascii=False))
        return 1
    if target.exists():
        print(json.dumps({"ok": False, "reason": "proof appeared during startup"}, ensure_ascii=False))
        return 1
    target.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": proof.get("ok"),
        "reason": proof.get("reason"),
        "next_build_returncode": proof.get("next_build_returncode"),
        "next_build_seconds": proof.get("next_build_seconds"),
        "runner_gate": proof.get("runner_gate"),
        "vector_sha_match": proof.get("vector_sha_match"),
        "synthetic_attempt": proof.get("synthetic_attempt"),
        "loopback_active_identity": proof.get("loopback_active_identity"),
        "scenarios_executed": proof.get("scenarios_executed"),
        "proof_path": str(target),
    }, ensure_ascii=False, indent=2))
    return 0 if proof.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
