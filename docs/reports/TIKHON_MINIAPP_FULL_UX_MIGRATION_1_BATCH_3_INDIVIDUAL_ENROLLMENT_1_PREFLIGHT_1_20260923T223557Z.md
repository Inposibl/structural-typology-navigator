# Tikhon Mini App — Batch 3 — Individual Enrollment — Preflight

- **Act:** TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-3.INDIVIDUAL-ENROLLMENT-1.PREFLIGHT-1
- **Executor / role:** Claude — Primary Coder / Preflight Analyst (read-only, except this report)
- **UTC:** 2026-09-23T22:35:57Z
- **Status:** PREFLIGHT_COMPLETE
- **Verdict:** CASE_A_BATCH3_UI_ONLY_NO_PERSISTENCE (see §29). The consent-authority gap (§5) must be resolved before any later batch transmits or persists personal data.

## 1. Controlling repo state

| Item | Value |
| --- | --- |
| Navigator branch | `navigator-production-dialogue-corr2-ab-normalization` |
| Navigator HEAD | `e6bc66dca2b96326303e5c6434c6a723dd723efd` |
| Navigator staging area | empty |
| Navigator dirty paths | unrelated, pre-existing: `src/lib/chat-contract.ts` (M); untracked `src/lib/navigation/conversation-first-contact.ts`, `tests/navigation/first-contact.test.mts`, `tests/tikhon-miniapp/live-data-binding.test.mts`, `.zcodeignore`, `benchmarks/`, docs |
| Chatbot branch / HEAD | `feat/telegram-shared-brain-integration-1` @ `c7ef1cbf203fe9a5d8cd5d83d9df793f6953d183` |
| Chatbot files inspected | `handlers/client.py`, `states.py`, `database.py`, `validators.py`, `config.py`: clean against chatbot HEAD. `keyboards.py`: locally modified, but the diff only adds `get_operator_zoom_confirm_kb`; `get_individual_confirm_kb` is unchanged. `api_service.py`: untracked. |

Whether the production bot runs exactly this chatbot tree was not verified (no VPS access in this act); all native claims below describe this local tree.

## 2. Native individual flow

FSM `OrderFlow` (`states.py:9-22`). Callback values and handlers are in `handlers/client.py`.

| Step | Handler (line) | FSM state / filter | Effect |
| --- | --- | --- | --- |
| Payer selection | `cb_payer_individual` (478) | `payer:individual` in `choosing_payer_type` | `payer_type="individual"` → `ind_full_name` |
| Full name | `msg_ind_full_name` (495) | `ind_full_name` | validate → store in FSM → `ind_phone` |
| Phone | `msg_ind_phone` (516-518) | `ind_phone`, `F.contact` or `F.text` | `normalize_phone` → `ind_email` |
| Email | `msg_ind_email` (543) | `ind_email` | `validate_email` → summary card → `ind_confirm_terms` |
| Summary | same handler (558-574) | — | card plus `get_individual_confirm_kb()` |
| Confirmation | `cb_ind_terms_confirmed` (577) | `confirm:ind_terms` in `ind_confirm_terms` | **Application INSERT**, `state.clear()`, Sheets sync, SBP requisites, operator notification |
| Afterwards | `cb_client_paid` (951) | `client_paid:<id>` | client message, Sheets «УВЕДОМИЛ ОБ ОПЛАТЕ», operator ping; **no DB status change** |

Back navigation:
- `nav:back_to_payer_type` (251) is offered on the full-name step only.
- Phone and email steps offer only «Выбрать другой курс» (`nav:back_to_courses`, which runs `state.clear()`).
- Text commands «отмена/назад/...» (274-281) also clear state.

## 3. Field authority

Exactly three input fields. No other profile field exists in the native individual branch.

| Field | Column (`database.py`) | Type | Required | Normalization | Stored |
| --- | --- | --- | --- | --- | --- |
| `full_name` | `full_name` (50) | `String(255)`, nullable | yes (flow) | `.strip()` only | stripped raw text |
| `phone` | `phone` (51) | `String(64)`, nullable | yes (flow) | `normalize_phone` → `+7XXXXXXXXXX` | normalized |
| `email` | `email` (52) | `String(255)`, nullable | yes (flow) | `.strip()` only (no lowercasing) | stripped raw text |

## 4. Validation rules

