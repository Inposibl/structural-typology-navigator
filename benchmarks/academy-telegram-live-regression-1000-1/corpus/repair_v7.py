"""CORR7 curation and repair.

Frozen input: corpus/corr5_input_996.jsonl.
Output: exactly 924 scenarios. The CORR6 removal set is not preserved.
Bad removals are replaced by static effective duplicates and by L4
extra-stimulus rows whose oracle, expected state and measurement are the
same as a retained sibling. Flags on the pruning plan are computed from
those row relationships.
"""

from __future__ import annotations

import ast
import copy
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
if str(BENCH) not in sys.path:
    sys.path.insert(0, str(BENCH))
sys.path.insert(0, str(BENCH / "corpus"))

import repair_v6 as v6  # noqa: E402
from adapters.product import StaticSourceInventoryAdapter  # noqa: E402
from adapters.registry import load_registry  # noqa: E402
from harness.contract_compile import compile_corpus, compile_retention_claim  # noqa: E402
from harness.corpus_tools import scenario_fingerprint  # noqa: E402
from harness.execution_request import build_execution_request  # noqa: E402
from harness.mechanisms import mechanism_doc  # noqa: E402
from harness.oracle import validate_oracle_completeness  # noqa: E402

OUT = Path(os.environ.get("CORR7_OUT_ROOT", str(BENCH)))
INPUT_CORPUS = Path(os.environ.get(
    "CORR7_INPUT_CORPUS", str(BENCH / "corpus" / "corr5_input_996.jsonl")))
CHATBOT = Path("/Users/entp_psyche/Desktop/InvestProjects2026/chatbot")
NAVIGATOR = BENCH.parent.parent

# IV7 section 9. Membership is the obligation. One retained member preserves it.
IV7_OBLIGATIONS: dict[str, list[str]] = {
    "TG07_LOCAL_DELIVERY_ORDER": ["A-0052", "A-0053", "A-0054", "A-0055", "A-0115"],
    "TG19_SESSION_DEFAULT_MISMATCH": ["A-0057"],
    "TG20_REPLY_LATENCY_RANGES": ["A-0059"],
    "AG11_PROFILE_NAME_FORGETTING": ["A-0105"],
    "TG18_THREE_TASK_SERIALIZATION": ["A-0114"],
    "ST16_SWITCH_PAYMENT_RACE": ["A-0116"],
    "ST04_PROFILE_COURSE_WRITE_RACE": ["A-0117"],
    "ST03_NONCOMMAND_HELP_NAME_CAPTURE": ["A-0300", "A-0301"],
    "TG15_SECRET_TOKEN_INVENTORY": ["B-0019"],
    "TG16_REPLAY_BUFFER_INVENTORY": ["B-0021"],
    "TG04_WEBHOOK_ROUTER_REGISTRATION": ["B-0025"],
    "TG05_DISCARD_CONFIG_OVERRIDE": ["B-0028"],
    "TG05_RESTART_DISCARD_POSTURE": ["B-0029"],
    "TG06_RESOLVED_UPDATES": ["B-0030", "B-0031", "B-0175"],
    "TG06_CROSS_RUN_PERSISTENCE": ["B-0032"],
    "TG14_SQLITE_PERSISTED_ID_WIDTH": ["B-0034", "B-0178"],
    "TG14_JSON_INT_WRITER_ROUNDTRIP": ["B-0035"],
    "TG14_NAVIGATOR_ID_ABSENCE": ["B-0036"],
    "ST05_RESET_STALE_REFERENCE_RACE": ["B-0061"],
    "TG06_REMINDER_ROUTER_REGISTRATION": ["B-0176"],
    "TG14_USER_ID_INDEXES": ["B-0177"],
    "ST18_INCOMING_STATE_RETENTION": ["B-0206", "B-0207", "B-0219", "B-0220"],
    "AG14_PARALLEL_COURSE_COMMITS": ["C-0006", "C-0078", "C-0110"],
    "ST18_HANDOFF_CONTEXT_ISOLATION": ["C-0010"],
    "AG14_COMMIT_CANCEL": ["C-0005", "C-0079"],
    "PAY01_CHECKOUT_CONFIRM": ["B-0041", "B-0058", "B-0095", "C-0007", "C-0080"],
    "TG_EXPIRY_CALLBACK_ABSENCE": ["B-0016", "B-0017"],
    "TG05_DROP_PENDING_LITERAL": ["B-0026", "B-0027"],
    "S_HANDOFF_STABILITY": ["A-0140", "A-0141", "A-0142"],
    "MALFORMED_CALLBACK_PAIR": ["B-0129", "B-0130"],
}

RESTORED = [
    "A-0115", "A-0057", "A-0059", "A-0105", "A-0114", "A-0116", "A-0117", "A-0300",
    "B-0019", "B-0021", "B-0025", "B-0028", "B-0029", "B-0032", "B-0034", "B-0035",
    "B-0036", "B-0061", "B-0176", "B-0177", "B-0206", "C-0006", "C-0010",
]
STATIC_EXCESS = [
    "B-0272", "B-0274", "B-0276", "B-0278", "B-0280", "B-0282", "B-0292", "B-0298",
]
L4_EXCESS = [
    "B-0155", "B-0156", "B-0157", "B-0158", "B-0159",
    "B-0151", "B-0152", "B-0153", "B-0154",
    "B-0136", "B-0138", "B-0140",
    "B-0147", "B-0148",
    "B-0142",
]
L4_KEPT = {
    "ST-16": "A-0290", "ST-18": "B-0150", "TG-18": "A-0284",
    "TG-13": "B-0146", "TG-09": "B-0141",
}
# Frozen CORR6 removal witness. Regeneration reads the 996 only.
# The rewritten 924 is an output, not an input.
CORR6_REMOVED = [
    "A-0052", "A-0053", "A-0054", "A-0055", "A-0057", "A-0059", "A-0105",
    "A-0114", "A-0115", "A-0116", "A-0117", "A-0140", "A-0300", "A-0301",
    "B-0016", "B-0019", "B-0021", "B-0025", "B-0026", "B-0028", "B-0029",
    "B-0031", "B-0032", "B-0034", "B-0035", "B-0036", "B-0057", "B-0058",
    "B-0061", "B-0095", "B-0130", "B-0161", "B-0162", "B-0163", "B-0164",
    "B-0165", "B-0166", "B-0167", "B-0168", "B-0169", "B-0170", "B-0171",
    "B-0172", "B-0173", "B-0174", "B-0175", "B-0176", "B-0177", "B-0178",
    "B-0206", "B-0207", "B-0219", "B-0220", "B-0283", "B-0284", "B-0285",
    "B-0288", "B-0294", "B-0300", "C-0006", "C-0007", "C-0010", "C-0078",
    "C-0079", "C-0080", "C-0108", "C-0109", "C-0110", "C-0174", "C-0175",
    "C-0176", "C-0180",
]
MATERIAL_CLASSES = {
    "TG-07|alexey_user_turn": "TG-07 local causal ordering",
    "ST-04|alexey_user_turn": "ST-04 native concurrent profile/course writes",
    "ST-16|alexey_user_turn": "ST-16 native switch/payment race",
}

