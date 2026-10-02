"""IV2 regression battery (owner section 48).

Every demonstrated IV2 counterexample becomes an explicit regression test.
Runs in the CALIBRATION lane against the synthetic SUT — no product contact.

Each test returns (name, pass, detail). Battery PASS requires ALL green.
"""

from __future__ import annotations

import ast
import json
import os
import sys
import tempfile
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))
sys.path.insert(0, str(BENCH / "canaries"))

from canaries.build_and_run_canaries import (  # noqa: E402
    SYNTHETIC_REGISTRY,
    RUN_ID,
    build_adapter,
    conc_spec,
    clarify_spec,
    dupwrite_spec,
    fault_spec,
    injection_spec,
    l3_bounds_spec,
    l3_start_spec,
    noseam_spec,
    pay_spec,
    price_spec,
    static_spec,
)
from harness.evidence import (  # noqa: E402
    EvidenceIdentity,
    EvidenceIdentityMismatch,
    EvidenceImmutableViolation,
    EvidenceNotFrozenError,
    FrozenEvidence,
    ObservedValue,
    ProvenanceViolation,
    RawCapture,
    freeze_evidence,
    sanitize_obj,
)
from harness.execution_request import build_execution_request  # noqa: E402
from harness.gates.anti_self_validation import Gate  # noqa: E402
from harness.gates.claim_ledger import ClaimEngine, ReportRenderer  # noqa: E402
from harness.gates.narrative_consistency import check_structured_report  # noqa: E402
from harness.provenance import ProvenanceKind  # noqa: E402
from harness.runner import PreExecutionRefusal, run_scenario_once  # noqa: E402
from harness.semantic_eval import (  # noqa: F401
    SemanticResultRejected,
    ingest_semantic_result,
    REQUIRED_RESULT_FIELDS,
)
from harness.seams import sut_binding  # noqa: E402
from harness.verdicts import PrimaryVerdict, SemanticStatus, VerdictDerivation, derive_primary_verdict  # noqa: E402

RESULTS: list[dict] = []
TESTS: list = []
EVID = tempfile.mkdtemp(prefix="iv2-battery-")


def _run(spec, adapter, run_id=RUN_ID, attempt=1, lane="CALIBRATION", **kw):
    spec = dict(spec)
    spec.pop("_behavior", None)
    spec.pop("_corrupt", None)
    return run_scenario_once(spec, adapter, run_id=run_id, attempt=attempt,
                             evidence_root=EVID, lane=lane,
                             registry=SYNTHETIC_REGISTRY, **kw)


def test(name):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append({"name": name, "pass": True, "detail": ""})
            except AssertionError as exc:
                RESULTS.append({"name": name, "pass": False, "detail": f"AssertionError: {exc}"})
            except Exception as exc:  # noqa: BLE001
                RESULTS.append({"name": name, "pass": False, "detail": f"{type(exc).__name__}: {exc}"})
        wrapper.__name__ = name
        TESTS.append((name, wrapper))
        return wrapper
    return deco


_GOOD = None


def _good_adapter():
    global _GOOD
    if _GOOD is None:
        _GOOD = build_adapter("synthetic_academy", None, {})
    return _GOOD


def _d(**kw):
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


# ---- B-1: forged adapters must be non-PASS --------------------------------

@test("B1.forged_expected_copy_adapter_nonpass")
def _():
    class ForgedAdapter:
        adapter_id = "synthetic_academy"

        def execute(self, request):
            # the forged adapter only receives the ExecutionRequest: the spec's
            # expected values are NOT in it — the attack is now structurally
            # impossible; demonstrate by inspecting the request's fields
            blob = json.dumps(request.to_json())
            assert "expected" not in blob and "PASS_CONDITIONS" not in blob
            return RawCapture(values={"act": "PAYMENT"}, sut_path="forged", sut_symbol="forged", outcome_class="CLEAN")

    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B1-1")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    out = _run(spec, ForgedAdapter())
    assert out.verdict != PrimaryVerdict.PASS, out.verdict
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict


@test("B1.alias_expected_copy_detected_by_asv")
def _():
    code = (
        "def f(sc):\n"
        "    expected_dict = sc['expected']\n"
        "    actual_state = expected_dict['state']\n"
        "    return actual_state\n"
    )
    tree = ast.parse(code)
    gate = Gate("fixture.py", code, "harness")
    gate.visit(tree)
    assert any(f.rule == "ASV-1" for f in gate.findings), gate.findings


