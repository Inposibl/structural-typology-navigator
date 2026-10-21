/**
 * NAVIGATOR-CONVERSATION-ENTRY-SIMPLIFICATION-1.CORR1.ROUTER-FAILURE-CORRECTION-1
 *
 * Deterministic regression coverage for FIX-1 (duration questions and catalogue
 * authority), FIX-3 (educational-router instructions), FIX-4 (act-router
 * instructions) and FIX-5 (Russian meeting-count agreement).
 *
 * Every provider output below is a canned fixture. The S2/S5 payloads are the
 * raw DeepSeek outputs captured by ROUTER-OUTPUT-OBSERVATION-1 (report sha256
 * 664016773b454cf7f6b1c66ab6f06447aae9a905983345a18251dc68bdb69925); they are
 * replayed through the unchanged validators. A passing test here proves the
 * deterministic contracts and the prompt text only — it is not evidence that
 * DeepSeek now follows the corrected prompts.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  ChatSuccessResponse,
  ConversationMessage,
  ConversationProfile,
} from "../../src/lib/chat-contract.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import {
  ACADEMY_COURSES,
  ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE,
  getAcademyCourse,
} from "../../src/lib/academy/course-catalog.ts";
import { getPublicCourseOutcomes } from "../../src/lib/academy/public-course-outcomes.ts";
import {
  ACADEMY_CONTACT_POLICY,
  composeCourseFactualCeilingAnswer,
} from "../../src/lib/academy/contact-policy.ts";
import {
  composeCatalogFollowUpAnswer,
  formatMeetingCount,
  isCatalogAnswerableFollowUp,
  isCourseDurationQuestion,
} from "../../src/lib/navigation/follow-up-grounding.ts";
import {
  composeCatalogListAnswer,
  composeCourseFollowUpAnswer,
  composeFollowUpReferenceClarification,
  composeHandoffOfferedAnswer,
  composeStableNoMatchAnswer,
  type CourseFollowUpOutcome,
} from "../../src/lib/navigation/conversation-response.ts";
import {
  routeConversationAct,
  validateConversationActDecision,
} from "../../src/lib/navigation/conversation-act-router.ts";
import { routeEducationalNavigation } from "../../src/lib/navigation/router.ts";
import {
  orchestrateNavigatorResponse,
  type OrchestrationDependencies,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import {
  CLARIFICATION_BUDGET,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";
import { createDefaultConversationProfile } from "../../src/lib/navigation/conversation-profile.ts";
import { undispatchedLineText } from "../../src/lib/navigation/task-plan.ts";
import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import { resolveCourseReferences } from "../../src/lib/academy/course-reference.ts";

/* ---------------------------------------------------------------------------
 * Network guard: every provider is stubbed; any network attempt fails the file.
 * ------------------------------------------------------------------------ */

let networkAttempts = 0;
globalThis.fetch = (async () => {
  networkAttempts += 1;
  throw new Error("Network access is forbidden in deterministic tests.");
}) as typeof globalThis.fetch;

test.after(() => {
  assert.equal(networkAttempts, 0, "no network attempt");
});

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const user = (content: string): ConversationMessage => ({ role: "user", content });
const assistant = (content: string): ConversationMessage => ({ role: "assistant", content });

const VY: ConversationProfile = createDefaultConversationProfile();
const MASLOW = getAcademyCourse("maslow");
assert.ok(MASLOW);
const MASLOW_TITLE = MASLOW.title;
const ROUTABLE = ACADEMY_COURSES.filter((course) => course.status === "ROUTABLE");

const noProvider = {
  callText: async (): Promise<string> => {
    throw new Error("composer must not be called");
  },
  callJson: async (): Promise<unknown> => {
    throw new Error("auditor must not be called");
  },
};

/* ---------------------------------------------------------------------------
 * Live fixtures (ROUTER-OUTPUT-OBSERVATION-1).
 * ------------------------------------------------------------------------ */

// S4 → S5 conversation as replayed by the observation (S4 answer Owner-supplied).
const S4_QUESTION = "Что изучают на курсе Маслоу?";
const S4_ANSWER = "Курс «Иерархия потребностей А. Маслоу: новая парадигма» — это 6 встреч, посвящённых динамической модели потребностей вместо статичной пирамиды.\n\nЧто изучается:\n\n- Как меняются мотивация и приоритеты под влиянием контекста.\n- Какие потребности фактически определяют поведение здесь и сейчас.\n- Различение режимов взаимодействия и роли ресурсов.\n- Понимание повторяющихся мотивационных и коммуникационных тупиков.\n- Как точнее работать с мотивацией человека или команды.\n\nЗаявленные результаты: освоить динамическую модель потребностей вместо статичной пирамиды, освоить позицию рефлексивного наблюдателя, понимать разнонаправленные переходы мотивации под давлением контекста.\n\nОтдельно в материалах курса обозначено, что в нём объясняется поведение и мотивацию людей в норме.";
const S5_ROUTED = "А сколько длится этот курс";
const S5_MESSAGES: ConversationMessage[] = [user(S4_QUESTION), assistant(S4_ANSWER), user(S5_ROUTED)];

// S5-s01/s05/s06: invented field (rejected, non-F-1).
const S5_DURATION_DECISION = {
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["DURATION"], scope: "SELECTED" }],
};
// S5-s02: semantic PRICE substitution (validator-valid).
const S5_PRICE_DECISION = {
  state: "FACTUAL",
  intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: ["PRICE"], scope: "SELECTED" }],
};
// S5-s04: the destination FIX-4 instructs.
const S5_FOLLOW_UP_DECISION = { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false };
// S5-s01 ARM-B plan (frozen extractor output).
const S5_ARM_B_PLAN = {
  tasks: [{ type: "SCHEDULE", courseIds: ["maslow"], role: "ACTIVE", evidence: "А сколько длится этот курс" }],
  mentions: [{ courseId: "maslow", surface: "этот курс", role: "ACTIVE" }],
};

const S2_ROUTED = "Мы новички. Какие курсы подходят";
// S2-s02: the rejected four-candidate ASK_MORE.
const S2_FOUR_CANDIDATES = {
  state: "ASK_MORE",
  candidateCourseIds: ["levels-of-consciousness", "maslow", "play-and-creativity", "normative-situation"],
  questions: ["Что вы хотите понять или решить в первую очередь: почему люди по-разному ведут себя в напряжённых ситуациях, почему у команды «не работает» мотивация, почему изменения и развитие застревают, или почему правила есть, но не соблюдаются?"],
  rationale: "Пользователь — новичок и не указал образовательную задачу; несколько курсов каталога сопоставимо правдоподобны, и ответ о конкретной задаче изменит выбор primaryCourseId. Уточняющий вопрос сформулирован через реальные задачи пользователя, без внутренней терминологии.",
};
const S3_ROUTED = "Меня зовут Анна, курсы онлайн";

const BEGINNER_ASK_MORE = {
  state: "ASK_MORE",
  candidateCourseIds: [],
  questions: ["Что вы хотите понять, решить или изменить с помощью обучения?"],
  rationale: "Учебная задача ещё не описана.",
};

/* ---------------------------------------------------------------------------
 * T1 — FIX-1: duration language and catalogue authority.
 * ------------------------------------------------------------------------ */

const DURATION_PHRASINGS = [
  "Сколько длится этот курс?",
  "А сколько длится этот курс",
  "Какая продолжительность курса?",
  "Сколько по времени идёт курс?",
  "Сколько часов длится курс?",
  "Какая длительность курса?",
  "Как долго идёт обучение?",
  "Сколько недель длится программа?",
  "Сколько времени занимает курс?",
  "Сколько длится одна встреча?",
  "Какая длительность одной встречи?",
] as const;

// Facts the catalogue does not authorize (D-1 not granted).
const UNAUTHORIZED_FACTS = [
  /\d+\s*(?:час|ч\.|минут)/iu,
  /\d+\s*(?:недел|месяц|дн)/iu,
  /онлайн|online|zoom|зум/iu,
  /раз[а]?\s+в\s+неделю/iu,
  /по\s+\d/iu,
] as const;

