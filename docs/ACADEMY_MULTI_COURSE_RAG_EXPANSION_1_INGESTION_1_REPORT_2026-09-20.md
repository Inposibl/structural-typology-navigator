# ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.INGESTION-1

VERDICT: PASS

Execution date: `2026-09-20`

## 1. Environment gate

- [VERIFIED] The corrected `.env.local` resolves to Supabase project `mgtghkxebccahtqqyyjv`, supplies an `sb_secret_`-format secret, and supplies a valid-length Cohere credential. No values were printed.
- [VERIFIED] The first resumed invocation inherited and therefore retained a stale shell credential despite `--env-file`; it received HTTP `401` before any successful document.
- [VERIFIED] The corrected invocation explicitly removed inherited credential variables and loaded `.env.local`; authenticated production work then proceeded.

## 2. Git baseline

- [VERIFIED] Repository: `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator`.
- [VERIFIED] Branch: `navigator-production-dialogue-corr2-ab-normalization`.
- [VERIFIED] `HEAD`, local `origin/main`, and remote `main`: `3e12b290b9cc10d8fb0b92c6dd8d967190b797b9`.
- [VERIFIED] Ahead/behind: `0 / 0`; initial tracked drift and staged paths: none.

## 3. Validation

- [VERIFIED] `npm run validate` exited `0`: typecheck passed, tests `546/546`, lint passed, and build passed.

## 4. Canonical / authority identity gate

- [VERIFIED] Canonicalization closure SHA-256: `f9366f11fec9b0b498d0cb564a06942eb0b1301c9214f4ea3a5ee13f428b7ad6`.
- [VERIFIED] Authority-map SHA-256: `5d8ca79e4afa3fa2a22b51221380e04e9fce2be2f72fc3fff9b2cc41ef863078`.
- [VERIFIED] Frozen manifest SHA-256: `d90509cf1be8389fafa5eb4d720ae2286f8ecf403822d27ac45e62d22efcb628`.
- [VERIFIED] Canonical Markdown `20/20` and unique provenance originals `19/19` matched their frozen hashes.
- [VERIFIED] Course-page identities: `Levels-of-Consciousness.md` `a9852ba6856a243f66ac59641933b6371f2efef5a6007d43e46dc471a9482e37`; `Play-and-Creativity.md` `4cc16361ebdc210fb0e6619ea8c6c5fb2c17300dc32af964d462469b111150d7`; `Normative-Situation.md` `ee93e31587090a0104141e2590bd8e36a2f86e9d28bf3ace21db1a3f8d54e371`; `Structural-Typology.md` `d8b58a7c0448d169f3d51f959528a888ade5255697062fe967f06c1d6f2282b7`.

## 5. Live read-only preflight

- [VERIFIED] Owner-resumed preflight exited `0`: planned sources `13`, documents `24`, chunks `1533`; existing target sources/documents `0/0`; target active bindings `0`.
- [VERIFIED] PRELIVE Maslow: `5` active bindings, `5` ready canonical documents, `591` embedded canonical chunks.
- [VERIFIED] PRELIVE synthetic smoke: one source, unbound, non-authoritative.

## 6. Exact 13-source / 24-document plan

- [VERIFIED] Planned course totals: normative `2 sources / 2 documents / 111 chunks`; play `3/3/110`; levels `4/4/201`; professional development `2/2/125`; structural typology `2/13/986`.
- [VERIFIED] `structural-typology-book` has exactly `12` planned chapter documents under one source.

## 7. Production execution

- [VERIFIED] More than 90 seconds elapsed after the prior 429. The minimal gate reconfirmed `ST_07` at `113` chunks / `0` embeddings, verified Storage bytes, zero target bindings, Maslow `5/5/591`, and an unbound/non-authoritative smoke source.
- [VERIFIED] `ST_07` then finalized at `113/113` embedded chunks, followed by `ST_08` at `40/40`.
- [VERIFIED] The separately authorized rate-limit diagnostic classified the prior failures as an upstream transient limit and proved no batching or concurrency defect. The Owner then reported replacing the prior Trial key in `.env.local` and authorized this continuation.
- [VERIFIED] Before mutation, the isolated read-only gate reconfirmed the `ST_09_12` document UUID `cc56f4f1-c9f9-4532-8ccb-091680f7eed4`, source UUID `3bb46dde-10f9-4bf7-bf5b-e444074a6b46`, `processing` status, `307` persisted chunks, `0` embeddings, matching chunk identities, verified Storage bytes, zero target bindings, Maslow `5/5/591`, and unchanged synthetic smoke.
- [VERIFIED] The exact isolated production invocation loaded `.env.local`, idempotently revalidated the 19 ready documents, and reached `ST_09_12` in frozen order.
- [VERIFIED] Cohere again returned HTTP `429` on `ST_09_12`. The operator stopped immediately with exit code `2`; `ST_13`, `ST_14`, `ST_15`, and `Structural-Typology.md` were not started.
- [UNKNOWN] Attempt count, parsed `retryAfterMs`, and raw safe response metadata are unavailable because the accepted operator failure receipt records only error name, message, code, and HTTP status.
- [VERIFIED] The Owner subsequently reported replacing that credential with a paid Production key and authorized one further continuation. The repeated minimal gate returned the same preserved state.
- [VERIFIED] The isolated production invocation then completed `ST_09_12` (`307` chunks), `ST_13` (`57`), `ST_14` (`73`), `ST_15` (`31`), and `Structural-Typology.md` (`12`) serially. The operator exited `0` with verdict `PASS` and `failure: null`.

