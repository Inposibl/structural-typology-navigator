import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptMarkdownDocument,
  buildIngestionPlan,
  type IngestionPlan,
} from "../../src/lib/ingestion/index.ts";
import {
  COHERE_EMBEDDING_MODEL,
  buildSupabaseIngestionPayload,
} from "../../src/lib/knowledge/persistence/payload.ts";
import {
  KnowledgeIdentityConflictError,
  persistIngestionPlan,
  PersistenceResponseError,
} from "../../src/lib/knowledge/persistence/persist-ingestion-plan.ts";
import {
  ACADEMY_KNOWLEDGE_BUCKET,
  buildOriginalFileStoragePath,
} from "../../src/lib/knowledge/persistence/storage-path.ts";
import {
  SupabaseConfigurationError,
  SupabaseRequestError,
} from "../../src/lib/supabase/server/http-client.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test_not_real",
};

function createPlan(): IngestionPlan {
  const document = adaptMarkdownDocument(
    "# Раздел\n\nПервый абзац.\n\nВторой абзац.",
    {
      sourceSlug: "academy-course",
      sourceTitle: "Учебный курс",
      sourceKind: "course",
      author: "Автор",
      language: "ru",
      versionLabel: "v1",
      originalFilename: "Курс № 1.md",
      mimeType: "text/markdown",
      documentMetadata: { audience: "students" },
    },
  );

  return buildIngestionPlan(document, {
    targetCharacters: 25,
    hardMaximumCharacters: 40,
    overlapCharacters: 5,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

test("maps an IngestionPlan to the exact processing-only RPC payload", () => {
  const plan = createPlan();
  const payload = buildSupabaseIngestionPayload(plan);

  assert.deepEqual(payload.source, {
    slug: "academy-course",
    title: "Учебный курс",
    author: "Автор",
    language: "ru",
    source_kind: "course",
  });
  assert.deepEqual(payload.document, {
    version_label: "v1",
    original_filename: "Курс № 1.md",
    mime_type: "text/markdown",
    storage_bucket: ACADEMY_KNOWLEDGE_BUCKET,
    storage_path: buildOriginalFileStoragePath(
      "academy-course",
      plan.normalizedContentSha256,
      "Курс № 1.md",
    ),
    sha256: plan.normalizedContentSha256,
    status: "processing",
    metadata: { audience: "students" },
  });
  assert.deepEqual(
    payload.chunks.map((chunk) => chunk.chunk_index),
    plan.chunks.map((chunk) => chunk.chunkIndex),
  );
  assert.ok(payload.chunks.every((chunk) => chunk.embedding === null));
  assert.ok(payload.chunks.every((chunk) => chunk.token_count === null));
  assert.ok(
    payload.chunks.every(
      (chunk) => chunk.embedding_model === COHERE_EMBEDDING_MODEL,
    ),
  );
  assert.ok(!JSON.stringify(payload).includes('"ready"'));
});

test("omits source metadata and an absent author from the persistence payload", () => {
  const plan = createPlan();
  delete plan.source.author;
  plan.documentMetadata = { audience: "students", canonical: true };

  const payload = buildSupabaseIngestionPayload(plan);

  assert.equal("metadata" in payload.source, false);
  assert.equal("author" in payload.source, false);
  assert.deepEqual(payload.document.metadata, {
    audience: "students",
    canonical: true,
  });
});

test("rejects plans that try to smuggle non-null token counts", () => {
  const plan = createPlan();
  const invalidPlan = structuredClone(plan) as unknown as {
    chunks: Array<{ tokenCount: number | null }>;
  };
  invalidPlan.chunks[0].tokenCount = 10;

  assert.throws(
    () =>
      buildSupabaseIngestionPayload(
        invalidPlan as unknown as IngestionPlan,
      ),
    /tokenCount must remain null/i,
  );
});

test("keeps the private bucket contract when no original filename exists", () => {
  const plan = createPlan();
  delete plan.documentIdentity.originalFilename;

  const payload = buildSupabaseIngestionPayload(plan);

  assert.equal(payload.document.storage_bucket, ACADEMY_KNOWLEDGE_BUCKET);
  assert.equal(payload.document.storage_path, null);
});

test("builds deterministic Unicode-safe storage paths", () => {
  const hash = "a".repeat(64);
  const first = buildOriginalFileStoragePath(
    "курс-основы",
    hash,
    "Лекция № 1 — Введение.md",
  );
  const second = buildOriginalFileStoragePath(
    "курс-основы",
    hash,
    "Лекция № 1 — Введение.md",
  );

  assert.equal(first, second);
  assert.equal(
    first,
    `sources/курс-основы/${hash}/Лекция № 1 — Введение.md`,
  );
  assert.equal(ACADEMY_KNOWLEDGE_BUCKET, "academy-knowledge");
});

test("removes traversal and path separators from storage path segments", () => {
  const storagePath = buildOriginalFileStoragePath(
    "../academy\\course",
    "b".repeat(64),
    "../../секция\\лекция.md",
  );
  const segments = storagePath.split("/");

  assert.equal(segments.length, 4);
  assert.equal(segments[0], "sources");
  assert.ok(segments.slice(1).every((segment) => segment !== "." && segment !== ".."));
  assert.ok(!segments.slice(1).some((segment) => segment.includes("\\")));
  assert.ok(!storagePath.includes("../"));
});

test("fails closed when SUPABASE_SECRET_KEY is missing", async () => {
  await assert.rejects(
    persistIngestionPlan(createPlan(), {
      env: { SUPABASE_URL: TEST_ENV.SUPABASE_URL },
      fetch: async () => jsonResponse([]),
    }),
    (error: unknown) => {
      assert.ok(error instanceof SupabaseConfigurationError);
      assert.match(error.message, /SUPABASE_SECRET_KEY is required/);
      assert.ok(!error.message.includes(TEST_ENV.SUPABASE_SECRET_KEY));
      return true;
    },
  );
});

test("passes an external AbortSignal through to the HTTP request", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    persistIngestionPlan(createPlan(), {
      env: TEST_ENV,
      signal: controller.signal,
      fetch: async (_input, init) => {
        assert.equal(init?.signal?.aborted, true);
        throw new Error("aborted by test");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SupabaseRequestError);
      assert.equal(error.code, "ABORTED");
      return true;
    },
  );
});

test(
  "keeps the timeout active while the response body is being read",
  { timeout: 1_000 },
  async () => {
    await assert.rejects(
      persistIngestionPlan(createPlan(), {
        env: TEST_ENV,
        timeoutMs: 20,
        fetch: async (_input, init) =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () =>
              new Promise((_resolve, reject) => {
                init?.signal?.addEventListener(
                  "abort",
                  () => reject(new Error("body read aborted")),
                  { once: true },
                );
              }),
          }) as Response,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupabaseRequestError);
        assert.equal(error.code, "TIMEOUT");
        return true;
      },
    );
  },
);