test("T1 FIX-1: duration phrasings reach the catalogue answer with the authorized meeting count for every routable course", () => {
  for (const course of ROUTABLE) {
    for (const question of DURATION_PHRASINGS) {
      assert.equal(isCourseDurationQuestion(question), true, question);
      assert.equal(isCatalogAnswerableFollowUp(question), true, question);
      const answer = composeCatalogFollowUpAnswer(course, question);
      assert.ok(
        answer.includes(
          `В текущем каталоге продолжительность курса «${course.title}» указана только количеством встреч: ${formatMeetingCount(course.meetings)}.`,
        ),
        `${course.id} / ${question}`,
      );
      assert.match(answer, /не указан/u, `${course.id} / ${question}`);
      for (const pattern of UNAUTHORIZED_FACTS) {
        assert.doesNotMatch(answer, pattern, `${course.id} / ${question}`);
      }
    }
  }
  const maslowAnswer = composeCatalogFollowUpAnswer(MASLOW, "Сколько длится этот курс?");
  assert.match(maslowAnswer, /6 встреч\./u);
  assert.doesNotMatch(maslowAnswer, /6 час/u);
});

test("T1 FIX-1: the Maslow duration answer is pinned byte-for-byte", () => {
  const outcomes = getPublicCourseOutcomes(MASLOW);
  assert.equal(
    composeCatalogFollowUpAnswer(MASLOW, S5_ROUTED),
    [
      `В текущем каталоге продолжительность курса «${MASLOW_TITLE}» указана только количеством встреч: 6 встреч. Длительность одной встречи, общее количество часов, частота встреч и календарные сроки курса в доступных мне подтверждённых данных не указаны. Быстро уточнить это можно в Telegram Академии: ${ACADEMY_CONTACT_POLICY.fastTelegramUrl}.`,
      `Подтверждённые публичные учебные результаты курса: ${outcomes.join("; ")}.`,
    ].join("\n\n"),
  );
});

test("T1 FIX-1: a requested unavailable unit is named and kept distinct from the meeting count", () => {
  const rows = [
    ["Сколько часов длится курс?", "Общее количество часов в доступных мне подтверждённых данных не указано: длительность одной встречи там не указана, поэтому 6 встреч нельзя пересчитать в часы."],
    ["Сколько длится курс в часах?", "Общее количество часов в доступных мне подтверждённых данных не указано: длительность одной встречи там не указана, поэтому 6 встреч нельзя пересчитать в часы."],
    ["Сколько длится одна встреча?", "Длительность одной встречи в доступных мне подтверждённых данных не указана, поэтому 6 встреч нельзя пересчитать в часы."],
    ["Какая длительность одной встречи?", "Длительность одной встречи в доступных мне подтверждённых данных не указана, поэтому 6 встреч нельзя пересчитать в часы."],
    ["Сколько часов длится одна встреча?", "Длительность одной встречи в доступных мне подтверждённых данных не указана, поэтому 6 встреч нельзя пересчитать в часы."],
    ["Сколько недель длится программа?", "Продолжительность курса в часах, неделях или месяцах в доступных мне подтверждённых данных не указана: длительность одной встречи, частота и даты встреч там не указаны, поэтому 6 встреч нельзя пересчитать в часы или календарный срок."],
    ["Сколько по времени идёт курс?", "Продолжительность курса в часах, неделях или месяцах в доступных мне подтверждённых данных не указана: длительность одной встречи, частота и даты встреч там не указаны, поэтому 6 встреч нельзя пересчитать в часы или календарный срок."],
    ["Сколько длится этот курс?", "Длительность одной встречи, общее количество часов, частота встреч и календарные сроки курса в доступных мне подтверждённых данных не указаны."],
  ] as const;
  for (const [question, limitation] of rows) {
    const answer = composeCatalogFollowUpAnswer(MASLOW, question);
    assert.ok(answer.includes(limitation), question);
    // Never presented as hours: the count is always "встреч", never "часов".
    assert.doesNotMatch(answer, /6\s*час/u, question);
  }
});

test("T1 FIX-1: existing «сколько встреч / занятий» answers are byte-unchanged", () => {
  for (const course of ROUTABLE) {
    const outcomes = getPublicCourseOutcomes(course);
    for (const question of ["Сколько встреч в курсе?", "Сколько занятий?", "А сколько встреч в этом курсе"]) {
      assert.equal(isCatalogAnswerableFollowUp(question), true, question);
      assert.equal(isCourseDurationQuestion(question), false, question);
      assert.equal(
        composeCatalogFollowUpAnswer(course, question),
        [
          `В текущем каталоге для курса «${course.title}» указано количество встреч: ${course.meetings}.`,
          ...(outcomes.length > 0
            ? [`Подтверждённые публичные учебные результаты курса: ${outcomes.join("; ")}.`]
            : []),
        ].join("\n\n"),
        `${course.id} / ${question}`,
      );
    }
  }
  // Literal pre-change bytes for Maslow.
  assert.equal(
    composeCatalogFollowUpAnswer(MASLOW, "Сколько встреч в курсе?"),
    "В текущем каталоге для курса «Иерархия потребностей А. Маслоу: новая парадигма» указано количество встреч: 6.\n\nПодтверждённые публичные учебные результаты курса: освоить динамическую модель потребностей вместо статичной пирамиды; освоить позицию рефлексивного наблюдателя; понимать разнонаправленные переходы мотивации под давлением контекста.",
  );
});

