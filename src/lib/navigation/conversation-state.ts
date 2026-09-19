/**
 * Package-A structured conversation state (A09) and session lifecycle (A28).
 *
 * The state is the single authoritative record of conversational control. It is
 * strictly validated at the API boundary, exactly like ConversationProfile, and
 * it is never reconstructed by re-reading earlier assistant prose.
 *
 * The session TTL constant and the clock both live here: the TTL is used in one
 * place only, and every transition takes the current time as an explicit
 * parameter so that staleness is deterministic and testable.
 */

import {
  MAX_CHAT_MESSAGE_LENGTH,
  type AddressMode,
  type ConversationProfile,
} from "../chat-contract.ts";
import { isRecommendableCourseId } from "../academy/course-catalog.ts";

/** Owner-ratified stale navigation-context boundary: 24 hours of inactivity. */
export const SESSION_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * One centrally configured clarification budget (A14). Scoped to an unresolved
 * issue by ClarificationState.issueKey, never a global lifetime total.
 */
export const CLARIFICATION_BUDGET = 3;

export const MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH = 120;
export const MAX_PENDING_CONFIRMATION_PROMPT_LENGTH = 600;

/**
 * Joins a preserved remainder to the text it is combined with. Exactly one
 * character, so the effective-request bound below stays exact.
 */
export const DEFERRED_REQUEST_SEPARATOR = "\n";

/**
 * The largest request the Package-A kernel may hand to normal routing.
 *
 * The only synthetic request the kernel can form is a preserved remainder
 * promoted in front of the turn's own request (A19). Both pieces are
 * individually bounded by the public MAX_CHAT_MESSAGE_LENGTH — a stored
 * remainder is validated against it on every API round trip, and an incoming
 * message is rejected against it at the API boundary — so two maximum-length
 * pieces plus the separator is the highest legal combination, and no third
 * component is ever joined to it. A combination past this bound is reported
 * rather than truncated.
 *
 * This is an internal router contract, not a public message limit: a piece that
 * is not combined with a remainder is still governed by MAX_CHAT_MESSAGE_LENGTH
 * where it enters.
 */
export const MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH =
  2 * MAX_CHAT_MESSAGE_LENGTH + DEFERRED_REQUEST_SEPARATOR.length;

export type SessionClock = {
  now(): number;
};

export const systemSessionClock: SessionClock = {
  now: () => Date.now(),
};

export type ConversationLifecycle = "OPEN" | "CLOSED";

export type ConversationFlowId =
  | "ADDRESS_SETUP"
  | "COURSE_SELECTION"
  | "COURSE_FOLLOW_UP"
  | "ACADEMY_CONTACT";

export type CourseMatchState =
  | "UNKNOWN"
  | "MATCHED"
  | "NO_CURRENT_COURSE_MATCH"
  | "AMBIGUOUS";

export type ConversationFlow = {
  id: ConversationFlowId;
  /** Bounded text of the question the flow awaits, so resume needs no prose scan. */
  pendingQuestion: string | null;
};

export type ClarificationState = {
  issueKey: string;
  attempts: number;
  /** Identity of the strategy already used, so the next attempt differs. */
  strategyKey: string | null;
};

export type PendingConfirmationKind = "STALE_COURSE_REFERENCE";

export type PendingConfirmation = {
  confirmationKey: string;
  kind: PendingConfirmationKind;
  prompt: string;
  candidateCourseId: string | null;
};

export type StaleReference = {
  previousCourseId: string | null;
  previousFlowId: ConversationFlowId | null;
};

export type LastAssistantAct =
  | "ADDRESS_SETUP"
  | "PROFILE_CONTROL"
  | "RESTART"
  | "CONVERSATION_CLOSE"
  | "CANCEL_FLOW"
  | "REPEAT"
  | "REPHRASE"
  | "SIMPLIFY"
  | "RESUME_FLOW"
  | "SKIP"
  | "DEFERRED_NOT_ACCEPTED"
  | "STALE_REFERENCE_CONFIRMATION"
  | "CLARIFICATION"
  | "CLARIFICATION_EXHAUSTED"
  | "NAVIGATE"
  | "COURSE_FOLLOW_UP"
  | "ACADEMY_CONTACT"
  | "META"
  | "OUT_OF_SCOPE";

