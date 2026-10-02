"""CORR7 focused closure battery for IV7-F01 through IV7-F08.

Local fixtures and source analysis only. No product execution, no
TEST_BASE binding, no network, and no git mutation.
"""

from __future__ import annotations

import ast
import copy
import json
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import patch

BENCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BENCH))
sys.path.insert(0, str(BENCH / "corpus"))

import repair_v7 as v7  # noqa: E402
from adapters.product import (  # noqa: E402
    AlexeyUserTurnAdapter,
    NavigatorL2ChatAdapter,
    StaticSourceInventoryAdapter,
    _call_order_before,
    _callback_filter_handler_present,
    collect_rag_diagnostics,
    validate_navigator_response_fixture,
)
from harness.contract_compile import compile_corpus, compile_retention_claim  # noqa: E402
from harness.evidence import EvidenceIdentity, field_evidence_ref, freeze_evidence  # noqa: E402
from harness.execution_request import build_execution_request  # noqa: E402
from harness.oracle import (  # noqa: E402
    oracle_different_user_independence_proven,
    oracle_prohibited_output,
    oracle_same_user_serialization_proven,
)
from harness.seams.sut_binding import validate_byte_state_manifest  # noqa: E402

RESULTS: list[dict] = []
TESTS: list = []
CHATBOT = Path("/Users/entp_psyche/Desktop/InvestProjects2026/chatbot")
LOST_23 = [
    "TG07_LOCAL_DELIVERY_ORDER", "TG19_SESSION_DEFAULT_MISMATCH",
    "TG20_REPLY_LATENCY_RANGES", "AG11_PROFILE_NAME_FORGETTING",
    "TG18_THREE_TASK_SERIALIZATION", "ST16_SWITCH_PAYMENT_RACE",
    "ST04_PROFILE_COURSE_WRITE_RACE", "ST03_NONCOMMAND_HELP_NAME_CAPTURE",
    "TG15_SECRET_TOKEN_INVENTORY", "TG16_REPLAY_BUFFER_INVENTORY",
    "TG04_WEBHOOK_ROUTER_REGISTRATION", "TG05_DISCARD_CONFIG_OVERRIDE",
    "TG05_RESTART_DISCARD_POSTURE", "TG06_CROSS_RUN_PERSISTENCE",
    "TG14_SQLITE_PERSISTED_ID_WIDTH", "TG14_JSON_INT_WRITER_ROUNDTRIP",
    "TG14_NAVIGATOR_ID_ABSENCE", "ST05_RESET_STALE_REFERENCE_RACE",
    "TG06_REMINDER_ROUTER_REGISTRATION", "TG14_USER_ID_INDEXES",
    "ST18_INCOMING_STATE_RETENTION", "AG14_PARALLEL_COURSE_COMMITS",
    "ST18_HANDOFF_CONTEXT_ISOLATION",
]
IV7_STATIC_GROUPS = [
    ["B-0271", "B-0272"], ["B-0273", "B-0274"], ["B-0275", "B-0276"],
    ["B-0277", "B-0278"], ["B-0279", "B-0280"], ["B-0281", "B-0282"],
    ["B-0286", "B-0292", "B-0298"],
]


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


def _rows(path: Path) -> dict[str, dict]:
    rows = {}
    with open(path) as fh:
        for line in fh:
            if line.strip():
                row = json.loads(line)
                rows[row["scenario_id"]] = row
    return rows


def _registry() -> dict:
    return json.loads((BENCH / "artifacts" / "ADAPTER_REGISTRY.json").read_text())


def _request(spec: dict, root: str, env: dict | None = None,
             navigator_root: str | None = None):
    return build_execution_request(
        spec, adapter_id=spec["adapter_id"], run_id="CORR7", attempt=1,
        scenario_sha256="a" * 64,
        navigator_test_root=root if navigator_root is None else navigator_root,
        tikhon_test_root=root,
        execution_environment=env or {})


def _compile_one(spec: dict) -> dict:
    compiled = compile_corpus({spec["scenario_id"]: spec}, _registry())
    return compiled["contracts"][0]


# ---------------------------------------------------------------------------
# F01 — obligation retention and exact 924
# ---------------------------------------------------------------------------

