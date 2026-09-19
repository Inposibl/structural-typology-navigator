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
 * One centrally configured repair-failure threshold (A05/A23). The counter it
 * bounds is scoped to one repair issue by RepairState.issueKey, never to the
 * session lifetime, and is deliberately separate from the clarification budget:
 * a semantic misunderstanding and an unsatisfactory answer are different
 * resources.
 */
export const REPAIR_FAILURE_THRESHOLD = 2;

/** Bounded session-scope evidence list (A25). Newest entry is last. */
export const MAX_SESSION_QUALITY_SIGNALS = 3;

/** Opaque request/execution identity carried by the client (A22). */
export const MAX_REQUEST_ID_LENGTH = 64;

export const MAX_TECHNICAL_ERROR_STAGE_LENGTH = 40;
export const MAX_QUALITY_SIGNAL_TRIGGER_LENGTH = 60;
export const MAX_HANDOFF_ESTABLISHED_FACTS = 6;

/**
 * Hard total-size limit for a composed handoff summary (A24). The structured
 * context is closed and small; this bounds the rendered text so a handoff can
 * never become a transcript dump.
 */
export const MAX_HANDOFF_CONTEXT_LENGTH = 900;

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
  | "REPAIR_RESTATE"
  | "REPAIR_CLARIFY"
  | "REPAIR_CHALLENGE"
  | "REPAIR_UNAVAILABLE"
  | "RESUME_FLOW"
  | "SKIP"
  | "DEFERRED_NOT_ACCEPTED"
  | "STALE_REFERENCE_CONFIRMATION"
  | "CLARIFICATION"
  | "CLARIFICATION_EXHAUSTED"
  | "HANDOFF_OFFERED"
  | "HANDOFF_READY"
  | "TECHNICAL_ERROR"
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

/**
 * Repair state (A05). Scoped to one unresolved repair issue by issueKey and
 * bounded by REPAIR_FAILURE_THRESHOLD, so an unrelated later complaint starts a
 * fresh issue instead of inheriting an old count.
 */
export type RepairState = {
  issueKey: string;
  /** Repair signals recorded for this issue, including the current turn. */
  attempts: number;
};

export type ExecutionPhase = "IDLE" | "IN_PROGRESS";

/**
 * Structured busy/duplicate state (A22).
 *
 * `phase` describes the request a state payload belongs to: a payload handed
 * back as the baseline for a new turn is always IDLE, because a successful turn
 * completes synchronously and a failed turn never marks itself completed. An
 * IN_PROGRESS baseline is therefore contradictory by construction and is
 * rejected at the API boundary rather than executed.
 */
export type ExecutionState = {
  phase: ExecutionPhase;
  requestId: string | null;
  /** Identity of the request whose turn completed. Used for replay detection. */
  lastCompletedRequestId: string | null;
};

/**
 * Coarse internal technical-failure taxonomy (A21). Never rendered to the user:
 * the public error response carries none of these labels.
 */
export const TECHNICAL_FAILURE_CLASSES = [
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "CONFIGURATION_FAILURE",
  "DATA_ACCESS_FAILURE",
  "INTERNAL_RUNTIME_FAILURE",
  "UNKNOWN_TECHNICAL_FAILURE",
] as const;

export type TechnicalFailureClass = (typeof TECHNICAL_FAILURE_CLASSES)[number];

export type TechnicalErrorState = {
  failureClass: TechnicalFailureClass;
  occurredAt: string;
  retryable: boolean;
  /** Navigator stage where the failure surfaced; internal provenance only. */
  stage: string;
};

export type HandoffStatus = "NONE" | "OFFERED" | "REQUESTED" | "READY";

export type HandoffReason =
  | "DIRECT_REQUEST"
  | "REPEATED_REPAIR_FAILURE"
  | "FRUSTRATION"
  | "CLARIFICATION_EXHAUSTED"
  | "REPAIR_CONTEXT_UNAVAILABLE"
  /** Reserved for the commercial-authority package; never detected here. */
  | "INSUFFICIENT_AUTHORITY";

export type HandoffGoal =
  | "COURSE_SELECTION"
  | "COURSE_FOLLOW_UP"
  | "ACADEMY_CONTACT"
  | "HUMAN_CONTACT"
  | "COURSE_CONFIRMATION"
  | "UNRESOLVED_CLARIFICATION";

export type HandoffUnresolvedChoice =
  | "NONE"
  | "NOT_MATCHED"
  | "AMBIGUOUS"
  | "CLARIFYING"
  | "AWAITING_CONFIRMATION";