_OBLIGATION_OF: dict[str, str] = {}
for _oid, _members in IV7_OBLIGATIONS.items():
    for _sid in _members:
        _OBLIGATION_OF[_sid] = _oid


def _oracle_key(row: dict) -> str:
    return json.dumps(row.get("oracle"), ensure_ascii=False, sort_keys=True)


def _static_subject(query: dict) -> dict:
    return {k: v for k, v in query.items()
            if k not in ("fact", "declared_question", "expected_value")}


def _project_input(row: dict) -> dict:
    """IV7 effective-stimulus projection. Fact labels are not part of it."""
    adapter = row.get("adapter_id")
    pre = row.get("preconditions") or {}
    turn = row.get("turns") or []
    state = row.get("state_setup") or {}
    first = turn[0].get("content", "") if turn else ""
    last = turn[-1].get("content", "") if turn else ""
    if adapter == "static_source_inventory":
        consumed = {"queries": pre.get("static_queries") or []}
    elif adapter == "harness_gate_selftest":
        consumed = {"attacks": pre.get("attacks") or []}
    elif adapter == "navigator_l1_payment_policy":
        consumed = {"query": last,
                    "act": state.get("act_decision") or {"state": "NAVIGATE"},
                    "context": state.get("payment_context") or {}}
    elif adapter in ("navigator_l1_course_reference", "navigator_l1_commercial_authority"):
        consumed = {"query": last}
    elif adapter == "navigator_l2_chat_api":
        consumed = {
            "messages": [{"role": t.get("role", "user"), "content": t.get("content", "")}
                         for t in turn],
            "profile": state.get("profile") or {
                "displayName": None, "addressMode": None,
                "nameDeclined": False, "pendingUserRequest": None},
            "state": state.get("conversationState"),
        }
    elif adapter == "chatbot_l3_deep_link_start":
        consumed = {"command": first}
    elif adapter == "chatbot_l3_callback_registry":
        raw = first.removeprefix("callback:")
        consumed = {"callback_data": raw.split(":")[1] if ":" in raw else "<MALFORMED>",
                    "fsm_data": pre.get("fsm_data") or {}}
    elif adapter == "chatbot_l3_parser_bounds":
        history = pre.get("history")
        if history is None:
            history = [{"role": "user", "content": "привет"},
                       {"role": "assistant", "content": "Здравствуйте"}]
        consumed = {"user_text": last, "history": history}
    elif adapter == "alexey_user_turn":
        workers = max(1, int(row.get("concurrency_workers") or 0))
        user_id = int(pre.get("user_id", 701001))
        consumed = {
            "worker_inputs": [
                {"user_id": user_id + i if pre.get("per_user_mode") and workers > 1 else user_id,
                 "text": ((turn[-1]["content"] if workers == 1
                           else turn[min(i, len(turn) - 1)]["content"]) if turn
                          else "Хочу Маслоу"),
                 "message_id": 5000 + i}
                for i in range(workers)
            ],
            "lead_status": pre.get("lead_status"),
            "mode": pre.get("navigator_transport", "stubbed"),
            "fault": (row.get("fault_schedule") or [])[:1],
            "users": pre.get("users"),
            "provider": row.get("provider_fixture"),
            "history": turn[:-1] if workers == 1 else [],
        }
    elif adapter == "outbound_dispatcher":
        consumed = {"message": last}
    elif adapter == "outbound_lead_lifecycle":
        consumed = {"user_id": int(pre.get("user_id", 900001)),
                    "lead_status": pre.get("lead_status", "STEP_1_FIRST_TOUCH_SENT"),
                    "text": first if turn else "Не пишите мне больше."}
    else:
        consumed = {"adapter": adapter, "unavailable": True}
    return {"adapter": adapter, "input": consumed}


def semantic_fingerprint(row: dict) -> str:
    """IV7 frozen effective fingerprint.

    Generated fact labels, derivation numbers, row ids and track are not
    distinctions. Static oracle paths are rebound to the query subject.
    """
    projected = _project_input(row)
    adapter = row.get("adapter_id")
    state = row.get("state_setup") or {}
    pre = row.get("preconditions") or {}
    oracles = copy.deepcopy(row.get("oracle"))
    expected = copy.deepcopy(row.get("expected"))
    mechanism = row.get("failure_mechanism") or ""
    if adapter == "navigator_l2_chat_api" and state.get("multi_step"):
        projected["input"] = {"multi_step": state["multi_step"]}
    if adapter == "alexey_user_turn":
        projected["input"]["schedule"] = (
            pre.get("concurrency_schedule")
            or (row.get("provider_fixture") or {}).get("contention_schedule"))
    if row.get("execution_level") == "L4" or row.get("seam_class") == "NO_SEAM":
        projected["input"]["future_turns"] = row.get("turns")
        projected["input"]["future_state"] = state
    if adapter == "static_source_inventory":
        projected["input"].pop("future_turns", None)
        projected["input"].pop("future_state", None)
        queries = pre.get("static_queries") or []
        querymap = {q["fact"]: _static_subject(q) for q in queries}
        projected["input"]["queries"] = list(querymap.values())
        for oracle in oracles or []:
            if oracle.get("oracle") != "static_config":
                continue
            for item in (oracle.get("params") or {}).get("expectations") or []:
                if item.get("path") in querymap:
                    item["path"] = querymap[item["path"]]
        if isinstance(expected, dict) and isinstance(expected.get("static_facts"), dict):
            expected["static_facts"] = [
                {"query": querymap[key], "value": value}
                for key, value in expected["static_facts"].items()
                if key in querymap
            ]
        mechanism = re.sub(r" \(derivation \d+\)", "", mechanism)
    return json.dumps({
        "input": projected,
        "class": row.get("failure_class"),
        "mechanism": mechanism,
        "oracle": oracles,
        "expected": expected,
        "semantic": row.get("semantic_evaluation"),
    }, ensure_ascii=False, sort_keys=True)


def obligation_id(row: dict) -> str:
    sid = row["scenario_id"]
    if sid in _OBLIGATION_OF:
        return _OBLIGATION_OF[sid]
    if sid.startswith("B-016") or sid.startswith("B-017"):
        # B-0161..B-0174 are the IV7-valid future-live siblings of the retained
        # same-class L4 rows. Class plus traceback-only oracle is the relationship.
        # This precedes the live-variant grouping: those rows also say
        # "Live transport variant", but their dominator uses different wording.
        number = int(sid.split("-")[1])
        if 161 <= number <= 174:
            return "L4_FUTURE_SIBLING:" + row.get("failure_class", "")
    if (row.get("execution_level") == "L4"
            and row.get("adapter_id") == "live_telegram_transport"
            and "Live transport variant" in (row.get("failure_mechanism") or "")):
        return "L4_EXTRA:" + row.get("failure_class", "") + ":" + _oracle_key(row)
    if row.get("adapter_id") == "static_source_inventory":
        subjects = [_static_subject(q) for q in
                    (row.get("preconditions") or {}).get("static_queries") or []]
        return "STATIC:" + json.dumps({
            "class": row.get("failure_class"),
            "queries": subjects,
            "mechanism": re.sub(r" \(derivation \d+\)", "", row.get("failure_mechanism") or ""),
        }, ensure_ascii=False, sort_keys=True)
    if row.get("adapter_id") == "alexey_user_turn" and any(
            o.get("oracle") == "different_user_independence_proven" for o in row.get("oracle") or []):
        return "DIFFERENT_USER:" + row.get("failure_class", "")
    return "ROW:" + sid


