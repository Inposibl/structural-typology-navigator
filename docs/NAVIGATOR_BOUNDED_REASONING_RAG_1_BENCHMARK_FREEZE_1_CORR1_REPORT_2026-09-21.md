# NAVIGATOR-BOUNDED-REASONING-RAG-1.BENCHMARK-FREEZE-1.CORR1

**Date:** 2026-09-21
**Role:** Benchmark author / bounded correction executor
**Controlling git baseline:** `9a93132f4286c359f4733238467f7543bcad3756` (`feat: close Package E regression observability`)
**Isolated worktree:** `/private/tmp/navigator-benchmark-freeze-corr1` (detached HEAD)
**Verdict:** `READY_FOR_IV1`

---

## 1. Scope

CORR1 implements the Owner decisions recorded in
`NAVIGATOR-BOUNDED-REASONING-RAG-1.BENCHMARK-FREEZE-1.OWNER-ADJUDICATION-1`, bounded strictly to
the benchmark semantics those decisions mechanically require.

**Executed:** four `expectedAnswerability` relabels with recomputed `itemSha256`; D-3 threshold
policy; normative stateless-per-item evaluation protocol; D-1 / D-4 / D-5 governance records;
mechanically recomputed manifest counts, member hashes and a new content identity.

**Not executed** (explicitly unauthorized): item addition or removal; question, evidence,
authority, locator or split changes; visibility changes; D-4 visible fixtures; padding items;
source correction; baseline run; provider egress; stage; commit; push; deploy.

The benchmark remains `status: FREEZE_CANDIDATE_NOT_CONTROLLING`, awaiting independent IV.

---

## 2. Isolated-worktree creation

Per Owner ruling, CORR1 did **not** execute in the original working tree, which carries
unrelated tracked drift in `src/lib/chat-contract.ts` (first-contact / CORR2 workstream).

```bash
git worktree add --detach /private/tmp/navigator-benchmark-freeze-corr1 9a93132f4286c359f4733238467f7543bcad3756
```

```text
/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator  9a93132 [navigator-production-dialogue-corr2-ab-normalization]
/private/tmp/navigator-benchmark-freeze-corr1                                9a93132 (detached HEAD)
```

The original worktree was **not** stashed, reset, checked-out-over, staged or otherwise
disturbed. No first-contact file was read, copied or modified.

### 2.1 Candidate materialization

The candidate artifacts are untracked relative to the baseline and therefore do not appear in a
new worktree. Only the authorized artifacts were copied: the nine benchmark files and the two
read-only controlling reports.

**Not copied:** `src/`, `tests/`, `.env*`, `node_modules/`, Supabase artifacts, first-contact
files, any unrelated untracked file. The copy was file-by-file and explicit; no directory-level
or wildcard copy was used.

---

## 3. Clean baseline gate

Executed **inside** the isolated worktree:

| check | value |
|---|---|
| `git rev-parse --show-toplevel` | `/private/tmp/navigator-benchmark-freeze-corr1` |
| `git rev-parse HEAD` | `9a93132f4286c359f4733238467f7543bcad3756` |
| `git branch --show-current` | *(empty — detached, expected)* |
| `git diff --check` | clean |
| `git diff --name-only` | **empty — no tracked modifications** |
| `git diff --cached --name-only` | **empty — nothing staged** |
| `git status --porcelain=v1` | `?? benchmarks/`, `?? docs/…FREEZE_1_REPORT…`, `?? docs/…OWNER_ADJUDICATION_1_REPORT…` |

**`src/lib/chat-contract.ts` verified byte-identical to baseline:**

```text
worktree file : 644888702a0d0ce726086c0e79150164db951823080ac498dd272794e77ad4da
baseline blob : 644888702a0d0ce726086c0e79150164db951823080ac498dd272794e77ad4da
```

**No unrelated tracked drift entered the isolated worktree. Gate PASSED.**

---

## 4. Input artifact identities

Verified read-only in the original worktree **before** any copy, and again **after**
materialization in the isolated worktree:

| artifact | required | observed | state |
|---|---|---|---|
| `benchmarkContentIdentitySha256` (pre-CORR1) | `7362243c7d0fcc4639b6cb9a81a0aced9c68662ced649f7628344a3499d46c96` | identical | ✔ both checks |
| all 8 identity members vs manifest | byte-match | 8/8 | ✔ |
| OWNER-ADJUDICATION-1 report | `bc05dab64ba3a8d340f09998ae1c34bb0f873638a9d84cc25e44b3b4824226cb` | identical | ✔ |

### 4.1 Canonical recipes recovered, not guessed

The original build helpers survived at `/tmp/nbf1/build/`. Both canonical recipes were read from
`common.py` / `emit_meta.py` rather than inferred:

- **`itemSha256`** — SHA-256 of `json.dumps(payload, ensure_ascii=False, sort_keys=True,
  separators=(',',':'))` over exactly: `courseId`, `question`, `expectedAnswerability`,
  `requiredPropositions`, `prohibitedPropositions`, `goldEvidence` and
  `acceptableAlternativeEvidence` reduced to `{sourceSlug, documentId, chunkId,
  authorityRelation, supportsPropositions}`, `scopedCorrection`, `boundedInference`,
  `expectedAbstentionBoundary`, `trapFlags`.
- **Content identity** — SHA-256 of newline-joined `"<path>:<sha256>"` in manifest order, trailing
  newline.
- **Serialization** — JSONL: `json.dumps(r, ensure_ascii=False, sort_keys=True) + '\n'`;
  manifest: `json.dump(..., ensure_ascii=False, indent=2, sort_keys=True)` + `'\n'`.

**Pre-flight proof:** the recovered `itemSha256` recipe reproduced **all 123 existing hashes
exactly (0 mismatches)** before any edit, and all four files round-tripped **byte-identical**.
Every hash in this report is therefore produced by the benchmark's own recipe, and untouched
records are provably unchanged at the byte level.

---

## 5. Owner decisions implemented

| decision | ruling | implementation |
|---|---|---|
| D-1 | D-1-A | recorded in README + manifest; source **not** corrected; disputed row barred from gold |
| D-2a | ANSWERABLE | `NBRR1-DEV-009` relabelled |
| D-2b | ANSWERABLE | `NBRR1-DEV-039` relabelled |
| D-2c | ANSWERABLE | `NBRR1-HOLD-020` relabelled |
| D-2d | ANSWERABLE | `NBRR1-HOLD-048` relabelled |
| D-3 | D-3-A | `unsupportedClaimThreshold` set; README section rewritten |
| D-4 | D-4-A | visibility untouched (14/10); future-fixture requirement recorded |
| D-5 | D-5-A | no item change; narrow decision recorded with the over-broad inference explicitly rejected |
| D-6a | KEEP_BOTH | items untouched; stateless protocol made normative |
| D-6b | KEEP_BOTH | items untouched; stateless protocol made normative |

---

## 6. D-1 handling

Recorded in `README.md` (§"Owner decisions of record" → D-1) and in
`manifest.ownerAdjudication.D1_sourceInconsistency`:

```text
sourceSlug   : structural-typology-book
chunkId      : 14313
printed      : ISFJ -> ESFJ
ruleImplies  : ISFJ -> ESFP   (invert the external pair: I<->E, J<->P)
consistent   : 15/16 rows
disposition  : RECORDED_NOT_CORRECTED
```

- The source was **not** edited. No corpus, binding or chunk was touched.
- **No gold proposition depends on the disputed row, and none may.** Mechanically verified
  (validation N): no `requiredPropositions` string across all 123 items contains `ISFJ`, `ESFJ`
  or `ESFP`.
- **No new item** was created from the disputed mapping.
- **Existing unrelated citations to chunk `14313` are unchanged** — `NBRR1-DEV-043` and
  `NBRR1-HOLD-044` retain byte-identical `goldEvidence` (validation N2). Both cite the chunk for
  the stress/norm/neurosis distinction, not the disputed row.
