import {
  callDeepSeekJson,
  DeepSeekClientError,
  type DeepSeekClientOptions,
  type DeepSeekMessage,
} from "./deepseek-client.ts";
import {
  ConversationActDecisionValidationError,
  type ConversationActDecision,
} from "./conversation-act-router.ts";
import type { ConversationMessage } from "../chat-contract.ts";
import {
  ARM_B_EXTRACTION_SYSTEM_PROMPT,
  buildPlanExtractionUserContent,
  mapPlanToRecoverySegments,
  validateTaskPlan,
  type RecoverySegment,
  type TaskPlanType,
  type TaskPlanTask,
} from "./task-plan.ts";
import type { NavigatorAnswerOrigin } from "./navigator-observability.ts";

/**
 * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — the F-1 recovery
 * boundary.
 *
 * Recovery eligibility requires the genuine exported validation-error class
 * with EXACTLY the F-1 COURSE_CONTENT-precondition failure (the wording is
 * pinned by test against the unchanged validator), a fulfilled invocation-local
 * capture of that rejection (a validation rejection can only originate from a
 * completed provider response — transport and malformed-output failures carry
 * different classes), no previous recovery for the same execution, and the
 * original effective user request. At most ONE extraction request is made; any
 * extraction, validation, mapping or coordination failure retains the existing
 * authorized fail-closed behavior. No third recovery-scoped provider request
 * exists and ARM-A-style re-classification is explicitly not implemented.
 */

/**
 * Byte-exact F-1 wording from conversation-act-router.ts (CORR1 F-1
 * precondition). The message is NOT exported by the router, so the constant is
 * pinned here and kept honest by a test that raises the real error through the
 * real validator; if the router wording ever changes, recovery silently
 * disables and the test failure surfaces the drift.
 */
export const F1_COURSE_CONTENT_PRECONDITION_MESSAGE =
  "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.";

export function isF1CourseContentRejection(error: unknown): boolean {
  return (
    error instanceof ConversationActDecisionValidationError &&
    error.message === F1_COURSE_CONTENT_PRECONDITION_MESSAGE
  );
}

/** Extraction deadline only; downstream work has no new whole-turn deadline. */
export const PLAN_RECOVERY_TIMEOUT_MS = 30_000;

export type PlanExtractionDependency = (
  messages: readonly DeepSeekMessage[],
  options: DeepSeekClientOptions,
) => Promise<unknown>;

/**
 * Bounds caller settlement even when an asynchronous dependency ignores abort.
 * Its late rejection is always observed. Cancellation is requested, not a
 * promise that a noncooperative dependency has stopped its own work.
 */
export async function extractTaskPlan(
  messages: readonly ConversationMessage[],
  options: DeepSeekClientOptions,
  extraction: PlanExtractionDependency = defaultPlanExtraction,
): Promise<unknown> {
  const requested = options.timeoutMs ?? PLAN_RECOVERY_TIMEOUT_MS;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new DeepSeekClientError("CONFIGURATION_ERROR", "Recovery timeout must be a positive integer.");
  }
  const timeoutMs = Math.min(requested, PLAN_RECOVERY_TIMEOUT_MS);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    return await new Promise<unknown>((resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new DeepSeekClientError("ABORTED", "Task-plan extraction was aborted or timed out."));
      };
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, timeoutMs);
      // Both rejection paths stay attached after this wrapper has settled.
      Promise.resolve().then(() => extraction([
        { role: "system", content: ARM_B_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: buildPlanExtractionUserContent(messages) },
      ], { ...options, signal: controller.signal, timeoutMs })).then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

function defaultPlanExtraction(
  messages: readonly DeepSeekMessage[],
  options: DeepSeekClientOptions,
): Promise<unknown> {
  return callDeepSeekJson(messages, options);
}

// ---------------------------------------------------------------- coordination

/** Read-only segment observation plus its already completed handler result. */
export type SegmentDispatchResult<Result = undefined> = {
  bindingKind: "NONE" | "MATCHED" | "NO_MATCH" | "AMBIGUOUS";
  pendingConfirmation: boolean;
  answerOrigin: NavigatorAnswerOrigin | null;
  message: string | null;
  value: Result;
};

export type SegmentDispatcher<Result = undefined> = (
  segment: Extract<RecoverySegment, { kind: "ACT" }>,
  segmentIndex: number,
) => Promise<SegmentDispatchResult<Result>>;

