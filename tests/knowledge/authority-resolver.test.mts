
import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCourseEvidence,
} from "../../src/lib/knowledge/retrieval/authority-resolver.ts";
import type {
  CourseKnowledgeMatch,
} from "../../src/lib/knowledge/retrieval/retrieve-course-knowledge.ts";

function match(
  overrides: Partial<CourseKnowledgeMatch> = {},
): CourseKnowledgeMatch {
  return {
    chunkId: 1,
    documentId: "doc",
    sourceId: "source",
    courseId: "maslow",
    sourceSlug: "maslow-qa-2025-04-20",
    sourceTitle: "Q&A",
    sourceKind: "other",
    authorityRelation: "PROPOSITION_SCOPED_CORRECTION",
    courseSourceMetadata: {},
    sourceMetadata: {},
    documentMetadata: {
      controllingAuthorityEntries: [
        {
          id: "QA-Q11-CORR-SUBLIMATION-REALITY",
          questionNumber: 11,
          type: "EXPLICIT_CORRECTION",
          propositionScope: "sublimation_reality",
        },
      ],
    },
    content: "Моя ошибка была во фразе...",
    contentSha256: "a".repeat(64),
    headingPath: ["Вопрос 11"],
    locator: {
      primary: {
        questionNumber: 11,
        pdfPageStart: 29,
      },
    },
    chunkMetadata: {
      sourceBlocks: [
        {
          metadata: {
            questionNumber: 11,
          },
        },
      ],
    },
    similarity: 0.91,
    ...overrides,
  };
}

test("Q11 becomes controlling only when the retrieved chunk carries question 11", () => {
  const resolved = resolveCourseEvidence([match()]);
  assert.equal(resolved[0].evidenceRole, "CONTROLLING_SCOPED_CORRECTION");
  assert.equal(resolved[0].controllingAuthorityEntries.length, 1);
  assert.equal(
    (resolved[0].locator.primary as Record<string, unknown>).questionNumber,
    11,
  );
  assert.equal(
    (resolved[0].locator.primary as Record<string, unknown>).pdfPageStart,
    29,
  );
});

test("an ordinary Q&A chunk is elaboration, not a global override", () => {
  const resolved = resolveCourseEvidence([
    match({
      content: "Обычное пояснение.",
      contentSha256: "b".repeat(64),
      chunkMetadata: {
        sourceBlocks: [{ metadata: { questionNumber: 9 } }],
      },
      locator: { primary: { questionNumber: 9, pdfPageStart: 25 } },
    }),
  ]);

  assert.equal(resolved[0].evidenceRole, "ELABORATION");
  assert.equal(resolved[0].controllingAuthorityEntries.length, 0);
});

test("foundational evidence remains foundational", () => {
  const resolved = resolveCourseEvidence([
    match({
      sourceSlug: "maslow-new-paradigm",
      sourceTitle: "Manuscript",
      authorityRelation: "FOUNDATIONAL",
      documentMetadata: {},
      chunkMetadata: {},
      contentSha256: "c".repeat(64),
    }),
  ]);

  assert.equal(resolved[0].evidenceRole, "FOUNDATIONAL");
});


import { buildCourseEvidenceContext } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

test("scoped correction context exposes proposition scope instead of a global override label only", () => {
  const resolved = resolveCourseEvidence([match()]);
  const context = buildCourseEvidenceContext(resolved);

  assert.match(context, /QA-Q11-CORR-SUBLIMATION-REALITY/u);
  assert.match(context, /propositionScope=sublimation_reality/u);
  assert.match(context, /type=EXPLICIT_CORRECTION/u);
});
