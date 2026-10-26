import assert from "node:assert/strict";
import test, { after } from "node:test";

import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import type { ConversationMessage, ConversationProfile } from "../../src/lib/chat-contract.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import type { ConversationState } from "../../src/lib/navigation/conversation-state.ts";
import type { NavigatorTurnDetails } from "../../src/lib/navigation/navigator-observability.ts";
import {
  composeCatalogListAnswer,
  composeFactualAnswer,
  composePaymentIntentBoundaryAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  asksExplicitPrice,
  composeCommercialConditionsAnswer,
  factualIntentsBesideServiceRequest,
} from "../../src/lib/navigation/owner-service-lanes.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY_VERSION } from "../../src/lib/academy/commercial-authority.ts";
import { ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION } from "../../src/lib/academy/commercial-policy-addendum.ts";
import { getAcademyCourse } from "../../src/lib/academy/course-catalog.ts";
import {
  readAcademyCalendar,
  type CalendarReadDependency,
} from "../../src/lib/academy/course-calendar.ts";
import { ACADEMY_PAYMENT_POLICY } from "../../src/lib/academy/payment-policy.ts";

/**
 * NAVIGATOR-LIVE-ACCEPTANCE-1.OWNER-DEFECT-REMEDIATION-1.CORR1 — Owner
 * decisions OD-1..OD-5 of 2026-10-24.
 *
 * OD-5 A: the Owner-confirmed service questions (discounts and installments,
 * start dates and enrollment availability, the Navigator's enrollment
 * capability, payment status) get the same Owner-defined answer when DeepSeek
 * proposes FACTUAL as when it proposes NAVIGATE / OUT_OF_SCOPE / META, while
 * unrelated FACTUAL questions keep their accepted answers.
 * OD-5 B: the payment-intent boundary (inherited MAJOR-REMEDIATION-1 OD-2=A)
 * states the known addendum rules and keeps only amounts, eligibility and
 * other special conditions unconfirmed.
 *
 * Every turn goes through the real chat route, act-router validator,
 * orchestrator, metadata guard, payment policy, authorities and composers;
 * each turn's returned message and conversationState feed the next request.
 * Deterministic seams only: the act proposal, the educational router
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
  throw new Error("OWNER-DEFECT-REMEDIATION-1.CORR1 TEST NETWORK FORBIDDEN");
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const VY: ConversationProfile = { displayName: null, addressMode: "VY", nameDeclined: true, pendingUserRequest: null };
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
const ANY_BOT = /AST_payment_course_bot/u;
const COURSE_BOT = /AST_payment_course_bot\?start=([a-z_]+)/u;
const PRICE_TEXT = /последняя подтверждённая цена|подтверждённой цены|₽/u;
const SUPERSEDED_TIMING_CEILING = /авторитетного значения нет/u;
const SUPERSEDED_DISCOUNT_DENIAL = /скидки, специальные условия или рассрочка в подтверждённых данных Академии не указаны/u;
const DISCOUNT_DENIAL = /скидок\s+нет|скидки\s+(?:не\s+предусмотрены|отсутствуют)|(?:скидки|рассрочка)[^.\n]{0,60}не\s+указаны/iu;
const ENROLLMENT_STATUS_CLAIM = /запись\s+(?:сейчас\s+)?(?:уже\s+)?(?:открыта|закрыта|идёт|завершена)|набор\s+(?:сейчас\s+)?(?:открыт|закрыт|идёт|завершён)/iu;
const CURATOR_CONTACTS = /Алексе[йяю] Лебедев[ауы]?: Telegram https:\/\/t\.me\/LebedevOo \(@LebedevOo\), телефон \+7 999 260-02-01; он доступен 09:00–19:00 МСК, Пн–Пт\./u;
const FABRICATED_TRANSACTION =
  /(?:вы|ты)\s+(?:успешно\s+)?(?:записан|зачислен)|оплата\s+(?:прошла|проведена|получена|подтверждена)|оплачено|чек\b|квитанци|счёт\s+(?:выставлен|отправлен)|номер\s+(?:заказа|брони)|бронь\s+подтвержден|заявка\s+(?:отправлена|принята|оформлена)/iu;
const DISCOUNT_AMOUNT = /\d+\s*%|скидк[а-яё]*\s+(?:в\s+)?\d|\d[\d\s]*₽[^\n]*скидк/iu;
/** A stated discount size; the boundary line legitimately carries the dated price before the rules. */
const DISCOUNT_SIZE = /\d+\s*%|скидк[а-яё]*\s+(?:в\s+|до\s+|на\s+)?\d|размер[а-яё]*\s+(?:скидки\s+)?(?:—|-|:)?\s*\d/iu;

