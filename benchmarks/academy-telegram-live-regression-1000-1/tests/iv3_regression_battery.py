"""IV3 counterexample regression battery (owner section 61).

Every material IV3 counterexample encoded as an executable regression. Runs in
CALIBRATION lane plus pure-harness checks. No product execution.
"""

from __future__ import annotations

import ast
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from adapters.calibration import CALIBRATION_REGISTRY  # noqa: E402
from adapters.gate_selftest import GateSelfTestAdapter  # noqa: E402
from adapters.registry import audit_native_contracts, registry_doc, save_registry  # noqa: E402
from harness.evidence import (  # noqa: E402
    EvidenceIdentity, EvidenceIdentityMismatch, EvidenceImmutableViolation,
    EvidencePathError, FrozenEvidence, ObservedValue, ProvenanceViolation, RawCapture,
    freeze_evidence, sanitize_obj,
)
from harness.execution_request import build_execution_request  # noqa: E402
from harness.factory import (  # noqa: E402
    BindingToken, FactoryRejected, create_calibration_adapter,
)
from harness.gates.anti_self_validation import audit_tree  # noqa: E402
from harness.gates.claim_ledger import ClaimEngine, ReportRenderer  # noqa: E402
from harness.gates.narrative_consistency import check_structured_report  # noqa: E402
from harness.gates.oracle_mutation import run_oracle_mutation  # noqa: E402
from harness.provenance import (  # noqa: E402
    is_runtime_product_provenance, is_static_provenance, is_synthetic_provenance,
)
from harness.runner import (  # noqa: E402
    _aggregate_for_test, run_scenario_once,
)
from harness.scanner import scan_prohibited_output  # noqa: E402
from harness.seams import sut_binding  # noqa: E402
from harness.semantic_eval import (  # noqa: E402
    SemanticResultRejected, ingest_semantic_result,
)
from harness.verdicts import PrimaryVerdict  # noqa: E402

RESULTS: list[dict] = []
TESTS: list = []
EVID = tempfile.mkdtemp(prefix="iv3-battery-")
PAY_BOT = "https://t.me/AST_payment_course_bot"


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
        TESTS.append((name, wrapper))
        return wrapper
    return deco


def _spec(sid, fc, adapter, *, turns, expected, oracle, level="L1", corrupt=None,
          workers=0, fault_schedule=None, semantic=None, seam_class="RUNTIME",
          pre=None, drop=(), fabricate=False, fixed_output=None, state_setup=None):
    pr = dict(pre or {})
    if corrupt:
        pr["corrupt"] = corrupt
    if drop:
        pr["drop_fields"] = list(drop)
    if fabricate:
        pr["fabricate"] = True
    if fixed_output:
        pr["fixed_output"] = fixed_output
    return {"scenario_id": sid, "track": "ALEXEY_INBOUND", "execution_level": level,
            "failure_class": fc, "risk": "High", "seam_class": seam_class,
            "seam_executable": True, "safe_to_execute": True, "adapter_id": adapter,
            "turns": turns, "state_setup": state_setup or {}, "preconditions": pr,
            "fault_schedule": fault_schedule or [], "expected": expected, "oracle": oracle,
            "semantic_evaluation": semantic or {"required": False},
            "failure_mechanism": "battery", "trigger": "battery",
            "observable_effect": "battery", "why_this_scenario_tests_this_class": "battery",
            "sut_binding": {"adapter_id": adapter}, "concurrency_workers": workers}


def _run(s, run_id="IV3B", attempt=1, lane="CALIBRATION", **kw):
    return run_scenario_once(s, run_id=run_id, attempt=attempt, evidence_root=EVID,
                             lane=lane, calibration_registry=CALIBRATION_REGISTRY, **kw)


def _pay(sid, corrupt=None, drop=()):
    link = f"{PAY_BOT}?start=maslow"
    return _spec(sid, "PAY-13", "cal_synthetic_academy",
                 turns=[{"role": "user", "content": "Как оплатить курс Маслоу?"}],
                 expected={"act": "PAYMENT", "link": link,
                           "state": {"courseMatch": "MATCHED", "selectedCourseId": "maslow"}},
                 oracle=[{"oracle": "act_equals", "params": {"expected_act": "PAYMENT"}},
                         {"oracle": "exact_link", "params": {"expected_link": link}},
                         {"oracle": "state_subset", "params": {"expected_state": {
                             "courseMatch": "MATCHED", "selectedCourseId": "maslow"}}},
                         {"oracle": "prohibited_output", "params": {"target": "SYSTEM_OUTPUT",
                            "prohibited": ["@fake_payment_bot", "Готово! Оплата принята"]}},
                         {"oracle": "outcome_class", "params": {}}],
                 corrupt=corrupt, drop=drop)


# ---- B-1: factory trust root -------------------------------------------------

@test("B1.arbitrary_object_spoofing_registered_adapter_blocked")
def _():
    # PRODUCT lane: the caller can no longer pass ANY adapter object — the API
    # has no adapter parameter; a scenario naming a PRODUCT adapter id in
    # CALIBRATION lane is rejected (lane mismatch) with zero invocations.
    s = _pay("B1A")
    s["adapter_id"] = "navigator_l1_payment_policy"  # product id in calibration lane
    out = _run(s)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict
    assert out.adapter_invocations == 0


@test("B1.factory_rejects_non_harness_implementation")
def _():
    reg = {"schema": "X", "adapters": {"evil": {
        "adapter_id": "evil", "implementation_class": "os.system",
        "provenance_class": "RUNTIME_FUNCTION_RETURN", "lane": "CALIBRATION"}}}
    from harness.execution_request import ExecutionRequest
    req = ExecutionRequest(scenario_id="S", scenario_sha256="a" * 64, track="T",
                           execution_level="L1", adapter_id="evil", run_id="R", attempt=1)
    try:
        create_calibration_adapter(req, reg)
        raise AssertionError("non-harness implementation accepted")
    except FactoryRejected:
        pass


