# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR2.TEST-COVERAGE-CLOSURE-1.IV3

**Date:** 2026-09-24T14:41:37Z
**Auditor:** Claude Opus 5.5. Role: independent read-only test-coverage closure auditor.
**Author under audit:** Gemini 3.8. The author did not audit this act.
**Act audited:** `docs/reports/…IMPLEMENTATION_1_CORR2_TEST_COVERAGE_CLOSURE_1_20260924T142318Z.md`
**Controlling prior audit:** `…IMPLEMENTATION_1_CORR1_IV2_20260924T133119Z.md`. Its verdict was FAIL, with one MAJOR finding: F-6, ORIGINAL_53 NOT_TESTED = 8.

The auditor made no edits to source, tests, or config, and no database writes. There was no SSH access, no Telegram send, and no live PII. The auditor ran no git add, commit, or push.

The only live access was read-only. Two Supabase REST GET probes, run 16 minutes apart, printed only HTTP status codes, row counts, a course id, and timestamps. No keys, no subject_key, and no PII were printed.

---

## 0. TERMINAL SUMMARY

```text
VERDICT: PASS
BLOCKING: 0   MAJOR: 0   MINOR: 7 (6 deferred and preserved, plus 1 new test-design minor)
ORIGINAL_53: PASS=53 FAIL=0 NOT_TESTED=0
PRODUCT_SOURCE_DELTA: 0
Live-1: EXTERNAL_ENVIRONMENT_DRIFT, NOT_CORR2_REGRESSION (§8 A–F all proven)
```

---

## 1. PHYSICAL CHANGE SET

The reference point is the IV2 report (mtime 10:33:04 local, ctime 10:35:36 local). Two independent scans were run against it:

- **mtime scan.** Files newer than IV2:
  - Navigator: `tests/tikhon-miniapp/batch-5-submission.test.mts` (11:12:06) and the CORR2 report (11:25:24). `tsconfig.tsbuildinfo` also changed but is git-ignored.
  - Chatbot: `tests/test_batch5_submission.py` (11:04:53).
- **ctime scan** (`find -cnewer`). ctime cannot be forged without root. The scan found the same two test files, the CORR2 report, the IV2 report itself, and `tsconfig.tsbuildinfo` (ignored). In the chatbot it also found:
  - `ast_bot.db` and `data_engine/outreach_history.db`, both at ctime 14:20:43Z.
  - For both files, mtime, atime, and size are unchanged, and there is no `-journal`, `-wal`, or `-shm` file. Both carry the xattr `com.apple.provenance`.
  - This is a **metadata-only** change, not a content write. It is recorded as advisory ADV-1.

Other evidence:
- `chatbot/api_service.py` is **byte-identical** (`cmp`) to the auditor's own IV2-time copy at `/tmp/iv2_baseline/api_service.py`.
- Status counts: Navigator went from 66 to 68 (the CORR2 report and one test file are new relative to IV2 counting). Chatbot stayed at 150.
- `.git/index` is unchanged in both repositories. Navigator's index was last written 2026-09-24 00:07:52 and the chatbot's 2026-09-23 17:12:30, so nothing was staged.

**PRODUCT_SOURCE_DELTA = 0 bytes.** No product file has a ctime or mtime after IV2. That covers all of the following:
- `route.ts` (both tikhon routes)
- `api_service.py`, `database.py`, `delivery_service.py`, `main.py`, `config.py`, `calendar_service.py`, `application_formatter.py`, `handlers/client.py`
- `projection_service.py`
- all `src/app/tikhon-miniapp-pilot/*.ts[x]` and CSS files
- all `data_engine/*.py`
- `package.json`, `eslint.config.mjs`, `tsconfig.json`, `next.config.ts`

The only paths that changed are exactly the ones authorized: the two test files plus the CORR2 report.

---

## 2. THE 8 PREVIOUS GAPS

The actual assertions were inspected. Test names were not accepted as evidence.

