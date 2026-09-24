# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR2.TEST-COVERAGE-CLOSURE-1

**Date:** 2026-09-24T14:23:18Z
**Executor:** Gemini 3.8, acting as PRIMARY TEST-CORRECTION CODER per Owner act
**Controlling audit:** `…IMPLEMENTATION_1_CORR1_IV2_20260924T133119Z.md` (verdict FAIL, 1 MAJOR F-6, 7 MINOR)
**Sole purpose of this act:** close the 8 NOT_TESTED requirements of the ORIGINAL 53 matrix (#10, #11, #16, #31, #43, #44, #46, #47) without touching any product source.

Nothing was staged, committed or pushed. No SSH, no live Telegram send, no database write. The only live access was read-only REST GET probing to attribute one pre-existing live-data test failure (§5).

---

## 0. TERMINAL SUMMARY

```text
ACT:          …IMPLEMENTATION-1.CORR2.TEST-COVERAGE-CLOSURE-1
STATUS:       PASS
ORIGINAL_53:  PASS=53  FAIL=0  NOT_TESTED=0
CHATBOT B5:   Ran 58, OK — ×3 runs, zero nondeterminism
NAVIGATOR B5: tests 42 / pass 42 / fail 0 — ×3 runs, zero nondeterminism
PRODUCT:      0 bytes changed (SHA-256 verified, 20 product files + AGENTS.md)
```

---

## 1. WORKTREE GATES (start of act)

| Repo | Branch | HEAD | Tracked dirty paths | Disposition |
|---|---|---|---|---|
| Navigator | `navigator-production-dialogue-corr2-ab-normalization` | `5f10d732…` | 6 (AGENTS.md, 4 tikhon-miniapp-pilot files, chat-contract.ts) | all belong to the still-open BATCH-5 IMPLEMENTATION-1 workstream (State B); untouched |
| Chatbot | `feat/telegram-shared-brain-integration-1` | `c7ef1cbf…` | 13 tracked + untracked residue | same active workstream; untouched |

No `git add`, no commit, no push, no stash at any point.

---

## 2. THE 8 REQUIREMENT CLOSURES (evidence)

### #10 — doc_email PERSISTED — PASS
`chatbot/tests/test_batch5_submission.py :: TestCorr2LegalEntityPersistence.test_case_10_corr2_doc_email_persisted`
Behavioral: valid legal-entity application (INN 10, all required fields, `doc_email = buh_corr2_10@example.invalid`) submitted through the actual aiohttp receiver (`create_api_app` → `POST /api/v1/applications`, HMAC-signed, nonce-protected); response 200; `Application` reloaded from the temporary SQLite DB by `app_id`; `app.doc_email` asserted **exactly equal** to the accepted submitted value (`assertIsNotNone` + `assertEqual`). Not a schema or formatter assertion.

### #11 — contact_person PERSISTED — PASS
`chatbot/tests/test_batch5_submission.py :: TestCorr2LegalEntityPersistence.test_case_11_corr2_contact_person_persisted`
Same behavioral receiver path with `contact_person = "Контактное Лицо Корр2-11"`; persisted row reloaded and the exact value asserted on `Application.contact_person`.

### #16 — SCHEDULE CANNOT BE OVERRIDDEN — PASS (test_case_16 replaced)
`chatbot/tests/test_batch5_submission.py :: TestCase16ScheduleOverride.test_case_16_schedule_override_blocked`
The old trivial `assertTrue(len(cohort.schedule) > 0)` is gone. Behavioral: submission payload carries the malicious extra client field `"cohort_schedule": "ВЗЛОМАННОЕ РАСПИСАНИЕ"`; request accepted (200); persisted `Application.cohort_schedule` asserted **exactly equal** to the canonical registry value (`get_course_by_id("structural_typology").cohorts[cohort_5].schedule` = "По воскресеньям в 18:00 МСК"); the injected value asserted absent from every stored-row value; both Telegram cards asserted to contain the canonical schedule and not the injected value. The old test's only meaningful sub-check (registry schedule non-empty, concrete value) is retained and hardened (`assertNotEqual(canonical, injected)`).

### #31 — DIFFERENT COURSE ALLOWED — PASS (test_case_31 replaced)
`chatbot/tests/test_batch5_submission.py :: TestCase30ConcurrentDuplicate.test_case_31_different_course_allowed`
The false comment ("only one course in the canonical registry") is removed. Real cross-course non-collision: same `user_id` (46311001), same payer identity (individual, same email), two **different** canonical courses from the actual registry — `structural_typology/cohort_5/level_1` and `maslow/cohort_1/single_payment`, both verified at runtime to exist and to be in `APPROVED_PAYMENT_PRODUCT_IDS`. Both 200; application ids differ; persisted rows reloaded: `course_id` values correct, `active_application_key` values differ and each contains its course id. No uniqueness collision.
Coverage attribution protection: the old mislabeled test also carried the tier-isolation evidence that IV2 used for #32; that variant is preserved as EXTRA `test_case_32b_different_tier_same_course_isolated` (same user/identity/course/cohort, level_1 vs level_2 → distinct ids and distinct active keys).

### #43 — BOT TOKEN ABSENT CLIENT-SIDE — PASS
`navigator/tests/tikhon-miniapp/batch-5-submission.test.mts :: "11.2: CORR2 #43 — synthetic bot token absent from built client bundle (behavioral build-artifact scan)"`
Behavioral build-artifact check: a distinctive **synthetic** marker token (`999001462:AA<24 random hex>`) is injected into the build environment (`TELEGRAM_BOT_TOKEN` + `BOT_TOKEN`) and a real production `next build` is executed in-test (build verified to actually run: `.next` and `.next/static` mtimes advance during the test; ~8 s in this repo). Every client-delivered artifact under `.next/static` plus prerendered HTML under `.next/server/app` is scanned: **zero occurrences** of the marker. Source dependency boundary: `page.tsx`, `legal-entity-flow.tsx`, `submission-screen.tsx`, `submission.ts`, `helpers.ts`, `legal-entity-helpers.ts` asserted free of `process.env` and of both bot-token env var names. No real token is ever printed or used.
The old chatbot receiver `bot=None` pre-send check remains as accurately-labeled EXTRA `test_case_43b_receiver_bot_none_fails_closed`.

### #44 — RAW S2S SECRET NEVER TRANSMITTED — PASS
`navigator/tests/tikhon-miniapp/batch-5-submission.test.mts :: "11.1: CORR2 #44 — raw S2S secret never transmitted on the outbound Navigator fetch (behavioral)"`
Behavioral: `TIKHON_INTERNAL_SECRET` set to a distinctive synthetic marker; `globalThis.fetch` replaced with a capturing stub; a valid individual application submitted through the actual route `POST` handler with valid initData. Captured the real outbound request and asserted: exactly one fetch; `X-Tikhon-Signature` present; the raw secret marker absent from URL, from **every** header name and value, and from the body; and the captured signature **validates** by recomputing `TIKHON-S2S-V1\nPOST\n/api/v1/applications\n{ts}\n{nonce}\n{sha256(body)}` with the injected secret (exact hex match). Env fully restored in `finally`.
The old chatbot receiver-response check remains as accurately-labeled EXTRA `test_case_44b_secret_absent_from_receiver_response`.

### #46 — PII ABSENT FROM LOGS — PASS (test_case_46 replaced)
`chatbot/tests/test_batch5_submission.py :: TestCase46PIIAbsentFromLogs.test_case_46_pii_absent_from_logs`
The invalid WARNING-level capture is fixed: first-party loggers `api_service` and `delivery_service` are set to **INFO** (production first-party level) with a record-capturing handler (original levels restored in `finally`). Three scenarios exercised through the real receiver: (S1) successful individual submission, (S2) successful legal-entity submission, (S3) controlled delivery failure where both sends raise a generic exception carrying a raw-text marker (→ UNKNOWN, HTTP 502).
Distinctive markers used: full_name, email, phone, Telegram user_id, username, INN, KPP, BIK, account, doc_email, contact_person, plus raw-body probe, raw initData probe, both recipient chat ids (curator and accounting overridden to unique values), raw exception text, and the HMAC secret.
Proof order mandated by the act is honored: first the test asserts ≥2 INFO `application_processed` records and ≥2 ERROR `delivery_telegram_error` records were actually captured (logging not suppressed), then asserts **every** marker absent from all captured first-party output (also covers the production curator chat id 8807727029).

### #47 — SUBMIT BLOCKED WHILE SUBMITTING (UI) — PASS
The DB-level SENDING-claim test remains as accurately-labeled EXTRA `test_case_47b_sending_claim_blocks_duplicate_delivery`.
Navigator UI proof, both flows:
- **Legal entity (full behavioral render)** — `navigator/…/batch-5-submission.test.mts :: "11.4: CORR2 #47 — legal_entity_confirmation CTA is disabled while submitting (behavioral render)"`. `LegalEntityFlow` is a presentational component taking `submissionState` as a prop; the test imports the real component (CSS-module loader stub registered via `module.register`, temp dir outside the repos) and renders it with `react-dom/server.renderToStaticMarkup`. With `submissionState="submitting"` the rendered HTML matches `/<button[^>]*disabled[^>]*>\s*Оформить заявку<\/button>/`; with `"idle"` and a valid draft the HTML contains no `disabled` attribute at all.
- **Individual (expression-level, limitation documented)** — `… :: "11.3: CORR2 #47 — individual confirmation CTA is disabled while submitting (page.tsx disabled expression)"`. `page.tsx` keeps `submissionState` in internal `useState`, and this lightweight `node:test` harness has no DOM renderer, so the confirmation screen cannot be reached behaviorally. The strongest deterministic proof is used: the exact `disabled={…}` expression bound to the actual `Оформить заявку` button is extracted from the `individual_confirmation` branch (brace-matched) and executed via `new Function` against each state: `submitting → true` (disabled), `idle/success/error → false`, `null draft → true`. Limitation is stated in the test itself: this evaluates the real production expression but does not click a rendered DOM button.

---

## 3. MECHANICAL GATES

| Gate | Result |
|---|---|
| Navigator `batch-5-submission.test.mts` ×3 | tests 42 / pass 42 / fail 0 — **every run** |
| Navigator `tests/tikhon-miniapp/*.test.mts` | tests 156 / suites 8 / pass 155 / fail 1 (see §5 — live-data failure outside this act; the other 152 baseline tests all pass) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (in-test build in 11.2 also exit 0 each run) |
| `npm run lint` | exit 1: **10 problems (9 errors, 1 warning)** — student-status ×2, page.tsx ×7, batch-1-corr1 ×1 warning. Identical files and rules to IV1/IV2 → **delta 0** |
| Targeted ESLint `npx eslint --max-warnings=0 tests/tikhon-miniapp/batch-5-submission.test.mts` | exit 0 |
| Navigator `git diff --check` | exit 0 |
| Chatbot `tests/test_batch5_submission.py` ×3 | Ran 58, OK — **every run** (was 55; +3 net) |
| Chatbot full `discover` | Ran 229, FAILED (failures=2): `test_cohort_limits…test_keyboard_rendering_with_availability`, `test_welcome_flow…test_client_start_welcome_text_contains_tikhon` — exactly the two known PRE_EXISTING failures from the Owner baseline and IV2 |
| Chatbot `git diff --check` | exit 0 |

Nondeterminism: Batch-5 suites ran 3× in each repo; zero variation.

---

## 4. MUTATION CHECK

SHA-256 snapshots of 21 files (20 product/config files + AGENTS.md) taken before and after the act:

- `chatbot`: api_service.py, database.py, delivery_service.py, config.py, calendar_service.py, application_formatter.py, main.py, handlers/client.py, keyboards.py — **byte-identical**
- `navigator`: helpers.ts, legal-entity-flow.tsx, miniapp.module.css, page.tsx, submission.ts, submission-screen.tsx, legal-entity-helpers.ts, chat-contract.ts, submit-application/route.ts, student-status/route.ts, AGENTS.md — **byte-identical**
- Changed files: exactly the two authorized test files
  - `chatbot/tests/test_batch5_submission.py` `5240d44a…` → `b773e227…`
  - `navigator/tests/tikhon-miniapp/batch-5-submission.test.mts` `77f218c1…` → `42508842…`
- `git diff --name-only` sets identical before/after in both repos (no additional path became dirty).
- Backups of the two test files written to /tmp only (outside both repos).
- 11.2 rewrites `.next/` (gitignored build artifacts) with the synthetic-token env; no tracked path affected.

---

## 5. OUT-OF-SCOPE LIVE-DATA FINDING (recorded, NOT fixed — §2.4)

`batch-1-corr1-entitlements.test.mts :: "Live 1: GET /api/tikhon/student-status for legacy user 8807727029…"`, part of the mandated full-suite command, now fails (`Must contain structural_typology entitlement record`).

Attribution performed:
- Fails identically when the file runs **alone** (×2) — no CORR2 test code executes in that run; the Navigator diff-name set shows no product path touched by this act.
- Read-only REST probe of `tikhon_private_entitlements?subject_key=eq.<HMAC(ENTITLEMENT_SUBJECT_SECRET, "telegram:8807727029")>` returns **HTTP 200, `[]`** — the live entitlement row the test asserts (structural_typology, `legacy_history_unverified=true`) is absent from the live database right now. `student-status/route.ts:202-220` builds `courses` from those rows, so the response has no `structural_typology` key.
- IV2 ran the same suite to 152/152 earlier today, so the live row state changed between IV2 and this act.

This is live-database state, not a product or test defect introduced here. Per the act's scope (product code and database untouchable) it is recorded for the Owner: **the legacy-subject entitlement row in live `tikhon_private_entitlements` is currently empty/absent; provenance of that change needs an Owner-level look** (possible projection/sync job run or manual table change outside this workstream). Navigator full-suite is therefore 155/156 until live state is restored, against the Owner-declared 152/152 baseline; the delta is exactly this one test.

---

## 6. ORIGINAL 53-REQUIREMENT MATRIX (controlling denominator — NOT redefined)

Key: C = `chatbot/tests/test_batch5_submission.py`; N = `navigator/tests/tikhon-miniapp/batch-5-submission.test.mts`; B4 = `navigator/tests/tikhon-miniapp/batch-4-legal-entity.test.mts`.

| # | Requirement | Exact test name | File | Result |
|---|---|---|---|---|
| 1 | individual normal submit | `TestBatch5S2SHMACAndReceiver.test_case_23_success_requires_both_delivered` (request B, first pass) | C | PASS |
| 2 | phone present | `TestBatch5ApplicationFormatter.test_case_05_html_escaping` | C | PASS |
| 3 | phone absent | `TestBatch5ApplicationFormatter.test_case_04_individual_card_structure` | C | PASS |
| 4 | exact card structure | `TestBatch5ApplicationFormatter.test_case_04_individual_card_structure` | C | PASS |
| 5 | payment-type label | `TestBatch5ApplicationFormatter.test_case_04_individual_card_structure` | C | PASS |
| 6 | legal entity | `TestBatch5S2SHMACAndReceiver.test_case_24_legal_entity_submission` | C | PASS |
| 7 | IP | `TestBatch5S2SHMACAndReceiver.test_case_25_ip_submission` | C | PASS |
| 8 | legal entity with KPP | `TestBatch5ApplicationFormatter.test_case_06_legal_entity_card`, `test_case_24_legal_entity_submission` | C | PASS |
| 9 | IP without KPP | `TestBatch5ApplicationFormatter.test_case_07_ip_card_no_kpp`, `test_case_25_ip_submission` | C | PASS |
| 10 | doc_email persisted | `TestCorr2LegalEntityPersistence.test_case_10_corr2_doc_email_persisted` | C | **PASS (new)** |
| 11 | contact_person persisted | `TestCorr2LegalEntityPersistence.test_case_11_corr2_contact_person_persisted` | C | **PASS (new)** |
| 12 | entity_type persisted | `test_case_24_legal_entity_submission`, `test_case_25_ip_submission` | C | PASS |
| 13 | OGRN not collected | `7: OGRN / OGRNIP is not collected` | B4 | PASS |
| 14 | amount not overridable | `TestBatch5S2SHMACAndReceiver.test_case_22_commercial_authority_not_overridable` | C | PASS |
| 15 | course title not overridable | `TestBatch5S2SHMACAndReceiver.test_case_22_commercial_authority_not_overridable` | C | PASS |
| 16 | schedule not overridable | `TestCase16ScheduleOverride.test_case_16_schedule_override_blocked` | C | **PASS (rewritten)** |
| 17 | level_1 title | `TestBatch5FlagshipCourseLevels.test_case_01_flagship_level_names_exact_authority` | C | PASS |
| 18 | level_2 title | `TestBatch5FlagshipCourseLevels.test_case_01_flagship_level_names_exact_authority` | C | PASS |
| 19 | level_3 title | `TestBatch5FlagshipCourseLevels.test_case_01_flagship_level_names_exact_authority` | C | PASS |
| 20 | prices unchanged | `test_case_01_flagship_level_names_exact_authority`, `test_case_02_calendar_cache_json_synced` | C | PASS |
| 21 | full-prepayment discount | `test_case_01_flagship_level_names_exact_authority` | C | PASS |
| 22 | missing headers | `TestBatch5S2SHMACAndReceiver.test_case_17_missing_auth_headers_rejected` | C | PASS |
| 23 | expired timestamp | `test_case_18_expired_timestamp_rejected` | C | PASS |
| 24 | bad HMAC | `test_case_19_bad_hmac_rejected_nonce_not_poisoned` | C | PASS |
| 25 | body tampering | `test_case_20_body_tampering_rejected` | C | PASS |
| 26 | valid HMAC | `test_case_21_replay_nonce_rejected` (first request) | C | PASS |
| 27 | duplicate nonce | `test_case_21_replay_nonce_rejected` (second request) | C | PASS |
| 28 | bad HMAC cannot reserve nonce | `test_case_19_bad_hmac_rejected_nonce_not_poisoned` | C | PASS |
| 29 | duplicate sequential submit | `test_case_26_partial_delivery_retry` (same id), `test_case_10_active_key_uniqueness_new` | C | PASS |
| 30 | concurrent duplicate submit | `TestCase30ConcurrentDuplicate.test_case_30_concurrent_duplicate_submit` | C | PASS |
| 31 | different course allowed | `TestCase30ConcurrentDuplicate.test_case_31_different_course_allowed` (structural_typology vs maslow, same user+payer) | C | **PASS (rewritten)** |
| 32 | different cohort/tier allowed | `TestCase30ConcurrentDuplicate.test_case_32b_different_tier_same_course_isolated` (isolated tier variant; CORR2), `test_case_32_different_cohort_allowed` (payer variant, EXTRA) | C | PASS |
| 33 | resolved prior permits new | `test_case_11_paid_allows_new_same_key`, `TestF8InvoiceSentActive.test_case_51_invoice_sent_blocks_duplicate` | C | PASS |
| 34 | both delivered | `test_case_23_success_requires_both_delivered` (request B, second pass) | C | PASS |
| 35 | same-destination concurrent claim | `TestCase35bSameDestConcurrentClaim.test_case_35b_concurrent_claim_race` | C | PASS |
| 36 | DELIVERED never resent | `test_case_14_delivered_terminal_no_retry`, `test_case_26_partial_delivery_retry`, `test_case_49_retry_no_curator_resend` | C | PASS |
| 37 | FAILED safe retry | `test_case_26_partial_delivery_retry` | C | PASS |
| 38 | UNKNOWN never auto-retried | `test_case_15_unknown_terminal_no_retry`, `test_case_39_unknown_never_resent` | C | PASS |
| 39 | one delivered / other failed | `test_case_23_success_requires_both_delivered` (request A) | C | PASS |
| 40 | one delivered / other unknown | `TestCase40MixedDeliveryStatus.test_case_40_delivered_and_unknown_is_partial` | C | PASS |
| 41 | success forbidden until both delivered | `test_case_23_success_requires_both_delivered` | C | PASS |
| 42 | destination injection | `TestSecurityProbes.test_case_42_destination_injection_blocked` | C | PASS |
| 43 | bot token absent client-side | `11.2: CORR2 #43 — synthetic bot token absent from built client bundle (behavioral build-artifact scan)` | N | **PASS (new)** |
| 44 | raw secret never transmitted | `11.1: CORR2 #44 — raw S2S secret never transmitted on the outbound Navigator fetch (behavioral)` | N | **PASS (new)** |
| 45 | applicant HTML escaped | `TestBatch5ApplicationFormatter.test_case_05_html_escaping` | C | PASS |
| 46 | PII absent from logs | `TestCase46PIIAbsentFromLogs.test_case_46_pii_absent_from_logs` (INFO-level, 3 scenarios) | C | **PASS (rewritten)** |
| 47 | repeat submit blocked while SUBMITTING (UI) | `11.3: CORR2 #47 — individual confirmation CTA is disabled while submitting (page.tsx disabled expression)` + `11.4: CORR2 #47 — legal_entity_confirmation CTA is disabled while submitting (behavioral render)` | N | **PASS (new)** |
| 48 | exact success copy | N `1.1`, `5.5`; C `test_case_23_success_requires_both_delivered` | N+C | PASS |
| 49 | controlled failure state | N `5.6: SubmissionResultScreen displays loading spinner and error retry button` | N | PASS |
| 50 | Batch-2 regression | `batch-2-pricing-payer.test.mts` (full suite green) | N | PASS |
| 51 | Batch-3 regression | `batch-3-individual-enrollment.test.mts` (full suite green) | N | PASS |
| 52 | Batch-4 regression | `batch-4-legal-entity.test.mts` (full suite green) | N | PASS |
| 53 | Google untouched | chatbot full suite: `test_sheets_sync.py`, `test_schedule_sheets_sync.py` pass; no `data_engine` file touched (hash-verified) | C | PASS |

**ORIGINAL_53: PASS = 53, FAIL = 0, NOT_TESTED = 0.**

---

## 7. OWNER INVARIANTS, GOOGLE/PAYMENT, DEFERRED MINORS

- Curator `@Lebedev_AST` / `8807727029`, accounting `-1003990047416`, verbatim success copy, flagship titles/prices (50 000 / 100 000 / 50 000; full prepayment 160 000, base 200 000, discount 20%), payment label `Физлицо (СБП/перевод)` — all product files hash-identical; asserting tests (`test_case_01/02/04/23`, N `1.1/1.2/5.5`) green.
- GOOGLE_BEHAVIOR_CHANGED: NO (no `data_engine` or Google path touched; sheets suites pass).
- PAYMENT_BEHAVIOR_CHANGED: NO (no payment/invoice/SBP/acquiring/refund/reconciliation logic introduced; the act is test-only).
- Deferred minors N-2, N-3, F-10, F-11, F-14, F-16 — preserved untouched.

---

## 8. RETURN BLOCK

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR2.TEST-COVERAGE-CLOSURE-1

STATUS:
PASS

PRODUCT_SOURCE_FILES_MODIFIED:
NONE

REQUIREMENT_10_DOC_EMAIL:
PASS

REQUIREMENT_11_CONTACT_PERSON:
PASS

REQUIREMENT_16_SCHEDULE_OVERRIDE:
PASS

REQUIREMENT_31_DIFFERENT_COURSE:
PASS

REQUIREMENT_43_BOT_TOKEN_CLIENT:
PASS

REQUIREMENT_44_RAW_SECRET_TRANSMISSION:
PASS

REQUIREMENT_46_PII_LOGS:
PASS

REQUIREMENT_47_UI_SUBMIT_LOCK:
PASS

ORIGINAL_53_MATRIX:
PASS=53
FAIL=0
NOT_TESTED=0

EXTRA_TESTS:
4 (C test_case_32b tier-isolation; C test_case_43b/44b/47b accurately-labeled preserved receiver coverage)
(jointly, N 11.3 + 11.4 close #47; chatbot Batch-5 58 functions, Navigator Batch-5 42)

NAVIGATOR_BATCH5:
npx tsx --env-file=.env.local --test tests/tikhon-miniapp/batch-5-submission.test.mts — tests 42 / pass 42 / fail 0, ×3 runs identical

NAVIGATOR_REGRESSION:
npx tsx --env-file=.env.local --test tests/tikhon-miniapp/*.test.mts — tests 156 / pass 155 / fail 1;
the 1 failure is batch-1-corr1-entitlements "Live 1" — live `tikhon_private_entitlements` for subject
telegram:8807727029 is currently empty (read-only probe HTTP 200 []); fails identically with zero CORR2
code executing; recorded as out-of-scope live-data finding (§5). All 152 baseline tests otherwise pass.

CHATBOT_BATCH5:
./venv/bin/python -m unittest tests/test_batch5_submission.py — Ran 58, OK, ×3 runs identical

CHATBOT_REGRESSION:
./venv/bin/python -m unittest discover -s tests -p 'test_*.py' — Ran 229, 227 pass, 2 fail, both the
known PRE_EXISTING: test_cohort_limits…test_keyboard_rendering_with_availability;
test_welcome_flow…test_client_start_welcome_text_contains_tikhon

NEW_REGRESSION:
0

BUILD:
PASS

TYPECHECK:
PASS

FULL_LINT:
exit 1 — 10 problems (9 errors, 1 warning), identical files/rules to IV2 baseline (student-status ×2,
page.tsx ×7, batch-1-corr1 ×1 warning); Batch-5/CORR2 delta = 0

DIFF_CHECK:
PASS (Navigator exit 0; Chatbot exit 0)

GOOGLE_BEHAVIOR_CHANGED:
NO

PAYMENT_BEHAVIOR_CHANGED:
NO

PRODUCTION_MUTATION:
NONE

LIVE_PII_USED:
NO (synthetic markers only; the only live read was the read-only entitlement probe replicating the
pre-existing mandated test's own legacy-user request, §5)

GIT_MUTATION:
NONE

DEFERRED_MINORS_PRESERVED:
N2 / N3 / F10 / F11 / F14 / F16 = YES

NEXT:
INDEPENDENT IV3

STOP.
```
