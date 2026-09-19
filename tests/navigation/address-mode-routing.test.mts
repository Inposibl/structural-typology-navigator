import assert from "node:assert/strict";
import test from "node:test";

import {
  routeEducationalNavigation,
} from "../../src/lib/navigation/router.ts";

test("ASK_MORE routing prompt preserves TY address mode", async () => {
  let systemPrompt = "";

  await routeEducationalNavigation(
    [{ role: "user", content: "Мне нужен курс." }],
    {
      profile: {
        displayName: "Николай",
        addressMode: "TY",
        nameDeclined: false,
        pendingUserRequest: null,
      },
      callJson: async (messages) => {
        systemPrompt = messages[0]?.content ?? "";
        return {
          state: "NO_CURRENT_COURSE_MATCH",
          rationale: "No exact match.",
        };
      },
    },
  );

  assert.match(systemPrompt, /обращение на «ты»/u);
  assert.match(systemPrompt, /не переключайся на «вы»/u);
});
