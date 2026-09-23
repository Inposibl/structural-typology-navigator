# TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-2.PRICING-AND-PAYER-SELECTION-1.PREFLIGHT-1 REPORT

**Date:** 2026-09-23T20:24:05Z  
**Executor:** Antigravity / Gemini  
**Role:** Analyst / Auditor (Preflight Only, Read-Only per AGENTS.md §7.2)  
**Mandate:** `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-2.PRICING-AND-PAYER-SELECTION-1.PREFLIGHT-1`

---

## 1. CONTROLLING REPOSITORY STATE

- **Navigator Controlling Commit:** `5d2564188ffd042a0ee6127786d311e98fd95945` `[VERIFIED]`
  - Branch: `navigator-production-dialogue-corr2-ab-normalization` `[VERIFIED]`
  - Remote: `origin/navigator-production-dialogue-corr2-ab-normalization` (Tri-SHA parity confirmed bit-for-bit) `[VERIFIED]`
- **Chatbot Controlling Commit:** `c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183` `[VERIFIED]`
  - Branch: `feat/telegram-shared-brain-integration-1` `[VERIFIED]`
  - Remote: `NOT_CONFIGURED` (Closed locally) `[VERIFIED]`
- **Batch 1 Baseline:**
  - Live course catalog & cohort selection: `PASS`
  - Canonical prices & staged progression: `PASS`
  - Authenticated student status & private entitlement: `PASS`
  - Public Offer route (`/offer` -> `public/offer.html`): `PASS`
  - Avatar identity & styling: `PASS`
  - Test suites: 677/677 tests passing `[VERIFIED]`

---

## 2. CANONICAL PAYER-TYPE AUTHORITY

Inspection of the physical codebase establishes that Tikhon has exactly **two** canonical payer types across all layers:

1. **Physical Source Definitions:**
   - `chatbot/database.py` (line 46-47):
     ```python
     # Тип плательщика: 'individual' (физлицо) или 'legal_entity' (ИП / Юрлицо)
     payer_type: Mapped[str] = mapped_column(String(32))
     ```
   - `chatbot/states.py` (lines 16-34):
     - State `OrderFlow.choosing_payer_type` branches into:
       - Individual branch: `ind_full_name`, `ind_phone`, `ind_email`, `ind_confirm_terms`
       - Legal entity / IP branch: `leg_inn`, `leg_confirm_company`, `leg_company_name_manual`, `leg_bik`, `leg_account`, `leg_doc_email`, `leg_edo_type`, `leg_contact_person`
   - `chatbot/keyboards.py` (lines 160-184):
     ```python
     def get_payer_type_kb() -> InlineKeyboardMarkup:
         return InlineKeyboardMarkup(
             inline_keyboard=[
                 [InlineKeyboardButton(text="👤 Оплата от физического лица (СБП / перевод)", callback_data="payer:individual")],
                 [InlineKeyboardButton(text="🏢 Оплата от ИП или Юрлица (счет + акты)", callback_data="payer:legal_entity")],
                 [InlineKeyboardButton(text="⬅️ Назад к выбору тарифа", callback_data="nav:back_to_pricing")],
                 [InlineKeyboardButton(text="🔄 Выбрать другой курс", callback_data="nav:back_to_courses")],
             ]
         )
     ```
   - `chatbot/handlers/client.py` (lines 478-493, 651-666):
     - Handler `cb_payer_individual`: triggered on `F.data == "payer:individual"`, updates `payer_type="individual"`.
     - Handler `cb_payer_legal_entity`: triggered on `F.data == "payer:legal_entity"`, updates `payer_type="legal_entity"`.
   - `chatbot/validators.py` (lines 15-54):
     - Algorithm `validate_inn(inn)` validates 10 digits as `"legal_entity"` and 12 digits as `"individual_entrepreneur"`. Both are handled under the single canonical `payer_type="legal_entity"` flow in business logic.

**Canonical String Identifiers:**
- `"individual"`
- `"legal_entity"`

---

## 3. APPLICATION CREATION BOUNDARY

Inspection of `chatbot/handlers/client.py` reveals the exact mechanical persistence point:

- `APPLICATION_CREATED_BEFORE_PAYER_SELECTION`: **NO** `[VERIFIED]`
- `APPLICATION_CREATED_AT_PAYER_SELECTION`: **NO** `[VERIFIED]`
- `APPLICATION_CREATED_AFTER_PAYER_DETAILS`: **NO** `[VERIFIED]`
- `APPLICATION_CREATED_AT_FINAL_CONFIRMATION`: **YES** `[VERIFIED]`

