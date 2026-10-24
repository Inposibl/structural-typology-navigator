import assert from "node:assert/strict";
import test, { after } from "node:test";

import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import type { ConversationMessage, ConversationProfile } from "../../src/lib/chat-contract.ts";
import {
  routeConversationAct,
  validateConversationActDecision,
} from "../../src/lib/navigation/conversation-act-router.ts";
import {
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  createInitialConversationState,
  withCourseBinding,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { composeFollowUpReferenceClarification } from "../../src/lib/navigation/conversation-response.ts";
import { composeCourseFactualCeilingAnswer } from "../../src/lib/academy/contact-policy.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY_VERSION } from "../../src/lib/academy/commercial-authority.ts";
import { CourseEvidenceSelectionError } from "../../src/lib/knowledge/retrieval/evidence-selector.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

/**
 * NAVIGATOR-PREVIEW-LIVE-DEEPSEEK-VERIFICATION-1.MAJOR-REMEDIATION-1.CORR2 —
 * F-01..F-04 of CORR1.IV1 as real API sequences.
 *
 * Every turn goes through the real chat route (`handleChatRequest`), the real
 * control kernel, the real conversation-act router validator, orchestrator,
 * payment policy, commercial authority, metadata guard, follow-up / catalog /
 * factual-ceiling composers and state transitions. The response text and the
 * returned conversationState of each turn are fed into the next request. Only
 * the provider seams are fixed: the act proposal (the live DeepSeek proposal
 * where one exists), retrieval, authority resolution (empty, or a structural
 * cross-course fault), the evidence selector and the educational router. No
 * composeFollowUp stub is used. Global fetch throws and is counted.
 */

type Msg = ConversationMessage;
type Proposal = (latest: string) => Record<string, unknown>;
type Fault = "NONE" | "STRUCTURAL" | "NO_SOURCES" | "SELECTOR_DEGRADED";
type Step = { user: string; propose: Proposal; fault?: Fault };
type TurnRecord = {
  status: number;
  message: string;
  state: ConversationState;
  selectedBefore: string | null;
  selectedAfter: string | null;
  courseMatchAfter: string | null;
  result: NavigatorOrchestrationResult;
  retrieved: string[];
  routeCalls: number;
};

let networkAttempts = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  networkAttempts += 1;
  throw new Error("CORR2 TEST NETWORK FORBIDDEN");
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const VY: ConversationProfile = { displayName: null, addressMode: "VY", nameDeclined: true, pendingUserRequest: null };

// Exact live Z.ai transcript strings (NAVIGATOR_PREVIEW_LIVE_DEEPSEEK_VERIFICATION_1_EVIDENCE/runs).
const E02_T1 = "Сколько встреч в курсе «Игра и творчество»?";
const E02_T2 = "А сколько он стоит?";
const LIVE_REFUSAL =
  "Не могу надёжно определить, что речь идёт о курсе Академии. Если вы спрашиваете о курсе Академии — назовите его так, как он указан в каталоге (можно скопировать название со страницы курса). Если вопрос по теме, а не о конкретном курсе, — задайте его отдельным вопросом, и я отвечу по материалам Академии.";
const F02_LIVE = "Запишите меня на курс Маслоу и проведите оплату прямо сейчас.";
// Exact CORR1.IV1 challenge strings.
const S2_REPORT = "Школа феникс запустила курс про Маслоу.";
const S2_PAY = "Хочу оплатить этот курс.";
const COURSERA = "Прохожу курс про Маслоу на Coursera. Что там разбирается?";
const NORMATIVE_CONCEPT = "Что такое нормативная ситуация?";

const PLAY_TITLE = "Игра и творчество в жизни взрослых людей";
const MASLOW_TITLE = "Иерархия потребностей А. Маслоу: новая парадигма";
const LEVELS_TITLE = "Иерархия уровней сознания";
// Intl ru-RU groups thousands with U+00A0; the exact rendered bytes are pinned.
const PLAY_PRICE_LINE = `«${PLAY_TITLE}»: последняя подтверждённая цена по данным на 19 сентября 2026 года — 60\u00a0000 ₽.`;
const MASLOW_PRICE_LINE = `«${MASLOW_TITLE}»: последняя подтверждённая цена по данным на 19 сентября 2026 года — 60\u00a0000 ₽.`;
const literal = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");
const LEVELS_PRICE = /45[\s ]?000/u;
const COMMERCIAL_LEAD = "Коммерческие сведения ограничены подтверждёнными данными Академии по состоянию на 19 сентября 2026 года.";
const NAME_THE_COURSE = "Уточните, пожалуйста, название курса. Без выбранного или названного курса я не могу определить, о какой цене идёт речь.";
const UNCERTAINTY = composeFollowUpReferenceClarification(VY);
const ANY_BOT = /AST_payment_course_bot/u;
const COURSE_BOT = /AST_payment_course_bot\?start=([a-z_]+)/u;
const FABRICATED_TRANSACTION =
  /(?:вы|ты)\s+(?:успешно\s+)?(?:записан|зачислен)|оплата\s+(?:прошла|проведена|получена|подтверждена)|оплачено|чек|квитанци|номер\s+(?:заказа|брони)|бронь\s+подтвержден/iu;

const FU = (courseId: string): Proposal => () => ({ state: "COURSE_FOLLOW_UP", courseId, evidenceRequested: false });
const CT = (courseId: string): Proposal => (latest) => ({
  state: "COURSE_CONTENT",
  courseId,
  evidenceRequested: false,
  contentIntentEvidence: latest.slice(0, 240),
});
const NAV: Proposal = () => ({ state: "NAVIGATE" });
const PRICE_SELECTED: Proposal = () => ({
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: [], fields: ["PRICE"], scope: "SELECTED" }],
});

