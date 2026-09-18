import type { IngestionPlan } from "../../ingestion/index.ts";
import type { SupabaseServerEnvironment } from "../../supabase/server/http-client.ts";
import {
  COHERE_EMBED_OUTPUT_DIMENSION,
  embedKnowledgeChunkTexts,
  type KnowledgeChunkEmbedding,
  type KnowledgeChunkText,
} from "../embeddings/cohere-embed.ts";
import {
  finalizeKnowledgeDocumentEmbeddings,
  type FinalizeChunkEmbedding,
  type FinalizeDocumentEmbeddingsInput,
  type FinalizeDocumentEmbeddingsResult,
} from "../persistence/finalize-document-embeddings.ts";
import {
  getKnowledgeIngestionResumeState,
  type KnowledgeIngestionResumeState,
} from "../persistence/ingestion-resume-state.ts";
import { COHERE_EMBEDDING_MODEL } from "../persistence/payload.ts";
import {
  persistIngestionPlan,
  type PersistIngestionResult,
} from "../persistence/persist-ingestion-plan.ts";
import {
  ACADEMY_KNOWLEDGE_BUCKET,
  isDeterministicOriginalFileStoragePath,
} from "../persistence/storage-path.ts";
import {
  uploadOrVerifyOriginalFile,
  verifyExistingOriginalFile,
  type OriginalFileStorageResult,
  type VerifiedOriginalFile,
} from "../storage/original-file.ts";

// Cohere requests are not exactly-once: a retry after network ambiguity may
// compute the same vectors twice. That is acceptable because embeddings are
// never persisted incrementally and finalization is identity-bound and atomic,
// so duplicated work costs money but cannot duplicate database state.

const DEFAULT_STORAGE_CONTENT_TYPE = "application/octet-stream";

export type IngestionServerEnvironment = SupabaseServerEnvironment & {
  COHERE_API_KEY?: string;
};

export type IngestionClientContext = {
  env: IngestionServerEnvironment;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
};

export type OriginalFileUploadInput = {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  normalizedDocumentSha256: string;
};

export type OriginalFileVerificationInput = {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  normalizedDocumentSha256: string;
};

export type IngestionClients = {
  persistIngestionPlan: (
    plan: IngestionPlan,
    context: IngestionClientContext,
  ) => Promise<PersistIngestionResult>;
  readIngestionResumeState: (
    documentId: string,
    context: IngestionClientContext,
  ) => Promise<KnowledgeIngestionResumeState>;
  uploadOrVerifyOriginalFile: (
    input: OriginalFileUploadInput,
    context: IngestionClientContext,
  ) => Promise<OriginalFileStorageResult>;
  verifyExistingOriginalFile: (
    input: OriginalFileVerificationInput,
    context: IngestionClientContext,
  ) => Promise<VerifiedOriginalFile>;
  embedKnowledgeChunkTexts: (
    chunks: readonly KnowledgeChunkText[],
    context: IngestionClientContext,
  ) => Promise<KnowledgeChunkEmbedding[]>;
  finalizeKnowledgeDocumentEmbeddings: (
    input: FinalizeDocumentEmbeddingsInput,
    context: IngestionClientContext,
  ) => Promise<FinalizeDocumentEmbeddingsResult>;
};

export const defaultIngestionClients: IngestionClients = {
  persistIngestionPlan: (plan, context) =>
    persistIngestionPlan(plan, {
      env: context.env,
      fetch: context.fetch,
      signal: context.signal,
    }),
  readIngestionResumeState: (documentId, context) =>
    getKnowledgeIngestionResumeState(documentId, {
      env: context.env,
      fetch: context.fetch,
      signal: context.signal,
    }),
  uploadOrVerifyOriginalFile: (input, context) =>
    uploadOrVerifyOriginalFile({
      ...input,
      env: context.env,
      fetch: context.fetch,
      signal: context.signal,
    }),
  verifyExistingOriginalFile: (input, context) =>
    verifyExistingOriginalFile({
      ...input,
      env: context.env,
      fetch: context.fetch,
      signal: context.signal,
    }),
  embedKnowledgeChunkTexts: (chunks, context) =>
    embedKnowledgeChunkTexts(chunks, {
      env: context.env,
      fetch: context.fetch,
      signal: context.signal,
    }),
  finalizeKnowledgeDocumentEmbeddings: (input, context) =>
    finalizeKnowledgeDocumentEmbeddings(input, {
      env: context.env,
      fetch: context.fetch,
      signal: context.signal,
    }),
};

export type IngestKnowledgeDocumentInput = {
  plan: IngestionPlan;
  originalFileBytes?: Uint8Array;
};

export type IngestKnowledgeDocumentOptions = {
  env?: IngestionServerEnvironment;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  clients?: Partial<IngestionClients>;
};

export type IngestKnowledgeDocumentResult = {
  status: "finalized" | "already_ready";
  sourceId: string;
  documentId: string;
  chunkCount: number;
  storageStatus?: "uploaded" | "already_present";
};

export class IngestionInputError extends Error {
  readonly code = "INVALID_INGESTION_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "IngestionInputError";
  }
}

