import type {
  AcademyContactCard,
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import {
  resolveCourseEvidence,
  type ResolvedCourseEvidence,
} from "../knowledge/retrieval/authority-resolver.ts";
import {
  retrieveCourseKnowledge,
  type RetrieveCourseKnowledgeResult,
} from "../knowledge/retrieval/retrieve-course-knowledge.ts";
import {
  selectCourseEvidence,
  type CourseEvidenceSelection,
  type SelectCourseEvidenceOptions,
} from "../knowledge/retrieval/evidence-selector.ts";
import {
  composeNavigatorAnswer,
  type ComposeNavigatorAnswerOptions,
} from "./answer-composer.ts";
import {
  routeEducationalNavigation,
  type RouteEducationalNavigationOptions,
} from "./router.ts";
import type { NavigationDecision } from "./navigation-decision.ts";
import type { RetrieveCourseKnowledgeOptions } from "../knowledge/retrieval/retrieve-course-knowledge.ts";
import {
  routeConversationAct,
  ConversationActDecisionValidationError,
  type ConversationActDecision,
  type RouteConversationActOptions,
} from "./conversation-act-router.ts";
import {
  ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
  getAcademyCourse,
} from "../academy/course-catalog.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
  type AuthorityAvailability,
} from "../academy/commercial-authority.ts";
import {
  composeCatalogListAnswer,
  composeCourseFollowUpAnswer,
  composeClarificationExhaustionAnswer,
  composeNavigatorMetaAnswer,
  composeNavigatorOutOfScopeAnswer,
  composeFactualAnswer,
  composePaymentAmbiguityAnswer,
  composePaymentCourseChangeConfirmationAnswer,
  composePaymentCourseIdentityRequiredAnswer,
  composePaymentUnavailableAnswer,
  composeStableNoMatchAnswer,
  composeTechnicalErrorAnswer,
  composeContentReferenceClarification,
  composeFollowUpReferenceClarification,
  composeReferenceClarificationExhausted,
  isCourseReferenceClarificationText,
  type CourseFollowUpOutcome,
  type ComposeCourseFollowUpOptions,
} from "./conversation-response.ts";
import {
  CLARIFICATION_BUDGET,
  clarificationIssueKey,
} from "./conversation-state.ts";
import {
  composeAcademyContactAnswer,
  composeCourseFactualCeilingAnswer,
  detectAcademyContactIntent,
  detectDeterministicAcademyContactIntent,
} from "../academy/contact-policy.ts";
import {
  composeEnrollmentPaymentAnswer,
  hasEnrollmentPaymentIntent,
  paymentMultipleIssueKey,
  resolveEnrollmentPaymentDecision,
} from "../academy/payment-policy.ts";
import {
  resolveCourseReferences,
  type AcademyCourseId,
} from "../academy/course-reference.ts";
import type {
  ConversationState,
  OrchestratedDecision,
  PendingConfirmation,
} from "./conversation-state.ts";
import {
  NavigatorStageError,
  createNavigatorDegradationLog,
  createNavigatorGroundingLog,
  createNavigatorRouterDegradationLog,
  isRecoverableConversationActFailure,
  isRecoverableEvidenceSelectionFailure,
  type NavigatorAnswerOrigin,
  type NavigatorCourseReferenceStrategy,
  type NavigatorGroundingDetails,
  type NavigatorTurnDetails,
  withNavigatorStage,
} from "./navigator-observability.ts";
import { formulateFollowUpContentQuery } from "./follow-up-query.ts";
import {
  callDeepSeekJson,
  type DeepSeekClientOptions,
  type DeepSeekMessage,
} from "./deepseek-client.ts";
import {
  attemptIntentPlanRecovery,
  createIntentPlanRecoveryLog,
  isF1CourseContentRejection,
  type PlanExtractionDependency,
  type SegmentDispatchResult,
  type IntentPlanRecoveryOutcome,
} from "./intent-plan-recovery.ts";
import {
  accountTaskOutcomes,
  createTaskCoverageLog,
  assembleTaskResponse,
  outcomeForTask,
  type TaskOutcome,
  type TaskCoverageRecord,
  type ResponsePiece,
  type SharedResponseBlock,
} from "./response-coverage.ts";
import {
  TASK_PLAN_ROLES,
  undispatchedLineText,
  type RecoverySegment,
  type TaskPlanMention,
  type TaskPlanTask,
  type TaskPlanType,
} from "./task-plan.ts";

/**
 * Internal completion disposition. The API boundary consumes this value.
 * Task coverage, a public sentence, and the technical-error act label do not
 * grant completion on their own.
 */
export const TURN_COMPLETIONS = [
  "ANSWERED",
  "PARTIAL_WITH_EXPLICIT_LIMITATIONS",
  "USER_ACTION_REQUIRED",
  "RETRYABLE_TECHNICAL_FAILURE",
  "TERMINAL_TECHNICAL_FAILURE",
] as const;
export type TurnCompletion = (typeof TURN_COMPLETIONS)[number];

export type NavigatorOrchestrationResult = {
  message: string;
  contactCard: AcademyContactCard | null;
  conversationAct: ConversationActDecision;
  decision: NavigationDecision | null;
  courseEvidenceCount: number;
  courseHadActiveSources: boolean;
  evidenceSelectionStatus: CourseEvidenceSelection["status"] | "NOT_RUN";
  observability?: NavigatorTurnDetails;
  clarification: OrchestrationClarificationOutcome;
  stateEffects: OrchestrationStateEffects;
  /** Internal recovery evidence; the API response schema is unchanged. */
  taskCoverage?: TaskCoverageRecord;
  taskResponseBlocks?: SharedResponseBlock[];
  /**
   * Producer disposition. Optional only so pre-existing test doubles keep
   * compiling; every result this module builds sets it.
   */
  completion?: TurnCompletion;
};

export type OrchestrationStateEffects = {
  catalogAuthorityVersion: string | null;
  transactionalAuthorityVersion: string | null;
  pendingConfirmation: PendingConfirmation | null;
  /**
   * P03 — the explicit validated course-binding state effect (MATCHED
   * resolution or AMBIGUOUS candidate set) consumed by the API layer before
   * the ordinary navigation-decision mapping.
   */
  courseBinding?: OrchestratedDecision;
};

/**
 * Package-A clarification budget outcome (A14). The counter is scoped to the
 * unresolved issue; EXHAUSTED is the structured result later packages consume.
 */
export type OrchestrationClarificationOutcome = {
  status: "NOT_APPLICABLE" | "ASKED" | "EXHAUSTED";
  issueKey: string | null;
  attempts: number;
  question: string | null;
};

export type ClarificationControlInput = {
  priorIssueKey: string | null;
  priorAttempts: number;
};

type ConversationActDependency = (
  messages: readonly ConversationMessage[],
  options: RouteConversationActOptions,
) => Promise<ConversationActDecision>;

type RouteDependency = (
  messages: readonly ConversationMessage[],
  options: RouteEducationalNavigationOptions,
) => Promise<NavigationDecision>;

type RetrieveDependency = (
  courseId: string,
  query: string,
  options: RetrieveCourseKnowledgeOptions,
) => ReturnType<typeof retrieveCourseKnowledge>;

type ResolveDependency = typeof resolveCourseEvidence;

type SelectEvidenceDependency = (
  learningNeed: string,
  evidence: readonly ResolvedCourseEvidence[],
  options: SelectCourseEvidenceOptions,
) => Promise<CourseEvidenceSelection>;

type ComposeDependency = (
  messages: readonly ConversationMessage[],
  decision: NavigationDecision,
  options: ComposeNavigatorAnswerOptions,
) => Promise<string>;

type ComposeFollowUpDependency = (
  messages: readonly ConversationMessage[],
  act: Extract<
    ConversationActDecision,
    { state: "COURSE_FOLLOW_UP" }
  >,
  options: ComposeCourseFollowUpOptions,
) => Promise<string>;

export type OrchestrationDependencies = {
  classifyAct?: ConversationActDependency;
  route?: RouteDependency;
  retrieve?: RetrieveDependency;
  resolve?: ResolveDependency;
  selectEvidence?: SelectEvidenceDependency;
  compose?: ComposeDependency;
  composeFollowUp?: ComposeFollowUpDependency;
  /**
   * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — the single F-1-gated
   * task-plan extraction request. Defaults to the frozen ARM-B prompt through
   * the unchanged DeepSeek client; tests inject canned plans.
   */
  extractPlan?: PlanExtractionDependency;
};

export type OrchestrateNavigatorOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  requestId?: string;
  profile?: ConversationProfile;
  /** Prior unresolved-clarification record, for the A14 budget. */
  clarification?: ClarificationControlInput;
  /**
   * The structured state this turn's orchestration may read. A10 contact
   * precedence is decided from it, so the queued remainder, an open
   * confirmation and the recorded last-assistant act are visible here; all
   * three are written by the kernel that already decided this turn routes.
   */
  conversationState?: Pick<
    ConversationState,
    | "courseMatch"
    | "selectedCourseId"
    | "staleReference"
    | "catalogAuthorityVersion"
    | "transactionalAuthorityVersion"
    | "deferredRequest"
    | "pendingConfirmation"
    | "lastAssistant"
    | "courseReferents"
    // P03 (CORR1 F04/F05) — the stored clarification record, so the bare-
    // candidate continuation and the preserved-remainder reduction are gated
    // on the recorded payment-multiple issue identity itself.
    | "clarification"
  >;
  dependencies?: OrchestrationDependencies;
};

function lastUserMessage(
  messages: readonly ConversationMessage[],
): string {
  const message = messages.at(-1);
  if (!message || message.role !== "user") {
    throw new Error("Conversation must end with a user message.");
  }
  return message.content;
}

async function selectEvidenceOrDegrade(
  query: string,
  resolvedEvidence: readonly ResolvedCourseEvidence[],
  selectEvidence: SelectEvidenceDependency,
  options: OrchestrateNavigatorOptions,
): Promise<{ selection: CourseEvidenceSelection; degraded: boolean }> {
  try {
    const selection = await withNavigatorStage("EVIDENCE_LLM", () =>
      selectEvidence(
        query,
        resolvedEvidence,
        {
          env: options.env,
          fetch: options.fetch,
          signal: options.signal,
        },
      ),
    );
    return { selection, degraded: false };
  } catch (error) {
    if (!isRecoverableEvidenceSelectionFailure(error)) {
      throw error;
    }

    if (options.requestId) {
      console.warn(
        JSON.stringify(
          createNavigatorDegradationLog(error, options.requestId),
        ),
      );
    }

    return {
      selection: {
        status: "INSUFFICIENT",
        evidence: [],
      },
      degraded: true,
    };
  }
}

const METADATA_TASK_TYPES = new Set<TaskPlanType>([
  "PRICE",
  "SCHEDULE",
  "COHORT",
  "ENROLLMENT_WINDOW",
]);

const GUARDED_METADATA_FIELDS = ["SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"] as const;
type GuardedMetadataField = (typeof GUARDED_METADATA_FIELDS)[number];

/**
 * The current metadata composer always narrates schedule, cohort and
 * enrollment window as unavailable. A future supported snapshot must not be
 * described by that unchanged text. Price reads its own authority value and
 * is not guarded here.
 */
