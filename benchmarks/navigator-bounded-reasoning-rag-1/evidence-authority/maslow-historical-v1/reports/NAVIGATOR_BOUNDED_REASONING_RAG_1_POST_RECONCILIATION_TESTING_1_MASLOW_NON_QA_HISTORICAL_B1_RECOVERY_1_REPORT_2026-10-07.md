# Historical B1 recovery author report — 2026-10-07

[VERIFIED] Primary recovery class: **B1_RECOVERED_EXACT_PASSAGE_AUTHORITY**. All four final historical documents reproduce exactly, and all 554 lossless passage files and SHA-256 values exist. The recovered historical dependency closure contains 18 modules. This is an author result; it does not declare independent IV, B1 technical closure, or Owner acceptance.

[VERIFIED] Open development binding is complete for 16 distinct database identities across 22 reference occurrences. Protected identity completeness remains unexamined. Database-ID completeness is separate from exact passage authority; 538 passage rows retain null chunk IDs, and no database ID was inferred from offsets, sequence, neighboring IDs, or current database state.

## Required final fields

```text
ACT = NAVIGATOR-BOUNDED-REASONING-RAG-1.POST-RECONCILIATION-TESTING-1.MASLOW-NON-QA-HISTORICAL-B1-RECOVERY-1
ACTOR = CODEX SOL 6.1
ROLE = HISTORICAL B1 FORENSIC RECOVERY AUTHOR
STATUS = B1_RECOVERED_EXACT_PASSAGE_AUTHORITY
PRODUCT_BASELINE = cd3743232c235d228fce1c2d9bf816d3d1e471d0
BENCHMARK_IDENTITY = 5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3
B2_STATUS = OWNER-ACCEPTED; TECHNICALLY CLOSED FOR FROZEN123; NOT REOPENED
INPUT_BUNDLE_SHA256 = 035dd4be8a5d0704c9dafebc4d35b68eea0954f4120cb4ee999dd20cfe9bb14c
INPUT_BUNDLE_INTERNAL_CHECKSUMS_PASS = YES (69/69)
PINNED_HISTORICAL_COMMIT = d7b3efd0d721f58e04b3506c46b9f53284a7c8a9
PINNED_HISTORICAL_COMMIT_VERIFIED = YES
HISTORICAL_GIT_DEPENDENCY_CLOSURE_COMPLETE = YES
HISTORICAL_GIT_MODULE_COUNT = 18
FINAL_OPERATORS_VERIFIED = 4/4
FINAL_INPUT_PACKAGES_VERIFIED = 9/9 primary archives; 2/2 predecessor archives; 4/4 original sources
MAIN_MANUSCRIPT_REPRODUCTION = PASS
MAIN_MANUSCRIPT_CHUNKS = 283
PRESENTATION_REPRODUCTION = PASS
PRESENTATION_CHUNKS = 20
SECOND_MEET_REPRODUCTION = PASS
SECOND_MEET_CHUNKS = 140
FIRST_MEET_REPRODUCTION = PASS
FIRST_MEET_CHUNKS = 111
TOTAL_EXACT_PASSAGES_RECOVERED = 554
TOTAL_EXACT_CONTENT_HASHES_RECOVERED = 554
FORENSIC_MANIFEST_ROWS = 554
OPEN_BENCHMARK_B1_IDENTITIES_FOUND = 16
OPEN_BENCHMARK_B1_IDENTITIES_BOUND = 16
HISTORICAL_ALL_DATABASE_IDS_COMPLETE = NO
B1_PASSAGE_AUTHORITY_STATUS = EXACT_HISTORICAL_554_PASSAGES_RECOVERED
B1_IDENTITY_BINDING_STATUS = COMPLETE_FOR_OPEN_DEVELOPMENT (16/16 unique; 22/22 occurrences); PROTECTED_BINDINGS_DEFERRED_TO_INDEPENDENT_IV
B1_STATUS = RECOVERY_AUTHOR_COMPLETE; INDEPENDENT_IV_PENDING; OWNER_CLOSURE_NOT_DECLARED
PROTECTED_GOLD_READ = 0
PROTECTED_SEMANTICS_EXPORTED = 0
NETWORK_CONTACT = 0
PRODUCT_FILES_MODIFIED = 0
BENCHMARK_FILES_MODIFIED = 0
GIT_MUTATIONS = 0
BENCHMARK_EXECUTIONS = 0
BLOCKING = 0
MAJOR = 0
MINOR = 1
READY_FOR_INDEPENDENT_IV = YES
RECOMMENDED_NEXT_ACT = NAVIGATOR-BOUNDED-REASONING-RAG-1.POST-RECONCILIATION-TESTING-1.MASLOW-NON-QA-HISTORICAL-B1-RECOVERY-1.IV1
NEXT = Independent IV of exact passage authority and minimum protected identity/locator metadata; not started in this act.
```

