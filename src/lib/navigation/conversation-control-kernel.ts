/**
 * Package-A/Package-B deterministic conversation-control kernel.
 *
 * The kernel runs ahead of the existing conversation-act router and owns the
 * conversational-control lanes only. Semantic precedence (controlling v1.2 §6,
 * with the Package-B lanes in their controlling positions):
 *
 *   0. duplicate / replay protection for an already completed request (A22)
 *   1. restart / cancel / close / stale-reference
 *   2. restatement, repair, challenge and frustration signals (A05)
 *   3. ADDRESS_SETUP and the existing profile controls
 *   4. direct human handoff and its acceptance (A23)
 *   5. clarification exhaustion changes strategy and offers human help (A23)
 *   6. pending-confirmation resolution
 *   7. resume / skip
 *   8. remaining substantive text continues to the existing router
 *
 * While a confirmation is unresolved it also gates lanes 7 and 8: ordinary
 * substantive text is preserved rather than routed, and a queued remainder is
 * never promoted, until the confirmation is resolved or cleared by a
 * higher-priority control (CORR2-A).
 *
 * Whatever the kernel returns as RESPOND therefore never reaches the
 * conversation-act router and can never fall through to META or OUT_OF_SCOPE.
 *
 * The kernel makes no model/provider call and consults no commercial
 * authority: it reads the current course catalog only to render the title of a
 * course that the structured state already references.
 */

import type { ConversationProfile } from "../chat-contract.ts";
import { getAcademyCourse } from "../academy/course-catalog.ts";
import { ACADEMY_COMMERCIAL_AUTHORITY_VERSION } from "../academy/commercial-authority.ts";
import {
  composeEnrollmentPaymentAnswer,
  paymentActionForCourse,
} from "../academy/payment-policy.ts";
import {
  applyConversationProfileControl,
  isConversationResetRequest,
} from "./conversation-profile-control.ts";
import {
  advanceConversationProfile,
  createEmptyConversationProfile,
  INITIAL_ADDRESS_PROMPT,
  isConversationProfileComplete,
} from "./conversation-profile.ts";
import {
  detectStaleReferenceLanguage,
  scanControls,
  type ControlToken,
} from "./conversation-control-phrases.ts";
import {
  advanceRepairState,
  detectRepairSignal,
} from "./conversation-repair.ts";
import {
  detectContactPreference,
  detectHandoffAcceptance,
  detectHandoffRequest,
  offerHandoff,
  prepareHandoff,
  composeHandoffContextText,
  type HandoffPreparation,
} from "./handoff.ts";
import {
  buildFeedbackSignal,
} from "./failure-capture.ts";
import {
  CLARIFICATION_BUDGET,
  applySessionFreshness,
  appendQualitySignal,
  cancelCurrentFlow,
  closeConversation,
  composeEffectiveRouteRequest,
  createInitialConversationState,
  isClarificationExhausted,
  reopenConversation,
  resumeSuspendedFlow,
  appendDeferredRequest,
  withActiveFlow,
  withActivity,
  withClarification,
  withCompletedExecution,
  withCourseBinding,
  withHandoff,
  withLastAssistant,
  withPendingConfirmation,
  withTechnicalError,
  type ConversationFlowId,
  type ConversationState,
  type HandoffReason,
  type HandoffState,
  type LastAssistantAct,
} from "./conversation-state.ts";
import {
  composeCancelFlowAnswer,
  composeConversationCloseAnswer,
  composeDeferredCapacityRejectedAnswer,
  composeDeferredRequestAnswer,
  composeDuplicateRequestAnswer,
  composeExpiredContextAnswer,
  composeHandoffOfferedAnswer,
  composeHandoffReadyAnswer,
  composePaymentCourseChangeDeclinedAnswer,
  composeRepairChallengeAnswer,
  composeRepairClarifyAnswer,
  composeRepairRestateAnswer,
  composeRepairUnavailableAnswer,
  composeResumeFlowAnswer,
  composeRestatementUnavailableAnswer,
  composeSkipAnswer,
  composeStaleReferenceConfirmationAnswer,
  composeStaleReferenceConfirmedAnswer,
  composeStaleReferenceDeclinedAnswer,
  composeUnsupportedAddressModeAnswer,
  restateAssistantContent,
  type DeferredCapacityNoticeScope,
  type RestatementKind,
} from "./conversation-response.ts";