/* ----------------------------------------------------------- proposals --- */

const NAV: Proposal = () => ({ state: "NAVIGATE" });
const OOS: Proposal = () => ({ state: "OUT_OF_SCOPE" });
const META: Proposal = () => ({ state: "META" });
const factual = (...intents: Record<string, unknown>[]): Proposal => () => ({ state: "FACTUAL", intents });
const metadata = (fields: string[], courseIds: string[] = [], scope = "ALL") =>
  ({ kind: "CURRENT_METADATA", courseIds, fields, scope });
/** Real FACTUAL alternatives a DeepSeek act proposal can take for these messages. */
const F_PRICE_ALL = factual(metadata(["PRICE"]));
const F_TIMING_ALL = factual(metadata(["COHORT", "ENROLLMENT_WINDOW"]));
const F_ALL_FIELDS = factual(metadata(["PRICE", "SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"]));
const F_CATALOG = factual({ kind: "CATALOG_LIST" });
const F_OVERVIEW = factual({ kind: "ACADEMY_OVERVIEW" });
const F_PRICE_MASLOW = factual(metadata(["PRICE"], ["maslow"], "REFERENCED"));
const F_TIMING_MASLOW = factual(metadata(["COHORT", "ENROLLMENT_WINDOW"], ["maslow"], "REFERENCED"));
const FACTUAL_ALTERNATIVES: ReadonlyArray<readonly [string, Proposal]> = [
  ["FACTUAL PRICE/ALL", F_PRICE_ALL],
  ["FACTUAL COHORT+ENROLLMENT_WINDOW/ALL", F_TIMING_ALL],
  ["FACTUAL all metadata fields/ALL", F_ALL_FIELDS],
  ["FACTUAL CATALOG_LIST", F_CATALOG],
  ["FACTUAL ACADEMY_OVERVIEW", F_OVERVIEW],
];

function lastUserIndexWith(messages: readonly Msg[], quote: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user" && messages[index].content.includes(quote)) return index;
  }
  throw new Error(`quote not found in user messages: ${quote}`);
}
const RECOMMEND = (courseId: string, quote: string): RouteFn => (messages) => ({
  state: "RECOMMEND_COURSE",
  primaryCourseId: courseId,
  secondaryCourseIds: [],
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

/** The published page's element markup (anchored in owner-defect-remediation-1.test.mts). */
function article(courseId: string, date: string, cohort: string | null = null): string {
  return `<article data-schedule-item="true" data-course-id="${courseId}"${cohort === null ? "" : ` data-cohort="${cohort}"`} data-date="${date}" data-session-status="active" style="${HIDDEN}"><span data-field="course-id">course_id: <!-- -->${courseId}</span>${cohort === null ? "" : `<span data-field="cohort">cohort: <!-- -->${cohort}</span>`}<time data-field="date" datetime="${date}">date: <!-- -->${date}</time><span data-field="session-status">status: <!-- -->active</span></article>`;
}
function page(items: readonly string[]): string {
  return `<!doctype html><html lang="ru"><body><ul>${items.join("")}</ul><style>.calendar-legend-link{color:#000000}</style></body></html>`;
}

/** The 38 items the public calendar published on 2026-10-24 (page Last-Modified 2026-10-05). */
const LIVE_PAGE = page([
  ...["2026-10-06", "2026-10-09", "2026-10-13", "2026-10-16"].map((d) => article("levels-of-consciousness", d)),
  ...["2026-10-20", "2026-10-23", "2026-10-27", "2026-10-30", "2026-11-03", "2026-11-06"].map((d) => article("maslow", d)),
  ...["2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05", "2026-11-12"].map((d) => article("normative-situation", d)),
  ...[
    "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20",
    "2026-09-27", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15",
    "2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27",
  ].map((d) => article("structural-typology", d, "пятый поток")),
]);
const UPCOMING_PAGE = page([
  ...["2026-11-16", "2026-11-19", "2026-11-23", "2026-11-26"].map((d) => article("maslow", d)),
  ...["2026-10-06", "2026-10-16"].map((d) => article("levels-of-consciousness", d)),
]);

const pageFetch = (html: string, status = 200) =>
  (async () =>
    new Response(html, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "last-modified": "Mon, 05 Oct 2026 02:50:24 GMT" },
    })) as typeof fetch;