export type LastAssistantAction = {
  act: LastAssistantAct;
  content: string;
  courseId: string | null;
};

export type ConversationState = {
  lifecycle: ConversationLifecycle;
  activeFlow: ConversationFlow | null;
  suspendedFlow: ConversationFlow | null;
  courseMatch: CourseMatchState;
  selectedCourseId: string | null;
  clarification: ClarificationState | null;
  pendingConfirmation: PendingConfirmation | null;
  /**
   * Substantive user text captured on a control turn, queued for normal
   * routing (A19). Not business authority: it is only preserved user input.
   * Lifecycle: captured here, promoted into the effective user request of the
   * next turn that reaches normal routing, then cleared by that turn. Cleared
   * without execution only by cancel / restart / close / TTL expiry. A capture
   * that does not fit alongside a stored value is rejected rather than allowed
   * to replace it.
   */
  deferredRequest: string | null;
  lastAssistant: LastAssistantAction | null;
  lastActivityAt: string;
  staleReference: StaleReference | null;
};

export class ConversationStateValidationError extends Error {
  readonly code = "INVALID_CONVERSATION_STATE";

  constructor(message: string) {
    super(message);
    this.name = "ConversationStateValidationError";
  }
}

const LIFECYCLES: readonly ConversationLifecycle[] = ["OPEN", "CLOSED"];
const FLOW_IDS: readonly ConversationFlowId[] = [
  "ADDRESS_SETUP",
  "COURSE_SELECTION",
  "COURSE_FOLLOW_UP",
  "ACADEMY_CONTACT",
];
const COURSE_MATCH_STATES: readonly CourseMatchState[] = [
  "UNKNOWN",
  "MATCHED",
  "NO_CURRENT_COURSE_MATCH",
  "AMBIGUOUS",
];
const LAST_ASSISTANT_ACTS: readonly LastAssistantAct[] = [
  "ADDRESS_SETUP",
  "PROFILE_CONTROL",
  "RESTART",
  "CONVERSATION_CLOSE",
  "CANCEL_FLOW",
  "REPEAT",
  "REPHRASE",
  "SIMPLIFY",
  "RESUME_FLOW",
  "SKIP",
  "DEFERRED_NOT_ACCEPTED",
  "STALE_REFERENCE_CONFIRMATION",
  "CLARIFICATION",
  "CLARIFICATION_EXHAUSTED",
  "NAVIGATE",
  "COURSE_FOLLOW_UP",
  "ACADEMY_CONTACT",
  "META",
  "OUT_OF_SCOPE",
];
const CONFIRMATION_KINDS: readonly PendingConfirmationKind[] = [
  "STALE_COURSE_REFERENCE",
];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ConversationStateValidationError(
      `${fieldName} must be one of: ${allowed.join(", ")}.`,
    );
  }

  return value as T;
}

function readNullableString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value !== "string") {
    throw new ConversationStateValidationError(
      `${fieldName} must be a string or null.`,
    );
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ConversationStateValidationError(
      `${fieldName} length is invalid.`,
    );
  }

  return normalized;
}

export function toSessionTimestamp(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

export function readSessionTimestamp(
  value: unknown,
  fieldName: string,
): number {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw new ConversationStateValidationError(
      `${fieldName} must be an ISO-8601 UTC timestamp.`,
    );
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ConversationStateValidationError(
      `${fieldName} is not a valid timestamp.`,
    );
  }

  return parsed;
}

export function createInitialConversationState(
  nowMs: number,
): ConversationState {
  return {
    lifecycle: "OPEN",
    activeFlow: null,
    suspendedFlow: null,
    courseMatch: "UNKNOWN",
    selectedCourseId: null,
    clarification: null,
    pendingConfirmation: null,
    deferredRequest: null,
    lastAssistant: null,
    lastActivityAt: toSessionTimestamp(nowMs),
    staleReference: null,
  };
}

