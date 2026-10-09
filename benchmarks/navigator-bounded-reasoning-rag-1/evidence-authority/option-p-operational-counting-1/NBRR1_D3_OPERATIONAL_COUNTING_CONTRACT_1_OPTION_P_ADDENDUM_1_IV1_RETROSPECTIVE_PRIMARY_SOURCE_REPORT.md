# RETROSPECTIVE PRIMARY-SOURCE IV1 REPORT

Act attested: `NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.OPTION-P-ADDENDUM-1.IV1`
Reviewer: Z-AI (GLM-5.3-Flash), independent of the author (Grok 4.7)
Report class: RETROSPECTIVE PRIMARY-SOURCE REPORT — ISSUANCE 1
Issued under: Owner handoff `README_PROVENANCE_AND_REISSUANCE_ADDENDUM.md` (handoff directory `NBRR1_IV1_ZAI_HANDOFF`)

---

## (a) Original IV1 act identifier

`NBRR1.D3-OPERATIONAL-COUNTING-CONTRACT-1.OPTION-P-ADDENDUM-1.IV1`

Object verified: the Option P operational addendum package (author Grok 4.7) at
`execution-infrastructure/NBRR1_D3_OPERATIONAL_COUNTING_CONTRACT_1_OPTION_P_ADDENDUM_1/`.

## (b) Original check date

2026-10-08 (executed in reviewer session `sess_ae77fa7e-5f25-4247-873d-09f2c0bd782f`; strictly read-only).

## (c) Actual report issuance date

2026-10-08, later the same day as the original check, at issuance time 23:49–23:55 local.
This is NOT a backdated document: the original check date and this issuance date are stated
separately and happen to fall on the same calendar day. No original filesystem report file was
authored at check time; this document is the first file primary-source report of that check,
issued at the explicit request of the Owner handoff.

## (d) Exact checked artifact hashes (re-verified at issuance time, 2026-10-08)

Candidate package (all five recomputed at issuance, all match the values checked originally):

| File | SHA-256 |
|---|---|
| D3_OPTION_P_OPERATIONAL_ADDENDUM.md | `90fc2a19c6504208f543838783819f2a00e30296220bde8b5d6c3eccaf6d44b6` |
| D3_OPTION_P_OPERATIONAL_CONTRACT.json | `4feb1fdf2a8a3b58c1aa0b0ac748c9b98d3361cfb4e5adc91d2f69a1e69c1eea` |
| D3_OPTION_P_ABSTRACT_TEST_VECTORS.json | `56e28e8f80572c5ee4fdc92f87c30c1b96d966f4877e73a7090c269a9d7d19eb` |
| REPORT.md | `3886bf9537254512243b4afb5305469c418ff2927e1ad3ae9204041dc1a3bc9c` |
| SHA256SUMS | `35dff6db932b39ff1883c03750b2847f9e554e26402fd7818613836a2e385680` |

Accepted-authority identities checked at original time and re-verified same day:
semantic map `5094a769…`, declarative counting contract `0b29ab6c…`, evidence universe
`0715ed57…` (1999 rows), frozen benchmark `5549d7f6…`, 47 group-ID list `1ea63abf…`,
519 guard-ID list `fd201cb1…` (both newline-joined, published order, no trailing newline).

Repository state at original check: `structural-typology-navigator-main-reconciliation-1`,
branch `integration/academy-main-reconciliation-1`, HEAD `ed8d82ec69f1ca87b391b35e80d443f8d1a7da36`,
porcelain 0.

## (e) Findings and PASS counts (as originally determined, unchanged at issuance)

**VERDICT: PASS — BLOCKING 0 · MAJOR 0 · MINOR 4 · 20/20 vectors independently reproduced.**

Per-vector outcomes (all independently derived from vector inputs, never from expected blocks):
V01 1/1; V02 2/2; V03 1/1 (2 passages → 1 key); V04 3/3 (4 occurrences → 3 keys); V05 1/1
(overlap → 1 key); V06 1/2; V07 1/1 (header excluded); V08 SCORING_FAILURE
`D3_SOURCE_TYPE_LABEL_CONFLICT`; V09 SCORING_FAILURE `D3_USED_SPAN_BINDING_MISSING`;
V10 2/2 (distinct qualifications kept); V11 2/2; V12 SCORING_FAILURE
`D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`; V13 NOT_APPLICABLE `EMPTY_DENOMINATOR` 0/0 null;
V14 SCORING_FAILURE `D3_R_NOT_SUBSET_OF_C`; V15 SCORING_FAILURE `D3_FOREIGN_EVIDENCE_IDENTITY`;
V16 SCORING_FAILURE `D3_ATOMIC_RATIO_AGGREGATION`; V17 1/1 (repeat → 1 key); V18 2/2 (shared
passage → 2 keys); V19 SCORING_FAILURE `D3_CONTEXT_PARTITION_MISSING`; V20 whole-item
suppression, no partial quotient. Every outcome, failure code, failure reason, quotient flag,
score string, numerator, denominator, CKeys/RKeys (as sets and in exact list order), all seven
counts, and unit weight 1 matched.

MINOR findings (4), unchanged:
1. `D3_DIGEST_DRIFT` stage-label divergence: addendum `ADMISSION_FAILURE` vs frozen contract
   `SCORING_FAILURE` — author-disclosed; both forbid a number.