## 8. Source/document/chunk results

| Course / document | Source UUID | Document UUID | Ready chunks |
|---|---|---|---:|
| normative / `NormaSituations_CANONICAL.md` | `37f12740-d7d6-4dca-9720-9070fd48c48a` | `246cd5bf-7a2f-4f3d-9b4d-3138c669b9b0` | 103 |
| normative / `Normative-Situation.md` | `d910ec8f-e90b-40e9-8ec5-91b5f8b046a4` | `8c5eb793-ddab-4c80-a945-793ecfcb571a` | 8 |
| play / `Arts_like_methodology_CANONICAL.md` | `432cfcb6-c295-449d-849d-3dfa1b2718b5` | `29454f75-283c-4ad0-8c8c-4ee6e167c66a` | 68 |
| play / `MethodologyOfLeadersContemplates_CANONICAL.md` | `d4943a02-7c6d-4077-91d2-e0b4ca43d342` | `33b786ec-f8d8-436c-a218-1eae92283eca` | 37 |
| play / `Play-and-Creativity.md` | `9c13b5d9-8306-478a-b257-421623919d07` | `93fa5e83-8904-4a47-92f5-a297ef041d18` | 5 |
| levels / `LevelOfCons_Protections_of_Perception_CANONICAL.md` | `119643da-5961-4fee-9e71-297f7ad83f9f` | `73cdcbfa-e539-404c-a17e-190a4505816d` | 28 |
| levels / `Levels_of_Consciousness_FOUNDATIONAL_CANONICAL.md` | `83611f83-9787-44ed-8b43-6827ac0b7615` | `3fe3c262-4f80-478b-bfb8-b4a90dde5ffe` | 75 |
| levels / `Levels-of-Consciousness.md` | `3d49cb21-df35-42a0-8827-717935f2d35e` | `95db6f87-bf83-4d24-838c-b4a642014f57` | 6 |
| levels / `LevelsOfConsciousness_Transcript_CANONICAL.md` | `a9eb75d0-6f21-458a-8200-00fa9dd1e1b5` | `bbc34417-b81e-4c2c-97b3-9a095e4f4a6e` | 92 |
| professional / `Stages_of_Professionalization_Presentation_CANONICAL.md` | `9a68241f-af80-4b87-95eb-8f8cf58b9fb5` | `09b593c7-50ee-4778-be5a-a54c250d285c` | 9 |
| professional / `StagesOfProfessionalization_CANONICAL.md` | `d4095ee3-6c79-4bdb-be1e-5269f59809f2` | `98d080ea-81f8-4f90-b8f6-e4b76b175e10` | 116 |
| structural / `ST_01_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `280de37d-5a83-414a-9cf8-d2c216e64622` | 39 |
| structural / `ST_02_Stages_of_Development_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `9800d671-de61-4522-a3f9-a710530ed5db` | 45 |
| structural / `ST_03_Levels_of_Consciousness_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `86abbb19-76f6-42e9-8c91-b310644b2a53` | 75 |
| structural / `ST_04_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `d5e513e0-3d94-43a5-896f-f1a1c3442aa2` | 72 |
| structural / `ST_05_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `6662977f-c490-4d9b-be45-f540e554edd8` | 68 |
| structural / `ST_06_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `48ea5a08-ef95-4a9c-89e6-3dcc690e3df4` | 54 |
| structural / `ST_07_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `360c1121-ab1c-4cf6-b148-5cbe5b507fea` | 113 |
| structural / `ST_08_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `870ff16c-1aba-49fe-bbc5-16961dda20e2` | 40 |
| structural / `ST_09_12_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `cc56f4f1-c9f9-4532-8ccb-091680f7eed4` | 307 |
| structural / `ST_13_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `33792332-fb67-42a9-aba6-39108ebe90cb` | 57 |
| structural / `ST_14_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `d4b78ebe-e0bf-486b-8486-e8b8f5a6020f` | 73 |
| structural / `ST_15_CANONICAL.md` | `3bb46dde-10f9-4bf7-bf5b-e444074a6b46` | `c09c77ca-2fb9-410b-835c-e733545cb3c0` | 31 |
| structural / `Structural-Typology.md` | `826de4c7-f919-413a-aa1d-d15b7d7c3653` | `6520088b-f78b-449b-81bb-c63abe0e6a2a` | 12 |

- [VERIFIED] Final reconciliation: `13/13` intended source rows, `24/24` intended documents ready, `1533/1533` deterministic chunks persisted, and `1533/1533` chunks embedded.
- [VERIFIED] `structural-typology-book` remains one source (`3bb46dde-10f9-4bf7-bf5b-e444074a6b46`) with exactly `12/12` ready chapter documents.

## 9. Storage verification

- [VERIFIED] All `24/24` document originals are present and byte-verified in bucket `academy-knowledge`; receipt total is `12,990,014` bytes.
- [VERIFIED] `ST_09_12` retained its verified original: SHA-256 `f68140fbc6c571d532345885583e007f285bae41a4313507ef4ded8815a1041b`, `1,321,940` bytes.
- [VERIFIED] No Storage object was overwritten or deleted.

## 10. Embedding verification

- [VERIFIED] All `24/24` documents use `cohere/embed-v4.0@1024`; all `1533/1533` chunks have stored embeddings and every stored vector has exactly `1024` dimensions.

## 11. Binding-zero proof

- [VERIFIED] Target active bindings PRELIVE `0`, POSTLIVE `0`, delta `0`; professional-development-stages active bindings `0`.

## 12. Course retrieval-zero proof

- [VERIFIED] No course binding was created.
- [VERIFIED] Course-scoped retrieval returned `0` matches for each of: `levels-of-consciousness`, `play-and-creativity`, `normative-situation`, `professional-development-stages`, and `structural-typology`.

## 13. professional-development-stages LISTED_UNROUTABLE proof

- [VERIFIED] Catalog state remains `LISTED_UNROUTABLE`; active bindings remain `0`; no routing or catalog code changed.

## 14. Maslow non-regression

- [VERIFIED] PRELIVE and POSTLIVE both show `5` active bindings, `5` ready canonical documents, and `591` embedded canonical chunks.

## 15. Synthetic-smoke non-regression

- [VERIFIED] POSTLIVE synthetic smoke remains unbound and non-authoritative.

## 16. Generic retrieval verification

- [VERIFIED] Generic retrieval returned `10` matches, all restricted to intended documents. Returned document UUIDs were `8c5eb793-ddab-4c80-a945-793ecfcb571a`, `246cd5bf-7a2f-4f3d-9b4d-3138c669b9b0`, `86abbb19-76f6-42e9-8c91-b310644b2a53`, `33792332-fb67-42a9-aba6-39108ebe90cb`, and `bbc34417-b81e-4c2c-97b3-9a095e4f4a6e`.

## 17. Evidence artifacts and SHA-256

Evidence root: `/Users/entp_psyche/Desktop/Academy Texts Corpus/_RAG_INGESTION/ACADEMY_MULTI_COURSE_RAG_EXPANSION_1_INGESTION_1/`

| Artifact | SHA-256 |
|---|---|
| `INGESTION_PLAN.json` | `58bf808bc2009ec4fdb0d11845e80367b0db382e18cb26dfabe11e42447a12c8` |
| `PRELIVE_STATE.json` | `98e7ea720a0594216100fa483b4e35ef36df426d4be045491eeb85a7b6dcd15b` |
| `POSTLIVE_STATE.json` | `d11222caca4992a1496eb159983dd3888710f5ddfb67f0fe1688bbcdb21e16de` |
| `SOURCE_DOCUMENT_RECEIPTS.json` | `ab51bc31ff7c3fcc24a5517ff58d2978feb463d526a80087fb3f992ca45fc720` |
| `STORAGE_RECEIPTS.json` | `85392d32f6aefa8fd8f9e063eabdfe13e157516de7fc09d1abf8ea7fe150ee0e` |
| `EMBEDDING_RECEIPTS.json` | `6db1c3cca61d6805d2aafb75a5dc06363018c50ef269d5ab00a9a1107c84f3ab` |
| `COURSE_VERIFICATION.json` | `4b1f1a63b4eb79b1759b7447fd0b61648b3ba15aae37a39517de72ff137871bc` |
| `MASLOW_NON_REGRESSION.json` | `8424025e17877d2b91680c055554d68e5d33b894e0c4ce16162d9beb4ed5f7bd` |
| `BINDING_ZERO_PROOF.json` | `6f5474b560ebb7910eacff896c48f4a82215e97fdc0dc56c2a4b72c8cc6f999c` |

## 18. Repository report path and SHA-256

- [VERIFIED] Report path: `docs/ACADEMY_MULTI_COURSE_RAG_EXPANSION_1_INGESTION_1_REPORT_2026-09-20.md`.
- [VERIFIED] Final report SHA-256 is calculated after finalization and returned in the execution response.

## 19. Final git status

- [VERIFIED] `git diff --check` exited `0`; staged paths, tracked code changes, SQL changes, migration changes, schema changes, and routing changes are empty.
- [VERIFIED] The only INGESTION-1-attributable repository path is this untracked report; the separately authorized diagnostic report and four known unrelated untracked governance inputs remain untouched.

## 20. Final state and stopping point

- [VERIFIED] Operator POSTLIVE verdict is `PASS` with `failure: null`.
- [VERIFIED] All INGESTION-1 pass conditions are satisfied. No IV1 execution or course binding was performed.
- [VERIFIED] The next governance act is `ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.INGESTION-1.IV1`, to be performed by an independent auditor under separate authorization.

Final verdict: **PASS**
