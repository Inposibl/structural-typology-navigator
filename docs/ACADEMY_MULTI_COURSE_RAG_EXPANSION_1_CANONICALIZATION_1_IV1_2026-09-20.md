# ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.CANONICALIZATION-1.IV1 — Independent Verification Report

**Act:** `ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.CANONICALIZATION-1.IV1`
**Role:** Independent Adversarial Canonicalization Auditor (strict read-only; single permitted write = this file)
**Date:** 2026-09-20
**Verdict:** **FAIL** — BLOCKING = 0, MAJOR = 2, MINOR = 11 (register below)

---

## 1. Act identity

- Act under audit: `ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.CANONICALIZATION-1` (author-reported verdict: PASS).
- This IV act audited all 20 canonical candidates against their 19 unique source originals under the controlling authority map closed at commit `2b46cfa`.

## 2. Auditor independence statement

The auditor did not author any part of the canonicalization act. All comparisons in this IV were produced by independently written extraction code (own DOCX XML walker; own pypdf page extraction; own letter-stream/token-stream containment, divergence-point, table-structure, and word-diff harnesses in `/tmp/iv1_audit/`), not by reusing the author's `_tools/`. Rendered-page inspection used macOS `qlmanage` rasterization of pypdf-extracted single pages; vision-model readings were accepted only where cross-validated against native text layers, content-stream font analysis, or repeated consistent strip-crop reads (two vision readings that contradicted native text were identified as hallucinations and discarded — see §8).

## 3. Repository baseline (verified this act)

| item | value |
|---|---|
| root | `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator` |
| branch | `navigator-production-dialogue-corr2-ab-normalization` |
| HEAD | `2b46cfa007f60410e2a1916601b5df4e0480007f` |
| origin/main (after fetch) | `2b46cfa007f60410e2a1916601b5df4e0480007f` |
| remote main (`git ls-remote`) | `2b46cfa007f60410e2a1916601b5df4e0480007f` |
| ahead/behind | `0 / 0` |
| staged paths | none |
| `git diff --check` | clean |

Untracked, untouched: `AGENTS.md`; 2 governance docs + 1 zip under `docs/governance/navigator/2026-09-18-live-supabase/`; the author report. New untracked file after this IV: this report only.

## 4. Controlling authority identity

- Map: `docs/ACADEMY_RAG_AUTHORITY_MAP_1_OWNER_DECISION_CLOSURE_2026-09-20.md`
- Commit: `2b46cfa007f60410e2a1916601b5df4e0480007f`
- SHA-256 recomputed this act: `5d8ca79e4afa3fa2a22b51221380e04e9fce2be2f72fc3fff9b2cc41ef863078` — **MATCH**.
- Author report SHA-256 recomputed: `08093eb149326b3e0148a95077897b00888ffb4fe957fd0fa429f3fe0693f38c` — **MATCH**.

## 5. Candidate package identity

- Expected 20 canonicals; found exactly 20 in `/Users/entp_psyche/Desktop/Academy Texts Corpus`, created 2026-09-20 14:50–14:51; no unexpected canonical candidate files added (the 5 pre-existing Maslow canonicals are dated 2026-09-18 and untouched).
- All 20 canonical SHA-256 and byte sizes recomputed → match MANIFEST.json, per-file sidecars, SOURCE_TO_CANONICAL_MAP.md, and the author report exactly.
- Every sidecar field cross-checked against MANIFEST (course, role, source/canonical file+hash, transformationType, verificationState) → zero discrepancies. `verificationState = CANDIDATE_PENDING_INDEPENDENT_VERIFICATION` everywhere, untouched by this IV.
- `chapterIdentity` exact for all 12 ST sidecars: chapter-01 … chapter-08, chapter-09-12, chapter-13 … chapter-15; `knowledgeSource = structural-typology-book`.

## 6. Source-integrity results

- 19 unique originals (ST_3 used twice). All 19 SHA-256 independently recomputed → match the authority map §14, MANIFEST, sidecars, and the author report. **Hash mismatches: 0. Identity mismatches: 0. Role/course mismatches: 0** (levels: FOUNDATIONAL=ST_3-derivative, ELABORATION=transcript, OPERATIONALIZATION=PDF; play: FOUNDATIONAL=Arts, SUPPLEMENTAL=Methodology; norma: FOUNDATIONAL=PDF; prof-dev: FOUNDATIONAL=docx, ELABORATION=pdf; ST: 12× FOUNDATIONAL — all exactly per the Owner-closed map).