## Exact reproduction evidence

| sourceSlug | Blocks | Chunks | JavaScript UTF-16 units | Normalized SHA-256 |
|---|---:|---:|---:|---|
| maslow-new-paradigm | 427 | 283 | 260217 | 484e722e2c7beff096f582adbd7989061072f915109101680586a8bd1fa82cce |
| maslow-new-paradigm-presentation-2025-02-22 | 213 | 20 | 20343 | 9629406fccc021d4e7b1a6ceee76bdf0bff691292d6c84741922f74ef0ff5abb |
| maslow-second-meet-transcript | 191 | 140 | 120328 | c28eabb758e34e0adea625986ef0ab38018dd1321d77fdd013ed521eef8efd95 |
| maslow-first-meet-transcript | 172 | 111 | 99214 | 7d790138b5c761f28cdada034c3529a1d4d8897531b831396ff775a71de7db82 |

[VERIFIED] Two deterministic invocations per document produced deeply identical normalized documents and plans, including all chunk content and provenance. Exact chunk indexes are zero-based and sequential. The subsequent local verification recomputed every passage SHA-256 and byte length, compared file bytes to plan content, and checked plan-provided contentSha256 values. UTF-8 files contain only the historical chunk bytes, with no added newline. Runtime used: Node v22.23.2; runtime lengths are JavaScript UTF-16 code units. The historical source and toolchain are preserved; this act does not claim recovery of the historical Node executable.

## Input and historical authority

[VERIFIED] The supplied ZIP matched the required outer digest at its explicitly supplied path. No broader machine search was necessary. The matching-path record covers the supplied candidate, not an exhaustive duplicate search. All 69 internal SHA256SUMS entries pass. All 11 historical ZIP archives pass CRC verification; each nested member matches an extracted bundle member byte for byte. All four originals, canonical Markdown files, sidecars, receipts, and final operators are present and hashed. All 27 non-null expected file hashes in the bundle manifest and every input-file hash constant in the four final operators match recomputation. Normalized-content hash constants were checked against the recovered plans.

[VERIFIED] git cat-file -t returned commit for the pinned historical object. git cat-file -p identifies tree 56c3c2075e57a396898a28ecaf5050fc21e789bc and parent a9b0f60ccd0aab4596704adff170e936b58eea6e. Module bytes were obtained exclusively with git show <pinned-commit>:<path>; blob IDs, SHA-256, byte length, direct imports, and recovery reasons are in historical_modules.json. A later local check compared every materialized module to Git object bytes again and independently recomputed the Git blob SHA-1 framing. Current worktree module bytes were never used as historical authority.

[VERIFIED] package.json, package-lock.json, and tsconfig.json exist at the pinned commit and were preserved exactly. npm-shrinkwrap.json, pnpm-lock.yaml, and yarn.lock were absent at that commit and were not fabricated. The broader operator import closure, including orchestration, transport and persistence dependencies, is preserved as evidence. The reproducer imports only the exact adapter/build-plan dependency path; original operators, network orchestration, retrieval, and provider runtimes were never executed or imported.

[VERIFIED] The new deterministic_specifications.mjs copies only selected constants, locator helpers, document metadata, normalization/plan construction, and deterministic assertions from the four operators. reproducer_source_mapping.json records operator hashes and copied line boundaries. The original operators are unchanged archived evidence. globalThis.fetch throws before any deterministic module is imported; its attempt counter is zero. No fetch, remote Git, provider, database, payment, or deployment command was issued.

[VERIFIED] Offline receipt fields were compared to recomputed block/chunk/character counts, normalized hashes, chunk configuration and bounds, canonical hashes, and available provenance counts. For both DOCX originals, the designated Word paragraph was extracted locally and its raw transcript SHA-256 and character count matched the receipt. The PPSX contains 21 source slide XML parts. Presentation receipt allBlocksBoundToSlides=false describes the earlier canonicalization stage; the final operator adds slide provenance to every block, and the final reproduced plan passes those assertions. This preserved stage difference is not a content reproduction mismatch.

## Open benchmark binding and blindness

[VERIFIED] The public manifest was read at product baseline cd3743232c235d228fce1c2d9bf816d3d1e471d0. Its public digest-list identity recomputes to the controlling 5549d7f60e982697bc0bc1f3c9b410615905430138461ae543471745e96fa1f3 value. README, schema, development questions, and development gold bytes match their public manifest hashes. Protected members were neither read nor hashed by this act. Identity recomputation uses the public manifest's digest declarations for protected members and does not independently attest their content bytes.

[VERIFIED] Only open DEVELOPMENT gold records were parsed for binding. References were gathered recursively, including acceptableAlternativeEvidence, without exporting question text or answer semantics into the identity projection. For each identity, the frozen explicit chunkIndex selects a reproduced passage, and every frozen locator field must match the historical primary locator or chunk headingPath. All 22 occurrences match. ChunkId/documentId values are copied only from these explicit frozen open records. The forensic manifest assigns IDs only to the 16 passages explicitly bound by those records; other rows remain null. There are no open development references to the first-meet document in these four targets. No QA source was processed, and B2 remains closed.

