# D3 Option P operational addendum

Status: `CANDIDATE_PENDING_INDEPENDENT_IV`

Act: `NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.OPTION-P-ADDENDUM-1`

This document is a candidate operational addendum. It is not Owner acceptance of itself, not an independent IV, and not authority to implement a scorer.

The normative machine statement is `D3_OPTION_P_OPERATIONAL_CONTRACT.json`. The twenty abstract executions are `D3_OPTION_P_ABSTRACT_TEST_VECTORS.json`. If prose and JSON disagree, the JSON contract governs.

## 1. Owner decision bound here

Controlling decision act: `NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.UNIT-KEY-DECISION-1`

OD-1 is Option P, and that choice is Owner-accepted.

One countable D3 unit is one independently material proposition contribution inside its accepted course and semantic scope.

- A passage may contribute several units when it carries several distinct used material propositions.
- Several passages that repeat one material proposition inside one approved course and scope contribute one unit.
- A repeated technical source span does not create a second unit for that same proposition.
- Distinct propositions, qualifications, polarities, type subjects, and course contexts stay distinct.
- Unknown or conflicting used-material applicability fails before a number.

Preserved:

- `D3 = |unitKeys(R)| / |unitKeys(C)|`
- `C` is the set of actually cited or used material contributions.
- `R` is the relevant subset of `C`.
- Every unit weight is 1.
- No fractional counting, dimension aggregation, compensatory scoring, or cross-item leakage.
- The original nine dimensions and nine non-compensatory gates stay in place.
- D4 semantic support stays a separate judgment.

## 2. Accepted authority this addendum does not rewrite

| Artifact | SHA-256 |
|---|---|
| Semantic map | `5094a769e3f27c98dc1ae89b14bd253f01f95b64f715d9aa9c51e103f436c5d7` |
| Declarative counting contract | `0b29ab6ce3ef45d4fad5736035566e8574c3cc769e8fb55aa8bf19a7af967fe4` |
| Package identity | `82c5b4af1bf08ac4abf5219041fd9752b9a1066db7062465891acedb0fbeed4a` |
| IV1 report | `f94f0e38d26c86afc579437b6b12ce2459fc2d310023e1dab8467455e921d88f` |
| Evidence universe, 1999 identities | `0715ed576d0b4d514437138b190f54a4aaec5f58f6b70969cc7a88efd80f719e` |
| Frozen benchmark | `5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3` |

Preservation pins: 47 group IDs, list SHA-256 `1ea63abf4bb4fa2a53ba8bfe985582595c966fa4542dd4c4c34f855dd47a4cea`. 519 guard IDs, list SHA-256 `fd201cb129fa1a59c0c83a0d3825aa5b5dcd4ce1cbaade5c880e4897fb5e1abe`.

IV1 remains PASS with blocking 0, major 0, and minor 3. Those three minors are label cautions. This addendum does not rewrite them.

Nine of the 47 groups have a `scopeId`. Thirty-eight do not. None of the 47 groups has a `quantification` field. The unit-key rule below accounts for those published shapes. It does not backfill the map.

## 3. Precedence

1. Owner-accepted semantic and procedure decisions, including the 47 groups, the 519 guards, and the occurrence procedure.
2. Owner-accepted OD-1 Option P.
3. The accepted declarative counting rule: the C/R cardinality quotient, unit weight 1, the empty-denominator null, and fail-closed applicability.
4. This addendum, only after a separate independent IV and a later Owner acceptance of the addendum.
5. Historical candidate files, as provenance only.

Until step 4 happens, this addendum stays `CANDIDATE_PENDING_INDEPENDENT_IV`.

### Obsolete admission flags

These files keep their bytes. Their older status sentences do not override a later explicit Owner acceptance.

| File | SHA-256 | What is obsolete |
|---|---|---|
| `decision.json` | `66e3743b61c2b3d348194e815f2d409809d22ab6d9bb91b93268203ab632dc00` | `D3MapComplete=false` and blocker `D3_SEMANTIC_MAP_INCOMPLETE` |
| `scoring-contract.json` | `0d9eb96a3e32666d2ed8de5c9dc62d30b5e8897ebd8ea30db22648402be37456` | The blocker that says the complete map was not authored |
| `test-base-contract.json` | `9d4728173789ef60a1f34011c2ffb3d9d5134f030b456770dfe968e185562a45` | `d3.acceptedMapIdentity=null` and `BLOCKED_D3_RESIDUAL_SEMANTIC_APPLICABILITY` |
| `package-identity.json` | `82c5b4af1bf08ac4abf5219041fd9752b9a1066db7062465891acedb0fbeed4a` | `ownerAccepted=false` and `AUTHOR_CANDIDATE_PACKAGE_IDENTITY_NOT_ACCEPTANCE` |