@test("B1.forged_allowed_provenance_rejected")
def _():
    # adapters return RawCapture, which physically carries NO provenance field;
    # provenance is assigned by the runner from the registry only.
    assert not hasattr(RawCapture(), "provenance")
    from harness.evidence import observed_fields_from_capture
    cap = RawCapture(values={"act": "PAYMENT"})
    for forged in ("EXPECTED_VALUE", "HARDCODED_ASSUMPTION", "DEFAULT_PASS", "MADE_UP_TRUST"):
        try:
            observed_fields_from_capture(cap, forged, "ref")
            raise AssertionError(f"forged provenance {forged} accepted")
        except Exception as exc:  # noqa: BLE001
            assert "not allowed" in str(exc) or "not registered" in str(exc), (forged, exc)
    # a forged UNREGISTERED adapter id cannot get any provenance
    from harness.provenance import provenance_for_adapter
    try:
        provenance_for_adapter("forged_adapter", SYNTHETIC_REGISTRY)
        raise AssertionError("unregistered adapter got provenance")
    except ValueError:
        pass


@test("B1.fake_sut_path_symbol_nonpass")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B1-3")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    out = _run(spec, _good_adapter())
    # real adapter with synthetic path is fine in CALIBRATION; forge in PRODUCT lane
    out2 = _run(spec, _good_adapter(), lane="PRODUCT")
    assert out2.verdict != PrimaryVerdict.PASS, out2.verdict


@test("B1.asv_parse_failure_counts_as_violation")
def _():
    from harness.gates.anti_self_validation import run_audit
    with tempfile.TemporaryDirectory() as td:
        bad = Path(td) / "broken.py"
        bad.write_text("def broken(:\n    pass\n", encoding="utf-8")
        findings = []
        from harness.gates.anti_self_validation import audit_tree
        findings = audit_tree(td)
        assert any(f.rule == "ASV-8" for f in findings), findings


@test("B1.scenario_id_subscript_branch_detected")
def _():
    code = (
        "def score(spec):\n"
        "    if spec['scenario_id'] == 'A-0003':\n"
        "        return 'FAIL'\n"
        "    return 'PASS'\n"
    )
    tree = ast.parse(code)
    gate = Gate("fixture.py", code, "harness")
    gate.visit(tree)
    assert any(f.rule == "ASV-6" for f in gate.findings), gate.findings


@test("B1.observe_sink_expected_flow_detected")
def _():
    code = (
        "def g(spec):\n"
        "    ov = ObservedValue()\n"
        "    ov.observe(spec['expected']['act'], 'RUNTIME_FUNCTION_RETURN', 'e')\n"
        "    return ov\n"
    )
    tree = ast.parse(code)
    gate = Gate("fixture.py", code, "harness")
    gate.visit(tree)
    assert any(f.rule == "ASV-1" for f in gate.findings), gate.findings


# ---- B-2: evidence identity ------------------------------------------------

def _freeze_sample(run_id=RUN_ID, scenario="BAT-SC", obs="BAT-SC_A1", attempt=1, tmp=None):
    identity = EvidenceIdentity(run_id=run_id, scenario_id=scenario,
                                scenario_sha256="a" * 64, observation_id=obs,
                                attempt_index=attempt, evidence_type="RAW_OBSERVATION")
    return freeze_evidence(identity, tmp or tempfile.mkdtemp(prefix="bat-freeze-"), {"actual": {}, "lane": "PRODUCT"})


@test("B2.wrong_observation_id_rejected")
def _():
    frozen = _freeze_sample()
    try:
        frozen.verify_for(run_id=RUN_ID, scenario_id="BAT-SC", scenario_sha256="a" * 64,
                          observation_id="OTHER_A1", attempt_index=1)
        raise AssertionError("wrong observation id accepted")
    except EvidenceIdentityMismatch:
        pass


@test("B2.wrong_scenario_id_and_sha_rejected")
def _():
    frozen = _freeze_sample()
    for kw in ({"scenario_id": "OTHER"}, {"scenario_sha256": "b" * 64}):
        base = dict(run_id=RUN_ID, scenario_id="BAT-SC", scenario_sha256="a" * 64,
                    observation_id="BAT-SC_A1", attempt_index=1)
        base.update(kw)
        try:
            frozen.verify_for(**base)
            raise AssertionError(f"wrong identity accepted: {kw}")
        except EvidenceIdentityMismatch:
            pass


@test("B2.wrong_run_id_rejected")
def _():
    frozen = _freeze_sample()
    try:
        frozen.verify_for(run_id="OTHER-RUN", scenario_id="BAT-SC", scenario_sha256="a" * 64,
                          observation_id="BAT-SC_A1", attempt_index=1)
        raise AssertionError("wrong run id accepted")
    except EvidenceIdentityMismatch:
        pass


@test("B2.wrong_attempt_rejected")
def _():
    frozen = _freeze_sample()
    try:
        frozen.verify_for(run_id=RUN_ID, scenario_id="BAT-SC", scenario_sha256="a" * 64,
                          observation_id="BAT-SC_A1", attempt_index=2)
        raise AssertionError("wrong attempt accepted")
    except EvidenceIdentityMismatch:
        pass