export type HandoffFact =
  | "SELECTED_COURSE"
  | "NO_CURRENT_COURSE_MATCH"
  | "AMBIGUOUS_COURSE_CHOICE"
  | "UNRESOLVED_COURSE_CHOICE"
  | "PRESERVED_REQUEST"
  | "PENDING_CONFIRMATION"
  | "AWAITING_CLARIFICATION"
  | "RECENT_TECHNICAL_FAILURE"
  | "REPAIR_IN_PROGRESS";

export type HandoffContactPreference = "NONE" | "TELEGRAM" | "PHONE" | "CHAT";

/**
 * Bounded handoff context (A24).
 *
 * Every field is either a closed enum or a canonical catalog identifier, so the
 * summary cannot carry an invented fact: the human-readable text is rendered
 * from these closed values, never stored as free prose.
 */
export type HandoffContext = {
  goal: HandoffGoal | null;
  /** Canonical routable course identity; the title is read from the catalog. */
  courseId: string | null;
  unresolvedChoice: HandoffUnresolvedChoice;
  flowId: ConversationFlowId | null;
  blockingProblem: HandoffReason;
  facts: HandoffFact[];
  contactPreference: HandoffContactPreference;
};

export type HandoffState = {
  status: HandoffStatus;
  reason: HandoffReason | null;
  context: HandoffContext | null;
};

export type QualitySignalType = "NEGATIVE_FEEDBACK" | "MATERIAL_FAILURE";

/**
 * Structured quality / failure-capture candidate (A25). Session-scope evidence
 * with bounded provenance, created for the observability package to consume
 * later. Package B stores no transcript, no stack and no credential here.
 */
export type QualitySignal = {
  signalType: QualitySignalType;
  trigger: string;
  occurredAt: string;
  stage: string;
  lastAssistantAct: LastAssistantAct | null;
  flowId: ConversationFlowId | null;
  courseId: string | null;
  requestId: string | null;
  repairOffered: boolean;
  handoffOffered: boolean;
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
  /** A05 repair episode. Null when no repair issue is open. */
  repair: RepairState | null;
  /** A22 execution identity of the request this state belongs to. */
  execution: ExecutionState;
  /** A21 last material technical failure; cleared by a later successful turn. */
  lastTechnicalError: TechnicalErrorState | null;
  /** A23/A24 handoff policy state and its bounded prepared context. */
  handoff: HandoffState;
  /** A25 bounded session-scope quality and failure-capture evidence. */
  qualitySignals: QualitySignal[];
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
  "REPAIR_RESTATE",
  "REPAIR_CLARIFY",
  "REPAIR_CHALLENGE",
  "REPAIR_UNAVAILABLE",
  "RESUME_FLOW",
  "SKIP",
  "DEFERRED_NOT_ACCEPTED",
  "STALE_REFERENCE_CONFIRMATION",
  "CLARIFICATION",
  "CLARIFICATION_EXHAUSTED",
  "HANDOFF_OFFERED",
  "HANDOFF_READY",
  "TECHNICAL_ERROR",
  "NAVIGATE",
  "COURSE_FOLLOW_UP",
  "ACADEMY_CONTACT",
  "META",
  "OUT_OF_SCOPE",
];
const CONFIRMATION_KINDS: readonly PendingConfirmationKind[] = [
  "STALE_COURSE_REFERENCE",
];
const EXECUTION_PHASES: readonly ExecutionPhase[] = ["IDLE", "IN_PROGRESS"];
const HANDOFF_STATUSES: readonly HandoffStatus[] = [
  "NONE",
  "OFFERED",
  "REQUESTED",
  "READY",
];
const HANDOFF_REASONS: readonly HandoffReason[] = [
  "DIRECT_REQUEST",
  "REPEATED_REPAIR_FAILURE",
  "FRUSTRATION",
  "CLARIFICATION_EXHAUSTED",
  "REPAIR_CONTEXT_UNAVAILABLE",
  "INSUFFICIENT_AUTHORITY",
];
const HANDOFF_GOALS: readonly HandoffGoal[] = [
  "COURSE_SELECTION",
  "COURSE_FOLLOW_UP",
  "ACADEMY_CONTACT",
  "HUMAN_CONTACT",
  "COURSE_CONFIRMATION",
  "UNRESOLVED_CLARIFICATION",
];
const HANDOFF_UNRESOLVED_CHOICES: readonly HandoffUnresolvedChoice[] = [
  "NONE",
  "NOT_MATCHED",
  "AMBIGUOUS",
  "CLARIFYING",
  "AWAITING_CONFIRMATION",
];
const HANDOFF_FACTS: readonly HandoffFact[] = [
  "SELECTED_COURSE",
  "NO_CURRENT_COURSE_MATCH",
  "AMBIGUOUS_COURSE_CHOICE",
  "UNRESOLVED_COURSE_CHOICE",
  "PRESERVED_REQUEST",
  "PENDING_CONFIRMATION",
  "AWAITING_CLARIFICATION",
  "RECENT_TECHNICAL_FAILURE",
  "REPAIR_IN_PROGRESS",
];
const HANDOFF_CONTACT_PREFERENCES: readonly HandoffContactPreference[] = [
  "NONE",
  "TELEGRAM",
  "PHONE",
  "CHAT",
];
const QUALITY_SIGNAL_TYPES: readonly QualitySignalType[] = [
  "NEGATIVE_FEEDBACK",
  "MATERIAL_FAILURE",
];

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * Opaque client request identity (A22). Validated, never interpreted: it is an
 * equality token for replay detection and carries no business meaning.
 */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

