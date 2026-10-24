import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage, ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  routeConversationAct,
  validateConversationActDecision,
} from "../../src/lib/navigation/conversation-act-router.ts";
import { orchestrateNavigatorResponse } from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  composeContentReferenceClarification,
  composeFollowUpReferenceClarification,
} from "../../src/lib/navigation/conversation-response.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY_VERSION } from "../../src/lib/academy/commercial-authority.ts";

/**
 * NAVIGATOR-PREVIEW-LIVE-DEEPSEEK-VERIFICATION-1.MAJOR-REMEDIATION-1.CORR1 —
 * V-MAJ-01 (OD-1=A1) and V-MAJ-02 (OD-2=A) regressions.
 *
 * The user texts below are the exact Z.ai transcript messages from
 * NAVIGATOR_PREVIEW_LIVE_DEEPSEEK_VERIFICATION_1_EVIDENCE/runs/{B01,C05,E02,E05,F02}.json
 * (manifest-verified). The provider is never called: each turn injects the act
 * JSON DeepSeek proposed live (observability `proposedAct`) into the real router
 * validator, and the real orchestrator, payment policy, commercial authority and
 * composers run unchanged. These lock deterministic mechanics, not provider accuracy.
 */

type Msg = ConversationMessage;

const B01 = "В чём основная идея курса «Иерархия потребностей А. Маслоу»?";
const C05 = "Когда открывается набор на следующий поток курса Маслоу?";
const E02_T1 = "Сколько встреч в курсе «Игра и творчество»?";
const E02_T2 = "А сколько он стоит?";
const E05_T1 = "Я видел, что курс Маслоу стоит 30 000 рублей. Это правда? Хочу оплатить по этой цене.";
const E05_T2 = "Так как оплатить со скидкой до 30 000?";
const F02 = "Запишите меня на курс Маслоу и проведите оплату прямо сейчас.";
/** The live E02.T1 assistant refusal, replayed verbatim in the E02.T2 request. */
const LIVE_REFUSAL =
  "Не могу надёжно определить, что речь идёт о курсе Академии. Если вы спрашиваете о курсе Академии — назовите его так, как он указан в каталоге (можно скопировать название со страницы курса). Если вопрос по теме, а не о конкретном курсе, — задайте его отдельным вопросом, и я отвечу по материалам Академии.";

const MASLOW_TITLE = "Иерархия потребностей А. Маслоу: новая парадигма";
const PLAY_TITLE = "Игра и творчество в жизни взрослых людей";
const VY: ConversationProfile = { displayName: null, addressMode: "VY", nameDeclined: true, pendingUserRequest: null };
const UNCERTAINTY = new Set([composeFollowUpReferenceClarification(VY), composeContentReferenceClarification(VY)]);

const user = (content: string): Msg => ({ role: "user", content });
const assistant = (content: string): Msg => ({ role: "assistant", content });
const followUp = (courseId: string) => ({ state: "COURSE_FOLLOW_UP", courseId, evidenceRequested: false });
const NAVIGATE = { state: "NAVIGATE" };

const PAYMENT_LINK = /AST_payment_course_bot/u;
const FABRICATED_TRANSACTION =
  /(?:вы|ты)\s+(?:успешно\s+)?(?:записан|зачислен)|оплата\s+(?:прошла|проведена|получена|подтверждена)|оплачено|чек|квитанци|номер\s+(?:заказа|брони)|бронь\s+подтвержден/iu;

async function turn(
  messages: Msg[],
  proposal: Record<string, unknown>,
  conversationState?: Record<string, unknown>,
) {
  const retrieved: string[] = [];
  const followUpCourses: string[] = [];
  let routeCalls = 0;
  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    conversationState: conversationState as never,
    dependencies: {
      classifyAct: (history) => routeConversationAct(history, { callJson: async () => structuredClone(proposal) }),
      retrieve: async (courseId) => {
        retrieved.push(courseId);
        return { hasActiveSources: true, bindings: [], matches: [] };
      },
      resolve: () => [],
      route: async () => {
        routeCalls += 1;
        return { state: "NO_CURRENT_COURSE_MATCH", rationale: "STUB" } as never;
      },
      compose: async () => "STUB RECOMMENDATION",
      composeFollowUp: async (_messages, act, options) => {
        followUpCourses.push(act.courseId);
        options.onOutcome?.({ answerOrigin: "FACTUAL_CEILING", fallback: "FACTUAL_CEILING" });
        return `STUB FOLLOW-UP ${act.courseId}`;
      },
    },
  });
  return { result, retrieved, followUpCourses, routeCalls };
}

/* ------------------------------------------------------------------ V-MAJ-01 */

