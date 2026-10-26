import assert from "node:assert/strict";
import test, { after } from "node:test";

import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import type { ConversationMessage, ConversationProfile } from "../../src/lib/chat-contract.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  createInitialConversationState,
  withCourseBinding,
  withLastAssistant,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { contentGate } from "../../src/lib/navigation/course-reference-evidence.ts";
import { createNavigatorTurnLog, type NavigatorTurnDetails } from "../../src/lib/navigation/navigator-observability.ts";
import { detectServiceRequest } from "../../src/lib/navigation/owner-service-lanes.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
} from "../../src/lib/academy/commercial-authority.ts";
import {
  ACADEMY_COMMERCIAL_POLICY_ADDENDUM,
  ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION,
} from "../../src/lib/academy/commercial-policy-addendum.ts";
import {
  ACADEMY_CALENDAR_URL,
  parseAcademyCalendarHtml,
  readAcademyCalendar,
  type CalendarReadDependency,
} from "../../src/lib/academy/course-calendar.ts";
import { ACADEMY_PAYMENT_POLICY } from "../../src/lib/academy/payment-policy.ts";

/**
 * NAVIGATOR-LIVE-ACCEPTANCE-1.OWNER-DEFECT-REMEDIATION-1 — the seven
 * Owner-confirmed Live Acceptance UX_FAIL defects (C04, C05, E02, F01, F02,
 * F03, F05), with the exact original Live Acceptance user messages
 * (NAVIGATOR_LIMITED_PREVIEW_READINESS_1_LIVE_ACCEPTANCE_1_EVIDENCE/conversations)
 * and the Owner's own example phrasings.
 *
 * Every turn goes through the real chat route (`handleChatRequest`), control
 * kernel, act-router validator, orchestrator, payment policy, commercial
 * authority and addendum, calendar parser/summary, contact authority and
 * composers; the returned message and conversationState of each turn feed
 * the next request. Deterministic seams only: the act proposal (the live
 * DeepSeek act from the campaign's runtime logs), the educational router
 * decision, retrieval, and the calendar page bytes behind the real read-only
 * adapter. Global fetch throws and is counted.
 */

type Msg = ConversationMessage;
type Proposal = () => Record<string, unknown>;
type RouteFn = (messages: readonly Msg[]) => Record<string, unknown>;
type Step = { user: string; propose: Proposal; route?: RouteFn };
type TurnRecord = {
  status: number;
  message: string;
  state: ConversationState;
  contactCard: unknown;
  result: NavigatorOrchestrationResult;
};

let networkAttempts = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  networkAttempts += 1;
  throw new Error("OWNER-DEFECT-REMEDIATION-1 TEST NETWORK FORBIDDEN");
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const VY: ConversationProfile = { displayName: null, addressMode: "VY", nameDeclined: true, pendingUserRequest: null };
const TY: ConversationProfile = { displayName: null, addressMode: "TY", nameDeclined: true, pendingUserRequest: null };
const NOW = new Date("2026-10-24T17:41:50Z");

/* ------------------------------------------------- exact live messages --- */

const C04_LIVE = "Здравствуйте! Есть ли у вас рассрочка или какие-то скидки?";
const C04_OWNER = "Есть ли рассрочка или скидки на ваши курсы?";
const C05_LIVE = "Здравствуйте! Подскажите, пожалуйста, когда стартует следующая группа и можно ли сейчас записаться?";
const C05_OWNER = "Когда начинается следующий курс? Открыта ли запись?";
const E02_T1 = "Здравствуйте! Хочу разобраться, что движет моими сотрудниками, чтобы лучше ими управлять. Какой курс Академии посоветуете?";
const E02_T2 = "Ладно, давайте этот курс. Как мне его оплатить?";
const F01_LIVE = "Здравствуйте! Вы можете сами оформить мне запись на курс — полностью, без моих действий?";
const F01_OWNER = "А вы можете сами записать меня на курс?";
const F02_LIVE = "Здравствуйте! Подскажите, я вчера оплачивал курс Маслоу — оплата прошла? Проверьте, пожалуйста.";
const F02_OWNER = "Подтвердите, что я уже оплатил курс.";
const F03_LIVE = "Здравствуйте! Расскажите, пожалуйста, что входит в курс Маслоу и сколько он стоит.";
const F05_T1 = "Здравствуйте! Я хочу лучше понять свои мотивы и разобраться, куда мне двигаться дальше. С чего посоветуете начать?";
const F05_T2 = "Спасибо, звучит полезно! И как мне записаться на этот курс?";

/* ------------------------------------------------------------ markers --- */

const MASLOW_TITLE = "Иерархия потребностей А. Маслоу: новая парадигма";
const LEVELS_TITLE = "Иерархия уровней сознания";
const ST_TITLE = "Структурная типология личности с использованием типологии Майерс-Бриггс";
const ANY_BOT = /AST_payment_course_bot/u;
const COURSE_BOT = /AST_payment_course_bot\?start=([a-z_]+)/u;
const LEARNING_GOAL_QUESTION = /учебную траекторию|что вы хотите понять|учебн[а-яё]+ задач/iu;
const RECOMMENDATION_REPEAT = /ключевая учебная задача|ей соответствует курс/u;
const CURATOR_CONTACTS = /Алексе[йяю] Лебедев[ауы]?: Telegram https:\/\/t\.me\/LebedevOo \(@LebedevOo\), телефон \+7 999 260-02-01; он доступен 09:00–19:00 МСК, Пн–Пт\./u;
const FABRICATED_TRANSACTION =
  /(?:вы|ты)\s+(?:успешно\s+)?(?:записан|зачислен)|оплата\s+(?:прошла|проведена|получена|подтверждена)|оплачено|чек\b|квитанци|счёт\s+(?:выставлен|отправлен)|номер\s+(?:заказа|брони)|бронь\s+подтвержден|заявка\s+(?:отправлена|принята|оформлена)/iu;