const user = (content: string): Msg => ({ role: "user", content });
const assistant = (content: string): Msg => ({ role: "assistant", content });

function wireState(selectedCourseId: string | null): unknown {
  const initial = createInitialConversationState(Date.now());
  const state = selectedCourseId === null ? initial : withCourseBinding(initial, "MATCHED", selectedCourseId);
  return JSON.parse(JSON.stringify(state));
}

function evidenceFor(courseId: string): ResolvedCourseEvidence[] {
  return [
    {
      chunkId: 77,
      documentId: "doc",
      sourceId: "source",
      courseId,
      sourceSlug: `${courseId}-fixture`,
      sourceTitle: "Fixture",
      sourceKind: "manuscript",
      authorityRelation: "FOUNDATIONAL",
      courseSourceMetadata: {},
      sourceMetadata: {},
      documentMetadata: {},
      content: "CORR2 fixture chunk",
      contentSha256: "b".repeat(64),
      headingPath: [],
      locator: {},
      chunkMetadata: {},
      similarity: 0.9,
      controllingAuthorityEntries: [],
      evidenceRole: "FOUNDATIONAL",
    },
  ];
}

async function apiSequence(
  steps: Step[],
  options: { prior?: Msg[]; initial?: unknown } = {},
): Promise<TurnRecord[]> {
  let history: Msg[] = [...(options.prior ?? [])];
  let state: unknown = options.initial ?? null;
  const out: TurnRecord[] = [];
  for (const [index, step] of steps.entries()) {
    history = [...history, user(step.user)];
    const fault = step.fault ?? "NONE";
    const retrieved: string[] = [];
    let routeCalls = 0;
    const captured: { result: NavigatorOrchestrationResult | null } = { result: null };
    const orchestrate: typeof orchestrateNavigatorResponse = async (messages, orchestrationOptions) => {
      captured.result = await orchestrateNavigatorResponse(messages, {
        ...orchestrationOptions,
        dependencies: {
          classifyAct: (effective) =>
            routeConversationAct(effective, {
              callJson: async () => step.propose(effective.at(-1)?.content ?? ""),
            }),
          retrieve: async (courseId) => {
            retrieved.push(courseId);
            return { hasActiveSources: fault !== "NO_SOURCES", bindings: [], matches: [] };
          },
          resolve: () =>
            fault === "STRUCTURAL"
              ? evidenceFor("levels-of-consciousness")
              : fault === "SELECTOR_DEGRADED"
                ? evidenceFor(retrieved.at(-1) ?? "")
                : [],
          selectEvidence: async () => {
            if (fault === "SELECTOR_DEGRADED") {
              throw new CourseEvidenceSelectionError("CORR2 controlled selector rejection");
            }
            return { status: "INSUFFICIENT", evidence: [] };
          },
          route: async () => {
            routeCalls += 1;
            return { state: "NO_CURRENT_COURSE_MATCH", rationale: "CORR2 fixture" } as never;
          },
          compose: async () => "CORR2 recommendation fixture",
          extractPlan: async () => {
            throw new Error("CORR2 fixture: no plan extraction");
          },
        },
      });
      return captured.result;
    };
    const selectedBefore =
      state === null ? null : ((state as ConversationState).selectedCourseId ?? null);
    const body: Record<string, unknown> = { messages: history, profile: VY, requestId: `corr2-${index}` };
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
      conversationState?: ConversationState;
      error?: { message?: string; conversationState?: ConversationState };
    };
    const result = captured.result;
    const returnedState = json.conversationState ?? json.error?.conversationState;
    assert.ok(result !== null, `turn ${index + 1} reached the orchestrator`);
    assert.ok(returnedState, `turn ${index + 1} returned a conversation state`);
    const message = String(json.message ?? json.error?.message ?? "");
    out.push({
      status: response.status,
      message,
      state: returnedState,
      selectedBefore,
      selectedAfter: returnedState.selectedCourseId ?? null,
      courseMatchAfter: returnedState.courseMatch ?? null,
      result,
      retrieved,
      routeCalls,
    });
    history = [...history, assistant(message)];
    state = returnedState;
  }
  assert.equal(networkAttempts, 0, "no provider or network call");
  return out;
}

