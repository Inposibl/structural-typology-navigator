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

const migration = readFileSync(MIGRATION_PATH, "utf8");
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