export function currentMetadataComposerAdmitsField(
  field: GuardedMetadataField,
  availability: AuthorityAvailability,
): boolean {
  if (!GUARDED_METADATA_FIELDS.includes(field)) return false;
  return (
    availability.status === "UNAVAILABLE" &&
    availability.reason === "NO_AUTHORITATIVE_VALUE"
  );
}

function liveGuardedMetadataAvailability(
  field: GuardedMetadataField,
): AuthorityAvailability {
  const metadata = ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata;
  if (field === "SCHEDULE") return metadata.schedule;
  if (field === "COHORT") return metadata.cohort;
  return metadata.enrollmentWindow;
}

function isMetadataTaskType(type: TaskPlanType): boolean {
  return METADATA_TASK_TYPES.has(type);
}

function readValidatedPlanSnapshot(
  plan: unknown,
): { tasks: TaskPlanTask[]; mentions: TaskPlanMention[] } | null {
  if (typeof plan !== "object" || plan === null) return null;
  const record = plan as { tasks?: unknown; mentions?: unknown };
  if (!Array.isArray(record.tasks)) return null;
  if (record.mentions !== undefined && !Array.isArray(record.mentions)) return null;
  const tasks: TaskPlanTask[] = [];
  for (const value of record.tasks) {
    if (typeof value !== "object" || value === null) return null;
    const task = value as TaskPlanTask;
    if (
      typeof task.type !== "string" ||
      typeof task.role !== "string" ||
      !TASK_PLAN_ROLES.includes(task.role) ||
      typeof task.evidence !== "string" ||
      !Array.isArray(task.courseIds) ||
      task.courseIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }
    tasks.push(task);
  }
  const mentions: TaskPlanMention[] = [];
  for (const value of record.mentions ?? []) {
    if (typeof value !== "object" || value === null) return null;
    const mention = value as TaskPlanMention;
    if (
      (mention.courseId !== null && typeof mention.courseId !== "string") ||
      typeof mention.surface !== "string" ||
      typeof mention.role !== "string" ||
      !TASK_PLAN_ROLES.includes(mention.role)
    ) {
      return null;
    }
    mentions.push(mention);
  }
  return { tasks, mentions };
}

type SourceInterval = { readonly start: number; readonly end: number };

type MentionLedgerClass =
  | "CORROBORATED_LOCAL_ACTIVE"
  | "EVALUATED_CONSTRAINT"
  | "PROVEN_SEPARATED"
  | "UNRESOLVED_OR_CONFLICT";

type MentionLedgerEntry = {
  readonly courseId: string | null;
  readonly surface: string;
  readonly role: string;
  readonly intervals: readonly SourceInterval[];
  readonly locallyApplicable: boolean;
};

/**
 * Every exact UTF-16 occurrence, including repeats and self-overlaps.
 * An empty surface has no occurrence identity. No length cutoff, trim,
 * case fold, quote strip or normalization is applied.
 */
function sourceIntervals(source: string, surface: string): SourceInterval[] {
  const found: SourceInterval[] = [];
  if (surface.length === 0) return found;
  let from = 0;
  while (from <= source.length) {
    const start = source.indexOf(surface, from);
    if (start < 0) break;
    found.push({ start, end: start + surface.length });
    from = start + 1;
  }
  return found;
}

function intervalsOverlap(left: SourceInterval, right: SourceInterval): boolean {
  return left.start < right.end && right.start < left.end;
}

function anyIntervalsOverlap(
  left: readonly SourceInterval[],
  right: readonly SourceInterval[],
): boolean {
  for (const first of left) {
    for (const second of right) {
      if (intervalsOverlap(first, second)) return true;
    }
  }
  return false;
}

function referencedCourseIds(text: string): ReadonlySet<string> {
  const resolved = resolveCourseReferences(text);
  return new Set(resolved.kind === "ZERO" ? [] : resolved.courseIds);
}

function corroboratesOnly(surface: string, courseId: string): boolean {
  const resolved = resolveCourseReferences(surface);
  return resolved.kind === "ONE" && resolved.courseIds[0] === courseId;
}

function sameCourseSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  if (seen.size !== left.length) return false;
  return right.every((id) => seen.has(id));
}

function markConflict(classes: MentionLedgerClass[], index: number): void {
  classes[index] = "UNRESOLVED_OR_CONFLICT";
}

/**
 * Option C non-F-1 authorization for one ACTIVE metadata task.
 * Every admitted mention receives one ledger class. A missing witness,
 * unresolved source claim, or any possible conflicting pairing refuses
 * the task. No public response field is added.
 */
function metadataTaskCourseIdsAreGrounded(
  task: TaskPlanTask,
  mentions: readonly TaskPlanMention[],
  allTasks: readonly TaskPlanTask[],
  latest: string,
): boolean {
  if (!isMetadataTaskType(task.type) || task.role !== "ACTIVE") return false;
  const evidence = task.evidence;
  const evidenceIntervals = sourceIntervals(latest, evidence);
  const proposed = [...task.courseIds];
  const evidenceCourses = referencedCourseIds(evidence);
  const entries: MentionLedgerEntry[] = [];
  const classes: MentionLedgerClass[] = [];
  let refused =
    evidenceIntervals.length === 0 ||
    proposed.length === 0 ||
    new Set(proposed).size !== proposed.length;

  for (const courseId of proposed) {
    if (getAcademyCourse(courseId) === null || !evidenceCourses.has(courseId)) {
      refused = true;
    }
  }

  for (const mention of mentions) {
    const intervals = sourceIntervals(latest, mention.surface);
    const unlocated = mention.surface.length === 0 || intervals.length === 0;
    const locallyApplicable =
      !unlocated && anyIntervalsOverlap(intervals, evidenceIntervals);
    entries.push({
      courseId: mention.courseId,
      surface: mention.surface,
      role: mention.role,
      intervals,
      locallyApplicable,
    });
    if (unlocated || evidenceIntervals.length === 0) {
      classes.push("UNRESOLVED_OR_CONFLICT");
      refused = true;
      continue;
    }
    if (!locallyApplicable) {
      classes.push("PROVEN_SEPARATED");
      continue;
    }
    classes.push(
      mention.role === "ACTIVE" ? "UNRESOLVED_OR_CONFLICT" : "EVALUATED_CONSTRAINT",
    );
  }

  const corroborated = new Set<number>();
  for (const [index, entry] of entries.entries()) {
    if (!entry.locallyApplicable || entry.role !== "ACTIVE") continue;
    const courseId = entry.courseId;
    const supported =
      typeof courseId === "string" &&
      proposed.includes(courseId) &&
      sourceIntervals(evidence, entry.surface).length > 0 &&
      corroboratesOnly(entry.surface, courseId);
    if (!supported) {
      markConflict(classes, index);
      refused = true;
      continue;
    }
    corroborated.add(index);
    classes[index] = "CORROBORATED_LOCAL_ACTIVE";
  }

  let fallbackCourseId: string | null = null;
  const support = new Map<string, readonly SourceInterval[]>();
  if (proposed.length === 1 && evidenceIntervals.length > 0) {
    const courseId = proposed[0];
    const localClaims = entries.some(
      (entry) => entry.courseId === courseId && entry.locallyApplicable,
    );
    if (!localClaims) {
      const onlyThisCourse =
        evidenceCourses.size === 1 && evidenceCourses.has(courseId);
      const extraLocalActive = entries.some(
        (entry) =>
          entry.locallyApplicable &&
          entry.role === "ACTIVE" &&
          entry.courseId !== courseId,
      );
      if (onlyThisCourse && !extraLocalActive && getAcademyCourse(courseId) !== null) {
        fallbackCourseId = courseId;
        support.set(courseId, evidenceIntervals);
      }
    }
  }

  for (const courseId of proposed) {
    if (fallbackCourseId === courseId) continue;
    const witnessIntervals: SourceInterval[] = [];
    let witnessed = false;
    for (const [index, entry] of entries.entries()) {
      if (
        entry.courseId !== courseId ||
        !entry.locallyApplicable ||
        entry.role !== "ACTIVE" ||
        !corroborated.has(index)
      ) {
        continue;
      }
      witnessed = true;
      witnessIntervals.push(...entry.intervals);
    }
    if (!witnessed) {
      refused = true;
      continue;
    }
    support.set(courseId, witnessIntervals);
  }

  for (const courseId of proposed) {
    const activeIntervals: SourceInterval[] = [];
    if (fallbackCourseId === courseId) activeIntervals.push(...evidenceIntervals);
    for (const entry of entries) {
      if (entry.courseId === courseId && entry.role === "ACTIVE") {
        activeIntervals.push(...entry.intervals);
      }
    }
    for (const [index, entry] of entries.entries()) {
      if (entry.courseId !== courseId || entry.role === "ACTIVE") continue;
      if (!anyIntervalsOverlap(entry.intervals, activeIntervals)) continue;
      markConflict(classes, index);
      refused = true;
      for (const [activeIndex, active] of entries.entries()) {
        if (
          active.courseId === courseId &&
          active.role === "ACTIVE" &&
          anyIntervalsOverlap(active.intervals, entry.intervals)
        ) {
          markConflict(classes, activeIndex);
        }
      }
    }
  }

  for (const courseId of proposed) {
    const bound = support.get(courseId) ?? [];
    for (const [index, entry] of entries.entries()) {
      if (entry.courseId === courseId) continue;
      const collides = anyIntervalsOverlap(entry.intervals, bound);
      const exposesDifferentIdentity =
        entry.locallyApplicable && referencedCourseIds(entry.surface).has(courseId);
      if (!collides && !exposesDifferentIdentity) continue;
      markConflict(classes, index);
      refused = true;
    }
  }

  for (const extra of evidenceCourses) {
    if (proposed.includes(extra)) continue;
    const bound = proposed.flatMap((courseId) => [...(support.get(courseId) ?? [])]);
    let explained = false;
    for (const [index, entry] of entries.entries()) {
      if (entry.courseId === extra && entry.role === "ACTIVE" && entry.locallyApplicable) {
        markConflict(classes, index);
        refused = true;
      }
      if (
        entry.courseId === extra &&
        entry.role !== "ACTIVE" &&
        sourceIntervals(evidence, entry.surface).length > 0 &&
        corroboratesOnly(entry.surface, extra) &&
        !anyIntervalsOverlap(entry.intervals, bound)
      ) {
        explained = true;
      }
    }
    if (!explained) refused = true;
  }

  for (const other of allTasks) {
    if (other.role === "ACTIVE") continue;
    const named = proposed.filter((courseId) => other.courseIds.includes(courseId));
    if (named.length === 0) continue;
    const embeddings = sourceIntervals(latest, other.evidence);
    // A task that names a proposed course but cannot be located has no
    // separation proof. Unrelated non-ACTIVE tasks stay unexecuted.
    if (embeddings.length === 0) {
      refused = true;
      continue;
    }
    for (const courseId of named) {
      if (anyIntervalsOverlap(embeddings, support.get(courseId) ?? [])) {
        refused = true;
      }
    }
  }

  return (
    classes.length === mentions.length &&
    classes.every((item) => item !== "UNRESOLVED_OR_CONFLICT") &&
    !refused
  );
}

