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
  type ComposeCourseFollowUpOptions,
} from "./conversation-response.ts";
import {
  CLARIFICATION_BUDGET,
  clarificationIssueKey,
} from "./conversation-state.ts";
import {
  composeAcademyContactAnswer,
  detectAcademyContactIntent,
} from "../academy/contact-policy.ts";
import {
  composeEnrollmentPaymentAnswer,
  resolveEnrollmentPaymentDecision,
} from "../academy/payment-policy.ts";
import type {
  ConversationState,
  PendingConfirmation,
} from "./conversation-state.ts";
import {
  createNavigatorDegradationLog,
  isRecoverableEvidenceSelectionFailure,
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
  conversationState?: Pick<
    ConversationState,
    | "courseMatch"
    | "selectedCourseId"
    | "staleReference"
    | "catalogAuthorityVersion"
    | "transactionalAuthorityVersion"
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
): Promise<CourseEvidenceSelection> {
  try {
    return await withNavigatorStage("EVIDENCE_LLM", () =>
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
      status: "INSUFFICIENT",
      evidence: [],
    };
  }
}

function emptyResult(
  message: string,
  conversationAct: ConversationActDecision,
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
    clarification: NOT_APPLICABLE_CLARIFICATION,
    stateEffects: {
      catalogAuthorityVersion: stateEffects.catalogAuthorityVersion ?? null,
      transactionalAuthorityVersion:
        stateEffects.transactionalAuthorityVersion ?? null,
      pendingConfirmation: stateEffects.pendingConfirmation ?? null,
    },
  };
}

const NOT_APPLICABLE_CLARIFICATION: OrchestrationClarificationOutcome = {
  status: "NOT_APPLICABLE",
  issueKey: null,
  attempts: 0,
  question: null,
};

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

  const conversationAct = await withNavigatorStage("ACT_ROUTER", () =>
    classifyAct(messages, {
      env: options.env,
      fetch: options.fetch,
      signal: options.signal,
    }),
  );

  const query = lastUserMessage(messages);
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
      )
    : null;
  const factualUsesTransactionalAuthority =
    conversationAct.state === "FACTUAL" &&
    conversationAct.intents.some((intent) => intent.kind === "CURRENT_METADATA");
  const combineFactual = (message: string): string =>
    factualMessage === null ? message : `${factualMessage}\n\n${message}`;

  if (paymentDecision.kind === "ACTION") {
    return emptyResult(
      combineFactual(composeEnrollmentPaymentAnswer(paymentDecision.action)),
      conversationAct,
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
      combineFactual(composePaymentAmbiguityAnswer()),
      conversationAct,
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
    );
    return emptyResult(combineFactual(prompt), conversationAct, null, {
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
      combineFactual(composePaymentCourseIdentityRequiredAnswer()),
      conversationAct,
    );
  }

  if (paymentDecision.kind === "COURSE_NOT_PAYABLE") {
    const course = getAcademyCourse(paymentDecision.courseId);
    return emptyResult(
      combineFactual(
        composePaymentUnavailableAnswer(course?.title ?? paymentDecision.courseId),
      ),
      conversationAct,
    );
  }

  if (conversationAct.state === "FACTUAL") {
    return emptyResult(factualMessage ?? "", conversationAct, null, {
      catalogAuthorityVersion: ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
      transactionalAuthorityVersion: factualUsesTransactionalAuthority
        ? ACADEMY_COMMERCIAL_AUTHORITY_VERSION
        : null,
    });
  }

  const contactIntent = detectAcademyContactIntent(query, {
    hasCourseContext:
      conversationAct.state === "COURSE_FOLLOW_UP",
  });

  if (
    contactIntent &&
    conversationAct.state !== "NAVIGATE"
  ) {
    const contact = composeAcademyContactAnswer(contactIntent);
    return emptyResult(
      contact.message,
      conversationAct,
      contact.contactCard,
    );
  }

  if (conversationAct.state === "OUT_OF_SCOPE") {
    return emptyResult(
      composeNavigatorOutOfScopeAnswer(),
      conversationAct,
    );
  }

  if (conversationAct.state === "META") {
    return emptyResult(
      composeNavigatorMetaAnswer(),
      conversationAct,
    );
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

    if (courseKnowledge.hasActiveSources) {
      resolvedEvidence = await withNavigatorStage("AUTHORITY", () =>
        resolve(courseKnowledge.matches, 8),
      );

      if (resolvedEvidence.length > 0) {
        evidenceSelection = await selectEvidenceOrDegrade(
          query,
          resolvedEvidence,
          selectEvidence,
          options,
        );
      } else {
        evidenceSelection = {
          status: "INSUFFICIENT",
          evidence: [],
        };
      }
    }

    const message = await withNavigatorStage("FOLLOW_UP", () =>
      composeFollowUp(messages, conversationAct, {
        env: options.env,
        fetch: options.fetch,
        signal: options.signal,
        courseEvidence: resolvedEvidence,
        evidenceSelection,
        profile: options.profile,
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
        evidenceSelection = await selectEvidenceOrDegrade(
          decision.learningNeed,
          resolvedEvidence,
          selectEvidence,
          options,
        );
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
