import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  adaptMarkdownDocument,
  adaptPlainTextDocument,
  buildIngestionPlan,
  normalizeBlockText,
  normalizeDocumentInput,
  sha256Hex,
  type NormalizedKnowledgeDocument,
  type NormalizedKnowledgeDocumentMetadata,
} from "../../src/lib/ingestion/index.ts";

const BASE_METADATA: NormalizedKnowledgeDocumentMetadata = {
  sourceSlug: "synthetic-source",
  sourceTitle: "Синтетический источник",
  sourceKind: "article",
  language: "ru",
  documentMetadata: {},
};

const REPOSITORY_ROOT = process.cwd();
const TSX_IMPORT = createRequire(import.meta.url).resolve("tsx");
const CLI_SCRIPT = path.join(REPOSITORY_ROOT, "scripts", "ingest-plan.mts");
const SYNTHETIC_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "synthetic-academy-sample.md",
);

test("removes a BOM only at the original document boundary", () => {
  assert.equal(
    normalizeDocumentInput("\uFEFFПервая\r\nВторая\rТретья"),
    "Первая\nВторая\nТретья",
  );
  assert.equal(
    adaptPlainTextDocument("\uFEFFТекст.", BASE_METADATA).blocks[0].text,
    "Текст.",
  );
});

test("preserves internal BOM characters, including at an extracted block boundary", () => {
  const document = adaptPlainTextDocument(
    "Первый\uFEFFфрагмент.\n\n\uFEFFВторой фрагмент.",
    BASE_METADATA,
  );

  assert.equal(document.blocks[0].text, "Первый\uFEFFфрагмент.");
  assert.equal(document.blocks[1].text, "\uFEFFВторой фрагмент.");
  assert.equal(normalizeBlockText("\uFEFFАвторский знак"), "\uFEFFАвторский знак");

  const singleBlockDocument: NormalizedKnowledgeDocument = {
    ...BASE_METADATA,
    blocks: [
      {
        blockIndex: 0,
        text: "\uFEFFАвторский знак",
        headingPath: [],
        locator: {},
        metadata: {},
      },
    ],
  };
  assert.equal(
    buildIngestionPlan(singleBlockDocument).chunks[0].content,
    "\uFEFFАвторский знак",
  );
});

test("preserves author spacing, indentation, and line structure in plain text", () => {
  const document = adaptPlainTextDocument(
    "  Отступ и  два пробела\n\tСтрока с\tтабуляцией",
    BASE_METADATA,
  );

  assert.equal(
    document.blocks[0].text,
    "  Отступ и  два пробела\n\tСтрока с\tтабуляцией",
  );
  assert.equal(
    buildIngestionPlan(document).chunks[0].content,
    "  Отступ и  два пробела\n\tСтрока с\tтабуляцией",
  );
});

test("propagates Markdown ATX heading paths to following paragraphs", () => {
  const document = adaptMarkdownDocument(
    "# Раздел\n\nПервый абзац.\n\n## Подраздел\n\nВторой абзац.",
    BASE_METADATA,
  );

  assert.deepEqual(
    document.blocks.map((block) => ({
      text: block.text,
      headingPath: block.headingPath,
    })),
    [
      { text: "# Раздел", headingPath: ["Раздел"] },
      { text: "Первый абзац.", headingPath: ["Раздел"] },
      {
        text: "## Подраздел",
        headingPath: ["Раздел", "Подраздел"],
      },
      {
        text: "Второй абзац.",
        headingPath: ["Раздел", "Подраздел"],
      },
    ],
  );
});

test("preserves the source heading line while normalizing its hierarchy title", () => {
  const sourceHeading = "  ##   Заголовок   с   пробелами ###  ";
  const document = adaptMarkdownDocument(
    `${sourceHeading}\n\nТекст.`,
    BASE_METADATA,
  );

  assert.equal(document.blocks[0].text, sourceHeading);
  assert.deepEqual(document.blocks[0].headingPath, ["Заголовок с пробелами"]);
  assert.deepEqual(document.blocks[1].headingPath, ["Заголовок с пробелами"]);
});

test("preserves Markdown hard-break spaces and leading indentation", () => {
  const document = adaptMarkdownDocument(
    "# Раздел\n\n  первая строка  \n    строка с отступом",
    BASE_METADATA,
  );

  assert.equal(
    document.blocks[1].text,
    "  первая строка  \n    строка с отступом",
  );
  assert.match(
    buildIngestionPlan(document).chunks[0].content,
    /  первая строка  \n    строка с отступом$/u,
  );
});

