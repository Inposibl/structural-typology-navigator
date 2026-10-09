# NBRR1 D3 Option P operational addendum — author report

## 1. Act

`NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.OPTION-P-ADDENDUM-1`

Role: operational counting-contract addendum author. Bounded document authoring. No implementation and no repository mutation.

## 2. Verified identities

| Control | Expected | Observed |
|---|---|---|
| Branch | `integration/academy-main-reconciliation-1` | match |
| HEAD | `ed8d82ec69f1ca87b391b35e80d443f8d1a7da36` | match |
| Remote | `https://github.com/Inposibl/structural-typology-navigator.git` | match |
| Working tree | clean before authoring | porcelain 0 |
| Semantic map | `5094a769e3f27c98dc1ae89b14bd253f01f95b64f715d9aa9c51e103f436c5d7` | match |
| Declarative counting contract | `0b29ab6ce3ef45d4fad5736035566e8574c3cc769e8fb55aa8bf19a7af967fe4` | match |
| Package identity | `82c5b4af1bf08ac4abf5219041fd9752b9a1066db7062465891acedb0fbeed4a` | match |
| IV1 report | `f94f0e38d26c86afc579437b6b12ce2459fc2d310023e1dab8467455e921d88f` | match |
| Universe | `0715ed576d0b4d514437138b190f54a4aaec5f58f6b70969cc7a88efd80f719e`, 1999 identities | match |
| Benchmark | `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3` | match |
| Group-id list | `1ea63abf4bb4fa2a53ba8bfe985582595c966fa4542dd4c4c34f855dd47a4cea`, 47 ids | match |
| Guard-id list | `fd201cb129fa1a59c0c83a0d3825aa5b5dcd4ce1cbaade5c880e4897fb5e1abe`, 519 ids | match |

The output directory is outside the repository toplevel. The historical `d3-validate.py` source-snapshot mismatch on `tsconfig.json` is not evidence of D3 semantic corruption. That pin was not changed.

## 3. Owner OD-1 binding

Act `NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.UNIT-KEY-DECISION-1` accepts OD-1 Option P.

One unit is one material proposition contribution in its accepted scope. A passage may contribute several units. Repeated propositions in one course and scope contribute one unit. Technical span duplication does not create a second unit for that proposition. Missing or conflicting applicability fails before a number.

The addendum that records this choice is still `CANDIDATE_PENDING_INDEPENDENT_IV`. The decision is accepted. This document is not yet accepted.

## 4. Operational unit-key definition

The key is SHA-256 of canonical JSON. The payload is the benchmark digest, the opaque counting context, the course, the identity kind, the proposition identity, the scope, the subject, the relation, the polarity, the quantification, and the qualifications.

Passage ids, spans, offsets, gold, and contribution vectors are outside the key.

An accepted group uses its `groupId` as `propositionIdentity`. A published distinct anchor coordinate uses `D3COORD-` plus a hash of the published anchor fields. A missing coordinate, including any of the 1964 unclosed passage states, produces no singleton and no new group.

Thirty-eight groups have no `scopeId`, and no group has a quantification field. Those absences stay null or `NOT_STATED_ON_ACCEPTED_RECORD`. They do not merge group IDs, and the map is not backfilled.

## 5. C/R counting semantics

`C` is the set of unique unit keys actually cited or used. `R` is the restricted relevant subset of `C`. The quotient is the unreduced `|R| / |C|`.

Passage counts, occurrence counts, proposition counts, unit-key counts, and relevant-key counts are separate fields. On a scored item the last two match the quotient. The earlier counts need not match them.

Empty `C` is numerator 0, denominator 0, score null, diagnostic `EMPTY_DENOMINATOR`.

## 6. Privileged binding interface

The interface is specified and empty. Public inputs are the accepted corpus authorities. Restricted inputs are the opaque item, the authorized course, opaque required-proposition pointers, cited member ids, exact used spans, published coordinate bindings, relevance booleans, and digests.

