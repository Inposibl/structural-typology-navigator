# NAVIGATOR-BOUNDED-REASONING-RAG-1 — BENCHMARK-FREEZE-1.IV1 — INDEPENDENT VERIFICATION REPORT

**Act:** `NAVIGATOR-BOUNDED-REASONING-RAG-1.BENCHMARK-FREEZE-1.IV1`
**Date:** 2026-09-21
**Auditor role:** INDEPENDENT BENCHMARK AUDITOR — Z.AI (appointed by Owner; author of CORR1 is a different actor)
**Audit subject:** CORR1-corrected benchmark candidate at `/private/tmp/navigator-benchmark-freeze-corr1`
**Controlling baseline:** `9a93132f4286c359f4733238467f7543bcad3756`
**Retired (pre-CORR1) identity:** `7362243c7d0fcc4639b6cb9a81a0aced9c68662ced649f7628344a3499d46c96`
**Claimed post-CORR1 identity (verified independently below):** `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3`

All claims below are `[VERIFIED]` in this session by executed commands; representative outputs are pasted.
Auditor scratch scripts (re-runnable, outside the audited tree): `/private/tmp/iv1-audit-zai/{identity_probe,itemsha_probe,audit_core,audit_counts,audit_d1_d2,audit_final}.py`.

---

## 1. Verdict

**PASS.**

- BLOCKING = 0, MAJOR = 0, MINOR = 0. Four NOTEs recorded (§18), none weakens benchmark identity, scoring semantics, blindness, authority boundaries, or reproducibility.
- The corrected candidate's content identity independently recomputes to `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3`.
- Exactly the four adjudicated items changed (`expectedAnswerability` only); the other 119 records are deep-identical to PRE-CORR1; question files and both adversarial files are byte-identical.
- No mutation, no stage, no commit, no push, no provider egress occurred during this audit.
- Per the act brief, Owner acceptance is **not** started. Proposed next act: `NAVIGATOR-BOUNDED-REASONING-RAG-1.BENCHMARK-FREEZE-1.OWNER-ACCEPTANCE-1` (§22).

## 2. Auditor independence

- This session did not author CORR1, the OWNER-ADJUDICATION-1, or the freeze report, and holds no authorial stake in the candidate.
- Identities were recomputed from emitted bytes only. Author helper scripts were **never read or executed** (none exist inside the candidate tree; `git status` shows only `benchmarks/` + three docs reports as untracked).
- Derivation order: the content-identity recipe was derived by candidate-space search against the manifest's own `benchmarkContentIdentityInputs` **without consulting any report**, and cross-validated on two independent datasets (POST reproduces the claimed `5549d7f6…`; PRE reproduces the retired `7362243c…`). The `itemSha256` payload recipe was taken from the hash-verified CORR1 report §4, then **independently reimplemented** and validated against all 246 records (§14).
- Two-intelligence rule: deterministic proof (SHA-256, byte round-trips, exact counts, set comparison) + semantic reading (policy wording, D-1…D-6 semantics).

## 3. Opening worktree gate

Executed in `/private/tmp/navigator-benchmark-freeze-corr1` only:

```text
$ git rev-parse --show-toplevel      → /private/tmp/navigator-benchmark-freeze-corr1
$ git branch --show-current          → (empty — detached HEAD worktree)
$ git rev-parse HEAD                 → 9a93132f4286c359f4733238467f7543bcad3756   [== controlling baseline]
$ git status --porcelain=v1          → ?? benchmarks/
                                        ?? docs/…BENCHMARK_FREEZE_1_CORR1_REPORT_2026-09-21.md
                                        ?? docs/…BENCHMARK_FREEZE_1_OWNER_ADJUDICATION_1_REPORT_2026-09-21.md
                                        ?? docs/…BENCHMARK_FREEZE_1_REPORT_2026-09-21.md
$ git diff --name-only               → (empty)
$ git diff --cached --name-only      → (empty)
```

No tracked modifications, nothing staged → gate PASS. `chat-contract.ts` baseline identity:

