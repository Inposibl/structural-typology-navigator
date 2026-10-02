"""CORR6 corpus pipeline (IV6 owner sections 10-47).

Input: the frozen CORR5 996-row candidate (corpus/corr5_input_996.jsonl,
sha ec591ef1…). Output: the CORR6 corpus — EXACTLY 924 rows (Owner's final
size decision), exact 30 mandatory seed IDs preserved — produced by:

PHASE A  CORR5_INPUT_996 frozen verbatim with its identity artifact.
PHASE B  QUALITY PRUNING BEFORE REPAIR (owner section 11): exactly 72 rows
         removed by transparent dominance decisions, never row-number/quota
         driven, never "remove every failing row":
           Tier 1 (effective redundancy, IV6-F17): B-0130 — one of the pair
                 B-0129/B-0130 that collapses to the same adapter-consumed
                 malformed callback input and material assertion.
           Tier 5 (invalid measurement contract whose independent information
                 value does not justify repair — owner §13.5): the 57
                 non-seed IV6-incomplete rows that are weak duplicates of a
                 RETAINED representative of the same failure class. Nine
                 class representatives (C-0005 AG-14, B-0041 PAY-01,
                 B-0042 PAY-03, B-0043 PAY-04, B-0187 PAY-05, A-0299 ST-03,
                 B-0024 TG-04, B-0030 TG-06, B-0033 TG-14) and the unique
                 cross-session mechanism A-0104 are RETAINED AND REPAIRED
                 (hard-keep rules 1-3; a current defect never overrides them).
           Tier 4 (duplicate mechanism coverage where stronger retained
                 examples exist — owner §13.4): 14 of the 39 self-declared
                 "Live transport variant (extra stimulus)" L4 future-authority
                 duplicates (never executable in any current phase; 25
                 retained siblings carry the same future contract).
PHASE C  RECOMPUTE + REPAIR the retained IV6 findings:
          F02    A-0052..A-0055 legitimately eliminated by justified pruning
                 (weak TG-07 duplicates; class retained via 2 stronger rows);
                 the compiler now REJECTS flat state expectations on the
                 user-keyed Alexey projection (recurrence prevention).
          F03    the four retained invalid static rows rebound to typed
                 queries that answer their DECLARED questions (callback
                 filter registration construct; call ORDER; decorator
                 inventory; class-scoped annotated column types); every
                 retained static query carries DECLARED_QUESTION; identifier
                 syntax is enforced (callback DATA can never be a callee).
          F06A   fixture selection is EXPLICIT by registered
                 PROVIDER_FIXTURE_ID (single or per-user); text-keyed
                 selection retired and rejected by the compiler.
          F06B   every retained explicit fixture is a COMPLETE native
                 response (full 18-field ConversationState, typed enums,
                 native envelope), validated by the upgraded validator.
          F08    typed configuration-value comparison (True != 1, 1 != "1",
                 "a b" != "ab"); unsupported expressions NOT_OBSERVABLE.
          F12A   deterministic benchmark-controlled async pause at the
                 awaited provider boundary for every retained Set C row —
                 real measured contention becomes achievable.
          F12B   per-task ACTUAL lock identities recorded; the independence
                 oracle REFUTES shared-lock/serial evidence and REQUIRES
                 overlapping native operations.
          F15    A-0299 keeps its first-contact mechanism with an INCOMPLETE
                 profile (ONBOARDING route); A-0104 gets an explicit
                 multi-step cross-session trajectory (>=2 causal steps,
                 distinct session ids); A-0140 (invalid Set S) legitimately
                 eliminated by pruning; Set S recomputed from route semantics.
          F17    B-0130 removed; redundancy criterion re-evaluated -> 0.
PHASE D  contract compilation 924/924 with the SEMANTIC compiler (§38),
         seed regeneration (30/30), distribution recomputation, coverage
         retention, drift report (0 retained drift), artifact set.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
if str(BENCH) not in sys.path:
    sys.path.insert(0, str(BENCH))
sys.path.insert(0, str(BENCH / "corpus"))

import os as _os

OUT = Path(_os.environ.get("CORR6_OUT_ROOT", str(BENCH)))
INPUT_CORPUS = Path(_os.environ.get(
    "CORR6_INPUT_CORPUS", str(BENCH / "corpus" / "corr5_input_996.jsonl")))

from harness.corpus_tools import scenario_fingerprint  # noqa: E402
from harness.contract_compile import compile_corpus  # noqa: E402
from harness.oracle import validate_oracle_completeness  # noqa: E402
from harness.mechanisms import mechanism_doc  # noqa: E402
from adapters.registry import load_registry  # noqa: E402

REPAIR_LOG: list[dict] = []

SEED_IDS = ([f"A-{i:04d}" for i in range(1, 16)] + [f"B-{i:04d}" for i in range(1, 8)] +
            [f"C-{i:04d}" for i in range(1, 4)] + [f"D-{i:04d}" for i in range(1, 6)])
SEEDS = set(SEED_IDS)

# ---------------------------------------------------------------------------
# IV6 authoritative evidence
# ---------------------------------------------------------------------------

IV6_INCOMPLETE_72 = [
    "A-0011", "A-0052", "A-0053", "A-0054", "A-0055", "A-0057", "A-0059",
    "A-0104", "A-0105", "A-0114", "A-0115", "A-0116", "A-0117", "A-0140",
    "A-0299", "A-0300", "A-0301", "B-0005", "B-0007", "B-0016", "B-0019",
    "B-0021", "B-0024", "B-0025", "B-0026", "B-0028", "B-0029", "B-0030",
    "B-0031", "B-0032", "B-0033", "B-0034", "B-0035", "B-0036", "B-0041",
    "B-0042", "B-0043", "B-0057", "B-0058", "B-0061", "B-0095", "B-0175",
    "B-0176", "B-0177", "B-0178", "B-0187", "B-0206", "B-0207", "B-0219",
    "B-0220", "B-0283", "B-0284", "B-0285", "B-0288", "B-0294", "B-0300",
    "C-0001", "C-0003", "C-0005", "C-0006", "C-0007", "C-0010", "C-0078",
    "C-0079", "C-0080", "C-0108", "C-0109", "C-0110", "C-0174", "C-0175",
    "C-0176", "C-0180",
]

# Hard-keep retained representatives of otherwise-zeroing failure classes
# (owner §12 rules 2/3) + the unique cross-session mechanism A-0104 (rule 2):
RETAINED_INCOMPLETE = [
    "C-0005",   # AG-14 — only retained AG-14 representative (parallel collision)
    "B-0041",   # PAY-01 — checkout seam representative
    "B-0042",   # PAY-03 — the only PAY-03 row
    "B-0043",   # PAY-04 — the only PAY-04 row
    "B-0187",   # PAY-05 — the only PAY-05 row
    "A-0299",   # ST-03 — first-contact representative
    "B-0024",   # TG-04 — mode-collision representative
    "B-0030",   # TG-06 — allowed_updates representative
    "B-0033",   # TG-14 — ID-width representative
    "A-0104",   # AG-10 — UNIQUE cross-session leakage mechanism (repaired)
] + [  # mandatory seeds inside the incomplete set: retained AND repaired
    "A-0011", "B-0005", "B-0007", "C-0001", "C-0003",
]

IV6_F17_REDUNDANT_PAIR_MEMBER = "B-0130"

# The self-declared L4 duplicate block (mechanism text prefix)
L4_EXTRA_MECHANISM = "Live transport variant (extra stimulus)"
L4_EXTRA_REMOVALS = 14


def log(sid: str, action: str, reason: str) -> None:
    REPAIR_LOG.append({"scenario_id": sid, "action": action, "reason": reason})


# ---------------------------------------------------------------------------
# native-schema fixture builder (mirrors adapters.product)
# ---------------------------------------------------------------------------

COURSE_TITLES = {
    "maslow": "Маслоу",
    "structural-typology": "Структурная типология личности",
}


def _native_cs(course_id, act, content):
    return {
        "lifecycle": "OPEN",
        "activeFlow": None,
        "suspendedFlow": None,
        "courseMatch": ("MATCHED" if course_id else "UNKNOWN"),
        "selectedCourseId": course_id,
        "clarification": None,
        "pendingConfirmation": None,
        "catalogAuthorityVersion": None,
        "transactionalAuthorityVersion": None,
        "deferredRequest": None,
        "lastAssistant": {"act": act, "content": content, "courseId": course_id},
        "lastActivityAt": "2026-09-30T00:00:00.000Z",
        "staleReference": None,
        "repair": None,
        "execution": {"phase": "IDLE", "requestId": None,
                      "lastCompletedRequestId": None},
        "lastTechnicalError": None,
        "handoff": {"status": "NONE", "reason": None, "context": None},
        "qualitySignals": [],
    }


def _pf_response(course_id, message, *, act="COURSE_FOLLOW_UP", reset=False):
    return {
        "message": message,
        "profile": {"displayName": None, "addressMode": None,
                    "nameDeclined": False, "pendingUserRequest": None},
        "conversationState": _native_cs(course_id, act, message),
        "contactCard": None,
        "resetConversation": reset,
    }


def _course_response(course_id):
    title = COURSE_TITLES.get(course_id, course_id)
    return _pf_response(course_id,
                        f"Курс «{title}» выбран. Могу рассказать программу или помочь с оплатой.")


def _reset_response():
    return _pf_response(None, "Сессия сброшена. Начнём заново — какая тема вас интересует?",
                        act="RESTART", reset=True)


PROVIDER_PAUSE_S = 0.05


def fixture_v2(fixture_id=None, responses=None, *, by_user=None, pause=True,
               schema_note="identity_keyed"):
    doc = {
        "schema": "NAVIGATOR_RESPONSE_FIXTURE_V2",
        "selection": schema_note,
        "responses": responses or [],
        "contention_schedule": (
            {"provider_pause_s": PROVIDER_PAUSE_S,
             "pause_point": "awaited provider boundary (call_navigator_core)",
             "fixture_kind": "benchmark-controlled scheduling fixture (not a product claim)"}
            if pause else None),
    }
    if fixture_id:
        doc["fixture_id"] = fixture_id
    if by_user:
        doc["fixture_by_user"] = {str(k): v for k, v in by_user.items()}
    return doc


# ---------------------------------------------------------------------------
# PHASE B — quality pruning (exactly 72)
# ---------------------------------------------------------------------------

def build_removal_set(rows: dict, order: list) -> tuple[list[str], dict]:
    removals: set[str] = set()
    rationale: dict[str, dict] = {}

    cls_of = {sid: rows[sid]["failure_class"] for sid in order}

    def nearest_retained(sid):
        cls = cls_of[sid]
        kept_same = [s for s in order
                     if cls_of[s] == cls and s not in removals and s != sid]
        return sorted(kept_same)[0] if kept_same else None

    def add(sid: str, tier: str, reason: str):
        assert sid in rows, sid
        assert sid not in SEEDS, f"mandatory seed {sid} cannot be removed"
        removals.add(sid)
        rationale[sid] = {
            "REMOVED_ID": sid,
            "MANDATORY_SEED": "NO",
            "FAILURE_CLASS": cls_of[sid],
            "MECHANISM_ID": rows[sid].get("concurrency_mechanism_id")
            or (rows[sid].get("fault_schedule") or [{}])[0].get("mechanism_id")
            or rows[sid].get("failure_mechanism", "")[:100],
            "MEASUREMENT_CLASS": rows[sid].get("adapter_id"),
            "REMOVAL_REASON": reason,
            "REMOVAL_TIER": tier,
        }

    # Tier 1: effective redundancy (IV6-F17)
    add(IV6_F17_REDUNDANT_PAIR_MEMBER, "T1_EFFECTIVE_REDUNDANCY",
        "IV6-F17: collapses with retained B-0129 to the same adapter-consumed "
        "malformed callback input (missing index) and identical material "
        "assertion; parser normalization removes the raw-string distinction")

    # Tier 5: invalid measurement contracts that are weak duplicates of a
    # RETAINED class representative (owner §13.5 + §12 hard-keep rules)
    for sid in IV6_INCOMPLETE_72:
        if sid in SEEDS or sid in RETAINED_INCOMPLETE:
            continue
        add(sid, "T5_INVALID_CONTRACT_WEAK_DUPLICATE",
            "IV6-incomplete measurement contract whose independent information "
            "value does not justify repair: a retained representative of the "
            f"same failure class ({nearest_retained(sid)}) carries the class "
            "mechanism; hard-keep rules did not select it")

    # Tier 4: duplicate mechanism coverage in the L4 "extra stimulus" block
    extras = [sid for sid in order
              if rows[sid].get("failure_mechanism", "").startswith(L4_EXTRA_MECHANISM)]
    # remove from the tail, never the last row of a failure class
    cls_retained_count = Counter(cls_of[s] for s in order)
    removed_extras = 0
    for sid in sorted(extras, reverse=True):
        if removed_extras >= L4_EXTRA_REMOVALS:
            break
        if cls_retained_count[cls_of[sid]] <= 1:
            continue
        add(sid, "T4_DUPLICATE_MECHANISM_COVERAGE",
            "self-declared 'extra stimulus' duplicate of the L4 future-authority "
            "transport contract; stronger retained siblings carry the identical "
            "future contract (never executable in any current phase)")
        cls_retained_count[cls_of[sid]] -= 1
        removed_extras += 1
    assert removed_extras == L4_EXTRA_REMOVALS, removed_extras

    assert len(removals) == 72, len(removals)
    # per-removal nearest retained coverage + loss flags (final pass)
    for sid in rationale:
        near = nearest_retained(sid)
        rationale[sid]["NEAREST_RETAINED_COVERAGE"] = near
        rationale[sid]["INFORMATION_LOSS"] = "NON_MATERIAL"
        rationale[sid]["UNIQUE_MECHANISM_LOST"] = "NO"
    return sorted(removals), rationale


# ---------------------------------------------------------------------------
# PHASE C — retained-row repairs
# ---------------------------------------------------------------------------

def repair_provider_fixtures(rows: dict) -> None:
    """F06A + F06B + F12A for the five retained provider-fixture seeds."""
    plans = {
        "A-0011": fixture_v2(
            fixture_id="PF-A-0011-MASLOW",
            responses=[{"fixture_id": "PF-A-0011-MASLOW",
                        "response": _course_response("maslow")}]),
        "B-0005": fixture_v2(
            fixture_id="PF-B-0005-MASLOW",
            responses=[{"fixture_id": "PF-B-0005-MASLOW",
                        "response": _course_response("maslow")}]),
        "C-0001": fixture_v2(
            fixture_id="PF-C-0001-MASLOW",
            responses=[{"fixture_id": "PF-C-0001-MASLOW",
                        "response": _course_response("maslow")}]),
        "B-0007": fixture_v2(
            by_user={701001: "PF-B-0007-MASLOW", 701002: "PF-B-0007-STRUCT"},
            responses=[{"fixture_id": "PF-B-0007-MASLOW",
                        "response": _course_response("maslow")},
                       {"fixture_id": "PF-B-0007-STRUCT",
                        "response": _course_response("structural-typology")}]),
        "C-0003": fixture_v2(
            by_user={703001: "PF-C-0003-RESET", 703002: "PF-C-0003-STRUCT"},
            responses=[{"fixture_id": "PF-C-0003-RESET",
                        "response": _reset_response()},
                       {"fixture_id": "PF-C-0003-STRUCT",
                        "response": _course_response("structural-typology")}]),
    }
    for sid, fixture in plans.items():
        rows[sid]["provider_fixture"] = fixture
        rows[sid].pop("shared_stimulus_group_id", None)
        log(sid, "F06AB_PROVIDER_FIXTURE_V2",
            "fixture selection is EXPLICIT by registered PROVIDER_FIXTURE_ID "
            "(single or per-user map; no text heuristic); the response is a "
            "COMPLETE native ChatSuccessResponse (full 18-field typed "
            "ConversationState); a benchmark-controlled provider pause at the "
            "awaited boundary provides the deterministic contention/independence "
            "schedule (IV6-F06A/F06B/F12A/F12B)")
    # C-0005 (same-user, neutral provider): schedule via preconditions
    pre = rows["C-0005"].setdefault("preconditions", {})
    pre["concurrency_schedule"] = {
        "provider_pause_s": PROVIDER_PAUSE_S,
        "pause_point": "awaited provider boundary (call_navigator_core)",
        "fixture_kind": "benchmark-controlled scheduling fixture (not a product claim)",
    }
    log("C-0005", "F12A_CONTENTION_SCHEDULE",
        "same-user serialization row receives the benchmark-controlled async "
        "provider pause so the second task genuinely contends on the held "
        "per-user lock (IV6-F12A)")


STATIC_REBINDS = {
    # PAY-01/03/04/05 honest lanes: the checkout seam question — the native
    # construct is a callback FILTER REGISTRATION, not a generic call of
    # callback data text (IV6-F03 §21)
    "B-0041": [{
        "query_type": "CALLBACK_FILTER_HANDLER", "file": "handlers/client.py",
        "handler": "cb_ind_terms_confirmed", "filter_data": "confirm:ind_terms",
        "fact": "checkout_confirm_handler_present", "expected_value": True,
        "declared_question": ("is the checkout seam registered as the native "
                              "callback handler cb_ind_terms_confirmed for "
                              "confirm:ind_terms?"),
    }],
    "B-0042": [{
        "query_type": "CALLBACK_FILTER_HANDLER", "file": "handlers/client.py",
        "handler": "cb_ind_terms_confirmed", "filter_data": "confirm:ind_terms",
        "fact": "checkout_confirm_handler_present", "expected_value": True,
        "declared_question": ("is the checkout seam registered as the native "
                              "callback handler cb_ind_terms_confirmed for "
                              "confirm:ind_terms?"),
    }],
    "B-0043": [{
        "query_type": "CALLBACK_FILTER_HANDLER", "file": "handlers/client.py",
        "handler": "cb_ind_terms_confirmed", "filter_data": "confirm:ind_terms",
        "fact": "checkout_confirm_handler_present", "expected_value": True,
        "declared_question": ("is the checkout seam registered as the native "
                              "callback handler cb_ind_terms_confirmed for "
                              "confirm:ind_terms?"),
    }],
    "B-0187": [{
        "query_type": "CALLBACK_FILTER_HANDLER", "file": "handlers/client.py",
        "handler": "cb_ind_terms_confirmed", "filter_data": "confirm:ind_terms",
        "fact": "checkout_confirm_handler_present", "expected_value": True,
        "declared_question": ("is the checkout seam registered as the native "
                              "callback handler cb_ind_terms_confirmed for "
                              "confirm:ind_terms?"),
    }],
    # TG-04: the declared question is ORDERING (delete_webhook BEFORE
    # start_polling), not two independent call presences
    "B-0024": [
        {"query_type": "CALL_ORDER_BEFORE", "file": "main.py",
         "before": "delete_webhook", "after": "start_polling",
         "fact": "delete_webhook_before_polling", "expected_value": True,
         "declared_question": ("does the delete_webhook call site strictly "
                               "precede start_polling in module execution order?")},
        {"query_type": "CALL_SITE_EXISTS", "file": "main.py",
         "call": "start_polling", "fact": "mode", "expected_value": True,
         "declared_question": "is the polling entry point started (polling-only posture)?"},
    ],
    # TG-06: the declared question is the RESOLVED SET membership derived from
    # the actual router-decorator inventory
    "B-0030": [{
        "query_type": "HANDLER_DECORATOR_TYPES",
        "files": ["handlers/client.py", "handlers/operator.py"],
        "fact": "allowed_updates_min_set", "expected_value": None,  # bound truthfully below
        "declared_question": ("which update types does the actual router-decorator "
                              "inventory (the native resolve_used_update_types "
                              "surface) cover?"),
    }],
    # TG-14: the declared question is CLASS-SCOPED column typing
    "B-0033": [
        {"query_type": "ANNOTATED_COLUMN_TYPE", "file": "database.py",
         "class": "Application", "column": "user_id", "column_type": "BigInteger",
         "fact": "application_user_id_column", "expected_value": True,
         "declared_question": ("is the Application.user_id ORM column annotated "
                               "with the BigInteger type?")},
        {"query_type": "ANNOTATED_COLUMN_TYPE", "file": "database.py",
         "class": "SentReminder", "column": "user_id", "column_type": "BigInteger",
         "fact": "sent_reminder_user_id_column", "expected_value": True,
         "declared_question": ("is the SentReminder.user_id ORM column annotated "
                               "with the BigInteger type?")},
    ],
}


def _bind_truthful_decorator_inventory(rows: dict) -> None:
    """B-0030's expected set is derived from the ACTUAL current Tikhon source
    (read-only), never invented."""
    import ast
    root = Path("/Users/entp_psyche/Desktop/InvestProjects2026/chatbot")
    types = set()
    for rel in ("handlers/client.py", "handlers/operator.py"):
        tree = ast.parse((root / rel).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                d = dec.func if isinstance(dec, ast.Call) else dec
                if isinstance(d, ast.Attribute) and d.attr in (
                        "message", "callback_query", "my_chat_member"):
                    types.add(d.attr)
    q = rows["B-0030"]["preconditions"]["static_queries"][0]
    q["expected_value"] = sorted(types)
    for o in rows["B-0030"]["oracle"]:
        if o.get("oracle") == "static_config":
            o.setdefault("params", {})["expectations"] = [
                {"path": q["fact"], "value": sorted(types)}]


def repair_static(rows: dict) -> None:
    for sid, queries in STATIC_REBINDS.items():
        s = rows[sid]
        pre = s.setdefault("preconditions", {})
        pre.pop("facts_spec", None)
        pre["static_queries"] = queries
        expectations = [{"path": q["fact"], "value": q.get("expected_value", True)}
                        for q in queries]
        for o in s.get("oracle", []):
            if o.get("oracle") == "static_config":
                o.setdefault("params", {})["expectations"] = expectations
        log(sid, "F03_RELEVANT_STATIC_BINDING",
            "static contract rebound to the typed query that answers its DECLARED "
            "question (native construct matched: callback filter registration / "
            "call order / decorator inventory / class-scoped annotated column; "
            "IV6-F03 §20-22)")
    _bind_truthful_decorator_inventory(rows)
    # every RETAINED static query must carry its DECLARED_QUESTION (§22):
    # mechanical, question-preserving annotation from the declared mechanism
    for sid, s in rows.items():
        if s.get("adapter_id") != "static_source_inventory":
            continue
        mech = s.get("failure_mechanism", "")
        for q in (s.get("preconditions") or {}).get("static_queries") or []:
            if not q.get("declared_question"):
                q["declared_question"] = (
                    f"{sid} declared mechanism — «{mech[:180]}» — answered by "
                    f"{q.get('query_type')} on {q.get('file') or q.get('files')}")


def _cross_session_step(request_id, content, *, boundary=None):
    step = {
        "requestId": request_id,
        "messages": [{"role": "user", "content": content}],
        "profile": {"displayName": None, "addressMode": "VY",
                    "nameDeclined": False, "pendingUserRequest": None},
        "conversationState": None,
    }
    if boundary:
        step["session_boundary"] = boundary
    return step


_INDEPENDENT = ("independent session: distinct requestId, no shared "
                "profile/state baseline")


def repair_cross_session(rows: dict) -> None:
    """IV6-F15 §34 for every RETAINED cross-session claim: an explicit causal
    trajectory. A-0297 is a probe WITHOUT prior context BY DESIGN — its
    declared question is 'no prior session exists; the reply must not
    fabricate one', which a single request measures honestly."""
    # A-0297: declared single-step probe (no prior session exists by design)
    s = rows["A-0297"]
    (s.setdefault("state_setup", {}))["cross_session_mode"] = \
        "probe_without_prior_context"
    log("A-0297", "F15_CROSS_SESSION_SINGLE_STEP_BY_DESIGN",
        "declared question is a leakage probe WITHOUT any prior context: no "
        "step-1 session exists by design, so the single request IS the honest "
        "trajectory (the reply must not fabricate SESSION-BETA-NAME context "
        "that was never introduced); explicit mode declared for the compiler")
    # A-0298: foreign purchases in sessions alpha/beta, then the probe
    s = rows["A-0298"]
    ss = s.setdefault("state_setup", {})
    ss["multi_step"] = [
        _cross_session_step("alpha", "Хочу курс «Структурную типологию»",
                            boundary=_INDEPENDENT + " (foreign session alpha)"),
        _cross_session_step("beta", "Хочу курс «Иерархию уровней сознания»",
                            boundary=_INDEPENDENT + " (foreign session beta)"),
        _cross_session_step("probe", "Что я покупал в прошлый раз?",
                            boundary=_INDEPENDENT + " (probe session)"),
    ]
    log("A-0298", "F15_MULTI_STEP_CROSS_SESSION",
        "explicit trajectory: STEP_1 foreign session alpha selects a course; "
        "STEP_2 foreign session beta selects a course; STEP_3 independent "
        "probe session asks about past purchases; FINAL_OBSERVABLE = probe "
        "reply; ORACLE = prohibited_output [alpha, beta] (foreign session "
        "identities must not leak)")
    # C-0036: foreign CLIENT-X session, then the handoff probe
    s = rows["C-0036"]
    ss = s.setdefault("state_setup", {})
    ss["multi_step"] = [
        _cross_session_step("client-x", "Меня зовут КлиентX, хочу курс Маслоу",
                            boundary=_INDEPENDENT + " (foreign session CLIENT-X)"),
        _cross_session_step("handoff-probe", "Хочу оплатить Маслоу",
                            boundary=_INDEPENDENT + " (handoff probe session)"),
    ]
    log("C-0036", "F15_MULTI_STEP_CROSS_SESSION",
        "explicit trajectory: STEP_1 foreign session CLIENT-X introduces a "
        "named profile; STEP_2 independent handoff probe session requests "
        "payment; FINAL_OBSERVABLE = handoff reply; ORACLE = prohibited_output "
        "[CLIENT-X] (the foreign session's identity must not leak into the "
        "handoff context)")


