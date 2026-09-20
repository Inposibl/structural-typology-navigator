# ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.CANONICALIZATION-1.CORR1.IV2-INTEGRITY — independent report

**Act:** `ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.CANONICALIZATION-1.CORR1.IV2-INTEGRITY`
**Role:** INDEPENDENT INTEGRITY VERIFICATION AUDITOR
**Owner authorization:** ACTIVE (this turn)
**Date:** 2026-09-20
**Verdict:** **PASS** — BLOCKING 0 · MAJOR 0 · MINOR 3
**IV2 artifact SHA-256:** recorded in the final response of this act (`shasum -a 256` of this file, executed after write)

---

## 1. Act identity

Narrow independent integrity re-verification of the corrected canonicalization package after CORR1.IV1 disclosed a process-integrity event (fabricated interim tool outputs before re-running affected checks).

This act is **not** a full re-audit of the 20 canonical documents. It independently re-establishes the four decisive claims required for Owner acceptance:

1. `ST_13_CANONICAL.md` — Табл. 12 restored correctly from source DOCX XML (Check A).
2. `LevelOfCons_Protections_of_Perception_CANONICAL.md` — slide 4 faithfully transcribed from the rendered source PDF page 4 (Check B).
3. `LevelsOfConsciousness_Transcript_CANONICAL.md` — exactly one authorized typo change (Check C).
4. The remaining 17 candidates byte-identical to their pre-CORR1 versions; provenance hashes internally consistent (Check D + §10).

No methodology was changed. No product source was written. No candidate, sidecar, manifest, provenance map, report, source document, or authority map was modified.

## 2. Independence statement

I did not author `CANONICALIZATION-1`, `CORR1`, `IV1`, or `CORR1.IV1`. I am not the author of any artifact under verification.

Every decisive finding below is derived from primary evidence generated in this session:

- original `ST_13.docx` OOXML (`word/document.xml`) parsed by me;
- original `LevelOfCons Protections of Perception.pdf` rendered by me with two independent engines;
- current canonical candidates read from disk by me;
- current provenance files read from disk by me;
- git state inspected by me;
- hashes computed by me (`hashlib.sha256`, `shasum -a 256`).

Prior reports were read **only** to learn the claimed scope (what CORR1 said it changed, what hashes it recorded). No prior auditor statement was used as evidence. Specifically: Z.ai's visual transcriptions, its XML-table transcription, its intermediate tool outputs and its reconstructed hashes were not reused. The prior slide-4 vocabulary claims were treated as untrusted and re-derived from the raster.

**Key independence gain:** I located physical pre-CORR1 bytes on disk — `_RAG_CANONICALIZATION/ACADEMY_MULTI_COURSE_CANONICALIZATION_1/_extract/preview/` — 18 files with mtimes 2026-09-20 14:50/14:51. All 18 hash to the pre-CORR1 values recorded independently in the original author report (§6 of that report). This let me diff the corrected state against a real pre-CORR1 snapshot instead of against a recorded hash list. This directory is not mentioned in any prior report or provenance document (OBSERVED; see §10, O-1).

## 3. Process-integrity statement

- No check is described below that I did not actually execute.
- No terminal output, hash, render, diff or XML extraction was synthesized or inferred from intent.
- Vision was used **only** to read rendered rasters that I produced myself, and no final assertion rests on vision alone where a deterministic measurement was possible. The one finding that corrects a prior visual claim (§7, MINOR-1) was established by pixel measurement and confirmed by a second, independent rendering engine — not by unaided visual reading.
- Where a negative could not be mechanically established within this read-only act, it is marked `[UNVERIFIED-BY-ME]` rather than asserted.
- Tags used: **OBSERVED** (seen in tool output this session), **COMPUTED** (derived by a command/hash/measurement this session), **INFERRED** (reasoned from OBSERVED/COMPUTED).

## 4. Baseline

| item | value | source |
|---|---|---|
| root | `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator` | `git rev-parse --show-toplevel` |
| branch | `navigator-production-dialogue-corr2-ab-normalization` | `git branch --show-current` |
| HEAD | `2b46cfa007f60410e2a1916601b5df4e0480007f` | `git rev-parse HEAD` |
| origin/main | `2b46cfa007f60410e2a1916601b5df4e0480007f` | `git rev-parse origin/main` after `git fetch origin` (exit 0) |
| remote main | `2b46cfa007f60410e2a1916601b5df4e0480007f` | `git ls-remote origin refs/heads/main` |
| ahead/behind | `0 / 0` | `git rev-list --left-right --count origin/main...HEAD` |
| staged | none | `git diff --cached --name-only` (empty) |
| whitespace check | clean | `git diff --check` (exit 0) |
| tracked dirty paths | none | `git status --porcelain=v1` → only `??` entries |

