import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  adaptMarkdownDocument,
  adaptPlainTextDocument,
  assertJsonObject,
  buildIngestionPlan,
  isSourceKind,
  type CharacterChunkingConfigInput,
  type JsonObject,
  type NormalizedKnowledgeDocumentMetadata,
} from "../src/lib/ingestion/index.ts";

type CliOptions = {
  inputPath: string;
  values: Record<string, string>;
};

const VALUE_FLAGS = new Set([
  "--metadata-file",
  "--source-slug",
  "--source-title",
  "--source-kind",
  "--language",
  "--author",
  "--version-label",
  "--target-characters",
  "--hard-maximum-characters",
  "--overlap-characters",
]);

function usage(): string {
  return [
    "Usage: npm run ingest:plan -- <file.md|file.txt> [metadata options]",
    "Required via flags or --metadata-file: --source-slug, --source-title, --source-kind, --language",
  ].join("\n");
}

function parseArguments(arguments_: string[]): CliOptions {
  const [inputPath, ...remaining] = arguments_;
  if (!inputPath || inputPath.startsWith("--")) {
    throw new Error(usage());
  }

  const values: Record<string, string> = {};
  for (let index = 0; index < remaining.length; index += 2) {
    const flag = remaining[index];
    const value = remaining[index + 1];
    if (!VALUE_FLAGS.has(flag) || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid or incomplete option: ${flag ?? "(missing)"}.\n${usage()}`);
    }
    if (values[flag] !== undefined) {
      throw new Error(`Option may only be provided once: ${flag}.`);
    }
    values[flag] = value;
  }

  return {
    inputPath,
    values,
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required metadata: ${field}.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireText(value, field);
}

function requireJsonObject(value: unknown, field: string): JsonObject {
  assertJsonObject(value, field);
  return value;
}

async function readSidecar(metadataFile: string | undefined): Promise<JsonObject> {
  if (!metadataFile) {
    return {};
  }
  const raw = await readFile(path.resolve(metadataFile), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Metadata file must contain valid JSON.");
  }
  return requireJsonObject(parsed, "Metadata file");
}

function parseOptionalInteger(
  value: string | undefined,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  return Number(value);
}

function safeOutputName(sourceSlug: string): string {
  const safe = sourceSlug
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return safe || "document";
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const absoluteInputPath = path.resolve(options.inputPath);
  const extension = path.extname(absoluteInputPath).toLowerCase();
  if (extension !== ".md" && extension !== ".txt") {
    throw new Error("Unsupported file extension. Only .md and .txt are accepted.");
  }

  const sidecar = await readSidecar(options.values["--metadata-file"]);
  const fromFlag = (flag: string, sidecarKey: string): unknown =>
    options.values[flag] ?? sidecar[sidecarKey];

  const sourceKind = requireText(
    fromFlag("--source-kind", "sourceKind"),
    "sourceKind",
  );
  if (!isSourceKind(sourceKind)) {
    throw new Error(`Invalid sourceKind: ${sourceKind}.`);
  }

  const author = optionalText(fromFlag("--author", "author"), "author");
  const versionLabel = optionalText(
    fromFlag("--version-label", "versionLabel"),
    "versionLabel",
  );

  const metadata: NormalizedKnowledgeDocumentMetadata = {
    sourceSlug: requireText(
      fromFlag("--source-slug", "sourceSlug"),
      "sourceSlug",
    ),
    sourceTitle: requireText(
      fromFlag("--source-title", "sourceTitle"),
      "sourceTitle",
    ),
    sourceKind,
    language: requireText(fromFlag("--language", "language"), "language"),
    ...(author === undefined ? {} : { author }),
    ...(versionLabel === undefined ? {} : { versionLabel }),
    originalFilename: path.basename(absoluteInputPath),
    mimeType: extension === ".md" ? "text/markdown" : "text/plain",
    documentMetadata:
      sidecar.documentMetadata === undefined
        ? {}
        : requireJsonObject(sidecar.documentMetadata, "documentMetadata"),
  };

  const chunking: CharacterChunkingConfigInput = {};
  const targetCharacters = parseOptionalInteger(
    options.values["--target-characters"],
    "targetCharacters",
  );
  const hardMaximumCharacters = parseOptionalInteger(
    options.values["--hard-maximum-characters"],
    "hardMaximumCharacters",
  );
  const overlapCharacters = parseOptionalInteger(
    options.values["--overlap-characters"],
    "overlapCharacters",
  );
  if (targetCharacters !== undefined) chunking.targetCharacters = targetCharacters;
  if (hardMaximumCharacters !== undefined) {
    chunking.hardMaximumCharacters = hardMaximumCharacters;
  }
  if (overlapCharacters !== undefined) chunking.overlapCharacters = overlapCharacters;

  const input = await readFile(absoluteInputPath, "utf8");
  const document =
    extension === ".md"
      ? adaptMarkdownDocument(input, metadata)
      : adaptPlainTextDocument(input, metadata);
  const plan = buildIngestionPlan(document, chunking);

  const outputDirectory = path.resolve(".ingestion-plans");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(
    outputDirectory,
    `${safeOutputName(metadata.sourceSlug)}-${plan.normalizedContentSha256.slice(0, 12)}.json`,
  );
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  console.log(`Файл: ${metadata.originalFilename}`);
  console.log(`Источник: ${metadata.sourceSlug}`);
  console.log(`SHA-256: ${plan.normalizedContentSha256}`);
  console.log(`Символов: ${plan.totalNormalizedCharacterCount}`);
  console.log(`Блоков: ${plan.blockCount}`);
  console.log(`Чанков: ${plan.chunkCount}`);
  console.log(`План: ${path.relative(process.cwd(), outputPath)}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown ingestion error.";
  console.error(`Ошибка: ${message}`);
  process.exitCode = 1;
});
