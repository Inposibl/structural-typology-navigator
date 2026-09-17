import {
  SOURCE_KINDS,
  type JsonObject,
  type JsonValue,
  type NormalizedKnowledgeDocument,
  type SourceKind,
} from "./types.ts";
import { hasSourceContent } from "./normalization.ts";

export function isSourceKind(value: string): value is SourceKind {
  return SOURCE_KINDS.includes(value as SourceKind);
}

function isJsonValue(value: unknown, seen: Set<object>): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const valid = value.every((item) => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return false;
  }

  const valid = Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

export function assertJsonObject(
  value: unknown,
  fieldName: string,
): asserts value is JsonObject {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !isJsonValue(value, new Set())
  ) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
}

function assertRequiredText(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required and cannot be blank.`);
  }
}

function assertOptionalText(value: unknown, fieldName: string): void {
  if (value !== undefined) {
    assertRequiredText(value, fieldName);
  }
}

export function assertNormalizedKnowledgeDocument(
  document: NormalizedKnowledgeDocument,
): void {
  assertRequiredText(document.sourceSlug, "sourceSlug");
  assertRequiredText(document.sourceTitle, "sourceTitle");
  assertRequiredText(document.language, "language");
  assertOptionalText(document.author, "author");
  assertOptionalText(document.versionLabel, "versionLabel");
  assertOptionalText(document.originalFilename, "originalFilename");
  assertOptionalText(document.mimeType, "mimeType");

  if (!isSourceKind(document.sourceKind)) {
    throw new Error(
      `sourceKind must be one of: ${SOURCE_KINDS.join(", ")}.`,
    );
  }

  assertJsonObject(document.documentMetadata, "documentMetadata");

  if (!Array.isArray(document.blocks) || document.blocks.length === 0) {
    throw new Error("Document must contain at least one non-blank block.");
  }

  document.blocks.forEach((block, index) => {
    if (!Number.isInteger(block.blockIndex) || block.blockIndex !== index) {
      throw new Error(
        "Block indices must be unique and sequential starting from 0.",
      );
    }

    if (typeof block.text !== "string" || !hasSourceContent(block.text)) {
      throw new Error(`Block ${index} is blank.`);
    }

    if (
      !Array.isArray(block.headingPath) ||
      block.headingPath.some(
        (heading) => typeof heading !== "string" || heading.trim().length === 0,
      )
    ) {
      throw new Error(`Block ${index} has an invalid headingPath.`);
    }

    assertJsonObject(block.locator, `Block ${index} locator`);
    assertJsonObject(block.metadata, `Block ${index} metadata`);
  });
}