Untracked entries are the expected act/governance reports (`AGENTS.md`, the four CANONICALIZATION-1 act reports, two CORR2 governance documents, one CORR2 closure zip). No tracked file is modified. Baseline matches the expected clean tracked state → no HOLD.

## 5. Report / file identity checks

All five identities were recomputed by me with `shasum -a 256` and match exactly:

| artifact | expected SHA-256 | recomputed | match |
|---|---|---|---|
| `docs/ACADEMY_RAG_AUTHORITY_MAP_1_OWNER_DECISION_CLOSURE_2026-09-20.md` | `5d8ca79e…863078` | `5d8ca79e4afa3fa2a22b51221380e04e9fce2be2f72fc3fff9b2cc41ef863078` | YES |
| `docs/…CANONICALIZATION_1_REPORT_2026-09-20.md` (author) | `08093eb1…693f38c` | `08093eb149326b3e0148a95077897b00888ffb4fe957fd0fa429f3fe0693f38c` | YES |
| `docs/…CANONICALIZATION_1_IV1_2026-09-20.md` | `f02625ef…ae1ebd9` | `f02625ef30d6a2eb298802aed50a6176eeb550f4d65366942b3dc1eaeae1ebd9` | YES |
| `docs/…CANONICALIZATION_1_CORR1_REPORT_2026-09-20.md` | `7a85f12f…eb9b619` | `7a85f12f08c38f2a5ca174189a31a3c1980a89e117142c7ae3383ac1beb9b619` | YES |
| `docs/…CANONICALIZATION_1_CORR1_IV1_2026-09-20.md` | `21a9d50a…b9095add` | `21a9d50a05d1e850cc5f60d8156a747fd8c2c0353db6a48e8efef56cb9095add` | YES |

Source identities (COMPUTED, this session):

| source | expected | recomputed | match |
|---|---|---|---|
| `ST_13.docx` | `fb08885be803a847e43d4794a91490f47fa760b723ce2fafdd2109bbf976c28c` | same | YES |
| `LevelOfCons Protections of Perception.pdf` | `dceb9f5ab7bea070d54017df3da9b743dc870f67eab4311445d5e9bca5d89e44` | same | YES |
| `LevelsOfConciousnessTranscrib.md` | `31a8ec963d6e68a45becd8f2c1945502c249008afe80af25ec7d274f9ea2fdf0` | same | YES |

Current canonical identities (COMPUTED) — all three match the values named in the act brief:

| canonical | SHA-256 | bytes |
|---|---|---:|
| `ST_13_CANONICAL.md` | `db3e4ecf1fc63a3b76fdd66aa62d2eb245484da764ed8f84c60b3d8b590ce3e9` | 106256 |
| `LevelOfCons_Protections_of_Perception_CANONICAL.md` | `a5aef1241756b47ed061d97fdfcb1b3a201dbf408b356c50788d853399016c24` | 53456 |
| `LevelsOfConsciousness_Transcript_CANONICAL.md` | `7faebe8af8ea37422042a7c6624b2cf04053b6b888af852f46a83d5285533f42` | 170906 |

## 6. Check A — ST_13 Табл. 12 (source DOCX XML)

**Method.** `ST_13.docx` extracted to a temp directory; `word/document.xml` (1 073 014 bytes, `sha256 d43a003d7d74d2ff051cb3d9d00032efa68e0e8675cab6ece4418642336e26fd`) parsed directly with `xml.etree.ElementTree` over the `w:` namespace. No prior extracted JSON was used.

**Findings (COMPUTED).**

