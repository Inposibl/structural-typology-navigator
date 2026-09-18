import assert from "node:assert/strict";
import test from "node:test";

import {
  composeCourseFollowUpAnswer,
  composeNavigatorMetaAnswer,
  composeNavigatorOutOfScopeAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

const conversation = [
  {
    role: "user" as const,
    content: "Хочу понять мотивацию команды.",
  },
  {
    role: "assistant" as const,
    content:
      "В текущем каталоге Академии ей соответствует курс «Иерархия потребностей А. Маслоу: новая парадигма» — https://structural-typology.academy/courses/maslow.",
  },
  {
    role: "user" as const,
    content: "Что это за динамическая модель?",
  },
];

const evidence: ResolvedCourseEvidence[] = [
  {
    chunkId: 1,
    documentId: "doc",
    sourceId: "source",
    courseId: "maslow",
    sourceSlug: "maslow-new-paradigm",
    sourceTitle: "Manuscript",
    sourceKind: "manuscript",
    authorityRelation: "FOUNDATIONAL",
    courseSourceMetadata: {},
    sourceMetadata: {},
    documentMetadata: {},
    content: "Мотивация меняется под влиянием контекста.",
    contentSha256: "a".repeat(64),
    headingPath: [],
    locator: { primary: { pdfPageStart: 5 } },
    chunkMetadata: {},
    similarity: 0.9,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  },
];

test("META explains navigator behavior instead of repeating a course recommendation", () => {
  const answer = composeNavigatorMetaAnswer();

  assert.match(answer, /выбора и объяснения учебного маршрута/u);
  assert.match(answer, /не должны появляться.*автоматически/u);
  assert.match(answer, /только когда вы прямо просите основания/u);
});

test("OUT_OF_SCOPE honestly states the boundary and redirects to better general resources", () => {
  const answer = composeNavigatorOutOfScopeAnswer();

  assert.match(answer, /вне функции Навигатора/u);
  assert.match(answer, /Google|Perplexity/u);
  assert.match(answer, /ChatGPT/u);
  assert.doesNotMatch(answer, /Маслоу/u);
});

test("course follow-up may use selected evidence internally without exposing raw citations", async () => {
  let capturedPayload = "";

  const answer = await composeCourseFollowUpAnswer(
    conversation,
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
    {
      courseEvidence: evidence,
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 1,
            quote: "Мотивация меняется под влиянием контекста",
          },
        ],
      },
      callText: async (messages) => {
        capturedPayload = messages[1]?.content ?? "";
        return "Это динамический взгляд на изменение мотивации под влиянием контекста.";
      },
    },
  );

  assert.match(answer, /динамический взгляд/u);
  assert.doesNotMatch(answer, /Manuscript/u);
  assert.doesNotMatch(answer, /PDF стр/u);
  assert.match(
    capturedPayload,
    /Мотивация меняется под влиянием контекста/u,
  );
});

test("explicit source request appends only strictly selected grounded evidence", async () => {
  const answer = await composeCourseFollowUpAnswer(
    [
      ...conversation.slice(0, -1),
      {
        role: "user" as const,
        content: "Покажи источник и страницу.",
      },
    ],
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: true,
    },
    {
      courseEvidence: evidence,
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 1,
            quote: "Мотивация меняется под влиянием контекста",
          },
        ],
      },
      callText: async () =>
        "Да, для этого утверждения есть прямое основание в подключённом материале.",
    },
  );

  assert.match(answer, /Основание в подключённых материалах/u);
  assert.match(
    answer,
    /«Мотивация меняется под влиянием контекста»/u,
  );
  assert.match(answer, /Manuscript \(PDF стр\. 5\)/u);
});
