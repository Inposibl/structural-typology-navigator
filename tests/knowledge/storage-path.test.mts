import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  adaptMarkdownDocument,
  buildIngestionPlan,
} from "../../src/lib/ingestion/index.ts";
import { buildSupabaseIngestionPayload } from "../../src/lib/knowledge/persistence/payload.ts";
import {
  buildOriginalFileStoragePath,
  isPhysicalStorageSegment,
} from "../../src/lib/knowledge/persistence/storage-path.ts";

const DOCUMENT_SHA = "a".repeat(64);
const UNICODE_FILENAME = "Лекция № 1 — Введение.md";
const UNICODE_SLUG = "синтетический-курс";
const PHYSICAL_PATH_PATTERN =
  /^sources\/[A-Za-z0-9._-]+\/[0-9a-f]{64}\/[A-Za-z0-9._-]+$/u;
const PHYSICAL_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

function digestOf(value: string): string {
  return createHash("sha256").update(value.normalize("NFC"), "utf8").digest("hex");
}

function physicalSegments(storagePath: string): string[] {
  return storagePath.split("/").slice(1);
}

test("builds deterministic physical segments for ASCII values", () => {
  const first = buildOriginalFileStoragePath(
    "academy-course",
    DOCUMENT_SHA,
    "lecture-01.md",
  );
  const second = buildOriginalFileStoragePath(
    "academy-course",
    DOCUMENT_SHA,
    "lecture-01.md",
  );

  assert.equal(first, second);
  assert.equal(
    first,
    `sources/academy-course--${digestOf("academy-course")}/${DOCUMENT_SHA}/lecture-01.md--${digestOf("lecture-01.md")}`,
  );
});

test("encodes a Cyrillic source slug into the ASCII physical class", () => {
  const storagePath = buildOriginalFileStoragePath(
    UNICODE_SLUG,
    DOCUMENT_SHA,
    "lecture.md",
  );
  const [sourceSegment] = physicalSegments(storagePath);

  assert.match(sourceSegment, PHYSICAL_SEGMENT_PATTERN);
  assert.ok(!/[^\u0000-\u007f]/u.test(sourceSegment));
  assert.ok(sourceSegment.endsWith(`--${digestOf(UNICODE_SLUG)}`));
});

test("encodes a Cyrillic filename into the ASCII physical class", () => {
  const storagePath = buildOriginalFileStoragePath(
    "academy-course",
    DOCUMENT_SHA,
    "Лекция.md",
  );
  const filenameSegment = physicalSegments(storagePath)[2];

  assert.match(filenameSegment, PHYSICAL_SEGMENT_PATTERN);
  assert.ok(!/[^\u0000-\u007f]/u.test(filenameSegment));
  assert.ok(filenameSegment.endsWith(`--${digestOf("Лекция.md")}`));
});

test("encodes a mixed Unicode filename into a Storage-safe segment", () => {
  const storagePath = buildOriginalFileStoragePath(
    "academy-course",
    DOCUMENT_SHA,
    UNICODE_FILENAME,
  );
  const filenameSegment = physicalSegments(storagePath)[2];

  assert.equal(
    filenameSegment,
    `1-.md--${digestOf(UNICODE_FILENAME)}`,
  );
  assert.match(filenameSegment, PHYSICAL_SEGMENT_PATTERN);
  assert.ok(!storagePath.includes("%"));
  assert.match(storagePath, PHYSICAL_PATH_PATTERN);
});

test("keeps the original Unicode filename in the persistence payload", () => {
  const plan = buildUnicodePlan();
  const payload = buildSupabaseIngestionPayload(plan);

  assert.equal(payload.document.original_filename, UNICODE_FILENAME);
  assert.equal(
    payload.document.storage_path,
    buildOriginalFileStoragePath(
      UNICODE_SLUG,
      plan.normalizedContentSha256,
      UNICODE_FILENAME,
    ),
  );
  assert.match(payload.document.storage_path ?? "", PHYSICAL_PATH_PATTERN);
  assert.ok(!(payload.document.storage_path ?? "").includes("%"));
});

test("keeps the canonical source slug in the persistence payload", () => {
  const plan = buildUnicodePlan();
  const payload = buildSupabaseIngestionPayload(plan);

  assert.equal(payload.source.slug, UNICODE_SLUG);
  assert.equal(plan.source.slug, UNICODE_SLUG);
  assert.equal(plan.documentIdentity.sourceSlug, UNICODE_SLUG);
});