/** Working navigation state only: everything the 24h TTL expires. */
export function clearWorkingState(
  state: ConversationState,
): ConversationState {
  return {
    ...createInitialConversationState(0),
    lifecycle: state.lifecycle,
    lastActivityAt: state.lastActivityAt,
  };
}

export function normalizeConversationStatePayload(
  value: unknown,
  nowMs: number,
): ConversationState {
  if (value === undefined || value === null) {
    return createInitialConversationState(nowMs);
  }

  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      "lifecycle",
      "activeFlow",
      "suspendedFlow",
      "courseMatch",
      "selectedCourseId",
      "clarification",
      "pendingConfirmation",
      "deferredRequest",
      "lastAssistant",
      "lastActivityAt",
      "staleReference",
    ])
  ) {
    throw new ConversationStateValidationError(
      "Conversation state has an invalid shape.",
    );
  }

  const lifecycle = readEnum(value.lifecycle, LIFECYCLES, "lifecycle");
  const courseMatch = readEnum(
    value.courseMatch,
    COURSE_MATCH_STATES,
    "courseMatch",
  );

  const readFlow = (
    raw: unknown,
    fieldName: string,
  ): ConversationFlow | null => {
    if (raw === null || raw === undefined) return null;
    if (!isRecord(raw) || !onlyKeys(raw, ["id", "pendingQuestion"])) {
      throw new ConversationStateValidationError(
        `${fieldName} has an invalid shape.`,
      );
    }

    const id = readEnum(raw.id, FLOW_IDS, `${fieldName}.id`);
    const pendingQuestion = readNullableString(
      raw.pendingQuestion,
      `${fieldName}.pendingQuestion`,
      MAX_CHAT_MESSAGE_LENGTH,
    );

    return { id, pendingQuestion };
  };

  const activeFlow = readFlow(value.activeFlow, "activeFlow");
  const suspendedFlow = readFlow(value.suspendedFlow, "suspendedFlow");

  if (
    activeFlow !== null &&
    suspendedFlow !== null &&
    activeFlow.id === suspendedFlow.id
  ) {
    throw new ConversationStateValidationError(
      "A flow cannot be active and suspended at the same time.",
    );
  }

  const selectedCourseId = readNullableString(
    value.selectedCourseId,
    "selectedCourseId",
    MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
  );

  if (selectedCourseId !== null && !isRecommendableCourseId(selectedCourseId)) {
    throw new ConversationStateValidationError(
      "selectedCourseId must be a current routable course.",
    );
  }

  if (courseMatch === "MATCHED" && selectedCourseId === null) {
    throw new ConversationStateValidationError(
      "MATCHED requires a selected course.",
    );
  }

  if (courseMatch !== "MATCHED" && selectedCourseId !== null) {
    throw new ConversationStateValidationError(
      "A selected course requires courseMatch MATCHED.",
    );
  }

  let clarification: ClarificationState | null = null;
  if (value.clarification !== null && value.clarification !== undefined) {
    const raw = value.clarification;
    if (!isRecord(raw) || !onlyKeys(raw, ["issueKey", "attempts", "strategyKey"])) {
      throw new ConversationStateValidationError(
        "clarification has an invalid shape.",
      );
    }

    const issueKey = readNullableString(
      raw.issueKey,
      "clarification.issueKey",
      MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
    );
    if (issueKey === null) {
      throw new ConversationStateValidationError(
        "clarification.issueKey is required.",
      );
    }

    if (
      !Number.isInteger(raw.attempts) ||
      (raw.attempts as number) < 0 ||
      (raw.attempts as number) > CLARIFICATION_BUDGET
    ) {
      throw new ConversationStateValidationError(
        `clarification.attempts must be an integer between 0 and ${CLARIFICATION_BUDGET}.`,
      );
    }

    clarification = {
      issueKey,
      attempts: raw.attempts as number,
      strategyKey: readNullableString(
        raw.strategyKey,
        "clarification.strategyKey",
        MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
      ),
    };
  }

  let pendingConfirmation: PendingConfirmation | null = null;
  if (
    value.pendingConfirmation !== null &&
    value.pendingConfirmation !== undefined
  ) {
    const raw = value.pendingConfirmation;
    if (
      !isRecord(raw) ||
      !onlyKeys(raw, [
        "confirmationKey",
        "kind",
        "prompt",
        "candidateCourseId",
      ])
    ) {
      throw new ConversationStateValidationError(
        "pendingConfirmation has an invalid shape.",
      );
    }

    const confirmationKey = readNullableString(
      raw.confirmationKey,
      "pendingConfirmation.confirmationKey",
      MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
    );
    const prompt = readNullableString(
      raw.prompt,
      "pendingConfirmation.prompt",
      MAX_PENDING_CONFIRMATION_PROMPT_LENGTH,
    );

    if (confirmationKey === null || prompt === null) {
      throw new ConversationStateValidationError(
        "pendingConfirmation requires confirmationKey and prompt.",
      );
    }

    const candidateCourseId = readNullableString(
      raw.candidateCourseId,
      "pendingConfirmation.candidateCourseId",
      MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
    );

    if (
      candidateCourseId !== null &&
      !isRecommendableCourseId(candidateCourseId)
    ) {
      throw new ConversationStateValidationError(
        "pendingConfirmation.candidateCourseId must be a current routable course.",
      );
    }

    pendingConfirmation = {
      confirmationKey,
      kind: readEnum(
        raw.kind,
        CONFIRMATION_KINDS,
        "pendingConfirmation.kind",
      ),
      prompt,
      candidateCourseId,
    };
  }

  const deferredRequest = readNullableString(
    value.deferredRequest,
    "deferredRequest",
    MAX_CHAT_MESSAGE_LENGTH,
  );

  let lastAssistant: LastAssistantAction | null = null;
  if (value.lastAssistant !== null && value.lastAssistant !== undefined) {
    const raw = value.lastAssistant;
    if (!isRecord(raw) || !onlyKeys(raw, ["act", "content", "courseId"])) {
      throw new ConversationStateValidationError(
        "lastAssistant has an invalid shape.",
      );
    }

    const content = readNullableString(
      raw.content,
      "lastAssistant.content",
      MAX_CHAT_MESSAGE_LENGTH,
    );
    if (content === null) {
      throw new ConversationStateValidationError(
        "lastAssistant.content is required.",
      );
    }

    const courseId = readNullableString(
      raw.courseId,
      "lastAssistant.courseId",
      MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
    );

    if (courseId !== null && !isRecommendableCourseId(courseId)) {
      throw new ConversationStateValidationError(
        "lastAssistant.courseId must be a current routable course.",
      );
    }

    lastAssistant = {
      act: readEnum(raw.act, LAST_ASSISTANT_ACTS, "lastAssistant.act"),
      content,
      courseId,
    };
  }

  let staleReference: StaleReference | null = null;
  if (value.staleReference !== null && value.staleReference !== undefined) {
    const raw = value.staleReference;
    if (!isRecord(raw) || !onlyKeys(raw, ["previousCourseId", "previousFlowId"])) {
      throw new ConversationStateValidationError(
        "staleReference has an invalid shape.",
      );
    }

    const previousCourseId = readNullableString(
      raw.previousCourseId,
      "staleReference.previousCourseId",
      MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
    );

    if (previousCourseId !== null && !isRecommendableCourseId(previousCourseId)) {
      throw new ConversationStateValidationError(
        "staleReference.previousCourseId must be a current routable course.",
      );
    }

    staleReference = {
      previousCourseId,
      previousFlowId:
        raw.previousFlowId === null || raw.previousFlowId === undefined
          ? null
          : readEnum(raw.previousFlowId, FLOW_IDS, "staleReference.previousFlowId"),
    };
  }

  if (lifecycle === "CLOSED" && activeFlow !== null) {
    throw new ConversationStateValidationError(
      "A closed conversation cannot keep an active flow.",
    );
  }

  const lastActivityAtMs = readSessionTimestamp(
    value.lastActivityAt,
    "lastActivityAt",
  );

  if (lastActivityAtMs - nowMs > SESSION_CONTEXT_TTL_MS) {
    throw new ConversationStateValidationError(
      "lastActivityAt is too far in the future.",
    );
  }

  return {
    lifecycle,
    activeFlow,
    suspendedFlow,
    courseMatch,
    selectedCourseId,
    clarification,
    pendingConfirmation,
    deferredRequest,
    lastAssistant,
    lastActivityAt: value.lastActivityAt as string,
    staleReference,
  };
}

