"""CORR6 focused closing artifacts (IV6 owner sections 45-47).

FOCUSED validation only (owner section 7): the CORR6 findings, the 924
corpus construction, seed preservation, contract compilation with semantic
negative fixtures, pruning/coverage validation, redundancy analysis,
distribution, directly adjacent canary gate, focused RAG regression,
deterministic fresh regeneration, and the non-self-referential manifest
with detached digest. Historical IV2-IV5 suites are NOT reritually
re-executed by this pipeline.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def run_suite(cmd: list[str]) -> dict:
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    proc = subprocess.run([sys.executable, *cmd], cwd=str(BENCH), env=env,
                          capture_output=True, text=True, timeout=900)
    return {"exit": proc.returncode, "tail": proc.stdout.strip()[-400:]}


def main() -> int:
    artifacts = BENCH / "artifacts"

    # ---- 1. CORR6 focused regression battery -----------------------------------
    battery = run_suite(["tests/iv6_regression_battery.py"])
    print(f"suite iv6_battery: exit={battery['exit']}")
    if battery["exit"] != 0:
        print("  tail:", battery["tail"])
        return 1

    # ---- 2. fresh deterministic regeneration from the frozen 996 input --------
    regen_root = Path(tempfile.mkdtemp(prefix="corr6-regen-", dir="/tmp"))
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
           "CORR6_OUT_ROOT": str(regen_root),
           "CORR6_INPUT_CORPUS": str(BENCH / "corpus" / "corr5_input_996.jsonl")}
    regen = subprocess.run([sys.executable, "corpus/repair_v6.py"], cwd=str(BENCH),
                           env=env, capture_output=True, text=True, timeout=900)
    if regen.returncode != 0:
        print("fresh regeneration FAILED:", regen.stdout[-400:], regen.stderr[-400:])
        return 1
    compare = [
        "corpus/corrected_corpus_84.jsonl", "corpus/CORPUS_SHA256.txt",
        "seeds/seeds_30_corrected.jsonl", "seeds/SEED_SYNC_REPORT.json",
        "corpus/distribution.json", "corpus/EFFECTIVE_STIMULUS_REPORT.json",
        "corpus/SEMANTIC_DUPLICATE_REPORT.json", "corpus/REPAIR_LOG.json",
        "corpus/CORPUS_COMPLETENESS_REPORT.json",
        "corpus/EXPECTATION_CONSISTENCY_REPORT.json",
        "corpus/VALIDATION_ERRORS.json", "corpus/SEED_NATIVE_CONTRACT_MATRIX.json",
        "corpus/SCENARIO_COMPILED_CONTRACTS.json",
        "corpus/CORPUS_PRUNING_PLAN_996_TO_924.json",
        "corpus/CORPUS_924_COVERAGE_RETENTION_REPORT.json",
        "corpus/SEMANTIC_DRIFT_REPORT.json",
        "corpus/PROVIDER_FIXTURE_REGISTRY.json",
        "corpus/STATIC_QUERY_REGISTRY.json",
        "corpus/FAULT_MECHANISM_REGISTRY.json",
        "corpus/CONCURRENCY_MECHANISM_REGISTRY.json",
        "corpus/CORR5_INPUT_996_IDENTITY.json",
    ]
    diffs = [rel for rel in compare
             if sha256_file(regen_root / rel) != sha256_file(BENCH / rel)]
    regen_doc = {
        "schema": "FRESH_REGEN_CHECK_V6",
        "method": ("clean /tmp regeneration from the frozen CORR5_INPUT_996 "
                   "(corpus/corr5_input_996.jsonl, sha256 ec591ef1b91eeb58a8873ae8"
                   "ec4920018f8ce26e3393b88c5b2cf32c6aac9a42) via corpus/repair_v6.py"),
        "artifacts_compared": compare,
        "unexpected_differences": diffs,
        "deterministic": not diffs,
    }
    (artifacts / "FRESH_REGEN_CHECK.json").write_text(
        json.dumps(regen_doc, ensure_ascii=False, indent=2))
    print("fresh-regen deterministic:", regen_doc["deterministic"], "| diffs:", diffs)
    if diffs:
        return 1

    # ---- 3. compiler semantic-negative fixtures (owner §38/§45) ---------------
    from harness.contract_compile import AdapterCapability, compile_scenario_contract
    from adapters.product import native_conversation_state_fixture

    def _l2(sid="NEG"):
        return {"scenario_id": sid, "failure_class": "ST-02", "track": "TIKHON",
                "execution_level": "L2", "seam_class": "RUNTIME",
                "adapter_id": "navigator_l2_chat_api", "turns": [], "expected": {},
                "oracle": [{"oracle": "outcome_class", "params": {}}],
                "state_setup": {"profile": {"displayName": "Т", "addressMode": "VY",
                                            "nameDeclined": False,
                                            "pendingUserRequest": None}},
                "route_precondition": "COMPLETE_PROFILE_PROVIDED",
                "failure_mechanism": "content measurement", "trigger": "t",
                "observable_effect": "e", "why_this_scenario_tests_this_class": "w",
                "sut_binding": {"adapter_id": "x"}}

    def _fixture(sid):
        return {"schema": "NAVIGATOR_RESPONSE_FIXTURE_V2", "fixture_id": "PF-X",
                "responses": [
                    {"fixture_id": "PF-X",
                     "response": {"message": "m",
                                  "profile": {"displayName": None, "addressMode": None,
                                              "nameDeclined": False,
                                              "pendingUserRequest": None},
                                  "conversationState": native_conversation_state_fixture(
                                      course_id=None, act="META", content="m"),
                                  "contactCard": None, "resetConversation": False}}],
                "contention_schedule": {"provider_pause_s": 0.05}}

    def _static(sid, queries):
        return {"scenario_id": sid, "failure_class": "TG-15", "track": "TIKHON",
                "execution_level": "L1", "seam_class": "NO_SEAM",
                "adapter_id": "static_source_inventory", "turns": [], "expected": {},
                "oracle": [{"oracle": "static_config",
                            "params": {"expectations": [
                                {"path": queries[0]["fact"], "value": True}]}},
                           {"oracle": "no_runtime_claim", "params": {}}],
                "preconditions": {"static_queries": queries},
                "failure_mechanism": "webhook origin auth", "trigger": "t",
                "observable_effect": "e",
                "why_this_scenario_tests_this_class": "w",
                "sut_binding": {"adapter_id": "x"}}

    def _c_row(sid, **over):
        row = {"scenario_id": sid, "failure_class": "ST-18", "track": "ALEXEY_INBOUND",
               "execution_level": "L5", "seam_class": "RUNTIME",
               "adapter_id": "alexey_user_turn",
               "turns": [{"role": "user", "content": "Хочу Маслоу"}],
               "expected": {"state": {"701001": {"selectedCourseId": "maslow"}}},
               "oracle": [{"oracle": "same_user_serialization_proven",
                           "params": {"workers": 2}},
                          {"oracle": "concurrency_invariant",
                           "params": {"per_user": True,
                                      "expected_state": {"701001":
                                                         {"selectedCourseId": "maslow"}}}}],
               "preconditions": {"user_id": 701001,
                                 "concurrency_schedule": {"provider_pause_s": 0.05}},
               "concurrency_workers": 2, "replay_set": "C",
               "concurrency_mechanism_id": "ALEXEY.SAME_USER_SERIALIZATION",
               "failure_mechanism": "same-user burst serialization", "trigger": "t",
               "observable_effect": "e",
               "why_this_scenario_tests_this_class": "w",
               "sut_binding": {"adapter_id": "x"}}
        row.update(over)
        return row

    negative_cases = {
        "state_expectation_wrong_projection": (
            {"scenario_id": "N1", "failure_class": "TG-07", "track": "ALEXEY_INBOUND",
             "execution_level": "L5", "seam_class": "RUNTIME",
             "adapter_id": "alexey_user_turn", "turns": [],
             "expected": {"state": {"selectedCourseId": "maslow"}},
             "oracle": [{"oracle": "state_subset",
                         "params": {"expected_state": {"selectedCourseId": "maslow"}}}],
             "failure_mechanism": "m", "trigger": "t", "observable_effect": "e",
             "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"}},
            "alexey_user_turn"),
        "static_unrelated_fact_no_declared_question": (
            _static("N2", [{"query_type": "SYMBOL_EXISTS", "file": "main.py",
                            "symbol": "json", "fact": "unrelated_fact",
                            "expected_value": True}]),
            "static_source_inventory"),
        "static_callback_data_as_callee": (
            _static("N3", [{"query_type": "CALL_SITE_EXISTS", "file": "main.py",
                            "call": "confirm:ind_terms", "fact": "seam",
                            "expected_value": True,
                            "declared_question": "checkout seam presence"}]),
            "static_source_inventory"),
        "provider_fixture_unregistered_identity": (
            {**_fixture("N4"), "fixture_id": "PF-UNREGISTERED"},
            "fixture_adapter"),
        "concurrency_without_contention_schedule": (
            _c_row("N5", preconditions={"user_id": 701001}),
            "alexey_user_turn"),
        "cross_session_without_multistep": (
            {**_l2("N6"), "failure_mechanism": "Cross-session memory leakage"},
            "navigator_l2_chat_api"),
        "set_s_onboarding_route": (
            {**_l2("N7"), "replay_set": "S", "route_precondition":
             "ONBOARDING_IS_THE_MECHANISM",
             "state_setup": {"profile": {"displayName": None, "addressMode": None,
                                         "nameDeclined": False,
                                         "pendingUserRequest": None}}},
            "navigator_l2_chat_api"),
    }
    neg_results = []
    for name, (spec, adapter) in negative_cases.items():
        if adapter == "fixture_adapter":
            from harness.contract_compile import (
                FIXTURE_CONSUMPTION_ADAPTERS as _F, POLICY_MEASUREMENT_ADAPTERS as _P)
            base = {**_c_row("N4"), "provider_fixture": spec}
            cap = AdapterCapability("alexey_user_turn")
        else:
            base = spec
            cap = AdapterCapability(adapter)
        cc = compile_scenario_contract(base, cap)
        neg_results.append({"negative": name, "rejected": not cc.compiled,
                            "defects": cc.defects[:2]})
    rejected_all = all(r["rejected"] for r in neg_results)
    (artifacts / "COMPILER_SEMANTIC_NEGATIVE_FIXTURES.json").write_text(json.dumps({
        "schema": "COMPILER_SEMANTIC_NEGATIVE_FIXTURES_V1",
        "method": ("owner §38: the compiler must reject state expectations on the "
                   "wrong projection, static assertions unrelated to the declared "
                   "mechanism (incl. missing declared question / callback-data "
                   "callees), unregistered provider fixture identities, concurrency "
                   "contracts without a contention schedule, cross-session claims "
                   "without explicit causal steps, and Set S rows that cannot reach "
                   "their declared variable path"),
        "cases": neg_results,
        "all_rejected": rejected_all,
    }, ensure_ascii=False, indent=2))
    print("compiler semantic-negative fixtures:", "ALL REJECTED" if rejected_all
          else "FAIL", f"({len(neg_results)} cases)")
    if not rejected_all:
        for r in neg_results:
            if not r["rejected"]:
                print("  NOT rejected:", r["negative"], r["defects"])
        return 1

    # ---- 4. focused RAG regression (closed F05 not regressed) ------------------
    from adapters.rag_fixture_suite import run_rag_fixture_suite
    rag = run_rag_fixture_suite(str(artifacts / "RAG_FIXTURE_SUITE_RESULTS.json"))
    print("focused RAG regression:", f"{rag['passed']}/{rag['total']}")
    if not rag["all_pass"]:
        return 1

    # ---- 5. directly adjacent canary gate (oracle mutation — F04-F14) ----------
    canaries = run_suite(["canaries/build_and_run_canaries.py"])
    print(f"suite canaries (adjacent gates): exit={canaries['exit']}")
    if canaries["exit"] != 0:
        print("  tail:", canaries["tail"])
        return 1
    can = json.loads((BENCH / "canaries" / "CANARY_RESULTS.json").read_text())
    if can["summary"].get("oracle_mutation") != "PASS":
        print("adjacent oracle_mutation gate not PASS")
        return 1

    # ---- 6. state-machine invariants artifact refresh ---------------------------
    from harness.execution_state import run_state_machine_invariants
    inv = run_state_machine_invariants()
    (artifacts / "STATE_MACHINE_INVARIANT_RESULTS.json").write_text(json.dumps({
        "schema": "STATE_MACHINE_INVARIANT_RESULTS_V1",
        "total": len(inv),
        "passed": sum(1 for r in inv if r["pass"]),
        "failed": sum(1 for r in inv if not r["pass"]),
        "all_pass": all(r["pass"] for r in inv),
        "invariants": inv,
    }, ensure_ascii=False, indent=2))
    if not all(r["pass"] for r in inv):
        return 1

    # ---- 7. evidence inventory ---------------------------------------------------
    ev_root = BENCH / "evidence_runs"
    ev_files = sorted(str(p.relative_to(ev_root)).replace(os.sep, "/")
                      for p in ev_root.rglob("*.json")) if ev_root.exists() else []
    (artifacts / "EVIDENCE_INVENTORY.json").write_text(json.dumps({
        "schema": "EVIDENCE_INVENTORY_V4",
        "root": "benchmarks/academy-telegram-live-regression-1000-1/evidence_runs",
        "files": ev_files,
        "generated_at": NOW,
    }, ensure_ascii=False, indent=2))

    # ---- 8. distribution rationale ------------------------------------------------
    dist = json.loads((BENCH / "corpus" / "distribution.json").read_text())
    (artifacts / "DISTRIBUTION_RATIONALE.json").write_text(json.dumps({
        "schema": "DISTRIBUTION_RATIONALE_V6",
        "distribution": dist,
        "derivation": ("recomputed from the quality-pruned 924 corpus: no old "
                       "quota was preserved; membership derives ONLY from "
                       "actual valid retained mechanisms"),
        "replay_sets": {
            "C": ("4 rows with VALID typed concurrency contracts: 2 same-user "
                  "serialization (A-0011, C-0005) and 2 different-user "
                  "independence (B-0007, C-0003), each with a benchmark-"
                  "controlled contention schedule; the 27 pruned C rows were "
                  "weak duplicates under IV6-F12A/F12B"),
            "F": ("10 rows on the registered ALEXEY.LOST_RESPONSE.AFTER_"
                  "PERSISTENCE mechanism (real post-persistence order)"),
            "S": ("43 route-reachable orchestration rows (44 - A-0140, "
                  "legitimately pruned: its manager-request control turn "
                  "cannot reach orchestration — IV6-F15 §35)"),
        },
        "distribution_frozen": False,
        "planned_observations_note": ("planned observation specifications, not "
                                      "measured executions"),
    }, ensure_ascii=False, indent=2))

    # ---- 9. non-self-referential manifest + detached digest -----------------------
    manifest_lines = []
    manifest_path = artifacts / "ARTIFACT_MANIFEST_SHA256.txt"
    for path in sorted(BENCH.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(BENCH).as_posix()
        if rel.startswith("evidence_runs/"):
            continue
        if rel == manifest_path.relative_to(BENCH).as_posix():
            continue
        if rel == (artifacts / "ARTIFACT_MANIFEST_SHA256.txt.sha256").relative_to(BENCH).as_posix():
            continue
        if rel.endswith(".pyc") or "__pycache__" in rel:
            continue
        manifest_lines.append(f"{sha256_file(path)}  {rel}")
    manifest_path.write_text("\n".join(manifest_lines) + "\n")
    (artifacts / "ARTIFACT_MANIFEST_SHA256.txt.sha256").write_text(
        f"{sha256_file(manifest_path)}  ARTIFACT_MANIFEST_SHA256.txt\n")
    print("manifest entries:", len(manifest_lines))

    battery_doc = json.loads((artifacts / "IV6_REGRESSION_BATTERY.json").read_text())
    ok = (battery["exit"] == 0 and battery_doc["all_pass"]
          and regen_doc["deterministic"] and rejected_all and rag["all_pass"]
          and canaries["exit"] == 0 and all(r["pass"] for r in inv))
    print("CORR6 focused closing gate:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
