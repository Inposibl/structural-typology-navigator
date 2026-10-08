# Independent IV report — Historical B1 recovery — 2026-10-07

[VERIFIED] Verdict: **IV_PASS_B1_BENCHMARK_AUTHORITY_COMPLETE**. The author's recovery of exact historical passage authority for the four non-QA Maslow documents was reproduced independently, from the author's untouched inputs and my own extraction of the historical Git objects. All 554 lossless passages and all 554 content hashes verify byte-for-byte against my own reproduction; every B1 identity the frozen 123-item benchmark actually references binds to exact historical passage authority.

[VERIFIED] This act did not use any author-generated passage, hash, module copy, or reproduction output as an input. My reproduction used only: my own fresh extraction of the input bundle, my own `git show` extraction of the historical modules at the pinned commit, and my own drivers. The author's reproduction outputs were compared only after my own reproduction was complete, and they agree 554/554.

## Required final fields

```text
ACT = NAVIGATOR-BOUNDED-REASONING-RAG-1.POST-RECONCILIATION-TESTING-1.MASLOW-NON-QA-HISTORICAL-B1-RECOVERY-1.IV1
ACTOR = DEEPSEEK
ROLE = INDEPENDENT BENCHMARK AUDITOR / HISTORICAL B1 RECOVERY VERIFIER
AUTHOR_UNDER_REVIEW = CODEX SOL 6.1
VERDICT = IV_PASS_B1_BENCHMARK_AUTHORITY_COMPLETE
PRODUCT_BASELINE = cd3743232c235d228fce1c2d9bf816d3d1e471d0
BENCHMARK_IDENTITY = 5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3
B2_STATUS = OWNER-ACCEPTED / CLOSED / NOT REOPENED
INPUT_BUNDLE_SHA256_VERIFIED = YES
ALL_AUTHOR_CHECKSUMS_PASS = YES
PINNED_HISTORICAL_COMMIT_VERIFIED = YES
HISTORICAL_GIT_MODULES_VERIFIED = 18 / 18
FINAL_OPERATORS_VERIFIED = 4 / 4
INDEPENDENT_REPRODUCTION_PASS = YES
MAIN_MANUSCRIPT_CHUNKS = 283
PRESENTATION_CHUNKS = 20
SECOND_MEET_CHUNKS = 140
FIRST_MEET_CHUNKS = 111
TOTAL_EXACT_PASSAGES_VERIFIED = 554 / 554
TOTAL_EXACT_CONTENT_HASHES_VERIFIED = 554 / 554
FORENSIC_MANIFEST_ROWS_VERIFIED = 554
OPEN_B1_IDENTITIES_FOUND = 16
OPEN_B1_IDENTITIES_BOUND = 16
OPEN_B1_REFERENCE_OCCURRENCES = 22
OPEN_B1_REFERENCE_OCCURRENCES_BOUND = 22
FROZEN_BENCHMARK_B1_IDENTITY_COUNT = 31
PROTECTED_REQUIRED_IDENTITIES_FOUND = 23
PROTECTED_REQUIRED_IDENTITIES_BOUND = 23
TOTAL_BENCHMARK_REQUIRED_B1_IDENTITIES_BOUND = 31 / 31
HISTORICAL_ALL_554_DATABASE_IDS_COMPLETE = NO
FROZEN_BENCHMARK_REQUIRED_B1_BINDINGS_COMPLETE = YES
B1_STATUS = B1_BENCHMARK_REQUIRED_IDENTITY_BINDING_COMPLETE SUBJECT_TO_OWNER_ACCEPTANCE
MINOR_FINDING_CLASSIFICATION = NON-MATERIAL MINOR
PROTECTED_SEMANTICS_EXPORTED = NO
PRODUCT_FILES_MODIFIED = 0
BENCHMARK_FILES_MODIFIED = 0
GIT_MUTATIONS = 0
NETWORK_CONTACT = 0
BENCHMARK_EXECUTIONS = 0
BLOCKING = 0
MAJOR = 0
MINOR = 0 (no new independent findings; the author-reported minor is confirmed separately under MINOR_FINDING_CLASSIFICATION)
READY_FOR_OWNER_ACCEPTANCE = YES
RECOMMENDED_NEXT_ACT = OWNER ACCEPTANCE OF NAVIGATOR-BOUNDED-REASONING-RAG-1.POST-RECONCILIATION-TESTING-1.MASLOW-NON-QA-HISTORICAL-B1-RECOVERY-1 INCLUDING IV1
NEXT = Owner acceptance only. Execution-contract closure was not started; no runner, scorer, FULL123, or FULL924 execution was begun.
```

