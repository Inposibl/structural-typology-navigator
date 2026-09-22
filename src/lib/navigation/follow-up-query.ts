import type { ConversationMessage } from "../chat-contract.ts";

/**
 * CORR3.CONVERSATION-REPAIR-AND-FOLLOWUP-1 (D2) — clarified follow-up query.
 *
 * A semantic course-content follow-up may arrive as a narrowing/correction of a
 * prior question ("я имею в виду именно субъект-объектные отношения", "я
 * спросила именно про язык субъект-объектных отношений"). The discourse lead-in
 * ("я имею в виду", "я спросила именно про") states intent, not content: passing
 * it verbatim to course retrieval and evidence selection buries the substantive
 * question under meta-noise, so an otherwise grounded answer can drop to the
 * factual ceiling.
 *
 * This reformulation resolves discourse intent from the conversation and returns
 * the substantive question that retrieval/selection should run on. It strips the
 * narrowing lead-in to recover the substantive text, and — when the residue is
 * only a bare referent ("это", "то") — falls back to the most recent substantive
 * prior user turn. It reads ONLY user turns (never assistant prose, which must
 * not become evidence) and returns the latest message unchanged for an ordinary
 * follow-up that carries no narrowing lead-in.
 */

const NARROWING_LEAD_IN =
  /^(?:да[,!.\s]+|нет[,!.\s]+|ну[,!.\s]+)*(?:я\s+(?:имею\s+в\s+виду|имел[а]?\s+в\s+виду|спрашивал[а]?|спросил[а]?|говорил[а]?|писал[а]?|уточняю|уточнял[а]?|повтор(?:ю|яю))|меня\s+интересует|мой\s+вопрос(?:\s+был)?|вопрос\s+был)\s*(?:именно\s+)?(?:(?:про|о|об|обо|насч[её]т|в\s+том[,\s]+что)\s+)?[:,\-—]?\s*/iu;

const THIN_RESIDUE =
  /^(?:это|то|оно|такое|тот|та|те|этот|эта|эти|его|её|ее)[.!?…]*$/iu;

function isUserTurn(message: ConversationMessage): boolean {
  return message.role === "user";
}

function priorSubstantiveUserQuestion(
  userTurns: readonly ConversationMessage[],
): string | null {
  for (let index = userTurns.length - 2; index >= 0; index -= 1) {
    const content = userTurns[index].content.trim();
    if (content.length >= 8 && !NARROWING_LEAD_IN.test(content)) {
      return content;
    }
  }
  return null;
}

export function formulateFollowUpContentQuery(
  messages: readonly ConversationMessage[],
): string {
  const userTurns = messages.filter(isUserTurn);
  const latest = userTurns.at(-1)?.content?.trim() ?? "";
  if (latest.length === 0) {
    return latest;
  }

  const stripped = latest.replace(NARROWING_LEAD_IN, "").trim();

  // No narrowing lead-in, or stripping left nothing: keep the message verbatim so
  // ordinary single-turn follow-ups are unchanged.
  if (stripped === latest || stripped.length === 0) {
    return latest;
  }

  // A bare referent carries no content of its own — recover the topic from the
  // most recent substantive prior user turn.
  if (THIN_RESIDUE.test(stripped)) {
    return priorSubstantiveUserQuestion(userTurns) ?? latest;
  }

  return stripped;
}