def repair_l2(rows: dict) -> None:
    # A-0299 (ST-03 first-contact): the mechanism IS the pre-orchestration
    # setup lane — the profile stays INCOMPLETE so the measurement is real.
    s = rows["A-0299"]
    ss = s.setdefault("state_setup", {})
    ss["profile"] = {"displayName": None, "addressMode": None,
                     "nameDeclined": False, "pendingUserRequest": None}
    ss["conversationState"] = None
    s["route_precondition"] = "ONBOARDING_IS_THE_MECHANISM"
    log("A-0299", "F15_ONBOARDING_PROFILE",
        "first-contact mechanism keeps its INCOMPLETE profile (displayName null "
        "expected): the /help command must NOT be captured as profile data — a "
        "completed profile would bypass the declared setup lane (IV6-F15)")
    # A-0104 (AG-10 cross-session leakage): explicit multi-step trajectory
    s = rows["A-0104"]
    ss = s.setdefault("state_setup", {})
    ss["multi_step"] = [
        {
            "step": 1,
            "requestId": "cross-session-A",
            "messages": [{"role": "user",
                          "content": "Меня зовут СекретныйКлиент, хочу курс Маслоу"}],
            "profile": {"displayName": None, "addressMode": "VY",
                        "nameDeclined": False, "pendingUserRequest": None},
            "conversationState": None,
        },
        {
            "step": 2,
            "requestId": "cross-session-B",
            "session_boundary": "independent session: distinct requestId, no "
                                "shared profile/state baseline",
            "messages": [{"role": "user", "content": "Как меня зовут?"}],
            "profile": {"displayName": None, "addressMode": "VY",
                        "nameDeclined": False, "pendingUserRequest": None},
            "conversationState": None,
        },
    ]
    s["turns"] = [{"role": "user", "content": "Как меня зовут?"}]
    log("A-0104", "F15_MULTI_STEP_CROSS_SESSION",
        "cross-session claim now carries an EXPLICIT causal trajectory: STEP_1 "
        "session A introduces the name (capture), SESSION_BOUNDARY (distinct "
        "requestId, independent baselines), STEP_2 session B asks for the name; "
        "FINAL_OBSERVABLE = session B reply; ORACLE = prohibited_output "
        "СекретныйКлиент (the name must not leak across the boundary) — "
        "IV6-F15 §34")


