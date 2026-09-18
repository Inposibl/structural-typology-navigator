import { sha256Hex } from "./hash.ts";
import { hasSourceContent } from "./normalization.ts";
import type {
  CharacterChunkingConfig,
  CharacterChunkingConfigInput,
  IngestionChunk,
  NormalizedKnowledgeBlock,
} from "./types.ts";

export const DEFAULT_CHUNKING_CONFIG: CharacterChunkingConfig = {
  strategy: "characters",
  targetCharacters: 1_200,
  hardMaximumCharacters: 1_600,
  overlapCharacters: 160,
};

type BlockSpan = {
  block: NormalizedKnowledgeBlock;
  start: number;
  end: number;
};

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

export function resolveChunkingConfig(
  input: CharacterChunkingConfigInput = {},
): CharacterChunkingConfig {
  const config = { ...DEFAULT_CHUNKING_CONFIG, ...input };
  assertPositiveInteger(config.targetCharacters, "targetCharacters");
  assertPositiveInteger(config.hardMaximumCharacters, "hardMaximumCharacters");

  if (!Number.isInteger(config.overlapCharacters) || config.overlapCharacters < 0) {
    throw new Error("overlapCharacters must be a non-negative integer.");
  }
  if (config.hardMaximumCharacters < config.targetCharacters) {
    throw new Error("hardMaximumCharacters must be at least targetCharacters.");
  }
  if (config.overlapCharacters >= config.targetCharacters) {
    throw new Error("overlapCharacters must be smaller than targetCharacters.");
  }

  return config;
}

function buildCanonicalContent(blocks: NormalizedKnowledgeBlock[]): {
  content: string;
  spans: BlockSpan[];
} {
  let content = "";
  const spans: BlockSpan[] = [];

  for (const block of blocks) {
    if (content.length > 0) {
      content += "\n\n";
    }
    const start = content.length;
    content += block.text;
    spans.push({ block, start, end: content.length });
  }

  return { content, spans };
}

function firstSpanEndingAfter(spans: BlockSpan[], position: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (spans[middle].end <= position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function advancePastCanonicalSeparator(
  spans: BlockSpan[],
  position: number,
): number {
  const nextSpan = spans[firstSpanEndingAfter(spans, position)];
  return nextSpan !== undefined && position < nextSpan.start
    ? nextSpan.start
    : position;
}

function nearestBlockEnd(
  spans: BlockSpan[],
  start: number,
  preferredEnd: number,
  hardEnd: number,
  minimumEndExclusive: number,
): number | undefined {
  // Overlap may move the next chunk start back inside a block that the
  // previous chunk already finished. Never reuse that same block end.
  const first = firstSpanEndingAfter(
    spans,
    Math.max(start, minimumEndExclusive),
  );
  let low = first;
  let high = spans.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (spans[middle].end < preferredEnd) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const after = low < spans.length && spans[low].end <= hardEnd ? spans[low].end : undefined;
  const before = low > first ? spans[low - 1].end : undefined;
  if (before === undefined) return after;
  if (after === undefined) return before;
  return preferredEnd - before <= after - preferredEnd ? before : after;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{M}\p{N}_]/u.test(character);
}

function isWordBoundary(content: string, position: number): boolean {
  return !(
    isWordCharacter(content[position - 1]) && isWordCharacter(content[position])
  );
}

function moveOffLowSurrogate(content: string, position: number): number {
  if (position > 0 && position < content.length) {
    const code = content.charCodeAt(position);
    if (code >= 0xdc00 && code <= 0xdfff) {
      return position - 1;
    }
  }
  return position;
}

function findBreakAtOrBefore(
  content: string,
  start: number,
  preferredEnd: number,
): number | undefined {
  for (let position = moveOffLowSurrogate(content, preferredEnd); position > start; position -= 1) {
    if (isWordBoundary(content, position)) {
      return position;
    }
  }
  return undefined;
}

function findBreakAtOrAfter(
  content: string,
  start: number,
  maximumEnd: number,
): number | undefined {
  for (let position = start + 1; position <= maximumEnd; position += 1) {
    if (isWordBoundary(content, position)) {
      return moveOffLowSurrogate(content, position);
    }
  }
  return undefined;
}

function chooseEnd(
  content: string,
  spans: BlockSpan[],
  start: number,
  config: CharacterChunkingConfig,
  minimumEndExclusive: number,
): number {
  const hardEnd = Math.min(content.length, start + config.hardMaximumCharacters);
  if (hardEnd === content.length) {
    return hardEnd;
  }

  const preferredEnd = Math.min(content.length, start + config.targetCharacters);
  const progressFloor = Math.max(start, minimumEndExclusive);
  const blockEnd = nearestBlockEnd(
    spans,
    start,
    preferredEnd,
    hardEnd,
    minimumEndExclusive,
  );
  if (blockEnd !== undefined) {
    return blockEnd;
  }

  const before = findBreakAtOrBefore(content, progressFloor, preferredEnd);
  if (before !== undefined) {
    return before;
  }

  const after = findBreakAtOrAfter(
    content,
    Math.max(preferredEnd, progressFloor),
    hardEnd,
  );
  if (after !== undefined) {
    return after;
  }

  throw new Error(
    "A word exceeds the configured hard maximum; refusing to split it.",
  );
}

function chooseNextStart(
  content: string,
  currentStart: number,
  end: number,
  overlapCharacters: number,
): number {
  if (overlapCharacters === 0) {
    return end;
  }

  const preferred = Math.max(currentStart + 1, end - overlapCharacters);
  for (let position = preferred; position < end; position += 1) {
    if (isWordBoundary(content, position)) {
      return moveOffLowSurrogate(content, position);
    }
  }
  return end;
}

function longestCommonHeadingPath(spans: BlockSpan[]): string[] {
  if (spans.length === 0) {
    return [];
  }
  const first = spans[0].block.headingPath;
  const result: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    if (!spans.every((span) => span.block.headingPath[index] === first[index])) {
      break;
    }
    result.push(first[index]);
  }
  return result;
}

