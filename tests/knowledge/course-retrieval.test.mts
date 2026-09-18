
import assert from "node:assert/strict";
import test from "node:test";

import {
  retrieveCourseKnowledge,
} from "../../src/lib/knowledge/retrieval/retrieve-course-knowledge.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  COHERE_API_KEY: "cohere-test",
};

function vector(): number[] {
  return Array.from({ length: 1024 }, () => 0.1);
}

test("does not embed or call retrieval RPC when a routable course has no active sources", async () => {
  let embedCalls = 0;
  let fetchCalls = 0;

  const result = await retrieveCourseKnowledge(
    "normative-situation",
    "правила не работают без ручного контроля",
    {
      env: TEST_ENV,
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("unexpected fetch");
      },
      dependencies: {
        listBindings: async () => [],
        embedQuery: async () => {
          embedCalls += 1;
          return vector();
        },
      },
    },
  );

  assert.equal(result.hasActiveSources, false);
  assert.deepEqual(result.matches, []);
  assert.equal(embedCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("course retrieval sends the validated course id to the generic RPC", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  const result = await retrieveCourseKnowledge(
    "maslow",
    "мотивация и контекст",
    {
      env: TEST_ENV,
      dependencies: {
        listBindings: async () => [
          {
            courseId: "maslow",
            sourceId: "source-1",
            sourceSlug: "maslow-new-paradigm",
            sourceTitle: "Manuscript",
            authorityRelation: "FOUNDATIONAL",
            metadata: {},
          },
        ],
        embedQuery: async () => vector(),
      },
      fetch: async (input, init) => {
        const url = String(input);
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        requests.push({ url, body });

        return new Response(
          JSON.stringify([
            {
              chunk_id: 1,
              document_id: "doc-1",
              source_id: "source-1",
              course_id: "maslow",
              source_slug: "maslow-new-paradigm",
              source_title: "Manuscript",
              source_kind: "manuscript",
              authority_relation: "FOUNDATIONAL",
              course_source_metadata: {},
              source_metadata: {},
              document_metadata: {},
              content: "Контекст курса.",
              content_sha256: "a".repeat(64),
              heading_path: ["Раздел"],
              locator: {},
              chunk_metadata: {},
              similarity: 0.88,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(result.hasActiveSources, true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].courseId, "maslow");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /match_course_knowledge_chunks/u);
  assert.equal(requests[0].body.p_course_id, "maslow");
});