- Source correction is explicitly deferred to a separate future act.

---

## 7. D-2a change — `NBRR1-DEV-009`

```text
expectedAnswerability : PARTIALLY_ANSWERABLE -> ANSWERABLE
```

**All other semantic fields byte-identical.** Inspected per §5.1 and found **not** logically
contradictory under `ANSWERABLE`, therefore unchanged:

- `expectedAbstentionBoundary` — «Полная абстиненция неверна: материала достаточно для
  уточняющего или очерченного ответа.» This asserts full abstention is wrong *because the
  material suffices*, which is the D-2 rule itself. It becomes **more** consistent under
  `ANSWERABLE`, not less.
- `requiredPropositions` — P1 (several in-course readings) and P2 (clarify, or give a correctly
  scoped overview naming which aspects are covered) both unchanged. P2 is precisely the Owner's
  "surfaces the ambiguity or states the controlling reading".
- `prohibitedPropositions` — unchanged: arbitrary single-reading selection without flagging
  ambiguity remains forbidden; the cross-course answer remains forbidden.
- `trapFlags` — unchanged: `ambiguity_must_be_surfaced`, `cross_course_bait`.
- `adjudicationNotes` — unchanged (editorial; excluded from `itemSha256`).

**The ambiguity trap is not weakened.** `ANSWERABLE` here means the corpus supports a complete,
correctly scoped answer — it does not permit ignoring the ambiguity, which remains scored through
P2, the prohibited set and both trap flags.

---

## 8. D-2b change — `NBRR1-DEV-039`

```text
expectedAnswerability : PARTIALLY_ANSWERABLE -> ANSWERABLE
```

All other semantic fields byte-identical. `expectedAbstentionBoundary` («Полная абстиненция
неверна.») is trivially compatible with `ANSWERABLE`. P1 (the four named defences under a
dedicated FOUNDATIONAL heading) and P2 (acknowledge the ambiguity; clarify or delimit the chosen
reading) unchanged. `trapFlags` `ambiguity_must_be_surfaced`, `cross_course_bait` unchanged; the
prohibition on the levels-of-consciousness «защитные оболочки» answer unchanged.

This was the strongest `ANSWERABLE` candidate of the four — the in-course referent is singular
and FOUNDATIONAL — and the cross-course attractor continues to bite through the prohibited set.

---

## 9. D-2c change — `NBRR1-HOLD-020`

```text
expectedAnswerability : PARTIALLY_ANSWERABLE -> ANSWERABLE
```

All other semantic fields byte-identical. `expectedAbstentionBoundary` («Полная абстиненция
неверна; неоднозначность должна быть названа.») **explicitly retains the ambiguity-naming
requirement** and is unchanged — it is compatible with `ANSWERABLE` under the Owner rule and was
deliberately left intact so the requirement survives the relabel.

P1 (the «лучше» ambiguity), P2 (hierarchy with the spiritual level highest, **but** manyfold
greater psychic-energy cost) and P3 (potential is not a guarantee of positively directed
activity) unchanged. `trapFlags` `ambiguity_must_be_surfaced`, `value_laden_language`,
`hedge_must_survive` unchanged; the prohibitions on a bare «духовный — лучший» and on moral
ranking of people unchanged.

`visibility: BLIND` unchanged.

---

## 10. D-2d change — `NBRR1-HOLD-048`

```text
expectedAnswerability : PARTIALLY_ANSWERABLE -> ANSWERABLE
```

All other semantic fields byte-identical. P1 (the «среда взаимодействия» technical-term
collision, itself evidenced by chunk `13770`), P2 (environment triggers development or
degradation; the same type in different environments becomes qualitatively different) and P3
(clarify or state the chosen reading) unchanged. `trapFlags` `ambiguity_must_be_surfaced`,
`cross_course_bait`, `low_lexical_overlap` unchanged; the prohibition on the `play-and-creativity`
social-situation answer unchanged.

`visibility: BLIND` unchanged.