export const INTENT_PLAN_RECOVERY_DISPOSITIONS = [
  "RECOVERED_SINGLE_ACT", "RECOVERED_COMPOSED", "PLAN_REJECTED",
  "EXTRACTION_FAILED", "BINDING_CONFLICT", "PAYMENT_COMPOSITION_VETO",
] as const;
export type IntentPlanRecoveryDisposition = (typeof INTENT_PLAN_RECOVERY_DISPOSITIONS)[number];

type AcceptedRecoveryPlan = {
  segments: RecoverySegment[];
  activeTasks: TaskPlanTask[];
  activeTaskTypes: TaskPlanType[];
};
export type IntentPlanRecoveryOutcome<Result = undefined> =
  | (AcceptedRecoveryPlan & {
      disposition: "RECOVERED_SINGLE_ACT" | "RECOVERED_COMPOSED";
      act: ConversationActDecision | null;
      primaryAct: ConversationActDecision | null;
      primarySegmentIndex: number | null;
      commitPrimary: boolean;
      dispatchResults: (SegmentDispatchResult<Result> | null)[];
    })
  | (AcceptedRecoveryPlan & {
      disposition: "BINDING_CONFLICT" | "PAYMENT_COMPOSITION_VETO";
      reasonCode: string;
    })
  | { disposition: "PLAN_REJECTED"; problems: string[] }
  | { disposition: "EXTRACTION_FAILED"; reasonCode: string };

/**
 * One validated plan, an exact task partition and one execution per ACT.
 * Primary means state owner. Read-only secondaries run first; the primary
 * runs once, last. A failed primary never discards completed secondary work.
 */
export async function attemptIntentPlanRecovery<Result = undefined>(input: {
  messages: readonly ConversationMessage[];
  extractionOptions: DeepSeekClientOptions;
  extraction?: PlanExtractionDependency;
  dispatchSegment: SegmentDispatcher<Result>;
  preflight?: (segments: readonly RecoverySegment[], tasks: readonly TaskPlanTask[]) => string | null;
}): Promise<IntentPlanRecoveryOutcome<Result>> {
  let plan: unknown;
  try {
    plan = await extractTaskPlan(input.messages, input.extractionOptions, input.extraction);
  } catch (error) {
    return { disposition: "EXTRACTION_FAILED", reasonCode: extractionFailureCode(error) };
  }
  const verdict = validateTaskPlan(plan, input.messages);
  if (!verdict.ok) return { disposition: "PLAN_REJECTED", problems: verdict.problems };
  const segments = mapPlanToRecoverySegments(verdict.active, input.messages);
  const accepted = {
    segments, activeTasks: verdict.active,
    activeTaskTypes: verdict.active.map((task) => task.type),
  };
  const veto = input.preflight?.(segments, verdict.active) ?? null;
  if (veto !== null) {
    return { ...accepted, disposition: "PAYMENT_COMPOSITION_VETO", reasonCode: veto };
  }
  const actIndices = segments.flatMap((segment, index) => segment.kind === "ACT" ? [index] : []);
  const comparisonIndex = actIndices.find((index) => isComparisonSegment(segments[index]));
  const primaryIndex = comparisonIndex ?? actIndices[0] ?? null;
  const order = actIndices.filter((index) => index !== primaryIndex);
  if (primaryIndex !== null) order.push(primaryIndex);
  const results: (SegmentDispatchResult<Result> | null)[] = segments.map(() => null);
  for (const index of order) {
    if (input.extractionOptions.signal?.aborted) break;
    const segment = segments[index];
    if (segment.kind !== "ACT") continue;
    try {
      const result = await input.dispatchSegment(segment, index);
      results[index] = typeof result.message === "string" && result.message.trim().length > 0
        ? result : null;
    } catch {
      // The task remains present and receives an explicit failure outcome.
      results[index] = null;
    }
  }
  if (verdict.active.length > 1) {
    for (const index of actIndices) {
      const result = results[index];
      if (result === null) continue;
      const readOnlyComparison = index !== primaryIndex &&
        isComparisonSegment(segments[index]) && result.bindingKind === "AMBIGUOUS";
      if (result.pendingConfirmation ||
          (index !== primaryIndex && result.bindingKind !== "NONE" && !readOnlyComparison)) {
        return { ...accepted, disposition: "BINDING_CONFLICT", reasonCode: "UNSAFE_SECONDARY_STATE" };
      }
    }
  }
  const primary = primaryIndex === null ? null : segments[primaryIndex];
  return {
    ...accepted,
    disposition: verdict.active.length === 1 && primary?.kind === "ACT"
      ? "RECOVERED_SINGLE_ACT" : "RECOVERED_COMPOSED",
    act: primary?.kind === "ACT" ? primary.act : null,
    primaryAct: primary?.kind === "ACT" ? primary.act : null,
    primarySegmentIndex: primaryIndex,
    commitPrimary: input.extractionOptions.signal?.aborted !== true,
    dispatchResults: results,
  };
}

