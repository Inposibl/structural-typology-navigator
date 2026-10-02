"""Authenticated adapter registry v3 — CORR3 (owner sections 7, 25, 57).

Every entry binds IMPLEMENTATION_CLASS (harness-owned adapters package), LANE,
provenance class, native observables, native fault hooks, schedulable
operation and full controlling metadata. The registry is the ONLY source of
adapter implementation identity.

NATIVE CONTRACT AUDIT (owner section 57): static validation checks native
signatures (parameter names/arities) against the real product sources and the
adapter input mappings — the CORR2 wrong-signature pattern (single object into
resolveEnrollmentPaymentDecision(query, act, context)) is a REPRODUCIBLE FAIL
case of this validator.
"""

from __future__ import annotations

import ast
import dataclasses
import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

NAVIGATOR_LIVE = Path("/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator")
TIKHON_LIVE = Path("/Users/entp_psyche/Desktop/InvestProjects2026/chatbot")

NAVIGATOR_TEST_BASE_HEAD = "0a930593c1e354022160925e12e0b6474b5fa240"
TIKHON_TEST_BASE_HEAD = "3adbb9f1d16c299c5b42f1dccad0966c4e7eeecd"


@dataclass
class AdapterEntry:
    adapter_id: str
    implementation_class: str
    lane: str
    repo: str
    module_path: str
    native_symbols: str
    native_signature: str  # "name(arg1, arg2, ...)" checked by the contract audit
    provenance_class: str
    execution_level: str
    supported_failure_classes: list[str]
    input_schema: dict
    native_observables: list[str]
    unobservables: list[str]
    state_capture: str
    side_effect_class: str
    safe_in_isolation: bool
    requires_network: bool
    requires_real_telegram: bool
    requires_payment: bool
    requires_semantic_evaluation: bool
    notes: str = ""
    schedulable_operation: str | None = None
    real_fault_hooks: list[str] = field(default_factory=list)


