# D3COORD field-mapping contract — author report

## 1. Act

`NBRR1.D3-OPTION-P-D3COORD-FIELD-MAPPING-1.CONTRACT-1`

## 2. Verdict

`D3COORD_FIELD_MAPPING_CONTRACT_CANDIDATE_PENDING_INDEPENDENT_IV`

This candidate is not independently verified and does not authorize a scorer.

## 3. Repository integrity

Branch `integration/academy-main-reconciliation-1`. HEAD `ed8d82ec69f1ca87b391b35e80d443f8d1a7da36`. Remote `https://github.com/Inposibl/structural-typology-navigator.git`. Porcelain was empty before writing and is rechecked after writing.

## 4. Accepted authority digests

- semanticMap: `5094a769e3f27c98dc1ae89b14bd253f01f95b64f715d9aa9c51e103f436c5d7`
- anchorAdjudications: `f28fc94c7d3edc3d06991503a9fc709daf057181c497b562a94d6c4e96886c4b`
- declarativeCountingContract: `0b29ab6ce3ef45d4fad5736035566e8574c3cc769e8fb55aa8bf19a7af967fe4`
- optionPAddendum: `90fc2a19c6504208f543838783819f2a00e30296220bde8b5d6c3eccaf6d44b6`
- optionPContract: `4feb1fdf2a8a3b58c1aa0b0ac748c9b98d3361cfb4e5adc91d2f69a1e69c1eea`
- optionPVectors: `56e28e8f80572c5ee4fdc92f87c30c1b96d966f4877e73a7090c269a9d7d19eb`
- universe: `0715ed576d0b4d514437138b190f54a4aaec5f58f6b70969cc7a88efd80f719e`
- benchmark: `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3`

Group-id list `1ea63abf4bb4fa2a53ba8bfe985582595c966fa4542dd4c4c34f855dd47a4cea` (47). Guard-id list `fd201cb129fa1a59c0c83a0d3825aa5b5dcd4ce1cbaade5c880e4897fb5e1abe` (519).

## 5. Output paths

/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/NBRR1_D3_OPTION_P_D3COORD_FIELD_MAPPING_1_CONTRACT_1

## 6. SHA-256

- D3COORD_FIELD_MAPPING_CONTRACT.md: `974dd6cc2bf5bdbde85759c1f2f53f665a85b843a16064d64fcbfaf6451c87b5`
- D3COORD_FIELD_MAPPING_CONTRACT.json: `f532eefc91099e9a80457e1e570b59e1bdc09319b54412efecafd8a1db774fe7`
- D3COORD_FIELD_MAPPING_TEST_VECTORS.json: `a350a009d520102081b62c54afe90c15f4cbb7cbfe5dc8378649e1060d9ffd9b`
- REPORT.md: recorded in SHA256SUMS after this file is sealed
- SHA256SUMS: covers the four documents above

## 7. Decision-category coverage

All 10 published decisions are in the contract category table.

- `EQUIVALENT_SCOPED` (32): ACCEPTED_GROUP_IDENTITY
- `ATOMIC_COMPARISON_DECOMPOSITION` (3): ACCEPTED_GROUP_IDENTITY
- `SUBJECT_SCOPED_DISTINCT` (20): PUBLISHED_DISTINCT_COORDINATE
- `LOCAL_SUBJECT_SCOPED_DISTINCT` (8): PUBLISHED_DISTINCT_COORDINATE
- `QUALIFICATION_SCOPED_DISTINCT` (1): PUBLISHED_DISTINCT_COORDINATE
- `NONMATERIAL_EDITORIAL` (6): NONMATERIAL_EXCLUSION
- `NONMATERIAL_LABEL_STRIP` (5): NONMATERIAL_EXCLUSION
- `NONMATERIAL_TABLE_HEADER` (2): NONMATERIAL_EXCLUSION
- `BIBLIOGRAPHIC_TITLE_ONLY` (3): NONMATERIAL_EXCLUSION
- `SOURCE_LABEL_CONFLICT` (5): FAIL_CLOSED_SOURCE_CONFLICT

## 8. Field-mapping summary

Group contributions use `groups[].groupId` and the `countingScope` fields. Distinct coordinates use `TYPE_SUBJECT`, `LOCAL_SUBJECT`, or `QUALIFICATION` from the paths named in the contract. A subject array is split. A repeated token on one anchor collapses. `anchorId` and `courseId` stay inside the coordinate preimage.

## 9. Catalogue 68 and Maslow

Catalogue 68 `D3ANCH-d7ed0d4b1eccf9d9b911e73cbc5373747973e76d4998ebaf91676ac95478775e` fails `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED` because binding `ENFP` and context `ENTP` disagree. No partial key.

