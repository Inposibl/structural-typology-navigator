"""CORR5 closing artifacts (IV5 owner sections 36-45).

One deterministic pipeline:
    source definitions -> validation -> corpus -> seeds -> coverage ->
    duplicates -> distribution -> machine report -> manifest.

This builder produces/verifies: registry + native contract audit, ASV audit,
adapter constructibility report, RAG diagnostic capture contract + TYPED
schema + fixture results, canonical byte-state candidate, TEST_BASE binding
spec, evidence inventory, typed claim ledger (with the COMPLETE dependency
closure of F10) + machine narrative + consistency gate, the state-machine
invariant results, the IV5 regression battery, distribution rationale, the
FRESH-REGENERATION determinism check (byte identity against a clean /tmp
regeneration from the frozen CORR4 input), and the non-self-referential
manifest with detached digest.
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

from harness.gates.anti_self_validation import run_audit  # noqa: E402
from harness.gates.claim_ledger import ClaimEngine, ReportRenderer  # noqa: E402
from harness.gates.narrative_consistency import check_structured_report  # noqa: E402
from harness.seams import sut_binding  # noqa: E402
from adapters.registry import audit_native_contracts, save_registry  # noqa: E402

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

    # ---- 0. registry + native contract audit ---------------------------------
    validation = audit_native_contracts()
    if not validation["all_valid"]:
        print("native contract audit FAILED")
        return 1
    save_registry(str(artifacts / "ADAPTER_REGISTRY.json"))
    (artifacts / "ADAPTER_NATIVE_CONTRACT_AUDIT.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2))

    # ---- 1. ASV static audit ---------------------------------------------------
    audit = run_audit(str(BENCH), out_path=str(artifacts / "ANTI_SELF_VALIDATION_STATIC_AUDIT.json"))
    print("ASV violations:", audit["violations"], "pass:", audit["pass"])
    if not audit["pass"]:
        return 1

    # ---- 2. adapter constructibility (B-04) ------------------------------------
    from adapters.constructibility import save_report as save_constructibility
    cst = save_constructibility(str(artifacts / "ADAPTER_CONSTRUCTIBILITY_REPORT.json"))
    if not cst["all_required_product_adapters_ready"]:
        print("constructibility FAILED")
        return 1

    # ---- 3. RAG capture contract + TYPED schema + benign fixtures (F05) --------
    from adapters.rag_fixture_suite import (run_rag_fixture_suite, write_contract,
                                            write_schema)
    write_contract(str(artifacts / "RAG_DIAGNOSTIC_CAPTURE_CONTRACT.json"))
    write_schema(str(artifacts / "RAG_DIAGNOSTIC_SCHEMA.json"))
    rag = run_rag_fixture_suite(str(artifacts / "RAG_FIXTURE_SUITE_RESULTS.json"))
    print("RAG fixture suite:", f"{rag['passed']}/{rag['total']}")
    if not rag["all_pass"]:
        return 1

    # ---- 4. canonical byte-state candidate (M-02; IV5-accepted policy) ---------
    bs = subprocess.run([sys.executable, "artifacts/build_byte_state_v4.py"],
                        cwd=str(BENCH), capture_output=True, text=True,
                        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    if bs.returncode != 0:
        print("byte-state builder FAILED:", bs.stdout[-300:], bs.stderr[-300:])
        return 1
    print("byte-state:", bs.stdout.strip().splitlines()[0])

    # ---- 5. author suites (harness-local only) ----------------------------------
    suites = {
        "self": run_suite(["tests/run_all.py"]),
        "battery_iv3": run_suite(["tests/iv3_regression_battery.py"]),
        "battery_iv4": run_suite(["tests/iv4_regression_battery.py"]),
        "battery_iv5": run_suite(["tests/iv5_regression_battery.py"]),
        "canaries": run_suite(["canaries/build_and_run_canaries.py"]),
    }
    for name, r in suites.items():
        print(f"suite {name}: exit={r['exit']}")
        if r["exit"] != 0:
            print("  tail:", r["tail"])
            return 1

    # ---- 6. TEST_BASE binding spec (carried contract) ---------------------------
    binding_now = sut_binding.bind_test_bases()
    spec_doc = {
        "schema": "TEST_BASE_BINDING_SPEC_V2",
        "generated_at": NOW,
        "binding_contract": {
            "NAVIGATOR_TEST_ROOT": {
                "identity_type": "SHA",
                "expected_branch": sut_binding.EXPECTED_NAVIGATOR["branch"],
                "expected_head": sut_binding.EXPECTED_NAVIGATOR["head"],
                "tracked_tree": "must be CLEAN at the TEST_BASE commit",
            },
            "TIKHON_TEST_ROOT": {
                "identity_type": "ACCEPTED_BYTE_STATE",
                "expected_branch": sut_binding.EXPECTED_TIKHON["branch"],
                "expected_head": sut_binding.EXPECTED_TIKHON["head"],
                "byte_state_manifest": {
                    "path": "tests/_testbase/accepted-byte-state.json (inside the bound root)",
                    "authority": "externally pinned canonical candidate digest",
                },
            },
            "history_root": sut_binding.HISTORY_ROOT,
            "history_rule": "any configured runtime source resolving under History fails closed",
            "live_tree_rule": "live product trees are refused as TEST_BASE roots",
            "runner_order": "binding gate runs BEFORE any adapter invocation; unbound -> 0 calls",
        },
        "current_binding_state": binding_now,
        "current_state_note": ("Harness-only suites run in the CALIBRATION lane; product "
                               "roots bind at the later authorized execution act. "
                               "REAL_TEST_BASE_BINDING = NOT_YET_EXECUTED."),
    }
    (artifacts / "TEST_BASE_BINDING_SPEC.json").write_text(
        json.dumps(spec_doc, ensure_ascii=False, indent=2))
    (artifacts / "ACCEPTED_BYTE_STATE_SCHEMA.json").write_text(json.dumps({
        "schema": "ACCEPTED_BYTE_STATE_MANIFEST_SCHEMA_V1",
        "manifest_version": sut_binding.BYTE_STATE_MANIFEST_VERSION,
        "fields": {
            "manifest_version": "string, must equal " + sut_binding.BYTE_STATE_MANIFEST_VERSION,
            "head": "40-hex commit SHA, must equal the expected TEST_BASE HEAD",
            "tracked_modified": "object {repo-relative path: sha256}",
            "deleted_paths": "array of repo-relative paths accepted as deleted",
            "untracked_overlay": "object {repo-relative path: sha256} under the EXPLICIT CORR4 overlay policy",
            "overlay_included_classes": "explicit controlled families (no blanket docs/*)",
            "excluded_classes": "explicit never-controlled/never-read classes",
            "manifest_sha256": "sha256 of the canonical JSON of all other fields",
        },
        "attestation": "every controlled byte matches; extras under the policy fail; deleted paths absent",
    }, ensure_ascii=False, indent=2))

    # ---- 7. evidence inventory (registered FILE_ABSENCE source) ----------------
    ev_root = BENCH / "evidence_runs"
    ev_files = sorted(str(p.relative_to(ev_root)).replace(os.sep, "/")
                      for p in ev_root.rglob("*.json")) if ev_root.exists() else []
    (artifacts / "EVIDENCE_INVENTORY.json").write_text(json.dumps({
        "schema": "EVIDENCE_INVENTORY_V4",
        "root": "benchmarks/academy-telegram-live-regression-1000-1/evidence_runs",
        "files": ev_files,
        "generated_at": NOW,
    }, ensure_ascii=False, indent=2))

    # ---- 8. fresh-regeneration determinism check (CORR5 pipeline) ---------------
    regen_root = Path(tempfile.mkdtemp(prefix="corr5-regen-", dir="/tmp"))
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1",
           "CORR5_OUT_ROOT": str(regen_root),
           "CORR5_INPUT_CORPUS": str(BENCH / "corpus" / "corr4_input_996.jsonl")}
    regen = subprocess.run([sys.executable, "corpus/repair_v5.py"], cwd=str(BENCH),
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
        "corpus/FAULT_MECHANISM_REGISTRY.json",
        "corpus/CONCURRENCY_MECHANISM_REGISTRY.json",
    ]
    diffs = [rel for rel in compare
             if sha256_file(regen_root / rel) != sha256_file(BENCH / rel)]
    regen_doc = {
        "schema": "FRESH_REGEN_CHECK_V5",
        "method": ("clean /tmp regeneration from the frozen CORR5 pipeline input "
                   "(corpus/corr4_input_996.jsonl, the IV5-accepted CORR4 corpus, "
                   "sha256 afdede02642e2e323d2c79a33a1bf7b7651a1fdca5fd3dc51da1a5df6617446e)"),
        "artifacts_compared": compare,
        "unexpected_differences": diffs,
        "deterministic": not diffs,
    }
    (artifacts / "FRESH_REGEN_CHECK.json").write_text(
        json.dumps(regen_doc, ensure_ascii=False, indent=2))
    print("fresh-regen deterministic:", regen_doc["deterministic"], "| diffs:", diffs)
    if diffs:
        return 1

    # ---- 9. distribution rationale (IV5 owner section 40) ------------------------
    dist = json.loads((BENCH / "corpus" / "distribution.json").read_text())
    stim = json.loads((BENCH / "corpus" / "EFFECTIVE_STIMULUS_REPORT.json").read_text())
    rationale = {
        "schema": "DISTRIBUTION_RATIONALE_V5",
        "distribution": dist,
        "derivation": ("recomputed from actual mechanism eligibility after the CORR5 "
                       "repairs — CORR4 counts were NOT preserved for their own sake; "
                       "the replay composition changed BY MECHANISM (typed concurrency "
                       "contracts; registered fault mechanisms; route-reachable S)"),
        "replay_sets": {
            "C": ("31 rows on the Alexey same-loop per-user native lock seam, SPLIT BY "
                  "REGISTERED MECHANISM since F12: 11 same-user rows prove contention + "
                  "serialization + state invariant (overlap NOT required); 20 "
                  "different-user rows prove independent-lock independence (overlap is "
                  "the relevant evidence there)"),
            "F": ("10 rows referencing the REGISTERED mechanism "
                  "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE: the native process_user_turn "
                  "completes its normal persistence, THEN the returned response is "
                  "suppressed by the benchmark fixture (real causal order since F13)"),
            "S": ("44 rows, all on the navigator_l2_chat_api LLM native local API with "
                  "COMPLETE profile route preconditions (F15): every S row reaches the "
                  "orchestration path for its non-onboarding mechanism"),
        },
        "effective_stimulus_accounting": {
            "redundancy_criterion": ("adapter-consumed stimulus + failure mechanism + "
                                     "material controlling assertion (track excluded; F17)"),
            "redundant_effective_scenarios": stim["redundant_effective_scenarios"],
            "shared_stimulus_groups": stim["shared_stimulus_groups"],
            "unique_native_stimuli": stim["unique_native_stimuli"],
            "note": "shared stimuli across distinct legitimate assertions are tagged, never claimed as distinct triggers",
        },
        "distribution_frozen": False,
        "planned_observations_note": ("planned observation specifications, not measured "
                                      "executions; no sanctioned live identity exists"),
    }
    (artifacts / "DISTRIBUTION_RATIONALE.json").write_text(
        json.dumps(rationale, ensure_ascii=False, indent=2))

    # ---- 10. typed claim ledger + dependency closure + machine narrative ---------
    engine = ClaimEngine()
    semcov_p = str(BENCH / "corpus" / "SEMANTIC_TAXONOMY_COVERAGE.json")
    engine.register("TAX-01", "TAXONOMY_COUNT", str(BENCH / "taxonomy" / "taxonomy_84.json"),
                    {}, "Controlling taxonomy class count (must equal 84): {value}.")
    engine.register("COR-01", "SCENARIO_COUNT", str(BENCH / "corpus" / "distribution.json"),
                    {}, "Corrected corpus candidate scenario count: {value}.")
    engine.register("COR-02", "CORPUS_SHA", str(BENCH / "corpus" / "CORPUS_SHA256.txt"),
                    {}, "Corrected corpus SHA-256 (derived by hashing the corpus artifact): {value}.")
    engine.register("COR-03", "CORPUS_SHA_EQUALITY", str(BENCH / "corpus" / "CORPUS_SHA256.txt"),
                    {}, "Independently derived corpus digest vs recorded authority: {value}.")
    engine.register("SEM-01", "CLASS_COVERAGE", semcov_p, {"aggregate": "status_counts"},
                    "Semantic coverage status counts (of 84 classes): {value}.")
    engine.register("SEED-01", "SEED_ID_SET", str(BENCH / "seeds" / "SEED_SYNC_REPORT.json"),
                    {}, "Exact 30 mandatory seed IDs preserved (computed set equality): {value}.")
    engine.register("SEED-02", "FILE_ABSENCE_COUNT", str(artifacts / "EVIDENCE_INVENTORY.json"),
                    {"pattern": "*.json"},
                    "Seed observation artifacts found in evidence_runs: {value} (0 = seeds NOT executed).")
    engine.register("ASV-01", "STATIC_AUDIT",
                    str(artifacts / "ANTI_SELF_VALIDATION_STATIC_AUDIT.json"), {},
                    "Anti-self-validation static audit violations: {value} (required: 0).")
    engine.register("CAN-01", "CANARY_GATE", str(BENCH / "canaries" / "CANARY_RESULTS.json"),
                    {"gate": "positive"}, "POSITIVE_CANARY gate result: {value}.")
    engine.register("CAN-02", "CANARY_GATE", str(BENCH / "canaries" / "CANARY_RESULTS.json"),
                    {"gate": "negative"}, "NEGATIVE_CANARY gate result: {value}.")
    engine.register("CAN-03", "CANARY_GATE", str(BENCH / "canaries" / "CANARY_RESULTS.json"),
                    {"gate": "oracle_mutation"}, "ORACLE_MUTATION_GATE result: {value}.")
    engine.register("CAN-04", "CANARY_GATE", str(BENCH / "canaries" / "CANARY_RESULTS.json"),
                    {"gate": "m6_measurement_invalid_guards"}, "M6 measurement-invalid guards: {value}.")
    engine.register("TST-01", "SELF_TEST_COUNT", str(artifacts / "SELF_TEST_RESULTS.json"),
                    {}, "Harness-only self-tests: {value}.")
    engine.register("BAT-01", "BATTERY_COUNT", str(artifacts / "IV3_REGRESSION_BATTERY.json"),
                    {}, "IV3 regression battery: {value}.")
    engine.register("BAT-02", "BATTERY_COUNT", str(artifacts / "IV4_REGRESSION_BATTERY.json"),
                    {}, "IV4 regression battery: {value}.")
    engine.register("BAT-03", "BATTERY_COUNT", str(artifacts / "IV5_REGRESSION_BATTERY.json"),
                    {}, "IV5 regression battery (owner section 42): {value}.")
    engine.register("INV-01", "SELF_TEST_COUNT",
                    str(artifacts / "STATE_MACHINE_INVARIANT_RESULTS.json"),
                    {}, "Unified verdict state-machine invariants: {value}.")
    engine.register("DUP-01", "EFFECTIVE_DUPLICATE_GROUPS",
                    str(BENCH / "corpus" / "SEMANTIC_DUPLICATE_REPORT.json"), {},
                    "Effective duplicate groups remaining after repair: {value}.")
    ledger_doc = engine.to_json(str(artifacts / "REPORT_CLAIM_LEDGER.json"))
    closure = engine.dependency_closure_report()
    (artifacts / "CLAIM_DEPENDENCY_CLOSURE_REPORT.json").write_text(
        json.dumps(closure, ensure_ascii=False, indent=2))
    print("claim ledger all_match:", ledger_doc["all_match"],
          "| authoritative:", ledger_doc["authoritative_claims_total"],
          "| declared dependencies:", closure["total_declared_dependencies"])

    renderer = ReportRenderer(engine)
    for cid in ("TAX-01", "COR-01", "COR-02", "COR-03", "SEM-01", "SEED-01", "SEED-02",
                "ASV-01", "CAN-01", "CAN-02", "CAN-03", "CAN-04", "TST-01", "BAT-01",
                "BAT-02", "BAT-03", "INV-01", "DUP-01"):
        renderer.material(cid)
    renderer.commentary(
        "Material claims render ONLY from the hash-bound typed ledger above, with "
        "automatic render-time revalidation of the COMPLETE dependency closure "
        "(source + every sibling artifact that materially influences the computation). "
        "This channel is non-authoritative and is never benchmark evidence. CORR5 ran "
        "harness-local suites only: no product scenario, no adapter invocation against "
        "the real product, no Telegram, no payment, no production. Product binding "
        "remains NOT_YET_EXECUTED and the distribution remains unfrozen (IV6 decides "
        "independently)."
    )
    narrative = renderer.render_markdown()
    (BENCH / "reports" / "NARRATIVE_SUMMARY.md").write_text(
        "# CORR5 MACHINE-GENERATED NARRATIVE (typed claims only)\n\n" + narrative)

    machine = {
        "total_observations": 0,
        "candidate_scenario_count": dist["total_scenarios"],
        "verdict_counts": {},
        "l4": {"executed_count": 0},
        "concurrency": {"overlap_proven_count": 0, "fail_count": 0},
        "fault": {"confirmed_count": 0},
    }
    consistency = check_structured_report({"sentences": renderer.sentences}, ledger_doc,
                                          machine,
                                          out_path=str(artifacts / "NARRATIVE_EVIDENCE_CONSISTENCY.json"))
    print("narrative contradictions:", consistency["contradictions_count"])
    if not consistency["pass"]:
        return 1

    # ---- 11. non-self-referential manifest + detached sidecar --------------------
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

    selftest = json.loads((artifacts / "SELF_TEST_RESULTS.json").read_text())
    battery5 = json.loads((artifacts / "IV5_REGRESSION_BATTERY.json").read_text())
    invariants = json.loads((artifacts / "STATE_MACHINE_INVARIANT_RESULTS.json").read_text())
    ok = (audit["pass"] and ledger_doc["all_match"] and consistency["pass"]
          and selftest["all_pass"] and rag["all_pass"] and battery5["all_pass"]
          and invariants["all_pass"]
          and cst["all_required_product_adapters_ready"] and regen_doc["deterministic"])
    print("closing-artifact gate:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
