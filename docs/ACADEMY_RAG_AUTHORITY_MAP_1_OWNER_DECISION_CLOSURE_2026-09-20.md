# ACADEMY-RAG-AUTHORITY-MAP-1.OWNER-DECISION-CLOSURE-1

## 1. Act identity and status

- **Act:** `ACADEMY-RAG-AUTHORITY-MAP-1.OWNER-DECISION-CLOSURE-1`
- **Role:** Governance / Corpus Authority Analyst
- **Owner authorization:** ACTIVE (Owner instruction, 2026-09-20)
- **Mode:** GOVERNANCE + LOCAL CORPUS VERIFICATION ONLY. The only write produced by this act is this file.
- **Status:** Owner semantic decisions integrated; physical corpus inventory verified; canonical derivatives NOT yet created; no ingestion, no bindings, no code, no SQL, no Storage, no staging, no commit.
- **This act closes semantic authority and physical source verification only. It is NOT a statement that the map is implemented.**
- **CORR1 (2026-09-20):** Owner correction applied. For `professional-development-stages` the controlling sequencing is: **CANONICALIZATION REQUIRED IN CURRENT ROLLOUT · INGESTION AUTHORIZED IN CURRENT ROLLOUT · ACTIVE BINDING FORBIDDEN WHILE LISTED_UNROUTABLE · RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT.** No source roles, hashes, file counts, course mappings, exclusion policy, Maslow state, or ST_3 policy were changed.

## 2. Repository baseline

Verified 2026-09-20 (read-only git commands, executed in this act):

| item | value |
|---|---|
| root | `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator` |
| branch | `navigator-production-dialogue-corr2-ab-normalization` |
| HEAD | `101c87b9c223cbd55e3dd01e3a9f100911ecb355` |
| origin/main (local ref) | `101c87b9c223cbd55e3dd01e3a9f100911ecb355` |
| remote main (`git ls-remote`) | `101c87b9c223cbd55e3dd01e3a9f100911ecb355` |
| ahead/behind vs origin/main | `0 / 0` |
| staged paths | none (`git diff --cached --name-only` empty) |
| tracked drift | none (`git status --porcelain=v1` shows only the 4 pre-declared intentional untracked governance inputs; `git diff --check` clean) |

Untracked governance inputs present and untouched: `AGENTS.md`; 3 files under `docs/governance/navigator/2026-09-18-live-supabase/`. This artifact is the single additional untracked file created by this act.

## 3. Corpus-directory inventory summary

Physical recursive inventory of `/Users/entp_psyche/Desktop/Academy Texts Corpus` (2026-09-20, this act):

- **36 root source files** (all hashed in §14), of which:
  - **29 instructional materials** mapped to the six canonical courses (maslow 6, levels-of-consciousness 3, play-and-creativity 3, normative-situation 2, professional-development-stages 2, structural-typology 13);
  - **5 provenance originals** of already-ingested Maslow canonical documents;
  - **1 marketing-only file** (`Course_Maslow_Hierarchy.pdf`);
  - **1 excluded superseded canonical** (`Maslow_QA_CANONICAL.md`).
  29 + 5 + 1 + 1 = 36.