function nonF1MetadataSegmentIsGrounded(
  segment: Extract<RecoverySegment, { kind: "ACT" }>,
  plan: unknown,
  latest: string,
): boolean {
  if (segment.act.state !== "FACTUAL") return true;
  const metadata = segment.act.intents.find((intent) => intent.kind === "CURRENT_METADATA");
  if (metadata === undefined || metadata.kind !== "CURRENT_METADATA") return true;

  let fieldsAdmitted = true;
  for (const field of metadata.fields) {
    if (field === "PRICE") continue;
    if (
      !GUARDED_METADATA_FIELDS.includes(field as GuardedMetadataField) ||
      !currentMetadataComposerAdmitsField(
        field as GuardedMetadataField,
        liveGuardedMetadataAvailability(field as GuardedMetadataField),
      )
    ) {
      fieldsAdmitted = false;
    }
  }
  if (metadata.scope !== "REFERENCED") return false;

  const snapshot = readValidatedPlanSnapshot(plan);
  if (snapshot === null) return false;
  const active = snapshot.tasks.filter((task) => task.role === "ACTIVE");
  let tasksAuthorized = true;
  for (const taskIndex of segment.taskIndices) {
    const task = active[taskIndex];
    if (task === undefined || !isMetadataTaskType(task.type)) {
      tasksAuthorized = false;
      continue;
    }
    if (!sameCourseSet(task.courseIds, metadata.courseIds)) {
      tasksAuthorized = false;
      continue;
    }
    if (
      !metadataTaskCourseIdsAreGrounded(
        task,
        snapshot.mentions,
        snapshot.tasks,
        latest,
      )
    ) {
      tasksAuthorized = false;
    }
  }
  return fieldsAdmitted && tasksAuthorized;
}

function hasSubstantiveRemainder(value: string): boolean {
  for (const character of value) {
    if (/[\p{L}\p{N}]/u.test(character)) return true;
  }
  return false;
}

/**
 * Latest-user text outside accepted task evidence. A mention surface may
 * inform course role checks, but it has no disclosure authority. Substring
 * removal of accepted evidence does not invent a second task.
 */
function uncoveredLatestRemainder(
  latest: string,
  spans: readonly string[],
): string | null {
  const unique = [...new Set(spans.filter((span) => span.length >= 3))].sort(
    (left, right) => right.length - left.length,
  );
  let cursor = latest;
  for (const span of unique) cursor = cursor.split(span).join(" ");
  const compact = cursor.replace(/\s+/gu, " ").trim();
  if (!hasSubstantiveRemainder(compact) || compact.length < 3) return null;
  return compact.length > 240 ? compact.slice(0, 240) : compact;
}

/**
 * Educational-router validation rejection. The invalid decision is discarded
 * entirely: no course id, quote or schema field from it is read. Transport,
 * authentication and every other exception stay on the technical-error lane.
 */
function isRecoverableEducationalRouterFailure(
  error: unknown,
): error is NavigatorStageError {
  return (
    error instanceof NavigatorStageError &&
    error.stage === "ROUTER" &&
    error.errorName === "NavigationDecisionValidationError" &&
    error.errorCode === "INVALID_NAVIGATION_DECISION" &&
    error.status === null
  );
}

function composeEducationalRouterContinuation(
  profile: ConversationProfile | undefined,
): string {
  const lead =
    profile?.addressMode === "TY"
      ? "Чтобы сориентироваться в курсах Академии, ниже текущий каталог. Подбор конкретного курса я продолжу, когда ты уточнишь задачу."
      : "Чтобы сориентироваться в курсах Академии, ниже текущий каталог. Подбор конкретного курса я продолжу, когда вы уточните задачу.";
  const follow =
    profile?.addressMode === "TY"
      ? "Напиши, пожалуйста, с чем хочешь разобраться."
      : "Напишите, пожалуйста, с чем хотите разобраться.";
  return `${lead}\n\n${composeCatalogListAnswer()}\n\n${follow}`;
}

/**
 * EXPERIMENT-1.ROUTER-ACCESS-1 — the act router's degrade lane.
 *
 * Structurally identical to selectEvidenceOrDegrade one layer down: when the
 * provider's structured output fails the validator, the turn continues on a
 * bounded, non-semantic lane instead of becoming a user-visible 503. What the
 * degrade must NOT do is pick a course: a rejected act decision carries no
 * trust, so ROUTER_DEGRADED binds no course, resolves no evidence and invokes
 * no retrieval. Only the validator-rejection class degrades; every transport,
 * timeout and provider failure still reaches the technical-error lane.
 *
 * A recoverable validation rejection may spend one existing task-plan
 * extraction. The F-1 rejection keeps its accepted path. Every other
 * recoverable rejection uses that same extraction once, then the non-F-1
 * course gates. There is no lexical enrollment classifier and no second
 * repair call.
 */
/**
 * Invocation-local recovery controller. The attempted flag bounds extraction;
 * completedResult hands the existing result back without re-execution. Nested
 * segment dispatch passes null and cannot recover again.
 */
type PlanRecoveryContext = {
  attempted: boolean;
  completedResult: NavigatorOrchestrationResult | null;
  coverage: TaskCoverageRecord | null;
};

async function classifyActOrDegrade(
  messages: readonly ConversationMessage[],
  classifyAct: ConversationActDependency,
  options: OrchestrateNavigatorOptions,
  recovery: PlanRecoveryContext | null,
): Promise<ConversationActDecision> {
  // The typed rejection must be captured locally before the stage wrapper
  // folds it into a NavigatorStageError: recovery eligibility requires the
  // genuine exported validation-error class and the precise F-1 failure.
  let rawRejection: ConversationActDecisionValidationError | null = null;
  try {
    return await withNavigatorStage("ACT_ROUTER", async () => {
      try {
        return await classifyAct(messages, {
          env: options.env,
          fetch: options.fetch,
          signal: options.signal,
        });
      } catch (error) {
        if (error instanceof ConversationActDecisionValidationError) {
          rawRejection = error;
        }
        throw error;
      }
    });
  } catch (error) {
    if (!isRecoverableConversationActFailure(error)) {
      throw error;
    }

    // One task-plan extraction for a recoverable act rejection. Successful
    // classifications never reach this catch. Nested segment dispatch passes
    // a null recovery controller and cannot extract again.
    if (
      recovery !== null &&
      !recovery.attempted &&
      rawRejection !== null &&
      options.signal?.aborted !== true
    ) {
      recovery.attempted = true;
      const recovered = await attemptPlanRecoveryOrUndefined(
        messages,
        options,
        recovery,
        isF1CourseContentRejection(rawRejection) ? "F1" : "NON_F1",
      );
      if (recovered !== null) {
        return recovered;
      }
    }

    if (options.requestId) {
      console.warn(
        JSON.stringify(
          createNavigatorRouterDegradationLog(error, options.requestId),
        ),
      );
    }

    return { state: "ROUTER_DEGRADED" };
  }
}

/**
 * The production sink for the bounded hybrid grounding guardrail. The log
 * builder re-derives every field through a whitelist, so no candidate answer,
 * evidence quote, authority payload or user message can reach a log line.
 */
function groundingEventSink(
  options: OrchestrateNavigatorOptions,
): ((details: NavigatorGroundingDetails) => void) | undefined {
  const requestId = options.requestId;
  if (!requestId) return undefined;

  return (details) => {
    console.info(
      JSON.stringify(createNavigatorGroundingLog(requestId, details)),
    );
  };
}

function deriveTurnCompletion(input: {
  conversationAct: ConversationActDecision;
  clarification: OrchestrationClarificationOutcome;
  pendingConfirmation: PendingConfirmation | null;
}): TurnCompletion {
  if (input.conversationAct.state === "ROUTER_DEGRADED") {
    return "RETRYABLE_TECHNICAL_FAILURE";
  }
  if (
    input.clarification.status === "ASKED" ||
    input.clarification.status === "EXHAUSTED" ||
    input.pendingConfirmation !== null ||
    input.conversationAct.state === "COURSE_REFERENCE_UNRESOLVED"
  ) {
    return "USER_ACTION_REQUIRED";
  }
  return "ANSWERED";
}

function emptyResult(
  message: string,
  conversationAct: ConversationActDecision,
  answerOrigin: NavigatorAnswerOrigin,
  contactCard: AcademyContactCard | null = null,
  stateEffects: Partial<OrchestrationStateEffects> = {},
  clarification: OrchestrationClarificationOutcome = NOT_APPLICABLE_CLARIFICATION,
): NavigatorOrchestrationResult {
  const pendingConfirmation = stateEffects.pendingConfirmation ?? null;
  return {
    message,
    contactCard,
    conversationAct,
    decision: null,
    courseEvidenceCount: 0,
    courseHadActiveSources: false,
    evidenceSelectionStatus: "NOT_RUN",
    observability: {
      lane: "ORCHESTRATION",
      conversationAct: conversationAct.state,
      decision: null,
      courseId: null,
      ragInvoked: false,
      authorityResolved: false,
      activeBindingCount: 0,
      bindingSourceSlugs: [],
      retrievedMatchCount: 0,
      resolvedEvidenceCount: 0,
      selectedEvidence: [],
      evidenceSelectionStatus: "NOT_RUN",
      answerOrigin,
      fallback: "NONE",
      crossCourseLeakageDetected: false,
    },
    clarification,
    stateEffects: {
      catalogAuthorityVersion: stateEffects.catalogAuthorityVersion ?? null,
      transactionalAuthorityVersion:
        stateEffects.transactionalAuthorityVersion ?? null,
      pendingConfirmation,
      courseBinding: stateEffects.courseBinding,
    },
    completion: deriveTurnCompletion({
      conversationAct,
      clarification,
      pendingConfirmation,
    }),
  };
}

function assertCourseEvidenceIsolation(
  courseId: string,
  resolvedEvidence: readonly ResolvedCourseEvidence[],
  evidenceSelection: CourseEvidenceSelection | undefined,
): void {
  const crossCourseLeakageDetected = resolvedEvidence.some(
    (item) => item.courseId !== courseId,
  );
  const selectedCourseLeakage = evidenceSelection?.status === "SUPPORTED" &&
    evidenceSelection.evidence.some((selected) => {
      const resolved = resolvedEvidence.find(
        (item) => item.chunkId === selected.chunkId,
      );
      if (!resolved) {
        throw new Error("Selected evidence is absent from resolved evidence.");
      }
      return resolved?.courseId !== courseId;
    });

  if (crossCourseLeakageDetected || selectedCourseLeakage) {
    throw new Error("Cross-course evidence detected in navigator success path.");
  }
}

/**
 * PRODUCTION-IMPLEMENTATION-1.CORR1 F-2 — the same invariants as
 * `assertCourseEvidenceIsolation`, evaluated WITHOUT throwing.
 *
 * A bounded-RAG turn whose evidence is structurally invalid is not a technical
 * error and is not something a semantic repair may rescue: it is exactly the
 * condition the structural factual ceiling exists for. The orchestrator therefore
 * needs to ask the question rather than be thrown at, so the turn can take the
 * controlled ceiling before any composition, audit or repair happens.
 *
 * The three conditions are identical to the throwing guard, which is left in place
 * as a defence-in-depth backstop for the lanes that still rely on it:
 *   1. resolved evidence belonging to another course;
 *   2. selected evidence whose chunk is absent from resolved evidence;
 *   3. selected evidence whose chunk resolves to another course.
 */
