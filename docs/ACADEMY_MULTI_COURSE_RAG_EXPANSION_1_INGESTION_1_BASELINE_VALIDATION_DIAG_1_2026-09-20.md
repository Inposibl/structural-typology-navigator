# ACADEMY-MULTI-COURSE-RAG-EXPANSION-1 — INGESTION-1 Baseline Validation Diagnostic

**Act:** `ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.INGESTION-1.BASELINE-VALIDATION-DIAG-1`  
**Date:** 2026-09-20  
**Role:** Read-only baseline regression diagnostic  
**Authorization:** Owner-authorized diagnostic act. No repair was authorized or performed.

## Verdict

`DIAG_COMPLETE`

[VERIFIED] The 15 failures have one common root cause: five API-boundary test files construct conversation state at the fixed instant `2026-09-19T12:00:00.000Z`, while `handleChatRequest` obtains the current wall clock. Once the fixed state is at least 24 hours old, the intentional session-expiry path clears working state before the tested behavior runs.

Evidence:

```text
Observed UTC: 2026-09-20T21:53:20Z
Fixture UTC:  2026-09-19T12:00:00Z
Elapsed:      33.888888888888886 hours
TTL:          24 hours
Direct freshness probe:
  expired: true
  selectedCourseId: null
  courseMatch: UNKNOWN
  activeFlow: null
  deferredRequest: null
  lastAssistant: null
  staleReference.previousCourseId: maslow
```

[VERIFIED] This is a time-sensitive test-harness/fixture defect (`HARNESS_CONFIGURATION`), not a demonstrated product regression. The production 24-hour expiry behavior is operating as written and is independently covered by explicit-time tests.

Evidence:

```text
node --import /tmp/academy-baseline-validation-diag-1/freeze-system-clock.mjs \
  --import tsx --test <five affected files>
# tests 80
# pass 80
# fail 0
exit 0

NODE_OPTIONS='--import=/tmp/academy-baseline-validation-diag-1/freeze-system-clock.mjs' npm test
# tests 546
# pass 546
# fail 0
exit 0
```

## Baseline

[VERIFIED] Repository baseline after `git fetch origin`:

```text
root: /Users/entp_psyche/Desktop/InvestProjects2026/structural-typology-navigator
branch: navigator-production-dialogue-corr2-ab-normalization
HEAD:        85a3ff68998a14c829f409061659a767ab42a1be
origin/main: 85a3ff68998a14c829f409061659a767ab42a1be
remote main: 85a3ff68998a14c829f409061659a767ab42a1be
ahead/behind: 0 / 0
tracked drift: none
staged paths: none
```

[VERIFIED] The only pre-existing worktree entries were the declared unrelated untracked inputs:

```text
?? AGENTS.md
?? docs/governance/navigator/2026-09-18-live-supabase/NAVIGATOR_PRODUCTION_DIALOGUE_CORR2_CHANGE_CONTROL_v1.1_PRO_RESEARCH_2026-09-19.md
?? docs/governance/navigator/2026-09-18-live-supabase/NAVIGATOR_PRODUCTION_DIALOGUE_CORR2_CHANGE_CONTROL_v1.2_EXECUTION_GOVERNANCE_2026-09-19.md
?? docs/governance/navigator/2026-09-18-live-supabase/NAVIGATOR_PRODUCTION_DIALOGUE_CORR2_R0_REGRESSION_FREEZE_1_CLOSURE_2026-09-19.zip
```

## Closure commit

[VERIFIED] Commit `85a3ff6` is documentation-only. It added eight Markdown reports and changed no executable, test, package, configuration, SQL, migration, or corpus file.

Evidence:

```text
85a3ff6 docs: close multi-course canonical corpus
8 files changed, 1555 insertions(+)
All eight paths are docs/*.md
```

Therefore commit `85a3ff6` did not introduce the executable test behavior.

## Validation chain

[VERIFIED] `package.json` defines:

```text
validate: npm run typecheck && npm test && npm run lint && npm run build
typecheck: next typegen && tsc --noEmit
test: node --import tsx --test tests/**/*.test.mts
lint: eslint --max-warnings=0
build: next build
```

[VERIFIED] The observed run completed `next typegen` and `tsc --noEmit`, then stopped at the failing Node test command because the chain uses `&&`. Lint and build were not reached.

[VERIFIED] No separate test configuration or setup file is present. The Node built-in test runner loads TypeScript through `tsx`. The five affected files contain no `beforeEach`, `afterEach`, mock-reset hook, `dotenv`, environment loader, or global fixture import. Their API calls use the route’s real system clock unless the call bypasses the API and supplies `nowMs` explicitly.

## Environment comparison

[VERIFIED] Presence-only check:

```text
SUPABASE_URL: YES
SUPABASE_SECRET_KEY: YES
COHERE_API_KEY: YES
```

