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
  type ConversationActDecision,
  type RouteConversationActOptions,
} from "./conversation-act-router.ts";
import {
  ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
  getAcademyCourse,
} from "../academy/course-catalog.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
} from "../academy/commercial-authority.ts";
import {
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
  resolveEnrollmentPaymentDecision,
} from "../academy/payment-policy.ts";
import type {
  ConversationState,
  PendingConfirmation,
} from "./conversation-state.ts";
import {
  createNavigatorDegradationLog,
  createNavigatorGroundingLog,
  createNavigatorRouterDegradationLog,
  isRecoverableConversationActFailure,
  isRecoverableEvidenceSelectionFailure,
  type NavigatorAnswerOrigin,
  type NavigatorGroundingDetails,
  type NavigatorTurnDetails,
  withNavigatorStage,
} from "./navigator-observability.ts";

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
};

export type OrchestrationStateEffects = {
  catalogAuthorityVersion: string | null;
  transactionalAuthorityVersion: string | null;
  pendingConfirmation: PendingConfirmation | null;
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
 */
async function classifyActOrDegrade(
  messages: readonly ConversationMessage[],
  classifyAct: ConversationActDependency,
  options: OrchestrateNavigatorOptions,
): Promise<ConversationActDecision> {
  try {
    return await withNavigatorStage("ACT_ROUTER", () =>
      classifyAct(messages, {
        env: options.env,
        fetch: options.fetch,
        signal: options.signal,
      }),
    );
  } catch (error) {
    if (!isRecoverableConversationActFailure(error)) {
      throw error;
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

function emptyResult(
  message: string,
  conversationAct: ConversationActDecision,
  answerOrigin: NavigatorAnswerOrigin,
  contactCard: AcademyContactCard | null = null,
  stateEffects: Partial<OrchestrationStateEffects> = {},
): NavigatorOrchestrationResult {
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
    clarification: NOT_APPLICABLE_CLARIFICATION,
    stateEffects: {
      catalogAuthorityVersion: stateEffects.catalogAuthorityVersion ?? null,
      transactionalAuthorityVersion:
        stateEffects.transactionalAuthorityVersion ?? null,
      pendingConfirmation: stateEffects.pendingConfirmation ?? null,
    },
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

export async function orchestrateNavigatorResponse(
  messages: readonly ConversationMessage[],
  options: OrchestrateNavigatorOptions = {},
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

  const conversationAct = await classifyActOrDegrade(
    messages,
    classifyAct,
    options,
  );

  const paymentDecision = resolveEnrollmentPaymentDecision(
    query,
    conversationAct,
    {
      selectedCourseId: options.conversationState?.selectedCourseId ?? null,
      courseMatch: options.conversationState?.courseMatch ?? "UNKNOWN",
      staleCourseReference:
        options.conversationState?.staleReference !== null &&
        options.conversationState?.staleReference !== undefined,
    },
  );

  const factualMessage = conversationAct.state === "FACTUAL"
    ? composeFactualAnswer(
        conversationAct.intents,
        options.conversationState?.selectedCourseId ?? null,
        options.profile,
      )
    : null;
  const factualUsesTransactionalAuthority =
    conversationAct.state === "FACTUAL" &&
    conversationAct.intents.some((intent) => intent.kind === "CURRENT_METADATA");
  const combineFactual = (message: string): string =>
    factualMessage === null ? message : `${factualMessage}\n\n${message}`;

  if (paymentDecision.kind === "ACTION") {
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
      },
    );
  }

  if (paymentDecision.kind === "CLARIFY_MULTIPLE") {
    return emptyResult(
      combineFactual(composePaymentAmbiguityAnswer(options.profile)),
      conversationAct,
      "PAYMENT_POLICY",
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
    conversationAct.state !== "NAVIGATE"
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

  // EXPERIMENT-1.ROUTER-ACCESS-1 — the fail-closed lane. The provider's act
  // decision was rejected, so nothing about it is trusted: no course is bound,
  // no retrieval runs, no evidence is resolved. The user gets the project's
  // existing technical-failure wording as an ordinary turn rather than a 503,
  // and the turn is recorded as degraded so the rate stays measurable.
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
        query,
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
          query,
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
    };
  }

  if (conversationAct.state === "COURSE_FOLLOW_UP") {
    const courseKnowledge = await withNavigatorStage("COURSE_RPC", () =>
      retrieve(
        conversationAct.courseId,
        query,
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
          query,
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

  const decision = await withNavigatorStage("ROUTER", () =>
    route(messages, {
      env: options.env,
      fetch: options.fetch,
      signal: options.signal,
      profile: options.profile,
    }),
  );

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
  };
}