test("keeps heading paths dense when Markdown skips heading levels", () => {
  const document = adaptMarkdownDocument(
    "### Глубокий заголовок\n\nТекст.",
    BASE_METADATA,
  );

  assert.deepEqual(document.blocks[0].headingPath, ["Глубокий заголовок"]);
  assert.deepEqual(document.blocks[1].headingPath, ["Глубокий заголовок"]);
});

test("replaces a deeper skipped heading when a shallower heading follows", () => {
  const document = adaptMarkdownDocument(
    "### Глубокий\n\nТекст.\n\n## Средний\n\nПродолжение.",
    BASE_METADATA,
  );

  assert.deepEqual(document.blocks[2].headingPath, ["Средний"]);
  assert.deepEqual(document.blocks[3].headingPath, ["Средний"]);
});

test("keeps fenced Markdown with blank lines in one non-heading block", () => {
  const document = adaptMarkdownDocument(
    "# Раздел\n\n```text\n  строка\n\n# не заголовок\n```\n\nПосле блока.",
    BASE_METADATA,
  );

  assert.equal(document.blocks[1].metadata.blockType, "codeFence");
  assert.equal(document.blocks[1].text, "```text\n  строка\n\n# не заголовок\n```");
  assert.deepEqual(document.blocks[1].headingPath, ["Раздел"]);
  assert.deepEqual(document.blocks[2].headingPath, ["Раздел"]);
});

test("preserves one-based plain-text line provenance", () => {
  const document = adaptPlainTextDocument(
    "Первая строка\nвторая строка\n\nЧетвёртая строка",
    BASE_METADATA,
  );

  assert.deepEqual(
    document.blocks.map((block) => ({
      headingPath: block.headingPath,
      locator: block.locator,
    })),
    [
      {
        headingPath: [],
        locator: { format: "text", lineStart: 1, lineEnd: 2 },
      },
      {
        headingPath: [],
        locator: { format: "text", lineStart: 4, lineEnd: 4 },
      },
    ],
  );
});

test("emits stable sequential chunk indexes", () => {
  const document = adaptPlainTextDocument(
    "Первый короткий абзац.\n\nВторой короткий абзац.\n\nТретий короткий абзац.",
    BASE_METADATA,
  );
  const plan = buildIngestionPlan(document, {
    targetCharacters: 28,
    hardMaximumCharacters: 40,
    overlapCharacters: 6,
  });

  assert.ok(plan.chunks.length > 1);
  assert.deepEqual(
    plan.chunks.map((chunk) => chunk.chunkIndex),
    plan.chunks.map((_, index) => index),
  );
});

