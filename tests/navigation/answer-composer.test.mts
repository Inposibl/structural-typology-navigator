import assert from "node:assert/strict";
import test from "node:test";

import { composeNavigatorAnswer } from "../../src/lib/navigation/answer-composer.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

const messages = [
  {
    role: "user" as const,
    content: "Хочу понять мотивацию команды.",
  },
];

const courseEvidence: ResolvedCourseEvidence[] = [
  {
    chunkId: 10,
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
    content:
      "Мотивация человека меняется под влиянием контекста и доступных ресурсов.",
    contentSha256: "a".repeat(64),
    headingPath: [],
    locator: { primary: { pageStart: 12 } },
    chunkMetadata: {},
    similarity: 0.94,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  },
];

test("initial recommendation keeps selected RAG evidence private by default", async () => {
  const answer = await composeNavigatorAnswer(
    messages,
    {
      state: "RECOMMEND_COURSE",
      primaryCourseId: "maslow",
      secondaryCourseIds: [],
      learningNeed: "понять изменение мотивации команды",
      evidence: [
        {
          messageIndex: 0,
          quote: "понять мотивацию команды",
        },
      ],
      confidence: "strong",
    },
    {
      courseEvidence,
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote: "Мотивация человека меняется под влиянием контекста",
          },
        ],
      },
      hasActiveCourseSources: true,
    },
  );

  assert.match(
    answer,
    /Иерархия потребностей А\. Маслоу: новая парадигма/u,
  );
  assert.match(
    answer,
    /https:\/\/structural-typology\.academy\/courses\/maslow/u,
  );
  assert.doesNotMatch(
    answer,
    /Мотивация человека меняется под влиянием контекста/u,
  );
  assert.doesNotMatch(answer, /Manuscript/u);
  assert.doesNotMatch(answer, /Нормативная ситуация/u);
});

test("raw RAG evidence requires an explicit composer opt-in", async () => {
  const answer = await composeNavigatorAnswer(
    messages,
    {
      state: "RECOMMEND_COURSE",
      primaryCourseId: "maslow",
      secondaryCourseIds: [],
      learningNeed: "понять изменение мотивации команды",
      evidence: [
        {
          messageIndex: 0,
          quote: "понять мотивацию команды",
        },
      ],
      confidence: "strong",
    },
    {
      courseEvidence,
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote: "Мотивация человека меняется под влиянием контекста",
          },
        ],
      },
      hasActiveCourseSources: true,
      showEvidence: true,
    },
  );

  assert.match(
    answer,
    /Мотивация человека меняется под влиянием контекста/u,
  );
  assert.match(answer, /Manuscript \(стр\. 12\)/u);
});

test("ASK_MORE exposes only approved questions and no internal candidate courses", async () => {
  const answer = await composeNavigatorAnswer(messages, {
    state: "ASK_MORE",
    candidateCourseIds: ["maslow", "normative-situation"],
    questions: [
      "Проблема больше в мотивации людей или в том, что правила не работают без вашего контроля?",
    ],
    rationale: "Need discrimination.",
  });

  assert.match(answer, /Проблема больше в мотивации/u);
  assert.doesNotMatch(answer, /Маслоу/u);
  assert.doesNotMatch(answer, /Нормативная ситуация/u);
});

test("NO_CURRENT_COURSE_MATCH cannot invent an external or fictional course", async () => {
  const answer = await composeNavigatorAnswer(messages, {
    state: "NO_CURRENT_COURSE_MATCH",
    rationale: "Outside catalog.",
  });

  assert.match(answer, /не вижу в текущем каталоге Академии курса/u);
  assert.doesNotMatch(answer, /рекомендую/u);
});


test("Maslow public recommendation never renders internal mode labels from canonical outcomes", async () => {
  const answer = await composeNavigatorAnswer(
    messages,
    {
      state: "RECOMMEND_COURSE",
      primaryCourseId: "maslow",
      secondaryCourseIds: [],
      learningNeed:
        "понять потребности и индивидуальную мотивацию сотрудников",
      evidence: [
        {
          messageIndex: 0,
          quote: "понять мотивацию команды",
        },
      ],
      confidence: "strong",
    },
    {
      evidenceSelection: {
        status: "INSUFFICIENT",
        evidence: [],
      },
      courseEvidence,
      hasActiveCourseSources: true,
    },
  );

  assert.match(
    answer,
    /освоить динамическую модель потребностей вместо статичной пирамиды/u,
  );
  assert.match(
    answer,
    /понимать разнонаправленные переходы мотивации под давлением контекста/u,
  );
  assert.doesNotMatch(
    answer,
    /Mono\(S\)|Meta\(S\)|S[–-]O[–-]S|S[–-]O|S[–-]S/u,
  );
});

test("supported RAG evidence does not re-enable canonical internal outcome labels", async () => {
  const answer = await composeNavigatorAnswer(
    messages,
    {
      state: "RECOMMEND_COURSE",
      primaryCourseId: "maslow",
      secondaryCourseIds: [],
      learningNeed:
        "понять изменение мотивации команды",
      evidence: [
        {
          messageIndex: 0,
          quote: "понять мотивацию команды",
        },
      ],
      confidence: "strong",
    },
    {
      courseEvidence,
      evidenceSelection: {
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote:
              "Мотивация человека меняется под влиянием контекста",
          },
        ],
      },
      hasActiveCourseSources: true,
      showEvidence: true,
    },
  );

  assert.match(
    answer,
    /Мотивация человека меняется под влиянием контекста/u,
  );
  assert.doesNotMatch(
    answer,
    /Mono\(S\)|Meta\(S\)|S[–-]O[–-]S|S[–-]O|S[–-]S/u,
  );
});