`scoring-contract.json` still correctly freezes nine dimensions, nine gates, `noAggregateScore`, `noWeights`, and `noCrossDimensionCompensation`. TEST_BASE remains closed for reasons other than the D3 map: timeout authority, isolated database identity, reviewer bindings, Package A–E proof, and runner and scorer digests.

The v2/v3 contribution vector is not accepted. `schemaMechanicsPromotedToAuthority` stays false. Option P replaces that candidate as the item-level key. It does not promote the vector schema.

## 4. Unit-key definition

A unit key is the SHA-256 of one canonical JSON object.

Canonical JSON is UTF-8, object keys sorted lexicographically, separators comma and colon, Unicode written literally, and no trailing newline. Qualification strings are not split. A published string becomes a one-element array. A published array is sorted. A missing qualification field becomes JSON null.

The payload contains exactly these fields:

- `schema`: `nbrr1-d3-option-p-unit/1`
- `benchmarkIdentity`: the frozen benchmark digest
- `countingContextId`: the opaque per-item context
- `courseId`
- `identityKind`: `EQUIVALENCE_GROUP` or `ACCEPTED_DISTINCT_COORDINATE`
- `propositionIdentity`
- `scopeId`
- `subject`
- `relationPredicate`
- `polarity`
- `quantification`
- `qualifications`

The payload does not contain a passage id, member id, passage digest, byte offset, source-span id, occurrence count, gold text, required-proposition text, or contribution vector.

The same proposition inside one item context, one course, and one accepted scope therefore has one key on every passage that carries it. Two different proposition identities do not share a key. Two item contexts do not share a key, so item traces cannot be unioned.

Weight is 1. Any other weight is `D3_ACCEPTED_AUTHORITY_CONFLICT` with reason `NON_UNIT_WEIGHT`.

### Equivalence groups

When the used span binds to exactly one of the 47 accepted groups, and the binding does not contradict that group's published course, subject, relation, polarity, or qualifications:

- `identityKind` is `EQUIVALENCE_GROUP`.
- `propositionIdentity` is that `groupId` exactly.
- `scopeId` is the group's `scopeId` when the record has one, otherwise null.
- Subject, relation, and polarity are copied from `countingScope` when those fields exist, otherwise null.
- Quantification is `NOT_STATED_ON_ACCEPTED_RECORD`, because no accepted group publishes a quantification field. A binding that asserts some other quantification fails closed.
- Qualifications are the normalized published value, or null when the field is absent.

`corpusTargetId` is not the proposition identity. Some accepted anchors publish one corpus target over two distinct comparison cells. Those cells already have distinct group IDs, and the group ID is the key.

### Accepted distinct coordinates

Some accepted anchors keep propositions distinct and give them no group. Examples of that published shape are qualification bindings and per-carrier type or local subjects. This addendum does not create groups for them.

For one published single-subject binding:

- `identityKind` is `ACCEPTED_DISTINCT_COORDINATE`.
- `propositionIdentity` is `D3COORD-` plus the SHA-256 of a second canonical object.
- That coordinate object uses schema `nbrr1-d3-accepted-distinct-coordinate/1` and the published `anchorId`, `coordinateKind`, `courseId`, `subject`, `relationPredicate`, `polarity`, `quantification`, and `qualifications`.
- `coordinateKind` is one of `QUALIFICATION`, `LOCAL_SUBJECT`, `TYPE_SUBJECT`, or `OTHER_PUBLISHED_DISTINCT`.

The coordinate object has no member id, passage digest, or byte offset. Two carriers with the same published coordinate collapse. Two published subjects do not.

An anchor whose `materialSubject` is a list is not one coordinate. Each published single-subject binding stands alone. Collapsing the list is `D3_ACCEPTED_AUTHORITY_CONFLICT` with reason `SUBJECT_LIST_COLLAPSED`.

If the published binding has neither a group nor a single subject or qualification discriminator, the item fails with `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`. The passage id is not used as a substitute.

### Source spans, headers, and conflicts

A technical span is provenance. For one proposition coordinate, repeated and overlapping uses of that span produce one key. The same bytes may still carry two accepted distinct coordinates. Those coordinates stay two keys. The span rule forbids a second credit for one coordinate. It does not merge coordinates the accepted map kept apart.

An accepted nonmaterial header, label, title, or editorial span emits no coordinate. Crediting it is `D3_NONMATERIAL_INDEPENDENT_CREDIT`.

A used span under the accepted source-label conflict, when the use is type-specific or cross-type corroboration, is `D3_SOURCE_TYPE_LABEL_CONFLICT` for the whole item. The source is not repaired.

