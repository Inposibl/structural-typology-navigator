import type { NavigatorAnswerOrigin } from "./navigator-observability.ts";
import type { TaskPlanTask, TaskPlanType } from "./task-plan.ts";
import { getAcademyCourse, ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE } from "../academy/course-catalog.ts";
import { isAcademyCourseId } from "../academy/course-reference.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
  getAuthoritativeCoursePrice,
} from "../academy/commercial-authority.ts";

export const COVERAGE_GUARANTEE =
  "Every ACTIVE task of an accepted task plan receives exactly one deterministic outcome.";
export const COVERAGE_NON_CLAIM =
  "Outcome accounting does not prove that the plan extracted every task present in the student's message; extraction completeness is UNKNOWN.";
export const TASK_OUTCOME_KINDS = [
  "ANSWERED_FROM_EVIDENCE", "ANSWERED_FROM_AUTHORITY", "LIMITED_BY_FACTUAL_CEILING",
  "LEGITIMATELY_UNRESOLVED", "NOT_SAFELY_EXECUTABLE",
] as const;
export type TaskOutcomeKind = (typeof TASK_OUTCOME_KINDS)[number];
export const TASK_OUTCOME_REASONS = [
  "RAG_EVIDENCE", "CATALOG_OR_COMMERCIAL_AUTHORITY", "FACTUAL_CEILING", "NON_CATALOG_OBJECT",
  "PAYMENT_TASK_NOT_DISPATCHED_IN_COMPOSITION", "SELECTION_TASK_NOT_DISPATCHED_IN_COMPOSITION",
  "EVIDENCE_OR_COURSE_UNDISPATCHED", "VALIDATOR_DEMOTED", "POLICY_DIVERTED_SEGMENT",
  "SEGMENT_DISPATCH_FAILED", "MISSING_AUTHORITATIVE_FIELD", "COURSE_NOT_RESOLVED",
  "WHOLE_TURN_REFUSED", "PAYMENT_POLICY_AUTHORITY", "SELECTION_CLARIFICATION",
] as const;
export type TaskOutcomeReason = (typeof TASK_OUTCOME_REASONS)[number];
export type TaskFact = {
  courseId: string | null;
  field: "PRICE" | "SCHEDULE" | "COHORT" | "ENROLLMENT_WINDOW";
  status: "SUPPORTED" | "UNAVAILABLE";
  authorityVersion: string;
};
export type TaskOutcome = {
  taskIndex: number;
  taskType: TaskPlanType;
  outcome: TaskOutcomeKind;
  reasonCode: TaskOutcomeReason;
  /** Required by production descriptor-based accounting; optional for legacy unit callers. */
  taskId?: string;
  courseIds?: string[];
  evidenceSpan?: string;
  authorityVersion?: string | null;
  evidenceChunkIds?: number[];
  facts?: TaskFact[];
};
export type TaskCoverageRecord = {
  activeTaskCount: number;
  outcomes: TaskOutcome[];
  limitationCount: number;
  allTasksAccounted: true;
};
export const taskIdentity = (index: number): string => `task-${index + 1}`;
export function isLimitationOutcome(outcome: TaskOutcomeKind): boolean {
  return outcome !== "ANSWERED_FROM_EVIDENCE" && outcome !== "ANSWERED_FROM_AUTHORITY";
}

/** Production passes complete task descriptors, so identity and attribution are checked too. */
export function accountTaskOutcomes(
  activeTasks: readonly (TaskPlanType | TaskPlanTask)[],
  entries: readonly TaskOutcome[],
): TaskCoverageRecord {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (!Number.isInteger(entry.taskIndex) || entry.taskIndex < 0 || entry.taskIndex >= activeTasks.length) {
      throw new Error("Task outcome references an unknown ACTIVE task index.");
    }
    if (seen.has(entry.taskIndex)) throw new Error("Task outcome accounting double-counts a task.");
    const task = activeTasks[entry.taskIndex];
    if (entry.taskType !== (typeof task === "string" ? task : task.type)) {
      throw new Error("Task outcome task type does not match the plan task.");
    }
    if (!TASK_OUTCOME_KINDS.includes(entry.outcome) || !TASK_OUTCOME_REASONS.includes(entry.reasonCode)) {
      throw new Error("Task outcome contains an unknown status or reason.");
    }
    if (typeof task !== "string") {
      if (entry.taskId !== taskIdentity(entry.taskIndex) || entry.evidenceSpan !== task.evidence ||
          !Array.isArray(entry.courseIds) || entry.courseIds.some((id) => !isAcademyCourseId(id)) ||
          (task.courseIds.length > 0 && JSON.stringify([...entry.courseIds].sort()) !== JSON.stringify([...task.courseIds].sort()))) {
        throw new Error("Task outcome identity or course attribution does not match its task.");
      }
    }
    if (!isLimitationOutcome(entry.outcome) && entry.facts?.some((fact) => fact.status !== "SUPPORTED")) {
      throw new Error("An unavailable factual component cannot be recorded as answered.");
    }
    if (entry.outcome === "ANSWERED_FROM_EVIDENCE" && entry.reasonCode !== "RAG_EVIDENCE") {
      throw new Error("Task evidence outcome contradicts its reason.");
    }
    seen.add(entry.taskIndex);
  }
  if (seen.size !== activeTasks.length) throw new Error("Task outcome accounting is missing an ACTIVE task.");
  return {
    activeTaskCount: activeTasks.length,
    outcomes: [...entries].sort((a, b) => a.taskIndex - b.taskIndex),
    limitationCount: entries.filter((entry) => isLimitationOutcome(entry.outcome)).length,
    allTasksAccounted: true,
  };
}