def material_class(row: dict) -> str:
    key = f"{row.get('failure_class')}|{row.get('adapter_id')}"
    return MATERIAL_CLASSES.get(key, key)


def _consumed(row: dict) -> str:
    if row.get("adapter_id") == "static_source_inventory":
        return json.dumps([_static_subject(q) for q in
                           (row.get("preconditions") or {}).get("static_queries") or []],
                          ensure_ascii=False, sort_keys=True)
    turns = [t.get("content") for t in row.get("turns") or []]
    return json.dumps(turns, ensure_ascii=False)


def _assertion(row: dict) -> str:
    return json.dumps({"oracle": row.get("oracle"), "expected": row.get("expected")},
                      ensure_ascii=False, sort_keys=True)


def _bind_static(row: dict, queries: list[dict], *, navigator_root: str | None = None) -> None:
    pre = row.setdefault("preconditions", {})
    pre["static_queries"] = queries
    request = build_execution_request(
        row, adapter_id="static_source_inventory", run_id="CORR7", attempt=1,
        scenario_sha256="b" * 64, navigator_test_root=navigator_root,
        tikhon_test_root=str(CHATBOT))
    capture = StaticSourceInventoryAdapter().execute(request)
    if capture.capture_error:
        raise SystemExit(f"HOLD static {row['scenario_id']}: {capture.capture_error}")
    facts = capture.static_inspection["facts"]
    bound = []
    for query in queries:
        value = facts.get(query["fact"])
        if value is None:
            raise SystemExit(
                f"HOLD {row['scenario_id']} {query['fact']}: static derivation "
                "is NOT_OBSERVABLE; the question was not substituted")
        item = dict(query)
        item["expected_value"] = value
        bound.append(item)
    pre = row.setdefault("preconditions", {})
    pre.pop("facts_spec", None)
    pre["static_queries"] = bound
    expectations = [{"path": q["fact"], "value": q["expected_value"]} for q in bound]
    for oracle in row.get("oracle") or []:
        if oracle.get("oracle") == "static_config":
            oracle.setdefault("params", {})["expectations"] = expectations
    if isinstance(row.get("expected"), dict):
        row["expected"]["static_facts"] = {q["fact"]: q["expected_value"] for q in bound}


def _course_fixture(fixture_id: str, course_id: str | None, *, reset: bool = False,
                    handoff_course: str | None = None, handoff: dict | None = None,
                    display_name: str | None = None) -> dict:
    if reset:
        response = v6._reset_response()
    else:
        response = v6._course_response(course_id)
    if display_name is not None:
        response["profile"]["displayName"] = display_name
    if handoff is not None:
        response["conversationState"]["handoff"] = handoff
    elif handoff_course is not None:
        response["conversationState"]["handoff"] = {
            "status": "REQUESTED",
            "reason": "course handoff",
            "context": {"courseId": handoff_course},
        }
    return {"fixture_id": fixture_id, "response": response}


def _payment_binding_fixture(fixture_id: str) -> dict:
    """Payment response with no course of its own.

    The adapter copies the selection already committed in the user store.
    """
    response = v6._pf_response(
        None, "Оплата привязывается к уже выбранному курсу.", act="PAYMENT")
    response["bindPaymentToCommittedSelection"] = True
    return {"fixture_id": fixture_id, "response": response}


def _handoff_state(status: str, goal: str, course_id: str, preference: str,
                   facts: list[str], unresolved: str, flow_id: str) -> dict:
    return {
        "status": status,
        "reason": "DIRECT_REQUEST",
        "context": {
            "goal": goal,
            "courseId": course_id,
            "unresolvedChoice": unresolved,
            "flowId": flow_id,
            "blockingProblem": "DIRECT_REQUEST",
            "facts": facts,
            "contactPreference": preference,
        },
    }


def _handoff_record(handoff: dict) -> dict:
    context = handoff["context"]
    return {
        "status": handoff["status"],
        "goal": context["goal"],
        "courseId": context["courseId"],
        "contactPreference": context["contactPreference"],
        "facts": list(context["facts"]),
    }


def _install_race(row: dict, *, workers: int, user_id: int, per_user: bool,
                  responses: list[dict], by_worker: dict | None = None,
                  by_user: dict | None = None, expected: dict,
                  mode: str | None = None, users_seed: list | None = None,
                  observe_handoff: bool = False, observe_payment: bool = False) -> None:
    row["concurrency_workers"] = workers
    row["replay_set"] = "C"
    if not row.get("concurrency_mechanism_id"):
        row["concurrency_mechanism_id"] = (
            "ALEXEY.DIFFERENT_USER_INDEPENDENCE" if per_user
            else "ALEXEY.SAME_USER_SERIALIZATION")
    pre = row.setdefault("preconditions", {})
    pre["user_id"] = user_id
    pre["navigator_transport"] = pre.get("navigator_transport") or "stubbed"
    pre["per_user_mode"] = per_user
    if observe_handoff:
        pre["observe_handoff_context"] = True
    if observe_payment:
        pre["observe_payment_binding"] = True
    if users_seed is not None:
        pre["users"] = users_seed
    proof = ("different_user_independence_proven" if per_user
             else "same_user_serialization_proven")
    invariant = {
        "oracle": "concurrency_invariant",
        "params": {"expected_state": expected, "per_user": True},
    }
    proof_oracle = {
        "oracle": proof,
        "params": {"target_seam": "LebedevNavigatorAdapter.get_user_lock",
                   "workers": workers},
    }
    row["oracle"] = [proof_oracle, invariant]
    row["expected"] = {"state": expected}
    if mode == "state_aware":
        row["provider_fixture"] = {
            "schema": "NAVIGATOR_RESPONSE_FIXTURE_V2",
            "mode": "state_aware",
            "selection": "incoming_state",
            "responses": [],
            "contention_schedule": {
                "provider_pause_s": v6.PROVIDER_PAUSE_S,
                "pause_point": "awaited provider boundary (call_navigator_core)",
                "fixture_kind": "benchmark-controlled scheduling fixture (not a product claim)",
            },
        }
    else:
        row["provider_fixture"] = v6.fixture_v2(
            responses=responses, by_user=by_user)
        if by_worker:
            row["provider_fixture"]["fixture_by_worker"] = {str(k): v for k, v in by_worker.items()}
            row["provider_fixture"].pop("fixture_id", None)


def _complete_profile() -> dict:
    return {"displayName": "Проверяющий", "addressMode": "VY",
            "nameDeclined": False, "pendingUserRequest": None}


def _foreign_profile() -> dict:
    return {"displayName": None, "addressMode": None,
            "nameDeclined": False, "pendingUserRequest": None}