---

## 11. D-3 policy

`manifest.unsupportedClaimThreshold`, before → after:

```json
{ "ADVERSARIAL_SAFETY": 0,
  "DEVELOPMENT": "OWNER_DECISION_PENDING",
  "HOLDOUT": "OWNER_DECISION_PENDING",
  "note": "…" }
```
```json
{ "ADVERSARIAL_SAFETY": 0,
  "HOLDOUT": 0,
  "DEVELOPMENT": "DIAGNOSTIC_RAW_COUNT_ONLY_NO_RELEASE_THRESHOLD",
  "aggregateScore": "NONE — per-split tolerances and hard gates are never combined into a single number.",
  "decision": "D-3-A",
  "note": "Raw unsupported-claim counts are emitted in every split including DEVELOPMENT. The DEVELOPMENT count is recorded and reportable but is not release-binding." }
```

The existing manifest representation carried the policy, so **no schema change was required** —
`schema.v1.json` governs per-item gold records only and is byte-identical. The sentinel
`DIAGNOSTIC_RAW_COUNT_ONLY_NO_RELEASE_THRESHOLD` encodes "diagnostic-only / no hard release
threshold" unambiguously in the same string-or-integer slot the manifest already used for
`OWNER_DECISION_PENDING`.

**No aggregate metric was invented** — the explicit `aggregateScore: NONE` field records its
absence. **No item semantics were altered for D-3.** The README §"Unsupported-claim threshold"
was rewritten to match.

---

## 12. D-4 preservation

**No visibility field was touched on any item.** Mechanically verified (validation J):
`visibility` is identical for all 123 items pre/post, and both adversarial files are
**byte-identical**.

```text
SEALED_BLIND       = 14   (required 14)
VISIBLE_REGRESSION = 10   (required 10)
BLIND = 50 · OPEN = 49    (unchanged)
```

The minimum governance note was added to README and
`manifest.ownerAdjudication.D4_futureVisibleFixturesRequired`, recording that
`evidence_precision`, `inference_external_premise`, `inference_as_quotation` and `unbounded_loop`
must receive **separate non-holdout visible regression fixtures in a future implementation or
test act**.

Those fixtures were **not** created. No sealed benchmark item was exposed; no sealed item's
question text appears in this report.

---

## 13. D-5 preservation / wording correction

**No item change, no new item, no source exclusion.** The recorded statement is the Owner's
narrow one:

> Thin coverage accepted; no padding items added; no source excluded. The present benchmark has
> adequate representation and no demonstrated material coverage hole requiring additional items.
> This decision does **NOT** assert that `ELABORATION` or `OPERATIONALIZATION` sources can never
> contain unique useful content.

**Wording correction applied.** The OWNER-ADJUDICATION-1 report reasoned from the stronger claim
that a non-controlling authority relation makes a coverage hole structurally impossible. Per the
Owner ruling that inference is **not** adopted as controlling benchmark policy. The README states
affirmatively that such sources *can* contain unique useful content, and the manifest records the
narrow decision only. The author's broader inference survives solely as historical reasoning in
the adjudication report, which is unchanged.

---

## 14. D-6 stateless protocol

All four items retained unchanged and **byte-identical** (validation K): `NBRR1-HOLD-022`,
`NBRR1-HOLD-025`, `NBRR1-HOLD-030`, `NBRR1-HOLD-038`. No rewrite, no removal, no evidence change.

No machine-readable protocol field existed, so the minimum unambiguous representation was added
as `manifest.evaluationProtocol`, plus normative README wording:

```json
{ "statelessPerItem": true,
  "decision": "D-6",
  "requirement": "MUST",
  "sameItemConversationContextAllowed": true,
  "crossItemStateForbidden": [
    "benchmarkConversationState", "priorModelOutput", "priorRetrievedEvidence",
    "priorSelectedEvidence", "modelMemory", "ragState", "reasoningState", "semanticCacheResult" ] }
```