[UNKNOWN] Completeness of all FROZEN123 protected database identities is reserved for the independent IV. No holdout or adversarial gold/question member was read. Public README/manifest text was inspected as open metadata; no protected file semantics were decoded or exported. The later IV must assess the minimum authorized protected identity/locator projection.

## Packaging finding and lineage

[VERIFIED] One minor generated-metadata anomaly: bundle_manifest.json records README_FOR_REUPLOAD.md SHA-256 6473b88f378788c49441259b01d46afecaf75b47bc409f7ba6aaf2c556f4878a and 1,245 bytes; actual bytes are SHA-256 05b856a51517d0d4720edf9a2e8d85facc7ffecc71794fcfd526f8b6834dcfa8 and 1,219 bytes. The internal SHA256SUMS correctly authenticates the actual README. Its expected_sha256 is null and classification is GENERATED_EXPORT_METADATA. All primary expected hashes match. The anomaly was recorded, with no archived byte changed.

[VERIFIED] Both 297-chunk predecessor archives and the predecessor verification transcript are preserved as supporting lineage. Their recorded normalized identity 4dab28bbef2cde30552ed1c4600cc7e0185d5169c9998365317417e45f9206a0 was not substituted for the final 283-chunk manuscript. The predecessor was not executed.

## Artifacts and author self-audit

Evidence root: `/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure/NAVIGATOR_BOUNDED_REASONING_RAG_1_POST_RECONCILIATION_TESTING_1_MASLOW_NON_QA_HISTORICAL_B1_RECOVERY_1`

Key artifacts: forensic_manifest_554.jsonl, passages/, historical_modules.json, historical_git/, historical_toolchain.json, bundle_verification.json, primary_verification.json, reproducer_source_mapping.json, reproduction_results.json, reproduction/, open_development_identity_projection.json, benchmark_open_access_receipt.json, database_identity_completeness.json, final_verification_receipt.json, required_final_fields.json, SHA256SUMS, and output_inventory.json. Input archive bytes were safely extracted under input/ and never altered. The report and report SHA-256 sidecar are the expressly authorized exceptions outside the evidence root. No temporary utility was created under /private/tmp/nbrr1_b1_recovery/ or elsewhere.

Executable author utilities: forensic_reproducer.mjs, deterministic_specifications.mjs, bind_open_development.py, verify_recovery.py. The verification utility initially encountered a Python source-encoding error before running; an explicit UTF-8 encoding header corrected it. The original utility bytes are preserved in verify_recovery.py.before-encoding-fix. This was a utility syntax correction, not a historical reproduction adjustment.

Executed validation commands and actual outcomes:

```text
node --experimental-strip-types <evidence-root>/forensic_reproducer.mjs
exit 0: PASS: 554 exact passages and hashes; networkAttempts=0
python3 <evidence-root>/bind_open_development.py
exit 0: openUniqueIdentitiesFound=16, openUniqueIdentitiesBound=16,
        openReferenceOccurrences=22, manifestRows=554, protectedMembersRead=0
python3 <evidence-root>/verify_recovery.py
initial exit 1: source encoding declaration required
final exit 0: status=PASS, historicalModulesReverified=18,
              toolchainFilesReverified=3, passageBytesAndHashesReverified=554,
              independentIV=false
```

The SHA256SUMS ledger excludes itself to avoid recursion. output_inventory.json lists evidence files before the final ledger and contains the approved report/sidecar paths. The final checksum sealing receipt is separate from the ledger to avoid self-reference.

<audit>
FILES WRITTEN: all paths listed by output_inventory.json, plus SHA256SUMS and checksum_sealing_receipt.json inside the evidence root; this report and its .sha256 sidecar outside it.
COMMANDS RUN: local read-only Git object inspection, local Python extraction/hash/recovery utilities, and the three validation commands shown above; successful recovery/validation commands exited 0. The single corrected Python source-encoding attempt exited 1.
CLAIMS MADE WITHOUT EVIDENCE: none.
UNVERIFIED ASSUMPTIONS STILL LIVE: protected database identity completeness and independent IV acceptance are UNKNOWN, not assumed.
NEXT VERIFICATION THE OPERATOR SHOULD RUN: the separately authorized independent IV act NAVIGATOR-BOUNDED-REASONING-RAG-1.POST-RECONCILIATION-TESTING-1.MASLOW-NON-QA-HISTORICAL-B1-RECOVERY-1.IV1; it was not started here.
</audit>

[VERIFIED] This act stops after historical recovery, offline reproduction, exact passage materialization, open binding, report, and checksums. No runner/scorer implementation, full123/full924 execution, successor authority, or independent IV was started.