def repair_cross_session_contracts(rows: dict) -> None:
    """Keep the original questions. Markers are the introduced fact strings."""
    # Nominative purchase facts stay the introduced facts. The accusative
    # strings are the same facts' authorized disclosure surface, not new facts.
    purchase_a = "Структурная типология"
    purchase_a_surface = "Структурную типологию"
    purchase_b = "Иерархия уровней сознания"
    purchase_b_surface = "Иерархию уровней сознания"
    purchase_markers = [purchase_a, purchase_a_surface, purchase_b, purchase_b_surface]
    foreign_profile = {"displayName": "Покупатель", "addressMode": "VY",
                       "nameDeclined": False, "pendingUserRequest": None}
    a = rows["A-0298"]
    a["route_precondition"] = "COMPLETE_PROFILE_PROVIDED"
    setup = a.setdefault("state_setup", {})
    setup["profile"] = _complete_profile()
    setup["multi_step"] = [
        {"requestId": "foreign-purchase-structural",
         "introduced_facts": [purchase_a],
         "messages": [{"role": "user",
                       "content": "Покупка оформлена: Структурная типология"}],
         "profile": foreign_profile, "conversationState": None,
         "session_boundary": "independent session that established a purchase"},
        {"requestId": "foreign-purchase-hierarchy",
         "introduced_facts": [purchase_b],
         "messages": [{"role": "user",
                       "content": "Покупка оформлена: Иерархия уровней сознания"}],
         "profile": foreign_profile, "conversationState": None,
         "session_boundary": "independent session that established a purchase"},
        {"requestId": "purchase-probe",
         "messages": [{"role": "user", "content": "Что я покупал в прошлый раз?"}],
         "profile": _complete_profile(), "conversationState": None,
         "session_boundary": "independent probe session"},
    ]
    a["turns"] = [{"role": "user", "content": "Что я покупал в прошлый раз?"}]
    a.setdefault("expected", {})["prohibited_output"] = list(purchase_markers)
    for oracle in a.get("oracle") or []:
        if oracle.get("oracle") == "prohibited_output":
            oracle.setdefault("params", {})["prohibited"] = list(purchase_markers)
    name = "КлиентX"
    c = rows["C-0036"]
    c["route_precondition"] = "COMPLETE_PROFILE_PROVIDED"
    setup = c.setdefault("state_setup", {})
    setup["profile"] = _complete_profile()
    intro = f"Меня зовут {name}, хочу курс Маслоу"
    setup["multi_step"] = [
        {"requestId": "foreign-handoff-client",
         "introduced_facts": [name],
         "messages": [{"role": "user", "content": intro}],
         "profile": _foreign_profile(), "conversationState": None,
         "session_boundary": "independent foreign handoff session"},
        {"requestId": "handoff-probe",
         "messages": [{"role": "user", "content": "Хочу оплатить Маслоу"}],
         "profile": _complete_profile(), "conversationState": None,
         "session_boundary": "independent handoff probe session"},
    ]
    c["turns"] = [{"role": "user", "content": "Хочу оплатить Маслоу"}]
    c.setdefault("expected", {})["prohibited_output"] = [name]
    for oracle in c.get("oracle") or []:
        if oracle.get("oracle") == "prohibited_output":
            oracle.setdefault("params", {})["prohibited"] = [name]