- The caption paragraph is body child index **204**. Its text ends with the exact caption `Табл. 12. Иерархия типов личности (ЭГО) и Персоны в Норме`. The caption runs follow the drawing inside the same paragraph, i.e. the caption sits **below** the table as in the source layout.
- Raw `w:tbl` count in the body subtree = **8**. Body-direct tables = **6**. Nested drawing tables = **2**.
- The two nested tables live inside a single `mc:AlternateContent` block with `mc:Choice Requires="wps"` (1 table, 1 `w:txbxContent`, 1 `wps:wsp`) and `mc:Fallback` (1 table, 1 `w:txbxContent`, 1 `pict`). These are the modern DrawingML and the legacy VML renderings of the **same** text box; a renderer draws one or the other, never both.
- Cell-by-cell comparison of the two nested tables: **identical** (17 rows × 2 columns, all 34 cells equal) → the duplication is purely technical. Unique semantic source tables = **7**.
- Reconstructed table from XML (header + 16 data rows, exact cell text, exact order):

```
r00: ['ЭГО (Тип личности MBTI)', 'Персона(в Норме)']
r01: ['INFJ (16)', '(10) INTJ']      r09: ['ISTJ (8)',  '(5) ISFJ']
r02: ['INFP (15)', '(4) ISFP']       r10: ['ESTJ (7)',  '(9) ENTJ']
r03: ['ENFJ (14)', '(6) ESFJ']       r11: ['ESFJ (6)',  '(14) ENFJ']
r04: ['ENFP (13)', '(11) ENTP']      r12: ['ISFJ (5)',  '(8) ISTJ']
r05: ['INTP (12)', '(2) ISTP']       r13: ['ISFP (4)',  '(15) INFP']
r06: ['ENTP (11)', '(13) ENFP']      r14: ['ESFP (3)',  '(1) ESTP']
r07: ['INTJ (10)', '(16) INFJ']      r15: ['ISTP (2)',  '(12) INTP']
r08: ['ENTJ (9)',  '(7) ESTJ']       r16: ['ESTP (1)',  '(3) ESFP']
```

- Canonical `ST_13_CANONICAL.md` lines 283–300 reproduce this grid **character-for-character**, including the header's exact spacing (`Персона(в Норме)` with no space, `ЭГО (Тип личности MBTI)` with one). Row order, every MBTI token, every rank numeral identical. The table appears **exactly once**.
- Canonical markdown table count = **7** (separator-row count), matching `unique_semantic_source_tables = 7` in the sidecar and `canonical_tables: 7` in `canonicalStats`.
- **Surrounding prose unchanged — proven, not asserted.** Deleting the 18-line table block (487 bytes) from the current canonical reproduces a file whose `sha256` is exactly `a1ae213d411dda19e0361b18728be88a6d97ad94f7da1105fff51bc6fc3ee926` = 105 769 bytes, i.e. the pre-CORR1 canonical recorded independently by the author report. Independent confirmation: `diff -u` of `_extract/preview/ST_13_CANONICAL.md` (pre-CORR1, 105 769 bytes, hash `a1ae213d…`) against the current file yields **one pure insertion block, 0 deleted lines, 0 modified lines**. Both the +487-byte delta and the resulting hash agree.

**Check A result: PASS.** No cell differs. Duplication clearly technical. Canonical represents the table exactly once; surrounding prose byte-identical to pre-CORR1.

## 7. Check B — Levels slide 4 (rendered source PDF, page 4)

**Method (all renders produced by me this session).**

- `gs 9.53.3 -sDEVICE=png16m -dFirstPage=4 -dLastPage=4` at 300 dpi (4000×2250) and 600 dpi (8000×4500).
- Independent second engine: single-page PDF written with `pypdf` into `/tmp`, rendered with macOS Quick Look/CoreGraphics (`qlmanage -t -s 4096` → 4096×2304). A third engine (`sips`) was also run.
- Page identity confirmed: `pypdf` reports 57 pages; the isolated page decodes to the three thinking labels and its visible page number is «4» (bottom-right raster crop).
- Native text layer of page 4 extracted independently: exactly 84 characters — `Транс-логическое мышление`, `Ассоциативно-чувственное мышление`, `Рефлексивное мышление`. Content-stream analysis shows 10 `BT/ET` text blocks, all in `/F6` (Identity-H) plus one `/F7` hyphen; every one of them decodes to those three labels. The words `АППЕРЦЕПЦИЯ` / `ПЕРЦЕПЦИЯ` are **not** in the text layer (drawn as outlines/objects) — consistent with the canonical's note in line 31.
- No prior transcription, no ST_3, no transcript, no course page and no general knowledge were used. Slide 4's raster is the only content authority used for this check.

**Verified against the raster (OBSERVED + measured).**