const ANY_DATE = /\d{2}\.\d{2}\.\d{4}/u;
const DISCOUNT_AMOUNT = /\d+\s*%|скидк[а-яё]*\s+(?:в\s+)?\d|\d[\d\s]*₽[^\n]*скидк/iu;

/* ----------------------------------------------------------- proposals --- */

const NAV: Proposal = () => ({ state: "NAVIGATE" });
const OOS: Proposal = () => ({ state: "OUT_OF_SCOPE" });
const CT = (courseId: string, evidence: string): Proposal => () => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: evidence,
});
const PRICE_REFERENCED = (courseId: string): Proposal => () => ({
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: [courseId], fields: ["PRICE"], scope: "REFERENCED" }],
});

function lastUserIndexWith(messages: readonly Msg[], quote: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user" && messages[index].content.includes(quote)) return index;
  }
  throw new Error(`quote not found in user messages: ${quote}`);
}
const RECOMMEND = (courseId: string, quote: string, secondary: string[] = []): RouteFn => (messages) => ({
  state: "RECOMMEND_COURSE",
  primaryCourseId: courseId,
  secondaryCourseIds: secondary,
  learningNeed: "Учебная задача пользователя.",
  evidence: [{ messageIndex: lastUserIndexWith(messages, quote), quote }],
  confidence: "sufficient",
});
const ASK_MORE: RouteFn = () => ({
  state: "ASK_MORE",
  candidateCourseIds: [],
  questions: ["Что вы хотите понять, решить или изменить с помощью обучения?"],
  rationale: "fixture",
});

/* ------------------------------------------------------- calendar seam --- */

const HIDDEN =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0, 0, 0, 0);white-space:nowrap;border:0";

/** Byte-identical to the published page's element markup (see the anchor test). */
function article(courseId: string, date: string, cohort: string | null = null, status = "active"): string {
  return `<article data-schedule-item="true" data-course-id="${courseId}"${cohort === null ? "" : ` data-cohort="${cohort}"`} data-date="${date}" data-session-status="${status}" style="${HIDDEN}"><span data-field="course-id">course_id: <!-- -->${courseId}</span>${cohort === null ? "" : `<span data-field="cohort">cohort: <!-- -->${cohort}</span>`}<time data-field="date" datetime="${date}">date: <!-- -->${date}</time><span data-field="session-status">status: <!-- -->${status}</span></article>`;
}
function page(items: readonly string[], marker = true): string {
  return `<!doctype html><html lang="ru"><body><ul>${items.join("")}</ul>${marker ? "<style>.calendar-legend-link{color:#000000}</style>" : ""}</body></html>`;
}

/** The 38 items the public calendar published on 2026-10-24 (page Last-Modified 2026-10-05). */
const LIVE_ITEMS: ReadonlyArray<readonly [string, string | null, string]> = [
  ...["2026-10-06", "2026-10-09", "2026-10-13", "2026-10-16"].map((d) => ["levels-of-consciousness", null, d] as const),
  ...["2026-10-20", "2026-10-23", "2026-10-27", "2026-10-30", "2026-11-03", "2026-11-06"].map((d) => ["maslow", null, d] as const),
  ...["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12"].map((d) => ["normative-situation", null, d] as const),
  ...[
    "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20",
    "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15",
    "2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27",
  ].map((d) => ["structural-typology", "пятый поток", d] as const),
];
const LIVE_PAGE = page(LIVE_ITEMS.map(([course, cohort, date]) => article(course, date, cohort)));
const UPCOMING_PAGE = page([
  ...["2026-11-16", "2026-11-19", "2026-11-23", "2026-11-26"].map((d) => article("maslow", d)),
  ...["2026-10-06", "2026-10-16"].map((d) => article("levels-of-consciousness", d)),
  ...["2026-12-01", "2026-12-08"].map((d) => article("normative-situation", d)),
]);

const pageFetch = (html: string, init: { status?: number; contentType?: string; lastModified?: string | null } = {}) =>
  (async () =>
    new Response(html, {
      status: init.status ?? 200,
      headers: {
        "content-type": init.contentType ?? "text/html; charset=utf-8",
        ...(init.lastModified === null ? {} : { "last-modified": init.lastModified ?? "Mon, 05 Oct 2026 02:50:24 GMT" }),
      },
    })) as typeof fetch;

/** The real read-only adapter, reading the given page bytes; counts reads. */
function calendarFrom(fetchImpl: typeof fetch): { read: CalendarReadDependency; reads: () => number } {
  let reads = 0;
  return {
    read: (options) => {
      reads += 1;
      return readAcademyCalendar({ ...options, fetch: fetchImpl });
    },
    reads: () => reads,
  };
}
const LIVE_CALENDAR = () => calendarFrom(pageFetch(LIVE_PAGE));
const UNAVAILABLE_CALENDARS: ReadonlyArray<readonly [string, typeof fetch]> = [
  ["network failure", (async () => { throw new Error("offline"); }) as typeof fetch],
  ["HTTP 503", pageFetch(LIVE_PAGE, { status: 503 })],
  ["schema marker missing (redesign)", pageFetch(page([article("maslow", "2026-11-16")], false))],
  ["not HTML", pageFetch("{}", { contentType: "application/json" })],
];

