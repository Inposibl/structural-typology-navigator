# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.IV1

**Date:** 2026-09-24T04:56:00Z
**Auditor:** Claude Opus 5.5 — one-time independent read-only auditor
**Author under audit:** Gemini 3.8 (Antigravity primary coder)
**Controlling design:** PREFLIGHT-1, CORR1, CORR2, CORR3
**Implementation report audited:** `docs/reports/TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_5_APPLICATION_SUBMISSION_AND_DUAL_HANDOFF_1_IMPLEMENTATION_1_20260924T044500Z.md`

The auditor made no source, test, config, DB, or git mutations. All adversarial probes ran from `/tmp/iv1_probe/` and `/tmp/iv1_baseline/`, outside both repositories. They used temporary SQLite files, a mocked `Bot`, and synthetic `.invalid` identities. There was no network send, no SSH, and no production access.

---

## 0. TERMINAL SUMMARY

```text
ACT:                      ...BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.IV1
VERDICT:                  FAIL
BLOCKING:                 1
MAJOR:                    5
MINOR:                    10
BUILD:                    PASS
HMAC:                     PASS (protocol mechanics) — see F-2 fail-open default secret
NONCE_REPLAY:             PASS
APPLICATION_IDEMPOTENCY:  PASS
DELIVERY_CAS:             PASS
UNKNOWN_FAIL_CLOSED:      FAIL (F-1)
COMMERCIAL_AUTHORITY:     PASS
TELEGRAM_CARD_FORMAT:     FAIL (F-4 divergent facts path on resume)
PII_LOGGING:              PASS
GOOGLE_NON_REGRESSION:    PASS
PRODUCTION_MUTATION:      NONE detected (local evidence; production host not remotely inspected by auditor)
LIVE_PII_USED:            NO
GIT_MUTATION:             NONE
```

---

## 1. BASELINES & ATTRIBUTION

### 1.1 Navigator
- Path: `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator`
- Branch: `navigator-production-dialogue-corr2-ab-normalization`
- HEAD: `5f10d73223abe72fc6311d4f60afcca485b57605` (matches the expected baseline). The commit time is 2026-09-24 00:07:52 -0300.
- `git status --porcelain` entries: 64 (unchanged from audit start to audit end)

**Batch-5 author-changed paths.** Attribution uses mtime after the Batch-5 PREFLIGHT-1 file (00:34 local) and diff content:
```text
M  src/app/tikhon-miniapp-pilot/helpers.ts
M  src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx
M  src/app/tikhon-miniapp-pilot/page.tsx
M  src/app/tikhon-miniapp-pilot/miniapp.module.css
?? src/app/api/tikhon/submit-application/route.ts
?? src/app/tikhon-miniapp-pilot/submission.ts
?? src/app/tikhon-miniapp-pilot/submission-screen.tsx
?? tests/tikhon-miniapp/batch-5-submission.test.mts
?? docs/reports/*BATCH_5*  (preflights + implementation report)
```
No additional product path. The only other post-preflight file is `docs/reports/evidence/.DS_Store` (OS noise).

**Unrelated pre-existing residue.** These files were modified before the HEAD commit, or carry no Batch-5 content:
```text
M  AGENTS.md                       (23:19 local 09-23; next-dev agent-rules block)
M  src/lib/chat-contract.ts        (23:06 local 09-23; ConversationChannel/EntryMode types — dialogue work)
?? .zcodeignore, benchmarks/, src/lib/navigation/conversation-first-contact.ts,
   tests/navigation/first-contact.test.mts, tests/tikhon-miniapp/live-data-binding.test.mts,
   docs/* (non-Batch-5 reports)
```
There are no Navigator RAG or dialogue changes in the Batch-5 set.

### 1.2 Chatbot
- Path: `/Users/entp_psyche/Desktop/InvestProjects2026/chatbot`
- Branch: `feat/telegram-shared-brain-integration-1`
- HEAD: `c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183` (matches the expected baseline)

**Batch-5 author-changed paths.** These are exactly the files newer than the Batch-5 PREFLIGHT-1 file, and every one of them is on the expected list:
```text
M  calendar_service.py          (+3/-3 titles only)
M  data/calendar_cache.json     (+3/-3 titles only)
M  config.py                    (+3: curator_chat_id, curator_username, tikhon_internal_secret)
M  database.py                  (+131: 4 columns, ApplicationDelivery, S2SRequestNonce, apply_migrations)
M  handlers/client.py           (notify_operator_new_application → canonical formatter)
?? application_formatter.py
?? delivery_service.py
?? api_service.py               (untracked before Batch 5; handle_submit_application added)
?? tests/test_batch5_submission.py
```
**Unrelated pre-existing residue** (all mtimes before 2026-09-24): `.env.example`, `.gitignore`, `README.md`, `data_engine/lebedev_adapter.py`, `data_engine/sheets_sync.py` (09-23 07:43), `keyboards.py`, `requirements.txt`, every `*.bak_*`, `AGENTS*.md`, `data_engine/*` new modules, `deploy/`, `scripts/`, `reminder_scheduler.py`, `zoom_service.py`, non-Batch-5 tests and docs.

