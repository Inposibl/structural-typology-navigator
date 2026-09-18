import {
  assertJsonObject,
  hasSourceContent,
  isSha256Hex,
  isSourceKind,
  sha256Hex,
  type IngestionPlan,
  type JsonObject,
  type SourceKind,
} from "../../ingestion/index.ts";
import {
  ACADEMY_KNOWLEDGE_BUCKET,
  buildOriginalFileStoragePath,
} from "./storage-path.ts";

export const COHERE_EMBEDDING_MODEL = "cohere/embed-v4.0@1024";

export type SupabaseIngestionSourcePayload = {
  slug: string;
  title: string;
  author?: string;
  language: string;
  source_kind: SourceKind;
};

export type SupabaseIngestionDocumentPayload = {
  version_label: string | null;
  original_filename: string | null;
  mime_type: string | null;
  storage_bucket: typeof ACADEMY_KNOWLEDGE_BUCKET;
  storage_path: string | null;
  sha256: string;
  status: "processing";
  metadata: JsonObject;
};

export type SupabaseIngestionChunkPayload = {
  chunk_index: number;
  content: string;
  heading_path: string[];
  locator: JsonObject;
  content_sha256: string;
  token_count: null;
  embedding: null;
  embedding_model: typeof COHERE_EMBEDDING_MODEL;
  metadata: JsonObject;
};

export type SupabaseIngestionPayload = {
  source: SupabaseIngestionSourcePayload;
  document: SupabaseIngestionDocumentPayload;
  chunks: SupabaseIngestionChunkPayload[];
};

function requireText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required and cannot be blank.`);
  }
  return value;
}

function optionalText(value: unknown, fieldName: string): string | null {
  if (value === undefined) {
    return null;
  }
  return requireText(value, fieldName);
}

function requireSha256(value: unknown, fieldName: string): string {
  if (!isSha256Hex(value)) {
    throw new Error(`${fieldName} must be a lowercase SHA-256 value.`);
  }
  return value;
}

function validatePlan(plan: IngestionPlan): void {
  if (plan.schemaVersion !== 1) {
    throw new Error("Unsupported ingestion plan schemaVersion.");
  }

  const sourceSlug = requireText(plan.source.slug, "source.slug");
  requireText(plan.source.title, "source.title");
  requireText(plan.source.language, "source.language");
  optionalText(plan.source.author, "source.author");
  if (!isSourceKind(plan.source.kind)) {
    throw new Error("source.kind is invalid.");
  }
  if (plan.documentIdentity.sourceSlug !== sourceSlug) {
    throw new Error("documentIdentity.sourceSlug must match source.slug.");
  }

  optionalText(plan.documentIdentity.versionLabel, "documentIdentity.versionLabel");
  optionalText(
    plan.documentIdentity.originalFilename,
    "documentIdentity.originalFilename",
  );
  optionalText(plan.documentIdentity.mimeType, "documentIdentity.mimeType");
  requireSha256(plan.normalizedContentSha256, "normalizedContentSha256");
  assertJsonObject(plan.documentMetadata, "documentMetadata");

  if (!Array.isArray(plan.chunks) || plan.chunks.length === 0) {
    throw new Error("Ingestion plan must contain at least one chunk.");
  }
  if (plan.chunkCount !== plan.chunks.length) {
    throw new Error("chunkCount must match the number of chunks.");
  }

  plan.chunks.forEach((chunk, index) => {
    if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex !== index) {
      throw new Error("Chunks must be ordered sequentially starting at index 0.");
    }
    if (typeof chunk.content !== "string" || !hasSourceContent(chunk.content)) {
      throw new Error(`Chunk ${index} content cannot be blank.`);
    }
    if (
      !Array.isArray(chunk.headingPath) ||
      chunk.headingPath.some(
        (heading) =>
          typeof heading !== "string" || heading.trim().length === 0,
      )
    ) {
      throw new Error(`Chunk ${index} headingPath is invalid.`);
    }
    assertJsonObject(chunk.locator, `Chunk ${index} locator`);
    assertJsonObject(chunk.metadata, `Chunk ${index} metadata`);
    const contentSha256 = requireSha256(
      chunk.contentSha256,
      `Chunk ${index} contentSha256`,
    );
    if (contentSha256 !== sha256Hex(chunk.content)) {
      throw new Error(`Chunk ${index} contentSha256 does not match content.`);
    }
    if (chunk.tokenCount !== null) {
      throw new Error(`Chunk ${index} tokenCount must remain null.`);
    }
  });
}

export function buildSupabaseIngestionPayload(
  plan: IngestionPlan,
): SupabaseIngestionPayload {
  validatePlan(plan);
  const originalFilename = optionalText(
    plan.documentIdentity.originalFilename,
    "documentIdentity.originalFilename",
  );
  const author = optionalText(plan.source.author, "source.author");
  const storagePath =
    originalFilename === null
      ? null
      : buildOriginalFileStoragePath(
          plan.source.slug,
          plan.normalizedContentSha256,
          originalFilename,
        );

  return {
    source: {
      slug: plan.source.slug,
      title: plan.source.title,
      ...(author === null ? {} : { author }),
      language: plan.source.language,
      source_kind: plan.source.kind,
    },
    document: {
      version_label: optionalText(
        plan.documentIdentity.versionLabel,
        "documentIdentity.versionLabel",
      ),
      original_filename: originalFilename,
      mime_type: optionalText(
        plan.documentIdentity.mimeType,
        "documentIdentity.mimeType",
      ),
      storage_bucket: ACADEMY_KNOWLEDGE_BUCKET,
      storage_path: storagePath,
      sha256: plan.normalizedContentSha256,
      status: "processing",
      metadata: plan.documentMetadata,
    },
    chunks: plan.chunks.map((chunk) => ({
      chunk_index: chunk.chunkIndex,
      content: chunk.content,
      heading_path: [...chunk.headingPath],
      locator: chunk.locator,
      content_sha256: chunk.contentSha256,
      token_count: null,
      embedding: null,
      embedding_model: COHERE_EMBEDDING_MODEL,
      metadata: chunk.metadata,
    })),
  };
}