test("T1 FIX-1: unrelated, subject-matter and format questions are not duration requests and keep the factual ceiling", async () => {
  for (const question of [
    "Сколько длится стресс?",
    "Как долго длится кризис мотивации по Маслоу?",
    "Какова продолжительность жизни по Маслоу?",
    "Длительность стресса разбирают на курсе?",
    "Сколько длится эффект от обучения?",
    "На курсе говорят, сколько длится кризис?",
    "Сколько часов в сутках нужно спать?",
    "Сколько людей в группе курса?",
    "Сколько стоит курс?",
    "Когда начинается курс?",
    "Какое расписание курса?",
    "Курсы онлайн?",
    "Какой формат курса?",
    "Пирамида Маслоу научно доказана?",
  ]) {
    assert.equal(isCourseDurationQuestion(question), false, question);
    assert.equal(isCatalogAnswerableFollowUp(question), false, question);
    const outcomes: CourseFollowUpOutcome[] = [];
    const answer = await composeCourseFollowUpAnswer(
      [user(`Расскажите про курс «${MASLOW_TITLE}».`), assistant("Хорошо."), user(question)],
      { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
      { ...noProvider, evidenceSelection: { status: "INSUFFICIENT", evidence: [] }, onOutcome: (outcome) => outcomes.push(outcome) },
    );
    assert.equal(answer, composeCourseFactualCeilingAnswer(MASLOW_TITLE), question);
    assert.deepEqual(outcomes, [{ answerOrigin: "FACTUAL_CEILING", fallback: "FACTUAL_CEILING" }], question);
  }
});

test("T1 FIX-1: an INSUFFICIENT duration follow-up uses catalogue authority without any provider call", async () => {
  const outcomes: CourseFollowUpOutcome[] = [];
  const answer = await composeCourseFollowUpAnswer(
    S5_MESSAGES,
    { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
    { ...noProvider, evidenceSelection: { status: "INSUFFICIENT", evidence: [] }, onOutcome: (outcome) => outcomes.push(outcome) },
  );
  assert.equal(answer, composeCatalogFollowUpAnswer(MASLOW, S5_ROUTED));
  assert.deepEqual(outcomes, [{ answerOrigin: "CATALOG_AUTHORITY", fallback: "CATALOG_FOLLOW_UP" }]);
});

test("T1 FIX-1: SUPPORTED RAG composition, audit and single repair are unchanged for a duration question", async () => {
  const evidenceItem: ResolvedCourseEvidence = {
    chunkId: 7,
    documentId: "document-1",
    sourceId: "source-1",
    courseId: "maslow",
    sourceSlug: "maslow-foundational",
    sourceTitle: "Synthetic source",
    sourceKind: "manuscript",
    authorityRelation: "FOUNDATIONAL",
    courseSourceMetadata: {},
    sourceMetadata: {},
    documentMetadata: {},
    content: "synthetic",
    contentSha256: "a".repeat(64),
    headingPath: [],
    locator: {},
    chunkMetadata: {},
    similarity: 0.9,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  };
  const supported = {
    courseEvidence: [evidenceItem],
    evidenceSelection: { status: "SUPPORTED" as const, evidence: [{ chunkId: 7, quote: "synthetic quote" }] },
  };
  const act = { state: "COURSE_FOLLOW_UP" as const, courseId: "maslow", evidenceRequested: false };

  // PASS: the RAG answer is delivered; the catalogue fallback is not used.
  let composerCalls = 0;
  let auditCalls = 0;
  const outcomes: CourseFollowUpOutcome[] = [];
  const passed = await composeCourseFollowUpAnswer(S5_MESSAGES, act, {
    ...supported,
    callText: async () => {
      composerCalls += 1;
      return "RAG ANSWER";
    },
    callJson: async () => {
      auditCalls += 1;
      return { status: "PASS" };
    },
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  assert.equal(passed, "RAG ANSWER");
  assert.equal(composerCalls, 1);
  assert.equal(auditCalls, 1);
  assert.deepEqual(outcomes.at(-1), { answerOrigin: "RAG_EVIDENCE", fallback: "NONE" });

  // FAIL → one repair → PASS.
  const audits = [{ status: "FAIL", reasonCode: "UNSUPPORTED_CLAIM" }, { status: "PASS" }];
  const repaired = await composeCourseFollowUpAnswer(S5_MESSAGES, act, {
    ...supported,
    callText: (() => {
      const texts = ["FIRST", "REPAIRED"];
      return async () => texts.shift() ?? "UNEXPECTED";
    })(),
    callJson: async () => audits.shift(),
  });
  assert.equal(repaired, "REPAIRED");

  // FAIL → repair → FAIL: the factual ceiling, never the catalogue fallback.
  const ceiling = await composeCourseFollowUpAnswer(S5_MESSAGES, act, {
    ...supported,
    callText: async () => "UNSUPPORTED",
    callJson: async () => ({ status: "FAIL", reasonCode: "UNSUPPORTED_CLAIM" }),
  });
  assert.equal(ceiling, composeCourseFactualCeilingAnswer(MASLOW_TITLE));
});

/* ---------------------------------------------------------------------------
 * T2 — FIX-3: educational router.
 * ------------------------------------------------------------------------ */

async function capturedRouterPrompt(profile?: ConversationProfile): Promise<string> {
  let captured = "";
  await routeEducationalNavigation([user(S2_ROUTED)], {
    profile,
    callJson: async (requestMessages) => {
      captured = requestMessages[0]?.content ?? "";
      return BEGINNER_ASK_MORE;
    },
  });
  return captured;
}

const FIX3_LINES = [
  "- УЧЕБНАЯ ЗАДАЧА ЕЩЁ НЕ ОПИСАНА: если пользователь пока не сказал, что хочет понять, решить или изменить с помощью обучения, и сам не назвал ни одного курса каталога, который хочет пройти или рассматривает как вариант (например, только сообщил, что он новичок, представился, поздоровался, спросил «какие курсы подходят?» или спросил об условиях или формате обучения), это случай (b), а не NO_CURRENT_COURSE_MATCH: верни ASK_MORE с candidateCourseIds: [] и одним вопросом о его учебной задаче. То, что курс нельзя выбрать до описания задачи, — не основание для NO_CURRENT_COURSE_MATCH;",
  "- ПРИОРИТЕТ ЯВНОГО ВЫБОРА КУРСА: правило «ДВА КУРСА КАК ТЕКУЩИЕ АЛЬТЕРНАТИВЫ» (с его исключениями) имеет приоритет над правилом «УЧЕБНАЯ ЗАДАЧА ЕЩЁ НЕ ОПИСАНА» и над правилом о candidateCourseIds: [] в ASK_MORE и применяется, даже если учебная задача ещё не описана: если пользователь сам назвал два ROUTABLE курса, которые сейчас рассматривает как варианты (например, «Хочу пройти курс Маслоу. А ещё рассматриваю курс „Нормативная ситуация“.»), верни ASK_MORE с candidateCourseIds — ровно этими двумя курсами и одним вопросом о его учебной задаче. Курс, который пользователь сам назвал как желаемый или рассматриваемый, имеет прямую поддержку из его сигналов. candidateCourseIds: [] возвращай, только когда пользователь не назвал ни одного курса каталога как желаемый или рассматриваемый;",
  "- статус новичка («мы новички», «я начинающий», «без опыта») сам по себе не указывает ни на какой курс: не выводи из него ни соответствие курсу, ни отсутствие соответствия;",
  "- NO_CURRENT_COURSE_MATCH возвращай, когда пользователь описал учебную задачу или потребность, а ни один курс текущего каталога ей честно не соответствует;",
  "- candidateCourseIds НИКОГДА не содержит больше двух id. Если сопоставимо правдоподобны больше двух курсов или прямой поддержки из пользовательских сигналов нет ни у одного курса, верни candidateCourseIds: [] (пустой список), а не перечень курсов; не составляй список кандидатов, не подкреплённый прямыми сигналами пользователя;",
] as const;

test("T2 FIX-3 + CORR1 prompt: the five inserted rules are present once and the change is insert-only against f5aa968", async () => {
  const prompt = await capturedRouterPrompt();
  // CORR1 (IV1-02 precedence) re-baseline, recomputed from the captured bytes
  // (default «вы» profile). IV1-audited FIX-3 digest:
  // 740ceedca6fc6990bf88442c61d13680b6e75fbad080da8f41e807a4c663fd9d.
  assert.equal(sha256(prompt), "9ee3eacd691e59a72dd26879018d1c6110c9bf439fbdc04dec3da3e0f72f742c");
  const lines = prompt.split("\n");
  for (const line of FIX3_LINES) {
    assert.equal(lines.filter((candidate) => candidate === line).length, 1, line);
  }
  // Removing exactly the inserted lines restores the f5aa968 system prompt
  // (default «вы» profile) byte-for-byte.
  const reduced = lines.filter((line) => !(FIX3_LINES as readonly string[]).includes(line)).join("\n");
  assert.equal(sha256(reduced), "4730d6853e43990b553f438cbcc7ce51329aa283da95cd89d8be7d3de0dbecb9");
  // Previously pinned clauses stay verbatim (router.test.mts).
  for (const clause of [
    "ASK_MORE разрешён только если",
    "конкретный недостающий ответ может изменить primaryCourseId",
    "если один ROUTABLE курс имеет прямую явную поддержку из пользовательских формулировок, а альтернативы заметно слабее, выбирай RECOMMEND_COURSE;",
    "candidateCourseIds максимум 2;",
    "НЕ проси пользователя выбирать между моделями или курсами Академии;",
    "сообщения Навигатора/assistant — только контекст разговора, но НЕ самостоятельное evidence",
    "РАЗРЕШЕНЫ РОВНО ТРИ state:",
    "формулируй вопросы обычным языком задачи пользователя",
    "НЕ называй и НЕ объясняй внутренние обозначения",
    "Верни ASK_MORE: candidateCourseIds — ровно эти два курса, questions — один естественный вопрос по-русски о реальной учебной задаче пользователя",
    "если текущий каталог не соответствует запросу, не растягивай ASK_MORE: используй NO_CURRENT_COURSE_MATCH.",
  ]) {
    assert.ok(prompt.includes(clause), clause);
  }
  // The «ты» profile receives the same rules.
  const tyPrompt = await capturedRouterPrompt({ ...VY, addressMode: "TY" });
  for (const line of FIX3_LINES) assert.ok(tyPrompt.includes(line), line);
});

test("T2 FIX-3 validator unchanged: the live >2-candidate ASK_MORE is rejected; 0 and 2 candidates are accepted", async () => {
  const messages = [user(S2_ROUTED)];
  await assert.rejects(
    routeEducationalNavigation(messages, { callJson: async () => S2_FOUR_CANDIDATES }),
    /candidateCourseIds must contain at most 2 item\(s\)\./u,
  );
  await assert.rejects(
    routeEducationalNavigation(messages, {
      callJson: async () => ({ ...S2_FOUR_CANDIDATES, candidateCourseIds: ["levels-of-consciousness", "maslow", "play-and-creativity"] }),
    }),
    /at most 2/u,
  );
  assert.deepEqual(
    await routeEducationalNavigation(messages, { callJson: async () => BEGINNER_ASK_MORE }),
    BEGINNER_ASK_MORE,
  );
  const two = { ...BEGINNER_ASK_MORE, candidateCourseIds: ["levels-of-consciousness", "maslow"] };
  assert.deepEqual(await routeEducationalNavigation(messages, { callJson: async () => two }), two);
  // S3 (format-only, no learning task): the FIX-3 destination is validator-valid.
  assert.deepEqual(
    await routeEducationalNavigation([user(S3_ROUTED)], { callJson: async () => BEGINNER_ASK_MORE }),
    BEGINNER_ASK_MORE,
  );
});

function navigateDependencies(routeDecision: () => unknown, counters: { route: number }) {
  return {
    classifyAct: async (messages: readonly ConversationMessage[]) =>
      routeConversationAct(messages, { callJson: async () => ({ state: "NAVIGATE" }) }),
    route: async (messages: readonly ConversationMessage[]) => {
      counters.route += 1;
      return routeEducationalNavigation(messages, { profile: VY, callJson: async () => routeDecision() });
    },
    retrieve: async () => {
      throw new Error("retrieval must not run");
    },
  };
}

test("T2 FIX-3: a rejected >2-candidate decision still fails closed to the unchanged catalogue continuation", async () => {
  const counters = { route: 0 };
  const result = await orchestrateNavigatorResponse([user(S2_ROUTED)], {
    profile: VY,
    dependencies: navigateDependencies(() => S2_FOUR_CANDIDATES, counters),
  });
  assert.equal(counters.route, 1);
  assert.equal(result.decision, null);
  assert.equal(
    result.message,
    `Чтобы сориентироваться в курсах Академии, ниже текущий каталог. Подбор конкретного курса я продолжу, когда вы уточните задачу.\n\n${composeCatalogListAnswer()}\n\nНапишите, пожалуйста, с чем хотите разобраться.`,
  );
  // No candidate from the rejected decision leaks into the reply.
  assert.doesNotMatch(result.message ?? "", /напряжённых ситуациях/u);
});

type TurnOut = { message: string; state: ConversationState };

async function chatTurn(
  history: ConversationMessage[],
  state: ConversationState | null,
  routeDecision: () => unknown,
  act: () => unknown = () => ({ state: "NAVIGATE" }),
): Promise<TurnOut> {
  const orchestrate: typeof orchestrateNavigatorResponse = (messages, options) =>
    orchestrateNavigatorResponse(messages, {
      ...options,
      dependencies: {
        classifyAct: async (effective) => routeConversationAct(effective, { callJson: async () => act() }),
        route: async (routeMessages, routeOptions) =>
          routeEducationalNavigation(routeMessages, { ...routeOptions, callJson: async () => routeDecision() }),
        retrieve: async () => ({ hasActiveSources: false, bindings: [], matches: [] }),
      },
    });
  const body: Record<string, unknown> = { messages: history, profile: VY, requestId: `rfc1-${history.length}` };
  if (state !== null) body.conversationState = state;
  const info = console.info;
  console.info = () => undefined;
  try {
    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

test("T2 FIX-3: a valid beginner or format-only ASK_MORE [] clarifies and stores no NO_MATCH", async () => {
  for (const text of ["Мы новички. Какие курсы подходят?", "Меня зовут Анна, курсы онлайн?"]) {
    const first = await chatTurn([user(text)], null, () => BEGINNER_ASK_MORE);
    assert.match(first.message, /Что вы хотите понять, решить или изменить с помощью обучения\?/u, text);
    assert.notEqual(first.state.courseMatch, "NO_CURRENT_COURSE_MATCH", text);
    assert.equal(first.state.clarification?.issueKey, "ask-more:generic", text);
    assert.equal(first.state.clarification?.attempts, 1, text);

    // The next plain NAVIGATE turn is routed again rather than refused as no-match.
    const followUp = "Тогда какой курс вы посоветуете?";
    let routed = 0;
    const second = await chatTurn(
      [user(text), assistant(first.message), user(followUp)],
      first.state,
      () => {
        routed += 1;
        return BEGINNER_ASK_MORE;
      },
    );
    assert.equal(routed, 1, text);
    assert.notEqual(second.message, composeStableNoMatchAnswer(), text);
  }
});

test("T2 FIX-3: a genuine unmatched learning objective still yields NO_CURRENT_COURSE_MATCH and the stable no-match", async () => {
  const text = "Нужен курс по мобильной разработке на Swift.";
  const noMatch = { state: "NO_CURRENT_COURSE_MATCH", rationale: "Каталог не содержит курса по мобильной разработке." };
  const first = await chatTurn([user(text)], null, () => noMatch);
  assert.equal(first.state.courseMatch, "NO_CURRENT_COURSE_MATCH");
  assert.match(first.message, /не вижу в текущем каталоге Академии курса/u);

  let routed = 0;
  const second = await chatTurn(
    [user(text), assistant(first.message), user("Тогда какой курс вы посоветуете?")],
    first.state,
    () => {
      routed += 1;
      return noMatch;
    },
  );
  assert.equal(routed, 0, "stable no-match answers without routing");
  assert.equal(second.message, composeStableNoMatchAnswer());
});

test("T2 FIX-3 / A14: consecutive generic ASK_MORE [] turns share one issue; at the budget the kernel offers handoff instead of a fourth question", async () => {
  let history: ConversationMessage[] = [];
  let state: ConversationState | null = null;
  const turns = [
    "Мы новички.",
    "Хотим учиться в Академии.",
    "Нам интересно всё понемногу.",
    "Посоветуйте что-нибудь для начала.",
  ];
  const outs: TurnOut[] = [];
  let routed = 0;
  for (const text of turns) {
    history = [...history, user(text)];
    const out = await chatTurn(history, state, () => {
      routed += 1;
      return BEGINNER_ASK_MORE;
    });
    outs.push(out);
    history = [...history, assistant(out.message)];
    state = out.state;
  }
  assert.deepEqual(
    outs.slice(0, CLARIFICATION_BUDGET).map((out) => [out.state.clarification?.issueKey, out.state.clarification?.attempts]),
    [["ask-more:generic", 1], ["ask-more:generic", 2], ["ask-more:generic", 3]],
  );
  // Budget reached: the control kernel answers the next unresolved turn with
  // the one-shot handoff offer; the educational router is not called again.
  assert.equal(routed, CLARIFICATION_BUDGET, "no fourth routing / clarification");
  // A19: the unresolved turn's request is preserved after the offer.
  assert.equal(
    outs[CLARIFICATION_BUDGET]?.message,
    `${composeHandoffOfferedAnswer(VY, "CLARIFICATION_EXHAUSTED")}\n\nВаш запрос я сохранил: «Посоветуйте что-нибудь для начала».`,
  );
  assert.equal(outs[CLARIFICATION_BUDGET]?.state.lastAssistant?.act, "HANDOFF_OFFERED");
});

/* ---------------------------------------------------------------------------
 * T3 — FIX-4: act router.
 * ------------------------------------------------------------------------ */

async function capturedActPrompt(): Promise<string> {
  let captured = "";
  await routeConversationAct([user("Что такое архетип Тени?")], {
    callJson: async (requestMessages) => {
      captured = requestMessages[0]?.content ?? "";
      return { state: "META" };
    },
  });
  return captured;
}

const FIX4_LINES = [
  "ДЛИТЕЛЬНОСТЬ, КОЛИЧЕСТВО ВСТРЕЧ И ФОРМАТ КУРСА:",
  "- вопрос о длительности курса, количестве встреч или формате курса («Сколько длится этот курс?», «Сколько в нём встреч?», «Сколько часов идёт курс?», «В каком формате проходит курс?») о курсе, точное название или адрес страницы которого есть в разговоре, — COURSE_FOLLOW_UP с courseId этого курса;",
  "- отсылка «этот курс», «он», «в нём» указывает на курс, только если из разговора однозначно ясно, о каком точно названном курсе идёт речь: например, «А сколько длится этот курс?» сразу после ответа Навигатора о курсе, точное название которого в этом ответе есть. Если точно названы несколько курсов и неясно, о каком из них вопрос, или точного названия в разговоре нет, курс не угадывай;",
  "- КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА: если в разговоре НЕТ точного названия или адреса страницы ни одного курса catalog, а в последней реплике курс, о длительности или количестве встреч которого спрашивают, назван коротко, сокращением или пересказом и однозначно указывает ровно на один курс со status \"ROUTABLE\" («Сколько длится курс Маслоу?», «Сколько встреч в курсе про уровни сознания?»), — это COURSE_CONTENT с courseId этого курса и contentIntentEvidence — дословной цитатой этого вопроса из последней реплики. Не заменяй такой вопрос списком каталога: вопрос остаётся об этом одном курсе. Точного названия курса короткое название при этом не создаёт;",
  "- если точное название или адрес страницы какого-либо курса catalog в разговоре есть, а в последней реплике о длительности или количестве встреч коротко назван ДРУГОЙ курс, точного названия которого в разговоре нет, — в этом единственном случае верни COURSE_FOLLOW_UP с courseId коротко названного курса как предложение: точного основания оно не даёт, сервер проверит точное название и, не найдя его, сам попросит пользователя уточнить курс. Не подменяй коротко названный курс курсом, названным точно. Если коротко назван тот же курс, точное название которого в разговоре есть, — это COURSE_FOLLOW_UP по первому пункту;",
  "- FACTUAL с {\"kind\":\"CATALOG_LIST\"} возвращай только если: вопрос о длительности или количестве встреч курсов Академии вообще, без указания одного курса («Сколько длятся курсы Академии?»); отсылка «этот курс», «он», «в нём» не указывает однозначно ни на один точно названный курс (в разговоре нет ни одного курса или точно названы несколько и неясно, о каком из них вопрос); курс в catalog имеет status \"LISTED_UNROUTABLE\". В каталоге указано количество встреч каждого курса, и ни один курс при этом не угадывается;",
  "- такой вопрос — не CURRENT_METADATA: длительность курса и количество встреч не являются ни ценой (PRICE), ни расписанием (SCHEDULE), ни потоком (COHORT), ни окном набора (ENROLLMENT_WINDOW).",
  "CURRENT_METADATA.fields — только PRICE (стоимость), SCHEDULE (расписание), COHORT (поток) и ENROLLMENT_WINDOW (окно набора); других полей нет, не придумывай поля вроде DURATION, MEETINGS или FORMAT. PRICE выбирай только для вопроса о стоимости или цене: вопрос о длительности курса или количестве встреч — не вопрос о цене, не подставляй вместо него PRICE или другое поле (см. «ДЛИТЕЛЬНОСТЬ, КОЛИЧЕСТВО ВСТРЕЧ И ФОРМАТ КУРСА»).",
  "- длительности курса или количества встреч — это COURSE_FOLLOW_UP или FACTUAL CATALOG_LIST (см. «ДЛИТЕЛЬНОСТЬ, КОЛИЧЕСТВО ВСТРЕЧ И ФОРМАТ КУРСА»), а не COURSE_CONTENT; единственное исключение — курс, однозначно названный в последней реплике коротко, когда точного названия или адреса страницы ни одного курса catalog в разговоре нет: это COURSE_CONTENT (см. «КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА»);",
  "Исключение — вопрос о длительности или количестве встреч одного курса, однозначно названного в последней реплике коротко, когда точного названия или адреса страницы ни одного курса catalog в разговоре нет: это COURSE_CONTENT, а не список каталога (см. «КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА»).",
] as const;

test("T3 FIX-4 + CORR1 prompt: duration, meeting-count, format, short-name and anaphora guidance plus closed-field and PRICE prohibitions; insert-only against the 26593e3b pin", async () => {
  const prompt = await capturedActPrompt();
  // CORR1 (IV1-01) re-baseline, recomputed from the captured bytes. IV1-audited
  // FIX-4 digest: 0f776e6d8ce3e85c7442280bcfc61e8fb20d8d47de1cac3060ad75e5614ccb3f.
  assert.equal(sha256(prompt), "a5368d8d6a77603ea8a6f284a77fa1c5929c2a1a210fde609247b946b775897d");
  const lines = prompt.split("\n");
  for (const line of FIX4_LINES) {
    assert.equal(lines.filter((candidate) => candidate === line).length, 1, line);
  }
  const reduced = lines.filter((line) => !(FIX4_LINES as readonly string[]).includes(line)).join("\n");
  assert.equal(sha256(reduced), "26593e3b3f3220f0771b00e5b1fd6666b2a30a74cb3d26824dd1aae2280b838a");

  for (const clause of [
    "COURSE_FOLLOW_UP с courseId этого курса",
    "курс не угадывай",
    "не придумывай поля вроде DURATION, MEETINGS или FORMAT",
    "не подставляй вместо него PRICE или другое поле",
    "PRICE выбирай только для вопроса о стоимости или цене",
    "«А сколько длится этот курс?» сразу после ответа Навигатора о курсе, точное название которого в этом ответе есть",
  ]) {
    assert.ok(prompt.includes(clause), clause);
  }
  // Retained boundaries (C1 prompt test and payment-policy test clauses).
  for (const clause of [
    "РАЗРЕШЕНЫ РОВНО ШЕСТЬ state:",
    "это FACTUAL (в том числе «Сколько стоит курс Маслоу?»)",
    "оплата/запись на курс — это NAVIGATE, вопрос о цене — FACTUAL",
    "courseId должен указывать только на ROUTABLE курс, чьё точное название или адрес страницы есть в разговоре.",
    "Если точное название или адрес страницы любого курса catalog уже есть в разговоре, COURSE_CONTENT не используй.",
    "Отсылки «там», «в нём», «на этом курсе» сами по себе не являются явным указанием курса.",
    '{"kind":"CURRENT_METADATA","courseIds":[],"fields":["PRICE"],"scope":"SELECTED"}',
    '{"state":"COURSE_FOLLOW_UP","courseId":"course-id","evidenceRequested":false}',
  ]) {
    assert.ok(prompt.includes(clause), clause);
  }
});

test("T3 FIX-4 validator unchanged: invented DURATION rejected, PRICE accepted (FIX-4b not implemented), FOLLOW_UP needs the literal title, F-1 intact", () => {
  assert.throws(
    () => validateConversationActDecision(S5_DURATION_DECISION, S5_MESSAGES),
    /CURRENT_METADATA\.fields must be a non-empty unique supported field list\./u,
  );
  for (const field of ["MEETINGS", "FORMAT"]) {
    assert.throws(
      () => validateConversationActDecision({ state: "FACTUAL", intents: [{ kind: "CURRENT_METADATA", courseIds: ["maslow"], fields: [field], scope: "REFERENCED" }] }, S5_MESSAGES),
      /supported field list/u,
      field,
    );
  }
  // The semantic PRICE substitution remains validator-valid by contract.
  assert.deepEqual(validateConversationActDecision(S5_PRICE_DECISION, S5_MESSAGES), S5_PRICE_DECISION);
  // The FIX-4 destination is accepted only through the literal title.
  assert.deepEqual(validateConversationActDecision(S5_FOLLOW_UP_DECISION, S5_MESSAGES), S5_FOLLOW_UP_DECISION);
  const shortNameOnly = [user(S4_QUESTION), assistant("Курс Маслоу — это 6 встреч."), user(S5_ROUTED)];
  const unanchored = validateConversationActDecision(S5_FOLLOW_UP_DECISION, shortNameOnly);
  assert.equal(unanchored.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.ok(!("courseId" in unanchored));
  assert.throws(
    () => validateConversationActDecision(S5_FOLLOW_UP_DECISION, [user("А сколько длится этот курс")]),
    /absent from the conversation/u,
  );
  // F-1: COURSE_CONTENT is still unavailable once the title is in the conversation.
  assert.throws(
    () => validateConversationActDecision({ state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: S5_ROUTED }, S5_MESSAGES),
    /once a catalog course is present/u,
  );
});

function courseDependencies(act: () => unknown, counters: { retrieve: number }) {
  return {
    classifyAct: async (messages: readonly ConversationMessage[]) =>
      routeConversationAct(messages, { callJson: async () => act() }),
    retrieve: async () => {
      counters.retrieve += 1;
      return { hasActiveSources: false, bindings: [], matches: [] };
    },
    route: async () => {
      throw new Error("educational router must not run");
    },
  };
}

test("T3 FIX-4 + FIX-1: S5 routed to COURSE_FOLLOW_UP answers «6 встреч» from catalogue authority, never the price", async () => {
  const counters = { retrieve: 0 };
  const result = await orchestrateNavigatorResponse(S5_MESSAGES, {
    profile: VY,
    dependencies: courseDependencies(() => S5_FOLLOW_UP_DECISION, counters),
  });
  assert.equal(counters.retrieve, 1);
  assert.equal(result.conversationAct.state, "COURSE_FOLLOW_UP");
  assert.equal(result.message, composeCatalogFollowUpAnswer(MASLOW, S5_ROUTED));
  assert.match(result.message ?? "", /6 встреч\./u);
  assert.doesNotMatch(result.message ?? "", /₽|стоимост|60 000/u);
  assert.equal(result.observability?.answerOrigin, "CATALOG_AUTHORITY");
  assert.equal(result.observability?.fallback, "CATALOG_FOLLOW_UP");
});

test("T3 FIX-1 lane coverage: a short-name duration question accepted as COURSE_CONTENT reaches the same catalogue answer", async () => {
  const question = "Сколько длится курс Маслоу";
  const counters = { retrieve: 0 };
  const result = await orchestrateNavigatorResponse([user(question)], {
    profile: VY,
    dependencies: courseDependencies(
      () => ({ state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: question }),
      counters,
    ),
  });
  assert.equal(result.conversationAct.state, "COURSE_CONTENT");
  assert.equal(result.message, composeCatalogFollowUpAnswer(MASLOW, question));
  assert.equal(result.observability?.answerOrigin, "CATALOG_AUTHORITY");
});

test("T3 FIX-4 + CORR1: CATALOG_LIST stays the destination when «этот курс» identifies no course, stating every meeting count with FIX-5 agreement", async () => {
  const counters = { retrieve: 0 };
  const result = await orchestrateNavigatorResponse([user("А сколько длится этот курс?")], {
    profile: VY,
    dependencies: courseDependencies(() => ({ state: "FACTUAL", intents: [{ kind: "CATALOG_LIST" }] }), counters),
  });
  assert.equal(counters.retrieve, 0);
  assert.equal(result.message, composeCatalogListAnswer());
  assert.match(result.message ?? "", new RegExp(`«${MASLOW_TITLE.replace(/[.]/gu, "\\.")}» — 6 встреч;`, "u"));
});

test("T3 FIX-4 preservation: a genuine price question keeps FACTUAL PRICE and the dated commercial answer", async () => {
  const counters = { retrieve: 0 };
  const messages = [user(S4_QUESTION), assistant(S4_ANSWER), user("А сколько стоит этот курс")];
  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    dependencies: courseDependencies(() => S5_PRICE_DECISION, counters),
  });
  assert.equal(result.conversationAct.state, "FACTUAL");
  assert.equal(counters.retrieve, 0);
  assert.match(result.message ?? "", /60\s000\s₽/u);
});

test("T3 ARM-B preservation: the live DURATION rejection still recovers through the frozen plan path to the frozen UNDISPATCHED line", async () => {
  let extractions = 0;
  const result = await orchestrateNavigatorResponse(S5_MESSAGES, {
    profile: VY,
    dependencies: {
      classifyAct: async (messages) => routeConversationAct(messages, { callJson: async () => S5_DURATION_DECISION }),
      extractPlan: async () => {
        extractions += 1;
        return S5_ARM_B_PLAN;
      },
      retrieve: async () => {
        throw new Error("retrieval must not run");
      },
      route: async () => {
        throw new Error("educational router must not run");
      },
    },
  });
  assert.equal(extractions, 1);
  assert.equal(result.message, undispatchedLineText("А сколько длится этот курс"));
});

/* ---------------------------------------------------------------------------
 * T4 — FIX-5: Russian meeting-count morphology.
 * ------------------------------------------------------------------------ */

test("T4 FIX-5: meeting-count agreement follows the Russian cardinal rule", () => {
  const table: ReadonlyArray<readonly [number, string]> = [
    [1, "1 встреча"],
    [2, "2 встречи"],
    [4, "4 встречи"],
    [5, "5 встреч"],
    [6, "6 встреч"],
    [11, "11 встреч"],
    [12, "12 встреч"],
    [14, "14 встреч"],
    [21, "21 встреча"],
    [22, "22 встречи"],
    [25, "25 встреч"],
    [0, "0 встреч"],
    [111, "111 встреч"],
    [122, "122 встречи"],
  ];
  for (const [count, expected] of table) assert.equal(formatMeetingCount(count), expected, String(count));
});

test("T4 FIX-5: the catalogue list changes only the meeting-count word; titles, links, availability and snapshot date are unchanged", () => {
  const answer = composeCatalogListAnswer();
  const lines = answer.split("\n");
  assert.equal(lines[0], `Каталог Академии по состоянию на ${ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE}:`);
  assert.equal(lines.length, ACADEMY_COURSES.length + 1);
  for (const [index, course] of ACADEMY_COURSES.entries()) {
    const availability =
      course.status === "ROUTABLE"
        ? "доступен для навигации"
        : "только указан в каталоге; публичной страницы с достаточным описанием пока нет";
    const tail = `; ${availability}${course.url ? `; ${course.url}` : ""}.`;
    assert.equal(lines[index + 1], `• «${course.title}» — ${formatMeetingCount(course.meetings)}${tail}`, course.id);
    // Reverting only the count word reproduces the f5aa968 line.
    assert.equal(
      lines[index + 1]?.replace(formatMeetingCount(course.meetings), `${course.meetings} встреч`),
      `• «${course.title}» — ${course.meetings} встреч${tail}`,
      course.id,
    );
  }
  assert.match(answer, /«Иерархия уровней сознания» — 4 встречи;/u);
  assert.match(answer, /«Иерархия потребностей А\. Маслоу: новая парадигма» — 6 встреч;/u);
  assert.match(answer, /— 25 встреч;/u);
  assert.doesNotMatch(answer, /(?<!\d)[234] встреч;/u);
});

/* ---------------------------------------------------------------------------
 * T5 — ROUTER-FAILURE-CORRECTION-1.CORR1 (Codex IV1-01 / IV1-02 / IV1-03).
 *
 * Each CORR1-A case replays the decision the corrected act prompt prescribes
 * through the unchanged validator and orchestrator and checks the resulting
 * answer: bound course, retrieval scope, relevance, authorization and
 * completion. Model choices remain canned; live DeepSeek compliance is not
 * established here.
 * ------------------------------------------------------------------------ */

const ALL_TITLES = ACADEMY_COURSES.map((course) => course.title);
const LEVELS_TITLE = "Иерархия уровней сознания";

type RoutedDecision = Awaited<ReturnType<NonNullable<OrchestrationDependencies["route"]>>>;

function trackedDependencies(
  act: () => unknown,
  retrieved: string[],
  route?: () => unknown,
): OrchestrationDependencies {
  return {
    classifyAct: async (messages: readonly ConversationMessage[]) =>
      routeConversationAct(messages, { callJson: async () => act() }),
    retrieve: async (courseId: string) => {
      retrieved.push(courseId);
      return { hasActiveSources: false, bindings: [], matches: [] };
    },
    route: async () => {
      if (!route) throw new Error("educational router must not run");
      return route() as RoutedDecision;
    },
  };
}

function assertSingleCourseAnswer(message: string, courseId: string, question: string) {
  const course = getAcademyCourse(courseId);
  assert.ok(course);
  assert.equal(message, composeCatalogFollowUpAnswer(course, question), question);
  assert.notEqual(message, composeCatalogListAnswer(), question);
  assert.ok(message.includes(`«${course.title}»`), question);
  for (const title of ALL_TITLES.filter((title) => title !== course.title)) {
    assert.ok(!message.includes(title), `${question} — no other course: ${title}`);
  }
  assert.doesNotMatch(message, /₽|стоимост/u, question);
  for (const pattern of UNAUTHORIZED_FACTS) assert.doesNotMatch(message, pattern, question);
}

test("T5 CORR1-A prompt: the short-name destination is COURSE_CONTENT, CATALOG_LIST is narrowed, and the universal catalogue fallback is gone", async () => {
  const prompt = await capturedActPrompt();
  assert.ok(!prompt.includes(
    '- если курс, о длительности или количестве встреч которого спрашивают, нельзя однозначно определить по точному названию или адресу страницы в разговоре, верни FACTUAL с {"kind":"CATALOG_LIST"}: в каталоге указано количество встреч каждого курса;',
  ));
  for (const clause of [
    "КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА: если в разговоре НЕТ точного названия или адреса страницы ни одного курса catalog",
    "«Сколько длится курс Маслоу?», «Сколько встреч в курсе про уровни сознания?»), — это COURSE_CONTENT с courseId этого курса",
    "Не заменяй такой вопрос списком каталога: вопрос остаётся об этом одном курсе. Точного названия курса короткое название при этом не создаёт;",
    "в этом единственном случае верни COURSE_FOLLOW_UP с courseId коротко названного курса как предложение",
    "сервер проверит точное название и, не найдя его, сам попросит пользователя уточнить курс",
    'FACTUAL с {"kind":"CATALOG_LIST"} возвращай только если:',
    "ни один курс при этом не угадывается;",
    "единственное исключение — курс, однозначно названный в последней реплике коротко",
    "это COURSE_CONTENT, а не список каталога (см. «КОРОТКОЕ НАЗВАНИЕ ОДНОГО КУРСА»).",
    // Unchanged boundaries: F-1, short-name ≠ literal authority.
    "Если точное название или адрес страницы любого курса catalog уже есть в разговоре, COURSE_CONTENT не используй.",
    "Короткое название, сокращение или пересказ курса («курс Маслоу», «курс по структурной типологии личности») сами по себе НЕ дают основания для COURSE_FOLLOW_UP",
  ]) {
    assert.ok(prompt.includes(clause), clause);
  }
});

test("T5 CORR1-A IV1-01: «Сколько длится курс Маслоу?» stays a Maslow answer through the validator-permitted COURSE_CONTENT lane, never the six-course catalogue", async () => {
  const question = "Сколько длится курс Маслоу?";
  assert.deepEqual(resolveCourseReferences(question), { kind: "ONE", courseIds: ["maslow"] });
  const decision = { state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: question };
  // Accepted as-is by the unchanged validator: no exact title, so F-1 permits it; no UNRESOLVED.
  assert.deepEqual(validateConversationActDecision(decision, [user(question)]), decision);
  // The same short name never gains literal FOLLOW_UP authority.
  assert.equal(
    validateConversationActDecision({ state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false }, [user(question)]).state,
    "COURSE_REFERENCE_UNRESOLVED",
  );

  const retrieved: string[] = [];
  const result = await orchestrateNavigatorResponse([user(question)], {
    profile: VY,
    dependencies: trackedDependencies(() => decision, retrieved),
  });
  assert.deepEqual(retrieved, ["maslow"]);
  assert.equal(result.conversationAct.state, "COURSE_CONTENT");
  assertSingleCourseAnswer(result.message ?? "", "maslow", question);
  assert.match(result.message ?? "", /указана только количеством встреч: 6 встреч\./u);
  assert.ok((result.message ?? "").includes(
    "Длительность одной встречи, общее количество часов, частота встреч и календарные сроки курса в доступных мне подтверждённых данных не указаны.",
  ));
  assert.equal(result.observability?.answerOrigin, "CATALOG_AUTHORITY");
  assert.equal(result.observability?.courseId, "maslow");
  assert.equal(result.completion, "ANSWERED");
});

test("T5 CORR1-A: the exact full title in the question keeps COURSE_FOLLOW_UP; COURSE_CONTENT stays closed by F-1", async () => {
  const question = `Сколько длится курс «${MASLOW_TITLE}»?`;
  const followUp = { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false };
  assert.deepEqual(validateConversationActDecision(followUp, [user(question)]), followUp);
  assert.throws(
    () => validateConversationActDecision({ state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: question }, [user(question)]),
    /once a catalog course is present/u,
  );
  const retrieved: string[] = [];
  const result = await orchestrateNavigatorResponse([user(question)], {
    profile: VY,
    dependencies: trackedDependencies(() => followUp, retrieved),
  });
  assert.deepEqual(retrieved, ["maslow"]);
  assert.equal(result.conversationAct.state, "COURSE_FOLLOW_UP");
  assertSingleCourseAnswer(result.message ?? "", "maslow", question);
  assert.match(result.message ?? "", /6 встреч\./u);
  assert.equal(result.completion, "ANSWERED");
});

test("T5 CORR1-A: «А сколько длится этот курс?» after one exact title answers for that course", async () => {
  const question = "А сколько длится этот курс?";
  const messages = [user(S4_QUESTION), assistant(S4_ANSWER), user(question)];
  assert.deepEqual(validateConversationActDecision(S5_FOLLOW_UP_DECISION, messages), S5_FOLLOW_UP_DECISION);
  const retrieved: string[] = [];
  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    dependencies: trackedDependencies(() => S5_FOLLOW_UP_DECISION, retrieved),
  });
  assert.deepEqual(retrieved, ["maslow"]);
  assertSingleCourseAnswer(result.message ?? "", "maslow", question);
  assert.equal(result.completion, "ANSWERED");
});

test("T5 CORR1-A / D-B residual: after two exact titles «этот курс» keeps the CATALOG_LIST fallback (both counts, no course guessed); both literal FOLLOW_UP bindings remain validator-valid (pre-existing C-3)", async () => {
  const question = "А сколько длится этот курс?";
  const messages = [
    user("Расскажите о курсах."),
    assistant(`Есть курс «${MASLOW_TITLE}» и курс «${LEVELS_TITLE}».`),
    user(question),
  ];
  const retrieved: string[] = [];
  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    dependencies: trackedDependencies(() => ({ state: "FACTUAL", intents: [{ kind: "CATALOG_LIST" }] }), retrieved),
  });
  assert.deepEqual(retrieved, []);
  assert.equal(result.message, composeCatalogListAnswer());
  assert.ok((result.message ?? "").includes(`«${MASLOW_TITLE}» — 6 встреч;`));
  assert.ok((result.message ?? "").includes(`«${LEVELS_TITLE}» — 4 встречи;`));
  assert.equal(result.observability?.courseId, null);
  assert.equal(result.completion, "ANSWERED");
  // Registered residual limitation (Owner D-B): no deterministic clarification is reachable here.
  for (const courseId of ["maslow", "levels-of-consciousness"]) {
    const followUp = { state: "COURSE_FOLLOW_UP", courseId, evidenceRequested: false };
    assert.deepEqual(validateConversationActDecision(followUp, messages), followUp, courseId);
  }
});

test("T5 CORR1-A / D-B residual: with no identified course «этот курс» keeps CATALOG_LIST; a guessed course is never accepted", async () => {
  const question = "А сколько длится этот курс?";
  assert.deepEqual(resolveCourseReferences(question), { kind: "ZERO", courseIds: [] });
  const retrieved: string[] = [];
  const result = await orchestrateNavigatorResponse([user(question)], {
    profile: VY,
    dependencies: trackedDependencies(() => ({ state: "FACTUAL", intents: [{ kind: "CATALOG_LIST" }] }), retrieved),
  });
  assert.deepEqual(retrieved, []);
  assert.equal(result.message, composeCatalogListAnswer());
  assert.equal(result.completion, "ANSWERED");
  // A guessed FOLLOW_UP is rejected (absent course → degraded, no course answer).
  assert.throws(
    () => validateConversationActDecision({ state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false }, [user(question)]),
    /absent from the conversation/u,
  );
  const degraded = await orchestrateNavigatorResponse([user(question)], {
    profile: VY,
    dependencies: trackedDependencies(() => ({ state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false }), []),
  });
  assert.equal(degraded.conversationAct.state, "ROUTER_DEGRADED");
  assert.doesNotMatch(degraded.message ?? "", /встреч/u);
  // A guessed COURSE_CONTENT is turned into the controlled uncertainty, never bound.
  const guessed = validateConversationActDecision(
    { state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: question },
    [user(question)],
  );
  assert.equal(guessed.state, "COURSE_REFERENCE_UNRESOLVED");
});

test("T5 CORR1-A: unambiguous short names of the other routable courses bind to exactly that course with its own meeting count", async () => {
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ["Сколько длится курс по структурной типологии?", "structural-typology", /25 встреч\./u],
    ["Сколько встреч в курсе про уровни сознания?", "levels-of-consciousness", /указано количество встреч: 4\./u],
    ["Сколько длится курс про игру и творчество?", "play-and-creativity", /6 встреч\./u],
    ["Какая продолжительность курса по нормативной ситуации?", "normative-situation", /6 встреч\./u],
    ["Сколько часов длится курс Маслоу?", "maslow", /Общее количество часов в доступных мне подтверждённых данных не указано/u],
  ];
  for (const [question, courseId, expected] of cases) {
    assert.deepEqual(resolveCourseReferences(question), { kind: "ONE", courseIds: [courseId] }, question);
    const decision = { state: "COURSE_CONTENT", courseId, evidenceRequested: false, contentIntentEvidence: question };
    assert.deepEqual(validateConversationActDecision(decision, [user(question)]), decision, question);
    const retrieved: string[] = [];
    const result = await orchestrateNavigatorResponse([user(question)], {
      profile: VY,
      dependencies: trackedDependencies(() => decision, retrieved),
    });
    assert.deepEqual(retrieved, [courseId], question);
    assertSingleCourseAnswer(result.message ?? "", courseId, question);
    assert.match(result.message ?? "", expected, question);
    assert.equal(result.observability?.courseId, courseId, question);
    assert.equal(result.completion, "ANSWERED", question);
  }
});