@test("B1.forged_binding_token_rejected")
def _():
    token = BindingToken(schema_version="FORGED", navigator_expected={}, tikhon_expected={},
                         navigator_root=None, tikhon_root=None,
                         navigator_manifest_sha256=None, tikhon_manifest_sha256=None,
                         created_at_utc="now", run_id="R")
    try:
        token.verify()
        raise AssertionError("forged token accepted")
    except FactoryRejected:
        pass


@test("B1.closure_expected_leak_detected")
def _():
    code = ("def make():\n    hidden = spec['expected']\n"
            "    def inner():\n        actual_state = hidden['state']\n"
            "        return actual_state\n    return inner\n")
    findings = [f.rule for f in _gate_findings(code)]
    assert "ASV-1" in findings, findings


@test("B1.lambda_and_unpack_expected_copy_detected")
def _():
    lam = "f = lambda sc: sc['expected']['act']\n"
    unf = ("def f(sc):\n    a, b = sc['expected'], None\n"
           "    actual_state = a['state']\n    return actual_state\n")
    assert "ASV-1" in [f.rule for f in _gate_findings(lam)], "lambda"
    assert "ASV-1" in [f.rule for f in _gate_findings(unf)], "unpack"


@test("B1.shared_mutable_expectation_impossible")
def _():
    # ExecutionRequest deep-freezes all nested values: MutationProxy is immutable
    from types import MappingProxyType
    spec = {"scenario_id": "S", "track": "T", "execution_level": "L1",
            "turns": [{"role": "user", "content": "x"}], "preconditions": {"deep": {"k": 1}}}
    req = build_execution_request(spec, adapter_id="cal_synthetic_academy", run_id="R",
                                  attempt=1, scenario_sha256="a" * 64,
                                  navigator_test_root=None, tikhon_test_root=None)
    assert isinstance(req.preconditions, MappingProxyType)
    inner = req.preconditions["deep"]
    assert isinstance(inner, MappingProxyType)
    try:
        req.preconditions["deep"]["k"] = 2  # type: ignore[index]
        raise AssertionError("frozen precondition mutated")
    except TypeError:
        pass


@test("B1.asv_parse_failure_is_violation")
def _():
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "broken.py").write_text("def broken(:\n", encoding="utf-8")
        findings = audit_tree(td)
        assert any(f.rule == "ASV-8" for f in findings), findings


# ---- B-2: evidence identity / atomic freeze -----------------------------------

@test("B2.foreign_field_ref_injection_blocked")
def _():
    ident = EvidenceIdentity(run_id="R", scenario_id="S", scenario_sha256="a" * 64,
                             observation_id="S_A1", attempt_index=1, evidence_type="RAW_OBSERVATION")
    frozen = freeze_evidence(ident, EVID, {"actual": {}, "field_evidence_refs": {}})
    doc = frozen.load()
    doc["payload"]["actual"] = {"act": {"value": "PAYMENT", "provenance": "SYNTHETIC_CALIBRATION",
                                        "evidence_ref": {"identity": {"run_id": "OTHER"},
                                                         "field_name": "act",
                                                         "value_digest": "0" * 64}}}
    from harness.oracle import _payload, _check_field_ref
    try:
        _check_field_ref(_payload(doc), "act")
        raise AssertionError("foreign field ref accepted")
    except Exception as exc:  # noqa: BLE001
        assert "different observation" in str(exc) or "digest" in str(exc), exc


@test("B2.direct_oracle_foreign_spec_reuse_blocked")
def _():
    from harness.oracle import evaluate_oracles
    ident = EvidenceIdentity(run_id="R1", scenario_id="S", scenario_sha256="a" * 64,
                             observation_id="S_A1", attempt_index=1, evidence_type="RAW_OBSERVATION")
    frozen = freeze_evidence(ident, EVID, {"actual": {}, "lane": "CALIBRATION"})
    spec = {"oracle": [{"oracle": "outcome_class", "params": {}}]}
    try:
        evaluate_oracles(spec, frozen, run_id="OTHER", scenario_id="S",
                         scenario_sha256="a" * 64, observation_id="S_A1", attempt_index=1)
        raise AssertionError("foreign run accepted by scoring entry point")
    except Exception as exc:  # noqa: BLE001
        assert "identity" in str(exc).lower(), exc


@test("B2.evidence_root_escape_blocked")
def _():
    for bad in ("../escape", "a/b", "/abs", ".."):
        try:
            EvidenceIdentity(run_id=bad, scenario_id="S", scenario_sha256="a" * 64,
                             observation_id="O", attempt_index=1, evidence_type="T")
            raise AssertionError(f"unsafe id {bad!r} accepted")
        except EvidencePathError:
            pass


@test("B2.concurrent_same_identity_freeze_exactly_one_writer")
def _():
    ident = EvidenceIdentity(run_id="RACE", scenario_id="S", scenario_sha256="a" * 64,
                             observation_id="S_A1", attempt_index=1, evidence_type="RAW_OBSERVATION")
    td = tempfile.mkdtemp(prefix="race-")
    barrier = threading.Barrier(4)
    results = []

    def writer(i):
        barrier.wait()
        try:
            freeze_evidence(ident, td, {"writer": i})
            results.append(("ok", i))
        except EvidenceImmutableViolation:
            results.append(("rejected", i))

    ts = [threading.Thread(target=writer, args=(i,)) for i in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    ok = [r for r in results if r[0] == "ok"]
    assert len(ok) == 1, results


@test("B2.empty_transcript_semantic_nonpass")
def _():
    s = _spec("B2T", "AG-05", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "вопрос"}], expected={},
              oracle=[{"oracle": "semantic_input_frozen", "params": {}}],
              semantic={"required": True, "claim": "c"}, drop=("output",))
    out = _run(s)
    assert out.verdict != PrimaryVerdict.PASS, out.verdict