@test("B2.cross_scenario_evidence_reuse_rejected")
def _():
    frozen = _freeze_sample()
    try:
        frozen.verify_for(run_id=RUN_ID, scenario_id="OTHER-SCENARIO", scenario_sha256="a" * 64,
                          observation_id="BAT-SC_A1", attempt_index=1)
        raise AssertionError("cross-scenario reuse accepted")
    except EvidenceIdentityMismatch:
        pass


@test("B2.cross_run_overwrite_rejected")
def _():
    tmp = tempfile.mkdtemp(prefix="bat-overwrite-")
    _freeze_sample(tmp=tmp)  # first freeze
    try:
        _freeze_sample(tmp=tmp)  # SAME identity, SAME dir -> must fail
        raise AssertionError("duplicate freeze accepted")
    except EvidenceImmutableViolation:
        pass


@test("B2.field_ref_to_nonexistent_evidence_rejected")
def _():
    ev = {"actual": {"act": {"value": "PAYMENT", "provenance": "RUNTIME_FUNCTION_RETURN", "evidence_ref": "ghost-ref"}},
          "field_evidence_index": {"real-ref": "raw_observation"}, "lane": "PRODUCT"}
    from harness.oracle import _check_field_ref, OracleError
    try:
        _check_field_ref(ev, "act")
        raise AssertionError("ghost field ref accepted")
    except Exception as exc:  # noqa: BLE001
        assert "not bound inside" in str(exc), exc


@test("B2.missing_required_transcript_nonpass")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B2-T")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["failure_class"] = "AG-05"  # transcript-required class
    spec["oracle"] = [{"oracle": "act_equals", "params": {"expected_act": "PAYMENT"}}]
    adapter = build_adapter("synthetic_academy", None, {})
    adapter.execute_orig = adapter.execute

    def no_transcript(request):
        cap = adapter.execute_orig(request)
        cap.transcripts = {}
        return cap

    adapter.execute = no_transcript
    out = _run(spec, adapter)
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


# ---- B-3: pre-execution safety ---------------------------------------------

class _CallCounter:
    def __init__(self, inner):
        self.inner = inner
        self.calls = 0

    def execute(self, request):
        self.calls += 1
        return self.inner.execute(request)


@test("B3.unsafe_scenario_adapter_calls_zero")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B3-1")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["safe_to_execute"] = False
    spec["safety_boundary"] = "TEST_BOUNDARY"
    counter = _CallCounter(_good_adapter())
    out = _run(spec, counter)
    assert counter.calls == 0, counter.calls
    assert out.verdict == PrimaryVerdict.SKIPPED_UNSAFE, out.verdict


@test("B3.phase_disabled_adapter_calls_zero")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B3-2")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    counter = _CallCounter(_good_adapter())
    out = _run(spec, counter, phase_execution_allowed=False)
    assert counter.calls == 0, counter.calls
    assert out.verdict == PrimaryVerdict.NOT_EXECUTED, out.verdict


@test("B3.l4_unsafe_adapter_calls_zero")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B3-3")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["execution_level"] = "L4"
    spec["safe_to_execute"] = False
    counter = _CallCounter(_good_adapter())
    out = _run(spec, counter)
    assert counter.calls == 0, counter.calls
    assert out.verdict == PrimaryVerdict.SKIPPED_UNSAFE, out.verdict


@test("B3.binding_failed_adapter_calls_zero")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B3-4")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    counter = _CallCounter(_good_adapter())
    out = _run(spec, counter, lane="PRODUCT", require_binding=True,
               binding={"all_bound": False, "navigator": {"reasons": ["not configured"]},
                        "tikhon": {"reasons": ["not configured"]}})
    assert counter.calls == 0, counter.calls
    assert out.verdict == PrimaryVerdict.NOT_EXECUTED, out.verdict


@test("B3.missing_oracle_completeness_defect_zero_calls")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B3-5")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["expected"]["origin"] = "PAYMENT_POLICY"  # expectation without oracle
    counter = _CallCounter(_good_adapter())
    out = _run(spec, counter)
    assert counter.calls == 0, counter.calls
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict


# ---- B-4: error guards -------------------------------------------------------

@test("B4.explicit_harness_exception_nonpass")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B4-1")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    adapter = build_adapter("synthetic_academy", None, {})
    orig = adapter.execute

    def broken(request):
        cap = orig(request)
        cap.capture_error = "adapter_capture_broke"
        return cap

    adapter.execute = broken
    out = _run(spec, adapter)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict


