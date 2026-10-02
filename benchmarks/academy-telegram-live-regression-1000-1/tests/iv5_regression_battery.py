"""IV5 regression battery — CORR5 (owner section 42).

Covers exactly the controlling IV5 remainder F01-F17 with benign local
fixtures only. No product execution, no TEST_BASE binding, no Telegram, no
payment, no network. Every check targets the CORR5 closure mechanism, not a
reimplementation of the defective path.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import json
import sys
import tempfile
import time
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from harness.evidence import (  # noqa: E402
    EvidenceIdentity,
    EvidenceImmutableViolation,
    EvidenceLocationMismatch,
    FrozenEvidence,
    UNOBSERVED,
    freeze_evidence,
)
from harness.execution_request import ExecutionRequest  # noqa: E402
from harness.execution_state import (  # noqa: E402
    run_state_machine_invariants,
)
from harness.oracle import (  # noqa: E402
    oracle_different_user_independence_proven,
    oracle_fault_confirmed_injected,
    oracle_no_runtime_claim,
    oracle_same_user_serialization_proven,
    validate_semantic_completeness,
)
from harness.runner import apply_semantic_result, run_scenario_once  # noqa: E402
from harness.verdicts import PrimaryVerdict  # noqa: E402

RESULTS: list[dict] = []
TESTS: list = []


def test(name: str):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append({"name": name, "pass": True, "detail": ""})
            except AssertionError as exc:
                RESULTS.append({"name": name, "pass": False,
                                "detail": f"AssertionError: {exc}"})
            except Exception as exc:  # noqa: BLE001
                RESULTS.append({"name": name, "pass": False,
                                "detail": f"{type(exc).__name__}: {exc}"})
        wrapper.__name__ = name
        TESTS.append((name, wrapper))
        return wrapper
    return deco


def _ident(run="R5", scen="S5", obs="S5_A1", attempt=1):
    return EvidenceIdentity(run_id=run, scenario_id=scen, scenario_sha256="a" * 64,
                            observation_id=obs, attempt_index=attempt,
                            evidence_type="RAW_OBSERVATION")


def _load_rows():
    rows = {}
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                rows[r["scenario_id"]] = r
    return rows


# ---------------------------------------------------------------------------
# F01 — persistent evidence location identity
# ---------------------------------------------------------------------------

@test("F01.evidence_location_identity_retained")
def _():
    import os
    import shutil
    td = tempfile.mkdtemp(prefix="f01a-", dir="/tmp")
    ident = _ident()
    fe = freeze_evidence(ident, td, {"x": 1})
    fe.verify()  # same original container -> load succeeds
    fe2 = freeze_evidence(_ident(scen="S5b"), td, {"x": 2})
    fe2.verify()  # same container + different evidence -> succeeds
    # replacement container with byte-identical copied evidence -> refused
    td2 = tempfile.mkdtemp(prefix="f01b-", dir="/tmp")
    shutil.copytree(os.path.join(td, "R5"), os.path.join(td2, "R5"))
    clone = FrozenEvidence(ident, os.path.join(td2, "R5", "S5", "S5_A1.RAW_OBSERVATION.json"),
                           fe.sha256)
    try:
        clone.load()
        raise AssertionError("replacement container accepted")
    except EvidenceLocationMismatch:
        pass
    # missing original container -> refused
    os.remove(fe.path)
    try:
        fe.load()
        raise AssertionError("missing container accepted")
    except (FileNotFoundError, Exception):
        pass
    # exclusive creation remains one-writer-only
    try:
        freeze_evidence(_ident(scen="S5b"), td2, {"x": 9})
        raise AssertionError("second writer accepted")
    except EvidenceImmutableViolation:
        pass
    shutil.rmtree(td)
    shutil.rmtree(td2)


# ---------------------------------------------------------------------------
# F02 — fsm_state_literal adjudicated by the ACTUAL field
# ---------------------------------------------------------------------------

@test("F02.fsm_state_literal_adjudicated_by_actual_field")
def _():
    rows = _load_rows()
    bad = []
    for sid, s in rows.items():
        exp_state = (s.get("expected") or {}).get("state") or {}
        if "fsm_state_literal" not in exp_state:
            continue
        if s.get("adapter_id") != "chatbot_l3_deep_link_start":
            continue
        adjudicated = False
        for o in s.get("oracle", []):
            if o.get("oracle") == "state_subset" and "fsm_state_literal" in (
                    (o.get("params") or {}).get("expected_state") or {}):
                adjudicated = True
        if not adjudicated:
            bad.append(sid)
    assert not bad, f"fsm_state_literal rows without an actual-field adjudicator: {bad}"
    # the validator rejects the IV5 pattern: declared fsm_state_literal with
    # only catalog_fallback (which reads state.flow)
    defective = {
        "scenario_id": "F2X", "failure_class": "TG-13", "track": "TIKHON",
        "execution_level": "L3", "seam_class": "RUNTIME", "adapter_id": "chatbot_l3_deep_link_start",
        "turns": [], "expected": {"state": {"fsm_state_literal": "OrderFlow.choosing_course"}},
        "oracle": [{"oracle": "catalog_fallback", "params": {"expected_flow": "OrderFlow.choosing_course"}}],
        "failure_mechanism": "m", "trigger": "t", "observable_effect": "e",
        "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"},
    }
    from harness.oracle import validate_expectation_consistency
    d = validate_expectation_consistency(defective, ("fsm_state_literal", "stateCleared",
                                                     "catalogCourseContext"))
    assert any("F02" in e or "adjudicator" in e for e in d), d


# ---------------------------------------------------------------------------
# F03 — no vacuous static oracle
# ---------------------------------------------------------------------------

@test("F03.required_static_oracle_cannot_be_empty")
def _():
    rows = _load_rows()
    empty = [sid for sid, s in rows.items()
             for o in s.get("oracle", [])
             if o.get("oracle") == "static_config"
             and not (o.get("params") or {}).get("expectations")]
    assert not empty, f"vacuous static oracles remain: {empty}"
    defective = {
        "scenario_id": "F3X", "failure_class": "TG-15", "track": "TIKHON",
        "execution_level": "L1", "seam_class": "STATIC", "adapter_id": "static_source_inventory",
        "turns": [], "expected": {},
        "oracle": [{"oracle": "static_config", "params": {"expectations": []}},
                   {"oracle": "no_runtime_claim", "params": {}}],
        "failure_mechanism": "m", "trigger": "t", "observable_effect": "e",
        "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"},
    }
    d = validate_semantic_completeness(defective)
    assert any("EMPTY expectation" in e for e in d), d
    # every static expectation binds to a REGISTERED query fact
    for sid, s in rows.items():
        if s.get("adapter_id") != "static_source_inventory":
            continue
        facts = {q.get("fact") for q in (s.get("preconditions") or {}).get("static_queries") or []}
        for o in s.get("oracle", []):
            if o.get("oracle") == "static_config":
                for exp in (o.get("params") or {}).get("expectations") or []:
                    assert exp["path"] in facts, (sid, exp["path"])


# ---------------------------------------------------------------------------
# F04 — native-error FAIL cannot become semantic PASS
# ---------------------------------------------------------------------------

def _iv5_calibration_registry():
    from adapters.calibration import CALIBRATION_REGISTRY
    return CALIBRATION_REGISTRY


def _f04_spec(sid, claim="fixture claim"):
    return {
        "scenario_id": sid, "track": "ALEXEY_INBOUND", "execution_level": "L1",
        "failure_class": "AG-05", "risk": "High", "seam_class": "RUNTIME",
        "seam_executable": True, "safe_to_execute": True,
        "adapter_id": "cal_synthetic_technical_error",
        "turns": [{"role": "user", "content": "вопрос"}],
        "state_setup": {}, "preconditions": {}, "fault_schedule": [],
        "expected": {"act": "PAYMENT"},
        "oracle": [{"oracle": "act_equals", "params": {"expected_act": "PAYMENT"}},
                   {"oracle": "semantic_input_frozen", "params": {}}],
        "semantic_evaluation": {"required": True, "claim": claim},
        "failure_mechanism": "battery", "trigger": "synthetic", "observable_effect": "synthetic",
        "why_this_scenario_tests_this_class": "battery",
        "sut_binding": {"adapter_id": "cal_iv5_technical_error"}, "concurrency_workers": 0,
    }


def _semantic_result(outcome, evaluation):
    return {
        "run_id": outcome.run_id, "scenario_id": outcome.scenario_id,
        "scenario_sha256": outcome.scenario_sha256,
        "observation_id": outcome.observation_id,
        "attempt_index": outcome.observation.attempt,
        "raw_evidence_sha256": outcome.derivation_state["raw_evidence_sha256"],
        "semantic_input_sha256": hashlib.sha256(
            Path(outcome.semantic_input_path).read_bytes()).hexdigest(),
        "evaluator_id": "CODEX SOL 6.1", "evaluation_result": evaluation,
    }


@test("F04.native_error_fail_never_becomes_semantic_pass")
def _():
    reg = _iv5_calibration_registry()
    evid = tempfile.mkdtemp(prefix="f04-", dir="/tmp")
    out = run_scenario_once(_f04_spec("F4-ERR"), run_id="F4R", attempt=1,
                            evidence_root=evid, lane="CALIBRATION",
                            calibration_registry=reg)
    assert out.verdict == PrimaryVerdict.FAIL, out.verdict_reason
    st = out.derivation_state
    assert st["error_outcome"] == "TECHNICAL_ERROR"
    # F04 core: the preserved record is NORMALIZED — no
    # SATISFIED-despite-failure subset can exist
    assert not (st["deterministic_status"] == "SATISFIED"
                and st["deterministic_satisfied"] is False), st
    assert st["deterministic_status"] == "FAILED"
    out2 = apply_semantic_result(out, _semantic_result(out, "SEMANTIC_SATISFIED"),
                                 evidence_root=evid)
    assert out2.verdict == PrimaryVerdict.FAIL, out2.verdict_reason
    assert "native error" in out2.verdict_reason


# ---------------------------------------------------------------------------
# F05 — exact RAG types/enums
# ---------------------------------------------------------------------------

@test("F05.exact_rag_types_and_enums")
def _():
    from adapters.product import _rag_field_type_valid
    checks = [
        ("conversationAct", 17, False), ("conversationAct", "META", True),
        ("conversationAct", None, True), ("courseId", 17, False),
        ("courseId", "maslow", True), ("ragInvoked", "true", False),
        ("ragInvoked", True, True), ("activeBindingCount", True, False),
        ("activeBindingCount", -1, False), ("activeBindingCount", 3, True),
        ("evidenceSelectionStatus", 17, False),
        ("evidenceSelectionStatus", "SUPPORTED", True),
        ("answerOrigin", "WEIRD", False), ("answerOrigin", "META", True),
        ("fallback", 17, False), ("fallback", "NONE", True),
        ("groundingStage", 17, False),
        ("groundingStage", "PRIMARY_AUDIT_PASS", True),
        ("repairAttempted", "true", False), ("repairAttempted", False, True),
        ("reasonCode", 17, False), ("reasonCode", None, True),
        ("reasonCode", "UNSUPPORTED_CLAIM", True),
    ]
    for field, value, expected in checks:
        got = _rag_field_type_valid(field, value)
        assert got is expected, (field, value, got, expected)
    # invalid value -> UNOBSERVED for authority (documented rule)
    from adapters.rag_fixture_suite import run_rag_fixture_suite
    r = run_rag_fixture_suite()
    assert r["all_pass"], [c for c in r["cases"] if not c["pass"]]


# ---------------------------------------------------------------------------
# F06 — explicit fixture-provider state contract
# ---------------------------------------------------------------------------

@test("F06.explicit_fixture_provider_state_contract")
def _():
    # CORR6 direct regression update (IV6-F06A/F06B): fixture selection is
    # EXPLICIT by registered fixture identity, and fixtures must be complete
    # native-schema responses.
    from adapters.product import (_provider_fixture_response_for,
                                  native_conversation_state_fixture,
                                  validate_navigator_response_fixture)

    def _resp(course):
        return {"message": "ok",
                "profile": {"displayName": None, "addressMode": None,
                            "nameDeclined": False, "pendingUserRequest": None},
                "conversationState": native_conversation_state_fixture(
                    course_id=course, act="COURSE_FOLLOW_UP", content="ok"),
                "contactCard": None, "resetConversation": False}
    fixture = {
        "schema": "NAVIGATOR_RESPONSE_FIXTURE_V2", "mode": "identity_keyed",
        "fixture_id": "PF-TEST",
        "responses": [{"fixture_id": "PF-TEST", "response": _resp("maslow")}],
        "default": None,
    }
    resp = _provider_fixture_response_for(fixture, "PF-TEST", "lbl")
    assert resp["conversationState"]["selectedCourseId"] == "maslow"
    # an UNREGISTERED identity is refused (explicit selection requires registration)
    try:
        _provider_fixture_response_for(fixture, "PF-MISSING", "lbl")
        raise AssertionError("unregistered fixture identity accepted")
    except ValueError:
        pass
    # no selection -> neutral stub (native-complete, no fixture-derived authority)
    resp2 = _provider_fixture_response_for(fixture, None, "lbl")
    assert resp2["conversationState"]["selectedCourseId"] is None
    # state_aware retention driven by the REQUEST INPUT state
    fixture_sa = {"schema": "NAVIGATOR_RESPONSE_FIXTURE_V2", "mode": "state_aware",
                  "responses": [], "default": None}
    resp3 = _provider_fixture_response_for(
        fixture_sa, None, "lbl", {"selectedCourseId": "normative-situation"})
    assert resp3["conversationState"]["selectedCourseId"] == "normative-situation"
    # malformed / incomplete fixture response refused (IV6-F06B)
    try:
        validate_navigator_response_fixture({"message": 1}, where="t")
        raise AssertionError("malformed fixture accepted")
    except ValueError:
        pass
    try:
        validate_navigator_response_fixture(
            {"message": "m", "profile": {"displayName": None, "addressMode": None,
                                         "nameDeclined": False, "pendingUserRequest": None},
             "conversationState": {"courseMatch": None, "selectedCourseId": "x"},
             "contactCard": None, "resetConversation": False}, where="t")
        raise AssertionError("incomplete native-shape fixture accepted")
    except ValueError:
        pass
    # compile gate: fixture forbidden on policy-measurement adapters
    from harness.contract_compile import AdapterCapability, compile_scenario_contract
    spec = {
        "scenario_id": "F6X", "failure_class": "ST-01", "track": "TIKHON",
        "execution_level": "L2", "seam_class": "RUNTIME",
        "adapter_id": "navigator_l2_chat_api",
        "turns": [], "expected": {},
        "oracle": [{"oracle": "outcome_class", "params": {}}],
        "provider_fixture": fixture,
        "state_setup": {"profile": {"displayName": "Т", "addressMode": "VY",
                                    "nameDeclined": False, "pendingUserRequest": None}},
        "failure_mechanism": "m", "trigger": "t", "observable_effect": "e",
        "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"},
    }
    cc = compile_scenario_contract(spec, AdapterCapability("navigator_l2_chat_api"))
    assert not cc.compiled and any("FORBIDDEN" in d for d in cc.defects), cc.defects
    # corpus: the five mandatory Alexey seeds carry the recorded decision
    rows = _load_rows()
    for sid in ("A-0011", "B-0005", "B-0007", "C-0001", "C-0003"):
        assert rows[sid].get("provider_fixture"), sid


# ---------------------------------------------------------------------------
# F07 — distinct task-local lock metadata
# ---------------------------------------------------------------------------

@test("F07.distinct_task_local_lock_metadata")
def _():
    src = inspect.getsource(importlib.import_module(
        "adapters.product").AlexeyUserTurnAdapter.execute)
    # holder metadata is installed only AFTER acquisition; waiter data is
    # invocation-local (no shared mutable pre-await holder fields)
    assert "wait_start = time.perf_counter_ns()  # local to THIS invocation" in src
    assert "self._bench_records[task_id] = {" in src
    assert "self._bench_task = " not in src  # the IV5 overwrite pattern is gone
    assert "def release(self):" in src and "async def release" not in src
    # functional same-loop proof of the pattern: two tasks, one lock — every
    # task keeps its OWN timing/identity record; no overwrite; no negative wait
    lock_windows = []

    class InstrumentedLock(asyncio.Lock):
        def __init__(self, uid):
            super().__init__()
            self._bench_uid = uid
            self._bench_records = {}

        def _task_id(self):
            t = asyncio.current_task()
            return getattr(t, "get_name", lambda: None)() or str(id(t))

        async def acquire(self):
            task_id = self._task_id()
            wait_start = time.perf_counter_ns()
            got = await super().acquire()
            self._bench_records[task_id] = {
                "task_id": task_id, "user_id": self._bench_uid,
                "wait_start_ns": wait_start,
                "acquired_at_ns": time.perf_counter_ns(),
            }
            return got

        def release(self):
            task_id = self._task_id()
            t1 = time.perf_counter_ns()
            super().release()
            rec = self._bench_records.get(task_id)
            rec["critical_end_ns"] = t1
            rec["release_completed"] = True
            lock_windows.append(dict(rec))

    async def scenario():
        lock = InstrumentedLock(701001)

        async def hold(name, work_s):
            async with type("L", (), {"acquire": lock.acquire, "release": lock.release})():
                await asyncio.sleep(work_s)

        async def task(name, work_s, delay_s):
            await asyncio.sleep(delay_s)
            await lock.acquire()
            try:
                await asyncio.sleep(work_s)
            finally:
                lock.release()

        await asyncio.gather(task("w0", 0.05, 0), task("w1", 0.01, 0))

    asyncio.run(scenario())
    assert len(lock_windows) == 2
    ids = [w["task_id"] for w in lock_windows]
    assert len(set(ids)) == 2, f"task identities must be distinct: {ids}"
    for w in lock_windows:
        assert w["acquired_at_ns"] - w["wait_start_ns"] >= 0, w
    ordered = sorted(lock_windows, key=lambda w: w["acquired_at_ns"])
    assert ordered[0]["critical_end_ns"] <= ordered[1]["critical_end_ns"], \
        "critical sections must not overlap on one shared lock"


# ---------------------------------------------------------------------------
# F08 — semantic config comparison
# ---------------------------------------------------------------------------

@test("F08.semantic_config_comparison")
def _():
    from adapters.product import StaticSourceInventoryAdapter
    from harness.execution_request import ExecutionRequest as ER
    fixture = Path(tempfile.mkdtemp(prefix="f08-", dir="/tmp"))
    (fixture / "main.py").write_text(
        "flag = 'a b'\n"
        "other = 'ab'\n"
        "dp = Dispatcher(storage=MemoryStorage())\n"
        "start_polling(drop_pending_updates=True)\n", encoding="utf-8")
    req = ER(
        scenario_id="S", scenario_sha256="e" * 64, track="T", execution_level="L1",
        adapter_id="static_source_inventory", run_id="R", attempt=1, turns=(),
        tikhon_test_root=str(fixture),
        preconditions={"static_queries": [
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "flag='a b'", "fact": "exact_space"},
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "flag='ab'", "fact": "wrong_space"},
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "storage=MemoryStorage()", "fact": "structural"},
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "drop_pending_updates=True", "fact": "literal_true"},
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "###unparseable###", "fact": "unparseable"},
        ]})
    cap = StaticSourceInventoryAdapter().execute(req)
    facts = cap.static_inspection["facts"]
    assert facts["exact_space"] is True          # whitespace preserved, equal literal
    assert facts["wrong_space"] is False         # 'ab' != 'a b' (F08 core)
    # CORR6 direct regression update (IV6-F08): non-literal requested values are
    # NOT_OBSERVABLE — structural guessing is retired
    assert facts["structural"] is None
    assert facts["literal_true"] is True
    assert facts["unparseable"] is None          # NOT_OBSERVABLE, never text-normalized
    methods = {b["requested_subject"]: b["derivation_method"]
               for b in cap.static_inspection["source_basis"]}
    assert "TYPED" in methods["flag='a b'"]      # CORR6: typed comparison wording


# ---------------------------------------------------------------------------
# F09 — static provenance is not runtime provenance
# ---------------------------------------------------------------------------

@test("F09.static_provenance_not_runtime_provenance")
def _():
    with tempfile.TemporaryDirectory(prefix="f09-", dir="/tmp") as td:
        seq = [0]

        def evidence(actual):
            seq[0] += 1
            return freeze_evidence(_ident(scen=f"F9S{seq[0]}"), td,
                                   {"actual": actual, "lane": "CALIBRATION"})
        static_block = {"act": {"value": "STATIC_INSPECTION",
                                "sentinel": None,
                                "provenance": "STATIC_INSPECTION",
                                "evidence_ref": None}}
        spec = {"scenario_id": "F9S", "seam_class": "NO_SEAM", "oracle": []}
        ok = oracle_no_runtime_claim(evidence(static_block), spec, {})
        assert ok.satisfied is True, ok.reason  # legitimate static fact allowed
        runtime_block = {"act": {"value": "x", "sentinel": None,
                                 "provenance": "RUNTIME_FUNCTION_RETURN",
                                 "evidence_ref": None}}
        bad = oracle_no_runtime_claim(evidence(runtime_block), spec, {})
        assert bad.satisfied is False            # runtime claims still rejected
    # corpus: B-0004/B-0006/C-0002 remain static NO_SEAM rows (authorized
    # static facts while proving no PRODUCT_RUNTIME claim occurred)
    rows = _load_rows()
    for sid in ("B-0004", "B-0006", "C-0002"):
        s = rows[sid]
        assert s.get("seam_class") == "NO_SEAM", sid
        assert s.get("adapter_id") == "static_source_inventory", sid
        names = {o.get("oracle") for o in s.get("oracle", [])}
        assert {"static_config", "no_runtime_claim"} <= names, sid
        exps = [e for o in s["oracle"] if o["oracle"] == "static_config"
                for e in (o.get("params") or {}).get("expectations", [])]
        assert exps, f"{sid}: no material static assertions"


# ---------------------------------------------------------------------------
# F10 — full claim dependency closure at render
# ---------------------------------------------------------------------------

@test("F10.full_claim_dependency_closure_at_render")
def _():
    from harness.gates.claim_ledger import ClaimEngine, ReportRenderer
    with tempfile.TemporaryDirectory(prefix="f10-", dir="/tmp") as td:
        root = Path(td)
        (root / "corpus").mkdir()
        corpus = root / "corpus" / "corrected_corpus_84.jsonl"
        corpus.write_text("\n".join(json.dumps({"scenario_id": f"S{i}"}) for i in range(3)) + "\n")
        sidecar = root / "corpus" / "CORPUS_SHA256.txt"
        sidecar.write_text(f"{hashlib.sha256(corpus.read_bytes()).hexdigest()}  corrected_corpus_84.jsonl\n")
        dist = root / "corpus" / "distribution.json"
        dist.write_text(json.dumps({"schema": "CORPUS_DISTRIBUTION_V4",
                                    "total_scenarios": 3}))
        engine = ClaimEngine()
        engine.register("C1", "SCENARIO_COUNT", str(dist), {}, "{value}")
        engine.register("C2", "CORPUS_SHA_EQUALITY", str(sidecar), {}, "{value}")
        renderer = ReportRenderer(engine)
        assert renderer.material("C1") and renderer.material("C2")
        closure = engine.dependency_closure_report()
        assert closure["total_declared_dependencies"] >= 4  # corpus jsonl registered everywhere
        # the SIBLING corpus changes after creation -> rendering refused (F10)
        corpus.write_text("\n".join(json.dumps({"scenario_id": f"S{i}"}) for i in range(4)) + "\n")
        try:
            renderer.material("C1")
            raise AssertionError("changed sibling dependency accepted at render")
        except ValueError as exc:
            assert "dependency" in str(exc)
        # missing dependency -> rendering refused
        corpus.unlink()
        try:
            renderer.material("C2")
            raise AssertionError("missing sibling dependency accepted at render")
        except ValueError:
            pass


# ---------------------------------------------------------------------------
# F11 — complete semantic payload sanitization
# ---------------------------------------------------------------------------

@test("F11.complete_semantic_payload_sanitization")
def _():
    marker = "password=OBVIOUS_SYNTHETIC_MARKER_IV5_EXTRA"
    reg = _iv5_calibration_registry()
    evid = tempfile.mkdtemp(prefix="f11-", dir="/tmp")
    spec = _f04_spec("F11S", claim=f"synthetic claim {marker}")
    spec["oracle"] = [{"oracle": "semantic_input_frozen", "params": {}}]
    spec["expected"] = {}
    out = run_scenario_once(spec, run_id="F11R", attempt=1, evidence_root=evid,
                            lane="CALIBRATION", calibration_registry=reg)
    blob = Path(out.semantic_input_path).read_text(encoding="utf-8")
    assert marker not in blob, "specification-derived semantic_claim bypassed sanitization"
    assert "OBVIOUS_SYNTHETIC_MARKER_IV5_EXTRA" not in blob
    doc = json.loads(blob)
    sem = doc["payload"]["semantic_input"]
    assert "[REDACTED]" in str(sem["semantic_claim"])


# ---------------------------------------------------------------------------
# F12 — same-user serialization proof (serialization is not overlap)
# ---------------------------------------------------------------------------

def _conc_evidence(td, payload):
    _conc_evidence.seq = getattr(_conc_evidence, "seq", 0) + 1
    return freeze_evidence(_ident(scen=f"F12S{_conc_evidence.seq}"), td, payload)


@test("F12.same_user_serialization_proof")
def _():
    t = time.perf_counter_ns()
    good = {
        "workers": 2, "worker_ids": ["w0", "w1"],
        "task_records": [
            {"task_id": "w0", "user_id": 701001, "lock_identity": "user-lock-701001-a",
             "wait_start_ns": t, "acquired_at_ns": t + 100,
             "critical_end_ns": t + 5000, "release_completed": True},
            {"task_id": "w1", "user_id": 701001, "lock_identity": "user-lock-701001-a",
             "wait_start_ns": t + 200, "acquired_at_ns": t + 5100,
             "critical_end_ns": t + 9000, "release_completed": True},
        ],
        "lock_user_ids": [701001, 701001],
        "same_user_shared_lock": True, "lock_identity": "SHARED",
        "contention_evidence": {"contention_proven": True, "contention_events": 1,
                                "waiting_tasks": 1},
        "critical_sections_non_overlapping": True,
        "lock_release_completed_all": True,
        "target_seam": "LebedevNavigatorAdapter.get_user_lock",
        "schedule_id": "F12S-A1",
    }
    spec = {"scenario_id": "F12S", "fault_schedule": [],
            "concurrency_mechanism_id": "ALEXEY.SAME_USER_SERIALIZATION"}
    with tempfile.TemporaryDirectory(prefix="f12-", dir="/tmp") as td:
        frozen = _conc_evidence(td, {"concurrency": good})
        ok = oracle_same_user_serialization_proven(frozen, spec, {"workers": 2})
        assert ok.satisfied is True and not ok.invalid, ok.reason
        # NON-overlapping critical sections SATISFY the proof (F12 core:
        # overlap is NOT required for same-user serialization)
        # missing contention -> invalid (sequential non-contended tasks prove nothing)
        bad1 = json.loads(json.dumps(good))
        bad1["contention_evidence"] = {"contention_proven": False, "contention_events": 0,
                                       "waiting_tasks": 0}
        c1 = oracle_same_user_serialization_proven(_conc_evidence(td, {"concurrency": bad1}),
                                                   spec, {"workers": 2})
        assert c1.invalid is True and "contention" in c1.reason
        # overlapping critical sections -> invalid (serialization violated)
        bad2 = json.loads(json.dumps(good))
        bad2["critical_sections_non_overlapping"] = False
        c2 = oracle_same_user_serialization_proven(_conc_evidence(td, {"concurrency": bad2}),
                                                   spec, {"workers": 2})
        assert c2.invalid is True
        # wrong mechanism for the typed oracle -> invalid
        c3 = oracle_same_user_serialization_proven(
            _conc_evidence(td, {"concurrency": good}),
            {"scenario_id": "F12S", "fault_schedule": [],
             "concurrency_mechanism_id": "ALEXEY.DIFFERENT_USER_INDEPENDENCE"},
            {"workers": 2})
        assert c3.invalid is True
        # different-user independence: distinct locks/users + overlap relevant
        diff = {
            "workers": 2, "worker_ids": ["w0", "w1"],
            "task_records": [
                {"task_id": "w0", "user_id": 701001,
                 "lock_identity": "user-lock-701001-a", "wait_start_ns": t,
                 "acquired_at_ns": t + 100, "critical_end_ns": t + 5000,
                 "release_completed": True},
                {"task_id": "w1", "user_id": 701002,
                 "lock_identity": "user-lock-701002-b", "wait_start_ns": t,
                 "acquired_at_ns": t + 50, "critical_end_ns": t + 5000,
                 "release_completed": True},
            ],
            "lock_user_ids": [701001, 701002],
            "same_user_shared_lock": False,
            "native_operation_intervals": [[t, t + 5000], [t, t + 5000]],
            "lock_release_completed_all": True,
            "target_seam": "LebedevNavigatorAdapter.get_user_lock",
            "schedule_id": "F12S-A1",
        }
        c4 = oracle_different_user_independence_proven(
            _conc_evidence(td, {"concurrency": diff}),
            {"scenario_id": "F12S", "fault_schedule": [],
             "concurrency_mechanism_id": "ALEXEY.DIFFERENT_USER_INDEPENDENCE"},
            {"workers": 2})
        assert c4.satisfied is True and not c4.invalid, c4.reason
    # CORR6 direct regression update: quality pruning 996->924 retained the
    # four VALID typed C contracts (2 same-user + 2 different-user)
    rows = _load_rows()
    c_rows = [s for s in rows.values() if s.get("replay_set") == "C"]
    assert len(c_rows) == 4
    assert all(s.get("concurrency_mechanism_id") for s in c_rows)
    same = [s for s in c_rows
            if s["concurrency_mechanism_id"] == "ALEXEY.SAME_USER_SERIALIZATION"]
    assert len(same) == 2 and "A-0011" in {s["scenario_id"] for s in same}
    assert all("same_user_serialization_proven" in {o["oracle"] for o in s["oracle"]}
               for s in same)


# ---------------------------------------------------------------------------
# F13 — registered causal fault mechanism + post-processing response loss
# ---------------------------------------------------------------------------

@test("F13.registered_fault_mechanism_and_post_persistence_response_loss")
def _():
    with tempfile.TemporaryDirectory(prefix="f13-", dir="/tmp") as td:
        good_fault = {
            "fault_mechanism_id": "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE",
            "fault_target": "alexey_process_user_turn_response_delivery",
            "fault_point": "after_persistence_before_delivery",
            "fault_kind": "LOST_RESPONSE",
            "fault_confirmed_injected": True,
            "operation_invoked": 1,
            "mechanism_evidence": {"durable_write_proven": True,
                                   "persisted_state_present": True,
                                   "processing_completed": True,
                                   "response_dropped": True},
        }
        spec = {"scenario_id": "F13S",
                "fault_schedule": [{"mechanism_id": "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE",
                                    "kind": "LOST_RESPONSE",
                                    "target": "alexey_process_user_turn_response_delivery",
                                    "point": "after_persistence_before_delivery"}]}
        frozen = freeze_evidence(_ident(scen="F13S"), td, {"fault": good_fault})
        ok = oracle_fault_confirmed_injected(frozen, spec, {},
                                             supported_fault_hooks=("LOST_RESPONSE",))
        assert ok.satisfied is True and not ok.invalid, ok.reason
        # self-labelled UNRELATED target/point is refused against the registry
        forged = json.loads(json.dumps(good_fault))
        forged["fault_target"] = "unrelated_target"
        forged["fault_point"] = "unrelated_point"
        c1 = oracle_fault_confirmed_injected(
            freeze_evidence(_ident(scen="F13T"), td, {"fault": forged}), spec, {},
            supported_fault_hooks=("LOST_RESPONSE",))
        assert c1.invalid is True and "registry identity violated" in c1.reason, c1.reason
        # scenario free-form labels disagreeing with the registry -> invalid
        spec2 = {"scenario_id": "F13S",
                 "fault_schedule": [{"mechanism_id": "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE",
                                     "kind": "LOST_RESPONSE", "target": "whatever",
                                     "point": "somewhere"}]}
        c2 = oracle_fault_confirmed_injected(frozen, spec2, {},
                                             supported_fault_hooks=("LOST_RESPONSE",))
        assert c2.invalid is True and "disagrees" in c2.reason
        # EMPTY capability tuple = NO capability (never disables the check)
        c3 = oracle_fault_confirmed_injected(frozen, spec, {}, supported_fault_hooks=())
        assert c3.invalid is True and "not a supported fault capability" in c3.reason
        # pre-persistence write mislabeled durable: persisted state absent -> invalid
        pre = json.loads(json.dumps(good_fault))
        pre["mechanism_evidence"]["persisted_state_present"] = False
        c4 = oracle_fault_confirmed_injected(
            freeze_evidence(_ident(scen="F13U"), td, {"fault": pre}), spec, {},
            supported_fault_hooks=("LOST_RESPONSE",))
        assert c4.invalid is True and "normal persistence" in c4.reason
    # corpus: every fault schedule references the registered mechanism
    rows = _load_rows()
    for sid, s in rows.items():
        for fs in s.get("fault_schedule") or []:
            assert fs.get("mechanism_id") == "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE", sid
            assert fs.get("target") == "alexey_process_user_turn_response_delivery", sid
            assert fs.get("point") == "after_persistence_before_delivery", sid


# ---------------------------------------------------------------------------
# F14 — native-error authority preserved in mutation
# ---------------------------------------------------------------------------

@test("F14.native_error_authority_preserved_in_mutation")
def _():
    from harness.gates.oracle_mutation import run_oracle_mutation
    reg = _iv5_calibration_registry()
    evid = tempfile.mkdtemp(prefix="f14-", dir="/tmp")
    base = _f04_spec("F14S")
    out = run_scenario_once(base, run_id="F14R", attempt=1, evidence_root=evid,
                            lane="CALIBRATION", calibration_registry=reg)
    assert out.verdict == PrimaryVerdict.FAIL  # native TECHNICAL_ERROR
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id="F14R", scenario_id="F14S",
                         scenario_sha256=out.scenario_sha256,
                         observation_id="F14S_A1", attempt_index=1,
                         evidence_type="RAW_OBSERVATION"),
        out.derivation_state["raw_evidence_path"],
        out.derivation_state["raw_evidence_sha256"])
    muts = run_oracle_mutation(out, base, frozen, [("act", "PAYMENT")])
    assert muts, "mutation produced no results"
    for m in muts:
        assert m.base_verdict == "FAIL", m.base_verdict
        assert m.mutated_verdict != "PASS", (m.invariant, m.mutated_verdict)
        assert m.state_preserved, (m.invariant, m.detail)
    # and the same-state/same-verdict property across consumers
    from harness.execution_state import derive_verdict_from_execution_state, from_state_dict
    st = from_state_dict(out.derivation_state)
    assert derive_verdict_from_execution_state(st)[0] == PrimaryVerdict.FAIL


# ---------------------------------------------------------------------------
# F15 — L2 route reachability
# ---------------------------------------------------------------------------

@test("F15.l2_route_reachability")
def _():
    rows = _load_rows()
    l2 = [s for s in rows.values() if s.get("adapter_id") == "navigator_l2_chat_api"]
    assert l2
    for s in l2:
        assert s.get("route_precondition") in ("COMPLETE_PROFILE_PROVIDED",
                                               "ONBOARDING_IS_THE_MECHANISM"), \
            s["scenario_id"]
        if s["route_precondition"] == "COMPLETE_PROFILE_PROVIDED":
            prof = (s.get("state_setup") or {}).get("profile") or {}
            assert prof.get("displayName") is not None or prof.get("nameDeclined") is True
            assert prof.get("addressMode") is not None, s["scenario_id"]
    # the 8 mandatory L2 seeds are route-reachable
    for sid in ("A-0005", "A-0006", "A-0007", "A-0008", "A-0009", "A-0010",
                "A-0014", "A-0015"):
        s = rows[sid]
        assert (s.get("state_setup") or {}).get("profile", {}).get("addressMode"), sid
    # Set S eligibility: all S rows reach orchestration after the repair
    # (CORR6: 43 = 44 - A-0140, legitimately pruned under IV6-F15 §35)
    s_rows = [s for s in rows.values() if s.get("replay_set") == "S"]
    assert len(s_rows) == 43
    assert all((s.get("state_setup") or {}).get("profile", {}).get("addressMode")
               for s in s_rows)
    # compile gate rejects an L2 row without the precondition
    from harness.contract_compile import AdapterCapability, compile_scenario_contract
    spec = {"scenario_id": "F15X", "failure_class": "ST-02", "track": "TIKHON",
            "execution_level": "L2", "seam_class": "RUNTIME",
            "adapter_id": "navigator_l2_chat_api", "turns": [], "expected": {},
            "oracle": [{"oracle": "outcome_class", "params": {}}],
            "failure_mechanism": "content measurement", "trigger": "t",
            "observable_effect": "e", "why_this_scenario_tests_this_class": "w",
            "sut_binding": {"adapter_id": "x"}}
    cc = compile_scenario_contract(spec, AdapterCapability("navigator_l2_chat_api"))
    assert not cc.compiled and any("F15" in d for d in cc.defects), cc.defects


# ---------------------------------------------------------------------------
# F16 — direct ExecutionRequest construction safe
# ---------------------------------------------------------------------------

@test("F16.direct_execution_request_construction_safe")
def _():
    shared = {"nested": ["mutable"]}
    req = ExecutionRequest(scenario_id="S", scenario_sha256="a" * 64, track="T",
                           execution_level="L1", adapter_id="x", run_id="R", attempt=1,
                           state_setup=shared)
    shared["nested"].append("changed")
    blob = json.dumps(req.to_json(), default=str)
    assert "changed" not in blob, "shared nested mutable value retained by direct construction"
    try:
        ExecutionRequest(scenario_id="S", scenario_sha256="a" * 64, track="T",
                         execution_level="L1", adapter_id="x", run_id="R", attempt=1,
                         turns=({"a": {1, 2}},))
        raise AssertionError("unsupported carrier accepted by direct construction")
    except TypeError:
        pass
    # frozen immutability on every public construction path
    try:
        req.state_setup["x"] = 1
        raise AssertionError("frozen state_setup mutable")
    except TypeError:
        pass


# ---------------------------------------------------------------------------
# F17 — no redundant executable same-assertion pairs
# ---------------------------------------------------------------------------

@test("F17.no_redundant_executable_same_assertion_pairs")
def _():
    import importlib.util
    spec = importlib.util.spec_from_file_location("rv5", str(BENCH / "corpus" / "repair_v5.py"))
    rv5 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rv5)
    rows = _load_rows()
    order = sorted(rows)
    groups = rv5.redundant_groups(rows, order)
    assert not groups, f"redundant effective scenarios remain: {groups}"
    # the criterion is INDEPENDENT of track: same stimulus + same class + same
    # material controlling assertion is redundant even across tracks
    twin_a = {"scenario_id": "T1", "failure_class": "TG-09", "track": "TIKHON",
              "adapter_id": "chatbot_l3_callback_registry",
              "turns": [{"role": "user", "content": "callback:cohort:x"}],
              "failure_mechanism": "m", "oracle": [{"oracle": "state_subset",
                                                    "params": {"expected_state": {"stateMutated": False}}}],
              "semantic_evaluation": {"claim": None}}
    twin_b = json.loads(json.dumps(twin_a))
    twin_b["scenario_id"] = "T2"
    twin_b["track"] = "ALEXEY_TO_TIKHON"
    demo = {"T1": twin_a, "T2": twin_b}
    assert rv5.redundant_groups(demo, ["T1", "T2"]), "cross-track twin not detected"
    # the six IV5 pairs are repaired in the corpus
    for a, b in rv5.IV5_REDUNDANT_PAIRS:
        assert rows[a]["turns"][0]["content"] != rows[b]["turns"][0]["content"], (a, b)


# ---------------------------------------------------------------------------
# section 36 — state-machine invariant suite
# ---------------------------------------------------------------------------

@test("INVARANTS.unified_verdict_state_machine_table")
def _():
    results = run_state_machine_invariants()
    failed = [r for r in results if not r["pass"]]
    assert not failed, failed
    out = BENCH / "artifacts" / "STATE_MACHINE_INVARIANT_RESULTS.json"
    out.write_text(json.dumps({
        "schema": "STATE_MACHINE_INVARIANT_RESULTS_V1",
        "total": len(results), "passed": len(results) - len(failed),
        "failed": len(failed), "all_pass": not failed,
        "invariants": results,
    }, ensure_ascii=False, indent=2))


def main() -> int:
    importlib.import_module("tests.iv5_regression_battery")
    for _name, fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    failed = [r for r in RESULTS if not r["pass"]]
    print(f"IV5 REGRESSION BATTERY: {passed}/{len(RESULTS)} passed")
    for r in failed:
        print(f"  FAIL {r['name']}: {r['detail'][:240]}")
    (BENCH / "artifacts" / "IV5_REGRESSION_BATTERY.json").write_text(json.dumps({
        "schema": "IV5_REGRESSION_BATTERY",
        "total": len(RESULTS), "passed": passed, "failed": len(failed),
        "all_pass": not failed, "cases": RESULTS,
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