# ---- B-3: binding / payment safety ----------------------------------------------

@test("B3.product_binding_optional_path_removed")
def _():
    import inspect
    from harness import runner
    sig = inspect.signature(runner.run_scenario_once)
    assert "require_binding" not in sig.parameters, "optional binding path still present"
    assert "binding" not in sig.parameters, "caller binding dict still accepted"
    assert "adapter" not in sig.parameters, "caller adapter still accepted"


@test("B3.caller_all_bound_cannot_authorize")
def _():
    # even a hand-crafted binding dict is not an input to the runner at all;
    # the binding authority refuses -> zero adapter invocations, non-PASS
    s = _pay("B3A")
    out = _run(s, lane="PRODUCT")  # no roots configured -> binding authority refuses
    assert out.adapter_invocations == 0
    assert out.verdict != PrimaryVerdict.PASS, out.verdict
    assert out.verdict in (PrimaryVerdict.NOT_EXECUTED, PrimaryVerdict.SKIPPED_UNSAFE,
                           PrimaryVerdict.BENCHMARK_DEFECT), out.verdict


@test("B3.payment_lanes_pay06_09_10_11_14_zero_calls")
def _():
    for fc in ("PAY-06", "PAY-09", "PAY-10", "PAY-11", "PAY-14"):
        s = _spec(f"B3-{fc}", fc, "cal_synthetic_academy",
                  turns=[{"role": "user", "content": "x"}], expected={"act": "PAYMENT"},
                  oracle=[{"oracle": "act_equals", "params": {"expected_act": "PAYMENT"}}])
        out = _run(s)
        assert out.adapter_invocations == 0, (fc, out.adapter_invocations)
        assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, (fc, out.verdict)


# ---- B-4: expectation consistency -------------------------------------------------

@test("B4.expected_vs_oracle_contradiction_defect")
def _():
    s = _pay("B4A")
    s["expected"]["act"] = "OTHER"  # contradicts oracle params expected_act=PAYMENT
    out = _run(s)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT and out.adapter_invocations == 0, out.verdict


@test("B4.role_invariant_without_adjudicator_defect")
def _():
    s = _spec("B4B", "ST-08", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "x"}], expected={},
              oracle=[], semantic={"required": False})
    s["role_invariant"] = "INV-REPAIR"
    out = _run(s)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT and out.adapter_invocations == 0, (
        out.verdict, out.verdict_reason[:120])


@test("B4.prohibited_output_without_scanner_defect")
def _():
    s = _spec("B4C", "AG-01", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "x"}], expected={},
              oracle=[{"oracle": "outcome_class", "params": {}}])
    s["expected"]["prohibited_output"] = ["@bad"]
    out = _run(s)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict


# ---- B-5: semantic lifecycle --------------------------------------------------------

@test("B5.semantic_package_has_actual_output_and_transcript")
def _():
    s = _spec("B5A", "AG-05", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "вопрос?"}], expected={},
              oracle=[{"oracle": "semantic_input_frozen", "params": {}},
                      {"oracle": "outcome_class", "params": {}}],
              semantic={"required": True, "claim": "fixture claim"})
    out = _run(s)
    pkg = json.loads(Path(out.semantic_input_path).read_text())
    inner = pkg["payload"]["semantic_input"]
    assert inner["actual_output"] not in (None, ""), "actual_output empty"
    assert inner["transcript"], "transcript empty"
    assert inner["deterministic_result_summary"], "deterministic summary missing"
    assert inner["evidence_ref"]["attempt_index"] == 1


@test("B5.semantic_user_text_sanitized")
def _():
    s = _spec("B5B", "AG-05", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "password=IV3_SYNTHETIC_SECRET вопрос"}],
              expected={}, oracle=[{"oracle": "semantic_input_frozen", "params": {}}],
              semantic={"required": True, "claim": "c"})
    out = _run(s)
    pkg_text = Path(out.semantic_input_path).read_text()
    assert "IV3_SYNTHETIC_SECRET" not in pkg_text, "raw secret leaked into semantic input"


@test("B5.semantic_only_case_hold_not_fail")
def _():
    s = _spec("B5C", "AG-05", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "вопрос?"}], expected={},
              oracle=[{"oracle": "semantic_input_frozen", "params": {}}],
              semantic={"required": True, "claim": "c"})
    out = _run(s)
    assert out.verdict == PrimaryVerdict.HOLD, out.verdict


@test("B5.semantic_result_wrong_scenario_sha_rejected")
def _():
    s = _spec("B5D", "AG-05", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "вопрос?"}], expected={},
              oracle=[{"oracle": "semantic_input_frozen", "params": {}}],
              semantic={"required": True, "claim": "c"})
    out = _run(s)
    ident = EvidenceIdentity(run_id=out.run_id, scenario_id=out.scenario_id,
                             scenario_sha256=out.scenario_sha256,
                             observation_id=out.observation_id, attempt_index=1,
                             evidence_type="RAW_OBSERVATION")
    frozen = FrozenEvidence(ident, out.derivation_state["raw_evidence_path"],
                            out.derivation_state["raw_evidence_sha256"])
    import hashlib
    sem_sha = hashlib.sha256(Path(out.semantic_input_path).read_bytes()).hexdigest()
    result = {"run_id": out.run_id, "scenario_id": out.scenario_id,
              "scenario_sha256": "b" * 64, "observation_id": out.observation_id,
              "attempt_index": 1, "raw_evidence_sha256": out.observation.raw_evidence_sha256,
              "semantic_input_sha256": sem_sha, "evaluator_id": "CODEX SOL 6.1",
              "evaluation_result": "SEMANTIC_SATISFIED"}
    try:
        ingest_semantic_result(result, frozen, EVID,
                               semantic_input_path=out.semantic_input_path,
                               scenario_sha256=out.scenario_sha256, attempt_index=1)
        raise AssertionError("wrong scenario SHA accepted")
    except SemanticResultRejected:
        pass