export type SessionFreshnessOutcome = {
  state: ConversationState;
  expired: boolean;
};

/**
 * Applies the 24h inactivity boundary. Profile fields are not part of this
 * state and are therefore preserved by construction; displayName, nameDeclined
 * and the TY/VY preference survive expiry untouched.
 */
export function applySessionFreshness(
  state: ConversationState,
  nowMs: number,
): SessionFreshnessOutcome {
  const lastActivityAtMs = Date.parse(state.lastActivityAt);

  if (!Number.isFinite(lastActivityAtMs)) {
    throw new ConversationStateValidationError(
      "lastActivityAt is not a valid timestamp.",
    );
  }

  if (nowMs - lastActivityAtMs < SESSION_CONTEXT_TTL_MS) {
    return { state, expired: false };
  }

  const previousCourseId =
    state.selectedCourseId ?? state.staleReference?.previousCourseId ?? null;
  const previousFlowId =
    state.activeFlow?.id ?? state.suspendedFlow?.id ?? null;

  const cleared = clearWorkingState(state);

  return {
    state: {
      ...cleared,
      lastActivityAt: toSessionTimestamp(nowMs),
      // Always recorded, so a referential phrase can be recognised as stale
      // even when there was no course or flow worth remembering.
      staleReference: { previousCourseId, previousFlowId },
    },
    expired: true,
  };
}