const EMPTY_EXECUTION: ExecutionState = {
  phase: "IDLE",
  requestId: null,
  lastCompletedRequestId: null,
};

export function createEmptyHandoffState(): HandoffState {
  return { status: "NONE", reason: null, context: null };
}

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
    repair: null,
    execution: { ...EMPTY_EXECUTION },
    lastTechnicalError: null,
    handoff: createEmptyHandoffState(),
    qualitySignals: [],
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

function readRequestId(value: unknown, fieldName: string): string | null {
  if (value === null || value === undefined) return null;

  if (!isValidRequestId(value)) {
    throw new ConversationStateValidationError(
      `${fieldName} must be a bounded opaque request identity.`,
    );
  }

  return value;
}

function readRepairState(raw: unknown): RepairState | null {
  if (raw === null || raw === undefined) return null;

  if (!isRecord(raw) || !onlyKeys(raw, ["issueKey", "attempts"])) {
    throw new ConversationStateValidationError("repair has an invalid shape.");
  }

  const issueKey = readNullableString(
    raw.issueKey,
    "repair.issueKey",
    MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
  );

  if (issueKey === null) {
    throw new ConversationStateValidationError("repair.issueKey is required.");
  }

  if (
    !Number.isInteger(raw.attempts) ||
    (raw.attempts as number) < 1 ||
    (raw.attempts as number) > REPAIR_FAILURE_THRESHOLD
  ) {
    throw new ConversationStateValidationError(
      `repair.attempts must be an integer between 1 and ${REPAIR_FAILURE_THRESHOLD}.`,
    );
  }

  return { issueKey, attempts: raw.attempts as number };
}

function readExecutionState(raw: unknown): ExecutionState {
  if (raw === null || raw === undefined) return { ...EMPTY_EXECUTION };

  if (
    !isRecord(raw) ||
    !onlyKeys(raw, ["phase", "requestId", "lastCompletedRequestId"])
  ) {
    throw new ConversationStateValidationError(
      "execution has an invalid shape.",
    );
  }

  const phase = readEnum(raw.phase, EXECUTION_PHASES, "execution.phase");
  const requestId = readRequestId(raw.requestId, "execution.requestId");
  const lastCompletedRequestId = readRequestId(
    raw.lastCompletedRequestId,
    "execution.lastCompletedRequestId",
  );

  if (phase === "IN_PROGRESS" && requestId === null) {
    throw new ConversationStateValidationError(
      "An in-progress execution requires a request identity.",
    );
  }

  return { phase, requestId, lastCompletedRequestId };
}

function readTechnicalErrorState(raw: unknown): TechnicalErrorState | null {
  if (raw === null || raw === undefined) return null;

  if (
    !isRecord(raw) ||
    !onlyKeys(raw, ["failureClass", "occurredAt", "retryable", "stage"])
  ) {
    throw new ConversationStateValidationError(
      "lastTechnicalError has an invalid shape.",
    );
  }

  const stage = readNullableString(
    raw.stage,
    "lastTechnicalError.stage",
    MAX_TECHNICAL_ERROR_STAGE_LENGTH,
  );

  if (stage === null) {
    throw new ConversationStateValidationError(
      "lastTechnicalError.stage is required.",
    );
  }

  if (typeof raw.retryable !== "boolean") {
    throw new ConversationStateValidationError(
      "lastTechnicalError.retryable must be boolean.",
    );
  }

  readSessionTimestamp(raw.occurredAt, "lastTechnicalError.occurredAt");

  return {
    failureClass: readEnum(
      raw.failureClass,
      TECHNICAL_FAILURE_CLASSES,
      "lastTechnicalError.failureClass",
    ),
    occurredAt: raw.occurredAt as string,
    retryable: raw.retryable,
    stage,
  };
}

