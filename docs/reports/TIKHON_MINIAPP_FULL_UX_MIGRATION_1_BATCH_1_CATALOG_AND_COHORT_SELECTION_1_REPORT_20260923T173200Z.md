# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-1.CATALOG-AND-COHORT-SELECTION-1 REPORT

**Act:** `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-1.CATALOG-AND-COHORT-SELECTION-1`
**Date (UTC):** `2026-09-23T17:32:00Z`
**Status:** `BATCH_1_COMPLETE_AWAITING_OWNER_VISUAL_REVIEW`
**Executor:** Antigravity / Gemini
**Live Production URL:** `https://structural-typology-navigator.vercel.app/tikhon-miniapp-pilot`

---

## 1. EXACT FILES CHANGED

### Repository: `structural-typology-navigator`
- `src/app/tikhon-miniapp-pilot/page.tsx`:
  - Removed pilot navigation restriction (`isDetailEnabled = course.id === "levels_of_consciousness"`), making all 5 Academy courses navigable from Screen 1 to Screen 2.
  - Enforced strict canonical open enrollment badge invariant (`is_enrollment_open === true && enrollment_status === "AVAILABLE"`).
  - Integrated Telegram WebApp lifecycle (`ready()`, `expand()`, `BackButton`) with client-side screen state synchronization.
  - Implemented URL query and Telegram WebApp deep linking (`?course=<id>`, `?startapp=<id>`, or `start_param`).
  - Added Screen 2 interactive cohort selector with mobile radio cards, selected state, sold-out disabled state, waiting list state, and non-trapping informational status modal.
- `src/app/tikhon-miniapp-pilot/helpers.ts` (NEW):
  - Extracted type interfaces (`Course`, `Cohort`, `PricingOption`, `ApiResponse`).
  - Implemented pure helper functions: `getMeetingWord`, `extractCadence`, `resolveDeepLinkCourseId`, `isCohortAvailable`, `isCohortWaitingList`, `isCohortUnavailable`, `getCohortBadgeText`.
- `src/app/tikhon-miniapp-pilot/miniapp.module.css`:
  - Added cohort card styles (`.cohortSection`, `.cohortCard`, `.cohortCardSelected`, `.cohortCardDisabled`, `.cohortCardWaitingList`, `.cohortRadioGroup`, `.cohortBadge`).
  - Added safe area insets and responsive rules for `320px`, `390px`, `430px`, and `768px`.
- `tests/tikhon-miniapp/batch-1-catalog-cohort.test.mts` (NEW):
  - Deterministic node:test suite covering Tests A through M (14 test cases).

---

## 2. SCREEN 1 IMPLEMENTATION (ACADEMY CATALOG / PROGRAMS)
- **Surfaces Covered:** `TIKHON-UX-001`, `TIKHON-UX-002`, `TIKHON-UX-003`.
- **Top Brand Header:** Preserved subtle official secretary Tikhon brand chrome with avatar.
- **Owner-Accepted Welcome Card:**
  - Heading: `Добро пожаловать!`
  - Text: `Здесь вы можете оформить участие в образовательных программах, выбрать удобный поток и получить счет на оплату (для физлиц через СБП или для юрлиц/ИП с закрывающими документами).`
  - Zero persona marketing, zero mission fluff, zero unverified claims.
- **Section Heading:** `Образовательные программы`
- **Dynamic Program List:**
  - All 5 programs rendered dynamically from Supabase projection payload (`GET /api/tikhon/courses`).
  - Badge logic: "Открыт набор" displays strictly when at least one active cohort has `is_enrollment_open = true` AND `enrollment_status = "AVAILABLE"`.
  - Otherwise displays "Лист ожидания" or "Набор закрыт".
  - Meeting count: dynamic Russian inflection via `getMeetingWord` (1 встреча, 2-4 встречи, 5+ встреч).
  - Price: formatted from canonical `pricing_options[0].price`.
  - Navigation: All 5 cards are interactive and navigate directly to Screen 2.

---

## 3. SCREEN 2 IMPLEMENTATION (COURSE DETAIL & COHORT SELECTION)
- **Surfaces Covered:** `TIKHON-UX-008`, `TIKHON-UX-010`, `TIKHON-UX-012`.
- **Navigation Bar:**
  - Back button `← Все программы` and Telegram native `BackButton` seamlessly integrated.
  - Screen title: `Карточка курса`.
- **Course Detail Header:**
  - Source-backed title, short description, meeting count, format/cadence, group limit.
  - Zero invented syllabi, speaker bios, or marketing claims.
- **Interactive Cohort Selector:**
  - Renders all cohorts provided by the canonical projection for the selected course.
  - Radio card pattern with clear indicator dot and border highlight.
  - Default selection targets the first available open cohort.
- **Pricing Summary:**
  - Renders the current authoritative price from `pricing_options[0]`.
  - Zero client-side discount math in React.
- **Primary CTA:**
  - Button `Оформить участие` with non-trapping bottom sheet confirming cohort selection and guiding the user to Telegram bot chat for payment invoice generation.

---

## 4. DEEP-LINK BEHAVIOR
- Implemented `resolveDeepLinkCourseId` supporting:
  - URL query parameters: `?course=<id>`, `?startapp=<id>`, `?start=<id>`.
  - Telegram WebApp parameter: `window.Telegram.WebApp.initDataUnsafe.start_param`.
- If a valid course ID is detected, the Mini App automatically opens Screen 2 for that course.
- If the parameter is missing or invalid, the app falls back safely to Screen 1 (Catalog) with zero unhandled errors.

---

