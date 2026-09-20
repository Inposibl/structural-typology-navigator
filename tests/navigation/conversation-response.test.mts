import assert from "node:assert/strict";
import test from "node:test";

import {
  composeAcademyOverviewAnswer,
  composeCatalogListAnswer,
  composeCourseComparisonAnswer,
  composeCourseFollowUpAnswer,
  composeCurrentMetadataAnswer,
  composeNavigatorMetaAnswer,
  composeNavigatorOutOfScopeAnswer,
  composePaymentAmbiguityAnswer,
  composePaymentCourseChangeConfirmationAnswer,
  composePaymentCourseIdentityRequiredAnswer,
  composePsychologyBoundaryAnswer,
  composeStableNoMatchAnswer,
} from "../../src/lib/navigation/conversation-response.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import type {
  FactualIntent,
} from "../../src/lib/navigation/conversation-act-router.ts";
import { getAcademyCourse } from "../../src/lib/academy/course-catalog.ts";

const IVAN_TY: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const ANNA_VY: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

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

test("A03: every deterministic public answer class follows the selected mode", () => {
  const metadataIntent: Extract<FactualIntent, { kind: "CURRENT_METADATA" }> = {
    kind: "CURRENT_METADATA",
    courseIds: [],
    fields: ["PRICE"],
    scope: "SELECTED",
  };
  const comparisonIntent: Extract<FactualIntent, { kind: "COURSE_COMPARISON" }> = {
    kind: "COURSE_COMPARISON",
    courseIds: ["maslow", "levels-of-consciousness"],
    hasUnknownCourse: false,
  };
  const unknownComparisonIntent: Extract<FactualIntent, { kind: "COURSE_COMPARISON" }> = {
    kind: "COURSE_COMPARISON",
    courseIds: ["maslow"],
    hasUnknownCourse: true,
  };

  const classes: ReadonlyArray<{
    label: string;
    ty: string;
    vy: string;
    tyMarker: RegExp;
    vyMarker: RegExp;
  }> = [
    {
      label: "out of scope",
      ty: composeNavigatorOutOfScopeAnswer(IVAN_TY),
      vy: composeNavigatorOutOfScopeAnswer(ANNA_VY),
      tyMarker: /Так ты получишь/u,
      vyMarker: /Так вы получите/u,
    },
    {
      label: "price clarification",
      ty: composeCurrentMetadataAnswer(metadataIntent, null, IVAN_TY),
      vy: composeCurrentMetadataAnswer(metadataIntent, null, ANNA_VY),
      tyMarker: /Уточни, пожалуйста/u,
      vyMarker: /Уточните, пожалуйста/u,
    },
    {
      label: "unknown comparison course",
      ty: composeCourseComparisonAnswer(unknownComparisonIntent, IVAN_TY),
      vy: composeCourseComparisonAnswer(unknownComparisonIntent, ANNA_VY),
      tyMarker: /Уточни точное название/u,
      vyMarker: /Уточните точное название/u,
    },
    {
      label: "neutral comparison",
      ty: composeCourseComparisonAnswer(comparisonIntent, IVAN_TY),
      vy: composeCourseComparisonAnswer(comparisonIntent, ANNA_VY),
      tyMarker: /лучше именно для тебя/u,
      vyMarker: /лучше именно для вас/u,
    },
    {
      label: "payment ambiguity",
      ty: composePaymentAmbiguityAnswer(IVAN_TY),
      vy: composePaymentAmbiguityAnswer(ANNA_VY),
      tyMarker: /Назови, пожалуйста/u,
      vyMarker: /Назовите, пожалуйста/u,
    },
    {
      label: "payment course identity",
      ty: composePaymentCourseIdentityRequiredAnswer(IVAN_TY),
      vy: composePaymentCourseIdentityRequiredAnswer(ANNA_VY),
      tyMarker: /Назови, пожалуйста/u,
      vyMarker: /Назовите, пожалуйста/u,
    },
    {
      label: "payment course change confirmation",
      ty: composePaymentCourseChangeConfirmationAnswer("Курс А", "Курс Б", IVAN_TY),
      vy: composePaymentCourseChangeConfirmationAnswer("Курс А", "Курс Б", ANNA_VY),
      tyMarker: /Подтверди, пожалуйста/u,
      vyMarker: /Подтвердите, пожалуйста/u,
    },
  ];

  for (const answerClass of classes) {
    assert.match(answerClass.ty, answerClass.tyMarker, answerClass.label);
    assert.doesNotMatch(answerClass.ty, answerClass.vyMarker, answerClass.label);
    assert.match(answerClass.vy, answerClass.vyMarker, answerClass.label);
    assert.doesNotMatch(answerClass.vy, answerClass.tyMarker, answerClass.label);
  }
});

