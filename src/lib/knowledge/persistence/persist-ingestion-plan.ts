import type { IngestionPlan } from "../../ingestion/index.ts";
import {
  createSupabaseServerClient,
  SupabaseRequestError,
  type SupabaseServerClientOptions,
} from "../../supabase/server/http-client.ts";
import {
  buildSupabaseIngestionPayload,
  type SupabaseIngestionPayload,
} from "./payload.ts";

const INGESTION_RPC_PATH =
  "/rest/v1/rpc/persist_knowledge_ingestion_plan";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type PersistenceStatus = "already_exists" | "inserted";

export type PersistIngestionOptions = SupabaseServerClientOptions & {
  signal?: AbortSignal;
};

export type PersistIngestionResult = {
  status: PersistenceStatus;
  sourceId: string;
  documentId: string;
  chunkCount: number;
};

type RpcResultRow = {
  source_id: string;
  document_id: string;
  result_status: PersistenceStatus;
  chunk_count: number;
};

export class PersistenceResponseError extends Error {
  readonly code = "INVALID_INGESTION_RPC_RESPONSE";

  constructor() {
    super("Supabase ingestion RPC returned an invalid response.");
    this.name = "PersistenceResponseError";
  }
}

export class KnowledgeIdentityConflictError extends Error {
  readonly code = "KNOWLEDGE_IDENTITY_CONFLICT";

  constructor() {
    super("Knowledge source or document identity conflicts with existing data.");
    this.name = "KnowledgeIdentityConflictError";
  }
}

function isRpcResultRow(value: unknown): value is RpcResultRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const row = value as Partial<RpcResultRow>;
  return (
    typeof row.source_id === "string" &&
    UUID_PATTERN.test(row.source_id) &&
    typeof row.document_id === "string" &&
    UUID_PATTERN.test(row.document_id) &&
    (row.result_status === "inserted" ||
      row.result_status === "already_exists") &&
    Number.isInteger(row.chunk_count) &&
    (row.chunk_count ?? -1) >= 0
  );
}

function parseRpcResult(
  response: unknown,
  payload: SupabaseIngestionPayload,
): PersistIngestionResult {
  if (
    !Array.isArray(response) ||
    response.length !== 1 ||
    !isRpcResultRow(response[0])
  ) {
    throw new PersistenceResponseError();
  }

  const row = response[0];
  if (
    row.result_status === "inserted" &&
    row.chunk_count !== payload.chunks.length
  ) {
    throw new PersistenceResponseError();
  }

  return {
    status: row.result_status,
    sourceId: row.source_id,
    documentId: row.document_id,
    chunkCount: row.chunk_count,
  };
}

export async function persistIngestionPlan(
  plan: IngestionPlan,
  options: PersistIngestionOptions = {},
): Promise<PersistIngestionResult> {
  const payload = buildSupabaseIngestionPayload(plan);
  const { signal, ...clientOptions } = options;
  const client = createSupabaseServerClient(clientOptions);
  let response: unknown;
  try {
    response = await client.requestJson<unknown>(INGESTION_RPC_PATH, {
      method: "POST",
      body: JSON.stringify({ ingestion_plan: payload }),
      signal,
    });
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status === 409) {
      throw new KnowledgeIdentityConflictError();
    }
    throw error;
  }

  return parseRpcResult(response, payload);
}