| canonical element (lines 33–80) | raster evidence | result |
|---|---|---|
| Left panel title `УРОВНИ СОЗНАНИЯ` | large two-line stacked serif title in the left white panel | exact |
| `ДУХОВНОЕ (СОЗЕРЦАТЕЛЬНОЕ) СОЗНАНИЕ` + person icon, top band | top bar, `[иконка одного человека]` at its left | exact |
| three bidirectional vertical arrows to the three СПЕЦИАЛЬНОЕ boxes | three connectors, each with an up arrowhead into the top bar **and** a down arrowhead into its box | exact |
| three side-by-side blocks `СПЕЦИАЛЬНОЕ (ДИСЦИПЛИНАРНОЕ) СОЗНАНИЕ`, left→right, person icon each, inner labels `ФИЛОСОФСКОЕ` / `ИНЖЕНЕРНОЕ` / `ЛЮБОЕ ДРУГОЕ` | three boxes at x 2758–3897 / 4020–5159 / 5279–6418 with inner sub-boxes; inner label text matches | exact |
| up-arrow into each block from `ТЕОРЕТИЧЕСКОЕ (ИНТЕГРАЛЬНОЕ) СОЗНАНИЕ` | three up arrowheads at the boxes' bottom edges | exact |
| left connector from the leftmost special box down into level `1 СУБЪЕКТИВНАЯ ОЦЕНКА` | vertical line at x 2569–2577 from y≈1480 down to y≈3434, then a right-pointing arrowhead into level 1 | exact |
| `ТЕОРЕТИЧЕСКОЕ (ИНТЕГРАЛЬНОЕ) СОЗНАНИЕ` + group icon; left arrow; up arrow from moral; down arrow to syncretic | group icon at left; left-pointing arrowhead to the connector; up arrowhead from `АВТОНОМИЯ`; see MINOR-3 for the down connector's phrasing | exact (relation), MINOR-3 (wording) |
| `МОРАЛЬНОЕ СОЗНАНИЕ` + person icon; scale `3 АВТОНОМИЯ` / `2 ВИНА (СТЫД)` / `1 СУБЪЕКТИВНАЯ ОЦЕНКА` | box x 2748–4375, y 2203–3644; three sub-boxes carrying numerals 3, 2, 1 | exact |
| `3 АВТОНОМИЯ`: up arrow to theoretical; up arrow from level 2 | up arrowhead above `АВТОНОМИЯ`, shaft at x≈3560 continuing into the theoretical bar | exact |
| `2 ВИНА (СТЫД)`: bidirectional vertical link to level 1 | two opposed arrowheads between the 2 and 1 sub-boxes | exact |
| `1 СУБЪЕКТИВНАЯ ОЦЕНКА`: left input; bidirectional horizontal link to syncretic; bidirectional vertical link to ordinary | left arrowhead entry; horizontal double arrow x 4398–4754 (left head at top, right head at bottom); vertical double arrow below | exact |
| `СИНКРЕТИЧЕСКОЕ (РЕЛИГИОЗНОЕ) СОЗНАНИЕ` + group icon; top input; horizontal link; vertical link | box x 4779–6426, y 2979–3644; down arrowhead into its top; group icon top-left | exact |
| `ОБЫДЕННОЕ СОЗНАНИЕ` + group icon; bidirectional links to moral and syncretic; belt `ПЕРЦЕПЦИЯ` | full-width bar x 2746–6430, y 3882–4147; group icon (three figures) top-left; two vertical double arrows above | exact |
| horizontal dashed belt lines; belt-to-right-column alignment | dashed lines at y≈757–762 and y≈2875–2880; `АППЕРЦЕПЦИЯ III` above the first, `II` between, `I` below, `ПЕРЦЕПЦИЯ` aligned with the ordinary bar | exact |
| line 49: the second dashed line crosses `МОРАЛЬНОЕ СОЗНАНИЕ` between level 3 and level 2 | the dashed line at y≈2877 lies between `АВТОНОМИЯ` (y 2472–2689) and `ВИНА (СТЫД)` (y 2979–3196) | exact |
| right column, top→bottom: `… III [3]` / `… II [2]` / `… I [1]` then `ПЕРЦЕПЦИЯ`; page number «4» bottom-right | four right-column labels in that order; bracketed numerals `[3] [2] [1]` raised; `4` bottom-right | exact (see MINOR-1 for spelling) |
| line 45: preserved native layer text | `pypdf` extraction equals the three quoted labels | exact |

