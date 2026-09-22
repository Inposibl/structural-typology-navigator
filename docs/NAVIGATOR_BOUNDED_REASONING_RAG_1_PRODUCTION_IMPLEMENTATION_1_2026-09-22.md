# NAVIGATOR-BOUNDED-REASONING-RAG-1.PRODUCTION-IMPLEMENTATION-1

**Date:** 2026-09-22
**Role:** Sole production implementation author / coder
**Model:** Claude Opus 5
**Act type:** Production implementation (not research, not benchmark design, not a new experiment)

Owner reassigned this act from Grok to Claude. Claude is the sole implementation
author and may not audit its own work; the terminal recommendation of this act is
independent verification by another model.

---

## 1. Purpose

Port the verified Experiment-1 / -3 / -4 / -7 deltas from the durable controlling
implementation into the current production tree, implement the bounded hybrid
grounding guardrail, contain audit-boundary errors, and add production-safe
observability — while preserving newer unrelated production behaviour.

Controlling implementation directory:

```
/Users/entp_psyche/Desktop/InvestProjects2026/Navigator-Controlled-Artifacts/
NAVIGATOR-BOUNDED-REASONING-RAG-1/EXPERIMENT-8/AUDIT-STABILITY-REPLAY-1/
INPUT-REMATERIALIZATION-1/implementation/
```

All nine controlling files were SHA-256 re-verified against the act manifest at the
start of this act. All nine matched.

---

## 2. Baseline

| Item | Value |
| --- | --- |
| Repository root | `/Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator` |
| Branch | `navigator-production-dialogue-corr2-ab-normalization` |
| HEAD | `9a93132f4286c359f4733238467f7543bcad3756` |
| `origin/main` | `b0bc5adc24293eca2595b409f04007200311ef78` |
| `git diff --check` | clean |
| Tracked modified (pre-existing) | `src/lib/chat-contract.ts` — governed, **not touched** |
| Untracked (pre-existing) | 53 paths (`AGENTS.md`, `benchmarks/`, `public/offer.html`, `src/lib/navigation/conversation-first-contact.ts`, `tests/navigation/first-contact.test.mts`, prior act docs) |

Pre-change validation baseline: **570 tests pass**, typecheck clean, lint clean.

---

## 3. Production-vs-reference diff analysis

For every controlling file, the current production version was diffed against the
controlling version before any edit.

| File | Production state | Finding |
| --- | --- | --- |
| `follow-up-grounding.ts` | `c27d569c…` | **Byte-identical to the controlling reference.** The frozen auditor is already in production. |
| `evidence-selector.ts` | pre-experiment | Delta = quote contract + EXPERIMENT-1 payload capture |
| `conversation-act-router.ts` | pre-experiment | Delta = COURSE_CONTENT/ROUTER_DEGRADED + scope + trace |
| `navigator-observability.ts` | pre-experiment | Delta = degrade lane types + predicate |
| `orchestrate-navigation.ts` | pre-experiment | Delta = degrade lane + COURSE_CONTENT branch + trace |
| `conversation-response.ts` | pre-experiment | Delta = composer reinforcement + trace |
| `route.ts` | pre-experiment | Delta = act mapping |
| `course-identity-scope.ts` | **absent** | New file, must be ported |
| `experiment-router-access-trace.ts` | **absent** | Experiment-only sink — see §6 |

Every diff was purely additive or a direct replacement of the block the experiment
supersedes. No newer unrelated production work exists in these paths, so no
production behaviour had to be reconciled or sacrificed.

---

## 4. Planned changed-path set

**New**

- `src/lib/academy/course-identity-scope.ts`
- `tests/navigation/bounded-rag-production.test.mts`
- `docs/NAVIGATOR_BOUNDED_REASONING_RAG_1_PRODUCTION_IMPLEMENTATION_1_2026-09-22.md`
- `docs/NAVIGATOR_BOUNDED_REASONING_RAG_1_PRODUCTION_IMPLEMENTATION_1_REPORT_2026-09-22.md`

