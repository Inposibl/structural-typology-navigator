# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR1.IV2

**Date:** 2026-09-24T13:31:19Z
**Auditor:** Claude Opus 5.5, acting as independent read-only correction auditor
**Author under audit:** Gemini 3.8. The author did not audit this correction.
**Correction audited:** `docs/reports/TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_5_APPLICATION_SUBMISSION_AND_DUAL_HANDOFF_1_IMPLEMENTATION_1_CORR1_20260924T131319Z.md`
**Controlling audit:** IMPLEMENTATION-1.IV1, which returned FAIL with 1 BLOCKING, 5 MAJOR and 10 MINOR findings. Report: `…IMPLEMENTATION_1_IV1_20260924T045600Z.md`.

The auditor did not edit any source, test or config file. It made no database changes, no production access, no SSH connection and no real Telegram send, and used no live PII. There was no git add, commit or push.

All probes ran from `/tmp/iv2_probe/` and `/tmp/iv2_baseline/` using:
- temporary SQLite files
- a mocked `Bot`, and a mocked `Dispatcher` for the lifecycle test
- a mocked global `fetch`
- temporary environment overrides
- synthetic `.invalid` identities

---

## 0. TERMINAL SUMMARY

```text
VERDICT:  FAIL
BLOCKING: 0
MAJOR:    1   (F-6 survives: ORIGINAL_53 NOT_TESTED=8)
MINOR:    7
F1 PASS · F2 PASS · F3 PASS · F4 PASS · F5 PASS · F7 PASS · F8 PASS · F9 PASS (advisory) · F12 PASS · F13 PASS
ORIGINAL_53: PASS=45 FAIL=0 NOT_TESTED=8
BUILD PASS · NEW_REGRESSION 0
```

