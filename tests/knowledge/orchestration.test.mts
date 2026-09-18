import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptMarkdownDocument,
  buildIngestionPlan,
  type IngestionPlan,
} from "../../src/lib/ingestion/index.ts";
import {
  COHERE_EMBED_OUTPUT_DIMENSION,
  CohereRequestError,
  embedKnowledgeChunkTexts,
  type KnowledgeChunkText,
} from "../../src/lib/knowledge/embeddings/cohere-embed.ts";
import {
  ingestKnowledgeDocument,
  IngestionIdentityMismatchError,
  IngestionInputError,
  IngestionStatusError,
  type IngestionClients,
  type IngestionClientContext,
  type IngestKnowledgeDocumentInput,
} from "../../src/lib/knowledge/orchestration/ingest-knowledge-document.ts";
import {
  type KnowledgeIngestionResumeState,
  type PersistedIngestionChunk,
  type PersistedIngestionDocument,
} from "../../src/lib/knowledge/persistence/ingestion-resume-state.ts";
import { buildSupabaseIngestionPayload, COHERE_EMBEDDING_MODEL } from "../../src/lib/knowledge/persistence/payload.ts";
import { buildOriginalFileStoragePath } from "../../src/lib/knowledge/persistence/storage-path.ts";
import {
  StorageIdentityConflictError,
  StorageObjectMissingError,
  StorageUploadLimitError,
  uploadOrVerifyOriginalFile,
} from "../../src/lib/knowledge/storage/original-file.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_orchestration_not_real",
  COHERE_API_KEY: "cohere_orchestration_not_real",
};

const DEFAULT_TEXT =
  "# Раздел\n\nПервый абзац синтетического документа.\n\nВторой абзац синтетического документа.\n";

const LONG_TEXT = `# Длинный раздел\n\n${Array.from(
  { length: 130 },
  (_unused, index) => `Абзац ${index + 1} синтетического документа для батчинга.`,
).join("\n\n")}\n`;

function fakeUuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function buildPlan(input: {
  slug?: string;
  filename?: string;
  text?: string;
  targetCharacters?: number;
  hardMaximumCharacters?: number;
  overlapCharacters?: number;
} = {}): IngestionPlan {
  const document = adaptMarkdownDocument(input.text ?? DEFAULT_TEXT, {
    sourceSlug: input.slug ?? "синтетический-курс",
    sourceTitle: "Синтетический курс",
    sourceKind: "course",
    author: "Синтетический автор",
    language: "ru",
    versionLabel: "v1",
    ...(input.filename === undefined
      ? {}
      : { originalFilename: input.filename }),
    mimeType: "text/markdown",
    documentMetadata: { synthetic: true },
  });

  return buildIngestionPlan(document, {
    targetCharacters: input.targetCharacters ?? 25,
    hardMaximumCharacters: input.hardMaximumCharacters ?? 40,
    overlapCharacters: input.overlapCharacters ?? 5,
  });
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

type FakeBackend = {
  clients: IngestionClients;
  documents: Map<string, PersistedIngestionDocument & { chunks: PersistedIngestionChunk[] }>;
  objects: Map<string, Uint8Array>;
  calls: Record<
    "persist" | "resume" | "upload" | "verifyStorage" | "cohere" | "finalize",
    number
  >;
  cohereInputs: KnowledgeChunkText[][];
  storageUploadPaths: string[];
  storageVerifyPaths: string[];
  embeddedChunkCount: (documentId: string) => number;
  isRetrievable: (documentId: string) => boolean;
};

// Models the DB-1 and CLIENTS-1 semantics the orchestrator relies on:
// content-addressed documents, atomic identity-bound finalization, retrieval
// gated on ready, and non-overwriting Storage uploads.
function createFakeBackend(): FakeBackend {
  const documents = new Map<
    string,
    PersistedIngestionDocument & { chunks: PersistedIngestionChunk[] }
  >();
  const bySha = new Map<string, string>();
  const objects = new Map<string, Uint8Array>();
  const calls = {
    persist: 0,
    resume: 0,
    upload: 0,
    verifyStorage: 0,
    cohere: 0,
    finalize: 0,
  };
  const cohereInputs: KnowledgeChunkText[][] = [];
  const storageUploadPaths: string[] = [];
  const storageVerifyPaths: string[] = [];
  let documentCounter = 0;

  const clients: IngestionClients = {
    persistIngestionPlan: async (plan) => {
      calls.persist += 1;
      const existingId = bySha.get(plan.normalizedContentSha256);
      if (existingId !== undefined) {
        const existing = documents.get(existingId);
        if (existing === undefined) {
          throw new Error("fake backend lost the persisted document");
        }
        return {
          status: "already_exists",
          sourceId: existing.sourceId,
          documentId: existing.documentId,
          chunkCount: existing.chunks.length,
        };
      }

      documentCounter += 1;
      const payload = buildSupabaseIngestionPayload(plan);
      const documentId = fakeUuid(documentCounter);
      const sourceId = fakeUuid(1000 + documentCounter);

      documents.set(documentId, {
        documentId,
        sourceId,
        status: "processing",
        sha256: plan.normalizedContentSha256,
        storageBucket: payload.document.storage_bucket,
        storagePath: payload.document.storage_path,
        originalFilename: payload.document.original_filename,
        mimeType: payload.document.mime_type,
        versionLabel: payload.document.version_label,
        metadata: payload.document.metadata,
        chunks: plan.chunks.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          contentSha256: chunk.contentSha256,
          headingPath: [...chunk.headingPath],
          locator: chunk.locator,
          embeddingModel: COHERE_EMBEDDING_MODEL,
          tokenCount: null,
          hasEmbedding: false,
        })),
      });
      bySha.set(plan.normalizedContentSha256, documentId);

      return {
        status: "inserted",
        sourceId,
        documentId,
        chunkCount: plan.chunkCount,
      };
    },

    readIngestionResumeState: async (documentId) => {
      calls.resume += 1;
      const document = documents.get(documentId);
      if (document === undefined) {
        throw new Error(`fake backend has no document ${documentId}`);
      }
      return {
        document: { ...document, chunks: undefined } as unknown as PersistedIngestionDocument,
        chunks: document.chunks.map((chunk) => ({ ...chunk })),
      } satisfies KnowledgeIngestionResumeState;
    },

    uploadOrVerifyOriginalFile: async (input) => {
      calls.upload += 1;
      storageUploadPaths.push(input.path);
      const stored = objects.get(input.path);
      if (stored === undefined) {
        objects.set(input.path, Uint8Array.from(input.bytes));
        return {
          status: "uploaded",
          originalFileSha256: input.normalizedDocumentSha256,
          byteLength: input.bytes.byteLength,
        };
      }
      if (
        stored.byteLength !== input.bytes.byteLength ||
        !stored.every((byte, index) => byte === input.bytes[index])
      ) {
        throw new StorageIdentityConflictError(
          input.path,
          null,
          input.normalizedDocumentSha256,
        );
      }
      return {
        status: "already_present",
        originalFileSha256: input.normalizedDocumentSha256,
        byteLength: stored.byteLength,
      };
    },

    verifyExistingOriginalFile: async (input) => {
      calls.verifyStorage += 1;
      storageVerifyPaths.push(input.path);
      const stored = objects.get(input.path);
      if (stored === undefined) {
        throw new StorageObjectMissingError(input.path);
      }
      if (
        stored.byteLength !== input.bytes.byteLength ||
        !stored.every((byte, index) => byte === input.bytes[index])
      ) {
        throw new StorageIdentityConflictError(
          input.path,
          null,
          input.normalizedDocumentSha256,
        );
      }
      return {
        status: "verified",
        originalFileSha256: input.normalizedDocumentSha256,
        byteLength: stored.byteLength,
      };
    },

    embedKnowledgeChunkTexts: async (chunks) => {
      calls.cohere += 1;
      cohereInputs.push(chunks.map((chunk) => ({ ...chunk })));
      return chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        contentSha256: chunk.contentSha256,
        embedding: deterministicVector(chunk.chunkIndex),
      }));
    },

    finalizeKnowledgeDocumentEmbeddings: async (input) => {
      calls.finalize += 1;
      const document = documents.get(input.documentId);
      if (document === undefined) {
        throw new Error(`fake backend has no document ${input.documentId}`);
      }

      const identities = new Set(
        document.chunks.map(
          (chunk) => `${chunk.chunkIndex}:${chunk.contentSha256}`,
        ),
      );
      if (
        input.embeddings.length !== document.chunks.length ||
        !input.embeddings.every((embedding) =>
          identities.has(`${embedding.chunkIndex}:${embedding.contentSha256}`),
        )
      ) {
        throw new Error("fake finalization rejected an incomplete identity set");
      }

      if (document.status === "ready") {
        return {
          status: "already_ready" as const,
          documentId: document.documentId,
          chunkCount: document.chunks.length,
        };
      }
      if (document.status !== "processing") {
        throw new Error("fake finalization rejected the document status");
      }

      document.chunks = document.chunks.map((chunk) => ({
        ...chunk,
        hasEmbedding: true,
      }));
      document.status = "ready";

      return {
        status: "finalized" as const,
        documentId: document.documentId,
        chunkCount: document.chunks.length,
      };
    },
  };

  return {
    clients,
    documents,
    objects,
    calls,
    cohereInputs,
    storageUploadPaths,
    storageVerifyPaths,
    embeddedChunkCount: (documentId) =>
      documents.get(documentId)?.chunks.filter((chunk) => chunk.hasEmbedding)
        .length ?? 0,
    isRetrievable: (documentId) => {
      const document = documents.get(documentId);
      return (
        document !== undefined &&
        document.status === "ready" &&
        document.chunks.every((chunk) => chunk.hasEmbedding)
      );
    },
  };
}