Comparison cells use their existing group IDs. Merging cells is `D3_COMPARISON_SCOPE_COLLAPSE`.

## 5. C/R counting

Resolve every cited material span to a coordinate, or fail the item.

`C` is the set of unique unit keys of the material propositions actually cited or used.

`R` is the subset of `C` whose coordinates the restricted binding marks as satisfying the frozen required-proposition predicate. The predicate text is not part of the public key.

On success, `D3 = |R| / |C|`, written as the unreduced fraction `numerator/denominator`.

These counts are reported separately because they are not the same number:

| Count | Meaning |
|---|---|
| `passageCount` | Distinct cited carriers |
| `citedOccurrenceCount` | Cited occurrence records before collapse, including nonmaterial spans |
| `excludedNonmaterialOccurrenceCount` | Accepted nonmaterial occurrences with no key |
| `materialOccurrenceCount` | Material occurrences before proposition collapse |
| `distinctPropositionCount` | Unique proposition identities |
| `unitKeyCount` | `\|C\|` |
| `relevantUnitKeyCount` | `\|R\|` |

On a scored item, `distinctPropositionCount` equals `unitKeyCount`. Passage and occurrence counts may be larger or smaller.

Empty `C` is the accepted diagnostic `EMPTY_DENOMINATOR`: outcome `NOT_APPLICABLE`, numerator 0, denominator 0, score null. It is not a perfect score. A cited but unresolved carrier is a scoring failure, not an empty set.

No per-proposition ratio is summed or averaged into D3. No repeated citation increases a weight. No cross-item key union is allowed. No new aggregate score is defined.

## 6. Privileged binding

Nothing in this directory is a populated item binding.

Public authority supplies the benchmark digest, the 1999-member universe, the 47 groups, the 519 guards, the published anchor coordinates, and the accepted overlap identities.

The future restricted record supplies:

- an opaque item id
- the frozen benchmark digest
- the authorized course ids
- opaque required-proposition pointers
- one counting-context id
- the exact cited universe member ids
- exact used UTF-8 spans and, where an accepted overlap exists, the source-span id
- a binding from each material span to one existing group or one published distinct coordinate
- explicit attribution of every additional used proposition
- a boolean relevance membership for every admitted proposition
- the partition digest
- the authority digests, including the IV and Owner receipts when they exist

D3 authors, contract authors, and scorer or runner implementation authors do not receive gold or required-proposition text. Public output is the outcome, the unreduced counts, the failure code when present, and the digests. The trace listed in the JSON contract is restricted.

This addendum does not read holdout, sealed, or gold semantics, and it does not create those rows.

## 7. Fail-closed outcomes

The 519 guard IDs, their order pin, and their effects stay as published. This addendum adds three operational codes beside them:

| Code | When | Stage |
|---|---|---|
| `D3_R_NOT_SUBSET_OF_C` | An element of R is not in C | Scoring failure |
| `D3_FOREIGN_EVIDENCE_IDENTITY` | A cited identity is outside the 1999 universe | Scoring failure |
| `D3_ATOMIC_RATIO_AGGREGATION` | Atomic or per-proposition ratios are summed or averaged into D3 | Scoring failure |

Existing codes stay in force, including:

- unknown proposition: `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`
- missing used span: `D3_USED_SPAN_BINDING_MISSING`
- missing privileged binding: `D3_CONTEXT_PARTITION_MISSING`
- source-label conflict: `D3_SOURCE_TYPE_LABEL_CONFLICT`
- contradictory partition: `D3_MAP_SCOPE_AMBIGUOUS`
- unaccepted group, passage singleton, or vector key: `D3_ACCEPTED_AUTHORITY_CONFLICT` with the matching reason
- whole-passage key: `D3_WHOLE_PASSAGE_EQUIVALENCE_INFERRED`

`D3_DIGEST_DRIFT` is classified here as an admission failure. The frozen counting contract still contains the effect string scoring failure for that same code. The frozen file is not edited. Both classifications stop the item before a number.

A failure suppresses the whole-item quotient. Empty C remains the only null score that is not a failure.

## 8. Abstract vectors

The twenty vectors use synthetic proposition symbols only. They do not contain protected questions, gold, or corpus sentences. Each vector records the public inputs, the restricted placeholders, the expected keys or the exact failure, the governing guard families, and the authority for that expectation.

No vector is blocked. The results are computed by the key algorithm in the JSON contract.

## 9. Boundaries of this act

This act authors documents outside the repository. It does not modify the semantic map, the counting contract, the 47 groups, the 519 guards, the benchmark, production source, or Git history. It does not implement a scorer, open TEST_BASE, or run FULL123.