Every product defect that CORR1 was authorised to fix is closed, and each closure was verified behaviorally by the auditor. The verdict is FAIL only because the verdict rule requires `ORIGINAL_53 PASS=53 FAIL=0 NOT_TESTED=0`. Eight original requirements are still not proven by any committed test. Two of those eight (#10 and #11) were proven at IV1, and CORR1 lost that coverage when it rewrote the tests.

---

## 1. BASELINES & ATTRIBUTION

| Repo | Branch | HEAD | Matches expected | `status --porcelain` entries |
|---|---|---|---|---|
| Navigator | `navigator-production-dialogue-corr2-ab-normalization` | `5f10d73223abe72fc6311d4f60afcca485b57605` | yes | 66 |
| Chatbot | `feat/telegram-shared-brain-integration-1` | `c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183` | yes | 150 |

**CORR1 changed paths.** These are all files with an mtime later than the IV1 report (01:58:20 local, 2026-09-24):

```text
navigator:
  src/app/api/tikhon/submit-application/route.ts             10:08:58
  tests/tikhon-miniapp/batch-5-submission.test.mts           10:12:05
  docs/reports/…IMPLEMENTATION_1_CORR1_20260924T131319Z.md   10:13:35
  (ignored: tsconfig.tsbuildinfo, docs/reports/.DS_Store)

chatbot:
  delivery_service.py                                        09:49:26
  config.py                                                  09:49:39
  database.py                                                09:49:51
  api_service.py                                             09:51:23
  main.py                                                    09:51:44  (first modification vs HEAD; the diff is only the F-5 hunk)
  tests/test_batch5_submission.py                            10:07:51
```

There is no other product path. Compared with IV1:
- The Navigator status count went from 64 to 66: one IV1 report and one CORR1 report were added.
- The chatbot status count went from 149 to 150: `main.py` is now modified.

**Unrelated pre-existing residue.** This is unchanged from IV1 §1 and was not touched:
- Navigator: `AGENTS.md`, `src/lib/chat-contract.ts`, `.zcodeignore`, `benchmarks/`, `conversation-first-contact.ts` and its test, `live-data-binding.test.mts`, and non-Batch-5 docs.
- Chatbot: `sheets_sync.py`, `lebedev_adapter.py`, `keyboards.py`, `.env.example`, `.gitignore`, `README.md`, `requirements.txt`, `*.bak_*`, `data_engine/*`, `deploy/`, `scripts/`, and so on.

These Batch-5 files are unchanged since IV1, going by mtime: `calendar_service.py`, `data/calendar_cache.json`, `application_formatter.py`, `handlers/client.py`, and all Navigator UI files (`page.tsx`, `legal-entity-flow.tsx`, `helpers.ts`, `submission*.ts[x]`, CSS).

---

## 2. MECHANICAL GATES

| Gate | Result |
|---|---|
| Navigator `batch-5-submission.test.mts` | tests 38 / pass 38 / fail 0 |
| Navigator `tests/tikhon-miniapp/*.test.mts` | tests 152 / suites 8 / pass 152 / fail 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | **exit 0**. `ƒ /api/tikhon/submit-application` was emitted |
| `npm run lint` | exit 1: 10 problems (9 errors, 1 warning). These are the same files and rules as IV1: student-status ×2, page.tsx ×7, batch-1-corr1 ×1. **All are PRE_EXISTING, and the delta is 0.** |
| Targeted ESLint `--max-warnings=0` on all Batch-5/CORR1 TS/TSX files: route.ts, submission.ts, submission-screen.tsx, helpers.ts, legal-entity-flow.tsx, batch-5 test | exit 0 |
| page.tsx targeted | 7 errors, equal to the 7 at HEAD, so the delta is 0 |
| Navigator `git diff --check` | exit 0 |
| Chatbot `tests/test_batch5_submission.py` | Ran 55, OK. Repeated 5× and OK every time, so no nondeterminism was observed |
| Chatbot full `discover` | **Ran 226, FAILED (failures=2)**: `test_cohort_limits…test_keyboard_rendering_with_availability` and `test_welcome_flow…test_client_start_welcome_text_contains_tikhon` |
| Attribution of the 2 failures | Reproduced in `/tmp/iv2_baseline`, where all Batch-5 and CORR1 tracked files (including `main.py`) were restored to HEAD and the new files removed. They fail identically, so both are **PRE_EXISTING**. **NEW_REGRESSION = 0.** |
| `py_compile` and import of all changed or new modules | OK |
| Chatbot `git diff --check` | exit 0 |

---

## 3. F-1 — UNKNOWN/FAILED CLASSIFICATION: **PASS**

**Code.** `delivery_service.py:147-330`:
- Pre-send checks run first: `chat_id` must be non-zero and `bot` must not be `None`. Either failure gives FAILED.
- Phase A is `bot.send_message` inside `try`.
- Phase B is a separate DB-persistence step.
- `_classify_pre_send_exception` returns FAILED only for `TelegramBadRequest`, `TelegramForbiddenError` and `TelegramNotFound`. These are explicit Telegram 4xx rejections, where acceptance is impossible. Every other exception, including unknown `TelegramAPIError` subclasses and generic `Exception`, returns UNKNOWN.
- If a DB write fails after a successful send, the function returns UNKNOWN. The row stays `SENDING`, and `reconcile_stale_sending_claims` later turns it into `UNKNOWN`. It never becomes FAILED.
- The CAS only claims rows in `PENDING` or `FAILED`.

**Behavioral probes.** Each probe went end-to-end through the aiohttp receiver. The accounting destination was injected, then the user retried twice.

| Probe | First result | Retries (HTTP) | Accounting sends | Final |
|---|---|---|---|---|
| A `TelegramNetworkError("ServerDisconnectedError…")` | UNKNOWN | 502, 502 | **1** | UNKNOWN |
| B `TelegramNetworkError("ClientPayloadError…")` | UNKNOWN | 502, 502 | **1** | UNKNOWN |
| C `TelegramServerError("Bad Gateway")` | UNKNOWN | 502, 502 | **1** | UNKNOWN |
| D `asyncio.TimeoutError` | UNKNOWN | 502, 502 | **1** | UNKNOWN |
| E: mocked send succeeded, then a real `AsyncSession.commit` failure was injected while persisting DELIVERED | response UNKNOWN; row `SENDING` | 502 within 60 s; 502 after the stale window | **1** | UNKNOWN (`ERR_STALE_SENDING_CLAIM`) |
| F1 `TelegramBadRequest` 400 | FAILED | 200 | 2 (legitimate retry) | DELIVERED |
| F1 `TelegramForbiddenError` 403 | FAILED | 200 | 2 (legitimate retry) | DELIVERED |
| F2 `chat_id = 0` (pre-send) | FAILED `ERR_CHAT_ID_NOT_CONFIGURED` | 200 | 1 | DELIVERED |
| Extra: `TelegramRetryAfter` 429 | UNKNOWN | 502, 502 | 1 | UNKNOWN |
| Extra: generic `RuntimeError` | UNKNOWN | 502, 502 | 1 | UNKNOWN |

In every probe the curator destination was sent exactly once. DELIVERED and UNKNOWN were never auto-retried.

The 429 case is classified conservatively. A 429 is provably not delivered, yet it lands in UNKNOWN and needs manual reconciliation. That is safe, but it adds operator load; see F-16.

## 4. F-2 — S2S SECRET FAIL-CLOSED: **PASS**
- `config.py:61` is `os.getenv("TIKHON_INTERNAL_SECRET", "")`.
- `api_service.py:195-198` returns 500 `SERVER_MISCONFIGURATION` when the secret is empty.
- `route.ts:184-193` returns 500 `SERVER_CONFIGURATION_ERROR` when the secret is unset.
- The literal `test_internal_secret_key_ast_2026` has **0 occurrences** in either repo, across product code, tests, JSON and env files. Tests use synthetic secrets that they inject explicitly.

Probes:
- **Receiver** with the secret empty: a request signed with the old literal and another signed with an arbitrary secret both got 500. There were 0 nonce rows, 0 applications and 0 sends.
- **Navigator** with the secret unset: 500 and 0 `fetch` calls.
- **Navigator** with the secret set: the forwarded signature verifies with the environment secret. The raw secret does not appear in the URL, headers or body.

## 5. F-3 — BOT TOKEN FAIL-CLOSED: **PASS**
- `route.ts:53-61` uses `TELEGRAM_BOT_TOKEN || BOT_TOKEN` and returns 500 when neither is set. This is the same precedence and fail-closed policy as `student-status/route.ts:104-116`.
- Probes:
  - No tokens set, with initData forged using `PLACEHOLDER_BOT_TOKEN`: 500, 0 forwards.
  - Real token set, with the same forged initData: 401, 0 forwards.
  - When both variables are set, the request is validated against `TELEGRAM_BOT_TOKEN`.
- `PLACEHOLDER_BOT_TOKEN` is absent from `route.ts`. It still appears in chatbot `config.py:47` as the default for the bot's own `BOT_TOKEN`, and `main.py:43` warns about it. That code pre-dates Batch 5 and is not an initData fallback.

## 6. F-4 — STORED APPLICATION IS CANONICAL ON RETRY: **PASS**
`api_service.py:363-401`: on `IntegrityError`, the code reloads `existing_app` and builds the card only from the persisted row. `pricing_option_title` comes from the registry, keyed by the same `pricing_option.id` that is part of the key.

Probes:
- **Individual.** Version A: "Версия Альфа", phone +7…01. Version B: "Версия Бета", +7…02. Both runs returned the same `application_id`, with SUCCESS on the retry. The stored row is still A, and the curator was sent once. Accounting received A with no B values, and the curator and accounting cards are byte-identical.
- **Legal entity.** Version B changed `company_name`, `bik`, `account`, `contact_person`, `kpp`, `company_address` and `edo_type`. The results were the same: one application id, stored row A, and one send each. The accounting card contains every A value, and the B values leaked are `[]`. The two cards are byte-identical.

## 7. F-5 — RUNTIME RECEIVER WIRING: **PASS**
`main.py:80-97` starts the receiver with `start_api_server(host="127.0.0.1", port=8080, bot=bot)` after `init_db`, the scheduler and the projection, and before `dp.start_polling`. The code retains `api_runner`, and the `finally` block calls `api_runner.cleanup()`. There is no `0.0.0.0` bind anywhere; the one textual match is a code comment.

**Non-production lifecycle probe** (`/tmp/iv2_probe/lifecycle.py`): the real `main.main()` ran with `init_db`, `sync_calendar`, the reminder scheduler, the Supabase projection, `Bot` and `Dispatcher` all mocked, so there was no network and no real DB.
- The listen socket was exactly **`127.0.0.1:8080`**.
- `/healthz` returned 200 "OK", and `POST /api/v1/applications` returned 401 while polling ran.
- Polling started.
- After shutdown the connection was refused and the port was released.
- The reminder and projection tasks were cancelled, and the bot session was closed.
- There were 0 listeners on 8080 before and after.

`test_case_53` checks only `start_api_server` on port 18080 and does not exercise `main.py`. See N-3 for the fail-soft behavior.

## 8. F-6 — ORIGINAL 53-CASE MATRIX: **FAIL (NOT_TESTED = 8)**

Key: C = `chatbot/tests/test_batch5_submission.py`; N = `navigator/tests/tikhon-miniapp/batch-5-submission.test.mts`; B4 = `batch-4-legal-entity.test.mts`. The CORR1 test numbering (`case_01`…`case_53`, `34b`, `35b`) does **not** correspond to the original requirement numbers. The mapping below follows what each test actually asserts.

| # | Requirement | Test(s) | Result |
|---|---|---|---|
| 1 | individual normal submit | C `test_case_23` (B) | PASS |
| 2 | phone present | C `test_case_05` | PASS |
| 3 | phone absent | C `test_case_04` | PASS |
| 4 | exact card structure | C `test_case_04` | PASS |
| 5 | payment-type label | C `test_case_04` | PASS |
| 6 | legal entity | C `test_case_24` | PASS |
| 7 | IP | C `test_case_25` | PASS |
| 8 | legal entity with KPP | C `test_case_06`, `test_case_24` | PASS |
| 9 | IP without KPP | C `test_case_07`, `test_case_25` | PASS |
| 10 | doc_email persisted | — (**coverage regression**: the IV1-era assertion was removed; `case_24`/`25` no longer assert it, and `case_09` checks only that the column exists) | **NOT_TESTED** |
| 11 | contact_person persisted | — (**coverage regression**, same as #10) | **NOT_TESTED** |
| 12 | entity_type persisted | C `test_case_24`, `test_case_25` | PASS |
| 13 | OGRN not collected | B4 `7: OGRN / OGRNIP is not collected`. The C `assertIsNone(ogrn)` was removed | PASS |
| 14 | amount not overridable | C `test_case_22` | PASS |
| 15 | course title not overridable | C `test_case_22` | PASS |
| 16 | schedule not overridable | C `test_case_16` asserts only `len(cohort.schedule) > 0`. It injects no client schedule and asserts nothing about the DB or card | **NOT_TESTED** |
| 17–19 | level_1/2/3 titles | C `test_case_01` | PASS ×3 |
| 20 | prices unchanged | C `test_case_01`, `test_case_02` | PASS |
| 21 | full-prepayment discount | C `test_case_01` | PASS |
| 22 | missing headers | C `test_case_17` | PASS |
| 23 | expired timestamp | C `test_case_18` | PASS |
| 24 | bad HMAC | C `test_case_19` | PASS |
| 25 | body tampering | C `test_case_20` | PASS |
| 26 | valid HMAC | C `test_case_21` (first request) | PASS |
| 27 | duplicate nonce | C `test_case_21` | PASS |
| 28 | bad HMAC cannot reserve nonce | C `test_case_19` | PASS |
| 29 | duplicate sequential submit | C `test_case_26` (same id), `test_case_10` | PASS |
| 30 | concurrent duplicate submit | C `test_case_30` (10 concurrent: 1 active app, 2 delivery rows, no 500) | PASS |
| 31 | different course allowed | C `test_case_31` is misnamed: it varies `pricing_option_id` on the same course. Its comment "only one course in the canonical registry" is **false**; the registry exposes 5 approved courses | **NOT_TESTED** |
| 32 | different cohort/tier allowed | C `test_case_31` isolates the tier (same identity, cohort and course; level_1 vs level_2). `test_case_32` varies payer type and identity and is confounded. The cohort variant is not isolated, although `structural_typology` has 3 cohorts | PASS (tier) |
| 33 | resolved prior permits new | C `test_case_11`, `test_case_51` (paid/canceled/rejected) | PASS |
| 34 | both delivered | C `test_case_23` (B) | PASS |
| 35 | same-destination concurrent claim | C `test_case_35b` (`asyncio.gather` of 2 claims: exactly 1 wins) | PASS |
| 36 | DELIVERED never resent | C `test_case_14`, `test_case_26`, `test_case_49` | PASS |
| 37 | FAILED safe retry | C `test_case_26` | PASS |
| 38 | UNKNOWN never auto-retried | C `test_case_15`, `test_case_39` | PASS |
| 39 | one delivered / other failed | C `test_case_23` (A) | PASS |
| 40 | one delivered / other unknown | C `test_case_40` | PASS |
| 41 | success forbidden until both delivered | C `test_case_23` | PASS |
| 42 | destination injection | C `test_case_42` (stored delivery `chat_id` ≠ injected value) | PASS |
| 43 | bot token absent client-side | — `test_case_43` tests the receiver with `bot=None`, and N `8.x` tests server-side fail-closed. Nothing checks the client code or bundle. The auditor's scan of `.next/static` is clean | **NOT_TESTED** |
| 44 | raw secret never transmitted | — `test_case_44` checks the **receiver's response**, and N `10.3` is a source grep. Neither inspects the outbound Navigator request. The auditor's probe confirmed the secret is absent | **NOT_TESTED** |
| 46 | PII absent from logs | — `test_case_46` attaches a handler, but during the test the logger's effective level is **WARNING** (root is unconfigured). The INFO `application_processed` line is never captured, and only individual fields are checked. N `6.2`/`10.x` are source greps. The auditor's INFO-level probe was clean | **NOT_TESTED** |
| 45 | applicant HTML escaped | C `test_case_05` | PASS |
| 47 | repeat submit blocked while SUBMITTING (UI) | — `test_case_47` checks the DB `SENDING` claim, not the UI. No test asserts the CTA `disabled={… submissionState === "submitting"}` (`page.tsx:1486`, `legal-entity-flow.tsx:623`), though the code has it | **NOT_TESTED** |
| 48 | exact success copy | N `1.1`, `5.5`; C `test_case_23` | PASS |
| 49 | controlled failure state | N `5.6` | PASS |
| 50–52 | Batch-2/3/4 regression | Navigator 152/152 | PASS ×3 |
| 53 | Google untouched | Chatbot full-suite `test_sheets_sync.py` and `test_schedule_sheets_sync.py` pass, and the auditor's diff agrees | PASS |

**ORIGINAL_53: PASS=45, FAIL=0, NOT_TESTED=8** (#10, 11, 16, 31, 43, 44, 46, 47).

For #16, 43, 44 and 46, the auditor's probes show the **product behavior is correct**. The gap is only the absence of a committed proving test.

**Extra test cases.** Batch-5 now has chatbot 55 + Navigator 38 = 93 test functions, up from 18 + 26 = 44 at IV1, so **49 were added by CORR1**. The CORR1 report's "F6 PASS=55" counts test functions, not the original 53 requirements.

## 9. F-7 — CONCURRENT SUBMIT RACE: **PASS**
`ensure_delivery_records` now uses `sqlite_insert(...).on_conflict_do_nothing(index_elements=["application_id","destination"])`, backed by `UNIQUE(application_id, destination)`.

The probe ran 8 rounds of 10 concurrent identical signed submissions:
- **0 HTTP 500s.**
- Each round produced exactly 1 application and 2 sends.
- Totals: 8 applications, 16 delivery rows, one `CURATOR` and one `ACCOUNTING` row per application, and 16 sends.

Some losing concurrent requests got a controlled 502 `PARTIAL_OR_FAILED`. That happens when they observe the sibling request's `SENDING` claim; it is a correct fail-closed response.

## 10. F-8 — invoice_sent ACTIVE UNIQUENESS: **PASS** (MINOR N-2)
- The index is now `CREATE UNIQUE INDEX uq_active_application_key ON applications(active_application_key) WHERE status NOT IN ('paid','canceled','rejected')`.
- These status spellings match `handlers/operator.py` (`invoice_sent`/`paid`/`canceled`).

DB-level probe, inserting directly without going through the application:

| Status of the existing row with the same key | Second insert as `new` |
|---|---|
| `new` | BLOCKED |
| `invoice_sent` | BLOCKED |
| `paid` | ALLOWED |
| `canceled` | ALLOWED |
| `rejected` | ALLOWED |

Two more checks:
- Reactivating a `paid` row to `invoice_sent` while an active duplicate exists is BLOCKED.
- Through the API: resubmitting after `invoice_sent` reuses the same id, and resubmitting after `paid`, `canceled` or `rejected` creates a new application.

**Migration.** Starting from the old `WHERE status = 'new'` index, running `apply_migrations` twice leaves exactly one index with the new predicate, so the migration is idempotent.

**N-2:** if legacy data already holds an active duplicate, such as `new` plus `invoice_sent` under the same key, `DROP INDEX` is autocommitted and `CREATE` then raises `IntegrityError`. The result is **no uniqueness index at all**, and `init_db` raises, so the bot will not start until someone dedups manually. Only IV1-era Batch-5 data can trigger this, and production has none.

## 11. F-9 — NONCE CLEANUP: **PASS** (advisory)
- `_cleanup_expired_nonces` runs `DELETE … WHERE expires_at < now`, using the `idx_nonces_expires_at` index.
- It is called only after the HMAC check passes and the nonce INSERT succeeds, gated by `random.random() < 0.1` from the stdlib PRNG.

Probe:
- With the PRNG forced to 0.0, a **bad** HMAC request removed nothing.
- A valid request with the PRNG forced to 0.99 removed nothing.
- A valid request with the PRNG forced to 0.0 removed only the expired nonce and kept the live one.
- A nonce accepted at `ts = now − 290 s` was replayed after a forced cleanup and got **409**. `expires_at = ts + 300 s` equals the acceptance boundary, so there is no replay window.

Work per request is bounded by the number of already-expired rows, and it is indexed. The committed test calls the cleanup function directly, so it is deterministic. Five repeated runs were all OK.

Advisory: the cadence is probabilistic and depends on traffic. A deterministic periodic task would be preferable, but correctness and security are sound.

## 12. F-12 — LOG HARDENING: **PASS**
The probe ran with the root logger at INFO (the production level) and used unique markers for:
- full_name, email, phone, Telegram user_id, username
- INN, KPP, BIK, account, doc_email, contact_person
- a raw exception text ("RAWEXC_MARKER")
- both recipient chat IDs
- the secret
- a raw body key, and an injected `course_id` containing a newline

The flows covered were an individual application with an accounting network error, a legal entity where both sends raise a generic exception, a bad HMAC, and an invalid course.

**Result: 0 leaks in first-party loggers** (`api_service`, `delivery_service`, `ast_bot`):
- `delivery_service` logs only `app_id`, `dest`, the bounded `error_code` and `status`.
- `api_service` logs `course_id`/`cohort_id`/`pricing_option_id` **only from the validated registry objects**, after validation. The invalid-course request logged nothing.
- The Navigator route logs only `event`, `status`, `latency_ms` and `app_id`. It no longer logs `course_id` or raw network error text, and the probe found 0 marker leaks.

The only third-party INFO logger seen was `aiohttp.access`, which logs the request line and loopback IP with no PII.

## 13. F-13 — HTTPS FAIL-CLOSED: **PASS**

| Case | Result |
|---|---|
| A: URL absent | 500 `UPSTREAM_URL_NOT_CONFIGURED`, 0 forwards |
| B: `NODE_ENV=production` with `http://127.0.0.1:8080/…` | 500 `UPSTREAM_URL_NOT_HTTPS`, 0 forwards (an upper-case `HTTPS://` URL is also rejected, which is conservative) |
| C: production with `https://…` | forwarded (1) |
| D: `development` or unset `NODE_ENV` with `http://` | forwarded. This is allowed for local use only |

Next.js production builds and Vercel set `NODE_ENV=production`, so case D does not weaken production. The route has no hidden default URL; the only `127.0.0.1:8080` text left is a comment at `route.ts:204`.

## 14. OWNER INVARIANTS: no regression
- **Curator:** `CURATOR_CHAT_ID` defaults to `8807727029` and `CURATOR_USERNAME` to `Lebedev_AST`.
- **Accounting:** `operator_chat_id`. Local `.env` is unchanged (2026-09-23 16:56).
- **Success copy** is verbatim in `helpers.ts:203` and `api_service.py:451`, and the curator link is `https://t.me/Lebedev_AST`.
- **Flagship titles, prices, IDs and discount:** `calendar_service.py` and the cache are unchanged since IV1, and C `test_case_01`/`02` pass.
- **Payment label:** `Физлицо (СБП/перевод)` is at `application_formatter.py:65`, and that file is unchanged.
- `AST_lebedev` appears 0 times in product code.

## 15. GOOGLE / PAYMENT: **PASS / PASS**
- `data_engine/sheets_sync.py` is unchanged (2026-09-23 07:43), and CORR1 touched no `data_engine` file. There is no new Google dependency.
- CORR1 introduced no payment initiation, invoice generation, acquiring, SBP execution, refunds, payment webhook, reconciliation, Finance.xlsx, or payment-status automation.
- `invoice_sent`/`paid` appear only in the idempotency predicate.
- The `sbp_*` settings in `config.py` pre-date Batch 5 and are unchanged.

## 16. DEFERRED MINORS

| ID | Status | Note |
|---|---|---|
| F-10 operator keyboard | UNCHANGED | Mini App cards are still sent without `reply_markup` |
| F-11 entity_type visual label | UNCHANGED | the formatter is unchanged |
| F-14 DEBUG logging | IMPROVED | The first-party delivery log no longer carries the recipient chat_id or raw exception text. Third-party `aiosqlite` DEBUG parameter echo is unchanged |
| F-16 UNKNOWN recovery tooling | UNCHANGED | There is still no operator reconciliation command. CORR1 correctly routes more outcomes to UNKNOWN (429, 401, generic exceptions), which increases the manual reconciliation load. This follows from the mandated fail-closed policy and is not escalated |

## 17. PRODUCTION SAFETY
- `chatbot/.env` (09-23 16:56), `chatbot/ast_bot.db` (09-23 15:28) and `navigator/.env.local` (09-23 16:38) are unchanged, so `OPERATOR_CHAT_ID` is unchanged.
- `deploy/` and `scripts/` have no file changed after IV1.
- `.git/index` in both repos was last written before IV1, and there are no stash entries.
- There are 0 listeners on port 8080 after the probes.
- The auditor did not SSH, so nginx, DNS, Certbot, the firewall and the systemd service were not touched. There was no live Telegram send and no live PII.
- The privacy/legal gate remains **OPEN_FOR_LIVE_PRODUCTION**.

---

## 18. FINDINGS

### MAJOR
**F-6 (survives).** The ORIGINAL_53 matrix has 8 NOT_TESTED requirements: #10, 11, 16, 31, 43, 44, 46, 47.
- **Coverage regression:** #10 (`doc_email` persisted) and #11 (`contact_person` persisted) were PASS at IV1. The CORR1 test rewrite dropped those assertions.
- **Tests that don't test their requirement:**
  - `test_case_16` is trivial.
  - `test_case_31` is misnamed and relies on a false registry claim.
  - `test_case_43` and `test_case_44` test other properties.
  - `test_case_46` cannot observe INFO logs.
  - `test_case_47` is a DB test, not the UI lock.
- The CORR1 report's "F6 PASS=55 NOT_TESTED=0" inflates the denominator and does not match the controlling original-53 requirement.

### MINOR
- **N-2: non-atomic index migration.** `database.py` runs `DROP INDEX IF EXISTS` then `CREATE UNIQUE INDEX`. The DROP is autocommitted, so if active duplicates already exist the CREATE fails. That leaves no uniqueness index, and `init_db` raises, crashing startup until someone dedups manually. Only IV1-era Batch-5 data can trigger it.
- **N-3: fail-soft receiver start and cleanup ordering.** `main.py:83-88` logs a warning and continues polling if the receiver cannot bind, for example when the port is busy. Mini App submissions would then fail with 502 and there is no health alarm. In `finally`, an exception from `api_runner.cleanup()` would skip the projection and reminder cancellation and `bot.session.close()`.
- **N-4: CORR1 report and test-label inaccuracies.**
  - "55/55 … all 11 IV1 NOT_TESTED closed" is not accurate (§8).
  - "Case 53 passing" is cited for F-5, but case 53 does not exercise `main.py`.
  - "Targeted ESLint (route.ts, test)" covered only 2 files. The auditor ran all 6, and they are clean.
  - The comment in `test_case_31` claims a single course, which is false.
- **F-10 (deferred):** UNCHANGED.
- **F-11 (deferred):** UNCHANGED.
- **F-14 (deferred):** IMPROVED; the third-party DEBUG part is still open.
- **F-16 (deferred):** UNCHANGED. The UNKNOWN volume is higher by design.

### Closed from IV1 (auditor-verified)
F-1, F-2, F-3, F-4, F-5, F-7, F-8, F-9, F-12 and F-13 are closed. F-15 (report overstatements) was superseded and is replaced by N-4.

---

## 19. RETURN BLOCK

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR1.IV2

VERDICT:
FAIL

BLOCKING:
0

MAJOR:
1

MINOR:
7

F1:
PASS

F2:
PASS

F3:
PASS

F4:
PASS

F5:
PASS

ORIGINAL_53_MATRIX:
PASS=45
FAIL=0
NOT_TESTED=8   (#10, #11, #16, #31, #43, #44, #46, #47)

EXTRA_TEST_CASES:
49 added by CORR1 (Batch-5 test functions: chatbot 55 + navigator 38 = 93, was 18 + 26 = 44)

F7:
PASS

F8:
PASS

F9:
PASS (advisory: probabilistic cadence; correctness/security sound; tests deterministic)

F12:
PASS

F13:
PASS

NAVIGATOR_BUILD:
PASS

NAVIGATOR_REGRESSION:
tests/tikhon-miniapp/*.test.mts — 152/152 pass (8 suites); batch-5 38/38

CHATBOT_REGRESSION:
Ran 226, 224 pass, 2 fail — both PRE_EXISTING (re-attributed with Batch-5 + CORR1 reverted incl. main.py):
test_cohort_limits.test_keyboard_rendering_with_availability; test_welcome_flow.test_client_start_welcome_text_contains_tikhon
batch-5: Ran 55 OK (5/5 repeat runs OK)

NEW_REGRESSION:
0

FULL_LINT:
10 problems (9 errors, 1 warning), all PRE_EXISTING, identical to IV1; Batch-5/CORR1 delta = 0

GOOGLE_NON_REGRESSION:
PASS

PAYMENT_SCOPE:
PASS

DEFERRED_MINORS:
F10 = UNCHANGED
F11 = UNCHANGED
F14 = IMPROVED (first-party chat_id/raw-exception logging removed; aiosqlite DEBUG unchanged)
F16 = UNCHANGED (UNKNOWN volume higher by design)

PRODUCTION_MUTATION:
NONE

LIVE_PII_USED:
NO

GIT_MUTATION:
NONE

FINDINGS:
F-6  MAJOR  ORIGINAL_53 NOT_TESTED=8; #10/#11 coverage regressed; case_16/31/43/44/46/47 do not prove their requirement
N-2  MINOR  non-atomic DROP+CREATE index migration: legacy active duplicates → no unique index + init_db crash
N-3  MINOR  receiver start is fail-soft (warning only); finally-block cleanup ordering can skip later shutdown steps
N-4  MINOR  CORR1 report/test-label inaccuracies (55-denominator, case 53 ≠ main.py, 2-file targeted lint, false single-course comment)
F-10 MINOR  deferred, UNCHANGED
F-11 MINOR  deferred, UNCHANGED
F-14 MINOR  deferred, IMPROVED
F-16 MINOR  deferred, UNCHANGED

NEXT:
OWNER REVIEW

STOP.
```