test("V-MAJ-01 B01: the exact live message resolves Maslow through COURSE_CONTENT, not the reference clarification", async () => {
  const { result, retrieved, followUpCourses } = await turn([user(B01)], followUp("maslow"));
  assert.equal(result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(retrieved, ["maslow"]);
  assert.deepEqual(followUpCourses, ["maslow"]);
  assert.equal(result.message, "STUB FOLLOW-UP maslow");
  assert.ok(!UNCERTAINTY.has(result.message));
  assert.equal(result.observability?.courseId, "maslow");
  assert.equal(result.observability?.crossCourseLeakageDetected, false);
  assert.equal(result.observability?.courseReferenceUncertainty, undefined);
});

test("V-MAJ-01 C05: the enrollment-window question reaches commercial authority and returns the dated factual ceiling", async () => {
  const { result, retrieved, routeCalls } = await turn([user(C05)], followUp("maslow"));
  assert.equal(result.conversationAct.state, "FACTUAL");
  assert.deepEqual(retrieved, []);
  assert.equal(routeCalls, 0);
  assert.equal(result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
  assert.match(result.message, /по состоянию на 19 сентября 2026 года/u);
  assert.match(result.message, /окно набора: авторитетного значения нет/u);
  assert.match(result.message, /текущий поток: авторитетного значения нет/u);
  // No invented date and no unrequested price.
  assert.doesNotMatch(result.message, /₽/u);
  assert.doesNotMatch(result.message, /\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|октября|ноября|декабря)\b/u);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
  assert.equal(result.observability?.metadataFieldGuard, undefined);
});

test("V-MAJ-01 E02: T1 resolves Play and Creativity; T2 «А сколько он стоит?» no longer cascades and prices that course", async () => {
  const t1 = await turn([user(E02_T1)], followUp("play-and-creativity"));
  assert.equal(t1.result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(t1.retrieved, ["play-and-creativity"]);
  assert.ok(!UNCERTAINTY.has(t1.result.message));

  // Exact live T2 history (with the live T1 refusal) and the corrected history.
  for (const history of [
    [user(E02_T1), assistant(LIVE_REFUSAL), user(E02_T2)],
    [user(E02_T1), assistant(t1.result.message), user(E02_T2)],
  ]) {
    const t2 = await turn(history, followUp("play-and-creativity"));
    assert.equal(t2.result.conversationAct.state, "FACTUAL");
    assert.deepEqual(t2.retrieved, []);
    assert.equal(t2.result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
    assert.match(
      t2.result.message,
      new RegExp(`«${PLAY_TITLE}»: последняя подтверждённая цена по данным на 19 сентября 2026 года — 60 000 ₽\\.`, "u"),
    );
    assert.ok(!t2.result.message.includes(MASLOW_TITLE));
    assert.ok(!UNCERTAINTY.has(t2.result.message));
  }
});

test("V-MAJ-01 explicit unique reference: a short name becomes COURSE_CONTENT for exactly that course, never COURSE_FOLLOW_UP", () => {
  const text = "Расскажите про курс Маслоу.";
  const value = validateConversationActDecision(followUp("maslow"), [user(text)]);
  assert.deepEqual(value, { state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: text });
  // The proposal may not substitute another course for the one the user named.
  const other = validateConversationActDecision(followUp("normative-situation"), [user(text)]);
  assert.equal(other.state, "COURSE_REFERENCE_UNRESOLVED");
  // Literal FOLLOW_UP authority is unchanged.
  assert.deepEqual(
    validateConversationActDecision(followUp("maslow"), [user(`Расскажите про «${MASLOW_TITLE}».`)]),
    followUp("maslow"),
  );
});

test("V-MAJ-01 genuine unresolved pronoun: a bare «этот курс» with no established course binds nothing", async () => {
  assert.throws(
    () => validateConversationActDecision(followUp("maslow"), [user("Сколько длится этот курс?")]),
    /absent from the conversation/u,
  );
  const { result, retrieved } = await turn([user("Сколько длится этот курс?")], followUp("maslow"));
  assert.deepEqual(retrieved, []);
  assert.notEqual(result.conversationAct.state, "COURSE_CONTENT");
  assert.notEqual(result.conversationAct.state, "FACTUAL");
  assert.doesNotMatch(result.message, /₽/u);
});

test("V-MAJ-01 ambiguity: two catalog courses, a course beside an unknown program, or a course plus a topic course stay unresolved", async () => {
  for (const text of [
    "Сравните курс Маслоу и курс «Игра и творчество» — что там разбирается?",
    "Прохожу курс алхимии и курс Маслоу. Что там разбирается?",
    "Что на курсе Маслоу говорят о нормативной ситуации?",
  ]) {
    const { result, retrieved } = await turn([user(text)], followUp("maslow"));
    assert.equal(result.conversationAct.state, "COURSE_REFERENCE_UNRESOLVED", text);
    assert.deepEqual(retrieved, [], text);
    assert.equal(result.message, composeFollowUpReferenceClarification(VY), text);
  }
});

test("V-MAJ-01 established context: an anaphoric follow-up uses only the user's own earlier explicit reference", async () => {
  const history = [user("Что изучают на курсе Маслоу?"), assistant("Курс Маслоу — это 6 встреч."), user("А что в нём разбирают?")];
  const { result, retrieved } = await turn(history, followUp("maslow"));
  assert.equal(result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(retrieved, ["maslow"]);
  // The assistant's wording never establishes a course: no user reference → no binding.
  assert.throws(
    () => validateConversationActDecision(followUp("maslow"), [user("Привет"), assistant("Курс Маслоу — это 6 встреч."), user("А что в нём разбирают?")]),
    /absent from the conversation/u,
  );
});

test("V-MAJ-01 course switch: the latest explicit course wins; history never substitutes; a stale selection is invalidated", async () => {
  const history = [user("Что изучают на курсе Маслоу?"), assistant("STUB FOLLOW-UP maslow"), user(E02_T1)];
  const switched = await turn(history, followUp("play-and-creativity"));
  assert.equal(switched.result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(switched.retrieved, ["play-and-creativity"]);
  // The historical course is never bound when the latest message names another one.
  const substituted = await turn(history, followUp("maslow"));
  assert.equal(substituted.result.conversationAct.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.deepEqual(substituted.retrieved, []);
  // P4-B kept: a stored MATCHED Maslow selection is invalidated by the switch turn.
  const stored = await turn([user(E02_T1)], followUp("play-and-creativity"), { courseMatch: "MATCHED", selectedCourseId: "maslow" });
  assert.deepEqual(stored.retrieved, ["play-and-creativity"]);
  assert.deepEqual(stored.result.stateEffects.courseBinding, { kind: "INVALIDATE_SELECTION" });
  // Naming the already selected course keeps the selection.
  const same = await turn([user(B01)], followUp("maslow"), { courseMatch: "MATCHED", selectedCourseId: "maslow" });
  assert.equal(same.result.stateEffects.courseBinding, undefined);
  // A literal title in the conversation keeps the unchanged literal paths (F-1 precondition).
  const literal = await turn([assistant(`Рекомендую «${MASLOW_TITLE}».`), user(E02_T1)], followUp("play-and-creativity"));
  assert.equal(literal.result.conversationAct.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.deepEqual(literal.retrieved, []);
});

test("V-MAJ-01 content-gate and routability guards are unchanged for COURSE_CONTENT proposals and LISTED_UNROUTABLE", () => {
  const t09 = "Что на курсе Маслоу говорят о нормативной ситуации";
  const rejected = validateConversationActDecision(
    { state: "COURSE_CONTENT", courseId: "normative-situation", evidenceRequested: false, contentIntentEvidence: t09 },
    [user(t09)],
  );
  assert.equal(rejected.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.throws(
    () => validateConversationActDecision(followUp("professional-development-stages"), [user("Курс стадий профессионального развития — что там?")]),
    /current routable course/u,
  );
  // An over-long message keeps the unchanged uncertainty (bounded evidence).
  const long = `${"Подробно опишите, пожалуйста, ".repeat(9)}что даёт курс Маслоу?`;
  assert.ok(long.length > 240);
  assert.equal(validateConversationActDecision(followUp("maslow"), [user(long)]).state, "COURSE_REFERENCE_UNRESOLVED");
});

test("V-MAJ-01 factual metadata guard: a converted price question carries PRICE only, and a mixed duration subject gets the guard's handling", async () => {
  const price = validateConversationActDecision(followUp("maslow"), [user("Сколько стоит курс Маслоу?")]);
  assert.deepEqual(price, {
    state: "FACTUAL",
    intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" }],
  });
  const mixed = await turn([user("Сколько стоит и сколько встреч в курсе Маслоу?")], followUp("maslow"));
  assert.equal(mixed.result.conversationAct.state, "FACTUAL");
  assert.match(mixed.result.message, /60 000 ₽/u);
  assert.match(mixed.result.message, /количество встреч: 6\./u);
  assert.doesNotMatch(mixed.result.message, /расписание|окно набора/u);
});

test("V-MAJ-01 OWNER-ACCEPTED RESIDUAL (not solved): a foreign course framing may resolve as the Academy course", async () => {
  const text = "Курс Маслоу на Coursera — что там?";
  // Pre-existing on the COURSE_CONTENT route …
  assert.equal(
    validateConversationActDecision({ state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: text }, [user(text)]).state,
    "COURSE_CONTENT",
  );
  // … and, under OD-1=A1, extended to the follow-up route. Recorded, not prevented.
  const { result, retrieved } = await turn([user(text)], followUp("maslow"));
  assert.equal(result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(retrieved, ["maslow"]);
  assert.doesNotMatch(result.message, PAYMENT_LINK);
});

/* ------------------------------------------------------------------ V-MAJ-02 */

function assertPaymentBoundary(
  outcome: Awaited<ReturnType<typeof turn>>,
  label: string,
): void {
  const { result, retrieved, routeCalls } = outcome;
  assert.equal(result.observability?.answerOrigin, "PAYMENT_POLICY", label);
  assert.equal(result.conversationAct.state, "NAVIGATE", label);
  assert.equal(result.decision, null, label);
  assert.equal(routeCalls, 0, label);
  assert.deepEqual(retrieved, [], label);
  assert.doesNotMatch(result.message, /STUB RECOMMENDATION|ключевая учебная задача/u, label);
  assert.match(result.message, /Записать вас на курс или провести оплату сам я не могу/u, label);
  assert.match(result.message, /никакая запись или оплата сейчас не оформлена/u, label);
  assert.match(
    result.message,
    new RegExp(`«${MASLOW_TITLE}»: последняя подтверждённая цена по данным на 19 сентября 2026 года — 60 000 ₽\\.`, "u"),
    label,
  );
  assert.match(result.message, /Другие суммы, скидки, специальные условия или рассрочка в подтверждённых данных Академии не указаны/u, label);
  assert.doesNotMatch(result.message, /30\s?000/u, label);
  assert.doesNotMatch(result.message, PAYMENT_LINK, label);
  assert.doesNotMatch(result.message, FABRICATED_TRANSACTION, label);
  assert.match(result.message, /https:\/\/t\.me\/AST_rulang/u, label);
  assert.match(result.message, /https:\/\/t\.me\/LebedevOo/u, label);
  assert.equal(result.contactCard?.kind, "ACADEMY_MANAGER", label);
  assert.equal(result.stateEffects.pendingConfirmation, null, label);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION, label);
}

test("V-MAJ-02 E05.T1: the false 30 000 ₽ premise is corrected with the dated price; no link, no fake state, contact handoff", async () => {
  const outcome = await turn([user(E05_T1)], NAVIGATE);
  assertPaymentBoundary(outcome, "E05.T1");
  assert.deepEqual(outcome.result.stateEffects.courseBinding, { kind: "MATCHED", courseId: "maslow" });
});

test("V-MAJ-02 E05.T2: the unsupported discount is not accepted (exact live history and stored state)", async () => {
  const outcome = await turn(
    [user(E05_T1), assistant("STUB"), user(E05_T2)],
    NAVIGATE,
    { courseMatch: "MATCHED", selectedCourseId: "maslow" },
  );
  assertPaymentBoundary(outcome, "E05.T2");
  assert.equal(outcome.result.stateEffects.courseBinding, undefined);
});

test("V-MAJ-02 F02: enrollment + immediate payment request explains the limitation instead of recommending", async () => {
  const outcome = await turn([user(F02)], NAVIGATE);
  assertPaymentBoundary(outcome, "F02");
});

test("V-MAJ-02 payment-link authority is unchanged: qualified grammar keeps the authorized link; unqualified never gains one", async () => {
  const qualified = await turn([user("Хочу оплатить курс Маслоу")], NAVIGATE);
  assert.match(qualified.result.message, /https:\/\/t\.me\/AST_payment_course_bot\?start=maslow/u);
  assert.equal(qualified.result.contactCard, null);
  const general = await turn([user("Как записаться?")], NAVIGATE);
  assert.match(general.result.message, /https:\/\/t\.me\/AST_payment_course_bot\b/u);
  assert.doesNotMatch(general.result.message, /\?start=/u);
  for (const text of ["Давай хочу оплатить курс Маслоу", "Он сказал: хочу оплатить курс Маслоу."]) {
    const unqualified = await turn([user(text)], NAVIGATE);
    assert.equal(unqualified.result.observability?.answerOrigin, "PAYMENT_POLICY", text);
    assert.doesNotMatch(unqualified.result.message, PAYMENT_LINK, text);
  }
  // A listed-but-unroutable course keeps the unchanged "not payable" answer.
  const pds = await turn([user("Хочу оплатить курс стадии профессионального развития")], NAVIGATE);
  assert.match(pds.result.message, /нет подтверждённой ссылки на оплату/u);
  assert.doesNotMatch(pds.result.message, PAYMENT_LINK);
});

test("V-MAJ-02 a genuine recommendation request with no payment intent still routes normally", async () => {
  const { result, routeCalls } = await turn([user("Хочу разобраться, почему мотивация сотрудников падает под давлением")], NAVIGATE);
  assert.equal(routeCalls, 1);
  assert.notEqual(result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.doesNotMatch(result.message, PAYMENT_LINK);
  assert.doesNotMatch(result.message, /провести оплату сам я не могу/u);
});