test("T5 CORR1-A / D-C: a short-named course while another course is named exactly takes the unchanged controlled COURSE_REFERENCE_UNRESOLVED clarification", async () => {
  const question = "Сколько длится курс Маслоу?";
  const messages = [user(`Расскажите про курс «${LEVELS_TITLE}».`), assistant("Хорошо."), user(question)];
  const proposal = { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false };
  const validated = validateConversationActDecision(proposal, messages);
  assert.equal(validated.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.ok(!("courseId" in validated));
  assert.throws(
    () => validateConversationActDecision({ state: "COURSE_CONTENT", courseId: "maslow", evidenceRequested: false, contentIntentEvidence: question }, messages),
    /once a catalog course is present/u,
  );
  const retrieved: string[] = [];
  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    dependencies: trackedDependencies(() => proposal, retrieved),
  });
  assert.deepEqual(retrieved, []);
  assert.equal(result.conversationAct.state, "COURSE_REFERENCE_UNRESOLVED");
  assert.equal(result.message, composeFollowUpReferenceClarification(VY));
  assert.doesNotMatch(result.message ?? "", /встреч/u);
  for (const title of ALL_TITLES) assert.ok(!(result.message ?? "").includes(title), title);
  assert.equal(result.observability?.courseId, null);
  assert.equal(result.completion, "USER_ACTION_REQUIRED");
});