test("posts only to the ingestion RPC and parses an inserted result", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchStub: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse([
      {
        source_id: "11111111-1111-4111-8111-111111111111",
        document_id: "22222222-2222-4222-8222-222222222222",
        result_status: "inserted",
        chunk_count: createPlan().chunkCount,
      },
    ]);
  };

  const result = await persistIngestionPlan(createPlan(), {
    env: TEST_ENV,
    fetch: fetchStub,
  });

  assert.equal(
    requestUrl,
    "https://example.supabase.co/rest/v1/rpc/persist_knowledge_ingestion_plan",
  );
  assert.equal(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), TEST_ENV.SUPABASE_SECRET_KEY);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(result, {
    status: "inserted",
    sourceId: "11111111-1111-4111-8111-111111111111",
    documentId: "22222222-2222-4222-8222-222222222222",
    chunkCount: createPlan().chunkCount,
  });

  const body = JSON.parse(String(requestInit?.body));
  assert.deepEqual(Object.keys(body), ["ingestion_plan"]);
  assert.equal(body.ingestion_plan.document.status, "processing");
});

test("parses an already_exists RPC result", async () => {
  const result = await persistIngestionPlan(createPlan(), {
    env: TEST_ENV,
    fetch: async () =>
      jsonResponse([
        {
          source_id: "11111111-1111-4111-8111-111111111111",
          document_id: "22222222-2222-4222-8222-222222222222",
          result_status: "already_exists",
          chunk_count: createPlan().chunkCount,
        },
      ]),
  });

  assert.equal(result.status, "already_exists");
});

test("maps an identity-conflict HTTP 409 without reading its body", async () => {
  const responseBody = `private diagnostics ${TEST_ENV.SUPABASE_SECRET_KEY}`;

  await assert.rejects(
    persistIngestionPlan(createPlan(), {
      env: TEST_ENV,
      fetch: async () => new Response(responseBody, { status: 409 }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof KnowledgeIdentityConflictError);
      assert.ok(!String(error).includes(responseBody));
      assert.ok(!String(error).includes(TEST_ENV.SUPABASE_SECRET_KEY));
      return true;
    },
  );
});

test("rejects the legacy created result status", async () => {
  await assert.rejects(
    persistIngestionPlan(createPlan(), {
      env: TEST_ENV,
      fetch: async () =>
        jsonResponse([
          {
            source_id: "11111111-1111-4111-8111-111111111111",
            document_id: "22222222-2222-4222-8222-222222222222",
            result_status: "created",
            chunk_count: createPlan().chunkCount,
          },
        ]),
    }),
    PersistenceResponseError,
  );
});

test("rejects upstream errors without exposing the secret or response body", async () => {
  const upstreamBody = `database details ${TEST_ENV.SUPABASE_SECRET_KEY}`;

  await assert.rejects(
    persistIngestionPlan(createPlan(), {
      env: TEST_ENV,
      fetch: async () => new Response(upstreamBody, { status: 500 }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof SupabaseRequestError);
      assert.equal(error.status, 500);
      assert.ok(!String(error).includes(TEST_ENV.SUPABASE_SECRET_KEY));
      assert.ok(!String(error).includes(upstreamBody));
      return true;
    },
  );
});

test("cancels an upstream error body without reading it", async () => {
  let bodyWasCancelled = false;
  const body = new ReadableStream({
    cancel() {
      bodyWasCancelled = true;
    },
  });

  await assert.rejects(
    persistIngestionPlan(createPlan(), {
      env: TEST_ENV,
      fetch: async () => new Response(body, { status: 500 }),
    }),
    SupabaseRequestError,
  );

  assert.equal(bodyWasCancelled, true);
});
