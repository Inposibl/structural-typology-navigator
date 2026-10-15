import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { routeEducationalNavigation } from "../../src/lib/navigation/router.ts";

const messages = [
  {
    role: "user" as const,
    content: "У меня люди не соблюдают правила, если я перестаю всё контролировать.",
  },
];

test("router accepts a decision grounded by an exact user quote", async () => {
  const result = await routeEducationalNavigation(messages, {
    callJson: async () => ({
      state: "RECOMMEND_COURSE",
      primaryCourseId: "normative-situation",
      secondaryCourseIds: [],
      learningNeed: "Понять работу норм и ответственности.",
      evidence: [
        {
          messageIndex: 0,
          quote: "люди не соблюдают правила",
        },
      ],
      confidence: "strong",
    }),
  });

  assert.equal(result.state, "RECOMMEND_COURSE");
});

test("router fails closed when model invents evidence not present in the user message", async () => {
  await assert.rejects(
    routeEducationalNavigation(messages, {
      callJson: async () => ({
        state: "RECOMMEND_COURSE",
        primaryCourseId: "normative-situation",
        secondaryCourseIds: [],
        learningNeed: "Понять сопротивление изменениям.",
        evidence: [
          {
            messageIndex: 0,
            quote: "команда саботирует любые изменения",
          },
        ],
        confidence: "strong",
      }),
    }),
    /not verbatim grounded/u,
  );
});

type PilotFixture = {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  expectedEvaluation: {
    state: "RECOMMEND_COURSE";
    primaryCourseId: string;
    groundingQuote: string;
  };
};

function readPilotFixture(): PilotFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/navigation-router-corr-1-pilot.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as PilotFixture;
}

test("router contract makes ASK_MORE decision-critical, plain-language, and resistant to assistant-seeded theory", async () => {
  const fixture = readPilotFixture();
  let capturedMessages:
    | readonly { role: string; content: string }[]
    | undefined;

  const result = await routeEducationalNavigation(fixture.messages, {
    callJson: async (requestMessages) => {
      capturedMessages = requestMessages;

      return {
        state: fixture.expectedEvaluation.state,
        primaryCourseId: fixture.expectedEvaluation.primaryCourseId,
        secondaryCourseIds: [],
        learningNeed:
          "Понять актуальные потребности и индивидуальную мотивацию людей в команде.",
        evidence: [
          {
            messageIndex: 2,
            quote: fixture.expectedEvaluation.groundingQuote,
          },
        ],
        confidence: "strong",
      };
    },
  });

  assert.equal(result.state, "RECOMMEND_COURSE");
  if (result.state !== "RECOMMEND_COURSE") {
    assert.fail("Expected RECOMMEND_COURSE.");
  }
  assert.equal(
    result.primaryCourseId,
    fixture.expectedEvaluation.primaryCourseId,
  );

  const captured = capturedMessages;
  if (!captured) {
    assert.fail("Expected router request messages to be captured.");
  }

  const systemPrompt = captured[0]?.content ?? "";

  // Exact semantic clauses: avoid a regex that accidentally asserts wording
  // not present in the actual controlling prompt.
  assert.ok(
    systemPrompt.includes("ASK_MORE разрешён только если"),
  );
  assert.ok(
    systemPrompt.includes(
      "конкретный недостающий ответ может изменить primaryCourseId",
    ),
  );
  assert.ok(
    systemPrompt.includes(
      "сообщения Навигатора/assistant — только контекст разговора, но НЕ самостоятельное evidence",
    ),
  );
  assert.ok(
    systemPrompt.includes(
      "формулируй вопросы обычным языком задачи пользователя",
    ),
  );
  assert.ok(
    systemPrompt.includes(
      "НЕ называй и НЕ объясняй внутренние обозначения",
    ),
  );

  const routingRequest = captured[1]?.content ?? "";
  const jsonStart = routingRequest.indexOf("{");
  assert.notEqual(jsonStart, -1);

  const payload = JSON.parse(
    routingRequest.slice(jsonStart),
  ) as {
    courses: Array<Record<string, unknown>>;
    conversation: Array<{ role: string; content: string }>;
  };

  assert.equal(payload.conversation.length, 3);
  assert.equal(payload.conversation[1]?.role, "assistant");

  for (const course of payload.courses) {
    assert.equal("siteOutcomes" in course, false);
  }

  const serializedCourses = JSON.stringify(payload.courses);
  assert.doesNotMatch(
    serializedCourses,
    /Mono\(S\)|S–O|S–S/u,
  );
});

/* ---------------------------------------------------------------------------
 * NAVIGATOR-PRODUCTION-SMOKE-1.C1C2-IMPLEMENTATION-1 — C2 two-course clause.
 * ------------------------------------------------------------------------ */

const T10_TURN1_ASSISTANT =
  "По вашему описанию ключевая учебная задача сейчас — Изучение иерархии потребностей А. Маслоу в новой парадигме\n\nВ текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.\n\nПо программе курса его учебные результаты включают: освоить динамическую модель потребностей вместо статичной пирамиды; освоить позицию рефлексивного наблюдателя; понимать разнонаправленные переходы мотивации под давлением контекста.";
const T10_MESSAGES = [
  { role: "user" as const, content: "Хочу пройти курс Маслоу." },
  { role: "assistant" as const, content: T10_TURN1_ASSISTANT },
  { role: "user" as const, content: "А ещё я рассматриваю курс «Нормативная ситуация»." },
];