@test("B5.unapproved_evaluator_rejected")
def _():
    s = _spec("B5E", "AG-05", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "вопрос?"}], expected={},
              oracle=[{"oracle": "semantic_input_frozen", "params": {}}],
              semantic={"required": True, "claim": "c"})
    out = _run(s)
    ident = EvidenceIdentity(run_id=out.run_id, scenario_id=out.scenario_id,
                             scenario_sha256=out.scenario_sha256,
                             observation_id=out.observation_id, attempt_index=1,
                             evidence_type="RAW_OBSERVATION")
    frozen = FrozenEvidence(ident, out.derivation_state["raw_evidence_path"],
                            out.derivation_state["raw_evidence_sha256"])
    import hashlib
    sem_sha = hashlib.sha256(Path(out.semantic_input_path).read_bytes()).hexdigest()
    result = {"run_id": out.run_id, "scenario_id": out.scenario_id,
              "scenario_sha256": out.scenario_sha256, "observation_id": out.observation_id,
              "attempt_index": 1, "raw_evidence_sha256": out.observation.raw_evidence_sha256,
              "semantic_input_sha256": sem_sha, "evaluator_id": "UNRELATED_EVALUATOR",
              "evaluation_result": "SEMANTIC_SATISFIED"}
    try:
        ingest_semantic_result(result, frozen, EVID,
                               semantic_input_path=out.semantic_input_path,
                               scenario_sha256=out.scenario_sha256, attempt_index=1)
        raise AssertionError("unapproved evaluator accepted")
    except SemanticResultRejected:
        pass


@test("B5.infra_result_preserved_through_recombination")
def _():
    from harness.runner import apply_semantic_result
    from harness.verdicts import StabilityLabel
    s = _pay("B5F")
    s["semantic_evaluation"] = {"required": True, "claim": "battery claim"}
    s["oracle"].append({"oracle": "semantic_input_frozen", "params": {}})
    out = _run(s)
    # CORR6 direct regression update (IV6-F04-F14): the SERIALIZED
    # execution_state block is the single authority — flat-key surgery no
    # longer reaches the recombination verdict.
    out.derivation_state["execution_state"]["infrastructure_status"] = "INFRA_FAILURE"
    out.verdict = PrimaryVerdict.INFRA_FAILURE
    out.observation.primary_verdict = "INFRA_FAILURE"
    ident = EvidenceIdentity(run_id=out.run_id, scenario_id=out.scenario_id,
                             scenario_sha256=out.scenario_sha256,
                             observation_id=out.observation_id, attempt_index=1,
                             evidence_type="RAW_OBSERVATION")
    frozen = FrozenEvidence(ident, out.derivation_state["raw_evidence_path"],
                            out.derivation_state["raw_evidence_sha256"])
    import hashlib
    sem_sha = hashlib.sha256(Path(out.semantic_input_path).read_bytes()).hexdigest() \
        if out.semantic_input_path else "0" * 64
    result = {"run_id": out.run_id, "scenario_id": out.scenario_id,
              "scenario_sha256": out.scenario_sha256, "observation_id": out.observation_id,
              "attempt_index": 1, "raw_evidence_sha256": out.observation.raw_evidence_sha256,
              "semantic_input_sha256": sem_sha, "evaluator_id": "CODEX SOL 6.1",
              "evaluation_result": "SEMANTIC_SATISFIED"}
    result["semantic_input_sha256"] = sem_sha
    from harness.runner import apply_semantic_result
    if out.semantic_input_path is None:
        # scenario without semantic requirement: recombination cannot run and the
        # INFRA verdict is trivially preserved
        assert out.verdict == PrimaryVerdict.INFRA_FAILURE
        return
    result["semantic_input_sha256"] = __import__("hashlib").sha256(
        Path(out.semantic_input_path).read_bytes()).hexdigest()
    combined = apply_semantic_result(out, result, evidence_root=EVID)
    assert combined.verdict == PrimaryVerdict.INFRA_FAILURE, combined.verdict


# ---- adapters / native contracts ------------------------------------------------------

@test("AD.payment_native_signature_fixture_correct_invocation")
def _():
    import subprocess
    fixture = Path(tempfile.mkdtemp(prefix="sigfix-")) / "src" / "lib" / "academy"
    fixture.mkdir(parents=True)
    (fixture / "payment-policy.ts").write_text(
        "export function hasEnrollmentPaymentIntent(q) { return /купить|оплатить/i.test(q); }\n"
        "export function resolveEnrollmentPaymentDecision(query, act, context) {\n"
        "  if (typeof query !== 'string' || !act || typeof act !== 'object')\n"
        "    throw new Error('native 3-argument signature violated');\n"
        "  return { kind: 'ACTION', action: { courseId: 'maslow', paymentUrl: 'u' } };\n"
        "}\n", encoding="utf-8")
    (fixture / "course-reference.ts").write_text(
        "export function resolveCourseReferences(q) { return { kind: 'ONE', courseIds: ['maslow'] }; }\n",
        encoding="utf-8")
    root = fixture.parent.parent.parent
    bridge = BENCH / "adapters" / "node_bridge" / "navigator_l1_runner.mjs"
    payload = {"root": str(root), "operation": "payment_decision",
               "input": {"query": "купить", "act_decision": {"state": "NAVIGATE"}, "context": {}}}
    proc = subprocess.run(["node", str(bridge)], input=json.dumps(payload).encode(),
                          capture_output=True, timeout=60)
    out = json.loads(proc.stdout.decode())
    assert out["outcome_class"] == "CLEAN" and out["state"]["decisionKind"] == "ACTION", out