/** The real read-only adapter over the given page bytes; counts reads. */
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
const CALENDARS: ReadonlyArray<readonly [string, () => typeof fetch]> = [
  ["live page 2026-10-24", () => pageFetch(LIVE_PAGE)],
  ["future run published", () => pageFetch(UPCOMING_PAGE)],
  ["calendar unavailable (HTTP 503)", () => pageFetch(LIVE_PAGE, 503)],
  ["calendar unavailable (network)", () => (async () => { throw new Error("offline"); }) as typeof fetch],
];

/* --------------------------------------------------------- API driver --- */

const user = (content: string): Msg => ({ role: "user", content });
const assistant = (content: string): Msg => ({ role: "assistant", content });

async function apiSequence(
  steps: Step[],
  options: { calendar?: CalendarReadDependency } = {},
): Promise<TurnRecord[]> {
  let history: Msg[] = [];
  let state: unknown = null;
  const out: TurnRecord[] = [];
  for (const [index, step] of steps.entries()) {
    history = [...history, user(step.user)];
    const captured: { result: NavigatorOrchestrationResult | null } = { result: null };
    const orchestrate: typeof orchestrateNavigatorResponse = async (messages, orchestrationOptions) => {
      captured.result = await orchestrateNavigatorResponse(messages, {
        ...orchestrationOptions,
        dependencies: {
          classifyAct: (effective) => routeConversationAct(effective, { callJson: async () => step.propose() }),
          route: async (routed) => {
            if (step.route === undefined) throw new Error("educational router not expected on this turn");
            return step.route(routed) as never;
          },
          retrieve: async () => ({ hasActiveSources: true, bindings: [], matches: [] }),
          resolve: () => [],
          selectEvidence: async () => ({ status: "INSUFFICIENT", evidence: [] }),
          composeFollowUp: async () => "[RAG content fixture]",
          extractPlan: async () => {
            throw new Error("ODR-1.CORR1 fixture: no plan extraction");
          },
          readCalendar: options.calendar ?? (async () => {
            throw new Error("calendar read not expected on this turn");
          }),
          now: () => NOW,
        },
      });
      return captured.result;
    };
    const body: Record<string, unknown> = { messages: history, profile: VY, requestId: `odr1c1-${index}` };
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

function lane(turn: TurnRecord): unknown {
  return (turn.result.observability as NavigatorTurnDetails | undefined)?.ownerServiceLane;
}

/** The parts of a turn that must not depend on which act DeepSeek proposed. */
function observable(turn: TurnRecord): unknown {
  return {
    status: turn.status,
    message: turn.message,
    contactCard: turn.contactCard,
    origin: turn.result.observability?.answerOrigin,
    lane: lane(turn),
    completion: turn.result.completion,
    transactional: turn.result.stateEffects.transactionalAuthorityVersion,
    selectedCourseId: turn.state.selectedCourseId,
    courseMatch: turn.state.courseMatch,
    lastAssistantAct: turn.state.lastAssistant?.act ?? null,
  };
}

function assertNoTransaction(turn: TurnRecord, label: string): void {
  assert.doesNotMatch(turn.message, FABRICATED_TRANSACTION, label);
  assert.equal(turn.result.stateEffects.pendingConfirmation, null, label);
}

/* ============================================================ OD-5 A ==== */

test("CORR1 C04: every FACTUAL proposal gets exactly the NAVIGATE answer — published prepayment percentage, curator, no unrequested course price", async () => {
  for (const question of [C04_LIVE, C04_OWNER]) {
    const [reference] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }]);
    assert.deepEqual(lane(reference), { lane: "COMMERCIAL_CONDITIONS", calendar: "NOT_READ" }, question);
    assert.equal(reference.message, composeCommercialConditionsAnswer().message, question);
    for (const [label, proposal] of FACTUAL_ALTERNATIVES) {
      const [turn] = await apiSequence([{ user: question, propose: proposal }]);
      const tag = `${question} / ${label}`;
      assert.deepEqual(observable(turn), observable(reference), tag);
      assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION, tag);
      assert.match(turn.message, /• Рассрочки нет\./u, tag);
      assert.match(turn.message, CURATOR_CONTACTS, tag);
      assert.match(turn.message, /публичная скидка 20% при полной предоплате курса\./u, tag);
      assert.doesNotMatch(turn.message.replaceAll("публичная скидка 20%", "публичная скидка"), DISCOUNT_AMOUNT, tag);
      assert.doesNotMatch(turn.message, PRICE_TEXT, `${tag}: no unrequested price`);
      assert.doesNotMatch(turn.message, SUPERSEDED_TIMING_CEILING, tag);
      assert.doesNotMatch(turn.message, ANY_BOT, tag);
      assertNoTransaction(turn, tag);
    }
  }
});