export type ConversationControlAct =
  | "RESTART"
  | "CONVERSATION_CLOSE"
  | "CANCEL_FLOW"
  | "STALE_REFERENCE_CONFIRMATION"
  | "REPEAT"
  | "REPHRASE"
  | "SIMPLIFY"
  | "REPAIR_RESTATE"
  | "REPAIR_CLARIFY"
  | "REPAIR_CHALLENGE"
  | "REPAIR_UNAVAILABLE"
  | "HANDOFF_OFFERED"
  | "HANDOFF_READY"
  | "DUPLICATE_REQUEST_SUPPRESSED"
  | "PROFILE_CONTROL"
  | "ADDRESS_SETUP"
  | "UNSUPPORTED_ADDRESS_MODE"
  | "PENDING_CONFIRMATION_RESOLVED"
  | "PAYMENT_CONFIRMATION"
  | "PAYMENT_CONFIRMATION_RESOLVED"
  | "RESUME_FLOW"
  | "SKIP"
  | "DEFERRED_NOT_ACCEPTED";

/**
 * Control acts that are themselves recorded as a last-assistant action. A
 * suppressed duplicate is deliberately not one of them: it re-presents the
 * recorded answer instead of replacing it.
 */
export type RecordedControlAct = Exclude<
  ConversationControlAct,
  "DUPLICATE_REQUEST_SUPPRESSED"
>;

export type ConversationKernelResult =
  | {
      state: "RESPOND";
      act: ConversationControlAct;
      profile: ConversationProfile;
      conversationState: ConversationState;
      message: string;
      resetConversation: boolean;
    }
  | {
      state: "ROUTE";
      profile: ConversationProfile;
      conversationState: ConversationState;
      request: string;
    };

export type ConversationKernelInput = {
  profile: ConversationProfile;
  conversationState?: ConversationState;
  userText: string;
  nowMs: number;
  /** Opaque identity of the request being served (A22). */
  requestId?: string | null;
};

function has(controls: readonly ControlToken[], token: ControlToken): boolean {
  return controls.includes(token);
}

/** Cancellation is only meaningful when something is actually in flight (A17). */
function cancelContextClear(state: ConversationState): boolean {
  return (
    state.activeFlow !== null ||
    state.suspendedFlow !== null ||
    state.clarification !== null ||
    state.pendingConfirmation !== null ||
    state.selectedCourseId !== null ||
    state.courseMatch !== "UNKNOWN"
  );
}

/** Skip/decline is only meaningful while a question is actually outstanding (A16). */
function skipContextClear(state: ConversationState): boolean {
  return (
    state.activeFlow?.pendingQuestion != null ||
    state.suspendedFlow?.pendingQuestion != null ||
    state.clarification !== null ||
    state.pendingConfirmation !== null
  );
}

function restatementKind(
  controls: readonly ControlToken[],
): RestatementKind | null {
  if (has(controls, "SIMPLIFY")) return "SIMPLIFY";
  if (has(controls, "REPHRASE")) return "REPHRASE";
  if (has(controls, "REPEAT")) return "REPEAT";
  return null;
}

/** Control acts that are not themselves last-assistant action identities. */
function lastAssistantActFor(act: RecordedControlAct): LastAssistantAct {
  switch (act) {
    case "PENDING_CONFIRMATION_RESOLVED":
      return "STALE_REFERENCE_CONFIRMATION";
    case "PAYMENT_CONFIRMATION_RESOLVED":
      return "PAYMENT";
    case "UNSUPPORTED_ADDRESS_MODE":
      return "ADDRESS_SETUP";
    default:
      return act;
  }
}

function confirmationControlAct(
  state: ConversationState,
): "STALE_REFERENCE_CONFIRMATION" | "PAYMENT_CONFIRMATION" {
  return state.pendingConfirmation?.kind === "PAYMENT_COURSE_CHANGE"
    ? "PAYMENT_CONFIRMATION"
    : "STALE_REFERENCE_CONFIRMATION";
}