| # | Test | What the assertions actually prove | Result |
|---|---|---|---|
| 10 | C `TestCorr2LegalEntityPersistence.test_case_10_corr2_doc_email_persisted` | A legal entity is submitted through the real aiohttp receiver, HMAC-signed and returning 200. The `Application` row is reloaded by id. The test asserts `entity_type == "legal_entity"` and `app.doc_email == "buh_corr2_10@example.invalid"`, an exact match on the dedicated column. | **PASS** |
| 11 | C `…test_case_11_corr2_contact_person_persisted` | Same path. Asserts `app.contact_person == "Контактное Лицо Корр2-11"` exactly. | **PASS** |
| 16 | C `TestCase16ScheduleOverride.test_case_16_schedule_override_blocked` | The payload injects `cohort_schedule: "ВЗЛОМАННОЕ РАСПИСАНИЕ"` and the response is 200. The persisted `cohort_schedule` equals the registry value. The injected string is absent from every row attribute. Exactly 2 cards are sent, and each contains the canonical schedule and not the injected value. | **PASS** |
| 31 | C `TestCase30ConcurrentDuplicate.test_case_31_different_course_allowed` | Same `user_id` and email. The first submission is `structural_typology/cohort_5/level_1` and the second is `maslow/cohort_1/single_payment`. The test asserts both courses exist and are in `APPROVED_PAYMENT_PRODUCT_IDS`. Both return 200 with different ids. The reloaded rows have the correct `course_id`, distinct `active_application_key` values, and each key contains its own course. The false "single course" comment has been removed. | **PASS** |
| 43 | N `11.2: CORR2 #43 — synthetic bot token absent from built client bundle` | The test runs a real in-process `next build` with a random synthetic token, `999001462:AA<24 hex>`, set in both `TELEGRAM_BOT_TOKEN` and `BOT_TOKEN`. It then scans every file under `.next/static` and `.next/server/app`: at least one file is scanned, and there are 0 hits. It also enforces a source boundary: the 6 client modules contain no `process.env` and no bot-token env names. The auditor also re-checked `.next/static` after the auditor's own build and found it clean. | **PASS** |
| 44 | N `11.1: CORR2 #44 — raw S2S secret never transmitted on the outbound Navigator fetch` | A random secret marker and a capturing `fetch` stub are used, and the request goes through the real route `POST`. The test asserts exactly one fetch. The marker is absent from the URL, from every header name and value, and from the body. The captured signature is re-verified against the canonical `TIKHON-S2S-V1` string with an exact hex match. | **PASS** |
| 46 | C `TestCase46PIIAbsentFromLogs.test_case_46_pii_absent_from_logs` | First-party loggers are explicitly set to **INFO** and restored in `finally`. Three scenarios run through the real receiver: an individual success, a legal-entity success, and a double failure that ends in UNKNOWN with a 502. The test first proves logging was not suppressed: at least 2 INFO `application_processed` records and at least 2 ERROR `delivery_telegram_error` records. It then asserts all 11 PII markers are absent, along with raw body, raw initData, both recipient chat ids, raw exception text, the secret, and `8807727029`. | **PASS** |
| 47 | N `11.4` for legal entity; N `11.3` for individual | **11.4** imports the real `LegalEntityFlow` using a CSS-module loader stub written to a temp directory outside the repo, and renders it with `renderToStaticMarkup`. In the `submitting` state, the button matches `/<button[^>]*disabled[^>]*>\s*Оформить заявку<\/button>/`. In the `idle` state with a valid draft, there is no `disabled` anywhere. **11.3** brace-matches the actual `disabled={…}` expression bound to the `Оформить заявку` button in the `individual_confirmation` branch of `page.tsx`. It asserts the expression depends on both `individualDraft` and `submissionState`, then evaluates it: `submitting` gives true; `idle`, `success`, and `error` give false; a null draft gives true. The test itself documents that this is expression-level rather than a DOM render. Because it reads the live production expression, any change to that expression breaks the test. | **PASS** (ADV-2) |

---

## 3. ORIGINAL 53 MATRIX

The author's §6 mapping was checked row by row against the assertions: the 45 rows that were PASS at IV2 plus the 8 new rows above.

- The 45 IV2-PASS mappings are unchanged. Their tests still exist and still pass.
- #32 is now served by the isolated tier test `test_case_32b_different_tier_same_course_isolated`: same user, identity, course, and cohort, with level_1 versus level_2, giving distinct ids and keys. This preserves the evidence that IV2 had credited to the old test.
- #13 remains B4 `7: OGRN / OGRNIP is not collected`.

**The author's matrix is accurate. ORIGINAL_53: PASS=53, FAIL=0, NOT_TESTED=0.** Extra, accurately relabeled tests are `test_case_32b`, `43b`, `44b`, and `47b`. The Batch-5 test-function counts are chatbot 58 and Navigator 42.

---

## 4. MECHANICAL GATES

