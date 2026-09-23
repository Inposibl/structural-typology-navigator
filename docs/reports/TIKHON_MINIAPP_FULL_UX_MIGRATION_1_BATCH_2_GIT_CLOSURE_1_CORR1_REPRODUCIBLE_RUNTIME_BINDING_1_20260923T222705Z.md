# Tikhon Mini App — Batch 2 — Git Closure CORR1 — Reproducible Runtime Binding

- **Act:** TIKHON-MINIAPP-FULL-UX-MIGRATION-1.BATCH-2.GIT-CLOSURE-1.CORR1.REPRODUCIBLE-RUNTIME-BINDING-1
- **Executor / role:** Claude — Primary Coder + Git Agent (this act only)
- **UTC:** 2026-09-23T22:27:05Z
- **Branch:** `navigator-production-dialogue-corr2-ab-normalization`
- **Pre-correction HEAD:** `328dffe6eb845778d225cedd029db35386854981` (preserved; not reset, amended, rebased or force-pushed)

## 1. Defects closed

- **F-1:** `src/app/tikhon-miniapp-pilot/layout.tsx` was an untracked runtime dependency. It is the only loader of `telegram-web-app.js`.
- **F-2:** the previous closure committed with `git diff --cached --check` failing on whitespace in two third-party reports. That history is preserved. For this act, all newly staged content must pass `git diff --cached --check` with no exceptions.

## 2. Proof that layout.tsx is required

1. The committed tree at `328dffe` contains no Telegram SDK loader.
   `git grep -n 'telegram-web-app\|telegram.org/js' HEAD -- . ':!docs' ':!benchmarks'` found no matches.
2. The only committed layout is `src/app/layout.tsx`. It renders `<html lang="ru"><body>{children}</body></html>` and loads no scripts.
3. The committed `page.tsx` relies on `window.Telegram.WebApp`: it reads `initData`, sends the `x-telegram-init-data` header, and uses `BackButton`, `openLink` and `ready()`.
4. A clean export of `328dffe` (`git archive`, then `npm ci`, then `npm run build`) builds successfully, but the output contains the SDK **0** times: in `.next/server/app/tikhon-miniapp-pilot.html` and anywhere under `.next`. A clean checkout would therefore ship a Mini App with no `window.Telegram`, and every Telegram user would be blocked at the auth gate.

**LAYOUT_RUNTIME_DEPENDENCY = REQUIRED**

## 3. Content safety of layout.tsx

- SHA-256 `c568b232abba9e74d0857468d922778a68c3a11a97fdeb1e6d3174f2c6712190`; 28 lines; 773 bytes.
- Contents: route `metadata` (title and description), `viewport` (device-width, scale lock, `viewportFit: "cover"`), and `next/script` loading `https://telegram.org/js/telegram-web-app.js` with `strategy="beforeInteractive"`, followed by `{children}`.
- No credentials, user IDs, payment logic, business logic, Supabase or database access, or UI redesign. Its only responsibility is the Mini App runtime/bootstrap shell.
- It is byte-identical to the file served by the Owner-verified production deployment, which was built from this worktree.

## 4. Test disposition

`tests/tikhon-miniapp/live-data-binding.test.mts` (146 lines) imports only `node:test` and `node:assert/strict` and checks an inline sample courses payload. It never references `layout`, `Script` or the Telegram SDK.

**Disposition: HISTORICAL_OUT_OF_SCOPE_TEST.** It stays untracked and untouched.

## 5. Clean-tree reproduction (before commit)

Clean tree: `git archive 328dffe | tar -x` into `/tmp/stn_clean_head_20260923T222238Z`, followed by `npm ci` (exit 0, 359 packages). It contains no dirty worktree files and no `.env*` files.

| Step | Result |
| --- | --- |
| Build A: `328dffe` as committed | exit 0; SDK references in built HTML: **0** |
| Build B: `328dffe` + `layout.tsx` only | exit 0; SDK `<link rel="preload">`: **1**; SDK `self.__next_s` queue push: **1**; title «Академия структурной типологии — Тихон» |
| Typecheck, clean tree + `layout.tsx` | exit 0 |
| Tests, clean tree without `.env.local` | targeted 29/31; full 683/689 |
| Tests, clean tree + `.env.local` symlink (config only; removed afterwards) | targeted **31/31**; full **689/689** |

Without configuration, the only failures are live-integration tests that need gitignored runtime configuration (`.gitignore:35: .env*`): the courses route returns 503 "Supabase not configured", and the live student-status tests fail. No tracked source path is missing.

The main repo runs 708 tests; the clean tree runs 689. The 19-test difference is exactly the two untracked separate-track test files, `tests/navigation/first-contact.test.mts` and `tests/tikhon-miniapp/live-data-binding.test.mts`.

- **TELEGRAM_WEBAPP_SCRIPT_PRESENT_IN_CLEAN_TREE = YES**
- **MINIAPP_BUILD_FROM_CLEAN_TREE = PASS**
- **No additional required path.**

## 6. Validation (main repository)

| Gate | Result |
| --- | --- |
| `node --import tsx --test tests/tikhon-miniapp/batch-2-pricing-payer.test.mts` | PASS 31/31 |
| `npm test` | PASS 708/708, 0 fail |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

## 7. Correction scope

- Staged paths: `src/app/tikhon-miniapp-pilot/layout.tsx` and this report. Nothing else.
- No Batch-2 product logic reopened. No deploy, no Supabase or database change, no bot restart, no Telegram settings change, no payment.
- Pre-existing unrelated work (`src/lib/chat-contract.ts`, `src/lib/navigation/conversation-first-contact.ts`, `tests/navigation/first-contact.test.mts`, `tests/tikhon-miniapp/live-data-binding.test.mts`, untracked docs) is left untracked or unstaged and untouched.

Commit SHA, push parity and post-push clean-clone verification are recorded in the act's return block, because a commit cannot contain its own SHA.