test("T5 CORR1-A: genuine catalogue requests keep FACTUAL CATALOG_LIST", async () => {
  for (const question of ["Какие курсы есть в Академии?", "Сколько длятся курсы Академии?"]) {
    assert.deepEqual(resolveCourseReferences(question), { kind: "ZERO", courseIds: [] }, question);
    const retrieved: string[] = [];
    const result = await orchestrateNavigatorResponse([user(question)], {
      profile: VY,
      dependencies: trackedDependencies(() => ({ state: "FACTUAL", intents: [{ kind: "CATALOG_LIST" }] }), retrieved),
    });
    assert.deepEqual(retrieved, [], question);
    assert.equal(result.message, composeCatalogListAnswer(), question);
    assert.equal(result.completion, "ANSWERED", question);
  }
});

const CORR1_OWNER_PAIR_FIXTURE = "Хочу пройти курс Маслоу. А ещё рассматриваю курс «Нормативная ситуация».";
const CORR1_PAIR_ASK_MORE = {
  state: "ASK_MORE",
  candidateCourseIds: ["maslow", "normative-situation"],
  questions: ["Что вы хотите понять, решить или изменить с помощью обучения?"],
  rationale: "Пользователь сам назвал два рассматриваемых курса.",
};

test("T5 CORR1-B prompt: explicit course-choice precedence over the no-task [] rule, in both address modes", async () => {
  for (const profile of [VY, { ...VY, addressMode: "TY" as const }]) {
    const prompt = await capturedRouterPrompt(profile);
    for (const clause of [
      "и сам не назвал ни одного курса каталога, который хочет пройти или рассматривает как вариант",
      "ПРИОРИТЕТ ЯВНОГО ВЫБОРА КУРСА: правило «ДВА КУРСА КАК ТЕКУЩИЕ АЛЬТЕРНАТИВЫ» (с его исключениями) имеет приоритет над правилом «УЧЕБНАЯ ЗАДАЧА ЕЩЁ НЕ ОПИСАНА» и над правилом о candidateCourseIds: [] в ASK_MORE",
      "применяется, даже если учебная задача ещё не описана",
      "«Хочу пройти курс Маслоу. А ещё рассматриваю курс „Нормативная ситуация“.»",
      "верни ASK_MORE с candidateCourseIds — ровно этими двумя курсами и одним вопросом о его учебной задаче",
      "candidateCourseIds: [] возвращай, только когда пользователь не назвал ни одного курса каталога как желаемый или рассматриваемый;",
      // Preserved C2 contract and maximum-two rule.
      "Верни ASK_MORE: candidateCourseIds — ровно эти два курса, questions — один естественный вопрос по-русски о реальной учебной задаче пользователя",
      "candidateCourseIds НИКОГДА не содержит больше двух id.",
      "NO_CURRENT_COURSE_MATCH возвращай, когда пользователь описал учебную задачу или потребность, а ни один курс текущего каталога ей честно не соответствует;",
    ]) {
      assert.ok(prompt.includes(clause), `${profile.addressMode}: ${clause}`);
    }
    const lines = prompt.split("\n");
    const priority = lines.findIndex((line) => line.startsWith("- ПРИОРИТЕТ ЯВНОГО ВЫБОРА КУРСА:"));
    const noTask = lines.findIndex((line) => line.startsWith("- УЧЕБНАЯ ЗАДАЧА ЕЩЁ НЕ ОПИСАНА:"));
    assert.equal(priority, noTask + 1, String(profile.addressMode));
  }
});