---

## 2. MECHANICAL VALIDATION

### 2.1 Navigator
| Command | Result |
|---|---|
| `npx tsx --env-file=.env.local --test tests/tikhon-miniapp/batch-5-submission.test.mts` | tests 26 / pass 26 / fail 0 |
| `npx tsx --env-file=.env.local --test tests/tikhon-miniapp/*.test.mts` | tests 140 / suites 8 / pass 140 / fail 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | **exit 0**. Next.js 16.3.5, route `ƒ /api/tikhon/submit-application` emitted |
| `npm run lint` | exit 1: 10 problems (9 errors, 1 warning), **all PRE_EXISTING** (see 2.2) |
| targeted `eslint --max-warnings=0` on route.ts, submission.ts, submission-screen.tsx, helpers.ts, legal-entity-flow.tsx, batch-5-submission.test.mts | exit 0, 0 problems |
| `git diff --check` | exit 0. Untracked Batch-5 files have no trailing whitespace and end with a newline |

### 2.2 Full-lint classification
| File | Problems | Classification | Evidence |
|---|---|---|---|
| `src/app/api/tikhon/student-status/route.ts` | 2× no-explicit-any | PRE_EXISTING | file unmodified vs HEAD |
| `src/app/tikhon-miniapp-pilot/page.tsx` | 7× react-hooks/set-state-in-effect | PRE_EXISTING | `git show HEAD:page.tsx \| eslint --stdin` → 7 errors of the same rule; working tree gives 7 (line-shifted). Delta 0 |
| `tests/tikhon-miniapp/batch-1-corr1-entitlements.test.mts` | 1 warning | PRE_EXISTING | file unmodified vs HEAD |

**Lint delta introduced by Batch 5: 0.**

### 2.3 Chatbot
| Command | Result |
|---|---|
| `./venv/bin/python -m unittest tests/test_batch5_submission.py` | Ran 18, OK |
| `./venv/bin/python -m unittest discover -s tests -p 'test_*.py'` | **Ran 189 in 10.3 s. FAILED (failures=2)**. Terminated normally, no hang |
| `py_compile` on all 8 changed/new modules and tests | OK |
| import of calendar_service, config, database, application_formatter, delivery_service, api_service, handlers.client | OK |
| `data/calendar_cache.json` JSON parse | OK |
| `git diff --check` | exit 0 |

The 2 failures are:
- `test_cohort_limits.TestCohortLimitsAndDeadlines.test_keyboard_rendering_with_availability`
- `test_welcome_flow.TestWelcomeKitFlow.test_client_start_welcome_text_contains_tikhon`

**Both are PRE_EXISTING.** They reproduce identically in `/tmp/iv1_baseline`, a copy where the Batch-5 tracked files were restored to HEAD (`git show HEAD:<f>`) and the Batch-5 new files were removed.

---

## 3. FLAGSHIP COURSE AUTHORITY — PASS
- The `structural_typology` values in `calendar_service.py:205-231` and in `data/calendar_cache.json` are:
  - `level_1` = `Введение в теорию`, 50 000
  - `level_2` = `Основной курс`, 100 000
  - `level_3` = `Экспертный уровень`, 50 000
  - `full_prepayment` = 160 000, base 200 000, discount 20
- IDs are unchanged. The diff touches titles only.
- The Navigator has no hardcoded replacement titles. A grep for old and new titles across `src/` and `tests/tikhon-miniapp` returns 0 matches, so the Mini App consumes the projection.

## 4. CURATOR / ACCOUNTING — PASS (with F-5 context)
- `config.py:59-60`: `CURATOR_CHAT_ID` defaults to `8807727029` and `CURATOR_USERNAME` to `Lebedev_AST`.
- ACCOUNTING = `settings.operator_chat_id` (`delivery_service.py:40,262`). This matches the CORR2 design (production `.env` update deferred). Local `chatbot/.env` `OPERATOR_CHAT_ID` equals `-1003990047416`. Its mtime is 2026-09-23 16:56, before Batch 5, so Implementation-1 did not change it.
- Client injection: the route forwards a fixed key allowlist. The probe shows the forwarded keys are `cohort_id, course_id, email, first_name, full_name, last_name, payer_type, phone, pricing_option_id, user_id, username`. The receiver ignores `chat_id`, `destination`, `curator_chat_id`, and `accounting_chat_id`. In the probe, `send_message` targets were exactly `[8807727029, -1003990047416]`.
- Real Telegram send: none observed. `start_api_server` is never invoked (F-5), and all tests and probes use mocks.