function courseEvidenceStructurallyInvalid(
  courseId: string,
  resolvedEvidence: readonly ResolvedCourseEvidence[],
  evidenceSelection: CourseEvidenceSelection | undefined,
): boolean {
  if (resolvedEvidence.some((item) => item.courseId !== courseId)) {
    return true;
  }

  if (evidenceSelection?.status !== "SUPPORTED") {
    return false;
  }

  return evidenceSelection.evidence.some((selected) => {
    const resolved = resolvedEvidence.find(
      (item) => item.chunkId === selected.chunkId,
    );
    return resolved === undefined || resolved.courseId !== courseId;
  });
}

/**
 * CORR1 F-2 — the controlled structural ceiling for a bounded-RAG turn.
 *
 * Zero composition, zero audit, zero repair, no rejected promise. The structurally
 * invalid evidence is discarded rather than reported: none of it reaches the
 * answer, the turn log or the user, so the turn is logged as a factual ceiling
 * carrying no evidence. The structural violation itself stays observable through
 * the FACTUAL_CEILING_STRUCTURAL grounding event, which is why the turn record
 * does not need — and must not claim — a successful-turn leakage flag.
 */
function structuralCeilingResult(
  courseId: string,
  conversationAct: ConversationActDecision,
  courseKnowledge: RetrieveCourseKnowledgeResult,
  options: OrchestrateNavigatorOptions,
): NavigatorOrchestrationResult {
  groundingEventSink(options)?.({
    stage: "FACTUAL_CEILING_STRUCTURAL",
    courseId,
    reasonCode: null,
    errorName: null,
    selectedEvidenceCount: 0,
    repairAttempted: false,
  });

  const course = getAcademyCourse(courseId);

  return {
    message: composeCourseFactualCeilingAnswer(course?.title ?? courseId),
    contactCard: null,
    conversationAct,
    decision: null,
    courseEvidenceCount: 0,
    courseHadActiveSources: courseKnowledge.hasActiveSources,
    evidenceSelectionStatus: "INSUFFICIENT",
    observability: {
      lane: "ORCHESTRATION",
      conversationAct: conversationAct.state,
      decision: null,
      courseId,
      ragInvoked: true,
      authorityResolved: courseKnowledge.hasActiveSources,
      activeBindingCount: courseKnowledge.bindings.length,
      bindingSourceSlugs: courseKnowledge.bindings.map(
        (binding) => binding.sourceSlug,
      ),
      retrievedMatchCount: courseKnowledge.matches.length,
      resolvedEvidenceCount: 0,
      selectedEvidence: [],
      evidenceSelectionStatus: "INSUFFICIENT",
      answerOrigin: "FACTUAL_CEILING",
      fallback: "FACTUAL_CEILING",
      crossCourseLeakageDetected: false,
    },
    clarification: NOT_APPLICABLE_CLARIFICATION,
    stateEffects: {
      catalogAuthorityVersion: null,
      transactionalAuthorityVersion: null,
      pendingConfirmation: null,
    },
    completion: "ANSWERED",
  };
}

function courseObservability(
  conversationAct: ConversationActDecision,
  decision: NavigationDecision | null,
  courseId: string,
  courseKnowledge: RetrieveCourseKnowledgeResult,
  resolvedEvidence: readonly ResolvedCourseEvidence[],
  evidenceSelection: CourseEvidenceSelection | undefined,
  authorityResolved: boolean,
  answerOrigin: NavigatorAnswerOrigin,
  fallback: NavigatorTurnDetails["fallback"],
): NavigatorTurnDetails {
  assertCourseEvidenceIsolation(courseId, resolvedEvidence, evidenceSelection);
  const selectedEvidence = evidenceSelection?.status === "SUPPORTED"
    ? evidenceSelection.evidence.map((selected) => {
        const resolved = resolvedEvidence.find(
          (item) => item.chunkId === selected.chunkId,
        );
        if (!resolved) {
          throw new Error("Selected evidence is absent from resolved evidence.");
        }
        return {
          chunkId: resolved.chunkId,
          sourceSlug: resolved.sourceSlug,
          authorityRelation: resolved.authorityRelation,
        };
      })
    : [];

  return {
    lane: "ORCHESTRATION",
    conversationAct: conversationAct.state,
    decision: decision?.state ?? null,
    courseId,
    ragInvoked: true,
    authorityResolved,
    activeBindingCount: courseKnowledge.bindings.length,
    bindingSourceSlugs: courseKnowledge.bindings.map(
      (binding) => binding.sourceSlug,
    ),
    retrievedMatchCount: courseKnowledge.matches.length,
    resolvedEvidenceCount: resolvedEvidence.length,
    selectedEvidence,
    evidenceSelectionStatus: evidenceSelection?.status ?? "NOT_RUN",
    answerOrigin,
    fallback,
    crossCourseLeakageDetected: false,
  };
}

const NOT_APPLICABLE_CLARIFICATION: OrchestrationClarificationOutcome = {
  status: "NOT_APPLICABLE",
  issueKey: null,
  attempts: 0,
  question: null,
};

/**
 * P03 writer gate — the only authorized source of comparison candidates.
 *
 * A validated COURSE_COMPARISON may emit an AMBIGUOUS candidate set only when
 * it carries two known catalogue identities and its set equals the course
 * references of the latest effective user query, so the model's pair is always
 * corroborated by the user's own words. CATALOG_LIST, price metadata and
 * assistant prose never populate the field; an unknown comparison identity
 * never synthesizes a pair.
 */
function validatedComparisonCandidates(
  conversationAct: ConversationActDecision,
  query: string,
): readonly AcademyCourseId[] | null {
  if (conversationAct.state !== "FACTUAL") return null;

  const comparison = conversationAct.intents.find(
    (intent) => intent.kind === "COURSE_COMPARISON",
  );
  if (
    comparison === undefined ||
    comparison.kind !== "COURSE_COMPARISON" ||
    comparison.hasUnknownCourse ||
    comparison.courseIds.length !== 2
  ) {
    return null;
  }

  const lexicalCourseIds: readonly AcademyCourseId[] =
    resolveCourseReferences(query).courseIds;
  const sameSet =
    lexicalCourseIds.length === comparison.courseIds.length &&
    comparison.courseIds.every((courseId) =>
      lexicalCourseIds.includes(courseId),
    );

  return sameSet ? comparison.courseIds : null;
}

/**
 * NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 bounded exit: the same
 * course-reference clarification is given at most this many times in a row.
 */
export const MAX_CONSECUTIVE_COURSE_REFERENCE_CLARIFICATIONS = 2;

/**
 * Number of immediately preceding (user, clarification) exchanges. Derived from
 * the relayed history, so the count is stateless and never touches the A14
 * clarification record or the P03 payment budget; a client that drops or edits
 * its history can only reset its own counter.
 */
function trailingCourseReferenceClarifications(
  messages: readonly ConversationMessage[],
): number {
  let count = 0;
  for (let k = messages.length - 2; k >= 1; k -= 2) {
    const assistant = messages[k];
    const user = messages[k - 1];
    if (assistant.role !== "assistant" || user.role !== "user") break;
    if (!isCourseReferenceClarificationText(assistant.content)) break;
    count += 1;
  }
  return count;
}

function selectCourseReferenceUncertaintyAnswer(
  messages: readonly ConversationMessage[],
  proposedState: "COURSE_FOLLOW_UP" | "COURSE_CONTENT",
  profile: ConversationProfile | undefined,
): { message: string; strategy: NavigatorCourseReferenceStrategy } {
  if (
    trailingCourseReferenceClarifications(messages) >=
    MAX_CONSECUTIVE_COURSE_REFERENCE_CLARIFICATIONS
  ) {
    return {
      message: composeReferenceClarificationExhausted(),
      strategy: "EXHAUSTED",
    };
  }

  return {
    message:
      proposedState === "COURSE_FOLLOW_UP"
        ? composeFollowUpReferenceClarification(profile)
        : composeContentReferenceClarification(profile),
    strategy: "CLARIFY",
  };
}

type OrchestrationStateContext = OrchestrateNavigatorOptions["conversationState"];

/**
 * A10 deterministic contact answer, or null when the turn keeps ordinary
 * routing.
 *
 * The shortcut is deliberately narrow. Contact requests are an ordinary
 * business lane on the normal ROUTE path, so this runs only after the kernel
 * decided the turn routes; and it is taken only when the whole effective
 * request is a contact request. A preserved remainder promoted in front of the
 * turn, an unresolved confirmation, and a payment request all keep ordinary
 * routing, and with it the precedence that already governs them.
 *
 * Only an answer that carries the canonical manager contact card is returned:
 * the structured act of a contact turn is derived from that card, so the
 * card-free fast-text variant keeps its existing post-classification lane
 * instead of being recorded under an act that does not describe it.
 */
function deterministicContactAnswer(
  query: string,
  conversationState: OrchestrationStateContext,
  profile: ConversationProfile | undefined,
): { message: string; contactCard: AcademyContactCard | null } | null {
  if (conversationState?.pendingConfirmation != null) return null;
  if (conversationState?.deferredRequest != null) return null;
  if (hasEnrollmentPaymentIntent(query)) return null;

  const intent = detectDeterministicAcademyContactIntent(query, {
    hasContactContext: conversationState?.lastAssistant?.act === "ACADEMY_CONTACT",
  });

  if (intent === null) return null;

  const answer = composeAcademyContactAnswer(intent, profile);

  return answer.contactCard === null ? null : answer;
}

/**
 * Run the existing turn with one local recovery controller. Accepted-plan
 * outcomes are attached internally and logged without changing the API schema.
 */
export async function orchestrateNavigatorResponse(
  messages: readonly ConversationMessage[],
  options: OrchestrateNavigatorOptions = {},
): Promise<NavigatorOrchestrationResult> {
  const recovery: PlanRecoveryContext = { attempted: false, completedResult: null, coverage: null };
  const result = await orchestrateNavigatorTurn(messages, options, recovery);
  if (recovery.coverage !== null) {
    if (options.requestId) console.info(JSON.stringify(createTaskCoverageLog(options.requestId, recovery.coverage)));
    return { ...result, taskCoverage: recovery.coverage };
  }
  return result;
}

