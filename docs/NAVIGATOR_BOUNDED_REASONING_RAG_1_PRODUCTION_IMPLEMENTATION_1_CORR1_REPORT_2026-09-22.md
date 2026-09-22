# NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1.CORR1 — REPORT

**Date:** 2026-09-22
**Author:** Claude Opus 5 (implementation author — did not audit CORR1)
**Terminal state:** `PRODUCTION_IMPLEMENTATION_CORR1_COMPLETE`
**Secondary state:** `BLOCKED_SCOPE_EXPANSION` on one pre-existing test file (§8)

---

## 1. Exact changed paths

| Path | Δ | Note |
| --- | --- | --- |
| `src/lib/navigation/conversation-act-router.ts` | 111 → 144 | F-1 |
| `src/lib/navigation/orchestrate-navigation.ts` | 203 → 337 | F-2 |
| `tests/navigation/bounded-rag-production.test.mts` | 35 → 43 tests | revised + new |
| `docs/…_CORR1_2026-09-22.md` | new | act-local |
| `docs/…_CORR1_REPORT_2026-09-22.md` | new | act-local |

Nothing else changed. Confirmed byte-unchanged from their
PRODUCTION-IMPLEMENTATION-1 state: `conversation-response.ts` (356),
`evidence-selector.ts` (34), `navigator-observability.ts` (141),
`src/app/api/chat/route.ts` (12), `chat-contract.ts` (13, pre-existing governed).
SHA-verified unchanged: `follow-up-grounding.ts` `c27d569c…`,
`course-identity-scope.ts` `db0a2bf1…`.

---

## 2. Exact correction — F-1

Added `anyCourseWasActuallyInConversation(messages)`, composed from the **existing**
`courseWasActuallyInConversation` over `getRoutingCourseSummaries()` — the same
title/URL presence semantics `COURSE_FOLLOW_UP` binds on. No second detector.

Gate added to the `COURSE_CONTENT` validator branch, immediately after the
`onlyKeys` shape guard:

```ts
if (anyCourseWasActuallyInConversation(messages)) {
  throw new ConversationActDecisionValidationError(
    "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.",
  );
}
```

Because the gate precedes the `courseId` check, no rebinding — to a different
routable course, or back to the named one — is reachable. The catalog scan includes
`LISTED_UNROUTABLE`, so a named PDS closes the boundary too and PDS stays
unroutable. Router semantics were not otherwise broadened.

---

## 3. Exact correction — F-2

`courseEvidenceStructurallyInvalid(...)` evaluates the same three invariants as
`assertCourseEvidenceIsolation` without throwing (foreign resolved evidence;
selected chunk absent from resolved; selected chunk resolving to another course).

`structuralCeilingResult(...)` emits `FACTUAL_CEILING_STRUCTURAL` through the
existing grounding sink and returns `composeCourseFactualCeilingAnswer(title)` with
a zero-evidence turn record (`resolvedEvidenceCount: 0`, `selectedEvidence: []`,
`evidenceSelectionStatus: "INSUFFICIENT"`, `answerOrigin`/`fallback` =
`FACTUAL_CEILING`).

Both bounded-RAG lanes now take this ceiling **before composition**:

```
cross-course evidence  → FACTUAL_CEILING → 0 composition → 0 audit → 0 repair
missing selected chunk → FACTUAL_CEILING → 0 composition → 0 audit → 0 repair
```

No rejected promise; not a generic technical error; semantic repair cannot rescue
structural invalidity. `assertCourseEvidenceIsolation` is retained unchanged as a
backstop. The `RECOMMEND_COURSE` lane was deliberately not converted — it has no
composition/audit/repair cycle or ceiling semantics, and converting it would change
unrelated production behaviour outside CORR1 scope.

The observability **schema was not modified**; `FACTUAL_CEILING_STRUCTURAL` already
existed. `crossCourseLeakageDetected` stays `false` because nothing leaked into the
delivered turn — and because `true` would make `createNavigatorTurnLog` throw in
`route.ts`, reintroducing the uncontrolled failure F-2 removes.

---

## 4. New / changed tests

`tests/navigation/bounded-rag-production.test.mts` — 35 → **43 tests**.

**Revised (1)**

- `S13` → `S13/F-2: cross-course evidence takes the controlled structural ceiling
  with zero composition, audit and repair`. Previously asserted
  `assert.rejects(/Cross-course evidence/)`; now asserts the controlled ceiling.

**New (8)**

| Test | Finding |
| --- | --- |
| `F-1: COURSE_CONTENT is rejected when a catalog course is already named (adversarial rebinding)` | F-1 — Codex's adversarial case |
| `F-1: COURSE_CONTENT is rejected even when it rebinds to the already-named course` | F-1 |
| `F-1: a named course URL also closes the COURSE_CONTENT boundary` | F-1 |
| `F-1: naming the unroutable PDS course does not open a COURSE_CONTENT rebinding path` | F-1 |
| `F-1: COURSE_CONTENT stays valid while no catalog course has been named` | F-1 positive control |
| `F-1: COURSE_FOLLOW_UP still binds normally once a course is named` | F-1 non-regression |
| `F-2: a missing selected chunk takes the controlled structural ceiling…` | F-2 |
| `F-2: the COURSE_FOLLOW_UP lane takes the same controlled structural ceiling` | F-2 |

