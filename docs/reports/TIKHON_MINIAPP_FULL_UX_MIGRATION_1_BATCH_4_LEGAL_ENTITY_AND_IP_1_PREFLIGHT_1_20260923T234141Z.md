# Tikhon Mini App Full UX Migration: Batch 4 — Legal Entity & IP Preflight Analysis (CORR1: Field Authority Consistency)

**Document identifier:** `TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_4_LEGAL_ENTITY_AND_IP_1_PREFLIGHT_1_20260923T234141Z`<br>
**Date:** 2026-09-23<br>
**Author:** Antigravity (Primary Coder / Preflight Analyst)<br>
**Controlling Authority:** Human Project Owner (Nikolai Petyaev)<br>
**Act Envelope:** `TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-4.LEGAL-ENTITY-AND-IP-1.PREFLIGHT-1.CORR1.FIELD-AUTHORITY-CONSISTENCY-1`<br>
**Repository Branch:** `navigator-production-dialogue-corr2-ab-normalization`<br>
**Base Commit (HEAD):** `09bebe67c4bb1fbd5e510c691f69c00b7645165c`<br>

---

## 1. Executive Summary & Defect Reconciliation

This corrected preflight report reconciles the field authority contradiction identified in the initial draft regarding legal entity requisites in Batch 4.

### Reconciliation of Native Field Authority:
In native Tikhon (`chatbot/handlers/client.py:704-710`):
- When DaData suggestions are available, the bot autofills `company_name`, `kpp`, `ogrn`, and `address`.
- When DaData is unavailable, offline, or returns no match, **the bot falls back solely to manual entry of `company_name`** (`OrderFlow.leg_company_name_manual`).
- In manual fallback, **it does NOT prompt for `kpp`, does NOT prompt for `ogrn`, and does NOT prompt for `company_address`**.
- In the database schema (`chatbot/database.py:54-63`), `kpp`, `ogrn`, and `company_address` are all explicitly defined as `nullable=True`.

Therefore, classifying `company_address` or `kpp` as mandatory in Batch 4 would violate native parity by inventing new mandatory friction not present in the native fallback.

### Controlling Native-Parity Classification:
- **REQUIRED (7 fields):** `inn`, `company_name`, `bik`, `account`, `doc_email`, `edo_type`, `contact_person`
- **DERIVED (1 field):** `entity_type` (automatically resolved from INN length/checksum: `legal_entity` vs `individual_entrepreneur`)
- **OPTIONAL / ENRICHMENT (2 fields):** `kpp` (applicable to 10-digit legal entities only, skippable), `company_address` (skippable)
- **DEFERRED (1 field):** `ogrn / ogrnip` (omitted from local form input; deferred to future Russian-server write/enrichment stage)

---

## 2. Controlling Architecture Directives

1. **Russian Server Canonical Authority:** All applications, applicant personal data (PII), and organization requisites must reside exclusively on the Owner's Russian production VPS (`ast_bot.db`).
2. **Total Removal of Google Infrastructure:** Google Sheets sync (`data_engine/sheets_sync.py`), Google Drive/Workspace storage, and Google backups are classified as `LEGACY_TO_BE_REMOVED` and will not be maintained in target architecture.
3. **No Supabase / Vercel PII Persistence:** Supabase and Vercel must never receive or store PII, applications, or payer requisites.
4. **Local-Only Batch 4 Feasibility:** Batch 4 is 100% client-side React memory. Zero network calls, zero DaData API requests, zero database mutations (`CASE_A_BATCH4_UI_ONLY_NO_PERSISTENCE`).

---

## 3. Native Flow Sequence & States

Physical trace of `chatbot/handlers/client.py`, `chatbot/states.py`, and `chatbot/validators.py`:

```
[Screen 2: Choosing Payer]
       │
       ▼ (cb: "payer:legal_entity")
[State: OrderFlow.leg_inn]
       │
       ▼ (user sends INN)
[Validation: validate_inn(inn)]
       ├── Invalid INN ──────────────► Rejection with specific reason, re-prompts leg_inn
       │
       ▼ Valid INN
[DaData API: fetch_company_by_inn(inn)]
       ├── Success (Found in EGRUL/EGRIP)
       │      │
       │      ▼ [State: OrderFlow.leg_confirm_company]
       │        Card: Short Name, INN, KPP, OGRN, Address
       │        ├── "Да, все данные верны" (cb: "company_confirm:yes") ───┐
       │        └── "Ввести название вручную" (cb: "company_confirm:manual")│
       │                    │                                             │
       │                    ▼ [State: OrderFlow.leg_company_name_manual]  │
       │                      (user types company name)                   │
       │                                                                  │
       └── Failure / No DaData Key / No Network ──────────────────────────┤
              │                                                           │
              ▼ [State: OrderFlow.leg_company_name_manual]                │
                (user types company name; KPP/OGRN/Address SKIPPED)       │
                                                                          │
       ┌──────────────────────────────────────────────────────────────────┘
       │
       ▼ [State: OrderFlow.leg_bik]
       │  Prompt: "Введите БИК вашего банка (9 цифр, начинается с 04)"
       │  Validation: validate_bik(bik)
       │
       ▼ [State: OrderFlow.leg_account]
       │  Prompt: "Введите ваш Расчетный счет (20 цифр)"
       │  Validation: validate_account(account, bik) (weighted checksum)
       │
       ▼ [State: OrderFlow.leg_doc_email]
       │  Prompt: "Укажите Email бухгалтерии (куда отправить счет на оплату и закрывающие акты)"
       │  Validation: validate_email(email)
       │
       ▼ [State: OrderFlow.leg_edo_type]
       │  Prompt: "Как вашей бухгалтерии удобнее получать закрывающие документы (акты)?"
       │  Options:
       │    • "📦 Диадок (Контур)"    (cb: "edo:Диадок")
       │    • "📨 СБИС (Тензор)"      (cb: "edo:СБИС")
       │    • "✉️ Скан по Email (без ЭДО)" (cb: "edo:Email_Scan")
       │
       ▼ [State: OrderFlow.leg_contact_person]
       │  Prompt: "Укажите ФИО и телефон контактного лица (слушателя или куратора обучения от компании)"
       │  Input: Single free-text string
       │
       ▼ [PERSISTENCE BOUNDARY: msg_leg_contact_person]
       ├── 1. Insert into SQLite `applications` table (status='new')
       ├── 2. [LEGACY] Background Google Sheets sync (`sheets.async_sync_lead`) -> TO BE REMOVED
       ├── 3. Render Telegram Invoice Text (Academy requisites + payment purpose with #app_id)
       ├── 4. Send interactive notification to Operator Chat (`OPERATOR_CHAT_ID`)
       └── 5. Clear FSM state
```

---

## 4. Reconciled Field Specification Matrix

| Canonical Field | Status | Applicability | Native Validation | Normalization | Database Column (`applications`) | Handling in Batch 4 |
|---|---|---|---|---|---|---|
| `inn` | **REQUIRED** | All (ЮЛ / ИП) | Checksum algorithm (FNS) | `.strip()` | `inn: String(16)` | Client-side input & validation |
| `entity_type` | **DERIVED** | All | Deterministic from INN length | Lowercase | In-memory FSM | Derived: 10 digits = ЮЛ, 12 digits = ИП |
| `company_name` | **REQUIRED** | All | Non-empty string | `.strip()` | `company_name: String(255)` | Manual input |
| `kpp` | **OPTIONAL** | Legal entities only (10-digit INN) | 9 digits if entered | `.strip()` | `kpp: String(16)` (nullable) | Optional input for ЮЛ; hidden for ИП |
| `company_address` | **OPTIONAL** | All | Free text if entered | `.strip()` | `company_address: Text` (nullable) | Optional input; skippable |
| `ogrn` / `ogrnip` | **DEFERRED** | All | 13/15 digits | `.strip()` | `ogrn: String(20)` (nullable) | Omitted in Batch 4; deferred to server |
| `bik` | **REQUIRED** | All | 9 digits, starts with `"04"` | `.strip()` | `bik: String(16)` | Client-side input & validation |
| `account` | **REQUIRED** | All | 20 digits, weighted modulo 10 with BIK | `.strip()` | `account: String(32)` | Client-side input & validation |
| `doc_email` | **REQUIRED** | All | RFC-like email regex | `.strip().lower()` | `email: String(255)` | Client-side input & validation |
| `edo_type` | **REQUIRED** | All | Closed set: `"Диадок"`, `"СБИС"`, `"Email_Scan"` | Exact token | `edo_type: String(64)` | Closed button selector |
| `contact_person` | **REQUIRED** | All | Non-empty string (ФИО + телефон) | `.strip()` | `full_name: String(255)` | Manual text input |

