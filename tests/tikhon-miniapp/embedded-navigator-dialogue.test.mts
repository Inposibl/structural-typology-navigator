/*
TIKHON-NAVIGATOR-EMBEDDED-DIALOGUE-1.IMPLEMENTATION-1
Focused author tests for the Tikhon course-detail Navigator adapter.
*/

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getAcademyCourse } from "../../src/lib/academy/course-catalog.ts";
import { composeCourseFactualCeilingAnswer, getAcademyManagerContactCard } from "../../src/lib/academy/contact-policy.ts";
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CONVERSATION_MESSAGES,
} from "../../src/lib/chat-contract.ts";
import { validateConversationActDecision } from "../../src/lib/navigation/conversation-act-router.ts";
import { applyConversationControlKernel } from "../../src/lib/navigation/conversation-control-kernel.ts";
import {
  INITIAL_ADDRESS_PROMPT,
  isConversationProfileComplete,
} from "../../src/lib/navigation/conversation-profile.ts";
import { createInitialConversationState } from "../../src/lib/navigation/conversation-state.ts";
import {
  applyEmbeddedNavigatorFailure,
  applyEmbeddedNavigatorSuccess,
  buildEmbeddedResetOpening,
  buildNavigatorCourseOpening,
  createEmbeddedNavigatorProfile,
  decideNavigatorEntry,
  EMBEDDED_NAVIGATOR_MAX_BODY_BYTES,
  embeddedNavigatorExitGeneration,
  interpretNavigatorChatResponse,
  listMappedTikhonCourseIds,
  malformedNavigatorFailure,
  navigatorChatBodyByteLength,
  NAVIGATOR_ASK_LABEL,
  NAVIGATOR_EXIT_LABEL,
  NAVIGATOR_PENDING_LABEL,
  NAVIGATOR_RETRY_LABEL,
  NAVIGATOR_SEND_LABEL,
  NAVIGATOR_UNAVAILABLE_COPY,
  openEmbeddedNavigatorDialogue,
  resolveTikhonNavigatorCourse,
  retryEmbeddedNavigatorTurn,
  submitEmbeddedNavigatorTurn,
  TIKHON_NAVIGATOR_COURSE_IDS,
  type EmbeddedDialogueSession,
  type EmbeddedNavigatorSuccess,
} from "../../src/app/tikhon-miniapp-pilot/helpers.ts";