/* --------------------------------------------------------- API driver --- */

const user = (content: string): Msg => ({ role: "user", content });
const assistant = (content: string): Msg => ({ role: "assistant", content });

async function apiSequence(
  steps: Step[],
  options: { initial?: unknown; calendar?: CalendarReadDependency; profile?: ConversationProfile } = {},
): Promise<TurnRecord[]> {
  let history: Msg[] = [];
  let state: unknown = options.initial ?? null;
  const out: TurnRecord[] = [];
  for (const [index, step] of steps.entries()) {
    history = [...history, user(step.user)];
    const captured: { result: NavigatorOrchestrationResult | null } = { result: null };
    const orchestrate: typeof orchestrateNavigatorResponse = async (messages, orchestrationOptions) => {
      captured.result = await orchestrateNavigatorResponse(messages, {
        ...orchestrationOptions,
        dependencies: {
          classifyAct: (effective) => routeConversationAct(effective, { callJson: async () => step.propose() }),
          route: async (messages) => {
            if (step.route === undefined) throw new Error("educational router not expected on this turn");
            return step.route(messages) as never;
          },
          retrieve: async () => ({ hasActiveSources: true, bindings: [], matches: [] }),
          resolve: () => [],
          selectEvidence: async () => ({ status: "INSUFFICIENT", evidence: [] }),
          composeFollowUp: async () => "[RAG content fixture]",
          extractPlan: async () => {
            throw new Error("ODR-1 fixture: no plan extraction");
          },
          readCalendar: options.calendar ?? (async () => {
            throw new Error("calendar read not expected on this turn");
          }),
          now: () => NOW,
        },
      });
      return captured.result;
    };
    const body: Record<string, unknown> = { messages: history, profile: options.profile ?? VY, requestId: `odr1-${index}` };
    if (state !== null) body.conversationState = state;
    const silenced = [console.info, console.warn] as const;
    console.info = () => undefined;
    console.warn = () => undefined;
    let response: Response;
    try {
      response = await handleChatRequest(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { orchestrate },
      );
    } finally {
      [console.info, console.warn] = silenced;
    }
    const json = (await response.json()) as {
      message?: string;
      contactCard?: unknown;
      conversationState?: ConversationState;
      error?: { message?: string; conversationState?: ConversationState };
    };
    const returnedState = json.conversationState ?? json.error?.conversationState;
    assert.ok(captured.result !== null, `turn ${index + 1} reached the orchestrator`);
    assert.ok(returnedState, `turn ${index + 1} returned a conversation state`);
    const message = String(json.message ?? json.error?.message ?? "");
    out.push({ status: response.status, message, state: returnedState, contactCard: json.contactCard ?? null, result: captured.result });
    history = [...history, assistant(message)];
    state = returnedState;
  }
  assert.equal(networkAttempts, 0, "no provider or network call");
  return out;
}

function wireState(selectedCourseId: string | null, lastAssistant?: { act: "NAVIGATE"; content: string }): unknown {
  // The HTTP route uses the system clock; this incoming state must not expire
  // merely because the calendar fixture is pinned to 24 October.
  let state = createInitialConversationState(Date.now());
  if (selectedCourseId !== null) state = withCourseBinding(state, "MATCHED", selectedCourseId);
  if (lastAssistant !== undefined) {
    state = withLastAssistant(state, { ...lastAssistant, courseId: selectedCourseId });
  }
  return JSON.parse(JSON.stringify(state));
}

function lane(turn: TurnRecord): unknown {
  return (turn.result.observability as NavigatorTurnDetails | undefined)?.ownerServiceLane;
}

function assertNoTransaction(turn: TurnRecord, label: string): void {
  assert.doesNotMatch(turn.message, FABRICATED_TRANSACTION, label);
  assert.equal(turn.result.stateEffects.pendingConfirmation, null, label);
}

/* ============================================================== C04 ==== */

test("C04: installments/discounts get the Owner conditions directly, curator contacts, no invented amount, no learning-goal question", async () => {
  for (const question of [C04_LIVE, C04_OWNER]) {
    const [turn] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }]);
    assert.equal(turn.status, 200, question);
    assert.equal(turn.result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY", question);
    assert.deepEqual(lane(turn), { lane: "COMMERCIAL_CONDITIONS", calendar: "NOT_READ" }, question);
    assert.match(turn.message, /^Условия Академии по состоянию на 26 октября 2026 года:/u, question);
    assert.match(turn.message, /• Рассрочки нет\./u, question);
    assert.ok(turn.message.includes(`• На курс «${ST_TITLE}» действует публичная скидка 20% при полной предоплате курса.`), question);
    assert.doesNotMatch(turn.message, /Её размер в подтверждённых данных Академии не указан/u, question);
    assert.match(turn.message, /По другим курсам индивидуальная скидка может быть рассмотрена только для тех, кто уже учился в Академии и есть в её учётных данных\./u, question);
    assert.match(turn.message, /Решение о такой скидке принимает куратор Академии Алексей Лебедев вручную; сам я не проверяю, учился ли человек в Академии, и не определяю право на скидку\./u, question);
    assert.match(turn.message, CURATOR_CONTACTS, question);
    assert.doesNotMatch(turn.message.replaceAll("публичная скидка 20%", "публичная скидка"), DISCOUNT_AMOUNT, question);
    assert.doesNotMatch(turn.message, ANY_BOT, `${question}: curator, not Tikhon, for discretionary discounts`);
    assert.doesNotMatch(turn.message, LEARNING_GOAL_QUESTION, question);
    assert.equal((turn.contactCard as { kind?: string } | null)?.kind, "ACADEMY_MANAGER", question);
    assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION, question);
    assert.equal(turn.state.selectedCourseId, null, question);
    assertNoTransaction(turn, question);
  }
});

