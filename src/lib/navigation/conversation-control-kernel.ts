/**
 * Package-A deterministic conversation-control kernel.
 *
 * The kernel runs ahead of the existing conversation-act router and owns the
 * conversational-control lanes only. Semantic precedence (controlling v1.2 §6):
 *
 *   1. restart / cancel / close / stale-reference
 *   2. repeat / rephrase / simplify
 *   3. ADDRESS_SETUP and the existing profile controls
 *   4. pending-confirmation resolution
 *   5. resume / skip
 *   6. remaining substantive text continues to the existing router
 *
 * While a confirmation is unresolved it also gates lanes 5 and 6: ordinary
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
  CLARIFICATION_BUDGET,
  applySessionFreshness,
  cancelCurrentFlow,
  closeConversation,
  composeEffectiveRouteRequest,
  createInitialConversationState,
  reopenConversation,
  resumeSuspendedFlow,
  appendDeferredRequest,
  withActiveFlow,
  withActivity,
  withClarification,
  withCourseBinding,
  withLastAssistant,
  withPendingConfirmation,
  type ConversationFlowId,
  type ConversationState,
  type LastAssistantAct,
} from "./conversation-state.ts";
import {
  composeCancelFlowAnswer,
  composeConversationCloseAnswer,
  composeDeferredCapacityRejectedAnswer,
  composeDeferredRequestAnswer,
  composeExpiredContextAnswer,
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
  | "PROFILE_CONTROL"
  | "ADDRESS_SETUP"
  | "UNSUPPORTED_ADDRESS_MODE"
  | "PENDING_CONFIRMATION_RESOLVED"
  | "RESUME_FLOW"
  | "SKIP"
  | "DEFERRED_NOT_ACCEPTED";

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
function lastAssistantActFor(act: ConversationControlAct): LastAssistantAct {
  switch (act) {
    case "PENDING_CONFIRMATION_RESOLVED":
      return "STALE_REFERENCE_CONFIRMATION";
    case "UNSUPPORTED_ADDRESS_MODE":
      return "ADDRESS_SETUP";
    default:
      return act;
  }
}

function respond(
  act: ConversationControlAct,
  profile: ConversationProfile,
  conversationState: ConversationState,
  message: string,
  options: { resetConversation?: boolean } = {},
): ConversationKernelResult {
  return {
    state: "RESPOND",
    act,
    profile,
    conversationState: withLastAssistant(conversationState, {
      act: lastAssistantActFor(act),
      content: message,
      courseId: conversationState.selectedCourseId,
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
  act: ConversationControlAct,
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

export function applyConversationControlKernel(
  input: ConversationKernelInput,
): ConversationKernelResult {
  const nowMs = input.nowMs;
  const profile = input.profile;

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
        "STALE_REFERENCE_CONFIRMATION",
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
        "STALE_REFERENCE_CONFIRMATION",
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
  // 4. Pending material confirmation resolution (A18).
  // ---------------------------------------------------------------------

  const confirmation = state.pendingConfirmation;
  const answeredYes = has(controls, "CONFIRM_YES");
  const answeredNo = has(controls, "CONFIRM_NO");

  if (confirmation !== null && (answeredYes || answeredNo)) {
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
      "STALE_REFERENCE_CONFIRMATION",
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