test("A03: answers with no direct address stay mode-neutral instead of being rewritten", () => {
  assert.equal(composeNavigatorMetaAnswer(), composeNavigatorMetaAnswer());
  assert.equal(composeStableNoMatchAnswer(), composeStableNoMatchAnswer());

  // These classes address nobody, so the mode must not change a single byte.
  const neutral = [
    composeNavigatorMetaAnswer(),
    composeStableNoMatchAnswer(),
    composeAcademyOverviewAnswer(),
    composeCatalogListAnswer(),
    composePsychologyBoundaryAnswer(),
    composeCourseComparisonAnswer({
      kind: "COURSE_COMPARISON",
      courseIds: ["maslow", "levels-of-consciousness"],
      hasUnknownCourse: false,
    }),
    composeCurrentMetadataAnswer(
      {
        kind: "CURRENT_METADATA",
        courseIds: ["maslow"],
        fields: ["PRICE", "SCHEDULE"],
        scope: "SELECTED",
      },
      "maslow",
    ),
  ];

  for (const answer of neutral) {
    assert.doesNotMatch(answer, /(?<![а-яё])(?:ты|тебя|тебе|твой|твоя|твои)(?![а-яё])/iu);
  }
});

test("A31: a listed-unroutable course is explained in public language, not in the catalog's internal note", () => {
  const courseId = "professional-development-stages";
  const catalogCourse = getAcademyCourse(courseId);
  assert.notEqual(catalogCourse, undefined);
  if (!catalogCourse) return;

  // The catalog authority is untouched: the internal note is still there, with
  // its internal-routing wording, and Package C still owns that fact.
  assert.match(catalogCourse.routingBlockReason ?? "", /маршрутизац/iu);

  const publicSurfaces = [
    composeCatalogListAnswer(),
    composeCourseComparisonAnswer(
      { kind: "COURSE_COMPARISON", courseIds: ["maslow", courseId], hasUnknownCourse: false },
      IVAN_TY,
    ),
  ];

  for (const output of publicSurfaces) {
    assert.doesNotMatch(output, /маршрутизац|(?<![A-Za-z])routing(?![A-Za-z])|(?<![A-Za-z])route(?![A-Za-z])/iu);
    // The substantive limitation is preserved, not softened or removed.
    assert.match(output, /только указан в каталоге/u);
    assert.match(output, /достаточным описанием/u);
    assert.match(output, new RegExp(catalogCourse.title, "u"));
  }
});

test("A31: dated commercial meaning is preserved without the internal authority id", () => {
  const answer = composeCurrentMetadataAnswer(
    {
      kind: "CURRENT_METADATA",
      courseIds: ["maslow"],
      fields: ["PRICE", "SCHEDULE"],
      scope: "SELECTED",
    },
    "maslow",
    ANNA_VY,
  );

  assert.doesNotMatch(answer, /OWNER-COMMERCIAL-AUTHORITY/u);
  assert.match(answer, /подтверждёнными данными Академии по состоянию на 19 сентября 2026 года/u);
  assert.match(answer, /последняя подтверждённая цена по данным на 19 сентября 2026 года/u);
  assert.match(answer, /60[\s\u00a0]000 ₽/u);
  assert.match(answer, /расписание: авторитетного значения нет/u);
  // The dated ceiling is stated as a fact, never as a live or timeless value.
  assert.doesNotMatch(answer, /сейчас курс стоит|актуальная цена/iu);
});
