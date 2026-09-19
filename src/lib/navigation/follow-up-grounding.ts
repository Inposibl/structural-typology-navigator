import {
  getPublicCourseOutcomes,
} from "../academy/public-course-outcomes.ts";
import type {
  AcademyCourse,
} from "../academy/course-catalog.ts";
import {
  ACADEMY_CONTACT_POLICY,
} from "../academy/contact-policy.ts";
import {
  callDeepSeekJson,
  type DeepSeekClientOptions,
} from "./deepseek-client.ts";

export type FollowUpEvidenceExcerpt = {
  quote: string;
  source: string;
};

export type FollowUpAuthorityPayload = {
  course: {
    id: string;
    title: string;
    url: string | null;
    meetings: number | null;
    learningNeeds: readonly string[];
    publicOutcomes: readonly string[];
  };
  evidence: readonly FollowUpEvidenceExcerpt[];
};

export type FollowUpGroundingAudit =
  | { status: "PASS" }
  | {
      status: "FAIL";
      reasonCode:
        | "UNSUPPORTED_CLAIM"
        | "AUTHORITY_SCOPE"
        | "UNMARKED_INFERENCE";
    };

export class FollowUpGroundingAuditError extends Error {
  readonly code = "INVALID_FOLLOW_UP_GROUNDING_AUDIT";

  constructor(message: string) {
    super(message);
    this.name = "FollowUpGroundingAuditError";
  }
}

export type AuditFollowUpOptions = DeepSeekClientOptions & {
  callJson?: typeof callDeepSeekJson;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateAudit(value: unknown): FollowUpGroundingAudit {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new FollowUpGroundingAuditError(
      "Grounding audit must contain status.",
    );
  }

  if (value.status === "PASS") {
    if (!onlyKeys(value, ["status"])) {
      throw new FollowUpGroundingAuditError(
        "PASS contains unsupported fields.",
      );
    }
    return { status: "PASS" };
  }

  if (value.status !== "FAIL") {
    throw new FollowUpGroundingAuditError(
      `Unsupported grounding status: ${String(value.status)}.`,
    );
  }

  if (
    !onlyKeys(value, ["status", "reasonCode"]) ||
    (value.reasonCode !== "UNSUPPORTED_CLAIM" &&
      value.reasonCode !== "AUTHORITY_SCOPE" &&
      value.reasonCode !== "UNMARKED_INFERENCE")
  ) {
    throw new FollowUpGroundingAuditError(
      "FAIL requires a valid reasonCode.",
    );
  }

  return {
    status: "FAIL",
    reasonCode: value.reasonCode,
  };
}

export function buildFollowUpAuthorityPayload(
  course: AcademyCourse,
  evidence: readonly FollowUpEvidenceExcerpt[],
): FollowUpAuthorityPayload {
  return {
    course: {
      id: course.id,
      title: course.title,
      url: course.url,
      meetings:
        typeof course.meetings === "number" ? course.meetings : null,
      learningNeeds: course.learningNeeds,
      publicOutcomes: getPublicCourseOutcomes(course),
    },
    evidence,
  };
}

const CATALOG_FOLLOW_UP_PATTERN =
  /(?:почему.{0,30}курс.{0,30}(?:подход|подойд)|что\s+(?:я\s+)?получу|что\s+да[её]т\s+курс|чему\s+науч|учебн(?:ый|ые)\s+результат|о\s+ч[её]м\s+курс|что\s+за\s+курс|сколько.{0,20}(?:встреч|занят)|ссылк.{0,20}курс)/iu;

export function isCatalogAnswerableFollowUp(
  query: string,
): boolean {
  return CATALOG_FOLLOW_UP_PATTERN.test(query);
}

export function composeCatalogFollowUpAnswer(
  course: AcademyCourse,
  query: string,
): string {
  const parts: string[] = [];

  if (/сколько.{0,20}(?:встреч|занят)/iu.test(query)) {
    if (typeof course.meetings === "number") {
      parts.push(
        `В текущем каталоге для курса «${course.title}» указано количество встреч: ${course.meetings}.`,
      );
    }
  }

  if (/ссылк.{0,20}курс/iu.test(query) && course.url) {
    parts.push(`Страница курса: ${course.url}.`);
  }

  const outcomes = getPublicCourseOutcomes(course);
  if (outcomes.length > 0) {
    parts.push(
      `Подтверждённые публичные учебные результаты курса: ${outcomes.join(
        "; ",
      )}.`,
    );
  }

  if (
    /(?:инструмент|методик|упражнен|формат)/iu.test(query)
  ) {
    parts.push(
      `Конкретные методики, упражнения или формат прохождения из этих публичных данных не следуют. Быстро уточнить это можно в Telegram Академии: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl}.`,
    );
  }

  if (parts.length === 0) {
    return `По текущему публичному описанию курса «${course.title}» у меня нет более точного подтверждённого ответа на этот вопрос.`;
  }

  return parts.join("\n\n");
}

export async function auditCourseFollowUpAnswer(
  answer: string,
  latestUserMessage: string,
  authority: FollowUpAuthorityPayload,
  options: AuditFollowUpOptions = {},
): Promise<FollowUpGroundingAudit> {
  const callJson = options.callJson ?? callDeepSeekJson;

  const raw = await callJson(
    [
      {
        role: "system",
        content: `Ты — независимый fail-closed аудитор пользовательского ответа по курсу Академии.

Проверь КАЖДОЕ содержательное утверждение в candidateAnswer только против authorityPayload.

РАЗРЕШЕНО:
- прямо переформулировать подтверждённые поля course;
- прямо переформулировать evidence excerpts;
- делать очень ограниченный практический вывод только если он явно обозначен как вывод ("из этого следует", "это может означать") и не добавляет новых фактов.

ЗАПРЕЩЕНО БЕЗ ПРЯМОГО ОСНОВАНИЯ:
- общая научная или эмпирическая оценка теории;
- утверждения о научном консенсусе;
- формат прохождения, групповой/индивидуальный режим;
- психологическая безопасность и снижение рисков;
- эффективность, гарантированные результаты;
- конкретные упражнения, методики, фасилитация;
- преподаватели, кураторы, поддержка и контакты;
- любые факты из общих знаний модели;
- превращать утверждение внутреннего материала курса во внешний научный консенсус.

Если есть хотя бы одно такое утверждение — FAIL.
Если вывод не обозначен как вывод — FAIL.
Верни только JSON.

{"status":"PASS"}
или
{"status":"FAIL","reasonCode":"UNSUPPORTED_CLAIM"}
или
{"status":"FAIL","reasonCode":"AUTHORITY_SCOPE"}
или
{"status":"FAIL","reasonCode":"UNMARKED_INFERENCE"}`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            latestUserMessage,
            authorityPayload: authority,
            candidateAnswer: answer,
          },
          null,
          2,
        ),
      },
    ],
    options,
  );

  return validateAudit(raw);
}
