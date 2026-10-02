"""Real product-capture adapters v3 — CORR3 (B-6; owner sections 25-35, 58-59).

ADAPTER STANDARD (owner section 25): each adapter documents its
NATIVE_CALL_GRAPH, INPUT_MAPPING, OUTPUT_MAPPING, STATE_MAPPING,
SIDE_EFFECT_BOUNDARY, ERROR_MAPPING, OBSERVABLES and UNOBSERVABLES (machine
artifacts: ADAPTER_NATIVE_CONTRACT_AUDIT.json). Static symbol existence is
NOT claimed as implementation validity.

Containment (owner sections 58-59):
- Node bridge resolves every imported module path with realpath and refuses
  anything escaping the authenticated TEST_BASE root; no live-tree fallback.
- Python adapters import package-rooted modules (package semantics preserved)
  with the bound TEST_BASE as the import root; no accidental live-tree import.

All adapters are IMPLEMENTED but NOT EXECUTED in CORR3 (owner section 60).
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from types import MappingProxyType
from typing import Any

BENCH_ROOT = Path(__file__).resolve().parent.parent
if str(BENCH_ROOT) not in sys.path:
    sys.path.insert(0, str(BENCH_ROOT))

from harness.evidence import RawCapture, UNOBSERVED  # noqa: E402
from harness.execution_request import to_native  # noqa: E402

PAY_URL_RE = re.compile(r"https?://t\.me/AST_payment_course_bot[^\s)\]]*")

# Sensitive relative paths never read or hashed by any adapter.
SENSITIVE_PATH_PATTERNS = ("credentials/*", "*.env", ".env*", "*.db", "*.sqlite*", "__pycache__/*")


def _load_package_module(root: str | None, package: str, module: str):
    """Package-rooted import preserving native package semantics, rooted at
    the bound TEST_BASE (owner section 59). Returns (module, error)."""
    if not root:
        return None, "TEST_BASE root not bound"
    root_real = str(Path(root).resolve())
    try:
        import importlib

        saved_path = sys.path[:]
        sys.path.insert(0, root_real)
        # purge any previously imported benchmark-target modules so the import
        # resolves against THIS root, not a live tree
        for name in list(sys.modules):
            if name == package or name.startswith(package + "."):
                del sys.modules[name]
        try:
            mod = importlib.import_module(f"{package}.{module}" if module else package)
            mod_file = str(Path(getattr(mod, "__file__", "") or "").resolve())
            if not mod_file.startswith(root_real):
                return None, f"import escaped TEST_BASE root: {mod_file}"
            return mod, None
        finally:
            sys.path[:] = saved_path
    except Exception as exc:  # noqa: BLE001 — clean binding condition
        return None, f"package import failed from TEST_BASE: {type(exc).__name__}: {exc}"


class _AdapterBase:
    """ONE explicit product adapter constructor protocol (IV4 B-04).

    EVERY PRODUCT adapter is constructed by the factory through exactly:

        cls(request=request, token=token, spec=spec)

    Keyword-only; the same protocol the calibration lane uses with token=None.
    No adapter class may define an incompatible __init__.
    """

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request
        self.token = token
        self.spec = spec
        self.adapter_id = getattr(self, "adapter_id", getattr(spec, "adapter_id", "?"))

    def _fail(self, reason: str) -> RawCapture:
        return RawCapture(capture_error=str(reason), sut_symbol=getattr(self, "adapter_id", "?"))


# ---------------------------------------------------------------------------
# Navigator L1 payment policy — native 3-argument decision signature (§26)
# ---------------------------------------------------------------------------

class NavigatorL1PaymentPolicyAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH:
        resolveCourseReferences(query) -> CourseReferenceResolution
        hasEnrollmentPaymentIntent(query) -> bool
        resolveEnrollmentPaymentDecision(query, act, context) -> EnrollmentPaymentDecision
    INPUT_MAPPING: turns[-1] -> query; state_setup.act_decision -> act
    (ConversationActDecision input); state_setup.context -> PaymentResolutionContext.
    OUTPUT_MAPPING: decision.kind -> state.decisionKind; decision.action ->
    state.courseId/paymentUrl + link; resolution.kind -> state.refKind.
    OBSERVABLES: decisionKind, courseId, paymentUrl, refKind, link.
    UNOBSERVABLES: router act decision (LLM lane), answer prose.
    ERROR_MAPPING: bridge failure -> TECHNICAL_ERROR outcome.
    SIDE_EFFECT_BOUNDARY: none (pure functions)."""

    adapter_id = "navigator_l1_payment_policy"

    def execute(self, request) -> RawCapture:
        root = request.navigator_test_root
        if not root:
            return self._fail("NAVIGATOR_TEST_ROOT not bound")
        bridge = BENCH_ROOT / "adapters" / "node_bridge" / "navigator_l1_runner.mjs"
        if not bridge.exists():
            return self._fail("node bridge missing from benchmark tree")
        # B-05: frozen MappingProxyType/tuple request values are converted to
        # the adapter-owned plain native transport representation (deep copy,
        # ordinary dict/list/scalars) BEFORE json encoding / the native bridge.
        state_setup = to_native(request.state_setup or {})
        payload = {
            "root": str(root),
            "operation": "payment_decision",
            "input": {
                "query": to_native(request.turns[-1]["content"] if request.turns else ""),
                "act_decision": state_setup.get("act_decision") or {"state": "NAVIGATE"},
                "context": state_setup.get("payment_context") or {},
            },
        }
        try:
            proc = subprocess.run(["node", str(bridge)], input=json.dumps(payload).encode(),
                                  capture_output=True, timeout=60, cwd=root)
        except FileNotFoundError:
            return self._fail("node runtime unavailable in execution environment")
        except subprocess.TimeoutExpired:
            return RawCapture(timeout_exceeded=True, outcome_class="UNRESOLVED_STATE", sut_symbol=self.adapter_id)
        if proc.returncode != 0:
            return self._fail(f"bridge failed: {proc.stderr.decode()[:300]}")
        try:
            out = json.loads(proc.stdout.decode())
        except json.JSONDecodeError as exc:
            return self._fail(f"bridge returned non-JSON: {exc}")
        if out.get("outcome_class") == "TECHNICAL_ERROR":
            return RawCapture(capture_error=out.get("output"), sut_symbol=self.adapter_id,
                              outcome_class="TECHNICAL_ERROR")
        state = out.get("state") or {}
        link = state.get("paymentUrl")
        return RawCapture(
            values={
                "act": "PAYMENT_DECISION",
                "origin": "NAVIGATOR_PAYMENT_POLICY",
                "state": {
                    "decisionKind": state.get("decisionKind"),
                    "courseId": state.get("courseId"),
                    "paymentUrl": state.get("paymentUrl"),
                    "refKind": state.get("refKind"),
                    "intentDetected": state.get("intentDetected"),
                },
                "link": link,
                "output": json.dumps(state, ensure_ascii=False),
                "tool_api": [],
                "mutations": [],
            },
            transcripts={"turn_response": json.dumps(state, ensure_ascii=False)},
            sut_path=f"{root}/src/lib/academy/payment-policy.ts (native signature)",
            sut_symbol="resolveEnrollmentPaymentDecision(query, act, context)",
            outcome_class="CLEAN",
        )


class NavigatorL1CourseReferenceAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: resolveCourseReferences(query) -> ZERO/ONE/MULTIPLE.
    INPUT_MAPPING: turns[-1] -> query. OUTPUT_MAPPING: kind -> state.refKind;
    courseIds -> state.courseIds. OBSERVABLES: refKind, courseIds.
    UNOBSERVABLES: anaphora / prior-turn state (lexical single-turn resolver —
    stateful reference scenarios bind to the L2 seam instead)."""

    adapter_id = "navigator_l1_course_reference"

    def execute(self, request) -> RawCapture:
        root = request.navigator_test_root
        if not root:
            return self._fail("NAVIGATOR_TEST_ROOT not bound")
        bridge = BENCH_ROOT / "adapters" / "node_bridge" / "navigator_l1_runner.mjs"
        payload = {
            "root": str(root), "operation": "course_reference",
            "input": {"query": (request.turns[-1]["content"] if request.turns else "")},
        }
        try:
            proc = subprocess.run(["node", str(bridge)], input=json.dumps(payload).encode(),
                                  capture_output=True, timeout=60, cwd=root)
        except Exception as exc:  # noqa: BLE001
            return self._fail(f"bridge invocation failed: {exc}")
        if proc.returncode != 0:
            return self._fail(f"bridge failed: {proc.stderr.decode()[:200]}")
        out = json.loads(proc.stdout.decode())
        if out.get("outcome_class") == "TECHNICAL_ERROR":
            return RawCapture(capture_error=out.get("output"), sut_symbol=self.adapter_id, outcome_class="TECHNICAL_ERROR")
        state = out.get("state") or {}
        return RawCapture(
            values={"act": "COURSE_RESOLUTION", "origin": "COURSE_REFERENCE",
                    "state": {"refKind": state.get("refKind"), "courseIds": state.get("courseIds")},
                    "link": None, "output": json.dumps(state, ensure_ascii=False),
                    "tool_api": [], "mutations": []},
            transcripts={"turn_response": json.dumps(state, ensure_ascii=False)},
            sut_path=f"{root}/src/lib/academy/course-reference.ts",
            sut_symbol="resolveCourseReferences(query)",
            outcome_class="CLEAN",
        )


class NavigatorAuthorityAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: resolveCourseReferences(query) -> ONE ->
    getAuthoritativeCoursePrice(courseId) -> AuthorityAvailability.
    INPUT_MAPPING: turns[-1] -> query. OBSERVABLES: priceStatus, priceValue,
    refKind. UNOBSERVABLES: prose."""

    adapter_id = "navigator_l1_commercial_authority"

    def execute(self, request) -> RawCapture:
        root = request.navigator_test_root
        if not root:
            return self._fail("NAVIGATOR_TEST_ROOT not bound")
        bridge = BENCH_ROOT / "adapters" / "node_bridge" / "navigator_l1_runner.mjs"
        payload = {
            "root": str(root), "operation": "authority_price",
            "input": {"query": (request.turns[-1]["content"] if request.turns else "")},
        }
        try:
            proc = subprocess.run(["node", str(bridge)], input=json.dumps(payload).encode(),
                                  capture_output=True, timeout=60, cwd=root)
        except Exception as exc:  # noqa: BLE001
            return self._fail(f"bridge invocation failed: {exc}")
        if proc.returncode != 0:
            return self._fail(f"bridge failed: {proc.stderr.decode()[:200]}")
        out = json.loads(proc.stdout.decode())
        if out.get("outcome_class") == "TECHNICAL_ERROR":
            return RawCapture(capture_error=out.get("output"), sut_symbol=self.adapter_id, outcome_class="TECHNICAL_ERROR")
        state = out.get("state") or {}
        return RawCapture(
            values={"act": "AUTHORITY_LOOKUP", "origin": "COMMERCIAL_AUTHORITY",
                    "state": {"refKind": state.get("refKind"),
                              "priceStatus": state.get("priceStatus"),
                              "priceValue": state.get("priceValue")},
                    "link": None, "output": json.dumps(state, ensure_ascii=False),
                    "tool_api": [], "mutations": []},
            transcripts={"turn_response": json.dumps(state, ensure_ascii=False)},
            sut_path=f"{root}/src/lib/academy/commercial-authority.ts",
            sut_symbol="getAuthoritativeCoursePrice(courseId)",
            outcome_class="CLEAN",
        )


# ---------------------------------------------------------------------------
# Navigator L2 local chat — native capture, local-only URL, log collector (§28-29)
# ---------------------------------------------------------------------------

def navigator_chat_endpoint(base: str) -> str:
    """Complete local Navigator chat endpoint for an accepted base URL.

    OS-F02 correction: navigator_l2_base_url carries exactly ONE accepted
    meaning — the BASE URL of the locally started Navigator test server.
    Every consumer (navigator_l2_chat_api AND the alexey_user_turn real_local
    native transport, which posts to api_url verbatim as a COMPLETE endpoint)
    derives the chat endpoint through this single construction, so the two
    contracts can never diverge again. Trailing-slash safe and idempotent:
    no '//', '/api/chat/api/chat' or equivalent duplicate-path construction
    can occur.
    """
    root = (base or "").strip().rstrip("/")
    if root.endswith("/api/chat"):
        return root
    return root + "/api/chat"


def _transport_outcome(status: int, body: Any) -> str:
    """Existing single-request transport-success contract.

    200 without NAVIGATOR_TECHNICAL_ERROR is success. 400–499 except 429 is
    VALIDATION_REJECTED. Any other non-200, or a technical-error body, is
    TECHNICAL_ERROR. A multi-step causal conclusion may be CLEAN only when
    every required step meets this same contract.
    """
    if 400 <= status < 500 and status != 429:
        return "VALIDATION_REJECTED"
    if status != 200 or (isinstance(body, dict) and
                         body.get("error", {}).get("code") == "NAVIGATOR_TECHNICAL_ERROR"):
        return "TECHNICAL_ERROR"
    return "CLEAN"


