# NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1 — REPORT

**Date:** 2026-09-22
**Author:** Claude Opus 5 (sole implementation author)
**Terminal state:** `PRODUCTION_IMPLEMENTATION_COMPLETE`

> **Authorship boundary.** This is an implementation report. It contains no
> independent-verification PASS/FAIL verdict on this work. IV is the next act.

---

## 1. Baseline

| Item | Value |
| --- | --- |
| Branch | `navigator-production-dialogue-corr2-ab-normalization` |
| HEAD | `9a93132f4286c359f4733238467f7543bcad3756` |
| `origin/main` | `b0bc5adc24293eca2595b409f04007200311ef78` |
| `git diff --check` | clean |
| Pre-existing tracked dirty | `src/lib/chat-contract.ts` (governed — **not touched**) |
| Pre-existing untracked | 53 paths (`AGENTS.md`, `benchmarks/`, `public/offer.html`, `conversation-first-contact.ts`, `first-contact.test.mts`, prior act docs) |
| Pre-change validation | 570 tests pass · typecheck clean · lint clean |

All nine controlling-reference files SHA-256 re-verified against the act manifest
before any edit. All nine matched.

---

## 2. Planned changed-path set

New: `src/lib/academy/course-identity-scope.ts`,
`tests/navigation/bounded-rag-production.test.mts`, two act docs.
Modified: `evidence-selector.ts`, `conversation-act-router.ts`,
`navigator-observability.ts`, `orchestrate-navigation.ts`,
`conversation-response.ts`, `src/app/api/chat/route.ts`.

## 3. Actual changed-path set

Identical to the plan. No scope expansion; no unexpected governed path required.

| Path | Δ |
| --- | --- |
| `src/lib/academy/course-identity-scope.ts` | new, 69 lines |
| `src/lib/knowledge/retrieval/evidence-selector.ts` | +34 / −? (`34 ++-`) |
| `src/lib/navigation/conversation-act-router.ts` | `111 ++-` |
| `src/lib/navigation/navigator-observability.ts` | `141 ++-` |
| `src/lib/navigation/orchestrate-navigation.ts` | `203 ++-` |
| `src/lib/navigation/conversation-response.ts` | `356 ++-` |
| `src/app/api/chat/route.ts` | `12 +-` |
| `tests/navigation/bounded-rag-production.test.mts` | new, 957 lines |
| act docs ×2 | new |

Totals across modified source files: **794 insertions, 63 deletions**.

`src/lib/chat-contract.ts` remains at its pre-existing 13-insertion diff
(`ConversationChannel`, `ConversationEntryMode`, `BoundedOutreachContext`) — not
authored, modified or staged by this act.

---

## 4. Exact production deltas ported

### Router access (A)

- `ConversationActDecision` gains `COURSE_CONTENT` (courseId, evidenceRequested,
  contentIntentEvidence) and `ROUTER_DEGRADED`.
- Validator: `onlyKeys` guard; `isRecommendableCourseId` gate; boolean
  `evidenceRequested`; `contentIntentEvidence` must be a 3–240 char verbatim
  substring of the latest user message. `ROUTER_DEGRADED` is unselectable by the
  model — validation rejects it outright.
- Router prompt: "РОВНО ШЕСТЬ state", the full `6. COURSE_CONTENT` block including
  its negative enumeration, and the JSON format line.
- `classifyActOrDegrade` in the orchestrator degrades only the narrow
  validator-rejection class; transport/timeout/provider failures keep the existing
  technical-error lane. `ROUTER_DEGRADED` binds no course, runs no retrieval,
  resolves no evidence, and returns the existing technical-error wording as an
  ordinary turn.
- `route.ts`: `COURSE_CONTENT` maps to the existing `COURSE_FOLLOW_UP` act/flow;
  `ROUTER_DEGRADED` maps to `TECHNICAL_ERROR`; `courseId` extraction extended.

### Course identity scope (B)

Ported **byte-identical** — `sha256 = db0a2bf1608fd198bd7da07ac009fa085d3fc5192777b1caa8485a324d7e5e5e`,
matching the controlling reference exactly. The router catalog payload gains
exactly one field, `scope`; nothing else was added. PDS carries `null`.

> Note for IV: the file header retains its original
> `EXPERIMENT-3.COURSE-IDENTITY-SURFACE-1 — experiment-local` wording. This was
> deliberate: byte-identity makes the port hash-verifiable, and the header carries
> the authoring contract that governs the descriptors. Flagging it for the Owner as
> a wording decision, not a behavioural one.

### Selector quote contract (C)

- 320-character ceiling removed; minimum is now 8 canonical characters.
- `canonicalWhitespace` added (CRLF/CR normalise → collapse runs → trim).
- Acceptance: exact byte substring **or** canonical-whitespace substring of the
  same chunk.