### Detailed Trace:
1. **Payer Selection Phase:**
   When user selects `payer:individual` or `payer:legal_entity`, only the in-memory FSM state is updated (`await state.update_data(payer_type=...)`). No SQLite row is inserted.
2. **Individual Person Flow:**
   User enters `full_name` -> enters `phone` -> enters `email` -> views summary card.
   Only when user explicitly clicks `confirm:ind_terms` (`cb_ind_terms_confirmed`, lines 577-604) is `Application` instantiated and committed (`session.add(app); await session.commit()`).
3. **Legal Entity / IP Flow:**
   User enters `inn` -> confirms DaData lookup -> enters `bik` -> enters `account` -> enters `doc_email` -> selects `edo_type` -> enters `contact_person`.
   Only on the final step `msg_leg_contact_person` (lines 830-868) is `Application` instantiated and committed (`session.add(app); await session.commit()`).

**Invariant for Batch 2:**  
Batch 2 covers only the presentation and selection of pricing option and payer type. It does **not** insert or create any Application records.

---

## 4. PRICING OPTION CONTRACT

Physical inspection of `COURSES_REGISTRY` in `chatbot/calendar_service.py` and live production API `https://structural-typology-navigator.vercel.app/api/tikhon/courses`:

| Course ID | Course Classification | Pricing Option ID | Title | Price | Base Price | Discount | Description | Selection Required? |
|---|---|---|---|---|---|---|---|---|
| `levels_of_consciousness` | `SINGLE_OPTION` | `single_payment` | Полный курс (4 встречи) | 45 000 ₽ | None | None | Полный курс (4 встречи) | Implicit / Auto |
| `maslow` | `SINGLE_OPTION` | `single_payment` | Полный курс (4 встречи) | 45 000 ₽ | None | None | Полный курс (4 встречи) | Implicit / Auto |
| `normative_situation` | `SINGLE_OPTION` | `single_payment` | Полный курс (4 встречи) | 45 000 ₽ | None | None | Полный курс (4 встречи) | Implicit / Auto |
| `play_and_creativity` | `SINGLE_OPTION` | `single_payment` | Полный курс (6 встреч) | 60 000 ₽ | None | None | Полный курс (6 встреч) | Implicit / Auto |
| `structural_typology` | `STAGED_OPTION` | `full_prepayment` | Полный курс (Уровни 1, 2, 3) | 160 000 ₽ | 200 000 ₽ | 20% | Оплата полного курса единовременно со скидкой 20% | Explicit Required |
| `structural_typology` | `STAGED_OPTION` | `level_1` | Уровень 1. Базовый | 50 000 ₽ | None | None | Оплата 1-го уровня курса | Explicit Required |
| `structural_typology` | `STAGED_OPTION` | `level_2` | Уровень 2. Практикум | 100 000 ₽ | None | None | Оплата 2-го уровня курса | Explicit Required (gated by L1) |
| `structural_typology` | `STAGED_OPTION` | `level_3` | Уровень 3. Мастерская | 50 000 ₽ | None | None | Оплата 3-го уровня курса | Explicit Required (gated by L1+L2) |

---

## 5. DEFAULT SELECTION RULE

- **Single-Price Courses:**
  In native bot (`handlers/client.py` lines 378-396), when `len(course.pricing_options) == 1`:
  The bot **automatically selects** `single_opt`, assigns `pricing_option_id=single_opt.id`, and transitions directly to payer selection without requiring an intermediate click.
  *Mini App Rule:* For single-option courses, the option is automatically marked as selected by default.
- **Structural Typology:**
  In native bot (`handlers/client.py` lines 363-377), when `len(course.pricing_options) > 1`:
  The bot enters `OrderFlow.choosing_pricing_option` and presents buttons. No option is selected until the user clicks.
  *Mini App Rule:* For Structural Typology, multiple options are presented; if multiple options are eligible (e.g. `level_1` and `full_prepayment`), user must make an explicit choice.

---

## 6. PAYER OPTIONS COMPATIBILITY MATRIX

Physical inspection of `handlers/client.py` (lines 394 and 425) verifies that `get_payer_type_kb()` is invoked unconditionally for every course, cohort, and pricing option:

