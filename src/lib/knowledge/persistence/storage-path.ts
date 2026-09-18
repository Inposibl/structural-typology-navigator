import { isSha256Hex } from "../../ingestion/hash.ts";

export const ACADEMY_KNOWLEDGE_BUCKET = "academy-knowledge";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/gu;
const PATH_SEPARATORS = /[\\/]+/gu;
const TRAVERSAL_DOTS = /\.{2,}/gu;

function sanitizePathSegment(value: string, fieldName: string): string {
  const sanitized = value
    .normalize("NFC")
    .trim()
    .replace(CONTROL_CHARACTERS, "-")
    .replace(PATH_SEPARATORS, "-")
    .replace(TRAVERSAL_DOTS, "-")
    .replace(/^\.+|\.+$/gu, "");

  if (sanitized.length === 0 || sanitized === "." || sanitized === "..") {
    throw new Error(`${fieldName} must contain a safe path segment.`);
  }

  return sanitized;
}

export function buildOriginalFileStoragePath(
  sourceSlug: string,
  documentSha256: string,
  originalFilename: string,
): string {
  if (!isSha256Hex(documentSha256)) {
    throw new Error("documentSha256 must be a lowercase SHA-256 value.");
  }

  const safeSourceSlug = sanitizePathSegment(sourceSlug, "sourceSlug");
  const safeFilename = sanitizePathSegment(
    originalFilename,
    "originalFilename",
  );

  return `sources/${safeSourceSlug}/${documentSha256}/${safeFilename}`;
}