- Still rejected: paraphrase, fabrication, stitching across chunks, unknown chunk,
  wrong-course evidence, invalid count.
- Duplicate identity is now `chunkId + canonicalQuote`.
- **Not ported:** the EXPERIMENT-1 `rejectedPayload` capture on
  `CourseEvidenceSelectionError` — it exists only to feed the experiment trace sink
  and would attach a raw provider payload to a thrown error. Provenance checks are
  unweakened.

### Composer reinforcement (D)

Both Experiment-7 blocks ported verbatim from the controlling reference, not
paraphrased: `ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ ВЫХОДА ЗА ГРАНИЦУ АВТОРИТЕТА` (5 clauses) and
`ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ФОРМУЛИРОВКИ` (5 clauses). Test A14 asserts all 11 anchor
strings are present in the prompt actually sent to the provider.

---

## 5. Hybrid guardrail as implemented

Straight-line code in `composeCourseFollowUpAnswer`, no loop:

1. **Structural guards** (unchanged, pre-existing): selection must be `SUPPORTED`
   and evidence non-empty; `selectedEvidence` throws on an unknown chunk;
   `assertCourseEvidenceIsolation` runs in the orchestrator before composition.
   A structural failure emits `FACTUAL_CEILING_STRUCTURAL` and returns the ceiling
   with **zero** compositions and **zero** audits. It is never sent to repair.
2. **Compose** → candidate.
3. **Primary audit** (frozen auditor): `PASS` → deliver original as `RAG_EVIDENCE`.
   `ERROR` → `FACTUAL_CEILING` with no repair. Valid `FAIL` → one repair.
4. **Repair compose**: same composer system prompt + one narrow repair instruction;
   identical authority payload, plus the rejected candidate and the primary
   reasonCode. A repair composer throw → `FACTUAL_CEILING`.
5. **Second audit** (same frozen auditor): `PASS` → deliver repaired as
   `RAG_EVIDENCE`; `FAIL` → `FACTUAL_CEILING`; `ERROR` → `FACTUAL_CEILING`.

No third composition, no third audit, no majority vote, no fail-open branch. The
rejected candidate is only ever an input to the repair; it is never returned on any
failing branch (test H27).

---

## 6. Audit-error containment

`runGroundingAudit` wraps `auditCourseFollowUpAnswer` in a containment boundary that
converts **every** transport, parse, schema and validator failure into an `ERROR`
outcome. An `ERROR` outcome can only ever become `FACTUAL_CEILING`.

The measured defect — the model emitting `{"status":"PASS","reasonCode":null}` — is
covered by test H21: the frozen validator still rejects it, the rejection is
contained, and the turn becomes a controlled ceiling. It never becomes a `PASS`,
never an unhandled 500, never a raw exception surfaced to the user. The validator
was **not** weakened to accept malformed PASS.

---

## 7. Proof the auditor contract is unchanged

```
src/lib/navigation/follow-up-grounding.ts
  c27d569cbe2706366bd52aca5ae9ea5adacb83234ff4c4a8a940c00b8cbeae28
controlling reference
  c27d569cbe2706366bd52aca5ae9ea5adacb83234ff4c4a8a940c00b8cbeae28
git status --porcelain  →  (empty)
```

Byte-identical and unmodified. System prompt, model, parameters, PASS/FAIL contract,
reasonCode enum, validator acceptance semantics and threshold wording are untouched.
No mechanical integration import or type change was required.

---

## 8. PDS invariant evidence

- `COURSE_IDENTITY_SCOPE["professional-development-stages"] === null`
  (tests C5, C7).
- `COURSE_CONTENT` validator rejects a PDS `courseId` via `isRecommendableCourseId`
  (test R4).
- `ROUTER_DEGRADED` performs zero retrieval, zero authority resolution and zero
  selector calls, and binds no course (tests R2, G31).
- `composeCourseFollowUpAnswer` throws for any non-ROUTABLE course.
- No PDS commercial/content activation was added.

## 9. Retrieval non-change evidence

- `git status` over `src/lib/knowledge/` shows only `evidence-selector.ts`.
- `retrieve-course-knowledge.ts` unmodified: `matchCount` default 12,
  `matchThreshold` default −1.
- The `COURSE_CONTENT` branch calls `retrieve(...)` with `matchCount: 12` and never
  overrides the threshold (test G30 asserts `matchCount === 12` and
  `matchThreshold === undefined`).
- Authority resolution at 8, unchanged.
- No change to embeddings, Cohere, vector dimensions, chunking, storage, corpus
  bindings, RPC semantics or the authority-map policy.

---

## 10. Targeted tests

`tests/navigation/bounded-rag-production.test.mts` — **35 tests, 35 pass, 0 fail**,
covering all 31 required behaviours:

| Area | Tests |
| --- | --- |
| Routing (1–4) | R1, R2, R3, R3b, R4, R4b, R4c |
| Course identity (5–7) | C5, C6, C7 |
| Selector (8–13) | S8, S9, S10, S11, S12, S13, S13b, S13c |
| Composer (14–15) | A14, A15 |
| Hybrid guardrail (16–27) | H16, H17, H18/H19, H20/H25/H26, H21, H22, H23, H24, H27, H-repair |
| Observability (28–29) | O28, O29, O29b |
| Regression (30–31) | G30, G31 |

## 11. Full suite

`npm test` → **605 tests, 605 pass, 0 fail** (570 pre-existing + 35 new).
**Zero regressions**: all 570 pre-existing tests passed unchanged both before and
after implementation.

## 12. Typecheck

`npm run typecheck` → clean.

## 13. Lint

`npm run lint` (`eslint --max-warnings=0`) → clean.

## 14. Build

`npm run build` → compiled successfully; TypeScript clean; 4/4 static pages
generated; `/api/chat` dynamic. No pre-existing build failure exists.

## 15. `git diff --check`

Clean.

## 16. Security scan

Changed and new files scanned for API keys, secrets, bearer tokens, Supabase
credentials, JWTs, passwords, raw provider payloads, `/private/tmp` or `/tmp`
dependencies, debug dumps and candidate/evidence logging:

- **No matches** for any secret or credential pattern.
- **No matches** for `/tmp`, `appendFileSync`, `writeFileSync`,
  `NAV_EXPERIMENT_TRACE_PATH`, `console.log`, `console.debug` or `debugger`.
- Three logging call sites total in changed source, all routed through governed
  builders that sanitise every field: two `console.warn`
  (`createNavigatorDegradationLog`, `createNavigatorRouterDegradationLog`) and one
  `console.info` (`createNavigatorGroundingLog`).
- `experiment-router-access-trace.ts` is absent from `src/`, and there are zero
  references to `recordExperimentTrace` anywhere in `src/` or `tests/`.
- Test O29 proves that a candidate answer, an evidence quote and a full user message
  passed into the grounding log builder are all structurally dropped or sanitised.

---

## 17. Remaining known issues

1. **Descriptor header wording.** `course-identity-scope.ts` was ported
   byte-identical for hash-verifiable provenance, so its header still reads
   "experiment-local". Behaviourally inert; an Owner wording call.
2. **Repair instruction is newly authored.** The controlling reference contains no
   repair lane, so §13's instruction was rendered in Russian to match the composer's
   operating language and bind under the same system prompt. Semantic equivalence to
   the act's English text is an IV check.
3. **Guardrail cost.** A primary `FAIL` now costs one extra composition plus one
   extra audit. No latency or token budget was specified in the act; not measured.
4. **`ROUTER_DEGRADED` user wording** reuses the existing retryable technical-error
   text. It is accurate but generic; the Owner may prefer distinct wording.
5. Pre-existing untracked work (`conversation-first-contact.ts`, `benchmarks/`,
   `public/offer.html`) was left untouched and is out of scope.

No pre-existing build or test failure was found, so none had to be reproduced or
proven control-equivalent.

---

## 18. Problem scale

**LIMITED.**

The diagnosis was accurate and the production tree had not drifted from the
experiment base in any controlling path, so the port was mechanical rather than a
reconciliation. All five changes plus the guardrail landed inside one act with a
minimal diff, zero regressions and a green suite, typecheck, lint and build. The
work is confined to the routing/grounding surface; the retrieval stack, the frozen
auditor and the commercial/dialogue lanes were untouched.

Estimated **1–2 acts** to return to roadmap:

1. `PRODUCTION-IMPLEMENTATION-1.IV1` — independent verification.
2. Optionally one Owner-adjudication/correction act if IV raises findings
   (most likely candidates: the two wording items in §17).

---

## 19. Confirmation

- **NO** `git add` — nothing staged.
- **NO** commit.
- **NO** push.
- **NO** deploy, merge, branch deletion or worktree cleanup.
- `src/lib/chat-contract.ts` not touched.
- No stash, reset, clean or checkout of unrelated work.

Working-tree implementation only, as authorized.

---

## 20. Recommended next act

**`NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1.IV1`**

Independent verification by another model. This author may not verify their own
implementation.

Suggested IV focus:

- Re-verify `follow-up-grounding.ts` = `c27d569c…` and `course-identity-scope.ts` =
  `db0a2bf1…`.
- Confirm the decision not to port `experiment-router-access-trace.ts` and the
  selector `rejectedPayload` plumbing is correct under §16/§23, and that no
  quote-contract semantics were lost with it.
- Audit the repair instruction for semantic equivalence to §13 and for any implicit
  permission to introduce new facts.
- Independently confirm exactly one repair and at most two audits on every path.
- Re-run the 31 required behaviours against the delivered tests and check for gaps.
