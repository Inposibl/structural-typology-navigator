# DELIVERY REPORT: TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-1.CORR1.CORR2.CREDENTIAL-ROTATION-FINAL-CLOSURE-1

**Mandate:** `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-1.CORR1.CORR2.CREDENTIAL-ROTATION-FINAL-CLOSURE-1`
**Execution Date:** 2026-09-23T19:48:00Z
**Executor:** Antigravity / Gemini
**Audit Standard:** Antigravity Evidence Protocol v2.0 (Zero Axiom, Closed Write Allowlist, Zero Memory Assumption)
**Status:** HOLD — HOLD_OLD_SUPABASE_SECRET_ACTIVE

---

## 1. EXECUTIVE SUMMARY & EVIDENCE GRID

| Dimension | Physical Verification Standard | Actual Measured Evidence | Verdict |
|:---|:---|:---|:---:|
| **Old Telegram Bot Token** | Revocation verification via Telegram API | `https://api.telegram.org/bot<OLD_TOKEN>/getMe` returned `HTTP 401 Unauthorized` | **REVOKED** [VERIFIED] |
| **New Telegram Bot Token** | Production runtime & bot polling verification | Service `ast_bot.service` active (PID 88394); polling `@AST_payment_course_bot` active | **WORKING** [VERIFIED] |
| **Old Supabase Secret** | Revocation verification via REST API | `https://mgtghkxebccahtqqyyjv.supabase.co/rest/v1/` returned `HTTP 200 OK` (key still active in Supabase) | **ACTIVE (HOLD)** [VERIFIED] |
| **New Supabase Secret** | Query & mutation verification across VPS & Navigator | VPS projection sync: HTTP 200; Private query: HTTP 200 (6 rows); Vercel runtime: HTTP 200 | **WORKING** [VERIFIED] |
| **Subject Key Stability** | Decoupling proof after token rotation | `subject_key = HMAC_SHA256(ENTITLEMENT_SUBJECT_SECRET, "telegram:" + user_id)`. Zero token dependence. | **YES** [VERIFIED] |
| **API Response Privacy** | Remove raw `user_id`, `subject_key` from response | Live Vercel API `/api/tikhon/student-status` verified: `user_id` = false, `subject_key` = false | **REMOVED** [VERIFIED] |
| **Entitlement Reconciliation** | Full generation-based reconciliation | Supabase query: `total_rows: 6, total_gen: 1, min_ts == max_ts == 2026-09-23 19:38:22 UTC` | **PASS** [VERIFIED] |
| **Generations Count** | Exactly one active generation in Supabase | `CURRENT_GENERATIONS = 1` | **PASS** [VERIFIED] |
| **Stale / Old Key Rows** | Zero orphaned rows from old formulas or generations | `OLD_SUBJECT_KEY_ROWS = 0`, `STALE_ENTITLEMENT_ROWS = 0` | **PASS** [VERIFIED] |
| **Legacy Cohort 5 Disposition** | Historical students fail-closed in self-service | `legacy_history_unverified = true`, `paid_options = []` | **PASS** [VERIFIED] |
| **InitData New Token Auth** | Telegram WebApp HMAC validation | Live Vercel API returns `HTTP 200 OK` for valid signed `initData` | **PASS** [VERIFIED] |
| **InitData Old Token Auth** | Old revoked token signature rejected | Signed with old token returns `HTTP 401 UNAUTHORIZED` | **REJECTED** [VERIFIED] |
| **InitData Tamper / Expiry** | Boundary security checks | Tampered: 401; Expired: 401; Future-skewed: 401; Query param spoof attempt: rejected | **PASS** [VERIFIED] |
| **Private RLS Policy** | Direct browser access forbidden | Anon / publishable key to `tikhon_private_entitlements` returns `HTTP 401 (code 42501)` | **PASS** [VERIFIED] |
| **Inbound VPS Port 8080** | Network gate closure | `ss -tulpn | grep 8080` returned empty (`PORT 8080 CLOSED`) | **CLOSED** [VERIFIED] |
| **Secret Scan in Source/Tests** | Zero hardcoded credential literals in tracked code | Automated pattern scan across both repos: 0 violations found | **PASS** [VERIFIED] |
| **Navigator Test Suite** | Full test execution across entire repository | 677 tests passed, 0 failed, 0 skipped | **PASS** [VERIFIED] |
| **Backend Test Suite** | Python projection and reconciliation unit tests | 15 tests passed, 0 failed, 0 skipped | **PASS** [VERIFIED] |
| **Next.js Production Build** | Next.js 16.3.5 compile and typecheck | Typecheck: 0 errors; Build: compiled successfully in 5.0s | **PASS** [VERIFIED] |
| **Live Production Deployment** | Vercel live production release | Live at `https://structural-typology-navigator.vercel.app` (HTTP 200) | **YES** [VERIFIED] |
| **Git Invariants** | Zero commit, zero push standing rule | `GIT_COMMIT = NONE`, `PUSH = NONE` | **PASS** [VERIFIED] |

---

## 2. PHYSICAL SYSTEM STATE & ZERO AXIOM PROOFS