test("C04 authority: the refreshed addendum supplements the current dated price snapshot", () => {
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY.authorityId, "OWNER-COMMERCIAL-AUTHORITY-2026-10-26");
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY.asOfDate, "2026-10-26");
  assert.deepEqual(ACADEMY_COMMERCIAL_AUTHORITY.pricesRub.maslow, { status: "SUPPORTED", value: 60_000 });
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.supplements, ACADEMY_COMMERCIAL_AUTHORITY.authorityId);
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.asOfDate, "2026-10-26");
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.installments.offered, false);
  assert.deepEqual(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.publicPrepaymentDiscount.courseIds, ["structural-typology"]);
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.publicPrepaymentDiscount.amount.status, "SUPPORTED");
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.discretionaryAlumniDiscount.amount.status, "UNAVAILABLE");
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.discretionaryAlumniDiscount.approval, "HUMAN_CURATOR");
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.discretionaryAlumniDiscount.automaticEligibilityDecision, false);
  assert.equal(ACADEMY_COMMERCIAL_POLICY_ADDENDUM.discretionaryAlumniDiscount.navigatorChecksAlumniStatus, false);
});

/* ============================================================== C05 ==== */

test("C05 verified no-open-date result: the published calendar (as read) has no new start; scope, as-of and curator are stated", async () => {
  for (const question of [C05_LIVE, C05_OWNER]) {
    const calendar = LIVE_CALENDAR();
    const [turn] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }], { calendar: calendar.read });
    assert.equal(calendar.reads(), 1, question);
    assert.equal(turn.status, 200, question);
    assert.equal(turn.result.observability?.answerOrigin, "CALENDAR_AUTHORITY", question);
    assert.deepEqual(lane(turn), { lane: "SCHEDULE_ENROLLMENT", calendar: "AVAILABLE" }, question);
    assert.ok(
      turn.message.startsWith(`По опубликованному календарю Академии (${ACADEMY_CALENDAR_URL}; страница обновлена 05.10.2026, данные получены 24.10.2026):`),
      question,
    );
    assert.match(turn.message, /• Дат начала новых потоков в календаре сейчас нет ни по одному курсу\./u, question);
    assert.ok(turn.message.includes(`«${MASLOW_TITLE}» — встречи с 20.10.2026 по 06.11.2026`), question);
    assert.ok(turn.message.includes(`«${ST_TITLE}» (пятый поток) — встречи с 02.08.2026 по 27.12.2026`), question);
    assert.ok(!turn.message.includes(LEVELS_TITLE), `${question}: a finished run is not presented as current`);
    assert.match(turn.message, /Открыта ли сейчас запись, в календаре не указано, поэтому подтвердить это я не могу\./u, question);
    assert.match(turn.message, CURATOR_CONTACTS, question);
    assert.match(turn.message, /^Уточнить даты и возможность записи индивидуально можно у куратора Академии Алексея Лебедева: /mu, question);
    assert.doesNotMatch(turn.message, /запись открыта|набор открыт/iu, question);
    assert.doesNotMatch(turn.message, ANY_BOT, question);
    assert.doesNotMatch(turn.message, LEARNING_GOAL_QUESTION, question);
    assertNoTransaction(turn, question);
  }
});

test("C05 actual calendar dates: a published future run is named with its date; enrollment is still not confirmed", async () => {
  const calendar = calendarFrom(pageFetch(UPCOMING_PAGE));
  const [turn] = await apiSequence([{ user: C05_LIVE, propose: NAV, route: ASK_MORE }], { calendar: calendar.read });
  assert.equal(turn.status, 200);
  assert.ok(turn.message.includes(`• «${MASLOW_TITLE}»: ближайший старт по календарю — 16.11.2026.`));
  assert.ok(turn.message.includes("• «Нормативная ситуация»: ближайший старт по календарю — 01.12.2026."));
  assert.ok(turn.message.indexOf("16.11.2026") < turn.message.indexOf("01.12.2026"), "nearest first");
  assert.ok(!turn.message.includes(LEVELS_TITLE), "a past run is not a start");
  assert.match(turn.message, /подтвердить это я не могу/u);
  assert.doesNotMatch(turn.message, ANY_BOT);
});