export function outcomeForAnswerOrigin(
  origin: NavigatorAnswerOrigin,
): { outcome: TaskOutcomeKind; reasonCode: TaskOutcomeReason } {
  switch (origin) {
    case "RAG_EVIDENCE": return { outcome: "ANSWERED_FROM_EVIDENCE", reasonCode: "RAG_EVIDENCE" };
    case "CATALOG_AUTHORITY":
    case "COMMERCIAL_AUTHORITY": return { outcome: "ANSWERED_FROM_AUTHORITY", reasonCode: "CATALOG_OR_COMMERCIAL_AUTHORITY" };
    case "FACTUAL_CEILING": return { outcome: "LIMITED_BY_FACTUAL_CEILING", reasonCode: "FACTUAL_CEILING" };
    case "OUT_OF_SCOPE":
    case "META": return { outcome: "LEGITIMATELY_UNRESOLVED", reasonCode: "NON_CATALOG_OBJECT" };
    default: return { outcome: "NOT_SAFELY_EXECUTABLE", reasonCode: "POLICY_DIVERTED_SEGMENT" };
  }
}

export type TaskExecutionObservation = {
  answerOrigin: NavigatorAnswerOrigin;
  evidenceChunkIds?: number[];
  decisionState?: string | null;
};

/** Field support comes from the unchanged authority, never a segment-wide origin or prose scan. */
export function outcomeForTask(input: {
  task: TaskPlanTask;
  taskIndex: number;
  selectedCourseId: string | null;
  observation?: TaskExecutionObservation;
  limitationReason?: TaskOutcomeReason;
}): TaskOutcome {
  const { task, taskIndex, observation } = input;
  const metadata = ["PRICE", "SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"].includes(task.type);
  const courseIds = task.courseIds.length > 0 ? [...task.courseIds]
    : metadata && input.selectedCourseId !== null && isAcademyCourseId(input.selectedCourseId)
      ? [input.selectedCourseId] : [];
  const base = {
    taskIndex, taskId: taskIdentity(taskIndex), taskType: task.type,
    courseIds, evidenceSpan: task.evidence,
    authorityVersion: null as string | null,
    evidenceChunkIds: observation?.evidenceChunkIds ?? [],
  };
  if (input.limitationReason !== undefined || observation === undefined) {
    return { ...base, outcome: "NOT_SAFELY_EXECUTABLE", reasonCode: input.limitationReason ?? "SEGMENT_DISPATCH_FAILED" };
  }
  if (metadata && (observation.answerOrigin === "COMMERCIAL_AUTHORITY" || observation.answerOrigin === "CATALOG_AUTHORITY")) {
    const field = task.type as TaskFact["field"];
    const facts: TaskFact[] = (courseIds.length > 0 ? courseIds : [null]).map((courseId) => {
      const availability = field === "PRICE"
        ? courseId !== null && isAcademyCourseId(courseId) ? getAuthoritativeCoursePrice(courseId) : null
        : ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata[
          field === "SCHEDULE" ? "schedule" : field === "COHORT" ? "cohort" : "enrollmentWindow"
        ];
      return { courseId, field, status: availability?.status === "SUPPORTED" ? "SUPPORTED" : "UNAVAILABLE", authorityVersion: ACADEMY_COMMERCIAL_AUTHORITY_VERSION };
    });
    const supported = facts.every((fact) => fact.status === "SUPPORTED");
    return {
      ...base, authorityVersion: ACADEMY_COMMERCIAL_AUTHORITY_VERSION, facts,
      outcome: supported ? "ANSWERED_FROM_AUTHORITY" : "LIMITED_BY_FACTUAL_CEILING",
      reasonCode: supported ? "CATALOG_OR_COMMERCIAL_AUTHORITY"
        : courseIds.length === 0 && field === "PRICE" ? "COURSE_NOT_RESOLVED" : "MISSING_AUTHORITATIVE_FIELD",
    };
  }
  if (task.type === "PAYMENT" && observation.answerOrigin === "PAYMENT_POLICY") {
    return { ...base, authorityVersion: ACADEMY_COMMERCIAL_AUTHORITY_VERSION, outcome: "ANSWERED_FROM_AUTHORITY", reasonCode: "PAYMENT_POLICY_AUTHORITY" };
  }
  if (task.type === "RECOMMEND" && observation.decisionState === "ASK_MORE") {
    return { ...base, outcome: "LEGITIMATELY_UNRESOLVED", reasonCode: "SELECTION_CLARIFICATION" };
  }
  return {
    ...base,
    authorityVersion: observation.answerOrigin === "CATALOG_AUTHORITY" ? ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE : null,
    ...outcomeForAnswerOrigin(observation.answerOrigin),
  };
}

