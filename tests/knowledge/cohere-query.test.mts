import assert from "node:assert/strict";
import test from "node:test";

import {
  COHERE_QUERY_INPUT_TYPE,
  CohereQueryError,
  embedKnowledgeQuery,
} from "../../src/lib/knowledge/embeddings/cohere-query.ts";

const TEST_ENV = { COHERE_API_KEY: "cohere-test-key" };

function vector(value = 0.1, length = 1024): number[] {
  return Array.from({ length }, () => value);
}

test("uses Cohere embed-v4.0 search_query with 1024 float output and no truncation", async () => {
  const bodies: Array<Record<string, unknown>> = [];

  const result = await embedKnowledgeQuery("мотивация", {
    env: TEST_ENV,
    fetch: async (_input, init) => {
      bodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      return new Response(
        JSON.stringify({ embeddings: { float: [vector()] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(result.length, 1024);
  assert.equal(bodies.length, 1);

  const body = bodies[0];
  assert.equal(body.input_type, "search_query");
  assert.equal(COHERE_QUERY_INPUT_TYPE, "search_query");
  assert.equal(body.output_dimension, 1024);
  assert.deepEqual(body.embedding_types, ["float"]);
  assert.equal(body.truncate, "NONE");
});

test("rejects malformed query embeddings", async () => {
  await assert.rejects(
    embedKnowledgeQuery("test", {
      env: TEST_ENV,
      fetch: async () =>
        new Response(
          JSON.stringify({ embeddings: { float: [vector(0.1, 1023)] } }),
          { status: 200 },
        ),
    }),
    CohereQueryError,
  );
});
