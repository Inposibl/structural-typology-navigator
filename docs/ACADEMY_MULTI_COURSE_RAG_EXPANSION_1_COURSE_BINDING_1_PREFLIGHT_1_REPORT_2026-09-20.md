# ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.COURSE-BINDING-1.PREFLIGHT-1

VERDICT: **PASS**

Act date: `2026-09-21` (`America/Asuncion`).  
Role: Technical pre-mutation analyst / report author.  
Production posture: SELECT/read-only. No binding, application-code, schema, database-data, or Storage mutation was performed.

## 1. Git baseline

- [VERIFIED] Repository root: `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator`.
- [VERIFIED] Branch: `navigator-production-dialogue-corr2-ab-normalization`.
- [VERIFIED] `HEAD`, local `origin/main`, and remote `refs/heads/main` all resolve to `fccff5f2536727877fc28dc1a78555eda6b96775`.
- [VERIFIED] `git rev-list --left-right --count origin/main...HEAD` returned `0 0`.
- [VERIFIED] `git diff --check`, `git diff --name-only`, and `git diff --cached --name-only` were empty before the report write.
- [VERIFIED] Initial status contained only the five Owner-declared unrelated untracked paths: `AGENTS.md`, the Cohere rate-limit diagnostic report, the two CORR2 change-control documents, and the CORR2 closure zip. They were not modified or absorbed.

## 2. Live pre-binding state

- [VERIFIED] Supabase project `mgtghkxebccahtqqyyjv` was queried with SELECT-only SQL.
- [VERIFIED] The exact target set resolves to `11` distinct sources, `22` documents, and `1408` chunks.
- [VERIFIED] All `22/22` target documents are `ready` and carry both `metadata.academyCorpus = true` and `metadata.canonicalRagSource = true`.
- [VERIFIED] All `1408/1408` target chunks have non-null embeddings, `vector_dims(embedding) = 1024`, and `embedding_model = 'cohere/embed-v4.0@1024'`.
- [VERIFIED] Course aggregates are exact:

| course_id | sources | documents | chunks |
|---|---:|---:|---:|
| `levels-of-consciousness` | 4 | 4 | 201 |
| `play-and-creativity` | 3 | 3 | 110 |
| `normative-situation` | 2 | 2 | 111 |
| `structural-typology` | 2 | 13 | 986 |
| **Total** | **11** | **22** | **1408** |

- [VERIFIED] `professional-development-stages` remains separate: 2 sources, 2 ready canonical documents, and 125 chunks; all 125 are embedded at 1024 dimensions with the expected model. `1408 + 125 = 1533`, matching the accepted INGESTION-1 corpus total.

## 3. Exact 11-source identity verification

- [VERIFIED] Live reconciliation returned `manifest_rows = 11`, `resolved_rows = 11`, `uuid_matches = 11`, and `distinct_target_sources = 11`.

| course_id | source_slug | expected/live UUID | documents | chunks |
|---|---|---|---:|---:|
| `levels-of-consciousness` | `levels-of-consciousness-foundational` | `83611f83-9787-44ed-8b43-6827ac0b7615` | 1 | 75 |
| `levels-of-consciousness` | `levels-of-consciousness-transcript` | `a9eb75d0-6f21-458a-8200-00fa9dd1e1b5` | 1 | 92 |
| `levels-of-consciousness` | `levels-of-consciousness-protections-of-perception` | `119643da-5961-4fee-9e71-297f7ad83f9f` | 1 | 28 |
| `levels-of-consciousness` | `levels-of-consciousness-course-page` | `3d49cb21-df35-42a0-8827-717935f2d35e` | 1 | 6 |
| `play-and-creativity` | `play-and-creativity-foundational` | `432cfcb6-c295-449d-849d-3dfa1b2718b5` | 1 | 68 |
| `play-and-creativity` | `play-and-creativity-supplemental` | `d4943a02-7c6d-4077-91d2-e0b4ca43d342` | 1 | 37 |
| `play-and-creativity` | `play-and-creativity-course-page` | `9c13b5d9-8306-478a-b257-421623919d07` | 1 | 5 |
| `normative-situation` | `normative-situation-foundational` | `37f12740-d7d6-4dca-9720-9070fd48c48a` | 1 | 103 |
| `normative-situation` | `normative-situation-course-page` | `d910ec8f-e90b-40e9-8ec5-91b5f8b046a4` | 1 | 8 |
| `structural-typology` | `structural-typology-book` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | 12 | 974 |
| `structural-typology` | `structural-typology-course-page` | `826de4c7-f919-413a-aa1d-d15b7d7c3653` | 1 | 12 |

- [VERIFIED] `structural-typology-book` is one source containing exactly 12 documents. No chapter-level source or chapter-level binding is required or authorized.

## 4. Course status verification