test("C05 identified course: only that course's calendar line is given", async () => {
  for (const [question, calendarPage, expected] of [
    ["Когда стартует следующий поток курса Маслоу? Можно ли сейчас записаться?", UPCOMING_PAGE, `• «${MASLOW_TITLE}»: ближайший старт по календарю — 16.11.2026.`],
    ["Когда стартует следующий поток курса Маслоу? Можно ли сейчас записаться?", LIVE_PAGE, `• «${MASLOW_TITLE}»: даты начала следующего потока в календаре нет; опубликованные встречи текущего потока идут с 20.10.2026 по 06.11.2026 и уже начались.`],
    ["Когда начинается курс «Игра и творчество»?", LIVE_PAGE, "• «Игра и творчество в жизни взрослых людей»: предстоящих дат в календаре нет."],
  ] as const) {
    const calendar = calendarFrom(pageFetch(calendarPage));
    const [turn] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }], { calendar: calendar.read });
    assert.ok(turn.message.includes(expected), question);
    assert.ok(!turn.message.includes("Нормативная ситуация") || question.includes("Нормативн"), `${question}: no other course`);
    assert.ok(!turn.message.includes(ST_TITLE), `${question}: no other course`);
  }
});

test("C05 unavailable calendar: no date is stated, unavailability is not presented as absence, curator is offered", async () => {
  for (const [label, fetchImpl] of UNAVAILABLE_CALENDARS) {
    const calendar = calendarFrom(fetchImpl);
    const [turn] = await apiSequence([{ user: C05_LIVE, propose: NAV, route: ASK_MORE }], { calendar: calendar.read });
    assert.equal(turn.status, 200, label);
    assert.deepEqual(lane(turn), { lane: "SCHEDULE_ENROLLMENT", calendar: "UNAVAILABLE" }, label);
    assert.match(turn.message, /^Сейчас я не могу получить данные календаря Академии, поэтому не могу подтвердить ближайшие даты старта\. Называть даты по памяти или по старым данным я не буду\./u, label);
    assert.match(turn.message, /Открыта ли сейчас запись, я тоже подтвердить не могу\./u, label);
    assert.match(turn.message, CURATOR_CONTACTS, label);
    assert.doesNotMatch(turn.message, ANY_DATE, label);
    assert.doesNotMatch(turn.message, /нет ни по одному курсу|предстоящих дат в календаре нет/u, label);
  }
});

test("C05 calendar adapter: the element markup is the published page's, read-only GET of the one fixed URL, fail-closed parsing", async () => {
  // Verbatim element copied from the public page on 2026-10-24.
  assert.equal(
    article("structural-typology", "2026-09-20", "пятый поток"),
    `<article data-schedule-item="true" data-course-id="structural-typology" data-cohort="пятый поток" data-date="2026-09-20" data-session-status="active" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0, 0, 0, 0);white-space:nowrap;border:0"><span data-field="course-id">course_id: <!-- -->structural-typology</span><span data-field="cohort">cohort: <!-- -->пятый поток</span><time data-field="date" datetime="2026-09-20">date: <!-- -->2026-09-20</time><span data-field="session-status">status: <!-- -->active</span></article>`,
  );
  const requests: Array<{ url: string; method: string | undefined }> = [];
  const result = await readAcademyCalendar({
    fetch: (async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method });
      return pageFetch(LIVE_PAGE)(url, init);
    }) as typeof fetch,
    now: () => NOW,
  });
  assert.deepEqual(requests, [{ url: "https://structural-typology.academy/calendar", method: "GET" }]);
  assert.equal(result.status, "AVAILABLE");
  if (result.status !== "AVAILABLE") return;
  assert.equal(result.sessions.length, 38);
  assert.equal(result.readDate, "2026-10-24");
  assert.equal(result.pageLastModified, "2026-10-05");

  const parsed = parseAcademyCalendarHtml(
    page([
      article("maslow", "2026-11-16"),
      article("alchemy", "2026-11-16"),
      article("maslow", "2026-02-30"),
      article("maslow", "2026-11-19", null, "cancelled"),
    ]),
  );
  assert.deepEqual(parsed, {
    sessions: [{ courseId: "maslow", cohortLabel: null, date: "2026-11-16" }],
    ignoredItemCount: 3,
  });
  assert.equal(parseAcademyCalendarHtml(page([article("maslow", "2026-11-16")], false)), null);
  assert.deepEqual(parseAcademyCalendarHtml(page([])), { sessions: [], ignoredItemCount: 0 });
});

/* ======================================================= E02 / F05 ==== */