function respond(
  act: RecordedControlAct,
  profile: ConversationProfile,
  conversationState: ConversationState,
  message: string,
  options: { resetConversation?: boolean } = {},
): ConversationKernelResult {
  // The control turn completed, so a recorded technical failure is superseded
  // deterministically (A21).
  const settled = withTechnicalError(conversationState, null);

  return {
    state: "RESPOND",
    act,
    profile,
    conversationState: withLastAssistant(settled, {
      act: lastAssistantActFor(act),
      content: message,
      courseId: settled.selectedCourseId,
    }),
    message,
    resetConversation: options.resetConversation ?? false,
  };
}

/**
 * Preserves substantive text that a control turn did not consume, so it is
 * neither silently discarded nor reported as consumed (A19). The remainder is
 * stated back to the user in one bounded neutral sentence and queued in the
 * structured state until normal routing consumes it.
 *
 * The capture outcome decides the wording: a remainder that was not stored must
 * never be reported as saved, and an already acknowledged one stays untouched.
 */
function respondPreservingRemainder(
  act: RecordedControlAct,
  profile: ConversationProfile,
  baseState: ConversationState,
  baseMessage: string,
  remainder: string | null,
): ConversationKernelResult {
  if (remainder === null) {
    return respond(act, profile, baseState, baseMessage);
  }

  const capture = appendDeferredRequest(baseState, remainder);

  const notice =
    capture.status === "ACCEPTED"
      ? composeDeferredRequestAnswer(remainder, profile)
      : composeDeferredCapacityRejectedAnswer(
          capacityNoticeScope(baseState),
          profile,
        );

  return respond(act, profile, capture.state, `${baseMessage}\n\n${notice}`);
}

/** Whether a rejected remainder has to report on an earlier stored one. */
function capacityNoticeScope(
  state: ConversationState,
): DeferredCapacityNoticeScope {
  return state.deferredRequest === null ? "STANDALONE" : "ALONGSIDE_STORED";
}

/**
 * Prepares a READY handoff and renders its summary from the same preparation,
 * so the message and the stored context can never disagree (A23/A24).
 */
function readyHandoff(
  state: ConversationState,
  preparation: HandoffPreparation,
): { handoff: HandoffState; contextText: string } {
  const handoff = prepareHandoff(state, preparation);

  return {
    handoff,
    contextText:
      handoff.context === null
        ? ""
        : composeHandoffContextText(handoff.context),
  };
}

/**
 * Hands control to the normal routing path (A19).
 *
 * A queued remainder is promoted into this turn's effective user request, ahead
 * of the turn's own text, so neither the preserved promise nor the new message
 * is lost. The queued value is deliberately left in the state: only a turn that
 * actually completed normal routing clears it, so a technical failure cannot
 * silently consume a remainder the user was told was preserved.
 */
function routeResult(
  profile: ConversationProfile,
  state: ConversationState,
  request: string,
): ConversationKernelResult {
  const composed = composeEffectiveRouteRequest(state.deferredRequest, request);

  if (composed.status === "ACCEPTED") {
    return {
      state: "ROUTE",
      profile,
      conversationState: state,
      request: composed.request,
    };
  }

  // Past the bound the synthetic request cannot be formed without shortening
  // user content, so nothing is routed and the stored remainder is left exactly
  // as it was. Both pieces are individually bounded, so this is reachable only
  // from a state the API boundary would already have rejected.
  return respond(
    "DEFERRED_NOT_ACCEPTED",
    profile,
    state,
    composeDeferredCapacityRejectedAnswer(capacityNoticeScope(state), profile),
  );
}