## 5. SUCCESS COPY — PASS
- The exact string is `helpers.ts:202-203` `SUCCESS_COPY_VERBATIM`. It is rendered at `submission-screen.tsx:97` and returned by `api_service.py:386`.
- The curator link is `https://t.me/Lebedev_AST` (`helpers.ts:206`), opened through `openTelegramLink`.
- `@AST_lebedev` / `AST_lebedev` has **0 product-flow matches** in either repo (`grep -rI`, excluding venv/.git). The only matches are the negative assertion in `batch-5-submission.test.mts:75-85` and historical docs.

## 6. TELEGRAM CARD FORMATTER — FAIL (F-4)
- There is one formatter, `application_formatter.format_telegram_application_card`. It is used by the Mini App receiver and by the legacy bot flow (`handlers/client.py`).
- The individual card has the `Физлицо (СБП/перевод)` label, ФИО, phone (`не указан` when absent, no crash), email, course, tariff, cohort, schedule, amount, and status.
- The legal/IP card has inn, company_name, optional КПП (omitted for IP), optional address, bik, account, edo_type, doc_email, and contact. It does not render the derived `entity_type` (F-11). `entity_type` is derived server-side from INN length (`api_service.py:278-283`) and persisted. The client-sent `entity_type` is ignored.
- OGRN/OGRNIP are not collected. The Batch-4 test `7` asserts the form omits them, and the receiver never reads `ogrn`. The `applications.ogrn` column is pre-existing.
- `html.escape` is applied to every interpolated field.
- **Defect F-4:** on the idempotent-resume path, the card is rebuilt from the current request's PII rather than from the persisted application.

## 7. SERVER COMMERCIAL AUTHORITY — PASS
Traced data path:
1. The browser sends a draft.
2. The route picks only IDs and payer fields (`route.ts:66-167`). `user_id`, `username`, and names come from verified initData only. The probe's body `user_id: 1` was replaced by the initData id.
3. The receiver resolves `course`, `cohort`, and `pricing_option` from the registry by ID (`api_service.py:218-234`).
4. `amount`, `course_name`, `pricing_option_title`, `cohort_title`, `cohort_schedule`, and chat IDs are all server-derived.

In the probe, a body with `amount:1, course_name:"X", pricing_option_title:"Y", cohort_schedule:"Z", discount_percent:99` produced both cards with `50 000 ₽`, `Введение в теорию`, and `По воскресеньям в 18:00 МСК`. No injected text appeared, and the two cards were identical.

## 8. APPLICATION IDEMPOTENCY — PASS (MINOR F-7, F-8)
- Schema: `applications.active_application_key` plus the partial unique index `uq_active_application_key ... WHERE status='new'` (`database.py:164-170`).
- Key: `app:{user_id}:{course}:{cohort}:{pricing}:{payer_type}:{email.lower()|inn}` (`api_service.py:291`).
- **Probe, 10 concurrent identical signed submissions:** 1 application row and 2 `send_message` calls (one per destination). The HTTP results were 8×200 and 2×500. The 500s are an unhandled `IntegrityError` race in `ensure_delivery_records` (F-7). A repeat with 3×10 concurrent requests gave 3 rows and 6 sends.
- **Non-collision probe:** different pricing (level_2, full_prepayment), different email, different cohort, and different course each produced a distinct application (ids 1–6).
- A `paid` prior application allows a new one (id 7).
- An `invoice_sent` prior application **also** allows a duplicate active application (F-8).

## 9. DUAL DELIVERY STATE MACHINE — DELIVERY_CAS PASS / UNKNOWN_FAIL_CLOSED FAIL
- The states PENDING/SENDING/DELIVERED/FAILED/UNKNOWN are present.
- The CAS is `UPDATE ... SET status='SENDING' WHERE status IN ('PENDING','FAILED')`, with rowcount==1 checked (`delivery_service.py:104-125`). It is committed **before** `bot.send_message` (`:187`).
- The final write is fenced by `attempt_token`.
- DELIVERED and UNKNOWN are skipped and never auto-resent (`:290-295`).
- **Defect F-1 (BLOCKING):** `except Exception` defaults to FAILED (`:214-229`). aiogram 3.22.0 wraps every aiohttp `ClientError` into `TelegramNetworkError`, which inherits `TelegramAPIError → Exception` and not `OSError`. The code therefore recognises only messages containing "timeout" or "reset by peer" as ambiguous.

  | Injected exception (accounting destination) | Recorded | User retry | Accounting send attempts |
  |---|---|---|---|
  | `TelegramNetworkError("ServerDisconnectedError: Server disconnected")` | FAILED | 200 SUCCESS | **2 (duplicate)** |
  | `TelegramNetworkError("ClientPayloadError: Response payload is not completed")` | FAILED | 200 SUCCESS | **2 (duplicate)** |
  | `TelegramServerError("Bad Gateway")` (5xx) | FAILED | 200 SUCCESS | **2 (duplicate)** |
  | `TelegramNetworkError("Request timeout error")` | UNKNOWN | 502 | 1 (correct) |
  | non-network exception (`"database is locked"`) | FAILED | — | — |

  In addition, the DELIVERED `UPDATE`/`commit` sits inside the same `try` as `send_message` (`:186-212`). A local DB exception raised **after** Telegram accepted the message is therefore classified FAILED, and the message becomes eligible for resend. This violates CORR3 §4.3/§5 and authorization §9.