@test("F01.exact_924_and_23_obligations")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    source = _rows(BENCH / "corpus" / "corr5_input_996.jsonl")
    plan = json.loads((BENCH / "corpus" / "CORPUS_PRUNING_PLAN_996_TO_924_V2.json").read_text())
    assert len(source) == 996
    assert len(rows) == 924
    assert plan["REMOVED_COUNT"] == 72
    assert plan["FINAL_COUNT"] == 924
    assert len(plan["removals"]) == 72
    assert plan["UNIQUE_REQUIRED_MECHANISM_LOSS"] == 0
    assert plan["MATERIAL_MEASUREMENT_CLASS_LOSS"] == 0
    removed = {item["REMOVED_ID"] for item in plan["removals"]}
    assert removed == set(source) - set(rows)
    for item in plan["removals"]:
        assert item["SEMANTIC_EQUIVALENCE"] == "YES"
        assert item["MATERIAL_CAUSAL_CONDITION_PRESERVED"] == "YES"
        assert item["MATERIAL_STATE_DISTINCTION_PRESERVED"] == "YES"
        assert item["MANDATORY_SEED"] == "NO"
        assert item["UNIQUE_REQUIRED_OBLIGATION_LOST"] == "NO"
        assert item["MATERIAL_MEASUREMENT_CLASS_LOST"] == "NO"
        nearest = rows[item["NEAREST_RETAINED_EQUIVALENT"]]
        assert v7.obligation_id(source[item["REMOVED_ID"]]) == item["SEMANTIC_OBLIGATION_ID"] \
            or item["SEMANTIC_OBLIGATION_ID"].startswith("L4_FUTURE_SIBLING:")
        if not item["SEMANTIC_OBLIGATION_ID"].startswith("L4_FUTURE_SIBLING:"):
            assert v7.obligation_id(nearest) == item["SEMANTIC_OBLIGATION_ID"]
    present = {v7.obligation_id(row) for row in rows.values()}
    for oid in LOST_23:
        assert oid in present, oid
        assert any(sid in rows for sid in v7.IV7_OBLIGATIONS[oid])
    for key, label in v7.MATERIAL_CLASSES.items():
        failure, adapter = key.split("|")
        assert any(row.get("failure_class") == failure and row.get("adapter_id") == adapter
                   for row in rows.values()), label
    assert rows["A-0115"]["adapter_id"] == "alexey_user_turn"
    assert rows["A-0116"]["adapter_id"] == "alexey_user_turn"
    assert rows["A-0117"]["adapter_id"] == "alexey_user_turn"
    seeds = [sid for sid in v7.v6.SEED_IDS if sid in rows]
    assert len(seeds) == 30
    assert sum(1 for row in rows.values() if row.get("replay_set") == "S") == 43
    assert "A-0140" not in rows


# ---------------------------------------------------------------------------
# F02 — static measurement meaning
# ---------------------------------------------------------------------------

@test("F02.execution_order_and_callback_binding")
def _():
    uninvoked = ast.parse(
        "def unused():\n"
        "    delete_webhook()\n"
        "def run():\n"
        "    start_polling()\n"
        "    delete_webhook()\n"
        "run()\n")
    assert _call_order_before(uninvoked, "delete_webhook", "start_polling") is False
    executed = ast.parse(
        "async def main():\n"
        "    delete_webhook()\n"
        "    start_polling()\n"
        "import asyncio\n"
        "asyncio.run(main())\n")
    assert _call_order_before(executed, "delete_webhook", "start_polling") is True
    foreign = ast.parse(
        '@router.callback_query(other.data == "confirm:ind_terms")\n'
        "async def cb_ind_terms_confirmed():\n"
        "    pass\n")
    assert _callback_filter_handler_present(
        foreign, "cb_ind_terms_confirmed", "confirm:ind_terms") is False
    native = ast.parse(
        '@router.callback_query(F.data == "confirm:ind_terms")\n'
        "async def cb_ind_terms_confirmed():\n"
        "    pass\n")
    assert _callback_filter_handler_present(
        native, "cb_ind_terms_confirmed", "confirm:ind_terms") is True
    wrong_handler = ast.parse(
        '@router.callback_query(F.data == "confirm:ind_terms")\n'
        "async def other_handler():\n"
        "    pass\n")
    assert _callback_filter_handler_present(
        wrong_handler, "cb_ind_terms_confirmed", "confirm:ind_terms") is False
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = str(CHATBOT)
    for sid in ("B-0024", "B-0041", "B-0042", "B-0043", "B-0187", "B-0030"):
        capture = StaticSourceInventoryAdapter().execute(_request(rows[sid], root))
        assert not capture.capture_error, capture.capture_error
        facts = capture.static_inspection["facts"]
        for query in rows[sid]["preconditions"]["static_queries"]:
            assert facts[query["fact"]] == query["expected_value"], (sid, query["fact"], facts)
    resolved = rows["B-0030"]["preconditions"]["static_queries"][0]["expected_value"]
    assert resolved == ["callback_query", "message", "my_chat_member"]
    assert rows["B-0030"]["preconditions"]["static_queries"][0]["query_type"] == "RESOLVED_POLLING_UPDATES"


# ---------------------------------------------------------------------------
# F03 — exact IV7 invalid semantic fixtures
# ---------------------------------------------------------------------------

def _static_edit(spec, edit):
    edit(spec["preconditions"]["static_queries"][0])