function readHandoffContext(raw: unknown): HandoffContext | null {
  if (raw === null || raw === undefined) return null;

  if (
    !isRecord(raw) ||
    !onlyKeys(raw, [
      "goal",
      "courseId",
      "unresolvedChoice",
      "flowId",
      "blockingProblem",
      "facts",
      "contactPreference",
    ])
  ) {
    throw new ConversationStateValidationError(
      "handoff.context has an invalid shape.",
    );
  }

  const courseId = readNullableString(
    raw.courseId,
    "handoff.context.courseId",
    MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
  );

  if (courseId !== null && !isRecommendableCourseId(courseId)) {
    throw new ConversationStateValidationError(
      "handoff.context.courseId must be a current routable course.",
    );
  }

  const rawFacts = raw.facts;
  if (
    !Array.isArray(rawFacts) ||
    rawFacts.length > MAX_HANDOFF_ESTABLISHED_FACTS
  ) {
    throw new ConversationStateValidationError(
      "handoff.context.facts has an invalid shape.",
    );
  }

  return {
    goal:
      raw.goal === null || raw.goal === undefined
        ? null
        : readEnum(raw.goal, HANDOFF_GOALS, "handoff.context.goal"),
    courseId,
    unresolvedChoice: readEnum(
      raw.unresolvedChoice,
      HANDOFF_UNRESOLVED_CHOICES,
      "handoff.context.unresolvedChoice",
    ),
    flowId:
      raw.flowId === null || raw.flowId === undefined
        ? null
        : readEnum(raw.flowId, FLOW_IDS, "handoff.context.flowId"),
    blockingProblem: readEnum(
      raw.blockingProblem,
      HANDOFF_REASONS,
      "handoff.context.blockingProblem",
    ),
    facts: rawFacts.map((fact, index) =>
      readEnum(fact, HANDOFF_FACTS, `handoff.context.facts[${String(index)}]`),
    ),
    contactPreference: readEnum(
      raw.contactPreference,
      HANDOFF_CONTACT_PREFERENCES,
      "handoff.context.contactPreference",
    ),
  };
}

function readHandoffState(raw: unknown): HandoffState {
  if (raw === null || raw === undefined) return createEmptyHandoffState();

  if (!isRecord(raw) || !onlyKeys(raw, ["status", "reason", "context"])) {
    throw new ConversationStateValidationError("handoff has an invalid shape.");
  }

  const status = readEnum(raw.status, HANDOFF_STATUSES, "handoff.status");
  const reason =
    raw.reason === null || raw.reason === undefined
      ? null
      : readEnum(raw.reason, HANDOFF_REASONS, "handoff.reason");
  const context = readHandoffContext(raw.context);

  if (status === "NONE") {
    if (reason !== null || context !== null) {
      throw new ConversationStateValidationError(
        "A NONE handoff cannot carry a reason or a context.",
      );
    }

    return { status, reason: null, context: null };
  }

  if (reason === null) {
    throw new ConversationStateValidationError(
      "An active handoff requires a reason.",
    );
  }

  if (status === "READY" && context === null) {
    throw new ConversationStateValidationError(
      "A READY handoff requires a prepared context.",
    );
  }

  return { status, reason, context };
}

