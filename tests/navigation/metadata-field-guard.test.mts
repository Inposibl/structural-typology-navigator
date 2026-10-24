/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1.FIX-4b.IMPLEMENTATION-1
 *
 * Deterministic regression coverage for the metadata field consistency guard
 * (DESIGN-1 + DESIGN-1.CORR1, Owner OD-1..OD-4 = A, ID-1 = A, ID-2, OD-I2 = A):
 *
 * - G1  detector families of the current effective text (quote, negation,
 *       retrospection, attributive and allocation handling);
 * - G2  H1 end-to-end through orchestrateNavigatorResponse with the real act
 *       validator and canned decisions;
 * - G3  route-level turns through handleChatRequest;
 * - G4  ARM-B recovery (H2): dispatch and finalize blocks, the direct-render
 *       bypass, composite evidence spans and same-segment coverage;
 * - G5  preservation (prompt identities, admitted timing fields);
 * - G6  observability record shape and whitelisting;
 * - census of the existing commercial / payment / recovery fixtures.
 *
 * Every provider output is canned. No network access is possible: the file
 * replaces fetch and asserts that it was never called.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  ChatSuccessResponse,
  ConversationMessage,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import { getAcademyCourse } from "../../src/lib/academy/course-catalog.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY_VERSION } from "../../src/lib/academy/commercial-authority.ts";
import { ACADEMY_CONTACT_POLICY } from "../../src/lib/academy/contact-policy.ts";
import { composeCatalogFollowUpAnswer } from "../../src/lib/navigation/follow-up-grounding.ts";
import {
  composeAcademyOverviewAnswer,
  composeCatalogListAnswer,
  composeCourseComparisonAnswer,
  composeFactualAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  routeConversationAct,
  type FactualIntent,
} from "../../src/lib/navigation/conversation-act-router.ts";
import { routeEducationalNavigation } from "../../src/lib/navigation/router.ts";
import {
  finalizeRecoveredPlan,
  orchestrateNavigatorResponse,
  type NavigatorOrchestrationResult,
  type OrchestrationDependencies,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  createNavigatorTurnLog,
  type NavigatorMetadataFieldGuardLog,
  type NavigatorTurnDetails,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  assessMetadataFieldConsistency,
  assessRecoveryMetadataTasks,
  detectRequestedFamilies,
  isMetadataFieldIntervention,
  recoveryMetadataFieldGuardRecord,
  type TimingMetadataField,
} from "../../src/lib/navigation/metadata-field-consistency.ts";
import { undispatchedLineText } from "../../src/lib/navigation/task-plan.ts";
import type { CalendarReadResult } from "../../src/lib/academy/course-calendar.ts";
import { ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION } from "../../src/lib/academy/commercial-policy-addendum.ts";
import {
  composeCommercialConditionsAnswer,
  composeScheduleEnrollmentAnswer,
} from "../../src/lib/navigation/owner-service-lanes.ts";
import { createDefaultConversationProfile } from "../../src/lib/navigation/conversation-profile.ts";
import type { ConversationState } from "../../src/lib/navigation/conversation-state.ts";
import { handleChatRequest } from "../../src/app/api/chat/route.ts";

/* ---------------------------------------------------------------------------
 * Network guard.
 * ------------------------------------------------------------------------ */

let networkAttempts = 0;
globalThis.fetch = (async () => {
  networkAttempts += 1;
  throw new Error("Network access is forbidden in deterministic tests.");
}) as typeof globalThis.fetch;

test.after(() => {
  assert.equal(networkAttempts, 0, "no network attempt");
});

/* ---------------------------------------------------------------------------
 * Fixtures.
 * ------------------------------------------------------------------------ */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const user = (content: string): ConversationMessage => ({ role: "user", content });
const assistant = (content: string): ConversationMessage => ({ role: "assistant", content });

const VY: ConversationProfile = createDefaultConversationProfile();
const TY: ConversationProfile = { ...VY, addressMode: "TY" };

const MASLOW = getAcademyCourse("maslow");
const NORM = getAcademyCourse("normative-situation");
const LEVELS = getAcademyCourse("levels-of-consciousness");
assert.ok(MASLOW && NORM && LEVELS);

/** Navigator S4 answer carrying the exact Maslow title (FIX-4 anaphora frame). */
const S4: ConversationMessage[] = [
  user("Что изучают на курсе Маслоу?"),
  assistant(`Курс «${MASLOW.title}» — это 6 встреч, посвящённых динамической модели потребностей.`),
];

type MetadataField = "PRICE" | "SCHEDULE" | "COHORT" | "ENROLLMENT_WINDOW";
type Scope = "SELECTED" | "REFERENCED" | "ALL";

const md = (
  fields: MetadataField[],
  courseIds: string[] = ["maslow"],
  scope: Scope = "SELECTED",
): FactualIntent => ({ kind: "CURRENT_METADATA", courseIds, fields, scope } as FactualIntent);
const CATALOG_LIST: FactualIntent = { kind: "CATALOG_LIST" };
const OVERVIEW: FactualIntent = { kind: "ACADEMY_OVERVIEW" };
const factual = (...intents: FactualIntent[]) => ({ state: "FACTUAL" as const, intents });

/** Approved closed limitation copy (DESIGN-1 §7.5 VY; ID-2 TY), pinned independently. */
const TELEGRAM = "https://t.me/AST_rulang";
const LIMIT = {
  VY: {
    DURATION: `О продолжительности: в подтверждённых данных Академии продолжительность курсов указана только количеством встреч, а длительность одной встречи, общее количество часов и календарные сроки не указаны. Спросите, пожалуйста, отдельным сообщением, сколько длится нужный курс, назвав его, — я приведу количество встреч по каталогу. Быстро уточнить это можно в Telegram Академии: ${TELEGRAM}.`,
    PRICE: "О стоимости: в этом ответе я её не называю, чтобы не ответить сведениями о другом поле. Спросите, пожалуйста, о цене отдельным сообщением, назвав курс.",
    TIMING: "О сроках курса: в этом ответе я их не называю. Спросите, пожалуйста, о расписании или наборе отдельным сообщением.",
  },
  TY: {
    DURATION: `О продолжительности: в подтверждённых данных Академии продолжительность курсов указана только количеством встреч, а длительность одной встречи, общее количество часов и календарные сроки не указаны. Спроси, пожалуйста, отдельным сообщением, сколько длится нужный курс, назвав его, — я приведу количество встреч по каталогу. Быстро уточнить это можно в Telegram Академии: ${TELEGRAM}.`,
    PRICE: "О стоимости: в этом ответе я её не называю, чтобы не ответить сведениями о другом поле. Спроси, пожалуйста, о цене отдельным сообщением, назвав курс.",
    TIMING: "О сроках курса: в этом ответе я их не называю. Спроси, пожалуйста, о расписании или наборе отдельным сообщением.",
  },
} as const;

/** Any rendered price: the dated price line, a rouble sign, or the Maslow figure. */
const PRICE_TEXT = /последняя подтверждённая цена|подтверждённой цены|₽|60[\s ]000/u;
const SCHEDULE_TEXT = /расписание: авторитетного значения нет/u;
const ALL_TIMING: TimingMetadataField[] = ["SCHEDULE", "COHORT", "ENROLLMENT_WINDOW"];

type Counters = { retrieve: number; route: number; extract: number };

/**
 * OWNER-DEFECT-REMEDIATION-1.CORR1 — deterministic calendar seam. Under OD-5 A
 * a start-date / enrollment question proposed FACTUAL reads the published
 * calendar like one proposed NAVIGATE; the network stays forbidden.
 */
const CALENDAR: CalendarReadResult = {
  status: "AVAILABLE",
  sourceUrl: "https://structural-typology.academy/calendar",
  readDate: "2026-10-24",
  pageLastModified: "2026-10-05",
  sessions: [
    { courseId: "maslow", cohortLabel: null, date: "2026-11-16" },
    { courseId: "maslow", cohortLabel: null, date: "2026-11-26" },
  ],
  ignoredItemCount: 0,
};
const MASLOW_CALENDAR_ANSWER = composeScheduleEnrollmentAnswer(CALENDAR, "maslow").message;

function dependencies(
  act: unknown,
  counters: Counters,
  plan?: unknown,
): OrchestrationDependencies {
  return {
    classifyAct: async (messages) =>
      routeConversationAct(messages, { callJson: async () => structuredClone(act) }),
    retrieve: async () => {
      counters.retrieve += 1;
      return { hasActiveSources: false, bindings: [], matches: [] };
    },
    route: async () => {
      counters.route += 1;
      throw new Error("educational router must not run");
    },
    extractPlan: async () => {
      counters.extract += 1;
      if (plan === undefined) throw new Error("plan extraction must not run");
      return structuredClone(plan);
    },
    readCalendar: async () => CALENDAR,
    now: () => new Date("2026-10-24T17:41:50Z"),
  };
}

async function turn(
  history: readonly ConversationMessage[],
  question: string,
  act: unknown,
  options: { profile?: ConversationProfile; plan?: unknown } = {},
): Promise<{ result: NavigatorOrchestrationResult; counters: Counters }> {
  const counters: Counters = { retrieve: 0, route: 0, extract: 0 };
  const result = await orchestrateNavigatorResponse([...history, user(question)], {
    profile: options.profile ?? VY,
    dependencies: dependencies(act, counters, options.plan),
  });
  return { result, counters };
}

function guardOf(result: NavigatorOrchestrationResult): NavigatorMetadataFieldGuardLog | undefined {
  return result.observability?.metadataFieldGuard;
}

function assertNoSideLanes(counters: Counters, label: string): void {
  assert.deepEqual(counters, { retrieve: 0, route: 0, extract: 0 }, label);
}