No gold text is in this addendum. No item row is populated. Implementation authors remain denied gold by the existing blindness matrix. This candidate does not provision that denial.

## 7. Fail-closed outcomes

The 519 guards are unchanged. Three operational codes are added beside them:

- `D3_R_NOT_SUBSET_OF_C`
- `D3_FOREIGN_EVIDENCE_IDENTITY`
- `D3_ATOMIC_RATIO_AGGREGATION`

Unknown propositions, missing spans, missing privileged bindings, source-label conflicts, and nondeterministic partitions fail before a number through the existing codes. Digest drift is an admission failure in this addendum. Unaccepted group creation, passage singletons, and vector keys fail as `D3_ACCEPTED_AUTHORITY_CONFLICT`. Empty `C` stays a null diagnostic.

A failure suppresses the whole item. Partial quotients are not emitted.

## 8. Contract precedence

1. Owner-accepted semantic and procedure decisions.
2. Owner-accepted OD-1 Option P.
3. Accepted declarative counting authority.
4. This addendum only after independent IV and later Owner acceptance.
5. `decision.json`, `scoring-contract.json`, `test-base-contract.json`, and the candidate-status fields of `package-identity.json`, as provenance.

Their stale “map incomplete” and `ownerAccepted=false` flags do not override the later explicit acceptance. Those files were not edited.

## 9. Abstract test-vector results

All 20 vectors executed deterministically. None is blocked.

| Vector | Case | Result |
|---|---|---|
| V01 | One passage, one relevant proposition | SCORED 1/1; passages 1; occurrences 1; keys 1; relevant 1 |
| V02 | One passage, two relevant propositions | SCORED 2/2; passages 1; occurrences 2; keys 2; relevant 2 |
| V03 | Two passages repeating one proposition | SCORED 1/1; passages 2; occurrences 2; keys 1; relevant 1 |
| V04 | Two passages sharing one proposition with distinct additional propositions | SCORED 3/3; passages 2; occurrences 4; keys 3; relevant 3 |
| V05 | Two technically overlapping chunks supporting one proposition | SCORED 1/1; passages 2; occurrences 2; keys 1; relevant 1 |
| V06 | One passage containing relevant and irrelevant material propositions | SCORED 1/2; passages 1; occurrences 2; keys 2; relevant 1 |
| V07 | Structural header plus substantive material | SCORED 1/1; passages 1; occurrences 2; keys 1; relevant 1 |
| V08 | ENFP/ENTP conflicting source attribution | SCORING_FAILURE D3_SOURCE_TYPE_LABEL_CONFLICT |
| V09 | Missing exact used-span binding | SCORING_FAILURE D3_USED_SPAN_BINDING_MISSING |
| V10 | Different qualified propositions sharing one carrier passage | SCORED 2/2; passages 1; occurrences 2; keys 2; relevant 2 |
| V11 | Same proposition repeated across two different courses | SCORED 2/2; passages 2; occurrences 2; keys 2; relevant 2 |
| V12 | Missing accepted equivalence authority | SCORING_FAILURE D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED |
| V13 | Empty C | NOT_APPLICABLE EMPTY_DENOMINATOR numerator 0 denominator 0 score null |
| V14 | R not a subset of C | SCORING_FAILURE D3_R_NOT_SUBSET_OF_C |
| V15 | Foreign passage identity | SCORING_FAILURE D3_FOREIGN_EVIDENCE_IDENTITY |
| V16 | Attempt to sum atomic-scope ratios | SCORING_FAILURE D3_ATOMIC_RATIO_AGGREGATION |
| V17 | Repeated citation of the same passage and material span | SCORED 1/1; passages 1; occurrences 2; keys 1; relevant 1 |
| V18 | Different propositions sharing one exact source passage | SCORED 2/2; passages 1; occurrences 2; keys 2; relevant 2 |
| V19 | Missing privileged required-proposition binding | SCORING_FAILURE D3_CONTEXT_PARTITION_MISSING |
| V20 | Multiple material propositions with only partial used-span attribution | SCORING_FAILURE D3_USED_SPAN_BINDING_MISSING |