export function withActivity(
  state: ConversationState,
  nowMs: number,
): ConversationState {
  return { ...state, lastActivityAt: toSessionTimestamp(nowMs) };
}

export function withLastAssistant(
  state: ConversationState,
  action: LastAssistantAction,
): ConversationState {
  return { ...state, lastAssistant: action };
}

export function withActiveFlow(
  state: ConversationState,
  flow: ConversationFlow | null,
): ConversationState {
  return { ...state, activeFlow: flow };
}

export function withCourseBinding(
  state: ConversationState,
  courseMatch: CourseMatchState,
  selectedCourseId: string | null,
): ConversationState {
  if (courseMatch === "MATCHED" && selectedCourseId !== null) {
    return { ...state, courseMatch, selectedCourseId };
  }

  return { ...state, courseMatch, selectedCourseId: null };
}

/**
 * A supported side question suspends rather than erases the active flow (A15).
 * One bounded suspended slot is sufficient and is deliberately not a stack.
 */
export function suspendActiveFlow(
  state: ConversationState,
): ConversationState {
  if (state.activeFlow === null) return state;

  return { ...state, activeFlow: null, suspendedFlow: state.activeFlow };
}

export function resumeSuspendedFlow(
  state: ConversationState,
): ConversationState {
  if (state.suspendedFlow === null) return state;

  return { ...state, activeFlow: state.suspendedFlow, suspendedFlow: null };
}

/**
 * Cancel-current-flow clears flow state only; profile and session survive (A17).
 *
 * A preserved substantive remainder (A19) is cleared here without execution:
 * cancellation is a governance-approved stop condition, and the remainder
 * belongs to the flow context being abandoned.
 */
export function cancelCurrentFlow(
  state: ConversationState,
): ConversationState {
  return {
    ...state,
    activeFlow: null,
    suspendedFlow: null,
    clarification: null,
    pendingConfirmation: null,
    courseMatch: "UNKNOWN",
    selectedCourseId: null,
    staleReference: null,
    deferredRequest: null,
  };
}

export function closeConversation(
  state: ConversationState,
  nowMs: number,
): ConversationState {
  return {
    ...clearWorkingState(state),
    lifecycle: "CLOSED",
    lastActivityAt: toSessionTimestamp(nowMs),
  };
}