@test("F03.iv7_invalid_fixtures_rejected")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")

    def accept(name, sid, edit, expected):
        spec = copy.deepcopy(rows[sid])
        edit(spec)
        contract = _compile_one(spec)
        assert contract["compiled"] is expected, (name, contract["defects"][:3])

    accept("flat_state", "A-0011", lambda s: (
        s["expected"].update(state={"selectedCourseId": "maslow"}),
        next(o for o in s["oracle"] if o["oracle"] == "concurrency_invariant")["params"].update(
            expected_state={"selectedCourseId": "maslow"})), False)
    accept("correct_user_state", "A-0011", lambda s: None, True)
    accept("static_wrong_scope", "B-0033",
           lambda s: _static_edit(s, lambda q: q.update({"class": "UnrelatedClass"})),
           False)
    accept("static_wrong_symbol", "B-0041",
           lambda s: _static_edit(s, lambda q: q.update(handler="unrelated_handler")), False)
    accept("static_wrong_syntax_class", "B-0041", lambda s: _static_edit(s, lambda q: (
        q.clear(), q.update(query_type="IMPORT_EXISTS", file="main.py", module="asyncio",
                            fact="checkout_confirm_handler_present",
                            declared_question="is the native confirm:ind_terms callback handler registered?"))),
           False)
    accept("callback_data_as_callee", "B-0041", lambda s: _static_edit(s, lambda q: (
        q.clear(), q.update(query_type="CALL_SITE_EXISTS", file="handlers/client.py",
                            call="confirm:ind_terms", fact="checkout_confirm_handler_present",
                            declared_question="checkout registered?"))), False)
    accept("missing_declared_question_new_typed", "B-0041",
           lambda s: _static_edit(s, lambda q: q.pop("declared_question", None)), False)
    accept("missing_declared_question_old_symbol", "B-0006",
           lambda s: _static_edit(s, lambda q: q.pop("declared_question", None)), False)
    accept("unrelated_true_fact", "B-0041", lambda s: _static_edit(s, lambda q: (
        q.clear(), q.update(query_type="IMPORT_EXISTS", file="main.py", module="asyncio",
                            fact="checkout_confirm_handler_present",
                            declared_question="is checkout callback registered?"))), False)
    accept("unknown_provider_id", "B-0007",
           lambda s: s["provider_fixture"]["fixture_by_user"].update({"701001": "UNKNOWN"}), False)
    accept("invalid_provider_shape_missing_key", "B-0005",
           lambda s: s["provider_fixture"]["responses"][0]["response"]["conversationState"].pop("execution"),
           False)
    accept("invalid_provider_shape_nested_quality", "B-0005",
           lambda s: s["provider_fixture"]["responses"][0]["response"]["conversationState"].update(
               qualitySignals=["bad"]), False)
    accept("missing_concurrency_schedule", "A-0011",
           lambda s: s["provider_fixture"].pop("contention_schedule"), False)
    accept("different_user_wrong_proof", "B-0007",
           lambda s: s["oracle"][0].update(oracle="same_user_serialization_proven"), False)
    accept("missing_cross_session_steps", "A-0104",
           lambda s: s["state_setup"].pop("multi_step"), False)
    accept("S_unreachable_handoff", "A-0008",
           lambda s: s.update(turns=[{"role": "user", "content": "Позовите менеджера, я по оплате Маслоу"}]),
           False)
    accept("complete_profile_onboarding", "A-0299",
           lambda s: s["state_setup"]["profile"].update(displayName="Тест", addressMode="VY"), False)
    substituted = copy.deepcopy(rows["B-0030"])
    substituted["failure_mechanism"] = (
        "allowed_updates resolution must include every registered update type")
    substituted["preconditions"]["static_queries"] = [{
        "query_type": "HANDLER_DECORATOR_TYPES",
        "files": ["handlers/client.py", "handlers/operator.py"],
        "fact": "allowed_updates_resolved_set",
        "declared_question": "which decorators appear in two files?",
        "expected_value": ["message"],
    }]
    assert _compile_one(substituted)["compiled"] is False
    shared = copy.deepcopy(rows["B-0007"])
    shared["provider_fixture"].pop("fixture_by_user", None)
    shared["provider_fixture"].pop("fixture_by_worker", None)
    shared["provider_fixture"]["fixture_id"] = shared["provider_fixture"]["responses"][0]["fixture_id"]
    assert _compile_one(shared)["compiled"] is False
    bad_claim = {
        "REMOVED_ID": "B-0272", "NEAREST_RETAINED_EQUIVALENT": "B-0271",
        "SEMANTIC_EQUIVALENCE": "YES", "MANDATORY_SEED": "NO",
        "UNIQUE_REQUIRED_OBLIGATION_LOST": "NO",
        "MATERIAL_CAUSAL_CONDITION_PRESERVED": "YES",
        "MATERIAL_STATE_DISTINCTION_PRESERVED": "YES",
        "_computed_obligation_id": "OBLIGATION-A",
        "_retained_obligation_id": "OBLIGATION-B",
        "_computed_unique_loss": False,
    }
    assert compile_retention_claim(
        {"scenario_id": "B-0272"}, {"scenario_id": "B-0271"}, bad_claim)
    full = compile_corpus(rows, _registry())
    assert full["compiled_ok"] == 924


