import type {
  AcademyContactCard,
  ConversationProfile,
} from "../chat-contract.ts";
import type { FactualIntent } from "./conversation-act-router.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY_AS_OF,
  getAuthoritativeCoursePrice,
} from "../academy/commercial-authority.ts";
import { ACADEMY_COMMERCIAL_POLICY_ADDENDUM } from "../academy/commercial-policy-addendum.ts";
import {
  ACADEMY_CONTACT_POLICY,
  getAcademyManagerContactCard,
} from "../academy/contact-policy.ts";
import {
  ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
  getAcademyCourse,
  type AcademyCourse,
} from "../academy/course-catalog.ts";
import {
  summarizeCalendarRuns,
  type CalendarReadResult,
  type CalendarRunSummary,
} from "../academy/course-calendar.ts";
import { resolveCourseReferences, type AcademyCourseId } from "../academy/course-reference.ts";
import { getPublicCourseOutcomes } from "../academy/public-course-outcomes.ts";
import {
  ACADEMY_PAYMENT_POLICY,
  type EnrollmentPaymentAction,
} from "../academy/payment-policy.ts";
import { formatMeetingCount } from "./follow-up-grounding.ts";

/**
 * NAVIGATOR-LIVE-ACCEPTANCE-1.OWNER-DEFECT-REMEDIATION-1 — the Owner-defined
 * answers for the service questions of the first Live Acceptance campaign
 * (C04, C05, F01, F02) and the mixed content-and-price question (F03).
 *
 * Recognizers are closed phrase forms, not stems of ordinary course language.
 * Composers state only authority-backed facts: the dated commercial snapshot
 * and its 2026-10-24 addendum, the published calendar as read this turn, the
 * catalog snapshot, the approved payment-bot destinations and the approved
 * contact authority. Nothing here records an enrollment, a payment or a
 * discount decision.
 */

export type ServiceRequestKind =
  | "PAYMENT_STATUS"
  | "ENROLLMENT_CAPABILITY"
  | "COMMERCIAL_CONDITIONS"
  | "SCHEDULE_ENROLLMENT";

const PAYMENT_STATUS_PATTERNS: readonly RegExp[] = [
  /оплат[аы]\s+(?:уже\s+)?(?:прошл|поступил|дошл|зачислен|получен)/iu,
  /(?:подтверд|провер)[а-яё]*[^.?!\n]{0,40}(?:оплат|плат[её]ж)/iu,
  /(?<![а-яё])я\s+(?:уже\s+|вчера\s+|сегодня\s+|недавно\s+)?(?:оплатил|оплачивал|заплатил)[а-яё]*/iu,
  /статус[а-яё]*\s+(?:моей\s+|моего\s+)?(?:оплат|плат[её]ж)/iu,
];

const ENROLLMENT_CAPABILITY_PATTERNS: readonly RegExp[] = [
  /(?<![а-яё])(?:вы|ты)\s+(?:сами\s+|сам\s+)?(?:можете|можешь|сможете|сможешь)\s+(?:сами\s+|сам\s+)?(?:меня\s+|мне\s+)?(?:записать|оформить|зарегистрировать|оплатить|зачислить)/iu,
];

const COMMERCIAL_CONDITIONS_PATTERNS: readonly RegExp[] = [
  /(?<![а-яё])рассрочк/iu,
  /(?<![а-яё])скид(?:к|оч)/iu,
];

const SCHEDULE_ENROLLMENT_PATTERNS: readonly RegExp[] = [
  /(?<![а-яё])когда\s+(?:[а-яё]+\s+){0,3}?(?:стартует|стартуют|начинается|начинаются|начн[её]тся|старт|набор|запуск)(?![а-яё])/iu,
  /(?<![а-яё])(?:ближайш|следующ)[а-яё]*\s+(?:поток|групп|набор|старт|запуск)/iu,
  /(?<![а-яё])открыт[аоы]?\s+(?:ли\s+)?(?:сейчас\s+)?(?:запись|набор)/iu,
  /(?<![а-яё])(?:запись|набор)\s+(?:сейчас\s+)?открыт/iu,
  /(?<![а-яё])можно\s+ли\s+(?:сейчас\s+|ещё\s+|еще\s+|уже\s+)?записаться/iu,
  /(?<![а-яё])дат[аыу]\s+(?:старта|начала)/iu,
];

/**
 * The service request of the latest effective user message, or null. Payment
 * status outranks capability, which outranks conditions, which outrank
 * scheduling: the narrower, safety-relevant question is answered first.
 */