export class IngestionIdentityMismatchError extends Error {
  readonly code = "INGESTION_IDENTITY_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "IngestionIdentityMismatchError";
  }
}

export class IngestionStatusError extends Error {
  readonly code = "INGESTION_STATUS_NOT_ORCHESTRATABLE";

  constructor(message: string) {
    super(message);
    this.name = "IngestionStatusError";
  }
}

type StorageExpectation =
  | { storageExpected: false }
  | {
      storageExpected: true;
      bucket: string;
      path: string;
      contentType: string;
    };

function readOriginalFilename(plan: IngestionPlan): string | null {
  const filename = plan.documentIdentity?.originalFilename;
  return typeof filename === "string" && filename.trim().length > 0
    ? filename
    : null;
}

function requireOriginalFileBytes(
  input: IngestKnowledgeDocumentInput,
): Uint8Array {
  const bytes = input.originalFileBytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new IngestionInputError(
      "originalFileBytes must carry the exact original file bytes; they are never reconstructed from normalized text.",
    );
  }
  return bytes;
}

function assertIngestionInput(input: IngestKnowledgeDocumentInput): void {
  const plan = input.plan;
  if (
    typeof plan !== "object" ||
    plan === null ||
    typeof plan.documentIdentity !== "object" ||
    plan.documentIdentity === null ||
    !Array.isArray(plan.chunks)
  ) {
    throw new IngestionInputError("plan must be a complete ingestion plan.");
  }

  // Fail before any persistence side effect when the caller expects Storage
  // but cannot supply the original bytes.
  if (readOriginalFilename(plan) !== null) {
    requireOriginalFileBytes(input);
  }
}

function verifyChunkIdentities(
  state: KnowledgeIngestionResumeState,
  plan: IngestionPlan,
): void {
  if (state.chunks.length !== plan.chunkCount) {
    throw new IngestionIdentityMismatchError(
      `Persisted document ${state.document.documentId} holds ${state.chunks.length} chunks, but the ingestion plan declares ${plan.chunkCount}.`,
    );
  }

  const expectationsReady = state.document.status === "ready";

  state.chunks.forEach((chunk, position) => {
    const planned = plan.chunks[position];
    if (
      planned === undefined ||
      chunk.chunkIndex !== planned.chunkIndex ||
      chunk.content !== planned.content ||
      chunk.contentSha256 !== planned.contentSha256
    ) {
      throw new IngestionIdentityMismatchError(
        `Persisted chunk ${position} of document ${state.document.documentId} does not match the ingestion plan.`,
      );
    }
    if (chunk.contentSha256 === null) {
      throw new IngestionIdentityMismatchError(
        `Persisted chunk ${chunk.chunkIndex} of document ${state.document.documentId} has no content_sha256 and cannot be embedded.`,
      );
    }
    if (chunk.embeddingModel !== COHERE_EMBEDDING_MODEL) {
      throw new IngestionIdentityMismatchError(
        `Persisted chunk ${chunk.chunkIndex} of document ${state.document.documentId} uses embedding model ${chunk.embeddingModel}.`,
      );
    }
    if (chunk.tokenCount !== null) {
      throw new IngestionIdentityMismatchError(
        `Persisted chunk ${chunk.chunkIndex} of document ${state.document.documentId} has a token count; this contract never synthesizes token counts.`,
      );
    }
    if (chunk.hasEmbedding !== expectationsReady) {
      throw new IngestionIdentityMismatchError(
        `Persisted chunk ${chunk.chunkIndex} of document ${state.document.documentId} is inconsistent with status ${state.document.status}.`,
      );
    }
  });
}

function resolveStorageExpectation(
  state: KnowledgeIngestionResumeState,
  plan: IngestionPlan,
): StorageExpectation {
  const { storageBucket, storagePath, sha256, mimeType } = state.document;

  if (storagePath === null) {
    if (readOriginalFilename(plan) !== null) {
      throw new IngestionIdentityMismatchError(
        `Persisted document ${state.document.documentId} has no storage path although the ingestion plan supplies an original filename.`,
      );
    }
    return { storageExpected: false };
  }

  if (storageBucket !== ACADEMY_KNOWLEDGE_BUCKET) {
    throw new IngestionIdentityMismatchError(
      `Persisted document ${state.document.documentId} references bucket ${String(storageBucket)}.`,
    );
  }
  if (!isDeterministicOriginalFileStoragePath(storagePath, sha256)) {
    throw new IngestionIdentityMismatchError(
      `Persisted storage path ${storagePath} does not satisfy the physical key contract.`,
    );
  }

  const planMimeType = plan.documentIdentity?.mimeType;
  const contentType =
    mimeType ??
    (typeof planMimeType === "string" && planMimeType.trim().length > 0
      ? planMimeType
      : DEFAULT_STORAGE_CONTENT_TYPE);

  return { storageExpected: true, bucket: storageBucket, path: storagePath, contentType };
}

