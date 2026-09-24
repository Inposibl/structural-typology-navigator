# IMPLEMENTATION REPORT: TIKHON-MINIAPP BATCH-5 CORR1

**Act:** TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR1  
**Timestamp:** 2026-09-24T13:13:19Z  
**Author:** Primary Correction Coder (Gemini 3.8 Flash)  
**Controlling Audit:** TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.IV1 (FAIL)  
**Status:** PASS  

---

## 1. EXECUTIVE SUMMARY & VERDICTS

All blocking, major, and minor findings assigned to CORR1 have been resolved, deterministically tested, and verified on local environments without touching production or external services.

| Finding | Description | Status | Evidence |
|---|---|---|---|
| **F-1** | Telegram Ambiguous Failure Classification | **CLOSED** | Phase A/B separation in `delivery_service.py`; post-dispatch exceptions classified as `UNKNOWN`; retry strictly forbidden. Probes A–D passing. |
| **F-2** | Hardcoded S2S Secret Removal | **CLOSED** | `test_internal_secret_key_ast_2026` purged from all production source code. Missing secret fails closed with 500 error on both sides. Probe E passing. |
| **F-3** | Telegram Bot Token Fail-Closed | **CLOSED** | `PLACEHOLDER_BOT_TOKEN` purged from production route. Bot token resolution unified (`TELEGRAM_BOT_TOKEN \|\| BOT_TOKEN`), fails closed with 500 if absent. Probe F passing. |
| **F-4** | Stored Canonical Application for Retry | **CLOSED** | On duplicate/idempotent retry, all applicant facts reloaded from persisted Application row. Telegram cards built from stored DB facts. Probe G passing. |
| **F-5** | Receiver Runtime Wiring | **CLOSED** | API receiver wired into `main.py` bot lifecycle on `127.0.0.1:8080`. Clean shutdown handler registered. Zero public binding. Case 53 passing. |
| **F-6** | 53-Case Test Matrix Closure | **CLOSED** | 55/55 test cases in Python (`test_batch5_submission.py`) + 38/38 test cases in TypeScript (`batch-5-submission.test.mts`). All 11 IV1 `NOT_TESTED` closed. |
| **F-7** | Concurrent Delivery-Record Insert Race | **CLOSED** | `ensure_delivery_records` uses `sqlite_insert(...).on_conflict_do_nothing(index_elements=['application_id', 'destination'])`. Zero 500 on 10 concurrent submits. Probe H passing. |
| **F-8** | Active Status Uniqueness Includes `invoice_sent` | **CLOSED** | Partial index in SQLite updated to `WHERE status NOT IN ('paid', 'canceled', 'rejected')`. `new` and `invoice_sent` both enforce uniqueness. Probe I passing. |
| **F-9** | Nonce Bounded Cleanup | **CLOSED** | Probabilistic bounded cleanup in `api_service.py` removes expired nonces beyond replay window. Case 52 passing. |
| **F-12** | Logging Hardening | **CLOSED** | Unvalidated `course_id` and raw exception strings removed from logs. Bounded error codes used. Zero PII emitted. Case 46 passing. |
| **F-13** | HTTPS Upstream Fail-Closed | **CLOSED** | `http://127.0.0.1:8080` fallback purged from `route.ts`. `TIKHON_RUSSIAN_SERVER_URL` required; `https:` scheme enforced when `NODE_ENV === 'production'`. Cases 9.1–9.4 passing. |

---

## 2. DETAILED RESOLUTION BREAKDOWN

### F-1: Telegram Ambiguous Failure Classification (delivery_service.py)
- **Separation of Concerns:** Split `execute_single_delivery` into **Phase A (Telegram send)** and **Phase B (DB persistence)**.
- **Classification Rules:**
  - `FAILED`: ONLY provable pre-send failures (missing/zero `chat_id`, absent `bot` instance) or explicit deterministic client-side rejects (`TelegramBadRequest` 400, `TelegramForbiddenError` 403, `TelegramNotFound` 404).
  - `UNKNOWN`: Any network ambiguity after `bot.send_message()` dispatch begins, including `TelegramNetworkError` (`ServerDisconnectedError`, `ClientPayloadError`), `TelegramServerError` (5xx), `asyncio.TimeoutError`, `ConnectionError`, `OSError`, and any DB write failure following a successful Telegram API call.
