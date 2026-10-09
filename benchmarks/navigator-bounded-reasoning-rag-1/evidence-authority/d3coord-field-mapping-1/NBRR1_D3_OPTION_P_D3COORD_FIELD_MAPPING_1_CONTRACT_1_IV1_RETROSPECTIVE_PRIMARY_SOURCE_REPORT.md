# RETROSPECTIVE PRIMARY-SOURCE IV1 REPORT

Act attested: `NBRR1.D3-OPTION-P-D3COORD-FIELD-MAPPING-1.CONTRACT-1.IV1`
Reviewer: Z-AI / ZCode (GLM-5.3-Flash), independent of the author (Grok 4.7)
Report class: RETROSPECTIVE PRIMARY-SOURCE REPORT — ISSUANCE 1
Issued under: Owner handoff `README_PROVENANCE_AND_REISSUANCE_ADDENDUM.md` (handoff directory `NBRR1_IV1_ZAI_HANDOFF`)

---

## (a) Original IV1 act identifier

`NBRR1.D3-OPTION-P-D3COORD-FIELD-MAPPING-1.CONTRACT-1.IV1`

Object verified: the D3COORD field-mapping contract package (author Grok 4.7) at
`execution-infrastructure/NBRR1_D3_OPTION_P_D3COORD_FIELD_MAPPING_1_CONTRACT_1/`.

## (b) Original check date

2026-10-08 (executed in the live reviewer session; strictly read-only).

## (c) Actual report issuance date

2026-10-08, later the same day as the original check, at issuance time 23:49–23:55 local.
This is NOT a backdated document: the original check date and this issuance date are stated
separately and happen to fall on the same calendar day. No report file was authored at check
time (the check concluded with an in-conversation report); this document is the first file
primary-source report of that check, issued at the explicit request of the Owner handoff.

## (d) Exact checked artifact hashes (re-verified at issuance time, 2026-10-08)

Candidate package (all five recomputed at issuance, all match the values checked originally):

| File | SHA-256 |
|---|---|
| D3COORD_FIELD_MAPPING_CONTRACT.md | `974dd6cc2bf5bdbde85759c1f2f53f665a85b843a16064d64fcbfaf6451c87b5` |
| D3COORD_FIELD_MAPPING_CONTRACT.json | `f532eefc91099e9a80457e1e570b59e1bdc09319b54412efecafd8a1db774fe7` |
| D3COORD_FIELD_MAPPING_TEST_VECTORS.json | `a350a009d520102081b62c54afe90c15f4cbb7cbfe5dc8378649e1060d9ffd9b` |
| REPORT.md | `cbada5ca407c9267c52787f807ca1ca33d81b29f2356f196b17658dbadbebdbe` |
| SHA256SUMS | `267ac239021c244071e934960cd6093977b5890897a58f2bc0c43bb4f7a680c9` |

Accepted-authority identities checked originally (all verified against actual files):
semantic map `5094a769…`, anchor adjudications `f28fc94c…`, declarative counting contract
`0b29ab6c…`, Option P addendum `90fc2a19…` / contract `4feb1fdf…` / vectors `56e28e8f…`,
evidence universe `0715ed57…`, frozen benchmark `5549d7f6…` (manifest
`benchmarkContentIdentitySha256`). Group-ID list `1ea63abf…` (47) and guard-ID list
`fd201cb1…` (519) recomputed exactly. No HOLDOUT or SEALED gold decoded.

Repository state at original check: `structural-typology-navigator-main-reconciliation-1`,
branch `integration/academy-main-reconciliation-1`, HEAD `ed8d82ec69f1ca87b391b35e80d443f8d1a7da36`,
remote `https://github.com/Inposibl/structural-typology-navigator.git`, porcelain 0 before and after.

## (e) Findings and PASS counts (as originally determined, unchanged at issuance)

**VERDICT: PASS — BLOCKING 0 · MAJOR 0 · MINOR 3 · 28/28 vectors independently reproduced.**