class NavigatorL2ChatAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: POST {local}/api/chat -> ChatSuccessResponse.
    INPUT_MAPPING: turns -> messages; state_setup.profile/conversationState.
    OUTPUT_MAPPING: message -> output (+ link extracted FROM the actual
    message text); conversationState.lastAssistant.act -> act; courseMatch /
    selectedCourseId / pendingConfirmation.kind / activeFlow.pendingQuestion /
    profile fields -> state; contactCard/resetConversation -> state.
    Diagnostics: ONLY from the structured NAVIGATOR_TURN / NAVIGATOR_GROUNDING
    log collector correlated by the request-id header; absent event ->
    UNOBSERVED (never response-text keyword detection).
    SECURITY: base URL must be a loopback address from the execution
    environment; remote/public URLs are rejected."""

    adapter_id = "navigator_l2_chat_api"

    def _collect_log_diagnostics(self, env: dict, request_id: str | None) -> dict:
        """Legacy flat view over the structured B-08 capture (each diagnostic
        field -> value). The authoritative representation is the structured
        collect_rag_diagnostics document with raw-event evidence references."""
        doc = collect_rag_diagnostics(dict(env or {}), request_id)
        return {f: rec["value"] for f, rec in doc["fields"].items()}

    def _chat_call(self, base: str, body: dict):
        req = urllib.request.Request(
            navigator_chat_endpoint(base), data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "X-Navigator-Request-Id": body["requestId"]}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode()), \
                    resp.headers.get("X-Navigator-Request-Id")
        except urllib.error.HTTPError as exc:
            try:
                resp_body = json.loads(exc.read().decode())
            except Exception:  # noqa: BLE001
                resp_body = {}
            return exc.code, resp_body, (
                exc.headers.get("X-Navigator-Request-Id")
                if hasattr(exc, "headers") else None)
        # transport-level failures propagate to the caller

    def execute(self, request) -> RawCapture:
        env = dict(to_native(request.execution_environment or ()))
        base = str(env.get("navigator_l2_base_url", "")).strip()
        if not base:
            return self._fail(
                "navigator_l2_base_url not provided by the authenticated execution "
                "environment (a locally-started TEST_BASE server)"
            )
        host = urllib.parse.urlsplit(base)
        if host.scheme != "http" or host.hostname not in ("127.0.0.1", "localhost", "::1"):
            return self._fail(
                f"L2 endpoint {base!r} is not a local attested test server "
                "(remote/public URLs are rejected, owner section 28)")
        # B-05: adapter-owned plain transport representation of frozen values.
        state_setup = to_native(request.state_setup or {})
        turns = to_native(list(request.turns or ()))

        # IV6-F15 §34: MULTI-STEP / CROSS-SESSION trajectories. A scenario
        # claiming cross-session behavior declares explicit causal steps; the
        # adapter executes each step as its own native /api/chat request with
        # its own session identity (SESSION_BOUNDARY = distinct requestId and
        # independent profile/state baseline). A single request cannot
        # establish cross-session behavior.
        multi_step = state_setup.get("multi_step")
        if multi_step:
            # A-0105 sets this flag. Later requests then consume the profile
            # and conversationState returned by the previous call. Every other
            # multi_step row keeps the step's own baseline.
            propagate = state_setup.get("causal_profile_propagation") is True
            step_results = []
            carried_profile = None
            carried_state = None
            request_profiles = []
            request_states = []
            response_profiles = []
            response_states = []
            try:
                import copy
                for i, step in enumerate(multi_step, start=1):
                    if propagate and i > 1:
                        profile = carried_profile
                        conversation_state = carried_state
                    else:
                        profile = step.get("profile") or {
                            "displayName": None, "addressMode": None,
                            "nameDeclined": False, "pendingUserRequest": None}
                        conversation_state = step.get("conversationState")
                    body = {
                        "messages": step.get("messages") or [],
                        "profile": profile,
                        "conversationState": conversation_state,
                        "requestId": step.get("requestId")
                        or f"{request.run_id}-{request.scenario_id}-{request.attempt}-s{i}",
                    }
                    if propagate:
                        request_profiles.append(
                            copy.deepcopy(profile) if isinstance(profile, dict) else profile)
                        request_states.append(
                            copy.deepcopy(conversation_state)
                            if isinstance(conversation_state, dict) else conversation_state)
                    status, resp_body, header = self._chat_call(base, body)
                    if propagate:
                        if isinstance(resp_body, dict):
                            returned_profile = resp_body.get("profile")
                            returned_state = resp_body.get("conversationState")
                        else:
                            returned_profile = None
                            returned_state = None
                        carried_profile = (copy.deepcopy(returned_profile)
                                           if isinstance(returned_profile, dict)
                                           else returned_profile)
                        carried_state = (copy.deepcopy(returned_state)
                                         if isinstance(returned_state, dict)
                                         else returned_state)
                        response_profiles.append(carried_profile)
                        response_states.append(carried_state)
                    step_results.append({
                        "step": i, "requestId": body["requestId"], "status": status,
                        "response": resp_body, "header": header,
                    })
            except Exception as exc:  # noqa: BLE001
                return RawCapture(infra_failure=True,
                                  capture_error=f"L2 transport failure: {exc}",
                                  sut_symbol="POST /api/chat")
            final = step_results[-1]["response"]
            final_message = final.get("message") if isinstance(final, dict) else None
            diagnostics = collect_rag_diagnostics(
                env, step_results[-1]["header"])
            step_outcomes = [
                _transport_outcome(s["status"], s["response"]) for s in step_results]
            failed_at = next((i for i, outcome in enumerate(step_outcomes)
                              if outcome != "CLEAN"), None)
            causal_complete = failed_at is None
            if causal_complete:
                chain_outcome = "CLEAN"
                failed_request_id = None
            else:
                chain_outcome = step_outcomes[failed_at]
                failed_request_id = step_results[failed_at]["requestId"]
            chain_state = {"multiStepCount": len(step_results),
                           "stepRequestIds": [s["requestId"] for s in step_results],
                           "stepStatuses": [s["status"] for s in step_results],
                           "stepOutcomes": step_outcomes,
                           "failedStepIndex": None if failed_at is None else failed_at + 1,
                           "failedRequestId": failed_request_id,
                           "finalStatus": step_results[-1]["status"],
                           "causalChainComplete": causal_complete}
            if propagate:
                chain_state["causalProfilePropagation"] = True
                chain_state["stepRequestProfiles"] = request_profiles
                chain_state["stepRequestStates"] = request_states
                chain_state["stepResponseProfiles"] = response_profiles
                chain_state["stepResponseStates"] = response_states
            return RawCapture(
                values={"act": "MULTI_STEP_EXECUTED", "origin": "NAVIGATOR_L2_CHAT",
                        "state": chain_state,
                        "link": None, "output": final_message,
                        "tool_api": UNOBSERVED, "mutations": UNOBSERVED},
                transcripts={f"step_{s['step']}_reply":
                             (s["response"] or {}).get("message", "")
                             if isinstance(s["response"], dict) else ""
                             for s in step_results},
                auxiliary_diagnostics=diagnostics,
                sut_path=f"{base}/api/chat (local attested test server)",
                sut_symbol="POST /api/chat (multi-step)",
                outcome_class=chain_outcome,
            )

        body = {
            "messages": [{"role": t.get("role", "user"), "content": t.get("content", "")} for t in turns],
            "profile": state_setup.get("profile") or {
                "displayName": None, "addressMode": None, "nameDeclined": False,
                "pendingUserRequest": None},
            "conversationState": state_setup.get("conversationState"),
            "requestId": f"{request.run_id}-{request.scenario_id}-{request.attempt}",
        }
        try:
            status, resp_body, request_id_header = self._chat_call(base, body)
        except Exception as exc:  # noqa: BLE001
            return RawCapture(infra_failure=True, capture_error=f"L2 transport failure: {exc}",
                              sut_symbol="POST /api/chat")
        outcome = _transport_outcome(status, resp_body)
        cs = resp_body.get("conversationState") or {} if isinstance(resp_body, dict) else {}
        last_assistant = cs.get("lastAssistant") or {}
        message_text = resp_body.get("message") if isinstance(resp_body, dict) else None
        links = PAY_URL_RE.findall(str(message_text or ""))
        expected_keys = {"message", "profile", "conversationState", "contactCard", "resetConversation"}
        state_projection = {
            "courseMatch": cs.get("courseMatch"),
            "selectedCourseId": cs.get("selectedCourseId"),
            "lastAssistantAct": last_assistant.get("act"),
            "lastAssistantCourseId": last_assistant.get("courseId"),
            "pendingConfirmationKind": (cs.get("pendingConfirmation") or {}).get("kind"),
            "activeFlowId": (cs.get("activeFlow") or {}).get("id"),
            "pendingQuestionPresent": bool((cs.get("activeFlow") or {}).get("pendingQuestion")),
            "handoffStatus": (cs.get("handoff") or {}).get("status"),
            "displayName": (resp_body.get("profile") or {}).get("displayName"),
            "addressMode": (resp_body.get("profile") or {}).get("addressMode"),
            "schemaConformant": isinstance(resp_body, dict) and expected_keys.issubset(resp_body.keys()),
            "contactCardPresent": resp_body.get("contactCard") is not None,
            "resetConversation": resp_body.get("resetConversation"),
            "nativeRequestIdHeader": request_id_header,
        }
        # B-08: structured log collector correlated by the SERVER-RETURNED
        # request-id header (native route.ts mints logRequestId = randomUUID()
        # and returns it in X-Navigator-Request-Id; the client body requestId
        # is NOT log authority).
        diagnostics = collect_rag_diagnostics(env, request_id_header)
        return RawCapture(
            values={"act": state_projection["lastAssistantAct"] or outcome,
                    "origin": "NAVIGATOR_L2_CHAT", "state": state_projection,
                    "link": links[0] if links else None,
                    "output": message_text, "tool_api": UNOBSERVED, "mutations": UNOBSERVED},
            transcripts={"assistant_reply": message_text or ""},
            auxiliary_diagnostics=diagnostics,
            sut_path=f"{base}/api/chat (local attested test server)",
            sut_symbol="POST /api/chat",
            outcome_class=outcome,
        )

# ---------------------------------------------------------------------------
# RAG diagnostic capture — CORR4 B-08
# ---------------------------------------------------------------------------

RAG_TURN_DIRECT_FIELDS = (
    "conversationAct", "courseId", "ragInvoked", "activeBindingCount",
    "retrievedMatchCount", "resolvedEvidenceCount", "evidenceSelectionStatus",
    "answerOrigin", "fallback",
)
RAG_GROUNDING_FIELDS = ("groundingStage", "repairAttempted", "reasonCode")
RAG_ALL_FIELDS = RAG_TURN_DIRECT_FIELDS + RAG_GROUNDING_FIELDS

_COUNT_FIELDS = ("activeBindingCount", "retrievedMatchCount", "resolvedEvidenceCount")
_BOOL_FIELDS = ("ragInvoked", "repairAttempted")

# ---------------------------------------------------------------------------
# F05 (IV5): TYPED RAG diagnostic schema — exact native enums/types.
#
# The native source of truth is src/lib/navigation/navigator-observability.ts
# (checked at the recorded sha256 in RAG_DIAGNOSTIC_CAPTURE_CONTRACT.json).
# Generic JSON scalar acceptance is insufficient: no integer may satisfy an
# enum/string field; no arbitrary string may satisfy a finite enum.
# ---------------------------------------------------------------------------

NAVIGATOR_CONVERSATION_ACTS = (
    "NAVIGATE", "COURSE_FOLLOW_UP", "COURSE_CONTENT", "META", "OUT_OF_SCOPE",
    "FACTUAL", "ROUTER_DEGRADED",
)
NAVIGATOR_ANSWER_ORIGINS = (
    "DETERMINISTIC_CONTROL", "CONTACT_POLICY", "PAYMENT_POLICY",
    "CATALOG_AUTHORITY", "COMMERCIAL_AUTHORITY", "RAG_EVIDENCE",
    "FACTUAL_CEILING", "OUT_OF_SCOPE", "META",
)
NAVIGATOR_TURN_FALLBACKS = (
    "NONE", "CATALOG_FOLLOW_UP", "FACTUAL_CEILING",
    "EVIDENCE_SELECTION_DEGRADED", "ROUTER_VALIDATION_DEGRADED",
)
NAVIGATOR_GROUNDING_STAGES = (
    "PRIMARY_AUDIT_PASS", "PRIMARY_AUDIT_FAIL", "PRIMARY_AUDIT_ERROR",
    "REPAIR_ATTEMPTED", "REPAIR_AUDIT_PASS", "REPAIR_AUDIT_FAIL",
    "REPAIR_AUDIT_ERROR", "FACTUAL_CEILING_STRUCTURAL", "FACTUAL_CEILING_AUDIT",
)
NAVIGATOR_GROUNDING_REASON_CODES = (
    "UNSUPPORTED_CLAIM", "AUTHORITY_SCOPE", "UNMARKED_INFERENCE",
)

# typed registry: FIELD -> {source_event, nullable, type, allowed_values,
# source_native_symbol}
RAG_DIAGNOSTIC_SCHEMA_FIELDS = {
    "conversationAct": {
        "source_event": "NAVIGATOR_TURN", "nullable": True, "type": "enum_or_null",
        "allowed_values": NAVIGATOR_CONVERSATION_ACTS,
        "source_native_symbol": "NavigatorTurnDetails.conversationAct (navigator-observability.ts)",
    },
    "courseId": {
        "source_event": "NAVIGATOR_TURN", "nullable": True, "type": "string_or_null",
        "allowed_values": None,
        "source_native_symbol": "NavigatorTurnDetails.courseId (navigator-observability.ts)",
    },
    "ragInvoked": {
        "source_event": "NAVIGATOR_TURN", "nullable": False, "type": "boolean",
        "allowed_values": None,
        "source_native_symbol": "NavigatorTurnDetails.ragInvoked (navigator-observability.ts)",
    },
    "activeBindingCount": {
        "source_event": "NAVIGATOR_TURN", "nullable": False,
        "type": "non_negative_integer_excluding_bool", "allowed_values": None,
        "source_native_symbol": "NavigatorTurnDetails.activeBindingCount (navigator-observability.ts)",
    },
    "retrievedMatchCount": {
        "source_event": "NAVIGATOR_TURN", "nullable": False,
        "type": "non_negative_integer_excluding_bool", "allowed_values": None,
        "source_native_symbol": "NavigatorTurnDetails.retrievedMatchCount (navigator-observability.ts)",
    },
    "resolvedEvidenceCount": {
        "source_event": "NAVIGATOR_TURN", "nullable": False,
        "type": "non_negative_integer_excluding_bool", "allowed_values": None,
        "source_native_symbol": "NavigatorTurnDetails.resolvedEvidenceCount (navigator-observability.ts)",
    },
    "evidenceSelectionStatus": {
        "source_event": "NAVIGATOR_TURN", "nullable": False, "type": "enum",
        "allowed_values": ("NOT_RUN", "SUPPORTED", "INSUFFICIENT"),
        "source_native_symbol": "NavigatorTurnDetails.evidenceSelectionStatus (navigator-observability.ts)",
    },
    "answerOrigin": {
        "source_event": "NAVIGATOR_TURN", "nullable": False, "type": "enum",
        "allowed_values": NAVIGATOR_ANSWER_ORIGINS,
        "source_native_symbol": "NavigatorAnswerOrigin (navigator-observability.ts)",
    },
    "fallback": {
        "source_event": "NAVIGATOR_TURN", "nullable": False, "type": "enum",
        "allowed_values": NAVIGATOR_TURN_FALLBACKS,
        "source_native_symbol": "NavigatorTurnFallback (navigator-observability.ts)",
    },
    "groundingStage": {
        "source_event": "NAVIGATOR_GROUNDING", "nullable": False, "type": "enum",
        "allowed_values": NAVIGATOR_GROUNDING_STAGES,
        "source_native_symbol": "NavigatorGroundingStage (navigator-observability.ts)",
    },
    "repairAttempted": {
        "source_event": "NAVIGATOR_GROUNDING", "nullable": False, "type": "boolean",
        "allowed_values": None,
        "source_native_symbol": "NavigatorGroundingDetails.repairAttempted (navigator-observability.ts)",
    },
    "reasonCode": {
        "source_event": "NAVIGATOR_GROUNDING", "nullable": True, "type": "enum_or_null",
        "allowed_values": NAVIGATOR_GROUNDING_REASON_CODES,
        "source_native_symbol": "NavigatorGroundingReasonCode (navigator-observability.ts)",
    },
}


def _rag_field_type_valid(field: str, value: Any) -> bool:
    """F05: EXACT native type/enum contract per field. Counts must be
    non-negative integers excluding bool; booleans must be bool; finite enums
    accept ONLY their declared members; string fields accept only str; null
    is legal only where the native contract declares it. No integer may
    satisfy an enum/string field; no arbitrary string may satisfy a finite
    enum; malformed fixture values never become valid diagnostics."""
    spec = RAG_DIAGNOSTIC_SCHEMA_FIELDS.get(field)
    if spec is None:
        return False
    ftype = spec["type"]
    if value is None:
        return bool(spec["nullable"])
    if ftype == "boolean":
        return isinstance(value, bool)
    if ftype == "non_negative_integer_excluding_bool":
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0
    if ftype == "enum":
        return isinstance(value, str) and value in spec["allowed_values"]
    if ftype == "enum_or_null":
        return isinstance(value, str) and value in spec["allowed_values"]
    if ftype == "string_or_null":
        return isinstance(value, str) and not isinstance(value, bool)
    return False


def _rag_evidence_id(event: dict, seq: int) -> str:
    """Stable raw-event evidence identity: event type + server request id +
    sequence position + content digest."""
    digest = hashlib.sha256(
        canonical_json_bytes(event)).hexdigest()[:24]
    return f"{event.get('event')}:{event.get('requestId')}:{seq}:{digest}"


def canonical_json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), default=str).encode("utf-8")


def _rag_unobserved_diagnostics(reason: str) -> dict:
    return {
        "correlation": {"server_request_id": None, "reason": reason},
        "fields": {f: {"value": UNOBSERVED, "valid": True,
                       "event_type": None, "raw_event_evidence_id": None}
                   for f in RAG_ALL_FIELDS},
        "raw_events": [],
        "grounding_event_count": 0,
        "selection_rule": "final grounding event per file sequence (repair/final events update stage)",
        "valid": True,
    }


def collect_rag_diagnostics(env: dict, server_request_id: str | None) -> dict:
    """B-08 capture order (owner sections 15-17):

    1. correlation key = the SERVER-RETURNED request-id header captured from
       the actual response (native logRequestId), never body['requestId'];
    2. match NAVIGATOR_TURN / NAVIGATOR_GROUNDING events by that server
       identity only;
    3. freeze the matching RAW events into the diagnostic document;
    4. derive every diagnostic field FROM those frozen events with an
       evidence reference (event type, server request id, raw event evidence
       id, field name, field value digest);
    5. deterministic grounding event selection: the FINAL grounding event in
       file sequence represents stage/repairAttempted/reasonCode (a later
       repair event materially updates them); the full event sequence and
       count are preserved;
    6. typed validation: malformed values are marked invalid and never become
       valid diagnostics.
    """
    log_path = env.get("navigator_l2_log_path")
    if not server_request_id:
        return _rag_unobserved_diagnostics("no server-returned request-id header on the response")
    if not log_path or not Path(log_path).exists():
        return _rag_unobserved_diagnostics("collector log file absent")
    matched: list[tuple[int, dict]] = []
    try:
        for seq, line in enumerate(Path(log_path).read_text(encoding="utf-8", errors="replace").splitlines()):
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue  # malformed lines are ignored (documented)
            if not isinstance(event, dict):
                continue
            if event.get("requestId") != server_request_id:
                continue  # wrong request id ignored
            if event.get("event") in ("NAVIGATOR_TURN", "NAVIGATOR_GROUNDING"):
                matched.append((seq, event))
    except OSError:
        return _rag_unobserved_diagnostics("collector log file unreadable")

    turn_events = [e for _, e in matched if e.get("event") == "NAVIGATOR_TURN"]
    grounding_events = [e for _, e in matched if e.get("event") == "NAVIGATOR_GROUNDING"]
    # deterministic final-event semantics: LAST turn event and LAST grounding
    # event in file sequence represent the observable state; earlier events
    # remain frozen in the sequence record.
    turn_event = turn_events[-1] if turn_events else None
    final_grounding = grounding_events[-1] if grounding_events else None

    raw_events = [
        {"seq": seq, "event": event.get("event"),
         "raw_event_evidence_id": _rag_evidence_id(event, seq),
         "raw_event": event}
        for seq, event in matched
    ]

    fields: dict[str, dict] = {}
    for f in RAG_TURN_DIRECT_FIELDS:
        if turn_event is not None and f in turn_event:
            value = turn_event.get(f)
            fields[f] = _rag_field_record(f, value, "NAVIGATOR_TURN", server_request_id, None)
        else:
            fields[f] = {"value": UNOBSERVED, "valid": True, "event_type": None,
                         "raw_event_evidence_id": None}
    for f in RAG_GROUNDING_FIELDS:
        key = {"groundingStage": "stage", "repairAttempted": "repairAttempted",
               "reasonCode": "reasonCode"}[f]
        if final_grounding is not None and key in final_grounding:
            fields[f] = _rag_field_record(f, final_grounding.get(key), "NAVIGATOR_GROUNDING",
                                          server_request_id, None)
        else:
            fields[f] = {"value": UNOBSERVED, "valid": True, "event_type": None,
                         "raw_event_evidence_id": None}

    # bind each derived field to its actual frozen raw event evidence id
    turn_eid = _rag_turn_evidence_id(matched, turn_event)
    grounding_eid = _rag_grounding_evidence_id(matched, final_grounding)
    for f in RAG_TURN_DIRECT_FIELDS:
        if fields[f]["value"] is not UNOBSERVED:
            fields[f]["raw_event_evidence_id"] = turn_eid
            fields[f]["value_digest"] = hashlib.sha256(
                canonical_json_bytes(fields[f]["value"])).hexdigest()
    for f in RAG_GROUNDING_FIELDS:
        if fields[f]["value"] is not UNOBSERVED:
            fields[f]["raw_event_evidence_id"] = grounding_eid
            fields[f]["value_digest"] = hashlib.sha256(
                canonical_json_bytes(fields[f]["value"])).hexdigest()

    all_valid = all(v["valid"] for v in fields.values())
    return {
        "correlation": {"server_request_id": server_request_id,
                        "reason": "matched by server-returned request-id header"},
        "fields": fields,
        "raw_events": raw_events,
        "grounding_event_count": len(grounding_events),
        "grounding_stage_sequence": [e.get("stage") for _, e in matched
                                     if e.get("event") == "NAVIGATOR_GROUNDING"],
        "selection_rule": "final grounding event per file sequence (repair/final events update stage)",
        "valid": all_valid,
    }


def _rag_turn_evidence_id(matched, turn_event):
    for seq, e in matched:
        if e is turn_event:
            return _rag_evidence_id(e, seq)
    return None


def _rag_grounding_evidence_id(matched, final_grounding):
    for seq, e in matched:
        if e is final_grounding:
            return _rag_evidence_id(e, seq)
    return None


def _rag_field_record(field: str, value: Any, event_type: str,
                      server_request_id: str, raw_evidence_id: str | None) -> dict:
    """Typed field record (F05): the raw captured value is retained as
    evidence, and an invalid enum/value becomes INVALID and UNOBSERVED FOR
    AUTHORITY according to the documented rule — a malformed value can never
    become a valid diagnostic conclusion."""
    valid = _rag_field_type_valid(field, value)
    return {"value": value, "valid": valid, "event_type": event_type,
            "server_request_id": server_request_id,
            "raw_event_evidence_id": raw_evidence_id,
            "field_name": field,
            "authority_value": (value if valid else UNOBSERVED),
            "invalid_rule": (
                "value failing its exact native type/enum contract is retained as "
                "raw evidence but is UNOBSERVED for authority purposes")}


# ---------------------------------------------------------------------------
# Tikhon deep-link start — native handler invocation in a fixture context (§30)
# ---------------------------------------------------------------------------

class _RecordingFSM:
    def __init__(self, initial_data=None):
        self._data = dict(initial_data or {})
        self.state = None
        self.cleared = False
        self.updates: list[tuple] = []

    async def get_data(self):
        return dict(self._data)

    async def update_data(self, **kw):
        self._data.update(kw)
        self.updates.append(("update_data", dict(kw)))

    async def set_state(self, state):
        self.state = str(state)
        self.updates.append(("set_state", str(state)))

    async def clear(self):
        self.cleared = True
        self.state = None
        self.updates.append(("clear",))


class _RecordingMessage:
    def __init__(self, text, chat_id=701001, user_id=701001):
        from datetime import datetime

        self.text = text
        self.chat = type("C", (), {"id": chat_id})()
        self.from_user = type("U", (), {"id": user_id, "first_name": "Тест"})()
        self.date = datetime.now()
        self.answer_photo_calls: list[dict] = []
        self.answer_calls: list[dict] = []

    async def answer_photo(self, **kw):
        self.answer_photo_calls.append(kw)

    async def answer(self, text, **kw):
        self.answer_calls.append({"text": text, **kw})

    async def bot(self):  # pragma: no cover - attribute accessed, not called
        raise AssertionError


def _fixture_bot(message: _RecordingMessage):
    class _Bot:
        async def set_chat_menu_button(self, **kw):
            return True

        async def send_photo(self, **kw):
            message.answer_photo_calls.append(kw)

    return _Bot()


class TikhonStartAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: cmd_start(message, command, state) [handlers/client.py]
      -> get_course_by_id(raw_args) [calendar_service.LocalCalendarProvider]
      -> send_or_edit_root_catalog(message, course_id=...) (recorded wrapper)
      -> state.clear() / state.set_state(OrderFlow.choosing_course)
    INPUT_MAPPING: turns[0] -> /start command args.
    OUTPUT_MAPPING: recorded catalog invocation course_id -> catalogCourseContext;
    recorded FSM state -> fsm_state_literal/stateCleared; recorded caption ->
    output. Handler failure propagates as capture error (the adapter does NOT
    reconstruct handler behavior)."""

    adapter_id = "chatbot_l3_deep_link_start"

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root
        mod, err = _load_package_module(root, "handlers", "client")
        if mod is None:
            return self._fail(err)
        text = request.turns[0]["content"] if request.turns else "/start"
        raw_args = text[len("/start "):].strip() if text.startswith("/start ") else (
            "" if text.strip() == "/start" else text.strip())
        message = _RecordingMessage(text)
        message.bot = _fixture_bot(message)
        state = _RecordingFSM()
        command = type("Cmd", (), {"args": raw_args or None})()
        recorded_catalog_calls: list[dict] = []
        original_catalog = mod.send_or_edit_root_catalog

        async def recording_catalog(event, reply_markup=None, course_id=None):
            recorded_catalog_calls.append({"course_id": course_id})
            return await original_catalog(event, reply_markup=reply_markup, course_id=course_id)

        mod.send_or_edit_root_catalog = recording_catalog
        import asyncio

        try:
            asyncio.run(mod.cmd_start(message, command, state))
        except Exception as exc:  # noqa: BLE001 — native failure is captured, not fabricated
            return RawCapture(capture_error=f"native cmd_start raised: {type(exc).__name__}: {exc}",
                              sut_symbol="cmd_start", outcome_class="TECHNICAL_ERROR")
        finally:
            mod.send_or_edit_root_catalog = original_catalog
        catalog_course = recorded_catalog_calls[-1]["course_id"] if recorded_catalog_calls else None
        caption = ""
        if message.answer_photo_calls:
            caption = str(message.answer_photo_calls[-1].get("caption", ""))
        fsm_literal = state.state if state.state is not None else ("CLEARED" if state.cleared else None)
        return RawCapture(
            values={"act": "TIKHON_START", "origin": "TIKHON_CMD_START",
                    "state": {"fsm_state_literal": fsm_literal,
                              "stateCleared": state.cleared,
                              "catalogCourseContext": catalog_course},
                    "link": None, "output": caption[:2000],
                    "tool_api": [], "mutations": []},
            transcripts={"assistant_reply": caption[:4000],
                         "catalog_calls": json.dumps(recorded_catalog_calls),
                         "fsm_updates": json.dumps(state.updates, default=str)},
            sut_path=f"{root}/handlers/client.py::cmd_start",
            sut_symbol="cmd_start|get_course_by_id|send_or_edit_root_catalog",
            outcome_class="CLEAN",
        )


class TikhonCallbackAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: cb_cohort_selected(callback, state) [handlers/client.py]
      -> callback.data split -> get_course_by_id / get_cohort_by_id (registry)
      -> registry rejection BEFORE state mutation (TG-09) or native flow.
    INPUT_MAPPING: turns[0] callback data; preconditions.fsm_data -> FSM data.
    OUTPUT_MAPPING: recorded callback answers -> output/answerText; recorded
    FSM updates -> stateMutated/state; registry results -> registryLookupResult."""

    adapter_id = "chatbot_l3_callback_registry"

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root
        mod, err = _load_package_module(root, "handlers", "client")
        if mod is None:
            return self._fail(err)
        data = request.turns[0]["content"] if request.turns else "callback:cohort:x"
        cb_data = data[len("callback:"):] if data.startswith("callback:") else data
        class _Msg:
            photo = None

            async def delete(self):
                return True

            async def answer_photo(self, **kw):
                return None

            def __init__(self):
                self.chat = type("C", (), {"id": 701001})()
                self.from_user = type("U", (), {"id": 701001})()

        class _Callback:
            def __init__(self, d):
                self.data = d
                self.message = _Msg()
                self.from_user = type("U", (), {"id": 701001, "first_name": "Тест"})()
                self.answers: list[dict] = []

            async def answer(self, text=None, show_alert=False):
                self.answers.append({"text": text, "show_alert": show_alert})

        callback = _Callback(cb_data)
        # B-05: frozen preconditions become the adapter-owned plain native
        # representation (native FSM code requires an ordinary dict).
        state = _RecordingFSM(to_native((request.preconditions or {}).get("fsm_data")
                                        or {"course_id": "maslow"}))
        import asyncio

        try:
            asyncio.run(mod.cb_cohort_selected(callback, state))
        except Exception as exc:  # noqa: BLE001
            return RawCapture(capture_error=f"native callback handler raised: {type(exc).__name__}: {exc}",
                              sut_symbol="cb_cohort_selected", outcome_class="TECHNICAL_ERROR")
        answer_text = callback.answers[-1]["text"] if callback.answers else None
        state_mutated = any(u[0] in ("update_data", "set_state") for u in state.updates)
        return RawCapture(
            values={"act": "CALLBACK_HANDLED", "origin": "TIKHON_CALLBACK",
                    "state": {"stateMutated": state_mutated,
                              "fsm_state_literal": state.state,
                              "registryLookupResult": "FOUND" if state_mutated or not callback.answers else "REJECTED"},
                    "link": None, "output": str(answer_text or ""),
                    "tool_api": [], "mutations": ["callback_state_update"] if state_mutated else []},
            transcripts={"assistant_reply": str(answer_text or ""),
                         "callback_answers": json.dumps(callback.answers, ensure_ascii=False),
                         "fsm_updates": json.dumps(state.updates, default=str)},
            sut_path=f"{root}/handlers/client.py::cb_cohort_selected",
            sut_symbol="cb_cohort_selected|get_course_by_id|get_cohort_by_id",
            outcome_class="CLEAN",
        )


class TikhonParserAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: find_valid_history_suffix(history, ...) +
    build_navigator_payload(...) [data_engine/lebedev_adapter.py] invoked with
    the ACTUAL request text (an oversized scenario physically carries a
    >4000-char turn) and the scenario's history fixture.
    INPUT_MAPPING: turns[-1] -> user_text; preconditions.history -> history.
    OUTPUT_MAPPING: native returns -> payloadBuilt/failClosed/suffixLength.
    OBSERVABLES: payloadBuilt, failClosed, suffixLength, payloadBytes."""

    adapter_id = "chatbot_l3_parser_bounds"

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root
        mod, err = _load_package_module(root, "data_engine", "lebedev_adapter")
        if mod is None:
            return self._fail(err)
        user_text = request.turns[-1]["content"] if request.turns else ""
        # B-05: frozen history (tuple of MappingProxyType) becomes the native
        # list-of-dict representation the parser's isinstance(msg, dict) and
        # json serialization require.
        history = to_native((request.preconditions or {}).get("history"))
        if history is None:
            history = [{"role": "user", "content": "привет"}, {"role": "assistant", "content": "Здравствуйте"}]
        try:
            suffix = mod.find_valid_history_suffix(history)
        except Exception as exc:  # noqa: BLE001
            return RawCapture(capture_error=f"native find_valid_history_suffix raised: {exc}",
                              sut_symbol="find_valid_history_suffix", outcome_class="TECHNICAL_ERROR")
        suffix = suffix or []
        current_user_message = {"role": "user", "content": user_text}
        try:
            payload = mod.build_navigator_payload(
                suffix, current_user_message, {}, None,
                f"{request.run_id}-{request.scenario_id}-{request.attempt}")
        except Exception as exc:  # noqa: BLE001
            return RawCapture(capture_error=f"native build_navigator_payload raised: {exc}",
                              sut_symbol="build_navigator_payload", outcome_class="TECHNICAL_ERROR")
        fail_closed = payload is None or (isinstance(payload, tuple) and payload[0] is None)
        body = payload[0] if isinstance(payload, tuple) else payload
        payload_bytes = len(json.dumps(body).encode()) if body is not None else 0
        return RawCapture(
            values={"act": "PARSER_INVOKED", "origin": "TIKHON_PARSER_BOUNDS",
                    "state": {"payloadBuilt": payload is not None and not fail_closed,
                              "failClosed": bool(fail_closed),
                              "suffixLength": len(suffix),
                              "payloadBytes": payload_bytes,
                              "inputChars": len(user_text)},
                    "link": None, "output": "native parser invoked",
                    "tool_api": [], "mutations": []},
            transcripts={"assistant_reply": "native parser invoked",
                         "native_returns": json.dumps({"failClosed": bool(fail_closed),
                                                       "suffixLength": len(suffix),
                                                       "payloadBytes": payload_bytes})},
            sut_path=f"{root}/data_engine/lebedev_adapter.py",
            sut_symbol="find_valid_history_suffix|build_navigator_payload",
            outcome_class="CLEAN",
        )


# ---------------------------------------------------------------------------
# Alexey user turn — native process_user_turn, same-loop asyncio (§33, §53)
# CORR4: B-05 (native input conversion), B-09 (async native-signature
# transport), B-10 (lock instrumentation preserves the native release
# protocol), B-11 (fault hooks installed on every control path and the native
# operation is actually invoked).
# ---------------------------------------------------------------------------

def _stubbed_navigator_response(request_label: str) -> dict:
    """Deterministic local Navigator transport fixture (B-09): an ASYNC
    callable with the native call_navigator_core signature returning a
    contract-valid Navigator response. Used ONLY where Navigator policy
    generation itself is NOT under test; scenarios that measure real policy
    output use real_local mode, which retains the native transport and
    declares a FUTURE_LOCAL_NAVIGATOR_SERVER requirement when unbound.
    CORR6 (IV6-F06B): the neutral response carries the COMPLETE native
    ConversationState structure — courseMatch is a valid native enum member
    (UNKNOWN), not null."""
    message = ("Добрый день! Помогу сориентироваться по курсам Академии. "
               "Подскажите, какая тема вас интересует?")
    return {
        "message": message,
        "profile": {"displayName": None, "addressMode": None, "nameDeclined": False,
                    "pendingUserRequest": None},
        "conversationState": native_conversation_state_fixture(
            course_id=None, act="META", content=message),
        "contactCard": None,
        "resetConversation": False,
        "requestLabel": request_label,
    }


# ---------------------------------------------------------------------------
# F06 (IV5 -> CORR6 IV6-F06A/F06B): explicit PROVIDER FIXTURE contract V2.
#
# A benchmark-local fixture provides controlled INPUTS (a native-schema
# Navigator response) needed to isolate the component under measurement
# (Alexey consumption/persistence/concurrency). It is NEVER represented as
# evidence that the real provider behaved that way.
#
# IV6-F06A: fixture selection is EXPLICIT by identity — the scenario declares
# a stable PROVIDER_FIXTURE_ID (single, or per-user mapping) as controlled
# INPUT setup; the adapter resolves the id against the fixture's registered
# response registry before the turn. No language/text heuristic participates
# in benchmark-input selection.
#
# IV6-F06B: a fixture advertised as native-schema must be native-schema
# COMPLETE — the full native ChatSuccessResponse envelope and the complete
# 18-field ConversationState structure (typed enums included) are validated
# against the current read-only native source contract. Input-contract
# fidelity does NOT add output assertions (scenarios still assert only what
# they were designed to measure).
#
# IV6-F12A: contention_schedule.provider_pause_s is a deterministic
# benchmark-controlled async pause AT the documented awaited provider point
# (call_navigator_core, awaited inside the native per-user critical section).
# It is a scheduling fixture only — never reported as product behavior.
# ---------------------------------------------------------------------------

NAVIGATOR_RESPONSE_REQUIRED_KEYS = (
    "message", "profile", "conversationState", "contactCard", "resetConversation",
)

NATIVE_ADDRESS_MODES = ("TY", "VY")
NATIVE_LIFECYCLES = ("OPEN", "CLOSED")
NATIVE_COURSE_MATCH_STATES = ("UNKNOWN", "MATCHED", "NO_CURRENT_COURSE_MATCH", "AMBIGUOUS")
NATIVE_FLOW_IDS = ("ADDRESS_SETUP", "COURSE_SELECTION", "COURSE_FOLLOW_UP", "ACADEMY_CONTACT")
NATIVE_LAST_ASSISTANT_ACTS = (
    "ADDRESS_SETUP", "PROFILE_CONTROL", "RESTART", "CONVERSATION_CLOSE", "CANCEL_FLOW",
    "REPEAT", "REPHRASE", "SIMPLIFY", "REPAIR_RESTATE", "REPAIR_CLARIFY",
    "REPAIR_CHALLENGE", "REPAIR_UNAVAILABLE", "RESUME_FLOW", "SKIP",
    "DEFERRED_NOT_ACCEPTED", "STALE_REFERENCE_CONFIRMATION", "CLARIFICATION",
    "CLARIFICATION_EXHAUSTED", "HANDOFF_OFFERED", "HANDOFF_READY", "TECHNICAL_ERROR",
    "NAVIGATE", "COURSE_FOLLOW_UP", "FACTUAL", "PAYMENT", "PAYMENT_CONFIRMATION",
    "ACADEMY_CONTACT", "META", "OUT_OF_SCOPE",
)
NATIVE_HANDOFF_STATUSES = ("NONE", "OFFERED", "REQUESTED", "READY")
NATIVE_EXECUTION_PHASES = ("IDLE", "IN_PROGRESS")

CONVERSATION_STATE_REQUIRED_FIELDS = (
    "lifecycle", "activeFlow", "suspendedFlow", "courseMatch", "selectedCourseId",
    "clarification", "pendingConfirmation", "catalogAuthorityVersion",
    "transactionalAuthorityVersion", "deferredRequest", "lastAssistant",
    "lastActivityAt", "staleReference", "repair", "execution",
    "lastTechnicalError", "handoff", "qualitySignals",
)


def _fail_fixture(where: str, problem: str) -> None:
    raise ValueError(f"{where}: {problem}")


def _validate_native_flow(node: Any, where: str) -> None:
    if node is not None:
        if not isinstance(node, dict) or node.get("id") not in NATIVE_FLOW_IDS \
                or not (node.get("pendingQuestion") is None
                        or isinstance(node.get("pendingQuestion"), str)):
            _fail_fixture(where, f"ConversationFlow field must be null or "
                                 f"{{id in {NATIVE_FLOW_IDS}, pendingQuestion: str|null}}")