## 10. CRASH / STALE SENDING — PASS
- `reconcile_stale_sending_claims` moves SENDING rows older than 60 s to UNKNOWN (`:62-87`), never to FAILED.
- A late-finishing original sender can still write DELIVERED, because the write is keyed on `attempt_token`. That is acceptable.
- Final SUCCESS requires `CURATOR=='DELIVERED' and ACCOUNTING=='DELIVERED'` (`api_service.py:372-381`). Every other state gives 502 `PARTIAL_OR_FAILED`.
- The route and the client each additionally require `status==="SUCCESS"` together with `ok`.

## 11. S2S HMAC — PASS (mechanics) / F-2
- The canonical string is `TIKHON-S2S-V1\nPOST\n/api/v1/applications\n{ts}\n{nonce}\n{sha256(raw body)}` on both sides (`route.ts:179`, `api_service.py:159-166`).
- The receiver hashes raw bytes and uses `hmac.compare_digest`.
- Probes:
  - body tampering → 401
  - timestamp −301 s → 401
  - wrong-path signature → 401
  - missing headers → 401
- The raw secret is not transmitted. The probe scanned the captured URL, headers, and body.
- **F-2:** both sides default to the same public literal `test_internal_secret_key_ast_2026` when `TIKHON_INTERNAL_SECRET` is unset.

## 12. DURABLE NONCE — PASS (MINOR F-9)
- Nonces persist in the SQLite table `s2s_request_nonces` (PK `nonce`).
- The order is headers → timestamp → body hash → canonical → HMAC → INSERT → IntegrityError→409 (`api_service.py:129-197`).
- Probe: a bad HMAC with nonce N gives 401. A subsequent valid request with the same nonce N gives **200**, which proves no reservation or poisoning. A replay of that request gives 409.
- `expires_at = ts + 300 s`, which equals the acceptance boundary, so cleanup by `expires_at < now` cannot re-open a replay window. No cleanup job is implemented (F-9).

## 13. PII / LOGGING — PASS
Audited statements:
- `route.ts:204-206,226-228,255`: course_id, status, latency, app_id, network error message.
- `api_service.py:171,181,196,374-378`: ids and statuses only.
- `delivery_service.py:216-218`: app_id, destination, destination chat_id, exception text.

Probe, with Уникальноимя / email / phone / INN / KPP / BIK / account / doc_email / contact / username / user_id markers:
- At **INFO** (the production `basicConfig(level=logging.INFO)` in `main.py:19-20`): 0 leaking lines.
- At DEBUG: only the third-party `aiosqlite` logger echoes bound parameters (F-14).
- The secret was never logged.

## 14. CLIENT SUBMISSION UX — PASS
- There is a submit CTA "Оформить заявку" for both individual (`page.tsx:1483-1494`) and legal/IP (`legal-entity-flow.tsx:620-635`). Each is `disabled` while `submissionState==="submitting"`, and the screen switches to `submission_result` immediately.
- SUCCESS shows only on route `status==="SUCCESS"`.
- The error state has an alert, a retry button, and a back button.
- Retry re-posts. Server idempotency resumes the same application, and DELIVERED destinations are not resent (chatbot test `test_partial_delivery_retry_semantics`).
- There is no `localStorage`/`sessionStorage`/`indexedDB`/cookie use in `src/app/tikhon-miniapp-pilot/`.
- There is no client correlation UUID. Duplicate guarding is server-side.
- A scan of the client static bundle (`.next/static`) found no bot token or S2S secret.

## 15. PAYMENT SCOPE — PASS
Batch 5 adds no payment initiation, SBP transaction, acquiring, invoice issuing, payment confirmation, refund, reconciliation, payment webhook, Finance.xlsx code, or new `paid`-transition logic. The only matches in the Batch-5 modules are `acquire_delivery_claim` and `reconcile_stale_sending_claims`, which are delivery-only.

## 16. GOOGLE NON-REGRESSION — PASS
- `data_engine/sheets_sync.py` was modified 2026-09-23 07:43 (pre-existing residue, before Batch 5). Batch 5 did not touch it.
- The Batch-5 diff hunks in `calendar_service.py` are title-only. The Google Sheets lines at `:538-548` are unchanged context.
- `handlers/client.py`'s Batch-5 hunk does not touch sheets.
- None of the new modules import Google.
- The pre-existing Google tests (`test_sheets_sync.py`, `test_schedule_sheets_sync.py`) pass in the full run.
- Google-related paths changed by Batch 5: **none**.
- NEW_GOOGLE_DEPENDENCY: **NO**.

