import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260917224500_supabase_ingestion_foundation.sql",
);

const FINALIZATION_MIGRATION_PATH = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260918013644_storage_cohere_ingestion_finalization.sql",
);

const migration = readFileSync(MIGRATION_PATH, "utf8");
const finalizationMigration = readFileSync(FINALIZATION_MIGRATION_PATH, "utf8");

const resumeStart = finalizationMigration.indexOf(
  "create or replace function public.get_knowledge_ingestion_resume_state",
);
const finalizeStart = finalizationMigration.indexOf(
  "create or replace function public.finalize_knowledge_document_embeddings",
);
const resumeFunction = finalizationMigration.slice(resumeStart, finalizeStart);
const finalizeFunction = finalizationMigration.slice(finalizeStart);
const sourceResolutionStart = migration.indexOf(
  "insert into public.knowledge_sources",
);
const sourceResolutionEnd = migration.indexOf(
  "insert into public.knowledge_documents",
);
const sourceResolution = migration.slice(
  sourceResolutionStart,
  sourceResolutionEnd,
);

test("migration keeps the storage bucket private without object policies", () => {
  assert.match(migration, /'academy-knowledge'[\s\S]*public[\s\S]*false/iu);
  assert.match(migration, /file_size_limit\s*=\s*null/iu);
  assert.match(migration, /allowed_mime_types\s*=\s*null/iu);
  assert.doesNotMatch(migration, /create\s+policy/iu);
  assert.doesNotMatch(migration, /storage\.objects/iu);
});

test("migration exposes one invoker-only JSONB ingestion RPC", () => {
  assert.match(
    migration,
    /function\s+public\.persist_knowledge_ingestion_plan\(\s*ingestion_plan\s+jsonb\s*\)/iu,
  );
  assert.match(migration, /security\s+invoker/iu);
  assert.match(migration, /set\s+search_path\s*=\s*''/iu);
  assert.match(
    migration,
    /revoke\s+execute[\s\S]*from\s+public,\s*anon,\s*authenticated/iu,
  );
  assert.match(migration, /grant\s+execute[\s\S]*to\s+service_role/iu);
});

test("migration enforces pre-embedding and idempotency contracts", () => {
  assert.match(migration, /status[\s\S]*'processing'/iu);
  assert.doesNotMatch(migration, /status\s*=\s*'ready'/iu);
  assert.match(migration, /token_count[\s\S]*must be null/iu);
  assert.match(migration, /embedding[\s\S]*must be null/iu);
  assert.match(migration, /cohere\/embed-v4\.0@1024/u);
  assert.match(migration, /already_exists/u);
  assert.match(migration, /raise\s+sqlstate\s+'PT409'/iu);
  assert.match(migration, /pg_advisory_xact_lock/iu);
});

test("migration returns inserted only for a fresh ingestion", () => {
  assert.match(migration, /'inserted'::text/iu);
  assert.doesNotMatch(migration, /'created'::text/iu);
  assert.equal(migration.match(/'already_exists'::text/giu)?.length, 1);
});

test("migration creates new sources without accepting authoritative source metadata", () => {
  assert.ok(sourceResolutionStart >= 0);
  assert.ok(sourceResolutionEnd > sourceResolutionStart);
  assert.match(sourceResolution, /insert\s+into\s+public\.knowledge_sources/iu);
  assert.match(sourceResolution, /'\{\}'::jsonb/iu);
  assert.match(sourceResolution, /on\s+conflict\s*\(slug\)\s+do\s+nothing/iu);
  assert.match(
    migration,
    /Source metadata is not accepted by this ingestion contract\./u,
  );
});

test("migration preserves existing source metadata and absent authors", () => {
  assert.doesNotMatch(sourceResolution, /metadata\s*=\s*excluded\.metadata/iu);
  assert.doesNotMatch(sourceResolution, /title\s*=\s*excluded\.title/iu);
  assert.doesNotMatch(sourceResolution, /language\s*=\s*excluded\.language/iu);
  assert.doesNotMatch(sourceResolution, /source_kind\s*=\s*excluded\.source_kind/iu);
  assert.match(
    sourceResolution,
    /v_existing_source_author\s+is\s+null[\s\S]*v_incoming_author\s+is\s+not\s+null[\s\S]*update\s+public\.knowledge_sources[\s\S]*set\s+author\s*=\s*v_incoming_author/iu,
  );
  assert.equal(
    sourceResolution.match(/set\s+author\s*=/giu)?.length,
    1,
  );
});