## 7. All 20 candidate audit rows

Method per 1:1 candidate: independent extraction of the full source (body paragraphs incl. nested textbox paragraphs, tables as cell units, footnotes/endnotes for DOCX; per-page native text with hyphen-join for PDFs) → word-level ordered containment against the canonical (footnote markers and running page numbers handled deterministically) → every non-matching unit resolved by divergence-point analysis to a named cause. "PASS" below means: no substantive omission or semantic alteration found at source level.

| # | candidate | result | notes |
|---:|---|---|---|
| 1 | Levels_of_Consciousness_FOUNDATIONAL_CANONICAL.md | PASS | Special audit §12; 368/368 sentences grounded in ST_3 (incl. footnotes.xml); only the 2 declared book-context omissions; no imported/invented content |
| 2 | LevelsOfConsciousness_Transcript_CANONICAL.md | PASS | Special audit §13; 21 word-level changes, all authorized and changelog-logged; 1 typo MINOR-6 |
| 3 | LevelOfCons_Protections_of_Perception_CANONICAL.md | **FAIL (M-2)** | Native text layer 100% preserved word-level for all 57 slides; slide 4 core schema lost (§9) |
| 4 | Arts_like_methodology_CANONICAL.md | PASS | 3 flags all benign (mid-word italic boundary `*«В*сякая`; tab joins `5.а⇥Первый`) |
| 5 | MethodologyOfLeadersContemplates_CANONICAL.md | PASS | 0 missing units |
| 6 | NormaSituations_CANONICAL.md | PASS (with MINORs) | Word-complete, in order, for 69/70 pages; page 60 reflow verified complete (§8) |
| 7 | StagesOfProfessionalization_CANONICAL.md | PASS | 0 missing units; no tables in source |
| 8 | Stages_of_Professionalization_Presentation_CANONICAL.md | PASS | All 16 pages native-complete (extracted ≈ hex-bytes/2 on every page — no undecodable text); decorative images |
| 9 | ST_01_CANONICAL.md | PASS | initial flags = footnote-marker digits only |
| 10 | ST_02_Stages_of_Development_CANONICAL.md | PASS | 5/5 tables preserved (letter-stream + row counts) |
| 11 | ST_03_Levels_of_Consciousness_CANONICAL.md | PASS | Complete chapter (§11); diagram-label dedup verified legitimate |
| 12 | ST_04_CANONICAL.md | PASS | 5/5 tables; mid-word bold `ст**о**ит` = source styling |
| 13 | ST_05_CANONICAL.md | PASS | 0 missing |
| 14 | ST_06_CANONICAL.md | PASS | 0 missing |
| 15 | ST_07_CANONICAL.md | PASS | `п**о**том` = source emphasis; table preserved; 7 images = photographs |
| 16 | ST_08_CANONICAL.md | PASS | 2/2 tables preserved; images decorative (incl. 321KB seascape photo, vision-verified no text) |
| 17 | ST_09_12_CANONICAL.md | PASS (with MINOR-7) | 30/30 unique tables preserved; 16 stack codes bold-boundary MINOR |
| 18 | ST_13_CANONICAL.md | **FAIL (M-1)** | 6 real Word tables fully preserved; Табл. 12 drawing-nested table data omitted (§10) |
| 19 | ST_14_CANONICAL.md | PASS | 4/4 tables (17-row варна tables) preserved |
| 20 | ST_15_CANONICAL.md | PASS | 0 missing |

Cross-cutting verified: 62 unique real Word tables across all DOCX — every one fully contained in its canonical (letter-stream) with matching row structure; the only table-content loss in the entire act is ST_13's nested drawing table (M-1).

## 8. Visual-content audit (PDF and DOCX graphics)

