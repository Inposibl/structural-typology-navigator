import assert from "node:assert/strict";
import test from "node:test";

import {
  composeAcademyOverviewAnswer,
  composeCatalogListAnswer,
  composeCourseComparisonAnswer,
  composeCourseFollowUpAnswer,
  composeCurrentMetadataAnswer,
  composeFactualAnswer,
  composeNavigatorMetaAnswer,
  composeNavigatorOutOfScopeAnswer,
  composePaymentAmbiguityAnswer,
  composePaymentCourseChangeConfirmationAnswer,
  composePaymentCourseIdentityRequiredAnswer,
  composePsychologyBoundaryAnswer,
  composeStableNoMatchAnswer,
  proveCourseOperandIdentity,
  proveSameCourseEquivalence,
} from "../../src/lib/navigation/conversation-response.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type { ConversationProfile } from "../../src/lib/chat-contract.ts";
import type {
  FactualIntent,
} from "../../src/lib/navigation/conversation-act-router.ts";
import {
  getAcademyCourse,
  type AcademyCourse,
} from "../../src/lib/academy/course-catalog.ts";
import { resolveCourseReferences } from "../../src/lib/academy/course-reference.ts";
import {
  orchestrateNavigatorResponse,
  type OrchestrationDependencies,
} from "../../src/lib/navigation/orchestrate-navigation.ts";
import { routeConversationAct } from "../../src/lib/navigation/conversation-act-router.ts";
import { handleChatRequest } from "../../src/app/api/chat/route.ts";
import {
  createInitialConversationState,
  withCourseBinding,
  type ConversationState,
} from "../../src/lib/navigation/conversation-state.ts";

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

/* ---------------------------------------------------------------------------
 * NAVIGATOR-COURSE-IDENTITY-COMPARISON-CORR-1 — same-course equivalence.
 *
 * A FACTUAL COURSE_COMPARISON with one known course and hasUnknownCourse=true
 * is confirmed as one course only when each operand of the bounded
 * «<A> и <B> — это же одно и то же» construction is proved on its own. The
 * whole-message resolver returning [C] is never sufficient (M2): every
 * negative control below asserts that singleton is present and still refused.
 * ------------------------------------------------------------------------ */

const LOC_ID = "levels-of-consciousness" as const;
const LOC_COURSE = getAcademyCourse(LOC_ID) as AcademyCourse;
const EQUIVALENCE_EM_DASH =
  "Иерархия уровней сознания и уровни сознания — это же одно и то же";
const EQUIVALENCE_HYPHEN =
  "Иерархия уровней сознания и уровни сознания - это же одно и то же";
const NOT_FOUND_TY =
  "Не могу выполнить сравнение: один из названных курсов не найден в текущем каталоге Академии. Уточни точное название.";
const NOT_FOUND_VY =
  "Не могу выполнить сравнение: один из названных курсов не найден в текущем каталоге Академии. Уточните точное название.";
const SAME_COURSE_ANSWER =
  "Да, «Иерархия уровней сознания» и «уровни сознания» обозначают один и тот же курс Академии: «Иерархия уровней сознания».";

const LOC_UNKNOWN: Extract<FactualIntent, { kind: "COURSE_COMPARISON" }> = {
  kind: "COURSE_COMPARISON",
  courseIds: [LOC_ID],
  hasUnknownCourse: true,
};
const LOC_UNKNOWN_PROPOSAL = {
  state: "FACTUAL",
  intents: [{ kind: "COURSE_COMPARISON", courseIds: [LOC_ID], hasUnknownCourse: true }],
};

const PAYMENT_MARKERS = /AST_payment_course_bot|t\.me\/|\?start=|оплат/iu;

test("CORR-1 positive: full title and governed short name are proved separately as one course", () => {
  for (const message of [EQUIVALENCE_EM_DASH, EQUIVALENCE_HYPHEN]) {
    const proof = proveSameCourseEquivalence(LOC_UNKNOWN, message);
    assert.deepEqual(proof, {
      courseId: LOC_ID,
      operands: [
        { text: "Иерархия уровней сознания", authority: "CATALOG_TITLE" },
        { text: "уровни сознания", authority: "GOVERNED_ALIAS_SPAN" },
      ],
    });

    for (const profile of [IVAN_TY, ANNA_VY, undefined]) {
      const answer = composeCourseComparisonAnswer(LOC_UNKNOWN, profile, message);
      assert.equal(answer, SAME_COURSE_ANSWER);
      assert.doesNotMatch(answer, /не найден/u);
      assert.doesNotMatch(answer, PAYMENT_MARKERS);
      assert.equal(
        composeFactualAnswer([LOC_UNKNOWN], null, profile, message),
        SAME_COURSE_ANSWER,
      );
    }
  }
  // The confirmed title is the catalog's own title.
  assert.match(SAME_COURSE_ANSWER, new RegExp(`«${LOC_COURSE.title}»\\.$`, "u"));
});