async function orchestrateNavigatorTurn(
  messages: readonly ConversationMessage[],
  options: OrchestrateNavigatorOptions,
  recovery: PlanRecoveryContext | null,
  paymentMessages: readonly ConversationMessage[] = messages,
): Promise<NavigatorOrchestrationResult> {
  const classifyAct =
    options.dependencies?.classifyAct ?? routeConversationAct;
  const route = options.dependencies?.route ?? routeEducationalNavigation;
  const retrieve =
    options.dependencies?.retrieve ?? retrieveCourseKnowledge;
  const resolve = options.dependencies?.resolve ?? resolveCourseEvidence;
  const selectEvidence =
    options.dependencies?.selectEvidence ?? selectCourseEvidence;
  const compose = options.dependencies?.compose ?? composeNavigatorAnswer;
  const composeFollowUp =
    options.dependencies?.composeFollowUp ?? composeCourseFollowUpAnswer;

  const query = lastUserMessage(messages);

  // CORR3.CONVERSATION-REPAIR-AND-FOLLOWUP-1 (D2) — the substantive question a
  // course-content follow-up should be retrieved and evidence-selected on. For a
  // narrowing/correction turn this recovers the clarified question from the
  // discourse; for an ordinary follow-up it is identical to `query`.
  const contentQuery = formulateFollowUpContentQuery(messages);

  // A10 — deterministic contact, ahead of the act classifier. The reason is
  // stated in the act: an obvious contact/photo/Telegram/phone follow-up must
  // not be misclassified as out of scope, and must not need a provider call to
  // be answered. See deterministicContactAnswer for the exact preconditions.
  const deterministicContact = deterministicContactAnswer(
    query,
    options.conversationState,
    options.profile,
  );

  if (deterministicContact !== null) {
    return emptyResult(
      deterministicContact.message,
      { state: "NAVIGATE" },
      "CONTACT_POLICY",
      deterministicContact.contactCard,
    );
  }

  const classifiedAct = await classifyActOrDegrade(
    messages,
    classifyAct,
    options,
    recovery,
  );
  if (recovery?.completedResult !== null && recovery?.completedResult !== undefined) {
    return recovery.completedResult;
  }

  // NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 (P7-A) — every pre-RAG policy
  // (payment, factual, contact, scope, meta) sees exactly the act the
  // pre-correction validator would have produced for this request and state:
  // the original COURSE_CONTENT for a content conflict, ROUTER_DEGRADED for a
  // follow-up without literal authority. Commercial and contact outcomes are
  // therefore unchanged, including an explicit payment that wins before the
  // uncertainty lane; only the lane that would have retrieved (CONTENT) or
  // degraded (FOLLOW_UP) is replaced.
  const unresolvedAct =
    classifiedAct.state === "COURSE_REFERENCE_UNRESOLVED" ? classifiedAct : null;
  const conversationAct: ConversationActDecision =
    unresolvedAct === null
      ? classifiedAct
      : unresolvedAct.proposed.state === "COURSE_CONTENT"
        ? unresolvedAct.proposed
        : { state: "ROUTER_DEGRADED" };

  // P03 — the stored comparison candidates and the liveness of the structured
  // payment clarification they back. Continuation is possible only when the
  // recorded last assistant act is the payment clarification itself, the open
  // issue is the EXACT current payment-multiple issue of the stored candidate
  // set, the stored clarification record is that same issue, the state is
  // AMBIGUOUS with no selected course, no stale/no-match guard applies, and the
  // candidate set is non-empty.
  //
  // CORR1 F04 — the previous prefix-only issue check let a wrong or already
  // spent issue pay a bare candidate. Here the prior issue must equal
  // paymentMultipleIssueKey(storedReferents) — the same canonical algorithm
  // that created the clarification — and the recorded last assistant act must
  // be the asked clarification itself: an exhausted issue records
  // CLARIFICATION_EXHAUSTED or the one-shot HANDOFF_OFFERED on its
  // exhaustion/handoff turn and is never live again for that set, while a new
  // valid comparison establishes a new issue identity and a fresh budget
  // (a set change resets attempts), so a stale handoff from a prior issue
  // cannot spend the new issue's lifecycle either.
  const storedState = options.conversationState;
  const storedReferents: readonly AcademyCourseId[] =
    storedState?.courseReferents ?? [];
  const priorIssueKey = options.clarification?.priorIssueKey ?? null;
  const currentPaymentIssueKey = paymentMultipleIssueKey(storedReferents);
  const paymentClarificationLive =
    storedState?.lastAssistant?.act === "CLARIFICATION" &&
    priorIssueKey !== null &&
    storedState?.clarification?.issueKey === priorIssueKey &&
    priorIssueKey === currentPaymentIssueKey &&
    storedState?.courseMatch === "AMBIGUOUS" &&
    (storedState?.selectedCourseId ?? null) === null &&
    storedState?.staleReference == null &&
    storedReferents.length > 0;

  // CORR2 F05 — the CORR1 duplicate-line reduction is removed at the root:
  // the kernel no longer preserves a redundant remainder on the exhausted
  // payment-multiple handoff transition, so the effective request is never
  // that one question repeated and the payment decision reads the turn's real
  // effective request exactly as every other lane does. Duplicated or
  // multi-line text is consequently never collapsed or qualified here.
  const paymentDecision = resolveEnrollmentPaymentDecision(
    lastUserMessage(paymentMessages),
    conversationAct,
    {
      selectedCourseId: storedState?.selectedCourseId ?? null,
      courseMatch: storedState?.courseMatch ?? "UNKNOWN",
      staleCourseReference:
        storedState?.staleReference !== null &&
        storedState?.staleReference !== undefined,
      courseReferents: storedReferents,
      pendingPaymentClarification: paymentClarificationLive,
    },
  );

  // NAVIGATOR-COURSE-IDENTITY-COMPARISON-CORR-1 — the latest effective user
  // message lets the factual composer prove a same-course equivalence operand
  // by operand; it adds no binding, retrieval or commercial effect.
  const factualMessage = conversationAct.state === "FACTUAL"
    ? composeFactualAnswer(
        conversationAct.intents,
        options.conversationState?.selectedCourseId ?? null,
        options.profile,
        query,
      )
    : null;
  const factualUsesTransactionalAuthority =
    conversationAct.state === "FACTUAL" &&
    conversationAct.intents.some((intent) => intent.kind === "CURRENT_METADATA");
  const combineFactual = (message: string): string =>
    factualMessage === null ? message : `${factualMessage}\n\n${message}`;

  if (paymentDecision.kind === "ACTION") {
    // P03 — when the resolved payment consumes a stored candidate set, the
    // resolution is an explicit course selection: bind MATCHED and clear the
    // candidates through the validated state effect.
    const resolvedBinding: OrchestratedDecision | undefined =
      storedReferents.length > 0 && paymentDecision.action.courseId !== null
        ? { kind: "MATCHED", courseId: paymentDecision.action.courseId }
        : undefined;
    return emptyResult(
      combineFactual(
        composeEnrollmentPaymentAnswer(paymentDecision.action, options.profile),
      ),
      conversationAct,
      "PAYMENT_POLICY",
      null,
      {
        catalogAuthorityVersion:
          conversationAct.state === "FACTUAL"
            ? ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE
            : null,
        transactionalAuthorityVersion: ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
        ...(resolvedBinding !== undefined
          ? { courseBinding: resolvedBinding }
          : {}),
      },
    );
  }

  if (paymentDecision.kind === "CLARIFY_MULTIPLE") {
    // Lexical multi-course requests keep the existing generic clarification.
    if (paymentDecision.fromStoredCandidates !== true) {
      return emptyResult(
        combineFactual(composePaymentAmbiguityAnswer(options.profile)),
        conversationAct,
        "PAYMENT_POLICY",
      );
    }

    // P03 structured payment clarification — deterministic one-question
    // wording, explicit AMBIGUOUS/candidates binding, and the A14 budget
    // scoped to the payment-multiple issue identity.
    const issueKey = paymentMultipleIssueKey(paymentDecision.courseIds);
    const priorAttempts =
      options.clarification?.priorIssueKey === issueKey
        ? (options.clarification?.priorAttempts ?? 0)
        : 0;
    const courseBinding: OrchestratedDecision = {
      kind: "AMBIGUOUS",
      ...(paymentDecision.courseIds.length > 0
        ? { courseIds: [...paymentDecision.courseIds] }
        : {}),
    };

    if (priorAttempts >= CLARIFICATION_BUDGET) {
      return emptyResult(
        combineFactual(composeClarificationExhaustionAnswer(options.profile)),
        conversationAct,
        "PAYMENT_POLICY",
        null,
        { courseBinding },
        {
          status: "EXHAUSTED",
          issueKey,
          attempts: CLARIFICATION_BUDGET,
          question: null,
        },
      );
    }

    const question = composePaymentAmbiguityAnswer(options.profile);
    return emptyResult(
      combineFactual(question),
      conversationAct,
      "PAYMENT_POLICY",
      null,
      { courseBinding },
      {
        status: "ASKED",
        issueKey,
        attempts: priorAttempts + 1,
        question,
      },
    );
  }

  if (paymentDecision.kind === "CONFIRM_COURSE_CHANGE") {
    const currentCourse = getAcademyCourse(paymentDecision.currentCourseId);
    const requestedCourse = getAcademyCourse(paymentDecision.requestedCourseId);
    if (!currentCourse || !requestedCourse) {
      throw new Error("Payment course confirmation references an unavailable course.");
    }
    const prompt = composePaymentCourseChangeConfirmationAnswer(
      currentCourse.title,
      requestedCourse.title,
      options.profile,
    );
    return emptyResult(combineFactual(prompt), conversationAct, "PAYMENT_POLICY", null, {
      pendingConfirmation: {
        confirmationKey: `payment-course-change:${paymentDecision.currentCourseId}:${paymentDecision.requestedCourseId}`,
        kind: "PAYMENT_COURSE_CHANGE",
        prompt,
        candidateCourseId: paymentDecision.requestedCourseId,
      },
    });
  }

  if (
    paymentDecision.kind === "REESTABLISH_COURSE" ||
    paymentDecision.kind === "PRESERVE_NO_MATCH"
  ) {
    return emptyResult(
      combineFactual(composePaymentCourseIdentityRequiredAnswer(options.profile)),
      conversationAct,
      "PAYMENT_POLICY",
    );
  }

  if (paymentDecision.kind === "COURSE_NOT_PAYABLE") {
    const course = getAcademyCourse(paymentDecision.courseId);
    return emptyResult(
      combineFactual(
        composePaymentUnavailableAnswer(course?.title ?? paymentDecision.courseId),
      ),
      conversationAct,
      "PAYMENT_POLICY",
    );
  }

  if (conversationAct.state === "FACTUAL") {
    // P03 — a corroborated comparison replaces the candidate set through the
    // explicit AMBIGUOUS binding; the factual act itself stays FACTUAL.
    const comparisonCandidates = validatedComparisonCandidates(
      conversationAct,
      query,
    );
    return emptyResult(
      factualMessage ?? "",
      conversationAct,
      factualUsesTransactionalAuthority
        ? "COMMERCIAL_AUTHORITY"
        : "CATALOG_AUTHORITY",
      null,
      {
      catalogAuthorityVersion: ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
      transactionalAuthorityVersion: factualUsesTransactionalAuthority
        ? ACADEMY_COMMERCIAL_AUTHORITY_VERSION
        : null,
      ...(comparisonCandidates !== null
        ? {
            courseBinding: {
              kind: "AMBIGUOUS",
              courseIds: [...comparisonCandidates],
            } satisfies OrchestratedDecision,
          }
        : {}),
      },
    );
  }

  const contactIntent = detectAcademyContactIntent(query, {
    hasCourseContext:
      conversationAct.state === "COURSE_FOLLOW_UP" ||
      conversationAct.state === "COURSE_CONTENT",
  });

  if (
    contactIntent &&
    conversationAct.state !== "NAVIGATE" &&
    !(conversationAct.state === "COURSE_FOLLOW_UP" && hasEnrollmentPaymentIntent(query))
  ) {
    const contact = composeAcademyContactAnswer(contactIntent, options.profile);
    return emptyResult(
      contact.message,
      conversationAct,
      "CONTACT_POLICY",
      contact.contactCard,
    );
  }

  if (conversationAct.state === "OUT_OF_SCOPE") {
    return emptyResult(
      composeNavigatorOutOfScopeAnswer(options.profile),
      conversationAct,
      "OUT_OF_SCOPE",
    );
  }

  if (conversationAct.state === "META") {
    return emptyResult(
      composeNavigatorMetaAnswer(),
      conversationAct,
      "META",
    );
  }

  // NAVIGATOR-ACT-ROUTER-ALIAS-CORRECTION-1 — the controlled course-reference
  // uncertainty lane: deterministic and non-technical, binds no course, runs no
  // retrieval, resolution, selection or composition, and carries no
  // transactional authority. It invalidates a stored MATCHED selection (P4-B)
  // and changes strategy after two consecutive identical clarifications.
  if (unresolvedAct !== null) {
    const answer = selectCourseReferenceUncertaintyAnswer(
      messages,
      unresolvedAct.proposed.state,
      options.profile,
    );
    const result = emptyResult(
      answer.message,
      unresolvedAct,
      "DETERMINISTIC_CONTROL",
      null,
      { courseBinding: { kind: "INVALIDATE_SELECTION" } },
    );
    return {
      ...result,
      observability: {
        ...(result.observability as NavigatorTurnDetails),
        courseReferenceUncertainty: {
          reason: unresolvedAct.reason,
          strategy: answer.strategy,
          proposedAct: unresolvedAct.proposed.state,
        },
      },
    };
  }

  // EXPERIMENT-1.ROUTER-ACCESS-1 — the fail-closed lane. The provider's act
  // decision was rejected and no accepted recovery produced a user-facing
  // disposition. Nothing about the rejected decision is trusted. The result
  // is a retryable technical failure even when internal task accounting is
  // attached; coverage does not complete the request.
  if (conversationAct.state === "ROUTER_DEGRADED") {
    return emptyResult(
      composeTechnicalErrorAnswer(options.profile, true),
      conversationAct,
      "DETERMINISTIC_CONTROL",
    );
  }

  // EXPERIMENT-1.ROUTER-ACCESS-1 — the route the taxonomy was missing. A
  // question answerable from course material, asked without the material having
  // been named, now has a path into the unchanged RAG stack: the same
  // matchCount 12 / matchThreshold -1 retrieval, the same authority resolution
  // at 8, the same selector, and the same follow-up composer and answer audit
  // fed the same way. Only the entry into that stack is new.
  if (conversationAct.state === "COURSE_CONTENT") {
    const boundCourseId = conversationAct.courseId;

    const courseKnowledge = await withNavigatorStage("COURSE_RPC", () =>
      retrieve(
        boundCourseId,
        contentQuery,
        {
          env: options.env,
          fetch: options.fetch,
          signal: options.signal,
          matchCount: 12,
        },
      ),
    );

    let resolvedEvidence: ResolvedCourseEvidence[] = [];
    let evidenceSelection: CourseEvidenceSelection | undefined;
    let evidenceSelectionDegraded = false;

    if (courseKnowledge.hasActiveSources) {
      resolvedEvidence = await withNavigatorStage("AUTHORITY", () =>
        resolve(courseKnowledge.matches, 8),
      );

      if (resolvedEvidence.length > 0) {
        const selectionOutcome = await selectEvidenceOrDegrade(
          contentQuery,
          resolvedEvidence,
          selectEvidence,
          options,
        );
        evidenceSelection = selectionOutcome.selection;
        evidenceSelectionDegraded = selectionOutcome.degraded;
      } else {
        evidenceSelection = {
          status: "INSUFFICIENT",
          evidence: [],
        };
      }
    }

    let contentOutcome: CourseFollowUpOutcome =
      evidenceSelection?.status === "SUPPORTED"
        ? { answerOrigin: "RAG_EVIDENCE", fallback: "NONE" }
        : { answerOrigin: "FACTUAL_CEILING", fallback: "FACTUAL_CEILING" };

    // CORR1 F-2: a structural invariant failure is a hard failure. It takes the
    // controlled ceiling here — before composition — so no composer, auditor or
    // repair ever sees structurally invalid evidence.
    if (
      courseEvidenceStructurallyInvalid(
        boundCourseId,
        resolvedEvidence,
        evidenceSelection,
      )
    ) {
      return structuralCeilingResult(
        boundCourseId,
        conversationAct,
        courseKnowledge,
        options,
      );
    }

    const message = await withNavigatorStage("FOLLOW_UP", () =>
      composeFollowUp(
        messages,
        {
          state: "COURSE_FOLLOW_UP",
          courseId: boundCourseId,
          evidenceRequested: conversationAct.evidenceRequested,
        },
        {
          env: options.env,
          fetch: options.fetch,
          signal: options.signal,
          courseEvidence: resolvedEvidence,
          evidenceSelection,
          onOutcome: (outcome) => {
            contentOutcome = outcome;
          },
          profile: options.profile,
          onGroundingEvent: groundingEventSink(options),
        },
      ),
    );

    return {
      message,
      contactCard: null,
      conversationAct,
      decision: null,
      courseEvidenceCount: resolvedEvidence.length,
      courseHadActiveSources: courseKnowledge.hasActiveSources,
      evidenceSelectionStatus: evidenceSelection?.status ?? "NOT_RUN",
      observability: courseObservability(
        conversationAct,
        null,
        boundCourseId,
        courseKnowledge,
        resolvedEvidence,
        evidenceSelection,
        courseKnowledge.hasActiveSources,
        contentOutcome.answerOrigin,
        evidenceSelectionDegraded
          ? "EVIDENCE_SELECTION_DEGRADED"
          : contentOutcome.fallback,
      ),
      clarification: NOT_APPLICABLE_CLARIFICATION,
      stateEffects: {
        catalogAuthorityVersion: null,
        transactionalAuthorityVersion: null,
        pendingConfirmation: null,
      },
      completion: "ANSWERED",
    };
  }

  if (conversationAct.state === "COURSE_FOLLOW_UP") {
    const courseKnowledge = await withNavigatorStage("COURSE_RPC", () =>
      retrieve(
        conversationAct.courseId,
        contentQuery,
        {
          env: options.env,
          fetch: options.fetch,
          signal: options.signal,
          matchCount: 12,
        },
      ),
    );

    let resolvedEvidence: ResolvedCourseEvidence[] = [];
    let evidenceSelection: CourseEvidenceSelection | undefined;
    let evidenceSelectionDegraded = false;

    if (courseKnowledge.hasActiveSources) {
      resolvedEvidence = await withNavigatorStage("AUTHORITY", () =>
        resolve(courseKnowledge.matches, 8),
      );

      if (resolvedEvidence.length > 0) {
        const selectionOutcome = await selectEvidenceOrDegrade(
          contentQuery,
          resolvedEvidence,
          selectEvidence,
          options,
        );
        evidenceSelection = selectionOutcome.selection;
        evidenceSelectionDegraded = selectionOutcome.degraded;
      } else {
        evidenceSelection = {
          status: "INSUFFICIENT",
          evidence: [],
        };
      }
    }

    let followUpOutcome: CourseFollowUpOutcome =
      evidenceSelection?.status === "SUPPORTED"
        ? { answerOrigin: "RAG_EVIDENCE", fallback: "NONE" }
        : { answerOrigin: "FACTUAL_CEILING", fallback: "FACTUAL_CEILING" };

    // CORR1 F-2: same controlled structural ceiling as the COURSE_CONTENT lane —
    // zero composition, zero audit, zero repair.
    if (
      courseEvidenceStructurallyInvalid(
        conversationAct.courseId,
        resolvedEvidence,
        evidenceSelection,
      )
    ) {
      return structuralCeilingResult(
        conversationAct.courseId,
        conversationAct,
        courseKnowledge,
        options,
      );
    }

    const message = await withNavigatorStage("FOLLOW_UP", () =>
      composeFollowUp(messages, conversationAct, {
        env: options.env,
        fetch: options.fetch,
        signal: options.signal,
        courseEvidence: resolvedEvidence,
        evidenceSelection,
        onOutcome: (outcome) => {
          followUpOutcome = outcome;
        },
        profile: options.profile,
        onGroundingEvent: groundingEventSink(options),
      }),
    );

    return {
      message,
      contactCard: null,
      conversationAct,
      decision: null,
      courseEvidenceCount: resolvedEvidence.length,
      courseHadActiveSources: courseKnowledge.hasActiveSources,
      evidenceSelectionStatus:
        evidenceSelection?.status ?? "NOT_RUN",
      observability: courseObservability(
        conversationAct,
        null,
        conversationAct.courseId,
        courseKnowledge,
        resolvedEvidence,
        evidenceSelection,
        courseKnowledge.hasActiveSources,
        followUpOutcome.answerOrigin,
        evidenceSelectionDegraded
          ? "EVIDENCE_SELECTION_DEGRADED"
          : followUpOutcome.fallback,
      ),
      clarification: NOT_APPLICABLE_CLARIFICATION,
      stateEffects: {
        catalogAuthorityVersion: null,
        transactionalAuthorityVersion: null,
        pendingConfirmation: null,
      },
      completion: "ANSWERED",
    };
  }

  const storedNoMatch =
    options.conversationState?.courseMatch === "NO_CURRENT_COURSE_MATCH";
  const storedCatalogVersion =
    options.conversationState?.catalogAuthorityVersion ?? null;
  const authorityChanged =
    storedCatalogVersion !== null &&
    storedCatalogVersion !== ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE;
  const hasNewTaskEvidence =
    conversationAct.state === "NAVIGATE" &&
    typeof conversationAct.newTaskEvidence === "string";

  if (storedNoMatch && !authorityChanged && !hasNewTaskEvidence) {
    return emptyResult(
      composeStableNoMatchAnswer(),
      conversationAct,
      "CATALOG_AUTHORITY",
      null,
      { catalogAuthorityVersion: ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE },
    );
  }

  let decision: NavigationDecision;
  try {
    decision = await withNavigatorStage("ROUTER", () =>
      route(messages, {
        env: options.env,
        fetch: options.fetch,
        signal: options.signal,
        profile: options.profile,
      }),
    );
  } catch (error) {
    if (!isRecoverableEducationalRouterFailure(error)) {
      throw error;
    }

    // The rejected decision is not inspected. The continuation is the current
    // catalogue plus a request to name the task; it selects no course and
    // makes no second provider call.
    if (options.requestId) {
      console.warn(
        JSON.stringify({
          event: "NAVIGATOR_DEGRADATION",
          requestId: options.requestId,
          stage: "ROUTER",
          provider: "DEEPSEEK",
          fallback: "CATALOG_CONTINUATION",
          errorName: error.errorName,
          errorCode: error.errorCode,
          status: error.status,
        }),
      );
    }

    return emptyResult(
      composeEducationalRouterContinuation(options.profile),
      conversationAct,
      "CATALOG_AUTHORITY",
      null,
      { catalogAuthorityVersion: ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE },
    );
  }

  let courseKnowledge: RetrieveCourseKnowledgeResult | null = null;
  let resolvedEvidence: ResolvedCourseEvidence[] = [];
  let evidenceSelection: CourseEvidenceSelection | undefined;
  let evidenceSelectionDegraded = false;

  if (decision.state === "RECOMMEND_COURSE") {
    const recommendationCourseKnowledge = await withNavigatorStage(
      "COURSE_RPC",
      () =>
        retrieve(
          decision.primaryCourseId,
          decision.learningNeed,
          {
            env: options.env,
            fetch: options.fetch,
            signal: options.signal,
            matchCount: 12,
          },
        ),
    );
    courseKnowledge = recommendationCourseKnowledge;

    if (recommendationCourseKnowledge.hasActiveSources) {
      resolvedEvidence = await withNavigatorStage("AUTHORITY", () =>
        resolve(recommendationCourseKnowledge.matches, 8),
      );

      if (resolvedEvidence.length > 0) {
        const selectionOutcome = await selectEvidenceOrDegrade(
          decision.learningNeed,
          resolvedEvidence,
          selectEvidence,
          options,
        );
        evidenceSelection = selectionOutcome.selection;
        evidenceSelectionDegraded = selectionOutcome.degraded;
      } else {
        evidenceSelection = {
          status: "INSUFFICIENT",
          evidence: [],
        };
      }
    }
  }

  if (decision.state === "ASK_MORE") {
    return withNavigatorStage("COMPOSER", () =>
      composeClarificationTurn(messages, decision, compose, options),
    );
  }

  if (decision.state === "RECOMMEND_COURSE") {
    assertCourseEvidenceIsolation(
      decision.primaryCourseId,
      resolvedEvidence,
      evidenceSelection,
    );
  }

  const message = await withNavigatorStage("COMPOSER", () =>
    compose(messages, decision, {
      courseEvidence: resolvedEvidence,
      evidenceSelection,
      hasActiveCourseSources: courseKnowledge?.hasActiveSources ?? false,
      showEvidence: false,
      profile: options.profile,
    }),
  );

  return {
    message,
    contactCard: null,
    conversationAct,
    decision,
    courseEvidenceCount: resolvedEvidence.length,
    courseHadActiveSources: courseKnowledge?.hasActiveSources ?? false,
    evidenceSelectionStatus: evidenceSelection?.status ?? "NOT_RUN",
    observability: decision.state === "RECOMMEND_COURSE"
      ? courseObservability(
          conversationAct,
          decision,
          decision.primaryCourseId,
          courseKnowledge ?? { hasActiveSources: false, bindings: [], matches: [] },
          resolvedEvidence,
          evidenceSelection,
          courseKnowledge?.hasActiveSources ?? false,
          "CATALOG_AUTHORITY",
          evidenceSelectionDegraded ? "EVIDENCE_SELECTION_DEGRADED" : "NONE",
        )
      : {
          lane: "ORCHESTRATION",
          conversationAct: conversationAct.state,
          decision: "NO_CURRENT_COURSE_MATCH",
          courseId: null,
          ragInvoked: false,
          authorityResolved: false,
          activeBindingCount: 0,
          bindingSourceSlugs: [],
          retrievedMatchCount: 0,
          resolvedEvidenceCount: 0,
          selectedEvidence: [],
          evidenceSelectionStatus: "NOT_RUN",
          answerOrigin: "CATALOG_AUTHORITY",
          fallback: "NONE",
          crossCourseLeakageDetected: false,
        },
    clarification: NOT_APPLICABLE_CLARIFICATION,
    stateEffects: {
      catalogAuthorityVersion: ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
      transactionalAuthorityVersion: null,
      pendingConfirmation: null,
    },
    completion: "ANSWERED",
  };
}