2. D3COORD field mapping unpinned for null-`semanticAnalysis` anchors (count-invariant; only
   opaque-ID cross-implementation portability unpinned); the real `D3COORD-` derivation is
   exercised only symbolically by the vectors.
3. Anchor `D3ANCH-5df251cda236184cb…` (Maslow, LOCAL_SUBJECT) publishes no structured
   discriminator; items citing it always fail closed `D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`
   — conservative, an Owner-awareness note.
4. No total precedence order among distinct simultaneously-firing same-stage codes; quotient
   suppression invariant.

Inventory facts confirmed: `scopeId` on exactly 9/47 groups; `materialSubject`/`qualifications`
on the disjoint 38/47; no `quantification` field on any group; 1964 unclosed passage states
(33 GROUPED + 2 PROCEDURALLY_DISTINCT + 1964 = 1999); candidate directory contains no gold or
corpus text.

## (f) Independent check methodology

Original check (2026-10-08): read-only file reads and digests; read-only JSON inspection;
group/guard ID-list digest recomputation; hand-derivation of the V01 unit key from the contract
text alone before any code; then a purpose-built independent recomputation script deriving every
vector outcome from `publicInputs` + `restricted` only (whole-item fail-closed stage before
resolution; C as set of unit keys; asserted-relevance subset check; R ⊆ C; unreduced quotient;
empty-C as NOT_APPLICABLE), compared field-by-field against the stored expectations.

Issuance-time re-demonstration (2026-10-08): the ORIGINAL retained script was located intact and
re-executed against the same frozen vectors file (digest re-verified above):

- Retained script: `/tmp/d3_option_p_iv1_recompute.py`
  SHA-256 `ac42838a61e7370c6c979a76cc7d80ab11038ebfa40d3481e00dc91236fd652d`,
  mtime 2026-10-08 22:14 (predates this issuance session).
- Re-run result: `ALL-20-INDEPENDENTLY-REPRODUCED: True`, exit 0, 20/20 PASS lines.
- Third-path corroboration: the V01 unit key was recomputed a second time by a separate inline
  canonicalizer written for this issuance; result
  `f9fa370c3d55034d0c836ad1a29828303710037320ec43f9b85a0da55e3d90ba` — matching the frozen
  vectors file's own expected block and the original check's hand-derived value.

## (g) Known limitations and proof classification

Proof class: **RETAINED-OUTPUT-BACKED, with transcript corroboration — not transcript-only.**

- The original IV1 session's console transcript is not retained by the reviewer as a file. The
  Owner supplied a byte-identical export of the reviewer conversation text
  (`OPTION_P_IV1_ZAI_CHAT_TRANSCRIPT_COPY.txt`,
  SHA-256 `093c2003ca220ad932181a94f6ff1fe8adfa21a77d8f6ba482e7245a434ae6ef`).
- However, the decisive proof object — the original independent recomputation script — IS
  retained (path, digest, and pre-issuance mtime above) and re-demonstrates 20/20 at issuance
  against digest-verified frozen inputs. A contemporaneous reviewer memory record
  (`navigator-nbrr1-d3-option-p-addendum-iv1`, origin session `sess_ae77fa7e-5f25-4247-873d-09f2c0bd782f`)
  written at check time agrees with the transcript in every checkable particular (act, reviewer,
  verdict, counts, minors, digests, V01 key).
- Limitation 1: the exact console output of the original run is not preserved; the issuance-time
  re-run is a re-demonstration by the same implementation, not a capture of the original output.
- Limitation 2: no NEW independent re-implementation of the 20 vectors was written for this
  issuance; doing so would constitute a fresh verification act requiring separate Owner
  authorization. The V01 third-path key check is a targeted corroboration only.
- Limitation 3: the transient `/tmp` script survives only until host reboot; its digest is
  recorded here for permanence.

## Provenance statements

- The Owner-supplied transcript copy is source material, not an authenticated original
  filesystem report; it must not be archived in Git as the original IV1 file.
- This document is a retrospective primary-source report of a completed verification act. It is
  not Owner acceptance, not a receipt, and authorizes no implementation.
- `NBRR1.D3-OPERATIONAL-AUTHORITY-GIT-CLOSURE-1` remains blocked
  (`BLOCKED_MISSING_ORIGINAL_IV1_REPORT`) until the Owner separately authorizes resumption;
  this issuance does not resume, commit, or push anything.

## Issuance-time unauthorized-operation counters

`REPOSITORY_MUTATIONS=0 · CANDIDATE_MUTATIONS=0 · ACCEPTED_ARTIFACT_MUTATIONS=0 ·
BENCHMARK_MUTATIONS=0 · BENCHMARK_EXECUTIONS=0 · PROVIDER_CALLS=0 · PRODUCTION_CONTACT=0 ·
GIT_MUTATIONS=0 · SCORER_IMPLEMENTATIONS=0 · RUNNER_IMPLEMENTATIONS=0 ·
PRIVILEGED_BINDINGS_CREATED=0 · TEST_BASE=0 · FULL123=0 · FULL924=0 ·
PRODUCTION_DEPLOYMENTS=0 · GIT_FORCE_PUSHES=0`

Issuer: Z-AI (GLM-5.3-Flash), 2026-10-08.