test("C2 prompt: two current alternatives → ASK_MORE with both candidates and one task question; the four exclusions stay distinct", async () => {
  let captured: readonly { role: string; content: string }[] = [];
  const result = await routeEducationalNavigation(T10_MESSAGES, {
    callJson: async (requestMessages) => {
      captured = requestMessages;
      return {
        state: "ASK_MORE",
        candidateCourseIds: ["maslow", "normative-situation"],
        questions: ["Какую задачу вы хотите решить с помощью обучения: что именно важно понять или изменить в работе с людьми?"],
        rationale: "Два курса остаются сопоставимо правдоподобными.",
      };
    },
  });

  assert.deepEqual(result, {
    state: "ASK_MORE",
    candidateCourseIds: ["maslow", "normative-situation"],
    questions: ["Какую задачу вы хотите решить с помощью обучения: что именно важно понять или изменить в работе с людьми?"],
    rationale: "Два курса остаются сопоставимо правдоподобными.",
  });

  const systemPrompt = captured[0]?.content ?? "";
  for (const clause of [
    "ДВА КУРСА КАК ТЕКУЩИЕ АЛЬТЕРНАТИВЫ: если собственные USER-сообщения показывают, что пользователь сейчас рассматривает два ROUTABLE курса как варианты",
    "оба остаются сопоставимо правдоподобными по прямым пользовательским сигналам и ответ о его учебной задаче может изменить primaryCourseId",
    "НЕ повторяй молча рекомендацию только ранее выбранного курса",
    "Верни ASK_MORE: candidateCourseIds — ровно эти два курса, questions — один естественный вопрос по-русски о реальной учебной задаче пользователя",
    "без просьбы выбрать между курсами",
    "упоминает другой курс как уже пройденный или как фон",
    "явно заменяет прежний курс другим («нет, лучше курс …») — тогда RECOMMEND_COURSE для нового курса",
    "подтверждает уже выбранный курс",
    "своим ответом на уточняющий вопрос уже снял различие между курсами — тогда RECOMMEND_COURSE без повторного уточнения того же различия",
  ]) {
    assert.ok(systemPrompt.includes(clause), clause);
  }
  // The pre-existing sufficiency, ASK_MORE and evidence rules are retained verbatim.
  for (const clause of [
    "ASK_MORE разрешён только если",
    "конкретный недостающий ответ может изменить primaryCourseId",
    "если один ROUTABLE курс имеет прямую явную поддержку из пользовательских формулировок, а альтернативы заметно слабее, выбирай RECOMMEND_COURSE;",
    "candidateCourseIds максимум 2;",
    "НЕ проси пользователя выбирать между моделями или курсами Академии;",
    "сообщения Навигатора/assistant — только контекст разговора, но НЕ самостоятельное evidence",
    "РАЗРЕШЕНЫ РОВНО ТРИ state:",
  ]) {
    assert.ok(systemPrompt.includes(clause), clause);
  }

  // The request payload still carries the indexed conversation and the unchanged catalog.
  const routingRequest = captured[1]?.content ?? "";
  const payload = JSON.parse(routingRequest.slice(routingRequest.indexOf("{"))) as {
    conversation: Array<{ messageIndex: number; role: string; content: string }>;
    courses: Array<{ id: string }>;
  };
  assert.deepEqual(
    payload.conversation.map(({ messageIndex, role }) => [messageIndex, role]),
    [[0, "user"], [1, "assistant"], [2, "user"]],
  );
  assert.equal(payload.conversation[2]?.content, "А ещё я рассматриваю курс «Нормативная ситуация».");
  assert.ok(payload.courses.some((course) => course.id === "maslow"));
  assert.ok(payload.courses.some((course) => course.id === "normative-situation"));
});

test("C2 validator boundaries are unchanged: the pair is valid, a third candidate or an unroutable candidate is not, and replacement stays grounded", async () => {
  await assert.rejects(
    routeEducationalNavigation(T10_MESSAGES, {
      callJson: async () => ({
        state: "ASK_MORE",
        candidateCourseIds: ["maslow", "normative-situation", "levels-of-consciousness"],
        questions: ["Какую задачу вы хотите решить?"],
        rationale: "x",
      }),
    }),
  );
  await assert.rejects(
    routeEducationalNavigation(T10_MESSAGES, {
      callJson: async () => ({
        state: "ASK_MORE",
        candidateCourseIds: ["maslow", "professional-development-stages"],
        questions: ["Какую задачу вы хотите решить?"],
        rationale: "x",
      }),
    }),
    /unknown or unroutable candidate course/u,
  );

  const replacement = [
    T10_MESSAGES[0],
    T10_MESSAGES[1],
    { role: "user" as const, content: "Нет, передумал: лучше курс «Нормативная ситуация»." },
  ];
  const recommended = await routeEducationalNavigation(replacement, {
    callJson: async () => ({
      state: "RECOMMEND_COURSE",
      primaryCourseId: "normative-situation",
      secondaryCourseIds: [],
      learningNeed: "Пользователь заменил выбранный курс.",
      evidence: [{ messageIndex: 2, quote: "лучше курс «Нормативная ситуация»" }],
      confidence: "sufficient",
    }),
  });
  assert.equal(recommended.state, "RECOMMEND_COURSE");
  // Assistant text is never evidence for a recommendation.
  await assert.rejects(
    routeEducationalNavigation(replacement, {
      callJson: async () => ({
        state: "RECOMMEND_COURSE",
        primaryCourseId: "maslow",
        secondaryCourseIds: [],
        learningNeed: "x",
        evidence: [{ messageIndex: 1, quote: "Иерархия потребностей А. Маслоу" }],
        confidence: "sufficient",
      }),
    }),
  );
});