function isComparisonSegment(segment: RecoverySegment): boolean {
  return segment.kind === "ACT" && segment.act.state === "FACTUAL" &&
    segment.act.intents.some((intent) => intent.kind === "COURSE_COMPARISON");
}

function extractionFailureCode(error: unknown): string {
  if (error instanceof DeepSeekClientError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "ABORTED";
  return "EXTRACTION_ERROR";
}

// ---------------------------------------------------------------- bounded logging

const CLOSED_ACT_STATES = [
  "NAVIGATE",
  "META",
  "OUT_OF_SCOPE",
  "FACTUAL",
  "COURSE_FOLLOW_UP",
  "COURSE_CONTENT",
  "ROUTER_DEGRADED",
  "COURSE_REFERENCE_UNRESOLVED",
] as const;

const safeCode = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value)
    ? value
    : null;

export type IntentPlanRecoveryLog = {
  event: "NAVIGATOR_INTENT_PLAN_RECOVERY";
  requestId: string;
  originalAct: "COURSE_CONTENT";
  disposition: IntentPlanRecoveryDisposition;
  reasonCode: string | null;
  activeTaskCount: number | null;
  limitationCount: number | null;
  segmentActStates: string[];
  courseIds: string[];
  extractionCalls: 0 | 1;
};

/**
 * Bounded recovery event. Only request id, the fixed original act, closed
 * dispositions/reason codes, counts, closed act states and authorized catalog
 * course identifiers are emitted — never student text, evidence spans,
 * provider payloads or environment values.
 */
export function createIntentPlanRecoveryLog(
  requestId: string,
  details: {
    disposition: IntentPlanRecoveryDisposition;
    reasonCode?: string | null;
    problems?: readonly string[];
    activeTaskCount?: number | null;
    limitationCount?: number | null;
    segments?: readonly RecoverySegment[];
    courseIds?: readonly (string | null)[];
    extractionCalls?: boolean;
  },
): IntentPlanRecoveryLog {
  const segmentActStates = (details.segments ?? [])
    .filter((segment) => segment.kind === "ACT")
    .map((segment) =>
      CLOSED_ACT_STATES.includes(
        (segment.act as { state: string }).state as (typeof CLOSED_ACT_STATES)[number],
      )
        ? (segment.act as { state: string }).state
        : "UNKNOWN",
    );
  const courseIds = [
    ...new Set(
      (details.segments ?? [])
        .filter((segment) => segment.kind === "ACT")
        .flatMap((segment) =>
          segment.act.state === "COURSE_FOLLOW_UP" ||
          segment.act.state === "COURSE_CONTENT"
            ? [segment.act.courseId]
            : segment.act.state === "FACTUAL"
              ? segment.act.intents.flatMap((intent) =>
                  intent.kind === "COURSE_COMPARISON" ||
                  intent.kind === "CURRENT_METADATA"
                    ? intent.courseIds
                    : [],
                )
              : [],
        )
        .filter((id) => typeof id === "string"),
    ),
  ];
  const reasonCode =
    details.reasonCode !== undefined && details.reasonCode !== null
      ? safeCode(details.reasonCode)
      : details.problems !== undefined
        ? safeCode((details.problems[0] ?? "").split(":")[0])
        : null;

  return {
    event: "NAVIGATOR_INTENT_PLAN_RECOVERY",
    requestId: safeRequestId(requestId),
    originalAct: "COURSE_CONTENT",
    disposition: details.disposition,
    reasonCode,
    activeTaskCount:
      typeof details.activeTaskCount === "number" &&
      Number.isInteger(details.activeTaskCount) &&
      details.activeTaskCount >= 0
        ? details.activeTaskCount
        : null,
    limitationCount:
      typeof details.limitationCount === "number" &&
      Number.isInteger(details.limitationCount) &&
      details.limitationCount >= 0
        ? details.limitationCount
        : null,
    segmentActStates,
    courseIds,
    extractionCalls: details.extractionCalls === true ? 1 : 0,
  };
}

function safeRequestId(requestId: string): string {
  return typeof requestId === "string" && requestId.length > 0
    ? requestId.slice(0, 80)
    : "UNKNOWN";
}