Catalogue 25 `D3ANCH-5df251cda236184cb35bd620964710d885ba64a27109b2862b456a1edc3e223f` fails `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED`. Its multi-token binding subjects are not hashed.

## 10. Synthetic-vector validation

28 vectors were evaluated twice from the reference checker. The stored expectations match the second run.

- V01: SCORED C=1 D3COORD=0 groups=1
- V02: SCORED C=2 D3COORD=2 groups=0
- V03: SCORED C=2 D3COORD=2 groups=0
- V04: SCORED C=2 D3COORD=2 groups=0
- V05: SCORED C=1 D3COORD=1 groups=0
- V06: SCORED C=2 D3COORD=2 groups=0
- V07: SCORING_FAILURE D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED
- V08: SCORING_FAILURE D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED
- V09: SCORED C=1 D3COORD=0 groups=1
- V10: SCORING_FAILURE D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED
- V11: SCORED C=2 D3COORD=2 groups=0
- V12A: SCORING_FAILURE D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED
- V12B: SCORING_FAILURE D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED
- V13: SCORED C=2 D3COORD=0 groups=2
- V14: SCORED C=1 D3COORD=1 groups=0
- V15: SCORING_FAILURE D3_MAP_SCOPE_AMBIGUOUS
- V16: SCORING_FAILURE D3_MAP_SCOPE_AMBIGUOUS
- V17: SCORING_FAILURE D3_ACCEPTED_AUTHORITY_CONFLICT
- V18: SCORING_FAILURE D3_QUALIFICATION_SCOPE_COLLAPSE
- V19: SCORING_FAILURE D3_ACCEPTED_AUTHORITY_CONFLICT
- V20: SCORING_FAILURE D3_SOURCE_TYPE_LABEL_CONFLICT
- V21: NOT_APPLICABLE EMPTY_DENOMINATOR
- V22: SCORING_FAILURE D3_NONMATERIAL_INDEPENDENT_CREDIT
- V23: SCORING_FAILURE D3_ACCEPTED_AUTHORITY_CONFLICT
- V24: SCORING_FAILURE D3_ACCEPTED_AUTHORITY_CONFLICT
- V25: SCORING_FAILURE D3_ACCEPTED_AUTHORITY_CONFLICT
- V26: SCORING_FAILURE codes D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED,D3_MAP_SCOPE_AMBIGUOUS
- V27: SCORING_FAILURE D3_SCOPE_MISSING

V12 is split into V12A and V12B so an unknown group and an unknown anchor each have one code. V13 through V27 cover invariants the twelve cases do not isolate: atomic-cell precedence, literal UNKNOWN, course mismatch, subject-inventory discrepancy, collapse and double-count prohibitions, the source-label category, nonmaterial results, singleton and vector fallbacks, witness text, simultaneous defects, and an unauthorized course.

## 11. Unresolved ambiguities

No mapping choice remains open. Simultaneous failure codes do not have an accepted total order. V26 records that limitation: the item fails, and this candidate does not name a winning code.

Inherited Option P item-stage checks for a missing span, a missing privileged binding, and digest drift are cited and not reordered.

## 12. Findings

BLOCKING: 0

MAJOR: 0 in this candidate. The catalogue 68 conflict and the Maslow prose subject are encoded as whole-item failures.

MINOR:

1. Frozen `ownerAccepted: false` labels remain on the accepted sources and on the Option P files.
2. The semantic map still stores a historical path beside the anchor digest. The digest matches the repository file.
3. Condition labels in this candidate are explanations. They are not new guard ids.

## 13. Unauthorized-operation counters

REPOSITORY_MUTATIONS=0

ACCEPTED_ARTIFACT_MUTATIONS=0

BENCHMARK_MUTATIONS=0

BENCHMARK_EXECUTIONS=0

GIT_MUTATIONS=0

SCORER_IMPLEMENTATIONS=0

RUNNER_IMPLEMENTATIONS=0

PRIVILEGED_BINDINGS_CREATED=0

PROVIDER_CALLS=0

PRODUCTION_CONTACT=0

TEST_BASE=0

FULL123=0

FULL924=0

## 14. Recommended independent IV

Review only this directory. Suggested act: `NBRR1.D3-OPTION-P-D3COORD-FIELD-MAPPING-1.CONTRACT-1.IV1`.

- Recompute the authority digests, the 47 group-id list, and the 519 guard-id list.
- Recompute every stored coordinate payload and unit key.
- Confirm V08 and V10 emit no quotient, V13 emits two group identities and zero D3COORD values, and V14 keeps the subject UNKNOWN.
- Confirm V26 leaves the emitted code null.
- Confirm the Markdown and JSON state the same category table, paths, and failure codes.
- Confirm this directory contains no gold and the repository diff is empty.
- Do not accept the candidate, implement a scorer, or authorize TEST_BASE or FULL123.
