"""Harness-only self-test suite v2 (CORR2).

Complements tests/iv2_regression_battery.py (which covers every §48 IV2
counterexample) with core unit coverage: verdict vocabulary and precedence,
stability separation, provenance classes, ExecutionRequest projection,
scanner behavior, evidence sanitization/immutability, TEST_BASE binding
guards, and corpus artifact integrity.

NO product seeds, no full-corpus execution, no production contact.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from harness.evidence import (  # noqa: E402
    EvidenceIdentity,
    EvidenceImmutableViolation,
    ObservedValue,
    ProvenanceViolation,
    RawCapture,
    UNOBSERVED,
    freeze_evidence,
    sanitize_obj,
)
from harness.execution_request import build_execution_request, FORBIDDEN_REQUEST_FIELDS  # noqa: E402
from harness.provenance import (  # noqa: E402
    ProvenanceKind,
    is_allowed_provenance,
    is_forbidden_provenance,
    is_runtime_product_provenance,
    is_static_provenance,
    is_synthetic_provenance,
)
from harness.scanner import ScannerMisuseError, scan_prohibited_output  # noqa: E402
from harness.seams import sut_binding  # noqa: E402
from harness.verdicts import (  # noqa: E402
    PrimaryVerdict,
    SemanticStatus,
    StabilityLabel,
    VerdictDerivation,
    derive_primary_verdict,
    derive_stability_label,
)

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []


def test(name: str):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append((name, True, ""))
            except AssertionError as exc:
                RESULTS.append((name, False, f"AssertionError: {exc}"))
            except Exception as exc:  # noqa: BLE001
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        wrapper.__name__ = name
        TESTS.append((name, wrapper))
        return wrapper
    return deco


def _d(**kw) -> VerdictDerivation:
    base = dict(
        phase_execution_allowed=True, safe_to_execute=True, seam_class="RUNTIME",
        seam_authorized_and_executable=True, scenario_definition_valid=True,
        oracle_registered=True, harness_exception=False, timeout_exceeded=False,
        infra_failure=False, sut_invoked=True, sut_path_identified=True,
        required_fields_observed=True, provenance_valid=True,
        deterministic_oracles_satisfied=True, deterministic_oracle_failures=0,
        semantic_status=SemanticStatus.NOT_REQUIRED, repeat_outcomes=[],
    )
    base.update(kw)
    return VerdictDerivation(**base)


@test("verdict_vocabulary.exactly_owner_ten")
def _():
    expected = {"PASS", "FAIL", "HOLD", "TIMEOUT", "NONDETERMINISTIC",
                "INFRA_FAILURE", "SKIPPED_UNSAFE", "BENCHMARK_DEFECT",
                "NOT_EXECUTED", "NOT_OBSERVABLE"}
    assert {v.value for v in PrimaryVerdict} == expected


@test("verdict_precedence.all_branches")
def _():
    assert derive_primary_verdict(_d(safe_to_execute=False))[0] == PrimaryVerdict.SKIPPED_UNSAFE
    assert derive_primary_verdict(_d(phase_execution_allowed=False))[0] == PrimaryVerdict.NOT_EXECUTED
    assert derive_primary_verdict(_d(seam_class="NO_SEAM", seam_authorized_and_executable=False))[0] == PrimaryVerdict.NOT_OBSERVABLE
    assert derive_primary_verdict(_d(infra_failure=True))[0] == PrimaryVerdict.INFRA_FAILURE
    assert derive_primary_verdict(_d(timeout_exceeded=True))[0] == PrimaryVerdict.TIMEOUT
    assert derive_primary_verdict(_d(harness_exception=True))[0] == PrimaryVerdict.BENCHMARK_DEFECT
    assert derive_primary_verdict(_d(deterministic_oracles_satisfied=False, deterministic_oracle_failures=1))[0] == PrimaryVerdict.FAIL
    assert derive_primary_verdict(_d(semantic_status=SemanticStatus.PREPARED_PENDING))[0] == PrimaryVerdict.HOLD
    assert derive_primary_verdict(_d())[0] == PrimaryVerdict.PASS
    assert derive_primary_verdict(_d(repeat_outcomes=["PASS", "FAIL"]))[0] == PrimaryVerdict.NONDETERMINISTIC
    assert derive_primary_verdict(_d(required_fields_observed=False))[0] == PrimaryVerdict.BENCHMARK_DEFECT


@test("stability_labels.separate_from_primary")
def _():
    assert derive_stability_label([PrimaryVerdict.PASS] * 3) == StabilityLabel.STABLE_PASS
    assert derive_stability_label([PrimaryVerdict.PASS, PrimaryVerdict.FAIL]) == StabilityLabel.FLAP
    assert derive_stability_label([PrimaryVerdict.FAIL, PrimaryVerdict.FAIL]) == StabilityLabel.NONE
    assert StabilityLabel.FLAP.value != PrimaryVerdict.FAIL.value


@test("provenance.classes_and_families")
def _():
    assert is_runtime_product_provenance("RUNTIME_FUNCTION_RETURN")
    assert is_runtime_product_provenance("DERIVED_FROM_OBSERVED_DATA")
    assert not is_runtime_product_provenance("STATIC_INSPECTION")
    assert not is_runtime_product_provenance("SYNTHETIC_CALIBRATION")
    assert is_static_provenance("STATIC_INSPECTION")
    assert is_synthetic_provenance("SYNTHETIC_CALIBRATION")
    for f in ("EXPECTED_VALUE", "SCENARIO_METADATA", "HARDCODED_ASSUMPTION",
              "AUTHOR_INFERENCE", "DEFAULT_PASS", "NARRATIVE_INFERENCE"):
        assert is_forbidden_provenance(f)
        ov = ObservedValue()
        try:
            ov.set_observed("x", f)
            raise AssertionError(f"forbidden provenance {f} accepted")
        except ProvenanceViolation:
            pass


@test("execution_request.no_expectations_leak")
def _():
    spec = {
        "scenario_id": "X-1", "track": "ALEXEY_INBOUND", "execution_level": "L1",
        "turns": [{"role": "user", "content": "t"}],
        "expected": {"act": "PAYMENT", "link": "https://x"}, "oracle": [{"oracle": "act_equals"}],
        "pass_conditions": ["never"], "fail_conditions": ["never"],
        "role_invariant": "INV", "semantic_evaluation": {"required": False},
        "prohibited_output": ["x"], "failure_mechanism": "m", "trigger": "t",
        "observable_effect": "e", "why_this_scenario_tests_this_class": "w",
        "sut_binding": {"adapter_id": "synthetic_academy"},
    }
    req = build_execution_request(spec, adapter_id="synthetic_academy", run_id="R", attempt=1,
                                  scenario_sha256="a" * 64, navigator_test_root=None, tikhon_test_root=None)
    blob = json.dumps(req.to_json(), default=str)
    for forbidden in ("expected", "PASS_CONDITIONS", "pass_conditions", "oracle", "role_invariant", "prohibited_output"):
        assert forbidden not in blob, forbidden


@test("scanner.output_only_and_refusals")
def _():
    try:
        scan_prohibited_output(["@bad"])
        raise AssertionError("no-stream call accepted")
    except ScannerMisuseError:
        pass
    res = scan_prohibited_output(["@bad"], system_output="pay to @BAD now")
    assert not res[0].clean  # case-insensitive
    assert scan_prohibited_output(["@bad"], system_output="clean reply")[0].clean


@test("evidence.sanitize_keys_and_values")
def _():
    doc = {"api_key": "sk-VALUE123", "note": "Authorization: Bearer abc.def.ghi", "nested": {"token": "x"}}
    red = sanitize_obj(doc)
    blob = json.dumps(red)
    assert "sk-VALUE123" not in blob and "abc.def.ghi" not in blob
    assert red["nested"]["token"] == "[REDACTED]"


@test("evidence.unobserved_sentinel_discipline")
def _():
    ov = ObservedValue()
    assert ov.is_unobserved and ov.value is UNOBSERVED
    try:
        ov.set_observed("v", "UNOBSERVED")
        raise AssertionError("value with UNOBSERVED provenance accepted")
    except ProvenanceViolation:
        pass


@test("evidence.immutability_and_identity")
def _():
    identity = EvidenceIdentity(run_id="R1", scenario_id="S", scenario_sha256="a" * 64,
                                observation_id="S_A1", attempt_index=1, evidence_type="RAW_OBSERVATION")
    with tempfile.TemporaryDirectory() as td:
        frozen = freeze_evidence(identity, td, {"x": 1})
        frozen.verify()
        try:
            freeze_evidence(identity, td, {"x": 2})
            raise AssertionError("overwrite accepted")
        except EvidenceImmutableViolation:
            pass
        # identity mismatch on verify_for
        try:
            frozen.verify_for(run_id="R2", scenario_id="S", scenario_sha256="a" * 64,
                              observation_id="S_A1", attempt_index=1)
            raise AssertionError("wrong run accepted")
        except Exception as exc:  # noqa: BLE001
            assert "IdentityMismatch" in type(exc).__name__ or "mismatch" in str(exc).lower()


@test("sut_binding.history_exclusion_and_fail_closed")
def _():
    results = sut_binding.synthetic_history_path_probe()
    assert any("EXCLUDED" in r for r in results)
    os_env = dict(__import__("os").environ)
    __import__("os").environ.pop("NAVIGATOR_TEST_ROOT", None)
    __import__("os").environ.pop("TIKHON_TEST_ROOT", None)
    binding = sut_binding.bind_test_bases()
    assert binding["all_bound"] is False


@test("corpus.artifacts_coherent")
def _():
    dist = json.loads((BENCH / "corpus" / "distribution.json").read_text())
    sem = json.loads((BENCH / "corpus" / "SEMANTIC_TAXONOMY_COVERAGE.json").read_text())
    # CORR6 direct regression update: Owner's final corpus size is 924
    assert dist["total_scenarios"] == 924 and dist["unique_fingerprints"] == 924
    assert dist.get("effective_duplicate_groups_remaining") == 0
    assert sem["target_classes"] == 84
    counts = sem["status_counts"]
    assert sum(counts.values()) == 84
    sha_txt = (BENCH / "corpus" / "CORPUS_SHA256.txt").read_text().split()[0]
    import hashlib
    assert hashlib.sha256((BENCH / "corpus" / "corrected_corpus_84.jsonl").read_bytes()).hexdigest() == sha_txt


@test("seeds.exact_30_ids_and_corpus_membership")
def _():
    expected = [f"A-{i:04d}" for i in range(1, 16)] + [f"B-{i:04d}" for i in range(1, 8)] + \
               [f"C-{i:04d}" for i in range(1, 4)] + [f"D-{i:04d}" for i in range(1, 6)]
    rows = {json.loads(l)["scenario_id"]: json.loads(l)
            for l in (BENCH / "corpus" / "corrected_corpus_84.jsonl").read_text().splitlines() if l}
    for sid in expected:
        assert sid in rows, sid
        assert rows[sid].get("seed") is True, sid
        assert rows[sid].get("adapter_id"), sid
    matrix = json.loads((BENCH / "corpus" / "SEED_NATIVE_CONTRACT_MATRIX.json").read_text())
    assert len(matrix["seeds"]) == 30


@test("adapters.registry_native_contract_audit")
def _():
    from adapters.registry import audit_native_contracts
    d = audit_native_contracts()
    assert d["all_valid"], [c for c in d["checks"] if not c["valid"]]


def main() -> int:
    import importlib

    mod = importlib.import_module("tests.run_all")
    mod.RESULTS.clear()
    for _name, fn in mod.TESTS:
        fn()
    results = mod.RESULTS
    passed = sum(1 for _, ok, _ in results if ok)
    failed = [r for r in results if not r[1]]
    print(f"HARNESS SELF-TESTS V2: {passed}/{len(results)} passed")
    for name, _ok, err in failed:
        print(f"  FAIL {name}: {err}")
    out = BENCH / "artifacts" / "SELF_TEST_RESULTS.json"
    from datetime import datetime, timezone
    out.write_text(json.dumps({
        "schema": "CORR2_SELF_TEST_RESULTS_V2",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": len(results), "passed": passed, "failed": len(failed),
        "all_pass": not failed,
        "cases": [{"name": n, "pass": ok, "error": e} for n, ok, e in results],
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