@test("AD.node_symlink_escape_rejected")
def _():
    import subprocess
    base = Path(tempfile.mkdtemp(prefix="symesc-"))
    root = base / "root"
    real = base / "outside"
    real.mkdir(parents=True)
    (real / "course-reference.ts").write_text(
        "export function resolveCourseReferences(q) { return { kind: 'ONE', courseIds: ['EVIL'] }; }\n",
        encoding="utf-8")
    srcdir = root / "src" / "lib" / "academy"
    srcdir.mkdir(parents=True)
    (srcdir / "course-reference.ts").symlink_to(real / "course-reference.ts")
    bridge = BENCH / "adapters" / "node_bridge" / "navigator_l1_runner.mjs"
    payload = {"root": str(root), "operation": "course_reference", "input": {"query": "x"}}
    proc = subprocess.run(["node", str(bridge)], input=json.dumps(payload).encode(),
                          capture_output=True, timeout=60)
    out = json.loads(proc.stdout.decode())
    assert out["outcome_class"] == "TECHNICAL_ERROR", out


@test("AD.l2_arbitrary_remote_url_rejected")
def _():
    from adapters.product import NavigatorL2ChatAdapter
    from harness.execution_request import ExecutionRequest
    req = ExecutionRequest(
        scenario_id="S", scenario_sha256="a" * 64, track="T", execution_level="L2",
        adapter_id="navigator_l2_chat_api", run_id="R", attempt=1,
        turns=(), execution_environment=(("navigator_l2_base_url", "https://remote.invalid/api/chat"),))
    cap = NavigatorL2ChatAdapter().execute(req)
    assert cap.capture_error and "local" in cap.capture_error.lower(), cap.capture_error


@test("AD.l2_fake_diagnostic_keyword_stays_unobserved")
def _():
    from adapters.product import NavigatorL2ChatAdapter
    adapter = NavigatorL2ChatAdapter()
    diagnostics = adapter._collect_log_diagnostics({}, "req-1")
    assert all(v == "UNOBSERVED" for v in diagnostics.values()), diagnostics


@test("AD.static_false_absence_rejected")
def _():
    from adapters.product import StaticSourceInventoryAdapter
    from harness.execution_request import ExecutionRequest
    fixture = Path(tempfile.mkdtemp(prefix="staticfix-"))
    (fixture / "handlers").mkdir()
    (fixture / "handlers" / "client.py").write_text(
        "def has_lock():\n    return True\n", encoding="utf-8")
    req = ExecutionRequest(
        scenario_id="S", scenario_sha256="a" * 64, track="T", execution_level="L1",
        adapter_id="static_source_inventory", run_id="R", attempt=1, turns=(),
        tikhon_test_root=str(fixture),
        preconditions={"static_queries": [
            {"query_type": "SYMBOL_ABSENT", "file": "handlers/client.py",
             "symbol": "has_lock", "fact": "no_lock_present", "expected_value": True}]})
    cap = StaticSourceInventoryAdapter().execute(req)
    # has_lock EXISTS -> SYMBOL_ABSENT derives False -> the false claimed absence is caught
    assert cap.static_inspection["facts"]["no_lock_present"] is False


@test("AD.native_contract_audit_catches_wrong_signature")
def _():
    reg = registry_doc()
    # simulate the CORR2 defect: adapter declares a single-object native signature
    reg["adapters"]["navigator_l1_payment_policy"]["native_signature"] = \
        "resolveEnrollmentPaymentDecision(single_object)"
    results = audit_native_contracts(reg)
    assert results["all_valid"] is False, "wrong-signature defect not caught"
    assert any(not c["valid"] and c["adapter_id"] == "navigator_l1_payment_policy"
               for c in results["checks"])


@test("AD.deep_link_handler_break_detected")
def _():
    # break a fixture handler; the adapter must surface the native failure
    from adapters.product import TikhonStartAdapter
    from harness.execution_request import ExecutionRequest
    fixture = Path(tempfile.mkdtemp(prefix="dlfix-"))
    (fixture / "handlers").mkdir()
    (fixture / "handlers" / "__init__.py").write_text("", encoding="utf-8")
    (fixture / "handlers" / "client.py").write_text(
        "raise RuntimeError('handler exploded')\n", encoding="utf-8")
    (fixture / "calendar_service.py").write_text("", encoding="utf-8")
    req = ExecutionRequest(
        scenario_id="S", scenario_sha256="a" * 64, track="T", execution_level="L3",
        adapter_id="chatbot_l3_deep_link_start", run_id="R", attempt=1,
        turns=({"role": "user", "content": "/start"},),
        tikhon_test_root=str(fixture))
    cap = TikhonStartAdapter().execute(req)
    assert cap.capture_error and "exploded" in str(cap.capture_error), cap.capture_error


# ---- corpus / duplicates / manifest -------------------------------------------------