test("migration fails closed on incompatible existing source identity", () => {
  assert.match(
    sourceResolution,
    /v_existing_source_title\s+is\s+distinct\s+from\s+\(v_source\s*->>\s*'title'\)/iu,
  );
  assert.match(
    sourceResolution,
    /v_existing_source_language\s+is\s+distinct\s+from\s+\(v_source\s*->>\s*'language'\)/iu,
  );
  assert.match(
    sourceResolution,
    /v_existing_source_kind\s+is\s+distinct\s+from\s+\(v_source\s*->>\s*'source_kind'\)/iu,
  );
  assert.match(
    sourceResolution,
    /v_existing_source_author\s+is\s+not\s+null[\s\S]*v_incoming_author\s+is\s+not\s+null[\s\S]*v_existing_source_author\s+is\s+distinct\s+from\s+v_incoming_author/iu,
  );
  assert.match(
    sourceResolution,
    /raise\s+sqlstate\s+'PT409'[\s\S]*Knowledge source identity conflict for existing slug\./iu,
  );
  assert.match(
    migration,
    /Document SHA-256 identity conflict across sources\./u,
  );
});

test("migration validates source identity before document hash idempotency", () => {
  const titleConflict = migration.indexOf("Source title does not match.");
  const languageConflict = migration.indexOf("Source language does not match.");
  const sourceKindConflict = migration.indexOf("Source kind does not match.");
  const authorConflict = migration.indexOf("Source author does not match.");
  const documentHashLock = migration.indexOf("pg_advisory_xact_lock");
  const idempotentReturn = migration.indexOf("'already_exists'::text");

  assert.ok(sourceResolutionStart >= 0);
  assert.ok(titleConflict > sourceResolutionStart);
  assert.ok(languageConflict > sourceResolutionStart);
  assert.ok(sourceKindConflict > sourceResolutionStart);
  assert.ok(authorConflict > sourceResolutionStart);
  assert.ok(documentHashLock > authorConflict);
  assert.ok(idempotentReturn >= 0);
  assert.ok(idempotentReturn > documentHashLock);
  assert.match(
    migration.slice(documentHashLock, sourceResolutionEnd),
    /if\s+found\s+then[\s\S]*v_existing_source_id\s*<>\s*v_source_id[\s\S]*Document SHA-256 identity conflict across sources\.[\s\S]*'already_exists'::text[\s\S]*return;/iu,
  );
});

test("finalization migration adds exactly two service-only invoker RPCs", () => {
  assert.ok(resumeStart >= 0);
  assert.ok(finalizeStart > resumeStart);
  assert.equal(
    finalizationMigration.match(/create\s+or\s+replace\s+function/giu)?.length,
    2,
  );
  for (const [name, body] of [
    ["get_knowledge_ingestion_resume_state", resumeFunction],
    ["finalize_knowledge_document_embeddings", finalizeFunction],
  ] as const) {
    assert.equal(
      body.match(/security\s+invoker/giu)?.length,
      1,
      `${name} must be SECURITY INVOKER`,
    );
    assert.equal(
      body.match(/set\s+search_path\s*=\s*''/giu)?.length,
      1,
      `${name} must pin an empty search_path`,
    );
  }
  assert.equal(
    finalizationMigration.match(
      /revoke\s+execute[\s\S]*?from\s+public,\s*anon,\s*authenticated/giu,
    )?.length,
    2,
  );
  assert.equal(
    finalizationMigration.match(
      /grant\s+execute[\s\S]*?to\s+service_role/giu,
    )?.length,
    2,
  );
  assert.match(
    finalizationMigration,
    /revoke\s+execute\s+on\s+function\s+public\.get_knowledge_ingestion_resume_state\(uuid\)\s+from\s+public,\s*anon,\s*authenticated/iu,
  );
  assert.match(
    finalizationMigration,
    /grant\s+execute\s+on\s+function\s+public\.get_knowledge_ingestion_resume_state\(uuid\)\s+to\s+service_role/iu,
  );
  assert.match(
    finalizationMigration,
    /revoke\s+execute\s+on\s+function\s+public\.finalize_knowledge_document_embeddings\(\s*uuid,\s*text,\s*jsonb\s*\)\s+from\s+public,\s*anon,\s*authenticated/iu,
  );
  assert.match(
    finalizationMigration,
    /grant\s+execute\s+on\s+function\s+public\.finalize_knowledge_document_embeddings\(\s*uuid,\s*text,\s*jsonb\s*\)\s+to\s+service_role/iu,
  );
});