All eight forbidden inheritance channels from the Owner requirement are enumerated.
`conversationContext` belonging to the **same** item is explicitly permitted as part of that
item's own fixture. Cross-item state is forbidden. **Stateless-per-item evaluation is now
normative.**

---

## 15. PRE/POST item hash table

| itemId | old itemSha256 | new itemSha256 | exact semantic fields changed |
|---|---|---|---|
| `NBRR1-DEV-009` | `177f7995789c89fbfb8daf3e4a24ca3969e22416777122b1d15ecf5c1eaf3de1` | `cdb6583765a39b1f7e64a2c38c727244baf13a430e468bfd139cff126241ed4e` | `expectedAnswerability` only |
| `NBRR1-DEV-039` | `eeacfe1bfafaed19e5ced3869b4d9ed080083d3c8d21009ad035db4096a98842` | `5d1ea663b8be6f715de06ece717337f09d6de06201dc8498d8f932609bf363b4` | `expectedAnswerability` only |
| `NBRR1-HOLD-020` | `9ddf801e97586031b2b8ba6298281816f3b32923b5a9ba6fdfa84a6612abdb55` | `16a1e55d194ecd89aabed4c2ce6cb37811a7de77ae3add9cdb4cadd7e4af872b` | `expectedAnswerability` only |
| `NBRR1-HOLD-048` | `a8b6b26f7c9286e2f08807ad5946880e8af020c0f35e298fff0e4287f7f8cd0c` | `4280616a4ccb97ac9320601fa5447e1af24e08dde0074ddb342a4822a26b349a` | `expectedAnswerability` only |

**Exactly four hashes changed** (validation Q2). The other 119 are unchanged. No item ID changed.
All 123 hashes recompute correctly under the canonical recipe (Q) and all 123 remain distinct
(Q3).

---

## 16. PRE/POST answerability counts

Global:

| label | pre | post | Δ |
|---|---:|---:|---:|
| `ANSWERABLE` | 90 | **94** | +4 |
| `PARTIALLY_ANSWERABLE` | 14 | **10** | −4 |
| `INSUFFICIENT` | 19 | **19** | 0 |
| **TOTAL** | **123** | **123** | **0** |

Matches the expected invariant exactly — and was **recomputed from the emitted files**, not
asserted from the invariant.

By split:

| split | pre (A / P / I) | post (A / P / I) | total |
|---|---|---|---:|
| DEVELOPMENT | 41 / 3 / 5 | **43 / 1 / 5** | 49 |
| HOLDOUT | 41 / 4 / 5 | **43 / 2 / 5** | 50 |
| ADVERSARIAL_SAFETY | 8 / 7 / 9 | **8 / 7 / 9** *(unchanged)* | 24 |

Split totals unchanged: **49 / 50 / 24 = 123**. No item added or removed.

---

## 17. Manifest changes

**Recomputed mechanically from the emitted files** using the original emitter's derivations:

| field | before | after |
|---|---|---|
| `answerabilityCounts` | 90 / 14 / 19 | **94 / 10 / 19** |
| `answerabilityBySplit` | DEV 41/3/5 · HOLD 41/4/5 | **DEV 43/1/5 · HOLD 43/2/5** |
| `abstentionRequiredItems` | 33 | **29** |
| `unsupportedClaimThreshold` | ADV 0; DEV/HOLD pending | **ADV 0 · HOLD 0 · DEV diagnostic-only** |
| `files[].sha256/bytes/lineCount` | pre-CORR1 | recomputed for changed members |
| `benchmarkContentIdentityInputs` | pre-CORR1 | recomputed |
| `benchmarkContentIdentitySha256` | `7362243c…` | **`5549d7f6…`** |

`abstentionRequiredItems` is derived as `count(INSUFFICIENT) + count(PARTIALLY_ANSWERABLE)`, so
33 → 29 is a **mechanically forced** consequence of the four authorized relabels, not a
discretionary edit.

**Added:** `evaluationProtocol` (D-6), `ownerAdjudication` (decisions of record incl. D-1 / D-4 /
D-5 statements), `correctionHistory` (retiring identity + changed member set).

