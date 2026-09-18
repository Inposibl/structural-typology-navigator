# LIVE-CONVERSATIONAL-PILOT.ROUTER-CORR-1.PREFLIGHT

**Status:** PASS WITH BLOCKING ROUTING-QUALITY FINDINGS
**Baseline:** `b68271a178b610a083a0e635486e43eee8d4c66e`
**Mode:** read-only preflight; no repository or production mutation
**Problem scale:** LIMITED
**Estimated return-to-pilot:** ~5 gated acts after this preflight

## 1. Reproduced product-quality defect

The exact production conversation now returns HTTP 200, so the infrastructure/RAG incident is closed. The remaining defect is routing quality.

After the user explicitly states:

- `Скорее всего потребности и мотивы`
- `мне интересны практические инструменты, скорее всего мотивации, но лучше индивидуально`

the router still returns `ASK_MORE` instead of resolving the route.

It also asks the user about internal theoretical constructs:

- `Mono(S)`
- `S–O`
- `S–S`

This violates the intended Navigator architecture: theory is an internal reasoning layer, while the user should be routed from their stated problem/learning need in ordinary language.

## 2. Root causes in the current code

### RF-1 — ASK_MORE has no decision-critical stopping rule — BLOCKING

`src/lib/navigation/router.ts` currently defines:

> `ASK_MORE — данных недостаточно, задай 1–3 различающих вопроса.`

This does not define *when data are sufficient*.

There is no rule requiring the router to prove that another answer could actually change the primary course. Therefore an LLM can keep asking “useful” questions even after one course is already directly supported.

The current validator in `src/lib/navigation/navigation-decision.ts` checks only the shape of `ASK_MORE`:
- max two candidates;
- one to three questions;
- non-empty rationale.

It does not validate that clarification is decision-critical.

### RF-2 — router input exposes answer/outcome terminology that should not drive user-facing clarification — BLOCKING

`getRoutingCourseSummaries()` currently sends `siteOutcomes` to the router.

For `maslow`, `siteOutcomes` explicitly includes:

> `понимать режимы Mono(S), S–O, S–S, S–O–S, Meta(S)`

The model therefore receives internal theoretical vocabulary in the same payload from which it constructs `ASK_MORE.questions`.

There is no instruction saying that `siteOutcomes` must never be echoed or used to formulate clarification questions.

This is the direct architectural path by which `Mono(S), S–O, S–S` reached the user.

### RF-3 — assistant-seeded terminology can recursively become routing ambiguity — BLOCKING

The first assistant turn introduced the phrase `динамическая модель уровней/режимов`.

The user then reasonably asked what that phrase meant:

> `Интересно услышать про динамическую модель - что это? В вопросе не понятно для чего она.`

The router receives the whole conversation, including assistant messages. Although `RECOMMEND_COURSE.evidence` must ultimately be a verbatim user quote, the prompt contains no provenance rule saying:

> terminology first introduced by the assistant is context, not independent evidence of a new user need.

As a result, the model can turn its own earlier terminology into another clarification loop.

### RF-4 — prompt prohibits assigning labels, but does not prohibit exposing labels — BLOCKING

The current prompt says the Navigator:

> `не назначает пользователю тип, уровень сознания, S–O/S–S статус ... как факт`

That prevents one misuse only: **assigning** a label.

It does not prohibit:
- mentioning internal labels;
- asking users whether they are ready to work with them;
- making course selection depend on understanding them.

So the observed output is not a violation of the literal current prompt even though it is a violation of the intended product design.

### RF-5 — current tests protect JSON validity and evidence grounding, not routing sufficiency or user-language quality — MAJOR

Current router/navigation tests verify:
- exact user-quote grounding;
- rejection of hallucinated evidence;
- current-course membership;
- official multi-course sequences;
- unroutable-course rejection.

They do **not** cover:
- when `ASK_MORE` must stop;
- internal terminology leakage;
- assistant-seeded terminology;
- the exact live pilot conversation;
- whether clarification can materially change the primary route.

## 3. Exact route assessment for the pilot conversation

On the current catalog, the user's independent statements directly align with the `maslow` routing learning needs:

Catalog:
- `понимание изменения мотивации и приоритетов под влиянием контекста`
- `понимание того, какие потребности фактически определяют поведение здесь и сейчас`
- `необходимость точнее работать с мотивацией человека или команды`

User:
- `понять кому что не хватает, кого что мотивирует`
- `Скорее всего потребности и мотивы`
- `практические инструменты, скорее всего мотивации, но лучше индивидуально`

The competing `levels-of-consciousness` route is supported mainly by the *first* broad description of reactions to pressure, but the user explicitly resolves the Navigator's own discriminator in favor of needs/motives.

Therefore, under the intended product contract, the conversation has crossed the sufficiency threshold for `RECOMMEND_COURSE(primaryCourseId="maslow")`.

This conclusion is specific to the catalog evidence above; it does not require a hard-coded `if maslow`.

