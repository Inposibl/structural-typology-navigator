
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function migration(): { name: string; sql: string } {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const names = readdirSync(dir).filter((name) =>
    name.endsWith("_course_source_registry.sql"),
  );
  assert.equal(
    names.length,
    1,
    `Expected exactly one course_source_registry migration, found ${names.length}`,
  );
  const name = names[0];
  return {
    name,
    sql: readFileSync(path.join(dir, name), "utf8"),
  };
}

test("course-source registry migration is service-role-only and RLS protected", () => {
  const { sql } = migration();

  assert.match(sql, /create table public\.academy_course_sources/u);
  assert.match(
    sql,
    /alter table public\.academy_course_sources enable row level security/u,
  );
  assert.match(
    sql,
    /revoke all privileges on table public\.academy_course_sources[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    sql,
    /grant select, insert, update, delete[\s\S]*to service_role/u,
  );
});

test("course retrieval RPC is invoker-only, bounded, canonical, ready and service-role-only", () => {
  const { sql } = migration();

  assert.match(
    sql,
    /create or replace function public\.match_course_knowledge_chunks/u,
  );
  assert.match(sql, /security invoker/u);
  assert.match(sql, /set search_path = ''/u);
  assert.match(sql, /bindings\.is_active/u);
  assert.match(sql, /documents\.status = 'ready'/u);
  assert.match(sql, /"academyCorpus": true/u);
  assert.match(sql, /"canonicalRagSource": true/u);
  assert.match(
    sql,
    /revoke execute on function public\.match_course_knowledge_chunks[\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    sql,
    /grant execute on function public\.match_course_knowledge_chunks[\s\S]*to service_role/u,
  );
});

test("Maslow pilot is seeded by source slug and requires exactly five bindings", () => {
  const { sql } = migration();

  assert.match(sql, /where sources\.slug in/u);
  assert.doesNotMatch(
    sql,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u,
  );
  assert.match(sql, /v_binding_count <> 5/u);
  assert.match(sql, /PROPOSITION_SCOPED_CORRECTION/u);
});