No secret value was printed.

| Run | Tests | Pass | Fail | Exit | Failure names |
|---|---:|---:|---:|---:|---|
| Current agent environment | 546 | 531 | 15 | 1 | Exact set below |
| Only the three production variables unset | 546 | 531 | 15 | 1 | Identical exact set |

[VERIFIED] Removing all three variables together changed neither the totals nor any failing test name. Only run durations differed.

| Variable | Observed effect |
|---|---|
| `SUPABASE_URL` | No effect detected in the collective-unset comparison |
| `SUPABASE_SECRET_KEY` | No effect detected in the collective-unset comparison |
| `COHERE_API_KEY` | No effect detected in the collective-unset comparison |

[INFERRED] Individual one-variable runs are unnecessary because the required collective removal produced no behavioral delta. Premise: both logs contain the identical 15 `not ok` names and identical `546/531/15` totals.

## Exact failure inventory

All failures are `AssertionError` / `ERR_ASSERTION` / strict equality failures.

| # | Test file | Full test name | Expected | Actual | Stack location | Directly implicated symbol/state |
|---:|---|---|---|---|---|---|
| 1 | `tests/navigation/conversation-corr2-boundaries.test.mts` | `F1: the wire does not route an ordinary message past an open confirmation` | HTTP `200` | HTTP `500` | `apiRespond`, line 769; test line 776 | expired `pendingConfirmation`/`deferredRequest` causes routing instead of deterministic response |
| 2 | same | `F3: an overflow at the wire keeps the stored remainder and a valid state` | `filler(4000)`, exactly 4,000 chars from repeated `мотивациякоманды` | `null` | line 826 | expired `deferredRequest` |
| 3 | `tests/navigation/failure-capture.test.mts` | `B-F3: a material technical failure produces a bounded failure candidate` | `COURSE_FOLLOW_UP` | `null` | line 194 | expired `activeFlow`; emitted `QualitySignal.flowId` |
| 4 | `tests/navigation/package-b-regression.test.mts` | `HARD-2: repair phrases never create a course-selection route` | `REPAIR_RESTATE` | `REPAIR_UNAVAILABLE` | line 208 | expired `lastAssistant` removes repair context |
| 5 | same | `HARD-3: a direct human request hands off instead of looping` | `maslow` | `null` | line 242 | expired `selectedCourseId`; emitted `HandoffContext.courseId` |
| 6 | same | `R08: repair of the prior clarification answer, without unrelated routing` | `REPAIR_RESTATE` | `REPAIR_UNAVAILABLE` | line 274 | expired `lastAssistant` removes repair context |
| 7 | same | `R16: exhausted clarification changes strategy and offers human help` | HTTP `200` | HTTP `503` | `success`, line 97; test line 280 | expired `clarification` and `lastAssistant`; request reaches injected rejecting orchestrator |
| 8 | same | `R28: a failing semantic resolver preserves deterministic state for retry` | `maslow` | `null` | line 384 | expired `selectedCourseId` before technical preservation |
| 9 | same | `R33: handoff after a course-selection discussion carries the goal, not the transcript` | `maslow` | `null` | line 493 | expired `selectedCourseId`; emitted `HandoffContext.courseId` |
| 10 | same | `R34: 'не помогло' is captured as a quality signal, not an out-of-scope answer` | `NAVIGATE` | `null` | line 528 | expired `lastAssistant`; emitted `QualitySignal.lastAssistantAct` |
| 11 | `tests/navigation/package-d-regression.test.mts` | `R04 through the API: the mode switch round-trips and leaves the session intact` | `maslow` | `null` | line 817 | expired `selectedCourseId` |
| 12 | `tests/navigation/technical-error.test.mts` | `B-E1: a provider timeout selects the technical lane with a retryable class` | `maslow` | `null` | `failedTurn`, line 131; test line 148 | expired `selectedCourseId` before technical preservation |
| 13 | same | `B-E2: a provider configuration failure is classified and not retryable` | `maslow` | `null` | `failedTurn`, line 131; test line 193 | expired `selectedCourseId` before technical preservation |
| 14 | same | `B-E3: a throwing semantic resolver is a technical failure, never a semantic verdict` | `maslow` | `null` | line 242 | expired `selectedCourseId` before technical preservation |
| 15 | same | `B-E4: a data-access failure is classified as a data failure` | `maslow` | `null` | `failedTurn`, line 131; test line 249 | expired `selectedCourseId` before technical preservation |

Count: **15**.

## Independent-file rerun matrix