function deterministicVector(chunkIndex: number): number[] {
  return Array.from({ length: COHERE_EMBED_OUTPUT_DIMENSION }, (_unused, position) =>
    position === chunkIndex % COHERE_EMBED_OUTPUT_DIMENSION ? 1 : 0,
  );
}

function context(): IngestionClientContext {
  return { env: TEST_ENV };
}

function run(
  backend: FakeBackend,
  input: IngestKnowledgeDocumentInput,
  clients: Partial<IngestionClients> = {},
): ReturnType<typeof ingestKnowledgeDocument> {
  return ingestKnowledgeDocument(input, {
    env: TEST_ENV,
    clients: { ...backend.clients, ...clients },
  });
}

function requireDocument(backend: FakeBackend) {
  const document = [...backend.documents.values()][0];
  assert.ok(document !== undefined, "expected a persisted document");
  return document;
}

test("ingests a fresh document to ready with authoritative chunks", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция № 1 — Синтетика.md" });
  const bytes = bytesOf("Синтетический оригинал 1.\n");

  const result = await run(backend, { plan, originalFileBytes: bytes });

  assert.deepEqual(result, {
    status: "finalized",
    sourceId: requireDocument(backend).sourceId,
    documentId: requireDocument(backend).documentId,
    chunkCount: plan.chunkCount,
    storageStatus: "uploaded",
  });
  assert.equal(requireDocument(backend).status, "ready");
  assert.equal(backend.embeddedChunkCount(result.documentId), plan.chunkCount);
  assert.equal(backend.isRetrievable(result.documentId), true);
  assert.equal(backend.calls.cohere, 1);
  assert.deepEqual(
    backend.cohereInputs[0],
    backend.documents
      .get(result.documentId)
      ?.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentSha256: chunk.contentSha256,
      })),
  );
});