## 5. LIVE DATA BINDING & PHYSICAL REALITY
- Physical data flow:
  1. Postgres canonical records on VPS ->
  2. Outbound projection worker (`projection_service.py`) ->
  3. Supabase table `public.tikhon_public_projection` ->
  4. Next.js API route `GET /api/tikhon/courses` ->
  5. Mini App React state (`courses`).
- Maslow Control Values:
  - `meetings_count = 4` [VERIFIED]
  - `price = 45 000 RUB` [VERIFIED]
  - `cadence = "Zoom · 2 раза в неделю"` [VERIFIED]
  - `max_participants = 24` [VERIFIED]
- Zero hardcoded course prices, dates, or factual constants exist in the UI source.

---

## 6. WAITING-LIST BEHAVIOR (`TIKHON-UX-010`)
- Identifies cohorts with `id === "waiting_list"` or `enrollment_status === "WAITING_LIST"`.
- Rendered with distinct badge "Лист ожидания" and subtle dashed border styling.
- Selectable client-side in Batch 1; mutation/application submission deferred to future batches.

---

## 7. UNAVAILABLE / SOLD-OUT BEHAVIOR (`TIKHON-UX-012`)
- Cohorts with `enrollment_status === "STARTED"` or `enrollment_status === "CAPACITY_REACHED"` or `!is_enrollment_open`:
  - Renders disabled (`aria-disabled="true"`, `cohortCardDisabled` class).
  - Cannot be selected.
  - Displays explicit state: "Набор завершён" (for started) or "Мест нет" (for capacity reached).

---

## 8. LOADING & ERROR STATES
- **Loading State:** Violet spinner with label `Загрузка расписания и программ...`
- **Error State:** If live API call fails, displays bounded message:
  - Title: `Актуальные данные временно недоступны`
  - Text: `Не удалось подключиться к расписанию Академии.`
  - Action: `Повторить` button triggering retry fetch.
  - ZERO stale hardcoded fallback facts are displayed.

---

## 9. RESPONSIVE VERIFICATION
- Container constrained to `max-width: 480px` with `overflow-x: hidden`.
- Safe area insets applied for iOS / Android notch and home bars (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`).
- Specific responsive breakpoints:
  - `320px`: flex wrapping on meta headers, stacked price box, zero horizontal scroll.
  - `390px`: iPhone standard viewport padding and typography scaling.
  - `430px`: iPhone Pro Max optimal spacing.
  - `768px`: centered column layout.

---

## 10. TEST VERIFICATION
- **Targeted Test Suite (`tests/tikhon-miniapp/batch-1-catalog-cohort.test.mts`):**
  - Test A: Screen 1 renders course cards from API payload dynamically — PASS
  - Test B: No hardcoded course prices in Screen 1/2 source code — PASS
  - Test C: No hardcoded course dates in Screen 1/2 source code — PASS
  - Test D: 'Открыт набор' appears ONLY for canonical open enrollment state — PASS
  - Test E: Unavailable cohort renders disabled with sold-out indicator — PASS
  - Test F: Waiting-list state renders distinctly marked and selectable — PASS
  - Test G: Course selection opens Screen 2 for all courses — PASS
  - Test H: Back navigation returns to Screen 1 — PASS
  - Test I: Valid deep link opens correct course directly — PASS
  - Test J: Invalid deep link safely returns null (catalog fallback) — PASS
  - Test K: API error displays bounded UI message without stale hardcoded facts — PASS
  - Test L: Maslow live control values render correctly from projection — PASS
  - Test M: Responsive structure contains no known horizontal-overflow regression — PASS
  - Helper Test: Russian meeting count inflection — PASS
  - **Result: 14/14 PASS**
- **Existing Tikhon Tests:**
  - `courses-supabase-route.test.ts` — 1/1 PASS
  - `live-data-binding.test.mts` — 4/4 PASS
- **Full Project Suite (`npm test`):**
  - **655 passed, 0 failed (100% PASS)**
- **Production Build (`npm run build`):**
  - Exit code: 0 (Turbopack production build succeeded)
- **Diff Check (`git diff --check`):**
  - Exit code: 0 (No whitespace errors or invalid diff markers)

---

## 11. LIVE DEPLOYMENT
- Deployed via `npx vercel --prod --yes` to Vercel production.
- Production Alias: `https://structural-typology-navigator.vercel.app`
- Direct Live Mini App Route: `https://structural-typology-navigator.vercel.app/tikhon-miniapp-pilot`
- Verification: `curl -I` returned `HTTP/2 200 OK`.

---

## 12. KNOWN LIMITATIONS & TECHNICAL DEBT
- **Route Name (`tikhon-miniapp-pilot`):** Preserved existing pilot path to maintain 100% zero-disruption compatibility with Telegram bot WebApp button URL. Canonical production alias (`/miniapp` or `/tikhon-miniapp`) can be mapped once bot settings are updated.
- **Batch 1 Scope Boundary:** Payer type selection, pricing tier selection (Screen 3), SBP checkout generation, B2B requisites, and transactional payment webhooks belong to Batch 2 and subsequent batches.

---

## 13. DEFERRED BATCH 2 DEPENDENCIES
1. **Deferred Commercial Gate:** Resolution of the 20% full-course prepayment discount base source must be physically bound before pricing selection implementation.
2. **Screen 3 (Pricing Tier & Tariff Selection):** Multi-tier pricing (Full Course / Level by Level) and student payer type selection.

---

## 14. GIT STATUS
- `GIT_COMMIT: NONE` (Forbidden in Batch 1 per §28 until Owner visual review).
- `PUSH: NONE` (Forbidden in Batch 1 per §28 until Owner visual review).
