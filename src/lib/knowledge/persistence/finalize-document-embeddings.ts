import {
  createSupabaseServerClient,
  type SupabaseServerClientOptions,
} from "../../supabase/server/http-client.ts";

const FINALIZE_RPC_PATH =
  "/rest/v1/rpc/finalize_knowledge_document_embeddings";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type FinalizeChunkEmbedding = {
  chunkIndex: number;
  contentSha256: string;
  embedding: readonly number[];
};

export type FinalizeDocumentEmbeddingsInput = {
  documentId: string;
  embeddingModel: string;
  embeddings: readonly FinalizeChunkEmbedding[];
};

export type FinalizeDocumentEmbeddingsResult = {
  status: "finalized" | "already_ready";
  documentId: string;
  chunkCount: number;
};

export type FinalizeDocumentEmbeddingsOptions =
  SupabaseServerClientOptions & {
    signal?: AbortSignal;
  };

export class FinalizeRequestError extends Error {
  readonly code = "INVALID_FINALIZE_REQUEST";

  constructor(message: string) {
    super(message);
    this.name = "FinalizeRequestError";
  }
}

export class FinalizeResponseError extends Error {
  readonly code = "INVALID_FINALIZE_RESPONSE";

  constructor() {
    super("Supabase finalization RPC returned an invalid response.");
    this.name = "FinalizeResponseError";
  }
}

type RpcResultRow = {
  result_status: "finalized" | "already_ready";
  finalized_document_id: string;
  chunk_count: number;
};

function isRpcResultRow(value: unknown): value is RpcResultRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const row = value as Partial<RpcResultRow>;
  return (
    (row.result_status === "finalized" ||
      row.result_status === "already_ready") &&
    typeof row.finalized_document_id === "string" &&
    UUID_PATTERN.test(row.finalized_document_id) &&
    Number.isInteger(row.chunk_count) &&
    (row.chunk_count ?? -1) >= 0
  );
}

// The database owns the embedding identity contract, so the wire payload keeps
// the exact snake_case field names the finalization RPC requires.
function buildFinalizePayload(input: FinalizeDocumentEmbeddingsInput): {
  document_id: string;
  embedding_model: string;
  embeddings: Array<{
    chunk_index: number;
    content_sha256: string;
    embedding: number[];
  }>;
} {
  return {
    document_id: input.documentId,
    embedding_model: input.embeddingModel,
    embeddings: input.embeddings.map((embedding) => ({
      chunk_index: embedding.chunkIndex,
      content_sha256: embedding.contentSha256,
      embedding: [...embedding.embedding],
    })),
  };
}

export async function finalizeKnowledgeDocumentEmbeddings(
  input: FinalizeDocumentEmbeddingsInput,
  options: FinalizeDocumentEmbeddingsOptions = {},
): Promise<FinalizeDocumentEmbeddingsResult> {
  if (
    typeof input.documentId !== "string" ||
    !UUID_PATTERN.test(input.documentId)
  ) {
    throw new FinalizeRequestError("documentId must be a UUID string.");
  }
  if (
    typeof input.embeddingModel !== "string" ||
    input.embeddingModel.trim().length === 0
  ) {
    throw new FinalizeRequestError(
      "embeddingModel is required and cannot be blank.",
    );
  }
  if (!Array.isArray(input.embeddings) || input.embeddings.length === 0) {
    throw new FinalizeRequestError(
      "embeddings must contain at least one chunk embedding.",
    );
  }

  const { signal, ...clientOptions } = options;
  const client = createSupabaseServerClient(clientOptions);
  const response = await client.requestJson<unknown>(FINALIZE_RPC_PATH, {
    method: "POST",
    body: JSON.stringify(buildFinalizePayload(input)),
    signal,
  });

  if (
    !Array.isArray(response) ||
    response.length !== 1 ||
    !isRpcResultRow(response[0]) ||
    response[0].finalized_document_id !== input.documentId
  ) {
    throw new FinalizeResponseError();
  }

  return {
    status: response[0].result_status,
    documentId: response[0].finalized_document_id,
    chunkCount: response[0].chunk_count,
  };
}