test("T5 CORR1-B IV1-02: the Owner pair fixture with no stated objective keeps both named alternatives as ASK_MORE candidates", async () => {
  const messages = [user(CORR1_OWNER_PAIR_FIXTURE)];
  assert.deepEqual(resolveCourseReferences(CORR1_OWNER_PAIR_FIXTURE).courseIds, ["maslow", "normative-situation"]);
  const routed = await routeEducationalNavigation(messages, { callJson: async () => CORR1_PAIR_ASK_MORE });
  assert.deepEqual(routed, CORR1_PAIR_ASK_MORE);

  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    dependencies: trackedDependencies(() => ({ state: "NAVIGATE" }), [], () => CORR1_PAIR_ASK_MORE),
  });
  assert.equal(result.decision?.state, "ASK_MORE");
  assert.deepEqual(
    result.decision?.state === "ASK_MORE" ? result.decision.candidateCourseIds : null,
    ["maslow", "normative-situation"],
  );
  assert.equal(result.clarification.status, "ASKED");
  assert.equal(result.clarification.issueKey, "ask-more:maslow+normative-situation");
  assert.ok((result.message ?? "").includes(CORR1_PAIR_ASK_MORE.questions[0]));
  assert.notEqual(result.message, composeStableNoMatchAnswer());
  assert.equal(result.completion, "USER_ACTION_REQUIRED");
  // The validator stays neutral (unchanged): >2 candidates are still rejected.
  await assert.rejects(
    routeEducationalNavigation(messages, { callJson: async () => S2_FOUR_CANDIDATES }),
  );
});