### 2.1 Telegram Bot Token State
- **Old Token Revocation Proof:**
  - Endpoint: `https://api.telegram.org/bot<OLD_TOKEN>/getMe`
  - Exit Code / Status: `HTTP 401 Unauthorized`
  - Verdict: `OLD_TELEGRAM_TOKEN = REVOKED`
- **New Token Runtime Proof:**
  - Command: `ssh root@37.77.104.66 "journalctl -u ast_bot.service -n 25 --no-pager"`
  - Output:
    ```text
    Run polling for bot @AST_payment_course_bot id=8682116994 - 'Тихон — AI секретарь Академии'
    Реконсиляция приватных прав завершена (поколение 151481ff-095a-41b5-84b9-b6252fe4c49f, строк: 6).
    Публичная проекция курсов успешно синхронизирована с Supabase (HTTP 200).
    Start polling.
    ```
  - Service PID: `88394` (active)

### 2.2 Supabase Key State & HOLD Rationale
- **New Key Working Proof:**
  - Tested from VPS projection worker: `HTTP 200`
  - Tested from Python test suite: `HTTP 200`
  - Tested from live Vercel API: `HTTP 200`
  - Verdict: `NEW_SUPABASE_SECRET = WORKING`
- **Old Key Physical Status:**
  - Request to `https://mgtghkxebccahtqqyyjv.supabase.co/rest/v1/tikhon_public_projection?id=eq.current&select=id` using the old key returned `HTTP 200 OK`.
  - Inspection via Supabase CLI (`supabase projects api-keys`):
    - Key `ac74c79a-c973-4b8d-8859-e3badf650b1e` (name: `default`, prefix: `sb_secret_kmLcS...`, created 2026-09-17) remains active in Supabase Console.
    - Key `4bdf0408-3fad-4309-9ce8-3ef01e0584b1` (name: `tikhonbackend09232026`, prefix: `sb_secret_ix64h...`, created 2026-09-23 19:34:42) is the newly provisioned key.
  - Per Section 6 Mandate:
    > *"If old credential still works: STATUS = HOLD_OLD_SUPABASE_SECRET_ACTIVE. STOP."*
  - Therefore, status is marked `HOLD_OLD_SUPABASE_SECRET_ACTIVE` until the Owner revokes the old key `default` in Supabase Console.

### 2.3 API Response Privacy Proof (Live Vercel Production)
- **Endpoint:** `GET https://structural-typology-navigator.vercel.app/api/tikhon/student-status`
- **Live Response Payload:**
  ```json
  {
    "is_authenticated": true,
    "courses": {
      "structural_typology": {
        "paid_options": [],
        "legacy_history_unverified": true
      }
    }
  }
  ```
- **Fields Verified Absent:**
  - `"user_id"`: NOT PRESENT (`undefined`)
  - `"subject_key"`: NOT PRESENT (`undefined`)
  - `"telegram_user_id"`: NOT PRESENT (`undefined`)

### 2.4 Supabase Table Generation Proof
- **Query:** `SELECT count(*) as total_rows, count(distinct generation_id) as total_gen, min(updated_at) as min_ts, max(updated_at) as max_ts FROM public.tikhon_private_entitlements;`
- **Output:**
  ```json
  {
    "total_rows": 6,
    "total_gen": 1,
    "min_ts": "2026-09-23 19:38:22.563859+00",
    "max_ts": "2026-09-23 19:38:22.563859+00"
  }
  ```
- `CURRENT_GENERATIONS = 1`
- `OLD_SUBJECT_KEY_ROWS = 0`
- `STALE_ENTITLEMENT_ROWS = 0`

---

## 3. ACTION REQUIRED BY OWNER TO CLEAR HOLD

To clear `HOLD_OLD_SUPABASE_SECRET_ACTIVE`:
1. Navigate to Supabase Dashboard: `https://supabase.com/dashboard/project/mgtghkxebccahtqqyyjv/settings/api`.
2. Under **Project API keys** -> **Secret API keys**, locate the old key named `default` (created on 2026-09-17, ID `ac74c79a-c973-4b8d-8859-e3badf650b1e`).
3. Click the three dots menu next to it and select **"Revoke"** (or **"Delete"**).
4. Once revoked, the old key will return `HTTP 401 / 403`, immediately satisfying the final revocation condition.

---

## 4. REPOSITORY STATE

- **Chatbot:**
  - Branch: `feat/telegram-shared-brain-integration-1`
  - Modified files: `config.py`, `projection_service.py`, `tests/test_projection_service.py`
  - Scripts added: `scripts/rotate_bot_token.sh`, `scripts/rotate_supabase_key.sh`
  - Zero git commit or push executed.
- **Navigator:**
  - Branch: `navigator-production-dialogue-corr2-ab-normalization`
  - Modified files: `src/app/api/tikhon/student-status/route.ts`, `tests/tikhon-miniapp/batch-1-corr1-entitlements.test.mts`
  - Migration file: `supabase/migrations/20260923191500_tikhon_private_entitlements_generation.sql`
  - Zero git commit or push executed.