- [VERIFIED] `src/lib/academy/course-catalog.ts:21-24`: `levels-of-consciousness` is `ROUTABLE`.
- [VERIFIED] `src/lib/academy/course-catalog.ts:77-80`: `play-and-creativity` is `ROUTABLE`.
- [VERIFIED] `src/lib/academy/course-catalog.ts:106-109`: `normative-situation` is `ROUTABLE`.
- [VERIFIED] `src/lib/academy/course-catalog.ts:149-152`: `structural-typology` is `ROUTABLE`.
- [VERIFIED] `src/lib/academy/course-catalog.ts:137-146`: `professional-development-stages` is `LISTED_UNROUTABLE` with a routing block reason.
- [VERIFIED] No catalog modification is required or permitted by this act.

## 5. Exact authority-relation manifest

| course_id | source_slug | authority_relation |
|---|---|---|
| `levels-of-consciousness` | `levels-of-consciousness-foundational` | `FOUNDATIONAL` |
| `levels-of-consciousness` | `levels-of-consciousness-transcript` | `ELABORATION` |
| `levels-of-consciousness` | `levels-of-consciousness-protections-of-perception` | `OPERATIONALIZATION` |
| `levels-of-consciousness` | `levels-of-consciousness-course-page` | `OPERATIONALIZATION` |
| `play-and-creativity` | `play-and-creativity-foundational` | `FOUNDATIONAL` |
| `play-and-creativity` | `play-and-creativity-supplemental` | `SUPPLEMENTAL` |
| `play-and-creativity` | `play-and-creativity-course-page` | `OPERATIONALIZATION` |
| `normative-situation` | `normative-situation-foundational` | `FOUNDATIONAL` |
| `normative-situation` | `normative-situation-course-page` | `OPERATIONALIZATION` |
| `structural-typology` | `structural-typology-book` | `FOUNDATIONAL` |
| `structural-typology` | `structural-typology-course-page` | `OPERATIONALIZATION` |

- [VERIFIED] The manifest relations reproduce the accepted authority map without adding a new semantic relation.

## 6. Binding metadata contract

- [VERIFIED] The accepted authority map defines `authority_relation` for these sources but does not authorize literal `role`, `scope`, `priority`, `weight`, `rank`, or override metadata for the 11 new bindings.
- [VERIFIED] Existing Maslow bindings contain five different source-specific `role` values and bespoke `scope`/correction metadata; those values are Maslow-specific and do not form a universal mapping.
- [VERIFIED] `src/lib/knowledge/retrieval/authority-resolver.ts:92-115` derives the evidence role from `authorityRelation`. It does not require invented ranking metadata for these relations.
- [VERIFIED] `src/lib/knowledge/retrieval/course-source-bindings.ts:121-140` accepts binding metadata and normalizes null to `{}`, but does not require additional keys.
- [INFERRED] Therefore the exact contract for every new row is `metadata = '{}'::jsonb`. This is a deliberate fail-closed omission of unauthorized semantics, not missing implementation.

## 7. Transaction design

The later execution act should use one atomic transaction:

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;

CREATE TEMP TABLE binding_manifest (
  course_id text NOT NULL,
  source_slug text NOT NULL,
  expected_source_id uuid NOT NULL,
  authority_relation text NOT NULL,
  metadata jsonb NOT NULL
) ON COMMIT DROP;

-- Populate exactly the 11 rows in §5; metadata is '{}'::jsonb on every row.
-- Run all assertions in §8 with RAISE EXCEPTION on any mismatch.
-- Resolve by source_slug and simultaneously require id = expected_source_id.
-- Insert only the exact resolved rows and require inserted row count = 11.
-- Run every post-insert invariant in §§9, 11, 12 and 13.