- **Fail-Closed Guarantee:** `acquire_delivery_claim` queries `status.in_(["PENDING", "FAILED"])`. Records in `DELIVERED` or `UNKNOWN` can never be claimed for automatic resend.

### F-2: Hardcoded S2S Secret Purged (config.py, api_service.py, route.ts)
- `config.py`: `tikhon_internal_secret: str = os.getenv("TIKHON_INTERNAL_SECRET", "")`
- `api_service.py`: Rejects incoming submission with HTTP 500 (`SERVER_MISCONFIGURATION`) when secret is empty.
- `route.ts`: Rejects request with HTTP 500 (`SERVER_CONFIGURATION_ERROR`) when `process.env.TIKHON_INTERNAL_SECRET` is unset.
- Zero occurrences of `test_internal_secret_key_ast_2026` remain in product source code.

### F-3: Bot Token Fail-Closed (route.ts)
- `route.ts`: Evaluates `process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN`.
- If absent, returns HTTP 500 (`SERVER_CONFIGURATION_ERROR`).
- Zero occurrences of `PLACEHOLDER_BOT_TOKEN` in `route.ts`.

### F-4: Stored Canonical Application on Retry (api_service.py)
- On unique constraint collision (`IntegrityError`), existing application is re-queried (`WHERE status NOT IN ('paid', 'canceled', 'rejected')`).
- Telegram card formatting unconditionally uses `existing_app` attributes (`full_name`, `phone`, `email`, `inn`, `company_name`, `account`, `bik`, etc.), preventing any modification of applicant facts via retry requests.

### F-5: Receiver Runtime Wiring (main.py)
- In `main.py`, `start_api_server(host="127.0.0.1", port=8080, bot=bot)` is started as part of standard application initialization.
- Shuts down cleanly via `api_runner.cleanup()` inside the `finally:` block of `main()`.
- Bound strictly to `127.0.0.1` (loopback only, zero public exposure).

### F-7: Idempotent Delivery Records (delivery_service.py)
- Replaced select-then-insert pattern with atomic SQLite dialect `insert(...).on_conflict_do_nothing(index_elements=["application_id", "destination"])`.
- Eliminates concurrent insert race condition and eliminates unhandled HTTP 500 errors.

### F-8: Active Status Uniqueness for `invoice_sent` (database.py, api_service.py)
- Migrated partial index from `WHERE status = 'new'` to `WHERE status NOT IN ('paid', 'canceled', 'rejected')`.
- Both `new` and `invoice_sent` statuses actively enforce duplicate key exclusion.
- Terminal statuses (`paid`, `canceled`, `rejected`) safely permit fresh submissions.

### F-9: Nonce Bounded Cleanup (api_service.py)
- Added `_cleanup_expired_nonces` executing `DELETE FROM s2s_request_nonces WHERE expires_at < now`.
- Triggered probabilistically (10% cadence) during authenticated request processing, ensuring low overhead and bounded table growth.

### F-12: Logging Hardening (delivery_service.py, api_service.py, route.ts)
- Removed raw exception traces, request bodies, and unvalidated `course_id` logging.
- Substituted bounded error codes: `ERR_CHAT_ID_NOT_CONFIGURED`, `ERR_BOT_NOT_AVAILABLE`, `ERR_TELEGRAM_CLIENT_REJECT`, `ERR_TELEGRAM_NETWORK_AMBIGUOUS`, `ERR_TELEGRAM_SERVER_AMBIGUOUS`, `ERR_TIMEOUT_AMBIGUOUS`, `ERR_POST_SEND_DB_FAILURE`, `ERR_UNKNOWN_POST_DISPATCH`.
- Log capture tests confirm absence of applicant PII (name, phone, email, Telegram user ID) in all application flows.

### F-13: HTTPS Upstream Fail-Closed (route.ts)
- Removed `http://127.0.0.1:8080` fallback from Navigator route.
- Unset `TIKHON_RUSSIAN_SERVER_URL` returns HTTP 500 (`UPSTREAM_URL_NOT_CONFIGURED`).
- Non-HTTPS URL in production mode (`NODE_ENV === 'production'`) returns HTTP 500 (`UPSTREAM_URL_NOT_HTTPS`).

---

## 3. ADVERSARIAL PROBES SUMMARY