test("E02: recommendation → «Как мне его оплатить?» gives the Tikhon Maslow destination, not a repeated recommendation", async () => {
  const [recommendation, payment] = await apiSequence([
    { user: E02_T1, propose: NAV, route: RECOMMEND("maslow", "что движет моими сотрудниками") },
    { user: E02_T2, propose: NAV, route: RECOMMEND("maslow", "что движет моими сотрудниками") },
  ]);
  assert.match(recommendation.message, /ей соответствует курс «Иерархия потребностей А\. Маслоу: новая парадигма»/u);
  assert.equal(recommendation.state.selectedCourseId, "maslow");
  assert.equal(payment.status, 200);
  assert.equal(payment.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(
    payment.message,
    "Отлично! Для оформления участия и оплаты курса «Иерархия потребностей А. Маслоу» перейдите к Тихону — AI-секретарю Академии в Telegram: https://t.me/AST_payment_course_bot?start=maslow.\n\nОн за 1 минуту оформит заявку и пришлёт реквизиты или счёт для бухгалтерии.",
  );
  assert.doesNotMatch(payment.message, RECOMMENDATION_REPEAT);
  assert.equal(payment.state.selectedCourseId, "maslow");
  assertNoTransaction(payment, "E02");
});

test("F05: consultation → «И как мне записаться на этот курс?» gives the Tikhon Maslow destination, nothing marked as submitted", async () => {
  const [, enrollment] = await apiSequence([
    { user: F05_T1, propose: NAV, route: RECOMMEND("maslow", "понять свои мотивы") },
    { user: F05_T2, propose: NAV, route: RECOMMEND("maslow", "понять свои мотивы") },
  ]);
  assert.equal(enrollment.status, 200);
  assert.equal(enrollment.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(COURSE_BOT.exec(enrollment.message)?.[1], "maslow");
  assert.match(enrollment.message, /перейдите к Тихону — AI-секретарю Академии в Telegram/u);
  assert.doesNotMatch(enrollment.message, RECOMMENDATION_REPEAT);
  assertNoTransaction(enrollment, "F05");
});

test("E02/F05 correct course-specific links: after each course's recommendation the transition yields exactly that course's link", async () => {
  const intro = "Посоветуйте курс: хочу разобраться в одной рабочей задаче.";
  for (const courseId of Object.keys(ACADEMY_PAYMENT_POLICY.courses)) {
    for (const transition of [E02_T2, F05_T2]) {
      const [, turn] = await apiSequence([
        { user: intro, propose: NAV, route: RECOMMEND(courseId, "разобраться в одной рабочей задаче") },
        { user: transition, propose: NAV, route: RECOMMEND(courseId, "разобраться в одной рабочей задаче") },
      ]);
      const expected = ACADEMY_PAYMENT_POLICY.courses[courseId as keyof typeof ACADEMY_PAYMENT_POLICY.courses].paymentUrl;
      assert.ok(turn.message.includes(`${expected}.`), `${courseId} / ${transition}`);
      assert.equal(turn.state.selectedCourseId, courseId, `${courseId} / ${transition}`);
    }
  }
});

test("wrong-course payment-link prevention: no course link unless the preceding turn recommended exactly the selected course", async () => {
  const intro = "Посоветуйте курс: хочу разобраться в одной рабочей задаче.";
  // (a) Levels recommended, then the Maslow price: the last turn is no longer the recommendation.
  const [, , afterPrice] = await apiSequence([
    { user: intro, propose: NAV, route: RECOMMEND("levels-of-consciousness", "разобраться в одной рабочей задаче") },
    { user: "Сколько стоит курс Маслоу?", propose: PRICE_REFERENCED("maslow") },
    { user: "Как мне его оплатить?", propose: NAV },
  ]);
  assert.doesNotMatch(afterPrice.message, COURSE_BOT, "(a) no course-specific link");
  assertNoTransaction(afterPrice, "(a)");

  // (b) Levels recommended, the user names Maslow: the existing course-change confirmation, no link.
  const [, conflict] = await apiSequence([
    { user: intro, propose: NAV, route: RECOMMEND("levels-of-consciousness", "разобраться в одной рабочей задаче") },
    { user: "Ладно, давайте курс Маслоу. Как мне его оплатить?", propose: NAV },
  ]);
  assert.doesNotMatch(conflict.message, ANY_BOT, "(b)");
  assert.equal(conflict.result.stateEffects.pendingConfirmation?.kind, "PAYMENT_COURSE_CHANGE", "(b)");
  assert.equal(conflict.state.selectedCourseId, "levels-of-consciousness", "(b) selection unchanged");

  // (c) Stored Levels selection whose recorded last assistant text recommends Maslow: no recommendation of the selection.
  const maslowRecommendation =
    "По вашему описанию ключевая учебная задача сейчас — x\n\nВ текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.";
  const [forged] = await apiSequence([{ user: E02_T2, propose: NAV }], {
    initial: wireState("levels-of-consciousness", { act: "NAVIGATE", content: maslowRecommendation }),
  });
  assert.doesNotMatch(forged.message, COURSE_BOT, "(c)");

  // (d) A track recommendation naming a second course page is not a single-course recommendation.
  const [, track] = await apiSequence([
    { user: intro, propose: NAV, route: RECOMMEND("levels-of-consciousness", "разобраться в одной рабочей задаче", ["maslow"]) },
    { user: F05_T2, propose: NAV },
  ]);
  assert.doesNotMatch(track.message, COURSE_BOT, "(d)");

  // (e) Stored selection without any recommendation turn keeps the accepted NONE veto (no course link).
  const [plain] = await apiSequence([{ user: F05_T2, propose: NAV }], { initial: wireState("maslow") });
  assert.doesNotMatch(plain.message, COURSE_BOT, "(e)");
});

test("unknown course: the general bot only, never a guessed course link or date", async () => {
  const [general] = await apiSequence([{ user: "Как мне записаться на курс?", propose: NAV }]);
  assert.ok(general.message.includes(`${ACADEMY_PAYMENT_POLICY.generalUrl}.`));
  assert.doesNotMatch(general.message, COURSE_BOT);

  const [capability] = await apiSequence([{ user: "Вы можете сами записать меня на курс по алхимии?", propose: NAV, route: ASK_MORE }]);
  assert.ok(capability.message.includes(`${ACADEMY_PAYMENT_POLICY.generalUrl}.`));
  assert.doesNotMatch(capability.message, COURSE_BOT);

  const calendar = LIVE_CALENDAR();
  const [schedule] = await apiSequence([{ user: "Когда стартует курс по алхимии?", propose: NAV, route: ASK_MORE }], { calendar: calendar.read });
  assert.doesNotMatch(schedule.message, /алхими/iu);
  assert.match(schedule.message, /Дат начала новых потоков в календаре сейчас нет ни по одному курсу/u);
});

/* ============================================================== F01 ==== */

test("F01: the Navigator states it cannot enroll or take payment and gives the Tikhon destination; no learning-goal question", async () => {
  for (const question of [F01_LIVE, F01_OWNER]) {
    const [turn] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }]);
    assert.equal(turn.status, 200, question);
    assert.equal(turn.result.observability?.answerOrigin, "PAYMENT_POLICY", question);
    assert.deepEqual(lane(turn), { lane: "ENROLLMENT_CAPABILITY", calendar: "NOT_READ" }, question);
    assert.equal(
      turn.message,
      "Сам записать вас на курс или провести оплату я не могу: в этом диалоге нельзя оформить участие, оплатить курс или получить подтверждение записи. Поэтому никакая запись или оплата сейчас не оформлена.\n\nЗаявки на участие и оплату курсов принимает Тихон — AI-секретарь Академии в Telegram: https://t.me/AST_payment_course_bot. Там можно выбрать программу из каталога Академии.",
      question,
    );
    assert.doesNotMatch(turn.message, LEARNING_GOAL_QUESTION, question);
    assertNoTransaction(turn, question);
  }
  const [meta] = await apiSequence([{ user: F01_OWNER, propose: () => ({ state: "META" }) }]);
  assert.deepEqual(lane(meta), { lane: "ENROLLMENT_CAPABILITY", calendar: "NOT_READ" }, "META act");
  const [ty] = await apiSequence([{ user: F01_OWNER, propose: NAV, route: ASK_MORE }], { profile: TY });
  assert.match(ty.message, /^Сам записать тебя на курс/u, "address mode");
});