export function reopenConversation(
  state: ConversationState,
): ConversationState {
  if (state.lifecycle === "OPEN") return state;
  return { ...clearWorkingState(state), lifecycle: "OPEN" };
}

export function withClarification(
  state: ConversationState,
  clarification: ClarificationState | null,
): ConversationState {
  return { ...state, clarification };
}

export function withPendingConfirmation(
  state: ConversationState,
  pendingConfirmation: PendingConfirmation | null,
): ConversationState {
  // A pending confirmation blocks routing but must not destroy a preserved
  // remainder (A19): the remainder stays queued and is promoted by the next
  // turn that reaches normal routing once the confirmation is resolved.
  return { ...state, pendingConfirmation };
}

export function withDeferredRequest(
  state: ConversationState,
  deferredRequest: string | null,
): ConversationState {
  return { ...state, deferredRequest };
}

export type DeferredCaptureStatus = "ACCEPTED" | "REJECTED_CAPACITY";

/**
 * Structured outcome of one capture attempt (A19). A capacity condition is an
 * ordinary expected result rather than an exception, so the control response
 * layer can state the truth instead of inspecting its own prose.
 */
export type DeferredCaptureOutcome = {
  status: DeferredCaptureStatus;
  state: ConversationState;
};

/**
 * Queues a newly captured substantive remainder behind any remainder that is
 * already waiting (A19), without ever destroying text the user was told was
 * preserved.
 *
 * An accepted capture keeps both remainders, in arrival order, so a second
 * control turn cannot silently drop the first one. A capture that does not fit
 * alongside the stored remainder is reported as REJECTED_CAPACITY and the
 * stored remainder is returned untouched: replacing it with the newest text
 * would delete a remainder the user was already told was saved, which is the
 * same false-promise class the deferred lifecycle exists to prevent.
 */
export function appendDeferredRequest(
  state: ConversationState,
  remainder: string | null,
): DeferredCaptureOutcome {
  if (remainder === null) {
    return { status: "ACCEPTED", state };
  }

  const existing = state.deferredRequest;

  const next =
    existing === null || existing === remainder
      ? remainder
      : `${existing}${DEFERRED_REQUEST_SEPARATOR}${remainder}`;

  if (next.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { status: "REJECTED_CAPACITY", state };
  }

  return { status: "ACCEPTED", state: { ...state, deferredRequest: next } };
}

export type EffectiveRouteRequestOutcome =
  | { status: "ACCEPTED"; request: string }
  | { status: "REJECTED_CAPACITY" };

/**
 * Forms the request handed to normal routing (A19) under the single explicit
 * bound MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH.
 *
 * A preserved remainder is promoted in front of the turn's own request; with
 * nothing preserved the turn's request is already the effective one. A
 * combination past the bound is reported as REJECTED_CAPACITY rather than
 * shortened, so no user content is ever silently truncated.
 */
export function composeEffectiveRouteRequest(
  deferredRequest: string | null,
  request: string,
): EffectiveRouteRequestOutcome {
  const effective =
    deferredRequest === null
      ? request
      : `${deferredRequest}${DEFERRED_REQUEST_SEPARATOR}${request}`;

  return effective.length <= MAX_EFFECTIVE_ROUTE_REQUEST_LENGTH
    ? { status: "ACCEPTED", request: effective }
    : { status: "REJECTED_CAPACITY" };
}

/**
 * Issue identity for the clarification budget. Keyed on the router's
 * unresolved candidate set so the counter is scoped to the unresolved issue
 * rather than to the session lifetime.
 */
export function clarificationIssueKey(candidateCourseIds: readonly string[]): string {
  const sorted = [...new Set(candidateCourseIds)].sort();
  return sorted.length === 0 ? "ask-more:generic" : `ask-more:${sorted.join("+")}`;
}

export function isClarificationExhausted(
  clarification: ClarificationState | null,
): boolean {
  return clarification !== null && clarification.attempts >= CLARIFICATION_BUDGET;
}

/**
 * Profile fields the 24h TTL must never clear.
 */