# ---------------------------------------------------------------------------
# F04 / F05 — operation-local fixtures and identity closure
# ---------------------------------------------------------------------------

class _Store:
    def __init__(self, **_kw):
        self.states = {}
        self.history = {}

    def save_session(self, uid, profile, state):
        self.states[uid] = (copy.deepcopy(profile), copy.deepcopy(state))

    def get_session(self, uid):
        return self.states.get(uid, ({}, {}))

    def append_message(self, uid, role, text):
        self.history.setdefault(uid, []).append({"role": role, "content": text})


class _History:
    def __init__(self, **_kw):
        return None


class _Proto:
    def __init__(self, session_store, **_kw):
        self.store = session_store
        self.user_locks = {}

    def get_user_lock(self, uid):
        return self.user_locks[uid]

    async def call_navigator_core(self, *_a, **_k):
        raise AssertionError("fixture did not replace the provider")

    async def process_user_turn(self, uid, text, mid):
        async with self.get_user_lock(uid):
            if text == "/reset":
                self.store.save_session(uid, {}, {})
                text = "Здравствуйте"
            profile, state = self.store.get_session(uid)
            res = await self.call_navigator_core(
                [{"role": "user", "content": text}], profile, state, str(mid))
            saved = {} if res["resetConversation"] else res["conversationState"]
            self.store.save_session(uid, res["profile"], saved)
            return [res["message"]]


def _loader(_root, _pkg, module):
    modules = {
        "lebedev_adapter": types.SimpleNamespace(LebedevNavigatorAdapter=_Proto),
        "session_store": types.SimpleNamespace(TelegramSessionStore=_Store),
        "outreach": types.SimpleNamespace(OutreachHistoryManager=_History),
    }
    return modules[module], None


def _freeze(root: Path, payload: dict, name: str):
    identity = EvidenceIdentity("CORR7", name, "a" * 64, name + "-O1", 1, "RAW_OBSERVATION")
    return freeze_evidence(identity, str(root), payload)


def _run_alexey(spec: dict, root: Path):
    with patch("adapters.product._load_package_module", _loader):
        return AlexeyUserTurnAdapter().execute(_request(spec, str(root)))


def _course(state: dict, user: str) -> object:
    return (state.get(user) or {}).get("selectedCourseId")


@test("F04.operation_local_provider_identity")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = Path(tempfile.mkdtemp(prefix="corr7-f04-"))
    b7 = _run_alexey(rows["B-0007"], root)
    assert not b7.capture_error, b7.capture_error
    state = b7.values["state"]
    assert _course(state, "701001") == "maslow"
    assert _course(state, "701002") == "structural-typology"
    c3 = _run_alexey(rows["C-0003"], root)
    assert not c3.capture_error, c3.capture_error
    state = c3.values["state"]
    assert _course(state, "703001") is None
    assert _course(state, "703002") == "structural-typology"
    assert "current_fixture_id" not in (BENCH / "adapters" / "product.py").read_text()


@test("F05.task_user_identity_closure")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = Path(tempfile.mkdtemp(prefix="corr7-f05-"))
    for sid, oracle in (("B-0007", oracle_different_user_independence_proven),
                        ("C-0003", oracle_different_user_independence_proven),
                        ("A-0011", oracle_same_user_serialization_proven),
                        ("C-0005", oracle_same_user_serialization_proven)):
        capture = _run_alexey(rows[sid], root)
        assert not capture.capture_error, (sid, capture.capture_error)
        frozen = _freeze(root, {"concurrency": capture.concurrency}, "valid-" + sid)
        check = oracle(frozen, rows[sid], rows[sid]["oracle"][0]["params"])
        assert check.satisfied is True, (sid, check.reason)
    capture = _run_alexey(rows["B-0007"], root)
    mismatched = copy.deepcopy(capture.concurrency)
    for index, record in enumerate(mismatched.get("task_records") or []):
        record["task_id"] = f"unrelated-task-{index}"
        record["user_id"] = 99000 + index
    frozen = _freeze(root, {"concurrency": mismatched}, "mismatched")
    refused = oracle_different_user_independence_proven(
        frozen, rows["B-0007"], rows["B-0007"]["oracle"][0]["params"])
    assert refused.satisfied is not True
    assert refused.invalid is True


# ---------------------------------------------------------------------------
# F06 / F07 — trajectory markers and multi-step status
# ---------------------------------------------------------------------------

