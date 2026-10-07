import assert from "node:assert/strict";
import test from "node:test";

import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";

test("explicit course enrollment bypasses RAG and returns exact payment deep link", async () => {
  let retrievalCalls = 0;
  let routeCalls = 0;

  const result = await orchestrateNavigatorResponse(
    [
      {
        role: "assistant",
        content:
          "Курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
      },
      {
        role: "user",
        content: "Хочу на этот курс",
      },
    ],
    {
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_FOLLOW_UP",
          courseId: "maslow",
          evidenceRequested: false,
        }),
        route: async () => {
          routeCalls += 1;
          throw new Error("course router must be bypassed");
        },
        retrieve: async () => {
          retrievalCalls += 1;
          throw new Error("RAG must be bypassed for checkout");
        },
      },
    },
  );

  assert.equal(routeCalls, 0);
  assert.equal(retrievalCalls, 0);
  assert.equal(result.decision, null);
  assert.match(
    result.message,
    /https:\/\/t\.me\/AST_payment_course_bot\?start=maslow/u,
  );
  assert.doesNotMatch(result.message, /подключённых материалах/u);
});

test("unconsumed narrative payment framing follows deterministic local routing", async () => {
  let routeCalls = 0;

  const result = await orchestrateNavigatorResponse(
    [
      {
        role: "user",
        content:
          "Мне подходит курс по уровням сознания, хочу оплатить",
      },
    ],
    {
      dependencies: {
        classifyAct: async () => ({ state: "NAVIGATE" }),
        route: async () => {
          routeCalls += 1;
          return { state: "NO_CURRENT_COURSE_MATCH", rationale: "Локальная тестовая маршрутизация." };
        },
        compose: async () => "Локальный ответ без оплаты.",
      },
    },
  );

  assert.equal(routeCalls, 1);
  assert.equal(result.decision?.state, "NO_CURRENT_COURSE_MATCH");
  assert.doesNotMatch(result.message, /AST_payment_course_bot/u);
});
