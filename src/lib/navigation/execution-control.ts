/**
 * Package-B A22 execution control.
 *
 * This is the strongest truthful protection available in this architecture, and
 * its limits are stated rather than papered over:
 *
 *   - in-flight: the production client coalesces a second submission while a
 *     request is outstanding, so one user gesture can never produce two
 *     outbound chat requests;
 *   - identity: each submission carries an opaque request identity, which the
 *     API validates and the server uses to recognise a replay of a completed
 *     request;
 *   - state: an execution state handed back as the baseline of a new turn is
 *     always idle, so a contradictory in-progress payload fails closed.
 *
 * It is NOT a distributed idempotency guarantee. There is no shared durable
 * server-side lock, and no cross-instance locking is faked in process memory.
 * Consequential transactional actions remain responsible for their own
 * idempotency in the authority layer that owns them.
 */

import type { ExecutionPhase } from "./conversation-state.ts";

/** The client's own view of whether a turn is executing. */
export type ClientExecutionState = {
  phase: ExecutionPhase;
  requestId: string | null;
};

export const IDLE_EXECUTION: ClientExecutionState = {
  phase: "IDLE",
  requestId: null,
};

export type SubmissionOutcome =
  | {
      status: "ACCEPTED";
      execution: ClientExecutionState;
      requestId: string;
      text: string;
    }
  | { status: "COALESCED"; execution: ClientExecutionState }
  | { status: "EMPTY"; execution: ClientExecutionState };

export function isExecutionInProgress(state: ClientExecutionState): boolean {
  return state.phase === "IN_PROGRESS";
}

/**
 * Decides one submission and, when it is accepted, reserves the client for it.
 *
 * A second submission while a request is outstanding is coalesced: it issues no
 * request and it does not clear the draft, so unrelated text the user typed
 * while waiting is neither executed twice nor silently discarded.
 */
export function submitExecution(
  state: ClientExecutionState,
  draft: string,
  nextRequestId: () => string,
): SubmissionOutcome {
  if (isExecutionInProgress(state)) {
    return { status: "COALESCED", execution: state };
  }

  const text = draft.trim();
  if (text.length === 0) {
    return { status: "EMPTY", execution: state };
  }

  const requestId = nextRequestId();

  return {
    status: "ACCEPTED",
    execution: { phase: "IN_PROGRESS", requestId },
    requestId,
    text,
  };
}

/**
 * Releases the client after a turn settles. Both outcomes release it, so a
 * failed turn never leaves the interface permanently busy and a retry is always
 * possible.
 */
export function completeExecution(
  state: ClientExecutionState,
  requestId: string,
): ClientExecutionState {
  if (state.requestId !== requestId) return state;

  return IDLE_EXECUTION;
}

/**
 * Opaque request identity for one submission. It is an equality token for
 * replay detection, never a secret and never business data.
 */
export function createClientRequestId(): string {
  const source = globalThis.crypto;

  if (source !== undefined && typeof source.randomUUID === "function") {
    return source.randomUUID().replace(/[^A-Za-z0-9_-]/gu, "");
  }

  return `req-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
