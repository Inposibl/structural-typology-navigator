export const SOURCE_KINDS = [
  "manuscript",
  "course",
  "presentation",
  "article",
  "lecture",
  "transcript",
  "website",
  "other",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type NormalizedKnowledgeDocumentMetadata = {
  sourceSlug: string;
  sourceTitle: string;
  sourceKind: SourceKind;
  author?: string;
  language: string;
  versionLabel?: string;
  originalFilename?: string;
  mimeType?: string;
  documentMetadata: JsonObject;
};

export type NormalizedKnowledgeBlock = {
  blockIndex: number;
  text: string;
  headingPath: string[];
  locator: JsonObject;
  metadata: JsonObject;
};

export type NormalizedKnowledgeDocument =
  NormalizedKnowledgeDocumentMetadata & {
    blocks: NormalizedKnowledgeBlock[];
  };

export type CharacterChunkingConfig = {
  strategy: "characters";
  targetCharacters: number;
  hardMaximumCharacters: number;
  overlapCharacters: number;
};

export type CharacterChunkingConfigInput = Partial<
  Omit<CharacterChunkingConfig, "strategy">
>;

export type ChunkProvenanceSource = {
  blockIndex: number;
  headingPath: string[];
  locator: JsonObject;
  blockCharacterRange: {
    start: number;
    end: number;
  };
};

export type ChunkLocator = {
  primary: JsonObject;
  sourceBlockRange: {
    start: number;
    end: number;
  };
  sources: ChunkProvenanceSource[];
};

export type ChunkMetadata = {
  sourceBlocks: Array<{
    blockIndex: number;
    metadata: JsonObject;
  }>;
};

export type IngestionChunk = {
  chunkIndex: number;
  content: string;
  headingPath: string[];
  locator: ChunkLocator;
  contentSha256: string;
  tokenCount: null;
  metadata: ChunkMetadata;
};

export type IngestionPlan = {
  schemaVersion: 1;
  documentIdentity: {
    sourceSlug: string;
    versionLabel?: string;
    originalFilename?: string;
    mimeType?: string;
  };
  normalizedContentSha256: string;
  source: {
    slug: string;
    title: string;
    kind: SourceKind;
    author?: string;
    language: string;
  };
  documentMetadata: JsonObject;
  chunking: CharacterChunkingConfig;
  chunks: IngestionChunk[];
  blockCount: number;
  chunkCount: number;
  totalNormalizedCharacterCount: number;
};