function bindEmbeddingsToChunks(
  state: KnowledgeIngestionResumeState,
  embeddings: readonly KnowledgeChunkEmbedding[],
): FinalizeChunkEmbedding[] {
  if (embeddings.length !== state.chunks.length) {
    throw new IngestionIdentityMismatchError(
      `Embedding client returned ${embeddings.length} vectors for ${state.chunks.length} persisted chunks.`,
    );
  }

  const byIdentity = new Map<string, KnowledgeChunkEmbedding>();
  for (const embedding of embeddings) {
    const identity = `${embedding.chunkIndex}:${embedding.contentSha256}`;
    if (byIdentity.has(identity)) {
      throw new IngestionIdentityMismatchError(
        `Embedding client returned duplicate identity ${embedding.chunkIndex}.`,
      );
    }
    if (
      !Array.isArray(embedding.embedding) ||
      embedding.embedding.length !== COHERE_EMBED_OUTPUT_DIMENSION ||
      !embedding.embedding.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    ) {
      throw new IngestionIdentityMismatchError(
        `Embedding client returned an unusable vector for chunk ${embedding.chunkIndex}.`,
      );
    }
    byIdentity.set(identity, embedding);
  }

  return [...state.chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => {
      const match = byIdentity.get(`${chunk.chunkIndex}:${chunk.contentSha256}`);
      if (match === undefined) {
        throw new IngestionIdentityMismatchError(
          `Embedding client did not return a vector for persisted chunk ${chunk.chunkIndex}.`,
        );
      }
      return {
        chunkIndex: chunk.chunkIndex,
        contentSha256: chunk.contentSha256 as string,
        embedding: match.embedding,
      };
    });
}

async function verifyReadyStorage(
  clients: IngestionClients,
  state: KnowledgeIngestionResumeState,
  expectation: StorageExpectation,
  input: IngestKnowledgeDocumentInput,
  context: IngestionClientContext,
): Promise<"already_present" | undefined> {
  if (!expectation.storageExpected) {
    return undefined;
  }

  // Ready-state repair is an operator concern: this path only reads.
  await clients.verifyExistingOriginalFile(
    {
      bucket: expectation.bucket,
      path: expectation.path,
      bytes: requireOriginalFileBytes(input),
      normalizedDocumentSha256: state.document.sha256,
    },
    context,
  );

  return "already_present";
}

export async function ingestKnowledgeDocument(
  input: IngestKnowledgeDocumentInput,
  options: IngestKnowledgeDocumentOptions = {},
): Promise<IngestKnowledgeDocumentResult> {
  assertIngestionInput(input);

  const context: IngestionClientContext = {
    env: options.env ?? process.env,
    fetch: options.fetch,
    signal: options.signal,
  };
  const clients: IngestionClients = {
    ...defaultIngestionClients,
    ...options.clients,
  };

  // The caller's plan is never trusted beyond persistence: the database state
  // returned by the resume RPC is the authoritative input for Storage, Cohere,
  // and finalization.
  const persisted = await clients.persistIngestionPlan(input.plan, context);
  const state = await clients.readIngestionResumeState(
    persisted.documentId,
    context,
  );

  if (state.document.sha256 !== input.plan.normalizedContentSha256) {
    throw new IngestionIdentityMismatchError(
      `Persisted document ${state.document.documentId} carries sha256 ${state.document.sha256} instead of ${input.plan.normalizedContentSha256}.`,
    );
  }

  verifyChunkIdentities(state, input.plan);
  const expectation = resolveStorageExpectation(state, input.plan);

  if (state.document.status === "ready") {
    const storageStatus = await verifyReadyStorage(
      clients,
      state,
      expectation,
      input,
      context,
    );

    return {
      status: "already_ready",
      sourceId: state.document.sourceId,
      documentId: state.document.documentId,
      chunkCount: state.chunks.length,
      ...(storageStatus === undefined ? {} : { storageStatus }),
    };
  }

  if (state.document.status !== "processing") {
    throw new IngestionStatusError(
      `Document ${state.document.documentId} cannot be ingested from status ${state.document.status}.`,
    );
  }

  let storageStatus: "uploaded" | "already_present" | undefined;
  if (expectation.storageExpected) {
    const upload = await clients.uploadOrVerifyOriginalFile(
      {
        bucket: expectation.bucket,
        path: expectation.path,
        bytes: requireOriginalFileBytes(input),
        contentType: expectation.contentType,
        normalizedDocumentSha256: state.document.sha256,
      },
      context,
    );
    storageStatus = upload.status;
  }

  const embeddings = await clients.embedKnowledgeChunkTexts(
    state.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentSha256: chunk.contentSha256 as string,
    })),
    context,
  );

  const finalized = await clients.finalizeKnowledgeDocumentEmbeddings(
    {
      documentId: state.document.documentId,
      embeddingModel: COHERE_EMBEDDING_MODEL,
      embeddings: bindEmbeddingsToChunks(state, embeddings),
    },
    context,
  );

  return {
    status: finalized.status,
    sourceId: state.document.sourceId,
    documentId: state.document.documentId,
    chunkCount: state.chunks.length,
    ...(storageStatus === undefined ? {} : { storageStatus }),
  };
}