test("repeats to already_ready without calling Cohere again", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция № 1 — Синтетика.md" });
  const bytes = bytesOf("Синтетический оригинал 1.\n");

  const first = await run(backend, { plan, originalFileBytes: bytes });
  const snapshots = backend.documents.get(first.documentId);

  const second = await run(backend, { plan, originalFileBytes: bytes });

  assert.equal(second.status, "already_ready");
  assert.equal(second.storageStatus, "already_present");
  assert.equal(backend.calls.cohere, 1);
  assert.equal(backend.calls.finalize, 1);
  assert.equal(backend.calls.verifyStorage, 1);
  assert.equal(backend.embeddedChunkCount(first.documentId), plan.chunkCount);
  assert.deepEqual(
    backend.documents.get(first.documentId)?.chunks,
    snapshots?.chunks,
  );
});

test("uses the persisted storage path when a different filename is re-submitted", async () => {
  const backend = createFakeBackend();
  const bytes = bytesOf("Синтетический оригинал 2.\n");
  const firstPlan = buildPlan({ filename: "Первая лекция.md" });
  const secondPlan = buildPlan({ filename: "Вторая лекция.md" });

  assert.equal(
    firstPlan.normalizedContentSha256,
    secondPlan.normalizedContentSha256,
  );

  const first = await run(backend, {
    plan: firstPlan,
    originalFileBytes: bytes,
  });
  const persistedPath = requireDocument(backend).storagePath;
  const incomingPath = buildOriginalFileStoragePath(
    "синтетический-курс",
    secondPlan.normalizedContentSha256,
    "Вторая лекция.md",
  );

  assert.notEqual(persistedPath, incomingPath);

  const second = await run(backend, {
    plan: secondPlan,
    originalFileBytes: bytes,
  });

  assert.equal(second.status, "already_ready");
  assert.equal(second.documentId, first.documentId);
  assert.equal(backend.storageVerifyPaths.at(-1), persistedPath);
  assert.equal(backend.storageUploadPaths.length, 1);
  assert.equal(requireDocument(backend).storagePath, persistedPath);
});

test("skips Storage when the plan carries no original filename", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({});

  const result = await run(backend, { plan });

  assert.equal(result.status, "finalized");
  assert.equal(result.storageStatus, undefined);
  assert.equal(backend.calls.upload, 0);
  assert.equal(backend.calls.verifyStorage, 0);
  assert.equal(requireDocument(backend).storagePath, null);
  assert.equal(backend.isRetrievable(result.documentId), true);
});

test("requires original file bytes before any persistence side effect", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });

  await assert.rejects(
    run(backend, { plan }),
    (error: unknown) => {
      assert.ok(error instanceof IngestionInputError);
      assert.equal(error.code, "INVALID_INGESTION_INPUT");
      return true;
    },
  );
  assert.equal(backend.calls.persist, 0);
  assert.equal(backend.documents.size, 0);
});

test("fails closed on a resume identity mismatch before Storage and Cohere", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 3.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        readIngestionResumeState: async (documentId) => {
          const state = await backend.clients.readIngestionResumeState(
            documentId,
            context(),
          );
          return {
            document: {
              ...state.document,
              sha256: "f".repeat(64),
            },
            chunks: state.chunks,
          };
        },
      },
    ),
    IngestionIdentityMismatchError,
  );
  assert.equal(backend.calls.upload, 0);
  assert.equal(backend.calls.cohere, 0);
});

test("fails closed when persisted chunks differ from the plan", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 4.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        readIngestionResumeState: async (documentId) => {
          const state = await backend.clients.readIngestionResumeState(
            documentId,
            context(),
          );
          return {
            document: state.document,
            chunks: state.chunks.map((chunk, index) =>
              index === 0 ? { ...chunk, content: "Подменённое содержимое." } : chunk,
            ),
          };
        },
      },
    ),
    IngestionIdentityMismatchError,
  );
  assert.equal(backend.calls.upload, 0);
  assert.equal(backend.calls.cohere, 0);
});

