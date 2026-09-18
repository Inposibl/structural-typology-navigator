import assert from "node:assert/strict";
import test from "node:test";

import {
  FinalizeRequestError,
  FinalizeResponseError,
  finalizeKnowledgeDocumentEmbeddings,
} from "../../src/lib/knowledge/persistence/finalize-document-embeddings.ts";
import {
  getKnowledgeIngestionResumeState,
  IngestionResumeRequestError,
  IngestionResumeResponseError,
} from "../../src/lib/knowledge/persistence/ingestion-resume-state.ts";
import { COHERE_EMBEDDING_MODEL } from "../../src/lib/knowledge/persistence/payload.ts";
import { SupabaseRequestError } from "../../src/lib/supabase/server/http-client.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_orchestration_not_real",
};

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

type ResumeRowShape = {
  document: Record<string, unknown>;
  chunks: Array<Record<string, unknown>>;
};

function resumeRow(): ResumeRowShape {
  return {
    document: {
      document_id: DOCUMENT_ID,
      source_id: SOURCE_ID,
      status: "processing",
      sha256: "a".repeat(64),
      storage_bucket: "academy-knowledge",
      storage_path: `sources/academy-course--${"b".repeat(64)}/${"a".repeat(64)}/lecture.md--${"c".repeat(64)}`,
      original_filename: "Лекция.md",
      mime_type: "text/markdown",
      version_label: "v1",
      metadata: { synthetic: true },
    },
    chunks: [
      {
        chunk_index: 0,
        content: "Первый фрагмент.",
        content_sha256: "d".repeat(64),
        heading_path: ["Раздел"],
        locator: { paragraph: 1 },
        embedding_model: COHERE_EMBEDDING_MODEL,
        token_count: null,
        has_embedding: false,
      },
    ],
  };
}

type RecordedRequest = { url: string; init: RequestInit };

function recordingFetch(
  handler: (request: RecordedRequest) => Response | Promise<Response>,
): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    const request: RecordedRequest = { url: String(input), init: init ?? {} };
    requests.push(request);
    return handler(request);
  };
  return { fetch: fetchStub, requests };
}

test("posts the resume RPC and maps the authoritative state", async () => {
  const { fetch, requests } = recordingFetch(() =>
    Response.json([resumeRow()]),
  );

  const state = await getKnowledgeIngestionResumeState(DOCUMENT_ID, {
    env: TEST_ENV,
    fetch,
  });

  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/get_knowledge_ingestion_resume_state",
  );
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    document_id: DOCUMENT_ID,
  });
  assert.equal(state.document.documentId, DOCUMENT_ID);
  assert.equal(state.document.sourceId, SOURCE_ID);
  assert.equal(state.document.status, "processing");
  assert.equal(state.document.originalFilename, "Лекция.md");
  assert.equal(state.chunks.length, 1);
  assert.deepEqual(state.chunks[0], {
    chunkIndex: 0,
    content: "Первый фрагмент.",
    contentSha256: "d".repeat(64),
    headingPath: ["Раздел"],
    locator: { paragraph: 1 },
    embeddingModel: COHERE_EMBEDDING_MODEL,
    tokenCount: null,
    hasEmbedding: false,
  });
});

test("rejects unusable resume document ids before any request", async () => {
  const { fetch, requests } = recordingFetch(() =>
    Response.json([resumeRow()]),
  );

  await assert.rejects(
    getKnowledgeIngestionResumeState("not-a-uuid", { env: TEST_ENV, fetch }),
    IngestionResumeRequestError,
  );
  assert.equal(requests.length, 0);
});

test("rejects malformed resume responses", async () => {
  const row = resumeRow();
  const responses: unknown[] = [
    [],
    [{}],
    [{ document: { document_id: "nope" }, chunks: [] }],
    [{ document: { ...row.document, status: "unknown" }, chunks: [] }],
    [
      {
        document: { ...row.document, sha256: "not-a-sha" },
        chunks: row.chunks,
      },
    ],
    [{ document: row.document, chunks: [{ chunk_index: 0 }] }],
    [
      {
        document: row.document,
        chunks: [{ ...row.chunks[0], token_count: 0 }],
      },
    ],
  ];

  for (const response of responses) {
    const { fetch } = recordingFetch(() => Response.json(response));
    await assert.rejects(
      getKnowledgeIngestionResumeState(DOCUMENT_ID, { env: TEST_ENV, fetch }),
      IngestionResumeResponseError,
      JSON.stringify(response).slice(0, 60),
    );
  }
});

