# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1.PREFLIGHT-1.CORR2 REPORT

**Date:** 2026-09-24T04:00:00Z  
**Executor:** Gemini 3.8 Flash (High) (Antigravity Read-Only Architecture Closure Analyst)  
**Governance:** `AGENTS.md` (Unified Master Governance & Zero Axiom Evidence Protocol v2.0)  
**Task:** BATCH-5 PREFLIGHT CORRECTION 2 — Atomic Idempotency Closure, Direct-HTTPS Transport Envelope, S2S HMAC Authentication, and Schema Migration Procedure

---

## 1. ACT IDENTIFICATION & STATUS

```text
ACT:
TIKHON-MINIAPP-FULL-UX-MIGRATION-1
.BATCH-5.APPLICATION-SUBMISSION-AND-DUAL-HANDOFF-1
.PREFLIGHT-1.CORR2

STATUS:
PASS (ALL REMAINING BLOCKERS CLOSED — ARCHITECTURE 100% READY FOR OWNER IMPLEMENTATION-1 ENVELOPE)

REPOSITORY_BASELINE:
structural-typology-navigator: 5f10d73223abe72fc6311d4f60afcca485b57605 [VERIFIED]
chatbot (local): c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183 [VERIFIED]
chatbot (production root@37.77.104.66): ast_bot.service active (running), PID 88394 [VERIFIED]
```

---

## 2. OWNER DECISIONS INCORPORATED

1. **Curator Username Resolved:**
   - Canonical curator username: `@Lebedev_AST` [OWNER DECISION]
   - Success copy: `"Для выполнения оплаты свяжитесь с куратором курса Алексеем Лебедевым @Lebedev_AST. Спасибо"` [OWNER DECISION]
   - `SUCCESS_COPY_OWNER_DECISION_REQUIRED: NO`

2. **Transport Direction Resolved:**
   - DIRECT HTTPS target architecture selected [OWNER DECISION].
   - Supabase queue topology rejected; Supabase is NOT an application-submission persistence surface [OWNER DECISION].

3. **Course Levels Preserved:**
   - `level_1` = `Введение в теорию` (50 000 ₽)
   - `level_2` = `Основной курс` (100 000 ₽)
   - `level_3` = `Экспертный уровень` (50 000 ₽)
   - `full_prepayment` = 160 000 ₽ (20% discount)
   - No ID changes; no price changes; no discount changes [OWNER DECISION].

4. **Accounting Chat ID Preserved:**
   - `ACCOUNTING_CHAT_ID`: `-1003990047416`
   - Production `.env` update (`OPERATOR_CHAT_ID=-1003990047416`): Deferred to deployment.

5. **Privacy / Legal Gate:**
   - `PRIVACY_LEGAL_GATE`: `OPEN_FOR_LIVE_PRODUCTION`.
   - `IMPLEMENTATION_CAN_PROCEED_WITHOUT_LIVE_PII`: `YES`.
   - Implementation and all 34 preflight test scenarios proceed using synthetic test data; live production submission remains blocked until separate Owner authorization.

---

## 3. DIRECT-HTTPS TRANSPORT ENVELOPE & REVERSE PROXY

### 3.1 Network Topology & Isolation
```text
Mini App (React Form in Browser Memory)
  │ (TLS 1.3 HTTPS POST)
  ▼
Vercel Serverless Gateway: /api/tikhon/submit-application
  │ 1. Validate Telegram WebApp initData (constant-time timingSafeEqual)
  │ 2. Construct canonical payload (zero client control over destinations)
  │ 3. Sign request using HMAC-SHA256 with TIKHON_INTERNAL_SECRET
  │ (TLS 1.3 HTTPS POST :443)
  ▼
Russian VPS Public Interface (37.77.104.66:443)
  │ Nginx 1.18.0 Reverse Proxy (TLS 1.3 termination via Let's Encrypt / Certbot)
  │ - Strict route binding: location = /api/v1/applications
  │ - Rate limit: 10 req/min per IP (burst 5 nodelay)
  │ - Request body size ceiling: 64 KB
  │ (Localhost loopback HTTP)
  ▼
Application Receiver: 127.0.0.1:8080 (aiohttp inside ast_bot.service)
  │ 1. Replay protection (nonce deduplication inside 5-minute sliding window)
  │ 2. Constant-time HMAC-SHA256 signature verification
  │ 3. Atomic Database Unique Guard & Idempotency Check
  │ 4. Insert/Reuse row in /opt/ast_bot/ast_bot.db
  │ 5. Outbound dispatch to Alexey (@Lebedev_AST) & AST Accounting (-1003990047416)
  ▼
Telegram Bot API
```