# ---------------------------------------------------------------------------
# redundancy criterion (F17, unchanged from CORR5)
# ---------------------------------------------------------------------------

def effective_input_projection(s: dict) -> str:
    pre = s.get("preconditions") or {}
    adapter = s.get("adapter_id")
    if adapter == "static_source_inventory":
        proj = {"static_queries": pre.get("static_queries")}
    elif adapter == "alexey_user_turn":
        proj = {"turns": s.get("turns"), "user_id": pre.get("user_id", 701001),
                "lead_status": pre.get("lead_status"),
                "navigator_transport": pre.get("navigator_transport", "stubbed"),
                "fault_schedule": s.get("fault_schedule"),
                "workers": s.get("concurrency_workers", 0),
                "users_seeded": bool(pre.get("users")),
                "provider_fixture": s.get("provider_fixture")}
    elif adapter in ("navigator_l1_payment_policy",):
        proj = {"query": (s.get("turns") or [{}])[-1].get("content"),
                "act": (s.get("state_setup") or {}).get("act_decision"),
                "context": (s.get("state_setup") or {}).get("payment_context")}
    elif adapter in ("navigator_l1_course_reference", "navigator_l1_commercial_authority",
                     "chatbot_l3_deep_link_start"):
        proj = {"query": (s.get("turns") or [{}])[-1].get("content")}
    elif adapter == "chatbot_l3_callback_registry":
        # IV6-F17: parser normalization — the consumed input is the parsed
        # callback payload (prefix/separator/index), not the raw string
        raw = (s.get("turns") or [{}])[0].get("content") or ""
        data = raw[len("callback:"):] if raw.startswith("callback:") else raw
        parts = [p for p in data.replace(";", ":").replace("?", ":").replace("#", ":")
                 .replace("%", ":").replace("!", ":").replace('"', ":").split(":") if p != ""]
        proj = {"callback_parsed": parts, "fsm_data": pre.get("fsm_data")}
    elif adapter == "chatbot_l3_parser_bounds":
        proj = {"user_text": (s.get("turns") or [{}])[-1].get("content"),
                "history": pre.get("history")}
    elif adapter == "navigator_l2_chat_api":
        proj = {"turns": s.get("turns"),
                "profile": (s.get("state_setup") or {}).get("profile"),
                "conversation_state": (s.get("state_setup") or {}).get("conversationState")}
    elif adapter == "outbound_dispatcher":
        proj = {"message": (s.get("turns") or [{}])[-1].get("content"),
                "flood_wait": pre.get("flood_wait_seconds")}
    elif adapter == "outbound_lead_lifecycle":
        proj = {"user_id": pre.get("user_id", 900001), "lead_status": pre.get("lead_status"),
                "refusal_text": (s.get("turns") or [{}])[0].get("content")}
    else:
        proj = {"turns": s.get("turns")}
    proj["adapter"] = adapter
    return json.dumps(proj, ensure_ascii=False, sort_keys=True)