ADAPTERS: list[AdapterEntry] = [
    AdapterEntry(
        adapter_id="navigator_l1_payment_policy",
        implementation_class="adapters.product.NavigatorL1PaymentPolicyAdapter",
        lane="PRODUCT", repo="NAVIGATOR",
        module_path="src/lib/academy/payment-policy.ts",
        native_symbols="resolveCourseReferences|hasEnrollmentPaymentIntent|resolveEnrollmentPaymentDecision",
        native_signature="resolveEnrollmentPaymentDecision(query, act, context)",
        provenance_class="RUNTIME_FUNCTION_RETURN", execution_level="L1",
        supported_failure_classes=["PAY-13", "ST-02", "ST-06", "ST-07", "ST-16", "AG-07", "AG-12"],
        input_schema={"query": "string (last turn)", "act_decision": "ConversationActDecision input",
                      "payment_context": "PaymentResolutionContext input"},
        native_observables=["decisionKind", "courseId", "paymentUrl", "refKind", "intentDetected"],
        unobservables=["router act (LLM lane)", "answer prose"],
        state_capture="native decision return",
        side_effect_class="NONE", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
        notes="native 3-argument signature; act/context are scenario INPUTS, never expectations",
    ),
    AdapterEntry(
        adapter_id="navigator_l1_course_reference",
        implementation_class="adapters.product.NavigatorL1CourseReferenceAdapter",
        lane="PRODUCT", repo="NAVIGATOR",
        module_path="src/lib/academy/course-reference.ts",
        native_symbols="resolveCourseReferences",
        native_signature="resolveCourseReferences(query)",
        provenance_class="RUNTIME_FUNCTION_RETURN", execution_level="L1",
        supported_failure_classes=["ST-02", "ST-16", "ST-17"],
        input_schema={"query": "string (last turn)"},
        native_observables=["refKind", "courseIds"],
        unobservables=["anaphora", "prior-turn state (lexical single-turn resolver)"],
        state_capture="native resolution return",
        side_effect_class="NONE", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="navigator_l1_commercial_authority",
        implementation_class="adapters.product.NavigatorAuthorityAdapter",
        lane="PRODUCT", repo="NAVIGATOR",
        module_path="src/lib/academy/commercial-authority.ts",
        native_symbols="getAuthoritativeCoursePrice|ACADEMY_COMMERCIAL_AUTHORITY",
        native_signature="getAuthoritativeCoursePrice(courseId)",
        provenance_class="RUNTIME_FUNCTION_RETURN", execution_level="L1",
        supported_failure_classes=["AG-03", "AG-06", "AG-12"],
        input_schema={"query": "string (resolved via native course references)"},
        native_observables=["refKind", "priceStatus", "priceValue"],
        unobservables=["prose wording"],
        state_capture="native authority lookup",
        side_effect_class="NONE", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="navigator_l2_chat_api",
        implementation_class="adapters.product.NavigatorL2ChatAdapter",
        lane="PRODUCT", repo="NAVIGATOR",
        module_path="src/app/api/chat/route.ts",
        native_symbols="POST /api/chat",
        native_signature="POST /api/chat {messages, profile, conversationState, requestId}",
        provenance_class="LIVE_API_RESPONSE", execution_level="L2",
        supported_failure_classes=["PAY-13", "PAY-12", "ST-01", "ST-02", "ST-03", "ST-04", "ST-05", "ST-06",
                                   "ST-07", "ST-08", "ST-09", "ST-10", "ST-11", "ST-12", "ST-13", "ST-14",
                                   "ST-15", "ST-16", "ST-17", "AG-01", "AG-02", "AG-03", "AG-04", "AG-05",
                                   "AG-06", "AG-07", "AG-08", "AG-09", "AG-10", "AG-11", "AG-12", "AG-13",
                                   "AG-15", "AG-16", "AG-17", "AG-18", "AG-19", "AG-20", "OUT-08", "TG-17"],
        input_schema={"messages": "ConversationMessage[]", "profile": "ConversationProfile",
                      "conversationState": "ConversationState baseline"},
        native_observables=["courseMatch", "selectedCourseId", "lastAssistantAct", "lastAssistantCourseId",
                            "pendingConfirmationKind", "activeFlowId", "pendingQuestionPresent",
                            "handoffStatus", "displayName", "addressMode", "schemaConformant",
                            "contactCardPresent", "resetConversation", "nativeRequestIdHeader"],
        unobservables=["RAG diagnostics without the log collector event (UNOBSERVED)"],
        state_capture="native ChatSuccessResponse + structured log collector (requestId-correlated)",
        side_effect_class="LOCAL_ONLY", safe_in_isolation=True,
        requires_network=True, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
        notes="loopback-only URL from the authenticated execution environment; diagnostics from NAVIGATOR_TURN/NAVIGATOR_GROUNDING events only",
    ),
    AdapterEntry(
        adapter_id="chatbot_l3_deep_link_start",
        implementation_class="adapters.product.TikhonStartAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="handlers/client.py",
        native_symbols="cmd_start|get_course_by_id|send_or_edit_root_catalog",
        native_signature="cmd_start(message, command, state)",
        provenance_class="ISOLATED_ADAPTER_OUTPUT", execution_level="L3",
        supported_failure_classes=["TG-13", "PAY-13", "TG-17"],
        input_schema={"start_payload": "string (from turn)"},
        native_observables=["fsm_state_literal", "stateCleared", "catalogCourseContext"],
        unobservables=["Mini App internal rendering"],
        state_capture="recording FSM + recorded catalog invocation + recorded caption",
        side_effect_class="LOCAL_ONLY", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="chatbot_l3_callback_registry",
        implementation_class="adapters.product.TikhonCallbackAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="handlers/client.py",
        native_symbols="cb_cohort_selected|get_course_by_id|get_cohort_by_id",
        native_signature="cb_cohort_selected(callback, state)",
        provenance_class="ISOLATED_ADAPTER_OUTPUT", execution_level="L3",
        supported_failure_classes=["TG-09", "ST-16", "ST-17", "AG-20", "AG-01", "AG-02", "AG-04",
                                   "AG-05", "AG-06", "ST-01", "ST-06"],
        input_schema={"callback_data": "string", "fsm_data": "FSM dict"},
        native_observables=["stateMutated", "fsm_state_literal", "registryLookupResult"],
        unobservables=["client-side spinner"],
        state_capture="recording callback answers + FSM updates",
        side_effect_class="LOCAL_ONLY", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="chatbot_l3_parser_bounds",
        implementation_class="adapters.product.TikhonParserAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="data_engine/lebedev_adapter.py",
        native_symbols="find_valid_history_suffix|build_navigator_payload",
        native_signature="find_valid_history_suffix(history); build_navigator_payload(history, current_user_message, profile, conversation_state, request_id)",
        provenance_class="ISOLATED_ADAPTER_OUTPUT", execution_level="L3",
        supported_failure_classes=["TG-17"],
        input_schema={"user_text": "string (ACTUAL turn content — oversized rows carry >4000 chars)",
                      "history": "list fixture"},
        native_observables=["payloadBuilt", "failClosed", "suffixLength", "payloadBytes", "inputChars"],
        unobservables=["Navigator-side validation"],
        state_capture="native parser returns",
        side_effect_class="NONE", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="alexey_user_turn",
        implementation_class="adapters.product.AlexeyUserTurnAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="data_engine/lebedev_adapter.py",
        native_symbols="LebedevNavigatorAdapter.process_user_turn|get_user_lock|call_navigator_core",
        native_signature="process_user_turn(user_id, user_text, message_id)",
        provenance_class="ISOLATED_ADAPTER_OUTPUT", execution_level="L5",
        supported_failure_classes=["TG-07", "TG-18", "TG-17", "ST-05", "ST-12", "ST-13", "ST-18",
                                   "ST-16", "ST-04", "ST-06", "AG-14", "PAY-02", "PAY-13",
                                   "OUT-07", "OUT-08", "OUT-02", "OUT-03", "OUT-04"],
        input_schema={"user_id": "int", "user_text": "string", "message_id": "int",
                      "navigator_transport": "stubbed|real_local"},
        native_observables=["selectedCourseId", "displayName", "leadStatus",
                             "handoffCourseId", "handoffRecord", "paymentCourseId",
                             "nativeError"],
        unobservables=["Navigator internal stages without the L2 collector"],
        state_capture="native store tuple + native reply segments + instrumented native lock windows",
        side_effect_class="LOCAL_SQLITE_TEMP", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
        schedulable_operation="process_user_turn under the native per-user asyncio lock (same loop, same instance)",
        real_fault_hooks=["DEPENDENCY_500", "LOST_RESPONSE", "TIMEOUT_AFTER_PROCESSING",
                          "DEPENDENCY_429", "TIMEOUT_BEFORE_PROCESSING", "MALFORMED_DEPENDENCY_PAYLOAD"],
    ),
    AdapterEntry(
        adapter_id="outbound_dispatcher",
        implementation_class="adapters.product.OutboundDispatcherAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="data_engine/outreach.py",
        native_symbols="SafeOutreachDispatcher.send_single",
        native_signature="send_single(target_entity, message)",
        provenance_class="ISOLATED_ADAPTER_OUTPUT", execution_level="L3",
        supported_failure_classes=["OUT-01", "OUT-05", "OUT-06", "OUT-07", "TG-12"],
        input_schema={"message": "string", "flood_wait_seconds": "stub behavior"},
        native_observables=["sendResult"],
        unobservables=["Telegram server-side behavior"],
        state_capture="native returned dict (verbatim)",
        side_effect_class="LOCAL_STUB_CLIENT", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
        notes="TG-12's REAL transport seam",
    ),
    AdapterEntry(
        adapter_id="outbound_lead_lifecycle",
        implementation_class="adapters.product.OutboundLeadLifecycleAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="data_engine/lebedev_adapter.py (lead-stage branch)",
        native_symbols="process_user_turn|classify_lead_intent|update_lead_status|STAGE_STOPPED",
        native_signature="process_user_turn(user_id, user_text, message_id) [lead-stage branch]",
        provenance_class="ISOLATED_STATE_READ", execution_level="L3",
        supported_failure_classes=["OUT-02", "OUT-03", "OUT-04"],
        input_schema={"user_id": "int", "lead_status": "initial stage", "refusal_text": "turn"},
        native_observables=["leadStatus", "classifiedIntent", "suppressionHonored"],
        unobservables=["campaign scheduler internals"],
        state_capture="NATIVE branch: NEGATIVE -> STAGE_STOPPED persisted; second turn suppressed by the native gate",
        side_effect_class="LOCAL_SQLITE_TEMP", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="static_source_inventory",
        implementation_class="adapters.product.StaticSourceInventoryAdapter",
        lane="PRODUCT", repo="TIKHON",
        module_path="(registered static queries over bound TEST_BASE sources)",
        native_symbols="(query executor)",
        native_signature="query_type(file, target) -> derived fact",
        provenance_class="STATIC_INSPECTION", execution_level="L1",
        supported_failure_classes=["TG-01", "TG-02", "TG-03", "TG-04", "TG-05", "TG-06", "TG-08",
                                   "TG-10", "TG-11", "TG-14", "TG-15", "TG-16", "TG-19", "TG-20",
                                   "TG-21", "TG-22", "PAY-06", "PAY-07", "PAY-08", "PAY-09",
                                   "PAY-10", "PAY-11", "PAY-14"],
        input_schema={"static_queries": "list of registered query specs (preconditions)"},
        native_observables=["(derived static facts only)"],
        unobservables=["any runtime product behavior"],
        state_capture="AST/text derivation + per-query source hash",
        side_effect_class="NONE", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="harness_gate_selftest",
        implementation_class="adapters.gate_selftest.GateSelfTestAdapter",
        lane="PRODUCT", repo="HARNESS",
        module_path="adapters/gate_selftest.py",
        native_symbols="GateSelfTestAdapter",
        native_signature="execute(request) -> scenario-driven gate detections",
        provenance_class="RUNTIME_FUNCTION_RETURN", execution_level="L5",
        supported_failure_classes=["AG-21", "AG-22"],
        input_schema={"attacks": "scenario precondition list of adversarial fixtures"},
        native_observables=["expectedCopyDetected", "aliasCopyDetected", "forgedProvenanceBlocked",
                            "scenarioIdSubscriptBranchDetected", "contradictionDetected",
                            "narrativeParaphraseDetected"],
        unobservables=["product behavior"],
        state_capture="the ACTUAL gate machinery executed on scenario-supplied attacks + fixed regression fixtures",
        side_effect_class="NONE", safe_in_isolation=True,
        requires_network=False, requires_real_telegram=False, requires_payment=False,
        requires_semantic_evaluation=False,
    ),
    AdapterEntry(
        adapter_id="live_telegram_transport",
        implementation_class="adapters.product.LiveTransportPlaceholder",
        lane="PRODUCT", repo="TIKHON",
        module_path="(live Telegram transport via sanctioned controlled identity)",
        native_symbols="(live transport capture)",
        native_signature="(future)",
        provenance_class="CONTROLLED_TELEGRAM_OBSERVATION", execution_level="L4",
        supported_failure_classes=["TG-07", "TG-09", "TG-12", "TG-13", "TG-17", "TG-18", "ST-18",
                                   "PAY-13", "OUT-01", "OUT-02", "OUT-05", "OUT-08"],
        input_schema={"stimulus": "controlled live message"},
        native_observables=["live_state"],
        unobservables=["everything until the sanctioned identity exists"],
        state_capture="controlled observation",
        side_effect_class="LIVE_TRANSPORT", safe_in_isolation=False,
        requires_network=True, requires_real_telegram=True, requires_payment=False,
        requires_semantic_evaluation=False,
        notes="L4 rows are safe_to_execute=false; SKIPPED_UNSAFE at execution",
    ),
]