**Modified**

- `src/lib/knowledge/retrieval/evidence-selector.ts`
- `src/lib/navigation/conversation-act-router.ts`
- `src/lib/navigation/navigator-observability.ts`
- `src/lib/navigation/orchestrate-navigation.ts`
- `src/lib/navigation/conversation-response.ts`
- `src/app/api/chat/route.ts`

**Explicitly not touched**

- `src/lib/chat-contract.ts` (governed pre-existing dirty path)
- `src/lib/navigation/follow-up-grounding.ts` (frozen auditor)
- Retrieval stack: embeddings, Cohere, dimensions, chunking, storage, corpus
  bindings, RPC, threshold, limit, authority-map policy

---

## 5. Implementation scope

### A — Router access

`COURSE_CONTENT` is added as a sixth conversation act: a first-turn substantive
question about course material, asked without any catalog course having been named.
It requires an actual bounded course decision — `courseId` must pass
`isRecommendableCourseId`, and `contentIntentEvidence` must be a 3–240 character
verbatim substring of the latest user message. It is not a generic catch-all RAG
path: the prompt enumerates what `COURSE_CONTENT` is *not* for (price, schedule,
catalog, overview, psychology boundary, recommendation, payment, contact, META,
out-of-scope), and the existing distinctions between `COURSE_FOLLOW_UP`,
`NAVIGATE`, `META`, `FACTUAL`, `OUT_OF_SCOPE` and the commercial/dialogue states
are preserved unchanged.

Router model validation failure no longer produces an uncontrolled HTTP 503.
`classifyActOrDegrade` mirrors the existing `selectEvidenceOrDegrade` one layer
down: only the narrow validator-rejection class
(`ConversationActDecisionValidationError` / `INVALID_CONVERSATION_ACT_DECISION` /
no upstream status) degrades to `ROUTER_DEGRADED`. Transport, timeout and provider
failures keep the technical-error lane they have today.

`ROUTER_DEGRADED` fabricates nothing: no course, no evidence, no retrieval, no PDS
routing, no hidden fallback course. It returns the project's existing
technical-error wording as an ordinary turn.

### B — Course identity scope

`course-identity-scope.ts` ported **byte-identical** to the controlling reference
(`db0a2bf1…`). One governed, corpus-derived subject-matter descriptor per course;
PDS carries `null`. The router payload gains exactly one field — `scope` — and
nothing else. A course without a descriptor keeps its title and status exactly as
before, so the field can enrich an identity but never gates one. Newer
commercial/catalog metadata elsewhere is untouched.

### C — Selector quote contract

The 320-character ceiling is removed. A quote is valid if it is an exact byte
substring of its chunk **or** if its canonical-whitespace form is a substring of the
chunk's canonical-whitespace form. Canonicalisation normalises CRLF/CR, collapses
whitespace runs and trims — letters, case, punctuation and word order are untouched.
Paraphrase, fabrication, stitching across chunks, unknown chunks, wrong-course
evidence and invalid counts all remain rejected. Duplicate identity is now
`chunkId + canonicalQuote`.

### D — Composer authority reinforcement

The exact Experiment-7 reinforcement text is ported verbatim from the controlling
reference — both the `ЗАПРЕЩЁННЫЕ ПАТТЕРНЫ ВЫХОДА ЗА ГРАНИЦУ АВТОРИТЕТА` block and
the `ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ФОРМУЛИРОВКИ` block. Not paraphrased.

### E — Bounded hybrid grounding guardrail

```
DETERMINISTIC STRUCTURAL GUARDS
        ↓
COMPOSE
        ↓
PRIMARY AUDIT ── PASS  → RAG_EVIDENCE (original)
               ├ FAIL  → ONE CONTROLLED REPAIR
               └ ERROR → FACTUAL_CEILING
        ↓
REPAIR COMPOSE ── error → FACTUAL_CEILING
        ↓
SECOND AUDIT ── PASS  → RAG_EVIDENCE (repaired)
              ├ FAIL  → FACTUAL_CEILING
              └ ERROR → FACTUAL_CEILING
```