function assertNoTransactionState(turn: TurnRecord, label: string): void {
  assert.doesNotMatch(turn.message, FABRICATED_TRANSACTION, label);
  assert.equal(turn.result.stateEffects.pendingConfirmation, null, label);
}

/* ========================================================== Sequence A — E02 */

test("CORR2 A (F-03): exact E02 T1 → T2 with the real composer and returned state prices Play and Creativity", async () => {
  const [t1, t2] = await apiSequence([
    { user: E02_T1, propose: FU("play-and-creativity") },
    { user: E02_T2, propose: FU("play-and-creativity") },
  ]);

  // T1 — the real deterministic catalog answer introduces the full catalog title.
  assert.equal(t1.status, 200);
  assert.equal(t1.result.conversationAct.state, "COURSE_CONTENT");
  assert.equal(t1.result.observability?.answerOrigin, "CATALOG_AUTHORITY");
  assert.ok(t1.message.includes(`«${PLAY_TITLE}»`));
  assert.match(t1.message, /количество встреч: 6\./u);
  assert.deepEqual(t1.retrieved, ["play-and-creativity"]);
  assert.equal(t1.selectedBefore, null);
  assert.equal(t1.selectedAfter, null);

  // T2 — the literal follow-up is re-validated as commercial metadata: PRICE from
  // commercial authority with its date, no RAG, no payment link, no binding.
  assert.equal(t2.status, 200);
  assert.deepEqual(t2.result.conversationAct, {
    state: "FACTUAL",
    intents: [{ kind: "CURRENT_METADATA", courseIds: ["play-and-creativity"], fields: ["PRICE"], scope: "REFERENCED" }],
  });
  assert.equal(t2.result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
  assert.equal(t2.message, `${COMMERCIAL_LEAD}\n• ${PLAY_PRICE_LINE}`);
  assert.equal(t2.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
  assert.equal(t2.state.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
  assert.deepEqual(t2.retrieved, []);
  assert.equal(t2.routeCalls, 0);
  assert.equal(t2.result.completion, "ANSWERED");
  assert.doesNotMatch(t2.message, ANY_BOT);
  assert.ok(!t2.message.includes(MASLOW_TITLE));
  assert.equal(t2.result.stateEffects.courseBinding, undefined);
  assert.equal(t2.selectedAfter, null);
  assertNoTransactionState(t2, "E02.T2");
});

test("CORR2 A (F-03): the original live refusal history and the full official title both price the course", async () => {
  // Owner-confirmed ANTECEDENT: the exact live T2 request (with the live refusal).
  const [refusal] = await apiSequence([{ user: E02_T2, propose: FU("play-and-creativity") }], {
    prior: [user(E02_T1), assistant(LIVE_REFUSAL)],
  });
  assert.equal(refusal.result.conversationAct.state, "FACTUAL");
  assert.equal(refusal.message, `${COMMERCIAL_LEAD}\n• ${PLAY_PRICE_LINE}`);
  assert.deepEqual(refusal.retrieved, []);

  // Same sequence where T1 already uses the full official title.
  const [full1, full2] = await apiSequence([
    { user: `Сколько встреч в курсе «${PLAY_TITLE}»?`, propose: FU("play-and-creativity") },
    { user: E02_T2, propose: FU("play-and-creativity") },
  ]);
  assert.equal(full1.result.conversationAct.state, "COURSE_FOLLOW_UP");
  assert.match(full1.message, /6/u);
  assert.equal(full2.result.conversationAct.state, "FACTUAL");
  assert.equal(full2.message, `${COMMERCIAL_LEAD}\n• ${PLAY_PRICE_LINE}`);
  assert.deepEqual(full2.retrieved, []);
});

test("CORR2 A (F-03): content follow-ups stay literal, unresolved and switched references never price the wrong course", async () => {
  // A content question after the real T1 keeps the unchanged literal FOLLOW_UP lane.
  const [, content] = await apiSequence([
    { user: E02_T1, propose: FU("play-and-creativity") },
    { user: "А что в нём разбирают?", propose: FU("play-and-creativity") },
  ]);
  assert.equal(content.result.conversationAct.state, "COURSE_FOLLOW_UP");
  assert.deepEqual(content.retrieved, ["play-and-creativity"]);
  assert.doesNotMatch(content.message, /₽/u);
  assert.doesNotMatch(content.message, ANY_BOT);

  // A genuine unresolved reference: nothing establishes «он».
  const [fresh] = await apiSequence([{ user: E02_T2, propose: FU("play-and-creativity") }]);
  assert.doesNotMatch(fresh.message, /₽/u);
  assert.deepEqual(fresh.retrieved, []);
  assert.notEqual(fresh.result.conversationAct.state, "FACTUAL");

  // A different course in T2: the model's literal Play binding is not re-validated
  // into a Play price, and a Maslow proposal stays the unchanged uncertainty.
  for (const proposal of [FU("play-and-creativity"), FU("maslow")]) {
    const [, switched] = await apiSequence([
      { user: E02_T1, propose: FU("play-and-creativity") },
      { user: "А сколько стоит курс Маслоу?", propose: proposal },
    ]);
    assert.ok(!switched.message.includes(PLAY_PRICE_LINE));
    assert.notEqual(switched.result.conversationAct.state, "FACTUAL");
    assert.doesNotMatch(switched.message, ANY_BOT);
  }

  // A literal follow-up payment request keeps the unchanged literal payment route.
  const [, pay] = await apiSequence([
    { user: E02_T1, propose: FU("play-and-creativity") },
    { user: S2_PAY, propose: FU("play-and-creativity") },
  ]);
  assert.equal(pay.result.conversationAct.state, "COURSE_FOLLOW_UP");
  assert.equal(COURSE_BOT.exec(pay.message)?.[1], "play_and_creativity");
  assertNoTransactionState(pay, "literal pay");

  // The shared validator keeps its literal FOLLOW_UP contract (recovery segments).
  assert.deepEqual(
    validateConversationActDecision(FU("play-and-creativity")(""), [user(E02_T1), assistant(`«${PLAY_TITLE}»`), user(E02_T2)]),
    FU("play-and-creativity")(""),
  );
});

/* =========================================================== Sequence B — S2 */

test("CORR2 B (F-01): the exact S2 sequence gets no Academy price and no payment handoff for the foreign course", async () => {
  const [turn] = await apiSequence([{ user: S2_PAY, propose: FU("maslow") }], {
    prior: [user(S2_REPORT), assistant("Понятно.")],
  });
  assert.equal(turn.status, 200);
  // Identical to frozen HEAD for the same proposal: the controlled uncertainty.
  assert.equal(turn.result.conversationAct.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.equal(turn.message, UNCERTAINTY);
  assert.equal(turn.result.observability?.answerOrigin, "DETERMINISTIC_CONTROL");
  assert.equal(turn.result.completion, "USER_ACTION_REQUIRED");
  assert.doesNotMatch(turn.message, /₽/u);
  assert.doesNotMatch(turn.message, ANY_BOT);
  assert.ok(!turn.message.includes(MASLOW_TITLE));
  assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, null);
  assert.deepEqual(turn.retrieved, []);
  assert.equal(turn.routeCalls, 0);
  assert.equal(turn.selectedAfter, null);
  assertNoTransactionState(turn, "S2");
});

test("CORR2 B (F-01): price, enrollment and same-message variants of the foreign report stay ungrounded", async () => {
  for (const [label, steps, prior] of [
    ["price", [{ user: E02_T2, propose: FU("maslow") }], [user(S2_REPORT), assistant("Понятно.")]],
    ["enroll", [{ user: "Хочу записаться на этот курс.", propose: FU("maslow") }], [user(S2_REPORT), assistant("Понятно.")]],
    ["same message", [{ user: `${S2_REPORT} Хочу его оплатить.`, propose: FU("maslow") }], []],
  ] as const) {
    const [turn] = await apiSequence([...steps], { prior: [...prior] });
    assert.equal(turn.message, UNCERTAINTY, label);
    assert.doesNotMatch(turn.message, /₽/u, label);
    assert.doesNotMatch(turn.message, ANY_BOT, label);
    assert.deepEqual(turn.retrieved, [], label);
  }
});

test("CORR2 B (F-01): A1 content identity, grounded Academy commercial requests and the closed payment grammar are preserved", async () => {
  // Content about the recognised course remains answerable (A1 residual for content only).
  const [content] = await apiSequence([{ user: "А что в нём разбирают?", propose: FU("maslow") }], {
    prior: [user(S2_REPORT), assistant("Понятно.")],
  });
  assert.equal(content.result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(content.retrieved, ["maslow"]);
  assert.doesNotMatch(content.message, /₽/u);
  assert.doesNotMatch(content.message, ANY_BOT);

  // A current-turn commercial request that names the course keeps commercial authority.
  const [price] = await apiSequence([{ user: "Сколько стоит курс Маслоу?", propose: FU("maslow") }]);
  assert.equal(price.result.conversationAct.state, "FACTUAL");
  assert.match(price.message, literal(MASLOW_PRICE_LINE));

  // A grounded user antecedent (a question to the Navigator) keeps commercial authority;
  // the general handoff names no course and no course-specific link is minted.
  const [grounded] = await apiSequence([{ user: S2_PAY, propose: FU("play-and-creativity") }], {
    prior: [user(E02_T1), assistant(LIVE_REFUSAL)],
  });
  assert.equal(grounded.result.conversationAct.state, "FACTUAL");
  assert.ok(grounded.message.includes(PLAY_PRICE_LINE));
  assert.doesNotMatch(grounded.message, COURSE_BOT);

  // Closed grammar: qualified named payment keeps its authorized course link.
  const [qualified] = await apiSequence([{ user: "Хочу оплатить курс Маслоу", propose: NAV }]);
  assert.equal(COURSE_BOT.exec(qualified.message)?.[1], "maslow");
  const [qualifiedFollowUp] = await apiSequence([{ user: "Хочу оплатить курс Маслоу", propose: FU("maslow") }]);
  assert.equal(COURSE_BOT.exec(qualifiedFollowUp.message)?.[1], "maslow");
  assertNoTransactionState(qualifiedFollowUp, "qualified follow-up");
});

/* ============================================== Sequence C — structural ceiling */

test("CORR2 C (F-02): selected Levels → Maslow request → structural evidence guard → price → payment never reuse Levels", async () => {
  const [t1, t2, t3] = await apiSequence(
    [
      { user: COURSERA, propose: FU("maslow"), fault: "STRUCTURAL" },
      { user: "Сколько стоит этот курс?", propose: PRICE_SELECTED },
      { user: S2_PAY, propose: NAV },
    ],
    { initial: wireState("levels-of-consciousness") },
  );

  // T1 — the invalid cross-course evidence is discarded (structural ceiling) AND
  // the stale selection is invalidated on that same return.
  assert.equal(t1.result.conversationAct.state, "COURSE_CONTENT");
  assert.equal(t1.result.conversationAct.state === "COURSE_CONTENT" ? t1.result.conversationAct.courseId : null, "maslow");
  assert.equal(t1.result.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(t1.message, composeCourseFactualCeilingAnswer(MASLOW_TITLE));
  assert.equal(t1.result.observability?.resolvedEvidenceCount, 0);
  assert.deepEqual(t1.result.stateEffects.courseBinding, { kind: "INVALIDATE_SELECTION" });
  assert.equal(t1.selectedBefore, "levels-of-consciousness");
  assert.equal(t1.selectedAfter, null);
  assert.equal(t1.courseMatchAfter, "UNKNOWN");
  assert.ok(!t1.message.includes("CORR2 fixture chunk"));

  // T2 — no stale Levels price.
  assert.equal(t2.message, NAME_THE_COURSE);
  assert.doesNotMatch(t2.message, LEVELS_PRICE);
  assert.equal(t2.selectedAfter, null);

  // T3 — no stale course-specific payment destination.
  assert.equal(COURSE_BOT.exec(t3.message), null);
  assert.ok(!t3.message.includes(LEVELS_TITLE));
  assert.equal(t3.selectedAfter, null);
  assertNoTransactionState(t3, "structural T3");
});

test("CORR2 C (F-02): every content-completion exit applies the same selection effect", async () => {
  for (const fault of ["NONE", "NO_SOURCES", "SELECTOR_DEGRADED", "STRUCTURAL"] as const) {
    const [t1, t2, t3] = await apiSequence(
      [
        { user: COURSERA, propose: FU("maslow"), fault },
        { user: "Сколько стоит этот курс?", propose: PRICE_SELECTED },
        { user: S2_PAY, propose: NAV },
      ],
      { initial: wireState("levels-of-consciousness") },
    );
    assert.equal(t1.result.conversationAct.state, "COURSE_CONTENT", fault);
    assert.ok(t1.message.startsWith(`В доступных мне подтверждённых материалах курса «${MASLOW_TITLE}» нет достаточного основания`), fault);
    assert.deepEqual(t1.result.stateEffects.courseBinding, { kind: "INVALIDATE_SELECTION" }, fault);
    assert.equal(t1.selectedAfter, null, fault);
    assert.equal(t2.message, NAME_THE_COURSE, fault);
    assert.equal(COURSE_BOT.exec(t3.message), null, fault);
  }
  // The degraded exit is the controlled selector degradation, not a technical error.
  const [degraded] = await apiSequence([{ user: COURSERA, propose: FU("maslow"), fault: "SELECTOR_DEGRADED" }], {
    initial: wireState("levels-of-consciousness"),
  });
  assert.equal(degraded.result.observability?.fallback, "EVIDENCE_SELECTION_DEGRADED");
});

test("CORR2 C (F-02): same-course questions keep the selection, a genuine switch invalidates it", async () => {
  const [same, samePay] = await apiSequence(
    [
      { user: "Что изучают на курсе про уровни сознания?", propose: FU("levels-of-consciousness") },
      { user: S2_PAY, propose: NAV },
    ],
    { initial: wireState("levels-of-consciousness") },
  );
  assert.equal(same.result.conversationAct.state, "COURSE_CONTENT");
  assert.equal(same.result.stateEffects.courseBinding, undefined);
  assert.equal(same.selectedAfter, "levels-of-consciousness");
  assert.equal(COURSE_BOT.exec(samePay.message)?.[1], "levels_of_consciousness");

  const [switched] = await apiSequence([{ user: "Что изучают на курсе Маслоу?", propose: CT("maslow") }], {
    initial: wireState("levels-of-consciousness"),
  });
  assert.equal(switched.result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(switched.result.stateEffects.courseBinding, { kind: "INVALIDATE_SELECTION" });
  assert.equal(switched.selectedAfter, null);
});

/* ======================================== Sequence D — conceptual digression */

test("CORR2 D (F-04): a conceptual digression overlapping another course alias keeps the valid selection", async () => {
  const [t1, t2, t3] = await apiSequence(
    [
      { user: NORMATIVE_CONCEPT, propose: CT("normative-situation") },
      { user: "Сколько стоит этот курс?", propose: PRICE_SELECTED },
      { user: S2_PAY, propose: NAV },
    ],
    { initial: wireState("levels-of-consciousness") },
  );
  assert.equal(t1.result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(t1.retrieved, ["normative-situation"]);
  assert.equal(t1.result.stateEffects.courseBinding, undefined);
  assert.equal(t1.selectedBefore, "levels-of-consciousness");
  assert.equal(t1.selectedAfter, "levels-of-consciousness");
  assert.equal(t1.courseMatchAfter, "MATCHED");
  // The retained selection is legitimately priced and paid.
  assert.ok(t2.message.includes(`«${LEVELS_TITLE}»`));
  assert.match(t2.message, LEVELS_PRICE);
  assert.equal(COURSE_BOT.exec(t3.message)?.[1], "levels_of_consciousness");
  assertNoTransactionState(t3, "digression T3");
});

test("CORR2 D (F-04): explicit or conflicting course references and unresolved references still invalidate; assistant text never does", async () => {
  // Explicit course reference to another course in the user's own words.
  const [explicit] = await apiSequence([{ user: "Что разбирают на курсе Маслоу?", propose: FU("maslow") }], {
    initial: wireState("levels-of-consciousness"),
  });
  assert.equal(explicit.result.conversationAct.state, "COURSE_CONTENT");
  assert.equal(explicit.selectedAfter, null);

  // Conflicting identity (course beside an unknown programme) — the unchanged uncertainty.
  const [conflict] = await apiSequence(
    [{ user: "Прохожу курс алхимии и курс Маслоу. Что там разбирается?", propose: FU("maslow") }],
    { initial: wireState("levels-of-consciousness") },
  );
  assert.equal(conflict.result.conversationAct.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.equal(conflict.selectedAfter, null);

  // The unbroken user antecedent establishes the other course: invalidated.
  const [antecedent] = await apiSequence([{ user: "А что в нём изучают?", propose: FU("maslow") }], {
    prior: [user("Прохожу курс Маслоу."), assistant("Понятно.")],
    initial: wireState("levels-of-consciousness"),
  });
  assert.equal(antecedent.result.conversationAct.state, "COURSE_CONTENT");
  assert.deepEqual(antecedent.result.stateEffects.courseBinding, { kind: "INVALIDATE_SELECTION" });

  // Assistant-only wording neither establishes nor invalidates a course.
  const [assistantOnly] = await apiSequence([{ user: "А что в нём разбирают?", propose: CT("maslow") }], {
    prior: [user("Привет"), assistant("Курс Маслоу — это 6 встреч.")],
    initial: wireState("levels-of-consciousness"),
  });
  assert.equal(assistantOnly.result.stateEffects.courseBinding, undefined);
  assert.equal(assistantOnly.selectedAfter, "levels-of-consciousness");
  assert.throws(
    () =>
      validateConversationActDecision(FU("maslow")(""), [
        user("Привет"),
        assistant("Курс Маслоу — это 6 встреч."),
        user("А что в нём разбирают?"),
      ]),
    /absent from the conversation/u,
  );
});

/* ========================================= Sequences E/F — payment boundaries */

test("CORR2 E: a valid Academy course with a qualified payment request keeps the authorized bot route", async () => {
  const [selected] = await apiSequence([{ user: S2_PAY, propose: NAV }], { initial: wireState("maslow") });
  assert.equal(selected.selectedBefore, "maslow");
  assert.equal(selected.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(COURSE_BOT.exec(selected.message)?.[1], "maslow");
  assert.equal(selected.selectedAfter, "maslow");
  assertNoTransactionState(selected, "selected pay");

  const [literal] = await apiSequence([{ user: S2_PAY, propose: FU("maslow") }], {
    prior: [assistant(`Рекомендую «${MASLOW_TITLE}».`)],
  });
  assert.equal(literal.result.conversationAct.state, "COURSE_FOLLOW_UP");
  assert.equal(COURSE_BOT.exec(literal.message)?.[1], "maslow");
  assertNoTransactionState(literal, "literal pay");
});

test("CORR2 F: an explicit unqualified payment request gets the dated price, the honest limitation and the Academy contact, no bot", async () => {
  for (const [label, text, initial] of [
    ["unqualified", "Давай хочу оплатить курс Маслоу", null],
    ["F02 live", F02_LIVE, null],
  ] as const) {
    const [turn] = await apiSequence([{ user: text, propose: NAV }], { initial: initial ?? undefined });
    assert.equal(turn.result.conversationAct.state, "NAVIGATE", label);
    assert.equal(turn.result.observability?.answerOrigin, "PAYMENT_POLICY", label);
    assert.equal(turn.routeCalls, 0, label);
    assert.match(turn.message, /Записать вас на курс или провести оплату сам я не могу/u, label);
    assert.match(turn.message, /никакая запись или оплата сейчас не оформлена/u, label);
    assert.match(turn.message, literal(MASLOW_PRICE_LINE), label);
    assert.match(turn.message, /https:\/\/t\.me\/AST_rulang/u, label);
    assert.doesNotMatch(turn.message, ANY_BOT, label);
    assert.equal(turn.result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION, label);
    assertNoTransactionState(turn, label);
  }
});
