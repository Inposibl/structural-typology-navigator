export type MessageContentSegment =
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "link";
      value: string;
      href: string;
    };

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?\])}]+$/u;

export function tokenizeMessageContent(
  content: string,
): MessageContentSegment[] {
  const segments: MessageContentSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(HTTP_URL_PATTERN)) {
    const start = match.index;
    const raw = match[0];

    if (start > cursor) {
      segments.push({
        kind: "text",
        value: content.slice(cursor, start),
      });
    }

    const trailing =
      raw.match(TRAILING_PUNCTUATION_PATTERN)?.[0] ?? "";
    const href = trailing
      ? raw.slice(0, -trailing.length)
      : raw;

    if (href) {
      segments.push({
        kind: "link",
        value: href,
        href,
      });
    } else {
      segments.push({
        kind: "text",
        value: raw,
      });
    }

    if (trailing) {
      segments.push({
        kind: "text",
        value: trailing,
      });
    }

    cursor = start + raw.length;
  }

  if (cursor < content.length) {
    segments.push({
      kind: "text",
      value: content.slice(cursor),
    });
  }

  if (segments.length === 0) {
    return [{ kind: "text", value: content }];
  }

  return segments;
}