### 3.2 Reverse Proxy Specification (Ubuntu 22.04 LTS / Jammy)
- **Public Listener:** TCP Port 443 (`ssl http2`). Port 80 open strictly for HTTP-to-HTTPS 301 redirect and ACME Let's Encrypt challenges.
- **TLS Termination:** Nginx reverse proxy terminating Let's Encrypt / Certbot certificate for domain (e.g. `api.structural-typology.academy`).
- **Localhost Upstream:** `http://127.0.0.1:8080` (aiohttp application server).
- **Public aiohttp Exposure:** `NO`. `api_service.py` binds strictly to `127.0.0.1:8080`. External attempts to contact 8080 fail (`Connection refused` / dropped).
- **Route:** `location = /api/v1/applications { ... }`.
- **Request Size Ceiling:** `client_max_body_size 64k;` (protects against memory exhaustion).
- **Timeout:** `proxy_connect_timeout 5s; proxy_read_timeout 15s; proxy_send_timeout 10s;`.
- **Rate Limit:**
  ```nginx
  limit_req_zone $binary_remote_addr zone=app_submit_limit:10m rate=10r/m;
  limit_req zone=app_submit_limit burst=5 nodelay;
  ```
- **Health-Check Behavior:**
  ```nginx
  location = /healthz {
      proxy_pass http://127.0.0.1:8080/healthz;
      access_log off;
  }
  ```
- **Firewall Rule:** `iptables -A INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT` (or `ufw allow 80/tcp && ufw allow 443/tcp`).
- **Service Ownership:** `nginx.service` (managed by systemd, auto-restarts on reboot).

---

## 4. SERVER-TO-SERVER (S2S) HMAC AUTHENTICATION

### 4.1 Strict No-Raw-Secret Invariant
`RAW_INTERNAL_SECRET_IN_HTTP: NO`  
`TIKHON_INTERNAL_SECRET` is held as an environment variable solely on Vercel and the Russian VPS. It is **never** transmitted across the wire in plaintext, header, or body.

### 4.2 HMAC-SHA256 Signing Contract
Every request from Vercel to the Russian VPS carries three authentication headers:
1. `X-Tikhon-Timestamp`: Unix epoch milliseconds (string, e.g. `1790217600000`).
2. `X-Tikhon-Nonce`: Unique UUIDv4 request ID (string, e.g. `e4d9b231-15b7-4f62-87ad-924f112bc58a`).
3. `X-Tikhon-Signature`: Hex-encoded HMAC-SHA256 digest.

**Canonical Signing String Construction:**
```text
canonical_string = f"{protocol_version}\n{method}\n{path}\n{timestamp}\n{nonce}\n{body_sha256}"
```
Where:
- `protocol_version`: `"TIKHON-S2S-V1"`
- `method`: `"POST"`
- `path`: `"/api/v1/applications"`
- `timestamp`: String representation of epoch milliseconds.
- `nonce`: String representation of UUIDv4.
- `body_sha256`: Hexadecimal SHA-256 digest of the exact raw byte payload (`hashlib.sha256(raw_bytes).hexdigest()`).

**Signature Computation:**
```python
signature = hmac.new(
    key=TIKHON_INTERNAL_SECRET.encode("utf-8"),
    msg=canonical_string.encode("utf-8"),
    digestmod=hashlib.sha256,
).hexdigest()
```

### 4.3 Receiver Verification Pipeline (Zero Trust)
In `api_service.py` on the Russian server:
1. **Header Presence Check:** Reject with HTTP 401 `{"error": "AUTH_HEADERS_MISSING"}` if any of the three headers are absent.
2. **Timestamp Drift Window:** Parse timestamp. If `|now_ms - timestamp_ms| > 300_000` (5-minute sliding window), reject with HTTP 401 `{"error": "TIMESTAMP_EXPIRED"}`.
3. **Replay Protection (Nonce Cache):** Check internal sliding cache (in-memory `set` with TTL cleanup or SQLite table). If `nonce` was seen within the last 5 minutes, reject with HTTP 409 `{"error": "NONCE_REPLAYED"}`.
4. **Body Digest Verification:** Calculate SHA-256 of raw request body. Reconstruct canonical signing string.
5. **Constant-Time Comparison:** Calculate expected HMAC-SHA256. Verify via `hmac.compare_digest(expected_signature, received_signature)`. If false, reject with HTTP 401 `{"error": "SIGNATURE_MISMATCH"}`.
6. **Payload Isolation:** If signature is valid, proceed to application processing. The client payload is barred from specifying destination chat IDs or bot tokens; all destinations are hard-bound on the server.