COMMIT;
```

- [INFERRED] Implementation should use a PL/pgSQL assertion block or an equivalently atomic mechanism inside the transaction so any failed predicate raises an exception and rolls back all 11 rows.
- [INFERRED] Source identity must be resolved by slug and checked against the expected UUID in the same execution; blind UUID-only insertion is forbidden.
- [INFERRED] Blind `ON CONFLICT` is forbidden because it could conceal partial or incorrect prior state.
- [INFERRED] Lost-response safety has exactly two allowed states: State A is zero target rows and an exact 11-row first insertion; State B is all exact 11 rows already present, active, with exact relations and `{}` metadata, permitting only an explicit verified recovery/no-op. Any partial or different state is HOLD.

## 8. Fail-closed preconditions

Before insertion, the later act must assert all of the following:

1. Manifest count is exactly 11.
2. Every slug resolves exactly once and every live UUID equals `expected_source_id`.
3. Target totals are exactly 11 sources, 22 documents, and 1408 chunks.
4. Every target document is `ready`, `academyCorpus=true`, and `canonicalRagSource=true`.
5. Every target chunk has a non-null 1024-dimensional embedding using `cohere/embed-v4.0@1024`.
6. The four target courses have zero binding rows on the first-run path.
7. None of the 11 sources is bound to any course.
8. `professional-development-stages` has zero active bindings.
9. `synthetic-cohere-smoke-20260918-v1` has zero bindings.
10. Maslow has exactly 5 active bindings and 591 embedded canonical chunks.

- [VERIFIED] Every precondition above holds in this PREFLIGHT-1 live snapshot.

## 9. Expected post-binding counts

The later act must prove before commit:

| invariant | exact expected value |
|---|---:|
| total active `academy_course_sources` | 16 |
| `maslow` | 5 |
| `levels-of-consciousness` | 4 |
| `play-and-creativity` | 3 |
| `normative-situation` | 2 |
| `structural-typology` | 2 |
| `professional-development-stages` | 0 |
| synthetic smoke | 0 |

All 11 new rows must be active, relation-exact, metadata-exact `{}`, and collectively exhaustive for the four target courses. No manifest source may be bound to an unauthorized course, and all five Maslow rows must remain byte-for-byte semantically unchanged.

## 10. Retrieval verification plan

- [VERIFIED] Live `public.match_course_knowledge_chunks` requires `bindings.course_id = p_course_id`, active bindings, ready documents, both canonical metadata flags, and non-null chunk embeddings. It has no global fallback.
- [VERIFIED] `src/lib/knowledge/retrieval/retrieve-course-knowledge.ts:167-180` reads active bindings first and returns `hasActiveSources=false`, `bindings=[]`, and `matches=[]` when none exist, before the Cohere call at lines 183-189.
- [VERIFIED] With bindings present, lines 183-230 generate a 1024-dimensional query embedding and call `match_course_knowledge_chunks` with the validated `p_course_id`.
- [VERIFIED] The focused tests passed `6/6`, including the no-binding/no-embedding path, course-scoped RPC request, and authority-relation resolution.

The later act should execute these positive queries:

| course_id | query |
|---|---|
| `levels-of-consciousness` | `Какие уровни сознания и стратегии защиты восприятия описываются в модели?` |
| `play-and-creativity` | `Как связаны игра, обучение, творчество и рутина в развитии взрослого человека?` |
| `normative-situation` | `Что такое нормативная ситуация и как формируются и изменяются нормы?` |
| `structural-typology` | `Как структурная типология личности использует типологию Майерс-Бриггс и структуру типа?` |

For each positive course require `hasActiveSources=true`, non-empty bindings, non-empty matches, and every result source inside that course's active binding set. Run the professional-development query as a negative control and require no active-source retrieval. Re-run a Maslow query and require no regression. Do not require stable similarity ordering between runs.

## 11. Maslow non-regression contract

- [VERIFIED] Live Maslow state is exactly 5 active bindings, 5 ready canonical documents, and 591 embedded canonical chunks.
- [VERIFIED] The five live Maslow metadata objects are source-specific rather than a global ranking system.
- [INFERRED] The later transaction must snapshot and reassert the complete Maslow binding set and the exact `5/5/591` counts before commit; it must not update any Maslow row.

## 12. professional-development-stages exclusion proof

- [VERIFIED] The catalog status is `LISTED_UNROUTABLE` at `src/lib/academy/course-catalog.ts:137-146`.
- [VERIFIED] Live state contains 0 binding rows and 0 active bindings for this course.
- [VERIFIED] Its 2 ready canonical documents and 125 valid embedded chunks remain ingested but non-retrievable through course-scoped retrieval because there is no active binding.
- [INFERRED] The later transaction must assert zero active bindings both before and after the target insertion.

## 13. Synthetic-smoke exclusion proof

- [VERIFIED] Source `synthetic-cohere-smoke-20260918-v1` has zero bindings.
- [VERIFIED] Its sole ready document metadata is exactly purpose/synthetic smoke information: `{"purpose":"production-ingestion-smoke","synthetic":true}`. It does not carry the Academy canonical authority flags.
- [INFERRED] The later transaction must assert that this source remains unbound.

## 14. Whether any code/schema change is required

**NO. Activation is DATA-ONLY.**

- [VERIFIED] The catalog already marks the four target courses routable.
- [VERIFIED] The binding reader, course-scoped retrieval function, authority resolver, orchestration path, and live RPC already support the intended behavior.
- [VERIFIED] The live RPC definition contains the exact required filtering semantics and no global fallback.
- [INFERRED] No application-code change, schema change, migration, or RPC alteration is required for the authorized 11-row activation.

## 15. Exact proposed next act

If separately authorized by the Owner, the exact next act is:

`ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.COURSE-BINDING-1`

This PREFLIGHT-1 does not execute that act.

## 16. Report SHA-256

- [VERIFIED] The report digest is computed only after final file serialization. To avoid a self-referential changing hash, the authoritative SHA-256 is the final `shasum -a 256` command output returned with this report, not an embedded digest value inside the hashed file.

## 17. Final Git safety state

Final commands are executed after this report is written:

```text
git diff --check
git status --porcelain=v1
git diff --name-only
git diff --cached --name-only
shasum -a 256 docs/ACADEMY_MULTI_COURSE_RAG_EXPANSION_1_COURSE_BINDING_1_PREFLIGHT_1_REPORT_2026-09-20.md
```

The authoritative outputs and exact report SHA-256 are returned in the act-completion response.

## Final statement

**PASS.** All pre-mutation identity, readiness, embedding, binding-zero, exclusion, Maslow non-regression, RPC, and application-architecture gates required by this act were independently verified. The later activation is an exact data-only 11-row transaction with empty JSON metadata and fail-closed assertions. No production mutation was performed in PREFLIGHT-1.