def _output_evidence(root: Path, spec: dict, message: str, label: str):
    identity = EvidenceIdentity("CORR7", spec["scenario_id"], "a" * 64,
                                spec["scenario_id"] + "-" + label, 1, "RAW_OBSERVATION")
    payload = {"lane": "CALIBRATION", "actual": {"output": {
        "value": message, "provenance": "SYNTHETIC_CALIBRATION",
        "evidence_ref": field_evidence_ref(identity, "output", message)}}}
    return freeze_evidence(identity, str(root), payload)


@test("F06.cross_session_markers_match_introduced_facts")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = Path(tempfile.mkdtemp(prefix="corr7-f06-"))
    authorized_surfaces = {
        "Структурную типологию": "Структурная типология",
        "Иерархию уровней сознания": "Иерархия уровней сознания",
    }
    for sid, hit, miss in (
            ("A-0298", "Покупка оформлена: Структурная типология",
             "У меня нет сведений о ваших покупках."),
            ("C-0036", "КлиентX", "CLIENT-X")):
        spec = rows[sid]
        steps = spec["state_setup"]["multi_step"]
        intro = "\n".join(message["content"] for step in steps[:-1] for message in step["messages"])
        markers = next(o["params"]["prohibited"] for o in spec["oracle"]
                       if o["oracle"] == "prohibited_output")
        assert markers == spec["expected"]["prohibited_output"]
        for marker in markers:
            if sid == "A-0298" and marker in authorized_surfaces:
                assert authorized_surfaces[marker] in intro
                assert marker not in intro
            else:
                assert marker in intro
        params = next(o["params"] for o in spec["oracle"] if o["oracle"] == "prohibited_output")
        leaked = oracle_prohibited_output(
            _output_evidence(root, spec, hit, "hit"), spec, params)
        clean = oracle_prohibited_output(
            _output_evidence(root, spec, miss, "miss"), spec, params)
        assert leaked.satisfied is False
        assert clean.satisfied is True
        if sid == "A-0298":
            assert markers == [
                "Структурная типология", "Структурную типологию",
                "Иерархия уровней сознания", "Иерархию уровней сознания",
            ]
            assert "alpha" not in markers and "beta" not in markers
            assert all(not marker.startswith("Хочу курс") for marker in markers)
            for step in steps[:-1]:
                assert step["profile"]["displayName"] is not None
                assert step["profile"]["addressMode"] is not None
                assert step["introduced_facts"]
            for label, text in (
                    ("iv8-structural", "Вы покупали Структурную типологию личности."),
                    ("iv8-consciousness", "Вы покупали Иерархию уровней сознания.")):
                disclosure = oracle_prohibited_output(
                    _output_evidence(root, spec, text, label), spec, params)
                assert disclosure.satisfied is False, text
            pre_corr1 = dict(params)
            pre_corr1["prohibited"] = ["Структурная типология", "Иерархия уровней сознания"]
            accepted_by_old_surface = oracle_prohibited_output(
                _output_evidence(root, spec, "Вы покупали Структурную типологию личности.",
                                 "pre-corr1-structural"),
                spec, pre_corr1)
            assert accepted_by_old_surface.satisfied is True
    assert rows["A-0298"]["turns"][0]["content"] == "Что я покупал в прошлый раз?"
    assert rows["C-0036"]["turns"][0]["content"] == "Хочу оплатить Маслоу"


class _ChatFixture(NavigatorL2ChatAdapter):
    def __init__(self, statuses):
        self.statuses = statuses
        self.calls = []

    def _chat_call(self, base, body):
        index = len(self.calls)
        self.calls.append(body)
        status = self.statuses[index]
        if status == 200:
            response = {"message": "ordinary final answer", "profile": body["profile"]}
        else:
            response = {"error": {"code": "NAVIGATOR_TECHNICAL_ERROR",
                                  "message": "ordinary failure"}}
        return status, response, None


@test("F07.failed_causal_step_is_not_clean")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = Path(tempfile.mkdtemp(prefix="corr7-f07-"))
    env = {"navigator_l2_base_url": "http://127.0.0.1:9"}
    with patch("adapters.product.collect_rag_diagnostics", lambda env, header: {}):
        for statuses, clean in (([500, 200], False), ([200, 503], False), ([200, 200], True)):
            capture = _ChatFixture(statuses).execute(_request(rows["A-0104"], str(root), env))
            state = capture.values["state"]
            assert state["stepStatuses"] == statuses
            assert state["causalChainComplete"] is clean
            if clean:
                assert capture.outcome_class == "CLEAN"
                assert state["failedStepIndex"] is None
            else:
                assert capture.outcome_class != "CLEAN"
                assert state["failedStepIndex"] == statuses.index(next(s for s in statuses if s != 200)) + 1
                assert state["failedRequestId"]


# ---------------------------------------------------------------------------
# F08 — effective static fingerprint
# ---------------------------------------------------------------------------

