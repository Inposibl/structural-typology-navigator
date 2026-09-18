import { isSha256Hex, sha256Hex } from "../../ingestion/hash.ts";

export const ACADEMY_KNOWLEDGE_BUCKET = "academy-knowledge";

// Supabase Storage only accepts ASCII object keys, so each physical segment
// carries a conservative ASCII hint plus the full SHA-256 of the
// NFC-normalized logical value. The logical values stay untouched in
// knowledge_documents.original_filename and knowledge_sources.slug; the digest
// is what keeps distinct Unicode values distinct in the physical key.
const UNSUPPORTED_HINT_CHARACTERS = /[^A-Za-z0-9._-]+/gu;
const REPEATED_DOTS = /\.{2,}/gu;
const REPEATED_HYPHENS = /-{2,}/gu;
const HINT_EDGE_PUNCTUATION = /^[._-]+|[._-]+$/gu;
const PHYSICAL_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const EMPTY_HINT = "u";
const SEGMENT_SEPARATOR = "--";

export function isPhysicalStorageSegment(value: unknown): value is string {
  return typeof value === "string" && PHYSICAL_SEGMENT_PATTERN.test(value);
}

// The physical key contract: sources/<ascii-segment>/<document-sha256>/<ascii-segment>.
export function isDeterministicOriginalFileStoragePath(
  path: unknown,
  documentSha256: string,
): boolean {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }

  const segments = path.split("/");
  return (
    segments.length === 4 &&
    segments[0] === "sources" &&
    segments[2] === documentSha256 &&
    isSha256Hex(segments[2]) &&
    segments
      .slice(1)
      .every(
        (segment) =>
          isPhysicalStorageSegment(segment) &&
          segment !== "." &&
          segment !== "..",
      )
  );
}

function buildPhysicalStorageSegment(value: string, fieldName: string): string {
  const normalized = value.normalize("NFC");

  if (normalized.trim().length === 0) {
    throw new Error(`${fieldName} must contain a safe path segment.`);
  }

  const hint = normalized
    .replace(UNSUPPORTED_HINT_CHARACTERS, "-")
    .replace(REPEATED_DOTS, "-")
    .replace(REPEATED_HYPHENS, "-")
    .replace(HINT_EDGE_PUNCTUATION, "");

  return `${hint.length === 0 ? EMPTY_HINT : hint}${SEGMENT_SEPARATOR}${sha256Hex(
    normalized,
  )}`;
}

export function buildOriginalFileStoragePath(
  sourceSlug: string,
  documentSha256: string,
  originalFilename: string,
): string {
  if (!isSha256Hex(documentSha256)) {
    throw new Error("documentSha256 must be a lowercase SHA-256 value.");
  }

  const sourceSegment = buildPhysicalStorageSegment(sourceSlug, "sourceSlug");
  const filenameSegment = buildPhysicalStorageSegment(
    originalFilename,
    "originalFilename",
  );

  return `sources/${sourceSegment}/${documentSha256}/${filenameSegment}`;
}