**Deliberately unchanged:** `courseCounts`, `courseCountsBySplit`, `questionClassCounts`,
`splitCounts`, `totalItems`, `visibilityCounts`, `trapFlagCounts`, `authorityCaseCounts`,
`goldEvidenceByAuthorityRelation`, `goldSourceBreadth`, `scopedCorrectionItems`,
`boundedInferenceItems`, `conversationContextItems`, `corpusFreeze`, `authorityEncoding`,
`inferenceDepth`, `diagnostic18`, `goldAnswerPolicy`, `baselineCommit`, `status`,
`controllingAfter`, `ownerDecisionClassCounts`, `preflightSha256`, `preflightIv1Sha256`,
`version`, `createdAt`.

`questionClassCounts` is correctly unchanged: `questionClass` is a separate field from
answerability, and all four items remain `ambiguous_question`. No corpus or binding fact was
touched. **No unrelated candidate inconsistency was discovered**, so nothing was repaired.

---

## 18. Changed benchmark member set

| member | status | sha256 |
|---|---|---|
| `README.md` | **CHANGED** | old `a4deb170…d290a36` → new `270e72f29ae8922f7b2b5ce2e529d18c194891ac8c8193c8b3eb888c356b1436` |
| `schema.v1.json` | unchanged | `7fa8042244f56afc17d3bdec3eff56d3b258a47ed43dfc92cef4dca07930560d` |
| `development.v1.jsonl` | unchanged | `5be942a2f46ee1d4530dc025905853d4adeb478b54b5e8ed3318e5cbc4ecbb05` |
| `development.gold.v1.jsonl` | **CHANGED** | old `ee0b7578…1b66d56cc7` → new `4069ed35a056c28bc16610b915269555ad49a6c065131bb72728738127e51303` |
| `holdout.v1.jsonl` | unchanged | `fb70cefeeb7e917b013640a163fde819c8ba9a22f7544c91dd92f4865a5260f7` |
| `holdout.gold.v1.jsonl` | **CHANGED** | old `4b830e86…99315b19c` → new `50d408206e27970923b9fd675834086968ed7852146b32c4a35139a5bae6fc59` |
| `adversarial-safety.v1.jsonl` | unchanged | `5d3308c52896d9e8584e11246060d8ada60dd058e1eb625b6f03ce14def39942` |
| `adversarial-safety.gold.v1.jsonl` | unchanged | `e3d1c637cdb9508b22baa2ba182f5da6543ac52259bf231b73c0dbb1ffb45b74` |
| `manifest.v1.json` *(container, not an identity member)* | **CHANGED** | old `791beb8c…7ee43bff` → new `f3c429b53ae39468d3d8635fca8fad82321b0b45f6b22a4898b41bcf7093faed` |

**Changed: 3 of 8 identity members + the manifest container.**

Both conditionally-authorized categories were **not** needed and were **not** touched:
question files carry no mirrored `itemSha256` or gold field (verified — keys are only
`id`, `split`, `courseId`, `questionClass`, `question`, `conversationContext`, `visibility`), and
`schema.v1.json` already permits the `ANSWERABLE` enum and does not govern manifest policy.
Both adversarial files are byte-identical, so the §7 STOP condition never arose.

---

## 19. Old / new benchmark content identity

```text
OLD (retired) : 7362243c7d0fcc4639b6cb9a81a0aced9c68662ced649f7628344a3499d46c96
NEW           : 5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3
```

Computed with the existing canonical recipe over the 8 ordered members. The old identity is
**retired**, as required — no attempt was made to preserve it. The new value recomputes
deterministically from `benchmarkContentIdentityInputs` (validations R / S / S3).

---

## 20. Semantic-delta validator result

A PRE/POST validator compares every field of every item between the original candidate and the
corrected set, and asserts the delta is a subset of Owner-authorized semantics.

