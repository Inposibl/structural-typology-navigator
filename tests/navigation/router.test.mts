import assert from "node:assert/strict";
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
