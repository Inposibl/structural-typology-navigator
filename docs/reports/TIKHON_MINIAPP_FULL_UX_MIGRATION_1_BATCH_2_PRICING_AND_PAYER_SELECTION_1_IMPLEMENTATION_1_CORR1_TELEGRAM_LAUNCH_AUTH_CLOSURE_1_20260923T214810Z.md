# Tikhon Mini App — Batch 2 — CORR1 — Telegram Launch Auth Closure

- **Act:** TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-2.PRICING-AND-PAYER-SELECTION-1.IMPLEMENTATION-1.CORR1.TELEGRAM-LAUNCH-AUTH-CLOSURE-1
- **Executor / role:** Claude — Primary Coder
- **UTC:** 2026-09-23T21:48:10Z
- **Branch:** `navigator-production-dialogue-corr2-ab-normalization` @ `d090270` (HEAD moved from `5d25641` during this act by the Owner's separate commit `d090270 docs: bind current coder routing governance`, AGENTS.md only)
- **Status:** HOLD — fix deployed and all local/live gates pass; closure requires Owner reproduction from Telegram (§9), which cannot be executed from this environment. The upstream cause of the 502 is not yet identified (§6).

## 1. Observed failure

The Owner opened the Mini App from Telegram on Android and pressed «Оформить участие». The app showed «Требуется вход через Telegram» even though the Owner was inside Telegram.

## 2. Root cause — CASE_D_OTHER_PROVEN_CAUSE

### 2.1 Launch mode is WEB_APP (CASE_A excluded)

`chatbot/handlers/client.py` (read-only, not modified):

```
90: TIKHON_MINIAPP_URL = "https://structural-typology-navigator.vercel.app/tikhon-miniapp-pilot"
95:     miniapp_btn = InlineKeyboardButton(
96:         text="Продолжить общение",
97:         web_app=WebAppInfo(url=TIKHON_MINIAPP_URL),
186:            menu_button=MenuButtonWebApp(text="Продолжить общение", web_app=WebAppInfo(url=TIKHON_MINIAPP_URL)),
```

### 2.2 Telegram initData reached the server and passed HMAC (CASE_B / CASE_C excluded for this incident)

Production request log (`vercel logs --environment production --json`, deployment `dpl_E6nkaAqXuqnFQLHwJ2jRq7EhSdLL`):

| UTC | Request | Status | Attribution |
| --- | --- | --- | --- |
| 21:04:26 / 21:04:27 | `/api/tikhon/student-status` | 401 / 401 | Kimi smoke checks (no initData, forged initData) |
| 21:16:19 | `/api/tikhon/student-status` | 401 | Z.AI unauthenticated smoke check |
| 21:21:41 / 21:21:42 | pilot 200 · courses 200 · student-status **200** | — | Real Telegram session, validated |
| 21:34:00 / 21:34:01 | pilot 304 · courses **200** · student-status **502** | — | Real Telegram session; **HMAC passed**, entitlement lookup failed |

In `src/app/api/tikhon/student-status/route.ts`, a 502 is returned **only** from the `SUPABASE_QUERY_FAILED` branch. That branch runs after `validateTelegramInitData(...)` has returned `valid: true`. Missing, tampered, expired or future-dated initData all return 401. So at 21:34:01 Telegram had delivered valid signed initData.

The script-loading race was also checked. `telegram-web-app.js` is queued via `self.__next_s` in `<body>`, and `next/dist/client/app-bootstrap.js` reads that queue once. The theoretical race did not reproduce in 5 consecutive desktop loads (`typeof window.Telegram === "object"` every time), and it does not match the log evidence. It remains a latent risk (see §6).

### 2.3 Client defect that produced the wrong message

Pre-fix `page.tsx`:

```
if (res.ok) {
  const data: StudentStatusResponse = await res.json();
  setStudentStatus(data);
}
...
const isAuthenticated = studentStatus?.is_authenticated === true;
```

Any failed status response (401, 5xx or network error) was treated the same way: `isAuthenticated=false`. The gate then returned `auth_required` and showed «Требуется вход через Telegram». An upstream entitlement-lookup failure was misreported to the user as a missing Telegram login.

## 3. Correction (minimal, client-only)

`src/app/tikhon-miniapp-pilot/page.tsx`:

1. Added `StudentStatusCheck = "idle" | "ok" | "unauthorized" | "unavailable"`, plus the constants `STUDENT_STATUS_MAX_ATTEMPTS = 3` and `STUDENT_STATUS_RETRY_DELAY_MS = 700`.
2. `loadStudentStatus` is now a `useCallback`:
   - It still reads `window.Telegram?.WebApp?.initData` and sends it only in the `x-telegram-init-data` header.
   - `res.ok` → `ok`. `401` → `unauthorized`, with no retry. 5xx or network error → retried with linear backoff, then `unavailable`.
   - There is still exactly one `fetch("/api/tikhon/student-status"…)` call site.
3. `handleProceedToPayer`: if a Telegram session has status `unavailable`, it opens a new modal «Не удалось проверить статус участия» with a «Повторить проверку» button that re-runs `loadStudentStatus`. It never opens Screen 3 and never shows the Telegram-login modal.
4. `isAuthenticated` is unchanged: it still comes only from a 2xx server response. `unavailable` stays closed, so gated stages remain locked and there is no transition to the payer screen.

Not changed: the server route, HMAC / auth_date / future-skew / tamper checks, the chatbot, helpers.ts, CSS, and all entitlement rules.

## 4. Tests

`tests/tikhon-miniapp/batch-2-pricing-payer.test.mts`: added the `CORR1` describe block with 9 tests. The route tests are hermetic: test-only bot token and env, stubbed upstream `fetch`, env and fetch restored in `finally`, no network.

| Test | Covers |
| --- | --- |
| CORR1-A | initData taken from `Telegram.WebApp.initData`, sent only in a header; `isAuthenticated` comes only from the server response |
| CORR1-B | valid signed initData → route 200 `is_authenticated:true` → payer gate `allowed` |
| CORR1-C | no initData → 401, no upstream lookup, gate `auth_required` |
| CORR1-D / E / F | tampered → 401 `HASH_MISMATCH`; expired → 401 `EXPIRED_INIT_DATA`; future-dated → 401 `FUTURE_AUTH_DATE` |
| CORR1-G | 200 body contains no raw Telegram user ID or `subject_key`; page never reads `initDataUnsafe.user` |
| CORR1-H | upstream call is GET only; page still has exactly 2 `fetch(` calls; no mutating methods |
| CORR1-W | valid signature + upstream failure → 502 (not 401); client 401 / unavailable split; unavailable branch comes before the gate and never calls `setScreen` or the auth modal; retries bounded |

Forced-failure check: the pre-fix `page.tsx` (`/tmp/page.tsx.bak.corr1.20260923T214152Z`) contains 0 occurrences of `res.status === 401`, so CORR1-W fails against it.

## 5. Validation

| Gate | Command | Result |
| --- | --- | --- |
| Batch-2 targeted | `node --import tsx --test tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` | PASS 31/31 (22 + 9 CORR1) |
| Full regression | `npm test` | PASS 708/708, 0 fail |
| Typecheck | `npm run typecheck` | PASS (exit 0) |
| Build | `npm run build` | PASS (exit 0) |
| Diff check | `git diff --check` | PASS (exit 0); untracked test file checked via `--no-index --check`: no whitespace errors |
| Deploy | `vercel deploy --prod --yes` | exit 0 → `https://structural-typology-navigator-ft1tpeke1-npetiaev.vercel.app`, aliased to production |

Live checks (production alias, after deploy):

| Check | Result |
| --- | --- |
| `GET /tikhon-miniapp-pilot` | 200 |
| `GET /api/tikhon/courses` | 200 |
| `GET /offer` | 200 |
| `GET /api/tikhon/student-status` (no initData) | 401 |
| `GET /api/tikhon/student-status` (forged initData) | 401 |
| CORR1 bundle served | modal copy found in `/_next/static/immutable/chunks/0qa3sfpm3lixm.js` |
| Ordinary browser → «Оформить участие» | «Требуется вход через Telegram» shown; Screen 3 not reached; `initData === ""` |
| Real Telegram session → Screen 3 | **NOT VERIFIED** (no Telegram client available here; no Telegram session has hit the new deployment as of 21:47:49Z) |

## 6. Open items

1. **Upstream 502 cause unknown.** Why the `tikhon_private_entitlements` lookup failed at 21:34:01 is not established; it succeeded at 21:21:42, and `/api/tikhon/courses` against the same Supabase project succeeded in the same second. The route returns Supabase's error text to the client but does not log it, so Vercel logs have `logs: []`. A read-only probe of that endpoint needs production credentials; it was blocked by this environment's permission policy and not attempted any other way. If the failure is transient, the bounded retry recovers automatically. If it is persistent, the user now sees an accurate retryable message but still cannot reach Screen 3. Recommended follow-up, subject to separate authorization: add a server-side `console.error` of the upstream status and message in `route.ts` (no secrets), or authorize a read-only Supabase probe.
2. **Latent script-loading race (not proven).** `layout.tsx` (separate-track, untracked) places `next/script beforeInteractive` in a nested layout. Next emits the `__next_s` push in `<body>`, while `app-bootstrap` reads the queue once. Not reproduced, and not the cause of this incident. Recorded only.
3. `vercel deploy` uploads the working tree, so the production build also contains the separate-track uncommitted files (`src/lib/chat-contract.ts`, `layout.tsx`, `conversation-first-contact.ts`), exactly as the Batch-2 deploy did. This act did not modify them.

## 7. Boundaries

- Files changed by this act: `src/app/tikhon-miniapp-pilot/page.tsx`, `tests/tikhon-miniapp/batch-2-pricing-payer.test.mts`, and this report.
- Chatbot: read-only, not modified, not restarted.
- No Application created, no payment, no invoice, no DB / Supabase / SQLite mutation, no POST/PUT/PATCH/DELETE.
- No commit, no push. Batch 2 remains pending Owner visual acceptance.