export function detectServiceRequest(query: string): ServiceRequestKind | null {
  if (PAYMENT_STATUS_PATTERNS.some((pattern) => pattern.test(query))) return "PAYMENT_STATUS";
  if (ENROLLMENT_CAPABILITY_PATTERNS.some((pattern) => pattern.test(query))) return "ENROLLMENT_CAPABILITY";
  if (COMMERCIAL_CONDITIONS_PATTERNS.some((pattern) => pattern.test(query))) return "COMMERCIAL_CONDITIONS";
  if (SCHEDULE_ENROLLMENT_PATTERNS.some((pattern) => pattern.test(query))) return "SCHEDULE_ENROLLMENT";
  return null;
}

const OVERVIEW_CONTENT_PATTERNS: readonly RegExp[] = [
  /(?<![а-яё])что\s+входит\s+в/iu,
  /(?<![а-яё])(?:расскаж[а-яё]*|рассказать)\s+(?:подробнее\s+)?(?:о|об|про)\s+курс/iu,
  /(?<![а-яё])что\s+(?:да[её]т|включает)\s+(?:этот\s+)?курс/iu,
  /(?<![а-яё])чему\s+(?:учит|учат|научит)/iu,
  /(?<![а-яё])о\s+ч[её]м\s+курс/iu,
  /(?<![а-яё])программ[аеуы]\s+курса/iu,
];

const OVERVIEW_PRICE_PATTERNS: readonly RegExp[] = [
  /(?<![а-яё])сколько\s+(?:[а-яё]+\s+){0,2}?сто(?:ит|ят|ить)(?![а-яё])/iu,
  /(?<![а-яё])стоимост/iu,
  /(?<![а-яё])цен[аеуы](?![а-яё])/iu,
];

/** A literal price question; the discount, installment and payment stems do not count. */
const EXPLICIT_PRICE_QUESTION_PATTERNS: readonly RegExp[] = [
  ...OVERVIEW_PRICE_PATTERNS,
  /(?<![а-яё])поч[её]м(?![а-яё])/iu,
  /(?<![а-яё])обойд[её]т(?:ся)?(?![а-яё])/iu,
];

/** Whether the message literally asks a price (CORR1 OD-5). */
export function asksExplicitPrice(query: string): boolean {
  return EXPLICIT_PRICE_QUESTION_PATTERNS.some((pattern) => pattern.test(query));
}

/**
 * OWNER-DEFECT-REMEDIATION-1.CORR1 (OD-5) — the part of a validated FACTUAL
 * proposal that still answers the message beside its service lane. The service
 * lane is the authority for the service question itself: discounts and
 * installments (addendum), dates (calendar), payment status and the
 * Navigator's capability. Only a price the message literally asks as well is
 * kept, as the PRICE field of the proposal's CURRENT_METADATA intent; timing
 * fields give way to the calendar lane, and every other factual intent of a
 * service message is not literally corroborated and gives way to the service
 * answer. The input is the metadata-guard-sanitized intent list, so nothing is
 * ever added.
 */
export function factualIntentsBesideServiceRequest(
  intents: readonly FactualIntent[],
  query: string,
): FactualIntent[] {
  if (!asksExplicitPrice(query)) return [];
  return intents.flatMap((intent): FactualIntent[] =>
    intent.kind === "CURRENT_METADATA" && intent.fields.includes("PRICE")
      ? [{ ...intent, courseIds: [...intent.courseIds], fields: ["PRICE"] }]
      : [],
  );
}

/**
 * F03 — a request for one explicitly named routable course's content AND its
 * price in one message. Only an explicit single-course reference qualifies;
 * an anaphor, a stored selection or several courses never do.
 */
export function detectCourseOverviewWithPrice(query: string): AcademyCourseId | null {
  if (!OVERVIEW_CONTENT_PATTERNS.some((pattern) => pattern.test(query))) return null;
  if (!OVERVIEW_PRICE_PATTERNS.some((pattern) => pattern.test(query))) return null;
  const references = resolveCourseReferences(query);
  if (references.kind !== "ONE") return null;
  const course = getAcademyCourse(references.courseIds[0]);
  return course !== null && course.status === "ROUTABLE" && course.url !== null
    ? references.courseIds[0]
    : null;
}

/* --------------------------------------------------------------- wording --- */

function pick(profile: ConversationProfile | undefined, ty: string, vy: string): string {
  return profile?.addressMode === "TY" ? ty : vy;
}

