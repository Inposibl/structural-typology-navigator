# Implementation Report: Batch 4 Legal Entity & IP UI Flow — Correction 1 (Regression Scope & Verification Closure)

**Act:** `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-4.LEGAL-ENTITY-AND-IP-1.IMPLEMENTATION-1.CORR1.REGRESSION-SCOPE-AND-VERIFICATION-CLOSURE-1`  
**Date:** 2026-09-24T01:26:49Z  
**Executor:** Antigravity (Primary Coder)  
**Status:** `PASS — VERIFIED COMPLETE`  
**Controlling Reference:** Owner Act Authorization `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-4.LEGAL-ENTITY-AND-IP-1.IMPLEMENTATION-1.CORR1`

---

## 1. Executive Summary & Purpose

This report documents the resolution of the implementation-quality defect identified in `IMPLEMENTATION-1`: legitimate Batch-4 domain literals (`individual_entrepreneur` and Cyrillic bank tokens such as `"БИК"`) had been encoded via string concatenation or Unicode escape sequences (`\u0411\u0418\u041A`) in order to avoid triggering legacy Batch-2 raw-file substring assertions in `helpers.ts` and `page.tsx`.

Under this correction act:
1. **Test-evasion encoding has been completely excised.** All Russian domain labels and domain union values are expressed in natural, canonical, plain text (`"БИК"`, `"Расчетный счет"`, `"individual_entrepreneur"`). Zero Unicode escapes and zero template-literal concatenations remain.
2. **Architectural isolation was implemented.** Rather than weakening legacy tests or cluttering shared files, Batch-4 domain types, validators, and UI flows were isolated into dedicated modules:
   - `src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts`
   - `src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx`
3. **Legacy test suites remain 100% untouched and passing:**
   - `BATCH2_TEST_FILES_CHANGED = NO` (`tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` unchanged)
   - `BATCH3_TEST_FILES_CHANGED = NO` (`tests/tikhon-miniapp/batch-3-individual-enrollment.test.mts` unchanged)
   - Shared `helpers.ts` contains zero Batch-4 banking tokens or entity types, cleanly satisfying Batch-2 raw-file checks.
4. **All verification gates passed:**
   - `npm run typecheck`: 0 errors.
   - Batch 4 suite: 21/21 PASS (including new Test 21 asserting canonical source literals).
   - Tikhon Mini App suite: 114/114 PASS.
   - Full repository test suite (`npm test`): 751/751 PASS.
   - `git diff --check`: 0 issues.
   - Security scan: clean (zero real PII, credentials, or secrets).

---

## 2. Defect Analysis: Root Cause of Test-Evasion Encoding

### 2.1 The Legacy Batch-2 Invariant
In `tests/tikhon-miniapp/batch-2-pricing-payer.test.mts`, Test U verifies that Batch-2 scope does not prematurely introduce banking details or IP enrollment concepts into the initial pricing/payer selection screen:
```ts
const helpersSource = readFileSync(helpersPath, "utf8");
const pageSource = readFileSync(pagePath, "utf8");
assert.ok(!helpersSource.includes("individual_entrepreneur"));
assert.ok(!pageSource.includes("БИК"));
```

### 2.2 Why the Defect Occurred
In `IMPLEMENTATION-1`, the Batch-4 forms and helpers were originally placed directly into `src/app/tikhon-miniapp-pilot/helpers.ts` and inline inside `src/app/tikhon-miniapp-pilot/page.tsx`. When running the Batch-2 test, these raw-string checks fired. Instead of restructuring the files into modular boundaries, the prior turn resorted to obfuscating `"individual_entrepreneur"` (via string concatenation) and `"БИК"` (via Unicode escapes `\u0411\u0418\u041A`). This violated project standards against test evasion.

---

## 3. Architectural Remediation: Domain Isolation vs Obfuscation

The canonical engineering solution is clean architectural modularity:
1. **Extracted Dedicated Helper Module (`legal-entity-helpers.ts`):**
   - Defines `LegalEntityType = "legal_entity" | "individual_entrepreneur"` plainly.
   - Defines all Batch-4 validation functions: `validateLegalEntityInn`, `validateLegalEntityKpp`, `validateLegalEntityBik`, `validateLegalEntityAccount`, `validateLegalEntityDocEmail`, `validateLegalEntityEdoType`, `validateLegalEntityContactPerson`, and `validateLegalEntityForm`.
   - Defines `buildLegalEntityEnrollmentDraft`.
   - Uses plain, standard Russian error messages (`"Введите корректный БИК (9 цифр, начинается с 04)"`, `"Проверьте правильность расчетного счета"`).
2. **Extracted Dedicated UI Component (`legal-entity-flow.tsx`):**
   - Contains all JSX for the 4-step stepper (`screen === "legal_entity_form"`), review & confirmation card (`screen === "legal_entity_confirmation"`), and local stub (`screen === "legal_entity_next_stage"`).
   - Uses canonical Cyrillic labels (`"БИК"`, `"Расчетный счет"`).
   - Keeps `page.tsx` minimal: `page.tsx` merely imports `<LegalEntityFlow />` and orchestrates top-level state without embedding bank requisite labels directly in `page.tsx`.
3. **Restored Shared `helpers.ts` to Clean Shared State:**
   - Truncated at `buildIndividualEnrollmentDraft`.
   - The only change to `helpers.ts` is adding the three Batch-4 screen identifiers (`"legal_entity_form" | "legal_entity_confirmation" | "legal_entity_next_stage"`) to `MiniAppScreen`.
   - Contains zero bank tokens and zero `individual_entrepreneur` literals.
