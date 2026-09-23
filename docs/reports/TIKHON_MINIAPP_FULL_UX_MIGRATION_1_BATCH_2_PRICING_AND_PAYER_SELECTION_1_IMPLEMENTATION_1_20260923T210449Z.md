# Tikhon Mini App — Full UX Migration — Batch 2: Pricing & Payer Selection — Implementation Report

- **Report ID:** TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_2_PRICING_AND_PAYER_SELECTION_1_IMPLEMENTATION_1
- **UTC:** 2026-09-23T21:04:49Z
- **Branch:** `navigator-production-dialogue-corr2-ab-normalization` @ `5d25641`
- **Preflight:** `docs/reports/TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_2_PRICING_AND_PAYER_SELECTION_1_PREFLIGHT_1_20260923T202405Z.md`
- **Status:** COMPLETE_AWAITING_OWNER_VISUAL_REVIEW (no git commit/push per contract)

## 1. Scope Delivered

Screen 3 («Кто будет оплачивать?») of the pricing-option → payer-type flow in
`/tikhon-miniapp-pilot`, UI-only, with zero persistence/payment side effects:

- Pricing option selection on Screen 2 with Batch-1 entitlement gating preserved
  (ELIGIBLE / PAID / LOCKED / DISABLED_STARTED_STAGED / legacy fail-closed).
- Single-option courses auto-select their only `single_payment` option from the
  source course object; Structural Typology requires explicit user selection
  (no first-eligible auto-select).
- Screen 3: summary card bound to source objects only (course/cohort/pricing option
  titles + option price), payer-type radiogroup with exactly two canonical options
  (`individual`, `legal_entity`; ИП stays inside `legal_entity` — no third class),
  canonical Public Offer notice via `openLink` to `/offer`, primary CTA
  «Продолжить» disabled until a valid payer type is selected.
- Local-only next-stage stub («Данные участника» / «Реквизиты ИП или организации»)
  with back navigation preserving all selections. No forms, no requisites, no
  payment channels, no submission.
- Auth boundary: transition to Screen 3 requires a valid Telegram session
  (`canProceedToPayerSelection` → `auth_required`); public browser mode keeps
  pricing viewable but locks gated Structural Typology stages
  (`getPublicAwareOptionEligibility`) and shows a bounded
  «Требуется вход через Telegram» modal. No fabricated unauthenticated identity,
  no `subject_key`, no raw Telegram user ID in UI state, no localStorage authority.

## 2. Files Changed

| File | Change |
| --- | --- |
| `src/app/tikhon-miniapp-pilot/helpers.ts` | Added `MiniAppScreen`, `PayerType`, `PAYER_TYPE_OPTIONS` (exactly `individual` / `legal_entity` with canonical Russian labels), `isValidPayerType`, `getNextStageLabel`, `getSingleAutoPricingOption`, `getPublicAwareOptionEligibility` (public mode locks level_2/level_3), `canProceedToPayerSelection` gate (`missing_selection` / `auth_required` / `not_eligible`). Batch-1 `getOptionEligibility` reused unchanged. |
| `src/app/tikhon-miniapp-pilot/page.tsx` | New state (`selectedPayerType`, `showAuthRequiredModal`, `hasTelegramInitData`, `studentStatusResolved`); multi-screen Telegram BackButton (detail→catalog, payer→detail, stub→payer); single-option auto-select with explicit-only for Structural Typology; guard clearing non-ELIGIBLE selections; `handleProceedToPayer` gate with bounded auth modal; 4-screen ternary (catalog/detail/payer/next_stage_stub); full Screen-3 JSX; local-only stub; Batch-1 notice modal replaced by auth-required modal. |
| `src/app/tikhon-miniapp-pilot/miniapp.module.css` | Appended Screen-3 + stub styles (payer cards with selected/radio states, summary card, disabled CTA states, 320px media rules) in the existing Academy design language. |
| `tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` | New: 22 tests covering contract §23–26 (A–V). |

No other source files touched by Batch 2. (`src/lib/chat-contract.ts` shows a
pre-existing unrelated diff from earlier session work; left untouched.)

## 3. Contract Compliance Highlights

- Exactly two payer types; `individual_entrepreneur` appears nowhere in helpers/page
  (test H).
- Screen 3 heading is «Кто будет оплачивать?» with subheading
  «Выберите тип плательщика»; the string «Способ оплаты» is absent (test L).
- All commercial facts render from `selectedCourse` / `selectedCohort` /
  `selectedPricingOption` source-backed objects; prohibited hardcoded price
  constants absent from Screen 3/stub regions (test F).
- Zero mutations: exactly two `fetch(` calls in page.tsx (GET courses, GET
  student-status); no POST/PUT/PATCH/DELETE, no XMLHttpRequest, no Supabase client,
  no mutation endpoints referenced (tests Q, R).
- No payment requisites/channels in source or rendered contract (test U).

## 4. Validation Evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | PASS (`/tmp/batch2_typecheck.log`) |
| Targeted Batch-2 suite | **22/22 PASS** (tests A–V) |
| Full suite `npm test` | **699/699 PASS** (677 baseline + 22 new), 0 fail (`/tmp/batch2_fulltest.log`) |
| `npm run build` | PASS — compiled, static generation OK; routes `/api/tikhon/courses`, `/api/tikhon/student-status`, `/tikhon-miniapp-pilot` built (`/tmp/batch2_build.log`) |
| `git diff --check` | CLEAN |

## 5. Deployment & Production Smoke Checks

- Deployed via `vercel deploy --prod` (no git commit/push per contract).
- Production alias: `https://structural-typology-navigator.vercel.app`
- Deployment: `https://structural-typology-navigator-i19o56k7v-npetiaev.vercel.app`

| Check | Result |
| --- | --- |
| `GET /tikhon-miniapp-pilot` | **200** |
| `GET /api/tikhon/courses` | **200** |
| `GET /offer` (canonical Public Offer) | **200** |
| `GET /api/tikhon/student-status` without initData | **401** (boundary intact) |
| `GET /api/tikhon/student-status` with forged initData | **401** `MISSING_HASH` — signature validation intact |

## 6. Responsive Verification (Static)

- Layout is fluid: cards are `width: 100%` within the padded container; container
  max-width governs 430px / 768px viewports (existing Academy design language).
- Breakpoints present: `@media (max-width: 390px)` (Batch-1 baseline) and
  `@media (max-width: 320px)` with Screen-3-specific rules — summary rows stack
  vertically, values left-align, total row left-justifies, heading scales to 19px.
- Disabled CTA has distinct visual state (opacity, no shadow, no active transform).
- Live visual confirmation at 320 / 390 / 430 / 768 px remains with the owner
  (visual review gate).

## 7. Residual Items / Out of Scope (per contract)

- No persistence, payment, invoice, or application-submission behavior introduced;
  next-stage stub is local-only by design.
- No git commit/push performed.
- Owner visual review of Screens 2→3→stub at 320/390/430/768 px pending.

## 8. Final Status

**STATUS: COMPLETE_AWAITING_OWNER_VISUAL_REVIEW**

