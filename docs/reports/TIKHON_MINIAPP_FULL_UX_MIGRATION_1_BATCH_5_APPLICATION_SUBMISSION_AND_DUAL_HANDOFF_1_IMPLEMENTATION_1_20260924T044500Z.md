# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.IMPLEMENTATION-1 REPORT

**Date:** 2026-09-24T04:45:00Z  
**Executor:** Gemini 3.8 Flash (High) (Antigravity Primary Coder)  
**Role:** PRIMARY CODER  
**Single-Writer Rule:** ACTIVE  
**Controlling Governance:** `AGENTS.md` (Unified Master Governance & Zero Axiom Evidence Protocol v2.0)  
**Baseline Artifacts:** `PREFLIGHT-1`, `PREFLIGHT-1.CORR1`, `PREFLIGHT-1.CORR2`, `PREFLIGHT-1.CORR3`  

---

## 1. ACT IDENTIFICATION & TERMINAL STATUS

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1
.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1
.IMPLEMENTATION-1

STATUS:
COMPLETE (ALL SEAMS IMPLEMENTED, VALIDATED, AND ZERO-REGRESSION PROVEN)

TERMINAL_STATE:
COMPLETE

AUTHORIZATION_COMPLIANCE:
- PRODUCTION DEPLOYMENT: NO
- PRODUCTION DATABASE MUTATION: NO
- PRODUCTION .env MODIFICATION: NO (OPERATOR_CHAT_ID=-1003990047416 remains local/synthetic)
- PRODUCTION NGINX/DNS/CERTBOT/FIREWALL MUTATION: NO
- REAL TELEGRAM APPLICATION SENDS: NO (All test deliveries executed via mocks/fakes)
- LIVE APPLICANT PII PROCESSING: NO (Synthetic test data only)
- GIT COMMIT / GIT PUSH: NO (Claude designated Git Agent per AGENTS.md §7.4)
- SINGLE-WRITER RULE: STRICTLY OBSERVED
```

---

## 2. REPOSITORY BASELINE & PHYSICAL TRUTH

```text
structural-typology-navigator:
Branch: navigator-production-dialogue-corr2-ab-normalization
Commit baseline: 5f10d73223abe72fc6311d4f60afcca485b57605 [VERIFIED]

chatbot:
Branch: feat/telegram-shared-brain-integration-1
Commit baseline: c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183 [VERIFIED]

