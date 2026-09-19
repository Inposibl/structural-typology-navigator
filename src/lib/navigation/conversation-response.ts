import type {
  ConversationMessage,
  ConversationProfile,
} from "../chat-contract.ts";
import {
  getAcademyCourse,
  type AcademyCourse,
} from "../academy/course-catalog.ts";
import type { ResolvedCourseEvidence } from "../knowledge/retrieval/authority-resolver.ts";
import type { CourseEvidenceSelection } from "../knowledge/retrieval/evidence-selector.ts";
import {
  callDeepSeekJson,
  callDeepSeekText,
  type DeepSeekClientOptions,
} from "./deepseek-client.ts";
import type { ConversationActDecision } from "./conversation-act-router.ts";
import {
  addressStyleInstruction,
} from "./conversation-profile.ts";
import {
  auditCourseFollowUpAnswer,
  buildFollowUpAuthorityPayload,
  composeCatalogFollowUpAnswer,
  isCatalogAnswerableFollowUp,
  type FollowUpEvidenceExcerpt,
} from "./follow-up-grounding.ts";
import {
  composeCourseFactualCeilingAnswer,
} from "../academy/contact-policy.ts";

type CourseFollowUpAct = Extract<
  ConversationActDecision,
  { state: "COURSE_FOLLOW_UP" }
>;

export type ComposeCourseFollowUpOptions = DeepSeekClientOptions & {
  callText?: typeof callDeepSeekText;
  callJson?: typeof callDeepSeekJson;
  courseEvidence?: readonly ResolvedCourseEvidence[];
  evidenceSelection?: CourseEvidenceSelection;
  profile?: ConversationProfile;
};

export function composeNavigatorMetaAnswer(): string {
  return [
    "Навигатор нужен для выбора и объяснения учебного маршрута внутри Академии структурной типологии.",
    "Цитаты и ссылки на внутренние материалы не должны появляться в обычной рекомендации автоматически. Я показываю их только по прямому запросу на основания, источники или конкретные выдержки из материалов курса.",
    "Если вопрос не относится к курсам Академии, Навигатор должен честно обозначить границу своей функции, а не притягивать новый вопрос к уже обсуждавшемуся курсу.",
  ].join("\n\n");
}

export function composeNavigatorOutOfScopeAnswer(): string {
  return [
    "Этот вопрос вне функции Навигатора: здесь я помогаю выбирать и понимать учебные маршруты Академии структурной типологии.",
    "Для общего поиска лучше использовать, например, Google или Perplexity; для диалогового разбора — универсальный ассистент вроде ChatGPT. Так ответ будет качественнее по теме, которая не относится к курсам Академии.",
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
): FollowUpEvidenceExcerpt[] {
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

function coursePublicPayload(
  course: AcademyCourse,
  evidence: readonly FollowUpEvidenceExcerpt[],
) {
  return buildFollowUpAuthorityPayload(course, evidence);
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

  const evidence = selectedEvidence(
    options.evidenceSelection,
    options.courseEvidence,
  );
  const latestUserMessage = messages.at(-1)?.content ?? "";

  if (
    options.evidenceSelection?.status !== "SUPPORTED" ||
    evidence.length === 0
  ) {
    if (isCatalogAnswerableFollowUp(latestUserMessage)) {
      return composeCatalogFollowUpAnswer(
        course,
        latestUserMessage,
      );
    }

    return composeCourseFactualCeilingAnswer(course.title);
  }

  const callText = options.callText ?? callDeepSeekText;
  const authority = coursePublicPayload(course, evidence);
  const userContext = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);

  const answer = await callText(
    [
      {
        role: "system",
        content: `Ты — публичный Навигатор Академии структурной типологии.

Ответь ТОЛЬКО на последнюю реплику пользователя как на follow-up по уже обсуждаемому курсу.
Не выбирай курс заново и не повторяй полный recommendation template.

КРИТИЧЕСКАЯ ГРАНИЦА АВТОРИТЕТА:
- используй только authorityPayload;
- НЕ используй общие знания модели;
- НЕ используй предыдущие ответы assistant как фактический источник;
- предыдущие сообщения assistant намеренно не передаются как authority;
- научная/эмпирическая оценка допустима только если прямо подтверждена evidence, и тогда формулируй её как утверждение подключённого материала курса, а не как внешний научный консенсус;
- не придумывай формат курса, упражнения, психологическую безопасность, эффективность, поддержку, преподавателей, контакты или гарантии;
- если делаешь практический вывод, явно обозначь его словами "из этого следует", "это может означать" или аналогично и не добавляй новых фактов.

${addressStyleInstruction(options.profile)}

Если evidenceRequested=false, не показывай пользователю сырые цитаты, названия внутренних документов, страницы и provenance.
Если evidenceRequested=true, список точных цитат и provenance будет добавлен системой после твоего ответа.
Не раскрывай внутренние формулы, служебные labels или технические обозначения, если пользователь сам прямо о них не спрашивает.
Пиши по-русски, коротко и по существу.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            latestUserMessage,
            userContext,
            evidenceRequested: act.evidenceRequested,
            authorityPayload: authority,
          },
          null,
          2,
        ),
      },
    ],
    options,
  );

  const audit = await auditCourseFollowUpAnswer(
    answer,
    latestUserMessage,
    authority,
    {
      env: options.env,
      fetch: options.fetch,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      callJson: options.callJson,
    },
  );

  if (audit.status !== "PASS") {
    return composeCourseFactualCeilingAnswer(course.title);
  }

  if (!act.evidenceRequested) {
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
