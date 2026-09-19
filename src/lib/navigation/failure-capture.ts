/**
 * Package-B A25 quality signal and failure capture.
 *
 * A negative-feedback signal and a material technical failure are represented
 * as structured, bounded candidates with provenance, so the observability
 * package can later persist or aggregate them.
 *
 * Package B creates the candidate only. It performs no persistence and no cloud
 * mutation, stores no transcript, and copies no error message, stack frame,
 * token, or credential into the candidate: only the coarse classification, the
 * stage, and the structured conversation identity are recorded.
 */

import {
  type ConversationState,
  type QualitySignal,
  type QualitySignalType,
  type TechnicalErrorState,
} from "./conversation-state.ts";

/** Stage recorded for a signal observed by the deterministic control layer. */
export const CONVERSATION_CONTROL_STAGE = "CONVERSATION_CONTROL";

export type FeedbackSignalInput = {
  state: ConversationState;
  trigger: string;
  requestId: string | null;
  nowMs: number;
  repairOffered: boolean;
  handoffOffered: boolean;
};

function provenance(state: ConversationState, requestId: string | null) {
  return {
    lastAssistantAct: state.lastAssistant?.act ?? null,
    flowId: state.activeFlow?.id ?? state.suspendedFlow?.id ?? null,
    courseId: state.selectedCourseId ?? state.lastAssistant?.courseId ?? null,
    requestId,
  };
}

function occurredAt(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

function signal(
  input: {
    state: ConversationState;
    signalType: QualitySignalType;
    trigger: string;
    stage: string;
    requestId: string | null;
    nowMs: number;
    repairOffered: boolean;
    handoffOffered: boolean;
  },
): QualitySignal {
  return {
    signalType: input.signalType,
    trigger: input.trigger,
    occurredAt: occurredAt(input.nowMs),
    stage: input.stage,
    ...provenance(input.state, input.requestId),
    repairOffered: input.repairOffered,
    handoffOffered: input.handoffOffered,
  };
}

/** A conversational negative signal: a failed repair or an explicit "не помогло". */
export function buildFeedbackSignal(
  input: FeedbackSignalInput,
): QualitySignal {
  return signal({
    state: input.state,
    signalType: "NEGATIVE_FEEDBACK",
    trigger: input.trigger,
    stage: CONVERSATION_CONTROL_STAGE,
    requestId: input.requestId,
    nowMs: input.nowMs,
    repairOffered: input.repairOffered,
    handoffOffered: input.handoffOffered,
  });
}

export type MaterialFailureSignalInput = {
  state: ConversationState;
  technicalError: TechnicalErrorState;
  requestId: string | null;
  nowMs: number;
};

/** A material technical failure: eligible for the production failure corpus. */
export function buildMaterialFailureSignal(
  input: MaterialFailureSignalInput,
): QualitySignal {
  return signal({
    state: input.state,
    signalType: "MATERIAL_FAILURE",
    trigger: input.technicalError.failureClass,
    stage: input.technicalError.stage,
    requestId: input.requestId,
    nowMs: input.nowMs,
    repairOffered: false,
    handoffOffered: false,
  });
}