export function chunkNormalizedBlocks(
  blocks: NormalizedKnowledgeBlock[],
  config: CharacterChunkingConfig,
): { chunks: IngestionChunk[]; content: string } {
  const { content, spans } = buildCanonicalContent(blocks);
  const chunks: IngestionChunk[] = [];
  let cursor = 0;
  let previousEnd = -1;

  while (cursor < content.length) {
    cursor = advancePastCanonicalSeparator(spans, cursor);
    if (cursor >= content.length) {
      break;
    }

    const selectedEnd = chooseEnd(
      content,
      spans,
      cursor,
      config,
      previousEnd,
    );
    if (selectedEnd <= previousEnd) {
      throw new Error("Chunking did not advance the chunk end.");
    }
    const range = { start: cursor, end: selectedEnd };
    const chunkContent = content.slice(range.start, range.end);
    if (!hasSourceContent(chunkContent)) {
      throw new Error("Chunking produced a blank chunk.");
    }
    if (chunkContent.length > config.hardMaximumCharacters) {
      throw new Error("Chunking exceeded the configured hard maximum.");
    }

    const contributingSpans: BlockSpan[] = [];
    for (
      let spanIndex = firstSpanEndingAfter(spans, range.start);
      spanIndex < spans.length && spans[spanIndex].start < range.end;
      spanIndex += 1
    ) {
      contributingSpans.push(spans[spanIndex]);
    }
    if (contributingSpans.length === 0) {
      throw new Error("Chunking produced a chunk without source provenance.");
    }
    const sources = contributingSpans.map((span) => ({
      blockIndex: span.block.blockIndex,
      headingPath: [...span.block.headingPath],
      locator: span.block.locator,
      blockCharacterRange: {
        start: Math.max(range.start, span.start) - span.start,
        end: Math.min(range.end, span.end) - span.start,
      },
    }));

    chunks.push({
      chunkIndex: chunks.length,
      content: chunkContent,
      headingPath: longestCommonHeadingPath(contributingSpans),
      locator: {
        primary: contributingSpans[0].block.locator,
        sourceBlockRange: {
          start: contributingSpans[0].block.blockIndex,
          end: contributingSpans.at(-1)!.block.blockIndex,
        },
        sources,
      },
      contentSha256: sha256Hex(chunkContent),
      tokenCount: null,
      metadata: {
        sourceBlocks: contributingSpans.map((span) => ({
          blockIndex: span.block.blockIndex,
          metadata: span.block.metadata,
        })),
      },
    });

    previousEnd = selectedEnd;
    if (selectedEnd >= content.length) {
      break;
    }
    const nextCursor = chooseNextStart(
      content,
      cursor,
      selectedEnd,
      config.overlapCharacters,
    );
    if (nextCursor <= cursor) {
      throw new Error("Chunking did not make forward progress.");
    }
    cursor = advancePastCanonicalSeparator(spans, nextCursor);
  }

  return { chunks, content };
}