function readQualitySignals(raw: unknown): QualitySignal[] {
  if (raw === null || raw === undefined) return [];

  if (!Array.isArray(raw) || raw.length > MAX_SESSION_QUALITY_SIGNALS) {
    throw new ConversationStateValidationError(
      "qualitySignals has an invalid shape.",
    );
  }

  return raw.map((entry, index) => {
    const fieldName = `qualitySignals[${String(index)}]`;

    if (
      !isRecord(entry) ||
      !onlyKeys(entry, [
        "signalType",
        "trigger",
        "occurredAt",
        "stage",
        "lastAssistantAct",
        "flowId",
        "courseId",
        "requestId",
        "repairOffered",
        "handoffOffered",
      ])
    ) {
      throw new ConversationStateValidationError(
        `${fieldName} has an invalid shape.`,
      );
    }

    const trigger = readNullableString(
      entry.trigger,
      `${fieldName}.trigger`,
      MAX_QUALITY_SIGNAL_TRIGGER_LENGTH,
    );
    const stage = readNullableString(
      entry.stage,
      `${fieldName}.stage`,
      MAX_TECHNICAL_ERROR_STAGE_LENGTH,
    );

    if (trigger === null || stage === null) {
      throw new ConversationStateValidationError(
        `${fieldName} requires a trigger and a stage.`,
      );
    }

    if (
      typeof entry.repairOffered !== "boolean" ||
      typeof entry.handoffOffered !== "boolean"
    ) {
      throw new ConversationStateValidationError(
        `${fieldName} offer flags must be boolean.`,
      );
    }

    readSessionTimestamp(entry.occurredAt, `${fieldName}.occurredAt`);

    const courseId = readNullableString(
      entry.courseId,
      `${fieldName}.courseId`,
      MAX_CONVERSATION_STATE_IDENTIFIER_LENGTH,
    );

    if (courseId !== null && !isRecommendableCourseId(courseId)) {
      throw new ConversationStateValidationError(
        `${fieldName}.courseId must be a current routable course.`,
      );
    }

    return {
      signalType: readEnum(
        entry.signalType,
        QUALITY_SIGNAL_TYPES,
        `${fieldName}.signalType`,
      ),
      trigger,
      occurredAt: entry.occurredAt as string,
      stage,
      lastAssistantAct:
        entry.lastAssistantAct === null || entry.lastAssistantAct === undefined
          ? null
          : readEnum(
              entry.lastAssistantAct,
              LAST_ASSISTANT_ACTS,
              `${fieldName}.lastAssistantAct`,
            ),
      flowId:
        entry.flowId === null || entry.flowId === undefined
          ? null
          : readEnum(entry.flowId, FLOW_IDS, `${fieldName}.flowId`),
      courseId,
      requestId: readRequestId(entry.requestId, `${fieldName}.requestId`),
      repairOffered: entry.repairOffered,
      handoffOffered: entry.handoffOffered,
    };
  });
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
      "repair",
      "execution",
      "lastTechnicalError",
      "handoff",
      "qualitySignals",
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
    repair: readRepairState(value.repair),
    execution: readExecutionState(value.execution),
    lastTechnicalError: readTechnicalErrorState(value.lastTechnicalError),
    handoff: readHandoffState(value.handoff),
    qualitySignals: readQualitySignals(value.qualitySignals),
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

export function withRepair(
  state: ConversationState,
  repair: RepairState | null,
): ConversationState {
  return { ...state, repair };
}

export function withTechnicalError(
  state: ConversationState,
  lastTechnicalError: TechnicalErrorState | null,
): ConversationState {
  return { ...state, lastTechnicalError };
}

export function withHandoff(
  state: ConversationState,
  handoff: HandoffState,
): ConversationState {
  return { ...state, handoff };
}

/**
 * Marks one request identity as completed (A22), leaving the session idle so
 * the next turn can execute. Only a turn that actually completed calls this:
 * a technical failure never marks its request as completed, so a retry of the
 * same identity re-executes rather than being suppressed as a replay.
 */
export function withCompletedExecution(
  state: ConversationState,
  requestId: string | null,
): ConversationState {
  return {
    ...state,
    execution: {
      phase: "IDLE",
      requestId: null,
      lastCompletedRequestId: requestId ?? state.execution.lastCompletedRequestId,
    },
  };
}

/**
 * Appends bounded quality evidence (A25), keeping only the most recent
 * entries so session state cannot grow with the conversation length.
 */
export function appendQualitySignal(
  state: ConversationState,
  signal: QualitySignal,
): ConversationState {
  const appended = [...state.qualitySignals, signal];

  return {
    ...state,
    qualitySignals: appended.slice(-MAX_SESSION_QUALITY_SIGNALS),
  };
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

  // The turn completed normally, so an open repair episode is closed (the user
  // stopped complaining) and a recorded technical failure is superseded (A21).
  next = withRepair(next, null);
  next = withTechnicalError(next, null);

  next = withLastAssistant(next, {
    act: outcome.act,
    content: outcome.message,
    courseId: next.selectedCourseId,
  });

  return withActivity(next, nowMs);
}
