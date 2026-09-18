import assert from "node:assert/strict";
import test from "node:test";

import {
  CourseEvidenceSelectionError,
  selectCourseEvidence,
} from "../../src/lib/knowledge/retrieval/evidence-selector.ts";
import type { ResolvedCourseEvidence } from "../../src/lib/knowledge/retrieval/authority-resolver.ts";

const evidence: ResolvedCourseEvidence[] = [
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
    locator: {},
    chunkMetadata: {},
    similarity: 0.94,
    controllingAuthorityEntries: [],
    evidenceRole: "FOUNDATIONAL",
  },
];

test("selector accepts only verbatim quotes from retrieved chunks", async () => {
  const selected = await selectCourseEvidence(
    "понять изменение мотивации под влиянием контекста",
    evidence,
    {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote: "Мотивация человека меняется под влиянием контекста",
          },
        ],
      }),
    },
  );

  assert.equal(selected.status, "SUPPORTED");
  assert.equal(selected.evidence[0].chunkId, 10);
});

test("selector rejects invented quotes and unknown chunk ids", async () => {
  await assert.rejects(
    selectCourseEvidence("мотивация", evidence, {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 10,
            quote: "Пользователю обязательно нужно пройти этот курс",
          },
        ],
      }),
    }),
    CourseEvidenceSelectionError,
  );

  await assert.rejects(
    selectCourseEvidence("мотивация", evidence, {
      callJson: async () => ({
        status: "SUPPORTED",
        evidence: [
          {
            chunkId: 999,
            quote: "Мотивация человека меняется под влиянием контекста",
          },
        ],
      }),
    }),
    CourseEvidenceSelectionError,
  );
});

test("selector can fail closed with INSUFFICIENT", async () => {
  const selected = await selectCourseEvidence("другая задача", evidence, {
    callJson: async () => ({
      status: "INSUFFICIENT",
      evidence: [],
    }),
  });

  assert.deepEqual(selected, {
    status: "INSUFFICIENT",
    evidence: [],
  });
});
