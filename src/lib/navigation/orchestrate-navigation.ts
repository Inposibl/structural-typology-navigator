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
  createNavigatorDegradationLog,
  isRecoverableEvidenceSelectionFailure,
  withNavigatorStage,
} from "./navigator-observability.ts";

export type NavigatorOrchestrationResult = {
  message: string;
  decision: NavigationDecision;
  courseEvidenceCount: number;
  courseHadActiveSources: boolean;
  evidenceSelectionStatus: CourseEvidenceSelection["status"] | "NOT_RUN";
};

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

export type OrchestrationDependencies = {
  route?: RouteDependency;
  retrieve?: RetrieveDependency;
  resolve?: ResolveDependency;
  selectEvidence?: SelectEvidenceDependency;
  compose?: ComposeDependency;
};

export type OrchestrateNavigatorOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  requestId?: string;
  dependencies?: OrchestrationDependencies;
};

export async function orchestrateNavigatorResponse(
  messages: readonly ConversationMessage[],
  options: OrchestrateNavigatorOptions = {},
): Promise<NavigatorOrchestrationResult> {
  const route = options.dependencies?.route ?? routeEducationalNavigation;
  const retrieve =
    options.dependencies?.retrieve ?? retrieveCourseKnowledge;
  const resolve = options.dependencies?.resolve ?? resolveCourseEvidence;
  const selectEvidence =
    options.dependencies?.selectEvidence ?? selectCourseEvidence;
  const compose = options.dependencies?.compose ?? composeNavigatorAnswer;

  // Critical anti-bias invariant: no course knowledge retrieval before routing.
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
    courseKnowledge = await withNavigatorStage("COURSE_RPC", () =>
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

    if (courseKnowledge.hasActiveSources) {
      const courseMatches = courseKnowledge.matches;
      resolvedEvidence = await withNavigatorStage("AUTHORITY", () =>
        resolve(courseMatches, 8),
      );

      if (resolvedEvidence.length > 0) {
        try {
          evidenceSelection = await withNavigatorStage("EVIDENCE_LLM", () =>
            selectEvidence(
              decision.learningNeed,
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

          // Evidence enrichment is optional. A selector payload that fails
          // strict grounding validation is discarded in full; the already
          // validated course recommendation remains available without a
          // source quote.
          evidenceSelection = {
            status: "INSUFFICIENT",
            evidence: [],
          };

          if (options.requestId) {
            console.warn(
              JSON.stringify(
                createNavigatorDegradationLog(error, options.requestId),
              ),
            );
          }
        }
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
    }),
  );

  return {
    message,
    decision,
    courseEvidenceCount: resolvedEvidence.length,
    courseHadActiveSources: courseKnowledge?.hasActiveSources ?? false,
    evidenceSelectionStatus: evidenceSelection?.status ?? "NOT_RUN",
  };
}