function resolveConversationControl(
  input: ConversationKernelInput,
): ConversationKernelResult {
  const nowMs = input.nowMs;
  const profile = input.profile;
  const requestId = input.requestId ?? null;

  // A28 — 24h inactivity boundary. Profile fields are not part of this state,
  // so displayName / nameDeclined / TY-VY survive expiry by construction.
  const freshness = applySessionFreshness(
    input.conversationState ?? createInitialConversationState(nowMs),
    nowMs,
  );
  // Every turn stamps activity, so an active conversation never crosses the
  // 24h boundary merely because it has been running for longer than 24h.
  let state = withActivity(freshness.state, nowMs);

  const text = input.userText.trim();
  const setupOpen = !isConversationProfileComplete(profile);
  const scan = scanControls(text, {
    confirmationPending: state.pendingConfirmation !== null,
    addressSetupOpen: setupOpen,
  });
  const { controls, remainder } = scan;

  // ---------------------------------------------------------------------
  // 0. A22 duplicate / replay protection outranks every conversational act.
  //
  // The state proves this identity already completed, so the turn is answered
  // from the record instead of being executed again as a fresh action.
  // ---------------------------------------------------------------------

  if (
    requestId !== null &&
    state.execution.lastCompletedRequestId === requestId
  ) {
    return {
      state: "RESPOND",
      act: "DUPLICATE_REQUEST_SUPPRESSED",
      profile,
      conversationState: withCompletedExecution(state, requestId),
      message:
        state.lastAssistant?.content ?? composeDuplicateRequestAnswer(profile),
      resetConversation: false,
    };
  }

  // ---------------------------------------------------------------------
  // 1. Session controls: restart, close, cancel, stale reference.
  // ---------------------------------------------------------------------

  if (isConversationResetRequest(text)) {
    return {
      state: "RESPOND",
      act: "RESTART",
      profile: createEmptyConversationProfile(),
      conversationState: createInitialConversationState(nowMs),
      message: INITIAL_ADDRESS_PROMPT,
      resetConversation: true,
    };
  }

  // A closed conversation reopens on any non-close message, so the user is
  // never trapped after saying goodbye.
  if (state.lifecycle === "CLOSED" && !has(controls, "CLOSE")) {
    state = reopenConversation(state);
  }

  if (has(controls, "CLOSE") && state.lifecycle === "OPEN") {
    return respond(
      "CONVERSATION_CLOSE",
      profile,
      closeConversation(state, nowMs),
      composeConversationCloseAnswer(profile),
    );
  }

  if (has(controls, "CANCEL_FLOW") && cancelContextClear(state)) {
    return respondPreservingRemainder(
      "CANCEL_FLOW",
      profile,
      cancelCurrentFlow(state),
      composeCancelFlowAnswer(profile),
      remainder,
    );
  }

  // A28 — a referential phrase after the TTL boundary is never resolved
  // against the expired context. The old referent may only be offered back as a
  // confirmation candidate.
  if (state.staleReference !== null && detectStaleReferenceLanguage(text)) {
    const pending = state.pendingConfirmation;

    if (pending !== null && pending.kind === "STALE_COURSE_REFERENCE") {
      // The question is already outstanding; restate it rather than letting a
      // repeated stale reference fall through to ordinary routing.
      return respond(
        confirmationControlAct(state),
        profile,
        state,
        pending.prompt,
      );
    }

    const previousCourseId = state.staleReference.previousCourseId;

    if (previousCourseId !== null) {
      const course = getAcademyCourse(previousCourseId);

      if (course) {
        const prompt = composeStaleReferenceConfirmationAnswer(
          course.title,
          profile,
        );

        return respond(
          "STALE_REFERENCE_CONFIRMATION",
          profile,
          withPendingConfirmation(state, {
            confirmationKey: `stale-course:${course.id}`,
            kind: "STALE_COURSE_REFERENCE",
            prompt,
            candidateCourseId: course.id,
          }),
          prompt,
        );
      }
    }

    return respond(
      "STALE_REFERENCE_CONFIRMATION",
      profile,
      state,
      composeExpiredContextAnswer(profile),
    );
  }

  // ---------------------------------------------------------------------
  // 2. Restatement controls: repeat / rephrase / simplify (A20).
  // ---------------------------------------------------------------------

  const restatement = restatementKind(controls);

  if (restatement !== null && (state.lastAssistant !== null || !setupOpen)) {
    if (state.lastAssistant === null) {
      return respond(
        restatement,
        profile,
        state,
        composeRestatementUnavailableAnswer(profile),
      );
    }

    // Restatement transforms already-returned public content only. It never
    // re-routes, never re-selects a course, and never changes navigation state.
    let message = restateAssistantContent(
      state.lastAssistant.content,
      restatement,
    );
    let nextState = state;

    if (has(controls, "RESUME") && state.suspendedFlow !== null) {
      message = `${message}\n\n${composeResumeFlowAnswer(
        state.suspendedFlow.pendingQuestion,
        profile,
      )}`;
      nextState = resumeSuspendedFlow(state);
    }

    return respondPreservingRemainder(
      restatement,
      profile,
      nextState,
      message,
      remainder,
    );
  }

  // ---------------------------------------------------------------------
  // 2a. Repair, challenge and frustration signals (A05).
  //
  // These are signals about the previous assistant answer, not fresh business
  // intents, so they are resolved here and never reach ordinary routing.
  // ---------------------------------------------------------------------

  const repairSignal = detectRepairSignal(text);

  if (repairSignal !== null) {
    const advance = advanceRepairState({ state, signal: repairSignal });

    // A clear frustration, or the second failure for the same repair issue,
    // offers human help instead of another attempt (A23).
    if (repairSignal.frustration || advance.thresholdReached) {
      const reason: HandoffReason = repairSignal.frustration
        ? "FRUSTRATION"
        : "REPEATED_REPAIR_FAILURE";

      let nextState = advance.state;

      if (nextState.handoff.status === "NONE") {
        nextState = withHandoff(nextState, offerHandoff(reason));
      }

      nextState = appendQualitySignal(
        nextState,
        buildFeedbackSignal({
          state: nextState,
          trigger: repairSignal.kind,
          requestId,
          nowMs,
          repairOffered: false,
          handoffOffered: true,
        }),
      );

      return respondPreservingRemainder(
        "HANDOFF_OFFERED",
        profile,
        nextState,
        composeHandoffOfferedAnswer(
          profile,
          nextState.handoff.reason ?? reason,
        ),
        repairSignal.remainder,
      );
    }

    if (repairSignal.kind === "FRUSTRATION") {
      // Not reachable: a frustration signal always takes the offer lane above.
      throw new Error("Unreachable frustration lane.");
    }

    // With nothing recorded there is nothing to repair, so the honest answer
    // says so and offers the bounded next step instead of inventing one (A05).
    if (state.lastAssistant === null) {
      const nextState = appendQualitySignal(
        withHandoff(advance.state, offerHandoff("REPAIR_CONTEXT_UNAVAILABLE")),
        buildFeedbackSignal({
          state: advance.state,
          trigger: repairSignal.kind,
          requestId,
          nowMs,
          repairOffered: false,
          handoffOffered: true,
        }),
      );

      return respondPreservingRemainder(
        "REPAIR_UNAVAILABLE",
        profile,
        nextState,
        composeRepairUnavailableAnswer(profile),
        repairSignal.remainder,
      );
    }

    const prior = state.lastAssistant;

    const message =
      repairSignal.kind === "REPAIR_RESTATE"
        ? composeRepairRestateAnswer(prior, profile)
        : repairSignal.kind === "REPAIR_CLARIFY"
          ? composeRepairClarifyAnswer(prior, profile)
          : composeRepairChallengeAnswer(prior, profile);

    return respondPreservingRemainder(
      repairSignal.kind,
      profile,
      appendQualitySignal(
        advance.state,
        buildFeedbackSignal({
          state: advance.state,
          trigger: repairSignal.kind,
          requestId,
          nowMs,
          repairOffered: true,
          handoffOffered: false,
        }),
      ),
      message,
      repairSignal.remainder,
    );
  }

  // ---------------------------------------------------------------------
  // 3. ADDRESS_SETUP and the existing profile controls.
  // ---------------------------------------------------------------------

  if (setupOpen && scan.unsupportedAddressModeWord !== null) {
    // The counter is scoped to the unsupported-mode issue, and the wording
    // changes with it, so repeated invalid input never re-emits the same
    // initial prompt indefinitely.
    const issueKey = `address-mode:${scan.unsupportedAddressModeWord}`;
    const priorAttempts =
      state.clarification?.issueKey === issueKey
        ? state.clarification.attempts
        : 0;

    return respond(
      "UNSUPPORTED_ADDRESS_MODE",
      profile,
      withClarification(state, {
        issueKey,
        attempts: Math.min(priorAttempts + 1, CLARIFICATION_BUDGET),
        strategyKey: `address-mode-${priorAttempts}`,
      }),
      composeUnsupportedAddressModeAnswer(priorAttempts, CLARIFICATION_BUDGET),
    );
  }

  const profileControl = applyConversationProfileControl(profile, text);

  if (profileControl.handled) {
    return respond(
      "PROFILE_CONTROL",
      profileControl.profile,
      profileControl.resetConversation
        ? createInitialConversationState(nowMs)
        : state,
      profileControl.message,
      { resetConversation: profileControl.resetConversation },
    );
  }

  if (setupOpen) {
    const setup = advanceConversationProfile(profile, text);

    if (!setup.complete || setup.effectiveUserRequest === null) {
      return respond(
        "ADDRESS_SETUP",
        setup.profile,
        state,
        setup.response ?? "Скажите, пожалуйста, как к вам обращаться.",
      );
    }

    // The setup lane completes, but an unresolved confirmation still outranks
    // ordinary routing (CORR2-A): the request it produced is preserved instead.
    if (state.pendingConfirmation !== null) {
      return respondPreservingRemainder(
        confirmationControlAct(state),
        setup.profile,
        state,
        state.pendingConfirmation.prompt,
        setup.effectiveUserRequest,
      );
    }

    return routeResult(
      setup.profile,
      withClarification(state, null),
      setup.effectiveUserRequest,
    );
  }

  // ---------------------------------------------------------------------
  // 3a. Human handoff (A23). A direct request and the acceptance of an
  // outstanding offer both outrank pending confirmation and ordinary routing.
  // ---------------------------------------------------------------------

  const handoffRequest = detectHandoffRequest(text);

  if (handoffRequest !== null) {
    const ready = readyHandoff(state, {
      reason: "DIRECT_REQUEST",
      contactPreference: detectContactPreference(text),
    });

    return respondPreservingRemainder(
      "HANDOFF_READY",
      profile,
      withHandoff(state, ready.handoff),
      composeHandoffReadyAnswer(ready.contextText),
      handoffRequest.remainder,
    );
  }

  // Accepting an outstanding offer is only recognised while no confirmation is
  // pending, because a bare yes/no belongs to the confirmation when one is open.
  if (
    state.handoff.status === "OFFERED" &&
    state.pendingConfirmation === null &&
    detectHandoffAcceptance(text)
  ) {
    const ready = readyHandoff(state, {
      reason: state.handoff.reason ?? "FRUSTRATION",
    });

    return respond(
      "HANDOFF_READY",
      profile,
      withHandoff(state, ready.handoff),
      composeHandoffReadyAnswer(ready.contextText),
    );
  }

  // ---------------------------------------------------------------------
  // 3b. Exhausted clarification changes strategy (A23/A14): offer human help
  // once. The clarification resource itself is never reset here, and the offer
  // is one-shot, so the user is not trapped in the offer either.
  // ---------------------------------------------------------------------

  if (
    state.handoff.status === "NONE" &&
    isClarificationExhausted(state.clarification)
  ) {
    return respondPreservingRemainder(
      "HANDOFF_OFFERED",
      profile,
      withHandoff(state, offerHandoff("CLARIFICATION_EXHAUSTED")),
      composeHandoffOfferedAnswer(profile, "CLARIFICATION_EXHAUSTED"),
      remainder,
    );
  }

  // ---------------------------------------------------------------------
  // 4. Pending material confirmation resolution (A18).
  // ---------------------------------------------------------------------

  const confirmation = state.pendingConfirmation;
  const answeredYes = has(controls, "CONFIRM_YES");
  const answeredNo = has(controls, "CONFIRM_NO");

  if (confirmation !== null && (answeredYes || answeredNo)) {
    if (confirmation.kind === "PAYMENT_COURSE_CHANGE") {
      const candidate = confirmation.candidateCourseId;
      const requestedCourse = candidate === null ? null : getAcademyCourse(candidate);

      if (answeredYes && requestedCourse && requestedCourse.status === "ROUTABLE") {
        return respondPreservingRemainder(
          "PAYMENT_CONFIRMATION_RESOLVED",
          profile,
          {
            ...withPendingConfirmation(
              withCourseBinding(state, "MATCHED", requestedCourse.id),
              null,
            ),
            transactionalAuthorityVersion:
              ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
          },
          composeEnrollmentPaymentAnswer(
            paymentActionForCourse(
              requestedCourse.id as Parameters<typeof paymentActionForCourse>[0],
            ),
          ),
          remainder,
        );
      }

      const currentTitle = state.selectedCourseId === null
        ? null
        : getAcademyCourse(state.selectedCourseId)?.title ?? null;
      return respondPreservingRemainder(
        "PAYMENT_CONFIRMATION_RESOLVED",
        profile,
        withPendingConfirmation(state, null),
        currentTitle === null
          ? composeStaleReferenceDeclinedAnswer(profile)
          : composePaymentCourseChangeDeclinedAnswer(currentTitle),
        remainder,
      );
    }

    const course =
      answeredYes && confirmation.candidateCourseId !== null
        ? getAcademyCourse(confirmation.candidateCourseId)
        : null;

    if (course) {
      return respondPreservingRemainder(
        "PENDING_CONFIRMATION_RESOLVED",
        profile,
        withActiveFlow(
          {
            ...withPendingConfirmation(
              withCourseBinding(state, "MATCHED", course.id),
              null,
            ),
            staleReference: null,
          },
          { id: "COURSE_FOLLOW_UP", pendingQuestion: null },
        ),
        composeStaleReferenceConfirmedAnswer(course.title, profile),
        remainder,
      );
    }

    return respondPreservingRemainder(
      "PENDING_CONFIRMATION_RESOLVED",
      profile,
      {
        ...withPendingConfirmation(state, null),
        staleReference: null,
        courseMatch: "UNKNOWN",
        selectedCourseId: null,
      },
      composeStaleReferenceDeclinedAnswer(profile),
      remainder,
    );
  }

  // ---------------------------------------------------------------------
  // 4a. An unresolved confirmation outranks ordinary routing (CORR2-A).
  // ---------------------------------------------------------------------

  // The confirmation exists precisely because the consequential state is not
  // resolved yet, so ordinary substantive text must not reach the router and a
  // queued remainder must not be promoted while it is open. The text is
  // preserved through the same bounded capture as any other control turn, and
  // the confirmation stays the outstanding gate.
  if (confirmation !== null) {
    return respondPreservingRemainder(
      confirmationControlAct(state),
      profile,
      state,
      confirmation.prompt,
      remainder ?? text,
    );
  }

  // ---------------------------------------------------------------------
  // 5. Resume / skip controls.
  // ---------------------------------------------------------------------

  if (has(controls, "RESUME") && state.suspendedFlow !== null) {
    return respondPreservingRemainder(
      "RESUME_FLOW",
      profile,
      resumeSuspendedFlow(state),
      composeResumeFlowAnswer(state.suspendedFlow.pendingQuestion, profile),
      remainder,
    );
  }

  if (has(controls, "SKIP") && skipContextClear(state)) {
    return respondPreservingRemainder(
      "SKIP",
      profile,
      {
        ...state,
        activeFlow: state.activeFlow
          ? { ...state.activeFlow, pendingQuestion: null }
          : null,
        clarification: null,
      },
      composeSkipAnswer(profile),
      remainder,
    );
  }

  // ---------------------------------------------------------------------
  // 6. Ordinary message continues to the existing conversation-act router.
  // ---------------------------------------------------------------------

  return routeResult(profile, state, remainder ?? text);
}