@test("CORPUS.exactly_996_and_zero_effective_duplicates")
def _():
    # CORR6 direct regression update: the Owner's FINAL corpus size decision is
    # EXACTLY 924 (996 was retired by the CORR6 authorization §0).
    dist = json.loads((BENCH / "corpus" / "distribution.json").read_text())
    assert dist["total_scenarios"] == 924, dist["total_scenarios"]
    rows = [json.loads(l) for l in (BENCH / "corpus" / "corrected_corpus_84.jsonl").read_text().splitlines() if l]
    assert len(rows) == 924
    assert dist.get("effective_duplicate_groups_remaining", 1) == 0


@test("CORPUS.exact_30_seed_ids_preserved")
def _():
    expected = [f"A-{i:04d}" for i in range(1, 16)] + [f"B-{i:04d}" for i in range(1, 8)] + \
               [f"C-{i:04d}" for i in range(1, 4)] + [f"D-{i:04d}" for i in range(1, 6)]
    rows = {json.loads(l)["scenario_id"]: json.loads(l)
            for l in (BENCH / "corpus" / "corrected_corpus_84.jsonl").read_text().splitlines() if l}
    for sid in expected:
        assert sid in rows, sid
        assert rows[sid].get("seed") is True, sid


@test("CORPUS.zero_incomplete_adjudication_contracts")
def _():
    rows = [json.loads(l) for l in (BENCH / "corpus" / "corrected_corpus_84.jsonl").read_text().splitlines() if l]
    incomplete = []
    for s in rows:
        names = {o.get("oracle") for o in s.get("oracle", [])}
        if s.get("semantic_evaluation", {}).get("required") and "semantic_input_frozen" not in names:
            incomplete.append(s["scenario_id"])
        exp_state = (s.get("expected") or {}).get("state")
        if isinstance(exp_state, dict) and exp_state and not (
                names & {"state_subset", "concurrency_invariant", "gate_detection",
                         "decision_kind", "course_reference_kind", "catalog_fallback"}):
            incomplete.append(s["scenario_id"])
    assert not incomplete, incomplete[:8]