---

## 5. Mathematical Checksum Algorithms (Ported to Client)

### 5.1 INN Checksum (ФНС РФ)
Implemented in `chatbot/validators.py:15-54`:
- **10-digit INN (Юридическое лицо):**
  - Weights: `[2, 4, 10, 3, 5, 9, 4, 6, 8]`
  - Control digit: `(sum(digits[0..8] * weights) % 11) % 10`
  - Valid if `control_digit == digits[9]`.
- **12-digit INN (Индивидуальный предприниматель):**
  - 11th digit weights: `[7, 2, 4, 10, 3, 5, 9, 4, 6, 8]`
  - Control digit 11: `(sum(digits[0..9] * weights_11) % 11) % 10`
  - 12th digit weights: `[3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]`
  - Control digit 12: `(sum(digits[0..10] * weights_12) % 11) % 10`
  - Valid if `control_11 == digits[10]` AND `control_12 == digits[11]`.

### 5.2 BIK Validation (ЦБ РФ)
Implemented in `chatbot/validators.py:56-65`:
- Exactly 9 digits.
- Must begin with `"04"`.

### 5.3 Settlement Account & BIK Checksum (ЦБ РФ)
Implemented in `chatbot/validators.py:68-94`:
- Exactly 20 digits.
- Check string: `bik[-3:] + account` (23 digits total).
- Weights: `[7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1]`
- Checksum: `sum(int(digit) * weight) % 10 == 0`.

---

## 6. DaData Boundary in Batch 4

- **No Network Requests:** Batch 4 operates strictly local-only (`BATCH4_NETWORK_CALLS: 0`).
- **No Client-Side DaData Call:** DaData API keys will not be exposed to the browser.
- **Native Parity Execution:** Batch 4 local entry mirrors the native bot's manual fallback path.
- **Server Enrichment Deferral:** Enrichment of registry data (OGRN/OGRNIP, official registered address, verified KPP) is deferred to the future Russian-server write stage.

---

## 7. Re-evaluated Form Shape & Stepper

To provide optimal mobile UX without overwhelming the user, the form is segmented into 4 logical groups:

### Step 1: Организация
- `inn` (REQUIRED; triggers real-time checksum and entity resolution)
- `entity_type` (DERIVED; displays badge "Юридическое лицо" or "Индивидуальный предприниматель")
- `company_name` (REQUIRED; manual input)
- `kpp` (OPTIONAL; visible only if `entity_type == "legal_entity"`, skippable)
- `company_address` (OPTIONAL; skippable)

### Step 2: Банковские реквизиты
- `bik` (REQUIRED; 9 digits, starts with 04)
- `account` (REQUIRED; 20 digits, validated against BIK)

### Step 3: Документы и ЭДО
- `doc_email` (REQUIRED; email бухгалтерии)
- `edo_type` (REQUIRED; 3 buttons: Диадок, СБИС, Скан по Email)

### Step 4: Контактное лицо
- `contact_person` (REQUIRED; ФИО и телефон куратора/слушателя)

### Screen 4B: Подтверждение реквизитов (Review Screen)
- **Contract Rule:** Displays course, cohort, price, and all entered requisites.
- **Optional Field Rule:** Optional fields (`kpp`, `company_address`) are displayed **ONLY IF ENTERED**. No fabricated placeholders (such as "—" or "Не указано") that could be mistaken for official registry data.

---

## 8. Handoff Draft Schema (Batch 4 to Future Batch 5)

Maintained in React session memory:
```typescript
interface LegalEntityDraft {
  payerType: "legal_entity";
  entityType: "legal_entity" | "individual_entrepreneur";
  inn: string;
  companyName: string;
  kpp?: string;
  companyAddress?: string;
  bik: string;
  account: string;
  docEmail: string;
  edoType: "Диадок" | "СБИС" | "Email_Scan";
  contactPerson: string;
}
```

---

## 9. Preflight Verdict

`IMPLEMENTATION_OUTCOME: CASE_A_BATCH4_UI_ONLY_NO_PERSISTENCE`
- Zero server interaction.
- Zero network calls.
- Zero personal data persistence.
- Zero dependency on external APIs.
- Pure client-side UI and mathematical validation.