test("generates deterministic lowercase SHA-256 hashes", () => {
  const first = sha256Hex("детерминированный текст");
  const second = sha256Hex("детерминированный текст");

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("preserves every contributing block in multi-block chunk provenance", () => {
  const document = adaptPlainTextDocument(
    "Первый блок.\n\nВторой блок.",
    BASE_METADATA,
  );
  const plan = buildIngestionPlan(document, {
    targetCharacters: 100,
    hardMaximumCharacters: 120,
    overlapCharacters: 0,
  });

  assert.equal(plan.chunks.length, 1);
  assert.deepEqual(
    plan.chunks[0].locator.sources.map((source) => source.blockIndex),
    [0, 1],
  );
  assert.deepEqual(plan.chunks[0].locator.sourceBlockRange, {
    start: 0,
    end: 1,
  });
});

test("keeps overlap provenance aligned to the same source block", () => {
  const document = adaptPlainTextDocument(
    "Один два три четыре пять шесть семь восемь девять десять одиннадцать.",
    BASE_METADATA,
  );
  const plan = buildIngestionPlan(document, {
    targetCharacters: 32,
    hardMaximumCharacters: 40,
    overlapCharacters: 8,
  });

  const firstRange = plan.chunks[0].locator.sources[0].blockCharacterRange;
  const secondRange = plan.chunks[1].locator.sources[0].blockCharacterRange;

  assert.ok(secondRange.start < firstRange.end);
  assert.ok(secondRange.end > firstRange.end);
});

test("advances past an already-covered block boundary when overlap starts inside that block", () => {
  const document: NormalizedKnowledgeDocument = {
    ...BASE_METADATA,
    blocks: [
      {
        blockIndex: 0,
        text: "alpha beta gamma.",
        headingPath: [],
        locator: { format: "synthetic", block: 0 },
        metadata: {},
      },
      {
        blockIndex: 1,
        text: "delta ".repeat(30).trim(),
        headingPath: [],
        locator: { format: "synthetic", block: 1 },
        metadata: {},
      },
    ],
  };

  const plan = buildIngestionPlan(document, {
    targetCharacters: 30,
    hardMaximumCharacters: 40,
    overlapCharacters: 8,
  });

  assert.equal(plan.chunks[0].content, "alpha beta gamma.");
  assert.match(plan.chunks[1].content, /delta/u);
  assert.deepEqual(plan.chunks[1].locator.sourceBlockRange, {
    start: 0,
    end: 1,
  });
});

test("rejects empty input", () => {
  const document = adaptPlainTextDocument("\uFEFF \r\n\t", BASE_METADATA);

  assert.throws(
    () => buildIngestionPlan(document),
    /at least one non-blank block/i,
  );
});

test("rejects invalid required metadata", () => {
  const invalidDocument = adaptPlainTextDocument("Текст.", {
    ...BASE_METADATA,
    sourceKind: "book" as never,
  });

  assert.throws(
    () => buildIngestionPlan(invalidDocument),
    /sourceKind/i,
  );
});

test("rejects unbreakable content that exceeds the hard maximum", () => {
  const document = adaptPlainTextDocument("сверхдлинноесловобезпробелов", BASE_METADATA);

  assert.throws(
    () =>
      buildIngestionPlan(document, {
        targetCharacters: 10,
        hardMaximumCharacters: 15,
        overlapCharacters: 0,
      }),
    /hard maximum/i,
  );
});

test("rejects invalid character chunking configuration", () => {
  const document = adaptPlainTextDocument("Короткий текст.", BASE_METADATA);

  assert.throws(
    () =>
      buildIngestionPlan(document, {
        targetCharacters: 20,
        hardMaximumCharacters: 10,
        overlapCharacters: 0,
      }),
    /hardMaximumCharacters/i,
  );
  assert.throws(
    () =>
      buildIngestionPlan(document, {
        targetCharacters: 20,
        hardMaximumCharacters: 30,
        overlapCharacters: 20,
      }),
    /overlapCharacters/i,
  );
});

test("rejects blank and non-sequential normalized blocks", () => {
  const blankBlockDocument: NormalizedKnowledgeDocument = {
    ...BASE_METADATA,
    blocks: [
      {
        blockIndex: 0,
        text: "\t\n ",
        headingPath: [],
        locator: {},
        metadata: {},
      },
    ],
  };
  const skippedIndexDocument: NormalizedKnowledgeDocument = {
    ...BASE_METADATA,
    blocks: [
      {
        blockIndex: 1,
        text: "Непустой блок",
        headingPath: [],
        locator: {},
        metadata: {},
      },
    ],
  };

  assert.throws(() => buildIngestionPlan(blankBlockDocument), /block 0 is blank/i);
  assert.throws(
    () => buildIngestionPlan(skippedIndexDocument),
    /sequential/i,
  );
});

test("produces identical plans for identical input", () => {
  const document = adaptMarkdownDocument(
    "# Заголовок\n\nОдинаковый вход даёт одинаковый результат.",
    BASE_METADATA,
  );

  const first = buildIngestionPlan(document);
  const second = buildIngestionPlan(document);

  assert.deepEqual(first, second);
  assert.equal(first.normalizedContentSha256, second.normalizedContentSha256);
  assert.deepEqual(
    first.chunks.map((chunk) => chunk.contentSha256),
    second.chunks.map((chunk) => chunk.contentSha256),
  );
});

test("CLI rejects unsupported extensions before reading content", () => {
  const result = spawnSync(process.execPath, ["--import", TSX_IMPORT, CLI_SCRIPT, "package.json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only \.md and \.txt/i);
});

test("CLI rejects missing required metadata", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", TSX_IMPORT, CLI_SCRIPT, SYNTHETIC_FIXTURE],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required metadata/i);
});

test("CLI writes a valid local ingestion plan for explicit metadata", () => {
  const workingDirectory = mkdtempSync(path.join(tmpdir(), "navigator-ingestion-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        TSX_IMPORT,
        CLI_SCRIPT,
        SYNTHETIC_FIXTURE,
        "--source-slug",
        "synthetic-cli",
        "--source-title",
        "Синтетический CLI-тест",
        "--source-kind",
        "article",
        "--language",
        "ru",
      ],
      { cwd: workingDirectory, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const outputDirectory = path.join(workingDirectory, ".ingestion-plans");
    const outputFiles = readdirSync(outputDirectory);
    assert.equal(outputFiles.length, 1);
    const plan = JSON.parse(
      readFileSync(path.join(outputDirectory, outputFiles[0]), "utf8"),
    );
    assert.equal(plan.documentIdentity.sourceSlug, "synthetic-cli");
    assert.equal(plan.chunkCount, plan.chunks.length);
    assert.ok(plan.chunks.every((chunk: { locator: { sources: unknown[] } }) =>
      chunk.locator.sources.length > 0,
    ));
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
});