@test("F08.iv7_static_groups_collapse_and_final_excess_is_zero")
def _():
    source = _rows(BENCH / "corpus" / "corr5_input_996.jsonl")
    for members in IV7_STATIC_GROUPS:
        fingerprints = {v7.semantic_fingerprint(source[sid]) for sid in members}
        assert len(fingerprints) == 1, members
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    groups: dict[str, list[str]] = {}
    for sid, row in rows.items():
        groups.setdefault(v7.semantic_fingerprint(row), []).append(sid)
    excess = [members for members in groups.values() if len(members) > 1]
    assert excess == []
    for sid in v7.STATIC_EXCESS:
        assert sid not in rows
    kept = ["B-0271", "B-0273", "B-0275", "B-0277", "B-0279", "B-0281", "B-0286"]
    for sid in kept:
        assert sid in rows


# ---------------------------------------------------------------------------
# Seeds and preserved closed surfaces touched by these repairs
# ---------------------------------------------------------------------------

@test("SEEDS.contract_readiness_without_product_execution")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    seed_lines = (BENCH / "seeds" / "seeds_30_corrected.jsonl").read_text().splitlines()
    seed_rows = [json.loads(line) for line in seed_lines if line.strip()]
    assert [row["scenario_id"] for row in seed_rows] == v7.v6.SEED_IDS
    for row in seed_rows:
        canonical = json.dumps(rows[row["scenario_id"]], ensure_ascii=False,
                               sort_keys=True, separators=(",", ":"))
        assert canonical == json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    compiled = compile_corpus({sid: rows[sid] for sid in v7.v6.SEED_IDS}, _registry())
    assert compiled["compiled_ok"] == 30
    for sid in ("B-0005", "C-0001"):
        for entry in rows[sid]["provider_fixture"]["responses"]:
            assert validate_navigator_response_fixture(entry["response"], where=sid) is None
    for sid in ("A-0008", "A-0009", "A-0011", "A-0014", "A-0015", "B-0007", "C-0003"):
        assert _compile_one(rows[sid])["compiled"] is True


@test("CLOSED.direct_preserved_properties")
def _():
    manifest, reasons = validate_byte_state_manifest(
        BENCH / "artifacts" / "CANONICAL_TIKHON_BYTE_STATE_CANDIDATE.json")
    assert manifest is not None and reasons == [], reasons
    assert isinstance(collect_rag_diagnostics({}, None), dict)
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    assert rows["A-0011"]["concurrency_mechanism_id"] == "ALEXEY.SAME_USER_SERIALIZATION"
    text = (BENCH / "adapters" / "product.py").read_text()
    assert "True != 1" in text or "typed" in text.lower()
    assert "current_fixture_id" not in text