## 17. PRODUCTION SAFETY
- Local `chatbot/.env` (09-23 16:56), `chatbot/ast_bot.db` (09-23 15:28), and Navigator `.env.local` (09-23 16:38) are all unmodified.
- `deploy/` and `scripts/` have no files newer than the Batch-5 preflight.
- `.git/index` in both repos was not written after the baselines, so nothing was staged.
- The receiver is not wired into `main.py`, so it cannot have been running.
- The auditor did not SSH to the production host.
- Privacy/legal gate remains **OPEN_FOR_LIVE_PRODUCTION**. Do not deploy.

---

## 18. REQUIRED 53-CASE COVERAGE MATRIX

C = `chatbot/tests/test_batch5_submission.py`; N = `navigator/tests/tikhon-miniapp/batch-5-submission.test.mts`; B4 = `batch-4-legal-entity.test.mts`

| # | Requirement | Test | File | Result |
|---|---|---|---|---|
| 1 | individual normal submit | `test_success_condition_requires_both_delivered` (case B) | C | PASS |
| 2 | phone present | `test_individual_with_phone_and_html_escaping` | C | PASS |
| 3 | phone absent | `test_individual_application_card_structure` (`не указан`) | C | PASS |
| 4 | exact card structure | `test_individual_application_card_structure` | C | PASS |
| 5 | payment-type label | `test_individual_application_card_structure` | C | PASS |
| 6 | legal entity | `test_legal_entity_and_ip_submission` | C | PASS |
| 7 | IP | `test_legal_entity_and_ip_submission` | C | PASS |
| 8 | legal entity with KPP | `test_legal_entity_and_ip_card` + `test_legal_entity_and_ip_submission` | C | PASS |
| 9 | IP without KPP | `test_legal_entity_and_ip_card` | C | PASS |
| 10 | doc_email persisted | `test_legal_entity_and_ip_submission` | C | PASS |
| 11 | contact_person persisted | `test_legal_entity_and_ip_submission` | C | PASS |
| 12 | entity_type persisted | `test_legal_entity_and_ip_submission` | C | PASS |
| 13 | OGRN not collected | `7: OGRN / OGRNIP is not collected` + `assertIsNone(app_le.ogrn)` | B4 + C | PASS |
| 14 | client cannot override amount | `test_canonical_commercial_authority_cannot_be_overridden_by_client` | C | PASS |
| 15 | client cannot override course title | same | C | PASS |
| 16 | client cannot override schedule | — (schedule never injected, never asserted) | — | NOT_TESTED |
| 17 | level_1 title | `test_flagship_level_names_exact_authority` | C | PASS |
| 18 | level_2 title | same | C | PASS |
| 19 | level_3 title | same | C | PASS |
| 20 | prices unchanged | same + `test_calendar_cache_json_synced` | C | PASS |
| 21 | full-prepayment discount | `test_flagship_level_names_exact_authority` | C | PASS |
| 22 | missing HMAC headers | `test_missing_auth_headers_rejected` | C | PASS |
| 23 | expired timestamp | `test_expired_timestamp_rejected` | C | PASS |
| 24 | bad HMAC | `test_bad_hmac_rejected_and_cannot_poison_nonces` | C | PASS |
| 25 | body tampering | `test_body_tampering_rejected` | C | PASS |
| 26 | valid HMAC | `test_replay_nonce_rejected` (first request 200) | C | PASS |
| 27 | duplicate nonce | `test_replay_nonce_rejected` | C | PASS |
| 28 | bad HMAC cannot reserve nonce | `test_bad_hmac_rejected_and_cannot_poison_nonces` | C | PASS |
| 29 | duplicate sequential submit | `test_partial_delivery_retry_semantics` (same app_id) + `test_active_application_key_uniqueness` | C | PASS |
| 30 | concurrent duplicate submit | — (no concurrent test) | — | NOT_TESTED |
| 31 | different course allowed | — | — | NOT_TESTED |
| 32 | different cohort/tier allowed | — (existing variants also change payer identity → confounded) | — | NOT_TESTED |
| 33 | resolved prior permits new | `test_active_application_key_uniqueness` (`paid`) | C | PASS |
| 34 | both targets delivered | `test_success_condition_requires_both_delivered` (B) | C | PASS |
| 35 | same-destination concurrent claim | — (`test_atomic_claim_and_no_duplicate_send` is sequential only) | — | NOT_TESTED |
| 36 | DELIVERED never resent | `test_atomic_claim_and_no_duplicate_send`, `test_partial_delivery_retry_semantics` | C | PASS |
| 37 | FAILED safe retry | `test_partial_delivery_retry_semantics` | C | PASS |
| 38 | UNKNOWN never auto-retried | `test_stale_claim_recovery_to_unknown` | C | PASS |
| 39 | one delivered / other failed | `test_success_condition_requires_both_delivered` (A) | C | PASS |
| 40 | one delivered / other unknown | — | — | NOT_TESTED |
| 41 | success forbidden until both delivered | `test_success_condition_requires_both_delivered` | C | PASS |
| 42 | destination injection | — (C sends `chat_id` but never asserts targets; N `3.4` is a source-string grep) | — | NOT_TESTED |
| 43 | bot token absent client-side | — | — | NOT_TESTED |
| 44 | raw secret never transmitted | — | — | NOT_TESTED |
| 45 | applicant HTML escaped | `test_individual_with_phone_and_html_escaping` | C | PASS |
| 46 | PII absent from logs | — (N `6.2` greps 5 literal patterns only; no C log test) | — | NOT_TESTED |
| 47 | repeated submit blocked while SUBMITTING | — (no assertion on CTA `disabled`) | — | NOT_TESTED |
| 48 | exact success copy | `1.1`, `5.5` (N); `test_success_condition_requires_both_delivered` (C) | N + C | PASS |
| 49 | controlled failure state | `5.6` | N | PASS |
| 50 | Batch-2 regression | `batch-2-pricing-payer.test.mts` (140/140 suite) | N | PASS |
| 51 | Batch-3 regression | `batch-3-individual-enrollment.test.mts` | N | PASS |
| 52 | Batch-4 regression | `batch-4-legal-entity.test.mts` | N | PASS |
| 53 | Google untouched | `test_sheets_sync.py`, `test_schedule_sheets_sync.py` pass + auditor diff | C-suite | PASS |

