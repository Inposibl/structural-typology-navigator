# NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1.CORR1

**Date:** 2026-09-22
**Implementation author:** Claude Opus 5
**Controlling IV1 report SHA-256:** `f5c6021cd6e904bb76559a6df608000281960bc45a870b1d1ef0645b973e4431`

Scope is strictly limited to IV1 findings **F-1** and **F-2**.

---

## F-1 — COURSE_CONTENT boundary

### Defect

`COURSE_CONTENT` accepted a decision even when a catalog course had already been
named in the conversation. `COURSE_FOLLOW_UP` guards binding with
`courseWasActuallyInConversation`, so a model that wanted to bind a course absent
from the conversation could route through `COURSE_CONTENT` instead and bypass that
guard entirely — including rebinding to a *different* routable course.

### Correction

`src/lib/navigation/conversation-act-router.ts`

Added `anyCourseWasActuallyInConversation(messages)`, built directly on the existing
`courseWasActuallyInConversation` — the same title/URL presence semantics
`COURSE_FOLLOW_UP` already binds on. No second detector was introduced.

It scans `getRoutingCourseSummaries()`, i.e. the whole catalog including
`LISTED_UNROUTABLE` entries, so naming an unroutable course cannot open a rebinding
path to a routable one.

In `validateConversationActDecision`, the `COURSE_CONTENT` branch gains one gate,
placed immediately after the `onlyKeys` shape guard so the act's precondition is
evaluated before any course reasoning:

```ts
if (anyCourseWasActuallyInConversation(messages)) {
  throw new ConversationActDecisionValidationError(
    "COURSE_CONTENT cannot be used once a catalog course is present in the conversation.",
  );
}
```

### Invariants

| Condition | Result |
| --- | --- |
| No catalog course named | `COURSE_CONTENT` may be valid |
| Any catalog course title present | `COURSE_CONTENT` invalid |
| Any catalog course URL present | `COURSE_CONTENT` invalid |
| Named course, follow-up intent | Existing `COURSE_FOLLOW_UP` path, unchanged |
| PDS named | `COURSE_CONTENT` invalid; PDS remains unroutable |
| Arbitrary rebinding | Impossible — the gate precedes the `courseId` check |

Router semantics were not otherwise broadened or redesigned. The system prompt,
the other five acts and every other validator branch are untouched.

---

## F-2 — Structural failure controlled ceiling

### Defect

Missing-selected-chunk and cross-course isolation failures threw from
`orchestrate-navigation.ts`, surfacing as rejected promises / technical errors
rather than the controlled structural ceiling the bounded-RAG design already
defines.

### Correction

`src/lib/navigation/orchestrate-navigation.ts`

1. **`courseEvidenceStructurallyInvalid(courseId, resolvedEvidence, evidenceSelection)`**
   — the same three invariants as `assertCourseEvidenceIsolation`, evaluated without
   throwing:
   - resolved evidence belonging to another course;
   - selected evidence whose chunk is absent from resolved evidence;
   - selected evidence whose chunk resolves to another course.

2. **`structuralCeilingResult(...)`** — emits the `FACTUAL_CEILING_STRUCTURAL`
   grounding event through the existing production sink, then returns
   `composeCourseFactualCeilingAnswer(course.title)` with a turn record carrying
   zero evidence (`resolvedEvidenceCount: 0`, `selectedEvidence: []`,
   `evidenceSelectionStatus: "INSUFFICIENT"`, `answerOrigin: "FACTUAL_CEILING"`,
   `fallback: "FACTUAL_CEILING"`).

3. Both bounded-RAG lanes — `COURSE_CONTENT` and `COURSE_FOLLOW_UP` — now check
   **before composition** and return the controlled ceiling instead of calling
   `assertCourseEvidenceIsolation`.

`assertCourseEvidenceIsolation` itself is left in place, unchanged, as a
defence-in-depth backstop and because the `RECOMMEND_COURSE` lane still relies on
it. That lane was deliberately **not** converted: it has no composition/audit/repair
cycle and no factual-ceiling semantics, so converting it would change unrelated
production behaviour outside CORR1 scope.

### Invariants

```
cross-course evidence  → FACTUAL_CEILING → 0 composition → 0 audit → 0 repair
missing selected chunk → FACTUAL_CEILING → 0 composition → 0 audit → 0 repair
```

No rejected promise. Not a generic technical error. Semantic repair cannot rescue
structural invalidity, because the ceiling is taken before the composer is reached.

### Observability

`FACTUAL_CEILING_STRUCTURAL` is preserved and is the channel that keeps the
structural violation visible. The observability **schema was not changed** — the
stage already existed.

The turn record reports `crossCourseLeakageDetected: false` because nothing leaked
into the delivered turn: the invalid evidence is discarded, not composed, not
logged and not shown. Reporting `true` would additionally make
`createNavigatorTurnLog` throw in `route.ts`, reintroducing precisely the
uncontrolled failure F-2 exists to remove.

---

## Authorized change surface — observed

| Path | Changed |
| --- | --- |
| `src/lib/navigation/conversation-act-router.ts` | yes (F-1) |
| `src/lib/navigation/orchestrate-navigation.ts` | yes (F-2) |
| `tests/navigation/bounded-rag-production.test.mts` | yes |
| CORR1 act-local docs | created |

Verified byte-unchanged from their PRODUCTION-IMPLEMENTATION-1 state:
`conversation-response.ts`, `evidence-selector.ts`, `navigator-observability.ts`,
`src/app/api/chat/route.ts`, `chat-contract.ts`, and — by SHA —
`follow-up-grounding.ts` (`c27d569c…`) and `course-identity-scope.ts`
(`db0a2bf1…`).

Not reworked: hybrid audit semantics, repair instruction, selector contract,
composer reinforcement, course descriptors, retrieval, PDS policy.

---

## Open blocker

One pre-existing test asserts the exact behaviour F-2 was authorized to replace:

`tests/navigation/package-e-regression-observability.test.mts:209` —
*"Package E: cross-course resolved evidence fails instead of logging clean success"*

It is outside the authorized change surface, so it was **not** modified. See the
CORR1 report, §Blocker, for the proposed minimal edit and the Owner decision
required.
