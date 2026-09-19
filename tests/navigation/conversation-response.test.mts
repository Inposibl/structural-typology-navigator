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
  assert.match(answer, /только по прямому запросу/u);
});

test("OUT_OF_SCOPE honestly states the boundary and redirects to better general resources", () => {
  const answer = composeNavigatorOutOfScopeAnswer();

  assert.match(answer, /вне функции Навигатора/u);
  assert.match(answer, /Google|Perplexity/u);
  assert.match(answer, /ChatGPT/u);
  assert.doesNotMatch(answer, /Маслоу/u);
});

test("course follow-up uses selected evidence without exposing raw citations or assistant-history claims", async () => {
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
        return "В подключённом материале курса мотивация описывается как меняющаяся под влиянием контекста.";
      },
      callJson: async () => ({ status: "PASS" }),
    },
  );

  assert.match(answer, /подключённом материале курса/u);
  assert.doesNotMatch(answer, /Manuscript/u);
  assert.doesNotMatch(answer, /PDF стр/u);
  assert.match(
    capturedPayload,
    /Мотивация меняется под влиянием контекста/u,
  );
  assert.doesNotMatch(
    capturedPayload,
    /В текущем каталоге Академии ей соответствует курс/u,
  );
});

test("explicit source request appends only strictly selected grounded evidence after audit", async () => {
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
        "Для этого утверждения есть прямое основание в подключённом материале курса.",
      callJson: async () => ({ status: "PASS" }),
    },
  );

  assert.match(answer, /Основание в подключённых материалах/u);
  assert.match(
    answer,
    /«Мотивация меняется под влиянием контекста»/u,
  );
  assert.match(answer, /Manuscript \(PDF стр\. 5\)/u);
});

test("unsupported scientific question fails closed without using general model knowledge", async () => {
  let textCalls = 0;

  const answer = await composeCourseFollowUpAnswer(
    [
      ...conversation.slice(0, -1),
      {
        role: "user" as const,
        content: "Пирамида Маслоу научно доказана?",
      },
    ],
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
    {
      evidenceSelection: {
        status: "INSUFFICIENT",
        evidence: [],
      },
      callText: async () => {
        textCalls += 1;
        return "should not run";
      },
    },
  );

  assert.equal(textCalls, 0);
  assert.match(answer, /нет достаточного основания/u);
  assert.match(answer, /https:\/\/t\.me\/AST_rulang/u);
  assert.doesNotMatch(answer, /не подтверждена|эмпирически не/u);
});

test("grounding audit FAIL discards unsafe generated answer", async () => {
  const answer = await composeCourseFollowUpAnswer(
    [
      ...conversation.slice(0, -1),
      {
        role: "user" as const,
        content: "Не обнажит ли обучение болезненные моменты?",
      },
    ],
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
      callText: async () =>
        "Курс снижает психологический риск для команды.",
      callJson: async () => ({
        status: "FAIL",
        reasonCode: "UNSUPPORTED_CLAIM",
      }),
    },
  );

  assert.doesNotMatch(answer, /снижает психологический риск/u);
  assert.match(answer, /нет достаточного основания/u);
});

test("catalog-only why-course follow-up stays useful without inventing methods", async () => {
  const answer = await composeCourseFollowUpAnswer(
    [
      ...conversation.slice(0, -1),
      {
        role: "user" as const,
        content:
          "Почему этот курс мне подойдёт, что я получу и какой инструмент?",
      },
    ],
    {
      state: "COURSE_FOLLOW_UP",
      courseId: "maslow",
      evidenceRequested: false,
    },
    {
      evidenceSelection: {
        status: "INSUFFICIENT",
        evidence: [],
      },
    },
  );

  assert.match(answer, /Подтверждённые публичные учебные результаты/u);
  assert.match(answer, /Конкретные методики, упражнения или формат/u);
  assert.doesNotMatch(answer, /гарантированно/u);
});