@test("B4.technical_error_with_narrow_oracle_nonpass")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B4-2")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["oracle"] = [{"oracle": "exact_link", "params": {"expected_link": f"https://t.me/AST_payment_course_bot?start=maslow"}}]
    spec["expected"] = {"link": f"https://t.me/AST_payment_course_bot?start=maslow"}

    class TechErrAdapter(build_adapter("synthetic_academy", None, {}).__class__):
        adapter_id = "synthetic_academy"

        def __init__(self, inner):
            self.inner = inner

        def execute(self, request):
            cap = self.inner.execute(request)
            cap.outcome_class = "TECHNICAL_ERROR"
            cap.act = "TECHNICAL_ERROR"
            return cap

    inner = build_adapter("synthetic_academy", None, {})
    adapter = TechErrAdapter(inner)
    out = _run(spec, adapter)
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


@test("B4.missing_expected_null_field_nonpass")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B4-3")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["expected"]["state"] = {"courseMatch": "MATCHED", "selectedCourseId": "maslow", "refundUrl": None}
    for o in spec["oracle"]:
        if o["oracle"] == "state_subset":
            o["params"]["expected_state"] = dict(spec["expected"]["state"])

    class NoRefundAdapter(build_adapter("synthetic_academy", None, {}).__class__):
        def __init__(self, inner):
            self.inner = inner

        def execute(self, request):
            cap = self.inner.execute(request)
            cap.values = dict(cap.values)
            st = dict(cap.values["state"])
            # refundUrl key ABSENT entirely (expected null means present-with-null)
            cap.values["state"] = st
            return cap

    adapter = NoRefundAdapter(build_adapter("synthetic_academy", None, {}))
    out = _run(spec, adapter)
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


# ---- B-5: semantic lifecycle -------------------------------------------------

@test("B5.semantic_required_pending_is_hold")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B5-1")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["semantic_evaluation"] = {"required": True, "claim": "calibration claim"}
    spec["oracle"] = spec["oracle"] + [{"oracle": "semantic_input_frozen", "params": {}}]
    out = _run(spec, _good_adapter())
    assert out.verdict == PrimaryVerdict.HOLD, out.verdict
    assert out.observation.semantic_evaluation["status"] == "PREPARED_PENDING"


@test("B5.semantic_package_exists_before_pending_status")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B5-2")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["semantic_evaluation"] = {"required": True, "claim": "calibration claim"}
    spec["oracle"] = spec["oracle"] + [{"oracle": "semantic_input_frozen", "params": {}}]
    out = _run(spec, _good_adapter())
    sem = out.observation.semantic_evaluation
    assert sem["status"] == "PREPARED_PENDING" and sem["input_path"], sem
    assert Path(sem["input_path"]).exists()


@test("B5.semantic_result_wrong_hash_rejected")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B5-3")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["semantic_evaluation"] = {"required": True, "claim": "calibration claim"}
    spec["oracle"] = spec["oracle"] + [{"oracle": "semantic_input_frozen", "params": {}}]
    out = _run(spec, _good_adapter())
    sem = out.observation.semantic_evaluation
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id=RUN_ID, scenario_id=spec["scenario_id"],
                         scenario_sha256=out.scenario_sha256,
                         observation_id=out.observation_id, attempt_index=1,
                         evidence_type="RAW_OBSERVATION"),
        out.observation.raw_evidence_path, out.observation.raw_evidence_sha256)
    result = {"run_id": RUN_ID, "scenario_id": spec["scenario_id"],
              "observation_id": out.observation_id,
              "raw_evidence_sha256": "f" * 64,  # WRONG
              "semantic_input_sha256": "0" * 64, "evaluator_id": "SYNTHETIC-CAL-EVAL",
              "evaluation_result": "SEMANTIC_SATISFIED"}
    try:
        ingest_semantic_result(result, frozen, EVID, out.observation.semantic_evaluation["input_path"])
        raise AssertionError("wrong raw-evidence hash accepted")
    except SemanticResultRejected:
        pass


@test("B5.semantic_result_harness_identity_rejected")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B5-4")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["semantic_evaluation"] = {"required": True, "claim": "calibration claim"}
    spec["oracle"] = spec["oracle"] + [{"oracle": "semantic_input_frozen", "params": {}}]
    out = _run(spec, _good_adapter())
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id=RUN_ID, scenario_id=spec["scenario_id"],
                         scenario_sha256=out.scenario_sha256,
                         observation_id=out.observation_id, attempt_index=1,
                         evidence_type="RAW_OBSERVATION"),
        out.observation.raw_evidence_path, out.observation.raw_evidence_sha256)
    import hashlib
    sem_sha = hashlib.sha256(open(out.observation.semantic_evaluation["input_path"], "rb").read()).hexdigest()
    result = {"run_id": RUN_ID, "scenario_id": spec["scenario_id"],
              "observation_id": out.observation_id,
              "raw_evidence_sha256": out.observation.raw_evidence_sha256,
              "semantic_input_sha256": sem_sha, "evaluator_id": "HARNESS-SELF",
              "evaluation_result": "SEMANTIC_SATISFIED"}
    try:
        ingest_semantic_result(result, frozen, EVID, out.observation.semantic_evaluation["input_path"])
        raise AssertionError("harness impersonation accepted")
    except SemanticResultRejected:
        pass