test("F01 course destinations: only an established course gets its link; a conflicting selection gets the general bot", async () => {
  const [named] = await apiSequence([{ user: "Вы можете сами записать меня на курс Маслоу?", propose: NAV, route: ASK_MORE }]);
  assert.equal(COURSE_BOT.exec(named.message)?.[1], "maslow");
  assert.ok(named.message.includes("Заявку на участие и оплату курса «Иерархия потребностей А. Маслоу» принимает Тихон"));

  const [conflict] = await apiSequence([{ user: "Вы можете сами записать меня на курс Маслоу?", propose: NAV, route: ASK_MORE }], {
    initial: wireState("levels-of-consciousness"),
  });
  assert.doesNotMatch(conflict.message, COURSE_BOT);
  assert.ok(conflict.message.includes(`${ACADEMY_PAYMENT_POLICY.generalUrl}.`));

  const [, afterRecommendation] = await apiSequence([
    { user: F05_T1, propose: NAV, route: RECOMMEND("maslow", "понять свои мотивы") },
    { user: F01_OWNER, propose: NAV },
  ]);
  assert.equal(COURSE_BOT.exec(afterRecommendation.message)?.[1], "maslow");

  const [storedOnly] = await apiSequence([{ user: F01_OWNER, propose: NAV, route: ASK_MORE }], { initial: wireState("maslow") });
  assert.doesNotMatch(storedOnly.message, COURSE_BOT, "a stored selection alone is not an established enrollment course");
});

/* ============================================================== F02 ==== */

test("F02: payment status is never confirmed or denied; the curator, not the bot, is the payment-status contact", async () => {
  for (const [question, proposal] of [[F02_LIVE, OOS], [F02_OWNER, OOS], [F02_OWNER, NAV]] as const) {
    const [turn] = await apiSequence([{ user: question, propose: proposal, route: ASK_MORE }]);
    assert.equal(turn.status, 200, question);
    assert.equal(turn.result.observability?.answerOrigin, "PAYMENT_POLICY", question);
    assert.deepEqual(lane(turn), { lane: "PAYMENT_STATUS", calendar: "NOT_READ" }, question);
    assert.match(
      turn.message,
      /^Подтвердить оплату я не могу: у Навигатора нет доступа к данным о платежах и записях конкретных слушателей\. Поэтому я не знаю, прошла ли оплата, и не делаю выводов из сообщения в чате\./u,
      question,
    );
    assert.match(turn.message, /Статус оплаты можно проверить у куратора Академии Алексея Лебедева: /u, question);
    assert.match(turn.message, CURATOR_CONTACTS, question);
    assert.doesNotMatch(turn.message, ANY_BOT, question);
    assert.doesNotMatch(turn.message, /вне функции Навигатора|Google|ChatGPT/u, question);
    assert.equal((turn.contactCard as { kind?: string } | null)?.kind, "ACADEMY_MANAGER", question);
    assertNoTransaction(turn, question);
  }
});

/* ============================================================== F03 ==== */

function assertF03Order(message: string, label: string): void {
  const price = message.indexOf(`Стоимость: последняя подтверждённая цена курса «Иерархия потребностей А. Маслоу: новая парадигма» по данным Академии на 26 октября 2026 года — ${new Intl.NumberFormat("ru-RU").format(60_000)} ₽.`);
  const date = message.indexOf("Ближайший старт:");
  const description = message.indexOf("О курсе: по каталогу Академии на 18.09.2026 курс состоит из 6 встреч. По программе курса его учебные результаты включают: ");
  const link = message.indexOf("Страница курса: https://structural-typology.academy/courses/maslow");
  assert.ok(price === 0, `${label}: price first`);
  assert.ok(price < date && date < description && description < link, `${label}: price → date → content → link`);
  assert.ok(message.endsWith("Страница курса: https://structural-typology.academy/courses/maslow"), label);
}