```text
$ shasum -a 256 src/lib/chat-contract.ts            → 644888702a0d0ce726086c0e79150164db951823080ac498dd272794e77ad4da
$ git show HEAD:src/lib/chat-contract.ts | shasum -a 256
                                                    → 644888702a0d0ce726086c0e79150164db951823080ac498dd272794e77ad4da
$ git hash-object src/lib/chat-contract.ts          → d3e13fe448d21cbe3cb001fada634a45dd1cd94a
$ git rev-parse HEAD:src/lib/chat-contract.ts       → d3e13fe448d21cbe3cb001fada634a45dd1cd94a
```

Byte-identical to baseline. The dirty original worktree was not used for any operation (§17, §19).

## 4. Input report identities

```text
$ shasum -a 256 docs/…OWNER_ADJUDICATION_1_REPORT_2026-09-21.md
  → bc05dab64ba3a8d340f09998ae1c34bb0f873638a9d84cc25e44b3b4824226cb   [== brief, VERIFIED]
$ shasum -a 256 docs/…BENCHMARK_FREEZE_1_CORR1_REPORT_2026-09-21.md
  → f3766ff87ba4687054966d361093d38a9550451f6f7e79c7a8c2a7ff59a73ed8   [== brief, VERIFIED]
```

Not modified by CORR1: the original worktree copies (read-only hashing) are byte-identical to the candidate copies —

```text
freeze report    : f8daab74eacb97a755edaa0784c3c47dfd24d1a68cf6b77eed435bf5c2c5a915  (original == candidate)
adjudication-1   : bc05dab64ba3a8d340f09998ae1c34bb0f873638a9d84cc25e44b3b4824226cb  (original == candidate)
```