const cssLoaderSource = `const STUB_SOURCE = "const stub = new Proxy({}, { get: () => 'nav-css-stub' });\\nexport default stub;";
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "nav-css-stub:" + encodeURIComponent(specifier), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (url.startsWith("nav-css-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
const cssLoaderDir = fs.mkdtempSync(path.join(os.tmpdir(), "nav-css-loader-"));
const cssLoaderFile = path.join(cssLoaderDir, "css-stub-loader.mjs");
fs.writeFileSync(cssLoaderFile, cssLoaderSource);
register(pathToFileURL(cssLoaderFile));

const ROOT = process.cwd();
const QUESTION = "Какое центральное понятие разбирается на этом курсе?";
const FOLLOW_UP = "Приведите один пример из материалов.";
const NOW_MS = 1_700_000_000_000;
const CURRENT_TIKHON_COURSE_IDS = [
  "structural_typology",
  "levels_of_consciousness",
  "maslow",
  "normative_situation",
  "play_and_creativity",
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function courseNamed(courseId: string, contents: readonly string[]): boolean {
  const course = getAcademyCourse(courseId);
  assert.ok(course, courseId);
  return contents.some(
    (content) =>
      content.includes(course.title) ||
      (course.url !== null && content.includes(course.url)),
  );
}

function accepted(
  session: EmbeddedDialogueSession,
  draft: string,
  requestId: string,
) {
  const decision = submitEmbeddedNavigatorTurn(session, draft, requestId);
  assert.equal(decision.status, "ACCEPTED");
  if (decision.status !== "ACCEPTED") {
    throw new Error("unreachable");
  }
  return decision;
}

function successPayload(
  message: string,
  profile = createEmbeddedNavigatorProfile(),
  conversationState = createInitialConversationState(NOW_MS),
  contactCard: unknown = null,
): unknown {
  return {
    message,
    profile,
    conversationState,
    contactCard,
    resetConversation: false,
  };
}

describe("Tikhon embedded Navigator dialogue", () => {
  test("maps all five current Tikhon courses explicitly", () => {
    assert.deepEqual(listMappedTikhonCourseIds(), [...CURRENT_TIKHON_COURSE_IDS]);

    const helpers = read("src/app/tikhon-miniapp-pilot/helpers.ts");
    const start = helpers.indexOf("export function resolveTikhonNavigatorCourse");
    const end = helpers.indexOf("export function decideNavigatorEntry");
    const resolver = helpers.slice(start, end);
    assert.equal(resolver.includes(".replace("), false);
    assert.equal(resolver.includes('split("_")'), false);

    const unroutable = getAcademyCourse("professional-development-stages");
    assert.ok(unroutable);
    assert.equal(resolveTikhonNavigatorCourse("professional_development_stages"), null);
    assert.equal(decideNavigatorEntry("professional_development_stages"), "unavailable");
    assert.equal(resolveTikhonNavigatorCourse("levels-of-consciousness"), null);
    assert.equal(resolveTikhonNavigatorCourse("not_a_course"), null);
    assert.equal(openEmbeddedNavigatorDialogue("not_a_course"), null);

    for (const tikhonCourseId of CURRENT_TIKHON_COURSE_IDS) {
      const resolved = resolveTikhonNavigatorCourse(tikhonCourseId);
      assert.ok(resolved);
      assert.equal(
        resolved.navigatorCourseId,
        TIKHON_NAVIGATOR_COURSE_IDS[tikhonCourseId],
      );
      const catalog = getAcademyCourse(resolved.navigatorCourseId);
      assert.ok(catalog);
      assert.equal(catalog.status, "ROUTABLE");
      assert.equal(resolved.title, catalog.title);
      assert.equal(resolved.url, catalog.url);
      assert.equal(decideNavigatorEntry(tikhonCourseId), "open");
    }
  });

  test("opening profile skips name and address setup for every course", () => {
    const profile = createEmbeddedNavigatorProfile();
    assert.deepEqual(profile, {
      displayName: null,
      addressMode: "VY",
      nameDeclined: true,
      pendingUserRequest: null,
    });
    assert.equal(isConversationProfileComplete(profile), true);
    assert.equal(INITIAL_ADDRESS_PROMPT.includes("Как вас зовут"), false);

    for (const tikhonCourseId of CURRENT_TIKHON_COURSE_IDS) {
      const session = openEmbeddedNavigatorDialogue(tikhonCourseId);
      assert.ok(session);
      assert.equal(session.conversationState, null);
      assert.equal(session.messages.length, 1);
      assert.equal(session.messages[0]?.role, "assistant");
      const opening = session.messages[0]?.content ?? "";
      assert.equal(opening, buildNavigatorCourseOpening(session.canonicalTitle));
      assert.equal(opening.includes(session.canonicalTitle), true);
      assert.equal(opening.includes("http"), false);
      assert.equal(opening.includes("Как вас зовут"), false);
      assert.equal(opening.includes(INITIAL_ADDRESS_PROMPT), false);
      assert.equal(opening.includes("как к вам обращаться"), false);

      const kernel = applyConversationControlKernel({
        profile: session.profile,
        conversationState: createInitialConversationState(NOW_MS),
        userText: QUESTION,
        nowMs: NOW_MS,
        requestId: "req-open",
      });
      assert.equal(kernel.state, "ROUTE");
      if (kernel.state === "ROUTE") {
        assert.equal(kernel.request.includes("центральное понятие"), true);
        assert.equal(kernel.request.includes("Как вас зовут"), false);
        assert.equal(kernel.request.includes("как к вам обращаться"), false);
        assert.equal(kernel.profile.addressMode, "VY");
        assert.equal(kernel.profile.nameDeclined, true);
        assert.equal(kernel.profile.displayName, null);
      }
    }
  });

  test("first user question carries only that course context", () => {
    const routableIds = [
      "structural-typology",
      "levels-of-consciousness",
      "maslow",
      "normative-situation",
      "play-and-creativity",
    ];

    for (const tikhonCourseId of CURRENT_TIKHON_COURSE_IDS) {
      const session = openEmbeddedNavigatorDialogue(tikhonCourseId);
      assert.ok(session);
      const snapshot = JSON.stringify(session);
      const decision = accepted(session, QUESTION, "req-1");
      assert.equal(JSON.stringify(session), snapshot);
      assert.equal("conversationState" in decision.body, false);
      assert.deepEqual(Object.keys(decision.body).sort(), [
        "messages",
        "profile",
        "requestId",
      ]);
      assert.equal(decision.body.requestId, "req-1");
      assert.deepEqual(decision.body.profile, session.profile);
      assert.equal(decision.body.messages.at(-1)?.role, "user");
      assert.equal(decision.body.messages.at(-1)?.content, QUESTION);
      assert.equal(decision.body.messages[0]?.role, "assistant");
      assert.ok(
        courseNamed(
          session.navigatorCourseId,
          decision.body.messages.map((message) => message.content),
        ),
      );
      for (const otherId of routableIds) {
        if (otherId === session.navigatorCourseId) continue;
        assert.equal(
          courseNamed(
            otherId,
            decision.body.messages.map((message) => message.content),
          ),
          false,
          otherId,
        );
      }
      const serialized = JSON.stringify(decision.body);
      assert.equal(serialized.includes('"courseId"'), false);
      assert.equal(serialized.includes("initData"), false);
      assert.equal(serialized.includes("subject_key"), false);
      assert.equal(serialized.includes("paid_options"), false);
      assert.equal(serialized.includes("role\":\"system\""), false);
      assert.equal(decision.body.messages.every((message) => message.role === "user" || message.role === "assistant"), true);
    }
  });

  test("second turn sends the returned profile and conversationState", () => {
    const session = openEmbeddedNavigatorDialogue("structural_typology");
    assert.ok(session);
    const first = accepted(session, QUESTION, "req-1");
    const returnedProfile = {
      displayName: null,
      addressMode: "TY" as const,
      nameDeclined: true,
      pendingUserRequest: null,
    };
    const interpreted = interpretNavigatorChatResponse(
      true,
      JSON.parse(JSON.stringify(successPayload(
        "Короткий ответ по материалам курса.",
        returnedProfile,
      ))),
      first.session.profile,
      NOW_MS,
    );
    assert.equal(interpreted.ok, true);
    if (!interpreted.ok) return;
    const stateBefore = JSON.stringify(interpreted.success.conversationState);
    Object.freeze(interpreted.success.conversationState);
    const continued = applyEmbeddedNavigatorSuccess(
      first.session,
      first.session.generation,
      { generation: first.session.generation, requestId: "req-1" },
      interpreted.success,
    );
    assert.notEqual(continued, "IGNORED");
    if (continued === "IGNORED") return;
    assert.equal(continued.phase, "ready");
    assert.equal(continued.profile.addressMode, "TY");
    assert.equal(continued.conversationState, interpreted.success.conversationState);
    assert.equal(JSON.stringify(interpreted.success.conversationState), stateBefore);
    assert.equal(continued.tikhonCourseId, "structural_typology");

    const second = accepted(continued, FOLLOW_UP, "req-2");
    assert.equal(second.body.profile.addressMode, "TY");
    assert.equal(second.body.conversationState, continued.conversationState);
    assert.deepEqual(Object.keys(second.body).sort(), [
      "conversationState",
      "messages",
      "profile",
      "requestId",
    ]);
    assert.equal(second.body.messages.at(-1)?.content, FOLLOW_UP);
    assert.equal(second.body.messages[0]?.content.includes(continued.canonicalTitle), true);
    const kernel = applyConversationControlKernel({
      profile: second.body.profile,
      conversationState: second.body.conversationState,
      userText: FOLLOW_UP,
      nowMs: NOW_MS,
      requestId: "req-2",
    });
    assert.equal(kernel.state, "ROUTE");
  });

  test("exit invalidates a late response and the next opening is clean", () => {
    const session = openEmbeddedNavigatorDialogue("maslow");
    assert.ok(session);
    const pending = accepted(session, QUESTION, "req-late");
    const late = "LATE_RESPONSE_MUST_NOT_APPEAR";
    const success: EmbeddedNavigatorSuccess = {
      message: late,
      profile: createEmbeddedNavigatorProfile(),
      conversationState: createInitialConversationState(NOW_MS),
      resetConversation: false,
    };
    const ignored = applyEmbeddedNavigatorSuccess(
      pending.session,
      embeddedNavigatorExitGeneration(pending.session.generation),
      { generation: pending.session.generation, requestId: "req-late" },
      success,
    );
    assert.equal(ignored, "IGNORED");
    assert.equal(pending.session.phase, "pending");
    assert.equal(pending.session.messages.some((message) => message.content === late), false);
    const wrongId = applyEmbeddedNavigatorSuccess(
      pending.session,
      pending.session.generation,
      { generation: pending.session.generation, requestId: "req-other" },
      success,
    );
    assert.equal(wrongId, "IGNORED");
    const reopened = openEmbeddedNavigatorDialogue("maslow");
    assert.ok(reopened);
    assert.equal(reopened.messages.some((message) => message.content === late), false);
    assert.equal(reopened.conversationState, null);
    assert.equal(reopened.tikhonCourseId, "maslow");
  });

  test("network, timeout, http, and malformed failures stay retryable without inventing an answer", () => {
    const session = openEmbeddedNavigatorDialogue("normative_situation");
    assert.ok(session);
    const pending = accepted(session, QUESTION, "req-fail");
    const turn = { generation: pending.session.generation, requestId: "req-fail" };

    const network = applyEmbeddedNavigatorFailure(
      pending.session,
      pending.session.generation,
      turn,
      {
        kind: "network",
        message: "Не удалось получить ответ Навигатора. Попробуйте ещё раз.",
        retryable: true,
        conversationState: null,
      },
    );
    assert.notEqual(network, "IGNORED");
    if (network === "IGNORED") return;
    assert.equal(network.phase, "error");
    assert.equal(network.errorRetryable, true);
    assert.equal(network.profile, pending.session.profile);
    assert.equal(network.conversationState, null);
    assert.equal(network.messages.at(-1)?.content, QUESTION);
    assert.equal(network.messages.some((message) => message.role === "assistant" && message.id !== "opening"), false);
    const retry = retryEmbeddedNavigatorTurn(network, "req-retry");
    assert.equal(retry.status, "ACCEPTED");
    if (retry.status !== "ACCEPTED") return;
    assert.equal(retry.body.requestId, "req-retry");
    assert.equal(retry.body.messages.filter((message) => message.role === "user").length, 1);

    const preserved = createInitialConversationState(NOW_MS);
    const http = interpretNavigatorChatResponse(
      false,
      {
        error: {
          code: "NAVIGATOR_TECHNICAL_ERROR",
          message: "Сервис временно недоступен.",
          retryable: true,
          conversationState: preserved,
        },
      },
      network.profile,
      NOW_MS,
    );
    assert.equal(http.ok, false);
    if (http.ok) return;
    assert.equal(http.failure.kind, "http");
    assert.equal(http.failure.message, "Сервис временно недоступен.");
    assert.equal(http.failure.retryable, true);
    assert.ok(http.failure.conversationState);

    const stack = interpretNavigatorChatResponse(
      false,
      {
        error: {
          code: "NAVIGATOR_TECHNICAL_ERROR",
          message: "TypeError: x\n    at foo (/app/src/lib/foo.ts:1:1)",
          retryable: false,
        },
      },
      network.profile,
      NOW_MS,
    );
    assert.equal(stack.ok, false);
    if (stack.ok) return;
    assert.equal(stack.failure.message.includes("TypeError"), false);
    assert.equal(stack.failure.message.includes("foo.ts"), false);
    assert.equal(stack.failure.retryable, false);
    assert.equal(stack.failure.conversationState, null);

    const malformed = interpretNavigatorChatResponse(
      true,
      { message: "не ответ", profile: { displayName: 1 } },
      network.profile,
      NOW_MS,
    );
    assert.equal(malformed.ok, false);
    if (malformed.ok) return;
    assert.equal(malformed.failure.kind, "malformed");
    const afterMalformed = applyEmbeddedNavigatorFailure(
      pending.session,
      pending.session.generation,
      turn,
      malformed.failure,
    );
    assert.notEqual(afterMalformed, "IGNORED");
    if (afterMalformed === "IGNORED") return;
    assert.equal(afterMalformed.messages.some((message) => message.content === "не ответ"), false);
    assert.equal(afterMalformed.conversationState, pending.session.conversationState);
    assert.equal(afterMalformed.profile, pending.session.profile);
  });

  test("factual ceiling is a normal assistant answer and dialogue stays open", () => {
    const session = openEmbeddedNavigatorDialogue("play_and_creativity");
    assert.ok(session);
    const pending = accepted(session, QUESTION, "req-ceiling");
    const ceiling = composeCourseFactualCeilingAnswer(session.canonicalTitle);
    const card = getAcademyManagerContactCard();
    const interpreted = interpretNavigatorChatResponse(
      true,
      JSON.parse(JSON.stringify(successPayload(ceiling, session.profile, createInitialConversationState(NOW_MS), card))),
      session.profile,
      NOW_MS,
    );
    assert.equal(interpreted.ok, true);
    if (!interpreted.ok) return;
    const next = applyEmbeddedNavigatorSuccess(
      pending.session,
      pending.session.generation,
      { generation: pending.session.generation, requestId: "req-ceiling" },
      interpreted.success,
    );
    assert.notEqual(next, "IGNORED");
    if (next === "IGNORED") return;
    assert.equal(next.phase, "ready");
    assert.equal(next.errorMessage, null);
    assert.equal(next.messages.at(-1)?.role, "assistant");
    assert.equal(next.messages.at(-1)?.content, ceiling);
    const again = submitEmbeddedNavigatorTurn(next, FOLLOW_UP, "req-after-ceiling");
    assert.equal(again.status, "ACCEPTED");
  });

  test("reset restarts Navigator content without re-entering onboarding", () => {
    const resetText = "Начнём всё сначала";
    const routableIds = [
      "structural-typology",
      "levels-of-consciousness",
      "maslow",
      "normative-situation",
      "play-and-creativity",
    ];

    for (const tikhonCourseId of CURRENT_TIKHON_COURSE_IDS) {
      const opened = openEmbeddedNavigatorDialogue(tikhonCourseId);
      assert.ok(opened);
      const priorTurn = accepted(opened, QUESTION, `req-prior-${tikhonCourseId}`);
      const otherId = routableIds.find((id) => id !== opened.navigatorCourseId);
      assert.ok(otherId);
      const other = getAcademyCourse(otherId);
      assert.ok(other);
      const staleState = createInitialConversationState(NOW_MS - 3_600_000);
      const prior = interpretNavigatorChatResponse(
        true,
        successPayload(
          `Дополнительно смотрите курс «${other.title}».`,
          createEmbeddedNavigatorProfile(),
          staleState,
        ),
        priorTurn.session.profile,
        NOW_MS,
      );
      assert.equal(prior.ok, true);
      if (!prior.ok) return;
      const continued = applyEmbeddedNavigatorSuccess(
        priorTurn.session,
        priorTurn.session.generation,
        { generation: priorTurn.session.generation, requestId: priorTurn.requestId },
        prior.success,
      );
      assert.notEqual(continued, "IGNORED");
      if (continued === "IGNORED") return;
      assert.equal(
        continued.messages.some((message) => message.content.includes(other.title)),
        true,
      );

      const resetTurn = accepted(continued, resetText, `req-reset-${tikhonCourseId}`);
      assert.ok(resetTurn.body.conversationState);
      const produced = applyConversationControlKernel({
        profile: resetTurn.body.profile,
        conversationState: resetTurn.body.conversationState,
        userText: resetText,
        nowMs: NOW_MS,
        requestId: resetTurn.requestId,
      });
      assert.equal(produced.state, "RESPOND");
      if (produced.state !== "RESPOND") return;
      assert.equal(produced.act, "RESTART");
      assert.equal(produced.resetConversation, true);
      assert.equal(produced.message, "Хорошо, начнём сначала.");
      assert.deepEqual(produced.profile, resetTurn.body.profile);

      const interpreted = interpretNavigatorChatResponse(
        true,
        {
          message: produced.message,
          profile: produced.profile,
          conversationState: produced.conversationState,
          contactCard: null,
          resetConversation: produced.resetConversation,
        },
        resetTurn.session.profile,
        NOW_MS,
      );
      assert.equal(interpreted.ok, true);
      if (!interpreted.ok) return;
      const ignored = applyEmbeddedNavigatorSuccess(
        resetTurn.session,
        embeddedNavigatorExitGeneration(resetTurn.session.generation),
        { generation: resetTurn.session.generation, requestId: resetTurn.requestId },
        interpreted.success,
      );
      assert.equal(ignored, "IGNORED");
      assert.equal(resetTurn.session.phase, "pending");

      const next = applyEmbeddedNavigatorSuccess(
        resetTurn.session,
        resetTurn.session.generation,
        { generation: resetTurn.session.generation, requestId: resetTurn.requestId },
        interpreted.success,
      );
      assert.notEqual(next, "IGNORED");
      if (next === "IGNORED") return;

      assert.deepEqual(next.profile, {
        displayName: null,
        addressMode: "VY",
        nameDeclined: true,
        pendingUserRequest: null,
      });
      assert.equal(isConversationProfileComplete(next.profile), true);
      assert.equal(next.tikhonCourseId, tikhonCourseId);
      assert.equal(next.navigatorCourseId, opened.navigatorCourseId);
      assert.equal(next.messages.length, 1);
      assert.equal(next.messages[0]?.role, "assistant");
      assert.equal(
        next.messages[0]?.content,
        buildEmbeddedResetOpening(opened.canonicalTitle),
      );
      assert.equal(next.messages[0]?.content.includes(opened.canonicalTitle), true);
      assert.equal(next.messages[0]?.content.includes(INITIAL_ADDRESS_PROMPT), false);
      assert.equal(next.messages[0]?.content.includes("Как вас зовут"), false);
      assert.equal(next.messages[0]?.content.includes(other.title), false);
      assert.equal(next.messages.some((message) => message.content === QUESTION), false);
      assert.equal(next.messages.some((message) => message.role !== "assistant"), false);
      assert.equal(next.conversationState, interpreted.success.conversationState);
      assert.notEqual(
        JSON.stringify(next.conversationState),
        JSON.stringify(continued.conversationState),
      );
      assert.equal(next.phase, "ready");

      const follow = accepted(next, QUESTION, `req-next-${tikhonCourseId}`);
      assert.equal(follow.body.conversationState, next.conversationState);
      assert.deepEqual(follow.body.profile, next.profile);
      assert.equal(follow.body.messages[0]?.content, next.messages[0]?.content);
      assert.equal(follow.body.messages.at(-1)?.content, QUESTION);
      assert.equal(
        follow.body.messages.some(
          (message) => message.role !== "user" && message.role !== "assistant",
        ),
        false,
      );
      const contents = follow.body.messages.map((message) => message.content);
      assert.equal(courseNamed(opened.navigatorCourseId, contents), true);
      for (const id of routableIds) {
        if (id === opened.navigatorCourseId) continue;
        assert.equal(courseNamed(id, contents), false, id);
      }
      const serialized = JSON.stringify(follow.body);
      assert.equal(serialized.includes("initData"), false);
      assert.equal(serialized.includes('"role":"system"'), false);

      const routed = applyConversationControlKernel({
        profile: follow.body.profile,
        conversationState: follow.body.conversationState,
        userText: QUESTION,
        nowMs: NOW_MS,
        requestId: follow.requestId,
      });
      assert.equal(routed.state, "ROUTE");
      if (routed.state === "ROUTE") {
        assert.equal(routed.request.includes("центральное понятие"), true);
        assert.equal(routed.request.includes("Как вас зовут"), false);
        assert.equal(routed.profile.addressMode, "VY");
        assert.equal(routed.profile.nameDeclined, true);
        assert.equal(routed.profile.displayName, null);
      }

      const acceptedDecision = validateConversationActDecision(
        {
          state: "COURSE_FOLLOW_UP",
          courseId: opened.navigatorCourseId,
          evidenceRequested: false,
        },
        follow.body.messages,
      );
      assert.equal(acceptedDecision.state, "COURSE_FOLLOW_UP");
      if (acceptedDecision.state === "COURSE_FOLLOW_UP") {
        assert.equal(acceptedDecision.courseId, opened.navigatorCourseId);
      }
      assert.throws(() =>
        validateConversationActDecision(
          {
            state: "COURSE_FOLLOW_UP",
            courseId: otherId,
            evidenceRequested: false,
          },
          follow.body.messages,
        ),
      );
    }
  });

  test("history stays inside the chat contract", () => {
    const route = read("src/app/api/chat/route.ts");
    const declared = route.match(/const MAX_REQUEST_BYTES = (\d[\d_]*)/);
    assert.ok(declared);
    assert.equal(
      EMBEDDED_NAVIGATOR_MAX_BODY_BYTES,
      Number(declared[1].replaceAll("_", "")),
    );

    let session = openEmbeddedNavigatorDialogue("structural_typology");
    assert.ok(session);
    const title = session.canonicalTitle;
    for (let index = 0; index < 30; index += 1) {
      const decision = accepted(session, "я".repeat(3000), `req-long-${index}`);
      const interpreted = interpretNavigatorChatResponse(
        true,
        successPayload("Коротко."),
        decision.session.profile,
        NOW_MS,
      );
      assert.equal(interpreted.ok, true);
      if (!interpreted.ok) return;
      const next = applyEmbeddedNavigatorSuccess(
        decision.session,
        decision.session.generation,
        { generation: decision.session.generation, requestId: decision.requestId },
        interpreted.success,
      );
      assert.notEqual(next, "IGNORED");
      if (next === "IGNORED") return;
      session = next;
    }
    const last = accepted(session, QUESTION, "req-final");
    assert.ok(last.body.messages.length <= MAX_CONVERSATION_MESSAGES);
    assert.ok(last.body.messages.length < 61);
    assert.equal(last.body.messages[0]?.content.includes(title), true);
    assert.equal(last.body.messages.at(-1)?.content, QUESTION);
    assert.ok(last.body.messages.every((message) => message.content.length <= MAX_CHAT_MESSAGE_LENGTH));
    assert.ok(navigatorChatBodyByteLength(last.body) <= EMBEDDED_NAVIGATOR_MAX_BODY_BYTES);
    assert.equal(last.body.messages.some((message) => message.role !== "user" && message.role !== "assistant"), false);

    const tooLong = submitEmbeddedNavigatorTurn(
      openEmbeddedNavigatorDialogue("maslow")!,
      "я".repeat(MAX_CHAT_MESSAGE_LENGTH + 1),
      "req-too-long",
    );
    assert.equal(tooLong.status, "REJECTED");
    if (tooLong.status === "REJECTED") assert.equal(tooLong.reason, "too_long");

    const blocked = accepted(openEmbeddedNavigatorDialogue("maslow")!, QUESTION, "req-a");
    const second = submitEmbeddedNavigatorTurn(blocked.session, FOLLOW_UP, "req-b");
    assert.equal(second.status, "REJECTED");
    if (second.status === "REJECTED") assert.equal(second.reason, "pending");
  });

  test("course detail wires entry and exit without clearing the selected course", () => {
    const page = read("src/app/tikhon-miniapp-pilot/page.tsx");
    const dialogue = read("src/app/tikhon-miniapp-pilot/navigator-dialogue.tsx");
    assert.equal(page.includes("{NAVIGATOR_ASK_LABEL}"), true);
    assert.equal(page.includes("{NAVIGATOR_UNAVAILABLE_COPY}"), true);
    assert.equal(NAVIGATOR_ASK_LABEL, "Задать вопрос Навигатору");
    assert.equal(page.includes('onClick={openNavigatorDialogue}'), true);
    assert.equal(page.includes('setScreen("navigator_dialogue")'), true);
    assert.equal(page.includes('onExit={() => setScreen("detail")}'), true);
    assert.equal(page.includes('screen === "navigator_dialogue") setScreen("detail")'), true);
    assert.equal(page.includes("setSelectedCourseId(null)"), false);
    assert.equal(dialogue.includes('fetch("/api/chat"'), true);
    assert.equal(dialogue.includes('method: "POST"'), true);
    assert.equal(dialogue.includes("embeddedNavigatorExitGeneration"), true);
    assert.equal(dialogue.includes("applyEmbeddedNavigatorSuccess"), true);
    assert.equal(dialogue.includes("applyEmbeddedNavigatorFailure"), true);
    assert.equal(dialogue.includes("localStorage"), false);
    assert.equal(dialogue.includes("sessionStorage"), false);
    assert.equal(dialogue.includes('role: "system"'), false);
    assert.equal(dialogue.includes("initData"), false);
    assert.equal(dialogue.includes("studentStatus"), false);
    assert.equal(dialogue.includes("AcademyManagerCard"), false);
    assert.equal(malformedNavigatorFailure(createEmbeddedNavigatorProfile()).retryable, true);
  });

  test("same-origin chat classifies network, timeout, and malformed HTTP", async () => {
    const { postEmbeddedNavigatorChat } = await import(
      "../../src/app/tikhon-miniapp-pilot/navigator-dialogue.tsx"
    );
    const session = openEmbeddedNavigatorDialogue("maslow");
    assert.ok(session);
    const decision = accepted(session, QUESTION, "req-http");
    const previous = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new TypeError("offline");
      };
      const network = await postEmbeddedNavigatorChat(
        decision.body,
        new AbortController().signal,
        () => false,
      );
      assert.equal(network.ok, false);
      if (!network.ok) {
        assert.equal(network.failure.kind, "network");
        assert.equal(network.failure.retryable, true);
        assert.equal(network.failure.conversationState, null);
      }

      globalThis.fetch = async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      };
      const timeout = await postEmbeddedNavigatorChat(
        decision.body,
        new AbortController().signal,
        () => true,
      );
      assert.equal(timeout.ok, false);
      if (!timeout.ok) {
        assert.equal(timeout.failure.kind, "timeout");
        assert.equal(timeout.failure.retryable, true);
      }

      globalThis.fetch = async () => new Response("not-json", { status: 200 });
      const malformed = await postEmbeddedNavigatorChat(
        decision.body,
        new AbortController().signal,
        () => false,
      );
      assert.equal(malformed.ok, false);
      if (!malformed.ok) assert.equal(malformed.failure.kind, "malformed");
    } finally {
      globalThis.fetch = previous;
    }
  });

  test("dialogue view shows ready, pending, error, and exit", async () => {
    const { NavigatorDialogueView } = await import(
      "../../src/app/tikhon-miniapp-pilot/navigator-dialogue.tsx"
    );
    const session = openEmbeddedNavigatorDialogue("maslow");
    assert.ok(session);
    const ready = renderToStaticMarkup(
      createElement(NavigatorDialogueView, {
        session,
        draft: "",
        notice: null,
        onDraft: () => undefined,
        onSubmit: () => undefined,
        onRetry: () => undefined,
        onExit: () => undefined,
      }),
    );
    assert.equal(ready.includes(session.canonicalTitle), true);
    assert.equal(ready.includes(NAVIGATOR_SEND_LABEL), true);
    assert.equal(ready.includes(NAVIGATOR_EXIT_LABEL), true);
    assert.equal(ready.includes("Как вас зовут"), false);
    assert.equal(ready.includes(INITIAL_ADDRESS_PROMPT), false);
    assert.equal(ready.includes(NAVIGATOR_RETRY_LABEL), false);

    const pending = accepted(session, QUESTION, "req-view");
    const pendingHtml = renderToStaticMarkup(
      createElement(NavigatorDialogueView, {
        session: pending.session,
        draft: "",
        notice: null,
        onDraft: () => undefined,
        onSubmit: () => undefined,
        onRetry: () => undefined,
        onExit: () => undefined,
      }),
    );
    assert.equal(pendingHtml.includes(NAVIGATOR_PENDING_LABEL), true);
    assert.equal(pendingHtml.includes(NAVIGATOR_EXIT_LABEL), true);
    assert.equal(pendingHtml.includes("disabled"), true);

    const failed = applyEmbeddedNavigatorFailure(
      pending.session,
      pending.session.generation,
      { generation: pending.session.generation, requestId: "req-view" },
      {
        kind: "timeout",
        message: "Навигатор не ответил вовремя. Попробуйте ещё раз.",
        retryable: true,
        conversationState: null,
      },
    );
    assert.notEqual(failed, "IGNORED");
    if (failed === "IGNORED") return;
    const errorHtml = renderToStaticMarkup(
      createElement(NavigatorDialogueView, {
        session: failed,
        draft: "",
        notice: null,
        onDraft: () => undefined,
        onSubmit: () => undefined,
        onRetry: () => undefined,
        onExit: () => undefined,
      }),
    );
    assert.equal(errorHtml.includes("Навигатор не ответил вовремя."), true);
    assert.equal(errorHtml.includes(NAVIGATOR_RETRY_LABEL), true);
    assert.equal(errorHtml.includes(NAVIGATOR_EXIT_LABEL), true);
    assert.equal(errorHtml.includes(QUESTION), true);
    assert.equal(errorHtml.includes(NAVIGATOR_UNAVAILABLE_COPY), false);
  });
});