## Author artifact integrity

[VERIFIED] The author report SHA-256 sidecar authenticates the report bytes (`e5e0f3f5dd9b89fe779dc87279108738f97e4628d511104500a34ab90cfe6bd5`). The evidence-root `SHA256SUMS` ledger verifies in full, and its own digest (`a821409bece75c73627bb6e863d7bd00ce2f0beb372397cd71275896ecbbad98`) matches the author's separate sealing receipt, which correctly excludes the ledger and the receipt from itself.

```text
AUTHOR_CHECKSUM_ENTRIES_TOTAL = 668
AUTHOR_CHECKSUM_ENTRIES_PASS = 668
AUTHOR_CHECKSUM_FAILURES = 0
```

[VERIFIED] Every evidence file the report names is present and hash-authenticating. The author's `controlling_request.txt` is the author act's own prompt (not this IV prompt), and its `required_final_fields.json` agrees with the report's field block. No author artifact was modified: all evidence files are byte-identical to what the ledger seals.

## Input identity and bundle

[VERIFIED] The input bundle was located at the author's declared path and its outer digest recomputed independently:

`035dd4be8a5d0704c9dafebc4d35b68eea0954f4120cb4ee999dd20cfe9bb14c` — matches both the shipped sidecar and the act's controlling identity (`INPUT_BUNDLE_SHA256_VERIFIED = YES`).

