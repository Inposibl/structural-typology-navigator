import type { ConversationMessage } from "../chat-contract.ts";
import {
  getAcademyCourse,
  type AcademyCourse,
} from "../academy/course-catalog.ts";
import { getPublicCourseOutcomes } from "../academy/public-course-outcomes.ts";
import type { ResolvedCourseEvidence } from "../knowledge/retrieval/authority-resolver.ts";
import type { CourseEvidenceSelection } from "../knowledge/retrieval/evidence-selector.ts";
import type { NavigationDecision } from "./navigation-decision.ts";

export type ComposeNavigatorAnswerOptions = {
  courseEvidence?: readonly ResolvedCourseEvidence[];
  evidenceSelection?: CourseEvidenceSelection;
  hasActiveCourseSources?: boolean;
  showEvidence?: boolean;
};

function russianQuestionBlock(questions: readonly string[]): string {
  if (questions.length === 1) {
    return questions[0];
  }

  return questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join("\n");
}

function courseReference(course: AcademyCourse): string {
  if (!course.url) {
    throw new Error(`Routable course ${course.id} is missing a public URL.`);
  }
  return `«${course.title}» — ${course.url}`;
}

function outcomeSentence(course: AcademyCourse): string {
  const outcomes = getPublicCourseOutcomes(course);
  if (outcomes.length === 0) {
    return "";
  }

  return `По программе курса его учебные результаты включают: ${outcomes.join(
    "; ",
  )}.`;
}

function secondarySequence(courseIds: readonly string[]): string {
  if (courseIds.length === 0) {
    return "";
  }

  const courses = courseIds.map((courseId) => {
    const course = getAcademyCourse(courseId);
    if (!course || course.status !== "ROUTABLE") {
      throw new Error("Validated secondary course is unavailable.");
    }
    return courseReference(course);
  });

  return `Если идти дальше по подтверждённой последовательности Академии: ${courses.join(
    " → ",
  )}.`;
}

function sourceProvenance(source: ResolvedCourseEvidence): string {
  const primary =
    typeof source.locator.primary === "object" &&
    source.locator.primary !== null &&
    !Array.isArray(source.locator.primary)
      ? (source.locator.primary as Record<string, unknown>)
      : {};

  const parts: string[] = [];
  if (Number.isInteger(primary.questionNumber)) {
    parts.push(`вопрос ${String(primary.questionNumber)}`);
  }
  if (Number.isInteger(primary.pdfPageStart)) {
    parts.push(`PDF стр. ${String(primary.pdfPageStart)}`);
  }
  if (Number.isInteger(primary.pageStart)) {
    parts.push(`стр. ${String(primary.pageStart)}`);
  }
  if (Number.isInteger(primary.slideStart)) {
    parts.push(`слайд ${String(primary.slideStart)}`);
  }

  return parts.length > 0
    ? `${source.sourceTitle} (${parts.join(", ")})`
    : source.sourceTitle;
}

function evidenceSentence(
  selection: CourseEvidenceSelection | undefined,
  evidence: readonly ResolvedCourseEvidence[] | undefined,
): string {
  if (!selection || selection.status !== "SUPPORTED" || !evidence) {
    return "";
  }

  const byChunkId = new Map(evidence.map((item) => [item.chunkId, item]));

  const lines = selection.evidence.map((item) => {
    const source = byChunkId.get(item.chunkId);
    if (!source) {
      throw new Error("Selected evidence chunk is unavailable.");
    }

    return `• «${item.quote}» — ${sourceProvenance(source)}`;
  });

  return [
    "В подключённых материалах этого курса есть прямое содержательное основание для такой учебной задачи:",
    ...lines,
  ].join("\n");
}

export async function composeNavigatorAnswer(
  _messages: readonly ConversationMessage[],
  decision: NavigationDecision,
  options: ComposeNavigatorAnswerOptions = {},
): Promise<string> {
  if (decision.state === "ASK_MORE") {
    return [
      "Чтобы выбрать учебную траекторию без натяжки, мне нужно уточнить несколько вещей.",
      russianQuestionBlock(decision.questions),
    ].join("\n\n");
  }

  if (decision.state === "NO_CURRENT_COURSE_MATCH") {
    return "По тому, что вы описали, я сейчас не вижу в текущем каталоге Академии курса, который можно было бы честно рекомендовать без натяжки.";
  }

  const primary = getAcademyCourse(decision.primaryCourseId);
  if (!primary || primary.status !== "ROUTABLE") {
    throw new Error("Validated primary course is unavailable.");
  }

  const parts = [
    `Из того, что вы описали, ключевая учебная задача сейчас — ${decision.learningNeed}`,
    `В текущем каталоге Академии ей соответствует курс ${courseReference(primary)}.`,
    options.showEvidence
      ? evidenceSentence(options.evidenceSelection, options.courseEvidence)
      : "",
    outcomeSentence(primary),
    secondarySequence(decision.secondaryCourseIds),
  ].filter(Boolean);

  return parts.join("\n\n");
}