export function profileSurvivesExpiry(
  profile: ConversationProfile,
): {
  displayName: string | null;
  nameDeclined: boolean;
  addressMode: AddressMode | null;
} {
  return {
    displayName: profile.displayName,
    nameDeclined: profile.nameDeclined,
    addressMode: profile.addressMode,
  };
}

/** Routing outcome of one orchestrated turn, independent of the orchestrator. */
export type OrchestratedDecision =
  | { kind: "NONE" }
  | { kind: "MATCHED"; courseId: string }
  | { kind: "NO_MATCH" }
  | { kind: "AMBIGUOUS" };

export type OrchestratedClarification = {
  status: "NOT_APPLICABLE" | "ASKED" | "EXHAUSTED";
  issueKey: string | null;
  attempts: number;
  question: string | null;
};

export type OrchestratedTurnOutcome = {
  act: LastAssistantAct;
  /** null when the turn was a digression rather than a flow continuation. */
  flowId: ConversationFlowId | null;
  message: string;
  decision: OrchestratedDecision;
  clarification: OrchestratedClarification;
};

/**
 * Applies one orchestrated turn to the structured state (A09/A15).
 *
 * A supported digression suspends the active flow instead of erasing it; a
 * continuation keeps or replaces it. A bound course identity is only ever taken
 * from an already-validated routing outcome.
 */
export function applyOrchestratedTurn(
  state: ConversationState,
  outcome: OrchestratedTurnOutcome,
  nowMs: number,
): ConversationState {
  let next = state;

  if (outcome.flowId === null) {
    next = suspendActiveFlow(next);
  } else if (next.suspendedFlow?.id === outcome.flowId) {
    // Re-activating the interrupted flow: the interruption is over.
    next = {
      ...next,
      suspendedFlow: null,
      activeFlow: {
        id: outcome.flowId,
        pendingQuestion:
          outcome.clarification.status === "ASKED"
            ? outcome.clarification.question
            : null,
      },
    };
  } else if (
    next.activeFlow !== null &&
    next.activeFlow.id !== outcome.flowId
  ) {
    // A supported digression suspends the flow it interrupted rather than
    // erasing it (A15).
    next = suspendActiveFlow(next);
    next = withActiveFlow(next, {
      id: outcome.flowId,
      pendingQuestion:
        outcome.clarification.status === "ASKED"
          ? outcome.clarification.question
          : null,
    });
  } else {
    next = withActiveFlow(next, {
      id: outcome.flowId,
      pendingQuestion:
        outcome.clarification.status === "ASKED"
          ? outcome.clarification.question
          : null,
    });
  }

  switch (outcome.decision.kind) {
    case "MATCHED":
      next = withCourseBinding(next, "MATCHED", outcome.decision.courseId);
      break;
    case "NO_MATCH":
      next = withCourseBinding(next, "NO_CURRENT_COURSE_MATCH", null);
      break;
    case "AMBIGUOUS":
      next = withCourseBinding(next, "AMBIGUOUS", null);
      break;
    default:
      break;
  }

  if (outcome.clarification.status === "ASKED") {
    next = withClarification(next, {
      issueKey: outcome.clarification.issueKey ?? "ask-more:generic",
      attempts: outcome.clarification.attempts,
      strategyKey: `ask-more-${String(outcome.clarification.attempts)}`,
    });
  } else if (outcome.clarification.status === "EXHAUSTED") {
    next = withClarification(next, {
      issueKey: outcome.clarification.issueKey ?? "ask-more:generic",
      attempts: CLARIFICATION_BUDGET,
      strategyKey: null,
    });
  } else if (outcome.decision.kind !== "NONE") {
    // The unresolved issue no longer blocks routing, so its counter resets.
    next = withClarification(next, null);
  }

  // A business turn supersedes whatever a control turn had deferred, and
  // establishes fresh context, so the stale-session marker is retired.
  next = withDeferredRequest(next, null);
  next = { ...next, staleReference: null };

  next = withLastAssistant(next, {
    act: outcome.act,
    content: outcome.message,
    courseId: next.selectedCourseId,
  });

  return withActivity(next, nowMs);
}
