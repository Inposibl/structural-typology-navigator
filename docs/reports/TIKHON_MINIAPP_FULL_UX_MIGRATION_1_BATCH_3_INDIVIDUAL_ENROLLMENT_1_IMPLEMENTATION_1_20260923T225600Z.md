# Tikhon Mini App — Batch 3 — Individual Enrollment — Implementation Report

- **Act:** TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-3.INDIVIDUAL-ENROLLMENT-1.IMPLEMENTATION-1, including the Owner amendment making phone optional
- **Executor / role:** Claude — Primary Coder
- **UTC:** 2026-09-23T22:56:00Z
- **Base:** `navigator-production-dialogue-corr2-ab-normalization` @ `e6bc66dca2b96326303e5c6434c6a723dd723efd`
- **Controlling preflight:** `docs/reports/TIKHON_MINIAPP_FULL_UX_MIGRATION_1_BATCH_3_INDIVIDUAL_ENROLLMENT_1_PREFLIGHT_1_20260923T223557Z.md` (CASE_A_BATCH3_UI_ONLY_NO_PERSISTENCE)
- **Status:** PASS — awaiting Owner visual review. No commit, no push.

## 1. Changed paths

| Path | Change |
| --- | --- |
| `src/app/tikhon-miniapp-pilot/helpers.ts` | `MiniAppScreen` extended with `individual_form`, `individual_confirmation`, `individual_next_stage`. New pure helpers: `validateIndividualFullName`, `normalizeIndividualPhone`, `validateIndividualEmail`, `validateIndividualForm`, `buildIndividualEnrollmentDraft`, plus types and error copy. |
| `src/app/tikhon-miniapp-pilot/page.tsx` | React-memory form state; Screen 4 / Screen 5 / individual stub; BackButton routes; payer CTA branch (`individual` → form, `legal_entity` → unchanged Batch-2 stub). |
| `src/app/tikhon-miniapp-pilot/miniapp.module.css` | Appended form, confirmation, notice and secondary-button styles, plus a 320 px rule. No existing rule changed. |
| `tests/tikhon-miniapp/batch-3-individual-enrollment.test.mts` | New, 22 tests. |
| `docs/reports/…BATCH_3…IMPLEMENTATION_1_20260923T225600Z.md` | This report. |

Diff against the base: 3 source files, +622 / −3. The three removed lines are the Batch-2 payer CTA body (split into an individual / legal branch), the stub `) : (` condition (now `screen === "next_stage_stub" ? (`), and the one-line `MiniAppScreen` union (now multi-line). No other path was touched: no layout.tsx, API route, chatbot, database, Supabase, AGENTS.md, or separate-track file.

## 2. Screen flow

catalog → detail → payer →
- **individual** → Screen 4 «Данные участника» → Screen 5 «Проверьте данные» → local stub «Оформление заявки»
- **legal_entity** → the Batch-2 stub «Следующий этап / Реквизиты ИП или организации» (unchanged)

Screen 4 fields, in native order:

| Field | Label | Input attributes |
| --- | --- | --- |
| full_name | «Фамилия и имя» | `type="text"`, `autoComplete="name"` |
| phone | «Телефон (необязательно)» | `type="tel"`, `inputMode="tel"`, `autoComplete="tel"`; hint «Только российские номера, формат +7XXXXXXXXXX» |
| email | «Email» | `type="email"`, `inputMode="email"`, `autoComplete="email"`, `autoCapitalize="none"` |

- Errors appear only after a field loses focus, or after «Продолжить» has been pressed. «Продолжить» never advances while the form is invalid.
- Screen 5 shows the source-bound course, option, cohort, schedule, price and payer type («Физическое лицо»), plus ФИО, the phone (only when provided, normalized) and the email from the normalized local draft.
- Screen 5 also has the informational §7 notice with the `/offer` link. Actions: «Продолжить» (to the stub) and «Изменить данные».

## 3. Validation parity