/**
 * Bounded clarification (A14).
 *
 * The issue key is derived from the router's unresolved candidate set, so the
 * counter is scoped to the issue rather than to the session lifetime. Within
 * budget the turn asks exactly one question, selected by attempt index, so a
 * repeated attempt asks a materially different question instead of paraphrasing
 * the previous one. At budget exhaustion the kernel stops asking and returns a
 * structured EXHAUSTED outcome for later packages to consume.
 *
 * The public wording stays entirely with the existing composer: this narrows
 * the decision and re-composes, so no new clarification prose is introduced
 * here.
 */
async function composeClarificationTurn(
  messages: readonly ConversationMessage[],
  decision: Extract<NavigationDecision, { state: "ASK_MORE" }>,
  compose: ComposeDependency,
  options: OrchestrateNavigatorOptions,
): Promise<NavigatorOrchestrationResult> {
  const issueKey = clarificationIssueKey(decision.candidateCourseIds);
  const priorAttempts =
    options.clarification?.priorIssueKey === issueKey
      ? (options.clarification?.priorAttempts ?? 0)
      : 0;

  if (priorAttempts >= CLARIFICATION_BUDGET) {
    return {
      message: composeClarificationExhaustionAnswer(options.profile),
      contactCard: null,
      conversationAct: { state: "NAVIGATE" },
      decision,
      courseEvidenceCount: 0,
      courseHadActiveSources: false,
      evidenceSelectionStatus: "NOT_RUN",
      observability: {
        lane: "ORCHESTRATION",
        conversationAct: "NAVIGATE",
        decision: "ASK_MORE",
        courseId: null,
        ragInvoked: false,
        authorityResolved: false,
        activeBindingCount: 0,
        bindingSourceSlugs: [],
        retrievedMatchCount: 0,
        resolvedEvidenceCount: 0,
        selectedEvidence: [],
        evidenceSelectionStatus: "NOT_RUN",
        answerOrigin: "CATALOG_AUTHORITY",
        fallback: "NONE",
        crossCourseLeakageDetected: false,
      },
      clarification: {
        status: "EXHAUSTED",
        issueKey,
        attempts: CLARIFICATION_BUDGET,
        question: null,
      },
      stateEffects: {
        catalogAuthorityVersion: null,
        transactionalAuthorityVersion: null,
        pendingConfirmation: null,
      },
      completion: "USER_ACTION_REQUIRED",
    };
  }

  const strategyIndex = Math.min(
    priorAttempts,
    decision.questions.length - 1,
  );
  const question = decision.questions[strategyIndex];

  const message = await compose(
    messages,
    { ...decision, questions: [question] },
    { showEvidence: false, profile: options.profile },
  );

  return {
    message,
    contactCard: null,
    conversationAct: { state: "NAVIGATE" },
    decision,
    courseEvidenceCount: 0,
    courseHadActiveSources: false,
    evidenceSelectionStatus: "NOT_RUN",
    observability: {
      lane: "ORCHESTRATION",
      conversationAct: "NAVIGATE",
      decision: "ASK_MORE",
      courseId: null,
      ragInvoked: false,
      authorityResolved: false,
      activeBindingCount: 0,
      bindingSourceSlugs: [],
      retrievedMatchCount: 0,
      resolvedEvidenceCount: 0,
      selectedEvidence: [],
      evidenceSelectionStatus: "NOT_RUN",
      answerOrigin: "CATALOG_AUTHORITY",
      fallback: "NONE",
      crossCourseLeakageDetected: false,
    },
    clarification: {
      status: "ASKED",
      issueKey,
      attempts: priorAttempts + 1,
      question,
    },
    stateEffects: {
      catalogAuthorityVersion: null,
      transactionalAuthorityVersion: null,
      pendingConfirmation: null,
    },
    completion: "USER_ACTION_REQUIRED",
  };
}