[VERIFIED] From **my own** extraction of that ZIP (not the author's copy): **69 / 69** internal `00_MANIFEST/SHA256SUMS` entries pass. All **11 / 11** archives (9 primary, 2 predecessor) pass CRC verification, and every nested member matches the extracted bundle member byte-for-byte (0 mismatches). The nine primary package identities, the two predecessor package identities, the four original source identities, and the four operator identities all recompute as declared.

[NOTE] The bundle's own manifest is internally honest about a gap: it records `historical_commit_verified: false` and lists the pinned Git object database, the ingestion source files, and the pinned toolchain among `missing_mandatory_files`. The bundle therefore could not by itself supply the historical Git authority; the recovery obtained it from the local Git object store. I verified that source directly rather than relying on the bundle's snapshot.

## Historical Git authority

[VERIFIED] `d7b3efd0d721f58e04b3506c46b9f53284a7c8a9` is a commit in the local object store. Independently confirmed: object type `commit`, tree `56c3c2075e57a396898a28ecaf5050fc21e789bc`, parent `a9b0f60ccd0aab4596704adff170e936b58eea6e`. Both candidate repositories in this workspace resolve the commit to the same tree.

```text
HISTORICAL_GIT_MODULES_EXPECTED = 18
HISTORICAL_GIT_MODULES_VERIFIED = 18
```

[VERIFIED] Every module was re-extracted with `git show <pinned-commit>:<path>`; never from the author's copies and never from current HEAD. For all 18 modules the Git blob SHA-1 (with `blob <len>\0` framing), the SHA-256, and the byte length match the author's claims exactly, and a second repository clone produces byte-identical content for all 18. Toolchain files at the pinned commit (`package.json`, `package-lock.json`, `tsconfig.json`) match the author's recorded blob ids, hashes, and lengths; `npm-shrinkwrap.json`, `pnpm-lock.yaml`, and `yarn.lock` are genuinely absent at that commit, as the author states.

[VERIFIED] The dependency closure is complete and was re-derived independently: I walked the four operators' relative imports (from my own bundle extraction) against the pinned commit and obtained exactly the same 18-module set the author lists — no module missing, no module added. The deterministic path used by the reproduction is 8 of those modules, all self-contained with no external package imports.

[NOTE] The four operators hard-code their repository path to `structural-typology-navigator`, whose live worktree HEAD today is `e6d82b887bb1d266bd10f4674102fc791bd760cf` — not the pinned commit. Running them verbatim is therefore not possible in the current environment (their own local-HEAD assertion would fail, and their preflight fetches from the network). I verified that the pinned commit is an ancestor of that live HEAD and that **all 18 historical modules are byte-identical between the pinned commit and the live worktree**, so this difference cannot cause a reproduction divergence. My drivers import only my own `git show` materialization.

## Four historical operators

[VERIFIED] All four operators hash exactly to the act's controlling pins, and all four pin `EXPECTED_REPO_HEAD` to the historical commit.

```text
academy_ingest_maslow_canonical_md_v1.mjs       bb9ea8750110b90e5bd2d3f4276bbf4fc73add391cea22cf245733a6e7a938a4  MATCH
academy_ingest_maslow_presentation_2025_v1.mjs  cbe8e14e596ca2a9d1e68aa7c9dd5b8839ffa686b37434083ae67913b115f746  MATCH
academy_ingest_maslow_second_meet_v1.mjs        ba1de4715d0dcd311224543ce477602d715a83f46ef25ef2168e3800fd68c9b7  MATCH
academy_ingest_maslow_first_meet_v1.mjs         04cfd4d67e4f8d8d1a1823b0acc7af8eaaeeacbb3eea8c03392501642d039f84  MATCH
```

[VERIFIED] The operators were never executed or imported. Each was sliced at its own secret-acquisition boundary; only the deterministic pre-network prefix was copied into an IV driver. Four patches were applied, each mechanical and recorded in `independent-reproduction.json`: a throwing `globalThis.fetch` guard, replacement of the `git()` helper with a local-only shim that removes the single remote fetch, redirection of the module root to my materialization, and redirection of the input paths to my own bundle extraction. The P2 shim does not simply assert the pin — it re-derives all 18 module blob ids from the Git object store and re-computes each materialized file's blob id before any module is imported.

## Independent reproduction

[VERIFIED] All four documents reproduce exactly, from the frozen inputs, and match every frozen expectation:

| sourceSlug | blocks | chunks | characters | normalized SHA-256 | canonical SHA-256 |
|---|---:|---:|---:|---|---|
| maslow-new-paradigm | 427 | 283 | 260217 | `484e722e…2cce` MATCH | `588d0d86…a038` MATCH |
| maslow-new-paradigm-presentation-2025-02-22 | 213 | 20 | 20343 | `9629406f…5abb` MATCH | `870fbb8d…2d29` MATCH |
| maslow-second-meet-transcript | 191 | 140 | 120328 | `c28eabb7…fd95` MATCH | `7e74ceb4…55b0` MATCH |
| maslow-first-meet-transcript | 172 | 111 | 99214 | `7d790138…db82` MATCH | `f895917c…573f` MATCH |

[VERIFIED] Reproduction quality, recomputed in a second implementation (Python) rather than trusting the Node plan: every one of the 554 chunk hashes recomputes from raw UTF-8 bytes; the normalized content hash recomputes from the reconstructed `"\n\n"`-joined block text; every chunk content locates sequentially in the reconstructed content; every chunk's `sourceBlockRange` and per-source `blockCharacterRange` are consistent with independently computed block spans; and the union of chunks covers the whole normalized content. Two independent invocations of each driver produce byte-identical output. `networkAttempts = 0` in all four runs.

[VERIFIED] Compared only after my reproduction was complete, the author's reproduction agrees on all 554 chunks across content, content hash, locator, and heading path. There is no divergence to explain and no reliance on author output anywhere in my chain.

## Exact 554 passages

```text
EXACT_554_PASSAGES_VERIFIED = YES
EXACT_554_CONTENT_HASHES_VERIFIED = YES
```

[VERIFIED] The author's `forensic_manifest_554.jsonl` has exactly 554 rows with the required distribution 283 / 20 / 140 / 111 and strict zero-based sequential `historicalChunkIndex` within each document. All 554 named passage files exist; all 554 are byte-identical to my independently reproduced chunk bytes; all 554 `exactContentSha256` values equal hashes recomputed from the passage file bytes; all 554 UTF-8 byte lengths and historical runtime unit lengths (JavaScript UTF-16 code units) match; all 554 locator objects (primary, source block range, and per-source provenance) equal my reproduction; all 554 provenance heading paths equal my reproduction. Zero errors. No passage is widened, none carries an added trailing newline, none substitutes current database content, and none uses current-HEAD chunking — every byte descends from the pinned commit's modules and the frozen canonical inputs.

## Open development bindings

[VERIFIED] Independently re-derived from the frozen open development gold member, including `acceptableAlternativeEvidence`:

```text
OPEN_B1_IDENTITIES_FOUND = 16        (3 manuscript + 2 presentation + 11 second-meet + 0 first-meet)
OPEN_B1_REFERENCE_OCCURRENCES = 22   (4 + 2 + 16 + 0)
OPEN_B1_IDENTITIES_BOUND = 16 / 16
OPEN_B1_REFERENCE_OCCURRENCES_BOUND = 22 / 22
```

[VERIFIED] Each identity was bound by its frozen explicit `chunkIndex` selecting my reproduced passage, with **every** frozen locator field required to match the reproduced primary locator or chunk heading path. No database id was inferred arithmetically; each is copied only from an explicit frozen open record. Field-by-field comparison against the author's projection shows **zero differences** across all 22 occurrences. The frozen `chunkId ↔ chunkIndex` relation is a clean bijection (no multi-valued mappings), consistent with the author's claim that no id was derived from sequence or neighbours.

## Complete frozen-123 B1 identity projection

[VERIFIED] The complete projection across all three splits, computed under the limited protected access this act authorizes:

```text
DEVELOPMENT        : 22 references, 16 unique identities
HOLDOUT            : 19 references, 18 unique identities
ADVERSARIAL_SAFETY :  5 references,  5 unique identities
TOTAL              : 46 references, 31 unique identities
FROZEN_BENCHMARK_B1_IDENTITY_COUNT = 31
TOTAL_B1_REFERENCES_BOUND = 46 / 46
TOTAL_B1_IDENTITIES_BOUND = 31 / 31
```

[VERIFIED] All four B1 source slugs are referenced by the benchmark (the first-meet transcript only in holdout). Each slug maps to exactly one frozen `documentId`, consistent across all its references. Every reference carries an explicit `chunkId` and `documentId` — no nulls among referenced identities — and every one binds exactly.

[VERIFIED] Completeness was tested, not assumed: a string-level sweep over every frozen member found all B1 slug occurrences confined to evidence arrays (45 in `goldEvidence`, 1 in `acceptableAlternativeEvidence`) and none in the question members or elsewhere; the frozen schema declares only `goldEvidence` and `acceptableAlternativeEvidence` as evidence-bearing fields. No B1-referencing location was missed.

```text
PROTECTED_REQUIRED_IDENTITIES_FOUND = 23   (18 HOLDOUT + 5 ADVERSARIAL_SAFETY)
PROTECTED_REQUIRED_IDENTITIES_BOUND = 23 / 23
```

## Benchmark-required sufficiency

[VERIFIED] For every frozen benchmark-referenced B1 identity the exact chain was verified end to end — frozen `chunkId` → frozen `chunkIndex` / locator → my independently reproduced exact historical passage → exact content SHA-256 — with zero chain failures.

```text
HISTORICAL_ALL_554_DATABASE_IDS_COMPLETE = NO
FROZEN_BENCHMARK_REQUIRED_B1_BINDINGS_COMPLETE = YES
```

[VERIFIED] The first may legitimately be NO while the second is YES, and here that is exactly the case. Database `chunkId` values exist for 16 passages — precisely those explicitly bound by open development gold records — while 538 passage rows retain null ids, and no id was invented. The question this act was asked to answer is not whether all 554 database ids are known, but whether every B1 identity the frozen benchmark requires binds to exact historical passage authority. It does: 31 / 31, with the standard for referenced identities held at full strength (byte-exact passage plus SHA-256 plus full locator agreement).

## Protected data minimization

[VERIFIED] Protected members were read only as permitted for this act, and only the minimum identity/locator metadata was retained. The retained fields are an explicit allowlist: reference path, split, source slug, chunk id, document id, locator, authority relation, and a proposition count. Question text, gold answer content, required and prohibited propositions, abstention boundaries, trap semantics, adjudication notes, and sealed answer semantics were never retained, printed, or written anywhere. Item-level protected identity projection exists only inside this IV's evidence root.

```text
PROTECTED_SEMANTICS_EXPORTED = NO
```

[VERIFIED] B2 boundary respected: this act read no Maslow-QA evidence, reopened no B2 artifact, and modified nothing under the B2 roots. The only observation of B2 was directory names appearing in a top-level workspace listing. `B2_STATUS = OWNER-ACCEPTED / CLOSED / NOT REOPENED`.

## Minor finding

[VERIFIED] The author-reported non-material minor is confirmed and correctly classified.

```text
MINOR_FINDING_CLASSIFICATION = NON-MATERIAL MINOR
```

`bundle_manifest.json` records `README_FOR_REUPLOAD.md` as SHA-256 `6473b88f…78a` / 1,245 bytes; the actual bytes are SHA-256 `05b856a5…fa8` / 1,219 bytes. The record's own `expected_sha256` is null and its classification is `GENERATED_EXPORT_METADATA`, and the internal `SHA256SUMS` authenticates the actual README bytes. I checked the whole manifest rather than only the reported row: 67 of 68 file records are internally consistent and this is the **only** stale record. Effect determination: none on primary artifact identity (the README is generated export metadata, not a primary artifact), none on historical reproduction (it is not an operator input, canonical document, or sidecar), none on passage authority, none on benchmark binding. I did not modify the bundle; the anomaly was recorded only.

## Audit

```text
ACT = NAVIGATOR-BOUNDED-REASONING-RAG-1.POST-RECONCILIATION-TESTING-1.MASLOW-NON-QA-HISTORICAL-B1-RECOVERY-1.IV1
ACTOR = DEEPSEEK
VERDICT = IV_PASS_B1_BENCHMARK_AUTHORITY_COMPLETE
EVIDENCE_ROOT = /Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/NAVIGATOR_BOUNDED_REASONING_RAG_1_POST_RECONCILIATION_TESTING_1_MASLOW_NON_QA_HISTORICAL_B1_RECOVERY_1_IV1
EVIDENCE_ROOT_LEDGER = SHA256SUMS (702 entries, all verified)
AUTHOR_UNDER_REVIEW_ARTIFACTS_MODIFIED = 0
PRODUCT_FILES_MODIFIED = 0
BENCHMARK_FILES_MODIFIED = 0
GIT_MUTATIONS = 0
NETWORK_CONTACT = 0
BENCHMARK_EXECUTIONS = 0
SCOPE_DEVIATION_DISCLOSED = agent-memory entry only (see audit block)
```

[VERIFIED] No mutation of any kind was made. The two product repositories show unchanged working-tree state before and after this act (93 pre-existing dirty files in the navigator repository, 0 in the main-reconciliation repository, both unchanged), `benchmarks/navigator-bounded-reasoning-rag-1` differs from its baseline commit by nothing, and no commit, push, deploy, Supabase, Cohere, Telegram, Tikhon, payment, or runtime model call was made. Network contact was zero: no `git fetch`, no HTTP client, no provider call. The four drivers replace `globalThis.fetch` with a throwing guard and report zero attempts.

[VERIFIED] Method notes for reproduction of this IV: the historical modules were materialized with `git show`; the four drivers are included under `iv_tools/generated_drivers/` with their patch mapping in `independent-reproduction.json` and `iv-work/reproducer_source_mapping_iv.json`; the Python-side recomputation tools are under `iv_tools/`; per-chunk reproduced passages, locators, and reconstructed normalized documents are under `iv-work/iv-passages/`.

<audit>
FILES WRITTEN: inside the IV evidence root only — the twelve required artifacts, integrity.json, SHA256SUMS, iv_tools/ (five analysis tools plus four generated drivers), and iv-work/ (fresh bundle extraction, Git materialization, driver stdout for two runs, per-chunk reproduced passages, intermediate verification records including the local protected identity projection). Outside the root: this report and its SHA-256 sidecar plus one agent-memory entry. SCOPE DEVIATION DISCLOSED: the agent-memory write (a project status note under the persistent agent memory directory, containing no protected or author-artifact content) is outside this act's authorized artifact list and is disclosed here per the standing Owner ruling that such auxiliary writes be surfaced rather than silently made. It touches no product file, benchmark file, or Git object.
COMMANDS RUN: local read-only Git inspection (cat-file, rev-parse, show, ls-tree, log, diff, merge-base, status), local SHA-256 hashing, local Python standard-library analysis, and the four local offline Node drivers. No network command.
CLAIMS MADE WITHOUT EVIDENCE: none.
UNVERIFIED ASSUMPTIONS STILL LIVE: none material. The historical Node executable itself is not recovered (the author does not claim it either); reproduction uses the recorded Node v22.23.2 runtime, under which all frozen values reproduce exactly.
NEXT VERIFICATION THE OPERATOR SHOULD RUN: none. The recommended next act is Owner acceptance; execution-contract closure was deliberately not started.
</audit>

[VERIFIED] This act stops after independent reproduction, 554-passage verification, the complete frozen-123 B1 identity projection, benchmark-required binding verification, the IV report, the IV evidence, and the IV checksums. Owner acceptance, execution-contract closure, runner/scorer implementation, and FULL123/FULL924 execution were not started.