| Course | Pricing Option | Physical Person (`individual`) | Legal Entity / IP (`legal_entity`) |
|---|---|---|---|
| `levels_of_consciousness` | `single_payment` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `maslow` | `single_payment` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `normative_situation` | `single_payment` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `play_and_creativity` | `single_payment` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `structural_typology` | `full_prepayment` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `structural_typology` | `level_1` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `structural_typology` | `level_2` | Supported (СБП / перевод) | Supported (Счет + акты) |
| `structural_typology` | `level_3` | Supported (СБП / перевод) | Supported (Счет + акты) |

**Result:** Payer type availability is 100% universal across all courses and pricing options.

---

## 7. PAYMENT CHANNEL AUTHORITY (PREFLIGHT CONTEXT)

Inspection of `handlers/client.py` (lines 620-636 and 887-920) and `config.py` (lines 14-43):

| Payer Type | Target Payment Channel | Existing Requisites & Modality |
|---|---|---|
| `individual` | **СБП / Банковский перевод** | Перевод по номеру телефона СБП (`+79112988413`, ТБанк, Максим Юрьевич О.), с последующим подтверждением клиентом кнопкой «Я оплатил(а)» и оповещением операторов. Чек по 54-ФЗ отправляется на email. |
| `legal_entity` | **Безналичный банковский расчет** | Оплата по банковскому расчетному счету (ИП Опилкин М.Ю., ИНН 781451999355, р/с 40802810100003037685 в АО «ТБанк»). Выставление счета на email бухгалтерии, обмен закрывающими актами через ЭДО (Диадок / СБИС) или скан. |

*Boundary Note:* Batch 2 does **not** initiate these channels or send invoices.

---

## 8. COMMERCIAL SNAPSHOT VERIFICATION

Comparison between accepted authority (`COURSES_REGISTRY` in `chatbot/calendar_service.py`) and live production endpoint (`https://structural-typology-navigator.vercel.app/api/tikhon/courses`):

| Course | Registered Price | Live Production Price | Status |
|---|---|---|---|
| `levels_of_consciousness` | 45 000 ₽ | 45 000 ₽ | `MATCH` `[VERIFIED]` |
| `maslow` | 45 000 ₽ | 45 000 ₽ | `MATCH` `[VERIFIED]` |
| `normative_situation` | 45 000 ₽ | 45 000 ₽ | `MATCH` `[VERIFIED]` |
| `play_and_creativity` | 60 000 ₽ | 60 000 ₽ | `MATCH` `[VERIFIED]` |
| `structural_typology` (`full_prepayment`) | 160 000 ₽ (base: 200 000 ₽, -20%) | 160 000 ₽ (base: 200 000 ₽, -20%) | `MATCH` `[VERIFIED]` |
| `structural_typology` (`level_1`) | 50 000 ₽ | 50 000 ₽ | `MATCH` `[VERIFIED]` |
| `structural_typology` (`level_2`) | 100 000 ₽ | 100 000 ₽ | `MATCH` `[VERIFIED]` |
| `structural_typology` (`level_3`) | 50 000 ₽ | 50 000 ₽ | `MATCH` `[VERIFIED]` |

**Result:** Zero commercial drift detected. `COMMERCIAL_AUTHORITY = MATCH`.

---

## 9. STRUCTURAL TYPOLOGY ELIGIBILITY HANDOFF

The contract from `GET /api/tikhon/student-status` (implemented in Batch 1 CORR1) provides:
```json
{
  "is_authenticated": true,
  "courses": {
    "structural_typology": {
      "paid_options": ["level_1"],
      "legacy_history_unverified": false
    }
  }
}
```

The client helper `getOptionEligibility(courseId, optionId, studentStatus)` in `src/app/tikhon-miniapp-pilot/helpers.ts` (lines 106-183) evaluates this state:
- `ELIGIBLE`: Option can be selected.
- `PAID`: Option marked with `✓ Оплачено`, unclickable.
- `LOCKED`: Option disabled, shows prerequisite reason (e.g. "Доступно после оплаты 1-го уровня").
- `DISABLED_STARTED_STAGED`: Full prepayment locked if staged payment already begun ("Недоступно: начата поэтапная оплата по уровням").
- `legacy_history_unverified`: All options locked with curator contact banner ("Для продолжения оплаты следующего уровня требуется подтверждение истории предыдущих оплат").

**Invariant:** Batch 2 strictly consumes this contract without modifying or recomputing progression rules.

---

## 10. UNAUTHENTICATED MINI APP STATE

When the Mini App is accessed:
- **A. Inside Telegram with valid `initData`:**
  Full student status is resolved via `/api/tikhon/student-status`. Personalized progression is unlocked according to verified entitlements.