test("keeps Unicode names that collapse to the same hint distinguishable", () => {
  const lecture = buildOriginalFileStoragePath(
    "academy-course",
    DOCUMENT_SHA,
    "Лекция.md",
  );
  const section = buildOriginalFileStoragePath(
    "academy-course",
    DOCUMENT_SHA,
    "Секция.md",
  );

  assert.notEqual(lecture, section);
  const lectureFilename = physicalSegments(lecture)[2];
  const sectionFilename = physicalSegments(section)[2];
  assert.notEqual(lectureFilename, sectionFilename);
  assert.equal(lectureFilename.split("--")[0], sectionFilename.split("--")[0]);
});

test("treats NFC-equivalent logical values as the same physical key", () => {
  const composed = "Ёлка № 1.md";
  const decomposed = composed.normalize("NFD");

  assert.notEqual(decomposed, composed);
  assert.equal(
    buildOriginalFileStoragePath("academy-course", DOCUMENT_SHA, decomposed),
    buildOriginalFileStoragePath("academy-course", DOCUMENT_SHA, composed),
  );
});

test("keeps distinct NFC-normalized values distinct", () => {
  const paths = [
    "Лекция.md",
    "Секция.md",
    "Лекция 2.md",
    "Ёлка.md",
  ].map((filename) =>
    buildOriginalFileStoragePath("academy-course", DOCUMENT_SHA, filename),
  );

  assert.equal(new Set(paths).size, paths.length);
});

test("never lets separators or traversal survive in a physical segment", () => {
  const storagePath = buildOriginalFileStoragePath(
    "../academy\\course",
    DOCUMENT_SHA,
    "../../секция\\лекция.md",
  );

  assert.match(storagePath, PHYSICAL_PATH_PATTERN);
  assert.ok(!storagePath.includes("\\"));
  assert.ok(!storagePath.includes("../"));
  assert.ok(!storagePath.includes("%"));
  for (const segment of physicalSegments(storagePath)) {
    assert.match(segment, PHYSICAL_SEGMENT_PATTERN);
    assert.notEqual(segment, ".");
    assert.notEqual(segment, "..");
  }
});

test("keeps the document hash segment unchanged in the physical path", () => {
  const storagePath = buildOriginalFileStoragePath(
    UNICODE_SLUG,
    DOCUMENT_SHA,
    UNICODE_FILENAME,
  );

  assert.equal(physicalSegments(storagePath)[1], DOCUMENT_SHA);
  assert.match(storagePath, PHYSICAL_PATH_PATTERN);
});

test("falls back to a plain hint when no ASCII characters remain", () => {
  const storagePath = buildOriginalFileStoragePath(
    "академия",
    DOCUMENT_SHA,
    "лекция.md",
  );
  const [sourceSegment] = physicalSegments(storagePath);

  assert.equal(sourceSegment, `u--${digestOf("академия")}`);
  assert.ok(isPhysicalStorageSegment(sourceSegment));
});

test("rejects blank segments", () => {
  assert.throws(
    () => buildOriginalFileStoragePath("   ", DOCUMENT_SHA, "lecture.md"),
    /sourceSlug must contain a safe path segment/u,
  );
  assert.throws(
    () => buildOriginalFileStoragePath("academy-course", DOCUMENT_SHA, " "),
    /originalFilename must contain a safe path segment/u,
  );
});

test("recognizes only Supabase-safe physical segments", () => {
  assert.ok(isPhysicalStorageSegment("lecture-01.md--abc"));
  assert.ok(isPhysicalStorageSegment("u--abc"));
  assert.ok(!isPhysicalStorageSegment("Лекция.md"));
  assert.ok(!isPhysicalStorageSegment("lecture 01.md"));
  assert.ok(!isPhysicalStorageSegment("lecture%2001.md"));
  assert.ok(!isPhysicalStorageSegment("lecture/01.md"));
  assert.ok(!isPhysicalStorageSegment(""));
});

function buildUnicodePlan(): ReturnType<typeof buildIngestionPlan> {
  const document = adaptMarkdownDocument(
    "# Раздел\n\nПервый абзац.\n\nВторой абзац.",
    {
      sourceSlug: UNICODE_SLUG,
      sourceTitle: "Синтетический курс",
      sourceKind: "course",
      author: "Автор",
      language: "ru",
      versionLabel: "v1",
      originalFilename: UNICODE_FILENAME,
      mimeType: "text/markdown",
      documentMetadata: { synthetic: true },
    },
  );

  return buildIngestionPlan(document, {
    targetCharacters: 25,
    hardMaximumCharacters: 40,
    overlapCharacters: 5,
  });
}