test("CORR-1 operand authority: each complete operand is checked on its own", () => {
  assert.equal(proveCourseOperandIdentity("Иерархия уровней сознания", LOC_COURSE), "CATALOG_TITLE");
  assert.equal(proveCourseOperandIdentity("иерархия  уровней сознания", LOC_COURSE), "CATALOG_TITLE");
  assert.equal(proveCourseOperandIdentity("уровни сознания", LOC_COURSE), "GOVERNED_ALIAS_SPAN");

  const notProved: readonly string[] = [
    // Foreign program and foreign provenance: residue, quotes, no identity.
    "курс «Алхимия бессмертия» на Udemy",
    "Алхимия бессмертия",
    // Known name embedded in a longer, unsupported program name.
    "Иерархия уровней сознания для руководителей",
    "Продвинутые уровни сознания",
    "уровни сознания курс",
    // Glued foreign prefix and an over-long ending after the governed stem.
    "Суперуровни сознания",
    "уровни сознаниеведения",
    // Inflected title is neither the exact title nor a residue-free alias.
    "Иерархии уровней сознания",
    // A different catalog course.
    "Иерархия Маслоу",
    "",
  ];
  for (const operand of notProved) {
    assert.equal(proveCourseOperandIdentity(operand, LOC_COURSE), null, operand);
  }
  // Each embedded/residue operand would still be found by the whole-text
  // resolver; that is exactly why resolver output alone is not the proof.
  for (const operand of [
    "Иерархия уровней сознания для руководителей",
    "Продвинутые уровни сознания",
    "уровни сознания курс",
    "Суперуровни сознания",
    "уровни сознаниеведения",
  ]) {
    assert.deepEqual(resolveCourseReferences(operand).courseIds, [LOC_ID], operand);
  }
});

test("CORR-1 negative controls: a whole-message singleton never promotes identity", () => {
  const singletonButRefused: readonly string[] = [
    // N-COMP-1 known plus foreign unknown course
    "Иерархия уровней сознания и курс «Алхимия бессмертия» на Udemy — это же одно и то же",
    // N-COMP-2 known plus foreign unknown comparison
    "Сравните Иерархия уровней сознания и курс «Алхимия бессмертия» на Udemy",
    // N-COMP-5 known name as a substring of a longer foreign name
    "Иерархия уровней сознания для руководителей и уровни сознания — это же одно и то же",
    "Продвинутые уровни сознания и Иерархия уровней сознания — это же одно и то же",
    "Суперуровни сознания и уровни сознания — это же одно и то же",
    "уровни сознаниеведения и уровни сознания — это же одно и то же",
    // N-COMP-6 one operand unresolved under catalog identity
    "Иерархия уровней сознания и Алхимия бессмертия — это же одно и то же",
    "Иерархия уровней сознания и он — это же одно и то же",
    // N-COMP-7 extra, quoted or ambiguous operands; unsupported constructions
    "Иерархия уровней сознания, уровни сознания и Алхимия бессмертия — это же одно и то же",
    "Иерархия уровней сознания и уровни сознания и курс Udemy — это же одно и то же",
    "«Иерархия уровней сознания» и «уровни сознания» и «Алхимия бессмертия» — это же одно и то же",
    "Иерархия уровней сознания и уровни сознания — это же одно и то же, а «Алхимия бессмертия» нет",
    "Иерархия уровней сознания и уровни сознания — одно и то же",
    "Иерархия уровней сознания и уровни сознания это же одно и то же",
    "Иерархия уровней сознания и уровни сознания — это же одно и то же?",
    "Иерархия уровней сознания и\nуровни сознания — это же одно и то же",
  ];
  for (const message of singletonButRefused) {
    assert.deepEqual(resolveCourseReferences(message).courseIds, [LOC_ID], message);
    assert.equal(proveSameCourseEquivalence(LOC_UNKNOWN, message), null, message);
    assert.equal(composeCourseComparisonAnswer(LOC_UNKNOWN, IVAN_TY, message), NOT_FOUND_TY, message);
    assert.equal(composeCourseComparisonAnswer(LOC_UNKNOWN, ANNA_VY, message), NOT_FOUND_VY, message);
  }

  // N-COMP-4 unknown-only: no catalog identity is invented, whatever ID shape
  // the proposal carries.
  const unknownOnly = "курс «Алхимия бессмертия» на Udemy";
  for (const intent of [
    LOC_UNKNOWN,
    { kind: "COURSE_COMPARISON", courseIds: [], hasUnknownCourse: true } as const,
  ]) {
    const proposal = { ...intent, courseIds: [...intent.courseIds] };
    assert.equal(proveSameCourseEquivalence(proposal, unknownOnly), null);
    assert.equal(composeCourseComparisonAnswer(proposal, IVAN_TY, unknownOnly), NOT_FOUND_TY);
  }

  // Conflicting identity: the proposed course must be the one both operands
  // name, and a different course operand is never absorbed.
  const conflicting = "Иерархия Маслоу и Иерархия уровней сознания — это же одно и то же";
  for (const courseId of [LOC_ID, "maslow"] as const) {
    const intent = { kind: "COURSE_COMPARISON" as const, courseIds: [courseId], hasUnknownCourse: true };
    assert.equal(proveSameCourseEquivalence(intent, conflicting), null, courseId);
    assert.equal(composeCourseComparisonAnswer(intent, IVAN_TY, conflicting), NOT_FOUND_TY);
  }
  const wrongCourse = { kind: "COURSE_COMPARISON" as const, courseIds: ["maslow" as const], hasUnknownCourse: true };
  assert.equal(proveSameCourseEquivalence(wrongCourse, EQUIVALENCE_EM_DASH), null);
  assert.equal(composeCourseComparisonAnswer(wrongCourse, IVAN_TY, EQUIVALENCE_EM_DASH), NOT_FOUND_TY);

  // Without the latest user message the existing answer is unchanged.
  assert.equal(composeCourseComparisonAnswer(LOC_UNKNOWN, IVAN_TY), NOT_FOUND_TY);
  assert.equal(composeFactualAnswer([LOC_UNKNOWN], null, ANNA_VY), NOT_FOUND_VY);
});