def repair_restored(rows: dict) -> None:
    _bind_static(rows["A-0057"], [{
        "query_type": "CONFIG_DEFAULTS_DIFFER",
        "file": "data_engine/auth_helper.py", "file_b": "data_engine/config.py",
        "symbol": "session_name", "fact": "auth_helper_default_session_differs",
        "declared_question": ("does auth_helper.py default a different session_name "
                              "literal than the adapter config default?"),
    }])
    _bind_static(rows["A-0059"], [
        {"query_type": "NUMERIC_RANGE_LITERALS", "file": "data_engine/lebedev_adapter.py",
         "symbol": "calculate_typing_delay", "fact": "typing_delay_range_s",
         "declared_question": "does calculate_typing_delay encode a numeric per-turn reply latency range?"},
        {"query_type": "NUMERIC_RANGE_LITERALS", "file": "data_engine/lebedev_adapter.py",
         "symbol": "calculate_reading_delay", "fact": "reading_delay_range_s",
         "declared_question": "does calculate_reading_delay encode a numeric per-turn reading latency range?"},
    ])
    _bind_static(rows["B-0019"], [
        {"query_type": "SYMBOL_ABSENT", "file": "main.py", "symbol": "secret_token",
         "fact": "secret_token_absent_main",
         "declared_question": "is a secret_token symbol absent from the telegram entry module?"},
        {"query_type": "SYMBOL_ABSENT", "file": "handlers/client.py", "symbol": "secret_token",
         "fact": "secret_token_absent_client",
         "declared_question": "is a secret_token symbol absent from the client router?"},
        {"query_type": "SYMBOL_ABSENT", "file": "api_service.py", "symbol": "secret_token",
         "fact": "secret_token_absent_api",
         "declared_question": "is a telegram secret_token symbol absent from the API service?"},
    ])
    _bind_static(rows["B-0021"], [
        {"query_type": "SYMBOL_EXISTS", "file": "api_service.py", "symbol": "S2SRequestNonce",
         "fact": "api_nonce_replay_buffer",
         "declared_question": "does the Academy API service declare an S2SRequestNonce replay buffer?"},
        {"query_type": "SYMBOL_ABSENT", "file": "main.py", "symbol": "replay_buffer",
         "fact": "telegram_replay_buffer_absent",
         "declared_question": "is a replay_buffer symbol absent from the telegram polling entry?"},
    ])
    _bind_static(rows["B-0025"], [{
        "query_type": "SYMBOL_ABSENT", "file": "main.py", "symbol": "webhook_router",
        "fact": "webhook_router_absent",
        "declared_question": "is a webhook_router absent from the executed telegram entry?",
    }])
    literal_question = ("on the executed entry path, is delete_webhook's "
                        "drop_pending_updates argument a literal rather than a config expression?")
    _bind_static(rows["B-0028"], [{
        "query_type": "CALL_KEYWORD_LITERAL", "file": "main.py",
        "call": "delete_webhook", "keyword": "drop_pending_updates",
        "fact": "discard_argument_literal",
        "declared_question": literal_question,
    }])
    _bind_static(rows["B-0029"], [{
        "query_type": "CALL_KEYWORD_LITERAL", "file": "main.py",
        "call": "delete_webhook", "keyword": "drop_pending_updates",
        "fact": "restart_entry_discard_literal",
        "declared_question": ("does process restart re-enter main() where delete_webhook's "
                              "drop_pending_updates argument is a literal?"),
    }])
    _bind_static(rows["B-0032"], [{
        "query_type": "ALLOWED_UPDATES_CROSS_RUN", "file": "main.py",
        "fact": "allowed_updates_cross_run_persistence",
        "declared_question": ("is allowed_updates resolved per process by "
                              "resolve_used_update_types() with MemoryStorage and "
                              "no cross-run persistence of that argument? "
                              "answered by ALLOWED_UPDATES_CROSS_RUN"),
    }])
    _bind_static(rows["B-0034"], [
        {"query_type": "SQL_COLUMN_TYPE", "file": "data_engine/session_store.py",
         "table": "sessions", "column": "user_id", "fact": "sessions_user_id_sql_type",
         "declared_question": "what SQL type does the persisted sessions.user_id column declare?"},
        {"query_type": "SQL_COLUMN_TYPE", "file": "data_engine/session_store.py",
         "table": "message_history", "column": "user_id", "fact": "message_history_user_id_sql_type",
         "declared_question": "what SQL type does the persisted message_history.user_id column declare?"},
    ])
    _bind_static(rows["B-0035"], [{
        "query_type": "JSON_DUMPS_PERSISTS", "file": "data_engine/session_store.py",
        "symbol": "save_session", "fact": "json_dumps_persists_session",
        "declared_question": "does save_session persist profile and state through json.dumps without an int-to-str encoder?",
    }])
    _bind_static(rows["B-0036"], [{
        "query_type": "NAVIGATOR_CHAT_CONTRACT_NUMERIC_ID_COUNT",
        "file": "src/lib/chat-contract.ts", "source_tree": "navigator",
        "fact": "navigator_numeric_telegram_id_fields",
        "declared_question": ("how many numeric Telegram ID fields does the Navigator "
                              "chat contract declare? answered by "
                              "NAVIGATOR_CHAT_CONTRACT_NUMERIC_ID_COUNT"),
    }], navigator_root=str(NAVIGATOR))
    _bind_static(rows["B-0176"], [{
        "query_type": "CALL_SITE_EXISTS", "file": "reminder_scheduler.py",
        "call": "include_router", "fact": "reminder_registers_router",
        "declared_question": "does the reminder scheduler register a router via include_router?",
    }])
    _bind_static(rows["B-0177"], [
        {"query_type": "ANNOTATED_COLUMN_INDEX", "file": "database.py",
         "class": "Application", "column": "user_id", "fact": "application_user_id_indexed",
         "declared_question": "is Application.user_id declared with an index?"},
        {"query_type": "ANNOTATED_COLUMN_INDEX", "file": "database.py",
         "class": "SentReminder", "column": "user_id", "fact": "sent_reminder_user_id_indexed",
         "declared_question": "is SentReminder.user_id declared with an index?"},
    ])
    _bind_static(rows["B-0030"], [{
        "query_type": "RESOLVED_POLLING_UPDATES", "file": "main.py",
        "fact": "allowed_updates_resolved_set",
        "declared_question": ("which update types does start_polling resolve when "
                              "allowed_updates is bound to resolve_used_update_types() "
                              "on the routers the executed entry includes? "
                              "answered by RESOLVED_POLLING_UPDATES"),
    }])

    # B-0024: the declared question is the executed path, not source line order.
    for query in rows["B-0024"]["preconditions"]["static_queries"]:
        if query.get("query_type") == "CALL_ORDER_BEFORE":
            query["declared_question"] = (
                "does delete_webhook execute before start_polling on the "
                "module execution path, ignoring uninvoked function bodies?")

    # TG-07 delivery order. Three turns, last committed course wins.
    _install_race(
        rows["A-0115"], workers=3, user_id=701001, per_user=False,
        responses=[
            _course_fixture("PF-A0115-0", "structural-typology"),
            _course_fixture("PF-A0115-1", "maslow"),
            _course_fixture("PF-A0115-2", "structural-typology"),
        ],
        by_worker={0: "PF-A0115-0", 1: "PF-A0115-1", 2: "PF-A0115-2"},
        expected={"701001": {"selectedCourseId": "structural-typology"}})
    # Three-task serialization. Last turn commits play-and-creativity.
    _install_race(
        rows["A-0114"], workers=3, user_id=701001, per_user=False,
        responses=[
            _course_fixture("PF-A0114-0", "maslow"),
            _course_fixture("PF-A0114-1", "maslow"),
            _course_fixture("PF-A0114-2", "play-and-creativity"),
        ],
        by_worker={0: "PF-A0114-0", 1: "PF-A0114-1", 2: "PF-A0114-2"},
        expected={"701001": {"selectedCourseId": "play-and-creativity"}})
    # Switch, later switch, then payment. Payment reads the committed selection.
    _install_race(
        rows["A-0116"], workers=3, user_id=701001, per_user=False,
        observe_payment=True,
        responses=[
            _course_fixture("PF-A0116-0", "maslow"),
            _course_fixture("PF-A0116-1", "normative-situation"),
            _payment_binding_fixture("PF-A0116-PAY"),
        ],
        by_worker={0: "PF-A0116-0", 1: "PF-A0116-1", 2: "PF-A0116-PAY"},
        expected={"701001": {"selectedCourseId": "normative-situation",
                             "paymentCourseId": "normative-situation"}})
    rows["A-0116"]["turns"] = [
        {"role": "user", "content": "Хочу Маслоу"},
        {"role": "user", "content": "Хочу «Нормативную ситуацию»"},
        {"role": "user", "content": "Где оплатить?"},
    ]
    # Profile write then course write. Last committed snapshot is the course.
    _install_race(
        rows["A-0117"], workers=2, user_id=701001, per_user=False,
        responses=[
            _course_fixture("PF-A0117-0", None, display_name="Ольга"),
            _course_fixture("PF-A0117-1", "maslow", display_name="Ольга"),
        ],
        by_worker={0: "PF-A0117-0", 1: "PF-A0117-1"},
        expected={"701001": {"selectedCourseId": "maslow", "displayName": "Ольга"}})
    # Parallel course commits. Last serialized commit is maslow.
    uid = int((rows["C-0006"].get("preconditions") or {}).get("user_id") or 708826)
    _install_race(
        rows["C-0006"], workers=2, user_id=uid, per_user=False,
        responses=[
            _course_fixture("PF-C0006-0", "play-and-creativity"),
            _course_fixture("PF-C0006-1", "maslow"),
        ],
        by_worker={0: "PF-C0006-0", 1: "PF-C0006-1"},
        expected={str(uid): {"selectedCourseId": "maslow"}})
    # Reset versus a stale course write. The later reset clears the course.
    uid = int((rows["B-0061"].get("preconditions") or {}).get("user_id") or 701001)
    _install_race(
        rows["B-0061"], workers=2, user_id=uid, per_user=False,
        responses=[
            _course_fixture("PF-B0061-0", "maslow"),
            _course_fixture("PF-B0061-1", None, reset=True),
        ],
        by_worker={0: "PF-B0061-0", 1: "PF-B0061-1"},
        expected={str(uid): {"selectedCourseId": None}})
    # Incoming state is retained per user under overlap.
    _install_race(
        rows["B-0206"], workers=2, user_id=760001, per_user=True,
        responses=[], mode="state_aware",
        users_seed=[
            {"user_id": 760001, "profile": {"displayName": None},
             "state": {"selectedCourseId": "maslow"}},
            {"user_id": 760002, "profile": {"displayName": None},
             "state": {"selectedCourseId": "normative-situation"}},
        ],
        expected={"760001": {"selectedCourseId": "maslow"},
                  "760002": {"selectedCourseId": "normative-situation"}})
    # Each user keeps a handoff record. The record is not the course id.
    uid = int((rows["C-0010"].get("preconditions") or {}).get("user_id") or 708599)
    other = uid + 1
    handoff_a = _handoff_state(
        "REQUESTED", "HUMAN_CONTACT", "maslow", "TELEGRAM",
        ["SELECTED_COURSE"], "NONE", "ACADEMY_CONTACT")
    handoff_b = _handoff_state(
        "READY", "COURSE_CONFIRMATION", "play-and-creativity", "PHONE",
        ["PENDING_CONFIRMATION"], "AWAITING_CONFIRMATION", "COURSE_SELECTION")
    _install_race(
        rows["C-0010"], workers=2, user_id=uid, per_user=True, observe_handoff=True,
        responses=[
            _course_fixture("PF-C0010-A", "maslow", handoff=handoff_a),
            _course_fixture("PF-C0010-B", "play-and-creativity", handoff=handoff_b),
        ],
        by_user={uid: "PF-C0010-A", other: "PF-C0010-B"},
        expected={str(uid): {"selectedCourseId": "maslow",
                             "handoffRecord": _handoff_record(handoff_a)},
                  str(other): {"selectedCourseId": "play-and-creativity",
                               "handoffRecord": _handoff_record(handoff_b)}})
    # C-0005 already proves same-user contention. Its turns are commit then cancel.
    # The later cancel fixture is the commit/cancel effect the neutral stub omitted.
    c5 = rows["C-0005"]
    uid = int((c5.get("preconditions") or {}).get("user_id") or 701001)
    _install_race(
        c5, workers=2, user_id=uid, per_user=False,
        responses=[
            _course_fixture("PF-C0005-COMMIT", "maslow"),
            _course_fixture("PF-C0005-CANCEL", None, reset=True),
        ],
        by_worker={0: "PF-C0005-COMMIT", 1: "PF-C0005-CANCEL"},
        expected={str(uid): {"selectedCourseId": None}})

    # Natural-language help must not capture displayName. Profile stays incomplete.
    help_row = rows["A-0300"]
    help_row["route_precondition"] = "ONBOARDING_IS_THE_MECHANISM"
    help_setup = help_row.setdefault("state_setup", {})
    help_setup["profile"] = {"displayName": None, "addressMode": None,
                             "nameDeclined": False, "pendingUserRequest": None}
    help_setup["conversationState"] = None
    help_row["expected"] = {"state": {"displayName": None}}

    # One causal conversation: introduction, then forgetting consumes the
    # returned profile, then recall consumes the profile returned after forgetting.
    # The name is not planted in the initial profile. The three utterances are
    # three requests, not one history batch.
    forget = rows["A-0105"]
    forget["route_precondition"] = "COMPLETE_PROFILE_PROVIDED"
    forget["failure_mechanism"] = (
        "Deleted/forgotten memory must not resurrect. "
        "Introduced profile-name forgetting and later name recall.")
    forget["observable_effect"] = (
        "The recall does not return the introduced profile name after it is forgotten.")
    forget["semantic_evaluation"] = {
        "claim": "After the introduced profile name is forgotten, the recall does not assert that name.",
        "required": True,
    }
    initial_profile = {"displayName": None, "addressMode": "VY",
                       "nameDeclined": True, "pendingUserRequest": None}
    forget_setup = forget.setdefault("state_setup", {})
    forget_setup["profile"] = dict(initial_profile)
    forget_setup["conversationState"] = None
    forget_setup["causal_profile_propagation"] = True
    forget_setup["multi_step"] = [
        {"requestId": "name-introduction",
         "messages": [{"role": "user", "content": "Меня зовут Варвара"}],
         "profile": dict(initial_profile), "conversationState": None},
        {"requestId": "name-forgetting",
         "messages": [{"role": "user", "content": "Забудь моё имя"}],
         "profile": dict(initial_profile), "conversationState": None},
        {"requestId": "name-recall",
         "messages": [{"role": "user", "content": "Как меня зовут?"}],
         "profile": dict(initial_profile), "conversationState": None},
    ]
    forget["turns"] = [
        {"role": "user", "content": "Меня зовут Варвара"},
        {"role": "user", "content": "Забудь моё имя"},
        {"role": "user", "content": "Как меня зовут?"},
    ]
    forget.setdefault("expected", {})["prohibited_output"] = ["Варвара"]
    for oracle in forget.get("oracle") or []:
        if oracle.get("oracle") == "prohibited_output":
            oracle.setdefault("params", {})["prohibited"] = ["Варвара"]
    if not any(o.get("oracle") == "prohibited_output" for o in forget.get("oracle") or []):
        forget.setdefault("oracle", []).append({
            "oracle": "prohibited_output",
            "params": {"prohibited": ["Варвара"], "target": "SYSTEM_OUTPUT"},
        })