V03, V05, and V17 each collapse to one key. V02, V10, V11, and V18 each keep two keys. V04 keeps three keys from four occurrences. V06 scores 1/2. V13 is the empty diagnostic. V08, V09, V12, V14, V15, V16, V19, and V20 emit no quotient.

## 10. Created artifacts

Directory: `/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/NBRR1_D3_OPERATIONAL_COUNTING_CONTRACT_1_OPTION_P_ADDENDUM_1`

| File | SHA-256 |
|---|---|
| `D3_OPTION_P_OPERATIONAL_ADDENDUM.md` | `90fc2a19c6504208f543838783819f2a00e30296220bde8b5d6c3eccaf6d44b6` |
| `D3_OPTION_P_OPERATIONAL_CONTRACT.json` | `4feb1fdf2a8a3b58c1aa0b0ac748c9b98d3361cfb4e5adc91d2f69a1e69c1eea` |
| `D3_OPTION_P_ABSTRACT_TEST_VECTORS.json` | `56e28e8f80572c5ee4fdc92f87c30c1b96d966f4877e73a7090c269a9d7d19eb` |
| `REPORT.md` | recorded in `SHA256SUMS` after this file is sealed |
| `SHA256SUMS` | covers the four documents above, including this report |

## 11. Blocking methodological ambiguities

None.

Four corollaries are determined by Option P and the accepted records, and they are stated so IV can check them:

- Span suppression is per proposition coordinate. Two accepted coordinates may share a passage.
- Missing quantification does not merge group IDs.
- Distinct non-group propositions use `D3COORD` over published anchor fields, never a passage singleton and never a new public group.
- `D3_DIGEST_DRIFT` is an admission failure here. The frozen effect string remains historical. Neither emits a number.

## 12. Author validation results

- Repository porcelain was 0 before writing and is rechecked after writing.
- Accepted map, contract, package, IV1, universe, and benchmark digests were recomputed before writing.
- Group count 47 and guard count 519, with the list digests above, are pinned in the contract.
- The evaluator recomputed all 20 vectors from the payload rule.
- Scored vectors have unit weight 1, R keys inside C keys, and unreduced fractions.
- Failure vectors have `quotientEmitted=false` and null numerator.
- Success payloads exclude passage ids, spans, offsets, and contribution vectors.
- No protected question or gold text was written.
- The old D3 validator was not treated as a semantic verdict. Its historical source pin was not modified.

## 13. Unauthorized-operation counters

`PRODUCTION_SOURCE_MUTATIONS=0`

`ACCEPTED_D3_ARTIFACT_MUTATIONS=0`

`BENCHMARK_MUTATIONS=0`

`BENCHMARK_EXECUTIONS=0`

`PROVIDER_CALLS=0`

`PRODUCTION_CONTACT=0`

`GIT_MUTATIONS=0`

`SCORER_IMPLEMENTATIONS=0`

`TEST_BASE=0`

`FULL123=0`

`FULL924=0`

## 14. Verdict

`OPTION_P_OPERATIONAL_ADDENDUM_CANDIDATE_PENDING_INDEPENDENT_IV`

## 15. Recommended independent IV scope

Review only this addendum directory.

- Recompute the accepted digests, the 47 group-id list, and the 519 guard-id list.
- Recompute all 20 unit keys from the JSON payload rule and compare them with the vector file.
- Confirm R is a subset of C on every scored vector and that the eight failure vectors plus the empty diagnostic emit no numeric quotient.
- Confirm the three new codes do not add, remove, or reorder guards.
- Confirm no passage singleton, no new public group, and no contribution-vector key is emitted.
- Confirm the directory contains no gold or holdout question text and that the repository diff is empty.
- Check the four stated corollaries. Do not re-adjudicate the 47 groups, the 426 pair dispositions, or the 42 new anchors.
- Do not accept the addendum, implement a scorer, or authorize TEST_BASE or FULL123.

Suggested IV act: `NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.OPTION-P-ADDENDUM-1.IV1`
