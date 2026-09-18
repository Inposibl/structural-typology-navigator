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