| Gate | Result |
|---|---|
| Chatbot `unittest tests/test_batch5_submission.py -v`, 3 runs | Ran 58, OK in each run. No variation. |
| Navigator `batch-5-submission.test.mts`, 3 runs | tests 42, pass 42, fail 0 in each run. No variation. |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run lint` | exit 1 with 10 problems (9 errors, 1 warning): `student-status/route.ts`, `page.tsx`, `batch-1-corr1-entitlements.test.mts`. These are the same files and rules as at IV1 and IV2, and all are PRE_EXISTING. **CORR2 delta = 0.** |
| Targeted ESLint `--max-warnings=0` on `batch-5-submission.test.mts` | exit 0 |
| `git diff --check`, Navigator and chatbot | exit 0 and exit 0 |
| `py_compile tests/test_batch5_submission.py` | OK |
| Chatbot full `discover` | Ran 229, FAILED (failures=2). Both failures are the known PRE_EXISTING tests `test_cohort_limits…test_keyboard_rendering_with_availability` and `test_welcome_flow…test_client_start_welcome_text_contains_tikhon`. They were attributed in IV1 and IV2 by reverting to baseline. Their test files are unchanged since 09-22, and so are the product files they read. **No new failure.** |
| Navigator full `tests/tikhon-miniapp/*.test.mts`, 3 runs | Run 1: 156 tests, 154 pass, 2 fail (Live 1, plus a transient in `batch-1-catalog-cohort` A). Runs 2 and 3: 156 tests, 155 pass, 1 fail (Live 1 only). |

**Transient in `batch-1-catalog-cohort` "A".** The failure was `/api/tikhon/courses` returning 503. That is the route's `catch` path around a **live Supabase GET** of `tikhon_public_projection`. The test passed 3 of 3 times when run alone and passed in 2 of 2 subsequent full runs. Neither the route nor the test file was touched by CORR2: their mtime and ctime date from 09-23. The failure is classified as a transient external network read, not a regression. See M-1 for a related test-design note.

---

## 5. NAVIGATOR LIVE-1 ATTRIBUTION (§8 of the act)

| Condition | Evidence | Status |
|---|---|---|
| A. Reproduces alone | `batch-1-corr1-entitlements.test.mts` run alone twice: tests 22, pass 21, fail 1 (`Live 1`, "Must contain structural_typology entitlement record") both times. | PROVEN |
| B. No CORR2 test code runs in that isolated run | The TAP output of the isolated run contains only the `TIKHON-MINIAPP BATCH 1 CORR1` suite. That file does not import `batch-5-submission.test.mts`, and nothing from the chatbot runs. | PROVEN |
| C. Relevant Batch-1 and product source unmodified by CORR2 | `batch-1-corr1-entitlements.test.mts` (mtime and ctime 09-23 16:43:38), `student-status/route.ts` (09-23 16:42:52), and `.env.local` (09-23 16:38:09) are all untouched. PRODUCT_SOURCE_DELTA = 0. | PROVEN |
| D. Read-only live evidence shows the row is absent | GET `tikhon_private_entitlements?subject_key=eq.<derived for telegram:8807727029>` returned **HTTP 200 with 0 rows**. The table itself exists and holds 6 rows (`Content-Range 0-0/6`). | PROVEN |
| E. Every other Navigator regression passes | All 155 other tests pass in runs 2 and 3. The single transient in run 1 did not reproduce (§4). | PROVEN |
| F. No other new regression | The chatbot run has no new failure. Build, typecheck, and lint delta are all clean. | PROVEN |

**Provenance.** The table is regenerated by `chatbot/projection_service.push_private_entitlements_to_supabase`. That function performs a full generation reconciliation: it upserts the current generation and deletes all other generations. When there are zero paid rows, it deletes every row.

Two probes, taken 16 minutes apart, show pushes at **14:25:25Z** (`tikhon_public_projection.projected_at`, with entitlements `updated_at` 14:25:26Z) and **14:40:27Z**. That is a **15-minute cadence** from an always-on writer. No local bot or projection process is running (`ps`). The pattern is consistent with the production `start_projection_scheduler(interval_sec=900)`.

Each generation omits the legacy subject. The 14:25 push landing within about 2 s of the CORR2 report's mtime is explained by this cadence. It is not caused by CORR2.

Static inspection also shows that no chatbot test can reach live Supabase:
- Every projection and entitlement test patches `projection_service.settings` to `mock.supabase.co` and patches `aiohttp.ClientSession`, or else patches `trigger_projection_sync` or `push_projection_to_supabase`.
- The Navigator only **reads** this table.

**LIVE_ENTITLEMENT_FINDING = EXTERNAL_ENVIRONMENT_DRIFT, NOT_CORR2_REGRESSION.**

**Owner note.** The live table is rewritten about every 15 minutes by an external writer, most likely the production VPS scheduler. Restoring the row by hand would be overwritten within one cycle. The fix is at the source: either the production DB's `paid` legacy application for this subject, or the production `ENTITLEMENT_SUBJECT_SECRET` if it differs from the Navigator's. It is unknown what changed between IV2's green run (about 13:15Z) and CORR2 (about 14:10Z). Finding that out needs Owner-level production inspection, which this act did not perform. Nothing was restored or mutated.

---

## 6. PREVIOUS PRODUCT CLOSURES

F1, F2, F3, F4, F5, F7, F8, F9, F12, and F13 were verified behaviorally in IV2. Their product code has **no CORR2 delta** (§1), so they remain PASS.

## 7. OWNER INVARIANTS: preserved

The files that hold these values are unchanged since IV2 (§1):
- `@Lebedev_AST` / `8807727029`
- Бухгалтерия АСТ `-1003990047416`, which is `operator_chat_id`; local `.env` is untouched
- the verbatim success copy
- `Введение в теорию` / `Основной курс` / `Экспертный уровень`
- 50 000 / 100 000 / 50 000, and 160 000 / 200 000 / 20 %
- `Физлицо (СБП/перевод)`

The asserting tests all pass: C `test_case_01/02/04/23` and N `1.1/1.2/5.5`.

## 8. GOOGLE / PAYMENT
- **GOOGLE_NON_REGRESSION = PASS.** No `data_engine/*.py` file or Google path changed. `outreach_history.db` had only a metadata ctime change (ADV-1). `test_sheets_sync.py` and `test_schedule_sheets_sync.py` pass in the full run.
- **PAYMENT_SCOPE = PASS.** CORR2 is test-only, so no payment logic was introduced.

## 9. DEFERRED MINORS

N-2, N-3, F-10, F-11, F-14, and F-16 are all **PRESERVED**, since product code is unchanged.

---

## 10. FINDINGS

**BLOCKING: none. MAJOR: none.** F-6 is closed.

**MINOR**
- **M-1 (new, test design).** Test `11.2` runs a full production `next build` inside the Batch-5 unit test. That adds about 8 seconds or more per run and rewrites the git-ignored `.next/` on every run, including builds with a synthetic-token env. Under the full-suite command, it runs in parallel with the other files, several of which do live network reads. This could disturb a developer's running `next start` or `next dev` artifacts, and it adds load and timing sensitivity. One transient live-read 503 was observed in 1 of 3 full runs. It could not be reproduced or attributed. A dedicated build-artifact check step outside `node:test` would be preferable.
- **N-2, N-3, F-10, F-11, F-14, F-16.** Deferred and PRESERVED.

**ADVISORY (not counted)**
- **ADV-1.** During the CORR2 window, at 14:20:43Z, the local `chatbot/ast_bot.db` and `data_engine/outreach_history.db` had a metadata-only change: ctime changed and the xattr `com.apple.provenance` is present. mtime, atime, and size are unchanged, and there are no journal or WAL files. There was no content write.
- **ADV-2.** #47 for the individual flow is proven at the expression level, not by a DOM render. The limitation is stated in the test. The expression is extracted from live source, so the test cannot drift from production silently.

---

## 11. RETURN BLOCK

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR2.TEST-COVERAGE-CLOSURE-1.IV3

VERDICT:
PASS

BLOCKING:
0

MAJOR:
0

MINOR:
7

REQUIREMENT_10:
PASS

REQUIREMENT_11:
PASS

REQUIREMENT_16:
PASS

REQUIREMENT_31:
PASS

REQUIREMENT_43:
PASS

REQUIREMENT_44:
PASS

REQUIREMENT_46:
PASS

REQUIREMENT_47:
PASS

ORIGINAL_53:
PASS=53
FAIL=0
NOT_TESTED=0

PRODUCT_SOURCE_DELTA:
0

CHATBOT_BATCH5:
Ran 58, OK — 3/3 runs identical

NAVIGATOR_BATCH5:
tests 42 / pass 42 / fail 0 — 3/3 runs identical

BUILD:
PASS

TYPECHECK:
PASS

FULL_LINT_DELTA:
0 (10 problems / 9 errors / 1 warning, all PRE_EXISTING, identical files/rules)

CHATBOT_REGRESSION:
Ran 229, 2 failures — both known PRE_EXISTING (test_cohort_limits…, test_welcome_flow…); no new failure

NAVIGATOR_REGRESSION:
156 tests; runs 2–3: 155 pass / 1 fail (Live 1); run 1 additionally one transient live-read 503 in
batch-1-catalog-cohort A (not reproducible: 3/3 alone, 2/2 full re-runs; untouched files)

LIVE_ENTITLEMENT_FINDING:
EXTERNAL_ENVIRONMENT_DRIFT (NOT_CORR2_REGRESSION; §8 A–F proven; live table regenerated every 15 min
by external writer; legacy subject row absent: HTTP 200, 0 rows)

GOOGLE_NON_REGRESSION:
PASS

PAYMENT_SCOPE:
PASS

DEFERRED_MINORS:
N2 = PRESERVED
N3 = PRESERVED
F10 = PRESERVED
F11 = PRESERVED
F14 = PRESERVED
F16 = PRESERVED

PRODUCTION_MUTATION:
NONE

LIVE_PII_USED:
NO

GIT_MUTATION:
NONE

NEXT:
OWNER REVIEW

STOP.
```