type PlanRecoveryMode = "F1" | "NON_F1";

async function extractRecoveryPlan(
  messages: readonly DeepSeekMessage[],
  extractionOptions: DeepSeekClientOptions,
  dependency: PlanExtractionDependency | undefined,
): Promise<unknown> {
  if (dependency !== undefined) return dependency(messages, extractionOptions);
  return callDeepSeekJson(messages, extractionOptions);
}

/** Runs one plan and integrates already completed results; no primary re-execution. */
async function attemptPlanRecoveryOrUndefined(
  messages: readonly ConversationMessage[],
  options: OrchestrateNavigatorOptions,
  recovery: PlanRecoveryContext,
  mode: PlanRecoveryMode,
): Promise<ConversationActDecision | null> {
  const requestId = options.requestId ?? "";
  const latestEffectiveText = messages.at(-1)?.content ?? "";
  let capturedPlan: unknown = null;
  const outcome = await attemptIntentPlanRecovery<NavigatorOrchestrationResult>({
    messages,
    extractionOptions: { env: options.env, fetch: options.fetch, signal: options.signal },
    extraction: async (extractionMessages, extractionOptions) => {
      const plan = await extractRecoveryPlan(
        extractionMessages,
        extractionOptions,
        options.dependencies?.extractPlan,
      );
      capturedPlan = plan;
      return plan;
    },
    preflight: (segments, tasks) => {
      if (tasks.length === 1) return null;
      for (const segment of segments) {
        if (segment.kind !== "ACT") continue;
        const payment = recoveryPaymentDecision(messages, segment.act, options);
        if (payment.kind !== "NONE") return payment.kind;
      }
      return null;
    },
    dispatchSegment: (segment, index) => {
      if (
        mode === "NON_F1" &&
        !nonF1MetadataSegmentIsGrounded(segment, capturedPlan, latestEffectiveText)
      ) {
        return Promise.resolve({
          bindingKind: "NONE" as const,
          pendingConfirmation: false,
          answerOrigin: null,
          message: "",
          value: emptyResult(
            "",
            { state: "ROUTER_DEGRADED" },
            "DETERMINISTIC_CONTROL",
          ),
        });
      }
      return dispatchRecoverySegment(
        segment, messages, options, requestId, index,
      );
    },
  });
  if (options.requestId) {
    console.info(JSON.stringify(createIntentPlanRecoveryLog(requestId, {
      disposition: outcome.disposition,
      reasonCode: "reasonCode" in outcome ? outcome.reasonCode : null,
      problems: outcome.disposition === "PLAN_REJECTED" ? outcome.problems : undefined,
      activeTaskCount: "activeTasks" in outcome ? outcome.activeTasks.length : null,
      segments: "segments" in outcome ? outcome.segments : undefined,
      extractionCalls: true,
    })));
  }
  if (outcome.disposition === "EXTRACTION_FAILED" || outcome.disposition === "PLAN_REJECTED") return null;
  if (!("dispatchResults" in outcome)) {
    // Internal refusal accounting is not a displayed answer and must not
    // complete the request. The caller keeps the retryable degraded result.
    recovery.coverage = accountTaskOutcomes(outcome.activeTasks, outcome.activeTasks.map((task, index) =>
      outcomeForTask({ task, taskIndex: index, selectedCourseId: options.conversationState?.selectedCourseId ?? null, limitationReason: "WHOLE_TURN_REFUSED" }),
    ));
    return null;
  }
  const completed = finalizeRecoveredPlan(
    outcome,
    options,
    mode,
    latestEffectiveText,
    capturedPlan,
  );
  recovery.completedResult = completed;
  recovery.coverage = completed.taskCoverage ?? null;
  return completed.conversationAct;
}