test("finalization migration leaves the existing foundation contracts untouched", () => {
  assert.doesNotMatch(finalizationMigration, /persist_knowledge_ingestion_plan/iu);
  assert.doesNotMatch(finalizationMigration, /match_knowledge_chunks/iu);
  assert.doesNotMatch(finalizationMigration, /create\s+policy/iu);
  assert.doesNotMatch(finalizationMigration, /storage\.objects/iu);
  assert.doesNotMatch(finalizationMigration, /create\s+table|drop\s+/iu);
  assert.doesNotMatch(finalizationMigration, /original_file_sha256/iu);
  assert.match(
    finalizationMigration,
    /raw file identity belongs to the Storage upload step/iu,
  );
});

test("finalization migration constrains physical storage keys to the ASCII contract", () => {
  const constraintStart = finalizationMigration.indexOf(
    "add constraint knowledge_documents_storage_path_key_check",
  );
  const constraint = finalizationMigration.slice(
    finalizationMigration.indexOf("alter table public.knowledge_documents"),
    finalizationMigration.indexOf(
      "create or replace function public.get_knowledge_ingestion_resume_state",
    ),
  );

  assert.ok(constraintStart > 0);
  assert.equal(finalizationMigration.match(/alter\s+table/giu)?.length, 1);
  assert.match(constraint, /storage_path\s+is\s+null/iu);
  assert.ok(
    constraint.includes(
      "storage_path ~ '^sources/[A-Za-z0-9._-]+/[0-9a-f]{64}/[A-Za-z0-9._-]+$'",
    ),
    constraint,
  );
  assert.doesNotMatch(constraint, /original_filename/iu);
  assert.doesNotMatch(constraint, /slug/iu);
  assert.doesNotMatch(constraint, /cohere/iu);
});

test("resume RPC is a read-only ordered projection without embedding vectors", () => {
  assert.match(
    resumeFunction,
    /returns\s+table\s*\(\s*document\s+jsonb,\s*chunks\s+jsonb\s*\)/iu,
  );
  assert.match(resumeFunction, /language\s+plpgsql\s+stable/iu);
  assert.doesNotMatch(resumeFunction, /\bupdate\b|\binsert\s+into\b|\bdelete\s+from\b/iu);
  for (const field of [
    "document_id",
    "source_id",
    "status",
    "sha256",
    "storage_bucket",
    "storage_path",
    "original_filename",
    "mime_type",
    "version_label",
    "metadata",
  ]) {
    assert.match(resumeFunction, new RegExp(`'${field}',`, "u"));
  }
  for (const field of [
    "chunk_index",
    "content",
    "content_sha256",
    "heading_path",
    "locator",
    "embedding_model",
    "token_count",
    "has_embedding",
  ]) {
    assert.match(resumeFunction, new RegExp(`'${field}',`, "u"));
  }
  assert.match(
    resumeFunction,
    /'has_embedding',\s*chunk_rows\.embedding\s+is\s+not\s+null/iu,
  );
  assert.doesNotMatch(resumeFunction, /'embedding'\s*,/iu);
  assert.match(
    resumeFunction,
    /order\s+by\s+chunk_rows\.chunk_index/iu,
  );
  assert.match(resumeFunction, /does\s+not\s+exist/iu);
});