test("CORR1 C05: every FACTUAL proposal gets exactly the NAVIGATE calendar answer for every calendar state; enrollment is never confirmed", async () => {
  for (const question of [C05_LIVE, C05_OWNER]) {
    for (const [calendarLabel, calendarFetch] of CALENDARS) {
      const referenceCalendar = calendarFrom(calendarFetch());
      const [reference] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }], { calendar: referenceCalendar.read });
      assert.equal(referenceCalendar.reads(), 1, `${question} / ${calendarLabel}`);
      for (const [label, proposal] of FACTUAL_ALTERNATIVES) {
        const calendar = calendarFrom(calendarFetch());
        const [turn] = await apiSequence([{ user: question, propose: proposal }], { calendar: calendar.read });
        const tag = `${question} / ${calendarLabel} / ${label}`;
        assert.equal(calendar.reads(), 1, `${tag}: one calendar read`);
        assert.deepEqual(observable(turn), observable(reference), tag);
        assert.equal(turn.result.observability?.answerOrigin, "CALENDAR_AUTHORITY", tag);
        assert.doesNotMatch(turn.message, SUPERSEDED_TIMING_CEILING, tag);
        assert.doesNotMatch(turn.message, ENROLLMENT_STATUS_CLAIM, `${tag}: neither open nor closed is claimed`);
        assert.doesNotMatch(turn.message, PRICE_TEXT, tag);
        assert.match(turn.message, /Открыта ли сейчас запись, (?:в календаре не указано, поэтому подтвердить это я не могу|я тоже подтвердить не могу)\./u, tag);
        assert.match(turn.message, CURATOR_CONTACTS, tag);
        assert.doesNotMatch(turn.message, ANY_BOT, tag);
        if (calendarLabel.startsWith("calendar unavailable")) {
          assert.match(turn.message, /^Сейчас я не могу получить данные календаря Академии/u, tag);
          assert.doesNotMatch(turn.message, /\d{2}\.\d{2}\.\d{4}/u, `${tag}: no date when unavailable`);
          assert.doesNotMatch(turn.message, /Дат начала новых потоков в календаре сейчас нет/u, `${tag}: missing data is not absence`);
        } else {
          assert.match(turn.message, /страница обновлена 05\.10\.2026, данные получены 24\.10\.2026/u, `${tag}: publication and retrieval dates`);
          assert.match(turn.message, /Открыта ли сейчас запись, в календаре не указано, поэтому подтвердить это я не могу\./u, tag);
        }
        assertNoTransaction(turn, tag);
      }
    }
  }
  // A named course under a FACTUAL proposal referencing it: only that course's line.
  const named = "Когда стартует курс Маслоу и можно ли записаться?";
  const [navNamed] = await apiSequence([{ user: named, propose: NAV, route: ASK_MORE }], { calendar: calendarFrom(pageFetch(UPCOMING_PAGE)).read });
  for (const proposal of [F_TIMING_MASLOW, F_PRICE_MASLOW]) {
    const [turn] = await apiSequence([{ user: named, propose: proposal }], { calendar: calendarFrom(pageFetch(UPCOMING_PAGE)).read });
    assert.deepEqual(observable(turn), observable(navNamed), named);
    assert.ok(turn.message.includes(`• «${MASLOW_TITLE}»: ближайший старт по календарю — 16.11.2026.`), named);
    assert.doesNotMatch(turn.message, /Иерархия уровней сознания/u, named);
  }
});