test("CORR-1 N-COMP-3: a two-known-course comparison is byte-identical with or without the message", () => {
  const message = "Иерархия Маслоу и Иерархия уровней сознания — сравни";
  const pair: Extract<FactualIntent, { kind: "COURSE_COMPARISON" }> = {
    kind: "COURSE_COMPARISON",
    courseIds: ["maslow", LOC_ID],
    hasUnknownCourse: false,
  };
  assert.equal(proveSameCourseEquivalence(pair, message), null);
  for (const profile of [IVAN_TY, ANNA_VY]) {
    const before = composeCourseComparisonAnswer(pair, profile);
    assert.equal(composeCourseComparisonAnswer(pair, profile, message), before);
    assert.equal(composeCourseComparisonAnswer(pair, profile, EQUIVALENCE_EM_DASH), before);
    assert.match(before, /^Нейтральное сравнение по данным каталога/u);
    assert.match(before, /«Иерархия потребностей А\. Маслоу: новая парадигма»/u);
    assert.match(before, /«Иерархия уровней сознания»/u);
  }
});

type ForbiddenStage =
  | "route"
  | "retrieve"
  | "resolve"
  | "selectEvidence"
  | "compose"
  | "composeFollowUp"
  | "fetch";

function forbiddenStages(
  calls: ForbiddenStage[],
): Omit<OrchestrationDependencies, "classifyAct"> {
  const forbid = (stage: ForbiddenStage) => () => {
    calls.push(stage);
    throw new Error(`${stage} must not run in the FACTUAL identity lane`);
  };
  return {
    route: forbid("route") as never,
    retrieve: forbid("retrieve") as never,
    resolve: forbid("resolve") as never,
    selectEvidence: forbid("selectEvidence") as never,
    compose: forbid("compose") as never,
    composeFollowUp: forbid("composeFollowUp") as never,
  };
}

async function withFetchGuard<T>(
  calls: ForbiddenStage[],
  run: (guard: typeof globalThis.fetch) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const guard = (async () => {
    calls.push("fetch");
    throw new Error("network must not be used");
  }) as typeof globalThis.fetch;
  globalThis.fetch = guard;
  try {
    return await run(guard);
  } finally {
    globalThis.fetch = original;
  }
}

async function orchestrateLocProposal(message: string, calls: ForbiddenStage[]) {
  return withFetchGuard(calls, (guard) =>
    orchestrateNavigatorResponse([{ role: "user", content: message }], {
      fetch: guard,
      profile: IVAN_TY,
      dependencies: {
        // The captured proposal shape passes through the REAL act validator.
        classifyAct: (messages) =>
          routeConversationAct(messages, { callJson: async () => LOC_UNKNOWN_PROPOSAL }),
        ...forbiddenStages(calls),
      },
    }),
  );
}

