import assert from "node:assert/strict";
import test from "node:test";

import {
  orchestrateNavigatorResponse,
} from "../../src/lib/navigation/orchestrate-navigation.ts";

test("course contact follow-up bypasses RAG and returns exact manager contact card", async () => {
  let retrievalCalls = 0;

  const result = await orchestrateNavigatorResponse(
    [
      {
        role: "assistant",
        content:
          "Курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
      },
      {
        role: "user",
        content: "С кем я могу обсудить этот курс вживую?",
      },
    ],
    {
      profile: {
        displayName: "Николай",
        addressMode: "VY",
        nameDeclined: false,
        pendingUserRequest: null,
      },
      dependencies: {
        classifyAct: async () => ({
          state: "COURSE_FOLLOW_UP",
          courseId: "maslow",
          evidenceRequested: false,
        }),
        retrieve: async () => {
          retrievalCalls += 1;
          throw new Error("RAG must be bypassed for deterministic contact");
        },
      },
    },
  );

  assert.equal(retrievalCalls, 0);
  assert.equal(result.contactCard?.name, "Алексей Лебедев");
  assert.equal(
    result.contactCard?.telegram.href,
    "https://t.me/LebedevOo",
  );
  assert.equal(
    result.contactCard?.phone.href,
    "tel:+79992600201",
  );
  assert.match(result.message, /09:00–19:00 МСК/u);
});