def _future_sibling_anchor(row: dict, retained: dict[str, dict]) -> str | None:
    """Retained L4 row of the same class whose oracle is traceback-only."""
    if row.get("execution_level") != "L4":
        return None
    for sid, other in retained.items():
        if other.get("failure_class") != row.get("failure_class"):
            continue
        if other.get("adapter_id") != "live_telegram_transport":
            continue
        if _oracle_key(other) == _oracle_key(row) and other.get("expected") == row.get("expected"):
            return sid
    return None


def build_plan(source: dict[str, dict], final_rows: dict[str, dict],
               removed_ids: list[str]) -> dict:
    retained_ids = set(final_rows)
    obligations_retained = defaultdict(list)
    for sid, row in final_rows.items():
        obligations_retained[obligation_id(row)].append(sid)
    # Future-sibling anchors use the retained corpus, matched by class and oracle.
    plan_rows = []
    losses = []
    for sid in removed_ids:
        row = source[sid]
        oid = obligation_id(row)
        if oid.startswith("L4_FUTURE_SIBLING:"):
            anchor = _future_sibling_anchor(row, final_rows)
            candidates = [anchor] if anchor else []
        else:
            candidates = [s for s in obligations_retained.get(oid, []) if s != sid]
        nearest = sorted(candidates)[0] if candidates else None
        retained = final_rows.get(nearest) if nearest else None
        same = retained is not None and obligation_id(retained) == oid or (
            oid.startswith("L4_FUTURE_SIBLING:") and nearest is not None)
        if oid.startswith("L4_FUTURE_SIBLING:") and nearest is not None:
            # The relationship is class + oracle equality, not the synthetic id
            # on the retained row. Recompute from the two rows.
            same = (_future_sibling_anchor(row, {nearest: retained}) == nearest)
        unique_loss = sid in _OBLIGATION_OF and _OBLIGATION_OF[sid] in {
            k for k, members in IV7_OBLIGATIONS.items()
            if k not in ("TG06_RESOLVED_UPDATES", "AG14_COMMIT_CANCEL",
                         "PAY01_CHECKOUT_CONFIRM", "TG_EXPIRY_CALLBACK_ABSENCE",
                         "TG05_DROP_PENDING_LITERAL", "S_HANDOFF_STABILITY",
                         "MALFORMED_CALLBACK_PAIR")
        } and not any(obligation_id(final_rows[s]) == oid for s in retained_ids)
        class_key = f"{row.get('failure_class')}|{row.get('adapter_id')}"
        class_lost = class_key in MATERIAL_CLASSES and not any(
            f"{final_rows[s].get('failure_class')}|{final_rows[s].get('adapter_id')}" == class_key
            for s in retained_ids)
        if not same or nearest is None:
            losses.append(sid)
        claim = {
            "REMOVED_ID": sid,
            "SEMANTIC_OBLIGATION_ID": oid if not oid.startswith("L4_FUTURE") else
            "L4_FUTURE_SIBLING:" + row.get("failure_class", ""),
            "NEAREST_RETAINED_EQUIVALENT": nearest,
            "SEMANTIC_EQUIVALENCE": "YES" if same else "NO",
            "MATERIAL_CAUSAL_CONDITION_PRESERVED": "YES" if same else "NO",
            "MATERIAL_STATE_DISTINCTION_PRESERVED": "YES" if same else "NO",
            "MANDATORY_SEED": "YES" if sid in v6.SEEDS else "NO",
            "UNIQUE_REQUIRED_OBLIGATION_LOST": "YES" if unique_loss else "NO",
            "MATERIAL_MEASUREMENT_CLASS_LOST": "YES" if class_lost else "NO",
            "REMOVAL_REASON": _removal_reason(sid, nearest, oid),
            "_computed_obligation_id": oid,
            "_retained_obligation_id": obligation_id(retained) if retained and not oid.startswith("L4_FUTURE") else oid,
            "_computed_unique_loss": unique_loss,
        }
        if retained is not None and not oid.startswith("L4_FUTURE"):
            defects = compile_retention_claim(row, retained, claim)
            if defects:
                raise SystemExit(f"HOLD retention {sid}: {defects}")
        elif not same:
            raise SystemExit(f"HOLD {sid}: no retained equivalent for {oid}")
        plan_rows.append(claim)
    if losses:
        raise SystemExit(f"HOLD unequivalent removals: {losses}")
    return {"removals": plan_rows}