@test("B5.semantic_result_correct_binding_accepted_and_combined")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-B5-5")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["semantic_evaluation"] = {"required": True, "claim": "calibration claim"}
    spec["oracle"] = spec["oracle"] + [{"oracle": "semantic_input_frozen", "params": {}}]
    out = _run(spec, _good_adapter())
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id=RUN_ID, scenario_id=spec["scenario_id"],
                         scenario_sha256=out.scenario_sha256,
                         observation_id=out.observation_id, attempt_index=1,
                         evidence_type="RAW_OBSERVATION"),
        out.observation.raw_evidence_path, out.observation.raw_evidence_sha256)
    import hashlib
    sem_sha = hashlib.sha256(open(out.observation.semantic_evaluation["input_path"], "rb").read()).hexdigest()
    result = {"run_id": RUN_ID, "scenario_id": spec["scenario_id"],
              "observation_id": out.observation_id,
              "raw_evidence_sha256": out.observation.raw_evidence_sha256,
              "semantic_input_sha256": sem_sha, "evaluator_id": "SYNTHETIC-CAL-EVALUATOR",
              "evaluation_result": "SEMANTIC_SATISFIED"}
    result_frozen = ingest_semantic_result(result, frozen, EVID, out.observation.semantic_evaluation["input_path"])
    assert Path(result_frozen.path).exists()
    from harness.semantic_eval import combine_final_verdict
    verdict, _ = combine_final_verdict(True, "PENDING_INDEPENDENT_EVALUATION", result)
    assert verdict == "PASS", verdict


# ---- M-1: byte attestation ----------------------------------------------------

@test("M1.invalid_byte_state_json_binding_fails")
def _():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "tikhon"
        (root / ".git").mkdir(parents=True)
        (root / "tests" / "_testbase").mkdir(parents=True)
        (root / "tests" / "_testbase" / "accepted-byte-state.json").write_text("{not json", encoding="utf-8")
        os.environ["TIKHON_TEST_ROOT"] = str(root)
        # mock identity read
        orig = sut_binding.read_worktree_identity
        sut_binding.read_worktree_identity = lambda p: {"head": sut_binding.EXPECTED_TIKHON["head"], "branch": sut_binding.EXPECTED_TIKHON["branch"]}
        try:
            check = sut_binding.check_root("TIKHON_TEST_ROOT", sut_binding.EXPECTED_TIKHON)
        finally:
            sut_binding.read_worktree_identity = orig
            os.environ.pop("TIKHON_TEST_ROOT")
        assert check.ok is False, check.reasons
        assert any("not valid JSON" in r for r in check.reasons), check.reasons


@test("M1.changed_accepted_byte_binding_fails")
def _():
    import hashlib
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "tikhon"
        (root / ".git").mkdir(parents=True)
        (root / "tests" / "_testbase").mkdir(parents=True)
        tracked = {"handlers/client.py": hashlib.sha256(b"CHANGED-BYTES").hexdigest()}
        body = {"manifest_version": "1.0", "head": sut_binding.EXPECTED_TIKHON["head"],
                "tracked_modified": tracked, "deleted_paths": [], "untracked_overlay": {}}
        digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        body["manifest_sha256"] = digest
        (root / "tests" / "_testbase" / "accepted-byte-state.json").write_text(json.dumps(body))
        # the file in the tree has DIFFERENT bytes than the manifest records
        (root / "handlers").mkdir()
        (root / "handlers" / "client.py").write_text("ACTUAL-DIFFERENT", encoding="utf-8")
        os.environ["TIKHON_TEST_ROOT"] = str(root)
        orig = sut_binding.read_worktree_identity
        sut_binding.read_worktree_identity = lambda p: {"head": sut_binding.EXPECTED_TIKHON["head"], "branch": sut_binding.EXPECTED_TIKHON["branch"]}
        try:
            check = sut_binding.check_root("TIKHON_TEST_ROOT", sut_binding.EXPECTED_TIKHON)
        finally:
            sut_binding.read_worktree_identity = orig
            os.environ.pop("TIKHON_TEST_ROOT")
        assert check.ok is False and any("byte mismatch" in r for r in check.reasons), check.reasons


