import assert from "node:assert/strict";
import test from "node:test";

import {
  composeNavigatorAnswer,
} from "../../src/lib/navigation/answer-composer.ts";

test("recommendation uses stable TY wording from conversation profile", async () => {
  const answer = await composeNavigatorAnswer(
    [{ role: "user", content: "Мне нужен курс про мотивацию." }],
    {
      state: "RECOMMEND_COURSE",
      primaryCourseId: "maslow",
      secondaryCourseIds: [],
      learningNeed: "понять изменение мотивации",
      evidence: [
        {
          messageIndex: 0,
          quote: "Мне нужен курс про мотивацию.",
        },
      ],
      confidence: "sufficient",
    },
    {
      profile: {
        displayName: "Николай",
        addressMode: "TY",
        nameDeclined: false,
        pendingUserRequest: null,
      },
    },
  );

  assert.match(answer, /^По твоему описанию/u);
  assert.doesNotMatch(answer, /По вашему описанию/u);
});