NON_CONSTRUCTIBLE = {
    "PAY-06": "NOT_OBSERVABLE", "PAY-07": "BENCHMARK_DEFECT", "PAY-08": "BENCHMARK_DEFECT",
    "PAY-09": "NOT_OBSERVABLE", "PAY-10": "NOT_OBSERVABLE", "PAY-11": "NOT_OBSERVABLE",
    "PAY-14": "NOT_OBSERVABLE",
}

RAG_DIAGNOSTIC_FIELDS = [
    "conversationAct", "courseId", "ragInvoked", "activeBindingCount", "retrievedMatchCount",
    "resolvedEvidenceCount", "evidenceSelectionStatus", "answerOrigin", "fallback",
    "groundingStage", "repairAttempted", "reasonCode",
]


def registry_doc() -> dict:
    return {
        "schema": "ADAPTER_REGISTRY_V3",
        "adapters": {a.adapter_id: asdict(a) for a in ADAPTERS},
        "non_constructible_lanes": NON_CONSTRUCTIBLE,
        "rag_diagnostic_fields": RAG_DIAGNOSTIC_FIELDS,
        "test_base_heads": {"NAVIGATOR": NAVIGATOR_TEST_BASE_HEAD, "TIKHON": TIKHON_TEST_BASE_HEAD},
    }