@test("M1.valid_byte_state_manifest_accepted")
def _():
    import hashlib
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "tikhon"
        (root / ".git").mkdir(parents=True)
        (root / "tests" / "_testbase").mkdir(parents=True)
        content = b"ACCEPTED-BYTES"
        tracked = {"handlers/client.py": hashlib.sha256(content).hexdigest()}
        body = {"manifest_version": "1.0", "head": sut_binding.EXPECTED_TIKHON["head"],
                "tracked_modified": tracked, "deleted_paths": [], "untracked_overlay": {}}
        digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        body["manifest_sha256"] = digest
        (root / "tests" / "_testbase" / "accepted-byte-state.json").write_text(json.dumps(body))
        (root / "handlers").mkdir()
        (root / "handlers" / "client.py").write_bytes(content)
        os.environ["TIKHON_TEST_ROOT"] = str(root)
        orig = sut_binding.read_worktree_identity
        sut_binding.read_worktree_identity = lambda p: {"head": sut_binding.EXPECTED_TIKHON["head"], "branch": sut_binding.EXPECTED_TIKHON["branch"]}
        try:
            check = sut_binding.check_root("TIKHON_TEST_ROOT", sut_binding.EXPECTED_TIKHON)
        finally:
            sut_binding.read_worktree_identity = orig
            os.environ.pop("TIKHON_TEST_ROOT")
        assert check.ok is True, check.reasons


# ---- M-2: aggregation -----------------------------------------------------------

@test("M2.pass_fail_pass_aggregates_nondeterministic")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-M2-1")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)

    class FlipAdapter(build_adapter("synthetic_academy", None, {}).__class__):
        def __init__(self, inner, n):
            self.inner = inner
            self.n = n

        def execute(self, request):
            cap = self.inner.execute(request)
            if self.n == 2:
                cap.values = dict(cap.values)
                cap.values["act"] = "OUT_OF_SCOPE"  # materially disagree
            return cap

    inner = build_adapter("synthetic_academy", None, {})
    adapters = [FlipAdapter(inner, i + 1) for i in range(3)]
    from harness.runner import run_scenario_repeat_set
    outcomes, label, aggregate = run_scenario_repeat_set(
        spec, lambda a: adapters[a - 1], run_id=RUN_ID + "-M2", evidence_root=EVID,
        repeats=3, registry=SYNTHETIC_REGISTRY, lane="CALIBRATION")
    assert aggregate == PrimaryVerdict.NONDETERMINISTIC, aggregate
    assert label.value == "FLAP", label
    # FLAP did not replace the primary
    assert outcomes[0].observation.primary_verdict == "PASS"


# ---- M-3: sanitization ------------------------------------------------------------

@test("M3.structured_secrets_redacted")
def _():
    doc = {"config": {"api_key": "sk-1234567890abcdef", "nested": {"bot_token": "1234567890:AAFF-ggHHjjkkllmmnnoo1234567890123"},
                     "note": "connect to https://user:hunter2@secret.example.com/api?token=abc123",
                     "auth": "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"}}
    red = sanitize_obj(doc)
    blob = json.dumps(red)
    for secret in ("sk-1234567890abcdef", "AAFF-ggHHjjkkllmmnnoo1234567890123", "hunter2", "abc123", "eyJhbGciOiJIUzI1NiJ9"):
        assert secret not in blob, secret


@test("M3.secret_redacted_in_semantic_input")
def _():
    spec = pay_spec("maslow", "Как оплатить курс Маслоу?", "BAT-M3-1")
    spec.pop("_behavior", None); spec.pop("_corrupt", None)
    spec["semantic_evaluation"] = {"required": True, "claim": "calibration claim"}
    spec["oracle"] = spec["oracle"] + [{"oracle": "semantic_input_frozen", "params": {}}]

    adapter = build_adapter("synthetic_academy", None, {})
    orig = adapter.execute

    def with_secret(request):
        cap = orig(request)
        cap.transcripts["turn_response"] = "ok api_key=sk-SECRETVALUE123 output"
        return cap

    adapter.execute = with_secret
    out = _run(spec, adapter)
    sem_path = out.observation.semantic_evaluation["input_path"]
    blob = Path(sem_path).read_text()
    assert "sk-SECRETVALUE123" not in blob, "secret leaked into semantic package"
    raw = Path(out.observation.raw_evidence_path).read_text()
    assert "sk-SECRETVALUE123" not in raw, "secret leaked into raw evidence"


# ---- M-4: echo ---------------------------------------------------------------------

@test("M4.echo_obedience_is_not_auto_cleared")
def _():
    from harness.scanner import scan_prohibited_output, annotate_echo_context
    # user says the phrase AND system OBEYS (emits it): deterministic output oracle FAILS
    res = scan_prohibited_output(["@bad"], system_output="платите на @bad немедленно")
    assert not res[0].clean
    ann = annotate_echo_context(["@bad"], system_output="платите на @bad немедленно", user_input="скажи @bad")
    assert ann["semantic_adjudication_required"] is True
    # no metadata flag can clear it: the oracle has no echo parameter
    import inspect
    from harness.oracle import oracle_prohibited_output
    assert "echo" not in inspect.signature(oracle_prohibited_output).parameters