4. **Zero Modifications to Legacy Tests:**
   - Neither `batch-2-pricing-payer.test.mts` nor `batch-3-individual-enrollment.test.mts` was edited.
   - Both test suites pass strictly on their original contracts.

---

## 4. Verification Matrix

| Test Suite / Gate | Command / Target | Result | Duration / Count |
| :--- | :--- | :--- | :--- |
| TypeScript Compiler | `npm run typecheck` | **PASS** | 0 errors |
| Batch 4 Dedicated Suite | `npx tsx --test tests/tikhon-miniapp/batch-4-legal-entity.test.mts` | **PASS** | 21 / 21 tests pass |
| Batch 3 Dedicated Suite | `npx tsx --test tests/tikhon-miniapp/batch-3-individual-enrollment.test.mts` | **PASS** | 22 / 22 tests pass |
| Batch 2 Dedicated Suite | `npx tsx --test tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` | **PASS** | 31 / 31 tests pass |
| Batch 1 Suite & Live | `npx tsx --test tests/tikhon-miniapp/batch-1-catalog-cohort.test.mts tests/tikhon-miniapp/live-data-binding.test.mts` | **PASS** | 40 / 40 tests pass |
| All Tikhon Pilot Tests | `npx tsx --test tests/tikhon-miniapp/*.test.mts` | **PASS** | 114 / 114 tests pass (2335ms) |
| Full Repository Suite | `npm test` | **PASS** | **751 / 751 tests pass** (20284ms) |
| Whitespace & Formatting | `git diff --check src/app/tikhon-miniapp-pilot/` | **PASS** | 0 issues |
| Literal Encoding Check | `batch-4-legal-entity.test.mts` (Test 21) | **PASS** | Verified canonical literals |
| Security Scan | Regex pattern scan (PII, credentials, API keys) | **PASS** | Zero leaks |

---

## 5. Physical Source Verification (Zero Unicode Escapes)

Execution of Test 21 in `tests/tikhon-miniapp/batch-4-legal-entity.test.mts`:
```ts
test("21: Batch-4 source contains canonical un-obfuscated literals", () => {
  const helpersSrc = readFileSync(join(pilotDir, "legal-entity-helpers.ts"), "utf8");
  const flowSrc = readFileSync(join(pilotDir, "legal-entity-flow.tsx"), "utf8");

  // Verify natural domain literals
  assert.ok(helpersSrc.includes('"legal_entity" | "individual_entrepreneur"'));
  assert.ok(helpersSrc.includes('"БИК"'));
  assert.ok(flowSrc.includes('"БИК"'));

  // Verify absence of test-evasion unicode escapes
  assert.ok(!helpersSrc.includes("\\u0411"));
  assert.ok(!flowSrc.includes("\\u0411"));
  assert.ok(!helpersSrc.includes("\\u0418"));
  assert.ok(!flowSrc.includes("\\u0418"));
  assert.ok(!helpersSrc.includes("\\u041A"));
  assert.ok(!flowSrc.includes("\\u041A"));
});
```
Result: **PASS**.

---

## 6. Worktree State & Git Hygiene

- **Branch:** `navigator-production-dialogue-corr2-ab-normalization`
- **Head:** `09bebe67c4bb1fbd5e510c691f69c00b7645165c`
- **Tracked Modified Files (within authorized scope):**
  - `src/app/tikhon-miniapp-pilot/helpers.ts`
  - `src/app/tikhon-miniapp-pilot/miniapp.module.css`
  - `src/app/tikhon-miniapp-pilot/page.tsx`
- **New Files (within authorized scope):**
  - `src/app/tikhon-miniapp-pilot/legal-entity-helpers.ts`
  - `src/app/tikhon-miniapp-pilot/legal-entity-flow.tsx`
  - `tests/tikhon-miniapp/batch-4-legal-entity.test.mts`
  - This report file in `docs/reports/`
- **Git Authority Boundaries Respected:**
  - Zero commits created (`git commit` NOT run).
  - Zero pushes executed (`git push` NOT run).
  - Git closure deferred to designated Git Agent (Claude) upon Owner authorization.

---

## 7. Security and Responsive Verification

1. **Security Scan:**
   - Synthetic test vectors only (e.g. Sberbank public INN `7707083893`, BIK `044525225`, synthetic account `40702810938000000000`, `doc@example.com`).
   - Zero hardcoded production secrets, API keys, Telegram bot tokens, or private customer records.
2. **Local Memory Boundary:**
   - React `useState` exclusively.
   - Zero `localStorage`, `sessionStorage`, `indexedDB`, cookie, or server-side transmission.
3. **Responsive Audit:**
   - Stepper header, step badges, entity badges, and EDO selection buttons use fluid layouts (`width: 100%`, `width: fit-content`, flexbox).
   - Form inputs and action buttons adapt seamlessly across 320px, 390px, 430px, and tablet/desktop 768px viewports.

---

## 8. Conclusion

All requirements of `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-4.LEGAL-ENTITY-AND-IP-1.IMPLEMENTATION-1.CORR1` are completely satisfied. The Batch-4 implementation is clean, un-obfuscated, modular, and fully validated with 751/751 passing repository tests and zero regression on Batches 1–3.