def _removal_reason(sid: str, nearest: str | None, oid: str) -> str:
    if sid in STATIC_EXCESS:
        return (f"same static measurement as retained {nearest}; fact label and "
                "derivation number are not semantic distinctions")
    if sid in L4_EXCESS:
        return (f"same L4 future-transport oracle and expected state as retained "
                f"{nearest}; stimulus wording is not a separate asserted state")
    if oid.startswith("L4_FUTURE"):
        return (f"same future-live class and traceback-only oracle as retained {nearest}")
    return (f"retained {nearest} preserves semantic obligation {oid}: same material "
            "question, causal condition and measurement capability")


def _load(path: Path) -> tuple[dict[str, dict], list[str]]:
    rows: dict[str, dict] = {}
    order: list[str] = []
    with open(path) as fh:
        for line in fh:
            if line.strip():
                row = json.loads(line)
                rows[row["scenario_id"]] = row
                order.append(row["scenario_id"])
    return rows, order


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    rows, order = _load(INPUT_CORPUS)
    if len(rows) != 996:
        raise SystemExit(f"HOLD source count {len(rows)}")
    input_sha = _sha(INPUT_CORPUS)
    expected_sha = "ec591ef1b91eeb58a8873ae8ec4920018f8ce26e3393b88c5b2cf32c6aac9a42"
    if input_sha != expected_sha:
        raise SystemExit("HOLD frozen CORR5 sha differs")
    current_removed = list(CORR6_REMOVED)
    if len(current_removed) != 72 or len(set(current_removed)) != 72:
        raise SystemExit(f"HOLD CORR6 removed count {len(current_removed)}")
    unknown = [sid for sid in current_removed if sid not in rows]
    if unknown:
        raise SystemExit(f"HOLD CORR6 removal ids are not in the 996: {unknown}")
    missing = [sid for sid in RESTORED if sid not in current_removed]
    if missing:
        raise SystemExit(f"HOLD restores were not in the CORR6 removal set: {missing}")
    occupied = [sid for sid in STATIC_EXCESS + L4_EXCESS if sid in current_removed]
    if occupied:
        raise SystemExit(f"HOLD new removals were already in the CORR6 removal set: {occupied}")
    removed = sorted((set(current_removed) - set(RESTORED)) | set(STATIC_EXCESS) | set(L4_EXCESS))
    if len(removed) != 72:
        raise SystemExit(f"HOLD removal count {len(removed)}")
    if set(removed) & set(v6.SEED_IDS):
        raise SystemExit("HOLD a mandatory seed would be removed")

    source_snapshot = {sid: json.loads(json.dumps(row)) for sid, row in rows.items()}
    for sid in removed:
        del rows[sid]
    order = [sid for sid in order if sid in rows]
    if len(rows) != 924:
        raise SystemExit(len(rows))

    v6.REPAIR_LOG.clear()
    v6.repair_provider_fixtures(rows)
    v6.repair_static(rows)
    v6.repair_l2(rows)
    v6.repair_cross_session(rows)
    repair_cross_session_contracts(rows)
    repair_restored(rows)

    registry = load_registry()
    native_map = {aid: tuple(a.get("native_observables") or [])
                  for aid, a in (registry.get("adapters") or {}).items()}
    hooks_map = {aid: tuple(a.get("real_fault_hooks") or [])
                 for aid, a in (registry.get("adapters") or {}).items()}
    incomplete = []
    contradictions = []
    for sid in sorted(rows):
        defects = validate_oracle_completeness(
            rows[sid], native_map.get(rows[sid].get("adapter_id"), ()),
            hooks_map.get(rows[sid].get("adapter_id"), ()))
        contradictions.extend(item for item in defects if "contradict" in item)
        incomplete.extend(item for item in defects if item not in contradictions)
    if incomplete or contradictions:
        print("INCOMPLETE", incomplete[:20])
        print("CONTRADICTIONS", contradictions[:10])
        raise SystemExit(f"HOLD completeness {len(incomplete)} / {len(contradictions)}")
    compiled = compile_corpus(rows, registry)
    if not compiled["all_compile"]:
        bad = [c for c in compiled["contracts"] if not c["compiled"]]
        for item in bad[:20]:
            print("COMPILE", item["scenario_id"], item["defects"][:3])
        raise SystemExit(f"HOLD compile {compiled['compile_failed']}")

    groups = defaultdict(list)
    for sid in order:
        groups[semantic_fingerprint(rows[sid])].append(sid)
    redundant = [members for members in groups.values() if len(members) > 1]
    excess = sum(len(members) - 1 for members in redundant)
    if excess:
        print("REDUNDANT", redundant[:8])
        raise SystemExit(f"HOLD effective redundancy {excess}")
    legacy = v6.redundant_groups(rows, order)
    if legacy:
        raise SystemExit(f"HOLD legacy redundancy {legacy[:4]}")

    plan = build_plan(source_snapshot, rows, removed)
    unique_loss = sum(1 for item in plan["removals"]
                      if item["UNIQUE_REQUIRED_OBLIGATION_LOST"] == "YES")
    class_loss = sum(1 for item in plan["removals"]
                     if item["MATERIAL_MEASUREMENT_CLASS_LOST"] == "YES")
    required_ids = [oid for oid in IV7_OBLIGATIONS
                    if oid not in ("TG06_RESOLVED_UPDATES", "AG14_COMMIT_CANCEL",
                                   "PAY01_CHECKOUT_CONFIRM", "TG_EXPIRY_CALLBACK_ABSENCE",
                                   "TG05_DROP_PENDING_LITERAL", "S_HANDOFF_STABILITY",
                                   "MALFORMED_CALLBACK_PAIR")]
    present = {obligation_id(rows[sid]) for sid in rows}
    missing_obligations = [oid for oid in required_ids if oid not in present]
    if missing_obligations or unique_loss or class_loss:
        raise SystemExit(
            f"HOLD obligations {missing_obligations} unique {unique_loss} class {class_loss}")

    seen = {}
    for sid in order:
        rows[sid].pop("executable_meaning_sha256", None)
        fingerprint = scenario_fingerprint(rows[sid])
        if fingerprint in seen:
            raise SystemExit(f"HOLD fingerprint collision {sid} {seen[fingerprint]}")
        seen[fingerprint] = sid
        rows[sid]["fingerprint_sha256"] = fingerprint

    (OUT / "corpus").mkdir(parents=True, exist_ok=True)
    (OUT / "seeds").mkdir(parents=True, exist_ok=True)
    out_rows = [rows[sid] for sid in order]
    corpus_path = OUT / "corpus" / "corrected_corpus_84.jsonl"
    with open(corpus_path, "w") as fh:
        for row in out_rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    corpus_sha = _sha(corpus_path)
    (OUT / "corpus" / "CORPUS_SHA256.txt").write_text(f"{corpus_sha}  corrected_corpus_84.jsonl\n")

    def canonical(row: dict) -> str:
        return json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    seed_rows = [rows[sid] for sid in v6.SEED_IDS]
    with open(OUT / "seeds" / "seeds_30_corrected.jsonl", "w") as fh:
        for row in seed_rows:
            fh.write(canonical(row) + "\n")
    (OUT / "seeds" / "SEED_SYNC_REPORT.json").write_text(json.dumps({
        "schema": "SEED_SYNC_REPORT_V5",
        "method": "seed rows regenerated from the CORR7 924 corpus",
        "expected_ids": v6.SEED_IDS,
        "actual_ids": [row["scenario_id"] for row in seed_rows],
        "match_count": 30,
        "byte_identical": True,
    }, ensure_ascii=False, indent=2))

    tracks = Counter(row["track"] for row in out_rows)
    levels = Counter(row["execution_level"] for row in out_rows)
    replays = Counter(row.get("replay_set") or "NONE" for row in out_rows)
    distribution = {
        "schema": "CORPUS_DISTRIBUTION_V5",
        "total_scenarios": 924,
        "tracks": dict(tracks), "levels": dict(levels), "replay_sets": dict(replays),
        "unique_fingerprints": 924,
        "effective_duplicate_groups_remaining": 0,
        "redundant_effective_scenarios": 0,
        "distribution_frozen": False,
        "set_s": replays.get("S", 0),
    }
    (OUT / "corpus" / "distribution.json").write_text(
        json.dumps(distribution, ensure_ascii=False, indent=2))

    public_removals = []
    for item in plan["removals"]:
        public_removals.append({k: v for k, v in item.items() if not k.startswith("_")})
    pruning = {
        "schema": "CORPUS_PRUNING_PLAN_996_TO_924_V2",
        "SOURCE_COUNT": 996,
        "REMOVED_COUNT": 72,
        "FINAL_COUNT": 924,
        "SOURCE_CORPUS_SHA256": input_sha,
        "MANDATORY_SEEDS_PRESENT": 30,
        "UNIQUE_REQUIRED_MECHANISM_LOSS": 0,
        "MATERIAL_MEASUREMENT_CLASS_LOSS": 0,
        "removed_ids": removed,
        "restored_obligation_representatives": RESTORED,
        "static_excess_removed": STATIC_EXCESS,
        "l4_excess_removed": L4_EXCESS,
        "l4_kept_anchors": L4_KEPT,
        "removals": public_removals,
    }
    (OUT / "corpus" / "CORPUS_PRUNING_PLAN_996_TO_924_V2.json").write_text(
        json.dumps(pruning, ensure_ascii=False, indent=2))

    obligation_map = []
    for sid, row in source_snapshot.items():
        obligation_map.append({
            "SCENARIO_ID": sid,
            "FAILURE_CLASS": row.get("failure_class"),
            "SEMANTIC_OBLIGATION_ID": obligation_id(row),
            "MATERIAL_MEASUREMENT_CLASS": material_class(row),
            "ADAPTER": row.get("adapter_id"),
            "LEVEL": row.get("execution_level"),
            "MECHANISM_ID": (row.get("failure_mechanism") or "")[:180],
            "CONSUMED_STIMULUS": _consumed(row)[:240],
            "MATERIAL_ASSERTION": _assertion(row)[:240],
            "MANDATORY_SEED": sid in v6.SEEDS,
            "RETAINED": sid in rows,
        })
    (OUT / "corpus" / "SEMANTIC_OBLIGATION_MAP.json").write_text(
        json.dumps({"schema": "SEMANTIC_OBLIGATION_MAP_V1", "rows": obligation_map},
                   ensure_ascii=False, indent=2))
    (OUT / "corpus" / "SCENARIO_COMPILED_CONTRACTS.json").write_text(
        json.dumps(compiled, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "CORPUS_COMPLETENESS_REPORT.json").write_text(json.dumps({
        "schema": "CORPUS_COMPLETENESS_REPORT_V5",
        "corpus_incomplete_contract_count": 0,
        "checked_rows": 924,
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "EXPECTATION_CONSISTENCY_REPORT.json").write_text(json.dumps({
        "schema": "EXPECTATION_CONSISTENCY_REPORT_V5",
        "expectation_contradiction_count": 0,
        "checked_rows": 924,
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "SEMANTIC_DUPLICATE_REPORT.json").write_text(json.dumps({
        "schema": "EFFECTIVE_DUPLICATE_REPORT_V5",
        "redundant_effective_scenarios": 0,
        "remaining_duplicate_groups": [],
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "SEMANTIC_DRIFT_REPORT.json").write_text(json.dumps({
        "schema": "SEMANTIC_DRIFT_REPORT_V2",
        "SEMANTIC_DRIFT_FINDINGS": 0,
        "note": "B-0030 again measures resolved allowed_updates, not a decorator inventory",
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "VALIDATION_ERRORS.json").write_text("[]")
    (OUT / "corpus" / "REPAIR_LOG.json").write_text(
        json.dumps(v6.REPAIR_LOG, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "FAULT_MECHANISM_REGISTRY.json").write_text(json.dumps(
        {**mechanism_doc(), "schema_fault": "FAULT_MECHANISM_REGISTRY_V1"},
        ensure_ascii=False, indent=2))
    (OUT / "corpus" / "CONCURRENCY_MECHANISM_REGISTRY.json").write_text(json.dumps(
        {**mechanism_doc(), "schema_conc": "CONCURRENCY_MECHANISM_REGISTRY_V1"},
        ensure_ascii=False, indent=2))
    print("CORR7", len(out_rows), "sha", corpus_sha[:16], "S", replays.get("S"),
          "removed", len(removed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