test("T5 CORR1-C IV1-03: subject-time allocation, in-course phenomena and «программ»-prefixed words are not course-duration questions and keep the factual ceiling", async () => {
  for (const question of [
    "Сколько времени на курсе уделяется мотивации?",
    "Сколько часов в программе посвящено мотивации?",
    "Сколько длится программирование?",
    "Сколько часов программы посвящено мотивации?",
    "Сколько времени курса отводится на мотивацию?",
    "Как долго на курсе сохраняется мотивация?",
    "Сколько длится мотивация на курсе?",
    "Сколько времени в обучении уходит на практику?",
    "Сколько длится программный кризис?",
  ]) {
    assert.equal(isCourseDurationQuestion(question), false, question);
    assert.equal(isCatalogAnswerableFollowUp(question), false, question);
    const outcomes: CourseFollowUpOutcome[] = [];
    const answer = await composeCourseFollowUpAnswer(
      [user(`Расскажите про курс «${MASLOW_TITLE}».`), assistant("Хорошо."), user(question)],
      { state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false },
      { ...noProvider, evidenceSelection: { status: "INSUFFICIENT", evidence: [] }, onOutcome: (outcome) => outcomes.push(outcome) },
    );
    assert.equal(answer, composeCourseFactualCeilingAnswer(MASLOW_TITLE), question);
    assert.deepEqual(outcomes, [{ answerOrigin: "FACTUAL_CEILING", fallback: "FACTUAL_CEILING" }], question);
  }
});