type Expectation = {
  message: string;
  origin: NavigatorTurnDetails["answerOrigin"];
  fallback?: NavigatorTurnDetails["fallback"];
  completion: NavigatorOrchestrationResult["completion"];
  transactional: boolean;
  guard: NavigatorMetadataFieldGuardLog | null;
  price: boolean;
};

async function assertH1(
  label: string,
  history: readonly ConversationMessage[],
  question: string,
  act: ReturnType<typeof factual>,
  expected: Expectation,
  profile: ConversationProfile = VY,
): Promise<NavigatorOrchestrationResult> {
  const { result, counters } = await turn(history, question, act, { profile });
  assert.equal(result.message, expected.message, `${label}: message`);
  assert.equal(PRICE_TEXT.test(result.message), expected.price, `${label}: price text`);
  assert.equal(result.observability?.answerOrigin, expected.origin, `${label}: origin`);
  assert.equal(result.observability?.fallback, expected.fallback ?? "NONE", `${label}: fallback`);
  assert.equal(result.completion, expected.completion, `${label}: completion`);
  assert.equal(
    result.stateEffects.transactionalAuthorityVersion,
    expected.transactional ? ACADEMY_COMMERCIAL_AUTHORITY_VERSION : null,
    `${label}: transactional authority`,
  );
  assert.ok(result.stateEffects.catalogAuthorityVersion, `${label}: catalog authority kept`);
  assert.deepEqual(result.conversationAct, act, `${label}: validated act kept for audit`);
  if (expected.guard === null) {
    assert.ok(!("metadataFieldGuard" in (result.observability ?? {})), `${label}: no guard record`);
  } else {
    assert.deepEqual(guardOf(result), expected.guard, `${label}: guard record`);
  }
  assertNoSideLanes(counters, label);
  return result;
}

/**
 * OWNER-DEFECT-REMEDIATION-1.CORR1 (OD-5 A) — a validated FACTUAL proposal of
 * an Owner-confirmed service question takes the service lane. The guard still
 * runs first: its record is kept, PRICE is never added, and only a price the
 * message asks literally leads the service answer.
 */
async function assertServiceLane(
  label: string,
  history: readonly ConversationMessage[],
  question: string,
  act: ReturnType<typeof factual>,
  expected: {
    message: string;
    origin: NavigatorTurnDetails["answerOrigin"];
    lane: "COMMERCIAL_CONDITIONS" | "SCHEDULE_ENROLLMENT";
    transactional: string | null;
    guard: NavigatorMetadataFieldGuardLog | null;
    price: boolean;
  },
): Promise<NavigatorOrchestrationResult> {
  const { result, counters } = await turn(history, question, act);
  assert.equal(result.message, expected.message, `${label}: message`);
  assert.equal(PRICE_TEXT.test(result.message), expected.price, `${label}: price text`);
  assert.equal(result.observability?.answerOrigin, expected.origin, `${label}: origin`);
  assert.deepEqual(
    result.observability?.ownerServiceLane,
    { lane: expected.lane, calendar: expected.lane === "SCHEDULE_ENROLLMENT" ? "AVAILABLE" : "NOT_READ" },
    `${label}: service lane`,
  );
  assert.equal(result.completion, "ANSWERED", `${label}: completion`);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, expected.transactional, `${label}: transactional authority`);
  assert.equal(result.conversationAct.state, "NAVIGATE", `${label}: service act`);
  if (expected.guard === null) {
    assert.ok(!("metadataFieldGuard" in (result.observability ?? {})), `${label}: no guard record`);
  } else {
    assert.deepEqual(guardOf(result), expected.guard, `${label}: guard record`);
  }
  assert.doesNotMatch(result.message, /авторитетного значения нет/u, `${label}: no superseded timing ceiling`);
  assertNoSideLanes(counters, label);
  return result;
}

const record = (
  verdict: "PARTIAL" | "MISMATCH",
  requested: NavigatorMetadataFieldGuardLog["requested"],
  vetoedFields: NavigatorMetadataFieldGuardLog["vetoedFields"],
  dispositions: NavigatorMetadataFieldGuardLog["dispositions"] = [],
  addedFields: NavigatorMetadataFieldGuardLog["addedFields"] = [],
  hook: "TURN" | "RECOVERY" = "TURN",
): NavigatorMetadataFieldGuardLog => ({ verdict, requested, vetoedFields, addedFields, dispositions, hook });

/* ---------------------------------------------------------------------------
 * G1 — detector.
 * ------------------------------------------------------------------------ */

const G1_TABLE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["А сколько длится этот курс?", ["DURATION"]],
  ["Сколько часов длится курс Маслоу?", ["DURATION"]],
  ["Сколько длится одна встреча?", ["DURATION"]],
  ["Сколько стоит этот курс?", ["PRICE"]],
  ["Какая цена курса Маслоу?", ["PRICE"]],
  ["Сколько длится и сколько стоит курс Маслоу?", ["PRICE", "DURATION"]],
  ["Сколько длится курс Маслоу и сколько он стоит?", ["PRICE", "DURATION"]],
  ["Когда начинается курс Маслоу?", ["TIMING"]],
  ["Я раньше спрашивал цену. Теперь сколько длится курс?", ["DURATION"]],
  ["Я не спрашиваю цену, мне нужна продолжительность", ["DURATION"]],
  ["В цитате написано «сколько стоит курс», но мой вопрос — о длительности", ["DURATION"]],
  ["Меня интересует оплата курса", ["PRICE"]],
  ["Какова продолжительность курса?", ["DURATION"]],
  ["Как долго идёт обучение?", ["DURATION"]],
  ["Сколько недель продолжается программа?", ["DURATION"]],
  ["Сколько встреч в этом курсе?", ["DURATION"]],
  ["Сколько времени на курсе уделяется теме мотивации?", ["DURATION"]],
  ["Во сколько обойдётся этот курс?", ["PRICE"]],
  ["Почём курс?", ["PRICE"]],
  ["Есть ли скидки или рассрочка?", ["PRICE"]],
  ["Сколько стоит одна встреча?", ["PRICE"]],
  ["Сколько стоит курс длительностью 6 встреч?", ["PRICE"]],
  ["Не подскажете, сколько стоит курс?", ["PRICE"]],
  ["Не подскажете, сколько стоит курс и сколько он длится?", ["PRICE", "DURATION"]],
  ["Я спрашивал цену, а не сколько длится курс", []],
  ["Цена меня не интересует. Сколько длится курс?", ["DURATION"]],
  ["Когда следующий поток и сколько стоит?", ["PRICE", "TIMING"]],
  ["В каком формате проходит курс?", []],
  ["Расскажите подробнее", []],
  ["Сколько длится стресс?", ["DURATION"]],
  ["Хочу оплатить курс. Сколько он длится?", ["PRICE", "DURATION"]],
  ["Цена курса Маслоу и дата старта?", ["PRICE", "TIMING"]],
  ["Коллега спросил: «сколько стоит курс?» А мне важно, сколько он длится", ["DURATION"]],
  // Declared benign L-2: a cross-clause retrospective marker is not neutralized.
  ["Сколько стоит курс? Сколько длится, я уже знаю", ["PRICE", "DURATION"]],
  ["«сколько стоит курс»", []],
  ["Сколько длится курс? Только не путайте с ценой", ["DURATION"]],
  ["Когда начинается набор на курс Маслоу и какой тариф?", ["PRICE", "TIMING"]],
  ["какой тариф", ["PRICE"]],
  ["и есть ли место", []],
  ["Какая длительность и какая цена?", ["PRICE", "DURATION"]],
  ["Сколько стоят все курсы?", ["PRICE"]],
  ["Во сколько обойдётся курс Маслоу и как долго он идёт?", ["PRICE", "DURATION"]],
  ["когда начинается обучение", ["TIMING"]],
  ["когда будут занятия", []],
  ["Сколько стоит обучение?", ["PRICE"]],
  ["Какие курсы есть в Академии?", []],
  [`Сколько стоит «${MASLOW.title}»?`, ["PRICE"]],
];

test("G1 detector: closed families of the current text, with quote / negation / retrospection / attributive neutralizers", () => {
  for (const [text, families] of G1_TABLE) {
    assert.deepEqual(detectRequestedFamilies(text), families, text);
  }
});

test("G1 detector: prior turns are never scanned (only the given text decides)", () => {
  assert.deepEqual(detectRequestedFamilies("А сколько он длится?"), ["DURATION"]);
  assert.deepEqual(detectRequestedFamilies("А сколько он стоит?"), ["PRICE"]);
  assert.deepEqual(detectRequestedFamilies(""), []);
});

/* ---------------------------------------------------------------------------
 * G2 — H1 end-to-end: the user-mandated matrix.
 * ------------------------------------------------------------------------ */

test("H1 R01 (mandated 1): duration only + PRICE → FIX-1 catalogue duration, no price, no transactional authority", async () => {
  const q = "А сколько длится этот курс?";
  await assertH1("R01", S4, q, factual(md(["PRICE"])), {
    message: composeCatalogFollowUpAnswer(MASLOW, q),
    origin: "CATALOG_AUTHORITY",
    fallback: "CATALOG_FOLLOW_UP",
    completion: "ANSWERED",
    transactional: false,
    guard: record("MISMATCH", ["DURATION"], ["PRICE"], ["CATALOG_DURATION"]),
    price: false,
  });
});