- **40 tooling/provenance files** under `_RAG_INGESTION/` (Maslow ingestion acts' scripts, sidecars, change maps, correction registries, offline verifications) — governance artifacts, NOT course sources, excluded from the map.
- **2 `.DS_Store`** OS artifacts — excluded.
- **Unresolved corpus members: NONE.** Every root file reconciles deterministically with the Owner decision map.

Newly added since PREFLIGHT-1 and physically verified in this act:

| file | size, B | SHA-256 | PDF metadata (Spotlight) |
|---|---|---|---|
| `Course_Maslow_Hierarchy.pdf` | 211,561 | `49b089683d3ce25f26c4aeb00ebec91f19f6637f787fe04cd60c885d62c0da78` | title «Теория иерархии потребностей Маслоу в менеджменте», author Nikolay Petyaev, 6 pages; hash matches the record in `_RAG_INGESTION/MASLOW_SOURCE_INVENTORY.md` byte-for-byte |
| `LevelOfCons Protections of Perception.pdf` | 2,214,725 | `dceb9f5ab7bea070d54017df3da9b743dc870f67eab4311445d5e9bca5d89e44` | title «Три уровня сознания и их стратегии защиты», author Nikolay Petyaev, 57 pages |
| `Stages_of_Professionalization.pdf` | 1,646,153 | `1efb7e0489a4b6ff8c669acf85054f4c27a3e0c8ed9a94a59de301eb9c1af18d` | title «Человек в труде и человек в работе», 16 pages; PDF author metadata says "Nataly" (export-tool account) — binary metadata is not authority; authority is the Owner designation (same precedent as `Maslow_QA.pdf`, author=`python-docx`) |

## 4. Canonical six-course authority matrix

Owner decisions of 2026-09-20 are authoritative; roles below restate them without reinterpretation.

| course_id | FOUNDATIONAL | OPERATIONALIZATION | ELABORATION | SUPPLEMENTAL | PROPOSITION_SCOPED_CORRECTION | binding state |
|---|---|---|---|---|---|---|
| `maslow` | `Maslow_New_Paradigm_CANONICAL.md` (1) | `Maslow_Presentation_2025_CANONICAL.md`, `Maslow-Hierarchy-of-Needs.md` (2) | first-meet, second-meet transcripts (2) | — | `Maslow_QA_CANONICAL_CORR1.md` (1) | **5 ACTIVE live bindings** (verified read-only 2026-09-20, this session); course-page source not yet ingested |
| `levels-of-consciousness` | course-specific canonical document **derived from ST_3** — `REQUIRED_CANONICAL_DERIVATIVE_NOT_YET_CREATED` (1 planned) | `Levels-of-Consciousness.md`, `LevelOfCons Protections of Perception.pdf` (2) | `LevelsOfConciousnessTranscrib.md` (1) | — | — | NONE |
| `play-and-creativity` | `Arts like methodology.docx` (1) | `Play-and-Creativity.md` (1) | — | `MethodologyOfLeadersContemplates.docx` (1) | — | NONE |
| `normative-situation` | `NormaSituations.pdf` (1) | `Normative-Situation.md` (1) | — | — | — | NONE |
| `professional-development-stages` | `StagesOfProfessionalization.docx` (1) | — | `Stages_of_Professionalization.pdf` (1) | — | — | NONE — **CANONICALIZATION REQUIRED IN CURRENT ROLLOUT; INGESTION AUTHORIZED IN CURRENT ROLLOUT; ACTIVE BINDING FORBIDDEN WHILE LISTED_UNROUTABLE; RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT** (Owner policy E, CORR1) |
| `structural-typology` | ONE source `structural-typology-book` = book chapters ST_1…ST_15 as **documents** (12 physical files; ST_9-12 is one combined document) | `Structural-Typology.md` (1) | — | — | — | NONE |

Every course has at least one FOUNDATIONAL authority (check A: PASS; levels' foundational is the planned ST_3-derived derivative per check D). Each instructional file maps to exactly one course (check B: PASS). Original `ST_3 (Levels of Consiousness).docx` belongs to `structural-typology` only and is NOT shared or bound to `levels-of-consciousness` (check C: PASS). Book corpus complete through ST_15; no ST_16+ exists or is expected (check G: PASS; Owner-confirmed). No source outside `Academy Texts Corpus` is introduced (check H: PASS).

## 5. Source-by-source table

Class values: ORIGINAL_BINARY / CANONICAL_MD / COURSE_PAGE / TRANSCRIPT / PRESENTATION / MARKETING_ONLY / EXCLUDED. "Ingestion eligible now" = canonical form exists + Owner authority granted + no policy block.

| file | course_id | Owner role | class | canonicalization required | ingestion eligible now | active binding eligible now | reason / note |
|---|---|---|---|---|---|---|---|
| `Maslow_New_Paradigm_CANONICAL.md` | maslow | FOUNDATIONAL | CANONICAL_MD | NO | (already ingested) | ACTIVE | live source `maslow-new-paradigm`, 283 chunks embedded |
| `Maslow_Presentation_2025_CANONICAL.md` | maslow | OPERATIONALIZATION | CANONICAL_MD | NO | (already ingested) | ACTIVE | live, 20 chunks |
| `Maslow_First_Meet_CANONICAL.md` | maslow | ELABORATION | CANONICAL_MD | NO | (already ingested) | ACTIVE | live, 111 chunks |
| `Maslow_Second_Meet_CANONICAL.md` | maslow | ELABORATION | CANONICAL_MD | NO | (already ingested) | ACTIVE | live, 140 chunks |
| `Maslow_QA_CANONICAL_CORR1.md` | maslow | PROPOSITION_SCOPED_CORRECTION | CANONICAL_MD | NO | (already ingested) | ACTIVE | live, 37 chunks, version 2025-04-20-corr1 |
| `Maslow-Hierarchy-of-Needs.md` | maslow | OPERATIONALIZATION | COURSE_PAGE | NO | **YES** (after ingestion+binding act) | after ingestion | Owner decision A.6; new source at ingestion time (slug assigned in that act; no live counterpart yet) |
| `Maslow (1).pdf` | maslow | provenance original of FOUNDATIONAL | ORIGINAL_BINARY | — (provenance only) | NO | NO | must not compete with canonical MD |
| `Иерархия_Маслоу_Новая_Парадигма_22_02_2025.ppsx` | maslow | provenance original of presentation | ORIGINAL_BINARY (PRESENTATION) | — | NO | NO | provenance only |
| `Maslow_Trancribir_First Meet.docx` | maslow | provenance original of first-meet transcript | ORIGINAL_BINARY (TRANSCRIPT) | — | NO | NO | provenance only |
| `Maslow_Trancribir_Second Meet.docx` | maslow | provenance original of second-meet transcript | ORIGINAL_BINARY (TRANSCRIPT) | — | NO | NO | provenance only |
| `Maslow_QA.pdf` | maslow | provenance original of Q&A CORR1 | ORIGINAL_BINARY | — | NO | NO | provenance only |
| `Maslow_QA_CANONICAL.md` | maslow | EXCLUDED | EXCLUDED | NO | **NO — must never be ingested** | NO | superseded by CORR1 (live registered version) |
| `Course_Maslow_Hierarchy.pdf` | maslow | marketing / course description | MARKETING_ONLY | NO | **NO — excluded from instructional retrieval** | NO | Owner policy A "SPECIAL NON-INSTRUCTIONAL MATERIAL"; retained for provenance/product presentation |
| `Levels-of-Consciousness.md` | levels-of-consciousness | OPERATIONALIZATION | COURSE_PAGE | NO | YES (after act) | after ingestion | Owner decision B |
| `LevelsOfConciousnessTranscrib.md` | levels-of-consciousness | ELABORATION | TRANSCRIPT (raw ASR) | **YES** (punctuation, paragraphing, mechanical ASR fixes only; no semantic rewriting) | NO | NO | canonicalization per Owner policy B |
| `LevelOfCons Protections of Perception.pdf` | levels-of-consciousness | OPERATIONALIZATION | PRESENTATION (hybrid lecture + applied exercises) | **YES** | NO | NO | newly verified |
| *(derived from ST_3)* | levels-of-consciousness | FOUNDATIONAL | CANONICAL_MD (future) | **YES — derivation act** (conservative selection/restructuring; NO new theory, NO semantic rewrite, NO invented content) | NO — `REQUIRED_CANONICAL_DERIVATIVE_NOT_YET_CREATED` | NO | check D: absence is not a corpus defect at this stage |
| `ST_3 (Levels of Consiousness).docx` | structural-typology | FOUNDATIONAL (book chapter document) | ORIGINAL_BINARY | **YES** (as `structural-typology-book` chapter-03) | NO | NO | structural-typology ONLY; never bound to levels |
| `Arts like methodology.docx` | play-and-creativity | FOUNDATIONAL | ORIGINAL_BINARY | **YES** | NO | NO | Owner decision C; absence of a separate Reiss text is not a defect |
| `Play-and-Creativity.md` | play-and-creativity | OPERATIONALIZATION | COURSE_PAGE | NO | YES (after act) | after ingestion | |
| `MethodologyOfLeadersContemplates.docx` | play-and-creativity | SUPPLEMENTAL | ORIGINAL_BINARY | **YES** | NO | NO | Owner decision C |
| `NormaSituations.pdf` | normative-situation | FOUNDATIONAL | ORIGINAL_BINARY | **YES** | NO | NO | Owner decision D; author-attributed 70-page manuscript |
| `Normative-Situation.md` | normative-situation | OPERATIONALIZATION | COURSE_PAGE | NO | YES (after act) | after ingestion | |
| `StagesOfProfessionalization.docx` | professional-development-stages | FOUNDATIONAL | ORIGINAL_BINARY | **YES — REQUIRED IN CURRENT ROLLOUT** | **AUTHORIZED IN CURRENT ROLLOUT** (after canonicalization) | **NO — ACTIVE BINDING FORBIDDEN WHILE LISTED_UNROUTABLE; RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT** | Owner policy E, CORR1 |
| `Stages_of_Professionalization.pdf` | professional-development-stages | ELABORATION | PRESENTATION | **YES — REQUIRED IN CURRENT ROLLOUT** | **AUTHORIZED IN CURRENT ROLLOUT** (after canonicalization) | **NO — ACTIVE BINDING FORBIDDEN WHILE LISTED_UNROUTABLE; RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT** | newly verified; Owner policy E, CORR1 |
| `ST_1.docx` | structural-typology | FOUNDATIONAL (book, chapter-01 document) | ORIGINAL_BINARY | **YES** | NO | NO | one source `structural-typology-book` |
| `ST_2 (Stages of Development).docx` | structural-typology | FOUNDATIONAL (chapter-02) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_4.docx` | structural-typology | FOUNDATIONAL (chapter-04) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_5.docx` | structural-typology | FOUNDATIONAL (chapter-05) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_6.docx` | structural-typology | FOUNDATIONAL (chapter-06) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_7.docx` | structural-typology | FOUNDATIONAL (chapter-07) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_8.docx` | structural-typology | FOUNDATIONAL (chapter-08) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_9-12.docx` | structural-typology | FOUNDATIONAL (one combined chapter-09-12 document) | ORIGINAL_BINARY | **YES** | NO | NO | grouping confirmed by Owner |
| `ST_13.docx` | structural-typology | FOUNDATIONAL (chapter-13) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_14.docx` | structural-typology | FOUNDATIONAL (chapter-14) | ORIGINAL_BINARY | **YES** | NO | NO | |
| `ST_15.docx` | structural-typology | FOUNDATIONAL (chapter-15) | ORIGINAL_BINARY | **YES** | NO | NO | book complete; no ST_16+ |
| `Structural-Typology.md` | structural-typology | OPERATIONALIZATION | COURSE_PAGE | NO | YES (after act) | after ingestion | |
| `_RAG_INGESTION/**` (40 files) | — | governance/tooling | OTHER | — | NO | NO | provenance records of Maslow ingestion acts; not course sources |
| `.DS_Store` (×2) | — | OS artifact | OTHER | — | NO | NO | |

## 6. Canonicalization requirements

Owner selected **CONTROLLED PER-SOURCE CANONICALIZATION**. For each DOCX/PDF instructional source:

1. preserve the original binary as provenance;
2. create an individually controlled canonical Markdown document;
3. create/preserve provenance/sidecar metadata tying the canonical MD to the original (binary SHA-256 recorded);
4. independently verify the canonicalization did not alter substantive meaning;
5. only after verification may the canonical form become an ingestion candidate.

Explicit prohibitions: no universal bulk DOCX/PDF-to-MD converter in this rollout; raw DOCX/PDF are never ingestion-ready by existence. The in-repo parser accepts plain text / Markdown only (verified: `src/lib/ingestion/adapters.ts` and `scripts/ingest-plan.mts` accept `.md`/`.txt` only).

Canonicalization queue implied by the map (order set by later acts, not here):

- `normative-situation`: `NormaSituations.pdf` (PDF→MD, page-provenance sidecars, Maslow-QA pattern).
- `structural-typology`: 12 book-chapter DOCX→MD documents under one source.
- `levels-of-consciousness`: ST_3-derived FOUNDATIONAL document (conservative derivation; ST_3 original stays ST-only); ASR cleanup of `LevelsOfConciousnessTranscrib.md` (mechanical fixes only); `LevelOfCons Protections of Perception.pdf` (PDF→MD).
- `play-and-creativity`: `Arts like methodology.docx`, `MethodologyOfLeadersContemplates.docx`.
- `professional-development-stages`: `StagesOfProfessionalization.docx`, `Stages_of_Professionalization.pdf` — **CANONICALIZATION REQUIRED IN CURRENT ROLLOUT; INGESTION AUTHORIZED IN CURRENT ROLLOUT; ACTIVE BINDING FORBIDDEN WHILE LISTED_UNROUTABLE; RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT** (Owner policy E, CORR1).
- `maslow`: none remaining (5 canonical MDs live; course-page MD needs no canonicalization).

## 7. Retrieval eligibility

Architecture is unchanged and must stay: active `academy_course_sources` binding + document `status='ready'` + `metadata.academyCorpus=true` + `metadata.canonicalRagSource=true` + embeddings present; course-scoped RPC; no global course fallback. Currently retrieval-eligible material: **only the 5 live Maslow sources** (verified read-only 2026-09-20, this session: 591 embedded chunks, all ready, exactly 5 active `maslow` bindings). No other course has retrievable material yet. The synthetic smoke source (`synthetic-cohere-smoke-20260918-v1`) remains unbound and flag-less — not retrievable, not Academy authority, outside this map (physical cleanup is a separate hygiene decision).

RAG content is not commercial authority: prices, enrollment, schedules, cohorts, payment rules remain governed by the frozen commercial-authority package. Marketing-only material (§10) never enters instructional retrieval.

## 8. Binding eligibility

- `maslow`: 5 bindings ACTIVE (frozen reference); the course-page material may add one binding only via a future ingestion+binding act.
- `levels-of-consciousness`, `play-and-creativity`, `normative-situation`, `structural-typology`: NO bindings exist; bindings become eligible only after canonicalization → ingestion → ready, per-course, through authorized acts.
- `professional-development-stages`: **CANONICALIZATION REQUIRED IN CURRENT ROLLOUT; INGESTION AUTHORIZED IN CURRENT ROLLOUT** — but **NO active `academy_course_sources` binding may be created while the course remains LISTED_UNROUTABLE**, and **RUNTIME SEMANTIC RETRIEVAL IS FORBIDDEN UNTIL A SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT** (Owner policy E, CORR1). Routability is not altered by this act.

## 9. Explicit exclusions

| material | scope of exclusion | physical state |
|---|---|---|
| `Kaufman-self-actualization-2018.pdf` | FULLY excluded from instructional RAG and external-research authority | not present in `Academy Texts Corpus` (correctly absent) |
| extra duplicate Maslow manuscript (`Иерархия_Маслоу_Новая_Парадигма_Петяев_Н_А_ (1).pdf`) | FULLY excluded from instructional RAG | not present in `Academy Texts Corpus` (correctly absent) |
| `Maslow_QA_CANONICAL.md` | superseded; MUST NOT be ingested; not active authority | present on disk; excluded from map |
| `Course_Maslow_Hierarchy.pdf` | marketing-only (see §10) | present, hashed, retained |
| `_RAG_INGESTION/**`, `.DS_Store` | not course sources | present, outside map |

Owner confirmed there are **no other intentional exclusions**. No exclusion has been reintroduced anywhere in this map (check F: PASS).

## 10. Marketing-only material

`Course_Maslow_Hierarchy.pdf` — sha256 `49b089683d3ce25f26c4aeb00ebec91f19f6637f787fe04cd60c885d62c0da78`, 211,561 B, 6 pages, «Теория иерархии потребностей Маслоу в менеджменте» (author metadata: Nikolay Petyaev). Policy: retain as advertising/course-description material for provenance/product presentation; EXCLUDE from ordinary semantic instructional RAG retrieval; never classify as substantive instructional authority. It is the only marketing-only corpus member.

## 11. Missing canonical derivatives still to be created

| derivative | course | derived from | constraints |
|---|---|---|---|
| levels-of-consciousness FOUNDATIONAL canonical document | `levels-of-consciousness` | `ST_3 (Levels of Consiousness).docx` | conservative selection of levels-relevant content; standalone course-document structure; remove book-context references where necessary; NO new theoretical ideas; NO semantic rewriting; NO invented content. Status: **REQUIRED_CANONICAL_DERIVATIVE_NOT_YET_CREATED** — recorded, not a corpus-content defect |

All other canonical forms derive 1:1 from their own originals (§6); no other derivatives are missing.

## 12. Unresolved physical-file discrepancies

- **UNRESOLVED_CORPUS_MEMBER: none.**
- Notes (non-blocking):
  1. `Stages_of_Professionalization.pdf` carries PDF author metadata "Nataly"; authority for this file is the Owner designation, not binary metadata (consistent with the `Maslow_QA.pdf` author=`python-docx` precedent). No action.
  2. Correction of an earlier session count: the structural-typology book corpus consists of **12** physical chapter files (ST_1…ST_8, ST_9-12 combined, ST_13…ST_15), not 11 as stated in the PREFLIGHT-1 report tables. Chapter coverage 1–15 is unchanged and Owner-confirmed complete.

## 13. Final deterministic corpus manifest

Instructional map (course → material → role → state):

```
maslow:
  Maslow_New_Paradigm_CANONICAL.md           FOUNDATIONAL                LIVE/ACTIVE
  Maslow_Presentation_2025_CANONICAL.md      OPERATIONALIZATION          LIVE/ACTIVE
  Maslow_First_Meet_CANONICAL.md             ELABORATION                 LIVE/ACTIVE
  Maslow_Second_Meet_CANONICAL.md            ELABORATION                 LIVE/ACTIVE
  Maslow_QA_CANONICAL_CORR1.md               PROPOSITION_SCOPED_CORRECTION LIVE/ACTIVE
  Maslow-Hierarchy-of-Needs.md               OPERATIONALIZATION          MD-READY, NOT INGESTED
  [provenance originals: Maslow (1).pdf; Иерархия_…22_02_2025.ppsx; Maslow_Trancribir_First Meet.docx; Maslow_Trancribir_Second Meet.docx; Maslow_QA.pdf]
  [excluded: Maslow_QA_CANONICAL.md; Course_Maslow_Hierarchy.pdf (MARKETING_ONLY)]
levels-of-consciousness:
  <ST_3-derived canonical document>          FOUNDATIONAL                REQUIRED_CANONICAL_DERIVATIVE_NOT_YET_CREATED
  Levels-of-Consciousness.md                 OPERATIONALIZATION          MD-READY, NOT INGESTED
  LevelOfCons Protections of Perception.pdf  OPERATIONALIZATION          CANONICALIZATION REQUIRED
  LevelsOfConciousnessTranscrib.md           ELABORATION                 CANONICALIZATION REQUIRED (ASR cleanup)
play-and-creativity:
  Arts like methodology.docx                 FOUNDATIONAL                CANONICALIZATION REQUIRED
  Play-and-Creativity.md                     OPERATIONALIZATION          MD-READY, NOT INGESTED
  MethodologyOfLeadersContemplates.docx      SUPPLEMENTAL                CANONICALIZATION REQUIRED
normative-situation:
  NormaSituations.pdf                        FOUNDATIONAL                CANONICALIZATION REQUIRED
  Normative-Situation.md                     OPERATIONALIZATION          MD-READY, NOT INGESTED
professional-development-stages (LISTED_UNROUTABLE — ACTIVE BINDING FORBIDDEN; RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT):
  StagesOfProfessionalization.docx           FOUNDATIONAL                CANONICALIZATION REQUIRED IN CURRENT ROLLOUT; INGESTION AUTHORIZED
  Stages_of_Professionalization.pdf          ELABORATION                 CANONICALIZATION REQUIRED IN CURRENT ROLLOUT; INGESTION AUTHORIZED
structural-typology (ONE source structural-typology-book):
  ST_1.docx … ST_8.docx, ST_9-12.docx, ST_13.docx, ST_14.docx, ST_15.docx   FOUNDATIONAL (12 chapter documents)  CANONICALIZATION REQUIRED
  Structural-Typology.md                     OPERATIONALIZATION          MD-READY, NOT INGESTED
out of map: _RAG_INGESTION/** (tooling), .DS_Store ×2, Kaufman (absent, excluded), duplicate manuscript (absent, excluded)
```

## 14. SHA-256 of every source file included in the map

| file | SHA-256 |
|---|---|
| `Arts like methodology.docx` | `b795b67776119294233ae25143a99cc1e26769010485d8c8b1d3d2a9bd64e9bc` |
| `Course_Maslow_Hierarchy.pdf` | `49b089683d3ce25f26c4aeb00ebec91f19f6637f787fe04cd60c885d62c0da78` |
| `LevelOfCons Protections of Perception.pdf` | `dceb9f5ab7bea070d54017df3da9b743dc870f67eab4311445d5e9bca5d89e44` |
| `Levels-of-Consciousness.md` | `a9852ba6856a243f66ac59641933b6371f2efef5a6007d43e46dc471a9482e37` |
| `LevelsOfConciousnessTranscrib.md` | `31a8ec963d6e68a45becd8f2c1945502c249008afe80af25ec7d274f9ea2fdf0` |
| `Maslow (1).pdf` | `ddbd5ef886f013c5ae522ea481efc417797c8af0351da5a4b1e3f34b92e27000` |
| `Maslow-Hierarchy-of-Needs.md` | `9c02f94e8638b14a3c1b0228372f5cba398e4030a9b953338f7a8d21cee33125` |
| `Maslow_First_Meet_CANONICAL.md` | `f895917c8ec048c36d5771411c17a1c6bda9c3f10d1b638bdf2538e4b9d9573f` |
| `Maslow_New_Paradigm_CANONICAL.md` | `588d0d86b644ac9dfaf8d5708a6a101346b8b3c1ac2894c058424e114c0ea038` |
| `Maslow_Presentation_2025_CANONICAL.md` | `870fbb8dec85853d84bb7825cbef173d29f03c31129617e3be347b6b7f622d29` |
| `Maslow_QA.pdf` | `dcd3c75b9335281a9582d060da0a951dbacf8f0984722d6c152036ad067c27dc` |
| `Maslow_QA_CANONICAL.md` (EXCLUDED) | `11cd1090d16a72b2df6090a604b9c43321937df9ea0e202a5ea1351e8c411e85` |
| `Maslow_QA_CANONICAL_CORR1.md` | `211af3f5a614af8f4dc97d5a5749da986c600a8849141b198eb46b2d1aca6351` |
| `Maslow_Second_Meet_CANONICAL.md` | `7e74ceb4d6db9aac3b8112f1ae65e0e61f4e31d6f71beeb60c4b1006eb7655b0` |
| `Maslow_Trancribir_First Meet.docx` | `a11f6ed1718c8cca7d107d8fa23232af38895d491f0ad4247369003ef2dd2884` |
| `Maslow_Trancribir_Second Meet.docx` | `74a8d8a590128349d95c123cc0bb7c1eaed15790298e5662679532eee4e40f1e` |
| `MethodologyOfLeadersContemplates.docx` | `11574ae732aa5611c171bccc69428cfdc7db7aaf99bb86fa20e9b7aa4d7cb386` |
| `NormaSituations.pdf` | `a8579bd089791e70b180da20ef5b5025c462d21bb265af1200ec47ae8bb89736` |
| `Normative-Situation.md` | `ee93e31587090a0104141e2590bd8e36a2f86e9d28bf3ace21db1a3f8d54e371` |
| `Play-and-Creativity.md` | `4cc16361ebdc210fb0e6619ea8c6c5fb2c17300dc32af964d462469b111150d7` |
| `ST_1.docx` | `2402ceaf46fddaa55a112882275ff5b2c523615645add577e87e05ddc5eb574e` |
| `ST_2 (Stages of Development).docx` | `9289b569716131e1f05e8b2291c656f77faa56519d6d27717fd6aa8fe24a9cb6` |
| `ST_3 (Levels of Consiousness).docx` | `ba0dc2caca686f8fe0d8f77b2a726c2c066522489672cd9514125b2e26f9b138` |
| `ST_4.docx` | `96bae1ce912d5c5fc2f0e93c1927717525619adefb3d3cd63b102c72620fa1ed` |
| `ST_5.docx` | `64a90eb3b087ce65d9af36b00e7f3e484fff50ae16a8e65b68548707f963dba5` |
| `ST_6.docx` | `ff18f2ce9c2a8027321a7c8af5d8dc64fe2f73ca0d3ed8441be8488fcd33e9f4` |
| `ST_7.docx` | `f933c838cd1d895a018090215fe5286f2638d60b7b02b6e2a9b358432dbec381` |
| `ST_8.docx` | `fd33f44e3c921f1e80ba03053329be2b839cc864c42cc195870a20b121b150da` |
| `ST_9-12.docx` | `f68140fbc6c571d532345885583e007f285bae41a4313507ef4ded8815a1041b` |
| `ST_13.docx` | `fb08885be803a847e43d4794a91490f47fa760b723ce2fafdd2109bbf976c28c` |
| `ST_14.docx` | `16415284337a44cada4aee94b0fa87f6de0539fd9e9b3fc6705060566e22d92f` |
| `ST_15.docx` | `78810834be1a6ef61f339b1169fd03900e0a328f4db17e3107ada4e050cc1654` |
| `StagesOfProfessionalization.docx` | `6ff719a64a5fadd92b71b9d8f24b38beb9a3212e5ae8566bbc695f48d6beaba9` |
| `Stages_of_Professionalization.pdf` | `1efb7e0489a4b6ff8c669acf85054f4c27a3e0c8ed9a94a59de301eb9c1af18d` |
| `Structural-Typology.md` | `d8b58a7c0448d169f3d51f959528a888ade5255697062fe967f06c1d6f2282b7` |
| `Иерархия_Маслоу_Новая_Парадигма_22_02_2025.ppsx` | `962fd63e2782466d8b3b15bfefa30b0afa842ac8a835c0efb69e4a85a4ddb43e` |

(36 files: 29 in-map instructional + 5 provenance originals + 1 marketing-only + 1 excluded-superseded. `_RAG_INGESTION/**` tooling and `.DS_Store` are intentionally not hashed into the map.)

## 15. Exact next-stage readiness statement

**READY_FOR_CONTROLLED_CANONICALIZATION.**

Semantic authority for all six canonical courses is closed by Owner decision; the physical corpus matches those decisions exactly (all 36 root files reconciled, 3 newly added files verified and hashed, zero unresolved members, zero reintroduced exclusions). The next stage is controlled per-source canonicalization beginning with the first authorized canonicalization act (queue in §6; the levels-of-consciousness FOUNDATIONAL derivative is the only derived — not converted — canonical document). No ingestion, binding, or runtime change is authorized by this closure act, and nothing in this document may be read as implementation.