**full_name** (`client.py:498-504`):
- Rule: `len(message.text.strip().split()) >= 2`.
- There is no minimum character count, no script or charset restriction (digits and Latin are accepted), and no requirement for a patronymic, although the prompt asks for «Фамилию, Имя и Отчество».
- Inner whitespace is not collapsed in storage.
- Error message: «Пожалуйста, укажите как минимум Имя и Фамилию через пробел:», then re-prompt.
- There is no Russian-only assumption in the rule itself.

**phone** (`validators.py:102-116`, `client.py:520-527`):
- Every character except digits and `+` is removed.
- Accepted inputs: `+7` + 10 digits; `8` + 10 digits; `7` + 10 digits; 10 digits starting with `9`.
- Output is always `+7XXXXXXXXXX`; anything else returns `None`.
- Accepts Telegram contact sharing (`message.contact.phone_number`) as well as text.
- Error message: «Не удалось распознать номер телефона...», then re-prompt.
- The docstring (validators.py:7) says «E.164», and the Batch-2 preflight §14 repeated that. The implementation is **Russian +7 only**; foreign numbers are rejected. → **PHONE_VALIDATION_SCOPE_LIMITATION.** The policy is not changed here; it is an Owner decision.
- Call sites: only `msg_ind_phone`. The legal-entity contact phone is a separate state.

**email** (`validators.py:96-99`, `client.py:546-552`):
- Regex `^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$`, applied after `.strip()`. ASCII only; no IDN.
- Stored stripped; case preserved.
- Error message: «Пожалуйста, введите корректный адрес электронной почты...».
- Stated use (534): «чек по 54-ФЗ и ссылка на учебный Zoom». Also sent to Google Sheets as `payer_email` and to the operator chat.

## 5. Consent / Offer authority

The native confirmation card (`client.py:569-570`) says: «подтвердите согласие с Публичной офертой и обработкой персональных данных (152-ФЗ РФ)».

The keyboard `get_individual_confirm_kb` (`keyboards.py:207-232`) has:
- «📄 Читать публичную оферту» → `settings.academy.offer_url` = `https://structural-typology.academy/offer`
- «🔒 Политика конфиденциальности (152-ФЗ)» → `privacy_policy_url` = `https://structural-typology.academy/privacy`
- «✅ Согласен(на), получить реквизиты» → `confirm:ind_terms`. Consent and the payment-requisites handoff are **one action**.

Physical checks (read-only `curl`, 2026-09-23T22:3xZ):