def validate_navigator_response_fixture(resp: Any, *, where: str) -> None:
    """IV6-F06B: validate the COMPLETE native response structure required by
    the actual current Navigator response contract (read-only native source
    as authority): the ChatSuccessResponse envelope, the typed Conversation
    Profile, and the complete 18-field ConversationState with its finite
    native enums. Not validating only selected fields is closed: a fixture
    advertised as native-schema must be native-schema complete."""
    if not isinstance(resp, dict):
        _fail_fixture(where, "provider fixture response must be a mapping")
    missing = [k for k in NAVIGATOR_RESPONSE_REQUIRED_KEYS if k not in resp]
    if missing:
        _fail_fixture(where, f"provider fixture response missing native keys {missing}")
    if not isinstance(resp["message"], str):
        _fail_fixture(where, "provider fixture message must be a string")
    prof = resp["profile"]
    if not isinstance(prof, dict) or any(
            k not in prof for k in ("displayName", "addressMode", "nameDeclined",
                                    "pendingUserRequest")):
        _fail_fixture(where, "provider fixture profile must carry the native profile fields")
    if not (prof["displayName"] is None or isinstance(prof["displayName"], str)):
        _fail_fixture(where, "profile.displayName must be string|null")
    if not (prof["addressMode"] is None or prof["addressMode"] in NATIVE_ADDRESS_MODES):
        _fail_fixture(where, f"profile.addressMode must be null or one of {NATIVE_ADDRESS_MODES}")
    if not isinstance(prof["nameDeclined"], bool):
        _fail_fixture(where, "profile.nameDeclined must be a boolean")
    if not (prof["pendingUserRequest"] is None
            or isinstance(prof["pendingUserRequest"], str)):
        _fail_fixture(where, "profile.pendingUserRequest must be string|null")

    cs = resp["conversationState"]
    if not isinstance(cs, dict):
        _fail_fixture(where, "provider fixture conversationState must be a mapping")
    missing_cs = [k for k in CONVERSATION_STATE_REQUIRED_FIELDS if k not in cs]
    if missing_cs:
        _fail_fixture(where, "conversationState missing required native fields "
                             f"{missing_cs} (native ConversationState has "
                             f"{len(CONVERSATION_STATE_REQUIRED_FIELDS)} required fields)")
    if cs["lifecycle"] not in NATIVE_LIFECYCLES:
        _fail_fixture(where, f"conversationState.lifecycle must be in {NATIVE_LIFECYCLES}")
    _validate_native_flow(cs["activeFlow"], where + ": activeFlow")
    _validate_native_flow(cs["suspendedFlow"], where + ": suspendedFlow")
    if cs["courseMatch"] not in NATIVE_COURSE_MATCH_STATES:
        _fail_fixture(where, f"conversationState.courseMatch must be in "
                             f"{NATIVE_COURSE_MATCH_STATES}")
    if not (cs["selectedCourseId"] is None or isinstance(cs["selectedCourseId"], str)):
        _fail_fixture(where, "conversationState.selectedCourseId must be string|null")
    clar = cs["clarification"]
    if clar is not None and (not isinstance(clar, dict)
                             or not isinstance(clar.get("issueKey"), str)
                             or not isinstance(clar.get("attempts"), int)
                             or isinstance(clar.get("attempts"), bool)
                             or not (clar.get("strategyKey") is None
                                     or isinstance(clar.get("strategyKey"), str))):
        _fail_fixture(where, "clarification must be null or "
                             "{issueKey: str, attempts: int, strategyKey: str|null}")
    pc = cs["pendingConfirmation"]
    if pc is not None and (not isinstance(pc, dict)
                           or not isinstance(pc.get("confirmationKey"), str)
                           or pc.get("kind") not in ("STALE_COURSE_REFERENCE",
                                                     "PAYMENT_COURSE_CHANGE")
                           or not isinstance(pc.get("prompt"), str)
                           or not (pc.get("candidateCourseId") is None
                                   or isinstance(pc.get("candidateCourseId"), str))):
        _fail_fixture(where, "pendingConfirmation must be null or the native shape")
    for k in ("catalogAuthorityVersion", "transactionalAuthorityVersion", "deferredRequest"):
        if not (cs[k] is None or isinstance(cs[k], str)):
            _fail_fixture(where, f"conversationState.{k} must be string|null")
    la = cs["lastAssistant"]
    if la is not None and (not isinstance(la, dict)
                           or la.get("act") not in NATIVE_LAST_ASSISTANT_ACTS
                           or not isinstance(la.get("content"), str)
                           or not (la.get("courseId") is None
                                   or isinstance(la.get("courseId"), str))):
        _fail_fixture(where, f"lastAssistant must be null or "
                             f"{{act in native acts, content: str, courseId: str|null}}")
    if not isinstance(cs["lastActivityAt"], str):
        _fail_fixture(where, "conversationState.lastActivityAt must be an ISO string")
    sr = cs["staleReference"]
    if sr is not None and (not isinstance(sr, dict)
                           or not (sr.get("previousCourseId") is None
                                   or isinstance(sr.get("previousCourseId"), str))
                           or not (sr.get("previousFlowId") is None
                                   or sr.get("previousFlowId") in NATIVE_FLOW_IDS)):
        _fail_fixture(where, "staleReference must be null or the native shape")
    rep = cs["repair"]
    if rep is not None and (not isinstance(rep, dict)
                            or not isinstance(rep.get("issueKey"), str)
                            or not isinstance(rep.get("attempts"), int)
                            or isinstance(rep.get("attempts"), bool)):
        _fail_fixture(where, "repair must be null or {issueKey: str, attempts: int}")
    ex = cs["execution"]
    if not isinstance(ex, dict) or ex.get("phase") not in NATIVE_EXECUTION_PHASES \
            or not (ex.get("requestId") is None or isinstance(ex.get("requestId"), str)) \
            or not (ex.get("lastCompletedRequestId") is None
                    or isinstance(ex.get("lastCompletedRequestId"), str)):
        _fail_fixture(where, "execution must be {phase in IDLE|IN_PROGRESS, "
                             "requestId: str|null, lastCompletedRequestId: str|null}")
    te = cs["lastTechnicalError"]
    if te is not None and (not isinstance(te, dict)
                           or te.get("failureClass") not in (
                               "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE",
                               "CONFIGURATION_FAILURE", "DATA_ACCESS_FAILURE",
                               "INTERNAL_RUNTIME_FAILURE", "UNKNOWN_TECHNICAL_FAILURE")
                           or not isinstance(te.get("occurredAt"), str)
                           or not isinstance(te.get("retryable"), bool)
                           or not isinstance(te.get("stage"), str)):
        _fail_fixture(where, "lastTechnicalError must be null or the native shape")
    ho = cs["handoff"]
    if not isinstance(ho, dict) or ho.get("status") not in NATIVE_HANDOFF_STATUSES:
        _fail_fixture(where, f"handoff.status must be in {NATIVE_HANDOFF_STATUSES}")
    if not (ho.get("reason") is None or isinstance(ho.get("reason"), str)):
        _fail_fixture(where, "handoff.reason must be string|null")
    if ho.get("context") is not None and not isinstance(ho.get("context"), dict):
        _fail_fixture(where, "handoff.context must be null or a mapping")
    if not isinstance(cs["qualitySignals"], list):
        _fail_fixture(where, "conversationState.qualitySignals must be a list")
    for signal in cs["qualitySignals"]:
        if not isinstance(signal, dict) or signal.get("signalType") not in (
                "NEGATIVE_FEEDBACK", "MATERIAL_FAILURE"):
            _fail_fixture(
                where, "conversationState.qualitySignals entries must be native "
                "QualitySignal objects whose signalType is NEGATIVE_FEEDBACK or "
                "MATERIAL_FAILURE")

    cc = resp["contactCard"]
    if cc is not None:
        if not isinstance(cc, dict) or cc.get("kind") != "ACADEMY_MANAGER" \
                or not all(isinstance(cc.get(k), str) for k in ("name", "role",
                                                                "availability", "imageUrl")):
            _fail_fixture(where, "contactCard must be null or the complete native "
                                 "AcademyContactCard (kind ACADEMY_MANAGER, name, role, "
                                 "availability, imageUrl, telegram, phone)")
    if not isinstance(resp["resetConversation"], bool):
        _fail_fixture(where, "provider fixture resetConversation must be a boolean")