Per-vector results (all derived from vector inputs by the reviewer's own contract-only
implementation, compared field-by-field to stored expectations): V01 group identity (C=1,
0 D3COORD); V02 subject-list split, sorted, repeat-collapse (2/2); V03 null-context local
binding (2/2); V04 qualified split with witness exclusion (2/2); V05 repeat collapse (1/1);
V06 two propositions in one carrier (2/2); V07 missing discriminator →
`D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`; V08 catalogue-68 ENFP/ENTP conflict, agreeing
carrier not emitted → `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED`; V09 absent quantification →
`NOT_STATED_ON_ACCEPTED_RECORD` with null fields, group still identifies (1/1); V10 multi-token
prose clause fails closed → `D3_LOCAL_SUBJECT_APPLICABILITY_UNRESOLVED`; V11 same nominal
subject across two courses → two coordinates (2/2); V12A unknown group and V12B unknown anchor →
`D3_USED_MATERIAL_APPLICABILITY_UNRESOLVED`; V13 two comparison groups, zero D3COORDs (2/2);
V14 literal UNKNOWN preserved (1/1); V15 course mismatch and V16 subject-inventory discrepancy →
`D3_MAP_SCOPE_AMBIGUOUS`; V17 subject-list collapse → `D3_ACCEPTED_AUTHORITY_CONFLICT` reason
`SUBJECT_LIST_COLLAPSED`; V18 → `D3_QUALIFICATION_SCOPE_COLLAPSE`; V19 group+coordinate double
count → `D3_ACCEPTED_AUTHORITY_CONFLICT`; V20 → `D3_SOURCE_TYPE_LABEL_CONFLICT`; V21
NOT_APPLICABLE `EMPTY_DENOMINATOR`, numerator 0, denominator 0, score null; V22 nonmaterial
credit → `D3_NONMATERIAL_INDEPENDENT_CREDIT`; V23 passage singleton → `D3_ACCEPTED_AUTHORITY_CONFLICT`
reason `PASSAGE_SINGLETON_FALLBACK`; V24 contribution-vector key → reason `VECTOR_KEY_FALLBACK`;
V25 witness text as identity → `D3_ACCEPTED_AUTHORITY_CONFLICT`; V26 simultaneous defects →
`emittedFailureCode` null, `applicableFailureCodes` lexicographic, quotient suppressed,
`precedenceUnsettled` true; V27 unauthorized course → `D3_SCOPE_MISSING`.

Key audits reproduced against the accepted authority: all ten decision-category counts
(32/3/20/8/1/6/5/2/3/5 = 85 anchors); 20 SUBJECT anchors set-equal to carrier subjects
(including repeated-token catalogues 51/53 collapsing to two coordinates); catalogue 47's two
`qualifiedPropositions` (INTP/UNKNOWN; `PRINCIPLES_DIFFERENCES_NUANCES`/`PHYSICAL_OBJECTS_ONLY`);
scopeId 9/38 split; all unit weights 1; zero quantification fields on groups; every canonical
coordinate digest, `D3COORD-` identity chain, and unit key regenerated byte-exact from the
written canonicalization specification; MD/JSON consistency with no material disagreement; both
special cases (catalogue 68, Maslow catalogue 25) fail closed; no gold, no passage digests, no
privileged content in any payload or candidate file.

MINOR findings (3), unchanged:
1. IV1-M01 diagnostic determinism: no contract-pinned emission order for diagnostic lists
   (V03 `unitKeys` order vs coordinates; V26 `conditions` in detection order while codes are
   lexicographic). Digests, cardinalities, codes, and suppression are order-independent.
2. IV1-M02 provenance: `controllingPreflight` cites `…FIELD-MAPPING-1.PREFLIGHT-1`, whose
   artifact is absent from disk; substance independently reproduced by the check.
3. IV1-M03 documentation: the 1964 unclosed passage-state count is preserved but not restated
   in the contract inventory.

## (f) Independent check methodology

Original check (2026-10-08): repository preflight; SHA-256 verification of all five candidate
files and all eight controlling authorities; group/guard ID-list digest recomputation; inventory
recount from the frozen files; ten-category field-mapping audit against the 85 anchor records;
special-case record inspection; canonicalization reproduction with a purpose-built
implementation written from the contract text alone (never from the author's report), executed
against every vector input and compared field-by-field to every expected field; MD/JSON
consistency diff; privileged-binding and blindness assertions.

Issuance-time re-demonstration (2026-10-08): the ORIGINAL retained checker was located intact
and re-executed against the same frozen vectors file (digest re-verified above):

- Retained script: `/tmp/iv1_d3coord/independent_checker.py`
  SHA-256 `538ce604973318af623ab29fba8fd58eff484b2df0cd0accad47101c2448f807`,
  mtime 2026-10-08 23:23 (original check session).
- Re-run result: `OVERALL: ALL VECTORS REPRODUCED INDEPENDENTLY`, exit 0, 28/28 PASS with the
  documented V26 conditions-order note (diagnostic only; suppression semantics identical).

## (g) Known limitations and proof classification

Proof class: **RETAINED-OUTPUT-BACKED — not transcript reconstruction.**

- The checking reviewer and this report's issuer are the same reviewer entity in the same live
  session; the full verification record (every command, derivation, and comparison) is retained
  in that session's records, and the decisive proof object — the independent checker script —
  is retained (path, digest, and pre-issuance mtime above) and re-demonstrates 28/28 at
  issuance against digest-verified frozen inputs.
- The Owner-supplied conversation export (`D3COORD_IV1_ZAI_CHAT_TRANSCRIPT_COPY.txt`,
  SHA-256 `b8e4841ce2823f977be69c1356fef11a96934a6696ae353d702fe72201be19fe`) was compared
  against the session record by the same-session reviewer and is consistent with it; it remains
  source material, not an authenticated original filesystem report.
- Limitation 1: the exact console output of the original run is not separately captured as a
  file; the issuance-time re-run is a re-demonstration by the same implementation.
- Limitation 2: the transient `/tmp` script survives only until host reboot; its digest is
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

Issuer: Z-AI / ZCode (GLM-5.3-Flash), 2026-10-08.
