# D3COORD field-mapping contract

Status: `CANDIDATE_PENDING_INDEPENDENT_IV`

Act: `NBRR1.D3-OPTION-P-D3COORD-FIELD-MAPPING-1.CONTRACT-1`

This candidate is not Owner-accepted, not independently verified, and not an authorization to implement a scorer. The Markdown and the JSON were rendered from the same rule table. Neither file overrides the other. A mismatch is an IV defect.

## Precedence

1. Owner-accepted D3 semantic and procedure authority, including the 47 groups and the 519 guards.
2. Owner-accepted OD-1 Option P.
3. The Owner-accepted Option P operational addendum and operational contract. Frozen `ownerAccepted: false` labels in those files remain historical and do not cancel that later acceptance.
4. This field-mapping contract, only after its own independent IV and a later Owner acceptance.
5. Historical candidate files, as provenance only.

## Authority pins

| Record | SHA-256 |
|---|---|
| Semantic map | `5094a769e3f27c98dc1ae89b14bd253f01f95b64f715d9aa9c51e103f436c5d7` |
| Anchor adjudications | `f28fc94c7d3edc3d06991503a9fc709daf057181c497b562a94d6c4e96886c4b` |
| Declarative counting contract | `0b29ab6ce3ef45d4fad5736035566e8574c3cc769e8fb55aa8bf19a7af967fe4` |
| Option P addendum | `90fc2a19c6504208f543838783819f2a00e30296220bde8b5d6c3eccaf6d44b6` |
| Option P contract | `4feb1fdf2a8a3b58c1aa0b0ac748c9b98d3361cfb4e5adc91d2f69a1e69c1eea` |
| Option P vectors | `56e28e8f80572c5ee4fdc92f87c30c1b96d966f4877e73a7090c269a9d7d19eb` |
| Evidence universe | `0715ed576d0b4d514437138b190f54a4aaec5f58f6b70969cc7a88efd80f719e` |
| Frozen benchmark | `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3` |

Group-id list, published order, newline-joined: `1ea63abf4bb4fa2a53ba8bfe985582595c966fa4542dd4c4c34f855dd47a4cea`, 47 ids.

Guard-id list from `residualClassAdmission.guardIds`, published order, newline-joined: `fd201cb129fa1a59c0c83a0d3825aa5b5dcd4ce1cbaade5c880e4897fb5e1abe`, 519 ids. This candidate adds no semantic guard id.

## Verified inventory

This act recomputed the inventory from the frozen files before writing.

85 anchors, 10 decision categories. 47 groups. 519 guards. 42 residual anchor cases. 426 bounded pair dispositions. 1999 evidence identities.

The 20 `SUBJECT_SCOPED_DISTINCT` anchors each publish a two-element `semanticAnalysis.materialSubject` list. On every one of them, that set equals the set of `carriers[].typeSubjectContext.subject`. Their shared polarity token is `AS_STATED_WITH_TYPE_CONTEXT`. Their relation predicates are published sentences and are copied exactly; those sentences are not restated here.

Catalogue 68 anchor `D3ANCH-d7ed0d4b1eccf9d9b911e73cbc5373747973e76d4998ebaf91676ac95478775e` has one carrier whose binding subject is `ENFP` and whose `typeSubjectContext.subject` is `ENTP`, while another carrier is already `ENTP`.

Maslow catalogue 25 anchor `D3ANCH-5df251cda236184cb35bd620964710d885ba64a27109b2862b456a1edc3e223f` has five multi-token binding subjects, null `typeSubjectContext` values, and no group. It is unconsumable.

No group record has a quantification field. Nine groups have `scopeId`. Thirty-eight do not. Every `countingWeight` is 1.

## Canonicalization

Coordinate schema `nbrr1-d3-accepted-distinct-coordinate/1`. Unit schema `nbrr1-d3-option-p-unit/1`.

Canonical JSON is UTF-8, with lexicographic keys, comma and colon separators, literal Unicode, and no trailing newline. An absent accepted field is JSON null and the key remains present. A qualification string becomes a one-element array and is not split. A subject array is never one string and is never one hash.

`propositionIdentity` for a distinct coordinate is `D3COORD-` plus the SHA-256 of the coordinate payload. `anchorId` and `courseId` are inside that payload, so the same token on another anchor or another course is a different coordinate.

The unit key is the SHA-256 of the unit payload. `benchmarkIdentity` and `countingContextId` are inside that payload, so two items do not share a unit key.

Quantification, when the accepted record has no field, is `NOT_STATED_ON_ACCEPTED_RECORD`. A different asserted quantification fails `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`.

