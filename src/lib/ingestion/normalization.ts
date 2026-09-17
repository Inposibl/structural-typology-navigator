export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/gu, "\n");
}

/**
 * Normalizes the original document boundary. Only this function may interpret
 * the first U+FEFF as a transport BOM; block-level normalization must preserve it.
 */
export function normalizeDocumentInput(value: string): string {
  const withoutLeadingBom = value.startsWith("\uFEFF") ? value.slice(1) : value;
  return normalizeNewlines(withoutLeadingBom);
}

/**
 * Normalizes already extracted author content without treating its first
 * character as a document BOM or rewriting whitespace.
 */
export function normalizeBlockText(value: string): string {
  return normalizeNewlines(value);
}

export function hasSourceContent(value: string): boolean {
  return /\P{White_Space}/u.test(value);
}