test("finalize RPC locks the document and fails closed on every invalid payload", () => {
  assert.match(finalizeFunction, /for\s+update/iu);
  assert.match(
    finalizeFunction,
    /v_expected_model\s+constant\s+text\s*:=\s*'cohere\/embed-v4\.0@1024'/u,
  );
  assert.match(
    finalizeFunction,
    /embedding_model\s+is\s+distinct\s+from\s+v_expected_model/iu,
  );
  assert.match(
    finalizeFunction,
    /v_status\s+not\s+in\s*\(\s*'processing'\s*,\s*'ready'\s*\)/iu,
  );
  assert.match(
    finalizeFunction,
    /jsonb_typeof\(embeddings\)\s+is\s+distinct\s+from\s+'array'/iu,
  );
  assert.match(finalizeFunction, /v_payload_count\s*<>\s*v_chunk_count/iu);
  assert.match(
    finalizeFunction,
    /jsonb_array_length\(items\.value\s*->\s*'embedding'\)\s*<>\s*1024/iu,
  );
  assert.match(finalizeFunction, /having\s+pg_catalog\.count\(\*\)\s*>\s*1/iu);
  assert.match(finalizeFunction, /is\s+missing\s+persisted\s+document\s+chunks/iu);
  assert.match(
    finalizeFunction,
    /does\s+not\s+match\s+persisted\s+document\s+%\s+chunks/iu,
  );
  assert.match(
    finalizeFunction,
    /get\s+diagnostics\s+v_updated_chunk_count\s*=\s*row_count/iu,
  );
  assert.match(finalizeFunction, /v_updated_chunk_count\s*<>\s*v_chunk_count/iu);
  assert.match(
    finalizeFunction,
    /chunk_rows\.embedding\s+is\s+null[\s\S]*chunk_rows\.embedding_model\s+is\s+distinct\s+from\s+v_expected_model/iu,
  );
  assert.equal(
    finalizeFunction.match(/update\s+public\.knowledge_chunks/giu)?.length,
    1,
  );
  assert.equal(
    finalizeFunction.match(/update\s+public\.knowledge_documents/giu)?.length,
    1,
  );
});

test("finalize RPC marks the document ready only after every embedding is stored", () => {
  const embeddingWrite = finalizeFunction.indexOf("set embedding =");
  const completenessGate = finalizeFunction.indexOf("without a % embedding");
  const readyTransition = finalizeFunction.indexOf("status = 'ready'");
  const ingestedAt = finalizeFunction.indexOf("ingested_at = pg_catalog.now()");
  const finalizedReturn = finalizeFunction.indexOf("'finalized'::text");

  assert.ok(embeddingWrite > 0);
  assert.ok(completenessGate > embeddingWrite);
  assert.ok(readyTransition > completenessGate);
  assert.ok(ingestedAt > readyTransition);
  assert.ok(finalizedReturn > ingestedAt);
  assert.equal(finalizeFunction.match(/set\s+embedding\s*=/giu)?.length, 1);
  assert.equal(finalizeFunction.match(/set\s+status\s*=\s*'ready'/giu)?.length, 1);
  assert.doesNotMatch(finalizeFunction, /set\s+status\s*=\s*'(?!ready)/iu);
});

test("finalize RPC returns finalized and already_ready without writing token counts", () => {
  assert.equal(finalizeFunction.match(/'finalized'::text/giu)?.length, 1);
  assert.equal(finalizeFunction.match(/'already_ready'::text/giu)?.length, 1);
  assert.doesNotMatch(finalizeFunction, /token_count\s*=/iu);
  assert.doesNotMatch(finalizeFunction, /embedding_model\s*=/iu);

  const readyBranch = finalizeFunction.indexOf("-- Already ready:");
  const readyConsistency = finalizeFunction.indexOf(
    "Ready document % has chunks without",
    readyBranch,
  );
  const alreadyReadyReturn = finalizeFunction.indexOf("'already_ready'::text");

  assert.ok(readyBranch > 0);
  assert.ok(readyConsistency > readyBranch);
  assert.ok(alreadyReadyReturn > readyConsistency);
});