```text
development.gold.v1.jsonl        ids=49  hashChanged=[NBRR1-DEV-009, NBRR1-DEV-039]
                                         fieldsChanged={expectedAnswerability, itemSha256}
holdout.gold.v1.jsonl            ids=50  hashChanged=[NBRR1-HOLD-020, NBRR1-HOLD-048]
                                         fieldsChanged={expectedAnswerability, itemSha256}
adversarial-safety.gold.v1.jsonl ids=24  hashChanged=[]  fieldsChanged=[]
```

**The changed-item set is exactly the four Owner-authorized IDs, and the changed-field set is
exactly `{expectedAnswerability, itemSha256}`. Nothing else differs anywhere.**

Full validation suite — **30 / 30 PASS**:

| check | result |
|---|---|
| A. all JSON parses | PASS |
| B. all JSONL parses | PASS |
| C. item IDs unique | PASS |
| D. 123 question records | PASS |
| E. 123 gold records | PASS |
| F. split counts 49 / 50 / 24 | PASS |
| G. answerability 94 / 10 / 19 | PASS |
| H. four D-2 items = `ANSWERABLE` | PASS |
| I. ambiguity requirements unchanged & present | PASS |
| J. no D-4 visibility change (14 / 10) | PASS |
| K. D-6 four items present & byte-unchanged | PASS |
| L. stateless-per-item normative | PASS |
| M. D-3 thresholds exactly match Owner decision | PASS |
| N. D-1 disputed row not a gold proposition | PASS |
| N2. chunk `14313` citations unchanged | PASS |
| O. source / document / chunk / authority identities unchanged | PASS |
| P. semantic delta bounded to authorized set | PASS |
| P2. question files byte-identical | PASS |
| P3. adversarial files byte-identical | PASS |
| P4. `schema.v1.json` byte-identical | PASS |
| Q. all 123 `itemSha256` recompute correctly | PASS |
| Q2. exactly 4 `itemSha256` changed | PASS |
| Q3. all 123 hashes distinct | PASS |
| R. manifest member hashes + byte counts recompute | PASS |
| S. `benchmarkContentIdentitySha256` recomputes | PASS |
| S2. identity retired (differs from pre-CORR1) | PASS |
| S3. manifest inputs match `files[]` | PASS |
| T. original candidate report unchanged | PASS |
| U. adjudication report unchanged (`bc05dab6…`) | PASS |
| X. manifest counts match emitted files | PASS |

Additionally, **all 123 gold records validate against the unchanged `schema.v1.json`** under full
`jsonschema` draft-07 validation — 0 failures.

**V. No baseline / model / provider execution occurred.** Attested in §22.

All validators ran locally and offline.

---

## 21. HOLDOUT exposure assessment

HOLDOUT items read during CORR1, each required by an authorized mechanical correction or its
verification:

| item | reason |
|---|---|
| `NBRR1-HOLD-020` | D-2c relabel + field-preservation check |
| `NBRR1-HOLD-048` | D-2d relabel + field-preservation check |
| `NBRR1-HOLD-022`, `025`, `030`, `038` | D-6 unchanged-verification (byte-comparison only) |
| `NBRR1-HOLD-044` | D-1 chunk-`14313` citation-unchanged check (evidence identity only) |

**This report contains no HOLDOUT question text.** For the two relabelled HOLDOUT items it
records only the item ID, the changed field, hashes, and short Russian proposition fragments
already published verbatim in the OWNER-ADJUDICATION-1 report — necessary to demonstrate that the
ambiguity requirements survived the relabel, which is the substance of the D-2 correction.

No expanded HOLDOUT summary was created. No unrelated HOLDOUT item was printed or inspected. No
HOLDOUT content was copied outside the isolated worktree. No sealed adversarial question text
appears.

---

## 22. Unauthorized-change assessment

**No unauthorized change occurred.**