@test("CORR8.six_repairs_measure_the_declared_questions")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = Path(tempfile.mkdtemp(prefix="corr8-six-"))

    name = rows["A-0105"]
    assert name["state_setup"]["causal_profile_propagation"] is True
    assert [step["messages"][0]["content"] for step in name["state_setup"]["multi_step"]] == [
        "Меня зовут Варвара", "Забудь моё имя", "Как меня зовут?"]
    assert [turn["content"] for turn in name["turns"]] == [
        "Меня зовут Варвара", "Забудь моё имя", "Как меня зовут?"]
    profile = name["state_setup"]["profile"]
    assert profile["displayName"] is None and profile["nameDeclined"] is True
    assert name["state_setup"]["multi_step"][0]["profile"]["displayName"] is None
    assert name["expected"]["prohibited_output"] == ["Варвара"]
    assert "cross-session" not in name["failure_mechanism"].lower()

    payment = rows["A-0116"]
    template = next(item["response"] for item in payment["provider_fixture"]["responses"]
                    if item["response"].get("bindPaymentToCommittedSelection"))
    assert template["conversationState"]["selectedCourseId"] is None
    assert "normative-situation" not in json.dumps(template, ensure_ascii=False)
    assert "maslow" not in json.dumps(template, ensure_ascii=False)
    paid = _run_alexey(payment, root)
    assert not paid.capture_error, paid.capture_error
    user = paid.values["state"]["701001"]
    assert user["selectedCourseId"] == "normative-situation"
    assert user["paymentCourseId"] == "normative-situation"

    persistence = rows["B-0032"]["preconditions"]["static_queries"][0]
    assert persistence["query_type"] == "ALLOWED_UPDATES_CROSS_RUN"
    assert persistence["file"] == "main.py"
    assert "DB_PATH" not in json.dumps(persistence)
    assert persistence["expected_value"]["resolution"] == "per_process"
    assert persistence["expected_value"]["cross_run_persistence"] is False
    inspected = StaticSourceInventoryAdapter().execute(_request(rows["B-0032"], str(CHATBOT)))
    assert not inspected.capture_error, inspected.capture_error
    assert inspected.static_inspection["facts"][persistence["fact"]] == persistence["expected_value"]
    resolved = rows["B-0030"]["preconditions"]["static_queries"][0]
    assert resolved["query_type"] == "RESOLVED_POLLING_UPDATES"
    assert resolved["expected_value"] == ["callback_query", "message", "my_chat_member"]

    absence = rows["B-0036"]["preconditions"]["static_queries"][0]
    assert absence["file"] == "src/lib/chat-contract.ts"
    assert absence["source_tree"] == "navigator"
    assert absence["expected_value"] == 0
    assert "session_store.py" not in absence["file"]
    contract = StaticSourceInventoryAdapter().execute(_request(
        rows["B-0036"], str(CHATBOT), navigator_root=str(BENCH.parent.parent)))
    assert not contract.capture_error, contract.capture_error
    assert contract.static_inspection["facts"][absence["fact"]] == 0

    handoff = _run_alexey(rows["C-0010"], root)
    assert not handoff.capture_error, handoff.capture_error
    expected = rows["C-0010"]["expected"]["state"]
    records = []
    for user_id, exp in expected.items():
        actual = handoff.values["state"][user_id]
        assert actual["selectedCourseId"] == exp["selectedCourseId"]
        assert actual["handoffRecord"] == exp["handoffRecord"]
        records.append(actual["handoffRecord"])
    assert records[0] != records[1]
    assert records[0]["contactPreference"] != records[1]["contactPreference"]
    assert records[0]["goal"] != records[1]["goal"]
    assert records[0]["facts"] != records[1]["facts"]

    foreign = rows["A-0298"]
    markers = next(item["params"]["prohibited"] for item in foreign["oracle"]
                   if item["oracle"] == "prohibited_output")
    assert markers == [
        "Структурная типология", "Структурную типологию",
        "Иерархия уровней сознания", "Иерархию уровней сознания",
    ]
    assert [step["messages"][0]["content"] for step in foreign["state_setup"]["multi_step"]] == [
        "Покупка оформлена: Структурная типология",
        "Покупка оформлена: Иерархия уровней сознания",
        "Что я покупал в прошлый раз?",
    ]
    assert foreign["state_setup"].get("causal_profile_propagation") is not True
    clean = "У меня нет сведений о ваших покупках."
    assert all(marker not in clean for marker in markers)
    assert "alpha" not in markers and "beta" not in markers


class _CausalNameFixture(NavigatorL2ChatAdapter):
    """Stubbed /api/chat. Turn 1 returns a name. Turn 2 returns a cleared profile."""

    def __init__(self):
        self.calls = []
        self.responses = []

    def _chat_call(self, base, body):
        self.calls.append(copy.deepcopy(body))
        index = len(self.calls)
        if index == 1:
            response = {
                "message": "Запомнила.",
                "profile": {"displayName": "Варвара", "addressMode": "VY",
                            "nameDeclined": False, "pendingUserRequest": None},
                "conversationState": {"token": "after-intro"},
            }
        elif index == 2:
            response = {
                "message": "Имя убрано.",
                "profile": {"displayName": None, "addressMode": "TY",
                            "nameDeclined": True, "pendingUserRequest": None},
                "conversationState": {"token": "after-forget"},
            }
        else:
            response = {
                "message": "Вас зовут Варвара.",
                "profile": {"displayName": None, "addressMode": "TY",
                            "nameDeclined": True, "pendingUserRequest": None},
                "conversationState": {"token": "after-recall"},
            }
        self.responses.append(response)
        return 200, response, None