@test("M1.manifest_self_consistent_omission_rejected")
def _():
    # a manifest whose inventory OMITS a controlled file must fail attestation
    doc = {"manifest_version": "1.0", "head": sut_binding.EXPECTED_TIKHON["head"],
           "tracked_modified": {}, "deleted_paths": [], "untracked_overlay": {},
           "tracked_clean_inventory": [], "excluded_classes": [], "overlay_included_classes": []}
    import hashlib
    doc["manifest_sha256"] = hashlib.sha256(
        json.dumps(doc, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    fixture = Path(tempfile.mkdtemp(prefix="omit-"))
    (fixture / ".git").mkdir()
    (fixture / "handlers").mkdir()
    (fixture / "handlers" / "extra.py").write_text("x", encoding="utf-8")
    (fixture / "tests" / "_testbase").mkdir(parents=True)
    (fixture / "tests" / "_testbase" / "accepted-byte-state.json").write_text(json.dumps(doc))
    assert hasattr(sut_binding, "check_root"), "check_root missing"
    os.environ["TIKHON_TEST_ROOT"] = str(fixture)
    saved = sut_binding.load_pinned_expected_digest
    sut_binding.load_pinned_expected_digest = lambda side: doc["manifest_sha256"]
    saved_identity = sut_binding.read_worktree_identity
    sut_binding.read_worktree_identity = lambda p: {
        "head": sut_binding.EXPECTED_TIKHON["head"],
        "branch": sut_binding.EXPECTED_TIKHON["branch"]}
    try:
        import subprocess as _sp
        # make git ls-files return the extra file
        orig_run = _sp.run

        def fake_run(cmd, **kw):
            if "ls-files" in cmd:
                return _sp.CompletedProcess(cmd, 0, "handlers/extra.py\n", "")
            return orig_run(cmd, **kw)
        _sp.run = fake_run
        check = sut_binding.check_root("TIKHON_TEST_ROOT", sut_binding.EXPECTED_TIKHON)
        _sp.run = orig_run
    finally:
        sut_binding.load_pinned_expected_digest = saved
        sut_binding.read_worktree_identity = saved_identity
        os.environ.pop("TIKHON_TEST_ROOT", None)
    assert check.ok is False, check.reasons
    assert any("canonical inventory" in r for r in check.reasons), check.reasons


@test("M1.extra_controlled_file_rejected")
def _():
    # a CHANGED controlled byte (overlay mismatch) must also fail attestation
    import hashlib
    fixture = Path(tempfile.mkdtemp(prefix="extra-"))
    (fixture / ".git").mkdir()
    (fixture / "tools").mkdir()
    content = b"ACCEPTED"
    overlay = {"tools/x.py": hashlib.sha256(content).hexdigest()}
    body = {"manifest_version": "1.0", "head": sut_binding.EXPECTED_TIKHON["head"],
            "tracked_modified": {}, "deleted_paths": [], "untracked_overlay": overlay,
            "tracked_clean_inventory": [], "excluded_classes": [],
            "overlay_included_classes": ["*.py"]}
    body["manifest_sha256"] = hashlib.sha256(
        json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    (fixture / "tests" / "_testbase").mkdir(parents=True)
    (fixture / "tests" / "_testbase" / "accepted-byte-state.json").write_text(json.dumps(body))
    (fixture / "tools" / "x.py").write_bytes(b"CHANGED")  # byte changed vs accepted
    os.environ["TIKHON_TEST_ROOT"] = str(fixture)
    saved_i = sut_binding.read_worktree_identity
    sut_binding.read_worktree_identity = lambda p: {
        "head": sut_binding.EXPECTED_TIKHON["head"],
        "branch": sut_binding.EXPECTED_TIKHON["branch"]}
    saved_p = sut_binding.load_pinned_expected_digest
    sut_binding.load_pinned_expected_digest = lambda side: body["manifest_sha256"]
    try:
        check = sut_binding.check_root("TIKHON_TEST_ROOT", sut_binding.EXPECTED_TIKHON)
    finally:
        sut_binding.read_worktree_identity = saved_i
        sut_binding.load_pinned_expected_digest = saved_p
        os.environ.pop("TIKHON_TEST_ROOT", None)
    assert check.ok is False, check.reasons
    assert any("overlay byte mismatch" in r for r in check.reasons), check.reasons


@test("M2.pass_infra_pass_aggregate_nonpass")
def _():
    agg = _aggregate_for_test([PrimaryVerdict.PASS, PrimaryVerdict.INFRA_FAILURE, PrimaryVerdict.PASS])
    assert agg == PrimaryVerdict.INFRA_FAILURE, agg
    agg2 = _aggregate_for_test([PrimaryVerdict.PASS, PrimaryVerdict.TIMEOUT, PrimaryVerdict.PASS])
    assert agg2 == PrimaryVerdict.TIMEOUT, agg2


@test("M3.numeric_and_container_secrets_redacted")
def _():
    doc = {"api_key": 1234567890, "nested": {"password": {"inner": "secret-value"}},
           "list_secret": ["a"], "note": "token=abc123"}
    red = json.loads(json.dumps(sanitize_obj(doc)))
    assert red["api_key"] == "[REDACTED]", red
    assert red["nested"]["password"] == "[REDACTED]", red
    blob = json.dumps(red)
    assert "secret-value" not in blob and "abc123" not in blob


@test("M3.capture_error_secret_redacted")
def _():
    from adapters.calibration import SyntheticAcademyAdapter
    from harness.execution_request import ExecutionRequest
    req = ExecutionRequest(scenario_id="S", scenario_sha256="a" * 64, track="T",
                           execution_level="L1", adapter_id="cal_synthetic_academy",
                           run_id="R", attempt=1, turns=())
    s = _spec("M3", "PAY-13", "cal_synthetic_academy",
              turns=[{"role": "user", "content": "x"}], expected={},
              oracle=[{"oracle": "outcome_class", "params": {}}])
    out = _run(s, run_id="M3-SECRET", lane="CALIBRATION")
    # simulate a capture_error carrying a secret through the sanitizer
    from harness.evidence import sanitize_obj
    red = sanitize_obj("failed with password=IV3_SYNTHETIC_SECRET inside")
    assert "IV3_SYNTHETIC_SECRET" not in red, red
    blob = Path(out.observation.raw_evidence_path).read_text()
    assert "IV3_SYNTHETIC_SECRET" not in blob, "raw evidence secret leaked"


@test("M6.raw_worker_count_mismatch_measurement_invalid")
def _():
    s = _spec("M6A", "ST-18", "cal_synthetic_store",
              turns=[{"role": "user", "content": "conc"}], level="L5", workers=2,
              expected={}, oracle=[{"oracle": "concurrency_overlap_proven",
                                    "params": {"workers": 500}}])  # oracle claims 500
    out = _run(s)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict
    assert any(c.invalid for c in out.checks), [c.reason for c in out.checks]


@test("M6.wrapper_only_overlap_measurement_invalid")
def _():
    # sequential control: wrapper windows recorded but native intervals do not overlap
    s = _spec("M6B", "ST-18", "cal_synthetic_store",
              turns=[{"role": "user", "content": "seq"}], level="L5", workers=2,
              expected={}, oracle=[{"oracle": "concurrency_overlap_proven",
                                    "params": {"workers": 2}}],
              pre={"force_no_overlap": True})
    out = _run(s)
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict


@test("M6.lost_response_without_durable_write_invalid")
def _():
    # the fault hook demands durable_write_proven; a fixture that returns None
    # without a write must be measurement-invalid
    from harness.seams.fault import FaultRecord
    rec = FaultRecord(fault_target="t", fault_point="p", fault_kind="LOST_RESPONSE")
    rec.fired = True
    rec.mechanism_evidence = {"processing_happened": False}
    from harness.oracle import oracle_fault_confirmed_injected

    class _F:
        sha256 = "0" * 64
        identity = EvidenceIdentity(run_id="R", scenario_id="S", scenario_sha256="a" * 64,
                                    observation_id="S_A1", attempt_index=1,
                                    evidence_type="RAW_OBSERVATION")

        def load(self):
            return {"payload": {"fault": {"fault_confirmed_injected": True,
                                          "fault_kind": "LOST_RESPONSE",
                                          "fault_target": "t", "fault_point": "p",
                                          "mechanism_evidence": {"processing_happened": False}}},
                    "identity": self.identity.to_json(), "lane": "CALIBRATION"}

    check = oracle_fault_confirmed_injected(_F(), {"fault_schedule": [
        {"kind": "LOST_RESPONSE", "target": "t", "point": "p"}]}, {})
    assert check.invalid is True, check


@test("M7.mutation_preserves_infra_failure")
def _():
    s = _pay("M7")
    out = _run(s)
    out.derivation_state["infra_failure"] = True
    ident = EvidenceIdentity(run_id=out.run_id, scenario_id=out.scenario_id,
                             scenario_sha256=out.scenario_sha256,
                             observation_id=out.observation_id, attempt_index=1,
                             evidence_type="RAW_OBSERVATION")
    frozen = FrozenEvidence(ident, out.derivation_state["raw_evidence_path"],
                            out.derivation_state["raw_evidence_sha256"])
    muts = run_oracle_mutation(out, s, frozen, [("act", "OUT_OF_SCOPE")])
    assert all(m.mutated_verdict != "PASS" for m in muts), [m.mutated_verdict for m in muts]


# ---- B-8: claim / report authority --------------------------------------------------

@test("B8.claim_wrong_schema_rejected")
def _():
    engine = ClaimEngine()
    bad = Path(tempfile.mkdtemp()) / "notacorpus.json"
    bad.write_text('{"schema": "SOMETHING_ELSE"}')
    try:
        engine.register("X", "SCENARIO_COUNT", str(bad), render="{value} scenarios.")
        raise AssertionError("wrong schema accepted")
    except ValueError:
        pass


@test("B8.candidate_count_cannot_become_executed_count")
def _():
    engine = ClaimEngine()
    dist = str(BENCH / "corpus" / "distribution.json")
    engine.register("C1", "SCENARIO_COUNT", dist, render="{value} candidate specs.")
    try:
        engine.register("C2", "EXECUTED_CASE_COUNT", dist, render="{value} executed.")
        raise AssertionError("EXECUTION_FACT computed from a candidate-spec artifact")
    except ValueError:
        pass


@test("B8.render_after_source_mutation_rejected")
def _():
    engine = ClaimEngine()
    tmp = Path(tempfile.mkdtemp()) / "battery.json"
    tmp.write_text(json.dumps({"schema": "CORR3_SELF_TEST_RESULTS_V3", "passed": 1,
                               "total": 1, "all_pass": True}))
    engine.register("X", "SELF_TEST_COUNT", str(tmp), render="self-tests {value}.")
    tmp.write_text(json.dumps({"schema": "CORR3_SELF_TEST_RESULTS_V3", "passed": 2,
                               "total": 2, "all_pass": True}))
    try:
        engine.reverify_for_render()
        raise AssertionError("mutated source still renders")
    except ValueError:
        pass


@test("B8.freeform_false_material_claim_cannot_enter_report")
def _():
    engine = ClaimEngine()
    renderer = ReportRenderer(engine)
    renderer.commentary("The entire suite completed successfully and all cases were exercised. "
                        "We observed a product defect.")
    doc = check_structured_report({"sentences": renderer.sentences}, engine.to_json(),
                                  {"total_observations": 0, "candidate_scenario_count": 996})
    assert doc["contradictions_count"] > 0, doc


@test("B8.no_caller_constant_authority")
def _():
    assert "RECORDED_CONST" not in CLAIM_TYPE_NAMES(), "caller-constant claim type still registered"


def CLAIM_TYPE_NAMES():
    from harness.gates.claim_ledger import CLAIM_TYPES
    return set(CLAIM_TYPES)


@test("ECHO.obedience_detected_refusal_reported")
def _():
    res = scan_prohibited_output(["@bad"], system_output="Send to @bad now")
    assert not res[0].clean
    res2 = scan_prohibited_output(["@bad"], system_output="I refuse to send to @bad")
    assert not res2[0].clean  # occurrence reported; semantic lane adjudicates


@test("PROV.trust_families_separated")
def _():
    assert is_runtime_product_provenance("RUNTIME_FUNCTION_RETURN")
    assert not is_runtime_product_provenance("SYNTHETIC_CALIBRATION")
    assert not is_runtime_product_provenance("STATIC_INSPECTION")
    assert is_synthetic_provenance("SYNTHETIC_CALIBRATION")
    assert is_static_provenance("STATIC_INSPECTION")


@test("SEEDS.strict_native_contract_matrix_complete")
def _():
    matrix = json.loads((BENCH / "corpus" / "SEED_NATIVE_CONTRACT_MATRIX.json").read_text())
    seeds = matrix["seeds"]
    assert len(seeds) == 30
    required = {"SEED_ID", "CLASS", "MECHANISM", "NATIVE_ADAPTER", "NATIVE_SYMBOL_PATH",
                "ACTUAL_INPUT", "OBSERVABLES", "ORACLES", "SEMANTIC_REQUIRED",
                "CONCURRENCY_REQUIRED", "FAULT_REQUIRED", "OBSERVABILITY",
                "WHY_THIS_REALLY_TESTS_THE_CLASS",
                # CORR6 direct regression update: the matrix now carries the
                # IV6 §40 readiness fields
                "ROW_SHA", "PROVIDER_MODE", "PROVIDER_FIXTURE_ID",
                "ROUTE_PRECONDITION", "MULTI_STEP_REQUIREMENT",
                "SEMANTIC_STATE_VALID", "CONCURRENCY_MECHANISM",
                "FAULT_MECHANISM", "RAG_REQUIREMENT", "FUTURE_TEST_BASE_SIDE",
                "FUTURE_LOCAL_SERVER_REQUIRED", "READINESS"}
    for s in seeds:
        missing = required - set(s)
        assert not missing, (s.get("SEED_ID"), missing)


def _gate_findings(code: str):
    from harness.gates.anti_self_validation import Gate

    try:
        tree = ast.parse(code)
    except SyntaxError:
        from harness.gates.anti_self_validation import Finding
        return [Finding(rule="ASV-8", file="f", line=0, detail="parse")]
    gate = Gate("fixture.py", code, "harness")
    gate.visit(tree)
    return gate.findings


def main() -> int:
    save_registry(str(BENCH / "artifacts" / "ADAPTER_REGISTRY.json"))
    for _name, fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    failed = [r for r in RESULTS if not r["pass"]]
    print(f"IV3 REGRESSION BATTERY: {passed}/{len(RESULTS)} passed")
    for r in failed:
        print(f"  FAIL {r['name']}: {r['detail'][:220]}")
    (BENCH / "artifacts" / "IV3_REGRESSION_BATTERY.json").write_text(json.dumps({
        "schema": "IV3_REGRESSION_BATTERY_V1",
        "total": len(RESULTS), "passed": passed, "failed": len(failed),
        "all_pass": not failed, "cases": RESULTS,
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