| Test file | Tests | Pass | Fail | Exit | Same failures as full suite? |
|---|---:|---:|---:|---:|---|
| `conversation-corr2-boundaries.test.mts` | 38 | 36 | 2 | 1 | Yes |
| `failure-capture.test.mts` | 8 | 7 | 1 | 1 | Yes |
| `package-b-regression.test.mts` | 12 | 5 | 7 | 1 | Yes |
| `package-d-regression.test.mts` | 14 | 13 | 1 | 1 | Yes |
| `technical-error.test.mts` | 8 | 4 | 4 | 1 | Yes |

[VERIFIED] Each file fails independently with its same subset. No full-suite order dependency or cross-file state leakage was observed.

## Root-cause clusters

### RC-1 — fixed fixture time crosses the production TTL

**Classification:** `HARNESS_CONFIGURATION`  
**Affected tests:** all 15 inventory rows  
**Confidence:** HIGH

[VERIFIED] Five files define the same fixed fixture instant:

```text
tests/navigation/conversation-corr2-boundaries.test.mts:45
tests/navigation/failure-capture.test.mts:31
tests/navigation/package-b-regression.test.mts:36
tests/navigation/package-d-regression.test.mts:79
tests/navigation/technical-error.test.mts:35
const T0 = Date.parse("2026-09-19T12:00:00.000Z");
```

[VERIFIED] The production call chain is:

```text
src/app/api/chat/route.ts:282
  handleChatRequest -> systemSessionClock.now()

src/app/api/chat/route.ts:317-325
  handleChatRequest -> prepareConversationTurn(..., nowMs)

src/lib/navigation/conversation-control-kernel.ts:367-375
  resolveConversationControl -> applySessionFreshness(state, nowMs)

src/lib/navigation/conversation-state.ts:1283-1302
  elapsed >= SESSION_CONTEXT_TTL_MS -> clearWorkingState(state)

src/lib/navigation/conversation-state.ts:592-600
  clearWorkingState -> initial working values while preserving lifecycle and timestamp
```

[VERIFIED] `SESSION_CONTEXT_TTL_MS` is exactly `24 * 60 * 60 * 1000` at `conversation-state.ts:20-21`.

**Causal chain:**

1. Each failing test creates state with `lastActivityAt = T0` through `createInitialConversationState(T0)`.
2. The test sends that state through `POST` or `handleChatRequest` without an injected clock.
3. `handleChatRequest` reads the real current time.
4. `applySessionFreshness` calculates an age greater than the 24-hour TTL.
5. `clearWorkingState` intentionally clears `selectedCourseId`, `courseMatch`, `activeFlow`, `clarification`, `deferredRequest`, `lastAssistant`, repair/handoff working state, and related values.
6. Each assertion then sees the correct expired-session result rather than the fresh-session premise encoded by the test name and expectation.

**Competing hypotheses tested:**

- Production credential contamination: rejected; collective removal of all three variables produced the identical failures.
- Full-suite state leakage/order dependence: rejected; all five files reproduced their failures independently.
- Product state-preservation regression: rejected for this failure set; freezing only the wall clock inside the fresh interval makes all 546 tests pass without changing product code.

## Null-state trace

### `maslow` becomes `null`

[VERIFIED] The expected value is first created in test fixtures as `selectedCourseId: "maslow"`, backed by `courseMatch: "MATCHED"`—for example `technical-error.test.mts:74-93` and `package-d-regression.test.mts:98-103`.

[VERIFIED] It is not lost during JSON parsing or state normalization. `normalizeConversationStatePayload` reads and validates it at `conversation-state.ts:1007-1029` and returns it at lines `1239-1257`.

[VERIFIED] It first becomes unavailable when `applySessionFreshness` reaches the expired branch at `conversation-state.ts:1283-1302`. `clearWorkingState` rebuilds initial working state, whose `selectedCourseId` is `null` and `courseMatch` is `UNKNOWN` (`conversation-state.ts:567-589`). The old value is retained only as `staleReference.previousCourseId`.

### `NAVIGATE` becomes `null`

[VERIFIED] `R34` first creates `lastAssistant.act = "NAVIGATE"` at `package-b-regression.test.mts:512-519`.

[VERIFIED] The expiry branch clears `lastAssistant`. The later quality-signal builder therefore has no prior assistant act and emits `lastAssistantAct: null`, observed at the assertion on line 528.

## Git causal analysis

[VERIFIED] Commit `9d76a720de76752a7d9904945d0840dfdbc51537` (`feat: add Package A conversation control kernel`, 2026-09-19 15:26:34 -0300) introduced together:

- the 24-hour TTL;
- `systemSessionClock`;
- `applySessionFreshness` and its state-clearing path;
- the fixed `T0` in `conversation-corr2-boundaries.test.mts`.

[VERIFIED] Commit `fb2403590ab26fa320ac2aa7e85643c925c2c767` (`feat: add Package B repair error handoff`, 2026-09-19 15:27:44 -0300) introduced the fixed `T0` plus API-boundary calls in:

- `failure-capture.test.mts`;
- `package-b-regression.test.mts`;
- `technical-error.test.mts`.

[VERIFIED] Commit `101c87b9c223cbd55e3dd01e3a9f100911ecb355` (`feat: add Package D public UX contract`, 2026-09-20 00:26:37 -0300) introduced the same fixed `T0` plus API-boundary calls in `package-d-regression.test.mts`.

[INFERRED] These are the introducing commits for the time-sensitive test defect because `git blame` assigns the implicated fixture lines to those commits, and the failure activates mechanically only after the fixture timestamp crosses the already-intended TTL. This is stronger than chronology alone: the frozen-clock counterfactual returns the full suite to 546/546.

[UNKNOWN] No GitHub PR/ticket context was retrieved. `gh auth status` reports that the configured token for account `Inposibl` is invalid. Git history and direct source evidence are sufficient for the causal determination, but no PR discussion is claimed.

## Corrective scope

**Problem scale:** `LOCAL`  
**Root causes:** 1  
**Schema/database/runtime work:** none  
**Production-code change required:** no  
**Test change required:** yes

[INFERRED] The smallest safe correction is five test-file fixture edits, one `T0` definition per file, so API-boundary states are created relative to the test process’s current clock instead of a calendar-fixed instant:

1. `tests/navigation/conversation-corr2-boundaries.test.mts` — `T0`
2. `tests/navigation/failure-capture.test.mts` — `T0`
3. `tests/navigation/package-b-regression.test.mts` — `T0`
4. `tests/navigation/package-d-regression.test.mts` — `T0`
5. `tests/navigation/technical-error.test.mts` — `T0`

Recommended implementation shape: replace the calendar-fixed `Date.parse(...)` base with a per-process current base such as `Date.now()`. Explicit TTL tests remain deterministic because they assert relative offsets from `T0`; API-boundary tests remain inside the intended fresh-session interval.

Rough repair steps:

1. Change the five `T0` definitions only.
2. Run each affected file independently.
3. Run current-environment `npm run validate`.
4. Run sanitized-child `npm run validate` as a regression check.
5. Confirm zero non-test drift.

Expected changed files: **5 test files**. No application, package, config, SQL, migration, corpus, provenance, or environment file should change.

## Ingestion safety decision

### A. Can INGESTION-1 resume now?

**No.** [VERIFIED] The mandatory gate currently exits 1 with 15 failures. The failures do not establish an ingestion defect, but the controlling gate is mechanically unsatisfied.

### B. Are the failures unrelated to ingestion but still a gate violation?

**Yes.** [VERIFIED] The failures are in navigation test fixtures and are caused by session-clock aging. They remain failures of the repository-wide mandatory validation command.

### C. Could the mandatory gate safely be waived?

**Technically defensible but not recommended.** [INFERRED] Evidence is unusually strong that the product code is not regressing: all 546 tests pass when the single wall-clock mismatch is neutralized. The residual risks of waiver are that lint and build were never reached in the normal chain, and the repository would still carry a date-triggered red baseline. Only the Owner may waive the gate.

### D. Is sanitized validation while retaining parent credentials viable?

**Not as a solution to this failure.** [VERIFIED] Sanitizing the three production variables leaves the same 15 failures. A sanitized child remains operationally possible, but it does not satisfy the gate until the test-clock defect is corrected or the clock is separately controlled.

## Proposed next act

```text
ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.INGESTION-1.BASELINE-VALIDATION-CORR-1
```

Exact write scope:

```text
tests/navigation/conversation-corr2-boundaries.test.mts :: T0
tests/navigation/failure-capture.test.mts :: T0
tests/navigation/package-b-regression.test.mts :: T0
tests/navigation/package-d-regression.test.mts :: T0
tests/navigation/technical-error.test.mts :: T0
```

No production source change is recommended for this correction.

## Production and forbidden-action check

```text
Supabase calls: NONE
Storage calls: NONE
Cohere calls: NONE
Ingestion: NONE
Database mutation: NONE
.env.local modification: NONE
Application-code edits: NONE
Test edits: NONE
Package/config edits: NONE
SQL/migration edits: NONE
Canonical/provenance edits: NONE
Git staging: NONE
Commit: NONE
Push: NONE
Deployment: NONE
```

## Diagnostic artifacts

All temporary artifacts are under `/tmp/academy-baseline-validation-diag-1/`, including:

```text
validate-current-env.log
validate-current-env.exit
validate-production-env-unset.log
validate-production-env-unset.exit
individual-*.log
individual-*.exit
freeze-system-clock.mjs
affected-files-frozen-clock.log
affected-files-frozen-clock.exit
full-suite-frozen-clock.log
full-suite-frozen-clock.exit
```

No temporary worktree was created.