test("CORR1 F01/F02: FACTUAL proposals get the Owner-approved capability and payment-status answers", async () => {
  for (const question of [F01_LIVE, F01_OWNER]) {
    const [reference] = await apiSequence([{ user: question, propose: NAV, route: ASK_MORE }]);
    assert.deepEqual(lane(reference), { lane: "ENROLLMENT_CAPABILITY", calendar: "NOT_READ" }, question);
    assert.equal(
      reference.message,
      "Сам записать вас на курс или провести оплату я не могу: в этом диалоге нельзя оформить участие, оплатить курс или получить подтверждение записи. Поэтому никакая запись или оплата сейчас не оформлена.\n\nЗаявки на участие и оплату курсов принимает Тихон — AI-секретарь Академии в Telegram: https://t.me/AST_payment_course_bot. Там можно выбрать программу из каталога Академии.",
      question,
    );
    for (const [label, proposal] of [...FACTUAL_ALTERNATIVES, ["META", META] as const]) {
      const [turn] = await apiSequence([{ user: question, propose: proposal }]);
      assert.deepEqual(observable(turn), observable(reference), `${question} / ${label}`);
      assertNoTransaction(turn, `${question} / ${label}`);
    }
  }
  for (const question of [F02_LIVE, F02_OWNER]) {
    const [reference] = await apiSequence([{ user: question, propose: OOS }]);
    assert.deepEqual(lane(reference), { lane: "PAYMENT_STATUS", calendar: "NOT_READ" }, question);
    assert.match(reference.message, /^Подтвердить оплату я не могу: у Навигатора нет доступа к данным о платежах/u, question);
    for (const [label, proposal] of [...FACTUAL_ALTERNATIVES, ["FACTUAL PRICE/maslow", F_PRICE_MASLOW] as const, ["NAVIGATE", NAV] as const]) {
      const [turn] = await apiSequence([{ user: question, propose: proposal, route: ASK_MORE }]);
      const tag = `${question} / ${label}`;
      assert.deepEqual(observable(turn), observable(reference), tag);
      assert.match(turn.message, CURATOR_CONTACTS, tag);
      assert.doesNotMatch(turn.message, ANY_BOT, tag);
      assert.doesNotMatch(turn.message, PRICE_TEXT, tag);
      assertNoTransaction(turn, tag);
    }
  }
});

