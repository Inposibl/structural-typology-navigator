"""IV4 regression battery — CORR4 (owner section 45).

Benign software-correctness fixtures ONLY: every IV4 root cause B-01..B-18
and M-01..M-05 is retested through the public benchmark path or a direct
harness unit. No product execution, no product import-with-execution, no
network, no Telegram/payment/production, no environment/security testing.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from harness.evidence import (  # noqa: E402
    EvidenceIdentity,
    EvidenceImmutableViolation,
    EvidencePathError,
    FrozenEvidence,
    UNOBSERVED,
    freeze_evidence,
    resolve_field_ref,
)
from harness.execution_request import to_native, freeze_request_fields  # noqa: E402
from harness.factory import (  # noqa: E402
    BindingToken,
    FactoryRejected,
    _import_implementation,
    create_product_adapter,
)
from harness.oracle import (  # noqa: E402
    FAULT_MECHANISM_CONTRACTS,
    SpecIdentityMismatch,
    evaluate_oracles,
    oracle_concurrency_overlap_proven,
    oracle_fault_confirmed_injected,
    validate_oracle_completeness,
)
from harness.runner import aggregate_repeat_verdicts, run_scenario_once, apply_semantic_result  # noqa: E402
from harness.verdicts import PrimaryVerdict  # noqa: E402
from harness.gates.claim_ledger import ClaimEngine, ReportRenderer  # noqa: E402
from harness.gates.oracle_mutation import run_oracle_mutation  # noqa: E402

RESULTS: list[dict] = []
TESTS: list = []


def test(name: str):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append({"name": name, "pass": True, "detail": ""})
            except AssertionError as exc:
                RESULTS.append({"name": name, "pass": False, "detail": f"AssertionError: {exc}"})
            except Exception as exc:  # noqa: BLE001
                RESULTS.append({"name": name, "pass": False,
                                "detail": f"{type(exc).__name__}: {exc}"})
        wrapper.__name__ = name
        TESTS.append((name, wrapper))
        return wrapper
    return deco


def _ident(run="R4", scen="B4S", obs="B4S_A1", ev="RAW_OBSERVATION"):
    return EvidenceIdentity(run_id=run, scenario_id=scen, scenario_sha256="b" * 64,
                            observation_id=obs, attempt_index=1, evidence_type=ev)


# ---------------------------------------------------------------------------
# B-01 evidence target anchoring
# ---------------------------------------------------------------------------

@test("B01.evidence_directory_anchored_and_immutable")
def _():
    with tempfile.TemporaryDirectory() as td:
        ident = _ident()
        f = freeze_evidence(ident, td, {"x": 1})
        assert f.load()["payload"] == {"x": 1}
        try:
            freeze_evidence(ident, td, {"x": 2})
            raise AssertionError("overwrite accepted")
        except EvidenceImmutableViolation:
            pass
        # a symlink at the final component is never followed on create/read
        target = Path(td) / "outside.json"
        target.write_text("{}")
        link = Path(td) / "R4" / "B4S" / "B4S_A2.RAW_OBSERVATION.json"
        link.symlink_to(target)
        ident2 = _ident(obs="B4S_A2")
        try:
            freeze_evidence(ident2, td, {"y": 1})
            raise AssertionError("symlink final component followed on create")
        except (EvidenceImmutableViolation, OSError):
            pass
        # directory swap between validation and access: the validated scenario
        # directory object identity is re-proved around every open
        scen_dir = Path(td) / "R4" / "B4S"
        st_before = scen_dir.stat()
        f.load()  # identity intact -> read ok
        assert (st_before.st_dev, st_before.st_ino) == (scen_dir.stat().st_dev, scen_dir.stat().st_ino)


@test("B01.concurrent_writers_exactly_one_succeeds")
def _():
    with tempfile.TemporaryDirectory() as td:
        ident = _ident(run="RACE4")
        outs = []

        def writer(i):
            try:
                freeze_evidence(ident, td, {"writer": i})
                outs.append("OK")
            except EvidenceImmutableViolation:
                outs.append("IMMUTABLE")
            except Exception as exc:  # noqa: BLE001
                outs.append(type(exc).__name__)

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert outs.count("OK") == 1, outs
        assert all(o in ("OK", "IMMUTABLE") for o in outs), outs


# ---------------------------------------------------------------------------
# B-02 specification + field identity
# ---------------------------------------------------------------------------

def _spec_sha(spec):
    return hashlib.sha256(json.dumps(spec, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def _frozen_with_oracle_payload(td: str):
    spec = {"scenario_id": "B4S", "oracle": [
        {"oracle": "act_equals", "params": {"expected_act": "PAYMENT"}}]}
    ident = EvidenceIdentity(run_id="R4", scenario_id="B4S",
                             scenario_sha256=_spec_sha(spec),
                             observation_id="B4S_A1", attempt_index=1,
                             evidence_type="RAW_OBSERVATION")
    payload = {
        "actual": {"act": {"value": "PAYMENT", "provenance": "RUNTIME_FUNCTION_RETURN",
                           "evidence_ref": {"identity": ident.to_json(), "field_name": "act",
                                            "value_digest": hashlib.sha256(
                                                json.dumps("PAYMENT", sort_keys=True,
                                                           ensure_ascii=False,
                                                           separators=(",", ":")).encode()).hexdigest()}}},
    }
    frozen = freeze_evidence(ident, td, payload)
    return spec, ident, frozen


@test("B02.spec_identity_binding_foreign_and_altered_specs_rejected")
def _():
    with tempfile.TemporaryDirectory() as td:
        spec, ident, frozen = _frozen_with_oracle_payload(td)
        sha = _spec_sha(spec)
        # the authentic spec scores
        checks = evaluate_oracles(spec, frozen, run_id="R4", scenario_id="B4S",
                                  scenario_sha256=sha, observation_id="B4S_A1", attempt_index=1)
        assert checks[0].satisfied is True, checks[0]
        # foreign spec (different content, same handle) is refused
        foreign = {"scenario_id": "B4S", "oracle": [
            {"oracle": "act_equals", "params": {"expected_act": "REFUND"}}]}
        try:
            evaluate_oracles(foreign, frozen, run_id="R4", scenario_id="B4S",
                             scenario_sha256=sha, observation_id="B4S_A1", attempt_index=1)
            raise AssertionError("altered expectations scored against old evidence")
        except SpecIdentityMismatch:
            pass


@test("B02.field_name_identity_enforced")
def _():
    with tempfile.TemporaryDirectory() as td:
        spec, ident, frozen = _frozen_with_oracle_payload(td)
        doc = frozen.load()
        block = doc["payload"]["actual"]["act"]
        # a ref declaring a DIFFERENT field name must fail resolution
        ref = dict(block["evidence_ref"])
        ref["field_name"] = "origin"
        try:
            resolve_field_ref(doc, "act", {"provenance": "RUNTIME_FUNCTION_RETURN",
                                           "value": block["value"], "evidence_ref": ref})
            raise AssertionError("wrong field-name ref accepted")
        except Exception as exc:  # noqa: BLE001
            assert "field" in str(exc).lower()


# ---------------------------------------------------------------------------
# B-03 binding import / function
# ---------------------------------------------------------------------------

@test("B03.binding_mint_imports_and_mints")
def _():
    mod = importlib.import_module("harness.seams.sut_binding")
    assert hasattr(mod, "bind_test_bases_with_token")
    src = inspect.getsource(mod.bind_test_bases_with_token)
    assert "from ..factory import" in src or "..factory" in src
    # unbound environment -> honest refusal with a token carrying NO roots
    env = dict(os.environ)
    os.environ.pop("NAVIGATOR_TEST_ROOT", None)
    os.environ.pop("TIKHON_TEST_ROOT", None)
    try:
        binding = mod.bind_test_bases_with_token(run_id="R4")
        assert binding.token_ok is False
        token = binding.token
        token.verify()  # mint-time digest holds
        assert token.navigator_root is None and token.tikhon_root is None
        # the PRODUCT factory refuses a rootless token (no adapter without binding)
        from harness.execution_request import ExecutionRequest
        req = ExecutionRequest(scenario_id="S", scenario_sha256="c" * 64, track="T",
                               execution_level="L1", adapter_id="navigator_l1_payment_policy",
                               run_id="R4", attempt=1)
        try:
            create_product_adapter(req, token,
                                   {"adapters": {"navigator_l1_payment_policy": {
                                       "implementation_class": "adapters.product.NavigatorL1PaymentPolicyAdapter",
                                       "provenance_class": "RUNTIME_FUNCTION_RETURN",
                                       "lane": "PRODUCT", "repo": "NAVIGATOR"}}})
            raise AssertionError("rootless token accepted for product adapter")
        except FactoryRejected:
            pass
    finally:
        os.environ.clear()
        os.environ.update(env)


# ---------------------------------------------------------------------------
# B-04 adapter constructor protocol
# ---------------------------------------------------------------------------

@test("B04.constructor_protocol_all_registered_non_l4")
def _():
    from adapters.registry import registry_doc
    reg = registry_doc()
    for aid, entry in reg["adapters"].items():
        if aid == "live_telegram_transport":
            continue
        cls = _import_implementation(entry["implementation_class"])
        adapter = cls(request=None, token=None, spec=None)
        assert adapter is not None
    from adapters.constructibility import build_constructibility_report
    report = build_constructibility_report(reg)
    assert report["all_required_product_adapters_ready"] is True
    assert report["product_adapters_executed_against_real_product"] is False


# ---------------------------------------------------------------------------
# B-05 immutable -> native conversion
# ---------------------------------------------------------------------------

@test("B05.frozen_values_serialize_to_native")
def _():
    from types import MappingProxyType
    frozen_payment = MappingProxyType({"act_decision": MappingProxyType({"state": "NAVIGATE"}),
                                       "payment_context": MappingProxyType({"courseId": "maslow"})})
    native = to_native(frozen_payment)
    blob = json.dumps(native)  # the CORR3 failure: json.dumps on proxies
    assert "NAVIGATE" in blob and isinstance(native["act_decision"], dict)
    # L2 structures + parser history become ordinary dict/list
    l2 = to_native(MappingProxyType({"profile": MappingProxyType({"displayName": "X"}),
                                     "conversationState": None}))
    assert isinstance(l2["profile"], dict)
    history = to_native((MappingProxyType({"role": "user", "content": "привет"}),
                         MappingProxyType({"role": "assistant", "content": "Здравствуйте"})))
    assert isinstance(history, list) and all(isinstance(m, dict) for m in history)
    # conversion never mutates the frozen request structure
    frozen = {"a": MappingProxyType({"b": (1, 2)})}
    to_native(frozen)
    assert isinstance(frozen["a"], MappingProxyType) and isinstance(frozen["a"]["b"], tuple)
    # deep copy: no shared identity
    native = to_native(frozen)
    assert native is not frozen and native["a"] is not frozen["a"]


@test("B05.request_construction_rejects_non_json_carriers")
def _():
    try:
        freeze_request_fields({"closure": (lambda: 1)()})
        freeze_request_fields({"s": {1, 2}})
        raise AssertionError("unsupported carrier silently retained")
    except TypeError:
        pass


# ---------------------------------------------------------------------------
# B-06 previously incomplete contracts
# ---------------------------------------------------------------------------

@test("B06.full_corpus_completeness_zero_zero")
def _():
    from corpus.repair_v4 import IV4_INCOMPLETE_UNION
    from adapters.registry import load_registry
    reg = load_registry()
    native_map = {aid: tuple(a.get("native_observables") or [])
                  for aid, a in reg["adapters"].items()}
    hooks_map = {aid: tuple(a.get("real_fault_hooks") or [])
                 for aid, a in reg["adapters"].items()}
    incomplete = contradictions = 0
    rows = 0
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if not line.strip():
                continue
            rows += 1
            s = json.loads(line)
            d = validate_oracle_completeness(s, native_map.get(s.get("adapter_id"), ()),
                                             hooks_map.get(s.get("adapter_id"), ()))
            contradictions += sum(1 for e in d if "contradicts" in e or "not in the scanner" in e)
            incomplete += len(d) - sum(1 for e in d if "contradicts" in e or "not in the scanner" in e)
    # CORR6 direct regression update: Owner's FINAL corpus size is 924
    assert rows == 924, f'rows={rows}'
    assert incomplete == 0 and contradictions == 0, (incomplete, contradictions)
    # spot-check repaired specimens from the exact IV4 union
    rows_by_id = {}
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                rows_by_id[r["scenario_id"]] = r
    # CORR6 direct regression update: 90-row IV4 union membership is checked
    # against the FROZEN 996 input; the quality-pruned 924 corpus legitimately
    # no longer contains every historical union row.
    with open(BENCH / "corpus" / "corr5_input_996.jsonl") as fh:
        frozen_ids = {json.loads(l)["scenario_id"] for l in fh if l.strip()}
    for sid in IV4_INCOMPLETE_UNION:
        assert sid in frozen_ids, sid
    a3 = rows_by_id["A-0003"]
    assert any(o["oracle"] == "exact_link" for o in a3["oracle"])
    a35 = rows_by_id["A-0035"]
    assert any(o["oracle"] == "course_ids_match" for o in a35["oracle"])
    c5 = rows_by_id["C-0005"]
    names = {o["oracle"] for o in c5["oracle"]}
    # CORR5 F12 direct regression update: Set C proof oracles are TYPED by
    # registered mechanism since IV5 (same-user serialization / different-user
    # independence); the generic concurrency_overlap_proven remains valid only
    # for overlap-relevant mechanisms.
    assert "concurrency_invariant" in names
    assert names & {"concurrency_overlap_proven", "same_user_serialization_proven",
                    "different_user_independence_proven"}
    a96 = rows_by_id["A-0096"]
    po = next(o for o in a96["oracle"] if o["oracle"] == "prohibited_output")
    assert set(a96["expected"]["prohibited_output"]) <= set(po["params"]["prohibited"])


# ---------------------------------------------------------------------------
# B-07 semantic-only finalization
# ---------------------------------------------------------------------------

_CAL = None


def _cal_registry():
    global _CAL
    if _CAL is None:
        from adapters.calibration import CALIBRATION_REGISTRY
        _CAL = CALIBRATION_REGISTRY
    return _CAL


def _semantic_spec(sid, corrupt=None):
    return {
        "scenario_id": sid, "track": "ALEXEY_INBOUND", "execution_level": "L1",
        "failure_class": "AG-05", "risk": "High", "seam_class": "RUNTIME",
        "seam_executable": True, "safe_to_execute": True,
        "adapter_id": "cal_synthetic_academy",
        "turns": [{"role": "user", "content": "Как оплатить курс Маслоу?"}],
        "state_setup": {}, "preconditions": ({"corrupt": corrupt} if corrupt else {}),
        "fault_schedule": [], "expected": {},
        "oracle": [{"oracle": "semantic_input_frozen", "params": {}}],
        "semantic_evaluation": {"required": True, "claim": "semantic-only claim"},
        "failure_mechanism": "battery specimen", "trigger": "synthetic",
        "observable_effect": "synthetic", "why_this_scenario_tests_this_class": "battery",
        "sut_binding": {"adapter_id": "cal_synthetic_academy"},
        "concurrency_workers": 0,
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


@test("B07.semantic_only_satisfied_passes_not_false_fail")
def _():
    evid = tempfile.mkdtemp(prefix="b07-")
    out = run_scenario_once(_semantic_spec("B7-SAT"), run_id="B7R", attempt=1,
                            evidence_root=evid, lane="CALIBRATION",
                            calibration_registry=_cal_registry())
    assert out.verdict == PrimaryVerdict.HOLD, out.verdict_reason  # pending -> HOLD
    out2 = apply_semantic_result(out, _semantic_result(out, "SEMANTIC_SATISFIED"),
                                 evidence_root=evid)
    assert out2.verdict == PrimaryVerdict.PASS, out2.verdict_reason  # the IV4 false FAIL is closed
    # violated -> FAIL
    out3 = run_scenario_once(_semantic_spec("B7-VIO"), run_id="B7R", attempt=1,
                             evidence_root=evid, lane="CALIBRATION",
                             calibration_registry=_cal_registry())
    out4 = apply_semantic_result(out3, _semantic_result(out3, "SEMANTIC_VIOLATED"),
                                 evidence_root=evid)
    assert out4.verdict == PrimaryVerdict.FAIL


@test("B07.deterministic_failed_not_rescued_by_semantic")
def _():
    evid = tempfile.mkdtemp(prefix="b07b-")
    spec = _semantic_spec("B7-DET")
    spec["oracle"] = [{"oracle": "act_equals", "params": {"expected_act": "REFUND"}},
                      {"oracle": "semantic_input_frozen", "params": {}}]
    out = run_scenario_once(spec, run_id="B7R2", attempt=1, evidence_root=evid,
                            lane="CALIBRATION", calibration_registry=_cal_registry())
    assert out.verdict == PrimaryVerdict.FAIL
    out2 = apply_semantic_result(out, _semantic_result(out, "SEMANTIC_SATISFIED"),
                                 evidence_root=evid)
    assert out2.verdict == PrimaryVerdict.FAIL


# ---------------------------------------------------------------------------
# B-08 RAG capture
# ---------------------------------------------------------------------------

@test("B08.rag_fixture_suite_green")
def _():
    from adapters.rag_fixture_suite import run_rag_fixture_suite
    result = run_rag_fixture_suite()
    assert result["all_pass"], [c for c in result["cases"] if not c["pass"]]
    assert result["no_network"] and result["no_navigator_server"]
    assert result["rag_diagnostic_capture_ready"]


@test("B08.server_returned_id_is_correlation_authority")
def _():
    from adapters.product import collect_rag_diagnostics
    with tempfile.TemporaryDirectory() as td:
        log = Path(td) / "nav.jsonl"
        ev = {"event": "NAVIGATOR_TURN", "requestId": "SERVER-1", "ragInvoked": True}
        log.write_text(json.dumps(ev) + "\n")
        # correlated by the SERVER id even though a client id exists
        d = collect_rag_diagnostics({"navigator_l2_log_path": str(log)}, "SERVER-1")
        assert d["fields"]["ragInvoked"]["value"] is True
        assert d["correlation"]["server_request_id"] == "SERVER-1"
        # a client body id that matches nothing leaves everything UNOBSERVED
        d2 = collect_rag_diagnostics({"navigator_l2_log_path": str(log)}, "client-id-xyz")
        assert d2["fields"]["ragInvoked"]["value"] is UNOBSERVED


# ---------------------------------------------------------------------------
# B-09 async Navigator transport contract
# ---------------------------------------------------------------------------

@test("B09.async_native_signature_transport_contract")
def _():
    from adapters.product import AlexeyUserTurnAdapter, _stubbed_navigator_response
    src = inspect.getsource(AlexeyUserTurnAdapter.execute)
    assert "async def stubbed_core(messages, profile, conversation_state, request_id" in src
    assert "payload_bytes=None" in src
    # the always-raising synchronous wrong-parameter stub is gone
    assert "stubbed navigator transport: policy generation not under test" not in src
    # contract-valid deterministic fixture response
    resp = _stubbed_navigator_response("x")
    assert {"message", "profile", "conversationState", "contactCard",
            "resetConversation"} <= set(resp)
    # real_local without the local server is an explicit refusal, never canned
    assert "FUTURE local" in src or "FUTURE_LOCAL_NAVIGATOR_SERVER" in src
    # native async signature is documented and audited
    from adapters.registry import audit_native_contracts
    audit = audit_native_contracts()
    assert audit["all_valid"]


# ---------------------------------------------------------------------------
# B-10 lock instrumentation contract
# ---------------------------------------------------------------------------

@test("B10.native_release_protocol_preserved")
def _():
    from adapters.product import AlexeyUserTurnAdapter
    src = inspect.getsource(AlexeyUserTurnAdapter.execute)
    # release is a SYNCHRONOUS override exactly like the native protocol
    assert "def release(self):" in src
    assert "async def release" not in src
    # the instrumentation pattern itself works natively on one loop:
    # same-loop tasks, shared lock, recorded critical sections, sync release
    windows = []

    class InstrumentedLock(asyncio.Lock):
        async def acquire(self):
            task = asyncio.current_task()
            self._task = getattr(task, "get_name", lambda: None)() or str(id(task))
            self._t0 = time.perf_counter_ns()
            got = await super().acquire()
            self._tacq = time.perf_counter_ns()
            return got

        def release(self):
            t1 = time.perf_counter_ns()
            super().release()
            windows.append({"task": self._task, "start": self._tacq, "end": t1})

    async def scenario():
        lock = InstrumentedLock()

        async def worker(i):
            async with lock:  # native protocol: acquire() then release()
                await asyncio.sleep(0.01)

        await asyncio.gather(worker(0), worker(1))

    asyncio.run(scenario())
    assert len(windows) == 2 and all(w["end"] >= w["start"] for w in windows)


# ---------------------------------------------------------------------------
# B-11 fault reachability
# ---------------------------------------------------------------------------

@test("B11.fault_hook_invokes_operation_and_records_evidence")
def _():
    from adapters.product import _install_alexey_fault_hook
    src = inspect.getsource(__import__("adapters.product", fromlist=["x"]).AlexeyUserTurnAdapter.execute)
    # the old single-worker 'install hook then return' pattern is gone
    assert "results.append(hook_res)" not in src
    # hooks are installed BEFORE the operation runs on every control path
    assert src.index("_install_alexey_fault_hook(") < src.index("async def runner")
    # multi-worker path gathers one_turn tasks (no fault bypass)
    assert "asyncio.gather" in src

    # CORR5 F13 direct regression update: LOST_RESPONSE represents REAL ORDER
    # since IV5 F13 — the hook wraps process_user_turn (the native operation
    # completes its normal persistence FIRST, then the returned response is
    # suppressed), with kind/target/point derived from the REGISTERED
    # mechanism ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE instead of free-form
    # scenario labels.
    class _FakeStore:
        def __init__(self):
            self.saved = 0
            self.state = {"selectedCourseId": None}

        def get_session(self, uid):
            return ({"displayName": None}, dict(self.state))

        def save_session(self, uid, profile, state):
            self.saved += 1
            self.state = dict(state or {})

    class _FakeAdapter:
        async def call_navigator_core(self, messages, profile, conversation_state,
                                      request_id, payload_bytes=None):
            return {"message": "ok", "profile": {}, "conversationState":
                    {"selectedCourseId": "maslow"}, "contactCard": None,
                    "resetConversation": False}

        async def process_user_turn(self, uid, text, message_id):
            res = await self.call_navigator_core(
                messages=[{"role": "user", "content": text}], profile=None,
                conversation_state=None, request_id="r1")
            fake_store.save_session(uid, res["profile"], res["conversationState"])
            return [res["message"]]

    adapter, fake_store = _FakeAdapter(), _FakeStore()
    adapter.process_user_turn = adapter.process_user_turn.__get__(adapter)
    transport_calls: list[dict] = []
    fault_evidence: list[dict] = [{}]
    res = _install_alexey_fault_hook(
        {"kind": "LOST_RESPONSE", "mechanism_id": "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE"},
        adapter, fake_store, 701001, transport_calls, fault_evidence)
    assert res is None
    out = asyncio.run(adapter.process_user_turn(701001, "Хочу Маслоу", 5001))
    # the intended native operation WAS invoked and completed its durable
    # persistence; only the returned response is lost afterward
    assert out is None
    ev = fault_evidence[0]
    assert ev["fault_confirmed_injected"] is True
    assert ev["operation_invoked"] >= 1
    assert ev["mechanism_evidence"]["durable_write_proven"] is True
    assert ev["mechanism_evidence"]["persisted_state_present"] is True
    assert ev["mechanism_evidence"]["response_dropped"] is True
    assert ev["fault_mechanism_id"] == "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE"
    assert ev["fault_target"] == "alexey_process_user_turn_response_delivery"
    assert ev["fault_point"] == "after_persistence_before_delivery"
    assert fake_store.state.get("selectedCourseId") == "maslow"


# ---------------------------------------------------------------------------
# B-12 typed static query derivation
# ---------------------------------------------------------------------------

@test("B12.typed_queries_derive_actual_facts")
def _():
    from adapters.product import StaticSourceInventoryAdapter
    from harness.execution_request import ExecutionRequest
    fixture = Path(tempfile.mkdtemp(prefix="b12-"))
    (fixture / "main.py").write_text(
        "# start_polling is only mentioned in this comment\n"
        "import asyncio\n"
        "delete_webhook()\n"
        "dp = Dispatcher(storage=MemoryStorage())\n"
        "async def process_user_turn(u):\n"
        "    lock = asyncio.Lock()\n"
        "    async with lock:\n"
        "        pass\n", encoding="utf-8")
    req = ExecutionRequest(
        scenario_id="S", scenario_sha256="d" * 64, track="T", execution_level="L1",
        adapter_id="static_source_inventory", run_id="R", attempt=1, turns=(),
        tikhon_test_root=str(fixture),
        preconditions={"static_queries": [
            {"query_type": "CALL_SITE_EXISTS", "file": "main.py", "call": "start_polling",
             "fact": "call_in_comment"},
            {"query_type": "CALL_SITE_EXISTS", "file": "main.py", "call": "delete_webhook",
             "fact": "real_call"},
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "storage=MemoryStorage()", "fact": "cfg_value"},
            {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
             "config_expression": "storage=RedisStorage()", "fact": "cfg_wrong"},
            {"query_type": "SYMBOL_EXISTS", "file": "main.py", "symbol": "asyncio.Lock",
             "fact": "qualified_symbol"},
            {"query_type": "IMPORT_EXISTS", "file": "main.py", "module": "asyncio",
             "fact": "import_exists"},
            {"query_type": "LOCK_PRIMITIVE_PRESENT", "file": "main.py", "fact": "lock_present"},
        ]})
    cap = StaticSourceInventoryAdapter().execute(req)
    facts = cap.static_inspection["facts"]
    assert facts["call_in_comment"] is False      # comment text is NOT a call site
    assert facts["real_call"] is True
    # CORR6 direct regression update (IV6-F08): a non-literal requested value
    # (Call expression) is NOT_OBSERVABLE — structural guessing is retired
    assert facts["cfg_value"] is None, f"cfg_value={facts.get('cfg_value')!r}"
    assert facts["cfg_wrong"] is None, f"cfg_wrong={facts.get('cfg_wrong')!r}"
    assert facts["qualified_symbol"] is True      # qualified attribute in code
    assert facts["import_exists"] is True
    assert facts["lock_present"] is True          # actual Lock() call expression
    basis = cap.static_inspection["source_basis"]
    for b in basis:
        assert {"query_type", "source_file", "source_sha256", "requested_subject",
                "derived_value", "derivation_method"} <= set(b)


# ---------------------------------------------------------------------------
# B-13 real native classification observable
# ---------------------------------------------------------------------------

@test("B13.classified_intent_is_native_observable")
def _():
    from adapters.product import OutboundLeadLifecycleAdapter
    src = inspect.getsource(OutboundLeadLifecycleAdapter.execute)
    assert "classify_lead_intent(refusal_text.strip(), lead_status)" in src
    assert "classifiedIntentSource" in src
    # the reply-truthiness fabrication is gone
    assert '"NEGATIVE" if first' not in src and '"NEGATIVE" if' not in src
    # classification, persistence and suppression are SEPARATE observables
    assert "leadStatus" in src and "suppressionHonored" in src


# ---------------------------------------------------------------------------
# B-14 seed / artifact synchronization
# ---------------------------------------------------------------------------

@test("B14.seed_artifact_synchronized_with_corpus")
def _():
    canon = lambda s: json.dumps(s, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    rows = {}
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                rows[r["scenario_id"]] = r
    seeds = [json.loads(l) for l in
             (BENCH / "seeds" / "seeds_30_corrected.jsonl").read_text().splitlines() if l.strip()]
    assert len(seeds) == 30
    match = sum(1 for s in seeds if canon(s) == canon(rows[s["scenario_id"]]))
    assert match == 30, match
    report = json.loads((BENCH / "seeds" / "SEED_SYNC_REPORT.json").read_text())
    assert report["schema"] == "SEED_SYNC_REPORT_V4"
    # A-0012 physically carries the oversized current input
    a12 = rows["A-0012"]
    assert max(len(t["content"]) for t in a12["turns"]) > 4000
    # removed adapter IDs do not remain in the seed file
    assert all(s["adapter_id"] != "chatbot_l3_session_store" for s in seeds)
    # matrix references the same row identity/hash
    matrix = json.loads((BENCH / "corpus" / "SEED_NATIVE_CONTRACT_MATRIX.json").read_text())
    for m in matrix["seeds"]:
        assert m["CONTROLLING_CORPUS_ROW_SHA256"] == m["SEED_ARTIFACT_SHA256"]
        row_sha = hashlib.sha256(canon(rows[m["SEED_ID"]]).encode()).hexdigest()
        assert m["SEED_ARTIFACT_SHA256"] == row_sha
        assert m["READINESS"] == "READY_FOR_FIRST_PRODUCT_RUN_CONTRACT"


# ---------------------------------------------------------------------------
# B-15 typed claim source / render contract
# ---------------------------------------------------------------------------

@test("B15.typed_sources_exact_schemas_and_render_revalidation")
def _():
    engine = ClaimEngine()
    tmp = Path(tempfile.mkdtemp()) / "self.json"
    # wrong schema refused (no default-zero interpretation)
    tmp.write_text(json.dumps({"schema": "WRONG", "passed": 999, "total": 999,
                               "all_pass": True}))
    try:
        engine.register("X", "SELF_TEST_COUNT", str(tmp))
        raise AssertionError("wrong-schema self-test source accepted")
    except ValueError:
        pass
    # correct schema registers; a later mutation is refused AT RENDER TIME
    tmp.write_text(json.dumps({"schema": "CORR2_SELF_TEST_RESULTS_V2", "passed": 1,
                               "total": 1, "all_pass": True}))
    engine.register("X", "SELF_TEST_COUNT", str(tmp))
    tmp.write_text(json.dumps({"schema": "CORR2_SELF_TEST_RESULTS_V2", "passed": 2,
                               "total": 2, "all_pass": True}))
    renderer = ReportRenderer(engine)
    try:
        renderer.material("X")
        raise AssertionError("mutated source still rendered")
    except ValueError:
        pass
    # missing source also refuses rendering
    tmp2 = Path(tempfile.mkdtemp()) / "gone.json"
    tmp2.write_text(json.dumps({"schema": "CORR2_SELF_TEST_RESULTS_V2", "passed": 1,
                                "total": 1, "all_pass": True}))
    engine2 = ClaimEngine()
    engine2.register("Y", "SELF_TEST_COUNT", str(tmp2))
    tmp2.unlink()
    try:
        ReportRenderer(engine2).material("Y")
        raise AssertionError("missing source still rendered")
    except ValueError:
        pass


@test("B15.payload_claims_are_calibration_only")
def _():
    engine = ClaimEngine()
    claim = engine.register("CAL", "SELF_TEST_COUNT", "/nonexistent.json",
                            calibration_payload={"schema": "CORR2_SELF_TEST_RESULTS_V2",
                                                 "passed": 999, "total": 999, "all_pass": True})
    assert claim["authoritative"] is False
    renderer = ReportRenderer(engine)
    try:
        renderer.material("CAL")
        raise AssertionError("calibration payload rendered as material")
    except ValueError:
        pass
    md = renderer.render_markdown()
    assert "NON_AUTHORITATIVE_COMMENTARY" in md
    assert "AUTHORITATIVE MACHINE CLAIMS" in md


# ---------------------------------------------------------------------------
# B-16 incomplete repeats cannot PASS
# ---------------------------------------------------------------------------

@test("B16.repeat_aggregation_precedence")
def _():
    V = PrimaryVerdict
    assert aggregate_repeat_verdicts([V.PASS, V.BENCHMARK_DEFECT, V.PASS]) == V.BENCHMARK_DEFECT
    assert aggregate_repeat_verdicts([V.PASS, V.INFRA_FAILURE, V.PASS]) == V.INFRA_FAILURE
    assert aggregate_repeat_verdicts([V.PASS, V.TIMEOUT, V.PASS]) == V.TIMEOUT
    assert aggregate_repeat_verdicts([V.PASS, V.NOT_EXECUTED, V.PASS]) == V.NOT_EXECUTED
    assert aggregate_repeat_verdicts([V.PASS, V.HOLD, V.PASS]) == V.HOLD
    assert aggregate_repeat_verdicts([V.PASS, V.NOT_OBSERVABLE, V.PASS]) == V.NOT_OBSERVABLE
    assert aggregate_repeat_verdicts([V.PASS, V.SKIPPED_UNSAFE, V.PASS]) == V.SKIPPED_UNSAFE
    assert aggregate_repeat_verdicts([V.PASS] * 3) == V.PASS
    assert aggregate_repeat_verdicts([V.FAIL] * 3) == V.FAIL
    assert aggregate_repeat_verdicts([V.PASS, V.FAIL, V.PASS]) == V.NONDETERMINISTIC


# ---------------------------------------------------------------------------
# B-17 sanitized actual evidence
# ---------------------------------------------------------------------------

@test("B17.observed_value_sanitized_before_freeze")
def _():
    from adapters.calibration import CALIBRATION_REGISTRY
    evid = tempfile.mkdtemp(prefix="b17-")
    spec = {
        "scenario_id": "B17-1", "track": "ALEXEY_INBOUND", "execution_level": "L1",
        "failure_class": "AG-07", "risk": "High", "seam_class": "RUNTIME",
        "seam_executable": True, "safe_to_execute": True,
        "adapter_id": "cal_synthetic_academy",
        "turns": [{"role": "user", "content": "статус?"}],
        "state_setup": {}, "preconditions": {"fixed_output": "держите api_key=SYNTHSECRET99"},
        "fault_schedule": [], "expected": {},
        "oracle": [{"oracle": "outcome_class", "params": {}}],
        "semantic_evaluation": {"required": False},
        "failure_mechanism": "battery", "trigger": "synthetic", "observable_effect": "synthetic",
        "why_this_scenario_tests_this_class": "battery",
        "sut_binding": {"adapter_id": "cal_synthetic_academy"}, "concurrency_workers": 0,
    }
    out = run_scenario_once(spec, run_id="B17R", attempt=1, evidence_root=evid,
                            lane="CALIBRATION", calibration_registry=CALIBRATION_REGISTRY)
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id="B17R", scenario_id="B17-1", scenario_sha256=out.scenario_sha256,
                         observation_id="B17-1_A1", attempt_index=1,
                         evidence_type="RAW_OBSERVATION"),
        out.derivation_state["raw_evidence_path"],
        out.derivation_state["raw_evidence_sha256"])
    doc = frozen.load()
    blob = json.dumps(doc, ensure_ascii=False)
    assert "SYNTHSECRET99" not in blob, "synthetic secret marker persisted in frozen evidence"
    assert "[REDACTED]" in blob
    # the ObservedValue and its field-evidence digest agree on the SANITIZED value
    ov = doc["payload"]["actual"]["output"]
    resolve_field_ref(doc, "output", ov)


# ---------------------------------------------------------------------------
# B-18 causal contract identity at scoring
# ---------------------------------------------------------------------------

_CONC_SEQ = [0]


def _conc_evidence(td, overlap):
    _CONC_SEQ[0] += 1
    ident = _ident(run="R18", scen="C18", obs=f"C18_A{_CONC_SEQ[0]}")
    payload = {"concurrency": overlap}
    frozen = freeze_evidence(ident, td, payload)
    return ident, frozen


@test("B18.concurrency_identity_no_wrapper_fallback")
def _():
    with tempfile.TemporaryDirectory() as td:
        t = time.perf_counter_ns()
        good = {"workers": 2, "worker_ids": ["w0", "w1"],
                "participant_identities": ["w0", "w1"],
                "intervals": [[t, t + 5000], [t, t + 5000]],
                "native_operation_intervals": [[t + 100, t + 4000], [t + 100, t + 4000]],
                "target_seam": "LebedevNavigatorAdapter.get_user_lock",
                "schedule_id": "C18-A1"}
        ident, frozen = _conc_evidence(td, good)
        spec = {"scenario_id": "C18", "fault_schedule": []}
        ok = oracle_concurrency_overlap_proven(frozen, spec, {"workers": 2})
        assert ok.satisfied is True and not ok.invalid, ok.reason
        # missing native_operation_intervals -> INVALID, no wrapper fallback
        bad = dict(good)
        bad.pop("native_operation_intervals")
        _, frozen2 = _conc_evidence(td, bad)
        check = oracle_concurrency_overlap_proven(frozen2, spec, {"workers": 2})
        assert check.invalid is True and "no fallback" in check.reason
        # wrong requested seam -> invalid (evidence for another mechanism)
        check2 = oracle_concurrency_overlap_proven(frozen, spec, {
            "workers": 2, "target_seam": "somewhere.else"})
        assert check2.invalid is True and "different mechanism" in check2.reason
        # participant mismatch -> invalid
        bad3 = dict(good)
        bad3["participant_identities"] = ["w0"]
        _, frozen3 = _conc_evidence(td, bad3)
        check3 = oracle_concurrency_overlap_proven(frozen3, spec, {"workers": 2})
        assert check3.invalid is True


_FAULT_SEQ = [0]


def _fault_evidence(td, payload):
    _FAULT_SEQ[0] += 1
    ident = _ident(run="R18F", scen="F18", obs=f"F18_A{_FAULT_SEQ[0]}")
    return freeze_evidence(ident, td, payload)


@test("B18.fault_kind_registry_and_adapter_capability_binding")
def _():
    with tempfile.TemporaryDirectory() as td:
        payload = {"fault": {
            "fault_target": "navigator_transport", "fault_point": "after_durable_write",
            "fault_kind": "SOME_UNREGISTERED_KIND", "fault_confirmed_injected": True,
            "operation_invoked": 1,
            "mechanism_evidence": {"anything": "nonempty"}}}
        frozen = _fault_evidence(td, payload)
        spec = {"scenario_id": "F18",
                "fault_schedule": [{"kind": "SOME_UNREGISTERED_KIND",
                                    "target": "navigator_transport",
                                    "point": "after_durable_write"}]}
        check = oracle_fault_confirmed_injected(frozen, spec, {},
                                                supported_fault_hooks=("LOST_RESPONSE",))
        assert check.invalid is True and check.satisfied is None  # no product verdict
        assert "no registered mechanism" in check.reason
        # a registered kind outside the bound adapter's capability is invalid too
        spec2 = {"scenario_id": "F18",
                 "fault_schedule": [{"kind": "LOST_RESPONSE", "target": "navigator_transport",
                                     "point": "after_durable_write"}]}
        check2 = oracle_fault_confirmed_injected(frozen, spec2, {},
                                                 supported_fault_hooks=("DEPENDENCY_500",))
        assert check2.invalid is True and "not a supported fault capability" in check2.reason
        # the operation-not-invoked guard (B-11) makes the measurement invalid
        payload3 = {"fault": dict(payload["fault"], fault_kind="LOST_RESPONSE",
                                  mechanism_evidence={"durable_write_proven": True})}
        payload3["fault"]["operation_invoked"] = 0
        frozen3 = _fault_evidence(td, payload3)
        check3 = oracle_fault_confirmed_injected(frozen3, spec2, {},
                                                 supported_fault_hooks=("LOST_RESPONSE",))
        assert check3.invalid is True and "never invoked" in check3.reason


# ---------------------------------------------------------------------------
# M-01 immutable authenticated helper contracts
# ---------------------------------------------------------------------------

@test("M01.token_deep_immutability_and_factory_trust")
def _():
    from types import MappingProxyType
    token = BindingToken(
        schema_version="CORR3-BINDING-TOKEN-1",
        navigator_expected={"repo": "structural-typology-navigator", "nested": {"head": "x"}},
        tikhon_expected={"repo": "chatbot"}, navigator_root="/tmp/nav", tikhon_root=None,
        navigator_manifest_sha256=None, tikhon_manifest_sha256=None,
        created_at_utc="t", run_id="R4")
    token.verify()
    assert isinstance(token.navigator_expected, MappingProxyType)
    assert isinstance(token.navigator_expected["nested"], MappingProxyType)
    # duck-typed fixture tokens are rejected by the factory
    from harness.execution_request import ExecutionRequest
    req = ExecutionRequest(scenario_id="S", scenario_sha256="e" * 64, track="T",
                           execution_level="L1", adapter_id="navigator_l1_payment_policy",
                           run_id="R4", attempt=1)
    reg = {"adapters": {"navigator_l1_payment_policy": {
        "implementation_class": "adapters.product.NavigatorL1PaymentPolicyAdapter",
        "provenance_class": "RUNTIME_FUNCTION_RETURN", "lane": "PRODUCT", "repo": "NAVIGATOR"}}}
    try:
        create_product_adapter(req, {"schema_version": "CORR3-BINDING-TOKEN-1"}, reg)
        raise AssertionError("duck-typed token accepted")
    except FactoryRejected:
        pass
    # run-identity correspondence
    token2 = BindingToken(
        schema_version="CORR3-BINDING-TOKEN-1", navigator_expected={}, tikhon_expected={},
        navigator_root="/tmp/nav", tikhon_root="/tmp/tik", navigator_manifest_sha256=None,
        tikhon_manifest_sha256=None, created_at_utc="t", run_id="OTHER-RUN")
    try:
        create_product_adapter(req, token2, reg)
        raise AssertionError("foreign run identity accepted")
    except FactoryRejected:
        pass
    # side correspondence: Navigator-side adapter cannot run on a Tikhon-only token
    token3 = BindingToken(
        schema_version="CORR3-BINDING-TOKEN-1", navigator_expected={}, tikhon_expected={},
        navigator_root=None, tikhon_root="/tmp/tik", navigator_manifest_sha256=None,
        tikhon_manifest_sha256=None, created_at_utc="t", run_id="R4")
    try:
        create_product_adapter(req, token3, reg)
        raise AssertionError("side correspondence violated")
    except FactoryRejected as exc:
        assert "Navigator TEST_BASE" in str(exc)


# ---------------------------------------------------------------------------
# M-02 canonical inventory policy
# ---------------------------------------------------------------------------

@test("M02.byte_state_policy_matches_physical_inventory")
def _():
    sys.path.insert(0, str(BENCH / "artifacts"))
    mod = importlib.import_module("build_byte_state_v4")
    doc = json.loads((BENCH / "artifacts" / "CANONICAL_TIKHON_BYTE_STATE_CANDIDATE.json").read_text())
    assert doc["candidate_status"].startswith("CANDIDATE")
    # the ambiguous blanket docs/* rule is retired
    assert "docs/*" not in doc["overlay_included_classes"]
    assert "**/.DS_Store" in doc["excluded_classes"] and "*.docx" in doc["excluded_classes"]
    # policy and physical inventory agree by construction: recompute and compare
    rebuilt = mod.build_candidate()
    assert rebuilt["counts"] == doc["counts"]
    assert rebuilt["untracked_overlay"] == doc["untracked_overlay"]
    assert rebuilt["manifest_sha256"] == doc["manifest_sha256"]


# ---------------------------------------------------------------------------
# M-03 shared/redundant stimulus accounting
# ---------------------------------------------------------------------------

@test("M03.stimulus_accounting_honest")
def _():
    report = json.loads((BENCH / "corpus" / "EFFECTIVE_STIMULUS_REPORT.json").read_text())
    assert report["redundant_effective_scenarios"] == 0
    assert report["shared_stimulus_groups"] > 0  # transparent, not hidden
    assert "NOT claimed" in report["honesty_note"]
    tagged = 0
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                if r.get("shared_stimulus_group_id"):
                    tagged += 1
    assert tagged >= 2 * report["shared_stimulus_groups"] - 5, (tagged, report["shared_stimulus_groups"])


# ---------------------------------------------------------------------------
# M-04 stochastic replay eligibility
# ---------------------------------------------------------------------------

@test("M04.set_s_only_for_stochastic_mechanisms")
def _():
    from corpus.repair_v4 import IV4_DETERMINISTIC_S_ROWS
    rows = {}
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                rows[r["scenario_id"]] = r
    for sid in IV4_DETERMINISTIC_S_ROWS:
        assert rows[sid].get("replay_set") is None, sid  # scenario stays, replay changes
    s_adapters = {r["adapter_id"] for r in rows.values() if r.get("replay_set") == "S"}
    assert s_adapters <= {"navigator_l2_chat_api"}, s_adapters


# ---------------------------------------------------------------------------
# M-05 mutation state preservation
# ---------------------------------------------------------------------------

@test("M05.mutation_preserves_original_authority_state")
def _():
    from adapters.calibration import CALIBRATION_REGISTRY
    evid = tempfile.mkdtemp(prefix="m05-")
    base = {
        "scenario_id": "M5-1", "track": "ALEXEY_INBOUND", "execution_level": "L1",
        "failure_class": "PAY-13", "risk": "High", "seam_class": "RUNTIME",
        "seam_executable": True, "safe_to_execute": True,
        "adapter_id": "cal_synthetic_academy",
        "turns": [{"role": "user", "content": "Как оплатить курс Маслоу?"}],
        "state_setup": {}, "preconditions": {}, "fault_schedule": [],
        "expected": {"act": "PAYMENT"},
        "oracle": [{"oracle": "act_equals", "params": {"expected_act": "PAYMENT"}}],
        "semantic_evaluation": {"required": False},
        "failure_mechanism": "battery", "trigger": "synthetic", "observable_effect": "synthetic",
        "why_this_scenario_tests_this_class": "battery",
        "sut_binding": {"adapter_id": "cal_synthetic_academy"}, "concurrency_workers": 0,
    }
    out = run_scenario_once(base, run_id="M5R", attempt=1, evidence_root=evid,
                            lane="CALIBRATION", calibration_registry=CALIBRATION_REGISTRY)
    assert out.verdict == PrimaryVerdict.PASS
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id="M5R", scenario_id="M5-1",
                         scenario_sha256=out.scenario_sha256, observation_id="M5-1_A1",
                         attempt_index=1, evidence_type="RAW_OBSERVATION"),
        out.derivation_state["raw_evidence_path"],
        out.derivation_state["raw_evidence_sha256"])
    muts = run_oracle_mutation(out, base, frozen, [("act", "OUT_OF_SCOPE")])
    assert muts and all(m.flipped and m.state_preserved for m in muts)
    # an original observation NOT eligible to execute can never mutate to PASS.
    # CORR6 direct regression update (IV6-F04-F14): the SERIALIZED
    # execution_state block is the single authority consumed by mutation —
    # flat-key surgery no longer reaches the verdict path.
    out.derivation_state["execution_state"]["execution_eligibility"] = "SKIPPED_UNSAFE"
    muts2 = run_oracle_mutation(out, base, frozen, [("act", "PAYMENT")])
    assert all(m.mutated_verdict != "PASS" for m in muts2), [m.mutated_verdict for m in muts2]
    # an outcome missing the serialized authority cannot be mutation-scored at all
    out.derivation_state["execution_state"].pop("execution_eligibility")
    muts3 = run_oracle_mutation(out, base, frozen, [("act", "PAYMENT")])
    assert all(m.mutated_verdict == "BENCHMARK_DEFECT" for m in muts3)
    # lineage: a DIFFERENT base spec cannot be mutation-scored against this evidence
    foreign = json.loads(json.dumps(base))
    foreign["oracle"][0]["params"]["expected_act"] = "OTHER"
    try:
        run_oracle_mutation(out, foreign, frozen, [("act", "X")])
        raise AssertionError("unbound mutation lineage accepted")
    except ValueError:
        pass


# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------

def main() -> int:
    importlib.import_module("tests.iv4_regression_battery")
    for _name, fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    failed = [r for r in RESULTS if not r["pass"]]
    print(f"IV4 REGRESSION BATTERY: {passed}/{len(RESULTS)} passed")
    for r in failed:
        print(f"  FAIL {r['name']}: {r['detail'][:240]}")
    (BENCH / "artifacts" / "IV4_REGRESSION_BATTERY.json").write_text(json.dumps({
        "schema": "IV4_REGRESSION_BATTERY",
        "total": len(RESULTS), "passed": passed, "failed": len(failed),
        "all_pass": not failed, "cases": RESULTS,
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