/**
 * Resolves one turn through the deterministic control kernel.
 *
 * A resolved control turn completes synchronously, so its request identity is
 * marked completed here and the session stays idle (A22). A routed turn is
 * deliberately left untouched: only a turn whose orchestration actually
 * completed may claim completion, so a technical failure cannot be mistaken for
 * a finished request and a retry of the same identity re-executes.
 */
export function applyConversationControlKernel(
  input: ConversationKernelInput,
): ConversationKernelResult {
  const result = resolveConversationControl(input);

  if (result.state !== "RESPOND") return result;

  return {
    ...result,
    conversationState: withCompletedExecution(
      result.conversationState,
      input.requestId ?? null,
    ),
  };
}

/**
 * Package-A flow identity for an orchestrated turn. The transport layer uses
 * this to keep an active flow while a supported digression is answered, and to
 * suspend it rather than erase it (A15).
 */
export function flowIdForConversationAct(
  act: "NAVIGATE" | "COURSE_FOLLOW_UP" | "META" | "OUT_OF_SCOPE" | "ACADEMY_CONTACT",
): ConversationFlowId | null {
  switch (act) {
    case "NAVIGATE":
      return "COURSE_SELECTION";
    case "COURSE_FOLLOW_UP":
      return "COURSE_FOLLOW_UP";
    case "ACADEMY_CONTACT":
      return "ACADEMY_CONTACT";
    default:
      return null;
  }
}
