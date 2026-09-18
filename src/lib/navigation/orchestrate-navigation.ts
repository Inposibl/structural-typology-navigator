import type { ConversationMessage } from "../chat-contract.ts";
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
  composeCourseFollowUpAnswer,
  composeNavigatorMetaAnswer,
  composeNavigatorOutOfScopeAnswer,
  type ComposeCourseFollowUpOptions,
} from "./conversation-response.ts";
import {
  createNavigatorDegradationLog,
  isRecoverableEvidenceSelectionFailure,
  withNavigatorStage,
} from "./navigator-observability.ts";

export type NavigatorOrchestrationResult = {
  message: string;
  conversationAct: ConversationActDecision;
  decision: NavigationDecision | null;
  courseEvidenceCount: number;
  courseHadActiveSources: boolean;
  evidenceSelectionStatus: CourseEvidenceSelection["status"] | "NOT_RUN";
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

  if (conversationAct.state === "OUT_OF_SCOPE") {
    return {
      message: composeNavigatorOutOfScopeAnswer(),
      conversationAct,
      decision: null,
      courseEvidenceCount: 0,
      courseHadActiveSources: false,
      evidenceSelectionStatus: "NOT_RUN",
    };
  }

  if (conversationAct.state === "META") {
    return {
      message: composeNavigatorMetaAnswer(),
      conversationAct,
      decision: null,
      courseEvidenceCount: 0,
      courseHadActiveSources: false,
      evidenceSelectionStatus: "NOT_RUN",
    };
  }

  if (conversationAct.state === "COURSE_FOLLOW_UP") {
    const query = lastUserMessage(messages);
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
      }),
    );

    return {
      message,
      conversationAct,
      decision: null,
      courseEvidenceCount: resolvedEvidence.length,
      courseHadActiveSources: courseKnowledge.hasActiveSources,
      evidenceSelectionStatus:
        evidenceSelection?.status ?? "NOT_RUN",
    };
  }

  // Critical anti-bias invariant: no course knowledge retrieval before
  // educational routing.
  const decision = await withNavigatorStage("ROUTER", () =>
    route(messages, {
      env: options.env,
      fetch: options.fetch,
      signal: options.signal,
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

  const message = await withNavigatorStage("COMPOSER", () =>
    compose(messages, decision, {
      courseEvidence: resolvedEvidence,
      evidenceSelection,
      hasActiveCourseSources: courseKnowledge?.hasActiveSources ?? false,
      showEvidence: false,
    }),
  );

  return {
    message,
    conversationAct,
    decision,
    courseEvidenceCount: resolvedEvidence.length,
    courseHadActiveSources: courseKnowledge?.hasActiveSources ?? false,
    evidenceSelectionStatus: evidenceSelection?.status ?? "NOT_RUN",
  };
}
