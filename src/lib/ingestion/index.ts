export { adaptMarkdownDocument, adaptPlainTextDocument } from "./adapters.ts";
export { buildIngestionPlan } from "./build-ingestion-plan.ts";
export { DEFAULT_CHUNKING_CONFIG } from "./chunker.ts";
export { isSha256Hex, sha256Hex } from "./hash.ts";
export {
  hasSourceContent,
  normalizeBlockText,
  normalizeDocumentInput,
  normalizeNewlines,
} from "./normalization.ts";
export { assertJsonObject, isSourceKind } from "./validation.ts";
export type {
  CharacterChunkingConfig,
  CharacterChunkingConfigInput,
  ChunkLocator,
  ChunkMetadata,
  ChunkProvenanceSource,
  IngestionChunk,
  IngestionPlan,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  NormalizedKnowledgeBlock,
  NormalizedKnowledgeDocument,
  NormalizedKnowledgeDocumentMetadata,
  SourceKind,
} from "./types.ts";
