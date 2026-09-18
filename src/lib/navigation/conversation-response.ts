import type { ConversationMessage } from "../chat-contract.ts";
import {
  getAcademyCourse,
  type AcademyCourse,
} from "../academy/course-catalog.ts";
import { getPublicCourseOutcomes } from "../academy/public-course-outcomes.ts";
import type { ResolvedCourseEvidence } from "../knowledge/retrieval/authority-resolver.ts";
import type { CourseEvidenceSelection } from "../knowledge/retrieval/evidence-selector.ts";
import {
  callDeepSeekText,
  type DeepSeekClientOptions,
} from "./deepseek-client.ts";
import type { ConversationActDecision } from "./conversation-act-router.ts";

type CourseFollowUpAct = Extract<
  ConversationActDecision,
  { state: "COURSE_FOLLOW_UP" }
>;

export type ComposeCourseFollowUpOptions = DeepSeekClientOptions & {
  callText?: typeof callDeepSeekText;
  courseEvidence?: readonly ResolvedCourseEvidence[];
  evidenceSelection?: CourseEvidenceSelection;
};

export function composeNavigatorMetaAnswer(): string {
  return [
    "Навигатор нужен для выбора и объяснения учебного маршрута внутри Академии структурной типологии.",
    "Цитаты и ссылки на внутренние материалы не должны появляться в обычной рекомендации автоматически. Я показываю их только когда вы прямо просите основания, источники или конкретные выдержки из материалов курса.",
    "Если вопрос не относится к курсам Академии, Навигатор должен честно обозначить границу своей функции, а не притягивать новый вопрос к уже обсуждавшемуся курсу.",
  ].join("\n\n");
}

export function composeNavigatorOutOfScopeAnswer(): string {
  return [
    "Этот вопрос вне функции Навигатора: здесь я помогаю выбирать и понимать учебные маршруты Академии структурной типологии.",
    "Для общего поиска лучше использовать, например, Google или Perplexity; для диалогового разбора — универсальный ассистент вроде ChatGPT. Так вы получите более качественный ответ по теме, которая не относится к курсам Академии.",
  ].join("\n\n");
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

function selectedEvidence(
  selection: CourseEvidenceSelection | undefined,
  evidence: readonly ResolvedCourseEvidence[] | undefined,
): Array<{
  quote: string;
  source: string;
}> {
  if (!selection || selection.status !== "SUPPORTED" || !evidence) {
    return [];
  }

  const byChunkId = new Map(evidence.map((item) => [item.chunkId, item]));

  return selection.evidence.map((item) => {
    const source = byChunkId.get(item.chunkId);
    if (!source) {
      throw new Error("Selected follow-up evidence chunk is unavailable.");
    }

    return {
      quote: item.quote,
      source: sourceProvenance(source),
    };
  });
}

function coursePublicPayload(course: AcademyCourse) {
  return {
    id: course.id,
    title: course.title,
    url: course.url,
    learningNeeds: course.learningNeeds,
    publicOutcomes: getPublicCourseOutcomes(course),
  };
}

export async function composeCourseFollowUpAnswer(
  messages: readonly ConversationMessage[],
  act: CourseFollowUpAct,
  options: ComposeCourseFollowUpOptions = {},
): Promise<string> {
  const course = getAcademyCourse(act.courseId);
  if (!course || course.status !== "ROUTABLE") {
    throw new Error("Follow-up course is unavailable.");
  }

  const callText = options.callText ?? callDeepSeekText;
  const evidence = selectedEvidence(
    options.evidenceSelection,
    options.courseEvidence,
  );
  const latestUserMessage = messages.at(-1)?.content ?? "";

  const answer = await callText(
    [
      {
        role: "system",
        content: `Ты — публичный Навигатор Академии структурной типологии.

Ответь ТОЛЬКО на последнюю реплику пользователя как на follow-up по уже обсуждаемому курсу.
Не выбирай курс заново и не повторяй полный recommendation template.
Используй только переданные публичные сведения о курсе и, если есть, строго отобранные evidence excerpts.
Не выдумывай содержание курса.
Если данных недостаточно для точного ответа, скажи об этом прямо.
Если evidenceRequested=false, не показывай пользователю сырые цитаты, названия внутренних документов, страницы и provenance; evidence можно использовать только как внутреннее содержательное основание для краткого ответа.
Если evidenceRequested=true, можешь опираться на excerpts, но сам список точных цитат и provenance будет добавлен системой после твоего ответа.
Не раскрывай внутренние формулы, служебные labels или технические обозначения, если пользователь сам прямо о них не спрашивает.
Пиши по-русски, коротко и по существу.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            latestUserMessage,
            course: coursePublicPayload(course),
            evidenceRequested: act.evidenceRequested,
            evidenceStatus:
              options.evidenceSelection?.status ?? "NOT_AVAILABLE",
            evidence,
            conversation: messages,
          },
          null,
          2,
        ),
      },
    ],
    options,
  );

  if (!act.evidenceRequested || evidence.length === 0) {
    return answer;
  }

  return [
    answer,
    "Основание в подключённых материалах:",
    ...evidence.map(
      (item) => `• «${item.quote}» — ${item.source}`,
    ),
  ].join("\n\n");
}