## 4. Minimal course-generic correction

### CORR-A — tighten ASK_MORE semantics in the router prompt

Replace the vague “data insufficient” rule with a decision-critical rule:

`ASK_MORE` is allowed only when:
1. at least two routable courses remain genuinely plausible **or** no course yet has sufficient support; and
2. the missing information could materially change the primary course or change the state to `NO_CURRENT_COURSE_MATCH`.

If one routable course has direct support from explicit user-stated goals/problems and alternatives are materially weaker, use `RECOMMEND_COURSE`.

Do not ask merely to improve confidence, explain Academy theory, or gather nice-to-have context.

### CORR-B — plain-language clarification contract

For `ASK_MORE.questions`:
- use only ordinary problem/task language;
- do not name internal modes, abbreviations, typological labels, course-internal constructs, or theoretical vocabulary not independently introduced by the user;
- do not ask the user to choose between Academy models;
- do not ask whether they are “ready for an abstract model” unless a documented negative-fit signal makes that fact genuinely decision-critical;
- questions must discriminate between candidate educational needs, not teach theory.

### CORR-C — provenance rule for assistant-seeded concepts

Add:

Prior assistant messages are conversational context only.
A concept first introduced by the assistant must not become an independent routing signal merely because the user asks what it means or repeats it while answering. Route on the user's independently stated goal/problem/constraint.

### CORR-D — reduce router catalog projection

The router does not need full `siteOutcomes`.

For routing, send:
- `id`
- `title`
- `status`
- `learningNeeds`
- `negativeFitSignals`
- `routingBlockReason`

Remove `siteOutcomes` from the router snapshot.

This is course-generic and eliminates the direct data path that exposed `Mono(S), S–O, S–S...` to the routing LLM.

`siteOutcomes` remains available elsewhere for deterministic user-facing course explanation after a route is selected.

## 5. What should NOT be added

Do not add:

- `if user mentions motivation => maslow`;
- a Maslow-specific phrase matcher;
- a special case for this conversation;
- RAG before routing;
- a requirement that the user understand Academy theory before recommendation;
- a second LLM call to adjudicate ASK_MORE;
- a large keyword blacklist as the primary control.

The correction should remain catalog-driven and course-generic.

## 6. Recommended implementation scope

Expected production-code scope:

1. `src/lib/navigation/router.ts`
   - decision-critical sufficiency contract;
   - plain-language question contract;
   - assistant-seeded provenance rule.

2. `src/lib/academy/course-catalog.ts`
   - routing projection excludes `siteOutcomes`.

Expected tests:

3. `tests/navigation/router.test.mts`
   - serialized router input excludes internal `siteOutcomes`;
   - system contract contains the sufficiency/provenance/plain-language rules.

4. `tests/navigation/course-catalog.test.mts`
   - routing summaries do not expose `siteOutcomes`.

5. Add a pilot routing fixture/test for the exact three-message conversation as an **evaluation fixture**, without hard-coding the answer in production logic.

No change is currently required to:
- Supabase;
- Cohere;
- RAG retrieval;
- answer composer;
- course-source registry;
- API contract;
- Vercel environment;
- observability.

## 7. Acceptance criteria for implementation

Local implementation is acceptable only if all are true:

1. Full `npm run validate` PASS.
2. Router prompt explicitly requires decision-critical `ASK_MORE`.
3. Router prompt explicitly bans exposing internal Academy constructs in clarification questions.
4. Router prompt explicitly handles assistant-seeded terminology.
5. Router catalog snapshot no longer contains `siteOutcomes`.
6. Existing grounding/fail-closed tests remain PASS.
7. No Maslow-specific production branching is introduced.
8. No change to the three allowed routing states.
9. No RAG-before-route regression.
10. No external provider calls in the local implementation act.

## 8. Post-implementation live evaluation gate

After commit/push/deploy, run a separate authorized routing evaluation.

Minimum cases:

- exact pilot conversation → should resolve rather than repeat theory-led `ASK_MORE`;
- genuinely ambiguous pressure-vs-motivation case → `ASK_MORE` remains allowed;
- clear rules/manual-control case → `normative-situation`;
- clear motivation/needs case → `maslow`;
- clear stress/perception/decision-distortion case → `levels-of-consciousness`;
- no current catalog fit → `NO_CURRENT_COURSE_MATCH`.

The evaluation should also assert that user-facing clarification contains none of the Academy-internal labels unless the user independently introduced them.

## 9. Governance conclusion

**Preflight result:** PASS WITH BLOCKING ROUTING-QUALITY FINDINGS.

The problem is **LIMITED**, not architectural/global.

The correction is expected to remain inside the router contract + router catalog projection + regression tests.

Approximate gated path back to pilot:

1. `ROUTER-CORR-1` local implementation + validate.
2. commit.
3. push.
4. production deployment verification.
5. authorized live routing evaluation.

No infrastructure correction is indicated by this preflight.