**MINOR-1 (new) — source «АППЕРЦЁПЦИЯ II» rendered in the canonical as «АППЕРЦЕПЦИЯ II».**

The raster of page 4 spells the second right-column label with a diaeresis: **АППЕРЦЁПЦИЯ II [2]**. The canonical (line 39) writes `АППЕРЦЕПЦИЯ II [2]`.

Evidence (deterministic, not visual judgment):

- 600 dpi ink-row analysis of the three labels: `III` ink rows 344–423 (height 80), `I` ink rows 2965–3044 (height 80), **`II` ink rows 825–912 (height 88)**.
- For label `II`, rows 825–832 contain ink confined to x 7264–7289 — i.e. **above** the text line (the letter's top bar starts at row 840). Rendered as ASCII (`#` = ink, window x 7250–7302):

```
   825 ................####..............####..............
   826 ...............######............######.............
   827 ..............########..........########............
   830 ..............########..........########............
   832 ................####..............####..............
   840 .......######################################.......
```

- That is **two round dots**, horizontally centred over the 7th letter cell (cell 7257–7294; dots 7264–7289, centre 7276 vs cell centre 7275).
- Labels `III` (cell x 7259–7295) and `I` (cell x 7259–7295) have **no ink whatsoever** above their top bar (their first ink rows are 344/2965, which belong to the raised `[3]`/`[1]` numerals at x 7673–7729 / 7618–7674, far to the right).
- Confirmed independently by CoreGraphics: in the `qlmanage` 4096 px render, label `II`'s window shows ink rows 5–8 in two blobs (cols [5,6,7] and [14,15]); labels `III` and `I` show none.

Assessment. The canonical is **orthographically correct** — Russian «апперцепция» takes no `ё`, and page 57 of the same deck writes «Апперцепция» with `е` — so the source slide carries a typo. The defect is therefore twofold and non-semantic: (a) the canonical block is presented as a transcription of the raster yet silently normalizes one character of a level label; (b) `LEVELS_SLIDE4_TRANSCRIPTION_MAP.md` line 24 affirmatively states that all three instances «read «АППЕРЦЕПЦИЯ» with Е», which the raster contradicts for instance `II`. Content, order, grouping and relations are unaffected (RAG retrieval impact: negligible). I assessed this as **MINOR**, not MAJOR, because the act's MAJOR criteria for Check B are unsupported or omitted *relations*, and no relation is wrong or missing; the deviation is a diacritic on one letter of one label. It is reported here in full so the Owner can reclassify if they disagree; I have not softened it.

**MINOR-3 (new) — «Стрелка вниз вправо» for the theoretical→syncretic connector.**

Canonical line 66 reads `Стрелка вниз вправо в блок «СИНКРЕТИЧЕСКОЕ (РЕЛИГИОЗНОЕ) СОЗНАНИЕ»`. Measured geometry: the connector is a straight **vertical** line at x 5598–5607 running from the theoretical bar's bottom edge (y 2098) to the syncretic box's top edge (y 2979), ending in a down arrowhead (barbs at y≈2950: x 5575–5587 / 5598–5607 / 5618–5630). Horizontal scan of the whole corridor (y 2110–2990) found no horizontal segment on that path. The relation (theoretical → syncretic, one-way, entering the top) is correct; only the phrase «вправо» implies a rightward path component that is not drawn. Wording-level, MINOR.

**Check B result: PASS with MINOR-1 and MINOR-3.** All substantive inserted items were verified against the raster; no invented semantic content was found; no source relation is omitted; every arrow direction was measured. No element was unreadable (no HOLD condition).

## 8. Check C — transcript typo delta

**Method.** Source `LevelsOfConciousnessTranscrib.md` hashed; current canonical hashed; the pre-CORR1 file is not on disk for this candidate (no preview copy), so the delta was proven by **hash reconstruction**: brute-force insertion of one `у` at every one of the 170 906 character positions of the current file, hashing each candidate and comparing to the recorded pre-CORR1 hash.

**Findings (COMPUTED).**

| item | value |
|---|---|
| source SHA-256 | `31a8ec963d6e68a45becd8f2c1945502c249008afe80af25ec7d274f9ea2fdf0` (matches expected) |
| pre-CORR1 canonical | `3d9bfd1e89c97e6b4cc4dbdd9886efadb59ffc3dcf115957ae76dbbbde71c1cc`, 170 908 bytes |
| post-CORR1 canonical | `7faebe8af8ea37422042a7c6624b2cf04053b6b888af852f46a83d5285533f42`, 170 906 bytes |
| byte delta | −2 bytes = exactly one 2-byte Cyrillic character |
| `Маслоуу` occurrences in current file | **0** |
| `Маслоу` occurrences in current file | 14 |

Reconstruction: inserting one `у` at character index 86052 (line 272 field) reproduces the pre-CORR1 hash **exactly**; a full scan over all positions finds that single distinct edit (the two reported indices 86052/86053 are the same edit — `txt[86052]` is the `у` itself, so inserting before or after it yields the identical string). Context:

```
… два в сознании связываются, Фрейд и Маслоу, получается супер картинка …
pre-CORR1:                 … Фрейд и Маслоуу, получается супер картинка …
```

Because SHA-256 is collision-resistant, this establishes that the delta between the current canonical and the file bearing the pre-CORR1 hash is **exactly that one character** — no other wording, punctuation, paragraph or footer changed anywhere in the document.

**Changelog agreement (OBSERVED).** `LEVELS_TRANSCRIPT_CHANGELOG.md`: header carries the post-CORR1 hash (line 7) and the pre-CORR1 hash (line 8); entry 14 is annotated with the stem-match explanation; the dedicated `CORR1 m-6` entry records `Маслоуу → Маслоу`, `count: 1`, "the only transcript candidate text delta in CORR1". Changelog and observed delta agree exactly. The sidecar's `transformationType` remains `ASR_CONTROLLED_CLEANUP` (unchanged and appropriate) and carries a `corr1` annotation.

**Unauthorized delta: none.** **Check C result: PASS.** No defect.

## 9. Check D — 17 unchanged candidates, byte-identity

Two mutually corroborating derivations were used; neither relies on a hand-written hash list from a prior *response* alone.

**(a) Recorded pre-CORR1 hashes vs current disk (COMPUTED).** The author report's candidate table (lines 102–121) holds 20 rows of `bytes + sha256`. Comparing each against the file now on disk:

- declared touched set = exactly 3 (`ST_13_CANONICAL.md`, `LevelOfCons_Protections_of_Perception_CANONICAL.md`, `LevelsOfConsciousness_Transcript_CANONICAL.md`);
- **17 / 17 remaining candidates byte-identical** (hash **and** byte size);
- deltas of the touched three: `ST_13` +487 B, `LevelOfCons` +5 755 B, transcript −2 B — matching the CORR1 report's own pre/post table.

**(b) Physical pre-CORR1 snapshot on disk (COMPUTED).** `_extract/preview/` holds 18 canonical files with mtimes 14:50/14:51 (before CORR1 ran at ~16:04–16:12). All 18 hash to the author report's pre-CORR1 values. Comparing them to the current corpus:

- **16 / 18 byte-identical** to current disk;
- the **only two** files that differ are `ST_13_CANONICAL.md` and `LevelOfCons_Protections_of_Perception_CANONICAL.md` — exactly the two candidates CORR1 was authorized to modify, plus the transcript (no preview copy) proven separately in §8.
- `diff -u` for `ST_13`: one pure insertion (19 added lines, 0 removed, 0 changed).
- `diff -u` for `LevelOfCons`: exactly **one replaced line** and 51 inserted lines — the pre-CORR1 line `## Слайд 4. Транс-логическое мышление Ассоциативночувственное мышление Рефлексивное мышление` replaced by `## Слайд 4. УРОВНИ СОЗНАНИЯ` plus the transcription block. The three thinking labels from the replaced line are all still present in the new block (lines 38/40/42) and in the preserved native-layer note (line 45) — **no information was lost** by the replacement. No other line anywhere in that canonical differs.

**(c) Corpus completeness (COMPUTED).** Strict set equality: author report (20) == `MANIFEST.json` outputs (20) == sidecars (20) == files on disk (20). Added: none. Deleted: none. All 19 `sourceIntegrity` source hashes match the files on disk → **no source document was changed**.

**Check D result: PASS.** 17 / 17 byte-identical, no additions, no deletions, no source changes.

## 10. Provenance consistency

| artifact | verification | result |
|---|---|---|
| `MANIFEST.json` | `act`, `canonicalCount: 20`, `verificationState: CANDIDATE_PENDING_INDEPENDENT_VERIFICATION`, `forbidden` flags all `false`; all 20 output records' sha256 **and** byte size recomputed against disk | 20/20 match |
| 20 sidecars | per file: `sourceSha256` (recomputed from the source), `canonicalSha256` (recomputed), `canonicalBytes` (recomputed), `courseId`, `authorityRole`, `transformationType`, `verificationState` | all consistent; `verificationState` is `CANDIDATE_PENDING_INDEPENDENT_VERIFICATION` in every one of the 20 |
| touched-candidate sidecars | `corr1: ACADEMY-…-CORR1` present in all three; `ST_13` sidecar additionally carries `choice_fallback_technical_duplicate: 1`, `unique_semantic_source_tables: 7`, `canonical_semantic_tables_after_corr1: 7`, `nested_tabl12_note`; `LevelOfCons` sidecar carries `slide4TranscriptionMapPath` and `slide4Classification: visual-heavy / visual-semantic` | accounting independently reproduced by me (§6) — correct |
| `SOURCE_TO_CANONICAL_MAP.md` | 20 rows; 39 distinct hashes, every one resolving to a current canonical or a source file; courses/roles identical to the sidecars | correct, no stale hash |
| `CANONICALIZATION_REPORT.md` | 21 distinct hashes (20 canonicals + authority map), all current; CORR1 addendum describes M-1, M-2, m-6 exactly as observed in §6/§7/§8 | correct, no stale hash |
| `_extract/LevelOfCons_Protections_of_Perception_CANONICAL.pages.json` | slide 4 `md_line_start 29 / md_line_end 81`, `visual_heavy: true`, `visual_semantic: true`, `corr1` annotation; source hash correct; slide 5 now starts at line 82 (was 31) | consistent with the canonical |
| `LEVELS_SLIDE4_TRANSCRIPTION_MAP.md` | source hash present and correct; block-to-area mapping re-verified against my render | correct except the II-instance claim (§7, MINOR-1) |
| `LEVELS_TRANSCRIPT_CHANGELOG.md` | pre/post hashes correct; entry 14 + m-6 agree with the observed delta | correct |
| stale-hash scan | all 64-hex tokens in 125 package files classified against current canonicals, pre-CORR1 preview files, sources and repo reports | **one** non-current token: `3d9bfd1e…` in the changelog, which is the intentional "Pre-CORR1 SHA-256" record. **No stale hash reference in the active package.** |

**MINOR-2 (new) — stale slide-4 section title in the `LevelOfCons` sidecar.** `extractionAccounting.stats.major_section_titles[3]` still reads

```
Слайд 4. Транс-логическое мышление Ассоциативночувственное мышление Рефлексивное мышление
```

i.e. the pre-CORR1 heading (glued native text), while the corrected canonical's slide-4 heading is `## Слайд 4. УРОВНИ СОЗНАНИЯ`. Every other entry in that list matches the corresponding canonical heading. Related, same class: `CANONICALIZATION_REPORT.md` §7 anomaly 1 still states that for the PDF presentations "graphic/layout of slides is not reconstructed", which is no longer true for `LevelOfCons` slide 4 (the CORR1 addendum at the end of the same file does disclose the change). Both are descriptive-field staleness, not hash staleness; neither misleads about the corrected bytes. MINOR.

**O-1 (observation, not a defect).** `_extract/preview/` — the undocumented 18-file pre-CORR1 snapshot — is not mentioned in any report or provenance document. It is internally consistent with every recorded pre-CORR1 hash and is the strongest evidence supporting Check D. Its absence from the documentation is noted for completeness; it does not contradict anything and is not counted as a defect.

## 11. Governance check

| prohibited action | finding | basis |
|---|---|---|
| ingestion | none | no ingestion tool invoked by this act; all 20 sidecars and MANIFEST carry `ingestionAuthorizedByThisAct: false`; no repo code/config references the corpus |
| Supabase mutation | none (repo-side) | clean tracked tree at `2b46cfa`; no SQL or config change; `[UNVERIFIED-BY-ME]` for the live database — this act grants no live DB access, so I did not query it |
| Storage upload | none | no upload tool invoked; no code path touched |
| embeddings / Cohere | none | no embedding tool invoked; no code/config change |
| `academy_course_sources` binding | none | the only repo occurrences are the pre-existing migration `supabase/migrations/20260918142356_course_source_registry.sql` and `src/lib/knowledge/retrieval/course-source-bindings.ts`; neither is modified, and neither references any canonical candidate (grep for `CANONICAL.md`, `_RAG_CANONICALIZATION`, corpus path over `*.ts/*.tsx/*.js/*.sql/*.json` → 0 hits) |
| runtime activation / routability change | none | authority map hash unchanged (`5d8ca79e…`); no code change; HEAD == origin/main |
| application-code / SQL modification | none | `git status --porcelain=v1` shows no tracked modification; `git diff --cached` empty |
| git staging / commit / push | none | no `git add`, no commit, no push by this act |

`professional-development-stages` remains **LISTED_UNROUTABLE**: the authority map (unchanged, hash `5d8ca79e4afa3fa2a22b51221380e04e9fce2be2f72fc3fff9b2cc41ef863078`) still states "CANONICALIZATION REQUIRED IN CURRENT ROLLOUT; INGESTION AUTHORIZED IN CURRENT ROLLOUT; **ACTIVE BINDING FORBIDDEN WHILE LISTED_UNROUTABLE**; RUNTIME RETRIEVAL FORBIDDEN UNTIL SEPARATELY AUTHORIZED ROUTABILITY/BINDING ACT". Its two candidates keep roles `FOUNDATIONAL` (`StagesOfProfessionalization_CANONICAL.md`) and `ELABORATION` (`Stages_of_Professionalization_Presentation_CANONICAL.md`), unchanged. No active binding exists or was created.

## 12. Defect counts

| severity | count | items |
|---|---:|---|
| BLOCKING | **0** | — |
| MAJOR | **0** | — |
| MINOR (new, this act) | **3** | MINOR-1 slide-4 «АППЕРЦЁПЦИЯ II» → canonical «АППЕРЦЕПЦИЯ II» (§7) + transcription-map claim contradicted for that instance; MINOR-2 stale slide-4 section title in the `LevelOfCons` sidecar, and the related §7 anomaly-1 wording in `CANONICALIZATION_REPORT.md` (§10); MINOR-3 «Стрелка вниз вправо» where the drawn path is a vertical drop (§7) |
| MINOR (prior register) | not reopened | no prior MINOR was made worse by CORR1; none was re-opened by this act |

No new BLOCKING or MAJOR defect exists. The Owner may reclassify MINOR-1 upward if they judge literal fidelity of a transcribed level label to be acceptance-blocking; my evidence for it is complete and deterministic, so such a decision requires no further investigation.

## 13. Verdict

**PASS.**

- Check A — ST_13 Табл. 12: independently reproduced from OOXML XML, cell-exact, technically de-duplicated, inserted once, surrounding prose proven byte-identical to pre-CORR1. **Verified.**
- Check B — Levels slide 4: independently rendered with two engines and verified item by item; no invented semantic content; no omitted source relation; every arrow direction measured. **Verified** (MINOR-1, MINOR-3).
- Check C — transcript: the sole delta is one authorized character, proven by hash reconstruction. **Verified.**
- Check D — 17 remaining candidates byte-identical, no additions, no deletions, no source changes. **Verified.**
- Provenance internally consistent; no stale hash reference; `verificationState` remains `CANDIDATE_PENDING_INDEPENDENT_VERIFICATION` in all 20 candidates and in the manifest.

No fabricated output was used as evidence. No decisive check was unavailable.

## 14. Exact next state

`READY_FOR_OWNER_ACCEPTANCE`

Acceptance does **not** authorize ingestion, `academy_course_sources` binding, Storage upload, embeddings, runtime retrieval, or any routability change. `professional-development-stages` remains `LISTED_UNROUTABLE`. Candidates remain `CANDIDATE_PENDING_INDEPENDENT_VERIFICATION` until the Owner accepts.

Optional, Owner-discretionary, non-blocking follow-ups (none required for acceptance):

1. bounded micro-correction: `АППЕРЦЕПЦИЯ II` → `АППЕРЦЁПЦИЯ II` in the canonical slide-4 block (and the corresponding sentence in `LEVELS_SLIDE4_TRANSCRIPTION_MAP.md`), or an explicit note recording the normalization;
2. refresh `major_section_titles[3]` in `LevelOfCons_Protections_of_Perception_CANONICAL.sidecar.json` to the corrected heading;
3. reword «Стрелка вниз вправо» → «Стрелка вниз» in the canonical slide-4 block.