/** Same original effective query and structured payment context as the main lane. */
function recoveryPaymentDecision(
  messages: readonly ConversationMessage[],
  act: ConversationActDecision,
  options: OrchestrateNavigatorOptions,
): ReturnType<typeof resolveEnrollmentPaymentDecision> {
  const state = options.conversationState;
  const referents = state?.courseReferents ?? [];
  const issue = options.clarification?.priorIssueKey ?? null;
  const live = state?.lastAssistant?.act === "CLARIFICATION" && issue !== null &&
    state?.clarification?.issueKey === issue && issue === paymentMultipleIssueKey(referents) &&
    state?.courseMatch === "AMBIGUOUS" && (state?.selectedCourseId ?? null) === null &&
    state?.staleReference == null && referents.length > 0;
  return resolveEnrollmentPaymentDecision(lastUserMessage(messages), act, {
    selectedCourseId: state?.selectedCourseId ?? null,
    courseMatch: state?.courseMatch ?? "UNKNOWN",
    staleCourseReference: state?.staleReference != null,
    courseReferents: referents,
    pendingPaymentClarification: live,
  });
}

/** Content uses its own task span; payment always uses the original request. */
async function dispatchRecoverySegment(
  segment: Extract<RecoverySegment, { kind: "ACT" }>,
  messages: readonly ConversationMessage[],
  options: OrchestrateNavigatorOptions,
  requestId: string,
  segmentIndex: number,
): Promise<SegmentDispatchResult<NavigatorOrchestrationResult>> {
  const scoped = segment.evidenceSpan !== null &&
    (segment.act.state === "COURSE_FOLLOW_UP" || segment.act.state === "COURSE_CONTENT" || segment.act.state === "FACTUAL");
  const segmentMessages = scoped
    ? [...messages.slice(0, -1), { role: "user" as const, content: segment.evidenceSpan! }]
    : messages;
  const result = await orchestrateNavigatorTurn(segmentMessages, {
    ...options,
    requestId: requestId.length > 0 ? `${requestId}:PLANREC:${segmentIndex + 1}` : undefined,
    dependencies: {
      ...(options.dependencies ?? {}),
      classifyAct: async () => structuredClone(segment.act),
      // Only a single PAYMENT/RECOMMEND plan can map NAVIGATE.
      ...(segment.act.state === "NAVIGATE" ? {} : {
        route: async () => { throw new Error("Recovery content dispatch must not re-route."); },
      }),
      extractPlan: undefined,
    },
  }, null, messages);
  return {
    bindingKind: recoveryBindingKind(result),
    pendingConfirmation: result.stateEffects.pendingConfirmation != null,
    answerOrigin: result.observability?.answerOrigin ?? null,
    message: result.message,
    value: result,
  };
}

function recoveryBindingKind(result: NavigatorOrchestrationResult): SegmentDispatchResult["bindingKind"] {
  const explicit = result.stateEffects.courseBinding;
  if (explicit !== undefined) {
    return explicit.kind === "MATCHED" || explicit.kind === "NO_MATCH" || explicit.kind === "AMBIGUOUS"
      ? explicit.kind : "NONE";
  }
  const decision = result.decision;
  if (decision === null) return "NONE";
  if (decision.state === "RECOMMEND_COURSE") return "MATCHED";
  if (decision.state === "NO_CURRENT_COURSE_MATCH") return "NO_MATCH";
  if (decision.state === "ASK_MORE" && decision.candidateCourseIds.length > 1) return "AMBIGUOUS";
  return "NONE";
}

function taskEvidenceLimitation(
  evidence: string,
  options: OrchestrateNavigatorOptions,
): string {
  if (options.profile?.addressMode === "TY") {
    return `Часть твоего сообщения («${evidence}») я в этом ответе не разобрал — задай её, пожалуйста, отдельным сообщением.`;
  }
  return undispatchedLineText(evidence);
}

function recoveryLimitationText(
  segment: RecoverySegment,
  options: OrchestrateNavigatorOptions,
): string {
  const evidence = segment.evidenceSpan ?? "";
  if (options.profile?.addressMode !== "TY") {
    return segment.kind === "LINE" ? segment.text : undispatchedLineText(evidence);
  }
  if (segment.kind === "LINE" && segment.lineKind === "PAYMENT") {
    return "Об оплате и записи: в этом ответе я не даю платёжных ссылок и не оформляю оплату. Если хочешь оплатить курс, напиши об этом отдельным сообщением с названием курса.";
  }
  if (segment.kind === "LINE" && segment.lineKind === "RECOMMEND") {
    return "Подходит ли тебе курс, лучше решить отдельно: опиши, пожалуйста, твою задачу, и я помогу с выбором.";
  }
  return taskEvidenceLimitation(evidence, options);
}

type CompletedPlanRecovery = Extract<
  IntentPlanRecoveryOutcome<NavigatorOrchestrationResult>,
  { disposition: "RECOVERED_SINGLE_ACT" | "RECOVERED_COMPOSED" }
>;

function finalizeRecoveredPlan(
  execution: CompletedPlanRecovery,
  options: OrchestrateNavigatorOptions,
  mode: PlanRecoveryMode,
  latestUserText: string,
  planSnapshot: unknown,
): NavigatorOrchestrationResult {
  const primary = execution.primarySegmentIndex === null ? null
    : execution.dispatchResults[execution.primarySegmentIndex];
  const owner = execution.commitPrimary ? primary?.value ?? null : null;
  const neutral = emptyResult(
    composeTechnicalErrorAnswer(options.profile, true),
    { state: "ROUTER_DEGRADED" }, "DETERMINISTIC_CONTROL",
  );
  // A failed primary never promotes a secondary's binding/decision/provenance.
  const base = owner ?? {
    ...neutral, decision: null, clarification: NOT_APPLICABLE_CLARIFICATION,
    stateEffects: { catalogAuthorityVersion: null, transactionalAuthorityVersion: null, pendingConfirmation: null },
  };
  const outcomes: TaskOutcome[] = [];
  const pieces: ResponsePiece[] = [];
  for (const [index, segment] of execution.segments.entries()) {
    const result = execution.dispatchResults[index];
    const metadataIntent = segment.kind === "ACT" && segment.act.state === "FACTUAL"
      ? segment.act.intents.find((intent) => intent.kind === "CURRENT_METADATA")
      : undefined;
    const blockUnauthorizedMetadata =
      mode === "NON_F1" &&
      segment.kind === "ACT" &&
      metadataIntent?.kind === "CURRENT_METADATA" &&
      !nonF1MetadataSegmentIsGrounded(segment, planSnapshot, latestUserText);
    const effectiveResult = blockUnauthorizedMetadata ? null : result;
    const origin = effectiveResult?.answerOrigin ?? "DETERMINISTIC_CONTROL";
    const taskOutcomes = segment.taskIndices.map((taskIndex) => {
      const task = execution.activeTasks[taskIndex];
      const limitationReason = segment.kind === "LINE"
        ? segment.lineKind === "PAYMENT" ? "PAYMENT_TASK_NOT_DISPATCHED_IN_COMPOSITION" as const
          : segment.lineKind === "RECOMMEND" ? "SELECTION_TASK_NOT_DISPATCHED_IN_COMPOSITION" as const
            : segment.validatorRejection !== null ? "VALIDATOR_DEMOTED" as const : "EVIDENCE_OR_COURSE_UNDISPATCHED" as const
        : effectiveResult === null ? "SEGMENT_DISPATCH_FAILED" as const : undefined;
      return outcomeForTask({
        task,
        taskIndex,
        selectedCourseId:
          mode === "NON_F1" && isMetadataTaskType(task.type)
            ? null
            : options.conversationState?.selectedCourseId ?? null,
        limitationReason,
        observation: segment.kind === "ACT" && effectiveResult !== null ? {
          answerOrigin: origin,
          decisionState: effectiveResult.value.decision?.state ?? null,
          evidenceChunkIds: effectiveResult.value.observability?.selectedEvidence.map((evidence) => evidence.chunkId) ?? [],
        } : undefined,
      });
    });
    outcomes.push(...taskOutcomes);
    // A merged segment keeps only the first task's evidence span. On the
    // non-F-1 path a refused segment must still show every accepted task.
    if (
      mode === "NON_F1" &&
      segment.kind === "ACT" &&
      effectiveResult === null &&
      segment.taskIndices.length > 1
    ) {
      for (const taskOutcome of taskOutcomes) {
        const task = execution.activeTasks[taskOutcome.taskIndex];
        pieces.push({
          taskIndices: [taskOutcome.taskIndex],
          courseIds: taskOutcome.courseIds ?? [],
          comparison: false,
          answerOrigin: "LIMITATION",
          outcomeKinds: [taskOutcome.outcome],
          text: taskEvidenceLimitation(task.evidence, options),
        });
      }
      continue;
    }
    const metadata = segment.kind === "ACT" && segment.act.state === "FACTUAL"
      ? segment.act.intents.find((intent) => intent.kind === "CURRENT_METADATA") : undefined;
    if (metadata?.kind === "CURRENT_METADATA" && segment.taskIndices.length > 1 &&
        effectiveResult !== null && origin === "COMMERCIAL_AUTHORITY") {
      // F-1 SELECTED recovery may render the stored course. NON_F1 must not inherit it.
      const renderedCourseId = mode === "F1"
        ? options.conversationState?.selectedCourseId ?? null
        : null;
      for (const taskOutcome of taskOutcomes) {
        const task = execution.activeTasks[taskOutcome.taskIndex];
        const text = composeFactualAnswer([{ ...metadata, fields: [task.type as typeof metadata.fields[number]] }],
          renderedCourseId, options.profile, task.evidence);
        pieces.push({
          taskIndices: [taskOutcome.taskIndex], courseIds: taskOutcome.courseIds ?? [],
          comparison: false, answerOrigin: origin, outcomeKinds: [taskOutcome.outcome],
          text: text.split("\n").join("\n\n"),
        });
      }
      continue;
    }
    pieces.push({
      taskIndices: segment.taskIndices,
      courseIds: [...new Set(taskOutcomes.flatMap((outcome) => outcome.courseIds ?? []))],
      comparison: segment.kind === "ACT" && segment.act.state === "FACTUAL" &&
        segment.act.intents.some((intent) => intent.kind === "COURSE_COMPARISON"),
      answerOrigin: segment.kind === "LINE" || effectiveResult === null ? "LIMITATION" : origin,
      outcomeKinds: taskOutcomes.map((outcome) => outcome.outcome),
      text: segment.kind === "ACT" && effectiveResult !== null ? effectiveResult.message! : recoveryLimitationText(segment, options),
    });
  }
  const coverage = accountTaskOutcomes(execution.activeTasks, outcomes);
  const assembled = assembleTaskResponse(pieces);
  const displayedTasks = new Set(assembled.blocks.flatMap((block) => block.taskIndices));
  if (displayedTasks.size !== execution.activeTasks.length) {
    throw new Error("A recovered task has an outcome but no displayed answer or limitation.");
  }
  const remainder = mode === "NON_F1"
    ? uncoveredLatestRemainder(
        latestUserText,
        execution.activeTasks.map((task) => task.evidence),
      )
    : null;
  const message = remainder === null
    ? assembled.message
    : `${assembled.message}\n\n${undispatchedLineText(remainder)}`;
  const completion: TurnCompletion = coverage.limitationCount > 0
    ? "PARTIAL_WITH_EXPLICIT_LIMITATIONS"
    : base.completion === "USER_ACTION_REQUIRED"
      ? "USER_ACTION_REQUIRED"
      : "ANSWERED";
  return {
    ...base,
    message,
    taskCoverage: coverage,
    taskResponseBlocks: assembled.blocks,
    completion,
  };
}