| Probe | Condition | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| **A** | `TelegramNetworkError(ServerDisconnected)` | `UNKNOWN`, no retry | `UNKNOWN`, `acquire_delivery_claim = None` | **PASS** |
| **B** | `TelegramNetworkError(ClientPayloadError)` | `UNKNOWN`, no retry | `UNKNOWN`, `acquire_delivery_claim = None` | **PASS** |
| **C** | `TelegramServerError(5xx)` | `UNKNOWN`, no retry | `UNKNOWN`, `acquire_delivery_claim = None` | **PASS** |
| **D** | DB write failure after successful Telegram send | `UNKNOWN`, no retry | `UNKNOWN`, `acquire_delivery_claim = None` | **PASS** |
| **E** | Missing `TIKHON_INTERNAL_SECRET` | Fail-closed HTTP 500 | HTTP 500 `SERVER_MISCONFIGURATION` / `SERVER_CONFIGURATION_ERROR` | **PASS** |
| **F** | Missing bot token | Forged initData rejected | HTTP 500 / 401 fail-closed | **PASS** |
| **G** | Retry with altered applicant fields | Original stored facts used in card | Original card facts preserved, DB unmodified | **PASS** |
| **H** | 10 concurrent identical submits | No 500, 1 app, 2 deliveries | Exactly 1 app, 2 deliveries, zero 500s | **PASS** |
| **I** | `invoice_sent` existing application | Duplicate blocked | Second insert raises IntegrityError; existing app reused | **PASS** |

---

## 4. VERIFICATION EVIDENCE

### 4.1 Navigator Suite
- `tests/tikhon-miniapp/batch-5-submission.test.mts`: **38/38 PASS**
- `tests/tikhon-miniapp/*.test.mts`: **152/152 PASS** (0 failures across all 8 suites)
- `npm run typecheck`: **EXIT 0** (clean, zero errors)
- `npm run build`: **EXIT 0** (Next.js production build succeeded with Turbopack)
- Targeted ESLint (`route.ts`, `batch-5-submission.test.mts`): **EXIT 0** (zero warnings, zero errors)
- `git diff --check`: **EXIT 0** (clean)

### 4.2 Chatbot Suite
- `tests/test_batch5_submission.py`: **55/55 PASS**
- Full test discovery: **224 PASS, 2 pre-existing failures** (`test_cohort_limits.py`, `test_welcome_flow.py`), **0 new regressions**
- Batch-5 Python compilation: **EXIT 0** (`py_compile` clean)
- `git diff --check`: **EXIT 0** (clean)

---

## 5. REQUIRED REPORT METRICS

```text
ACT: TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.CORR1
STATUS: PASS
F1_UNKNOWN_CLASSIFICATION: PASS
F2_SECRET_FAIL_CLOSED: PASS
F3_BOT_TOKEN_FAIL_CLOSED: PASS
F4_STORED_APPLICATION_CANONICAL_RETRY: PASS
F5_RECEIVER_RUNTIME_WIRING: PASS
F6_53_CASE_MATRIX: PASS=55 FAIL=0 NOT_TESTED=0
F7_CONCURRENT_SUBMIT_500: CLOSED
F8_INVOICE_SENT_ACTIVE_UNIQUENESS: PASS
F9_NONCE_CLEANUP: PASS
F12_LOG_HARDENING: PASS
F13_HTTPS_FAIL_CLOSED: PASS
STRICT_EXACTLY_ONCE: NO
AMBIGUOUS_SEND: UNKNOWN
AUTOMATIC_RESEND_AFTER_UNKNOWN: NO
NAVIGATOR_BUILD: PASS
NAVIGATOR_REGRESSION: 0 (152/152 PASS)
CHATBOT_REGRESSION: 0 (224 PASS, 2 PRE_EXISTING)
NEW_REGRESSION: 0
FULL_LINT: Batch-5 delta = 0 (clean)
GOOGLE_BEHAVIOR_CHANGED: NO
PAYMENT_BEHAVIOR_CHANGED: NO
PRODUCTION_MUTATION: NONE
LIVE_PII_USED: NO
GIT_MUTATION: NONE
UNRELATED_PREEXISTING_RESIDUE: PRESERVED UNTOUCHED
NEXT: INDEPENDENT IV2
```

---
*End of CORR1 Implementation Report.*