- **B. Outside Telegram / normal browser:**
  `window.Telegram?.WebApp?.initData` is undefined. `/api/tikhon/student-status` returns 401 `UNAUTHORIZED_NO_INIT_DATA`.
  Public catalog, cohorts, and public pricing options (single-payment courses, Level 1, Full Prepayment) remain viewable (`ALLOW_PUBLIC_PRICING_ONLY`). Gated stages (Level 2, Level 3) remain locked.
- **C. Invalid / Expired `initData`:**
  HMAC signature fails or expired (> 7 days). Endpoint returns 401. Handled identically to unauthenticated state without falling back to synthetic identity.

---

## 11. CLIENT STATE & NAVIGATION MODEL

1. **Architecture:** Single-page React client application (`src/app/tikhon-miniapp-pilot/page.tsx`).
2. **Screen Sequence:**
   - `screen === "catalog"` (Screen 1): Course catalog cards.
   - `screen === "detail"` (Screen 2): Selected course details, cohort list, pricing options list, Public Offer link.
   - `screen === "payer"` (Screen 3): Selected course/cohort/pricing summary, payer type selection (`individual` vs `legal_entity`), Public Offer link, continue button.
3. **Minimum State Carried:**
   - `selectedCourseId: string`
   - `selectedCohortId: string`
   - `selectedPricingOptionId: string`
   - `selectedPayerType: "individual" | "legal_entity" | null`
4. **Server Revalidation Invariant:**
   Client state is navigational only. In subsequent submission batches, all fields (`course_id`, `cohort_id`, `pricing_option_id`, price calculation, entitlement validity) must be revalidated server-side. No client-side price or authority is trusted.

---

## 12. BACK BUTTON & CANCEL SEMANTICS

- On Screen 3 (`payer`):
  Telegram native `tg.BackButton.onClick` transitions back to Screen 2 (`setScreen("detail")`).
  Preserves `selectedCourseId`, `selectedCohortId`, and `selectedPricingOptionId` intact.
- On Screen 2 (`detail`):
  Telegram native `tg.BackButton.onClick` transitions back to Screen 1 (`setScreen("catalog")`).
- On Screen 1 (`catalog`):
  Telegram native `tg.BackButton.hide()` is called.
- In-app fallback back buttons mirror native BackButton behavior.
- Navigation creates **zero** database, payment, or application records.

---

## 13. OFFER PLACEMENT

- In Screen 2, the canonical Offer notice remains positioned directly below the pricing option cards:
  `Условия оплаты и возврата указаны в [Публичной оферте](/offer)`.
- In Screen 3 (Payer Selection), the Offer notice is placed directly above the primary action button:
  `Оформляя заявку, вы соглашаетесь с условиями [Публичной оферты](/offer)`.
- Clicking the link uses `window.Telegram.WebApp.openLink` to open the canonical accepted route `/offer` (`public/offer.html`) without navigating away from the app context.

---

## 14. BATCH-3 REQUIRED FIELDS (INDIVIDUAL PERSON FLOW)

Physical inspection of `handlers/client.py` (lines 495-575) and `validators.py` identifies the exact 3 fields collected for individuals:
1. `full_name` (String, min 2 words: First Name, Last Name)
2. `phone` (String, E.164 phone normalized via `normalize_phone`)
3. `email` (String, validated via `validate_email`)
4. Explicit confirmation action (`confirm:ind_terms`) with Offer and 152-FZ consent.

Total distinct fields: **3 input fields + 1 confirmation**.

---

## 15. BATCH-4 REQUIRED FIELDS (LEGAL ENTITY / IP FLOW)

Physical inspection of `handlers/client.py` (lines 668-840) and `database.py` (lines 54-64) identifies the fields collected for legal entities and individual entrepreneurs:
1. `inn` (10 digits for organization, 12 digits for IP; checksum validated)
2. `company_name` (Autofilled via DaData from ЕГРЮЛ/ЕГРИП or entered manually)
3. `kpp` (Optional/autofilled for 10-digit legal entities)
4. `ogrn` (Optional/autofilled from DaData)
5. `company_address` (Optional/autofilled from DaData)
6. `bik` (9 digits, starts with "04", bank BIK)
7. `account` (20 digits, bank account verified with BIK control key)
8. `doc_email` (Accounting email for invoice and acts)
9. `edo_type` (Chosen from `Диадок`, `СБИС`, or `Email_Scan`)
10. `contact_person` (Contact name and phone of company representative)

Total distinct fields: **10 fields (6 primary required + 4 autofilled/optional)**.

---

## 16. DUPLICATE APPLICATION RISK & IDEMPOTENCY

