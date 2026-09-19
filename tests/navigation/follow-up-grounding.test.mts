import assert from "node:assert/strict";
import test from "node:test";

import {
  auditCourseFollowUpAnswer,
  buildFollowUpAuthorityPayload,
  isCatalogAnswerableFollowUp,
} from "../../src/lib/navigation/follow-up-grounding.ts";
import {
  getAcademyCourse,
} from "../../src/lib/academy/course-catalog.ts";

test("scientific-validity question is not treated as a catalog-only answer", () => {
  assert.equal(
    isCatalogAnswerableFollowUp(
      "Пирамида Маслоу научно доказана?",
    ),
    false,
  );
});

test("why this course / what will I get is catalog-answerable", () => {
  assert.equal(
    isCatalogAnswerableFollowUp(
      "Почему этот курс мне подойдёт и что я получу?",
    ),
    true,
  );
});

test("grounding audit receives only explicit authority and honors FAIL", async () => {
  const course = getAcademyCourse("maslow");
  assert.ok(course);

  const authority = buildFollowUpAuthorityPayload(course, [
    {
      quote: "Мотивация меняется под влиянием контекста.",
      source: "Source",
    },
  ]);

  let captured = "";
  const result = await auditCourseFollowUpAnswer(
    "Курс гарантированно снижает психологические риски.",
    "Не обнажит ли обучение болезненные моменты?",
    authority,
    {
      callJson: async (messages) => {
        captured = messages[1]?.content ?? "";
        return {
          status: "FAIL",
          reasonCode: "UNSUPPORTED_CLAIM",
        };
      },
    },
  );

  assert.deepEqual(result, {
    status: "FAIL",
    reasonCode: "UNSUPPORTED_CLAIM",
  });
  assert.match(captured, /candidateAnswer/u);
});
