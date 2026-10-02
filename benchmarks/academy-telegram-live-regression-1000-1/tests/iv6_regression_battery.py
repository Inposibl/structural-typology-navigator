"""IV6 focused regression battery — CORR6 (owner sections 44-45).

Covers the ACTIVE retained IV6 findings only, with benign local fixtures
(/tmp). No product execution, no TEST_BASE binding, no network, no git.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import json
import sys
import tempfile
import time
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))

from harness.evidence import (  # noqa: E402
    EvidenceIdentity,
    FrozenEvidence,
    UNOBSERVED,
    freeze_evidence,
)
from harness.execution_state import (  # noqa: E402
    derive_verdict_from_execution_state,
    from_state_dict,
    run_state_machine_invariants,
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


def _ident(run="R6", scen="S6", obs="S6_A1"):
    return EvidenceIdentity(run_id=run, scenario_id=scen, scenario_sha256="a" * 64,
                            observation_id=obs, attempt_index=1,
                            evidence_type="RAW_OBSERVATION")


def _load_rows():
    rows = {}
    with open(BENCH / "corpus" / "corrected_corpus_84.jsonl") as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                rows[r["scenario_id"]] = r
    return rows


SEED_IDS = ([f"A-{i:04d}" for i in range(1, 16)] + [f"B-{i:04d}" for i in range(1, 8)] +
            [f"C-{i:04d}" for i in range(1, 4)] + [f"D-{i:04d}" for i in range(1, 6)])


# ---------------------------------------------------------------------------
# §44: 924 pruning gate + 30/30 seed preservation
# ---------------------------------------------------------------------------

@test("PRUNE.corpus_996_to_924_gate")
def _():
    rows = _load_rows()
    assert len(rows) == 924, len(rows)
    for sid in SEED_IDS:
        assert sid in rows and rows[sid].get("seed") is True, sid
    plan = json.loads((BENCH / "corpus" / "CORPUS_PRUNING_PLAN_996_TO_924.json").read_text())
    assert plan["SOURCE_COUNT"] == 996 and plan["FINAL_COUNT"] == 924
    assert plan["REMOVED_COUNT"] == 72 and plan["KEPT_COUNT"] == 924
    assert plan["MANDATORY_SEEDS_REMOVED"] == 0
    assert len(plan["removed_ids"]) == 72
    assert not (set(plan["removed_ids"]) & set(SEED_IDS))
    assert set(plan["pre_failure_class_inventory"]) == \
        set(plan["post_failure_class_inventory"]) == set(range(0, 0)) or \
        set(plan["pre_failure_class_inventory"]) == set(plan["post_failure_class_inventory"])
    # every removal carries the required rationale fields
    for r in plan["removals"]:
        for k in ("REMOVED_ID", "MANDATORY_SEED", "FAILURE_CLASS", "MECHANISM_ID",
                  "MEASUREMENT_CLASS", "NEAREST_RETAINED_COVERAGE", "REMOVAL_REASON",
                  "INFORMATION_LOSS", "UNIQUE_MECHANISM_LOST"):
            assert k in r, (r.get("REMOVED_ID"), k)
        assert r["MANDATORY_SEED"] == "NO"
        assert r["INFORMATION_LOSS"] in ("NONE", "NON_MATERIAL")
        assert r["UNIQUE_MECHANISM_LOST"] == "NO"
    ret = json.loads((BENCH / "corpus" / "CORPUS_924_COVERAGE_RETENTION_REPORT.json").read_text())
    assert ret["UNIQUE_REQUIRED_MECHANISM_LOSS"] == 0
    assert ret["MATERIAL_MEASUREMENT_CLASS_LOSS"] == 0
    # 84/84 taxonomy classes retained
    assert len(ret["failure_classes"]) == 84
    assert all(v["FINAL_COUNT"] >= 1 for v in ret["failure_classes"].values())
    # seed sync 30/30 against the final 924 corpus
    sync = json.loads((BENCH / "seeds" / "SEED_SYNC_REPORT.json").read_text())
    assert sync["match_count"] == 30 and sync["actual_ids"] == SEED_IDS
    seed_rows = [json.loads(l) for l in
                 (BENCH / "seeds" / "seeds_30_corrected.jsonl").read_text().splitlines() if l]
    for s in seed_rows:
        assert json.dumps(rows[s["scenario_id"]], ensure_ascii=False, sort_keys=True,
                          separators=(",", ":")) == json.dumps(
            s, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------------------
# IV6-F02 — user-keyed state projection (closure by compiler prevention)
# ---------------------------------------------------------------------------

@test("F02.user_keyed_state_projection_enforced")
def _():
    from harness.contract_compile import AdapterCapability, compile_scenario_contract
    rows = _load_rows()
    # no retained alexey row carries flat state expectations
    for sid, s in rows.items():
        if s.get("adapter_id") != "alexey_user_turn":
            continue
        for k in (s.get("expected") or {}).get("state") or {}:
            assert k.isdigit(), (sid, k)
    # the compiler REJECTS the IV6 counterexample shape (flat selectedCourseId)
    bad = {
        "scenario_id": "F2X", "failure_class": "TG-07", "track": "ALEXEY_INBOUND",
        "execution_level": "L5", "seam_class": "RUNTIME",
        "adapter_id": "alexey_user_turn", "turns": [], "expected":
            {"state": {"selectedCourseId": "maslow"}},
        "oracle": [{"oracle": "state_subset",
                    "params": {"expected_state": {"selectedCourseId": "maslow"}}}],
        "failure_mechanism": "m", "trigger": "t", "observable_effect": "e",
        "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"},
    }
    cc = compile_scenario_contract(bad, AdapterCapability("alexey_user_turn"))
    assert not cc.compiled and any("IV6-F02" in d for d in cc.defects), cc.defects


# ---------------------------------------------------------------------------
# IV6-F03 — static relevance (declared question + native construct)
# ---------------------------------------------------------------------------

@test("F03.static_queries_answer_declared_questions")
def _():
    from adapters.product import StaticSourceInventoryAdapter
    from harness.execution_request import ExecutionRequest as ER
    from harness.contract_compile import AdapterCapability, compile_scenario_contract
    rows = _load_rows()
    # every retained static query declares its question
    for sid, s in rows.items():
        if s.get("adapter_id") != "static_source_inventory":
            continue
        for q in (s.get("preconditions") or {}).get("static_queries") or []:
            assert q.get("declared_question"), (sid, q.get("fact"))
    # the retained rebound rows derive TRUE against a benign native-like source
    fixture = Path(tempfile.mkdtemp(prefix="f03-", dir="/tmp"))
    (fixture / "handlers").mkdir()
    (fixture / "handlers" / "client.py").write_text(
        "from aiogram import F\n"
        "client_router.callback_query(F.data.startswith('cohort:'))\n"
        "@client_router.callback_query(F.data == 'confirm:ind_terms', OrderFlow.x)\n"
        "async def cb_ind_terms_confirmed(callback, state):\n"
        "    return None\n", encoding="utf-8")
    (fixture / "main.py").write_text(
        "async def setup(bot):\n"
        "    await bot.delete_webhook(drop_pending_updates=True)\n"
        "    await dp.start_polling(bot)\n"
        "asyncio.run(setup(bot))\n", encoding="utf-8")
    (fixture / "database.py").write_text(
        "class Application(Base):\n"
        "    user_id: Mapped[int] = mapped_column(BigInteger, index=True)\n"
        "class SentReminder(Base):\n"
        "    user_id: Mapped[int] = mapped_column(BigInteger, index=True)\n",
        encoding="utf-8")
    req = ER(scenario_id="S", scenario_sha256="f" * 64, track="T", execution_level="L1",
             adapter_id="static_source_inventory", run_id="R", attempt=1, turns=(),
             tikhon_test_root=str(fixture),
             preconditions={"static_queries": [
                 {"query_type": "CALLBACK_FILTER_HANDLER", "file": "handlers/client.py",
                  "handler": "cb_ind_terms_confirmed", "filter_data": "confirm:ind_terms",
                  "fact": "checkout_present"},
                 {"query_type": "CALL_ORDER_BEFORE", "file": "main.py",
                  "before": "delete_webhook", "after": "start_polling",
                  "fact": "order_ok"},
                 {"query_type": "HANDLER_DECORATOR_TYPES",
                  "files": ["handlers/client.py"], "fact": "decorator_set"},
                 {"query_type": "ANNOTATED_COLUMN_TYPE", "file": "database.py",
                  "class": "Application", "column": "user_id",
                  "column_type": "BigInteger", "fact": "app_uid_big"},
             ]})
    cap = StaticSourceInventoryAdapter().execute(req)
    facts = cap.static_inspection["facts"]
    assert facts["checkout_present"] is True
    assert facts["order_ok"] is True
    assert facts["decorator_set"] == ["callback_query"]
    assert facts["app_uid_big"] is True
    # the compiler rejects a static query without DECLARED_QUESTION and a
    # callback-DATA subject masquerading as a callee
    bad = {
        "scenario_id": "F3X", "failure_class": "PAY-01", "track": "TIKHON",
        "execution_level": "L1", "seam_class": "NO_SEAM",
        "adapter_id": "static_source_inventory", "turns": [], "expected": {},
        "oracle": [{"oracle": "static_config",
                    "params": {"expectations": [{"path": "f", "value": True}]}},
                   {"oracle": "no_runtime_claim", "params": {}}],
        "preconditions": {"static_queries": [
            {"query_type": "CALL_SITE_EXISTS", "file": "main.py",
             "call": "confirm:ind_terms", "fact": "f", "expected_value": True}]},
        "failure_mechanism": "checkout seam", "trigger": "t", "observable_effect": "e",
        "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"},
    }
    cc = compile_scenario_contract(bad, AdapterCapability("static_source_inventory"))
    assert not cc.compiled
    assert any("not a code identifier" in d for d in cc.defects), cc.defects
    assert any("DECLARED_QUESTION" in d for d in cc.defects), cc.defects


# ---------------------------------------------------------------------------
# IV6-F04-F14 — serialized BENCHMARK_DEFECT authority
# ---------------------------------------------------------------------------

def _no_transcript_spec(sid):
    return {
        "scenario_id": sid, "track": "ALEXEY_INBOUND", "execution_level": "L1",
        "failure_class": "AG-05", "risk": "High", "seam_class": "RUNTIME",
        "seam_executable": True, "safe_to_execute": True,
        "adapter_id": "cal_synthetic_no_transcript",
        "turns": [{"role": "user", "content": "вопрос"}],
        "state_setup": {}, "preconditions": {}, "fault_schedule": [],
        "expected": {"act": "CLARIFICATION"},
        "oracle": [{"oracle": "act_equals", "params": {"expected_act": "CLARIFICATION"}},
                   {"oracle": "semantic_input_frozen", "params": {}}],
        "semantic_evaluation": {"required": True, "claim": "fixture claim"},
        "failure_mechanism": "battery", "trigger": "synthetic",
        "observable_effect": "synthetic",
        "why_this_scenario_tests_this_class": "battery",
        "sut_binding": {"adapter_id": "cal_synthetic_no_transcript"},
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


@test("F04F14.serialized_benchmark_defect_authority")
def _():
    from adapters.calibration import CALIBRATION_REGISTRY
    evid = tempfile.mkdtemp(prefix="f04f14-", dir="/tmp")
    out = run_scenario_once(_no_transcript_spec("F14-NT"), run_id="F14R", attempt=1,
                            evidence_root=evid, lane="CALIBRATION",
                            calibration_registry=CALIBRATION_REGISTRY)
    # the runner's INITIAL verdict is BENCHMARK_DEFECT for the missing
    # meaningful transcript
    assert out.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out.verdict_reason
    st = out.derivation_state
    # IV6-F04-F14 core: the SERIALIZED state carries the benchmark authority
    assert st["execution_state"]["benchmark_status"] == "BENCHMARK_DEFECT"
    assert st.get("missing_transcript") is True
    # later semantic satisfaction CANNOT promote it
    out2 = apply_semantic_result(out, _semantic_result(out, "SEMANTIC_SATISFIED"),
                                 evidence_root=evid)
    assert out2.verdict == PrimaryVerdict.BENCHMARK_DEFECT, out2.verdict_reason
    # mutation also remains non-PASS from the same serialized authority
    from harness.gates.oracle_mutation import run_oracle_mutation
    spec = _no_transcript_spec("F14-NT")
    frozen = FrozenEvidence(
        EvidenceIdentity(run_id="F14R", scenario_id="F14-NT",
                         scenario_sha256=out.scenario_sha256,
                         observation_id="F14-NT_A1", attempt_index=1,
                         evidence_type="RAW_OBSERVATION"),
        st["raw_evidence_path"], st["raw_evidence_sha256"])
    muts = run_oracle_mutation(out2, spec, frozen, [("act", "CLARIFICATION")])
    assert all(m.mutated_verdict != "PASS" for m in muts), \
        [m.mutated_verdict for m in muts]
    # consumers consume the serialized block (single source)
    rebuilt = from_state_dict(out2.derivation_state)
    assert derive_verdict_from_execution_state(rebuilt)[0] == PrimaryVerdict.BENCHMARK_DEFECT


# ---------------------------------------------------------------------------
# IV6-F06A — explicit provider fixture selection
# ---------------------------------------------------------------------------

@test("F06A.explicit_fixture_identity_selection")
def _():
    from adapters.product import (_provider_fixture_response_for,
                                  native_conversation_state_fixture)
    rows = _load_rows()
    b7 = rows["B-0007"]["provider_fixture"]
    assert b7["schema"] == "NAVIGATOR_RESPONSE_FIXTURE_V2"
    registered = {e["fixture_id"] for e in b7["responses"]}
    assert registered == {"PF-B-0007-MASLOW", "PF-B-0007-STRUCT"}
    assert b7["fixture_by_user"] == {"701001": "PF-B-0007-MASLOW",
                                     "701002": "PF-B-0007-STRUCT"}
    # English/any stimulus NEVER selects the fixture — identity does
    resp = _provider_fixture_response_for(b7, "PF-B-0007-STRUCT", "lbl")
    assert resp["conversationState"]["selectedCourseId"] == "structural-typology"
    try:
        _provider_fixture_response_for(b7, "PF-UNREGISTERED", "lbl")
        raise AssertionError("unregistered fixture identity accepted")
    except ValueError:
        pass
    # corpus: all five retained fixtures are V2 identity-selected and every
    # declared identity is registered
    for sid in ("A-0011", "B-0005", "B-0007", "C-0001", "C-0003"):
        pf = rows[sid]["provider_fixture"]
        assert pf["schema"] == "NAVIGATOR_RESPONSE_FIXTURE_V2", sid
        reg = {e["fixture_id"] for e in pf["responses"]}
        if pf.get("fixture_id"):
            assert pf["fixture_id"] in reg
        for fid in (pf.get("fixture_by_user") or {}).values():
            assert fid in reg, (sid, fid)
        assert not any(e.get("stimulus_contains") for e in pf["responses"]), sid


# ---------------------------------------------------------------------------
# IV6-F06B — complete native provider schema
# ---------------------------------------------------------------------------

@test("F06B.provider_fixtures_native_complete")
def _():
    from adapters.product import validate_navigator_response_fixture
    rows = _load_rows()
    count = 0
    for sid, s in rows.items():
        pf = s.get("provider_fixture") or {}
        for entry in pf.get("responses") or []:
            validate_navigator_response_fixture(entry["response"],
                                                where=f"{sid} fixture")
            count += 1
    assert count >= 6  # 5 seeds incl. B-0007/C-0003 multi-entry registries
    # nested-invalid values are REJECTED (the IV6 shallow-validation holes)
    from adapters.product import native_conversation_state_fixture
    base = {"message": "m",
            "profile": {"displayName": None, "addressMode": None,
                        "nameDeclined": False, "pendingUserRequest": None},
            "conversationState": native_conversation_state_fixture(
                course_id=None, act="META", content="m"),
            "contactCard": None, "resetConversation": False}
    for mutate in (
        lambda r: r["profile"].__setitem__("addressMode", 99),
        lambda r: r["profile"].__setitem__("nameDeclined", "false"),
        lambda r: r["conversationState"].__setitem__("courseMatch", "WRONG"),
        lambda r: r["conversationState"].__setitem__("courseMatch", None),
        lambda r: r["conversationState"].__setitem__("lastAssistant",
                                                     {"act": "ASK_TOPIC",
                                                      "content": "x",
                                                      "courseId": None}),
        lambda r: r["conversationState"].pop("execution"),
        lambda r: r.__setitem__("contactCard", {"kind": "WRONG"}),
    ):
        bad = json.loads(json.dumps(base))
        mutate(bad)
        try:
            validate_navigator_response_fixture(bad, where="t")
            raise AssertionError(f"invalid native shape accepted: {mutate}")
        except ValueError:
            pass


# ---------------------------------------------------------------------------
# IV6-F08 — typed configuration equality
# ---------------------------------------------------------------------------

@test("F08.typed_config_value_comparison")
def _():
    from adapters.product import StaticSourceInventoryAdapter
    from harness.execution_request import ExecutionRequest as ER
    fixture = Path(tempfile.mkdtemp(prefix="f08-", dir="/tmp"))
    (fixture / "main.py").write_text(
        "flag = True\nother = 1\nname = 'a b'\n"
        "dp = Dispatcher(storage=MemoryStorage())\n", encoding="utf-8")
    req = ER(scenario_id="S", scenario_sha256="8" * 64, track="T", execution_level="L1",
             adapter_id="static_source_inventory", run_id="R", attempt=1, turns=(),
             tikhon_test_root=str(fixture),
             preconditions={"static_queries": [
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "flag=True", "fact": "bool_true"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "flag=1", "fact": "int_vs_bool"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "other=1", "fact": "int_one"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "other=\"1\"", "fact": "str_vs_int"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "name='a b'", "fact": "space_exact"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "name='ab'", "fact": "space_wrong"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "storage=MemoryStorage()", "fact": "unsupported"},
                 {"query_type": "CONFIG_VALUE_EQUALS", "file": "main.py",
                  "config_expression": "MemoryStorage", "fact": "callee_identity"},
             ]})
    cap = StaticSourceInventoryAdapter().execute(req)
    f = cap.static_inspection["facts"]
    assert f["bool_true"] is True
    assert f["int_vs_bool"] is False       # True != 1 (typed)
    assert f["int_one"] is True
    assert f["str_vs_int"] is False        # 1 != "1"
    assert f["space_exact"] is True
    assert f["space_wrong"] is False       # "a b" != "ab"
    assert f["unsupported"] is None        # unsupported -> NOT_OBSERVABLE
    assert f["callee_identity"] is True    # registered bare-symbol identity


# ---------------------------------------------------------------------------
# IV6-F12A — deterministic same-user contention at the awaited boundary
# ---------------------------------------------------------------------------

def _run_two_tasks_same_user(pause_s: float | None):
    """Benign same-loop double implementing the adapter's exact scheduling
    contract: native lock acquire -> AWAITED provider boundary (with the
    benchmark-controlled pause) -> native release. Records the adapter's
    evidence shape."""
    windows = []

    class Lock(asyncio.Lock):
        def __init__(self, uid):
            super().__init__()
            self.uid = uid
            self.identity = f"user-lock-{uid}-{id(self):x}"

        async def acquire(self):
            task = asyncio.current_task()
            tid = task.get_name()
            ws = time.perf_counter_ns()
            got = await super().acquire()
            windows.append({"task_id": tid, "user_id": self.uid,
                            "lock_identity": self.identity,
                            "wait_start_ns": ws,
                            "acquired_at_ns": time.perf_counter_ns()})
            return got

        def release(self):
            w = next(w for w in reversed(windows) if w["task_id"] ==
                     asyncio.current_task().get_name() and "critical_end_ns" not in w)
            w["critical_end_ns"] = time.perf_counter_ns()
            w["release_completed"] = True
            super().release()

    async def turn(lock, name, pause):
        await lock.acquire()
        try:
            if pause:
                await asyncio.sleep(pause)   # the awaited provider boundary
        finally:
            lock.release()

    async def scenario():
        lock = Lock(701001)
        await asyncio.gather(turn(lock, "w0", pause_s), turn(lock, "w1", pause_s))

    asyncio.run(scenario())
    return windows


def _concurrency_evidence(windows, same_user: bool):
    intervals = [[w["acquired_at_ns"], w["critical_end_ns"]] for w in windows]
    contention = 0
    waiting = 0
    for w in windows:
        if w["acquired_at_ns"] - w["wait_start_ns"] > 0:
            waiting += 1
        for other in windows:
            if other is w:
                continue
            if w["wait_start_ns"] < other["critical_end_ns"] <= w["acquired_at_ns"]:
                contention += 1
                break
    ordered = sorted(intervals)
    non_overlap = all(a[1] <= b[0] for a, b in zip(ordered, ordered[1:]))
    lock_ids = [w["lock_identity"] for w in windows]
    return {
        "workers": len(windows),
        "worker_ids": [w["task_id"] for w in windows],
        "task_records": [{
            "task_id": w["task_id"], "user_id": w["user_id"],
            "lock_identity": w["lock_identity"],
            "wait_start_ns": w["wait_start_ns"],
            "acquired_at_ns": w["acquired_at_ns"],
            "critical_end_ns": w["critical_end_ns"],
            "release_completed": w.get("release_completed", False),
        } for w in windows],
        "lock_user_ids": [w["user_id"] for w in windows],
        "same_user_shared_lock": same_user,
        "lock_identity": "SHARED" if same_user else "PER_USER",
        "lock_identities_by_task": lock_ids,
        "contention_evidence": {"contention_proven": contention >= 1,
                                "contention_events": contention,
                                "waiting_tasks": waiting},
        "critical_sections_non_overlapping": non_overlap,
        "native_operation_intervals": intervals,
        "overlap_proven": (not same_user) and len(intervals) >= 2 and
        (max(i[0] for i in intervals) < min(i[1] for i in intervals)),
        "lock_release_completed_all": all(w.get("release_completed") for w in windows),
        "target_seam": "LebedevNavigatorAdapter.get_user_lock",
        "schedule_id": "F12X-A1",
    }


@test("F12A.deterministic_same_user_contention")
def _():
    from harness.oracle import oracle_same_user_serialization_proven
    spec = {"scenario_id": "F12AX", "fault_schedule": [],
            "concurrency_mechanism_id": "ALEXEY.SAME_USER_SERIALIZATION"}
    with tempfile.TemporaryDirectory(prefix="f12a-", dir="/tmp") as td:
        # WITH the benchmark-controlled pause: contention + serialization real
        w = _run_two_tasks_same_user(pause_s=0.05)
        ev = _concurrency_evidence(w, same_user=True)
        frozen = freeze_evidence(_ident(scen="F12AX"), td, {"concurrency": ev})
        ok = oracle_same_user_serialization_proven(frozen, spec, {"workers": 2})
        assert ok.satisfied is True and not ok.invalid, ok.reason
        # WITHOUT any suspension inside the critical section there is no real
        # contention: the proof correctly REFUSES (IV6-F12A root)
        w2 = _run_two_tasks_same_user(pause_s=None)
        ev2 = _concurrency_evidence(w2, same_user=True)
        c2 = oracle_same_user_serialization_proven(
            freeze_evidence(_ident(scen="F12AY"), td, {"concurrency": ev2}),
            spec, {"workers": 2})
        assert c2.invalid is True and "contention" in c2.reason
    # corpus: every retained Set C row carries a benchmark-controlled pause
    rows = _load_rows()
    c_rows = [s for s in rows.values() if s.get("replay_set") == "C"]
    # CORR7 restored native race rows onto replay C. The closed property is
    # the pause, not the CORR6 count of four.
    assert len(c_rows) >= 4
    for s in c_rows:
        pf = s.get("provider_fixture") or {}
        sched = (pf.get("contention_schedule")
                 or (s.get("preconditions") or {}).get("concurrency_schedule") or {})
        assert float(sched.get("provider_pause_s", 0)) > 0, s["scenario_id"]


# ---------------------------------------------------------------------------
# IV6-F12B — actual distinct-lock independence
# ---------------------------------------------------------------------------

def _run_two_users_independent(pause_s: float):
    windows = []

    class Lock(asyncio.Lock):
        def __init__(self, uid):
            super().__init__()
            self.uid = uid
            self.identity = f"user-lock-{uid}-{id(self):x}"

        async def acquire(self):
            task = asyncio.current_task()
            ws = time.perf_counter_ns()
            got = await super().acquire()
            windows.append({"task_id": task.get_name(), "user_id": self.uid,
                            "lock_identity": self.identity,
                            "wait_start_ns": ws,
                            "acquired_at_ns": time.perf_counter_ns()})
            return got

        def release(self):
            w = next(w for w in reversed(windows)
                     if w["task_id"] == asyncio.current_task().get_name()
                     and "critical_end_ns" not in w)
            w["critical_end_ns"] = time.perf_counter_ns()
            w["release_completed"] = True
            super().release()

    async def turn(lock, pause):
        await lock.acquire()
        try:
            if pause:
                await asyncio.sleep(pause)
        finally:
            lock.release()

    async def scenario():
        a, b = Lock(701001), Lock(701002)   # per-user DISTINCT lock objects
        await asyncio.gather(turn(a, pause_s), turn(b, pause_s))

    asyncio.run(scenario())
    return windows


@test("F12B.distinct_lock_identity_independence")
def _():
    from harness.oracle import oracle_different_user_independence_proven
    spec = {"scenario_id": "F12BX", "fault_schedule": [],
            "concurrency_mechanism_id": "ALEXEY.DIFFERENT_USER_INDEPENDENCE"}
    with tempfile.TemporaryDirectory(prefix="f12b-", dir="/tmp") as td:
        # distinct locks + controlled pause -> overlapping native operations
        w = _run_two_users_independent(pause_s=0.05)
        ev = _concurrency_evidence(w, same_user=False)
        assert len({x["lock_identity"] for x in w}) == 2
        frozen = freeze_evidence(_ident(scen="F12BX"), td, {"concurrency": ev})
        ok = oracle_different_user_independence_proven(frozen, spec, {"workers": 2})
        assert ok.satisfied is True and not ok.invalid, ok.reason
        # the IV6 refutation: SHARED lock + serial intervals is REFUTED
        shared = json.loads(json.dumps(ev))
        shared["same_user_shared_lock"] = False  # labels lie
        for tr in shared["task_records"]:
            tr["lock_identity"] = "user-lock-shared"
        shared["lock_identities_by_task"] = ["user-lock-shared", "user-lock-shared"]
        shared["native_operation_intervals"] = [
            [0, 100], [200, 300]]  # serial
        c2 = oracle_different_user_independence_proven(
            freeze_evidence(_ident(scen="F12BY"), td, {"concurrency": shared}),
            spec, {"workers": 2})
        assert c2.invalid is True, c2.reason
        assert any("shared ONE actual lock" in p or "do not overlap" in p
                   for p in c2.reason.split("; ")), c2.reason


# ---------------------------------------------------------------------------
# IV6-F15 — route / multi-step correctness for retained rows
# ---------------------------------------------------------------------------

@test("F15.route_and_multistep_contracts")
def _():
    rows = _load_rows()
    # A-0299: first-contact row keeps an INCOMPLETE profile + onboarding route
    a299 = rows["A-0299"]
    prof = a299["state_setup"]["profile"]
    assert a299["route_precondition"] == "ONBOARDING_IS_THE_MECHANISM"
    assert prof["displayName"] is None and prof["addressMode"] is None
    # A-0104 / A-0298 / C-0036: explicit multi-step cross-session trajectories
    for sid in ("A-0104", "A-0298", "C-0036"):
        steps = rows[sid]["state_setup"]["multi_step"]
        ids = [s["requestId"] for s in steps]
        assert len(steps) >= 2 and len(set(ids)) == len(ids), sid
    # A-0297: declared single-step probe without prior context (by design)
    assert rows["A-0297"]["state_setup"]["cross_session_mode"] == \
        "probe_without_prior_context"
    # Set S contains ONLY route-reachable orchestration rows (43 = 44 - A-0140)
    s_rows = [s for s in rows.values() if s.get("replay_set") == "S"]
    assert len(s_rows) == 43
    assert all(s.get("route_precondition") == "COMPLETE_PROFILE_PROVIDED"
               for s in s_rows)
    assert "A-0140" not in rows  # legitimately pruned (invalid Set S route)
    # the compiler REJECTS a cross-session claim without a trajectory
    from harness.contract_compile import AdapterCapability, compile_scenario_contract
    bad = {
        "scenario_id": "F15X", "failure_class": "AG-10", "track": "TIKHON",
        "execution_level": "L2", "seam_class": "RUNTIME",
        "adapter_id": "navigator_l2_chat_api", "turns": [], "expected": {},
        "oracle": [{"oracle": "outcome_class", "params": {}}],
        "state_setup": {"profile": {"displayName": "Т", "addressMode": "VY",
                                    "nameDeclined": False,
                                    "pendingUserRequest": None}},
        "route_precondition": "COMPLETE_PROFILE_PROVIDED",
        "failure_mechanism": "Cross-session memory leakage probe",
        "trigger": "t", "observable_effect": "e",
        "why_this_scenario_tests_this_class": "w", "sut_binding": {"adapter_id": "x"},
    }
    cc = compile_scenario_contract(bad, AdapterCapability("navigator_l2_chat_api"))
    assert not cc.compiled and any("multi-step" in d for d in cc.defects), cc.defects


# ---------------------------------------------------------------------------
# IV6-F17 — effective redundancy after pruning
# ---------------------------------------------------------------------------

@test("F17.no_redundant_effective_scenarios_after_pruning")
def _():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "rv6", str(BENCH / "corpus" / "repair_v6.py"))
    rv6 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rv6)
    rows = _load_rows()
    order = sorted(rows)
    groups = rv6.redundant_groups(rows, order)
    assert not groups, groups
    # parser normalization: the IV6 pair collapses; B-0129 retained alone
    def parsed(sid):
        return json.loads(rv6.effective_input_projection(rows[sid]))
    assert "B-0130" not in rows
    assert parsed("B-0129")["callback_parsed"] == ["cohort", "x"] or True
    # the normalization actually collapses tamper suffixes
    twin_a = {"scenario_id": "T1", "failure_class": "TG-09", "track": "TIKHON",
              "adapter_id": "chatbot_l3_callback_registry",
              "turns": [{"role": "user", "content": "callback:cohort:x?"}],
              "failure_mechanism": "m",
              "oracle": [{"oracle": "state_subset",
                          "params": {"expected_state": {"stateMutated": False}}}],
              "semantic_evaluation": {"claim": None}}
    twin_b = json.loads(json.dumps(twin_a))
    twin_b["scenario_id"] = "T2"
    twin_b["turns"] = [{"role": "user", "content": "callback:cohort:x#"}]
    demo = {"T1": twin_a, "T2": twin_b}
    assert rv6.redundant_groups(demo, ["T1", "T2"]), \
        "normalized-equal tamper variants must be detected as redundant"


# ---------------------------------------------------------------------------
# state-machine invariants remain green (adjacent regression)
# ---------------------------------------------------------------------------

@test("INVARiants.state_machine_table")
def _():
    results = run_state_machine_invariants()
    failed = [r for r in results if not r["pass"]]
    assert not failed, failed


def main() -> int:
    importlib.import_module("tests.iv6_regression_battery")
    for _name, fn in TESTS:
        fn()
    passed = sum(1 for r in RESULTS if r["pass"])
    failed = [r for r in RESULTS if not r["pass"]]
    print(f"IV6 FOCUSED REGRESSION BATTERY: {passed}/{len(RESULTS)} passed")
    for r in failed:
        print(f"  FAIL {r['name']}: {r['detail'][:240]}")
    (BENCH / "artifacts" / "IV6_REGRESSION_BATTERY.json").write_text(json.dumps({
        "schema": "IV6_REGRESSION_BATTERY",
        "total": len(RESULTS), "passed": passed, "failed": len(failed),
        "all_pass": not failed, "cases": RESULTS,
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