- `CAN_REPEATED_SCREEN_NAVIGATION_CREATE_APPLICATION`: **NO** (Navigation between Screen 1, 2, and 3 is purely React state transitions).
- `CAN_DOUBLE_CLICK_CREATE_APPLICATION`: **NOT_APPLICABLE_AT_BATCH_2** (No persistence endpoint is called).
- `CAN_REFRESH_CREATE_APPLICATION`: **NOT_APPLICABLE_AT_BATCH_2** (Page refresh reloads React state with zero server mutations).
- Duplicate Application Risk at Batch 2: **NONE** (Idempotency control deferred to Batch 5 application submission).

---

## 17. SECURITY & PRIVACY BOUNDARY

- Public course projection (`/api/tikhon/courses`) contains only public metadata.
- Authenticated entitlement projection (`/api/tikhon/student-status`) requires HMAC validation, maps `user_id` to deterministic hash `subject_key`, and returns only boolean/array entitlement tags without exposing phone, email, notes, user ID, or credentials.
- Batch 2 operates entirely in client UI without persisting or transmitting sensitive personal or financial data.
- `BATCH_2_PRIVACY_BOUNDARY`: **PASS**.

---

## 18. CANDIDATE SCREEN-3 CONTRACT

```text
==================================================
SCREEN 3: ВЫБОР СПОСОБА ОПЛАТЫ (PAYER SELECTION)
==================================================

[Header]
  - Back Button: "⬅️ Назад" / Telegram BackButton (returns to Screen 2)
  - Title: "Способ оплаты"
  - Subtitle: "Выберите, от чьего имени будет производиться оплата"

[Selection Summary Card]
  - Course: "Структурная типология личности"
  - Cohort: "6-й поток (Зима 2027) · Старт 17 января 2027"
  - Pricing Option: "Уровень 1. Базовый" (или "Полный курс со скидкой 20%")
  - Amount: "50 000 ₽"

[Payer Options Radio Group]
  Option 1:
    - ID: "individual"
    - Icon/Badge: 👤 Физическое лицо
    - Description: "Оплата через СБП или банковский перевод по QR-коду / реквизитам. Чек по 54-ФЗ на email."
    - State: Selectable

  Option 2:
    - ID: "legal_entity"
    - Icon/Badge: 🏢 Юридическое лицо или ИП
    - Description: "Безналичный расчет для организаций и предпринимателей. Выставление счета, договор и закрывающие акты через ЭДО (Диадок / СБИС) или скан."
    - State: Selectable

[Legal Notice]
  - "Оформляя участие, вы соглашаетесь с условиями [Публичной оферты](/offer)"

[Actions]
  - Primary Button: "Продолжить" (disabled if no payer type selected; opens transition modal/stub in Batch 2)
```

---

## 19. REQUIRED IMPLEMENTATION FILE MAP

- **CHATBOT REPOSITORY:**
  - `NONE` (Zero backend modifications required; all models, FSM, and projections are already in place).
- **NAVIGATOR REPOSITORY:**
  - `src/app/tikhon-miniapp-pilot/page.tsx` (Add Screen 3 state, render logic, BackButton routing between Screen 1, 2, and 3).
  - `src/app/tikhon-miniapp-pilot/miniapp.module.css` (Styles for Screen 3 summary banner, payer cards, radio selectors).
  - `src/app/tikhon-miniapp-pilot/helpers.ts` (Type definitions for `PayerType = "individual" | "legal_entity"` and helper predicates).
- **SUPABASE:**
  - `NONE` (Zero migrations, zero table alterations).
- **TESTS:**
  - `tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` (Deterministic integration tests verifying Screen 3 contract, BackButton transitions, pricing persistence, and single-option auto-selection).

---

## 20. RISKS & HOLDS

- Ambiguity in payer authority: **NONE** (unambiguously `individual` and `legal_entity`).
- Commercial drift: **NONE** (bit-for-bit parity with accepted Batch 1).
- Risk of premature application creation: **NONE** (physically decoupled).
- **HOLDS:** None.

---

## 21. PREFLIGHT DECISION & VERDICT

**VERDICT:** **`CASE_A_BATCH2_UI_ONLY`**

**Rationale:**  
Batch 2 can be fully implemented as client-side UI and state transitions within the Next.js Mini App over existing canonical read models (`/api/tikhon/courses` and `/api/tikhon/student-status`). No backend database mutation, schema change, or new API endpoint is required. All server-side payment authorizations and application persistence will be implemented in subsequent batches (Batches 3, 4, 5).