@test("CORR1.two_roots_prove_causal_name_chain_and_purchase_surface")
def _():
    rows = _rows(BENCH / "corpus" / "corrected_corpus_84.jsonl")
    root = Path(tempfile.mkdtemp(prefix="corr1-two-"))
    env = {"navigator_l2_base_url": "http://127.0.0.1:9"}
    name = rows["A-0105"]
    assert _compile_one(name)["compiled"] is True
    steps = name["state_setup"]["multi_step"]
    assert len(steps) == 3
    assert all(len(step["messages"]) == 1 for step in steps)

    fixture = _CausalNameFixture()
    capture = fixture.execute(_request(name, str(root), env))
    assert not capture.capture_error, capture.capture_error
    assert len(fixture.calls) == 3
    assert [body["messages"] for body in fixture.calls] == [step["messages"] for step in steps]
    assert fixture.calls[0]["profile"]["displayName"] is None
    assert fixture.calls[0]["conversationState"] is None
    assert fixture.calls[1]["profile"] == fixture.responses[0]["profile"]
    assert fixture.calls[1]["conversationState"] == fixture.responses[0]["conversationState"]
    assert fixture.calls[2]["profile"] == fixture.responses[1]["profile"]
    assert fixture.calls[2]["conversationState"] == fixture.responses[1]["conversationState"]
    assert fixture.calls[1]["profile"] != steps[1]["profile"]
    assert fixture.calls[2]["profile"] != steps[2]["profile"]
    assert fixture.calls[1]["conversationState"] != steps[1]["conversationState"]
    assert fixture.calls[1]["profile"]["displayName"] == "Варвара"
    assert fixture.calls[2]["profile"]["displayName"] is None
    assert fixture.calls[2]["profile"]["addressMode"] == "TY"
    chain = capture.values["state"]
    assert chain["causalProfilePropagation"] is True
    assert chain["multiStepCount"] == 3
    assert chain["stepRequestProfiles"][1] == chain["stepResponseProfiles"][0]
    assert chain["stepRequestProfiles"][2] == chain["stepResponseProfiles"][1]
    assert chain["stepRequestStates"][1] == chain["stepResponseStates"][0]
    assert chain["stepRequestStates"][2] == chain["stepResponseStates"][1]
    assert "Варвара" in capture.values["output"]
    params = next(item["params"] for item in name["oracle"] if item["oracle"] == "prohibited_output")
    rejected = oracle_prohibited_output(
        _output_evidence(root, name, capture.values["output"], "recall"), name, params)
    accepted = oracle_prohibited_output(
        _output_evidence(root, name, "Я не знаю, как вас зовут.", "no-name"), name, params)
    assert rejected.satisfied is False
    assert accepted.satisfied is True

    flattened = copy.deepcopy(name)
    flattened["state_setup"].pop("multi_step")
    flattened["state_setup"].pop("causal_profile_propagation")
    flat_contract = _compile_one(flattened)
    assert flat_contract["compiled"] is False
    assert any("causal_profile_propagation" in item for item in flat_contract["defects"])
    flat_fixture = _CausalNameFixture()
    flat_capture = flat_fixture.execute(_request(flattened, str(root), env))
    assert not flat_capture.capture_error, flat_capture.capture_error
    assert len(flat_fixture.calls) == 1
    assert [message["content"] for message in flat_fixture.calls[0]["messages"]] == [
        "Меня зовут Варвара", "Забудь моё имя", "Как меня зовут?"]

    unlinked = copy.deepcopy(name)
    unlinked["state_setup"]["causal_profile_propagation"] = False
    unlinked_contract = _compile_one(unlinked)
    assert unlinked_contract["compiled"] is False
    assert any("causal_profile_propagation" in item for item in unlinked_contract["defects"])
    unlinked_fixture = _CausalNameFixture()
    unlinked_capture = unlinked_fixture.execute(_request(unlinked, str(root), env))
    assert not unlinked_capture.capture_error, unlinked_capture.capture_error
    assert len(unlinked_fixture.calls) == 3
    assert unlinked_fixture.calls[1]["profile"] == steps[1]["profile"]
    assert unlinked_fixture.calls[1]["conversationState"] is None
    assert unlinked_fixture.calls[1]["profile"] != unlinked_fixture.responses[0]["profile"]
    assert unlinked_fixture.calls[2]["conversationState"] != unlinked_fixture.responses[1]["conversationState"]

    foreign = rows["A-0298"]
    assert foreign["turns"][0]["content"] == "Что я покупал в прошлый раз?"
    assert [step.get("introduced_facts") for step in foreign["state_setup"]["multi_step"][:2]] == [
        ["Структурная типология"], ["Иерархия уровней сознания"]]
    assert foreign["state_setup"].get("causal_profile_propagation") is not True
    foreign_params = next(item["params"] for item in foreign["oracle"]
                          if item["oracle"] == "prohibited_output")
    for label, text in (
            ("structural-disclosure", "Вы покупали Структурную типологию личности."),
            ("consciousness-disclosure", "Вы покупали Иерархию уровней сознания.")):
        verdict = oracle_prohibited_output(
            _output_evidence(root, foreign, text, label), foreign, foreign_params)
        assert verdict.satisfied is False, text
    clean = oracle_prohibited_output(
        _output_evidence(root, foreign, "У меня нет сведений о ваших покупках.", "clean-purchases"),
        foreign, foreign_params)
    assert clean.satisfied is True


def main() -> int:
    for _name, fn in TESTS:
        fn()
    passed = sum(1 for item in RESULTS if item["pass"])
    failed = [item for item in RESULTS if not item["pass"]]
    print(f"IV7 FINAL CLOSURE BATTERY: {passed}/{len(RESULTS)} passed")
    for item in failed:
        print(f"  FAIL {item['name']}: {item['detail'][:500]}")
    (BENCH / "artifacts" / "IV7_FINAL_CLOSURE_BATTERY.json").write_text(json.dumps({
        "schema": "IV7_FINAL_CLOSURE_BATTERY",
        "total": len(RESULTS), "passed": passed, "failed": len(failed),
        "all_pass": not failed, "cases": RESULTS,
    }, ensure_ascii=False, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