test("H1 CORR1 (mandated 2): duration only + PRICE + CATALOG_LIST → PRICE vetoed, catalogue kept, and no implied single-course answer", async () => {
  const q = "А сколько длится этот курс?";
  const result = await assertH1("dur PRICE+CATALOG_LIST", S4, q, factual(md(["PRICE"]), CATALOG_LIST), {
    message: composeCatalogListAnswer(),
    origin: "CATALOG_AUTHORITY",
    fallback: "NONE",
    completion: "ANSWERED",
    transactional: false,
    guard: record("PARTIAL", ["DURATION"], ["PRICE"]),
    price: false,
  });
  // The catalogue's meeting counts cover DURATION; no FIX-1 supplement and no course binding.
  assert.doesNotMatch(result.message, /В текущем каталоге продолжительность курса/u);
  assert.equal(result.stateEffects.courseBinding, undefined);
});

test("H1 CORR1 (mandated 3): timing only + PRICE + SCHEDULE → PRICE vetoed; the start question takes the calendar lane (ODR-1.CORR1 OD-5 A)", async () => {
  const q = "Когда начинается курс Маслоу?";
  await assertServiceLane("tim PRICE+SCHEDULE", [], q, factual(md(["PRICE", "SCHEDULE"], ["maslow"], "REFERENCED")), {
    message: MASLOW_CALENDAR_ANSWER,
    origin: "CALENDAR_AUTHORITY",
    lane: "SCHEDULE_ENROLLMENT",
    transactional: null,
    guard: record("PARTIAL", ["TIMING"], ["PRICE"]),
    price: false,
  });
});

test("H1 R04 (mandated 4): price only + PRICE → unchanged dated price answer and no guard record", async () => {
  const q = "Сколько стоит этот курс?";
  const result = await assertH1("R04", S4, q, factual(md(["PRICE"])), {
    message: composeFactualAnswer([md(["PRICE"])], null, VY, q),
    origin: "COMMERCIAL_AUTHORITY",
    completion: "ANSWERED",
    transactional: true,
    guard: null,
    price: true,
  });
  assert.match(result.message, /60[\s ]000 ₽/u);
});

test("H1 R06a/R06c (mandated 5): price + duration + PRICE → price kept; duration limited or supplemented, never MISMATCH", async () => {
  const qa = "Сколько длится и сколько стоит курс Маслоу?";
  await assertH1("R06a", [], qa, factual(md(["PRICE"], ["maslow"], "REFERENCED")), {
    message: `${composeFactualAnswer([md(["PRICE"], ["maslow"], "REFERENCED")], null, VY, qa)}\n\n${LIMIT.VY.DURATION}`,
    origin: "COMMERCIAL_AUTHORITY",
    completion: "PARTIAL_WITH_EXPLICIT_LIMITATIONS",
    transactional: true,
    guard: record("PARTIAL", ["PRICE", "DURATION"], [], ["LIMITATION_DURATION"]),
    price: true,
  });
  const qc = "Сколько длится курс Маслоу и сколько он стоит?";
  await assertH1("R06c", [], qc, factual(md(["PRICE"], ["maslow"], "REFERENCED")), {
    message: `${composeFactualAnswer([md(["PRICE"], ["maslow"], "REFERENCED")], null, VY, qc)}\n\n${composeCatalogFollowUpAnswer(MASLOW, qc)}`,
    origin: "COMMERCIAL_AUTHORITY",
    completion: "ANSWERED",
    transactional: true,
    guard: record("PARTIAL", ["PRICE", "DURATION"], [], ["CATALOG_DURATION"]),
    price: true,
  });
});

test("H1 R06b (mandated 6): price + duration + PRICE + CATALOG_LIST → both authorized components unchanged", async () => {
  const q = "Сколько длится и сколько стоит курс Маслоу?";
  const intents = [md(["PRICE"], ["maslow"], "REFERENCED"), CATALOG_LIST];
  await assertH1("R06b", [], q, factual(...intents), {
    message: composeFactualAnswer(intents, null, VY, q),
    origin: "COMMERCIAL_AUTHORITY",
    completion: "ANSWERED",
    transactional: true,
    guard: null,
    price: true,
  });
});

test("H1 CORR1 (mandated 7): duration only + PRICE + SCHEDULE + CATALOG_LIST → PRICE and SCHEDULE removed, catalogue kept", async () => {
  const q = "А сколько длится этот курс?";
  const result = await assertH1("dur PRICE+SCHEDULE+CATALOG_LIST", S4, q, factual(md(["PRICE", "SCHEDULE"]), CATALOG_LIST), {
    message: composeCatalogListAnswer(),
    origin: "CATALOG_AUTHORITY",
    completion: "ANSWERED",
    transactional: false,
    guard: record("PARTIAL", ["DURATION"], ["PRICE", "SCHEDULE"]),
    price: false,
  });
  assert.doesNotMatch(result.message, SCHEDULE_TEXT);
});

test("H1 (mandated 8): timing only + SCHEDULE → no guard intervention; the start question takes the calendar lane (ODR-1.CORR1 OD-5 A)", async () => {
  const q = "Когда начинается курс Маслоу?";
  const intents = [md(["SCHEDULE"], ["maslow"], "REFERENCED")];
  await assertServiceLane("timing SCHEDULE", [], q, factual(...intents), {
    message: MASLOW_CALENDAR_ANSWER,
    origin: "CALENDAR_AUTHORITY",
    lane: "SCHEDULE_ENROLLMENT",
    transactional: null,
    guard: null,
    price: false,
  });
});

test("H1 X51 (mandated 9): duration only + PRICE scope ALL → no per-course price, explicit limitation", async () => {
  const q = "Сколько длится курс Маслоу?";
  await assertH1("X51", [], q, factual(md(["PRICE"], [], "ALL")), {
    message: LIMIT.VY.DURATION,
    origin: "DETERMINISTIC_CONTROL",
    completion: "PARTIAL_WITH_EXPLICIT_LIMITATIONS",
    transactional: false,
    guard: record("MISMATCH", ["DURATION"], ["PRICE"], ["LIMITATION_DURATION"]),
    price: false,
  });
});

test("H1 (mandated 10): duration only + PRICE + COURSE_COMPARISON → valid comparison kept, no price, binding unchanged", async () => {
  const q = "Сколько длится курс Маслоу и курс про нормативную ситуацию?";
  const comparison: FactualIntent = {
    kind: "COURSE_COMPARISON",
    courseIds: ["maslow", "normative-situation"],
    hasUnknownCourse: false,
  } as FactualIntent;
  const result = await assertH1("dur PRICE+COMPARISON", [], q, factual(md(["PRICE"], ["maslow", "normative-situation"], "REFERENCED"), comparison), {
    message: composeCourseComparisonAnswer(comparison as Extract<FactualIntent, { kind: "COURSE_COMPARISON" }>, VY, q),
    origin: "CATALOG_AUTHORITY",
    completion: "ANSWERED",
    transactional: false,
    guard: record("PARTIAL", ["DURATION"], ["PRICE"]),
    price: false,
  });
  const control = await turn([], q, factual(comparison));
  assert.deepEqual(result.stateEffects.courseBinding, control.result.stateEffects.courseBinding);
  assert.match(result.message, /Встреч: 6/u);
});

/* ---------------------------------------------------------------------------
 * G2 — DESIGN-1 / CORR1 rows and required classes.
 * ------------------------------------------------------------------------ */

const limitationOnly = (
  family: "DURATION" | "PRICE",
  vetoed: NavigatorMetadataFieldGuardLog["vetoedFields"],
  profile: "VY" | "TY" = "VY",
): Expectation => ({
  message: LIMIT[profile][family],
  origin: "DETERMINISTIC_CONTROL",
  completion: "PARTIAL_WITH_EXPLICIT_LIMITATIONS",
  transactional: false,
  guard: record("MISMATCH", [family], vetoed, [`LIMITATION_${family}`]),
  price: false,
});

const catalogDuration = (
  question: string,
  vetoed: NavigatorMetadataFieldGuardLog["vetoedFields"] = ["PRICE"],
): Expectation => ({
  message: composeCatalogFollowUpAnswer(MASLOW, question),
  origin: "CATALOG_AUTHORITY",
  fallback: "CATALOG_FOLLOW_UP",
  completion: "ANSWERED",
  transactional: false,
  guard: record("MISMATCH", ["DURATION"], vetoed, ["CATALOG_DURATION"]),
  price: false,
});

const unchangedPrice = (
  intents: FactualIntent[],
  question: string,
): Expectation => ({
  message: composeFactualAnswer(intents, null, VY, question),
  origin: "COMMERCIAL_AUTHORITY",
  completion: "ANSWERED",
  transactional: true,
  guard: null,
  price: true,
});

test("H1 short name and exact title: R02, X01, X02 → catalogue duration for the one identified course", async () => {
  const r02 = "Сколько часов длится курс Маслоу?";
  await assertH1("R02", [], r02, factual(md(["PRICE"], ["maslow"], "REFERENCED")), catalogDuration(r02));
  const x01 = `Сколько длится курс «${MASLOW.title}»?`;
  await assertH1("X01", [user(`Расскажите про «${MASLOW.title}»`), assistant("…")], x01, factual(md(["PRICE"])), catalogDuration(x01));
  const x02 = "Сколько длится курс Маслоу?";
  await assertH1("X02", [], x02, factual(md(["PRICE"], ["maslow"], "REFERENCED")), catalogDuration(x02));
});

test("H1 anaphora and meeting counts: R03, R08, X09 → catalogue answer from the FIX-1 composer", async () => {
  for (const q of ["Сколько длится одна встреча?", "Я раньше спрашивал цену. Теперь сколько длится курс?", "Сколько встреч в этом курсе?"]) {
    await assertH1(q, S4, q, factual(md(["PRICE"])), catalogDuration(q));
  }
});

