import type { JsonObject } from "../../ingestion/index.ts";
import {
  createSupabaseServerClient,
  type SupabaseServerClientOptions,
} from "../../supabase/server/http-client.ts";

const RESUME_RPC_PATH = "/rest/v1/rpc/get_knowledge_ingestion_resume_state";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export const KNOWLEDGE_DOCUMENT_STATUSES = [
  "pending",
  "processing",
  "ready",
  "failed",
  "archived",
] as const;

export type KnowledgeDocumentStatus =
  (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];

export type PersistedIngestionDocument = {
  documentId: string;
  sourceId: string;
  status: KnowledgeDocumentStatus;
  sha256: string;
  storageBucket: string | null;
  storagePath: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  versionLabel: string | null;
  metadata: JsonObject;
};

export type PersistedIngestionChunk = {
  chunkIndex: number;
  content: string;
  contentSha256: string | null;
  headingPath: string[];
  locator: JsonObject;
  embeddingModel: string;
  tokenCount: number | null;
  hasEmbedding: boolean;
};

export type KnowledgeIngestionResumeState = {
  document: PersistedIngestionDocument;
  chunks: PersistedIngestionChunk[];
};

export type ReadIngestionResumeStateOptions = SupabaseServerClientOptions & {
  signal?: AbortSignal;
};

export class IngestionResumeRequestError extends Error {
  readonly code = "INVALID_INGESTION_RESUME_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "IngestionResumeRequestError";
  }
}

export class IngestionResumeResponseError extends Error {
  readonly code = "INVALID_INGESTION_RESUME_RESPONSE";

  constructor() {
    super("Supabase ingestion resume RPC returned an invalid response.");
    this.name = "IngestionResumeResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function isStatus(value: unknown): value is KnowledgeDocumentStatus {
  return (
    typeof value === "string" &&
    (KNOWLEDGE_DOCUMENT_STATUSES as readonly string[]).includes(value)
  );
}

function parseDocument(value: unknown): PersistedIngestionDocument {
  if (
    !isRecord(value) ||
    typeof value.document_id !== "string" ||
    !UUID_PATTERN.test(value.document_id) ||
    typeof value.source_id !== "string" ||
    !UUID_PATTERN.test(value.source_id) ||
    !isStatus(value.status) ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    !isNullableString(value.storage_bucket) ||
    !isNullableString(value.storage_path) ||
    !isNullableString(value.original_filename) ||
    !isNullableString(value.mime_type) ||
    !isNullableString(value.version_label) ||
    !isJsonObject(value.metadata)
  ) {
    throw new IngestionResumeResponseError();
  }

  return {
    documentId: value.document_id,
    sourceId: value.source_id,
    status: value.status,
    sha256: value.sha256,
    storageBucket: value.storage_bucket,
    storagePath: value.storage_path,
    originalFilename: value.original_filename,
    mimeType: value.mime_type,
    versionLabel: value.version_label,
    metadata: value.metadata,
  };
}

function parseChunk(value: unknown): PersistedIngestionChunk {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.chunk_index) ||
    (value.chunk_index as number) < 0 ||
    typeof value.content !== "string" ||
    !isNullableString(value.content_sha256) ||
    !Array.isArray(value.heading_path) ||
    value.heading_path.some((heading) => typeof heading !== "string") ||
    !isJsonObject(value.locator) ||
    typeof value.embedding_model !== "string" ||
    !(
      value.token_count === null ||
      (Number.isInteger(value.token_count) &&
        (value.token_count as number) > 0)
    ) ||
    typeof value.has_embedding !== "boolean"
  ) {
    throw new IngestionResumeResponseError();
  }

  return {
    chunkIndex: value.chunk_index as number,
    content: value.content,
    contentSha256: value.content_sha256,
    headingPath: value.heading_path as string[],
    locator: value.locator,
    embeddingModel: value.embedding_model,
    tokenCount: value.token_count as number | null,
    hasEmbedding: value.has_embedding,
  };
}

export function parseIngestionResumeState(
  response: unknown,
): KnowledgeIngestionResumeState {
  if (!Array.isArray(response) || response.length !== 1) {
    throw new IngestionResumeResponseError();
  }

  const row = response[0];
  if (!isRecord(row) || !Array.isArray(row.chunks)) {
    throw new IngestionResumeResponseError();
  }

  return {
    document: parseDocument(row.document),
    chunks: row.chunks.map(parseChunk),
  };
}

export async function getKnowledgeIngestionResumeState(
  documentId: string,
  options: ReadIngestionResumeStateOptions = {},
): Promise<KnowledgeIngestionResumeState> {
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    throw new IngestionResumeRequestError(
      "documentId must be a UUID string.",
    );
  }

  const { signal, ...clientOptions } = options;
  const client = createSupabaseServerClient(clientOptions);
  const response = await client.requestJson<unknown>(RESUME_RPC_PATH, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId }),
    signal,
  });

  return parseIngestionResumeState(response);
}