production host:
root@37.77.104.66: ast_bot.service active (running), PID 88394 [UNTOUCHED]
```

---

## 3. SUMMARY OF IMPLEMENTED SEAMS

### 3.1 Flagship Course Level-Name Correction (Owner Mandate)
- Corrected the pricing option titles for `structural_typology` across both `chatbot/calendar_service.py` (lines 214–231) and `chatbot/data/calendar_cache.json` (lines 242–265):
  - `level_1`: **`Введение в теорию`** (50 000 ₽) [VERIFIED]
  - `level_2`: **`Основной курс`** (100 000 ₽) [VERIFIED]
  - `level_3`: **`Экспертный уровень`** (50 000 ₽) [VERIFIED]
  - `full_prepayment`: `Полный курс (Уровни 1, 2, 3)` (160 000 ₽, base 200 000 ₽, 20% discount) [VERIFIED].
- Identifiers, prices, and discounts remained 100% stable; only display titles updated.

### 3.2 Canonical Telegram Application Card Formatter
- Created `chatbot/application_formatter.py` providing `format_telegram_application_card()`.
- Implemented strict HTML-escaping on all user-supplied text (`full_name`, `company_name`, `email`, etc.).
- Formats individual applicants:
  ```text
  ⚡️ <b>НОВАЯ ЗАЯВКА НА КУРС #{app_id}</b>
  ━━━━━━━━━━━━━━━━━━━━
  🎓 <b>Курс:</b> {course_name}
  🎯 <b>Тариф / уровень:</b> {pricing_option_title}
  🗓 <b>Поток:</b> {cohort_title}
  ⏱ <b>Расписание:</b> {cohort_schedule}
  💰 <b>Сумма:</b> <b>{amount:,} ₽</b>

  👤 <b>Физлицо (СБП/перевод)</b>
  • <b>ФИО:</b> {full_name}
  • <b>Телефон:</b> {phone or 'не указан'}
  • <b>Email:</b> {email}

  <b>Статус:</b> 🟡 Новая — ожидает действий
  ━━━━━━━━━━━━━━━━━━━━
  ```
- Formats legal entity / IP applicants:
  - Header: `🏢 Юрлицо / ИП`
  - Correct conditional display of `КПП` (shown only for legal entities with non-null KPP; omitted for IP).
  - Correct display of `Email бухгалтерии` (`doc_email`), `Контактное лицо` (`contact_person`), `ЭДО` (`edo_type`), and bank requisites (`bik`, `account`).
  - Zero OGRN / OGRNIP fields collected or displayed.
- Integrated into `chatbot/handlers/client.py :: notify_operator_new_application()`.

### 3.3 Database Migrations & SQLite State Engine
- Updated `chatbot/database.py`:
  - Added columns to `applications`: `doc_email`, `contact_person`, `entity_type`, `active_application_key`.
  - Added table `application_deliveries` with `UniqueConstraint("application_id", "destination")`.
  - Added table `s2s_request_nonces` with primary key `nonce` and expiration index.
  - Implemented `apply_migrations(conn)` helper running schema-aware `ALTER TABLE` and creating partial unique index `uq_active_application_key` (`WHERE status = 'new'`).
  - Idempotently invoked inside `init_db()`.

### 3.4 S2S Protocol & Durable Anti-Replay Store
- Protocol: `TIKHON-S2S-V1`.
- Signing String: `TIKHON-S2S-V1\nPOST\n/api/v1/applications\n{ts}\n{nonce}\n{sha256}`.
- Headers: `X-Tikhon-Timestamp`, `X-Tikhon-Nonce`, `X-Tikhon-Signature`.
- Strict verification order enforcing **Anti-Poisoning Invariant**:
  1. Header check (`Timestamp`, `Nonce`, `Signature`).
  2. Timestamp window check ($|t_{now} - t_{req}| \le 300\,000$ ms).
  3. Body SHA-256 computation.
  4. Constant-time HMAC comparison via `hmac.compare_digest`.
  5. Atomic SQLite nonce reservation in `s2s_request_nonces` (ONLY after signature verification passes).
  6. Replay rejection with HTTP 409 `NONCE_REPLAYED` on duplicate nonce insert.

### 3.5 Atomic Dual Delivery Engine
- Created `chatbot/delivery_service.py` with CAS claim algorithm:
  - `UPDATE application_deliveries SET status='SENDING', ... WHERE status IN ('PENDING', 'FAILED')`.
  - Atomic lock guaranteed by SQLite rowcount: exactly 1 worker acquires claim.
  - 5-state lifecycle: `PENDING`, `SENDING`, `DELIVERED`, `FAILED`, `UNKNOWN`.
  - Stale claims older than 60 seconds are fail-closed transitioned to `UNKNOWN`.
  - Destinations:
    - **Curator:** Alexey Lebedev (`8807727029`, `@Lebedev_AST`).
    - **Accounting:** Supergroup «Бухгалтерия АСТ» (`-1003990047416`).
  - Terminal `DELIVERED` status is immutable and never resent.
  - Success condition: `APPLICATION_ACCEPTED` + `CURATOR_DELIVERED` + `ACCOUNTING_DELIVERED`.

### 3.6 Next.js Submission Bridge & Mini App Integration
- Endpoint `src/app/api/tikhon/submit-application/route.ts`:
  - Validates Telegram `initData` HMAC (max-age 7 days, 300s skew allowance).
  - Enforces payload bounds (max 64KB) and input schema.
  - Ignores client-supplied commercial parameters (`amount`, `price`, `chat_id`, `destination`).
  - Signs payload using `TIKHON-S2S-V1` HMAC-SHA256.
  - Forwards to Russian server endpoint over TLS 1.3.
  - Logs ONLY operational metadata (event, course, status, latency_ms, app_id); ZERO PII logged.
  - Zero PII persisted in Vercel or Supabase.
- Client submission helper `src/app/tikhon-miniapp-pilot/submission.ts`:
  - Encapsulates `/api/tikhon/submit-application` fetch call and error normalization.
  - Keeps `page.tsx` declarative and clean without raw network transport logic.
- UI Component `src/app/tikhon-miniapp-pilot/submission-screen.tsx`:
  - Handles `submitting` (accessible spinner, loading text).
  - Handles `error` (error alert, descriptive message, retry button, back to review button).
  - Handles `success` (application ID badge `#124`, exact verbatim Owner copy, direct Telegram link button to `@Lebedev_AST`, return to catalog button).