test("stops before Cohere when Storage reports an identity conflict", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 5.\n");
  const persistedPath = buildOriginalFileStoragePath(
    "синтетический-курс",
    plan.normalizedContentSha256,
    "Лекция.md",
  );
  backend.objects.set(persistedPath, bytesOf("Чужой объект.\n"));

  await assert.rejects(
    run(backend, { plan, originalFileBytes: bytes }),
    StorageIdentityConflictError,
  );
  assert.equal(backend.calls.cohere, 0);
  assert.equal(backend.embeddedChunkCount(requireDocument(backend).documentId), 0);
  assert.equal(backend.isRetrievable(requireDocument(backend).documentId), false);
});

test("leaves the document processing when Cohere fails permanently", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 6.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        embedKnowledgeChunkTexts: async () => {
          throw new Error("cohere rejected the request");
        },
      },
    ),
    /cohere rejected the request/u,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);
  assert.equal(backend.isRetrievable(document.documentId), false);
  assert.equal(backend.calls.finalize, 0);
});

test("leaves the document processing when Cohere exhausts retries", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 7.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        embedKnowledgeChunkTexts: async () => {
          throw new Error("cohere retries exhausted");
        },
      },
    ),
    /retries exhausted/u,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);
});

test("rejects malformed embedding responses before finalization", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 8.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        embedKnowledgeChunkTexts: async (chunks) =>
          chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            contentSha256: chunk.contentSha256,
            embedding: new Array<number>(1023).fill(0.1),
          })),
      },
    ),
    IngestionIdentityMismatchError,
  );

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        embedKnowledgeChunkTexts: async (chunks) =>
          chunks.map((chunk, index) => ({
            chunkIndex: chunk.chunkIndex,
            contentSha256:
              index === 0 ? "a".repeat(64) : chunk.contentSha256,
            embedding: deterministicVector(chunk.chunkIndex),
          })),
      },
    ),
    IngestionIdentityMismatchError,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);
  assert.equal(backend.calls.finalize, 0);
});

test("leaves the document processing when finalization fails", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 9.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        finalizeKnowledgeDocumentEmbeddings: async () => {
          throw new Error("finalization rejected the payload");
        },
      },
    ),
    /finalization rejected the payload/u,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);
  assert.equal(backend.isRetrievable(document.documentId), false);
});

test("resumes a crash after persistence", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 10.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        uploadOrVerifyOriginalFile: async () => {
          throw new Error("process died after persistence");
        },
      },
    ),
    /died after persistence/u,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(backend.objects.size, 0);
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);

  const retry = await run(backend, { plan, originalFileBytes: bytes });

  assert.equal(retry.status, "finalized");
  assert.equal(retry.storageStatus, "uploaded");
  assert.equal(backend.calls.persist, 2);
  assert.equal(backend.documents.size, 1);
  assert.equal(backend.isRetrievable(retry.documentId), true);
});

test("resumes a crash after Storage success", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 11.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        embedKnowledgeChunkTexts: async () => {
          throw new Error("process died after Storage");
        },
      },
    ),
    /died after Storage/u,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(backend.objects.size, 1);
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);

  const retry = await run(backend, { plan, originalFileBytes: bytes });

  assert.equal(retry.status, "finalized");
  assert.equal(retry.storageStatus, "already_present");
  assert.equal(backend.objects.size, 1);
  assert.equal(backend.isRetrievable(retry.documentId), true);
});