**LevelOfCons Protections of Perception.pdf** — native-text completeness verified page-by-page (0 word-level losses). Structural analysis of the PDF: shared background rasters on pages 10–45 extracted and vision-verified as blank decorative templates (no text); icons are tiny rasters; Form XObjects are vector icon art without text operators. Two vision readings that described content contradicting native text (a "table" on slide 34, "cards" on Stages p.3/p.8) were **rejected as hallucinations** after deterministic validation against native text and the extracted shared images.

- **Slide 4 (M-2)**: title band and strip-crop reads (two independent passes, consistent) establish a substantive multi-row schema «УРОВНИ СОЗНАНИЯ»: rows including «ТЕОРЕТИЧЕСКОЕ (ИНТЕГРАЛЬНОЕ) СОЗНАНИЕ», «(ОБЩЕСТВЕННЫЙ ТИП)», a subject-scale column «ЧЕЛОВЕЧЕСТВО / ОБЩЕСТВО / ГРУППА / ЧАСТНАЯ ЖИЗНЬ», «ЦЕЛЬ: УДЕРЖАТЬ ПОРЯДОК», «ЦЕЛЬ: УДЕРЖАТЬ БЛАГОСОСТОЯНИЕ», and an «АВТОНОМИЯ» scale with numerals. Content-stream analysis shows this text is drawn as vector outlines under a subset font with **no ToUnicode mapping** (`/F7` TrueType, ToUnicode absent; the only decodable text on the page = the 3 bracket labels, 84 chars ≈ exactly the 150 CID bytes present). The canonical's slide-4 section contains only the 3 bracket labels, **without the annotation pattern used on slide 56**, and `pages.json` misclassifies slide 4 as `visual_heavy: false`. The schema's vocabulary appears nowhere in the three levels-course canonicals (greps: человечество 0, автономия 0 (deck), удержать порядок 0, благосостояние 0, частная жизнь 0). → substantive visual semantics lost, undisclosed at point of use: **MAJOR**.
- **Slide 3**: raster title slide («ТРИ УРОВНЯ СОЗНАНИЯ и их стратегии защиты» in Image301) — title redundant with slide 1–2 native text; 7 words of native text preserved. MINOR.
- **Slide 56**: rendered and inspected; native text = two `↑` navigation-button glyphs only; the «ПРИМЕР II»/«ПРИМЕР III» labels and photographs are raster; the arrows are UI navigation, not semantic connectors; the canonical preserves the arrows and carries an explicit annotation. Decorative/illustrative loss, documented → MINOR.
- **Stages_of_Professionalization.pdf**: all 16 pages decode fully; per-page extracted chars ≈ hex-CID bytes/2 everywhere (no hidden undecodable text); images decorative. PASS.

**DOCX drawings**: ST_3's 3 diagrams emit textbox label lists with `Подписи к схеме…` annotations; duplication collapsed = genuine OOXML `mc:AlternateContent` Choice/Fallback copies (label sets verified byte-identical, 5/5, 6/6, 4/4; all 15 unique labels present in canonical once). Spatial arrow semantics of the apperception/perception cycle are not reconstructable natively; the governing law is fully present in prose. MINOR. DOCX raster images (ST_7 ×7 photos; ST_8 incl. one 321 KB photograph; ST_9-12 ×16 «Стек эктофункций» bar charts; ST_3/ST_13 illustrations) are dropped with **no in-text placeholder** (counted only in sidecar `extractionAccounting`); the stack charts visualize exactly the textual stack codes («Структура стека функций: Se1 Ti2 Fe3 Ni4» + prose dominance order), i.e., redundant. MINOR.

## 9. Levels PDF special audit (LevelOfCons)

See §8 (slide 4 = MAJOR M-2; slides 3 and 56 = MINOR). Adjacent pages 5, 7, 54, 55, 57 natively complete and preserved; source-side duplicated sentences on slides 54–55 (slide animation states in the text layer) were preserved, not deduplicated — correct under the no-deletion policy.

## 10. ST_3 full-chapter audit (structural-typology chapter-03)

`ST_03_Levels_of_Consciousness_CANONICAL.md` vs `ST_3 (Levels of Consiousness).docx`: 0 substantive missing units. The 7 initial flags all resolve to the duplicated diagram-label groups (§8) and footnote-marker positions. The chapter is COMPLETE: no levels-specific content was removed because a separate derivative was also created; the two documents differ exactly by the derivative's declared 2 book-context omissions and its course framing (§12). The ST_3 nested-drawing scan (tables inside `w:txbxContent`) found ST_13 as the **only** DOCX in the corpus with a drawing-nested table — ST_3 has none.

