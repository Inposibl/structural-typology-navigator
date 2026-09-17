import {
  hasSourceContent,
  normalizeBlockText,
  normalizeDocumentInput,
} from "./normalization.ts";
import type {
  NormalizedKnowledgeBlock,
  NormalizedKnowledgeDocument,
  NormalizedKnowledgeDocumentMetadata,
} from "./types.ts";

type PendingBlock = Omit<NormalizedKnowledgeBlock, "blockIndex">;

function finalizeDocument(
  metadata: NormalizedKnowledgeDocumentMetadata,
  blocks: PendingBlock[],
): NormalizedKnowledgeDocument {
  return {
    ...metadata,
    blocks: blocks.map((block, blockIndex) => ({ ...block, blockIndex })),
  };
}

function isBlank(line: string): boolean {
  return !hasSourceContent(line);
}

export function adaptPlainTextDocument(
  input: string,
  metadata: NormalizedKnowledgeDocumentMetadata,
): NormalizedKnowledgeDocument {
  const lines = normalizeDocumentInput(input).split("\n");
  const blocks: PendingBlock[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    while (lineIndex < lines.length && isBlank(lines[lineIndex])) {
      lineIndex += 1;
    }

    if (lineIndex >= lines.length) {
      break;
    }

    const start = lineIndex;
    while (lineIndex < lines.length && !isBlank(lines[lineIndex])) {
      lineIndex += 1;
    }

    const text = normalizeBlockText(lines.slice(start, lineIndex).join("\n"));
    if (text.length > 0) {
      blocks.push({
        text,
        headingPath: [],
        locator: {
          format: "text",
          lineStart: start + 1,
          lineEnd: lineIndex,
        },
        metadata: { blockType: "paragraph" },
      });
    }
  }

  return finalizeDocument(metadata, blocks);
}

const ATX_HEADING = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

function isClosingFence(line: string, marker: string, minimumLength: number): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= minimumLength &&
    [...trimmed].every((character) => character === marker)
  );
}

export function adaptMarkdownDocument(
  input: string,
  metadata: NormalizedKnowledgeDocumentMetadata,
): NormalizedKnowledgeDocument {
  const lines = normalizeDocumentInput(input).split("\n");
  const blocks: PendingBlock[] = [];
  const headings: Array<{ level: number; title: string }> = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    while (lineIndex < lines.length && isBlank(lines[lineIndex])) {
      lineIndex += 1;
    }

    if (lineIndex >= lines.length) {
      break;
    }

    const start = lineIndex;
    const openingFence = lines[lineIndex].match(FENCE);
    if (openingFence) {
      const marker = openingFence[1][0];
      const minimumLength = openingFence[1].length;
      lineIndex += 1;
      while (lineIndex < lines.length) {
        const closesFence = isClosingFence(
          lines[lineIndex],
          marker,
          minimumLength,
        );
        lineIndex += 1;
        if (closesFence) break;
      }

      blocks.push({
        text: normalizeBlockText(lines.slice(start, lineIndex).join("\n")),
        headingPath: headings.map((heading) => heading.title),
        locator: {
          format: "markdown",
          lineStart: start + 1,
          lineEnd: lineIndex,
        },
        metadata: { blockType: "codeFence" },
      });
      continue;
    }

    const headingMatch = lines[lineIndex].match(ATX_HEADING);
    if (headingMatch) {
      const level = headingMatch[2].length;
      const title = headingMatch[3]
        .replace(/[ \t]+#+[ \t]*$/u, "")
        .trim()
        .replace(/[ \t]+/gu, " ");

      if (title.length > 0) {
        while (
          headings.length > 0 &&
          headings[headings.length - 1].level >= level
        ) {
          headings.pop();
        }
        headings.push({ level, title });
        blocks.push({
          text: normalizeBlockText(lines[lineIndex]),
          headingPath: headings.map((heading) => heading.title),
          locator: {
            format: "markdown",
            lineStart: start + 1,
            lineEnd: start + 1,
          },
          metadata: { blockType: "heading", headingLevel: level },
        });
        lineIndex += 1;
        continue;
      }
    }

    while (lineIndex < lines.length && !isBlank(lines[lineIndex])) {
      if (
        lineIndex > start &&
        (ATX_HEADING.test(lines[lineIndex]) || FENCE.test(lines[lineIndex]))
      ) {
        break;
      }
      lineIndex += 1;
    }

    const rawText = lines.slice(start, lineIndex).join("\n");
    const text = normalizeBlockText(rawText);

    if (text.length > 0) {
      blocks.push({
        text,
        headingPath: headings.map((heading) => heading.title),
        locator: {
          format: "markdown",
          lineStart: start + 1,
          lineEnd: lineIndex,
        },
        metadata: { blockType: "paragraph" },
      });
    }
  }

  return finalizeDocument(metadata, blocks);
}