**PASS=42  FAIL=0  NOT_TESTED=11** (#16, 30, 31, 32, 35, 40, 42, 43, 44, 46, 47).

The auditor's probes exercised #16, 30, 31, 32, 42, 44, and 46, and the behavior was correct. They remain NOT_TESTED because no committed test proves them. No test covers aiogram exception classification, which is where F-1 lives.

---

## 19. FINDINGS

### BLOCKING

**F-1 — Ambiguous Telegram failures are classified FAILED and resent automatically (duplicate delivery).**
`chatbot/delivery_service.py:186-246`. The generic `except Exception` defaults to `FAILED`. The ambiguity test is `isinstance(e, (asyncio.TimeoutError, ConnectionError, OSError))` or a substring match on "timeout" / "reset by peer". In aiogram 3.22.0 (`client/session/aiohttp.py:181-184`), every `aiohttp.ClientError` is re-raised as `TelegramNetworkError`, which is not an `OSError`.

As a result, the following are all FAILED, and the next user retry claims them again (`status IN ('PENDING','FAILED')`) and resends:
- `ServerDisconnectedError`
- `ClientPayloadError` (the response was truncated after Telegram received the request)
- `TelegramServerError` 5xx

The probe observed 2 sends to accounting. In addition, the post-send `UPDATE ... DELIVERED` and `commit` share the `try` with `send_message`. A local exception after Telegram accepts the message is therefore also classified FAILED.

This is the exact pattern the authorization forbids ("generic except Exception -> FAILED"), and it contradicts CORR3 §4.3 `AUTOMATIC_DUPLICATE_SEND: FORBIDDEN`.

### MAJOR

**F-2 — Shared hardcoded S2S secret default (fail-open).**
`chatbot/config.py:61` and `navigator/src/app/api/tikhon/submit-application/route.ts:174-175` both fall back to `"test_internal_secret_key_ast_2026"`. That literal is in source and in `tests/test_batch5_submission.py:409`. The receiver's "secret not configured → 500" guard (`api_service.py:169-172`) is dead code, because the default is non-empty.

If `TIKHON_INTERNAL_SECRET` is omitted on the VPS, anyone who has read the source can forge signed applications. Those applications trigger curator and accounting sends. The Navigator probe confirmed that, with the env unset, the forward is signed with this public literal.

**F-3 — Placeholder bot-token fallback makes Telegram initData forgeable.**
`route.ts:51-53` uses `BOT_TOKEN || TELEGRAM_BOT_TOKEN || "PLACEHOLDER_BOT_TOKEN"`. In the probe, with both env vars unset, initData forged with `PLACEHOLDER_BOT_TOKEN` for arbitrary user `424242` was accepted (HTTP 200) and forwarded.

The existing `student-status/route.ts:104-116` fails closed instead. It also uses the opposite precedence (`TELEGRAM_BOT_TOKEN` first), so the two routes can validate against different tokens.

**F-4 — Resume path delivers facts that diverge from the stored application.**
`api_service.py:326-360`. On an `IntegrityError`, the existing application id is reused. The card, however, is formatted from the current request's `full_name`, `phone`, `company_name`, `bik`, `account`, `kpp`, `edo_type`, `contact_person`, and `company_address`, and the key does not cover these fields.

Probe:
1. First submit: curator DELIVERED with "Первая Версия", accounting FAILED.
2. Retry with an edited name and phone gave SUCCESS.
3. Accounting received "Вторая Версия", while the curator card and the DB row both hold "Первая Версия".

For legal entities, accounting can therefore receive bank requisites (`account`/`bik`) that differ from the persisted record and from the curator's card. This violates "one canonical facts path drives both destinations".

**F-5 — The S2S receiver is not wired into any runtime.**
`start_api_server`/`create_api_app` are referenced only in `api_service.py` and the Batch-5 test. `main.py` is unmodified and never starts the aiohttp app.

CORR1 §(line 46) and CORR2 §3 place the receiver at `127.0.0.1:8080` inside `ast_bot.service`. Without this wiring, the Navigator forward (default `http://127.0.0.1:8080/...`) cannot reach a receiver, and the end-to-end submission is non-functional. The implementation report's "ALL SEAMS IMPLEMENTED" is therefore inaccurate.

**F-6 — Material invariants are untested (11 NOT_TESTED).**
The committed suites do not prove:
- concurrent duplicate submission (#30)
- concurrent claim (#35)
- mixed DELIVERED/UNKNOWN outcome (#40)
- destination injection (#42)
- secret non-transmission (#44)
- PII-free logs (#46)
- SUBMITTING lock (#47)
- schedule override (#16)
- non-collision cases (#31, #32)
- client bundle secrecy (#43)

There is also no test at all for exception classification into UNKNOWN versus FAILED. F-1 went undetected because of that gap. Several Navigator tests (`3.1–3.4`, `5.x`, `6.2`) are source-string greps rather than behavioral assertions.

### MINOR

**F-7 — Uncontrolled HTTP 500 under concurrent identical submits.**
`delivery_service.ensure_delivery_records` does select-then-insert without `ON CONFLICT`. In the probe, 2 of 10 concurrent requests raised `IntegrityError (autoflush)` → 500. The invariants still held (1 row, 1 send per destination).

**F-8 — The partial index treats `invoice_sent` as resolved.**
`WHERE status='new'` (as specified in the CORR2 §5.2 SQL) contradicts CORR2's own resolution rule, where only `paid`/`canceled`/`rejected` count as resolved. `handlers/operator.py:151` sets `invoice_sent`. In the probe, a resubmit after `invoice_sent` created a second active application and new dual sends. This is design-inherited, so the owner should adjudicate.

**F-9 — No nonce cleanup job.**
CORR3 §7.2 step 8 is not implemented, so `s2s_request_nonces` grows without bound. There is no replay impact, because `expires_at` = the acceptance boundary.

**F-10 — Mini App cards carry no operator keyboard.**
`deliver_application_dual` sends no `reply_markup`, so Mini App applications cannot be moved out of `new` with the existing operator buttons. As a result, "resolved → new application allowed" (#33) is reachable only by manual DB edit. Paid-state logic is out of Batch-5 scope, so this is noted for the owner.

**F-11 — The legal/IP card does not render derived `entity_type`.**
The header `🏢 Юрлицо / ИП` is generic. The value is persisted only.

**F-12 — The Navigator logs `course_id` before validation.**
`route.ts:205,227` log a client-supplied, unvalidated `course_id`, which is a log-injection surface (not PII). Line 205 also logs `netErr.message`.

**F-13 — The transport default is plain HTTP.**
`TIKHON_RUSSIAN_SERVER_URL` defaults to `http://127.0.0.1:8080/...` (`route.ts:186-187`). The implementation report's "Forwards … over TLS 1.3" depends entirely on deployment config. There is no fail-closed check for an `https:` scheme.

**F-14 — Log hygiene edge cases.**
- At DEBUG level, the third-party `aiosqlite` logger emits bound SQL parameters, which include applicant PII. Production uses INFO, so there is no leak today.
- `delivery_service.py:216-218` logs the destination chat_id (the curator's Telegram user id) and the raw exception text.

**F-15 — Implementation report overstatements.**
- "ALL SEAMS IMPLEMENTED" (see F-5)
- "TLS 1.3" (see F-13)
- "26 comprehensive automated tests", when many are source greps (see F-6)
- "OPERATOR_CHAT_ID=-1003990047416 remains local/synthetic". The local `.env` value is real and pre-existing, and it was not changed by Implementation-1.

**F-16 — UNKNOWN has no user guidance or recovery tooling.**
An application with an UNKNOWN destination returns 502 with a generic message on every retry, and never tells the user to contact the curator. The CORR3 §5.3 operator reconciliation commands (UNKNOWN→DELIVERED/PENDING) are not implemented.

---

## 20. RETURN BLOCK

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1.IV1

VERDICT:
FAIL

BLOCKING:
1

MAJOR:
5

MINOR:
10

NAVIGATOR_BASELINE:
navigator-production-dialogue-corr2-ab-normalization @ 5f10d73223abe72fc6311d4f60afcca485b57605

CHATBOT_BASELINE:
feat/telegram-shared-brain-integration-1 @ c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183

AUTHOR_CHANGED_PATHS:
navigator: src/app/api/tikhon/submit-application/route.ts (new), src/app/tikhon-miniapp-pilot/submission.ts (new),
  src/app/tikhon-miniapp-pilot/submission-screen.tsx (new), src/app/tikhon-miniapp-pilot/helpers.ts (M),
  src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx (M), src/app/tikhon-miniapp-pilot/page.tsx (M),
  src/app/tikhon-miniapp-pilot/miniapp.module.css (M), tests/tikhon-miniapp/batch-5-submission.test.mts (new),
  docs/reports/*BATCH_5* (preflights + implementation report)
chatbot: calendar_service.py (M), data/calendar_cache.json (M), config.py (M), database.py (M),
  handlers/client.py (M), application_formatter.py (new), delivery_service.py (new),
  api_service.py (untracked; Batch-5 handler added), tests/test_batch5_submission.py (new)

UNRELATED_PREEXISTING_PATHS:
navigator: AGENTS.md, src/lib/chat-contract.ts, .zcodeignore, benchmarks/, src/lib/navigation/conversation-first-contact.ts,
  tests/navigation/first-contact.test.mts, tests/tikhon-miniapp/live-data-binding.test.mts, non-Batch-5 docs/*
chatbot: .env.example, .gitignore, README.md, data_engine/lebedev_adapter.py, data_engine/sheets_sync.py, keyboards.py,
  requirements.txt, all *.bak_*, AGENTS*.md, ANTIGRAVITY_CONTROLLER_PROMPT.md, Antigravity_Antigallucination.md, Dockerfile,
  docker-compose.yml, SKILL.md, data_engine/* untracked modules, deploy/, scripts/, reminder_scheduler.py, zoom_service.py,
  non-Batch-5 tests/*, docs/*

53_CASE_MATRIX:
PASS=42
FAIL=0
NOT_TESTED=11

BUILD:
PASS

FULL_NAVIGATOR_REGRESSION:
tests/tikhon-miniapp/*.test.mts — tests 140, suites 8, pass 140, fail 0

FULL_CHATBOT_REGRESSION:
Ran 189, FAILED (failures=2) — both PRE_EXISTING (reproduced with Batch-5 files reverted):
test_cohort_limits.test_keyboard_rendering_with_availability; test_welcome_flow.test_client_start_welcome_text_contains_tikhon

FULL_LINT:
10 problems (9 errors, 1 warning), all PRE_EXISTING; page.tsx 7 @HEAD vs 7 now; Batch-5 delta = 0

TARGETED_LINT:
6 Batch-5 TS/TSX/test files — exit 0, 0 problems

TYPECHECK:
PASS (exit 0)

HMAC:
PASS (protocol mechanics; fail-open default secret = F-2)

NONCE_REPLAY:
PASS

APPLICATION_IDEMPOTENCY:
PASS

DELIVERY_CAS:
PASS

UNKNOWN_FAIL_CLOSED:
FAIL

COMMERCIAL_AUTHORITY:
PASS

TELEGRAM_CARD_FORMAT:
FAIL

PII_LOGGING:
PASS

GOOGLE_NON_REGRESSION:
PASS

PRODUCTION_MUTATION:
NONE (local evidence; production host not remotely inspected by auditor)

LIVE_PII_USED:
NO

GIT_MUTATION:
NONE

FINDINGS:
F-1 BLOCKING  ambiguous aiogram TelegramNetworkError/TelegramServerError and post-send exceptions → FAILED → automatic resend (delivery_service.py:186-246)
F-2 MAJOR     shared hardcoded S2S secret default in both repos; receiver misconfiguration guard dead
F-3 MAJOR     PLACEHOLDER_BOT_TOKEN fallback → forged initData accepted when env unset; token precedence differs from student-status
F-4 MAJOR     resume path formats card from current request PII, not stored row → divergent destination facts
F-5 MAJOR     S2S receiver never started (main.py not wired); end-to-end submission non-functional
F-6 MAJOR     11 of 53 required cases NOT_TESTED, incl. concurrency and UNKNOWN classification
F-7 MINOR     concurrent identical submits → uncontrolled 500 (ensure_delivery_records race)
F-8 MINOR     invoice_sent outside partial index → duplicate active application (design-inherited)
F-9 MINOR     no nonce cleanup job
F-10 MINOR    Mini App cards lack operator keyboard; resolution path manual only
F-11 MINOR    legal/IP card omits derived entity_type
F-12 MINOR    Navigator logs unvalidated client course_id / raw network error
F-13 MINOR    default upstream URL is plain HTTP; TLS claim depends on env
F-14 MINOR    aiosqlite DEBUG logs PII if level lowered; delivery log carries destination chat_id
F-15 MINOR    implementation report overstatements
F-16 MINOR    UNKNOWN: no user guidance, no operator reconciliation tooling

NEXT:
OWNER REVIEW

STOP.
```