test("does not leak the secret key or an upstream body from the resume RPC", async () => {
  const upstreamBody = `resume diagnostics ${TEST_ENV.SUPABASE_SECRET_KEY}`;
  const { fetch } = recordingFetch(
    () => new Response(upstreamBody, { status: 500 }),
  );

  await assert.rejects(
    getKnowledgeIngestionResumeState(DOCUMENT_ID, { env: TEST_ENV, fetch }),
    (error: unknown) => {
      assert.ok(error instanceof SupabaseRequestError);
      assert.ok(!String(error).includes(TEST_ENV.SUPABASE_SECRET_KEY));
      assert.ok(!String(error).includes(upstreamBody));
      return true;
    },
  );
});

test("posts the finalization RPC with the exact database payload", async () => {
  const { fetch, requests } = recordingFetch(() =>
    Response.json([
      {
        result_status: "finalized",
        finalized_document_id: DOCUMENT_ID,
        chunk_count: 2,
      },
    ]),
  );

  const result = await finalizeKnowledgeDocumentEmbeddings(
    {
      documentId: DOCUMENT_ID,
      embeddingModel: COHERE_EMBEDDING_MODEL,
      embeddings: [
        { chunkIndex: 1, contentSha256: "e".repeat(64), embedding: [0.25, 0.5] },
        { chunkIndex: 0, contentSha256: "d".repeat(64), embedding: [0.5, 0.25] },
      ],
    },
    { env: TEST_ENV, fetch },
  );

  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/finalize_knowledge_document_embeddings",
  );
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    document_id: DOCUMENT_ID,
    embedding_model: COHERE_EMBEDDING_MODEL,
    embeddings: [
      {
        chunk_index: 1,
        content_sha256: "e".repeat(64),
        embedding: [0.25, 0.5],
      },
      {
        chunk_index: 0,
        content_sha256: "d".repeat(64),
        embedding: [0.5, 0.25],
      },
    ],
  });
  assert.deepEqual(result, {
    status: "finalized",
    documentId: DOCUMENT_ID,
    chunkCount: 2,
  });
});

test("maps an already_ready finalization result", async () => {
  const { fetch } = recordingFetch(() =>
    Response.json([
      {
        result_status: "already_ready",
        finalized_document_id: DOCUMENT_ID,
        chunk_count: 2,
      },
    ]),
  );

  const result = await finalizeKnowledgeDocumentEmbeddings(
    {
      documentId: DOCUMENT_ID,
      embeddingModel: COHERE_EMBEDDING_MODEL,
      embeddings: [{ chunkIndex: 0, contentSha256: "d".repeat(64), embedding: [1] }],
    },
    { env: TEST_ENV, fetch },
  );

  assert.equal(result.status, "already_ready");
});

test("rejects unexpected finalization responses", async () => {
  for (const response of [
    [],
    [{ result_status: "created", finalized_document_id: DOCUMENT_ID, chunk_count: 1 }],
    [
      {
        result_status: "finalized",
        finalized_document_id: "33333333-3333-4333-8333-333333333333",
        chunk_count: 1,
      },
    ],
    [{ result_status: "finalized", finalized_document_id: DOCUMENT_ID }],
  ]) {
    const { fetch } = recordingFetch(() => Response.json(response));
    await assert.rejects(
      finalizeKnowledgeDocumentEmbeddings(
        {
          documentId: DOCUMENT_ID,
          embeddingModel: COHERE_EMBEDDING_MODEL,
          embeddings: [
            { chunkIndex: 0, contentSha256: "d".repeat(64), embedding: [1] },
          ],
        },
        { env: TEST_ENV, fetch },
      ),
      FinalizeResponseError,
      JSON.stringify(response).slice(0, 60),
    );
  }
});

test("rejects unusable finalization input before any request", async () => {
  const { fetch, requests } = recordingFetch(() => Response.json([]));

  await assert.rejects(
    finalizeKnowledgeDocumentEmbeddings(
      {
        documentId: "not-a-uuid",
        embeddingModel: COHERE_EMBEDDING_MODEL,
        embeddings: [
          { chunkIndex: 0, contentSha256: "d".repeat(64), embedding: [1] },
        ],
      },
      { env: TEST_ENV, fetch },
    ),
    FinalizeRequestError,
  );

  await assert.rejects(
    finalizeKnowledgeDocumentEmbeddings(
      {
        documentId: DOCUMENT_ID,
        embeddingModel: "  ",
        embeddings: [
          { chunkIndex: 0, contentSha256: "d".repeat(64), embedding: [1] },
        ],
      },
      { env: TEST_ENV, fetch },
    ),
    FinalizeRequestError,
  );

  await assert.rejects(
    finalizeKnowledgeDocumentEmbeddings(
      { documentId: DOCUMENT_ID, embeddingModel: COHERE_EMBEDDING_MODEL, embeddings: [] },
      { env: TEST_ENV, fetch },
    ),
    FinalizeRequestError,
  );

  assert.equal(requests.length, 0);
});