test("resumes safely after a partial Cohere attempt over 96 chunks", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({
    filename: "Длинная лекция.md",
    text: LONG_TEXT,
    targetCharacters: 30,
    hardMaximumCharacters: 60,
    overlapCharacters: 0,
  });
  const bytes = bytesOf("Синтетический оригинал 12.\n");

  assert.ok(plan.chunkCount > 96, `expected > 96 chunks, got ${plan.chunkCount}`);

  // Exercises the real Cohere client batching: the first request succeeds and
  // the second batch fails permanently, so the run dies mid-document.
  let batchRequests = 0;
  const now = Date.now();
  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        embedKnowledgeChunkTexts: (chunks, clientContext) =>
          embedKnowledgeChunkTexts(chunks, {
            ...clientContext,
            maxRetries: 0,
            fetch: async (_input, init) => {
              batchRequests += 1;
              if (batchRequests > 1) {
                return new Response(JSON.stringify({ message: "rejected" }), {
                  status: 400,
                });
              }
              const body = JSON.parse(String(init?.body ?? "{}")) as {
                texts: string[];
              };
              return Response.json({
                embeddings: {
                  float: body.texts.map((_unused, position) =>
                    deterministicVector(position),
                  ),
                },
              });
            },
          }),
      },
    ),
    CohereRequestError,
  );

  assert.equal(batchRequests, 2);
  assert.ok(Date.now() - now < 5_000, "the failing batch must not be retried");

  const document = requireDocument(backend);
  assert.equal(document.status, "processing");
  assert.equal(document.chunks.length, plan.chunkCount);
  assert.equal(backend.embeddedChunkCount(document.documentId), 0);

  const retry = await run(backend, { plan, originalFileBytes: bytes });

  assert.equal(retry.status, "finalized");
  assert.equal(document.chunks.length, plan.chunkCount);
  assert.equal(backend.embeddedChunkCount(retry.documentId), plan.chunkCount);
  assert.equal(backend.documents.size, 1);
});

test("returns already_ready when the previous finalization response was lost", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 13.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        finalizeKnowledgeDocumentEmbeddings: async (input, clientContext) => {
          await backend.clients.finalizeKnowledgeDocumentEmbeddings(
            input,
            clientContext,
          );
          throw new Error("caller lost the finalization response");
        },
      },
    ),
    /lost the finalization response/u,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "ready");
  assert.equal(backend.embeddedChunkCount(document.documentId), plan.chunkCount);

  const retry = await run(backend, { plan, originalFileBytes: bytes });

  assert.equal(retry.status, "already_ready");
  assert.equal(backend.calls.cohere, 1);
  assert.equal(backend.embeddedChunkCount(retry.documentId), plan.chunkCount);
});

test("keeps one document, one object and ready state under concurrent ingestion", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Конкурентная лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 14.\n");

  const [first, second] = await Promise.all([
    run(backend, { plan, originalFileBytes: bytes }),
    run(backend, { plan, originalFileBytes: bytes }),
  ]);

  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, ["already_ready", "finalized"]);
  assert.equal(first.documentId, second.documentId);
  assert.equal(backend.documents.size, 1);
  assert.equal(backend.objects.size, 1);
  assert.equal(requireDocument(backend).status, "ready");
  assert.equal(
    backend.embeddedChunkCount(first.documentId),
    plan.chunkCount,
  );
  assert.equal(backend.isRetrievable(first.documentId), true);
});

test("fails closed when a ready document lost its Storage object", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 15.\n");

  const first = await run(backend, { plan, originalFileBytes: bytes });
  backend.objects.clear();

  await assert.rejects(
    run(backend, { plan, originalFileBytes: bytes }),
    StorageObjectMissingError,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "ready");
  assert.equal(document.documentId, first.documentId);
  assert.equal(backend.embeddedChunkCount(first.documentId), plan.chunkCount);
  assert.equal(backend.objects.size, 0);
  assert.equal(backend.calls.cohere, 1);
});

test("fails closed when a ready document has different stored bytes", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 16.\n");

  const first = await run(backend, { plan, originalFileBytes: bytes });
  const persistedPath = requireDocument(backend).storagePath;
  assert.ok(persistedPath !== null);
  backend.objects.set(persistedPath, bytesOf("Подменённый объект.\n"));

  await assert.rejects(
    run(backend, { plan, originalFileBytes: bytes }),
    StorageIdentityConflictError,
  );

  const document = requireDocument(backend);
  assert.equal(document.status, "ready");
  assert.equal(document.documentId, first.documentId);
  assert.equal(backend.embeddedChunkCount(first.documentId), plan.chunkCount);
  assert.equal(backend.calls.cohere, 1);
  assert.deepEqual(
    backend.objects.get(persistedPath),
    bytesOf("Подменённый объект.\n"),
  );
});

