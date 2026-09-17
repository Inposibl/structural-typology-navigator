import { chunkNormalizedBlocks, resolveChunkingConfig } from "./chunker.ts";
import { sha256Hex } from "./hash.ts";
import { normalizeBlockText } from "./normalization.ts";
import type {
  CharacterChunkingConfigInput,
  IngestionPlan,
  NormalizedKnowledgeDocument,
} from "./types.ts";
import { assertNormalizedKnowledgeDocument } from "./validation.ts";

function trimmed(value: string | undefined): string | undefined {
  return value?.trim();
}

export function buildIngestionPlan(
  input: NormalizedKnowledgeDocument,
  chunkingInput: CharacterChunkingConfigInput = {},
): IngestionPlan {
  assertNormalizedKnowledgeDocument(input);

  const document: NormalizedKnowledgeDocument = {
    ...input,
    sourceSlug: input.sourceSlug.trim(),
    sourceTitle: input.sourceTitle.trim(),
    language: input.language.trim(),
    author: trimmed(input.author),
    versionLabel: trimmed(input.versionLabel),
    originalFilename: trimmed(input.originalFilename),
    mimeType: trimmed(input.mimeType),
    blocks: input.blocks.map((block) => ({
      ...block,
      text: normalizeBlockText(block.text),
      headingPath: block.headingPath.map((heading) => heading.trim()),
    })),
  };

  assertNormalizedKnowledgeDocument(document);
  const chunking = resolveChunkingConfig(chunkingInput);
  const { chunks, content } = chunkNormalizedBlocks(document.blocks, chunking);

  return {
    schemaVersion: 1,
    documentIdentity: {
      sourceSlug: document.sourceSlug,
      ...(document.versionLabel === undefined
        ? {}
        : { versionLabel: document.versionLabel }),
      ...(document.originalFilename === undefined
        ? {}
        : { originalFilename: document.originalFilename }),
      ...(document.mimeType === undefined ? {} : { mimeType: document.mimeType }),
    },
    normalizedContentSha256: sha256Hex(content),
    source: {
      slug: document.sourceSlug,
      title: document.sourceTitle,
      kind: document.sourceKind,
      ...(document.author === undefined ? {} : { author: document.author }),
      language: document.language,
    },
    documentMetadata: document.documentMetadata,
    chunking,
    chunks,
    blockCount: document.blocks.length,
    chunkCount: chunks.length,
    totalNormalizedCharacterCount: content.length,
  };
}