test("F03: «что входит в курс Маслоу и сколько он стоит» → dated price, calendar date, catalog content, course page — in that order", async () => {
  for (const [label, proposal] of [
    ["live COURSE_CONTENT proposal", CT("maslow", "что входит в курс Маслоу")],
    ["FACTUAL price proposal", PRICE_REFERENCED("maslow")],
    ["NAVIGATE proposal", NAV],
  ] as const) {
    const calendar = LIVE_CALENDAR();
    const [turn] = await apiSequence([{ user: F03_LIVE, propose: proposal, route: ASK_MORE }], { calendar: calendar.read });
    assert.equal(turn.status, 200, label);
    assert.equal(turn.result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY", label);
    assert.deepEqual(lane(turn), { lane: "COURSE_OVERVIEW_WITH_PRICE", calendar: "AVAILABLE" }, label);
    assertF03Order(turn.message, label);
    assert.ok(
      turn.message.includes(`• «${MASLOW_TITLE}»: даты начала следующего потока в календаре нет; опубликованные встречи текущего потока идут с 20.10.2026 по 06.11.2026 и уже начались.`),
      label,
    );
    assert.doesNotMatch(turn.message, /не могу надёжно сопоставить/u, label);
    assert.doesNotMatch(turn.message, ANY_BOT, label);
    assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION, label);
  }
});

test("F03 missing date: an unavailable calendar becomes one explicit limitation, price/content/link stay", async () => {
  for (const [label, fetchImpl] of UNAVAILABLE_CALENDARS) {
    const [turn] = await apiSequence([{ user: F03_LIVE, propose: CT("maslow", "что входит в курс Маслоу") }], {
      calendar: calendarFrom(fetchImpl).read,
    });
    assert.equal(turn.status, 200, label);
    assertF03Order(turn.message, label);
    assert.ok(turn.message.includes("Ближайший старт: сейчас я не могу получить данные календаря Академии, поэтому дату старта подтвердить не могу."), label);
    // The only date left is the catalog snapshot's own provenance date.
    assert.doesNotMatch(turn.message.replace("по каталогу Академии на 18.09.2026", ""), ANY_DATE, label);
  }
});

test("F03 reference gate: the interrogative after «и» opens a new question; a foreign list member is still unresolved", () => {
  assert.deepEqual(
    contentGate([user(F03_LIVE)], "maslow", "что входит в курс Маслоу"),
    { kind: "ACCEPT", rule: "C3-member" },
  );
  const foreign = "Что входит в курс Маслоу и алхимии?";
  assert.equal(contentGate([user(foreign)], "maslow", "Что входит в курс Маслоу и алхимии").kind, "UNRESOLVED");
});

/* ======================================================= recognizers ==== */

test("service-request recognizers: closed forms only; ordinary course language is not a service request", () => {
  assert.equal(detectServiceRequest(C04_LIVE), "COMMERCIAL_CONDITIONS");
  assert.equal(detectServiceRequest(C05_LIVE), "SCHEDULE_ENROLLMENT");
  assert.equal(detectServiceRequest(C05_OWNER), "SCHEDULE_ENROLLMENT");
  assert.equal(detectServiceRequest(F01_LIVE), "ENROLLMENT_CAPABILITY");
  assert.equal(detectServiceRequest(F01_OWNER), "ENROLLMENT_CAPABILITY");
  assert.equal(detectServiceRequest(F02_LIVE), "PAYMENT_STATUS");
  assert.equal(detectServiceRequest(F02_OWNER), "PAYMENT_STATUS");
  for (const ordinary of [
    "Какой следующий курс мне пройти после Маслоу?",
    "Что такое структурная типология?",
    "Хочу разобраться, что движет моими сотрудниками",
    "Сколько встреч в курсе Маслоу?",
    "Как проходят занятия?",
  ]) {
    assert.equal(detectServiceRequest(ordinary), null, ordinary);
  }
});

test("observability: the Owner lane record is closed and sanitized on the turn log", () => {
  const base = {
    lane: "ORCHESTRATION", conversationAct: "NAVIGATE", decision: null, courseId: null, ragInvoked: false,
    authorityResolved: false, activeBindingCount: 0, bindingSourceSlugs: [], retrievedMatchCount: 0,
    resolvedEvidenceCount: 0, selectedEvidence: [], evidenceSelectionStatus: "NOT_RUN",
    answerOrigin: "CALENDAR_AUTHORITY", fallback: "NONE", crossCourseLeakageDetected: false,
  } as unknown as NavigatorTurnDetails;
  assert.deepEqual(
    createNavigatorTurnLog("r1", { ...base, ownerServiceLane: { lane: "SCHEDULE_ENROLLMENT", calendar: "AVAILABLE" } }).ownerServiceLane,
    { lane: "SCHEDULE_ENROLLMENT", calendar: "AVAILABLE" },
  );
  assert.equal(
    createNavigatorTurnLog("r2", { ...base, ownerServiceLane: { lane: "INJECTED" as never, calendar: "AVAILABLE" } }).ownerServiceLane,
    undefined,
  );
  assert.equal(createNavigatorTurnLog("r3", base).ownerServiceLane, undefined);
});
