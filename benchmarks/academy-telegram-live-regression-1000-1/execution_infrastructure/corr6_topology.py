"""CORR6 fresh real topology.

One new sanitized Navigator replica, built only after the origin matches the
frozen Next authority. The replica, the Node executable, and the preload are
attested against the same frozen artifact before the sandboxed build. The
product-authority negative matrix runs here because only a real controlled
context can produce a positive baseline for it.

No benchmark scenario body and no real provider contact.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BENCH = Path(__file__).resolve().parents[1]
if str(BENCH) not in sys.path:
    sys.path.insert(0, str(BENCH))

from adapters import corr6_producers as producers  # noqa: E402
from adapters.corr4_producers import TEN_SECOND, corr4_spec  # noqa: E402
from execution_infrastructure import product_capability as pc  # noqa: E402
from execution_infrastructure.attempt_binding import collected_evidence  # noqa: E402
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
from execution_infrastructure.corr3_topology import (  # noqa: E402
    _LocalProviderStub,
    _get_json,
    _summarize,
)
from execution_infrastructure.corr4_topology import _stale_during_b  # noqa: E402
from execution_infrastructure.corr5_topology import _no_attempt_during_b  # noqa: E402
from execution_infrastructure.frozen_next_authority import (  # noqa: E402
    attest_node_executable,
    attest_preload,
    load_frozen_authority,
)
from execution_infrastructure.next_authority import (  # noqa: E402
    finalized_artifact_root,
    issue_controlled_proofs,
    launch_controlled_next,
    refuse_persistent_artifact_root,
)
from execution_infrastructure.next_runtime_identity import (  # noqa: E402
    attest_origin_next_runtime,
    attest_replica_next_runtime,
)
from execution_infrastructure.orchestrator import (  # noqa: E402
    SANDBOX_PROFILE,
    _free_port,
    _probe_chain,
    _stop_process,
    build_sanitized_replica,
    claim_evidence_directory,
)
from execution_infrastructure.pd_f05_loopback import LoopbackSupabaseDouble  # noqa: E402
from execution_infrastructure.startup_proofs import clear_live_run  # noqa: E402
from harness.factory import LANE_CALIBRATION  # noqa: E402

NAVIGATOR_TEST_ROOT = (
    "/Users/entp_psyche/Desktop/InvestProjects2026/"
    "test-bases/ACADEMY_TELEGRAM_LIVE_REGRESSION_1000_1/navigator"
)
SECRET_SHAPES = (
    "Bearer CORR6SECRETTOKEN",
    "sb_secret_corr6destination",
    "Basic Y29ycjY6c2VjcmV0",
    "sk-corr6errorvalue0000",
    "Bearer CORR6NESTED",
    "sk-corr6listelement0000",
    "sb_secret_corr6freetext",
    "Bearer CORR6FREE",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "sb_secret_corr6placeholder",
)


def _select_root() -> Path:
    raw = os.environ.get("ACADEMY_CORR6_ARTIFACT_ROOT")
    if raw:
        path = Path(raw).resolve()
        refuse_persistent_artifact_root(path)
    else:
        path = Path(tempfile.mkdtemp(prefix="academy-corr6-topology-"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _run(scenario_id: str, adapter_id: str, root: Path, *, wall_budget_s: float = 60.0) -> dict[str, Any]:
    from harness.runner import run_scenario_once

    root.mkdir(parents=True, exist_ok=True)
    outcome = run_scenario_once(
        corr4_spec(scenario_id, adapter_id),
        run_id=f"corr6-{scenario_id.lower()}",
        attempt=1,
        evidence_root=str(root),
        lane=LANE_CALIBRATION,
        calibration_registry=producers.corr6_registry(),
        wall_budget_s=wall_budget_s,
    )
    summary = _summarize(outcome, scenario_id, 1)
    summary["cancelled_error_contained"] = bool((outcome.derivation_state or {}).get("cancelled_error_contained"))
    return summary


def _attestation_summary(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": result.get("ok"),
        "classification": result.get("classification"),
        "authority": result.get("authority"),
        "frozen_authority_sha256": result.get("frozen_authority_sha256"),
        "observed_surface_aggregate_sha256": result.get("observed_surface_aggregate_sha256"),
        "surface_aggregate_sha256": result.get("surface_aggregate_sha256"),
        "package_lock_ok": result.get("package_lock_ok"),
        "file_count": result.get("file_count"),
        "expected_entry_count": result.get("expected_entry_count"),
        "mismatch_count": result.get("mismatch_count"),
        "origin_is_replica": result.get("origin_is_replica"),
    }


def _hostile_path(root: Path) -> tuple[Path, Path]:
    """A PATH entry whose node and npx write a marker if anything runs them."""
    hostile = root / "hostile-bin"
    hostile.mkdir(parents=True, exist_ok=True)
    marker = root / "HOSTILE_NODE_EXECUTED"
    for name in ("node", "npx", "npm"):
        script = hostile / name
        script.write_text(f"#!/bin/sh\necho executed > '{marker}'\nexit 97\n", encoding="utf-8")
        script.chmod(0o755)
    return hostile, marker


# ---------------------------------------------------------------------------
# Product-authority negative matrix with a live controlled context
# ---------------------------------------------------------------------------

def _token(run_id: str, **overrides: Any) -> Any:
    from harness.factory import BINDING_TOKEN_SCHEMA_VERSION, BindingToken
    from harness.seams.sut_binding import EXPECTED_NAVIGATOR, EXPECTED_TIKHON

    fields = dict(
        schema_version=BINDING_TOKEN_SCHEMA_VERSION,
        navigator_expected=dict(EXPECTED_NAVIGATOR),
        tikhon_expected=dict(EXPECTED_TIKHON),
        navigator_root=NAVIGATOR_TEST_ROOT,
        tikhon_root=str(CHATBOT_TEST_BASE),
        navigator_manifest_sha256=None,
        tikhon_manifest_sha256=pc.PINNED_TIKHON_MANIFEST,
        created_at_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        run_id=run_id,
    )
    fields.update(overrides)
    return BindingToken(**fields)


class _Binding:
    def __init__(self, token: Any) -> None:
        self.token = token
        self.token_ok = True
        self.reasons: list[str] = []


def _matrix_case(name: str, root: Path, token_factory: Any, *, repoint: dict[str, str] | None = None) -> dict[str, Any]:
    """Run the bound authority probe with a substituted binding token.

    The runner's own install path receives the token. Only the binding step
    that produces it is substituted.
    """
    from harness.seams import sut_binding

    scenario = f"CORR6-MATRIX-{name.upper()}"
    run_id = f"corr6-{scenario.lower()}"
    original = sut_binding.bind_test_bases_with_token
    saved = {key: getattr(pc, key) for key in (repoint or {})}
    producers.RESULTS.pop("bound_authority", None)
    sut_binding.bind_test_bases_with_token = lambda **_kw: _Binding(token_factory(run_id))
    for key, value in (repoint or {}).items():
        setattr(pc, key, value)
    try:
        summary = _run(scenario, "corr6_BoundAuthorityProbeAdapter", root / name)
    finally:
        sut_binding.bind_test_bases_with_token = original
        for key, value in saved.items():
            setattr(pc, key, value)
    executed = "bound_authority" in producers.RESULTS
    return {
        "verdict": summary["verdict"],
        "reason": (summary.get("reason") or "")[:200],
        "adapter_invocations": summary["adapter_invocations"],
        "product_executed": executed and bool((producers.RESULTS.get("bound_authority") or {}).get("bound_call_ok")),
    }


def _drifted_chatbot(root: Path) -> Path:
    copy = root / "drifted-chatbot"
    subprocess.run(["cp", "-cR", str(CHATBOT_TEST_BASE), str(copy)], check=True)
    target = copy / "data_engine" / "lebedev_adapter.py"
    data = bytearray(target.read_bytes())
    data[-1] ^= 0x01
    target.unlink()
    target.write_bytes(bytes(data))
    return copy


def _wrong_head_navigator(root: Path) -> Path:
    """Disposable Navigator copy whose HEAD file names the parent commit."""
    copy = root / "wrong-head-navigator"
    subprocess.run(
        ["rsync", "-a", "--exclude", "node_modules", "--exclude", ".next",
         NAVIGATOR_TEST_ROOT + "/", str(copy) + "/"],
        check=True,
    )
    parent = subprocess.run(
        ["git", "-C", NAVIGATOR_TEST_ROOT, "rev-parse", pc.EXPECTED_NAVIGATOR_HEAD + "^"],
        capture_output=True, text=True, check=True, env={"PATH": "/usr/bin:/bin", "GIT_OPTIONAL_LOCKS": "0"},
    ).stdout.strip()
    (copy / ".git" / "HEAD").write_text(parent + "\n", encoding="utf-8")
    return copy


def _product_matrix(root: Path) -> dict[str, Any]:
    from harness.seams.sut_binding import EXPECTED_NAVIGATOR, EXPECTED_TIKHON

    rows: dict[str, Any] = {}
    rows["positive_control"] = _matrix_case("positive", root, lambda run_id: _token(run_id))

    def mutated(run_id: str) -> Any:
        token = _token(run_id)
        object.__setattr__(token, "tikhon_root", str(CHATBOT_TEST_BASE) + "/")
        return token

    drifted = _drifted_chatbot(root)
    wrong_head = _wrong_head_navigator(root)
    cases = {
        "no_token": (lambda run_id: None, None),
        "non_token_object": (lambda run_id: object(), None),
        "mutated_token": (mutated, None),
        "wrong_chatbot_root": (lambda run_id: _token(run_id, tikhon_root=str(root)), None),
        "live_chatbot_root": (lambda run_id: _token(run_id, tikhon_root=str(pc.LIVE_CHATBOT)), None),
        "wrong_chatbot_manifest_sha": (lambda run_id: _token(run_id, tikhon_manifest_sha256="0" * 64), None),
        "drifted_chatbot_copy": (lambda run_id: _token(run_id, tikhon_root=str(drifted)), None),
        "drifted_chatbot_with_repointed_root": (
            lambda run_id: _token(run_id, tikhon_root=str(drifted)),
            {"_ACCEPTED_CHATBOT_ROOT": os.path.realpath(str(drifted))},
        ),
        "wrong_chatbot_expected_head": (
            lambda run_id: _token(run_id, tikhon_expected=dict(EXPECTED_TIKHON, head="e" * 40)), None),
        "wrong_navigator_root": (lambda run_id: _token(run_id, navigator_root=str(root)), None),
        "navigator_root_none": (lambda run_id: _token(run_id, navigator_root=None), None),
        "wrong_navigator_expected_head": (
            lambda run_id: _token(run_id, navigator_expected=dict(EXPECTED_NAVIGATOR, head="f" * 40)), None),
        "wrong_navigator_actual_head": (
            lambda run_id: _token(run_id, navigator_root=str(wrong_head)),
            {"_ACCEPTED_NAVIGATOR_ROOT": os.path.realpath(str(wrong_head))},
        ),
        "token_from_other_run": (lambda run_id: _token("corr6-other-run"), None),
    }
    for name, (factory, repoint) in cases.items():
        rows[name] = _matrix_case(name, root, factory, repoint=repoint)
    shutil.rmtree(drifted, ignore_errors=True)
    shutil.rmtree(wrong_head, ignore_errors=True)
    return rows


def _capability_replay(root: Path) -> dict[str, Any]:
    """A kept runner capability is replayed in a bound and an unbound attempt."""
    for key in ("captured_capability", "captured_token", "capture", "replay_bound", "replay_unbound"):
        producers.RESULTS.pop(key, None)
    capture = _run("CORR6-CAPTURE-A", "corr6_BoundCaptureCapabilityAdapter", root / "capture-a")
    bound = _run("CORR6-REPLAY-B", "corr6_BoundReplayCapabilityAdapter", root / "replay-b")
    unbound = _run("CORR6-REPLAY-C", "corr6_UnboundReplayCapabilityAdapter", root / "replay-c")
    return {
        "capture": {**(producers.RESULTS.get("capture") or {}), "verdict": capture["verdict"]},
        "replay_bound": {**(producers.RESULTS.get("replay_bound") or {}), "verdict": bound["verdict"]},
        "replay_unbound": {**(producers.RESULTS.get("replay_unbound") or {}), "verdict": unbound["verdict"]},
    }


def _wrapper_matrix(root: Path) -> dict[str, Any]:
    rows: dict[str, Any] = {}
    for tag in producers.WRAPPERS:
        summary = _run(f"CORR6-WRAP-{tag.upper()}", "corr6_wrap_" + tag, root / f"wrap-{tag}")
        record = (producers.RESULTS.get("wrap") or {}).get(tag) or {}
        rows[tag] = {
            "verdict": summary["verdict"],
            "reason": (summary.get("reason") or "")[:160],
            "adapter_invocations": summary["adapter_invocations"],
            "product_returned": record.get("product_returned"),
            "denied": record.get("denied"),
            "side_effect": record.get("side_effect"),
        }
    return rows


def _checks(proof: dict[str, Any]) -> dict[str, bool]:
    frozen = proof.get("frozen_authority") or {}
    origin = proof.get("origin_attestation") or {}
    replica = proof.get("replica_attestation") or {}
    node = proof.get("node_attestation") or {}
    preload = proof.get("preload_attestation") or {}
    identity = proof.get("next_runtime_identity") or {}
    clean = proof.get("clean") or {}
    http500 = proof.get("armed_http500") or {}
    retrieval = proof.get("armed_retrieval") or {}
    retrieval_row = (retrieval.get("retrieval") or [{}])[0]
    deny = proof.get("unarmed_deny") or {}
    no_attempt = proof.get("no_attempt_start") or {}
    stale = proof.get("stale") or {}
    async_row = proof.get("async_10s") or {}
    a0005 = proof.get("a0005") or {}
    lifecycle = proof.get("bound_lifecycle") or {}
    arm = proof.get("real_local_arm") or {}
    arm_obs = (arm.get("observed") or [{}])[0]
    matrix = proof.get("product_authority_matrix") or {}
    wrappers = proof.get("wrapper_matrix") or {}
    replay = proof.get("capability_replay") or {}
    after_clear = proof.get("cached_after_clear") or {}
    pyviol = proof.get("python_violations") or {}
    generation = proof.get("generation_change") or {}
    negative_rows = {key: value for key, value in matrix.items() if key != "positive_control"}
    raw = {
        "1_frozen_authority": frozen.get("loaded") is True,
        "2_origin_attested": origin.get("ok") is True and origin.get("classification") == "TRUSTED_NEXT_RUNTIME",
        "3_replica_attested": replica.get("ok") is True and replica.get("origin_is_replica") is False,
        "4_node_attested": node.get("ok") is True,
        "5_preload_attested": preload.get("ok") is True,
        "6_sandboxed_build": proof.get("build_pass") is True and bool(proof.get("build_marker"))
        and identity.get("frozen_authority_sha256") == frozen.get("sha256"),
        "7_sandboxed_start": (proof.get("next_health") or {}).get("next_server") is True,
        "8_sentinel_and_mint": proof.get("minted") is True and bool(proof.get("preload_instance_id")),
        "hostile_path_not_used": proof.get("hostile_node_executed") is False,
        "9_clean_attempt": clean.get("verdict") == "PASS" and clean.get("continue_to_next_scenario") is True,
        "10_armed_http500": http500.get("verdict") == "INFRA_FAILURE" and "PROVIDER_HTTP_5XX" in (http500.get("provider_raw") or []),
        "11_armed_retrieval": retrieval.get("verdict") == "INFRA_FAILURE"
        and retrieval_row.get("classification") == "RETRIEVAL_INFRA_FAILURE",
        "12_a0005_clean": a0005.get("vector_sha_equal") is True and a0005.get("scenario_id") == "A-0005"
        and a0005.get("bindings_http") == 200 and a0005.get("match_http") == 200,
        "13_unarmed_deny": deny.get("verdict") == "INFRA_FAILURE"
        and "UNARMED_INFRA_EVENT" in (deny.get("quarantine_classifications") or []),
        "14_no_attempt_attribution": no_attempt.get("process_level") is True
        and no_attempt.get("misattributed_to_b") is False and no_attempt.get("joined") is True,
        "15_stale_visible": stale.get("visible_stale") is True and stale.get("b_not_stamped_with_a_as_own") is True,
        "16_bound_10s_turn": float((async_row.get("ten_second") or {}).get("elapsed_s") or 0) >= 9.0
        and async_row.get("cancelled_error_contained") is not True
        and (async_row.get("ten_second") or {}).get("capture_error") in (None, "")
        and async_row.get("verdict") in ("PASS", "FAIL"),
        "16b_bound_lifecycle": lifecycle.get("record_fail_closed") is False
        and bool(lifecycle.get("record_created_threads"))
        and lifecycle.get("turn_fail_closed") is False and lifecycle.get("turn_executor_closed") is True
        and lifecycle.get("turn_remaining_tasks") in (0, None),
        "16c_real_local_arm": (arm_obs.get("node") or {}).get("scenario_id") == "CORR6-REAL-LOCAL-ARM"
        and (arm_obs.get("loopback") or {}).get("scenario_id") == "CORR6-REAL-LOCAL-ARM",
        "17_self_mint_rejected": (wrappers.get("self_mint") or {}).get("verdict") == "NOT_EXECUTED"
        and proof.get("topology_self_mint") == "REJECTED",
        "18_import_scope_rejected": (wrappers.get("import_scope") or {}).get("verdict") == "NOT_EXECUTED"
        and (wrappers.get("import_scope") or {}).get("side_effect") is False,
        "19_cached_after_clear_rejected": all(value == "DENIED" for value in after_clear.values()) and bool(after_clear)
        and (wrappers.get("cached_module") or {}).get("verdict") == "NOT_EXECUTED",
        "20_python_violations_redacted": pyviol.get("leaked_secret_count") == 0 and int(pyviol.get("count") or 0) >= 3,
        "wrapper_matrix_all_rejected": bool(wrappers) and all(
            row.get("verdict") != "PASS" and not row.get("product_returned") and not row.get("side_effect")
            and "PRODUCT_BINDING_REQUIRED" in (row.get("reason") or "")
            for row in wrappers.values()
        ),
        "matrix_positive_control": (matrix.get("positive_control") or {}).get("product_executed") is True,
        "matrix_negatives_rejected": bool(negative_rows) and all(
            row.get("verdict") == "NOT_EXECUTED" and row.get("product_executed") is False
            for row in negative_rows.values()
        ),
        "capability_replay_rejected": (replay.get("capture") or {}).get("authority_valid_in_a") is True
        and bool((replay.get("capture") or {}).get("captured_capability_id"))
        and (replay.get("replay_bound") or {}).get("captured_present") is True
        and (replay.get("replay_bound") or {}).get("own_authority_still_valid") is True
        and (replay.get("replay_bound") or {}).get("current_capability_id")
        != (replay.get("capture") or {}).get("captured_capability_id")
        and all(
            str(value).startswith("REJECTED")
            for row in (replay.get("replay_bound") or {}, replay.get("replay_unbound") or {})
            for key, value in row.items() if key.startswith(("install_", "begin_"))
        )
        and str((replay.get("replay_unbound") or {}).get("product_call_after_replay", "")).startswith("DENIED")
        and (replay.get("replay_unbound") or {}).get("side_effect") is False
        and (replay.get("replay_unbound") or {}).get("authority_installed") is False,
        "generation_replay_rejected": (generation.get("relaunch") or {}).get("ok") is True
        and generation.get("before_call_ok") is True
        and "OTHER_GENERATION" in str(generation.get("after_denied_reason") or "")
        and generation.get("after_side_effect") is False,
        "no_scenarios": proof.get("scenarios_executed") == 0,
        "provider_contact_none": proof.get("provider_contact") == "NONE",
    }
    return {key: bool(value) for key, value in raw.items()}


def run_corr6_topology() -> dict[str, Any]:
    root = _select_root()
    replica = root / "navigator-replica"
    proof: dict[str, Any] = {
        "ok": False,
        "act": "IMPLEMENTATION-1.CORR6",
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "scenarios_executed": 0,
        "chatbot_test_base": str(CHATBOT_TEST_BASE),
        "artifact_root": str(root),
        "replica_reused_from_corr5": False,
        "replica_reused_from_corr4": False,
    }
    loopback: LoopbackSupabaseDouble | None = None
    stub: _LocalProviderStub | None = None
    processes: list[Any] = []
    claimed = False
    saved_env = {key: os.environ.get(key) for key in ("NAVIGATOR_TEST_ROOT", "TIKHON_TEST_ROOT")}
    os.environ["NAVIGATOR_TEST_ROOT"] = NAVIGATOR_TEST_ROOT
    os.environ["TIKHON_TEST_ROOT"] = str(CHATBOT_TEST_BASE)
    try:
        try:
            claim_evidence_directory(root)
            claimed = True
        except FileExistsError as exc:
            proof["reason"] = str(exc)
            return proof
        frozen = load_frozen_authority()
        proof["frozen_authority"] = {
            "loaded": True,
            "sha256": frozen["_artifact_sha256"],
            "runtime_surface_aggregate_sha256": frozen["runtime_surface_aggregate_sha256"],
            "surface_aggregate_sha256": frozen["runtime_surface"]["aggregate_sha256"],
            "entry_count": frozen["runtime_surface"]["entry_count"],
            "package_lock_sha256": frozen["package_lock"]["sha256"],
        }
        proof["origin_attestation"] = _attestation_summary(attest_origin_next_runtime())
        profile_path = root / "network-deny.sb"
        profile_path.write_text(SANDBOX_PROFILE, encoding="utf-8")
        replica_info = build_sanitized_replica(replica)
        proof["replica"] = replica_info.get("replica")
        proof["env_files_copied"] = replica_info.get("env_files_copied")
        proof["replica_origin_attestation"] = replica_info.get("origin_attestation")
        proof["replica_attestation"] = _attestation_summary(attest_replica_next_runtime(replica))
        proof["node_attestation"] = {k: v for k, v in attest_node_executable(frozen).items() if k != "realpath"}
        proof["node_realpath"] = frozen["node_executable"]["realpath"]
        proof["preload_attestation"] = attest_preload(frozen, PRELOAD_PATH)
        loopback = LoopbackSupabaseDouble()
        from execution_infrastructure.attempt_binding import register_active_loopback

        register_active_loopback(loopback)
        loopback_url = loopback.start()
        stub = _LocalProviderStub()
        stub_url = stub.start()
        hostile_bin, hostile_marker = _hostile_path(root)
        hostile_require = root / "hostile-require.js"
        hostile_require.write_text(f"require('fs').writeFileSync('{hostile_marker}', 'x');\n", encoding="utf-8")

        def launch(tag: str) -> Any:
            ledger_path = root / f"node-ledger-{tag}.json"
            state_path = root / f"preload-state-{tag}.json"
            port = _free_port()
            env = {
                "PATH": str(hostile_bin) + ":" + os.environ.get("PATH", ""),
                "NODE_OPTIONS": f"--require {hostile_require}",
                "DYLD_INSERT_LIBRARIES": str(root / "absent.dylib"),
                "HOME": str(root / "empty-home"),
                "TMPDIR": str(root),
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
                build_log=root / f"next-build-{tag}.log",
                start_log=root / f"next-start-{tag}.log",
                state_path=state_path,
                ledger_path=ledger_path,
                preload_path=PRELOAD_PATH,
            )
            processes.append(cap.start_process)
            os.environ["ACADEMY_EXECUTION_PRELOAD_STATE"] = str(state_path)
            os.environ["ACADEMY_NODE_LEDGER_PATH"] = str(ledger_path)
            os.environ["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
            os.environ["ACADEMY_CORR4_LOOPBACK_URL"] = loopback_url
            os.environ["ACADEMY_LOCAL_PROVIDER_STUB"] = stub_url
            proofs = issue_controlled_proofs(cap, loopback)
            clear_controlled_context()
            ctx = mint_controlled_context(proofs)
            permit_scenario_body()
            return cap, ctx, round(time.monotonic() - started, 3)

        cap, ctx, seconds = launch("gen1")
        proof["next_build_seconds"] = seconds
        proof["build_returncode"] = cap.build_process.returncode if cap.build_process else None
        proof["build_pass"] = bool(cap.build_process and cap.build_process.returncode == 0)
        proof["build_marker"] = cap.build_marker
        proof["build_argv"] = [str(item) for item in cap.build_process.args]
        proof["node_executable_used"] = cap.node_executable
        proof["capability_id"] = cap.capability_id
        proof["node_pid"] = cap.node_pid
        proof["build_id"] = cap.build_id
        proof["next_runtime_identity"] = {
            key: value for key, value in cap.next_runtime_identity.items() if key != "mismatches"
        }
        health = _get_json(cap.control_url + "/health")
        proof["next_health"] = {
            "next_server": health.get("next_server"),
            "pid": health.get("pid"),
            "argv_has_start": health.get("argv_has_start"),
            "fetch_patched": health.get("fetch_patched"),
        }
        proof["minted"] = True
        proof["context_generation"] = (ctx.proof_identity or {}).get("generation")
        proof["preload_instance_id"] = cap.preload_instance_id
        proof["ledger_instance_id"] = cap.ledger_instance_id
        proof["hostile_node_executed"] = hostile_marker.exists()
        attempts = root / "attempts"
        proof["clean"] = _run("CORR6-CLEAN", "corr4_clean", attempts / "clean")
        proof["armed_http500"] = _run("CORR6-ARMED-500", "corr4_armed_http500", attempts / "armed-500")
        proof["armed_retrieval"] = _run("CORR6-ARMED-RETRIEVAL", "corr4_armed_retrieval", attempts / "retrieval")
        proof["a0005"] = _probe_chain(cap.control_url, loopback_url, "A-0005")
        proof["unarmed_deny"] = _run("CORR6-UNARMED-DENY", "corr4_unarmed_deny", attempts / "unarmed-deny")
        proof["no_attempt_start"] = _no_attempt_during_b(cap.control_url)
        proof["stale"] = _stale_during_b(cap.control_url, attempts)
        proof["async_10s"] = _run("CORR6-ASYNC-10S", "corr4_ten_second", attempts / "async-10s", wall_budget_s=180.0)
        proof["async_10s"]["ten_second"] = dict(TEN_SECOND)
        lifecycle_run = _run("CORR6-BOUND-LIFECYCLE", "corr6_BoundLifecycleProbeAdapter", attempts / "bound-lifecycle")
        proof["bound_lifecycle"] = dict(producers.RESULTS.get("bound_lifecycle") or {})
        proof["bound_lifecycle"]["verdict"] = lifecycle_run["verdict"]
        arm_run = _run("CORR6-REAL-LOCAL-ARM", "corr6_BoundRealLocalArmProbeAdapter", attempts / "real-local-arm")
        proof["real_local_arm"] = dict(producers.RESULTS.get("real_local_arm") or {})
        proof["real_local_arm"]["verdict"] = arm_run["verdict"]
        authority_run = _run("CORR6-BOUND-AUTHORITY", "corr6_BoundAuthorityProbeAdapter", attempts / "bound-authority")
        proof["bound_authority"] = {
            "verdict": authority_run["verdict"],
            **{k: v for k, v in (producers.RESULTS.get("bound_authority") or {}).items()},
        }
        try:
            pc.mint_accepted_authority("corr6-topology")
            proof["topology_self_mint"] = "ACCEPTED"
        except pc.ProductBindingRequired:
            proof["topology_self_mint"] = "REJECTED"
        after_clear: dict[str, str] = {}
        kept_class = producers.RESULTS.get("kept_class")
        kept_method = producers.RESULTS.get("kept_method")
        kept_module = producers.RESULTS.get("kept_module")
        probe_db = root / "after-clear.sqlite"
        for label, call in (
            ("kept_class_construct", lambda: kept_class(db_path=probe_db)),
            ("kept_method_call", lambda: kept_method(object(), 1, "u", "f", "s", "m", "SENT", None)),
            ("cached_sys_modules_call", lambda: sys.modules["data_engine.outreach"].OutreachHistoryManager(db_path=probe_db)),
            ("kept_module_function", lambda: kept_module.format_navigator_message()),
        ):
            try:
                call()
                after_clear[label] = "EXECUTED"
            except pc.ProductBindingRequired:
                after_clear[label] = "DENIED"
        if probe_db.exists():
            after_clear["side_effect"] = "EXECUTED"
        proof["cached_after_clear"] = after_clear
        proof["wrapper_matrix"] = _wrapper_matrix(attempts)
        pyviol_run = _run("CORR6-PYVIOL", "corr6_PythonViolationSecretsAdapter", attempts / "pyviol")
        stored = collected_evidence("CORR6-PYVIOL", 1) or {}
        blob = json.dumps(stored.get("python_violations") or [], ensure_ascii=False, default=str)
        proof["python_violations"] = {
            "verdict": pyviol_run["verdict"],
            "count": len(stored.get("python_violations") or []),
            "leaked_secret_count": sum(1 for item in SECRET_SHAPES if item in blob),
        }
        proof["product_authority_matrix"] = _product_matrix(attempts / "matrix")
        proof["capability_replay"] = _capability_replay(attempts)

        def relaunch() -> dict[str, Any]:
            try:
                old_generation = (require_controlled_context().proof_identity or {}).get("generation")
                _stop_process(cap.start_process)
                cap2, ctx2, seconds2 = launch("gen2")
                return {
                    "ok": True,
                    "old_generation": old_generation,
                    "new_generation": (ctx2.proof_identity or {}).get("generation"),
                    "new_capability_id": cap2.capability_id,
                    "next_build_seconds": seconds2,
                    "build_pass": bool(cap2.build_process and cap2.build_process.returncode == 0),
                }
            except Exception as exc:  # noqa: BLE001 — recorded by the probe
                return {"ok": False, "reason": f"{type(exc).__name__}: {exc}"}

        producers.HOOKS["relaunch"] = relaunch
        try:
            generation_run = _run("CORR6-GENERATION", "corr6_BoundGenerationChangeAdapter", attempts / "generation")
        finally:
            producers.HOOKS.pop("relaunch", None)
        proof["generation_change"] = dict(producers.RESULTS.get("generation_change") or {})
        proof["generation_change"]["verdict"] = generation_run["verdict"]
        proof["guard_stats"] = pc.guard_stats()
        proof["scenarios_executed"] = ctx.scenarios_executed
        proof["scenario_body_permitted"] = ctx.scenario_body_permitted
        checks = _checks(proof)
        proof["checks"] = checks
        proof["ok"] = all(checks.values())
        if not proof["ok"]:
            proof["reason"] = "topology checks failed: " + ",".join(name for name, ok in checks.items() if not ok)
    except Exception as exc:  # noqa: BLE001 — record the failure and still stop processes
        proof["ok"] = False
        proof["reason"] = f"{type(exc).__name__}: {exc}"
        proof["traceback"] = traceback.format_exc()[-4000:]
    finally:
        pc.clear_product_authority()
        clear_controlled_context()
        clear_live_run()
        for process in processes:
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
        proof["next_processes_stopped"] = all(process.poll() is not None for process in processes if process is not None)
        if claimed and not finalized_artifact_root(root):
            target = root / "REAL_TOPOLOGY_CORR6_PROOF.json"
            if not target.exists():
                target.write_text(
                    json.dumps(proof, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n",
                    encoding="utf-8",
                )
                proof["proof_path"] = str(target)
    return proof


def main() -> int:
    sys.dont_write_bytecode = True
    from execution_infrastructure.process_hygiene import install_suite_hygiene

    install_suite_hygiene("corr6-topology")
    proof = run_corr6_topology()
    print(json.dumps({
        "ok": proof.get("ok"),
        "reason": proof.get("reason"),
        "checks": proof.get("checks"),
        "proof_path": proof.get("proof_path"),
    }, indent=2, default=str))
    return 0 if proof.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
