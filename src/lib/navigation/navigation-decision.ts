import type { ConversationMessage } from "../chat-contract.ts";
import {
  isContiguousOfficialCourseSequence,
  isRecommendableCourseId,
} from "../academy/course-catalog.ts";

export type NavigationEvidence = {
  messageIndex: number;
  quote: string;
};

export type NavigationDecision =
  | {
      state: "ASK_MORE";
      candidateCourseIds: string[];
      questions: string[];
      rationale: string;
    }
  | {
      state: "RECOMMEND_COURSE";
      primaryCourseId: string;
      secondaryCourseIds: string[];
      learningNeed: string;
      evidence: NavigationEvidence[];
      confidence: "sufficient" | "strong";
    }
  | {
      state: "NO_CURRENT_COURSE_MATCH";
      rationale: string;
    };

export class NavigationDecisionValidationError extends Error {
  readonly code = "INVALID_NAVIGATION_DECISION";

  constructor(message: string) {
    super(message);
    this.name = "NavigationDecisionValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function readStringArray(
  value: unknown,
  fieldName: string,
  options: { min?: number; max?: number } = {},
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new NavigationDecisionValidationError(
      `${fieldName} must be a string array.`,
    );
  }

  const normalized = value.map((item) => item.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new NavigationDecisionValidationError(
      `${fieldName} must not contain duplicates.`,
    );
  }
  if (options.min !== undefined && normalized.length < options.min) {
    throw new NavigationDecisionValidationError(
      `${fieldName} must contain at least ${options.min} item(s).`,
    );
  }
  if (options.max !== undefined && normalized.length > options.max) {
    throw new NavigationDecisionValidationError(
      `${fieldName} must contain at most ${options.max} item(s).`,
    );
  }
  return normalized;
}

function readEvidenceArray(value: unknown): NavigationEvidence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new NavigationDecisionValidationError(
      "evidence must contain between 1 and 6 grounded items.",
    );
  }

  const result: NavigationEvidence[] = [];
  const identities = new Set<string>();

  for (const item of value) {
    if (
      !isRecord(item) ||
      !onlyKeys(item, ["messageIndex", "quote"]) ||
      !Number.isInteger(item.messageIndex) ||
      (item.messageIndex as number) < 0 ||
      typeof item.quote !== "string" ||
      !item.quote.trim()
    ) {
      throw new NavigationDecisionValidationError(
        "Each evidence item must contain a non-negative integer messageIndex and a non-empty quote.",
      );
    }

    const normalized = {
      messageIndex: item.messageIndex as number,
      quote: item.quote.trim(),
    };
    const identity = `${normalized.messageIndex}:${normalized.quote}`;
    if (identities.has(identity)) {
      throw new NavigationDecisionValidationError(
        "evidence must not contain duplicates.",
      );
    }
    identities.add(identity);
    result.push(normalized);
  }

  return result;
}

function assertGroundedEvidence(
  evidence: readonly NavigationEvidence[],
  messages: readonly ConversationMessage[],
): void {
  for (const item of evidence) {
    const message = messages[item.messageIndex];

    if (!message || message.role !== "user") {
      throw new NavigationDecisionValidationError(
        `Evidence messageIndex ${item.messageIndex} must reference a user message.`,
      );
    }

    if (!message.content.includes(item.quote)) {
      throw new NavigationDecisionValidationError(
        `Evidence quote is not verbatim grounded in user message ${item.messageIndex}.`,
      );
    }
  }
}

export function validateNavigationDecision(
  value: unknown,
  messages?: readonly ConversationMessage[],
): NavigationDecision {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new NavigationDecisionValidationError(
      "Navigation decision must be an object with a state.",
    );
  }

  if (value.state === "ASK_MORE") {
    if (
      !onlyKeys(value, [
        "state",
        "candidateCourseIds",
        "questions",
        "rationale",
      ])
    ) {
      throw new NavigationDecisionValidationError(
        "ASK_MORE contains unsupported fields.",
      );
    }

    const candidateCourseIds = readStringArray(
      value.candidateCourseIds ?? [],
      "candidateCourseIds",
      { max: 2 },
    );
    if (candidateCourseIds.some((courseId) => !isRecommendableCourseId(courseId))) {
      throw new NavigationDecisionValidationError(
        "ASK_MORE contains an unknown or unroutable candidate course.",
      );
    }

    const questions = readStringArray(value.questions, "questions", {
      min: 1,
      max: 3,
    });

    if (typeof value.rationale !== "string" || !value.rationale.trim()) {
      throw new NavigationDecisionValidationError(
        "ASK_MORE rationale is required.",
      );
    }

    return {
      state: "ASK_MORE",
      candidateCourseIds,
      questions,
      rationale: value.rationale.trim(),
    };
  }

  if (value.state === "RECOMMEND_COURSE") {
    if (
      !onlyKeys(value, [
        "state",
        "primaryCourseId",
        "secondaryCourseIds",
        "learningNeed",
        "evidence",
        "confidence",
      ])
    ) {
      throw new NavigationDecisionValidationError(
        "RECOMMEND_COURSE contains unsupported fields.",
      );
    }

    if (
      typeof value.primaryCourseId !== "string" ||
      !value.primaryCourseId.trim()
    ) {
      throw new NavigationDecisionValidationError(
        "primaryCourseId is required.",
      );
    }

    const primaryCourseId = value.primaryCourseId.trim();
    if (!isRecommendableCourseId(primaryCourseId)) {
      throw new NavigationDecisionValidationError(
        "primaryCourseId is unknown or not routable.",
      );
    }

    const secondaryCourseIds = readStringArray(
      value.secondaryCourseIds ?? [],
      "secondaryCourseIds",
      { max: 3 },
    );

    if (
      secondaryCourseIds.includes(primaryCourseId) ||
      secondaryCourseIds.some((courseId) => !isRecommendableCourseId(courseId))
    ) {
      throw new NavigationDecisionValidationError(
        "secondaryCourseIds contain an invalid course.",
      );
    }

    const courseSequence = [primaryCourseId, ...secondaryCourseIds];
    if (!isContiguousOfficialCourseSequence(courseSequence)) {
      throw new NavigationDecisionValidationError(
        "Recommended multi-course sequence is not contiguous in an official track.",
      );
    }

    if (typeof value.learningNeed !== "string" || !value.learningNeed.trim()) {
      throw new NavigationDecisionValidationError("learningNeed is required.");
    }

    const evidence = readEvidenceArray(value.evidence);
    if (messages) {
      assertGroundedEvidence(evidence, messages);
    }

    if (value.confidence !== "sufficient" && value.confidence !== "strong") {
      throw new NavigationDecisionValidationError(
        "confidence must be sufficient or strong.",
      );
    }

    return {
      state: "RECOMMEND_COURSE",
      primaryCourseId,
      secondaryCourseIds,
      learningNeed: value.learningNeed.trim(),
      evidence,
      confidence: value.confidence,
    };
  }

  if (value.state === "NO_CURRENT_COURSE_MATCH") {
    if (!onlyKeys(value, ["state", "rationale"])) {
      throw new NavigationDecisionValidationError(
        "NO_CURRENT_COURSE_MATCH contains unsupported fields.",
      );
    }

    if (typeof value.rationale !== "string" || !value.rationale.trim()) {
      throw new NavigationDecisionValidationError(
        "NO_CURRENT_COURSE_MATCH rationale is required.",
      );
    }

    return {
      state: "NO_CURRENT_COURSE_MATCH",
      rationale: value.rationale.trim(),
    };
  }

  throw new NavigationDecisionValidationError(
    `Unsupported navigation state: ${String(value.state)}.`,
  );
}