The coordinate payload excludes member ids, passage ids, offsets, span ids, occurrence counts, gold, witness text, and contribution vectors.

## Decision categories

| Decision | Count | Disposition | Kind | Rule |
|---|---:|---|---|---|
| `EQUIVALENT_SCOPED` | 32 | ACCEPTED_GROUP_IDENTITY | none | Use the one published groupId. Do not emit a D3COORD. |
| `ATOMIC_COMPARISON_DECOMPOSITION` | 3 | ACCEPTED_GROUP_IDENTITY | none | Use the two published groupIds on atomicCells[].groupId. Cell subject text does not create a coordinate. |
| `SUBJECT_SCOPED_DISTINCT` | 20 | PUBLISHED_DISTINCT_COORDINATE | `TYPE_SUBJECT` | One coordinate per distinct element of semanticAnalysis.materialSubject after the carrier cross-check. |
| `LOCAL_SUBJECT_SCOPED_DISTINCT` | 8 | PUBLISHED_DISTINCT_COORDINATE | `LOCAL_SUBJECT` | One coordinate per distinct single-token localSubjectBindings[].subject. Conflicts and multi-token clauses fail the item. |
| `QUALIFICATION_SCOPED_DISTINCT` | 1 | PUBLISHED_DISTINCT_COORDINATE | `QUALIFICATION` | One coordinate per qualifiedPropositions element. Catalogue 47 publishes two. |
| `NONMATERIAL_EDITORIAL` | 6 | NONMATERIAL_EXCLUSION | none | Emit no coordinate. Independent credit is D3_NONMATERIAL_INDEPENDENT_CREDIT. |
| `NONMATERIAL_LABEL_STRIP` | 5 | NONMATERIAL_EXCLUSION | none | Emit no coordinate. Independent credit is D3_NONMATERIAL_INDEPENDENT_CREDIT. |
| `NONMATERIAL_TABLE_HEADER` | 2 | NONMATERIAL_EXCLUSION | none | Emit no coordinate. Independent credit is D3_NONMATERIAL_INDEPENDENT_CREDIT. |
| `BIBLIOGRAPHIC_TITLE_ONLY` | 3 | NONMATERIAL_EXCLUSION | none | Emit no coordinate. Independent credit is D3_NONMATERIAL_INDEPENDENT_CREDIT. |
| `SOURCE_LABEL_CONFLICT` | 5 | FAIL_CLOSED_SOURCE_CONFLICT | none | Fail D3_SOURCE_TYPE_LABEL_CONFLICT. Do not build a coordinate from disputedSubjects. |

No other decision value produces a D3COORD. `OTHER_PUBLISHED_DISTINCT` is not assigned to any of the 85 anchors.

## Group path

`propositionIdentity` is `groups[].groupId`.

`courseId` is `groups[].countingScope.courseId`.

`scopeId` is `groups[].scopeId` when that key exists, and otherwise null.

`subject`, `relationPredicate`, `polarity`, and `qualifications` come from `groups[].countingScope` when those keys exist, and otherwise null. Qualifications follow the Option P normalization.

The same contribution does not also emit a D3COORD. `atomicCells[].subject` does not create a coordinate. On the frozen three comparison anchors, each cell subject equals the corresponding group `materialSubject`, and the key still uses the group record.

## SUBJECT_SCOPED_DISTINCT

`coordinateKind` is `TYPE_SUBJECT`.

Each distinct element of `semanticAnalysis.materialSubject` is one subject. The carrier cross-check is the set of `carriers[].typeSubjectContext.subject`.

A missing carrier subject, or unequal sets, fails the whole item with `D3_MAP_SCOPE_AMBIGUOUS`. This candidate does not choose the list or the carriers. The frozen 20 anchors have equal sets, including catalogues 51 and 53, where one subject is repeated on an extra carrier and still collapses to one coordinate.

`semanticAnalysis.relationPredicate`, `semanticAnalysis.polarity`, and `semanticAnalysis.qualifications` are copied. The shared qualifications string becomes a one-element array. `scopeId` is null.

## LOCAL_SUBJECT_SCOPED_DISTINCT

`coordinateKind` is `LOCAL_SUBJECT`.

The subject source is `localSubjectBindings[].subject`, joined to `carriers[]` by `memberId`.

When `carriers[].typeSubjectContext.subject` exists, it must equal the binding subject. When it is null, a single-token binding subject is still consumed. A single token is a non-empty string with no whitespace. `UNKNOWN` is kept as `UNKNOWN`.