test("H1 negated, quoted and reported price: R09, R10, X19, X47 → PRICE vetoed, explicit duration limitation, never ANSWERED", async () => {
  for (const q of [
    "Я не спрашиваю цену, мне нужна продолжительность",
    "В цитате написано «сколько стоит курс», но мой вопрос — о длительности",
    "Коллега спросил: «сколько стоит курс?» А мне важно, сколько он длится",
  ]) {
    await assertH1(q, S4, q, factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"]));
  }
  const x19 = "Цена меня не интересует. Сколько длится курс?";
  await assertH1("X19", S4, x19, factual(md(["PRICE"])), catalogDuration(x19));
});

test("H1 negated, quoted and retrospective neutralizers also apply with a sibling catalogue list (CORR1 §4.3)", async () => {
  for (const q of [
    "Я не спрашиваю цену, мне нужна продолжительность",
    "В цитате написано «сколько стоит курс», но мой вопрос — о длительности",
    "Я раньше спрашивал цену. Теперь сколько длится курс?",
  ]) {
    await assertH1(q, S4, q, factual(md(["PRICE"]), CATALOG_LIST), {
      message: composeCatalogListAnswer(),
      origin: "CATALOG_AUTHORITY",
      completion: "ANSWERED",
      transactional: false,
      guard: record("PARTIAL", ["DURATION"], ["PRICE"]),
      price: false,
    });
  }
});

test("H1 two-course ambiguity and unsafe identity: X03, X04, X32, X49, X50 → limitation, no guessed course", async () => {
  const twoTitles = [user(`Сравните «${MASLOW.title}» и «${NORM.title}»`), assistant("…")];
  await assertH1("X03", twoTitles, "А сколько длится этот курс?", factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"]));
  await assertH1("X04", [user("Сколько стоит курс Маслоу?"), assistant("60 000 ₽")], "А сколько он длится?", factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"]));
  await assertH1("X32", [], "Сколько длится курс Маслоу и курс про нормативную ситуацию?", factual(md(["PRICE"], ["maslow", "normative-situation"], "REFERENCED")), limitationOnly("DURATION", ["PRICE"]));
  const listed = [user("Расскажите про курсы"), assistant(`Каталог: «${LEVELS.title}» — 4 встречи; «${MASLOW.title}» — 6 встреч`)];
  await assertH1("X49", listed, "А сколько длится этот курс?", factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"]));
  await assertH1("X50", [], "Сколько длится курс Маслоу?", factual(md(["PRICE"], [], "SELECTED")), limitationOnly("DURATION", ["PRICE"]));
});

test("H1 topic allocation and subject-matter duration: X10, X25 → limitation, never a whole-course answer", async () => {
  await assertH1("X10", S4, "Сколько времени на курсе уделяется теме мотивации?", factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"]));
  await assertH1("X25", S4, "Сколько длится стресс?", factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"]));
});

test("H1 other paraphrases: X06–X08 vetoes PRICE for every duration phrasing", async () => {
  for (const q of ["Какова продолжительность курса?", "Как долго идёт обучение?", "Сколько недель продолжается программа?"]) {
    const { result } = await turn(S4, q, factual(md(["PRICE"])));
    assert.doesNotMatch(result.message, PRICE_TEXT, q);
    assert.equal(guardOf(result)?.verdict, "MISMATCH", q);
    assert.deepEqual(guardOf(result)?.vetoedFields, ["PRICE"], q);
    assert.equal(result.stateEffects.transactionalAuthorityVersion, null, q);
  }
});

test("H1 genuine price questions are never vetoed: R05, R11, X05, X11–X16, X20, X33, X40", async () => {
  const rows: ReadonlyArray<readonly [ConversationMessage[], string, FactualIntent[]]> = [
    [[], "Какая цена курса Маслоу?", [md(["PRICE"], ["maslow"], "REFERENCED")]],
    [S4, "Меня интересует оплата курса", [md(["PRICE"])]],
    [[user("Сколько длится курс Маслоу?"), assistant("6 встреч")], "А сколько он стоит?", [md(["PRICE"])]],
    [S4, "Во сколько обойдётся этот курс?", [md(["PRICE"])]],
    [S4, "Почём курс?", [md(["PRICE"])]],
    [S4, "Сколько стоит одна встреча?", [md(["PRICE"])]],
    [S4, "Сколько стоит курс длительностью 6 встреч?", [md(["PRICE"])]],
    [S4, "Не подскажете, сколько стоит курс?", [md(["PRICE"])]],
    [[], "Сколько стоят все курсы?", [md(["PRICE"], [], "ALL")]],
    [[], "Сколько стоят курсы Маслоу и про нормативную ситуацию?", [md(["PRICE"], ["maslow", "normative-situation"], "REFERENCED")]],
  ];
  for (const [history, q, intents] of rows) {
    await assertH1(q, history, q, factual(...intents), unchangedPrice(intents, q));
  }
  // OWNER-DEFECT-REMEDIATION-1.CORR1 (OD-4/OD-5 A) — two former rows are
  // Owner-confirmed service questions. The guard still never vetoes them (no
  // guard record); the answer now comes from the 2026-10-24 addendum and the
  // published calendar instead of the price snapshot alone.
  const discountRow = "Есть ли скидки или рассрочка?";
  await assertServiceLane(discountRow, S4, discountRow, factual(md(["PRICE"])), {
    message: composeCommercialConditionsAnswer().message,
    origin: "COMMERCIAL_AUTHORITY",
    lane: "COMMERCIAL_CONDITIONS",
    transactional: ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION,
    guard: null,
    price: false,
  });
  const cohortPriceRow = "Когда следующий поток и сколько стоит курс Маслоу?";
  const cohortPriceRowPrice = [md(["PRICE"], ["maslow"], "REFERENCED")];
  await assertServiceLane(cohortPriceRow, [], cohortPriceRow, factual(md(["PRICE", "COHORT"], ["maslow"], "REFERENCED")), {
    message: `${composeFactualAnswer(cohortPriceRowPrice, null, VY, cohortPriceRow)}\n\n${MASLOW_CALENDAR_ANSWER}`,
    origin: "CALENDAR_AUTHORITY",
    lane: "SCHEDULE_ENROLLMENT",
    transactional: ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
    guard: null,
    price: true,
  });
});

test("H1 no recognizable cue: X24 and «Расскажите подробнее» stay UNCORROBORATED (declared L-1/L-3 residual)", async () => {
  for (const q of ["В каком формате проходит курс?", "Расскажите подробнее"]) {
    await assertH1(q, S4, q, factual(md(["PRICE"])), unchangedPrice([md(["PRICE"])], q));
  }
});

test("H1 negation that removes every cue: X18 stays UNCORROBORATED and no family is invented", async () => {
  const q = "Я спрашивал цену, а не сколько длится курс";
  await assertH1("X18", S4, q, factual(md(["PRICE"])), unchangedPrice([md(["PRICE"])], q));
});

test("H1 non-price substitutions: X21 SCHEDULE-for-duration, X48 both wrong → catalogue duration", async () => {
  const q = "Сколько длится этот курс?";
  await assertH1("X21", S4, q, factual(md(["SCHEDULE"])), catalogDuration(q, ["SCHEDULE"]));
  const x48 = "Сколько длится курс Маслоу?";
  await assertH1("X48", [], x48, factual(md(["SCHEDULE", "PRICE"], ["maslow"], "REFERENCED")), catalogDuration(x48, ["SCHEDULE", "PRICE"]));
});

test("H1 X22: the guard never creates PRICE — a price question with a SCHEDULE proposal gets the price limitation", async () => {
  const result = await assertH1("X22", S4, "Сколько стоит этот курс?", factual(md(["SCHEDULE"])), limitationOnly("PRICE", ["SCHEDULE"]));
  assert.doesNotMatch(result.message, SCHEDULE_TEXT);
});

test("H1 R07/X39: the guard's TIMING record is kept; the start question takes the calendar lane and price is kept only when asked (ODR-1.CORR1 OD-5 A)", async () => {
  const r07 = "Когда начинается курс Маслоу?";
  await assertServiceLane("R07", [], r07, factual(md(["PRICE"], ["maslow"], "REFERENCED")), {
    message: MASLOW_CALENDAR_ANSWER,
    origin: "CALENDAR_AUTHORITY",
    lane: "SCHEDULE_ENROLLMENT",
    transactional: null,
    guard: record("MISMATCH", ["TIMING"], ["PRICE"], ["TIMING_NO_AUTHORITY"], ALL_TIMING),
    price: false,
  });
  const x39 = "Цена курса Маслоу и дата старта?";
  await assertServiceLane("X39", [], x39, factual(md(["PRICE"], ["maslow"], "REFERENCED")), {
    message: `${composeFactualAnswer([md(["PRICE"], ["maslow"], "REFERENCED")], null, VY, x39)}\n\n${MASLOW_CALENDAR_ANSWER}`,
    origin: "CALENDAR_AUTHORITY",
    lane: "SCHEDULE_ENROLLMENT",
    transactional: ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
    guard: record("PARTIAL", ["PRICE", "TIMING"], [], ["TIMING_NO_AUTHORITY"], ALL_TIMING),
    price: true,
  });
});

test("H1 multiple factual intents: X52 overview + catalogue duration; X17/X31/X36/X37 mixed are never MISMATCH", async () => {
  const x52 = "Расскажите об Академии и сколько длится этот курс?";
  await assertH1("X52", S4, x52, factual(OVERVIEW, md(["PRICE"])), {
    message: `${composeAcademyOverviewAnswer()}\n\n${composeCatalogFollowUpAnswer(MASLOW, x52)}`,
    origin: "CATALOG_AUTHORITY",
    completion: "ANSWERED",
    transactional: false,
    guard: record("MISMATCH", ["DURATION"], ["PRICE"], ["CATALOG_DURATION"]),
    price: false,
  });
  for (const q of [
    "Не подскажете, сколько стоит курс и сколько он длится?",
    "Какая длительность и какая цена?",
    "Сколько стоит курс и как долго он длится?",
    "Какая продолжительность и стоимость курса?",
  ]) {
    const { result } = await turn(S4, q, factual(md(["PRICE"])));
    assert.equal(guardOf(result)?.verdict, "PARTIAL", q);
    assert.deepEqual(guardOf(result)?.vetoedFields, [], q);
    assert.match(result.message, PRICE_TEXT, q);
    assert.equal(result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY", q);
  }
});

test("H1 CORR1 §4.3: price + duration with an extra SCHEDULE → SCHEDULE removed, price and duration coverage kept", async () => {
  const q = "Сколько длится курс Маслоу и сколько он стоит?";
  await assertH1("price+duration+SCHEDULE", [], q, factual(md(["PRICE", "SCHEDULE"], ["maslow"], "REFERENCED")), {
    message: `${composeFactualAnswer([md(["PRICE"], ["maslow"], "REFERENCED")], null, VY, q)}\n\n${composeCatalogFollowUpAnswer(MASLOW, q)}`,
    origin: "COMMERCIAL_AUTHORITY",
    completion: "ANSWERED",
    transactional: true,
    guard: record("PARTIAL", ["PRICE", "DURATION"], ["SCHEDULE"], ["CATALOG_DURATION"]),
    price: true,
  });
});

test("H1 payment + duration (X26): the payment lane keeps precedence, prepends the guarded text and is not a clean answer", async () => {
  const q = "Хочу оплатить курс. Сколько он длится?";
  const { result, counters } = await turn(S4, q, factual(md(["PRICE"])));
  const control = await turn(S4, q, { state: "NAVIGATE" });
  assert.equal(control.result.observability?.answerOrigin, "PAYMENT_POLICY");
  assert.equal(result.observability?.answerOrigin, "PAYMENT_POLICY");
  const guarded = `${composeFactualAnswer([md(["PRICE"])], null, VY, q)}\n\n${LIMIT.VY.DURATION}`;
  assert.equal(result.message, `${guarded}\n\n${control.result.message}`);
  assert.equal(result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
  assert.notEqual(control.result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
  assert.deepEqual(guardOf(result), record("PARTIAL", ["PRICE", "DURATION"], [], ["LIMITATION_DURATION"]));
  assert.equal(result.stateEffects.transactionalAuthorityVersion, control.result.stateEffects.transactionalAuthorityVersion);
  assert.deepEqual(result.stateEffects.courseBinding, control.result.stateEffects.courseBinding);
  assertNoSideLanes(counters, "X26");
});

test("H1 genuine payment + price question: no intervention, byte-identical lane output", async () => {
  const q = "Хочу оплатить курс Маслоу. Сколько он стоит?";
  const { result } = await turn([], q, factual(md(["PRICE"], ["maslow"], "REFERENCED")));
  assert.ok(!("metadataFieldGuard" in (result.observability ?? {})));
  assert.match(result.message, PRICE_TEXT);
  assert.equal(result.completion, "ANSWERED");
});

test("H1 TY address mode: the approved TY limitation copy (ID-2)", async () => {
  await assertH1("TY R09", S4, "Я не спрашиваю цену, мне нужна продолжительность", factual(md(["PRICE"])), limitationOnly("DURATION", ["PRICE"], "TY"), TY);
  await assertH1("TY X22", S4, "Сколько стоит этот курс?", factual(md(["SCHEDULE"])), limitationOnly("PRICE", ["SCHEDULE"], "TY"), TY);
});

test("H1 non-FACTUAL acts are never touched (NOT_APPLICABLE)", async () => {
  const assessment = assessMetadataFieldConsistency({
    intents: [CATALOG_LIST],
    text: "А сколько длится этот курс?",
    messages: [...S4, user("А сколько длится этот курс?")],
    selectedCourseId: null,
    admittedTimingFields: ALL_TIMING,
  });
  assert.equal(assessment.verdict, "NOT_APPLICABLE");
  assert.deepEqual(assessment.sanitizedIntents, [CATALOG_LIST]);
});

/* ---------------------------------------------------------------------------
 * Pure-assessment edges (paths that live decisions cannot reach).
 * ------------------------------------------------------------------------ */

function assess(text: string, intents: FactualIntent[], admittedTimingFields: TimingMetadataField[] = ALL_TIMING) {
  return assessMetadataFieldConsistency({
    intents,
    text,
    messages: [...S4, user(text)],
    selectedCourseId: null,
    profile: VY,
    admittedTimingFields,
  });
}

test("pure: a comparison without meeting counts does not cover DURATION (CORR1 §2.2 op. 4)", () => {
  const withUnknown = assess("А сколько длится этот курс?", [
    md(["PRICE"]),
    { kind: "COURSE_COMPARISON", courseIds: ["maslow"], hasUnknownCourse: true } as FactualIntent,
  ]);
  assert.equal(withUnknown.verdict, "MISMATCH");
  assert.deepEqual(withUnknown.vetoedFields, ["PRICE"]);
  assert.deepEqual(withUnknown.dispositions, ["CATALOG_DURATION"]);
  const counted = assess("А сколько длится этот курс?", [
    md(["PRICE"]),
    { kind: "COURSE_COMPARISON", courseIds: ["maslow", "normative-situation"], hasUnknownCourse: false } as FactualIntent,
  ]);
  assert.equal(counted.verdict, "PARTIAL");
  assert.deepEqual(counted.dispositions, []);
});

test("pure: no admitted timing field → LIMITATION_TIMING, and PRICE is still never added", () => {
  const assessment = assess("Когда начинается курс Маслоу?", [md(["PRICE"])], []);
  assert.equal(assessment.verdict, "MISMATCH");
  assert.deepEqual(assessment.addedFields, []);
  assert.deepEqual(assessment.dispositions, ["LIMITATION_TIMING"]);
  assert.deepEqual(assessment.limitations, [LIMIT.VY.TIMING]);
  assert.deepEqual(assessment.sanitizedIntents, []);
});

test("pure: PRICE never appears in sanitized fields unless it was proposed and requested", () => {
  for (const [text] of G1_TABLE) {
    for (const fields of [["SCHEDULE"], ["COHORT"], ["ENROLLMENT_WINDOW"], ["SCHEDULE", "COHORT"]] as MetadataField[][]) {
      const assessment = assess(text, [md(fields)]);
      const metadata = assessment.sanitizedIntents.find((intent) => intent.kind === "CURRENT_METADATA");
      assert.ok(!(metadata?.kind === "CURRENT_METADATA" && metadata.fields.includes("PRICE")), text);
    }
    const withPrice = assess(text, [md(["PRICE"])]);
    const kept = withPrice.sanitizedIntents.find((intent) => intent.kind === "CURRENT_METADATA");
    if (kept?.kind === "CURRENT_METADATA" && kept.fields.includes("PRICE") && isMetadataFieldIntervention(withPrice)) {
      assert.ok(withPrice.requested.includes("PRICE"), text);
    }
  }
});

test("pure: limitation copy states no figures (INV-6)", () => {
  for (const profile of ["VY", "TY"] as const) {
    for (const text of Object.values(LIMIT[profile])) {
      assert.match(text.replace(TELEGRAM, ""), /^[^\d]*$/u, text);
    }
  }
  assert.equal(ACADEMY_CONTACT_POLICY.fastTelegramUrl, TELEGRAM);
});

/* ---------------------------------------------------------------------------
 * G3 — route level.
 * ------------------------------------------------------------------------ */

async function routeTurn(
  history: readonly ConversationMessage[],
  act: unknown,
): Promise<{ message: string; state: ConversationState }> {
  const orchestrate: typeof orchestrateNavigatorResponse = (messages, options) =>
    orchestrateNavigatorResponse(messages, {
      ...options,
      dependencies: dependencies(act, { retrieve: 0, route: 0, extract: 0 }),
    });
  const info = console.info;
  console.info = () => undefined;
  try {
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, profile: VY, requestId: `fix4b-${history.length}` }),
      }),
      { orchestrate },
    );
    assert.equal(response.status, 200);
    const json = (await response.json()) as ChatSuccessResponse;
    return { message: json.message, state: json.conversationState as ConversationState };
  } finally {
    console.info = info;
  }
}

test("G3 route: R01 and R09 are HTTP 200 FACTUAL turns with no transactional authority; R04 keeps it", async () => {
  const r01 = await routeTurn([...S4, user("А сколько длится этот курс?")], factual(md(["PRICE"])));
  assert.equal(r01.message, composeCatalogFollowUpAnswer(MASLOW, "А сколько длится этот курс?"));
  assert.equal(r01.state.lastAssistant?.act, "FACTUAL");
  assert.ok(!r01.state.transactionalAuthorityVersion);

  const r09 = await routeTurn([...S4, user("Я не спрашиваю цену, мне нужна продолжительность")], factual(md(["PRICE"])));
  assert.equal(r09.message, LIMIT.VY.DURATION);
  assert.equal(r09.state.lastAssistant?.act, "FACTUAL");
  assert.ok(!r09.state.transactionalAuthorityVersion);

  const r04 = await routeTurn([...S4, user("Сколько стоит этот курс?")], factual(md(["PRICE"])));
  assert.equal(r04.message, composeFactualAnswer([md(["PRICE"])], null, VY, "Сколько стоит этот курс?"));
  assert.equal(r04.state.lastAssistant?.act, "FACTUAL");
  assert.equal(r04.state.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
});

/* ---------------------------------------------------------------------------
 * G4 — recovery (H2).
 * ------------------------------------------------------------------------ */

const F1_CONTENT = (question: string) => ({
  state: "COURSE_CONTENT",
  courseId: "maslow",
  evidenceRequested: false,
  contentIntentEvidence: question,
});
const INVENTED_DURATION = {
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["DURATION"], scope: "REFERENCED" }],
};
const task = (type: string, evidence: string, courseIds: string[] = ["maslow"]) => ({
  type,
  courseIds,
  role: "ACTIVE",
  evidence,
});
const MASLOW_MENTION = { courseId: "maslow", surface: "Маслоу", role: "ACTIVE" };

async function recovered(
  history: readonly ConversationMessage[],
  question: string,
  act: unknown,
  plan: unknown,
) {
  const { result, counters } = await turn(history, question, act, { plan });
  assert.equal(counters.extract, 1, `${question}: one plan extraction`);
  assert.equal(counters.retrieve, 0, `${question}: no retrieval`);
  assert.equal(counters.route, 0, `${question}: no educational routing`);
  return result;
}

function outcomes(result: NavigatorOrchestrationResult) {
  return (result.taskCoverage?.outcomes ?? []).map((outcome) => [outcome.taskType, outcome.outcome, outcome.reasonCode]);
}

test("G4-1: the frozen S5 ARM-B path still ends in the frozen UNDISPATCHED line", async () => {
  const q = "А сколько длится этот курс";
  const result = await recovered(S4, q, INVENTED_DURATION, {
    tasks: [task("SCHEDULE", q)],
    mentions: [{ courseId: "maslow", surface: "этот курс", role: "ACTIVE" }],
  });
  assert.equal(result.message, undispatchedLineText(q));
  assert.doesNotMatch(result.message, PRICE_TEXT);
});

test("G4-2 (ID-1 = A): a single recovered PRICE task for a duration question is blocked; coverage stays truthful", async () => {
  const q = "Сколько часов длится курс Маслоу?";
  const evidence = "Сколько часов длится курс Маслоу";
  const result = await recovered([], q, INVENTED_DURATION, {
    tasks: [task("PRICE", evidence)],
    mentions: [{ courseId: "maslow", surface: "курс Маслоу", role: "ACTIVE" }],
  });
  assert.equal(result.message, undispatchedLineText(evidence));
  assert.equal(result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
  assert.equal(result.stateEffects.transactionalAuthorityVersion, null);
  assert.deepEqual(outcomes(result), [["PRICE", "NOT_SAFELY_EXECUTABLE", "SEGMENT_DISPATCH_FAILED"]]);
  assert.deepEqual(guardOf(result), record("MISMATCH", ["DURATION"], ["PRICE"], [], [], "RECOVERY"));
});

test("G4-3 H2-a: a manipulated span on the F-1 path falls back to the whole turn and blocks before dispatch", async () => {
  const q = "Сколько часов длится этот курс?";
  const result = await recovered(S4, q, F1_CONTENT(q), { tasks: [task("PRICE", "этот курс")], mentions: [] });
  assert.equal(result.message, undispatchedLineText("этот курс"));
  assert.doesNotMatch(result.message, PRICE_TEXT);
  assert.equal(result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS");
  // H2-a: the blocked primary never commits its transactional authority.
  assert.equal(result.stateEffects.transactionalAuthorityVersion, null);
  assert.deepEqual(outcomes(result), [["PRICE", "NOT_SAFELY_EXECUTABLE", "SEGMENT_DISPATCH_FAILED"]]);
  assert.ok(!(result.taskCoverage?.outcomes ?? []).some((outcome) => outcome.outcome === "ANSWERED_FROM_AUTHORITY"));
  assert.deepEqual(guardOf(result), record("MISMATCH", ["DURATION"], ["PRICE"], [], [], "RECOVERY"));
});

test("G4-3 control: the same manipulated span for a real price question is CONSISTENT and renders the price", async () => {
  const q = "Сколько стоит этот курс?";
  const result = await recovered(S4, q, F1_CONTENT(q), { tasks: [task("PRICE", "этот курс")], mentions: [] });
  assert.match(result.message, PRICE_TEXT);
  assert.equal(guardOf(result), undefined);
});

test("G4-4 H2-b: a merged F-1 segment with a misleading PRICE task never reaches the per-task re-render", async () => {
  const q = "Когда старт курса и сколько длится?";
  const result = await recovered(S4, q, F1_CONTENT(q), {
    tasks: [task("SCHEDULE", "Когда старт курса"), task("PRICE", "сколько длится")],
    mentions: [],
  });
  assert.equal(result.message, undispatchedLineText("Когда старт курса"));
  assert.doesNotMatch(result.message, PRICE_TEXT);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, null);
  assert.deepEqual(outcomes(result), [
    ["SCHEDULE", "NOT_SAFELY_EXECUTABLE", "SEGMENT_DISPATCH_FAILED"],
    ["PRICE", "NOT_SAFELY_EXECUTABLE", "SEGMENT_DISPATCH_FAILED"],
  ]);
});

test("G4-5: split spans EW + «какой тариф» stay CONSISTENT; the inherited TURN record of the first span is dropped", async () => {
  const q = "Когда начинается набор на курс Маслоу и какой тариф?";
  const result = await recovered(S4, q, F1_CONTENT(q), {
    tasks: [task("ENROLLMENT_WINDOW", "Когда начинается набор на курс Маслоу"), task("PRICE", "какой тариф")],
    mentions: [MASLOW_MENTION],
  });
  assert.match(result.message, /окно набора: авторитетного значения нет/u);
  assert.match(result.message, PRICE_TEXT);
  assert.ok(!("metadataFieldGuard" in (result.observability ?? {})));
});

test("OD-I2-A composite span (M02-4 shape): both merged tasks carry the whole turn; same-segment fields cover it", async () => {
  for (const q of [
    "Когда начинается набор на курс Маслоу и какова плата за обучение?",
    "Когда начинается набор на курс Маслоу и какой тариф?",
  ]) {
    const whole = q.slice(0, -1);
    const result = await recovered(S4, q, F1_CONTENT(q), {
      tasks: [task("ENROLLMENT_WINDOW", whole), task("PRICE", whole)],
      mentions: [MASLOW_MENTION],
    });
    assert.match(result.message, /окно набора: авторитетного значения нет/u, q);
    assert.match(result.message, /60[\s ]000/u, q);
    assert.ok(!("metadataFieldGuard" in (result.observability ?? {})), q);
    assert.deepEqual(
      outcomes(result).map(([type, outcome]) => [type, outcome]),
      [["ENROLLMENT_WINDOW", "LIMITED_BY_FACTUAL_CEILING"], ["PRICE", "ANSWERED_FROM_AUTHORITY"]],
      q,
    );
  }
});

test("OD-I2-A uncovered DURATION: a composite span that also asks duration blocks the whole merged segment", async () => {
  const q = "Когда начинается набор на курс Маслоу, сколько стоит и сколько длится обучение?";
  const whole = q.slice(0, -1);
  const result = await recovered(S4, q, F1_CONTENT(q), {
    tasks: [task("ENROLLMENT_WINDOW", whole), task("PRICE", whole)],
    mentions: [MASLOW_MENTION],
  });
  assert.equal(result.message, undispatchedLineText(whole));
  assert.doesNotMatch(result.message, PRICE_TEXT);
  assert.deepEqual(guardOf(result), record("PARTIAL", ["PRICE", "DURATION", "TIMING"], [], [], [], "RECOVERY"));
  assert.ok(!(result.taskCoverage?.outcomes ?? []).some((outcome) => outcome.outcome === "ANSWERED_FROM_AUTHORITY"));
});

test("OD-I2-A misleading PRICE: an uncorroborated task field blocks even though the segment covers the requested family", async () => {
  const q = "Когда начинается набор на курс Маслоу и когда начинается обучение?";
  const result = await recovered(S4, q, F1_CONTENT(q), {
    tasks: [task("ENROLLMENT_WINDOW", "Когда начинается набор на курс Маслоу"), task("PRICE", "когда начинается обучение")],
    mentions: [MASLOW_MENTION],
  });
  assert.doesNotMatch(result.message, PRICE_TEXT);
  assert.deepEqual(guardOf(result), record("MISMATCH", ["TIMING"], ["PRICE"], [], [], "RECOVERY"));
  assert.equal(result.stateEffects.transactionalAuthorityVersion, null);
});

test("OD-I2-A declared residual (ID-3): a multi-task PRICE span with no cue is UNCORROBORATED and not vetoed", async () => {
  const q = "Когда начинается набор на курс Маслоу и когда будут занятия?";
  const result = await recovered(S4, q, F1_CONTENT(q), {
    tasks: [task("ENROLLMENT_WINDOW", "Когда начинается набор на курс Маслоу"), task("PRICE", "когда будут занятия")],
    mentions: [MASLOW_MENTION],
  });
  assert.match(result.message, PRICE_TEXT);
  assert.ok(!("metadataFieldGuard" in (result.observability ?? {})));
});

test("OD-I2-A never borrows another segment's fields: TIMING requested beside a price is not covered by another course's SCHEDULE", async () => {
  const q = "Когда стартует курс Маслоу и сколько он стоит, и какое расписание у курса про нормативную ситуацию?";
  const result = await recovered(S4, q, F1_CONTENT(q), {
    tasks: [
      task("PRICE", "Когда стартует курс Маслоу и сколько он стоит"),
      task("SCHEDULE", "какое расписание у курса про нормативную ситуацию", ["normative-situation"]),
    ],
    mentions: [
      { courseId: "maslow", surface: "курс Маслоу", role: "ACTIVE" },
      { courseId: "normative-situation", surface: "курса про нормативную ситуацию", role: "ACTIVE" },
    ],
  });
  assert.doesNotMatch(result.message, PRICE_TEXT);
  assert.match(result.message, SCHEDULE_TEXT);
  assert.match(result.message, new RegExp(undispatchedLineText("Когда стартует курс Маслоу и сколько он стоит").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.deepEqual(
    outcomes(result).map(([type, , reason]) => [type, reason]),
    [["PRICE", "SEGMENT_DISPATCH_FAILED"], ["SCHEDULE", "MISSING_AUTHORITATIVE_FIELD"]],
  );
  assert.deepEqual(guardOf(result), record("PARTIAL", ["PRICE", "TIMING"], [], [], [], "RECOVERY"));
});

test("H2 unit: the task-level rule (DESIGN-1 H2-1..H2-4, OD-I2-A same-segment coverage)", () => {
  const rule = (tasks: { type: string; evidence: string }[], latestText: string, activeTaskCount: number) =>
    assessRecoveryMetadataTasks({ tasks, latestText, activeTaskCount });
  // H2-1: single-task fallback to the whole turn.
  assert.equal(rule([{ type: "PRICE", evidence: "курс Маслоу" }], "Сколько часов длится курс Маслоу?", 1).blocked, true);
  // H2-2 / H2-3: multi-task plans never fall back.
  assert.equal(rule([{ type: "PRICE", evidence: "какой тариф" }], "Когда начинается набор на курс Маслоу и какой тариф?", 2).blocked, false);
  assert.equal(rule([{ type: "PRICE", evidence: "и есть ли место" }], "Когда начинается набор на курс Маслоу и есть ли место?", 2).blocked, false);
  // H2-4: a duration span typed as SCHEDULE.
  assert.deepEqual(rule([{ type: "SCHEDULE", evidence: "А сколько длится этот курс" }], "А сколько длится этот курс", 1), {
    blocked: true, verdict: "MISMATCH", requested: ["DURATION"], vetoedFields: ["SCHEDULE"],
  });
  // Same-segment coverage: the union of the segment's own fields.
  const whole = "Когда начинается набор на курс Маслоу и какова плата за обучение";
  assert.equal(rule([{ type: "ENROLLMENT_WINDOW", evidence: whole }, { type: "PRICE", evidence: whole }], whole, 2).blocked, false);
  assert.deepEqual(rule([{ type: "PRICE", evidence: whole }], whole, 2), {
    blocked: true, verdict: "PARTIAL", requested: ["PRICE", "TIMING"], vetoedFields: [],
  });
  assert.equal(recoveryMetadataFieldGuardRecord([]), null);
});

test("H1/H2 consistency: on a segment whose tasks share one evidence span, H2 blocks exactly when H1 would intervene", () => {
  const fieldSets: MetadataField[][] = [["PRICE"], ["SCHEDULE"], ["COHORT"], ["ENROLLMENT_WINDOW"], ["ENROLLMENT_WINDOW", "PRICE"], ["SCHEDULE", "PRICE"]];
  for (const [text] of G1_TABLE) {
    for (const fields of fieldSets) {
      const h1 = assess(text, [md(fields)]);
      const h2 = assessRecoveryMetadataTasks({
        tasks: fields.map((type) => ({ type, evidence: text })),
        latestText: text,
        activeTaskCount: fields.length,
      });
      assert.equal(h2.blocked, isMetadataFieldIntervention(h1), `${fields.join("+")} | ${text}`);
      if (h2.blocked) assert.deepEqual([...h2.vetoedFields].sort(), [...h1.vetoedFields].sort(), `${fields.join("+")} | ${text}`);
    }
  }
});

/* ---------------------------------------------------------------------------
 * G5 — preservation.
 * ------------------------------------------------------------------------ */

test("G5 prompt identities are byte-unchanged: act router, educational router VY and TY", async () => {
  let act = "";
  await routeConversationAct([user("Что такое архетип Тени?")], {
    callJson: async (requestMessages) => {
      act = requestMessages[0]?.content ?? "";
      return { state: "META" };
    },
  });
  assert.equal(sha256(act), "a5368d8d6a77603ea8a6f284a77fa1c5929c2a1a210fde609247b946b775897d");
  const askMore = {
    state: "ASK_MORE",
    candidateCourseIds: [],
    questions: ["Что вы хотите понять, решить или изменить с помощью обучения?"],
    rationale: "Учебная задача ещё не описана.",
  };
  const routerPrompt = async (profile: ConversationProfile) => {
    let captured = "";
    await routeEducationalNavigation([user("Мы новички. Какие курсы подходят")], {
      profile,
      callJson: async (requestMessages) => {
        captured = requestMessages[0]?.content ?? "";
        return askMore;
      },
    });
    return captured;
  };
  assert.equal(sha256(await routerPrompt(VY)), "9ee3eacd691e59a72dd26879018d1c6110c9bf439fbdc04dec3da3e0f72f742c");
  assert.equal(sha256(await routerPrompt(TY)), "aca7f5a9a78105a9311362a3cac1319fce9b1ef0d6bc433cce6e2d11c7be2096");
});

/* ---------------------------------------------------------------------------
 * G6 — observability.
 * ------------------------------------------------------------------------ */

const TURN_LOG_KEYS = [
  "activeBindingCount", "answerOrigin", "authorityResolved", "bindingSourceSlugs", "conversationAct",
  "courseId", "crossCourseLeakageDetected", "decision", "event", "evidenceSelectionStatus", "fallback",
  "lane", "ragInvoked", "requestId", "resolvedEvidenceCount", "retrievedMatchCount", "selectedEvidence",
];

test("G6 turn log: no guard key on an ordinary FACTUAL turn; closed record on an intervened turn, without user text", async () => {
  const plain = await turn(S4, "Сколько стоит этот курс?", factual(md(["PRICE"])));
  const plainLog = createNavigatorTurnLog("fix4b-plain", plain.result.observability as NavigatorTurnDetails);
  assert.deepEqual(Object.keys(plainLog).sort(), TURN_LOG_KEYS);

  const q = "Я не спрашиваю цену, мне нужна продолжительность";
  const guarded = await turn(S4, q, factual(md(["PRICE"])));
  const log = createNavigatorTurnLog("fix4b-guarded", guarded.result.observability as NavigatorTurnDetails);
  assert.deepEqual(Object.keys(log).sort(), [...TURN_LOG_KEYS, "metadataFieldGuard"].sort());
  assert.deepEqual(log.metadataFieldGuard, record("MISMATCH", ["DURATION"], ["PRICE"], ["LIMITATION_DURATION"]));
  const serialized = JSON.stringify(log);
  assert.ok(!serialized.includes(q));
  assert.ok(!serialized.includes("продолжительн"));
  assert.ok(!serialized.includes(MASLOW.title));
});

test("G6 turn log: out-of-enum values are dropped and non-intervention verdicts are not logged", () => {
  const base = createNavigatorTurnLog("x", {
    lane: "ORCHESTRATION", conversationAct: "FACTUAL", decision: null, courseId: null, ragInvoked: false,
    authorityResolved: false, activeBindingCount: 0, bindingSourceSlugs: [], retrievedMatchCount: 0,
    resolvedEvidenceCount: 0, selectedEvidence: [], evidenceSelectionStatus: "NOT_RUN",
    answerOrigin: "DETERMINISTIC_CONTROL", fallback: "NONE", crossCourseLeakageDetected: false,
    metadataFieldGuard: {
      verdict: "MISMATCH",
      requested: ["DURATION", "сколько стоит"],
      vetoedFields: ["PRICE", "DURATION"],
      addedFields: ["SCHEDULE", "PRICE"],
      dispositions: ["CATALOG_DURATION", "free text"],
      hook: "elsewhere",
    } as unknown as NavigatorMetadataFieldGuardLog,
  });
  assert.deepEqual(base.metadataFieldGuard, record("MISMATCH", ["DURATION"], ["PRICE"], ["CATALOG_DURATION"], ["SCHEDULE"], "TURN"));
  const consistent = createNavigatorTurnLog("y", {
    ...(base as unknown as NavigatorTurnDetails),
    metadataFieldGuard: { ...record("PARTIAL", [], []), verdict: "CONSISTENT" } as unknown as NavigatorMetadataFieldGuardLog,
  });
  assert.ok(!("metadataFieldGuard" in consistent));
});

/* ---------------------------------------------------------------------------
 * Census of existing fixtures (CORR1 §5.9 predicate).
 * ------------------------------------------------------------------------ */

const CENSUS_SUITES = [
  "smoke2-targeted-remediation", "intent-plan-integration", "intent-plan-recovery", "payment-orchestration",
  "payment-policy", "academy-payment-framing-extension", "commercial-authority", "chat-api-state",
  "conversation-entry-simplification", "package-c-regression", "package-d-regression",
  "block-a-product-repair", "response-coverage",
];

test("census (a): no user text in the commercial / payment / recovery suites carries a DURATION cue", () => {
  const seen = new Set<string>();
  for (const suite of CENSUS_SUITES) {
    const source = readFileSync(new URL(`./${suite}.test.mts`, import.meta.url), "utf8");
    for (const match of source.matchAll(/(?:content|user|query|text|q):\s*"([^"\n]*[А-Яа-яЁё][^"\n]*)"/gu)) {
      seen.add(match[1]);
    }
  }
  assert.ok(seen.size >= 150, `scanned ${seen.size} texts`);
  for (const text of seen) {
    assert.ok(!detectRequestedFamilies(text).includes("DURATION"), text);
  }
});

test("census (b): every orchestrator-level CURRENT_METADATA fixture pair stays non-intervening", () => {
  const pairs: ReadonlyArray<readonly [string, FactualIntent[]]> = [
    ["Сколько стоит этот курс?", [md(["PRICE"], [], "SELECTED")]],
    ["Какие курсы есть в Академии?", [md(["PRICE"], [], "SELECTED")]],
    ["Сколько стоит курс?", [md(["PRICE"], [], "SELECTED")]],
    ["Сколько стоит индивидуальное VIP-наставничество по типологии?", [md(["PRICE"], [], "SELECTED")]],
    ["Сколько стоит курс Маслоу?", [md(["PRICE"], ["maslow"], "REFERENCED")]],
    ["Сколько стоит оплата?", [md(["PRICE"], [], "SELECTED")]],
    ["Сколько стоит обучение?", [md(["PRICE"], [], "SELECTED")]],
    ["Здравствуйте! Сколько стоит курс Маслоу?", [md(["PRICE"], [], "SELECTED")]],
    ["Зовите меня Олег. Сколько стоит обучение?", [md(["PRICE"], [], "SELECTED")]],
    ["Давайте на ты.", [md(["PRICE"], [], "SELECTED")]],
    [`Сколько стоит «${MASLOW.title}»?`, [md(["PRICE"], ["maslow"], "REFERENCED")]],
    ["Расскажите об Академии и сколько стоит курс Маслоу?", [OVERVIEW, md(["PRICE"], ["maslow"], "REFERENCED")]],
    ["А сколько стоит этот курс", [md(["PRICE"], ["maslow"], "SELECTED")]],
  ];
  for (const [text, intents] of pairs) {
    const assessment = assess(text, intents);
    assert.ok(["NOT_APPLICABLE", "UNCORROBORATED", "CONSISTENT"].includes(assessment.verdict), `${text}: ${assessment.verdict}`);
  }
});

/* ---------------------------------------------------------------------------
 * F02-CORR1 — an H2-b rejection revokes every state-bearing effect of the
 * rejected primary (Codex IV1 F02). The extraction dependency retains its
 * returned task; a caller signal whose `aborted` flag is read once before
 * dispatch and once at the frozen commitPrimary read
 * (intent-plan-recovery.ts:224) rewrites that retained evidence between H2-a
 * (dispatch) and H2-b (finalization). No microtask timing is involved.
 * ------------------------------------------------------------------------ */

const F02_QUESTION = "Какова цена программы Маслоу? Сколько часов длится программа Маслоу?";
const F02_PRICE_SPAN = "Какова цена программы Маслоу";
const F02_DURATION_SPAN = "Сколько часов длится программа Маслоу";
const F02_HISTORY: ConversationMessage[] = [assistant(`Курс «${MASLOW.title}».`)];

async function f02RetainedEvidence(fromEvidence: string, toEvidence: string) {
  const retainedTask = { type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: fromEvidence };
  let armed = false;
  let reads = 0;
  let rewrittenAtRead = 0;
  const signal = {
    get aborted() {
      if (armed) {
        reads += 1;
        if (reads === 2) {
          retainedTask.evidence = toEvidence;
          rewrittenAtRead = reads;
        }
      }
      return false;
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as AbortSignal;
  const counters: Counters = { retrieve: 0, route: 0, extract: 0 };
  const result = await orchestrateNavigatorResponse([...F02_HISTORY, user(F02_QUESTION)], {
    profile: VY,
    signal,
    dependencies: {
      ...dependencies(F1_CONTENT(F02_QUESTION), counters),
      extractPlan: async () => {
        counters.extract += 1;
        armed = true;
        return { tasks: [retainedTask], mentions: [MASLOW_MENTION] };
      },
    },
  });
  assert.equal(rewrittenAtRead, 2, "evidence rewritten exactly between dispatch and finalization");
  assert.equal(counters.extract, 1);
  assert.equal(counters.retrieve + counters.route, 0);
  return result;
}

/** Text, authority origin, binding, completion and coverage tell one story. */
function assertRejectedPrimaryOwnsNothing(result: NavigatorOrchestrationResult, evidence: string, label: string): void {
  assert.equal(result.message, undispatchedLineText(evidence), `${label}: limitation text`);
  assert.doesNotMatch(result.message, PRICE_TEXT, `${label}: no price`);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, null, `${label}: no transactional authority`);
  assert.equal(result.stateEffects.courseBinding, undefined, `${label}: no course binding`);
  assert.equal(result.stateEffects.pendingConfirmation, null, `${label}: no confirmation`);
  assert.equal(result.observability?.answerOrigin, "DETERMINISTIC_CONTROL", `${label}: no commercial origin`);
  assert.equal(result.conversationAct.state, "ROUTER_DEGRADED", `${label}: neutral failed-primary base`);
  assert.equal(result.decision, null, `${label}: no decision`);
  assert.equal(result.completion, "PARTIAL_WITH_EXPLICIT_LIMITATIONS", `${label}: never a clean answer`);
  assert.deepEqual(outcomes(result), [["PRICE", "NOT_SAFELY_EXECUTABLE", "SEGMENT_DISPATCH_FAILED"]], `${label}: coverage`);
  assert.ok(
    !(result.taskCoverage?.outcomes ?? []).some((outcome) => outcome.outcome === "ANSWERED_FROM_AUTHORITY"),
    `${label}: no ANSWERED_FROM_AUTHORITY`,
  );
}

test("F02 H2-a rejects a mismatched task before dispatch (independent of H2-b, which sees price evidence)", async () => {
  const result = await f02RetainedEvidence(F02_DURATION_SPAN, F02_PRICE_SPAN);
  assertRejectedPrimaryOwnsNothing(result, F02_DURATION_SPAN, "H2-a");
  assert.equal(guardOf(result), undefined, "H2-b saw corroborated price evidence and recorded no block");
});

test("F02 H2-b independently rejects a dispatched commercial primary and revokes its authority, origin and act", async () => {
  const result = await f02RetainedEvidence(F02_PRICE_SPAN, F02_DURATION_SPAN);
  assertRejectedPrimaryOwnsNothing(result, F02_PRICE_SPAN, "H2-b");
  assert.deepEqual(guardOf(result), record("MISMATCH", ["DURATION"], ["PRICE"], [], [], "RECOVERY"));
});

test("F02 control: a stable, corroborated price task keeps its owner, authority and clean completion", async () => {
  const result = await f02RetainedEvidence(F02_PRICE_SPAN, F02_PRICE_SPAN);
  assert.match(result.message, /60[\s ]000 ₽/u);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
  assert.equal(result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
  assert.equal(result.conversationAct.state, "FACTUAL");
  assert.equal(result.completion, "ANSWERED");
  assert.deepEqual(outcomes(result), [["PRICE", "ANSWERED_FROM_AUTHORITY", "CATALOG_OR_COMMERCIAL_AUTHORITY"]]);
  assert.equal(guardOf(result), undefined);
});

/* Finalization boundary (Codex finalization-probe shape): a previously
 * completed commercial result, optionally carrying a MATCHED binding, is
 * supplied for a single PRICE task. */

async function f02Execution(taskEvidence: string, binding?: { kind: "MATCHED"; courseId: string }) {
  const metadata = { kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "REFERENCED" };
  const priced = await orchestrateNavigatorResponse([user("Какова цена программы Маслоу?")], {
    profile: VY,
    dependencies: { classifyAct: async () => ({ state: "FACTUAL", intents: [metadata] }) as never },
  });
  assert.equal(priced.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
  const value: NavigatorOrchestrationResult = binding === undefined
    ? priced
    : { ...priced, stateEffects: { ...priced.stateEffects, courseBinding: binding } };
  const act = { state: "FACTUAL", intents: [metadata] };
  const task = { type: "PRICE", courseIds: ["maslow"], role: "ACTIVE", evidence: taskEvidence };
  return {
    execution: {
      disposition: "RECOVERED_SINGLE_ACT",
      segments: [{ kind: "ACT", taskIndices: [0], taskTypes: ["PRICE"], evidenceSpan: taskEvidence, act }],
      activeTasks: [task],
      activeTaskTypes: ["PRICE"],
      act,
      primaryAct: act,
      primarySegmentIndex: 0,
      commitPrimary: true,
      dispatchResults: [{
        bindingKind: binding === undefined ? "NONE" : "MATCHED",
        pendingConfirmation: false,
        answerOrigin: "COMMERCIAL_AUTHORITY",
        message: priced.message,
        value,
      }],
    } as unknown as Parameters<typeof finalizeRecoveredPlan>[0],
    plan: { tasks: [task], mentions: [] },
  };
}

test("F02 finalization boundary: a rejected primary carrying a commercial version and a MATCHED binding owns no state", async () => {
  const duration = "Сколько часов длится программа Маслоу?";
  const { execution, plan } = await f02Execution(duration, { kind: "MATCHED", courseId: "maslow" });
  const result = finalizeRecoveredPlan(execution, { profile: VY }, "F1", duration, plan);
  assertRejectedPrimaryOwnsNothing(result, duration, "finalize MATCHED");
  assert.deepEqual(guardOf(result), record("MISMATCH", ["DURATION"], ["PRICE"], [], [], "RECOVERY"));
});

test("F02 finalization boundary: an authorized primary keeps its commercial version and MATCHED binding (no over-revocation)", async () => {
  const price = "Какова цена программы Маслоу?";
  const { execution, plan } = await f02Execution(price, { kind: "MATCHED", courseId: "maslow" });
  const result = finalizeRecoveredPlan(execution, { profile: VY }, "F1", price, plan);
  assert.match(result.message, /60[\s ]000 ₽/u);
  assert.equal(result.stateEffects.transactionalAuthorityVersion, ACADEMY_COMMERCIAL_AUTHORITY_VERSION);
  assert.deepEqual(result.stateEffects.courseBinding, { kind: "MATCHED", courseId: "maslow" });
  assert.equal(result.observability?.answerOrigin, "COMMERCIAL_AUTHORITY");
  assert.equal(result.completion, "ANSWERED");
  assert.deepEqual(outcomes(result), [["PRICE", "ANSWERED_FROM_AUTHORITY", "CATALOG_OR_COMMERCIAL_AUTHORITY"]]);
  assert.equal(guardOf(result), undefined);
});