| Rule | Implementation |
| --- | --- |
| full_name | `value.trim().split(/\s+/).length >= 2`. The value is trimmed on blur and in the draft; inner whitespace is preserved, as in native. No charset, length or patronymic rule. Error: «Пожалуйста, укажите как минимум Имя и Фамилию через пробел.» |
| phone (**optional**) | Empty or whitespace-only phone is valid and stays `null`; no value is fabricated. A non-empty value must normalize under the Russia +7-only rule: remove everything except `[0-9+]`, then accept `+7\d{10}`, `[78]\d{10}` or `9\d{9}`, giving `+7XXXXXXXXXX`. Error: «Укажите российский номер (+7XXXXXXXXXX) или оставьте поле пустым.» |
| email (**required**) | `^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$` after trim; case preserved. |
| Form validity | `full_name` valid AND `email` valid AND (phone empty OR phone valid). |

Cross-check against the chatbot's own Python validators (`validators.normalize_phone` / `validate_email` and the `msg_ind_full_name` rule, imported read-only): 43 vectors, **1 mismatch, and it is intentional**. Native `normalize_phone("+7900+000001")` returns the non-canonical `"+7900+000001"` (a stray inner `+` passes its length check). The port rejects it, because the Owner policy requires canonical `+7XXXXXXXXXX` output. The port also uses ASCII `[0-9]`, whereas Python's `\d` also matches non-ASCII digits, for the same canonical-output reason. Name and email: full parity.

## 4. Phone policy

**RUSSIA_PLUS_7_ONLY; INTERNATIONAL_PHONE_SUPPORT = NO.** Tested rejections include Paraguay, US, DE and UA numbers; too-short and too-long numbers; invalid prefixes; and a stray `+`. The helper documents «Russia +7 only» and makes no E.164 claim.

## 5. PII transport proof

- **Static:** the Batch-3 region of `page.tsx` has no `fetch(`, no `<form>`, no input `name=` attributes, no `URLSearchParams` / `location.hash` / `location.search` / `history.*` / `encodeURIComponent`, and no `console.*`. `openLink` targets only `/offer`. There is no `requestContact`, `sendData`, `sendBeacon`, `XMLHttpRequest` or `WebSocket`.
- **Runtime:** a full local session covering catalog → form (invalid, international and valid inputs) → confirmation (with and without phone) → stub → Back produced exactly one API request, `GET /api/tikhon/courses` on page load. Every other request was a static asset. The URL never changed from `/tikhon-miniapp-pilot`.
- **Storage:** `localStorage` holds 0 keys. `sessionStorage` holds 1 key, `__telegram__initParams` with value `{}`, written by Telegram's `telegram-web-app.js` SDK. It contains no PII and is not Batch-3 code.

**PII_STORAGE = REACT_MEMORY_ONLY; PII_NETWORK_TRANSMISSION = NONE.**

## 6. Absence of persistence and side effects

There is no Application, SQLite, Supabase or Sheets write; no Telegram message, operator notification, payment, invoice, SBP or requisites; and no `application_id`. Initial state is always `EMPTY_INDIVIDUAL_FORM`, so refresh, closing the Mini App or a new session loses the values.

The draft `buildIndividualEnrollmentDraft` → `{course_id, cohort_id, pricing_option_id, payer_type: "individual", full_name, phone: string|null, email}` is local and non-authoritative. It is only computed for display and gating and is never transmitted.

## 7. Absence of a consent act

There is no checkbox or toggle, and no «Согласен», «Я принимаю», «Подтвердить согласие», «Подать/Отправить заявку», «Оплатить» or «Получить реквизиты». The §7 copy states that data «будут обрабатываться в соответствии с разделом 7 Публичной оферты после отправки заявки на следующем этапе. Сейчас данные никуда не передаются.» The preflight's consent-authority HOLD stays deferred to the write batch.

## 8. Network-surface comparison

| | Before (e6bc66d) | After |
| --- | --- | --- |
| `fetch(` call sites in page.tsx | 2 (GET courses, GET student-status) | 2 (unchanged) |
| Write methods | 0 | 0 |
| New API routes | — | 0 |

NEW_FETCH_CALLS = 0; WRITE_REQUESTS = 0.

## 9. BackButton behavior

| Screen | Telegram BackButton and in-app back |
| --- | --- |
| individual_form | → payer |
| individual_confirmation | → individual_form |
| individual_next_stage | → individual_confirmation |

Values are preserved across Back and Forward. Verified live: after «Изменить данные» all three inputs kept their values. Only two code paths write the form (per-field edit and blur-trim), and nothing resets it on navigation.