test("fails closed on non-orchestratable document statuses", async () => {
  for (const status of ["pending", "failed", "archived"] as const) {
    const backend = createFakeBackend();
    const plan = buildPlan({ filename: "Лекция.md" });
    const bytes = bytesOf("Синтетический оригинал 17.\n");

    await assert.rejects(
      run(
        backend,
        { plan, originalFileBytes: bytes },
        {
          readIngestionResumeState: async (documentId) => {
            const state = await backend.clients.readIngestionResumeState(
              documentId,
              context(),
            );
            return { document: { ...state.document, status }, chunks: state.chunks };
          },
        },
      ),
      IngestionStatusError,
      status,
    );
    assert.equal(backend.calls.cohere, 0, status);
    assert.equal(backend.calls.upload, 0, status);
  }
});

test("fails closed when persisted chunks use another embedding model", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 19.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        readIngestionResumeState: async (documentId) => {
          const state = await backend.clients.readIngestionResumeState(
            documentId,
            context(),
          );
          return {
            document: state.document,
            chunks: state.chunks.map((chunk) => ({
              ...chunk,
              embeddingModel: "cohere/embed-v4.0@512",
            })),
          };
        },
      },
    ),
    IngestionIdentityMismatchError,
  );
  assert.equal(backend.calls.cohere, 0);
  assert.equal(backend.calls.upload, 0);
});

test("fails closed when a processing document already holds embeddings", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 20.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        readIngestionResumeState: async (documentId) => {
          const state = await backend.clients.readIngestionResumeState(
            documentId,
            context(),
          );
          return {
            document: state.document,
            chunks: state.chunks.map((chunk) => ({
              ...chunk,
              hasEmbedding: true,
            })),
          };
        },
      },
    ),
    IngestionIdentityMismatchError,
  );
  assert.equal(backend.calls.cohere, 0);
});

test("fails closed when persistence itself fails", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 21.\n");

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: bytes },
      {
        persistIngestionPlan: async () => {
          throw new Error("persistence unavailable");
        },
      },
    ),
    /persistence unavailable/u,
  );

  assert.equal(backend.calls.resume, 0);
  assert.equal(backend.calls.upload, 0);
  assert.equal(backend.calls.cohere, 0);
  assert.equal(backend.documents.size, 0);
});

test("fails closed above the 6 MiB ceiling before any network or Cohere call", async () => {
  const backend = createFakeBackend();
  const plan = buildPlan({ filename: "Большая лекция.md" });
  const oversized = new Uint8Array(6 * 1024 * 1024 + 1).fill(7);
  let fetched = false;

  await assert.rejects(
    run(
      backend,
      { plan, originalFileBytes: oversized },
      {
        // The real Storage client owns the standard-upload ceiling.
        uploadOrVerifyOriginalFile: (input, clientContext) =>
          uploadOrVerifyOriginalFile({
            ...input,
            ...clientContext,
            fetch: async () => {
              fetched = true;
              return new Response("unexpected", { status: 500 });
            },
          }),
        embedKnowledgeChunkTexts: async () => {
          throw new Error("Cohere must never be reached for an oversized file");
        },
      },
    ),
    StorageUploadLimitError,
  );

  assert.equal(fetched, false);
  assert.equal(backend.calls.cohere, 0);
});

test("does not leak secrets or upstream bodies through orchestration failures", async () => {
  const upstreamBody = `rpc diagnostics ${TEST_ENV.SUPABASE_SECRET_KEY}`;
  const plan = buildPlan({ filename: "Лекция.md" });
  const bytes = bytesOf("Синтетический оригинал 18.\n");

  await assert.rejects(
    ingestKnowledgeDocument(
      { plan, originalFileBytes: bytes },
      {
        env: TEST_ENV,
        fetch: async () => new Response(upstreamBody, { status: 500 }),
      },
    ),
    (error: unknown) => {
      assert.ok(!String(error).includes(TEST_ENV.SUPABASE_SECRET_KEY));
      assert.ok(!String(error).includes(upstreamBody));
      assert.ok(!String(error).includes(TEST_ENV.COHERE_API_KEY));
      return true;
    },
  );
});
