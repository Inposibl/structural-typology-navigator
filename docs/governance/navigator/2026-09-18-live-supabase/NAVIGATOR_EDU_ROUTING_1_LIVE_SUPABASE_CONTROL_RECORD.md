# NAVIGATOR-EDU-ROUTING-1 — LIVE COURSE-SOURCE REGISTRY CONTROL RECORD

**Status:** PASS / CLOSED
**Artifact status:** READY FOR OWNER ACCEPTANCE
**Date:** 2026-09-18
**Supabase project:** `mgtghkxebccahtqqyyjv`
**Git controlling HEAD:** `ac4cee5c58c700976abba8d4c83757f98e08a874`
**Git subject:** `feat: add course-generic Academy education routing`

## 1. Controlling migration identity

- Migration version: `20260918142356`
- Migration name: `course_source_registry`
- Migration file: `supabase/migrations/20260918142356_course_source_registry.sql`
- Migration SHA-256: `83a33e58e585006a665d9d33bc975d220aeec1c77aeb8492832f2c959a368cd0`
- Supabase CLI used for live apply: `2.117.0`
- Pre-apply dry-run: exactly one migration
- Live apply: exactly one migration
- Post-apply dry-run: `upToDate=true`, zero pending migrations
- Seeds: not executed
- Roles: not executed
- Vault synchronization: explicitly skipped
- Database reset: not performed
- Migration-history repair: not performed

Remote migration ledger contains:

`20260918142356 | course_source_registry`

## 2. Course-source registry live state

`public.academy_course_sources` contains exactly **5 rows**.

All five rows are:

- `course_id = maslow`
- `is_active = true`

No non-Maslow course bindings exist in this pilot registry.

### Active bindings

| Source slug | Authority relation | Active | Scope / role |
|---|---|---:|---|
| `maslow-new-paradigm` | `FOUNDATIONAL` | yes | `foundational_author_text`, `COURSEWIDE` |
| `maslow-first-meet-transcript` | `ELABORATION` | yes | `foundational_psychophysiology_lecture`, `COURSEWIDE` |
| `maslow-new-paradigm-presentation-2025-02-22` | `OPERATIONALIZATION` | yes | `later_operationalization`, `COURSEWIDE` |
| `maslow-second-meet-transcript` | `ELABORATION` | yes | `lecture_explanation_and_application`, `COURSEWIDE` |
| `maslow-qa-2025-04-20` | `PROPOSITION_SCOPED_CORRECTION` | yes | `explicit_clarification_and_correction`, `PROPOSITION_SCOPED` |

The Q&A binding records:

`correctionRegistry = Maslow_QA_CORRECTION_REGISTRY_CORR1.json`

## 3. Corpus coverage behind the live Maslow binding

Every bound source has exactly one canonical ready Academy document with embeddings.

| Source slug | Embedded canonical chunks |
|---|---:|
| `maslow-new-paradigm` | 283 |
| `maslow-first-meet-transcript` | 111 |
| `maslow-new-paradigm-presentation-2025-02-22` | 20 |
| `maslow-second-meet-transcript` | 140 |
| `maslow-qa-2025-04-20` | 37 |
| **TOTAL** | **591** |

This matches the expected real Maslow corpus. The separate synthetic smoke chunk is not part of the course corpus.

## 4. Synthetic-smoke exclusion

Synthetic source:

`synthetic-cohere-smoke-20260918-v1`

Live verification:

- Registry bindings for synthetic source: **0**
- Adversarial query used the synthetic chunk's own stored embedding against `match_course_knowledge_chunks('maslow', ...)`
- Threshold: `0.9999`
- Returned rows: **0**
- Returned synthetic rows: **0**

Therefore course-scoped retrieval excludes the synthetic smoke source by the course↔source binding boundary, not by a Maslow-specific code branch.

## 5. RPC live security and execution contract

Function:

`public.match_course_knowledge_chunks(text, extensions.vector, real, integer)`

Live catalog verification:

- `SECURITY INVOKER`
- `STABLE`
- `PARALLEL SAFE`
- `search_path = ''`
- EXECUTE grantees: `postgres`, `service_role`
- `anon`: no EXECUTE
- `authenticated`: no EXECUTE

Table:

`public.academy_course_sources`

Live verification:

- RLS enabled
- `anon`: no SELECT
- `authenticated`: no SELECT
- `service_role`: server-side access present
- update trigger enabled:
  `academy_course_sources_set_updated_at`

Indexes present:

- `academy_course_sources_pkey (course_id, source_id)`
- `academy_course_sources_source_id_idx (source_id)`

### Platform-default ACL note

The live Supabase project grants `service_role` additional table privileges such as
`MAINTAIN`, `REFERENCES`, `TRIGGER`, and `TRUNCATE` through project default ACLs.

This is not unique to `academy_course_sources`: the same platform-default privileges
are present on `knowledge_sources`, `knowledge_documents`, and `knowledge_chunks`,
and are visible in `pg_default_acl`.

Supabase documentation describes these generated service-role grants as default /
redundant platform grants. No equivalent access is granted to `anon` or
`authenticated`.

Classification for this act:

**NON-BLOCKING PLATFORM-DEFAULT ACL NOTE**

No isolated one-table ACL divergence was introduced.

## 6. Proposition-scoped authority verification — Q11

Verified live Q&A chunk:

- Chunk ID: `12918`
- Chunk index: `32`
- Document ID: `b7e264ec-02cf-4ee0-8912-564a221c295c`
- Source: `maslow-qa-2025-04-20`
- PDF page: `29`
- Question number: `11`
- Authority boundary group: `question:11`
- Question classification: `EXPLICIT_CORRECTION`
- Course-source authority relation: `PROPOSITION_SCOPED_CORRECTION`

The document contains the controlling authority entry:

- ID: `QA-Q11-CORR-SUBLIMATION-REALITY`
- Type: `EXPLICIT_CORRECTION`
- Question number: `11`
- Proposition scope:
  `which_drive_is_sublimated_and_how_sublimation_relates_to_the_reality_principle`

The document authority policy remains proposition-scoped:

> explicit corrections/definitions override only their exact scope

No global superiority of the Q&A source was introduced.

## 7. Real service-role RPC execution

The live RPC was executed under:

`SET LOCAL ROLE service_role`

The query embedding was the already persisted embedding of Q11 chunk `12918`.

Result:

- first returned chunk: `12918`
- source: `maslow-qa-2025-04-20`
- course: `maslow`
- authority: `PROPOSITION_SCOPED_CORRECTION`
- question: `11`
- PDF page: `29`
- similarity: `1.0`

This confirms the real service-role path can retrieve the exact proposition-scoped
Q11 chunk through the new generic course-scoped RPC.

No new Cohere or DeepSeek request was required for this database-level verification.

## 8. Supabase advisors after migration

Security advisor:

- no blocking ERROR/WARN finding introduced
- INFO: `RLS Enabled No Policy` on the closed knowledge tables and
  `academy_course_sources`

This is consistent with the intentional access model:
the tables are not available to `anon` or `authenticated`; server-side
`service_role` is the authorized caller.

Performance advisor:

- INFO only:
  - `knowledge_chunks_search_vector_idx` currently unused
  - `knowledge_chunks_embedding_hnsw_idx` currently unused

These are not treated as defects at current traffic / pilot scale. The live RPC
itself has now been exercised successfully.

## 9. Architectural conclusions sealed by this verification

1. **Maslow is not architecturally special.**
   The production retrieval boundary is a generic course↔source registry plus a
   generic course-scoped RPC.

2. **Catalog eligibility and corpus availability remain separate.**
   The registry determines what source material belongs to a course; it does not
   define which courses may be recommended.

3. **Deep retrieval is course-scoped.**
   Only actively bound canonical ready Academy sources can enter the course RAG
   result.

4. **Synthetic test data is excluded structurally.**
   It has no course binding and cannot enter the Maslow retrieval path.

5. **Proposition-scoped corrections remain scoped.**
   A Q&A source is not globally higher authority; the Q11 correction is tied to
   its exact question/proposition boundary.

6. **Security remains server-only.**
   The registry and course-match RPC are unavailable to `anon` and
   `authenticated`.

## 10. Closed act

`NAVIGATOR-EDU-ROUTING-1.LIVE-SUPABASE-MIGRATION`

**FINAL VERIFICATION: PASS**

No corrective database act is required from this verification.

## 11. Next gate — not executed in this act

The next distinct risk-bearing act is the **live conversational pilot**:

`conversation → Educational Router → catalog decision → course-scoped RAG → authority resolution → evidence selection → deterministic answer`

Before that act, independently verify the current official DeepSeek API model
identifier used by `src/lib/navigation/deepseek-client.ts`.

A live conversational pilot will make external DeepSeek and Cohere API calls and
is therefore outside this closed database-migration act.