Switching to `legal_entity` reaches the unchanged Batch-2 stub with no inputs and no individual values rendered (verified live).

Batch-2 CORR1 auth behavior is unchanged: 401 → auth_required; 5xx or network → retryable «Не удалось проверить статус участия». Batch 3 adds no status request.

## 10. Tests

| Command | Result |
| --- | --- |
| `node --import tsx --test tests/tikhon-miniapp/batch-3-individual-enrollment.test.mts` | PASS 22/22 (A–U plus 2 amendment tests: optional phone, required email) |
| `node --import tsx --test tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` | PASS 31/31 (unmodified test file) |
| `npm test` | PASS 730/730, 0 fail (708 + 22) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS; new test file also clean under `--no-index --check` |

Static secret and PII scan of the changed files: PRODUCTION_SECRET_LITERAL = 0 (pattern scan plus a comparison against local env values); REAL_PII_FIXTURE = 0. All phones are synthetic `+7 900 000-00-01`-series or rejection vectors, emails use `example.com` / `mail.ru` placeholders, and names are synthetic.

## 11. Responsive checks

Checked on a local production build using a deliberately long synthetic name and a 59-character email, on Structural Typology (the longest titles).

| Width | Form | Confirmation | Stub | Notes |
| --- | --- | --- | --- | --- |
| 320 | no overflow | no overflow | no overflow | Summary rows stack label over value (existing Batch-2 rule); the long email wraps (`overflow-wrap: anywhere`); CTA is full width and reachable by scroll. |
| 390 | no overflow | no overflow | no overflow | CTA 336 px, within the viewport. |
| 430 | no overflow | no overflow | no overflow | CTA 356 px. |
| 768 | no overflow | no overflow | no overflow | The existing container max-width centers the card; CTA 406 px. |

Screens 4 and 5 were reached in the local build by setting the page's React `screen` state from the browser console (UI state only; no auth bypass, no network). Real-Telegram traversal remains the Owner's visual review.

## 12. Deployment

Method: an isolated candidate, not the dirty primary worktree.
1. `git clone` of the remote branch into `/tmp/stn_b3_deploy_20260923T*` (HEAD `e6bc66d`, verified).
2. Copied only `page.tsx`, `helpers.ts`, `miniapp.module.css` (byte-identical to the verified files). `git status` of the candidate shows exactly those 3 modified paths. `layout.tsx` is tracked. There are no `.env` files and no separate-track files. `.vercel/repo.json` is copied for project linking.
3. Candidate `npm ci` + `npm run build`: PASS. SDK loader in the built HTML: 1. Batch-3 UI present in the client bundle.
4. `vercel deploy --prod --yes` from the candidate: exit 0 → `https://structural-typology-navigator-62j5y28kd-npetiaev.vercel.app` (`dpl_9hGgeSPtJgnyu3Bp2wiSSQbTZRtv`), aliased to production.

Live smoke:

| Check | Result |
| --- | --- |
| `/tikhon-miniapp-pilot` | 200 |
| `/api/tikhon/courses` | 200 |
| `/offer` | 200 |
| `/api/tikhon/student-status` (no initData) | 401 |
| SDK loader | present |
| Batch-3 UI chunk | served |
| Ordinary browser → «Оформить участие» | auth modal; no payer screen; no form |

No PII was submitted during smoke testing.

Side effect of the clean deploy: production no longer includes the separate-track uncommitted files that earlier worktree deploys had shipped (`src/lib/chat-contract.ts` type-only diff, untracked `conversation-first-contact.ts`). Tracked code at `e6bc66d` builds without them, which the clean-checkout proof from the previous act confirms. Runtime behavior of the committed routes is therefore unaffected.

## 13. Known limitations

1. The consent-authority gap (preflight §5) is intentionally deferred. Any submission batch must resolve it before a real consent act.
2. The phone port deliberately rejects the native stray-`+` artifact and non-ASCII digits (canonical-output guarantee).
3. Full names keep inner multiple spaces, as native does.
4. Real Telegram traversal of Screens 4 → 5 → stub is not verified here (no Telegram client); Owner visual review is required.
5. Isolated candidate artifacts remain at `/tmp/stn_b3_deploy_*` (no `node_modules` or `.next`), with backups at `/tmp/b3_*.bak.20260923T224412Z`.