The F-2 tests read grounding events back off the production log sink via a
`console.info` capture, so "zero audit" and "zero repair" are asserted from emitted
observability (`stages` contains only `FACTUAL_CEILING_STRUCTURAL`) rather than
inferred. Each also asserts composition calls = 0 and that the promise resolves.

Fixture note: the F-1 fixtures read course titles and URLs from
`getAcademyCourse(...)` rather than hardcoding them, since the boundary is defined
by the catalog's own presence semantics.

---

## 5. Targeted results

`node --import tsx --test tests/navigation/bounded-rag-production.test.mts`
→ **43 tests, 43 pass, 0 fail.**

All six F-1 tests and all three F-2 tests pass. The 34 pre-existing
PRODUCTION-IMPLEMENTATION-1 tests in this file still pass unchanged (one revised as
above).

---

## 6. Full suite

`npm test` → **613 tests, 612 pass, 1 fail.**

- 605 → 613 (+8 new CORR1 tests).
- The single failure is `Package E: cross-course resolved evidence fails instead of
  logging clean success` — see §8. It is caused solely and directly by the
  authorized F-2 behaviour change.
- All other 604 previously-passing tests still pass.

---

## 7. Typecheck / lint / build / diff-check

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npm run build` | success — compiled, TS clean, 4/4 static pages, `/api/chat` dynamic |
| `git diff --check` | clean |

---

## 8. Blocker — `BLOCKED_SCOPE_EXPANSION`

**File:** `tests/navigation/package-e-regression-observability.test.mts:209`
**Test:** *"Package E: cross-course resolved evidence fails instead of logging clean success"*

This pre-existing test asserts the exact behaviour F-2 was authorized to replace:

```ts
await assert.rejects(
  () => orchestrateNavigatorResponse(/* cross-course resolved evidence */),
  /Cross-course evidence/u,
);
assert.equal(composerCalled, false);
```

F-2 mandates that this case become a controlled `FACTUAL_CEILING` instead of a
rejected promise, so the `assert.rejects` assertion can no longer hold. The file is
**not** in the authorized change surface, so per the act's governance it was **not
touched** and the failure is reported rather than silenced.

The test's *intent* is fully preserved by F-2 — the composer is still never called,
and the turn is still not logged as a clean success. Only the failure mechanism
changed.

**Proposed minimal edit, for Owner authorization (not applied):**

```ts
test("Package E: cross-course resolved evidence takes the controlled structural ceiling", async () => {
  let composerCalled = false;
  const result = await orchestrateNavigatorResponse(
    [{ role: "user", content: "Как устроены переходы?" }],
    {
      dependencies: followUpDependencies({
        resolve: () => [resolvedEvidence("levels-of-consciousness")],
        composeFollowUp: async () => {
          composerCalled = true;
          return "must not compose";
        },
      }),
    },
  );

  assert.equal(composerCalled, false);
  assert.equal(result.observability?.answerOrigin, "FACTUAL_CEILING");
  assert.equal(result.observability?.crossCourseLeakageDetected, false);
  assert.deepEqual(result.observability?.selectedEvidence, []);
});
```

Owner decision required: authorize this single test edit, or direct an alternative.
Equivalent coverage already exists inside the authorized surface
(`F-2: the COURSE_FOLLOW_UP lane takes the same controlled structural ceiling`), so
no coverage is lost either way.

---

## 9. Confirmation — no other production behaviour changed

- Hybrid audit semantics, repair instruction, selector contract, composer
  reinforcement, course descriptors, retrieval stack, PDS policy and the
  observability schema are all untouched.
- The five other production files modified by PRODUCTION-IMPLEMENTATION-1 are
  byte-identical to their state at the end of that act.
- `follow-up-grounding.ts` and `course-identity-scope.ts` SHA-verified unchanged.
- `src/lib/chat-contract.ts` remains at its pre-existing governed 13-insertion diff.
- The `RECOMMEND_COURSE` lane's isolation guard is unchanged.

## 10. Confirmation — no git mutation

No `git add`, commit, push, deploy, stash, reset or clean. Nothing staged.
Working-tree implementation only.

---

## 11. Terminal state

**`PRODUCTION_IMPLEMENTATION_CORR1_COMPLETE`**
(with `BLOCKED_SCOPE_EXPANSION` outstanding on the one test file in §8)

Per the act, this author did not audit CORR1 and issues no verification verdict.

## 12. Recommended next act

**`NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1.CORR1.IV1`**
— independent verification, **Codex** as verifier.

Suggested IV focus: that F-1 reuses the existing presence semantics rather than a
parallel detector and that the gate ordering forecloses rebinding; that F-2 leaves
no reachable throw on either bounded-RAG lane and that zero-audit/zero-repair is
genuinely structural; the `crossCourseLeakageDetected: false` reporting decision;
and the §8 blocker resolution.