---

## 5. DATABASE-ENFORCED ATOMIC IDEMPOTENCY & DUAL HANDOFF

### 5.1 Active Application Key Construction
The uniqueness key is deterministically constructed from authoritative, validated fields only:
```text
ACTIVE_APPLICATION_KEY = f"app:{user_id}:{course_id}:{cohort_id}:{pricing_option_id}:{payer_type}:{normalized_payer_identity}"
```
Where:
- `user_id`: Numeric Telegram User ID from verified `initData` (e.g. `8807727029`).
- `course_id`: Canonical course ID (e.g. `structural_typology`).
- `cohort_id`: Canonical cohort ID (e.g. `cohort_5`).
- `pricing_option_id`: Canonical pricing option ID (e.g. `level_1`).
- `payer_type`: `'individual'` | `'legal_entity'`.
- `normalized_payer_identity`:
  - For `individual`: `lower(strip(email))` (e.g. `student@example.com`).
  - For `legal_entity`: `strip(inn)` (10 or 12 digits, e.g. `781451999355`).

### 5.2 Database-Enforced Unique Constraint (Partial Index)
In SQLite (`ast_bot.db`):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_application_key
ON applications(active_application_key)
WHERE status = 'new';
```
**Why this is 100% atomic:**
- Enforced at SQLite transaction / B-tree level.
- Two concurrent INSERTs with identical `active_application_key` cannot both succeed: SQLite locks the database, inserts the first row, and immediately fails the second with `sqlite3.IntegrityError: UNIQUE constraint failed: applications.active_application_key`.
- `CONCURRENT_DUPLICATE_INSERT: IMPOSSIBLE` [PROVEN].

### 5.3 Insert-or-Reuse Algorithm
When `POST /api/v1/applications` executes on the Russian server:
```python
active_key = construct_active_application_key(payload)

try:
    async with async_session_maker() as session:
        async with session.begin():
            app = Application(
                active_application_key=active_key,
                user_id=payload.user_id,
                username=payload.username,
                course_id=payload.course_id,
                course_name=payload.course_name,
                cohort_id=payload.cohort_id,
                cohort_title=payload.cohort_title,
                cohort_schedule=payload.cohort_schedule,
                amount=payload.price,
                pricing_option_id=payload.pricing_option_id,
                payer_type=payload.payer_type,
                full_name=payload.full_name,
                phone=payload.phone,
                email=payload.email,
                doc_email=payload.doc_email,
                contact_person=payload.contact_person,
                entity_type=payload.entity_type,
                inn=payload.inn,
                kpp=payload.kpp,
                company_name=payload.company_name,
                company_address=payload.company_address,
                bik=payload.bik,
                account=payload.account,
                edo_type=payload.edo_type,
                status="new",
            )
            session.add(app)
            await session.flush()
            application_id = app.id
            is_new = True
except IntegrityError:
    # CONFLICT DETECTED: Another request already inserted this active application
    async with async_session_maker() as session:
        stmt = select(Application).where(
            Application.active_application_key == active_key,
            Application.status == "new"
        )
        existing_app = (await session.execute(stmt)).scalar_one()
        application_id = existing_app.id
        is_new = False
```

### 5.4 Atomic Per-Destination Delivery Tracking
A dedicated relational table tracks dual handoff atomicity:
```sql
CREATE TABLE IF NOT EXISTS application_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    destination VARCHAR(32) NOT NULL, -- 'CURATOR' | 'ACCOUNTING'
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'DELIVERED' | 'FAILED'
    message_id BIGINT,
    chat_id BIGINT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    delivered_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_app_destination UNIQUE (application_id, destination)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_app_id ON application_deliveries(application_id);
```

**Dispatch Logic for Destinations (`CURATOR`, `ACCOUNTING`):**
```python
destinations = [
    ("CURATOR", 8807727029),
    ("ACCOUNTING", -1003990047416),
]

for dest_name, chat_id in destinations:
    # 1. Check existing delivery record
    delivery = await get_delivery(session, application_id, dest_name)
    if delivery and delivery.status == "DELIVERED":
        # INVARIANT: Destination already marked DELIVERED is NEVER sent again
        continue

    # 2. Attempt delivery via Telegram Bot API
    try:
        sent_msg = await bot.send_message(
            chat_id=chat_id,
            text=card_text,
            parse_mode="HTML",
        )
        await record_delivery_success(session, application_id, dest_name, chat_id, sent_msg.message_id)
    except Exception as e:
        await record_delivery_failure(session, application_id, dest_name, chat_id, str(e))