## 11. ST_13 Табл. 12 audit (MAJOR M-1)

Source `ST_13.docx` body block 204 is a drawing whose textbox contains a nested 17×2 Word table (present twice via Choice/Fallback):

```
ЭГО (Тип личности MBTI) | Персона (в Норме)
INFJ (16) | (10) INTJ      INFP (15) | (4) ISFP
ENFJ (14) | (6) ESFJ       ENFP (13) | (11) ENTP
INTP (12) | (2) ISTP       ENTP (11) | (13) ENFP
INTJ (10) | (16) INFJ      ENTJ (9)  | (7) ESTJ
ISTJ (8)  | (5) ISFJ       ESTJ (7)  | (9) ENTJ
ESFJ (6)  | (14) ENFJ      ISFJ (5)  | (8) ISTJ
ISFP (4)  | (15) INFP      ESFP (3)  | (1) ESTP
ISTP (2)  | (12) INTP      ESTP (1)  | (3) ESFP
```

These numerals are the chapter's own 1–16 complexity hierarchy («1 — самый элементарный, 16 — наиболее сложный тип личности»), and the table is the **only** carrier of the full ЭГО-rank → Персона-rank mapping: the prose's worked example («у одного и того же человека в Норме ЭГО будет с уровнем 12, а Персона — на уровне 2» = row «INTP (12) → (2) ISTP») is unresolvable without it. The canonical keeps the caption «Табл. 12. Иерархия типов личности (ЭГО) и Персоны в Норме» and then continues directly to «На графике…» — all 16 data rows absent; `grep` confirms no `(16)`/`(10)`-style pairs anywhere in the canonical; the mapping exists nowhere else in the corpus (Табл. 5 has the type pairs but not the ranks). The author's own `_extract/ST_13_CANONICAL.extract.json` records `source_xml_tables: 8` vs `canonical_tables: 6` — a visible, unreconciled 2-table delta (= this nested table's Choice+Fallback copies). This omission is not in the author report's anomaly list. **Substantive omission + materially flattened table relationship: MAJOR.**

## 12. ST_3 levels derivative audit

Independent bidirectional sentence-level check (incl. `footnotes.xml`):
- Derivative → ST_3: 368 substantive sentences checked; after stripping footnote markers, **all grounded**. The only ungrounded strings are the 3 disclosed «Подписи к схеме в исходном документе:» annotations.
- ST_3 → derivative: 349 substantive sentences; 8 initial misses all resolved: exactly the **2 declared book-context omissions** (book-forward pointer «…к типам личности»; parenthetical «(см. «Стадии развития интеллекта»)») — matching `LEVELS_ST3_DERIVATION_MAP.md` precisely — plus 2 diagram-dedup label groups (present once) and 4 marker/glue artifacts.
- No invented bridges, no transcript material, no semantic rewriting; footnoted Jung bibliography carried over intact. The block-level derivation map is complete and accurate. **PASS.**

## 13. Levels transcript audit