const RU_MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function ruLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${RU_MONTHS_GENITIVE[month - 1]} ${year} года`;
}

function ruShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/**
 * The approved contact locators of the human curator, Алексей Лебедев
 * (ACADEMY_CONTACT_POLICY.manager — Owner contact authority v1.3). `lead`
 * carries the inflected name.
 */
export function composeCuratorContactLine(lead: string): string {
  const manager = ACADEMY_CONTACT_POLICY.manager;
  return `${lead}: Telegram ${manager.telegramUrl} (${manager.telegramHandle}), телефон ${manager.phoneLabel}; он доступен ${manager.availability}.`;
}

export type ServiceAnswer = {
  message: string;
  contactCard: AcademyContactCard | null;
};

/** C04 — installments and discounts under the Owner addendum of 2026-10-24. */
export function composeCommercialConditionsAnswer(): ServiceAnswer {
  const addendum = ACADEMY_COMMERCIAL_POLICY_ADDENDUM;
  const prepaymentTitles = addendum.publicPrepaymentDiscount.courseIds
    .map((courseId) => getAcademyCourse(courseId)?.title)
    .filter((title): title is string => title !== undefined)
    .map((title) => `«${title}»`)
    .join(", ");
  return {
    message: [
      `Условия Академии по состоянию на ${ruLongDate(addendum.asOfDate)}:`,
      addendum.installments.offered ? "• Рассрочка доступна." : "• Рассрочки нет.",
      `• На курс ${prepaymentTitles} действует публичная скидка при полной предоплате курса. Её размер в подтверждённых данных Академии не указан, поэтому называть его я не буду.`,
      "• По другим курсам индивидуальная скидка может быть рассмотрена только для тех, кто уже учился в Академии и есть в её учётных данных. Решение о такой скидке принимает куратор Академии Алексей Лебедев; сам я не проверяю, учился ли человек в Академии, и не определяю право на скидку.",
      composeCuratorContactLine("По вопросам скидки можно обратиться к куратору Академии Алексею Лебедеву"),
    ].join("\n"),
    contactCard: getAcademyManagerContactCard(),
  };
}

/** F02 — payment status: no record access, no inference, the curator decides. */
export function composePaymentStatusAnswer(): ServiceAnswer {
  return {
    message: [
      "Подтвердить оплату я не могу: у Навигатора нет доступа к данным о платежах и записях конкретных слушателей. Поэтому я не знаю, прошла ли оплата, и не делаю выводов из сообщения в чате.",
      composeCuratorContactLine("Статус оплаты можно проверить у куратора Академии Алексея Лебедева"),
    ].join("\n\n"),
    contactCard: getAcademyManagerContactCard(),
  };
}

/**
 * F01 — the Navigator's own capability, then the approved application path.
 * The destination is the course-specific one only when the caller resolved an
 * authorized course action; otherwise the general bot.
 */
export function composeEnrollmentCapabilityAnswer(
  action: EnrollmentPaymentAction,
  profile?: ConversationProfile,
): ServiceAnswer {
  const course = action.courseId === null ? null : ACADEMY_PAYMENT_POLICY.courses[action.courseId];
  return {
    message: [
      pick(
        profile,
        "Сам записать тебя на курс или провести оплату я не могу: в этом диалоге нельзя оформить участие, оплатить курс или получить подтверждение записи. Поэтому никакая запись или оплата сейчас не оформлена.",
        "Сам записать вас на курс или провести оплату я не могу: в этом диалоге нельзя оформить участие, оплатить курс или получить подтверждение записи. Поэтому никакая запись или оплата сейчас не оформлена.",
      ),
      course === null
        ? `Заявки на участие и оплату курсов принимает Тихон — AI-секретарь Академии в Telegram: ${action.paymentUrl}. Там можно выбрать программу из каталога Академии.`
        : `Заявку на участие и оплату курса «${course.title}» принимает Тихон — AI-секретарь Академии в Telegram: ${action.paymentUrl}.`,
    ].join("\n\n"),
    contactCard: null,
  };
}

function calendarSourceLine(calendar: Extract<CalendarReadResult, { status: "AVAILABLE" }>): string {
  const published = calendar.pageLastModified === null
    ? ""
    : `страница обновлена ${ruShortDate(calendar.pageLastModified)}, `;
  return `По опубликованному календарю Академии (${calendar.sourceUrl}; ${published}данные получены ${ruShortDate(calendar.readDate)}):`;
}

function runLabel(run: CalendarRunSummary): string {
  return run.cohortLabel === null ? "" : ` (${run.cohortLabel})`;
}

/** One course's literal calendar position; never a guessed start. */
function courseCalendarLine(course: AcademyCourse, runs: readonly CalendarRunSummary[]): string {
  const own = runs.filter((run) => run.courseId === course.id);
  const upcoming = own.filter((run) => run.position === "UPCOMING");
  if (upcoming.length > 0) {
    const next = upcoming[0];
    return `• «${course.title}»: ближайший старт по календарю — ${ruShortDate(next.firstDate)}${runLabel(next)}.`;
  }
  const inProgress = own.filter((run) => run.position === "IN_PROGRESS");
  if (inProgress.length > 0) {
    const current = inProgress
      .map((run) => `с ${ruShortDate(run.firstDate)} по ${ruShortDate(run.lastDate)}${runLabel(run)}`)
      .join("; ");
    return `• «${course.title}»: даты начала следующего потока в календаре нет; опубликованные встречи текущего потока идут ${current} и уже начались.`;
  }
  return `• «${course.title}»: предстоящих дат в календаре нет.`;
}

function allCoursesCalendarLines(runs: readonly CalendarRunSummary[]): string[] {
  const upcoming = runs.filter((run) => run.position === "UPCOMING");
  if (upcoming.length > 0) {
    return upcoming.map((run) => {
      const course = getAcademyCourse(run.courseId);
      return `• «${course?.title ?? run.courseId}»: ближайший старт по календарю — ${ruShortDate(run.firstDate)}${runLabel(run)}.`;
    });
  }
  const inProgress = runs.filter((run) => run.position === "IN_PROGRESS");
  return [
    "• Дат начала новых потоков в календаре сейчас нет ни по одному курсу.",
    ...(inProgress.length > 0
      ? [
          `• Уже идут: ${inProgress
            .map((run) => `«${getAcademyCourse(run.courseId)?.title ?? run.courseId}»${runLabel(run)} — встречи с ${ruShortDate(run.firstDate)} по ${ruShortDate(run.lastDate)}`)
            .join("; ")}.`,
        ]
      : []),
  ];
}

const CALENDAR_UNAVAILABLE_LINE =
  "Сейчас я не могу получить данные календаря Академии, поэтому не могу подтвердить ближайшие даты старта. Называть даты по памяти или по старым данным я не буду.";

/** C05 — dates from the calendar read this turn; enrollment status is never confirmed by it. */
export function composeScheduleEnrollmentAnswer(
  calendar: CalendarReadResult,
  courseId: AcademyCourseId | null,
): ServiceAnswer {
  const course = courseId === null ? null : getAcademyCourse(courseId);
  const lines: string[] = [];
  if (calendar.status === "AVAILABLE") {
    const runs = summarizeCalendarRuns(calendar.sessions, calendar.readDate);
    lines.push(
      [
        calendarSourceLine(calendar),
        ...(course === null ? allCoursesCalendarLines(runs) : [courseCalendarLine(course, runs)]),
      ].join("\n"),
    );
    lines.push("Открыта ли сейчас запись, в календаре не указано, поэтому подтвердить это я не могу.");
  } else {
    lines.push(CALENDAR_UNAVAILABLE_LINE);
    lines.push("Открыта ли сейчас запись, я тоже подтвердить не могу.");
  }
  lines.push(
    composeCuratorContactLine("Уточнить даты и возможность записи индивидуально можно у куратора Академии Алексея Лебедева"),
  );
  return { message: lines.join("\n\n"), contactCard: getAcademyManagerContactCard() };
}

/**
 * F03 — price (dated snapshot), nearest start (calendar read this turn, or an
 * explicit limitation), a catalog-grounded description, and the catalog course
 * page, in that order, for the one explicitly named course.
 */
export function composeCourseOverviewWithPriceAnswer(
  courseId: AcademyCourseId,
  calendar: CalendarReadResult,
): string {
  const course = getAcademyCourse(courseId);
  if (course === null || course.url === null) {
    throw new Error("Course overview requires a routable catalog course with a public page.");
  }
  const price = getAuthoritativeCoursePrice(courseId);
  const priceLine = price.status === "SUPPORTED"
    ? `Стоимость: последняя подтверждённая цена курса «${course.title}» по данным Академии на ${ruLongDate(ACADEMY_COMMERCIAL_AUTHORITY_AS_OF)} — ${formatRub(price.value)}.`
    : `Стоимость: подтверждённой цены курса «${course.title}» в данных Академии на ${ruLongDate(ACADEMY_COMMERCIAL_AUTHORITY_AS_OF)} нет.`;
  const dateLine = calendar.status === "AVAILABLE"
    ? [
        "Ближайший старт:",
        calendarSourceLine(calendar),
        courseCalendarLine(course, summarizeCalendarRuns(calendar.sessions, calendar.readDate)),
      ].join("\n")
    : "Ближайший старт: сейчас я не могу получить данные календаря Академии, поэтому дату старта подтвердить не могу.";
  const outcomes = getPublicCourseOutcomes(course);
  const description = [
    `О курсе: по каталогу Академии на ${ruShortDate(ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE)} курс состоит из ${formatMeetingCount(course.meetings)}.`,
    outcomes.length > 0 ? `По программе курса его учебные результаты включают: ${outcomes.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
  return [
    priceLine,
    dateLine,
    description,
    `Страница курса: ${course.url}`,
  ].join("\n\n");
}