test("T5 CORR1-C IV1-03: the Codex orchestration counterexample no longer substitutes the total meeting count", async () => {
  const question = "Сколько времени на курсе уделяется мотивации?";
  const messages = [user(`Расскажите про курс «${MASLOW_TITLE}».`), assistant("Хорошо."), user(question)];
  const result = await orchestrateNavigatorResponse(messages, {
    profile: VY,
    dependencies: trackedDependencies(() => ({ state: "COURSE_FOLLOW_UP", courseId: "maslow", evidenceRequested: false }), []),
  });
  assert.equal(result.message, composeCourseFactualCeilingAnswer(MASLOW_TITLE));
  assert.doesNotMatch(result.message ?? "", /встреч/u);
  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
});

test("T5 CORR1-C: course and session duration questions stay positive and answer only the authorized meeting count", () => {
  for (const question of [
    "Сколько длится курс Маслоу?",
    "А сколько длится этот курс?",
    "Какая продолжительность курса?",
    "Сколько часов длится курс?",
    "Сколько длится одна встреча?",
    "Сколько времени занимает программа?",
    "На сколько часов рассчитана программа?",
    "Как долго продолжается обучение?",
    "Какова длительность каждого занятия?",
    "Курс длится сколько месяцев?",
    "Сколько минут идет занятие?",
    "Какая продолжительность обучения?",
  ]) {
    assert.equal(isCourseDurationQuestion(question), true, question);
    assert.equal(isCatalogAnswerableFollowUp(question), true, question);
    const answer = composeCatalogFollowUpAnswer(MASLOW, question);
    assert.ok(answer.includes(`В текущем каталоге продолжительность курса «${MASLOW_TITLE}» указана только количеством встреч: 6 встреч.`), question);
    for (const pattern of UNAUTHORIZED_FACTS) assert.doesNotMatch(answer, pattern, question);
  }
});