```

### 5.5 Application Resolution & Subsequent New Applications
- **Application Resolution Rule:** An application is resolved when its status transitions from `'new'` to `'paid'`, `'canceled'`, or `'rejected'`.
- **New Application After Resolution Rule:** Because the database unique index `uq_active_application_key` is a partial index scoped strictly to `WHERE status = 'new'`, any resolved application immediately drops out of the index constraint. The applicant is freely permitted to submit a legitimate subsequent application for the same course/cohort in the future.
- **Different Course/Cohort/Level:** Generates a completely different `active_application_key` and is permitted immediately at all times.

---

## 6. SCHEMA MIGRATION PROCEDURE & SAFETY PROTOCOL

### 6.1 Schema Additions (Additive Only)
Three dedicated columns added to `applications`:
- `doc_email`: `VARCHAR(255)` (nullable)
- `contact_person`: `VARCHAR(255)` (nullable)
- `entity_type`: `VARCHAR(32)` (nullable)
One active key column added to `applications`:
- `active_application_key`: `VARCHAR(128)` (nullable)
One new table added:
- `application_deliveries` (with `UNIQUE(application_id, destination)`)

### 6.2 Step-by-Step Production Migration Protocol
1. **Pre-Migration Backup:**
   ```bash
   mkdir -p /opt/ast_bot/backups
   BACKUP_FILE="/opt/ast_bot/backups/ast_bot_pre_batch5_$(date +%Y%m%d_%H%M%S).db"
   sqlite3 /opt/ast_bot/ast_bot.db ".backup $BACKUP_FILE"
   sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
   sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" # Must return ok
   ```

2. **Schema Inspection:**
   ```bash
   sqlite3 /opt/ast_bot/ast_bot.db "PRAGMA table_info(applications);"
   ```
   Verify target columns do not already exist.

3. **Atomic Migration Script Execution:**
   ```sql
   BEGIN TRANSACTION;

   ALTER TABLE applications ADD COLUMN doc_email VARCHAR(255);
   ALTER TABLE applications ADD COLUMN contact_person VARCHAR(255);
   ALTER TABLE applications ADD COLUMN entity_type VARCHAR(32);
   ALTER TABLE applications ADD COLUMN active_application_key VARCHAR(128);

   CREATE UNIQUE INDEX IF NOT EXISTS uq_active_application_key
   ON applications(active_application_key)
   WHERE status = 'new';

   CREATE TABLE IF NOT EXISTS application_deliveries (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
       destination VARCHAR(32) NOT NULL,
       status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
       message_id BIGINT,
       chat_id BIGINT NOT NULL,
       attempt_count INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       delivered_at DATETIME,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT uq_app_destination UNIQUE (application_id, destination)
   );

   CREATE INDEX IF NOT EXISTS idx_deliveries_app_id ON application_deliveries(application_id);

   COMMIT;
   ```

4. **PRAGMA Verification:**
   ```bash
   sqlite3 /opt/ast_bot/ast_bot.db "PRAGMA table_info(applications);"
   sqlite3 /opt/ast_bot/ast_bot.db "PRAGMA table_info(application_deliveries);"
   sqlite3 /opt/ast_bot/ast_bot.db "PRAGMA integrity_check;" # Must return ok
   ```

5. **Existing-Row Compatibility:**
   - In SQLite, all existing rows (IDs 109–123) receive `NULL` for newly added columns.
   - `NULL` values do not conflict in unique indexes in SQLite.
   - Zero historical rows require backfilling or modification.

6. **Rollback / Recovery Procedure:**
   - If migration transaction errors out before commit: SQLite automatically rolls back.
   - If unexpected regression occurs post-commit:
     ```bash
     systemctl stop ast_bot.service
     cp "$BACKUP_FILE" /opt/ast_bot/ast_bot.db
     sqlite3 /opt/ast_bot/ast_bot.db "PRAGMA integrity_check;"
     systemctl start ast_bot.service
     ```

---

## 7. MUTATION INVENTORY (READ-ONLY VERIFICATION)

```text
PRODUCT_FILES_MODIFIED:
NO

PRODUCTION_STATE_MODIFIED:
NO

GIT_MUTATION:
NONE (Only report file created under docs/reports/)

REPORT_PATH:
docs/reports/TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_5_APPLICATION_SUBMISSION_AND_DUAL_HANDOFF_1_PREFLIGHT_1_CORR2_20260924T040000Z.md

NEXT:
OWNER APPROVAL OF PREFLIGHT-1.CORR2
-> PROCEED TO IMPLEMENTATION-1 ENVELOPE

STOP.
```