Unequal published subjects fail the whole item with `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED`. Catalogue 68 is that failure. No partial quotient is emitted.

A binding subject that contains whitespace fails with the same code. Catalogue 25 is that failure. The clause is not tokenized, summarized, or hashed. `normalizedSentence`, `basis`, and heading text are not repairs.

`relationPredicate`, `polarity`, `qualifications`, and `scopeId` are null on this path. The frozen records leave those semantic-analysis fields null.

## QUALIFICATION_SCOPED_DISTINCT

`coordinateKind` is `QUALIFICATION`.

Catalogue 47 publishes two `qualifiedPropositions`. Each one is a coordinate.

`subject` is `qualifiedPropositions[].subject`. `qualifications` is a one-element array containing `qualifiedPropositions[].qualification`. The frozen subjects are `INTP` and `UNKNOWN`. The frozen qualification tokens are `PRINCIPLES_DIFFERENCES_NUANCES` and `PHYSICAL_OBJECTS_ONLY`. `UNKNOWN` stays `UNKNOWN`.

`typeInferencePermitted` prohibits replacing `UNKNOWN`. It is not a unit-key field. `relationPredicate` and `polarity` are null. `predicateWitness.text` and `qualificationWitness.text` are excluded.

## Failure behavior

Any applicable failure code removes every key for the item. A failure has no numerator and no denominator.

When exactly one failure code applies, that code is the result. When two or more apply, `emittedFailureCode` is null, `applicableFailureCodes` lists the codes in lexicographic order, and the quotient remains suppressed. Option P does not publish a total order among simultaneous mapping defects. V26 is that case. This candidate does not invent the missing order.

| Condition | Code |
|---|---|
| Anchor id outside the frozen 85 | `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED` |
| Group id outside the frozen 47 | `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED` |
| No group, subject token, or qualification | `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED` |
| Decision outside the ten published categories | `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED` |
| Multi-token heading clause used as a local subject | `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED` |
| Binding subject and context subject both present and unequal | `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED` |
| `courseId` differs from `semanticAnalysis.courseId`, or from the bound group course | `D3_MAP_SCOPE_AMBIGUOUS` |
| Subject-list set differs from the carrier subject set | `D3_MAP_SCOPE_AMBIGUOUS` |
| Subject array collapsed into one coordinate | `D3_ACCEPTED_AUTHORITY_CONFLICT` reason `SUBJECT_LIST_COLLAPSED` |
| Qualified propositions collapsed | `D3_QUALIFICATION_SCOPE_COLLAPSE` |
| Group contribution also demanded as a D3COORD | `D3_ACCEPTED_AUTHORITY_CONFLICT` |
| Witness text used as semantic identity | `D3_ACCEPTED_AUTHORITY_CONFLICT` |
| Passage singleton or contribution-vector key | `D3_ACCEPTED_AUTHORITY_CONFLICT` with the accepted reason |
| `SOURCE_LABEL_CONFLICT`, including unrepaired ENFP/ENTP attribution | `D3_SOURCE_TYPE_LABEL_CONFLICT` |
| Nonmaterial span credited as a unit | `D3_NONMATERIAL_INDEPENDENT_CREDIT` |
| Course outside the item authorization | `D3_SCOPE_MISSING` |
| Only nonmaterial contributions and no failure | `EMPTY_DENOMINATOR`, score null |

These Option P outcomes stay in force and are not reordered here: missing used span, missing privileged applicability, digest drift, R not a subset of C, a foreign evidence identity, and an atomic-ratio sum. Digest drift remains an admission failure in the Option P addendum and a scoring-failure string in the frozen counting contract. Both stop a number.

## Excluded sources

`normalizedSentence`, binding `basis`, heading and completion witness text, occurrence text, predicate and qualification witness text, `semanticTarget`, `scopeRestriction`, `corpusTargetId`, `disputedSubjects`, `atomicCells[].subject`, member ids, passage digests, and byte offsets.

## Vectors

`D3COORD_FIELD_MAPPING_TEST_VECTORS.json` contains V01 through V12B for the twelve required cases, with V12 split into an unknown group and an unknown anchor. V13 through V27 cover atomic-cell precedence, `UNKNOWN`, course mismatch, subject-inventory discrepancy, prohibited collapses, double counting, source-label conflict, nonmaterial results, singleton and vector fallbacks, witness text, simultaneous defects, and an unauthorized course. Inputs are synthetic. Catalogue 68 and catalogue 25 are named as frozen patterns; their prose is not copied.