Word-level `difflib` diff, original (14,337 words) vs canonical body (14,333): **21 blocks, all accounted**:
- +10-word provenance header (declared pattern); −9-word speech2text footer (declared);
- 14 «масла/маслов/маслова/масло» → «Маслоу» proper-name restorations (changelog entries 3–15);
- «религарное» → «религиозное» (entry 17); «событинного» → «обыденного» (entry 18, non-word ASR garble restored to the lecture's own level term — authorized class);
- 5 accidental-duplicate removals (entry 20, count 5 = verified doubles «сапиенс сапиенс», «бескомпромиссная бескомпромиссная», «когда когда», «самом самом», «часто часто»), each confirmed duplicated in the original.
- Defect: canonical renders «Фрейд и Масло**уу**» (double у) once; changelog entry 13 misstates the canonical as «Маслоу». MINOR-6. No semantic rewriting, no deleted argument; «Пысал, пысал» preserved. **PASS.**

## 14. Structural-typology whole-book coherence audit

12 chapter documents present; chapter identities exact (§5); no chapter missing; ST_9-12 is one document («Часть 6. Иерархия 16 типов личности Майерс-Бриггс», internal 16 type sections); no cross-chapter text movement (each canonical's content is contained in its own hash-verified source); no duplication between ST_03 chapter and the levels derivative beyond the shared ST_3 origin (different documents by declared design, both traceable); no ST_16+. **PASS except ST_13 (M-1).**

## 15. Professional-development-stages governance check

Both candidates exist and are canonicalization-only. No `academy_course_sources` binding, no ingestion artifacts (`_RAG_INGESTION/` contains only the pre-existing Maslow files), no runtime/routability code changes (worktree clean), `ingestionAuthorizedByThisAct = false` and `activeBindingAuthorizedByThisAct = false` on both sidecars. The course remains LISTED_UNROUTABLE; runtime retrieval remains forbidden pending a separately authorized routability/binding act. **Governance: compliant.**

## 16. Course-page files and exclusions

- All 5 course pages + protected Maslow files hash-verified untouched vs the authority map §14: `Levels-of-Consciousness.md`, `Maslow-Hierarchy-of-Needs.md`, `Play-and-Creativity.md`, `Normative-Situation.md`, `Structural-Typology.md`, `Course_Maslow_Hierarchy.pdf`, `Maslow_QA_CANONICAL.md`, `Maslow_QA_CANONICAL_CORR1.md` — 8/8 MATCH.
- Exclusions: `Kaufman-self-actualization-2018.pdf` absent; extra duplicate Maslow manuscript absent; no excluded source reintroduced into any candidate (each candidate's content traces exclusively to its authorized source). **PASS.**

## 17. Provenance-package audit

MANIFEST.json, 20 sidecars, SOURCE_TO_CANONICAL_MAP.md, CANONICALIZATION_REPORT.md: internally consistent (filenames, both hash families, course IDs, roles, transformation types, chapter IDs, byte sizes — all recomputed and matched). pages.json per-page provenance (md-line ranges, printed-page omissions) consistent; Norma pages.json records exactly 1 omitted page (cover). Defect: `_extract/LevelOfCons_Protections_of_Perception_CANONICAL.pages.json` marks slide 4 `visual_heavy: false` (slides 3 and 56 are `true`) — a provenance misclassification that hid M-2 (MINOR-9, evidence to M-2). ST_13 extract.json's 8-vs-6 table count is captured but unreconciled (evidence to M-1).

## 18. Defect register

| id | severity | finding | source / candidate | evidence |
|---|---|---|---|---|
| M-1 | MAJOR | Табл. 12 hierarchy data (17×2 nested table: ЭГО type+rank → Персона rank+type, ranks 1–16) omitted; caption kept; undisclosed | ST_13.docx block 204 / ST_13_CANONICAL.md | §11; extract.json 8-vs-6 tables; canonical greps; prose example INTP(12)→ISTP(2) unresolvable |
| M-2 | MAJOR | Slide 4 «УРОВНИ СОЗНАНИЯ» schema (vector-outline text, no ToUnicode) absent, no in-file annotation, pages.json visual_heavy=false; vocabulary absent from whole levels corpus | LevelOfCons…pdf p.4 / LevelOfCons…CANONICAL.md | §8–9; font analysis; 2 consistent strip-crop reads; zero-coverage greps |
| m-1 | MINOR | Glued 20pt heading «Социальная действительность как фрактально-уровневая матрица» + following paragraph on one line (canonical line 66) | NormaSituations.pdf / canonical | §7 row 6 |
| m-2 | MINOR | Residual intra-word spaces (~40 letter-fragments / 13,365 tokens ≈ 0.3%; e.g. «о своения», «с уществующей», «источнико м») inherited from PDF text layer; terminology intact | NormaSituations.pdf / canonical | stem-count table: all domain terms ≥ source counts |
| m-3 | MINOR | Table-like pages rendered as prose (e.g. 5-column «Диагностика НС» map, pp. 60–62); row grouping and cell order preserved | NormaSituations.pdf / canonical | §7 row 6 |
| m-4 | MINOR | Slide 3 raster title («ТРИ УРОВНЯ СОЗНАНИЯ и их стратегии защиты») not in canonical; redundant with slides 1–2 native text | LevelOfCons…pdf / canonical | §8 |
| m-5 | MINOR | Slide 56 image-only «ПРИМЕР II/III» example slides unreconstructible (annotated in canonical; arrows are navigation buttons) | LevelOfCons…pdf / canonical | §8 |
| m-6 | MINOR | Canonical typo «Маслоуу» (1×) and changelog entry 13 misstating it as «Маслоу» | transcript / changelog | §13 |
| m-7 | MINOR | 16 function-stack codes contain a mid-code bold boundary (`**…Se1**Ti2Fe3Ni4`), breaking exact-string search of the codes; elements and order intact | ST_9-12.docx / ST_09_12_CANONICAL.md | §7 row 17 |
| m-8 | MINOR | ST_3 diagrams reduced to label lists; spatial/arrow semantics of the apperception–perception cycle not reconstructable (law fully present in prose; annotated) | ST_3.docx / ST_03 canonical | §8 |
| m-9 | MINOR | pages.json misclassification: slide 4 `visual_heavy: false` | provenance package | §17 |
| m-10 | MINOR | DOCX raster images dropped without in-text position placeholders (only sidecar counts); ST_9-12 stack charts redundant with textual stack codes; other rasters decorative | ST_3/7/8/9-12/13.docx | §8 |
| m-11 | MINOR | Cosmetic: «## Слайд N. Слайд N» placeholder headings (slides 31–45 series); tab-joined «5.а⇥Первый» in Arts | LevelOfCons / Arts canonicals | §7 |

**Counts: BLOCKING = 0 · MAJOR = 2 · MINOR = 11.**

## 19. Final verdict

**FAIL.** Per §23 of the IV brief, PASS requires MAJOR = 0. Two MAJOR defects (M-1, M-2) each require modifying a candidate to repair.

## 20. Exact corrective scope (for a bounded CORR act)

1. **ST_13 / M-1 (no OCR needed):** reconstruct Табл. 12 into `ST_13_CANONICAL.md` at the caption position as a Markdown table from the native nested-table XML (data reproduced verbatim in §11), e.g. columns `ЭГО (Тип MBTI, ранг)` / `Персона в Норме (ранг, Тип MBTI)` with rows `INFJ (16) | (10) INTJ` … `ESTP (1) | (3) ESFP`; then update `ST_13_CANONICAL.sidecar.json` (hash, bytes, accounting note reconciling the 8-vs-6 table count), `MANIFEST.json`, `SOURCE_TO_CANONICAL_MAP.md`, `CANONICALIZATION_REPORT.md`, and the author report addendum.
2. **LevelOfCons / M-2 (two-tier):** (a) minimum in-scope repair — add to the slide-4 section of `LevelOfCons_Protections_of_Perception_CANONICAL.md` the same disclosure annotation pattern as slide 56 (native layer nearly empty; core «УРОВНИ СОЗНАНИЯ» schema not reconstructable without OCR) and set `visual_heavy: true` for slide 4 in `_extract/…pages.json`, with hash/manifest updates; (b) full repair requires an **Owner-authorized transcription act** (OCR or manual vector-render transcription of slide 4 into a Markdown schema block), because this act operated under an OCR prohibition.
3. Optional MINOR repairs (Owner's discretion, non-blocking): «Маслоуу»→«Маслоу» + changelog entry 13; promote the glued Norma heading; slide-4-annotation consistency.

All corrections modify candidates and provenance → they belong to a separately authorized CORR act, then re-IV of the touched candidates.

## 21. Forbidden-action and final worktree check (this IV act)

Candidate/sidecar/manifest/report modifications: NO (this IV wrote only this file). Ingestion, Supabase, Storage, embeddings, bindings, runtime changes, git add/commit/push: NO. Final `git status --porcelain=v1` / `git diff --name-only` / `git diff --cached --name-only` / `git diff --check` executed after writing this file: expected state = 4 pre-existing untracked governance inputs + author report + this IV report, nothing staged, no tracked drift.

**IV artifact SHA-256:** recorded in the final response of this act (`shasum -a 256` of this file, executed after write).

**Next state: `CORRECTION_REQUIRED`.**