export type ResponsePiece = {
  taskIndices: number[];
  courseIds: string[];
  comparison: boolean;
  answerOrigin: NavigatorAnswerOrigin | "LIMITATION";
  outcomeKinds: TaskOutcomeKind[];
  text: string;
};
export type SharedResponseBlock = { text: string; taskIndices: number[]; courseIds: string[] };

/**
 * Share presentation only within the same course/authority/outcome context.
 * Every contributing task retains its own factual outcome and block link.
 * Exact paragraph equality is a rendering optimization, never a coverage verdict.
 */
export function assembleTaskResponse(pieces: readonly ResponsePiece[]): {
  message: string;
  blocks: SharedResponseBlock[];
} {
  const groups = new Map<string, { courseIds: string[]; comparison: boolean; blocks: SharedResponseBlock[]; known: Map<string, SharedResponseBlock> }>();
  for (const piece of pieces) {
    const ids = [...piece.courseIds].sort();
    const key = JSON.stringify([ids, piece.comparison]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { courseIds: piece.courseIds, comparison: piece.comparison, blocks: [], known: new Map() };
      groups.set(key, group);
    }
    // Commercial tasks can share the same authority introduction while field
    // availability remains separate in their outcomes and field blocks.
    const context = JSON.stringify([piece.answerOrigin, piece.answerOrigin === "COMMERCIAL_AUTHORITY"
      ? null : [...new Set(piece.outcomeKinds)].sort()]);
    for (const text of piece.text.split(/\n\s*\n/u).filter((part) => part.trim().length > 0)) {
      const blockKey = JSON.stringify([context, text]);
      const prior = group.known.get(blockKey);
      if (prior !== undefined) {
        prior.taskIndices = [...new Set([...prior.taskIndices, ...piece.taskIndices])];
      } else {
        const block = { text, taskIndices: [...piece.taskIndices], courseIds: piece.courseIds };
        group.blocks.push(block);
        group.known.set(blockKey, block);
      }
    }
  }
  const sections = [...groups.values()].map((group) => {
    const text = group.blocks.map((block) => block.text).join("\n\n");
    if (groups.size === 1 || group.courseIds.length === 0) return text;
    const titles = group.courseIds.map((id) => `«${getAcademyCourse(id)?.title ?? id}»`).join(" и ");
    return `${group.comparison ? "Сравнение" : "По курсу"} ${titles}:\n\n${text}`;
  });
  return { message: sections.join("\n\n"), blocks: [...groups.values()].flatMap((group) => group.blocks) };
}

export type NavigatorPlanCoverageLog = {
  event: "NAVIGATOR_INTENT_PLAN_COVERAGE";
  requestId: string;
  activeTaskCount: number;
  limitationCount: number;
  allTasksAccounted: true;
};
export function createTaskCoverageLog(requestId: string, record: TaskCoverageRecord): NavigatorPlanCoverageLog {
  return {
    event: "NAVIGATOR_INTENT_PLAN_COVERAGE", requestId: requestId.slice(0, 80),
    activeTaskCount: record.activeTaskCount, limitationCount: record.limitationCount,
    allTasksAccounted: record.allTasksAccounted,
  };
}