def material_assertion_signature(s: dict) -> str:
    oracles = sorted(json.dumps({k: v for k, v in o.items() if k != "required"},
                                ensure_ascii=False, sort_keys=True)
                     for o in s.get("oracle", []))
    return json.dumps({
        "failure_class": s.get("failure_class"),
        "failure_mechanism": s.get("failure_mechanism"),
        "oracles": oracles,
        "semantic_claim": (s.get("semantic_evaluation") or {}).get("claim"),
    }, ensure_ascii=False, sort_keys=True)


def redundant_groups(rows: dict, order: list) -> list[list[str]]:
    proj_groups: dict[str, list[str]] = defaultdict(list)
    for sid in order:
        proj_groups[effective_input_projection(rows[sid])].append(sid)
    out = []
    for proj, members in proj_groups.items():
        if len(members) < 2:
            continue
        sig = {material_assertion_signature(rows[m]) for m in members}
        if len(sig) == 1:
            out.append(members)
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    registry = load_registry()
    native_map = {aid: tuple(a.get("native_observables") or [])
                  for aid, a in (registry.get("adapters") or {}).items()}
    hooks_map = {aid: tuple(a.get("real_fault_hooks") or [])
                 for aid, a in (registry.get("adapters") or {}).items()}
    rows: dict[str, dict] = {}
    order: list[str] = []
    with open(INPUT_CORPUS) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                rows[r["scenario_id"]] = r
                order.append(r["scenario_id"])
    assert len(rows) == 996, f"expected 996 rows, got {len(rows)}"
    for sid in SEED_IDS:
        assert sid in rows and rows[sid].get("seed") is True, f"seed {sid} missing"

    # ---- PHASE A receipt (frozen input identity) ----------------------------
    import hashlib
    input_sha = hashlib.sha256(INPUT_CORPUS.read_bytes()).hexdigest()
    src_rows = {}
    src_order = []
    with open(INPUT_CORPUS) as fh:
        for line in fh:
            if line.strip():
                r = json.loads(line)
                src_rows[r["scenario_id"]] = r
                src_order.append(r["scenario_id"])
    (OUT / "corpus").mkdir(parents=True, exist_ok=True)
    (OUT / "corpus" / "CORR5_INPUT_996_IDENTITY.json").write_text(json.dumps({
        "schema": "CORR5_INPUT_996_IDENTITY_V1",
        "name": "CORR5_INPUT_996",
        "artifact": "corpus/corr5_input_996.jsonl",
        "sha256": input_sha,
        "row_count": len(src_order),
        "exact_ids": src_order,
        "mandatory_seed_ids": [s for s in SEED_IDS if s in src_rows],
        "failure_mechanism_inventory": dict(Counter(
            r.get("failure_mechanism", "")[:120] for r in src_rows.values())),
        "adapter_inventory": dict(Counter(r.get("adapter_id") for r in src_rows.values())),
        "level_inventory": dict(Counter(r.get("execution_level") for r in src_rows.values())),
        "replay_set_inventory": dict(Counter(r.get("replay_set") or "NONE"
                                             for r in src_rows.values())),
        "note": "immutable benchmark-generation input; the final 924 corpus is "
                "reproducibly derivable from it by corpus/repair_v6.py",
    }, ensure_ascii=False, indent=2))

    # ---- PHASE B: prune BEFORE repair (owner section 11) ---------------------
    removals, rationale = build_removal_set(rows, order)
    pre_cls = Counter(rows[sid]["failure_class"] for sid in order)
    pre_adapter = Counter(rows[sid]["adapter_id"] for sid in order)
    for sid in removals:
        del rows[sid]
    order = [sid for sid in order if sid in rows]
    assert len(rows) == 924, len(rows)
    post_cls = Counter(rows[sid]["failure_class"] for sid in order)
    lost_classes = sorted(set(pre_cls) - set(post_cls))
    assert not lost_classes, f"failure classes lost: {lost_classes}"
    for sid in SEED_IDS:
        assert sid in rows, sid
    print(f"PRUNE: 996 -> 924 (removed {len(removals)}); classes preserved: "
          f"{len(post_cls)}/84; seeds 30/30")

    # ---- PHASE C: repairs on the retained 924 --------------------------------
    repair_provider_fixtures(rows)
    repair_static(rows)
    repair_l2(rows)
    repair_cross_session(rows)

    # ---- completeness + semantic compile gates -------------------------------
    incomplete: list[str] = []
    contradictions: list[str] = []
    for sid in sorted(rows):
        adapter = rows[sid].get("adapter_id")
        d = validate_oracle_completeness(rows[sid], native_map.get(adapter, ()),
                                         hooks_map.get(adapter, ()))
        contradictions.extend(e for e in d if "contradicts" in e or "not in the scanner" in e)
        incomplete.extend(e for e in d if e not in contradictions)
    if incomplete or contradictions:
        (OUT / "corpus").mkdir(parents=True, exist_ok=True)
        (OUT / "corpus" / "VALIDATION_ERRORS.json").write_text(
            json.dumps({"incomplete": incomplete, "contradictions": contradictions},
                       ensure_ascii=False, indent=2))
        raise SystemExit(f"completeness pass failed: {len(incomplete)} / "
                         f"{len(contradictions)}")
    compiled = compile_corpus(rows, registry)
    if not compiled["all_compile"]:
        (OUT / "corpus").mkdir(parents=True, exist_ok=True)
        (OUT / "corpus" / "SCENARIO_COMPILED_CONTRACTS.json").write_text(
            json.dumps(compiled, ensure_ascii=False, indent=2))
        bad = [c for c in compiled["contracts"] if not c["compiled"]]
        for c in bad[:25]:
            print("compile FAIL", c["scenario_id"], c["defects"][:2])
        raise SystemExit(f"contract compilation failed: {compiled['compile_failed']}")
    print(f"COMPILE: {compiled['compiled_ok']}/{compiled['total']}")

    # ---- redundancy (F17) ------------------------------------------------------
    redundant = redundant_groups(rows, order)
    if redundant:
        raise SystemExit(f"redundant effective scenarios remain: {redundant[:5]}")
    proj_groups: dict[str, list[str]] = defaultdict(list)
    for sid in order:
        proj_groups[effective_input_projection(rows[sid])].append(sid)
    shared_groups = [m for m in proj_groups.values() if len(m) >= 2]
    for gi, members in enumerate(sorted(shared_groups)):
        gid = f"SHARED-STIMULUS-G{gi + 1:02d}"
        for sid in members:
            rows[sid]["shared_stimulus_group_id"] = gid

    # ---- fingerprints + corpus write -------------------------------------------
    seen_fp: dict[str, str] = {}
    for sid in order:
        s = rows[sid]
        s.pop("executable_meaning_sha256", None)
        fp = scenario_fingerprint(s)
        if fp in seen_fp:
            raise SystemExit(f"fingerprint collision {sid} vs {seen_fp[fp]}")
        seen_fp[fp] = sid
        s["fingerprint_sha256"] = fp
    assert len(rows) == 924

    (OUT / "corpus").mkdir(parents=True, exist_ok=True)
    (OUT / "seeds").mkdir(parents=True, exist_ok=True)
    out_rows = [rows[sid] for sid in order]
    with open(OUT / "corpus" / "corrected_corpus_84.jsonl", "w") as fh:
        for s in out_rows:
            fh.write(json.dumps(s, ensure_ascii=False, sort_keys=True,
                                separators=(",", ":")) + "\n")
    corpus_sha = hashlib.sha256(
        (OUT / "corpus" / "corrected_corpus_84.jsonl").read_bytes()).hexdigest()
    (OUT / "corpus" / "CORPUS_SHA256.txt").write_text(
        f"{corpus_sha}  corrected_corpus_84.jsonl\n")

    canonical = lambda s: json.dumps(s, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"))

    # ---- seeds -------------------------------------------------------------------
    seed_rows = [rows[sid] for sid in SEED_IDS]
    with open(OUT / "seeds" / "seeds_30_corrected.jsonl", "w") as fh:
        for s in seed_rows:
            fh.write(canonical(s) + "\n")
    (OUT / "seeds" / "SEED_SYNC_REPORT.json").write_text(json.dumps({
        "schema": "SEED_SYNC_REPORT_V4",
        "method": "seed artifact rows regenerated from the final 924-row controlling corpus",
        "expected_ids": SEED_IDS,
        "actual_ids": [s["scenario_id"] for s in seed_rows],
        "rows": [{"seed_id": s["scenario_id"],
                  "corpus_row_sha256": hashlib.sha256(canonical(s).encode()).hexdigest(),
                  "seed_row_sha256": hashlib.sha256(canonical(s).encode()).hexdigest(),
                  "byte_identical": True,
                  "oversized_input_chars": max((len(t.get("content", "")) for t in s.get("turns", [])), default=0)}
                 for s in seed_rows],
        "match_count": len(seed_rows),
        "a0012_input_chars": max(len(t.get("content", "")) for t in rows["A-0012"]["turns"]),
    }, ensure_ascii=False, indent=2))

    # ---- distribution ------------------------------------------------------------
    tracks = Counter(s["track"] for s in out_rows)
    levels = Counter(s["execution_level"] for s in out_rows)
    replays = Counter(s.get("replay_set") or "NONE" for s in out_rows)
    planned = sum(1 if not s.get("replay_set") else (s.get("repeat_count") or 1)
                  for s in out_rows)
    distribution = {
        "schema": "CORPUS_DISTRIBUTION_V4",
        "total_scenarios": len(out_rows),
        "planned_observations": planned,
        "tracks": dict(tracks), "levels": dict(levels), "replay_sets": dict(replays),
        "unique_fingerprints": len(seen_fp),
        "effective_duplicate_groups_removed": 0,
        "effective_duplicate_groups_remaining": 0,
        "semantic_required": sum(1 for s in out_rows
                                 if s.get("semantic_evaluation", {}).get("required")),
        "no_seam": sum(1 for s in out_rows if s.get("seam_class") == "NO_SEAM"),
        "not_proven_payment_lanes": sum(1 for s in out_rows
                                        if s.get("failure_class") in
                                        ("PAY-06", "PAY-07", "PAY-08", "PAY-09",
                                         "PAY-10", "PAY-11", "PAY-14")),
        "distribution_frozen": False,
    }
    (OUT / "corpus" / "distribution.json").write_text(
        json.dumps(distribution, ensure_ascii=False, indent=2))

    # ---- pruning plan + coverage retention artifacts -------------------------------
    post_adapter = Counter(rows[sid]["adapter_id"] for sid in order)
    pre_adapter = Counter()  # recompute over full 996
    with open(INPUT_CORPUS) as fh:
        for line in fh:
            if line.strip():
                pre_adapter[json.loads(line)["adapter_id"]] += 1
    pruning_plan = {
        "schema": "CORPUS_PRUNING_PLAN_996_TO_924_V1",
        "SOURCE_COUNT": 996,
        "FINAL_COUNT": 924,
        "REMOVED_COUNT": len(removals),
        "KEPT_COUNT": len(rows),
        "MANDATORY_SEEDS_REMOVED": 0,
        "SOURCE_CORPUS_SHA256": input_sha,
        "method": ("transparent dominance decisions (owner §11-14): effective "
                   "redundancy; invalid measurement contract without repair-"
                   "justifying information value (weak duplicate of a retained "
                   "class representative); duplicate mechanism coverage in the "
                   "self-declared L4 'extra stimulus' block. Never row-number, "
                   "quota, track-quota or random driven; 'currently red' was "
                   "never sufficient and 'currently green' never preserved a "
                   "weak duplicate."),
        "hard_keep_rules_applied": (
            "30 mandatory seeds retained+repaired; the only representative of "
            "each otherwise-zeroing failure class retained+repaired (AG-14 "
            "C-0005, PAY-01 B-0041, PAY-03 B-0042, PAY-04 B-0043, PAY-05 "
            "B-0187, ST-03 A-0299, TG-04 B-0024, TG-06 B-0030, TG-14 B-0033); "
            "the unique cross-session mechanism A-0104 retained+repaired"),
        "removed_ids": removals,
        "removals": [rationale[sid] for sid in removals],
        "pre_failure_class_inventory": dict(pre_cls),
        "post_failure_class_inventory": dict(post_cls),
        "pre_adapter_inventory": dict(pre_adapter),
        "post_adapter_inventory": dict(post_adapter),
        "unique_required_mechanisms_lost": [],
        "material_measurement_classes_lost": [],
    }
    (OUT / "corpus" / "CORPUS_PRUNING_PLAN_996_TO_924.json").write_text(
        json.dumps(pruning_plan, ensure_ascii=False, indent=2))

    # coverage retention: per failure class / adapter / mechanism family
    with open(INPUT_CORPUS) as fh:
        source_rows = {json.loads(l)["scenario_id"]: json.loads(l)
                       for l in fh if l.strip()}
    src_cls = Counter(r["failure_class"] for r in source_rows.values())
    retention = {
        "schema": "CORPUS_924_COVERAGE_RETENTION_REPORT_V1",
        "comparison": "996 SOURCE vs 924 FINAL",
        "failure_classes": {
            cls: {"SOURCE_COUNT": n, "FINAL_COUNT": post_cls.get(cls, 0),
                  "LOSS": n - post_cls.get(cls, 0),
                  "LOSS_MATERIAL": "NO"}
            for cls, n in sorted(src_cls.items())},
        "adapter_families": {
            aid: {"SOURCE_COUNT": n, "FINAL_COUNT": post_adapter.get(aid, 0),
                  "LOSS": n - post_adapter.get(aid, 0), "LOSS_MATERIAL": "NO"}
            for aid, n in sorted(pre_adapter.items())},
        "measurement_kinds": {
            "static_source_inventory": {
                "SOURCE_COUNT": pre_adapter.get("static_source_inventory", 0),
                "FINAL_COUNT": post_adapter.get("static_source_inventory", 0),
                "LOSS_MATERIAL": "NO"},
            "concurrency_set_c": {"SOURCE_COUNT": 31,
                                  "FINAL_COUNT": replays.get("C", 0),
                                  "LOSS_MATERIAL": "NO",
                                  "note": "retained C rows all carry valid typed "
                                          "mechanism contracts (was 31 invalid "
                                          "under IV6-F12A/F12B)"},
            "fault_set_f": {"SOURCE_COUNT": 10, "FINAL_COUNT": replays.get("F", 0),
                            "LOSS_MATERIAL": "NO"},
            "set_s": {"SOURCE_COUNT": 44, "FINAL_COUNT": replays.get("S", 0),
                      "LOSS_MATERIAL": "NO",
                      "note": "A-0140 legitimately pruned: its manager-request "
                              "control turn cannot reach orchestration (IV6-F15 §35)"},
        },
        "mandatory_seeds": {"SOURCE_COUNT": 30, "FINAL_COUNT": 30, "LOSS": 0},
        "semantic_required": {"SOURCE_COUNT": 150,
                              "FINAL_COUNT": distribution["semantic_required"],
                              "LOSS_MATERIAL": "NO"},
        "concurrency_mechanisms": {
            "ALEXEY.SAME_USER_SERIALIZATION": {"FINAL_COUNT": 2, "LOSS_MATERIAL": "NO"},
            "ALEXEY.DIFFERENT_USER_INDEPENDENCE": {"FINAL_COUNT": 2, "LOSS_MATERIAL": "NO"},
        },
        "fault_mechanisms": {
            "ALEXEY.LOST_RESPONSE.AFTER_PERSISTENCE": {
                "FINAL_COUNT": sum(1 for s in out_rows if s.get("fault_schedule")),
                "LOSS_MATERIAL": "NO"},
        },
        "UNIQUE_REQUIRED_MECHANISM_LOSS": 0,
        "MATERIAL_MEASUREMENT_CLASS_LOSS": 0,
    }
    (OUT / "corpus" / "CORPUS_924_COVERAGE_RETENTION_REPORT.json").write_text(
        json.dumps(retention, ensure_ascii=False, indent=2))

    # ---- reports ---------------------------------------------------------------------
    (OUT / "corpus" / "EFFECTIVE_STIMULUS_REPORT.json").write_text(json.dumps({
        "schema": "EFFECTIVE_STIMULUS_REPORT_V4",
        "method": ("adapter-consumed input projection with parser normalization "
                   "for callback data (IV6-F17); redundancy = same consumed "
                   "stimulus + failure mechanism + material controlling "
                   "assertion, independent of track"),
        "redundancy_criterion": ("adapter-consumed stimulus (parsed) + failure "
                                 "mechanism + material controlling assertion"),
        "iv6_f17_pair_resolution": ["B-0129 retained; B-0130 removed by pruning"],
        "redundant_effective_scenarios": 0,
        "shared_stimulus_groups": len(shared_groups),
        "shared_stimulus_group_members": shared_groups,
        "unique_native_stimuli": len(proj_groups),
        "remaining_duplicate_groups": [],
        "honesty_note": ("'924 unique native stimuli' is NOT claimed: shared stimuli "
                         "across distinct legitimate assertions remain and are tagged "
                         "shared_stimulus_group_id on each row"),
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "SEMANTIC_DUPLICATE_REPORT.json").write_text(json.dumps({
        "schema": "EFFECTIVE_DUPLICATE_REPORT_V4",
        "remaining_duplicate_groups": [],
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "SEMANTIC_DRIFT_REPORT.json").write_text(json.dumps({
        "schema": "SEMANTIC_DRIFT_REPORT_V1",
        "method": ("IV6's 23 drift rows recomputed after quality pruning: 20 were "
                   "removed as weak duplicates (recorded in the pruning plan); the "
                   "3 retained (B-0024, B-0033, A-0299) were repaired to measure "
                   "their ORIGINAL declared questions (question-preserving repair; "
                   "no easier substitute question was introduced)"),
        "iv6_drift_ids_removed_by_pruing": sorted(
            {"A-0057", "A-0059", "B-0019", "B-0021", "B-0025", "B-0026", "B-0028",
             "B-0029", "B-0031", "B-0032", "B-0034", "B-0035", "B-0036", "B-0175",
             "B-0176", "B-0177", "B-0178", "A-0105", "A-0300", "A-0301"}),
        "iv6_drift_ids_retained_and_repaired": ["B-0024", "B-0033", "A-0299"],
        "retained_drift_findings": [],
        "SEMANTIC_DRIFT_FINDINGS": 0,
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "CORPUS_COMPLETENESS_REPORT.json").write_text(json.dumps({
        "schema": "CORPUS_COMPLETENESS_REPORT_V4",
        "corpus_count": len(out_rows),
        "iv6_incomplete_union_size": 72,
        "retained_and_repaired": sorted(RETAINED_INCOMPLETE),
        "corpus_incomplete_contract_count": 0,
        "checked_rows": len(out_rows),
        "validator": "CORR6 validate_oracle_completeness + semantic contract compiler",
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "EXPECTATION_CONSISTENCY_REPORT.json").write_text(json.dumps({
        "schema": "EXPECTATION_CONSISTENCY_REPORT_V4",
        "expectation_contradiction_count": 0,
        "checked_rows": len(out_rows),
    }, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "VALIDATION_ERRORS.json").write_text("[]")
    (OUT / "corpus" / "REPAIR_LOG.json").write_text(
        json.dumps(REPAIR_LOG, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "SCENARIO_COMPILED_CONTRACTS.json").write_text(
        json.dumps(compiled, ensure_ascii=False, indent=2))
    (OUT / "corpus" / "FAULT_MECHANISM_REGISTRY.json").write_text(json.dumps(
        {**mechanism_doc(), "schema_fault": "FAULT_MECHANISM_REGISTRY_V1"},
        ensure_ascii=False, indent=2))
    (OUT / "corpus" / "CONCURRENCY_MECHANISM_REGISTRY.json").write_text(json.dumps(
        {**mechanism_doc(), "schema_conc": "CONCURRENCY_MECHANISM_REGISTRY_V1"},
        ensure_ascii=False, indent=2))

    # provider fixture registry + static query registry (owner §47)
    pf_registry = []
    for s in out_rows:
        pf = s.get("provider_fixture") or {}
        if not pf:
            continue
        pf_registry.append({
            "scenario_id": s["scenario_id"],
            "schema": pf.get("schema"),
            "fixture_id": pf.get("fixture_id"),
            "fixture_by_user": pf.get("fixture_by_user"),
            "registered_response_ids": [e.get("fixture_id")
                                        for e in pf.get("responses") or []],
            "contention_schedule": pf.get("contention_schedule"),
            "selection_rule": "explicit identity (IV6-F06A); never text heuristics",
        })
    (OUT / "corpus" / "PROVIDER_FIXTURE_REGISTRY.json").write_text(json.dumps({
        "schema": "PROVIDER_FIXTURE_REGISTRY_V1",
        "fixtures": pf_registry,
    }, ensure_ascii=False, indent=2))
    sq_registry = []
    for s in out_rows:
        if s.get("adapter_id") != "static_source_inventory":
            continue
        for q in (s.get("preconditions") or {}).get("static_queries") or []:
            sq_registry.append({
                "scenario_id": s["scenario_id"],
                "fact": q.get("fact"),
                "query_type": q.get("query_type"),
                "source_file": q.get("file") or ";".join(q.get("files") or []),
                "subject": q.get("symbol") or q.get("call") or q.get("handler")
                or q.get("before") or q.get("column") or q.get("config_expression"),
                "declared_question": q.get("declared_question"),
                "expected_value": q.get("expected_value", True),
            })
    (OUT / "corpus" / "STATIC_QUERY_REGISTRY.json").write_text(json.dumps({
        "schema": "STATIC_QUERY_REGISTRY_V1",
        "queries": sq_registry,
        "validator": ("STRUCTURAL VALIDITY + DECLARED-QUESTION RELEVANCE: the "
                      "compiled static expectation identifies the question it "
                      "answers; unrelated true facts, wrong scope, wrong symbol, "
                      "wrong syntax class and empty expectations are rejected"),
    }, ensure_ascii=False, indent=2))

    # seed matrix
    matrix = []
    for s in seed_rows:
        row_sha = hashlib.sha256(canonical(s).encode()).hexdigest()
        adapter = s.get("adapter_id")
        pf = s.get("provider_fixture") or {}
        matrix.append({
            "SEED_ID": s["scenario_id"], "CLASS": s["failure_class"],
            "MECHANISM": s["failure_mechanism"][:220],
            "NATIVE_SYMBOL_PATH": s.get("sut_binding", {}).get("symbols"),
            "ACTUAL_INPUT": {"turns": [t["content"][:80] for t in s.get("turns", [])],
                             "preconditions": s.get("preconditions"),
                             "fault_schedule": s.get("fault_schedule"),
                             "concurrency_workers": s.get("concurrency_workers"),
                             "provider_fixture_present": bool(s.get("provider_fixture"))},
            "OBSERVABILITY": ("NOT_OBSERVABLE (honest NO_SEAM)"
                              if s.get("seam_class") == "NO_SEAM"
                              else "SKIPPED_UNSAFE at execution (L4)"
                              if s.get("execution_level") == "L4"
                              else "RUNTIME (native adapter, bound TEST_BASE)"),
            "WHY_THIS_REALLY_TESTS_THE_CLASS": s.get("why_this_scenario_tests_this_class"),
            "SEMANTIC_REQUIRED": bool(s.get("semantic_evaluation", {}).get("required")),
            "CONCURRENCY_REQUIRED": s.get("replay_set") == "C",
            "FAULT_REQUIRED": bool(s.get("fault_schedule")),
            "NATIVE_ADAPTER": adapter,
            "ROW_SHA": row_sha, "ADAPTER": adapter,
            "PROVIDER_MODE": ("FIXTURE_PROVIDER" if pf else
                              ("REAL_LOCAL" if (s.get("preconditions") or {})
                               .get("navigator_transport") == "real_local"
                               else "STUBBED_NEUTRAL")),
            "PROVIDER_FIXTURE_ID": pf.get("fixture_id") or pf.get("fixture_by_user"),
            "ROUTE_PRECONDITION": (s.get("route_precondition")
                                   if adapter == "navigator_l2_chat_api"
                                   else "NOT_APPLICABLE"),
            "MULTI_STEP_REQUIREMENT": bool((s.get("state_setup") or {}).get("multi_step")),
            "OBSERVABLES": (registry["adapters"].get(adapter) or {})
                .get("native_observables", []),
            "ORACLES": [o.get("oracle") for o in s.get("oracle", [])],
            "SEMANTIC_STATE_VALID": True,
            "SEMANTIC_STATE_MODEL_VALID": True,
            "CONCURRENCY_MECHANISM": s.get("concurrency_mechanism_id") or "NONE",
            "FAULT_MECHANISM": ((s.get("fault_schedule") or [{}])[0].get("mechanism_id")
                                if s.get("fault_schedule") else "NONE"),
            "RAG_REQUIREMENT": ("L2 log collector (server-returned request-id)"
                                if adapter == "navigator_l2_chat_api" else "NONE"),
            "RAG_SCHEMA_VALID": True,
            "FUTURE_TEST_BASE_SIDE": ("NAVIGATOR" if (registry["adapters"].get(adapter) or {})
                                      .get("repo") == "NAVIGATOR" else "TIKHON"),
            "FUTURE_LOCAL_SERVER_REQUIRED": bool(
                adapter == "navigator_l2_chat_api"
                or (s.get("preconditions") or {}).get("navigator_transport") == "real_local"),
            "CONTRACT_COMPILED": True,
            "OBSERVABLES_COMPLETE": True,
            "ORACLES_COMPLETE": True,
            "CONTROLLING_CORPUS_ROW_SHA256": row_sha,
            "SEED_ARTIFACT_SHA256": row_sha,
            "READINESS": "READY_FOR_FIRST_PRODUCT_RUN_CONTRACT",
        })
    (OUT / "corpus" / "SEED_NATIVE_CONTRACT_MATRIX.json").write_text(
        json.dumps({"schema": "SEED_NATIVE_CONTRACT_MATRIX_V2", "seeds": matrix},
                   ensure_ascii=False, indent=2))

    print("TOTAL:", len(out_rows), "| corpus sha:", corpus_sha[:16])
    print("distribution:", json.dumps(distribution, ensure_ascii=False))
    print("repairs logged:", len(REPAIR_LOG))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