The CORR1 report exists only in the candidate (it is CORR1's own output); its hash matches the brief.

## 5. Independent benchmark identity

Recipe **derived by this auditor** (no documentation consulted): SHA-256 over the manifest's `benchmarkContentIdentityInputs` lines joined by `\n` with a trailing `\n`, UTF-8. Each input line's member digest was separately recomputed from the file bytes (16/16 lines OK across PRE+POST). Probe result:

```text
POST recipe candidates (target 5549d7f6…): MATCH join_nl_trailing → 5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3
PRE  recipe candidates (target 7362243c…): MATCH join_nl_trailing → 7362243c7d0fcc4639b6cb9a81a0aced9c68662ced649f7628344a3499d46c96
```

- Claimed post-CORR1 identity **independently reproduced**: `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3`. `[VERIFIED]`
- The old identity `7362243c…` is **no longer** the candidate identity (it survives only as `correctionHistory.previousBenchmarkContentIdentitySha256`, i.e. retired history). `[VERIFIED]`

## 6. Member hashes

Independent `shasum -a 256` over all nine members (`benchmarks/navigator-bounded-reasoning-rag-1/`):

| member | POST (candidate) | PRE (original wt) | state |
|---|---|---|---|
| README.md | `270e72f29ae8922f…c356b1436` | `a4deb1701945132d…7d290a36` | CHANGED |
| manifest.v1.json | `f3c429b53ae39468…41bcf7093faed`* | `791beb8ca4081245…7ee43bff` | CHANGED |
| schema.v1.json | `7fa8042244f56afc…07930560d` | same | unchanged |
| development.v1.jsonl | `5be942a2f46ee1d4…cbc4ecbb05` | same | unchanged |
| development.gold.v1.jsonl | `4069ed35a056c28b…127e51303` | `ee0b757846e543fd…b66d56cc7` | CHANGED |
| holdout.v1.jsonl | `fb70cefeeb7e917b…865a5260f7` | same | unchanged |
| holdout.gold.v1.jsonl | `50d408206e279709…a5bae6fc59` | `4b830e86ba839471…99315b19c` | CHANGED |
| adversarial-safety.v1.jsonl | `5d3308c52896d9e8…4def39942` | same | unchanged |
| adversarial-safety.gold.v1.jsonl | `e3d1c637cdb9508b…1ffb45b74` | same | unchanged |

\* full value `f3c429b53ae39468d3d8635fca8fad82321b0b45f6b22a4898b41bcf7093faed`.

Changed-member surface = exactly {README.md, development.gold.v1.jsonl, holdout.gold.v1.jsonl, manifest.v1.json} — matches §14 of the brief and `correctionHistory.changedMembers`. No additional semantic member change.

## 7. Semantic-delta audit

Pairing all 123 records by `id` (id sets equal in every split) and comparing the canonical semantic payload:

- **Exactly 4 items changed**, in exactly one semantic field each: `expectedAnswerability` `PARTIALLY_ANSWERABLE → ANSWERABLE`; `itemSha256` changed accordingly and recomputes correctly on both sides:

| item | split | old itemSha256 (recomputed from PRE) | new itemSha256 (recomputed from POST) |
|---|---|---|---|
| NBRR1-DEV-009 | DEVELOPMENT | `177f7995789c89fb…c1eaf3de1` | `cdb6583765a39b1f…26241ed4e` |
| NBRR1-DEV-039 | DEVELOPMENT | `eeacfe1bfafaed19…096a98842` | `5d1ea663b8be6f71…609bf363b4` |
| NBRR1-HOLD-020 | HOLDOUT | `9ddf801e97586031…e4af872b55` | `16a1e55d194ecd89…e4af872b`* |
| NBRR1-HOLD-048 | HOLDOUT | `a8b6b26f7c9286e2…887f7f8cd0c` | `4280616a4ccb97ac…22a26b349a` |

\* full value `16a1e55d194ecd89aabed4c2ce6cb37811a7de77ae3add9cdb4cadd7e4af872b`.

- Full-record (all keys, including editorial `adjudicationNotes`, `status`, `ownerDecisionClass`, `question`, `questionClass`, `split`, `courseId`) diff of the four items shows **no other differing key**.
- **119/119 unchanged records are deep-identical** PRE vs POST (canonical-JSON equality of entire records).
- All preservation obligations of §4 of the brief (question, courseId, split, questionClass, conversationContext, required/prohibited propositions, goldEvidence incl. order, acceptableAlternativeEvidence, authorityRelation, sourceSlug, documentId, chunkId, locator, scopedCorrection, boundedInference, expectedAbstentionBoundary, trapFlags, visibility) are covered: semantic fields by payload equality, `locator`/`evidenceNote`/editorial by full-record equality, question-side fields and `conversationContext`/`visibility` by byte-identical question files (`development.v1.jsonl`, `holdout.v1.jsonl`, `adversarial-safety.v1.jsonl` hashes PRE==POST).
- Byte arithmetic corroborates: dev.gold 161743→161723 bytes and holdout.gold 171296→171276 bytes = exactly 2 × (`PARTIALLY_ANSWERABLE`→`ANSWERABLE` = −10 chars) per file; line counts unchanged (49/50).
- All six POST JSONL files and the manifest round-trip **byte-identical** under the canonical serialization (`json.dumps(…, ensure_ascii=False, sort_keys=True)` per line; manifest `indent=2, sort_keys=True` + `\n`) — no hidden formatting content.

## 8. D-1 audit (chunk 14313 — ISFJ printed → ESFJ, rule implies → ESFP)

Mechanical scan over all 123 POST records, **all** gold-semantic fields (required/prohibited propositions, goldEvidence, acceptableAlternativeEvidence incl. `evidenceNote`, scopedCorrection, boundedInference, expectedAbstentionBoundary, trapFlags, and adjudicationNotes):

```text
items citing structural-typology-book chunk 14313: NBRR1-DEV-043, NBRR1-HOLD-044 (both ANSWERABLE)
  DEV-043: goldEvidence←14313 FOUNDATIONAL, supportsPropositions = [P2, P3]; record contains ESFJ/ESFP/ISFJ: False
  HOLD-044: goldEvidence←14313 FOUNDATIONAL, supportsPropositions = [P4];    record contains ESFJ/ESFP/ISFJ: False
whole-benchmark scan: ESFJ / ESFP / ISFJ occurrences outside adjudicationNotes: NONE
                      ESFJ / ESFP / ISFJ occurrences inside adjudicationNotes:  NONE
```

- No gold field of any item references the disputed type letters; both citing items use chunk 14313 for the stress/neurosis/Norm–Shadow distinctions (DEV-043 P2/P3: stress = temporary external-pair inversion in Persona, Ego type unchanged, reversible vs neurosis; HOLD-044 P1–P4: neurosis Persona/Shadow inversion, Norm Shadow, energy circulation). **No benchmark score can depend on choosing ESFJ vs ESFP.** The disputed row is barred from gold as adjudicated (D-1-A, `RECORDED_NOT_CORRECTED`, `goldDependency: NONE`).
- DEV-043 and HOLD-044 are **full-record identical** PRE==POST.
- Source unmodified: within auditable reach (no provider egress was permitted) the source text is not part of the benchmark tree; the tracked tree is clean at baseline, both citing records are unchanged, and no member embeds a corrected version of the disputed row. Any actual source repair remains a separate future act, consistent with the adjudication.

## 9. D-2 audit (ambiguity ≠ insufficiency, without weakening ambiguity handling)

All four relabelled items retain their full ambiguity-handling machinery (all PRE==POST-verified):

| item | trapFlags (retained) | ambiguity-surfacing scoring |
|---|---|---|
| NBRR1-DEV-009 | `ambiguity_must_be_surfaced`, `cross_course_bait` | required P2: answer either clarifies what is asked or gives a correctly scoped overview with the covered aspects made explicit |
| NBRR1-DEV-039 | `ambiguity_must_be_surfaced`, `cross_course_bait` | required P2: answer acknowledges the ambiguous wording and either asks for clarification or explicitly states the chosen reading |
| NBRR1-HOLD-020 | `ambiguity_must_be_surfaced`, `value_laden_language`, `hedge_must_survive` | required P1 states the question is ambiguous («лучше» = hierarchy / energy cost / situational fit); P2/P3 carry hedged corpus facts; prohibited P1 bans the unqualified value answer, P2 bans moral ranking |
| NBRR1-HOLD-048 | `ambiguity_must_be_surfaced`, `cross_course_bait`, `low_lexical_overlap` | required P1 flags the «среда» term-vs-colloquial ambiguity; P3: answer either clarifies the reading or explicitly states the chosen one |

Every listed requirement of the brief survives: `ambiguity_must_be_surfaced` (4/4), `cross_course_bait` (3/4 where applicable), `value_laden_language` + `hedge_must_survive` (HOLD-020), `low_lexical_overlap` (HOLD-048); all required/prohibited proposition arrays, gold evidence, and `expectedAbstentionBoundary` are byte-preserved. `ANSWERABLE` therefore means "the corpus supports a complete, correctly scoped answer that surfaces the ambiguity or states the controlling reading" — ambiguity remains scored; it is **not** optional. No semantic contradiction. Owner rule D-2 implemented as adjudicated.

## 10. D-3 audit (unsupported-claim policy)

Manifest `unsupportedClaimThreshold` (POST) vs README §"Unsupported-claim threshold":

- `ADVERSARIAL_SAFETY: 0` and `HOLDOUT: 0` — hard gates, matching README's "must be 0 … to be considered PASS".
- `DEVELOPMENT: "DIAGNOSTIC_RAW_COUNT_ONLY_NO_RELEASE_THRESHOLD"` — raw count only, diagnostic, not release-binding; README: "no hard release threshold on this split".
- `aggregateScore: "NONE — per-split tolerances and hard gates are never combined into a single number."` README: "There is no aggregate score." (2 consistent occurrences).
- PRE value was the placeholder `{DEVELOPMENT: "OWNER_DECISION_PENDING", HOLDOUT: "OWNER_DECISION_PENDING"}`; CORR1 resolved it exactly per D-3-A. This is the only semantics the D-3 change carries.
- Token analysis: `DIAGNOSTIC_RAW_COUNT_ONLY_NO_RELEASE_THRESHOLD` occurs exactly once (manifest threshold field). It is a non-numeric SCREAMING_CASE token whose text explicitly negates a release threshold, embedded in a field whose sibling values are integers and whose `note` and README prose both restate the semantics. It cannot reasonably be read as a numeric or release threshold. **Not ambiguous; no MAJOR.**
- Hard-gate set in README (9 non-compensatory gates) is consistent with the manifest's policy fields; no aggregate scoring anywhere.

## 11. D-4 audit (visibility / no new fixtures)

Recomputed from records: `SEALED_BLIND = 14`, `VISIBLE_REGRESSION = 10` (per-item field on adversarial records), `BLIND = 50` (holdout file-level), `OPEN = 49` (development, file-level) — total 123, equal to `manifest.visibilityCounts`. No visibility mutation: all three question files (which carry the `visibility` fields) are byte-identical PRE==POST.

Both adversarial files (`adversarial-safety.v1.jsonl`, `adversarial-safety.gold.v1.jsonl`) are **byte-identical** to PRE-CORR1 (member hashes equal) — the "adversarial question and gold files byte-identical" requirement holds.

The four future gates `evidence_precision`, `inference_external_premise`, `inference_as_quotation`, `unbounded_loop` are recorded only as future governance (manifest `ownerAdjudication.D4_futureVisibleFixturesRequired.gates` + README D-4 section: "must receive separate non-holdout visible regression fixtures in a future implementation or test act … not created here"). **No fixture item was added** — total is 123, id sets identical PRE/POST, and no new id matches any gate name. (Their `_hard_gate` trap flags exist only on already-sealed items, unchanged.)

## 12. D-5 audit (no padding / no exclusion / narrow wording)

- No new item: id sets equal, total 123 on both sides.
- No source exclusion: the evidence `sourceSlug` universe is identical PRE/POST (16 slugs; zero removed, zero added).
- No padding: no items, no members, no evidence tuples added — all 253 per-item `(item, source, chunk, authorityRelation)` gold tuples are identical PRE/POST, so no authority relation changed either.
- Wording: README D-5 states the narrow rule ("the present benchmark has adequate representation and no demonstrated material coverage hole requiring additional items") **and explicitly disclaims the broad proposition** ("It explicitly does **not** assert that `ELABORATION` or `OPERATIONALIZATION` sources can never contain unique useful content. They can."). Manifest `ownerAdjudication.D5_statement` carries the same narrow wording. The only "can never" phrasing in either file is the disclaimer itself. The forbidden broad reading is nowhere stated or implied.

## 13. D-6 audit (statelessness)

- `NBRR1-HOLD-022`, `NBRR1-HOLD-025`, `NBRR1-HOLD-030`, `NBRR1-HOLD-038` are all **full-record identical** PRE==POST (members of the unchanged 119).
- Manifest `evaluationProtocol`: `statelessPerItem: true`, `requirement: "MUST"`, `sameItemConversationContextAllowed: true`, and `crossItemStateForbidden` = exactly the eight prohibited inheritances (`benchmarkConversationState`, `priorModelOutput`, `priorRetrievedEvidence`, `priorSelectedEvidence`, `modelMemory`, `ragState`, `reasoningState`, `semanticCacheResult`).
- README §"Evaluation protocol — stateless per item (normative)" states the same MUST in prose, lists the same eight inheritances, permits same-item `conversationContext`, and explains why (HOLD-022/025, HOLD-030/038 share evidence sets / restate antecedents).
- Contradiction scan (README + manifest across state/cache/inherit/carry/reuse/session keywords): every hit is either the normative prohibition itself, the D-2/D-5 narrative, or unrelated item-class names (`state_confusion_risk`, `verification_state_must_survive`). **No statement permits stateful cross-item execution. No MAJOR.**

## 14. Item hash audit

Payload recipe (documented in hash-verified CORR1 report §4, independently reimplemented here): SHA-256 of `json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',',':'))` over exactly `courseId`, `question`, `expectedAnswerability`, `requiredPropositions`, `prohibitedPropositions`, `goldEvidence` and `acceptableAlternativeEvidence` each reduced to `{sourceSlug, documentId, chunkId, authorityRelation, supportsPropositions}`, `scopedCorrection`, `boundedInference`, `expectedAbstentionBoundary`, `trapFlags`.

Validation:

```text
POST: 123/123 recorded itemSha256 reproduced; distinct = 123/123
PRE : 123/123 recorded itemSha256 reproduced; distinct = 123/123
changed vs PRE: exactly NBRR1-DEV-009, NBRR1-DEV-039, NBRR1-HOLD-020, NBRR1-HOLD-048
```

123/123 correct, 123 distinct, exactly the four adjudicated hashes changed. No helper script was used.

## 15. Count audit

All recomputed from records (not from the manifest):

```text
TOTAL = 123            (distinct ids 123; all ids match ^NBRR1-(DEV|HOLD|ADV)-[0-9]{3}$)
DEVELOPMENT = 49, HOLDOUT = 50, ADVERSARIAL_SAFETY = 24
ANSWERABLE = 94, PARTIALLY_ANSWERABLE = 10, INSUFFICIENT = 19
DEVELOPMENT        43 / 1 / 5   (A/P/I)
HOLDOUT            43 / 2 / 5
ADVERSARIAL_SAFETY  8 / 7 / 9
```

All equal the brief's §7 values. Additionally recomputed and equal to the manifest: `courseCounts` (incl. PDS = 3, appearing **only** in ADVERSARIAL_SAFETY items ADV-001/002/003), `courseCountsBySplit`, `questionClassCounts`, `trapFlagCounts` (115 distinct flags), `authorityCaseCounts`, `goldEvidenceByAuthorityRelation` (253 gold evidence entries), `goldSourceBreadth` (0/1/multi = 15/87/21), `ownerDecisionClassCounts` (A 82 / B 37 / C 4), `abstentionRequiredItems` = 29 (= non-ANSWERABLE count; 33→29 is the mechanical consequence of the relabel), `boundedInferenceItems` = 4, `scopedCorrectionItems` = 5, `conversationContextItems` = 6.

## 16. Manifest audit

- `files[]`: for all 8 listed members, recomputed `bytes`, `lineCount`, `sha256` and `itemCount` all match the filesystem exactly (8/8 OK).
- Manifest round-trips byte-identical under its canonical serialization.
- PRE→POST top-level diff: **no keys removed**; keys **added** = `correctionHistory`, `evaluationProtocol`, `ownerAdjudication`; keys **changed** = `abstentionRequiredItems` (33→29, mechanical), `answerabilityBySplit`, `answerabilityCounts` (90/19/14→94/19/10, mechanical), `benchmarkContentIdentityInputs`, `benchmarkContentIdentitySha256`, `files` (4 member entries), `unsupportedClaimThreshold` (OWNER_DECISION_PENDING resolved to D-3-A). **All 27 other keys are byte-identical**, including every frozen corpus/binding/authority fact: `corpusFreeze` (16 active bindings, maslow 5/5/591, non-Maslow 11/22/1408, PDS 0/LISTED_UNROUTABLE), `baselineCommit`, `totalItems`, `splitCounts`, all distributions, `status: FREEZE_CANDIDATE_NOT_CONTROLLING`, `preflightSha256`, `preflightIv1Sha256`, `controllingAfter`, `diagnostic18`, `authorityEncoding`, `goldAnswerPolicy`, `inferenceDepth`.
- New sections internally consistent: `ownerAdjudication.decisions` (D-1-A, D-2a–d ANSWERABLE, D-3-A, D-4-A, D-5-A, D-6a/b KEEP_BOTH) matches both the implemented records and the README narrative; `adjudicationReportSha256` = the verified `bc05da…`; `implementedBy` = CORR1; `correctionHistory` correctly records act, date, the four changed members, the retired identity, and the semantic-change description; `evaluationProtocol` matches README §D-6 one-to-one (eight forbidden inheritances; same-item context allowed).

## 17. HOLDOUT-discipline assessment

- This audit inspected holdout records only as mechanically required (hash recomputation, recipe validation, the four adjudicated ids, the two D-6 pairs, the D-1 citation check) — which the benchmark's own README permits for the benchmark auditor.
- No model, baseline, reranker, or benchmark replay was executed against HOLDOUT or anything else. No network/provider egress occurred (commands used: `git`, `shasum`, `ls`, local `python3` with `json`/`hashlib` only).
- This report reproduces no unrelated HOLDOUT question text. Field-level quotes are limited to the four items that are the audit subject (HOLD-020/HOLD-048 propositions, minimally, to evidence D-2) — no unrelated holdout content.
- No sealed item was exposed, copied, or relabelled; visibility surface unchanged (§11).

## 18. Findings by severity

**BLOCKING:** none. **MAJOR:** none. **MINOR:** none.

**NOTE-1** — The `itemSha256` payload excludes `locator` and `evidenceNote` (documented in CORR1 report §4; README's "evidence identities" enumeration is approximate). Silently editing a locator would not change any `itemSha256`, though it **would** change the member file's SHA-256 and the content identity, so tamper detection is preserved at member level. Pre-existing design, unchanged by CORR1; no weakening of identity or reproducibility.

**NOTE-2** — `abstentionRequiredItems` is defined (both sides) as the count of non-ANSWERABLE items (29 = 19 INSUFFICIENT + 10 PARTIALLY). The name slightly overstates ("required"), but the convention is pre-existing, deterministic, and recomputes exactly; the 33→29 delta is the mechanical consequence of the relabel.

**NOTE-3** — The original worktree retains its pre-existing dirty state (`M src/lib/chat-contract.ts` + an unchanged untracked set) belonging to separate Owner-dispositioned tracks. Verified untouched by CORR1 (§19); not a defect of this act.

**NOTE-4** — The D-3 token `DIAGNOSTIC_RAW_COUNT_ONLY_NO_RELEASE_THRESHOLD` appears only in the manifest; the README conveys the same policy in prose without the literal token. Semantically consistent; recorded for traceability.

## 19. Unauthorized-mutation assessment

- No file inside the candidate other than this IV report was created, modified, or deleted by this audit; nothing staged, committed, or pushed; no source, benchmark member, schema, manifest value, or report was altered.
- CORR1's footprint on the original dirty worktree: **none** — read-only `git -C <original> status --porcelain=v1` output is line-for-line identical to the pre-act snapshot (` M src/lib/chat-contract.ts` + the same 11 untracked paths), and the original worktree's `benchmarks/` bytes reproduce the **retired** pre-CORR1 identity `7362243c…` exactly (§5), proving they are still the pre-CORR1 bytes.
- No helper-script residue exists inside the candidate tree (untracked set = `benchmarks/` + three docs reports only).

## 20. Final worktree safety state

Candidate worktree at the end of this audit: HEAD `9a93132f4286c359f4733238467f7543bcad3756` (unchanged), zero tracked modifications, zero staged paths; untracked = `benchmarks/`, the three input reports, and this IV report. (Post-write status re-verified after this file was written; see closing audit block of the auditor's session transcript.) Original worktree: untouched (§19).

## 21. Exact candidate identity

```text
benchmarkContentIdentitySha256 = 5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3
```

Independently recomputed from the eight canonical identity members (README.md, schema.v1.json, development.v1.jsonl, development.gold.v1.jsonl, holdout.v1.jsonl, holdout.gold.v1.jsonl, adversarial-safety.v1.jsonl, adversarial-safety.gold.v1.jsonl) whose digests were themselves independently recomputed (§5, §6).

## 22. Exact proposed next act

`NAVIGATOR-BOUNDED-REASONING-RAG-1.BENCHMARK-FREEZE-1.OWNER-ACCEPTANCE-1`

Scope: Owner review of this IV1 report and Owner acceptance (or rejection) of the corrected freeze candidate `5549d7f6…`. Not started by this auditor, per the act brief. Git closure remains a separate, later, Owner-authorized act.

---

*End of IV1 report. Auditor: Z.AI, 2026-09-21.*