| URL | HTTP |
| --- | --- |
| `https://structural-typology.academy/offer` (native Offer link; also the Offer's own declared address) | **404** |
| `https://structural-typology.academy/privacy` (native privacy link) | **404** |
| `https://structural-typology-navigator.vercel.app/offer` (tracked `public/offer.html`, Mini App link) | 200 |
| `https://structural-typology-navigator.vercel.app/privacy` | 404 |

Live Offer (`public/offer.html`, «Редакция от 20 сентября 2026 г.»), §7 «Защита персональных данных (152-ФЗ РФ)»:
- **7.1.** Acceptance of the Offer gives consent to process «ФИО, телефон, email, Telegram ID, реквизиты» for contract performance, receipts and organisational communication.
- **7.2.** «передача третьим лицам не осуществляется (за исключением банков и операторов фискальных данных для проведения расчетов)».
- §3.1 lists acceptance acts, including submitting an application in @AST_payment_course_bot and clicking «Подтвердить согласие с офертой».

Gaps (physically proven):
1. **No privacy policy document exists anywhere.** The native UI links to one, and the untracked draft `docs/legal/PUBLIC_OFFER_AST_2026-09-20.md` §3.1.4 refers to «Политикой конфиденциальности Исполнителя».
2. The native bot's Offer and privacy links both return 404. The Offer's self-declared address also returns 404.
3. §7.2 excludes third-party transfer except banks and fiscal operators, but the native confirmation copies phone and email to Google Sheets (`client.py:608-618`) and sends ФИО, phone and email to the operator Telegram chat (`client.py:996-1001`). Whether that is consistent with §7.2 is a legal determination this act does not make.

**CONSENT_AUTHORITY = HOLD** (`HOLD_PERSONAL_DATA_CONSENT_AUTHORITY_GAP`). This blocks any batch that transmits personal data to a server or persists it. It does not block a Batch 3 that keeps personal data on the device and defers the consent act (see §8 and §19).

## 6. Application model

Table `applications` (`database.py:28-72`, SQLAlchemy, SQLite `sqlite_autoincrement`, IDs start at 109):

| Group | Columns |
| --- | --- |
| Identity | `id` (int PK), `user_id` (BigInteger, indexed; raw Telegram ID), `username` (nullable) |
| Offer | `course_id`, `course_name` (native writes `"<title> (<option title>)"`), `cohort_id`, `cohort_title`, `cohort_schedule`, `amount` (int, RUB), `pricing_option_id` (nullable) |
| Payer | `payer_type` (`individual` / `legal_entity`), `full_name`, `phone`, `email` |
| Legal-entity only | `inn`, `kpp`, `ogrn`, `company_name`, `company_address`, `bik`, `bank_name`, `account`, `edo_type` (unused for individuals) |
| Lifecycle | `status` (default `new`), `operator_notes`, `created_at`, `updated_at` |

There is no idempotency or request-key column and no unique constraint beyond the PK.

## 7. Application creation boundary

**APPLICATION_CREATED_AT_CONFIRMATION = YES** (`cb_ind_terms_confirmed`, `client.py:577-603`):
- Construction: `Application(...)` at 584-599.
- `session.add(app)` at 600, `await session.commit()` at 601, `refresh` at 602.
- Initial status: `"new"`.
- Amount source: `data["price"]` from the FSM, captured at cohort selection (380-384) or option selection (411-415) from the static course catalog.
- Pricing-option source: FSM `pricing_option_id`.
- Cohort source: FSM `cohort_id`, `cohort_title`, `cohort_schedule`.
- Telegram identity: `callback.from_user.id` / `.username`, signed by Telegram's Bot API update.

The same handler then clears the FSM (605), syncs Google Sheets with `payment_status: «СЧЕТ ВЫСТАВЛЕН»` (608-618), shows the SBP requisites with «Назначение платежа: Обучение, заявка #id» (623-635), and notifies the operator (639-644).

## 8. Persistence decision

| Criterion | Finding |
| --- | --- |
| A. Native canonical behavior | The Application INSERT is atomically bundled with the payment handoff (requisites, «СЧЕТ ВЫСТАВЛЕН» in Sheets, operator card). Batch 3 excludes all of those. A Batch-3 INSERT would create a `new` row that no operator is told about and that has no requisites, which is not the canonical state. |
| B. Migration architecture | The accepted plan defers Application submission and idempotency to Batch 5 (Batch-2 preflight §16). |
| C. Batch-5 idempotency gate | Persisting in Batch 3 would pull that gate forward (§14, §15). |
| D. Abandoned / duplicate rows | Material (§14). No draft or cleanup mechanism exists. |
| E. Server revalidation | Required for any write (§10); no implementation exists yet. |
| F. Safe write API | None (§9). SQLite lives on the chatbot host; Navigator (Vercel) has no write path to it. |

**BATCH3_PERSISTENCE_DECISION = PERSISTENCE_DEFER_TO_LATER_BATCH**

## 9. Existing API surface

- Navigator: `POST /api/chat` (unrelated conversational endpoint), `GET /api/tikhon/courses`, `GET /api/tikhon/student-status`.
- Chatbot (`api_service.py`, untracked): `GET /api/v1/public/courses`, `GET /healthz`.
- There are no application, enrollment, payment, order or invoice endpoints in either repository.

**EXISTING_APPLICATION_WRITE_API = NONE**

## 10. Server revalidation contract

Needed before any future Application write. None of this is needed for a no-persistence Batch 3.

| Input | Server rule |
| --- | --- |
| Telegram identity | `validateTelegramInitData` (HMAC, `auth_date` ≤ 7 days, ≤ 300 s future skew, tamper rejection). `user_id` is derived only from verified initData; any client `user_id` is ignored. |
| `course_id` | Must exist in the canonical catalog. |
| `cohort_id` | Must belong to the course, re-checked with `check_cohort_availability` (`calendar_service.py:687`) using a **fresh** `get_enrolled_count` at submission time, not the Supabase projection snapshot. |
| `pricing_option_id` | Must belong to the course. |
| price | Re-resolved server-side from the canonical option. The client price is display-only and never trusted. |
| `payer_type` | Must equal `individual`. |
| Entitlement | Structural Typology progression re-evaluated against current private entitlements (PAID / LOCKED / staged / `legacy_history_unverified` fail-closed). |
| Personal fields | Same rules as §4, applied server-side. |

## 11. Telegram identity binding

- The native schema stores the raw Telegram ID in `applications.user_id` (and `username`), sourced from the Bot API update.
- A future Mini App write must resolve `user_id` **only server-side**, from validated initData, and store it in the existing `user_id` column.
- `subject_key` (HMAC of the user ID) remains the key for the private entitlement projection only.
- A client-supplied ID is never authority. The identity architecture is not redesigned here.

## 12. PII transport / storage map

**Native, current:**
- ФИО, phone and email go into aiogram `MemoryStorage` FSM, then into SQLite `applications` (bot host).
- Phone and email go to Google Sheets (`sheets_sync.async_sync_lead`, keyed by Telegram user ID).
- ФИО, phone and email go into the operator Telegram chat message.
- The phone number is echoed back to the user in the bot chat (533).

**PII_STORAGE_MAP (current canonical):** SQLite `applications`, Google Sheets lead row, operator Telegram chat. Not in Supabase: the public projection holds catalog data only, and private entitlements hold `subject_key` plus course and option tags.

**Batch 3 (Case A) minimum path:** Mini App form → React memory only. There is no network transmission, no URL parameter, no localStorage or sessionStorage, and no logging.

**Future write-batch minimum path:** browser → Navigator API (HTTPS POST body, validated initData header) → a new authenticated write channel to the chatbot host → SQLite. That channel does not exist yet and is an architecture decision for that batch. Supabase must not carry PII.

## 13. Logging risk

- Chatbot `sheets_sync.py` logs Telegram `user_id` on failure (335, 357, 432, 453, 522). ФИО, phone and email are not logged.
- `notify_operator_new_application` prints only the operator chat ID and the exception (1041).
- Navigator Tikhon surfaces: three `console.error` calls in `page.tsx` (courses error message, status fetch exception, WebApp init error). None of them logs initData or personal fields. The API routes have no `console.*` calls.
- Vercel request logs record path and status, not bodies.

**PII_LOGGING_RISK = LIMITED** (Telegram user ID in chatbot warning logs only).

## 14. Idempotency / duplicate analysis (native)

| Question | Answer | Evidence |
| --- | --- | --- |
| CAN_DOUBLE_CLICK_CONFIRM_CREATE_DUPLICATE_APPLICATION | **YES** | aiogram 3.22.0 `start_polling(handle_as_tasks=True)` by default (`dispatcher.py:343`). Both callbacks pass the `ind_confirm_terms` filter before `state.clear()` (605), which runs only after `commit` (601). There is no lock. |
| CAN_RETRY_AFTER_TIMEOUT_CREATE_DUPLICATE | **YES** | A slow handler plus a repeated tap takes the same path as a double click. |
| CAN_REFRESH_AND_RESUBMIT_CREATE_DUPLICATE | **YES** | Re-running the flow after completion inserts a new row; nothing is looked up. |
| CAN_SAME_USER_CREATE_MULTIPLE_APPLICATIONS_FOR_SAME_COURSE_COHORT_PRICE | **YES** | No constraint and no lookup. |
| IS_THERE_EXISTING_UNIQUE_CONSTRAINT | **NO** | `database.py:28-72` |
| IS_THERE_EXISTING_IDEMPOTENCY_KEY | **NO** | No such column or parameter. |
| IS_THERE_EXISTING_APPLICATION_LOOKUP_BEFORE_INSERT | **NO** | `client.py:583-603` |

**DUPLICATE_APPLICATION_RISK = MATERIAL** for any persistence path.

## 15. Batch-5 gate interaction

**IDEMPOTENCY_GATE_REQUIRED_BEFORE_BATCH3_PERSISTENCE = YES.** Any Batch-3 write would need the Batch-5 end-to-end idempotency contract closed first. Because Batch 3 defers persistence (§8), the gate stays at Batch 5 as planned and nothing is pulled forward.

## 16. Abandoned-form behavior

- Native: the FSM lives in `MemoryStorage`, so a partial form is lost on bot restart, cleared by «Выбрать другой курс» or «отмена», and never persisted before confirmation. No canonical draft mechanism exists.
- Batch 3: **EPHEMERAL_CLIENT_STATE_ONLY.**
  - Values live in React state for the current Mini App session.
  - Closing or refreshing the Mini App discards them.
  - Returning later starts clean.
  - No draft persistence is invented.

## 17. BackButton semantics

Telegram BackButton and in-app back:
- field step N → field step N−1 (if multi-step) → … → payer selection (Screen 3) → Screen 2.
- Entered values stay in React memory while navigating back and forward within the session, matching Batch 2's selection-preserving back navigation.
- Back and forward never write to a database.
- Changing the payer type to `legal_entity` hides the individual values; they are not carried into Batch-4 state.

This is a deliberate improvement over native, where Back is available only from the full-name step. It changes no data semantics.

## 18. Form UX recommendation

| Option | Assessment |
| --- | --- |
| A. One screen, three fields | Compact, but mixes three validations; mobile keyboard switching; weak per-field error focus. |
| B. Three sequential screens | Mirrors the native FSM exactly, but has three extra BackButton hops. |
| C. Hybrid: one form plus a confirmation summary | Keeps native field order and per-field validation messages, shows the native summary card as a separate confirmation screen, and needs only two BackButton levels. |

**RECOMMENDED_BATCH3_FORM_SHAPE = C (hybrid):**
1. Screen «Данные участника»: `full_name`, `phone`, `email` in native order, each with inline validation using the native error copy. «Продолжить» is disabled until all three are valid.
2. Screen «Проверьте данные» (§19).

Use appropriate input types: `tel`, `email`, `autocomplete="name"`. Do **not** use `WebApp.requestContact()`: it shares the phone with the bot chat, which is a transmission side effect outside Batch 3.

## 19. Individual confirmation contract

**INDIVIDUAL_CONFIRMATION_CONTRACT (Batch 3):**
- Display, all from source objects and the local form: course title; pricing option title; cohort title and schedule; price from the course projection; payer type «Физическое лицо»; ФИО; phone (normalized `+7…`); email.
- Offer link: Navigator `/offer` via `openLink`. This is the canonical accepted route; the native academy URL returns 404.
- Personal-data statement: informational only, referencing Offer §7, e.g. that the data will be processed under §7 of the Offer after the application is submitted.
- **No consent-acceptance control and no «Согласен» action in Batch 3.** The acceptance act must coincide with actual submission and persistence in the write batch, after the §5 gap is resolved.
- Primary CTA: continue to the local next-stage stub (application submission is the next stage). No payment requisites, SBP phone, bank data or invoice.

## 20. Auth failure behavior

- Screen 3 → form → confirmation are local-only. Loss of auth between them does not matter for Batch 3 because nothing is sent.
- Entry to the individual form stays behind Batch 2's `canProceedToPayerSelection` gate:
  - 401 → «Требуется вход через Telegram».
  - 5xx / network → CORR1 «Не удалось проверить статус участия» with a retry.
- Future write batch: the server re-runs the full §10 contract at submission. 401 means no write and the auth state is shown; 5xx means no write and the retryable state is shown. No Application is created unless identity and authority revalidate.

## 21. Cohort, price and entitlement races

- **Cohort.** The native flow checks availability only at cohort selection (`client.py:329-330`) and never at confirmation. Capacity counts only `paid` rows (`database.py:118-128`), and the Mini App reads a periodically projected snapshot (`projection_service.py:51-52`). **COHORT_REVALIDATION_REQUIRED_AT_SUBMISSION = YES**, server-side, with a fresh count.
- **Price.** Native uses the FSM price captured at selection. The server must re-resolve the canonical option and price at submission and reject or refresh a mismatch. The client price is never trusted. **YES.**
- **Entitlement.** The native individual flow has no progression checks at all (no matches for entitlement, `paid_options` or `level_2`/`level_3` in `client.py`). The Mini App enforces them from private entitlements (Batch 1 CORR1). A payment elsewhere between Screen 2 and submission is possible, so the server must re-evaluate at submission. **YES.**

## 22. Status lifecycle (current code only)

- `new` is set at insert (`client.py:598`).
- `invoice_sent` by `op:invoice_sent` (`operator.py:151`).
- `paid` by `op:paid` (`operator.py:199`).
- `canceled` by `op:cancel` from any status (`operator.py:308`).
- The client's «Я оплатил(а)» (`client_paid`) does **not** change status; it updates Sheets and notifies the operator.
- Every status transition is made by an operator.

## 23. Payment handoff

**BATCH3_TO_BATCH5_HANDOFF_CONTRACT.** Because persistence is deferred, no `application_id` exists in Batch 3. The handoff is an in-memory, client-side, **non-authoritative** enrollment draft:
`{ course_id, cohort_id, pricing_option_id, payer_type: "individual", full_name, phone, email }`.

- The displayed price is not part of the authority; Batch 5 re-resolves it.
- Batch 5 submits this draft once, with an idempotency key, to a new server write endpoint.
- That endpoint runs the §10 contract, then performs the canonical atomic act: INSERT `new` → requisites → operator notification (→ Sheets, subject to §5).
- Batch 5 returns `application_id`.
- Batch 3 must not pre-create any server state.

## 24. API / security boundary

**Batch 3 classification: NO_NEW_API.**

Minimum contract for the future write endpoint (not implemented):
- `POST` only; `Content-Type: application/json`; body ≤ ~4 KB; reject unknown fields.
- Identity only from the `x-telegram-init-data` header, validated server-side. Never from the body.
- A client-generated idempotency key (UUID per confirmation attempt) plus a server-side unique constraint. initData alone does not prevent replay: it is reusable for 7 days.
- Origin check against the pilot origin, as defense in depth.
- Full §10 revalidation.
- Responses carry no PII echo beyond what the client sent. Logs never contain body, initData or personal fields.
- Rate limiting per verified user.

## 25. Data minimization

Batch 3 needs exactly `full_name`, `phone`, `email`; the native authority collects no other individual fields. **BATCH3_DATA_MINIMIZATION = PASS.**

## 26. Privacy boundary

For Case A:
- No PII in public or private Supabase projections.
- No client identity authority.
- No payment details.
- No legal-entity fields.
- No persistence or transmission.
- The consent wording shown is grounded in the live Offer §7 (Navigator `/offer`, HTTP 200), and no consent acceptance is captured.

**BATCH3_PRIVACY_BOUNDARY = PASS** (Case A scope). The §5 HOLD carries forward to the write batch.

## 27. Minimum implementation file map

This is UI + client validation only; there are no writes anywhere.

| Area | Files |
| --- | --- |
| NAVIGATOR | `src/app/tikhon-miniapp-pilot/page.tsx` (replace the individual `next_stage_stub` with the form and confirmation screens; BackButton routing); `src/app/tikhon-miniapp-pilot/helpers.ts` (pure ports of native `full_name` / `normalize_phone` / `validate_email` rules); `src/app/tikhon-miniapp-pilot/miniapp.module.css` |
| CHATBOT | none |
| DATABASE | none |
| SUPABASE | none |
| TESTS | `tests/tikhon-miniapp/batch-3-individual-enrollment.test.mts` (new): native-parity validation vectors; no `fetch` / POST added; no localStorage; no PII in URL; Back preserves values; `legal_entity` path unchanged |
| REPORTS | the Batch-3 implementation report |

## 28. Risks / HOLDs

1. **HOLD_PERSONAL_DATA_CONSENT_AUTHORITY_GAP.** No privacy policy exists. The native Offer and privacy links return 404. Offer §7.2 may be inconsistent with the native Sheets and operator-chat copies. Owner or legal decision required before any PII transmission or persistence (the Batch-5 write).
2. **PHONE_VALIDATION_SCOPE_LIMITATION.** Only Russian +7 numbers are accepted; foreign customers cannot enrol. Owner policy decision: Batch 3 either ports the native rule unchanged, or a separate act widens it in both systems.
3. **Duplicate risk is MATERIAL** in native and any future write. Idempotency is required at Batch 5 (unique constraint plus key).
4. **No write path from Navigator to SQLite** on the chatbot host. Batch 5 needs an architecture decision (a new authenticated chatbot write endpoint or equivalent).
5. The native cohort capacity check is not re-run at confirmation. Batch 5 must re-check.
6. The production bot build was not verified against the local chatbot tree.

## 29. Verdict

**IMPLEMENTATION_OUTCOME = CASE_A_BATCH3_UI_ONLY_NO_PERSISTENCE**

Why:
- The canonical Application INSERT is inseparable from the payment handoff (requisites, «СЧЕТ ВЫСТАВЛЕН», operator card), which is out of Batch-3 scope.
- No write API exists.
- Persistence would pull the Batch-5 idempotency gate forward.
- Consent authority is not closed for PII transmission.
- Server-side validation without persistence (Case B) would send PII to a server for no durable purpose. That goes against data minimization and runs into the §5 gap, and all authoritative revalidation must happen again at the actual write anyway.

Case A keeps personal data on the device, mirrors the native field and validation semantics, and hands Batch 5 a non-authoritative draft.