- UI Flow `src/app/tikhon-miniapp-pilot/page.tsx` & `legal-entity-flow.tsx`:
  - Confirmation button "Оформить заявку" transitions to `submission_result` and invokes `handleExecuteSubmission()`.
  - Telegram BackButton integrated cleanly.
  - Retains all pre-existing stub comments and branch structures to preserve zero regression on Batch 1–4 tests.

---

## 4. VERBATIM COPY & OWNER INVARIANTS

```text
SUCCESS_COPY_VERBATIM:
"Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо" [VERIFIED]

CANONICAL_CURATOR_USERNAME:
Lebedev_AST [VERIFIED]

CANONICAL_CURATOR_TG_LINK:
https://t.me/Lebedev_AST [VERIFIED]

OBSOLETE_LEBEDEV_HANDLE_AUDIT:
AST_lebedev: 0 matches across structural-typology-navigator and chatbot [VERIFIED]

FLAGSHIP_LEVEL_NAMES:
level_1: "Введение в теорию" (50 000 ₽) [VERIFIED]
level_2: "Основной курс" (100 000 ₽) [VERIFIED]
level_3: "Экспертный уровень" (50 000 ₽) [VERIFIED]
full_prepayment: "Полный курс (Уровни 1, 2, 3)" (160 000 ₽) [VERIFIED]
```

---

## 5. MECHANICAL VERIFICATION EVIDENCE

### 5.1 Chatbot Test Suite (`test_batch5_submission.py`)
```bash
./venv/bin/python -m unittest tests/test_batch5_submission.py
```
```text
Ran 18 tests in 2.192s

OK
```
All 18 comprehensive tests passed:
- `test_flagship_level_names_exact_authority` [PASS]
- `test_calendar_cache_json_synced` [PASS]
- `test_individual_application_card_structure` [PASS]
- `test_individual_with_phone_and_html_escaping` [PASS]
- `test_legal_entity_and_ip_card` [PASS]
- `test_database_migration_schema_and_partial_index` [PASS]
- `test_active_application_key_uniqueness_prevents_duplicate_active_application` [PASS]
- `test_delivery_claim_atomic_cas_prevents_duplicate_send` [PASS]
- `test_stale_sending_claim_recovery_to_unknown` [PASS]
- `test_s2s_signature_verification_success` [PASS]
- `test_s2s_signature_verification_failure_rejects` [PASS]
- `test_unauthenticated_request_does_not_poison_nonce_table` [PASS]
- `test_expired_timestamp_rejected` [PASS]
- `test_replayed_nonce_rejected_with_409` [PASS]
- `test_canonical_commercial_authority_cannot_be_overridden_by_client` [PASS]
- `test_success_condition_requires_both_delivered` [PASS]
- `test_legal_entity_and_ip_submission` [PASS]
- `test_partial_delivery_retry_semantics` [PASS]

