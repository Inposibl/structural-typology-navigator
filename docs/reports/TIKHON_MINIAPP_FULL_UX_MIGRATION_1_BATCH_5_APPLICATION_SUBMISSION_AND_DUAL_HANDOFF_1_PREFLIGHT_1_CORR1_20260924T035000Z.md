# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.PREFLIGHT-1.CORR1 REPORT

**Date:** 2026-09-24T03:50:00Z  
**Executor:** Gemini 3.8 Flash (High) (Antigravity Primary Coder / Read-Only Preflight Correction Analyst)  
**Governance:** `AGENTS.md` (Unified Master Governance & Zero Axiom Evidence Protocol v2.0)  
**Task:** BATCH-5 PREFLIGHT CORRECTION — F-1 (Real Transport Closure), F-2 (Reopen-Safe Idempotency), F-3 (Legal Entity Persistence Schema), F-4 (Curator Username Conflict), F-5 (PII / Telemetry / Legal Gate)

---

## 1. ACT IDENTIFICATION & STATUS

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1
.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1
.PREFLIGHT-1.CORR1

STATUS:
PASS (ALL 5 DEFECTS PHYSICALLY ANALYZED AND BOUNDED — READY FOR OWNER ARCHITECTURAL DECISION)

REPOSITORY_BASELINE:
structural-typology-navigator: 5f10d73223abe72fc6311d4f60afcca485b57605 [VERIFIED]
chatbot (local): c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183 [VERIFIED]
chatbot (production root@37.77.104.66): ast_bot.service active (running), PID 88394 [VERIFIED]
```

---

## 2. DEFECT F-1: REAL PRODUCTION TRANSPORT CLOSURE

### Physical Verification of Current State
- Terminal inspection of production host `root@37.77.104.66` via `ss -tulpn`:
  - `tcp LISTEN 0 128 0.0.0.0:22` (sshd) [VERIFIED]
  - `tcp LISTEN 0 128 0.0.0.0:10050` (zabbix_agentd) [VERIFIED]
  - ZERO inbound HTTP/HTTPS ports open [VERIFIED].
- Public VPS port 8080 was permanently closed during Batch 0 closure (`TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_0_SECURE_DATA_TRANSPORT_CLOSURE_1_REPORT_20260923T163926Z.md`).
- **Conclusion:** Direct `Vercel -> HTTPS -> Russian VPS` is **NOT currently executable** without explicit network/service configuration.

### Viable Production Transport Options

#### Topology A: Direct Authenticated HTTPS on Russian VPS (RECOMMENDED)
- **Topology:** Browser Mini App → TLS 1.3 HTTPS POST → Vercel `/api/tikhon/submit-application` (stateless in-memory validation) → TLS 1.3 HTTPS POST → Russian VPS `https://api.structural-typology.academy:8443/api/v1/applications` (or direct IP with TLS cert) → `api_service.py` in `ast_bot.service` → SQLite `ast_bot.db` → Telegram Bot API → Alexey & Accounting.
- **Required Server/Config Changes:**
  1. Add DNS A-record (e.g. `api.structural-typology.academy` → `37.77.104.66`).
  2. Provision TLS certificate (Let's Encrypt / Certbot).
  3. Re-enable `start_api_server(host="0.0.0.0", port=8443)` in `chatbot/main.py` with SSL context.
  4. Configure `TIKHON_INTERNAL_SECRET` in both Vercel and Russian server `.env`.
- **Public Attack Surface:** Exactly one open port (`8443`), protected by TLS 1.3, constant-time HMAC-SHA256 signature check before body parsing, and IP rate-limiting.
- **Authentication Mechanism:** `X-Tikhon-Internal-Secret` header + HMAC-SHA256 request signature + authenticated Telegram `user_id` match.
- **TLS Termination:** Russian VPS (`api_service.py` via Python `ssl` module or lightweight reverse proxy).
- **Firewall Requirement:** Allow inbound TCP on port `8443` (iptables / cloud firewall).
- **New Third-Party Infrastructure:** NONE.
- **PII Crossing New Persistence Surfaces:** NO. Zero persistent storage on Vercel; zero storage in Supabase; PII persisted solely in `/opt/ast_bot/ast_bot.db`.

#### Topology B: Outbound Polling Queue via Supabase (Zero Inbound Ports)
- **Topology:** Browser Mini App → Vercel `/api/tikhon/submit-application` → Vercel encrypts payload with AES-256-GCM → Inserts row into private Supabase table `tikhon_submission_queue` → Russian VPS background task in `ast_bot.service` polls queue over outbound TLS every 1–2s → Decrypts payload, saves to `ast_bot.db`, sends Telegram messages → Deletes row immediately from Supabase → Vercel waits or polls for completion.
- **Required Server/Config Changes:**
  1. Create private Supabase table `tikhon_submission_queue` with Service Role RLS.
  2. Add background queue worker in `ast_bot.service`.
  3. Configure `SUBMISSION_ENCRYPTION_KEY` in Vercel and VPS `.env`.
- **Public Attack Surface:** ZERO inbound ports on VPS (preserves Batch 0 zero-inbound posture).
- **Authentication Mechanism:** Supabase Service Role Key on Vercel, Supabase Secret Key on VPS, end-to-end AES-256 payload encryption.
- **TLS Termination:** Supabase standard HTTPS endpoint.
- **Firewall Requirement:** NONE (existing outbound HTTPS only).
- **New Third-Party Infrastructure:** NONE (Supabase is already active).
- **PII Crossing New Persistence Surfaces:** YES, TRANSIENTLY: Encrypted ciphertext is buffered in Supabase for 1–5 seconds until consumed and deleted by VPS worker.

```text
TRANSPORT_TOPOLOGY:
Topology A (Direct Authenticated HTTPS on Russian VPS) [RECOMMENDED]
vs Topology B (Outbound Polling Queue via Supabase) [ALTERNATIVE]

TRANSPORT_CURRENTLY_EXECUTABLE:
NO (Requires Owner decision on Topology A vs B before implementation)

TRANSPORT_OWNER_DECISION_REQUIRED:
YES
```

---

## 3. DEFECT F-2: REOPEN-SAFE IDEMPOTENCY

### Vulnerability of Client-Only UUIDv4
In a Telegram Mini App:
- Closing the Mini App completely destroys the React view and all in-memory variables.
- A client UUID stored only in React state (`useState`) is lost upon close/reopen or browser reload.
- If a user closes the Mini App after a transient error or while waiting, and reopens it to submit again, a fresh client UUID would cause a DUPLICATE application to be inserted into `applications` and duplicate Telegram cards sent!

### Server-Enforced Idempotency Architecture
The server enforces idempotency via a two-tier boundary:

1. **Tier 1 (Fast-Path / Session Deduplication):**
   - Client sends `idempotency_key` (UUIDv4) persisted in `sessionStorage` for the duration of the web session.
   - Handles rapid double-clicks and immediate browser network retries.

2. **Tier 2 (Server-Enforced Reopen-Safe Uniqueness Boundary):**
   - Query existing database records on Russian Server:
     ```sql
     SELECT id, status, created_at FROM applications
     WHERE user_id = :telegram_user_id
       AND course_id = :course_id
       AND cohort_id = :cohort_id
       AND pricing_option_id = :pricing_option_id
       AND payer_type = :payer_type
       AND (
         (payer_type = 'individual' AND lower(email) = lower(:email))
         OR
         (payer_type = 'legal_entity' AND inn = :inn)
       )
       AND status = 'new'
       AND created_at > datetime('now', '-24 hours');
     ```

### Complete Lifecycle Decision Matrix
1. **Double-click / HTTP retry:**
   Matches Tier 1 `idempotency_key` → Returns existing `application_id`.
2. **Browser refresh / Mini App close and reopen:**
   Tier 1 key may be lost, but Tier 2 server boundary finds existing active `new` application for this exact user, course, cohort, tier, and payer identifier within 24 hours.
   - If `curator_delivered = True` AND `accounting_delivered = True`:
     Returns HTTP 200 with existing `application_id` and status `ALREADY_ACCEPTED`. Zero duplicate row; zero Telegram send.
   - If partial delivery occurred (`curator_delivered != accounting_delivered`):
     Server retries ONLY the failed target. Updates delivery tracker. Returns HTTP 200 with existing `application_id`.
3. **Legitimate later new application:**
   - If applying for a *different course*, *different cohort*, or *different level/tier*:
     Matches NO active row → Allowed immediately.
   - If previous application has been resolved (status = `'paid'` or `'canceled'`):
     Excluded from the `WHERE status = 'new'` clause → Allowed immediately.
   - If > 24 hours have elapsed:
     Excluded from 24-hour window → Allowed.

```text
IDEMPOTENCY_BOUNDARY:
Tier 1: Client sessionStorage idempotency_key (UUIDv4)
+
Tier 2: Server-enforced uniqueness across:
(user_id, course_id, cohort_id, pricing_option_id, payer_type, normalized_payer_id)
WHERE status = 'new' AND created_at > NOW() - 24 hours.

REOPEN_DUPLICATE_PREVENTED:
YES
```

---

## 4. DEFECT F-3: LEGAL ENTITY PERSISTENCE SCHEMA

### Physical Investigation of Current Schema & Code
Physical inspection of `chatbot/database.py` (lines 28–73) and production database `/opt/ast_bot/ast_bot.db`:
- Local columns: `id, user_id, username, course_id, course_name, cohort_id, cohort_title, cohort_schedule, amount, pricing_option_id, payer_type, full_name, phone, email, inn, kpp, ogrn, company_name, company_address, bik, bank_name, account, edo_type, status, operator_notes, created_at, updated_at` [VERIFIED].
- Production columns: Exact match with local columns [VERIFIED via `PRAGMA table_info(applications)` on production].
- Historical bot code (`chatbot/handlers/client.py:840–865`):
  - `email` column was overloaded to store `doc_email` (`email=data["doc_email"]`) [VERIFIED].
  - `full_name` column was overloaded to store `contact_person` (`full_name=contact_info`) [VERIFIED].
  - `entity_type` was NOT stored in database (only `payer_type='legal_entity'` was stored; entity type was derived from INN length or prefix) [VERIFIED].
  - `ogrn` column physically exists in schema, but prompt §13 explicitly mandates: `DO NOT collect OGRN / OGRNIP`.

### Storage Status for Batch-4 Fields
```text
DOC_EMAIL_STORAGE:
ABSENT as a dedicated column (historically overloaded into Application.email).

CONTACT_PERSON_STORAGE:
ABSENT as a dedicated column (historically overloaded into Application.full_name).

ENTITY_TYPE_STORAGE:
DERIVED_ONLY (derived from INN: 10 digits = legal_entity, 12 digits = individual_entrepreneur).

SCHEMA_MIGRATION_REQUIRED:
YES (Minimal backward-compatible migration recommended).
```

### Exact Minimal SQLite Schema Migration
To eliminate semantic overloading and cleanly preserve Batch-4 fields:
```sql
ALTER TABLE applications ADD COLUMN doc_email VARCHAR(255);
ALTER TABLE applications ADD COLUMN contact_person VARCHAR(255);
ALTER TABLE applications ADD COLUMN entity_type VARCHAR(32);
```
- In SQLite 3, `ALTER TABLE ... ADD COLUMN` with NULL default is instantaneous, non-locking, and 100% backward-compatible.
- `Application` SQLAlchemy model in `chatbot/database.py` is updated with:
  ```python
  doc_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
  contact_person: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
  entity_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
  ```
- Batch 4 data mapping:
  - `doc_email` → `Application.doc_email` (and optionally synced to `Application.email` for backward compatibility)
  - `contact_person` → `Application.contact_person` (and optionally synced to `Application.full_name`)
  - `entity_type` → `Application.entity_type` ('legal_entity' | 'individual_entrepreneur')

---

## 5. DEFECT F-4: CURATOR USERNAME CONFLICT

### Physical Investigation
1. Telegram Bot API query (`bot.get_chat(8807727029)`):
   - User ID: `8807727029` [VERIFIED]
   - First Name: `Алексей Лебедев / Академия Структурной Типологии` [VERIFIED]
   - Username: `Lebedev_AST` [VERIFIED]
2. Codebase references:
   - `chatbot/keyboards.py:387`: `text="👨‍🏫 Написать куратору (@Lebedev_AST)", url="https://t.me/Lebedev_AST"` [VERIFIED]
   - `chatbot/reminder_scheduler.py:289`: `...или у куратора @Lebedev_AST` [VERIFIED]
   - `chatbot/data_engine/lebedev_adapter.py:2`: `Telethon Inbound Adapter for Academy AI Navigator (@Lebedev_AST)` [VERIFIED]
   - `chatbot/.env`: `TG_SESSION_NAME=ast_lebedev_session` [VERIFIED]
3. Current Owner Success Copy (prompt §2):
   `"Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @AST_lebedev. Спасибо"`
   Username in Owner copy: `@AST_lebedev`.

```text
VERIFIED_CURATOR_USERNAME:
@Lebedev_AST [VERIFIED]

CURRENT_SUCCESS_COPY_USERNAME:
@AST_lebedev

USERNAME_MATCH:
NO

SUCCESS_COPY_OWNER_DECISION_REQUIRED:
YES
```

### Framing for Owner Decision
- **Option 1 (Update Copy to Verified Username):**  
  `"Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо"`  
  *(Ensures the link and handle point to Alexey's active Telegram account where delivery and reminder bots are wired).*
- **Option 2 (Retain @AST_lebedev):**  
  Keep exact Owner copy unchanged if `@AST_lebedev` is a separate forwarder or newly registered vanity username.

---

## 6. DEFECT F-5: PII, TELEMETRY & PRIVACY LEGAL GATE

### Classification of Telegram `user_id`
Under Russian Federal Law 152-FZ and general privacy doctrine, a numeric Telegram `user_id` is an individual identifier that, especially when linked with course enrollment, email, phone, or payment data, constitutes personal data.
```text
TELEGRAM_USER_ID_CLASSIFIED_AS_NON_PII:
NO (Formally retracted from PREFLIGHT-1; classified as PII).
```

### Inventory of Batch-5 Operational Logs
To ensure production debuggability without persisting applicant PII in log aggregators (e.g. Vercel Logs, Axiom, Datadog):

```text
LOGGED_FIELDS:
[timestamp_iso, event_name, course_id, cohort_id, pricing_option_id, status_code, latency_ms, application_id, error_code]

APPLICANT_CONTENT_LOGGED: NO
FULL_NAME_LOGGED: NO
EMAIL_LOGGED: NO
PHONE_LOGGED: NO
TELEGRAM_USER_ID_LOGGED: NO
USERNAME_LOGGED: NO
COURSE_ID_LOGGED: YES
```

Operational log statement example:
`[INFO] 2026-09-24T03:50:00Z event=application_forwarded course=maslow cohort=cohort_1 option=single_payment status=200 app_id=124 latency=180ms`

### Still-Open Privacy / Legal Gate
```text
PRIVACY_LEGAL_GATE:
OPEN

FACTUAL BASIS:
1. Consent Notice on Submit: In Batch 3 and Batch 4, Screen 5 displays an informational link to /offer ("Указанные данные будут обрабатываться в соответствии с разделом 7 Оферты"), but does not contain affirmative consent wording tied directly to the submission action (e.g. "Нажимая кнопку, вы даете согласие на обработку персональных данных в соответствии с Политикой конфиденциальности и условиями Оферты"). Under 152-FZ, affirmative consent must be legally linked to the submission trigger.
2. Cross-Border Edge Transit: The Mini App runs on Vercel's global edge infrastructure. While Vercel acts as a stateless, transient transit proxy and the primary database is on the Russian Timeweb server (/opt/ast_bot/ast_bot.db), the legal characterization of transient edge transit under 152-FZ Art. 18(5) (data localization) remains an open Owner / legal review item before live production PII processing.
```

---

## 7. PRODUCTION ACCOUNTING CONFIGURATION

```text
ACCOUNTING_PRODUCTION_CONFIG_CHANGE_REQUIRED:
YES

FACTUAL BASIS:
- Verified Accounting Supergroup Chat ID: -1003990047416 [VERIFIED]
- Current Local Config: OPERATOR_CHAT_ID = -1003990047416 [VERIFIED in chatbot/.env]
- Current Production Config: OPERATOR_CHAT_ID = 0 [VERIFIED in root@37.77.104.66:/opt/ast_bot/.env]
- Bot Status in Accounting Group: Administrator with can_manage_chat = True [VERIFIED]

REQUIRED ACTION:
During implementation deployment, update /opt/ast_bot/.env on root@37.77.104.66:
OPERATOR_CHAT_ID=-1003990047416
(Zero mutation performed during PREFLIGHT).
```

---

## 8. FLAGSHIP COURSE LEVEL NAMES PRESERVATION

Preserved from Owner instruction of 2026-09-24:
```text
FLAGSHIP_LEVEL_NAME_AUTHORITY:
chatbot/calendar_service.py :: ALL_COURSES["structural_typology"].pricing_options
and chatbot/data/calendar_cache.json

LEVEL 1: Введение в теорию (id: level_1, price: 50 000 ₽)
LEVEL 2: Основной курс (id: level_2, price: 100 000 ₽)
LEVEL 3: Экспертный уровень (id: level_3, price: 50 000 ₽)

full_prepayment remains: 160 000 ₽ (discount 20%).
NO ID change.
NO price change.
NO discount change.
```

---

## 9. MUTATION INVENTORY (READ-ONLY VERIFICATION)

```text
PRODUCT_FILES_MODIFIED:
NO

PRODUCTION_STATE_MODIFIED:
NO

GIT_MUTATION:
NONE (Only report file created under docs/reports/)

REPORT_PATH:
docs/reports/TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_5_APPLICATION_SUBMISSION_AND_DUAL_HANDOFF_1_PREFLIGHT_1_CORR1_20260924T035000Z.md

NEXT:
OWNER DECISION ON:
1. Transport Topology: Topology A (Direct HTTPS on VPS) vs Topology B (Outbound Queue via Supabase).
2. Curator Username in Success Copy: @Lebedev_AST (verified) vs @AST_lebedev (current copy).

STOP.
```