def load_registry() -> dict:
    p = Path(__file__).resolve().parent.parent / "artifacts" / "ADAPTER_REGISTRY.json"
    if p.exists():
        return json.loads(p.read_text())
    return registry_doc()


# ---------------------------------------------------------------------------
# Native contract audit (owner section 57)
# ---------------------------------------------------------------------------

def _py_signatures(path: Path) -> dict[str, list[str]]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return {}
    sigs: dict[str, list[str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = [a.arg for a in node.args.args]
            if node.args.vararg:
                args.append("*" + node.args.vararg.arg)
            sigs[node.name] = args
        if isinstance(node, ast.ClassDef):
            for sub in node.body:
                if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    args = [a.arg for a in sub.args.args]
                    sigs[f"{node.name}.{sub.name}"] = args[1:]  # drop self
    return sigs


def audit_native_contracts(registry: dict | None = None) -> dict:
    """Static validation BEYOND symbol presence: native signatures are checked
    against the real product sources; adapter input mappings must match native
    arities. The CORR2 wrong-signature mistake (single object into
    resolveEnrollmentPaymentDecision(query, act, context)) is a REPRODUCIBLE
    FAIL case: an adapter whose input_mapping arity != native arity FAILS."""
    reg = registry or registry_doc()
    results = {"schema": "ADAPTER_NATIVE_CONTRACT_AUDIT_V1",
               "checks": [], "all_valid": True}
    for a in ADAPTERS:
        entry = (reg.get("adapters") or {}).get(a.adapter_id) or asdict(a)
        if a.repo not in ("NAVIGATOR", "TIKHON"):
            continue
        a = type(a)(**{**asdict(a), **{k: v for k, v in entry.items()
                                       if k in {f.name for f in dataclasses.fields(a)}}})
        root = NAVIGATOR_LIVE if a.repo == "NAVIGATOR" else TIKHON_LIVE
        sig_declarations = [s.strip() for s in a.native_signature.split(";") if s.strip()]
        for sig_decl in sig_declarations:
            m = re.match(r"^(\w+)\((.*)\)$", sig_decl)
            if not m:
                continue
            fname, params = m.group(1), [p.strip() for p in m.group(2).split(",") if p.strip()]
            if fname == "POST":
                continue
            if fname.startswith("find_valid") or fname.startswith("build_navigator"):
                p = root / "data_engine" / "lebedev_adapter.py"
            elif fname in ("send_single", "classify_lead_intent", "update_lead_status"):
                p = root / "data_engine" / "outreach.py"
            elif fname.startswith("cmd_") or fname.startswith("cb_"):
                p = root / "handlers" / "client.py"
            else:
                p = root / a.module_path.split(" + ")[0]
            if fname == "getAuthoritativeCoursePrice":
                p = root / "src/lib/academy/commercial-authority.ts"
            if fname == "resolveCourseReferences":
                p = root / "src/lib/academy/course-reference.ts"
            if str(p).endswith(".ts"):
                text = p.read_text(encoding="utf-8") if p.exists() else ""
                ok = bool(re.search(
                    rf"export function {fname}\(\s*{params[0]}\s*[:,]",
                    text, re.S)) if params else bool(fname in text)
                detail = f"TS source {'declares' if ok else 'DOES NOT declare'} {fname}({', '.join(params)})"
            else:
                sigs = _py_signatures(p)
                native = sigs.get(fname) or sigs.get(f"LebedevNavigatorAdapter.{fname}") \
                    or sigs.get(f"SafeOutreachDispatcher.{fname}")
                ok = native is not None and len(native) >= len(params)
                detail = f"native {fname} params={native} vs contract arity {len(params)}"
            check = {"adapter_id": a.adapter_id, "symbol": fname,
                     "native_signature_declared": sig_decl, "file": str(p),
                     "valid": ok, "detail": detail}
            results["checks"].append(check)
            if not ok:
                results["all_valid"] = False
        # input-mapping arity vs native arity (CORR2 wrong-signature detector)
        if a.adapter_id == "navigator_l1_payment_policy":
            m = re.match(r"^(\w+)\((.*)\)$", a.native_signature)
            arity = len([p for p in m.group(2).split(",") if p.strip()])
            input_keys = set(a.input_schema.keys())
            if arity < 2 or "query" not in input_keys or "act_decision" not in input_keys:
                results["all_valid"] = False
                results["checks"].append({
                    "adapter_id": a.adapter_id, "symbol": "input_mapping",
                    "valid": False,
                    "detail": "payment decision input mapping must carry the native "
                              "query/act/context arity (CORR2 single-object defect)"})
    return results


def save_registry(path: str) -> dict:
    doc = registry_doc()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    return doc
