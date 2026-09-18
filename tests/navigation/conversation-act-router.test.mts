import assert from "node:assert/strict";
import test from "node:test";

import {
  routeConversationAct,
  validateConversationActDecision,
} from "../../src/lib/navigation/conversation-act-router.ts";

const history = [
  {
    role: "user" as const,
    content: "Хочу понять мотивацию команды.",
  },
  {
    role: "assistant" as const,
    content:
      "В текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
  },
];

test("conversation-act classifier gives the latest user turn decisive priority", async () => {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: "Какая самая известная дизайн студия в Москве?",
    },
  ];

  let captured:
    | readonly { role: string; content: string }[]
    | undefined;

  const result = await routeConversationAct(messages, {
    callJson: async (requestMessages) => {
      captured = requestMessages;
      return { state: "OUT_OF_SCOPE" };
    },
  });

  assert.deepEqual(result, { state: "OUT_OF_SCOPE" });
  assert.ok(captured);

  const systemPrompt = captured[0]?.content ?? "";
  assert.ok(
    systemPrompt.includes(
      "последняя USER-реплика имеет решающий приоритет",
    ),
  );
  assert.ok(
    systemPrompt.includes(
      "НЕ имеет права перетянуть новую несвязанную реплику обратно в прежний курс",
    ),
  );

  const request = captured[1]?.content ?? "";
  assert.match(request, /Какая самая известная дизайн студия в Москве/u);
  assert.match(
    request,
    /Иерархия потребностей А\. Маслоу: новая парадигма/u,
  );
});

test("course follow-up must bind to a course that actually appeared in the conversation", () => {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: "Почему именно этот курс?",
    },
  ];

  assert.deepEqual(
    validateConversationActDecision(
      {
        state: "COURSE_FOLLOW_UP",
        courseId: "maslow",
        evidenceRequested: false,
      },
      messages,
    ),
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
  );

  assert.throws(
    () =>
      validateConversationActDecision(
        {
          state: "COURSE_FOLLOW_UP",
          courseId: "normative-situation",
          evidenceRequested: false,
        },
        messages,
      ),
    /absent from the conversation/u,
  );
});

test("raw evidence is opt-in only for explicit source requests", async () => {
  const messages = [
    ...history,
    {
      role: "user" as const,
      content: "Покажи, откуда именно это взято и на какой странице.",
    },
  ];

  const result = await routeConversationAct(messages, {
    callJson: async () => ({
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: true,
    }),
  });

  assert.deepEqual(result, {
    state: "COURSE_FOLLOW_UP",
    courseId: "maslow",
    evidenceRequested: true,
  });
});