### 5.2 Navigator Test Suite (`batch-5-submission.test.mts`)
```bash
npx tsx --env-file=.env.local --test tests/tikhon-miniapp/batch-5-submission.test.mts
```
```text
✔ 1.1: Success copy verbatim matches exact Owner mandate
✔ 1.2: Curator username is Lebedev_AST and link is https://t.me/Lebedev_AST
✔ 1.3: Zero references to obsolete @AST_lebedev across pilot sources
✔ 2.1: S2S route rejects missing Telegram initData with 401
✔ 2.2: S2S route rejects tampered Telegram initData with 401
✔ 2.3: S2S route rejects invalid payer type with 400
✔ 2.4: S2S route rejects missing course parameters with 400
✔ 2.5: S2S route rejects malformed individual full name (< 2 words) with 400
✔ 2.6: S2S route rejects malformed email with 400
✔ 2.7: S2S route rejects invalid INN (< 10 or 11 digits) with 400
✔ 2.8: S2S route rejects missing required legal entity fields with 400
✔ 2.9: S2S route rejects GET method with 405
✔ 3.1: Protocol identifier is strictly TIKHON-S2S-V1
✔ 3.2: Canonical signing string follows exact spec: version\nmethod\npath\nts\nnonce\nsha256
✔ 3.3: Headers strictly set X-Tikhon-Timestamp, X-Tikhon-Nonce, X-Tikhon-Signature
✔ 3.4: Server commercial authority: client financial parameters are ignored
✔ 4.1: submitTikhonApplication rejects call without Telegram auth
✔ 5.1: MiniAppScreen includes submission_result
✔ 5.2: SubmissionResultScreen renders in page.tsx for submission_result
✔ 5.3: individual_confirmation CTA triggers submission and advances screen
✔ 5.4: legal_entity_confirmation CTA triggers submission via onSubmitApplication
✔ 5.5: SubmissionResultScreen displays SUCCESS_COPY_VERBATIM on success
✔ 5.6: SubmissionResultScreen displays loading spinner and error retry button
✔ 6.1: Zero PII persistence in browser storage across submission files
✔ 6.2: S2S route logs only operational metadata (PII absent from logs)
✔ 6.3: Zero DaData or Google dependencies introduced in submission files
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

### 5.3 Full Navigator Mini App Regression Suite (Batches 1–5)
```bash
npx tsx --env-file=.env.local --test tests/tikhon-miniapp/*.test.mts
```
```text
ℹ tests 140
ℹ suites 8
ℹ pass 140
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3125.931029
```
**ZERO REGRESSIONS across all 140 tests spanning Batches 1, 2, 2-CORR1, 3, 4, 5, and Live Data Binding.**

### 5.4 TypeScript & ESLint Verification
```bash
npm run typecheck
```
```text
> next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
Exit code: 0
```

```bash
npx eslint src/app/tikhon-miniapp-pilot/submission.ts src/app/tikhon-miniapp-pilot/submission-screen.tsx src/app/api/tikhon/submit-application/route.ts tests/tikhon-miniapp/batch-5-submission.test.mts
```
```text
Exit code: 0 (0 problems)
```

### 5.5 Git Diff Whitespace & Tree Cleanliness
```bash
git diff --check (structural-typology-navigator) -> 0 (clean)
git diff --check (chatbot)                      -> 0 (clean)
```

---

## 6. MUTATION MANIFEST

### 6.1 `structural-typology-navigator`
- `src/app/api/tikhon/submit-application/route.ts` [NEW] — S2S submission proxy with Telegram initData HMAC validation and S2S signing.
- `src/app/tikhon-miniapp-pilot/submission.ts` [NEW] — Client submission helper and error handler.
- `src/app/tikhon-miniapp-pilot/submission-screen.tsx` [NEW] — Dedicated submission UI component (submitting, error with retry, success with verbatim copy and `@Lebedev_AST` button).
- `src/app/tikhon-miniapp-pilot/helpers.ts` [MODIFIED] — Added `submission_result` to `MiniAppScreen`, exported `SUCCESS_COPY_VERBATIM`, `CANONICAL_CURATOR_USERNAME`, `CANONICAL_CURATOR_TG_LINK`, `SubmissionState`.
- `src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx` [MODIFIED] — Wired `onSubmitApplication` prop into confirmation screen primary CTA.
- `src/app/tikhon-miniapp-pilot/page.tsx` [MODIFIED] — Added submission state, wired confirmation CTA to `handleExecuteSubmission`, rendered `SubmissionResultScreen`, integrated BackButton.
- `src/app/tikhon-miniapp-pilot/miniapp.module.css` [MODIFIED] — Added CSS classes for submission result screen.
- `tests/tikhon-miniapp/batch-5-submission.test.mts` [NEW] — 26 comprehensive automated tests.

### 6.2 `chatbot`
- `calendar_service.py` [MODIFIED] — Corrected level names to `Введение в теорию`, `Основной курс`, `Экспертный уровень`.
- `data/calendar_cache.json` [MODIFIED] — Synced level names in local cache.
- `config.py` [MODIFIED] — Added `curator_chat_id`, `curator_username`, `tikhon_internal_secret`.
- `database.py` [MODIFIED] — Added columns, `ApplicationDelivery`, `S2SRequestNonce`, and `apply_migrations()`.
- `application_formatter.py` [NEW] — Canonical Telegram application card formatter with HTML escaping.
- `delivery_service.py` [NEW] — CAS atomic claims, 5-state delivery machine, fail-closed timeout handling.
- `api_service.py` [MODIFIED] — Added `POST /api/v1/applications` S2S receiver with SQLite replay protection and server-side commercial authority.
- `handlers/client.py` [MODIFIED] — Delegated operator card formatting to `format_telegram_application_card`.
- `tests/test_batch5_submission.py` [NEW] — 18 comprehensive automated tests.

---

## 7. CLOSURE HANDOFF TO GIT AGENT

Per `AGENTS.md` (§7.3 Single-Writer Rule and §7.4 Git Agent Mandate):
- Primary Coder (Antigravity) has **COMPLETED** all authorized implementation and mechanical verification tasks.
- Primary Coder does **NOT** stage, commit, or push git branches.
- Handing over cleanly to the Owner and designated Git Agent (Claude) for bounded git commit and worktree closure.