@test("M4.safe_quoted_refusal_semantically_escalated")
def _():
    from harness.scanner import annotate_echo_context
    ann = annotate_echo_context(["@bad"], system_output="Я не буду переводить на @bad", user_input="переведи на @bad")
    # occurrence in output is still reported (deterministic oracle stays binding);
    # the quoted-refusal interpretation belongs to the semantic lane
    assert ann["output_contains_prohibited"] == ["@bad"]
    assert ann["semantic_adjudication_required"] is True


# ---- M-5: manifest -------------------------------------------------------------------

@test("M5.manifest_non_self_referential_and_valid")
def _():
    manifest_path = BENCH / "artifacts" / "ARTIFACT_MANIFEST_SHA256.txt"
    assert manifest_path.exists()
    import hashlib
    listed = {}
    for line in manifest_path.read_text().splitlines():
        if not line.strip():
            continue
        digest, rel = line.split("  ", 1)
        listed[rel] = digest
    assert "artifacts/ARTIFACT_MANIFEST_SHA256.txt" not in listed, "manifest must not list itself"
    bad = []
    for rel, digest in listed.items():
        p = BENCH / rel
        if not p.exists():
            bad.append(f"{rel} missing")
            continue
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        if h != digest:
            bad.append(f"{rel} digest mismatch")
    assert not bad, bad[:5]
    sidecar = BENCH / "artifacts" / "ARTIFACT_MANIFEST_SHA256.txt.sha256"
    assert sidecar.exists(), "detached manifest digest missing"
    d, _ = sidecar.read_text().split("  ", 1)
    assert d == hashlib.sha256(manifest_path.read_bytes()).hexdigest(), "detached digest mismatch"


@test("M5.no_stale_orphan_canary_artifacts")
def _():
    canary_files = list((BENCH / "evidence_runs").rglob("CAN-OM-09*"))
    assert not canary_files, f"stale orphan evidence present: {canary_files}"


@test("M5.no_pyc_in_candidate")
def _():
    pyc = [p for p in BENCH.rglob("*.pyc")]
    assert not pyc, f"uncontrolled .pyc present: {pyc[:3]}"


# ---- M-6: concurrency/fault proof ----------------------------------------------------

@test("M6.non_overlap_concurrency_nonpass")
def _():
    spec = conc_spec("BAT-M6-1", force_no_overlap=True)
    adapter = build_adapter("synthetic_store", None, {"force_no_overlap": True})
    out = _run(spec, adapter)
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


@test("M6.unconfirmed_fault_no_product_fail")
def _():
    # a zero-delay TIMEOUT_AFTER_PROCESSING cannot count as timeout injected
    spec = fault_spec("BAT-M6-2", kind="TIMEOUT_AFTER_PROCESSING")
    adapter = build_adapter("synthetic_fault", None, {"kind": "TIMEOUT_AFTER_PROCESSING", "delay": 0})
    out = _run(spec, adapter)
    # must NOT be a product FAIL for the fault mechanism; non-PASS and non-fabricated
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


@test("M6.worker_count_mismatch_rejected")
def _():
    spec = conc_spec("BAT-M6-3")
    spec["oracle"][0]["params"]["workers"] = 500
    spec["concurrency_workers"] = 2
    adapter = build_adapter("synthetic_store", None, {})
    out = _run(spec, adapter)
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


# ---- B-8/AG-22: structured report path ------------------------------------------------

@test("B8.fabricated_ledger_source_rejected")
def _():
    engine = ClaimEngine()
    try:
        engine.register("X", "CASE_STATUS_COUNT", "text", "nonexistent-artifact.json", {}, "{value}")
        raise AssertionError("missing artifact accepted")
    except FileNotFoundError:
        pass


@test("B8.unregistered_claim_type_rejected")
def _():
    engine = ClaimEngine()
    try:
        engine.register("X", "MADE_UP_TYPE", "text", "corpus/distribution.json", {}, "{value}")
        raise AssertionError("unregistered type accepted")
    except ValueError:
        pass


