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

/**
 * ROUTER-FAILURE-CORRECTION-1 FIX-1 — ordinary Russian questions about how long
 * a course lasts. A duration cue must govern a course object (курс, программа,
 * обучение, встреча, занятие) across at most three closed filler words, in
 * either order, so a duration word attached to a subject-matter noun
 * («Сколько длится стресс?») never qualifies. The catalogue states only the
 * meeting count; the answer never converts it into hours, weeks or a schedule.
 *
 * CORR1 (IV1-03) — the object is a closed set of nominative, accusative and
 * genitive forms with a word-end boundary. The locative «на курсе», «в
 * программе», «в обучении» frames time spent on something inside the course
 * («Как долго на курсе сохраняется мотивация?»), and «программирование» is not
 * a course object. A question that allocates time to a subject inside the
 * course («…уделяется мотивации?», «…посвящено мотивации?») is vetoed by a
 * closed allocation-verb list and keeps the factual ceiling.
 */
const DURATION_CUE = String.raw`(?:(?<![а-яё])дл(?:ит|ят)|(?<![а-яё])продолжительн|(?<![а-яё])долг(?:о|ий|ая|ое|ие)(?![а-яё])|(?<![а-яё])сколько\s+(?:по\s+)?времен|(?<![а-яё])сколько\s+(?:академическ[а-яё]*\s+)?(?:час|минут|недел|месяц|дн(?:ей|я)(?![а-яё])))`;
const DURATION_OBJECT = String.raw`(?<![а-яё])(?:курс(?:а|ы|ов)?|программ(?:а|ы|у)?|обучени[ея]|встреч(?:а|и|у)?|заняти(?:е|я|й))(?![а-яё])`;
const DURATION_FILLER = String.raw`(?:этот|эта|это|эти|этого|этой|этом|этих|весь|вся|всё|все|всего|сам|сама|само|ваш|ваша|ваше|вашего|вашей|ли|же|в|во|на|у|по|вообще|обычно|примерно|приблизительно|один|одна|одно|одного|одной|каждый|каждая|каждое|каждого|каждой|длится|длятся|ид[её]т|идут|занимает|занимают|продолжается|продолжаются|проходит|проходят|рассчитан[а-яё]*|целиком|полностью|нужно|надо|можно|пройти|проходить|заниматься|учиться|сколько)`;
const COURSE_DURATION_PATTERN = new RegExp(
  `${DURATION_CUE}[а-яё]*(?:\\s+${DURATION_FILLER}){0,3}\\s+${DURATION_OBJECT}|${DURATION_OBJECT}(?:\\s+${DURATION_FILLER}){0,3}\\s+${DURATION_CUE}`,
  "iu",
);
const PER_MEETING_DURATION_PATTERN =
  /(?<![а-яё])(?:одн|кажд)[а-яё]*\s+(?:встреч|заняти)|(?<![а-яё])(?:дл(?:ит|ят)|продолжительн)[а-яё]*\s+(?:встреч|заняти)|(?<![а-яё])(?:встреча|встречи|занятие|занятия)\s+(?:дл(?:ит|ят)|ид[её]т|идут|продолжа)/iu;
const HOURS_DURATION_PATTERN =
  /(?<![а-яё])(?:час(?:а|ах|ам|ами|ов|ы)?|минут[а-яё]*)(?![а-яё])/iu;
const CALENDAR_DURATION_PATTERN =
  /(?<![а-яё])(?:недел|месяц|календар)|(?<![а-яё])дн(?:ей|я|ях)(?![а-яё])|(?<![а-яё])(?:по|сколько)\s+времени/iu;

const TIME_ALLOCATION_PATTERN =
  /(?<![а-яё])(?:удел[яеё]|посвя[щт]|отвод|отвед[её]н|отвест|выделя|выдел[её]н|трат|трач)/iu;

export function isCourseDurationQuestion(query: string): boolean {
  return (
    COURSE_DURATION_PATTERN.test(query) && !TIME_ALLOCATION_PATTERN.test(query)
  );
}

/**
 * ROUTER-FAILURE-CORRECTION-1 FIX-5 — Russian cardinal agreement for the
 * catalogue meeting count: 1/21 «встреча», 2–4/22–24 «встречи», otherwise
 * «встреч»; 11–14 always take «встреч».
 */
export function formatMeetingCount(count: number): string {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  if (last === 1 && lastTwo !== 11) return `${count} встреча`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) {
    return `${count} встречи`;
  }
  return `${count} встреч`;
}

function composeCourseDurationLimitation(
  meetingCount: string,
  query: string,
): string {
  if (PER_MEETING_DURATION_PATTERN.test(query)) {
    return `Длительность одной встречи в доступных мне подтверждённых данных не указана, поэтому ${meetingCount} нельзя пересчитать в часы.`;
  }
  if (HOURS_DURATION_PATTERN.test(query)) {
    return `Общее количество часов в доступных мне подтверждённых данных не указано: длительность одной встречи там не указана, поэтому ${meetingCount} нельзя пересчитать в часы.`;
  }
  if (CALENDAR_DURATION_PATTERN.test(query)) {
    return `Продолжительность курса в часах, неделях или месяцах в доступных мне подтверждённых данных не указана: длительность одной встречи, частота и даты встреч там не указаны, поэтому ${meetingCount} нельзя пересчитать в часы или календарный срок.`;
  }
  return "Длительность одной встречи, общее количество часов, частота встреч и календарные сроки курса в доступных мне подтверждённых данных не указаны.";
}

export function isCatalogAnswerableFollowUp(
  query: string,
): boolean {
  return (
    CATALOG_FOLLOW_UP_PATTERN.test(query) ||
    isCourseDurationQuestion(query)
  );
}

export function composeCatalogFollowUpAnswer(
  course: AcademyCourse,
  query: string,
): string {
  const parts: string[] = [];
  const durationQuestion = isCourseDurationQuestion(query);
  const formatQuestion = /(?:инструмент|методик|упражнен|формат)/iu.test(
    query,
  );

  if (durationQuestion) {
    if (typeof course.meetings === "number") {
      const meetingCount = formatMeetingCount(course.meetings);
      parts.push(
        [
          `В текущем каталоге продолжительность курса «${course.title}» указана только количеством встреч: ${meetingCount}.`,
          composeCourseDurationLimitation(meetingCount, query),
          ...(formatQuestion
            ? []
            : [
                `Быстро уточнить это можно в Telegram Академии: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl}.`,
              ]),
        ].join(" "),
      );
    }
  } else if (/сколько.{0,20}(?:встреч|занят)/iu.test(query)) {
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

  if (formatQuestion) {
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