def native_conversation_state_fixture(*, course_id: str | None, act: str,
                                      content: str,
                                      lifecycle: str = "OPEN") -> dict:
    """Build a COMPLETE native ConversationState (all 18 required fields) for
    provider fixtures (IV6-F06B input fidelity)."""
    return {
        "lifecycle": lifecycle,
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


def _neutral_stub_response(request_label: str) -> dict:
    return _stubbed_navigator_response(request_label)


def _resolve_fixture_by_id(provider_fixture: dict, fixture_id: str, *, where: str) -> dict:
    """IV6-F06A: explicit identity selection against the fixture's registered
    response registry. An unregistered identity is a harness input error."""
    for entry in provider_fixture.get("responses") or []:
        if (entry or {}).get("fixture_id") == fixture_id:
            resp = entry.get("response")
            validate_navigator_response_fixture(
                resp, where=f"{where}: fixture {fixture_id!r}")
            return dict(resp)
    raise ValueError(
        f"{where}: PROVIDER_FIXTURE_ID {fixture_id!r} is not registered in the "
        "fixture response registry (explicit selection requires registration)")


def _provider_fixture_response_for(provider_fixture: dict, fixture_id: str | None,
                                   request_label: str,
                                   conversation_state: Any = None) -> dict:
    """Select the controlled provider response EXPLICITLY (IV6-F06A): by the
    declared fixture identity; state_aware retention (driven by the REQUEST
    INPUT state) applies when no identity is declared for a state_aware
    fixture; a fixture with no selection falls back to the neutral stub."""
    if not isinstance(provider_fixture, dict) or not provider_fixture:
        return _neutral_stub_response(request_label)
    if fixture_id is not None:
        return _resolve_fixture_by_id(provider_fixture, fixture_id,
                                      where="provider fixture")
    if provider_fixture.get("mode") == "state_aware":
        incoming = (conversation_state or {}) if isinstance(conversation_state, dict) else {}
        retained = incoming.get("selectedCourseId")
        if retained:
            resp = _neutral_stub_response(request_label)
            cs = dict(resp["conversationState"])
            cs["courseMatch"] = "MATCHED"
            cs["selectedCourseId"] = retained
            cs["lastAssistant"] = {"act": "COURSE_FOLLOW_UP", "content": resp["message"],
                                   "courseId": retained}
            resp["conversationState"] = cs
            return resp
    return _neutral_stub_response(request_label)


class AlexeyUserTurnAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: LebedevNavigatorAdapter(api_url=..., session_store=TEMP,
    outreach_manager=TEMP). In stubbed mode an ASYNC instance-level transport
    with the EXACT native call_navigator_core signature (messages, profile,
    conversation_state, request_id, payload_bytes) replaces only that seam;
    process_user_turn / get_user_lock run natively. real_local mode keeps the
    NATIVE transport and requires the attested local Navigator server URL.
    INPUT_MAPPING: turns -> user_text; preconditions.user_id/message_id;
    preconditions.users -> native store session seeding (explicit INPUT
    state); provider_fixture -> stimulus-keyed native-schema provider
    responses (F06: INPUT to the component under measurement, never product
    authority, forbidden where Navigator policy generation is the target).
    CONCURRENCY (F07/F12): same event loop, SAME adapter instance and lock
    registry; instrumented native asyncio.Lock keeps the native acquire/
    release protocol (release stays synchronous) while recording TASK-LOCAL
    identity/timing: WAIT_START is bound to each acquire invocation, holder
    metadata is installed only AFTER successful acquisition, and per-task
    records are keyed by task identity — a waiting task can never overwrite
    the active holder's record. Same-user workers share one native lock;
    distinct users get distinct native locks.
    OUTPUT_MAPPING: native return segments -> output (+ payment link extracted
    from the native reply text); store tuple -> state; native classifier and
    lead store -> leadStatus."""

    adapter_id = "alexey_user_turn"

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root
        mod, err = _load_package_module(root, "data_engine", "lebedev_adapter")
        if mod is None:
            return self._fail(err)
        store_mod, err2 = _load_package_module(root, "data_engine", "session_store")
        if store_mod is None:
            return self._fail(err2)
        outreach_mod, err3 = _load_package_module(root, "data_engine", "outreach")
        if outreach_mod is None:
            return self._fail(err3)
        # B-05: adapter-owned plain native representation of frozen values.
        pre = to_native(request.preconditions or {})
        turns = to_native(list(request.turns or ()))
        fault_schedule = to_native(list(getattr(request, "fault_schedule", ()) or ()))
        provider_fixture = to_native(dict(getattr(request, "provider_fixture", {}) or {}))
        env = dict(to_native(request.execution_environment or ()))
        tmp = tempfile.mkdtemp(prefix="alexey-")
        store = store_mod.TelegramSessionStore(db_path=Path(tmp) / "sessions.db")
        hist = outreach_mod.OutreachHistoryManager(db_path=Path(tmp) / "outreach.db")
        mode = pre.get("navigator_transport", "stubbed")
        base_uid = int(pre.get("user_id", 701001))
        if mode == "real_local":
            base_url = str(env.get("navigator_l2_base_url", "")).strip()
            if not base_url:
                # B-09: scenarios measuring real policy output are NOT silently
                # replaced with a canned result — the local Navigator server is
                # a declared future test-base requirement.
                return self._fail(
                    "real_local navigator transport requires the FUTURE local "
                    "Navigator server (navigator_l2_base_url absent from the "
                    "authenticated execution environment); no canned policy "
                    "substitution is permitted"
                )
            # OS-F02: the native transport posts to api_url VERBATIM (complete
            # endpoint, matching the native NAVIGATOR_API_URL contract); derive
            # it from the accepted BASE value exactly like the L2 adapter does.
            api_url = navigator_chat_endpoint(base_url)
        else:
            api_url = "http://127.0.0.1:1/unreachable"
        adapter = mod.LebedevNavigatorAdapter(api_url=api_url, session_store=store, outreach_manager=hist)
        # seed lead state for lifecycle lanes (real history store)
        if pre.get("lead_status"):
            hist.update_lead_status(base_uid, pre["lead_status"],
                                    error_message=None, sync_to_sheets=False)
        # F06: explicit INPUT-side per-user session seeding (preconditions.users
        # is scenario stimulus: the native store state BEFORE the measured
        # turns; it never derives from expected/oracle fields)
        seeded_users = []
        for u in pre.get("users") or []:
            if not isinstance(u, dict) or "user_id" not in u:
                return self._fail("preconditions.users entries must carry user_id")
            ustate = dict(u.get("state") or {})
            store.save_session(int(u["user_id"]), dict(u.get("profile") or {}), ustate)
            seeded_users.append(int(u["user_id"]))

        # ---- B-09 + F06A: async transport fixture with the NATIVE signature -
        transport_calls: list[dict] = []
        original_core = adapter.call_navigator_core
        # IV6-F06A: EXPLICIT fixture identity selection. The scenario declares
        # a stable PROVIDER_FIXTURE_ID (single or per-user map) as controlled
        # INPUT; one_turn resolves the id for the CURRENT user before the
        # native operation; the transport returns exactly that registered
        # response. No language/text heuristic selects benchmark input.
        fixture_by_user = {
            int(uid): fid
            for uid, fid in ((provider_fixture or {}).get("fixture_by_user") or {}).items()
        }
        fixture_by_worker = {
            int(idx): fid
            for idx, fid in ((provider_fixture or {}).get("fixture_by_worker") or {}).items()
        }
        single_fixture_id = (provider_fixture or {}).get("fixture_id")
        # Operation-local fixture binding. The identity is stored on the
        # request id BEFORE any await; stubbed_core reads that request's own
        # binding after the pause. There is no shared selector cell.
        import contextvars
        task_fixture: contextvars.ContextVar[str | None] = contextvars.ContextVar(
            "alexey_operation_fixture_id", default=None)
        request_fixture_bindings: dict[str, str | None] = {}

        # IV6-F12A: deterministic benchmark-controlled async pause AT the
        # documented awaited provider point (call_navigator_core is awaited
        # inside the native per-user critical section). Scheduling fixture
        # only — the measured product behavior is per-user serialization /
        # lock behavior UNDER that controlled schedule, never the pause.
        pause_s = None
        _sched = (provider_fixture or {}).get("contention_schedule") \
            or pre.get("concurrency_schedule") or {}
        try:
            if float(_sched.get("provider_pause_s", 0)) > 0:
                pause_s = float(_sched["provider_pause_s"])
        except (TypeError, ValueError):
            pause_s = None
        provider_pause_evidence = {
            "provider_pause_s": pause_s,
            "pause_point": "awaited provider boundary (call_navigator_core)",
            "fixture_kind": "benchmark-controlled scheduling fixture (not a product claim)",
        } if pause_s else None

        async def stubbed_core(messages, profile, conversation_state, request_id,
                               payload_bytes=None):
            # Bind synchronously at entry, before the scheduling pause, so a
            # concurrent task cannot replace this operation's fixture.
            bound_fixture = task_fixture.get()
            request_key = str(request_id)
            request_fixture_bindings[request_key] = bound_fixture
            transport_calls.append({"user_request_id": request_id,
                                    "messages": len(messages or []),
                                    "fixture_id": bound_fixture})
            if pause_s is not None:
                await asyncio_sleep(pause_s)
            selected = request_fixture_bindings[request_key]
            response = _provider_fixture_response_for(
                provider_fixture, selected,
                f"{request.run_id}-{request.scenario_id}", conversation_state)
            # Payment carries no course of its own. The course written here is
            # the selection already committed in this user's store.
            if response.get("bindPaymentToCommittedSelection"):
                import copy
                response = copy.deepcopy(response)
                response.pop("bindPaymentToCommittedSelection", None)
                committed = conversation_state.get("selectedCourseId") \
                    if isinstance(conversation_state, dict) else None
                state = response.get("conversationState")
                if isinstance(state, dict):
                    state["selectedCourseId"] = committed
                    state["courseMatch"] = "MATCHED" if committed else "UNKNOWN"
                    last = state.get("lastAssistant")
                    if isinstance(last, dict):
                        last["act"] = "PAYMENT"
                        last["courseId"] = committed
                if isinstance(committed, str) and committed:
                    response["message"] = (
                        "https://t.me/AST_payment_course_bot?start=" + committed)
                else:
                    response["message"] = "https://t.me/AST_payment_course_bot"
            return response

        if mode != "real_local":
            adapter.call_navigator_core = stubbed_core

        # ---- B-10 + F07: instrumented native lock ----------------------------
        # TASK-LOCAL state: wait timestamps are bound to each acquire
        # INVOCATION (local variables), holder metadata is installed only
        # after successful acquisition, and per-task records are keyed by task
        # identity in a task-keyed map — a waiting task can never overwrite
        # the active holder's identity/timing record.
        lock_windows: list[dict] = []
        import asyncio

        class _InstrumentedLock(asyncio.Lock):
            """Native asyncio.Lock with TASK-LOCAL timing instrumentation
            (F07). acquire() (already async natively) binds WAIT_START as a
            local of the invocation and installs the holder record only after
            super().acquire() returns; release() remains a SYNCHRONOUS method
            exactly like the native protocol and completes the CURRENT task's
            record."""

            def __init__(self, uid):
                super().__init__()
                self._bench_uid = uid
                self._bench_identity = f"user-lock-{uid}-{id(self):x}"
                self._bench_records: dict[str, dict] = {}  # task-keyed, append-only

            def _task_id(self) -> str:
                task = asyncio.current_task()
                return (getattr(task, "get_name", lambda: None)() or str(id(task)))

            async def acquire(self):
                task_id = self._task_id()
                wait_start = time.perf_counter_ns()  # local to THIS invocation
                got = await super().acquire()
                acquired_at = time.perf_counter_ns()
                # holder metadata installed only after successful acquisition
                self._bench_records[task_id] = {
                    "task_id": task_id,
                    "user_id": self._bench_uid,
                    "lock_identity": self._bench_identity,
                    "wait_start_ns": wait_start,
                    "acquired_at_ns": acquired_at,
                    "critical_end_ns": None,
                    "release_completed": False,
                }
                return got

            def release(self):
                task_id = self._task_id()
                t1 = time.perf_counter_ns()
                super().release()
                rec = self._bench_records.get(task_id)
                if rec is not None and not rec["release_completed"]:
                    rec["critical_end_ns"] = t1
                    rec["release_completed"] = True
                    lock_windows.append({
                        "worker_id": rec["task_id"],
                        "user_id": rec["user_id"],
                        "lock_identity": rec["lock_identity"],
                        "acquire_wait": rec["acquired_at_ns"] - rec["wait_start_ns"],
                        "wait_start_ns": rec["wait_start_ns"],
                        "critical_start": rec["acquired_at_ns"],
                        "critical_end": t1,
                        "lock_release_completed": True,
                    })

        per_user_mode = bool(pre.get("per_user_mode"))
        workers = int(getattr(request, "concurrency_workers", 0) or 0)
        workers = max(1, workers)
        user_ids = [base_uid + i for i in range(workers)] if (per_user_mode and workers > 1) \
            else [base_uid] * workers
        lock_registry: dict[int, _InstrumentedLock] = {}

        # ---- B-11 + F13: fault hooks installed on EVERY control path ---------
        fault_evidence: list[dict] = [{}]
        if fault_schedule:
            fs = fault_schedule[0]
            hook_err = _install_alexey_fault_hook(
                fs, adapter, store, base_uid, transport_calls, fault_evidence)
            if isinstance(hook_err, RawCapture):
                return hook_err

        errors: list[str] = []

        async def one_turn(idx: int):
            uid = user_ids[idx]
            # Resolve the declared fixture for THIS operation and bind it to
            # the task before the native call. Worker binding wins over the
            # per-user map when the scenario declares an operation index.
            if idx in fixture_by_worker:
                selected_fixture = fixture_by_worker[idx]
            else:
                selected_fixture = fixture_by_user.get(uid, single_fixture_id)
            task_fixture.set(selected_fixture)
            text = turns[min(idx, len(turns) - 1)]["content"] if turns else "Хочу Маслоу"
            return await adapter.process_user_turn(uid, text, 5000 + idx)

        async def runner():
            # Locks are created on the running loop. Python 3.9 refuses
            # asyncio.Lock() after a previous asyncio.run has closed its loop.
            for uid in {base_uid} | set(user_ids) | set(seeded_users):
                lock_registry[uid] = _InstrumentedLock(uid)
                adapter.user_locks[uid] = lock_registry[uid]
            # B-11: the native operation (process_user_turn) is invoked on the
            # single-worker AND multi-worker paths alike; a fault schedule is
            # installed before the operation and never replaces it.
            if workers >= 2:
                tasks = [asyncio.create_task(one_turn(i), name=f"alexey-worker-{i}")
                         for i in range(workers)]
                return await asyncio.gather(*tasks, return_exceptions=False)
            return await one_turn(0)

        # F06 native INPUT mapping for single-worker multi-turn scenarios: the
        # native process_user_turn handles ONE message per call and draws
        # conversation history from the native store — earlier turns are
        # seeded into the store through the native append_message path and
        # the LAST turn is the current message.
        if workers == 1 and len(turns) > 1:
            try:
                for prior in turns[:-1]:
                    store.append_message(base_uid, "user", str(prior.get("content", "")))
            except Exception:  # noqa: BLE001 — native store contract; surfaced below if fatal
                pass
            turns = turns[-1:]

        turn_results: list[Any] = []
        try:
            result = asyncio.run(runner())
            # OS-F03: the native single-worker process_user_turn returns a
            # FLAT list of reply strings; the multi-worker gather returns one
            # reply list PER WORKER. Normalize to per-worker reply lists
            # WITHOUT flattening a legitimate single-worker list[str] reply;
            # a non-list result keeps the legacy single-slot projection and
            # an empty native reply stays empty (nothing is fabricated).
            if isinstance(result, list):
                turn_results = [result] if workers < 2 else list(result)
            else:
                turn_results = [result]
        except Exception as exc:  # noqa: BLE001 — native failure surfaces honestly
            errors.append(f"{type(exc).__name__}: {exc}")

        # ---- F12: mechanism-split concurrency evidence ------------------------
        concurrency: dict[str, Any] = {}
        if workers >= 2:
            same_user = len(set(user_ids)) == 1
            task_records = [dict(w) for w in lock_windows]
            intervals = [[w["critical_start"], w["critical_end"]] for w in lock_windows]
            # contention evidence (SAME_USER_SERIALIZATION): some task began
            # waiting BEFORE an earlier holder's release completed, and its
            # acquisition strictly followed that release
            contention_events = 0
            waiting_tasks = 0
            for w in lock_windows:
                if w["acquire_wait"] > 0:
                    waiting_tasks += 1
                for other in lock_windows:
                    if other is w:
                        continue
                    if w["wait_start_ns"] < other["critical_end"] <= w["critical_start"]:
                        contention_events += 1
                        break
            non_overlapping = True
            ordered = sorted(intervals)
            for a, b in zip(ordered, ordered[1:]):
                if a[1] > b[0]:
                    non_overlapping = False
            lock_identities_by_task = [w["lock_identity"] for w in lock_windows]
            distinct_locks = len(set(lock_identities_by_task))
            concurrency = {
                "workers": workers,
                "worker_ids": [f"alexey-worker-{i}" for i in range(workers)],
                "participant_identities": [w["worker_id"] for w in lock_windows],
                "task_records": [{
                    "task_id": w["worker_id"], "user_id": w["user_id"],
                    "lock_identity": w["lock_identity"],
                    "wait_start_ns": w["wait_start_ns"],
                    "acquired_at_ns": w["critical_start"],
                    "critical_end_ns": w["critical_end"],
                    "release_completed": w["lock_release_completed"],
                } for w in lock_windows],
                "intervals": [[w["critical_start"] - w["acquire_wait"], w["critical_end"]]
                              for w in lock_windows],
                "native_operation_intervals": intervals,
                "lock_user_ids": [w["user_id"] for w in lock_windows],
                "same_user_shared_lock": same_user,
                "lock_identity": ("SHARED" if same_user and distinct_locks == 1
                                  else "PER_USER"),
                "lock_identities_by_task": lock_identities_by_task,
                "distinct_lock_identities": distinct_locks,
                "lock_identities_match_users": (
                    len({(w["user_id"], w["lock_identity"]) for w in lock_windows})
                    == len({w["user_id"] for w in lock_windows})),
                "contention_evidence": {
                    "contention_proven": contention_events >= 1,
                    "contention_events": contention_events,
                    "waiting_tasks": waiting_tasks,
                    "rule": ("a waiter began waiting before the earlier holder's "
                             "release completed and acquired strictly after it"),
                },
                "critical_sections_non_overlapping": non_overlapping,
                "overlap_proven": (not same_user) and len(intervals) >= 2 and (
                    max(i[0] for i in intervals) < min(i[1] for i in intervals)),
                "controlled_schedule": provider_pause_evidence,
                "target_seam": "LebedevNavigatorAdapter.get_user_lock",
                "schedule_id": f"{request.scenario_id}-A{request.attempt}",
                "scheduler": "asyncio.same_loop",
                "lock_release_completed_all": all(w["lock_release_completed"] for w in lock_windows),
            }

        final_state: dict[str, Any] = {}
        try:
            for uid in sorted(set(user_ids)):
                raw = store.get_session(uid)
                if isinstance(raw, tuple):
                    profile_s, st = (raw + (None, None))[:2]
                    projected = {"selectedCourseId": (st or {}).get("selectedCourseId"),
                                 "displayName": (profile_s or {}).get("displayName")}
                    if pre.get("observe_handoff_context"):
                        handoff = (st or {}).get("handoff") or {}
                        context = handoff.get("context") if isinstance(handoff, dict) else None
                        context = context if isinstance(context, dict) else {}
                        facts = context.get("facts")
                        projected["handoffCourseId"] = context.get("courseId")
                        projected["handoffRecord"] = {
                            "status": handoff.get("status") if isinstance(handoff, dict) else None,
                            "goal": context.get("goal"),
                            "courseId": context.get("courseId"),
                            "contactPreference": context.get("contactPreference"),
                            "facts": list(facts) if isinstance(facts, list) else facts,
                        }
                    if pre.get("observe_payment_binding"):
                        last = (st or {}).get("lastAssistant") if isinstance(st, dict) else None
                        last = last if isinstance(last, dict) else {}
                        projected["paymentCourseId"] = (
                            last.get("courseId") if last.get("act") == "PAYMENT" else None)
                    final_state[str(uid)] = projected
        except Exception:  # noqa: BLE001
            pass
        lead_after = None
        if pre.get("lead_status"):
            lead_after = (hist.get_lead(base_uid) or {}).get("status")

        fault_block = dict(fault_evidence[0]) if fault_evidence[0] else {}
        if fault_schedule and not fault_block:
            fs0 = fault_schedule[0]
            from harness.mechanisms import FAULT_MECHANISMS
            rec = FAULT_MECHANISMS.get(fs0.get("mechanism_id"))
            fault_block = {
                "fault_mechanism_id": fs0.get("mechanism_id"),
                "fault_target": (rec.physical_fixture_seam if rec else fs0.get("target")),
                "fault_point": (rec.point if rec else fs0.get("point")),
                "fault_kind": (rec.kind if rec else fs0.get("kind")),
                "fault_confirmed_injected": False,
                "mechanism_evidence": {},
                "operation_invoked": len(transport_calls),
            }
        if not fault_block.get("fault_confirmed_injected"):
            # unconfirmed/absent hook evidence: transport-level invocation count
            fault_block["operation_invoked"] = len(transport_calls)

        if errors:
            # native exceptions from process_user_turn are captured reactions
            return RawCapture(values={"act": "NATIVE_ERROR_REACTION", "origin": "ALEXEY_USER_TURN",
                                      "state": {"nativeError": errors[0][:200]}, "link": None,
                                      "output": "", "tool_api": [], "mutations": []},
                              transcripts={"assistant_reply": json.dumps(errors)},
                              concurrency=concurrency, fault=fault_block,
                              sut_path=f"{root}/data_engine/lebedev_adapter.py",
                              sut_symbol="LebedevNavigatorAdapter.process_user_turn",
                              outcome_class="BOUNDED_FALLBACK")
        reply = turn_results[0] if turn_results and isinstance(turn_results[0], list) else []
        output_text = " | ".join(str(s) for s in (reply or []))[:4000]
        links_in_reply = PAY_URL_RE.findall(output_text)
        return RawCapture(
            values={"act": "USER_TURN_PROCESSED", "origin": "ALEXEY_USER_TURN",
                    "state": {**final_state, "leadStatus": lead_after},
                    "link": links_in_reply[0] if links_in_reply else None,
                    "output": output_text,
                    "tool_api": [], "mutations": []},
            transcripts={"assistant_reply": output_text[:8000]},
            concurrency=concurrency,
            fault=fault_block,
            auxiliary_diagnostics=({"provider_fixture_mode": "stimulus_keyed"}
                                   if provider_fixture else {}),
            sut_path=f"{root}/data_engine/lebedev_adapter.py",
            sut_symbol="LebedevNavigatorAdapter.process_user_turn|get_user_lock",
            outcome_class="BOUNDED_FALLBACK" if fault_schedule else "CLEAN",
        )


def _install_alexey_fault_hook(fs: dict, adapter, store, uid: int,
                               transport_calls: list, fault_evidence: list):
    """B-11 + F13: install a REAL causal hook whose identity derives from the
    REGISTERED fault mechanism (harness/mechanisms.py). The scenario references
    a FAULT_MECHANISM_ID; kind/target/point are taken from the REGISTRY record
    (the registered mechanism implementation), not from free-form scenario
    labels — the instrumentation cannot repeat arbitrary scenario labels back
    as proof. LOST_RESPONSE represents REAL ORDER since CORR5 (§29): the
    native process_user_turn runs to completion (its normal persistence
    observed), and only then is delivery of the returned response suppressed.
    Returns None on success, or a RawCapture refusal for an unimplemented
    fault kind."""
    from harness.seams.fault import FaultHook, FaultKind
    from harness.mechanisms import FAULT_MECHANISMS

    mechanism_id = fs.get("mechanism_id")
    registry_rec = FAULT_MECHANISMS.get(mechanism_id) if mechanism_id else None
    if mechanism_id and registry_rec is None:
        return RawCapture(
            capture_error=f"fault mechanism id {mechanism_id!r} is not registered",
            sut_symbol="fault", outcome_class="TECHNICAL_ERROR")
    kind = registry_rec.kind if registry_rec else fs.get("kind")
    target = registry_rec.physical_fixture_seam if registry_rec else fs.get(
        "target", "navigator_transport")
    point = registry_rec.point if registry_rec else fs.get("point", "before_response")
    try:
        hook = FaultHook(target, point, FaultKind(kind))
    except ValueError:
        return RawCapture(
            capture_error=f"fault kind {kind!r} has no registered native hook contract",
            sut_symbol="fault", outcome_class="TECHNICAL_ERROR")

    original_core = adapter.call_navigator_core
    writes = {"n": 0}
    original_save = store.save_session

    def counting_save(user_id, profile, state):
        writes["n"] += 1
        return original_save(user_id, profile, state)

    store.save_session = counting_save

    def _record(mechanism: dict, dropped: bool = False, invoked: int | None = None):
        fault_evidence[0] = {
            "fault_mechanism_id": (registry_rec.mechanism_id if registry_rec
                                   else mechanism_id),
            "fault_target": hook.record.fault_target,
            "fault_point": hook.record.fault_point,
            "fault_kind": hook.record.fault_kind,
            "fault_confirmed_injected": True,
            "operation_invoked": (len(transport_calls) if invoked is None
                                  else max(invoked, len(transport_calls))),
            "mechanism_evidence": mechanism,
        }

    if kind == "LOST_RESPONSE":
        # F13 §29 REAL ORDER: wrap the native process_user_turn itself. The
        # original operation runs to completion — call_navigator_core, the
        # NATIVE save_session of the returned state, everything — and only
        # THEN is delivery of the returned user-facing response suppressed by
        # the benchmark fixture. Proof: durable write(s) through the native
        # store path DURING the turn, non-null persisted state after
        # completion, response dropped afterward. A pre-persistence write is
        # never labeled durable processed state.
        original_put = adapter.process_user_turn
        process_invocations = {"n": 0}

        async def lost_response_put(user_id, user_text, message_id):
            process_invocations["n"] += 1
            writes_before = writes["n"]
            res = await original_put(user_id, user_text, message_id)
            writes_during = writes["n"] - writes_before
            persisted = store.get_session(user_id)
            persisted_state = (persisted[1] if isinstance(persisted, tuple)
                               and len(persisted) > 1 else None)
            _record({
                "durable_write_proven": writes_during >= 1,
                "durable_writes": writes_during,
                "persisted_state_present": persisted_state is not None,
                "persisted_selected_course": (persisted_state or {}).get(
                    "selectedCourseId") if isinstance(persisted_state, dict) else None,
                "processing_completed": True,
                "response_dropped": True,
            }, invoked=process_invocations["n"])
            return None  # the user-facing response is lost AFTER full processing
        adapter.process_user_turn = lost_response_put
        return None
    if kind == "DEPENDENCY_500":
        async def failing_core(messages, profile, conversation_state, request_id,
                               payload_bytes=None):
            transport_calls.append({"user_request_id": request_id, "fault": kind})
            _record({"raised": "DependencyError(500)"})
            raise RuntimeError("injected fault: HTTP 500")
        adapter.call_navigator_core = failing_core
        return None
    if kind == "DEPENDENCY_429":
        async def rate_limited_core(messages, profile, conversation_state, request_id,
                                    payload_bytes=None):
            transport_calls.append({"user_request_id": request_id, "fault": kind})
            _record({"raised": "DependencyError(429)"})
            raise RuntimeError("injected fault: HTTP 429")
        adapter.call_navigator_core = rate_limited_core
        return None
    if kind == "TIMEOUT_BEFORE_PROCESSING":
        async def timeout_before_core(messages, profile, conversation_state, request_id,
                                      payload_bytes=None):
            transport_calls.append({"user_request_id": request_id, "fault": kind})
            _record({"raised": "TimeoutError(before)", "at": "before_processing",
                     "processing_started": False})
            raise TimeoutError(f"injected fault: timeout before {target}")
        adapter.call_navigator_core = timeout_before_core
        return None
    if kind == "MALFORMED_DEPENDENCY_PAYLOAD":
        async def malformed_core(messages, profile, conversation_state, request_id,
                                 payload_bytes=None):
            transport_calls.append({"user_request_id": request_id, "fault": kind})
            _record({"payload": "{not-valid-json"})
            return "{not-valid-json"
        adapter.call_navigator_core = malformed_core
        return None
    if kind == "TIMEOUT_AFTER_PROCESSING":
        delay = float(fs.get("delay_s", 0.05))
        deadline = float(fs.get("deadline_s", 0.01))

        async def delayed_core(messages, profile, conversation_state, request_id,
                               payload_bytes=None):
            transport_calls.append({"user_request_id": request_id, "fault": kind})
            res = await original_core(messages=messages, profile=profile,
                                      conversation_state=conversation_state,
                                      request_id=request_id, payload_bytes=payload_bytes)
            t0 = time.perf_counter_ns()
            await asyncio_sleep(delay)
            t1 = time.perf_counter_ns()
            exceeded = (t1 - t0) > int(deadline * 1e9) and delay > 0
            _record({"delay_s": delay, "deadline_s": deadline,
                     "deadline_exceeded": bool(exceeded),
                     "durable_write_proven": writes["n"] >= 1,
                     "processing_completed_before_breach": True})
            return res
        adapter.call_navigator_core = delayed_core
        return None
    return RawCapture(capture_error=f"fault kind {kind!r} has no implemented native hook",
                      sut_symbol="fault", outcome_class="TECHNICAL_ERROR")


def asyncio_sleep(delay: float):
    import asyncio

    return asyncio.sleep(delay)


# ---------------------------------------------------------------------------
# Outbound dispatcher / lead lifecycle — native invocations (§34)
# ---------------------------------------------------------------------------

class OutboundDispatcherAdapter(_AdapterBase):
    """NATIVE_CALL_GRAPH: SafeOutreachDispatcher.send_single(target, message)
    with a stubbed TelegramClient (connect returns the stub; the stub raises
    FloodWaitError or returns a message object). INPUT_MAPPING: turns[-1] ->
    message; preconditions.flood_wait_seconds -> stub behavior.
    OUTPUT_MAPPING: the NATIVE returned dict -> state (verbatim)."""

    adapter_id = "outbound_dispatcher"

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root
        mod, err = _load_package_module(root, "data_engine", "outreach")
        if mod is None:
            return self._fail(err)
        pre = to_native(request.preconditions or {})
        wait_s = pre.get("flood_wait_seconds")

        class _StubClient:
            async def send_message(self, target, message):
                if wait_s is not None:
                    raise mod.FloodWaitError(wait_s) if hasattr(mod, "FloodWaitError") else _FloodWait(wait_s)
                class _Sent:
                    id = 4242
                return _Sent()

        class _FloodWait(Exception):
            def __init__(self, s):
                self.seconds = s

        stub = _StubClient()
        dispatcher = mod.SafeOutreachDispatcher.__new__(mod.SafeOutreachDispatcher)
        # minimal native construction: connect() returns the stub client
        dispatcher.client = stub
        dispatcher.daily_limit = None
        message_text = request.turns[-1]["content"] if request.turns else "текст"
        import asyncio

        async def run():
            async def connect():
                return stub
            dispatcher.connect = connect
            return await dispatcher.send_single("target_entity", message_text)

        try:
            result = asyncio.run(run())
        except Exception as exc:  # noqa: BLE001
            return RawCapture(capture_error=f"native send_single raised: {type(exc).__name__}: {exc}",
                              sut_symbol="SafeOutreachDispatcher.send_single", outcome_class="TECHNICAL_ERROR")
        return RawCapture(
            values={"act": "SEND_SINGLE_RETURNED", "origin": "OUTBOUND_DISPATCHER",
                    "state": {"sendResult": result},
                    "link": None, "output": json.dumps(result, ensure_ascii=False, default=str),
                    "tool_api": [], "mutations": []},
            transcripts={"assistant_reply": json.dumps(result, ensure_ascii=False, default=str)},
            sut_path=f"{root}/data_engine/outreach.py",
            sut_symbol="SafeOutreachDispatcher.send_single",
            outcome_class="CLEAN",
        )


class OutboundLeadLifecycleAdapter(AlexeyUserTurnAdapter):
    """Real lifecycle through the NATIVE lebedev lead-stage branch:
    process_user_turn with a FIRST_TOUCH lead + refusal text -> the native
    branch classifies through classify_lead_intent, persists STAGE_STOPPED and
    returns the native apology; a SECOND process_user_turn is suppressed by
    the STOPPED gate. B-13: classifiedIntent is the ACTUAL return value of the
    native classify_lead_intent(clean_text, lead_status) call — never inferred
    from reply truthiness. Persistence (stage) and suppression (second turn)
    are observed separately from the classification."""

    adapter_id = "outbound_lead_lifecycle"

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root
        mod, err = _load_package_module(root, "data_engine", "lebedev_adapter")
        if mod is None:
            return self._fail(err)
        store_mod, err2 = _load_package_module(root, "data_engine", "session_store")
        if store_mod is None:
            return self._fail(err2)
        outreach_mod, err3 = _load_package_module(root, "data_engine", "outreach")
        if outreach_mod is None:
            return self._fail(err3)
        pre = to_native(request.preconditions or {})
        turns = to_native(list(request.turns or ()))
        tmp = tempfile.mkdtemp(prefix="outbound-")
        store = store_mod.TelegramSessionStore(db_path=Path(tmp) / "sessions.db")
        hist = outreach_mod.OutreachHistoryManager(db_path=Path(tmp) / "outreach.db")
        adapter = mod.LebedevNavigatorAdapter(api_url="http://127.0.0.1:1/unreachable",
                                              session_store=store, outreach_manager=hist)

        # B-09: async transport fixture with the NATIVE call_navigator_core
        # signature (the old synchronous wrong-parameter stub always raised).
        async def stubbed_core(messages, profile, conversation_state, request_id,
                               payload_bytes=None):
            return _stubbed_navigator_response(f"{request.run_id}-{request.scenario_id}")

        adapter.call_navigator_core = stubbed_core
        uid = int(pre.get("user_id", 900001))
        lead_status = pre.get("lead_status", outreach_mod.STAGE_FIRST_TOUCH_SENT)
        hist.update_lead_status(uid, lead_status, sync_to_sheets=False)
        refusal_text = turns[0]["content"] if turns else "Не пишите мне больше."

        # B-13: the ACTUAL native classifier result for this exact stimulus
        # (the same call the native lead branch performs), captured directly.
        classified_intent = outreach_mod.classify_lead_intent(refusal_text.strip(), lead_status)

        import asyncio

        async def run():
            first = await adapter.process_user_turn(uid, refusal_text, 7001)
            second = await adapter.process_user_turn(uid, "Любой следующий текст", 7002)
            return first, second

        try:
            first, second = asyncio.run(run())
        except Exception as exc:  # noqa: BLE001
            return RawCapture(capture_error=f"native lifecycle raised: {type(exc).__name__}: {exc}",
                              sut_symbol="process_user_turn lead branch", outcome_class="TECHNICAL_ERROR")
        lead_after = (hist.get_lead(uid) or {}).get("status")
        suppressed = (second == [] or second is None)
        return RawCapture(
            values={"act": "LEAD_LIFECYCLE_NATIVE", "origin": "ALEXEY_LEAD_BRANCH",
                    "state": {"leadStatus": lead_after,
                              "classifiedIntent": classified_intent,
                              "classifiedIntentSource": "native classify_lead_intent return value",
                              "suppressionHonored": bool(suppressed)},
                    "link": None,
                    "output": " | ".join(str(s) for s in (first or []))[:2000],
                    "tool_api": [], "mutations": []},
            transcripts={"assistant_reply": " | ".join(str(s) for s in (first or []))[:4000],
                         "second_turn_reply": json.dumps(second, default=str)},
            sut_path=f"{root}/data_engine/lebedev_adapter.py (lead-stage branch)",
            sut_symbol="classify_lead_intent|update_lead_status|STAGE_STOPPED|process_user_turn",
            outcome_class="CLEAN",
        )


# ---------------------------------------------------------------------------
# Static source inventory — registered TYPED static queries (§35; IV4 B-12)
# ---------------------------------------------------------------------------

def _collect_defined_symbols(tree) -> set[str]:
    """Declaration names: functions, classes (incl. qualified methods),
    module-level assignments, imported aliases, and keyword-parameter names
    of decorators/calls at module level are NOT symbols."""
    import ast as _ast

    names: set[str] = set()
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            names.add(node.name)
            if isinstance(node, _ast.ClassDef):
                for sub in node.body:
                    if isinstance(sub, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                        names.add(f"{node.name}.{sub.name}")
        if isinstance(node, _ast.Assign):
            for t in node.targets:
                if isinstance(t, _ast.Name):
                    names.add(t.id)
                if isinstance(t, _ast.Attribute):
                    names.add(_ast.unparse(t))
        if isinstance(node, _ast.AnnAssign) and isinstance(node.target, _ast.Name):
            names.add(node.target.id)
        if isinstance(node, (_ast.Import, _ast.ImportFrom)):
            for alias in node.names:
                names.add(alias.asname or alias.name)
    return names


def _qualified_references(tree) -> set[str]:
    """Qualified attribute expressions appearing in CODE (e.g. `asyncio.Lock`,
    `aiogram.filters.MagicFilter`) — comments/strings cannot appear here."""
    import ast as _ast

    refs: set[str] = set()
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Attribute):
            try:
                refs.add(_ast.unparse(node))
            except Exception:  # noqa: BLE001 — unparse fallback
                pass
    return refs


def _call_targets(tree) -> set[str]:
    """Syntactic CALL EXPRESSIONS (name or last attribute segment), e.g.
    `start_polling(...)`, `bot.send_message(...)` -> {'start_polling',
    'send_message', 'bot.send_message'}."""
    import ast as _ast

    calls: set[str] = set()
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Call):
            try:
                calls.add(_ast.unparse(node.func))
            except Exception:  # noqa: BLE001
                continue
            f = node.func
            if isinstance(f, _ast.Attribute):
                calls.add(f.attr)
            elif isinstance(f, _ast.Name):
                calls.add(f.id)
    return calls


def _configured_value_fragments(tree) -> set[str]:
    """Actual configured-value expressions: keyword arguments of calls,
    assignment right-hand sides, and comparison constants — as CODE TEXT
    (comments and string literals elsewhere cannot produce these fragments)."""
    import ast as _ast

    frags: set[str] = set()
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Call):
            for kw in node.keywords:
                try:
                    frags.add(f"{kw.arg}={_ast.unparse(kw.value)}")
                except Exception:  # noqa: BLE001
                    pass
        if isinstance(node, _ast.Assign):
            try:
                frags.add(_ast.unparse(node.value))
            except Exception:  # noqa: BLE001
                pass
    return frags


# ---------------------------------------------------------------------------
# F08 (IV5 -> CORR6 IV6-F08): TYPED configuration-value comparison.
#
# Whitespace-stripping text comparison is RETIRED (IV5) and so is structural
# AST guessing (IV6): the registered comparison contract is now exactly:
#   1. LITERAL vs LITERAL — typed equality: the requested and actual parsed
#      literals must have the SAME Python type and equal value. True != 1,
#      1 != "1", "a b" != "ab". Literal containers compare recursively with
#      the same typed rule.
#   2. REGISTERED CONFIGURED-SYMBOL IDENTITY — a requested BARE identifier
#      matches a configured Call by exact callee identity or a configured
#      Name by exact identity (string equality only; no structural guessing).
#   3. Any other requested value expression (calls, attributes, operators…)
#      is UNSUPPORTED by this query contract: the derived fact is
#      NOT_OBSERVABLE (None), never a guessed equivalence.
# ---------------------------------------------------------------------------

_NOT_PARSED = object()
_UNSUPPORTED = object()


def _is_bare_identifier(node) -> bool:
    """The registered configured-symbol form: a bare Python identifier."""
    import ast as _ast

    return isinstance(node, _ast.Name)


def _parse_value_expression(text: str):
    """Parse a requested configured-value expression into an AST node, or
    _NOT_PARSED when it is not a parseable expression."""
    import ast as _ast

    try:
        return _ast.parse(str(text).strip(), mode="eval").body
    except (SyntaxError, ValueError):
        return _NOT_PARSED


def _parse_requested_config(expr: str):
    """Parse "target=value" (assignment target / call keyword context) or a
    bare value expression. Returns (target_name_or_None, value_node)."""
    import ast as _ast

    text = str(expr or "").strip()
    if not text:
        return None, _NOT_PARSED
    try:
        mod = _ast.parse(text, mode="exec")
    except (SyntaxError, ValueError):
        return None, _NOT_PARSED
    if (len(mod.body) == 1 and isinstance(mod.body[0], _ast.Assign)
            and len(mod.body[0].targets) == 1):
        tgt = mod.body[0].targets[0]
        name = tgt.id if isinstance(tgt, _ast.Name) else _ast.unparse(tgt)
        return name, mod.body[0].value
    node = _parse_value_expression(text)
    return None, node


def _configured_literal_bindings(tree) -> list[tuple]:
    """Actual configured values as PARSED (target, value-node) bindings: call
    keywords, assignment right-hand sides and annotated assignments. Comments
    and string text elsewhere cannot produce these bindings."""
    import ast as _ast

    out: list[tuple] = []
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Call):
            for kw in node.keywords:
                if kw.arg:
                    out.append((kw.arg, kw.value))
        if isinstance(node, _ast.Assign) and len(node.targets) == 1:
            t = node.targets[0]
            try:
                name = t.id if isinstance(t, _ast.Name) else _ast.unparse(t)
            except Exception:  # noqa: BLE001
                name = None
            out.append((name, node.value))
        if isinstance(node, _ast.AnnAssign) and node.value is not None:
            try:
                name = (node.target.id if isinstance(node.target, _ast.Name)
                        else _ast.unparse(node.target))
            except Exception:  # noqa: BLE001
                name = None
            out.append((name, node.value))
    return out


def _typed_literal_equal(a: Any, b: Any) -> bool:
    """Typed literal equality: bool/int/str are DISTINCT types — True != 1,
    1 != "1"; strings compare by exact characters — "a b" != "ab"; literal
    containers compare recursively under the same rule."""
    if type(a) is not type(b):
        return False
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a is b
    if isinstance(a, (int, float, str, bytes, type(None))):
        return a == b
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_typed_literal_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return (set(a.keys()) == set(b.keys())
                and all(_typed_literal_equal(a[k], b[k]) for k in a))
    return False


def _literal_of(node):
    import ast as _ast

    try:
        return _ast.literal_eval(node)
    except (ValueError, SyntaxError, TypeError):
        return _NOT_PARSED


def _semantic_config_equal(requested_node, actual_node) -> bool:
    """IV6-F08 typed comparison. Returns bool for the two REGISTERED forms
    (literal vs literal; bare-identifier configured-symbol identity). The
    caller routes unsupported requested expressions to NOT_OBSERVABLE before
    invoking this."""
    import ast as _ast

    if requested_node is _NOT_PARSED or actual_node is None:
        return False
    req_lit, act_lit = _literal_of(requested_node), _literal_of(actual_node)
    if req_lit is not _NOT_PARSED and act_lit is not _NOT_PARSED:
        return _typed_literal_equal(req_lit, act_lit)
    # registered configured-symbol rule: bare identifier identity only
    if isinstance(requested_node, _ast.Name):
        if isinstance(actual_node, _ast.Name) and actual_node.id == requested_node.id:
            return True
        if isinstance(actual_node, _ast.Call):
            f = actual_node.func
            if isinstance(f, _ast.Name) and f.id == requested_node.id:
                return True
            if isinstance(f, _ast.Attribute) and f.attr == requested_node.id:
                return True
        return False
    return False


def _normalize_fragment(text: str) -> str:
    # RETIRED for comparison purposes (F08): retained only for derivation
    # method labels; never used to compare configured values.
    return re.sub(r"\s+", "", str(text))


def _registration_constructs(tree, symbol: str) -> bool:
    """Actual registration constructs: a `.register(...)`/`.add_handler(...)`
    call whose argument names `symbol`, or a decorator application of it."""
    import ast as _ast

    for node in _ast.walk(tree):
        if isinstance(node, _ast.Call) and isinstance(node.func, _ast.Attribute) \
                and node.func.attr in ("register", "add_handler", "add_middleware",
                                       "message", "callback_query"):
            for arg in node.args:
                if isinstance(arg, _ast.Name) and arg.id == symbol:
                    return True
                if isinstance(arg, _ast.Attribute) and arg.attr == symbol:
                    return True
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            for dec in node.decorator_list:
                if isinstance(dec, _ast.Name) and dec.id == symbol:
                    return True
                if isinstance(dec, _ast.Call) and isinstance(dec.func, _ast.Attribute) \
                        and dec.func.attr == symbol:
                    return True
                if isinstance(dec, _ast.Attribute) and dec.attr == symbol:
                    return True
    return False


def _lock_primitive_calls(tree) -> bool:
    """Actual lock-constructor call expressions: asyncio.Lock(),
    threading.Lock(), any `*.Lock()` / bare `Lock()` CALL (not comment text,
    not an arbitrary identifier mention)."""
    import ast as _ast

    for node in _ast.walk(tree):
        if isinstance(node, _ast.Call):
            f = node.func
            if isinstance(f, _ast.Name) and f.id.endswith("Lock"):
                return True
            if isinstance(f, _ast.Attribute) and f.attr.endswith("Lock"):
                return True
    return False


def _callback_filter_handler_present(tree, handler: str, filter_data: str) -> bool:
    """Typed native construct (IV6-F03 §21): an aiogram callback handler is
    registered as `@<router>.callback_query(F.data == "<filter_data>", ...)`
    above `async def <handler>`. Derives whether THAT exact registration
    construct exists — never a generic call of callback DATA text."""
    import ast as _ast

    for node in _ast.walk(tree):
        if not isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
            continue
        if node.name != handler:
            continue
        for dec in node.decorator_list:
            if not (isinstance(dec, _ast.Call) and isinstance(dec.func, _ast.Attribute)
                    and dec.func.attr == "callback_query"):
                continue
            for arg in dec.args:
                # The filter must be the native F.data expression on THIS
                # handler. An unrelated `.data` attribute is not that binding.
                if (isinstance(arg, _ast.Compare) and isinstance(arg.left, _ast.Attribute)
                        and isinstance(arg.left.value, _ast.Name)
                        and arg.left.value.id == "F"
                        and arg.left.attr == "data" and len(arg.ops) == 1
                        and isinstance(arg.ops[0], _ast.Eq) and len(arg.comparators) == 1):
                    comp = arg.comparators[0]
                    if isinstance(comp, _ast.Constant) and comp.value == filter_data:
                        return True
    return False


def _call_name(node) -> str | None:
    import ast as _ast
    f = getattr(node, "func", None)
    if isinstance(f, _ast.Name):
        return f.id
    if isinstance(f, _ast.Attribute):
        return f.attr
    return None


def _executed_call_names(tree) -> list[str]:
    """Call names on the module execution path.

    Module-level statements and the body of a `__name__ == "__main__"` guard
    are the entry. A direct call of a function defined in this module inlines
    that function. Bodies of functions that are never called on this path are
    not execution.
    """
    import ast as _ast

    functions: dict[str, _ast.AST] = {}
    for node in tree.body:
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
            functions[node.name] = node
    inlined: set[str] = set()
    names: list[str] = []

    def walk_exec(stmts) -> None:
        for stmt in stmts:
            if isinstance(stmt, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                continue
            walk_node(stmt)

    def walk_node(node) -> None:
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            return
        if isinstance(node, _ast.Call):
            for arg in list(node.args) + [kw.value for kw in node.keywords]:
                walk_node(arg)
            name = _call_name(node)
            if isinstance(node.func, _ast.Name) and name in functions and name not in inlined:
                inlined.add(name)
                walk_exec(functions[name].body)
            if name:
                names.append(name)
            return
        for child in _ast.iter_child_nodes(node):
            walk_node(child)

    walk_exec(tree.body)
    return names


def _call_order_before(tree, before: str, after: str) -> bool | None:
    """Does `before` execute before `after` on the module execution path?

    Line order inside an uninvoked function is not execution order. None when
    either call is absent from the executed path — ordering of a missing call
    is NOT_OBSERVABLE.
    """
    names = _executed_call_names(tree)
    if before not in names or after not in names:
        return None
    return names.index(before) < names.index(after)


def _handler_decorator_types(trees: list) -> set[str]:
    """Derives the ACTUAL router-decorator inventory: the set of decorator
    method names (`message`, `callback_query`, `my_chat_member`, …) applied
    to handler definitions across the given parsed files. This is the native
    surface `dp.resolve_used_update_types()` derives from."""
    import ast as _ast

    types: set[str] = set()
    for tree in trees:
        for node in _ast.walk(tree):
            if not isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list:
                d = dec.func if isinstance(dec, _ast.Call) else dec
                if isinstance(d, _ast.Attribute) and d.attr in (
                        "message", "callback_query", "my_chat_member",
                        "channel_post", "edited_message", "inline_query",
                        "edited_callback_query", "chat_member", "poll", "error"):
                    types.add(d.attr)
    return types


def _annotated_column_type_present(tree, cls: str, column: str, type_name: str) -> bool | None:
    """Typed CLASS-SCOPED column query (IV6-F03 §20 context): within class
    `cls`, an annotated assignment `column: ... = <call>(<type_name>, ...)`
    exists. None when the class is absent (wrong scope is NOT_OBSERVABLE)."""
    import ast as _ast

    for node in _ast.walk(tree):
        if isinstance(node, _ast.ClassDef) and node.name == cls:
            for sub in node.body:
                if (isinstance(sub, _ast.AnnAssign) and isinstance(sub.target, _ast.Name)
                        and sub.target.id == column and sub.value is not None
                        and isinstance(sub.value, _ast.Call) and sub.value.args):
                    first = sub.value.args[0]
                    if isinstance(first, _ast.Name) and first.id == type_name:
                        return True
            return False
    return None


def _annotated_column_indexed(tree, cls: str, column: str) -> bool | None:
    """Within class `cls`, `column = mapped_column(..., index=True)`."""
    import ast as _ast

    for node in _ast.walk(tree):
        if isinstance(node, _ast.ClassDef) and node.name == cls:
            for sub in node.body:
                if (isinstance(sub, _ast.AnnAssign) and isinstance(sub.target, _ast.Name)
                        and sub.target.id == column and isinstance(sub.value, _ast.Call)):
                    for kw in sub.value.keywords:
                        if kw.arg == "index" and isinstance(kw.value, _ast.Constant):
                            return kw.value.value is True
            return False
    return None


def _function_has_numeric_bounds(tree, function_name: str) -> bool | None:
    """A named function contains numeric bound literals (range / clamp)."""
    import ast as _ast

    target = None
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and node.name == function_name:
            target = node
            break
    if target is None:
        return None
    for node in _ast.walk(target):
        if not isinstance(node, _ast.Call):
            continue
        name = _call_name(node)
        nums = [a for a in node.args if isinstance(a, _ast.Constant) and isinstance(a.value, (int, float))
                 and not isinstance(a.value, bool)]
        if name in ("uniform", "randint") and len(nums) >= 2:
            return True
        if name in ("min", "max") and nums:
            return True
    return False


def _sql_column_type(tree, table: str, column: str) -> str | None:
    """Declared SQL type of `column` inside a CREATE TABLE string for `table`."""
    import ast as _ast
    import re as _re

    for node in _ast.walk(tree):
        if not isinstance(node, _ast.Constant) or not isinstance(node.value, str):
            continue
        text = node.value
        if not _re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{table}\b", text, _re.I):
            continue
        match = _re.search(rf"\b{column}\s+([A-Z]+)\b", text, _re.I)
        if match:
            return match.group(1).upper()
    return None


def _json_dumps_persists_mapping(tree, function_name: str) -> bool | None:
    """`function_name` persists mappings through json.dumps without a default encoder."""
    import ast as _ast

    target = None
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and node.name == function_name:
            target = node
            break
    if target is None:
        return None
    found = False
    for node in _ast.walk(target):
        if not isinstance(node, _ast.Call):
            continue
        func = node.func
        if not (isinstance(func, _ast.Attribute) and func.attr == "dumps"):
            continue
        if any(kw.arg == "default" for kw in node.keywords):
            return False
        found = True
    return found


def _call_keyword_literal_on_path(tree, call: str, keyword: str):
    """Literal value of `keyword` on an executed call of `call`, or None."""
    import ast as _ast

    functions = {
        node.name: node for node in tree.body
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef))
    }
    inlined: set[str] = set()
    found = []

    def walk_exec(stmts) -> None:
        for stmt in stmts:
            if isinstance(stmt, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                continue
            walk_node(stmt)

    def walk_node(node) -> None:
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            return
        if isinstance(node, _ast.Call):
            for arg in list(node.args) + [kw.value for kw in node.keywords]:
                walk_node(arg)
            name = _call_name(node)
            if isinstance(node.func, _ast.Name) and name in functions and name not in inlined:
                inlined.add(name)
                walk_exec(functions[name].body)
            if name == call:
                for kw in node.keywords:
                    if kw.arg == keyword and isinstance(kw.value, _ast.Constant):
                        found.append(kw.value.value)
            return
        for child in _ast.iter_child_nodes(node):
            walk_node(child)

    walk_exec(tree.body)
    if not found:
        return None
    return found[0]


def _default_string_literals(tree, symbol: str) -> list[str]:
    """String default literals bound to `symbol` (argument, assignment, Field)."""
    import ast as _ast

    found: list[str] = []

    def take_call_default(call: _ast.Call) -> None:
        for kw in call.keywords:
            if kw.arg == "default" and isinstance(kw.value, _ast.Constant) \
                    and isinstance(kw.value.value, str):
                found.append(kw.value.value)
        if len(call.args) >= 2 and isinstance(call.args[1], _ast.Constant) \
                and isinstance(call.args[1].value, str):
            # os.getenv(name, fallback)
            found.append(call.args[1].value)

    for node in _ast.walk(tree):
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
            args = node.args.args
            defaults = node.args.defaults
            if defaults:
                paired = args[-len(defaults):]
                for arg, default in zip(paired, defaults):
                    if arg.arg != symbol:
                        continue
                    if isinstance(default, _ast.Constant) and isinstance(default.value, str):
                        found.append(default.value)
                    elif isinstance(default, _ast.Call):
                        take_call_default(default)
        if isinstance(node, _ast.AnnAssign) and isinstance(node.target, _ast.Name) \
                and node.target.id == symbol and isinstance(node.value, _ast.Call):
            take_call_default(node.value)
        if isinstance(node, _ast.Assign):
            for target in node.targets:
                if isinstance(target, _ast.Name) and target.id == symbol \
                        and isinstance(node.value, _ast.Call):
                    take_call_default(node.value)
    return found


def _resolved_polling_updates(root: Path, entry: str) -> list[str] | None:
    """Update types resolved for start_polling on the executed entry path.

    The entry must call start_polling with allowed_updates bound to
    resolve_used_update_types, and must include routers. The resolved set is
    the decorator update types on those included routers. None when that
    source path cannot be derived.
    """
    import ast as _ast

    entry_path = root / entry
    if not entry_path.is_file():
        return None
    try:
        tree = _ast.parse(entry_path.read_text(encoding="utf-8"))
    except SyntaxError:
        return None
    names = _executed_call_names(tree)
    if "start_polling" not in names or "include_router" not in names:
        return None
    polling_ok = False
    included: list[str] = []

    functions = {
        node.name: node for node in tree.body
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef))
    }
    inlined: set[str] = set()

    def walk_exec(stmts) -> None:
        for stmt in stmts:
            if isinstance(stmt, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                continue
            walk_node(stmt)

    def walk_node(node) -> None:
        nonlocal polling_ok
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            return
        if isinstance(node, _ast.Call):
            for arg in list(node.args) + [kw.value for kw in node.keywords]:
                walk_node(arg)
            name = _call_name(node)
            if isinstance(node.func, _ast.Name) and name in functions and name not in inlined:
                inlined.add(name)
                walk_exec(functions[name].body)
            if name == "include_router" and node.args and isinstance(node.args[0], _ast.Name):
                included.append(node.args[0].id)
            if name == "start_polling":
                for kw in node.keywords:
                    if kw.arg == "allowed_updates" and isinstance(kw.value, _ast.Call) \
                            and _call_name(kw.value) == "resolve_used_update_types":
                        polling_ok = True
            return
        for child in _ast.iter_child_nodes(node):
            walk_node(child)

    walk_exec(tree.body)
    if not polling_ok or not included:
        return None
    router_files = _router_name_files(root, tree)
    trees = []
    for router_name in included:
        rel = router_files.get(router_name)
        if not rel:
            return None
        path = root / rel
        if not path.is_file():
            return None
        try:
            trees.append(_ast.parse(path.read_text(encoding="utf-8")))
        except SyntaxError:
            return None
    return sorted(_handler_decorator_types(trees))


def _allowed_updates_cross_run(root: Path, entry: str) -> dict | None:
    """Per-process allowed_updates resolution, with no stored copy.

    The executed entry must call start_polling(allowed_updates=
    resolve_used_update_types()) exactly once, must construct the dispatcher
    with MemoryStorage, and must not assign that argument. None means the
    source does not answer the cross-run question.
    """
    import ast as _ast

    if not _resolved_polling_updates(root, entry):
        return None
    entry_path = root / entry
    try:
        tree = _ast.parse(entry_path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return None
    polling_values = []
    memory_storage = False
    functions = {
        node.name: node for node in tree.body
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef))
    }
    inlined: set[str] = set()

    def walk_exec(stmts) -> None:
        for stmt in stmts:
            if isinstance(stmt, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
                continue
            walk_node(stmt)

    def walk_node(node) -> None:
        nonlocal memory_storage
        if isinstance(node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            return
        if isinstance(node, _ast.Call):
            for arg in list(node.args) + [kw.value for kw in node.keywords]:
                walk_node(arg)
            name = _call_name(node)
            if isinstance(node.func, _ast.Name) and name in functions and name not in inlined:
                inlined.add(name)
                walk_exec(functions[name].body)
            if name == "start_polling":
                for kw in node.keywords:
                    if kw.arg == "allowed_updates":
                        polling_values.append(kw.value)
            if name == "Dispatcher":
                for kw in node.keywords:
                    if kw.arg == "storage" and isinstance(kw.value, _ast.Call) \
                            and _call_name(kw.value) == "MemoryStorage":
                        memory_storage = True
            return
        for child in _ast.iter_child_nodes(node):
            walk_node(child)

    walk_exec(tree.body)
    if len(polling_values) != 1 or not memory_storage:
        return None
    value = polling_values[0]
    if not isinstance(value, _ast.Call) or _call_name(value) != "resolve_used_update_types":
        return None
    assigned = False
    bindings = 0
    for node in _ast.walk(tree):
        if isinstance(node, _ast.Assign):
            for target in node.targets:
                if isinstance(target, _ast.Name) and target.id == "allowed_updates":
                    assigned = True
        if isinstance(node, _ast.AnnAssign) and isinstance(node.target, _ast.Name) \
                and node.target.id == "allowed_updates":
            assigned = True
        if isinstance(node, _ast.keyword) and node.arg == "allowed_updates":
            bindings += 1
    if assigned or bindings != 1:
        return None
    return {
        "resolution": "per_process",
        "allowed_updates_argument": "resolve_used_update_types",
        "dispatcher_storage": "MemoryStorage",
        "cross_run_persistence": False,
    }


_TS_FIELD_RE = re.compile(
    r"(?m)^[ \t]*(?:readonly[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)\??[ \t]*:[ \t]*([^;\n]+)")
_TS_ALIAS_RE = re.compile(
    r"(?m)^export[ \t]+type[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([^;]+);")
_TS_NUMBER_RE = re.compile(r"\bnumber\b")
_TS_TG_ID_RE = re.compile(
    r"(?i)(?:telegram|tg)_?(?:user|chat)?_?id$|^chatId$|^telegramId$"
    r"|^telegramUserId$|^telegramChatId$|^tgId$")


def _numeric_telegram_id_fields(text: str) -> int | None:
    """Count numeric Telegram/chat id fields on the Navigator chat contract.

    A field counts only when its name is a Telegram or chat id and its
    declared type is number, or a type alias whose body is number. None when
    the file is not the chat contract.
    """
    if "export type ConversationProfile" not in text \
            or "export type ChatSuccessResponse" not in text:
        return None
    numeric_aliases: set[str] = set()
    for match in _TS_ALIAS_RE.finditer(text):
        name, body = match.group(1), match.group(2)
        if _TS_NUMBER_RE.search(body) and _TS_TG_ID_RE.search(name):
            numeric_aliases.add(name)
    count = len(numeric_aliases)
    for match in _TS_FIELD_RE.finditer(text):
        name, type_expr = match.group(1), match.group(2).strip()
        if not _TS_TG_ID_RE.search(name):
            continue
        head = type_expr.split("|", 1)[0].strip().rstrip("[]")
        if _TS_NUMBER_RE.search(type_expr) or head in numeric_aliases:
            count += 1
    return count


def _router_name_files(root: Path, entry_tree) -> dict[str, str]:
    """Map included router names to source files via import statements."""
    import ast as _ast

    name_to_module: dict[str, str] = {}
    for node in entry_tree.body:
        if isinstance(node, _ast.ImportFrom) and node.module:
            for alias in node.names:
                name_to_module[alias.asname or alias.name] = node.module
    resolved: dict[str, str] = {}
    for name, module in name_to_module.items():
        init = root.joinpath(*module.split("."), "__init__.py")
        direct = root.joinpath(*module.split(".")).with_suffix(".py")
        if direct.is_file():
            resolved[name] = str(direct.relative_to(root))
            continue
        if not init.is_file():
            continue
        try:
            init_tree = _ast.parse(init.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for sub in init_tree.body:
            if not isinstance(sub, _ast.ImportFrom):
                continue
            for alias in sub.names:
                exported = alias.asname or alias.name
                if exported != name:
                    continue
                # Relative imports store the module without dots and a level.
                # `from .client import client_router` is module="client", level=1.
                if sub.level:
                    base = module.split(".")
                    climb = sub.level - 1
                    if climb:
                        base = base[:-climb] if climb <= len(base) else []
                    rel_mod = (sub.module or "").replace(".", "/")
                    parts = base + ([rel_mod] if rel_mod else [])
                    rel = "/".join(p for p in parts if p) + ".py"
                elif sub.module:
                    rel = sub.module.replace(".", "/") + ".py"
                else:
                    continue
                resolved[name] = rel
    return resolved


def _symbol_defined_anywhere(trees: list, symbol: str) -> bool:
    for tree in trees:
        if symbol in _collect_defined_symbols(tree) or symbol in _qualified_references(tree):
            return True
    return False


_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")


class StaticSourceInventoryAdapter(_AdapterBase):
    """Registered TYPED static queries executed against bound TEST_BASE
    sources (IV4 B-12: the ACTUAL requested fact is derived — no generic
    text-presence substitute for typed source meaning):

    SYMBOL_EXISTS / SYMBOL_ABSENT — declaration / qualified symbol definition
    (AST declarations, assignments, imports, and qualified attribute
    references in code; comments/strings are never evidence);
    CALL_SITE_EXISTS — a syntactic CALL EXPRESSION of the requested callee
    (the subject MUST be a code identifier: callback DATA text is not a
    callee — use CALLBACK_FILTER_HANDLER for callback registrations);
    CONFIG_VALUE_EQUALS — TYPED comparison of parsed configured values
    (IV6-F08: literal typed equality or registered bare-symbol identity;
    unsupported requested expressions are NOT_OBSERVABLE);
    HANDLER_REGISTERED — an actual registration construct naming the symbol;
    IMPORT_EXISTS — an actual import statement of the requested module;
    LOCK_PRIMITIVE_PRESENT — an actual Lock-constructor call expression;
    CALLBACK_FILTER_HANDLER (IV6-F03 §21) — the native
    `@router.callback_query(F.data == "<data>", ...` registration construct
    for a named handler (comparison/split semantics, not a generic call);
    CALL_ORDER_BEFORE — `before` executes before `after` on the module
    execution path (invoked functions only; uninvoked bodies do not count);
    HANDLER_DECORATOR_TYPES (IV6-F03) — router-decorator inventory across files;
    RESOLVED_POLLING_UPDATES — update types on the routers actually included
    by the executed entry, when start_polling binds allowed_updates to
    resolve_used_update_types;
    ANNOTATED_COLUMN_TYPE (IV6-F03 §20) — CLASS-SCOPED annotated ORM column
    binding to a named type;
    ANNOTATED_COLUMN_INDEX — the same column is declared with index=True;
    NUMERIC_RANGE_LITERALS — a named function contains numeric bound literals;
    SQL_COLUMN_TYPE — declared SQL type inside a CREATE TABLE string;
    JSON_DUMPS_PERSISTS — a function persists mappings via json.dumps with no
    default encoder;
    CALL_KEYWORD_LITERAL — an executed call binds a keyword to a literal;
    CONFIG_DEFAULTS_DIFFER — string defaults of one symbol differ across two files;
    ALLOWED_UPDATES_CROSS_RUN — start_polling binds allowed_updates to
    resolve_used_update_types() on the executed entry, dispatcher storage is
    MemoryStorage, and that argument is not assigned or stored;
    NAVIGATOR_CHAT_CONTRACT_NUMERIC_ID_COUNT — numeric Telegram/chat id
    fields declared by the Navigator chat contract. The file is read from
    navigator_test_root when the query sets source_tree to navigator.

    Every query records QUERY TYPE / SOURCE FILE / SOURCE SHA / REQUESTED
    SUBJECT / DERIVED VALUE / DERIVATION METHOD. No query result depends on
    any earlier query's local state."""

    adapter_id = "static_source_inventory"

    QUERY_TYPES = {"SYMBOL_EXISTS", "SYMBOL_ABSENT", "CALL_SITE_EXISTS",
                   "CONFIG_VALUE_EQUALS", "HANDLER_REGISTERED", "IMPORT_EXISTS",
                   "LOCK_PRIMITIVE_PRESENT", "CALLBACK_FILTER_HANDLER",
                   "CALL_ORDER_BEFORE", "HANDLER_DECORATOR_TYPES",
                   "ANNOTATED_COLUMN_TYPE", "RESOLVED_POLLING_UPDATES",
                   "ANNOTATED_COLUMN_INDEX", "NUMERIC_RANGE_LITERALS",
                   "SQL_COLUMN_TYPE", "JSON_DUMPS_PERSISTS",
                   "CALL_KEYWORD_LITERAL", "CONFIG_DEFAULTS_DIFFER",
                   "ALLOWED_UPDATES_CROSS_RUN",
                   "NAVIGATOR_CHAT_CONTRACT_NUMERIC_ID_COUNT"}

    def execute(self, request) -> RawCapture:
        root = request.tikhon_test_root or request.navigator_test_root
        if not root:
            return self._fail("static inventory requires a bound TEST_BASE root")
        queries = to_native((request.preconditions or {}).get("static_queries") or [])
        facts: dict[str, Any] = {}
        basis: list[dict] = []
        import ast as _ast
        import hashlib as _hashlib

        parsed_cache: dict[str, Any] = {}

        def _parse_source(rel: str):
            if rel in parsed_cache:
                return parsed_cache[rel]
            p = Path(root) / rel
            if not p.exists() or not p.is_file() or not rel.endswith(".py"):
                parsed_cache[rel] = None
                return None
            try:
                parsed_cache[rel] = _ast.parse(p.read_text(encoding="utf-8",
                                                           errors="replace"))
            except SyntaxError:
                parsed_cache[rel] = None
            return parsed_cache[rel]

        for q in queries:
            qtype = q.get("query_type")
            if qtype not in self.QUERY_TYPES:
                return self._fail(f"unregistered static query type {qtype!r}")
            if qtype == "HANDLER_DECORATOR_TYPES":
                files = q.get("files") or [q.get("file")]
                trees = []
                src_files = []
                for rel in files:
                    if not rel:
                        continue
                    t = _parse_source(rel)
                    if t is None:
                        return self._fail(f"static query source {rel!r} is not parseable")
                    trees.append(t)
                    src_files.append(rel)
                derived = sorted(_handler_decorator_types(trees))
                facts[q["fact"]] = derived
                basis.append({
                    "query_type": qtype, "source_file": ";".join(src_files),
                    "requested_subject": "router decorator inventory",
                    "derived_value": derived,
                    "derivation_method": ("actual router-decorator method inventory "
                                          "across the parsed handler files"),
                    "source_sha256": None,
                })
                continue
            if qtype == "RESOLVED_POLLING_UPDATES":
                rel = q.get("file") or "main.py"
                derived = _resolved_polling_updates(Path(root), rel)
                facts[q["fact"]] = derived
                basis.append({
                    "query_type": qtype, "source_file": rel,
                    "requested_subject": "resolved allowed_updates",
                    "derived_value": derived,
                    "derivation_method": ("executed entry include_router set plus "
                                          "start_polling(allowed_updates="
                                          "resolve_used_update_types()); decorator "
                                          "types of those routers. None is "
                                          "NOT_OBSERVABLE"),
                    "source_sha256": None,
                })
                continue
            if qtype == "CONFIG_DEFAULTS_DIFFER":
                file_a = q.get("file")
                file_b = q.get("file_b")
                symbol = q.get("symbol")
                tree_a = _parse_source(file_a) if file_a else None
                tree_b = _parse_source(file_b) if file_b else None
                if tree_a is None or tree_b is None:
                    derived = None
                else:
                    left = set(_default_string_literals(tree_a, symbol))
                    right = set(_default_string_literals(tree_b, symbol))
                    derived = bool(left and right and left.isdisjoint(right))
                facts[q["fact"]] = derived
                basis.append({
                    "query_type": qtype,
                    "source_file": f"{file_a};{file_b}",
                    "requested_subject": symbol,
                    "derived_value": derived,
                    "derivation_method": ("string default literals of the named "
                                          "symbol compared across the two files"),
                    "source_sha256": None,
                })
                continue
            if qtype == "ALLOWED_UPDATES_CROSS_RUN":
                rel = q.get("file") or "main.py"
                derived = _allowed_updates_cross_run(Path(root), rel)
                facts[q["fact"]] = derived
                basis.append({
                    "query_type": qtype, "source_file": rel,
                    "requested_subject": "allowed_updates cross-run persistence",
                    "derived_value": derived,
                    "derivation_method": ("executed start_polling allowed_updates "
                                          "argument is resolve_used_update_types(); "
                                          "Dispatcher storage is MemoryStorage; the "
                                          "argument is not assigned. None is "
                                          "NOT_OBSERVABLE"),
                    "source_sha256": None,
                })
                continue
            if qtype == "NAVIGATOR_CHAT_CONTRACT_NUMERIC_ID_COUNT":
                rel = q.get("file") or "src/lib/chat-contract.ts"
                nav_root = request.navigator_test_root
                path = Path(nav_root) / rel if nav_root else None
                if path is None or not path.is_file():
                    derived = None
                    source_sha = None
                    method = "navigator chat contract file is not bound: NOT_OBSERVABLE"
                else:
                    raw_bytes = path.read_bytes()
                    source_sha = _hashlib.sha256(raw_bytes).hexdigest()
                    derived = _numeric_telegram_id_fields(
                        raw_bytes.decode("utf-8", errors="replace"))
                    method = ("chat-contract property signatures and numeric type "
                              "aliases whose names are Telegram or chat ids and "
                              "whose declared type is number; None is NOT_OBSERVABLE")
                facts[q["fact"]] = derived
                basis.append({
                    "query_type": qtype, "source_file": rel,
                    "requested_subject": "navigator numeric telegram id fields",
                    "derived_value": derived,
                    "derivation_method": method,
                    "source_sha256": source_sha,
                })
                continue
            rel = q.get("file")
            subject = q.get("symbol") or q.get("call") or q.get("module") \
                or q.get("needle") or q.get("config_expression")
            record = {"query_type": qtype, "source_file": rel,
                      "requested_subject": subject}
            p = Path(root) / rel
            if not p.exists() or not p.is_file():
                facts[q["fact"]] = False if qtype in (
                    "SYMBOL_EXISTS", "CALL_SITE_EXISTS", "HANDLER_REGISTERED",
                    "IMPORT_EXISTS", "LOCK_PRIMITIVE_PRESENT") else None
                record.update({"derived_value": facts[q["fact"]],
                               "derivation_method": "FILE_ABSENT", "source_sha256": None})
                basis.append(record)
                continue
            raw_bytes = p.read_bytes()
            source_sha = _hashlib.sha256(raw_bytes).hexdigest()
            text = raw_bytes.decode("utf-8", errors="replace")
            derived: bool | None
            method: str
            if not rel.endswith(".py"):
                return self._fail(
                    f"static query on non-source file {rel!r}: typed derivation "
                    "requires a parseable Python source file")
            tree = _parse_source(rel)
            if tree is None:
                return self._fail(f"static query source {rel!r} is not parseable")
            # IV6-F03 §21: subjects of identifier-typed queries must BE code
            # identifiers — callback DATA text (e.g. "confirm:ind_terms") is
            # not a function callee; the native construct is a filter
            # comparison handled by CALLBACK_FILTER_HANDLER.
            if qtype in ("SYMBOL_EXISTS", "SYMBOL_ABSENT", "CALL_SITE_EXISTS",
                         "HANDLER_REGISTERED") and subject \
                    and not _IDENTIFIER_RE.fullmatch(str(subject)):
                return self._fail(
                    f"{qtype} subject {subject!r} is not a code identifier — callback "
                    "data / prose cannot be a callee or symbol; use the typed query "
                    "matching the native construct (e.g. CALLBACK_FILTER_HANDLER)")
            if qtype == "CALLBACK_FILTER_HANDLER":
                derived = _callback_filter_handler_present(
                    tree, q.get("handler", ""), q.get("filter_data", ""))
                method = (f"native registration construct: @<router>.callback_query("
                          f"F.data == {q.get('filter_data')!r}, …) decorating "
                          f"def {q.get('handler')!r}")
            elif qtype == "CALL_ORDER_BEFORE":
                derived = _call_order_before(tree, q.get("before", ""),
                                             q.get("after", ""))
                method = (f"executed-path order: {q.get('before')!r} runs before "
                          f"{q.get('after')!r}; uninvoked function bodies are excluded")
            elif qtype == "ANNOTATED_COLUMN_TYPE":
                derived = _annotated_column_type_present(
                    tree, q.get("class", ""), q.get("column", ""),
                    q.get("column_type", ""))
                method = (f"class-scoped annotated assignment {q.get('class')!r}."
                          f"{q.get('column')!r} = <call>({q.get('column_type')!r}, …)")
            elif qtype == "ANNOTATED_COLUMN_INDEX":
                derived = _annotated_column_indexed(
                    tree, q.get("class", ""), q.get("column", ""))
                method = (f"class-scoped mapped_column index=True on "
                          f"{q.get('class')!r}.{q.get('column')!r}")
            elif qtype == "NUMERIC_RANGE_LITERALS":
                derived = _function_has_numeric_bounds(tree, q.get("symbol", ""))
                method = (f"numeric bound literals inside function {q.get('symbol')!r}")
            elif qtype == "SQL_COLUMN_TYPE":
                derived = _sql_column_type(tree, q.get("table", ""), q.get("column", ""))
                method = (f"CREATE TABLE {q.get('table')} column {q.get('column')} "
                          "declared SQL type")
            elif qtype == "JSON_DUMPS_PERSISTS":
                derived = _json_dumps_persists_mapping(tree, q.get("symbol", ""))
                method = (f"json.dumps in {q.get('symbol')!r} without a default encoder")
            elif qtype == "CALL_KEYWORD_LITERAL":
                derived = _call_keyword_literal_on_path(
                    tree, q.get("call", ""), q.get("keyword", ""))
                method = (f"executed call {q.get('call')!r} keyword {q.get('keyword')!r} "
                          "literal value; None is NOT_OBSERVABLE")
            elif qtype in ("SYMBOL_EXISTS", "SYMBOL_ABSENT"):
                declared = subject in _collect_defined_symbols(tree)
                qualified = subject in _qualified_references(tree)
                exists = declared or qualified
                derived = exists if qtype == "SYMBOL_EXISTS" else (not exists)
                method = (f"AST declarations/assignments/imports + qualified attribute "
                          f"references in code; {qtype}({subject!r})")
            elif qtype == "CALL_SITE_EXISTS":
                derived = subject in _call_targets(tree)
                method = f"AST syntactic call expressions; callee {subject!r}"
            elif qtype == "CONFIG_VALUE_EQUALS":
                # IV6-F08: TYPED comparison of parsed configured values —
                # literal-vs-literal typed equality or registered bare-symbol
                # identity; unsupported requested expressions are NOT_OBSERVABLE
                needle_expr = q.get("config_expression") or q.get("needle", "")
                req_name, req_node = _parse_requested_config(needle_expr)
                if req_node is _NOT_PARSED:
                    derived = None  # NOT_OBSERVABLE for this query type
                    method = (f"requested configuration expression {needle_expr!r} is not "
                              "parseable: NOT_OBSERVABLE (no generic source-text "
                              "normalization is performed)")
                elif _literal_of(req_node) is _NOT_PARSED and not _is_bare_identifier(req_node):
                    derived = None  # unsupported expression form: NOT_OBSERVABLE
                    method = (f"requested configuration expression {needle_expr!r} uses a "
                              "value form outside the registered query contract "
                              "(supported: literals with typed equality; bare "
                              "identifier configured-symbol identity): NOT_OBSERVABLE — "
                              "no structural equivalence is guessed")
                else:
                    bindings = _configured_literal_bindings(tree)
                    candidates = [v for n, v in bindings
                                  if req_name is None or n == req_name]
                    derived = any(_semantic_config_equal(req_node, v) for v in candidates)
                    method = (f"parsed configured-value bindings (call keywords / "
                              f"assignments) compared by TYPED literal equality / "
                              f"registered configured-symbol identity to {needle_expr!r} "
                              "(True != 1, 1 != '1', 'a b' != 'ab')")
            elif qtype == "HANDLER_REGISTERED":
                derived = _registration_constructs(tree, subject)
                method = f"actual registration construct naming {subject!r}"
            elif qtype == "IMPORT_EXISTS":
                module = str(subject)
                found = False
                for node in _ast.walk(tree):
                    if isinstance(node, _ast.Import):
                        for alias in node.names:
                            if alias.name == module or alias.name.startswith(module + "."):
                                found = True
                    if isinstance(node, _ast.ImportFrom):
                        if node.module == module or (node.module or "").startswith(module + "."):
                            found = True
                        for alias in node.names:
                            if f"{node.module}.{alias.name}" == module:
                                found = True
                derived = found
                method = f"actual import statements of module {module!r}"
            elif qtype == "LOCK_PRIMITIVE_PRESENT":
                derived = _lock_primitive_calls(tree)
                method = "actual Lock-constructor call expressions in code"
            else:  # pragma: no cover — QUERY_TYPES gate above
                return self._fail(f"unhandled query type {qtype!r}")
            facts[q["fact"]] = derived
            record.update({"derived_value": derived, "derivation_method": method,
                           "source_sha256": source_sha})
            basis.append(record)
        return RawCapture(
            values={"act": "STATIC_INSPECTION", "origin": "STATIC_SOURCE_INVENTORY",
                    "state": {}, "link": None, "output": "typed static queries executed",
                    "tool_api": [], "mutations": []},
            static_inspection={"facts": facts,
                               "executed_queries": [b["requested_subject"] for b in basis],
                               "source_basis": basis},
            sut_path=str(root), sut_symbol="registered typed static queries",
            outcome_class="CLEAN",
        )


import urllib.parse  # noqa: E402  (used by NavigatorL2ChatAdapter)