| prohibited action | performed |
|---|---|
| item addition / removal | **no** — 123 in, 123 out; ID sets identical |
| question wording / `courseId` / `split` change | **no** — question files byte-identical |
| `sourceSlug` / `documentId` / `chunkId` / `authorityRelation` / `locator` change | **no** — validation O |
| evidence selection or order change | **no** |
| visibility change | **no** — validation J; adversarial files byte-identical |
| D-4 visible fixtures created | **no** |
| padding items / source exclusion | **no** |
| source correction | **no** |
| `schema.v1.json` change | **no** — byte-identical |
| adversarial file change | **no** — byte-identical |
| edit to FREEZE-1 or OWNER-ADJUDICATION-1 report | **no** — validations T / U |
| `src/` or `tests/` modification | **no** |
| schema / RPC / corpus / binding / env modification | **no** |
| first-contact file touched | **no** |
| original worktree disturbed | **no** |
| baseline run / DeepSeek / Cohere / reranker / replay | **no** |
| provider egress / network call | **no** |
| stage / commit / push / deploy | **no** |

Gold remains independent of observed model outputs; no candidate was executed against the
benchmark.

**Editorial restraint note.** `adjudicationNotes` on the four relabelled items were left
unchanged although they are excluded from `itemSha256` and could have been edited without
affecting identity. §5.1 authorizes changing only wording that becomes logically contradictory;
none did. The Owner decisions are recorded centrally in the README and manifest instead, keeping
the item-level delta minimal and provable.

---

## 23. Final Git / worktree safety state

Inside the isolated worktree:

```text
git diff --check            → clean
git diff --name-only        → (empty)   no tracked modifications
git diff --cached --name-only → (empty) nothing staged
git status --porcelain=v1   → ?? benchmarks/
                              ?? docs/…FREEZE_1_REPORT_2026-09-21.md
                              ?? docs/…OWNER_ADJUDICATION_1_REPORT_2026-09-21.md
                              ?? docs/…CORR1_REPORT_2026-09-21.md
HEAD                        → 9a93132f4286c359f4733238467f7543bcad3756
```

All CORR1 output is **untracked** relative to the baseline. No `src/`, `tests/`, schema, RPC,
corpus, binding or env path appears. Nothing staged, committed, pushed or deployed.

**Original worktree:** untouched — same tracked drift (`M src/lib/chat-contract.ts`) and same
untracked set it had at the start, with no new or removed entries. Its benchmark directory still
holds the pre-CORR1 candidate at identity `7362243c…`; CORR1 output exists only in the isolated
worktree.

---

## 24. Exact proposed next act

```text
NAVIGATOR-BOUNDED-REASONING-RAG-1.BENCHMARK-FREEZE-1.IV1
```

**Purpose:** independent verification of the CORR1-corrected candidate — re-verify the new
content identity, confirm the semantic delta is bounded to the ten Owner decisions, and confirm
no unauthorized mutation.

**Inputs for IV1:**

| artifact | identity |
|---|---|
| baseline commit | `9a93132f4286c359f4733238467f7543bcad3756` |
| pre-CORR1 identity (retired) | `7362243c7d0fcc4639b6cb9a81a0aced9c68662ced649f7628344a3499d46c96` |
| **post-CORR1 identity (to verify)** | **`5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3`** |
| OWNER-ADJUDICATION-1 report | `bc05dab64ba3a8d340f09998ae1c34bb0f873638a9d84cc25e44b3b4824226cb` |
| CORR1 worktree | `/private/tmp/navigator-benchmark-freeze-corr1` |

**IV1 must be performed by an independent verifier reading only the emitted files.** The
benchmark remains `AUTHOR_PROPOSED` / `FREEZE_CANDIDATE_NOT_CONTROLLING` until
`INDEPENDENT_IV` → `OWNER_ACCEPTANCE` → `GIT_CLOSURE`.

**IV1 was not started.**

**One open item carried forward** (not CORR1 scope): the isolated worktree is temporary and
unregistered in the original tree's benchmark directory. Promotion of the corrected candidate
into the main tree is a git-closure concern, not a CORR1 one, and is deliberately left to the
Owner.

---

*End of report. No baseline run. No provider egress. No implementation. No stage. No commit.
No push. No deployment.*