Exactly one repair opportunity, expressed as straight-line code with no loop. No
third composition, no third audit, no majority vote, no fail-open branch. The
frozen semantic auditor is unchanged and is called by the same function on both
passes.

The repair reuses the same composer system prompt (so every authority rule still
binds) plus one narrow repair instruction, and receives the identical authority
payload, the rejected candidate and the primary reasonCode. No new retrieval, no
new selector call, no new evidence, no new source, no world knowledge, no course
change.

---

## 6. Experiment trace module — deliberately not ported

`experiment-router-access-trace.ts` writes `candidateAnswer`, `selectedQuotes`, raw
rejected provider payloads and course identity payloads to a file named by
`NAV_EXPERIMENT_TRACE_PATH`. §16 of the act forbids production logging of candidate
answer text, authority payloads, evidence quotes and full user messages, and states
that experiment trace instrumentation is not automatically production logging.

The module is therefore **not** ported, and every `recordExperimentTrace` call site
in the controlling reference was dropped rather than carried across. For the same
reason the `CourseEvidenceSelectionError.rejectedPayload` plumbing — which exists
solely to feed that sink — was **not** ported; only the quote-contract semantics
were. The quote contract itself is complete.

Its production replacement is a governed observability event (§7) that classifies
the outcome without carrying any of the content.

---

## 7. Production observability

`NAVIGATOR_GROUNDING` events classify all nine required outcomes:

```
PRIMARY_AUDIT_PASS      REPAIR_AUDIT_PASS       FACTUAL_CEILING_STRUCTURAL
PRIMARY_AUDIT_FAIL      REPAIR_AUDIT_FAIL       FACTUAL_CEILING_AUDIT
PRIMARY_AUDIT_ERROR     REPAIR_AUDIT_ERROR      REPAIR_ATTEMPTED
```

`createNavigatorGroundingLog` re-derives every field through a whitelist or a
sanitiser and emits a fixed key set: `event`, `requestId`, `stage`, `courseId`,
`reasonCode`, `errorName`, `selectedEvidenceCount`, `repairAttempted`. Free text
fails `safeIdentifier` and collapses to `UNKNOWN`; an unknown stage throws; an
out-of-enum reasonCode becomes `null`. Extra properties on the input are structurally
dropped. No candidate answer, authority payload, evidence quote, user message or
secret can reach a log line.

The router degrade lane reuses the existing `NAVIGATOR_DEGRADATION` event via a
dedicated guarded builder, `createNavigatorRouterDegradationLog`.

---

## 8. Invariants preserved

- **Auditor frozen.** `follow-up-grounding.ts` is byte-unchanged
  (`c27d569c…`): same system prompt, model, parameters, PASS/FAIL contract,
  reasonCode enum, validator acceptance semantics and threshold wording. The
  malformed `{"status":"PASS","reasonCode":null}` case is still rejected by the
  validator — it is contained, never accepted.
- **PDS fail-closed.** No PDS routing, course binding, retrieval, evidence or
  commercial/content activation. `COURSE_IDENTITY_SCOPE` gives PDS `null`;
  `isRecommendableCourseId` rejects it in the `COURSE_CONTENT` validator; the
  composer rejects a non-ROUTABLE course outright.
- **Structural guards are hard failures.** Missing/insufficient selection, unknown
  chunk ids, cross-course evidence and authority-filter wipeout end at
  `FACTUAL_CEILING` or throw — never at the repair loop.
- **Retrieval untouched.** `matchCount` 12 and the module default `matchThreshold`
  of −1 are unchanged; `retrieve-course-knowledge.ts`, the authority resolver, the
  embeddings/Cohere path, chunking, storage, corpus bindings and the authority-map
  policy are not modified.

---

## 9. Git authority

Working-tree implementation only. No `git add`, no commit, no push, no merge, no
deploy, no branch deletion, no worktree cleanup. Nothing was staged.