test("CORR-1 orchestration: the validated proposal yields the identity answer with no RAG, binding or payment", async () => {
  for (const message of [EQUIVALENCE_EM_DASH, EQUIVALENCE_HYPHEN]) {
    const calls: ForbiddenStage[] = [];
    const result = await orchestrateLocProposal(message, calls);
    assert.deepEqual(calls, []);
    assert.equal(result.message, SAME_COURSE_ANSWER);
    assert.doesNotMatch(result.message, /не найден/u);
    assert.doesNotMatch(result.message, PAYMENT_MARKERS);
    assert.deepEqual(result.conversationAct, LOC_UNKNOWN_PROPOSAL);
    assert.equal(result.decision, null);
    assert.equal(result.contactCard, null);
    assert.equal(result.evidenceSelectionStatus, "NOT_RUN");
    const observability = result.observability;
    assert.ok(observability);
    assert.equal(observability.answerOrigin, "CATALOG_AUTHORITY");
    assert.equal(observability.ragInvoked, false);
    assert.equal(observability.authorityResolved, false);
    assert.equal(observability.courseId, null);
    assert.equal(result.stateEffects.courseBinding, undefined);
    assert.equal(result.stateEffects.pendingConfirmation, null);
    assert.equal(result.stateEffects.transactionalAuthorityVersion, null);
  }

  // N-COMP-1 through the same path keeps the authorized unknown-name answer,
  // and every non-message effect equals the corrected identity turn's.
  const controlCalls: ForbiddenStage[] = [];
  const control = await orchestrateLocProposal(
    "Иерархия уровней сознания и курс «Алхимия бессмертия» на Udemy — это же одно и то же",
    controlCalls,
  );
  const identity = await orchestrateLocProposal(EQUIVALENCE_EM_DASH, controlCalls);
  assert.deepEqual(controlCalls, []);
  assert.equal(control.message, NOT_FOUND_TY);
  assert.deepEqual({ ...identity, message: null }, { ...control, message: null });
});

async function chatTurn(
  message: string,
  conversationState: unknown,
  requestId: string,
): Promise<{ status: number; message: string; state: ConversationState; calls: ForbiddenStage[] }> {
  const calls: ForbiddenStage[] = [];
  const orchestrate: typeof orchestrateNavigatorResponse = (messages, options) =>
    orchestrateNavigatorResponse(messages, {
      ...options,
      dependencies: {
        classifyAct: (effective) =>
          routeConversationAct(effective, { callJson: async () => LOC_UNKNOWN_PROPOSAL }),
        ...forbiddenStages(calls),
      },
    });
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: message }],
    profile: ANNA_VY,
    requestId,
  };
  if (conversationState !== null) body.conversationState = conversationState;
  const info = console.info;
  console.info = () => undefined;
  try {
    const response = await withFetchGuard(calls, () =>
      handleChatRequest(
        new Request("http://localhost/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { orchestrate },
      ),
    );
    const json = (await response.json()) as { message: string; conversationState: ConversationState };
    return { status: response.status, message: json.message, state: json.conversationState, calls };
  } finally {
    console.info = info;
  }
}

test("CORR-1 N-COMP-8: API turn creates no MATCHED binding, referents, selection or payment destination", async () => {
  const fresh = null;
  const matchedMaslow = JSON.parse(
    JSON.stringify(
      withCourseBinding(createInitialConversationState(Date.now()), "MATCHED", "maslow"),
    ),
  ) as unknown;
  const foreign =
    "Иерархия уровней сознания и курс «Алхимия бессмертия» на Udemy — это же одно и то же";

  for (const [label, prior] of [["fresh", fresh], ["matched-maslow", matchedMaslow]] as const) {
    const corrected = await chatTurn(EQUIVALENCE_EM_DASH, prior, `corr1-${label}-identity`);
    const control = await chatTurn(foreign, prior, `corr1-${label}-control`);

    assert.equal(corrected.status, 200, label);
    assert.equal(control.status, 200, label);
    assert.deepEqual(corrected.calls, [], label);
    assert.deepEqual(control.calls, [], label);
    assert.equal(corrected.message, SAME_COURSE_ANSWER, label);
    assert.equal(control.message, NOT_FOUND_VY, label);
    for (const turn of [corrected, control]) {
      assert.doesNotMatch(turn.message, PAYMENT_MARKERS, label);
      assert.notEqual(turn.state.selectedCourseId, LOC_ID, label);
      assert.deepEqual(turn.state.courseReferents, [], label);
      assert.equal(turn.state.pendingConfirmation, null, label);
      assert.equal(turn.state.lastAssistant?.act, "FACTUAL", label);
    }
    if (prior === null) {
      assert.notEqual(corrected.state.courseMatch, "MATCHED", label);
      assert.equal(corrected.state.selectedCourseId, null, label);
    }
    // Every course/payment state field equals the unchanged unknown-name turn.
    for (const field of [
      "courseMatch",
      "selectedCourseId",
      "courseReferents",
      "staleReference",
      "pendingConfirmation",
      "clarification",
      "activeFlow",
      "suspendedFlow",
      "catalogAuthorityVersion",
      "transactionalAuthorityVersion",
      "handoff",
    ] as const) {
      assert.deepEqual(corrected.state[field], control.state[field], `${label}:${field}`);
    }
  }
});