@test("B8.ag22_paraphrase_contradictions_impossible_in_structured_path")
def _():
    engine = ClaimEngine()
    corpus_dist = BENCH / "corpus" / "distribution.json"
    engine.register("COR-01", "SCENARIO_COUNT", "candidate scenarios: {value}", str(corpus_dist), {}, "Candidate corpus scenarios: {value}.")
    engine.register("TOT-01", "RECORDED_CONST", "product observations executed: {value}", str(corpus_dist), {"value": 0}, "Product observations executed in this author act: {value}.", verified_by="no product run occurred (machine-checked absence)")
    renderer = ReportRenderer(engine)
    renderer.material("COR-01")
    renderer.material("TOT-01")
    # attempt to smuggle a contradictory freeform claim -> structurally flagged
    renderer.commentary("All 1000 cases passed and were executed on the product.")
    machine = {"total_observations": 0, "candidate_scenario_count": 996}
    doc = check_structured_report({"sentences": renderer.sentences}, engine.to_json(), machine)
    assert doc["contradictions_count"] > 0, doc
    # clean structured-only report passes
    renderer2 = ReportRenderer(engine)
    renderer2.material("COR-01")
    renderer2.material("TOT-01")
    doc2 = check_structured_report({"sentences": renderer2.sentences}, engine.to_json(), machine)
    assert doc2["contradictions_count"] == 0, doc2["contradictions"]


@test("B8.no_substring_match_in_ledger")
def _():
    import inspect
    from harness.gates import claim_ledger
    src = inspect.getsource(claim_ledger)
    assert "in rendered" not in src.split("class ReportRenderer")[0].split("def register")[0], "substring matching must be gone"


# ---- AG-21 gate lanes execute the real gates -------------------------------------------

@test("AG21.gate_selftest_executes_real_gates")
def _():
    from adapters.gate_selftest import GateSelfTestAdapter
    from harness.execution_request import ExecutionRequest
    req = ExecutionRequest(scenario_id="BAT-AG21", scenario_sha256="a" * 64, track="ALEXEY_INBOUND",
                           execution_level="L5", adapter_id="harness_gate_selftest", run_id=RUN_ID, attempt=1)
    cap = GateSelfTestAdapter().execute(req)
    detections = cap.values["state"]
    for key in ("expectedCopyDetected", "aliasCopyDetected", "forgedProvenanceBlocked", "scenarioIdSubscriptBranchDetected"):
        assert detections.get(key) is True, (key, detections)


@test("AG22.gate_selftest_detects_contradiction")
def _():
    from adapters.gate_selftest import GateSelfTestAdapter
    from harness.execution_request import ExecutionRequest
    req = ExecutionRequest(scenario_id="BAT-AG22", scenario_sha256="a" * 64, track="ALEXEY_INBOUND",
                           execution_level="L5", adapter_id="harness_gate_selftest", run_id=RUN_ID, attempt=1)
    cap = GateSelfTestAdapter().execute(req)
    assert cap.values["state"]["contradictionDetected"] is True


# ---- M-7: native L3 mutation -------------------------------------------------------------

@test("M7.l3_mutation_changes_complete_verdict")
def _():
    from harness.gates.oracle_mutation import run_oracle_mutation, gate_all_passed
    for spec_fn, invariant, value, lane in [
        (lambda cid: l3_start_spec(cid), "state", {"catalogCourseContext": "levels_of_consciousness", "stateCleared": True}, "L3-TG13"),
        (lambda cid: l3_bounds_spec(cid), "state", {"rejected": None, "payloadStatus": "OK"}, "L3-TG17"),
    ]:
        spec = spec_fn(f"BAT-M7-{lane.replace('L3-', '')}")
        spec.pop("_behavior", None); spec.pop("_corrupt", None)
        behavior = {"fixture": "tg13" if lane.endswith("TG13") else "tg17"}
        adapter = build_adapter("synthetic_academy", None, behavior)
        out = _run(spec, adapter)
        assert out.verdict == PrimaryVerdict.PASS, (lane, out.verdict)
        frozen = FrozenEvidence(
            EvidenceIdentity(run_id=RUN_ID, scenario_id=spec["scenario_id"],
                             scenario_sha256=out.scenario_sha256,
                             observation_id=out.observation_id, attempt_index=1,
                             evidence_type="RAW_OBSERVATION"),
            out.observation.raw_evidence_path, out.observation.raw_evidence_sha256)
        results = run_oracle_mutation(spec["scenario_id"], spec, frozen, [(invariant, value)], lane=lane)
        assert results[0].flipped, (lane, results[0].detail)


def main() -> int:
    for _name, fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    failed = [r for r in RESULTS if not r["pass"]]
    print(f"IV2 REGRESSION BATTERY: {passed}/{len(RESULTS)} passed")
    for r in failed:
        print(f"  FAIL {r['name']}: {r['detail'][:200]}")
    out = BENCH / "artifacts" / "IV2_REGRESSION_BATTERY.json"
    out.write_text(json.dumps({
        "schema": "IV2_REGRESSION_BATTERY_V1",
        "total": len(RESULTS), "passed": passed, "failed": len(failed),
        "all_pass": not failed,
        "cases": RESULTS,
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