test("CORR1 mixed FACTUAL: a literally asked price leads the service answer; the guard's ceiling is kept and never adds a price", async () => {
  const maslowPrice = composeFactualAnswer(
    [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" }],
    null,
    VY,
  );
  // Price + discount: the dated price, then the addendum.
  const priceAndDiscount = "Сколько стоит курс Маслоу и есть ли скидки?";
  const [both] = await apiSequence([{ user: priceAndDiscount, propose: F_PRICE_MASLOW }]);
  assert.equal(both.message, `${maslowPrice}\n\n${composeCommercialConditionsAnswer().message}`);
  assert.match(both.message, /60[\s\u00a0]000 ₽/u);
  assert.equal(both.result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
  assert.equal(both.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION);

  // Price + start: the dated price, then the calendar.
  const priceAndStart = "Сколько стоит курс Маслоу и когда стартует следующий поток?";
  const calendar = calendarFrom(pageFetch(UPCOMING_PAGE));
  const [priceStart] = await apiSequence([{ user: priceAndStart, propose: factual(metadata(["PRICE", "COHORT"], ["maslow"], "REFERENCED")) }], { calendar: calendar.read });
  assert.ok(priceStart.message.startsWith(`${maslowPrice}\n\nПо опубликованному календарю Академии`), priceAndStart);
  assert.ok(priceStart.message.includes(`• «${MASLOW_TITLE}»: ближайший старт по календарю — 16.11.2026.`), priceAndStart);
  assert.doesNotMatch(priceStart.message, SUPERSEDED_TIMING_CEILING);
  assert.equal(priceStart.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);

  // A discount question proposed with PRICE: the price is not asked, so none is shown.
  for (const question of ["Есть ли скидки на курс Маслоу?", "А рассрочка на курс Маслоу есть?"]) {
    const [turn] = await apiSequence([{ user: question, propose: F_PRICE_MASLOW }]);
    assert.equal(turn.message, composeCommercialConditionsAnswer().message, question);
    assert.doesNotMatch(turn.message, PRICE_TEXT, question);
  }

  // Installments proposed as SCHEDULE: the guard vetoes SCHEDULE and adds no PRICE; its
  // record stays, and its price limitation is not shown beside a non-price question.
  const [installments] = await apiSequence([{ user: "Есть ли рассрочка?", propose: factual(metadata(["SCHEDULE"])) }]);
  assert.equal(installments.message, composeCommercialConditionsAnswer().message);
  assert.equal(installments.result.completion, "ANSWERED");
  assert.deepEqual(installments.result.observability?.metadataFieldGuard?.vetoedFields, ["SCHEDULE"]);
  assert.deepEqual(installments.result.observability?.metadataFieldGuard?.addedFields, []);

  // Duration + discount: the guard's catalogue duration text, then the addendum; no price.
  const durationAndDiscount = "Сколько длится курс Маслоу и есть ли скидки?";
  const [duration] = await apiSequence([{ user: durationAndDiscount, propose: F_PRICE_MASLOW }]);
  assert.match(duration.message, /^В текущем каталоге/u);
  assert.ok(duration.message.endsWith(composeCommercialConditionsAnswer().message));
  assert.doesNotMatch(duration.message, PRICE_TEXT);
  assert.deepEqual(duration.result.observability?.metadataFieldGuard?.dispositions, ["CATALOG_DURATION"]);

  // A literal price question proposed without PRICE keeps the guard's price limitation, never a price.
  const [limited] = await apiSequence([{ user: "Сколько стоит курс Маслоу и есть ли скидки?", propose: factual(metadata(["SCHEDULE"], ["maslow"], "REFERENCED")) }]);
  assert.ok(limited.message.startsWith("О стоимости: в этом ответе я её не называю"));
  assert.doesNotMatch(limited.message, /₽/u);
  assert.equal(limited.result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");

  // The lead helper keeps only a literal price.
  assert.equal(asksExplicitPrice("Есть ли скидки или рассрочка?"), false);
  assert.equal(asksExplicitPrice("Какая цена курса Маслоу?"), true);
  assert.deepEqual(
    factualIntentsBesideServiceRequest([{ kind: "CATALOG_LIST" }, { kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE", "COHORT"], scope: "REFERENCED" }], "Сколько стоит курс Маслоу и когда старт?"),
    [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" }],
  );
});

test("CORR1 unrelated FACTUAL questions keep their accepted answers and read no calendar", async () => {
  const rows: ReadonlyArray<readonly [string, Proposal, Record<string, unknown>[]]> = [
    ["Сколько стоит курс Маслоу?", F_PRICE_MASLOW, [metadata(["PRICE"], ["maslow"], "REFERENCED")]],
    ["Какая цена курса Маслоу?", F_PRICE_MASLOW, [metadata(["PRICE"], ["maslow"], "REFERENCED")]],
    ["Сколько стоят все курсы?", F_PRICE_ALL, [metadata(["PRICE"])]],
    ["Какое расписание у курса Маслоу?", factual(metadata(["SCHEDULE"], ["maslow"], "REFERENCED")), [metadata(["SCHEDULE"], ["maslow"], "REFERENCED")]],
  ];
  for (const [question, proposal, intents] of rows) {
    const [turn] = await apiSequence([{ user: question, propose: proposal }]);
    assert.equal(turn.result.conversationAct.state, "FACTUAL", question);
    assert.equal(turn.message, composeFactualAnswer(intents as never, null, VY, question), question);
    assert.equal(turn.result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY", question);
    assert.equal(lane(turn), undefined, question);
    assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION, question);
  }
  const [catalog] = await apiSequence([{ user: "Какие курсы есть в Академии?", propose: F_CATALOG }]);
  assert.equal(catalog.message, composeCatalogListAnswer());
  assert.equal(lane(catalog), undefined);
});

/* ============================================================ OD-5 B ==== */

test("CORR1 OD-2 boundary: the addendum rules are stated per course, only amounts/eligibility/other conditions stay unconfirmed", async () => {
  for (const courseId of Object.keys(ACADEMY_PAYMENT_POLICY.courses)) {
    const title = getAcademyCourse(courseId)?.title;
    assert.ok(title, courseId);
    const boundary = composePaymentIntentBoundaryAnswer(courseId, VY);
    assert.ok(boundary.includes(`Курс «${title}»: последняя подтверждённая цена по данным на 26 октября 2026 года — `), courseId);
    assert.match(boundary, /Рассрочки нет\./u, courseId);
    if (courseId === "structural-typology") {
      assert.match(boundary, /На этот курс действует публичная скидка 20% при полной предоплате\./u, courseId);
      assert.doesNotMatch(boundary, /уже учился в Академии/u, courseId);
    } else {
      assert.match(boundary, /Индивидуальная скидка на этот курс может быть рассмотрена только для тех, кто уже учился в Академии и есть в её учётных данных; решение принимает куратор Академии Алексей Лебедев, её размер в подтверждённых данных Академии не указан\./u, courseId);
      assert.doesNotMatch(boundary, /публичная скидка при полной предоплате/u, courseId);
    }
    assert.match(boundary, /Другие суммы, право на скидку и иные специальные условия в подтверждённых данных Академии не указаны, поэтому подтвердить их я не могу\./u, courseId);
    assert.doesNotMatch(boundary, SUPERSEDED_DISCOUNT_DENIAL, courseId);
    assert.doesNotMatch(boundary, DISCOUNT_DENIAL, `${courseId}: never denies the known discount rules`);
    assert.doesNotMatch(boundary.replaceAll("публичная скидка 20%", "публичная скидка"), DISCOUNT_SIZE, courseId);
    assert.match(boundary, /никакая запись или оплата сейчас не оформлена/u, courseId);
    assert.doesNotMatch(boundary, FABRICATED_TRANSACTION, courseId);
    assert.doesNotMatch(boundary, ANY_BOT, courseId);
  }
  // No course identified: no commercial line at all, still no fabricated state.
  const general = composePaymentIntentBoundaryAnswer(null, VY);
  assert.doesNotMatch(general, /скидк|рассрочк|₽/u);

  // Through the API: the inherited OD-2 lane (explicit unqualified payment intent).
  for (const question of [
    "Запишите меня на курс Маслоу и проведите оплату прямо сейчас.",
    "Я видел, что курс Маслоу стоит 30 000 рублей. Это правда? Хочу оплатить по этой цене.",
  ]) {
    const [turn] = await apiSequence([{ user: question, propose: NAV }]);
    assert.equal(turn.result.observability?.answerOrigin, "PAYMENT_POLICY", question);
    assert.match(turn.message, /Индивидуальная скидка на этот курс может быть рассмотрена/u, question);
    assert.doesNotMatch(turn.message, SUPERSEDED_DISCOUNT_DENIAL, question);
    assert.doesNotMatch(turn.message, /30\s?000/u, question);
    assert.doesNotMatch(turn.message, ANY_BOT, question);
    assertNoTransaction(turn, question);
  }
});

/* ===================================================== preservation ==== */

test("CORR1 preservation: E02/F05 Tikhon transfer, F03 order, and no wrong-course link after a FACTUAL service turn", async () => {
  const [, e02] = await apiSequence([
    { user: E02_T1, propose: NAV, route: RECOMMEND("maslow", "что движет моими сотрудниками") },
    { user: E02_T2, propose: NAV, route: RECOMMEND("maslow", "что движет моими сотрудниками") },
  ]);
  assert.equal(
    e02.message,
    "Отлично! Для оформления участия и оплаты курса «Иерархия потребностей А. Маслоу» перейдите к Тихону — AI-секретарю Академии в Telegram: https://t.me/AST_payment_course_bot?start=maslow.\n\nОн за 1 минуту оформит заявку и пришлёт реквизиты или счёт для бухгалтерии.",
  );
  const [, f05] = await apiSequence([
    { user: F05_T1, propose: NAV, route: RECOMMEND("maslow", "понять свои мотивы") },
    { user: F05_T2, propose: NAV, route: RECOMMEND("maslow", "понять свои мотивы") },
  ]);
  assert.equal(COURSE_BOT.exec(f05.message)?.[1], "maslow");
  assertNoTransaction(f05, "F05");

  for (const [label, fetchImpl] of [["live", pageFetch(LIVE_PAGE)], ["unavailable", pageFetch(LIVE_PAGE, 503)]] as const) {
    const [f03] = await apiSequence([{ user: F03_LIVE, propose: F_PRICE_MASLOW }], { calendar: calendarFrom(fetchImpl).read });
    const price = f03.message.indexOf("Стоимость: последняя подтверждённая цена курса «Иерархия потребностей А. Маслоу: новая парадигма»");
    const date = f03.message.indexOf("Ближайший старт:");
    const content = f03.message.indexOf("О курсе: по каталогу Академии на 18.09.2026");
    const link = f03.message.indexOf("Страница курса: https://structural-typology.academy/courses/maslow");
    assert.ok(price === 0 && price < date && date < content && content < link, `F03 ${label}: price → date → content → link`);
    assert.deepEqual(lane(f03), { lane: "COURSE_OVERVIEW_WITH_PRICE", calendar: label === "live" ? "AVAILABLE" : "UNAVAILABLE" }, label);
  }

  // Levels recommended; a FACTUAL discount / start question about Maslow; then «Как мне его оплатить?».
  const intro = "Посоветуйте курс: хочу разобраться в одной рабочей задаче.";
  for (const [question, proposal] of [
    ["Есть ли скидки на курс Маслоу?", F_PRICE_MASLOW],
    ["Когда стартует курс Маслоу?", F_TIMING_MASLOW],
  ] as const) {
    const [recommendation, service, payment] = await apiSequence([
      { user: intro, propose: NAV, route: RECOMMEND("levels-of-consciousness", "разобраться в одной рабочей задаче") },
      { user: question, propose: proposal },
      { user: "Как мне его оплатить?", propose: NAV },
    ], { calendar: calendarFrom(pageFetch(UPCOMING_PAGE)).read });
    assert.equal(recommendation.state.selectedCourseId, "levels-of-consciousness", question);
    assert.equal(service.state.selectedCourseId, "levels-of-consciousness", `${question}: the service turn binds no course`);
    assert.doesNotMatch(payment.message, COURSE_BOT, `${question}: no course-specific link`);
    assertNoTransaction(payment, question);
  }
});
