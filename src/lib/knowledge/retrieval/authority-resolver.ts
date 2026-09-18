
import type { CourseKnowledgeMatch } from "./retrieve-course-knowledge.ts";

export type ScopedAuthorityEntry = {
  id: string;
  questionNumber?: number;
  type?: string;
  propositionScope?: string;
};

export type ResolvedCourseEvidence = CourseKnowledgeMatch & {
  controllingAuthorityEntries: ScopedAuthorityEntry[];
  evidenceRole:
    | "CONTROLLING_SCOPED_CORRECTION"
    | "FOUNDATIONAL"
    | "OPERATIONALIZATION"
    | "ELABORATION"
    | "EXTERNAL_RESEARCH"
    | "SUPPLEMENTAL";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function questionNumbersFromChunk(match: CourseKnowledgeMatch): Set<number> {
  const result = new Set<number>();
  const sourceBlocks = match.chunkMetadata.sourceBlocks;

  if (!Array.isArray(sourceBlocks)) {
    return result;
  }

  for (const sourceBlock of sourceBlocks) {
    if (!isRecord(sourceBlock) || !isRecord(sourceBlock.metadata)) {
      continue;
    }

    const questionNumber = sourceBlock.metadata.questionNumber;
    if (Number.isInteger(questionNumber)) {
      result.add(questionNumber as number);
    }
  }

  return result;
}

function controllingEntriesFor(
  match: CourseKnowledgeMatch,
): ScopedAuthorityEntry[] {
  if (match.authorityRelation !== "PROPOSITION_SCOPED_CORRECTION") {
    return [];
  }

  const rawEntries = match.documentMetadata.controllingAuthorityEntries;
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  const questionNumbers = questionNumbersFromChunk(match);
  const resolved: ScopedAuthorityEntry[] = [];

  for (const value of rawEntries) {
    if (!isRecord(value) || typeof value.id !== "string") {
      continue;
    }

    const questionNumber = Number.isInteger(value.questionNumber)
      ? (value.questionNumber as number)
      : undefined;

    if (
      questionNumber !== undefined &&
      !questionNumbers.has(questionNumber)
    ) {
      continue;
    }

    resolved.push({
      id: value.id,
      ...(questionNumber === undefined ? {} : { questionNumber }),
      ...(typeof value.type === "string" ? { type: value.type } : {}),
      ...(typeof value.propositionScope === "string"
        ? { propositionScope: value.propositionScope }
        : {}),
    });
  }

  return resolved;
}

function evidenceRoleFor(
  match: CourseKnowledgeMatch,
  controllingAuthorityEntries: ScopedAuthorityEntry[],
): ResolvedCourseEvidence["evidenceRole"] {
  if (
    match.authorityRelation === "PROPOSITION_SCOPED_CORRECTION" &&
    controllingAuthorityEntries.length > 0
  ) {
    return "CONTROLLING_SCOPED_CORRECTION";
  }

  switch (match.authorityRelation) {
    case "FOUNDATIONAL":
      return "FOUNDATIONAL";
    case "OPERATIONALIZATION":
      return "OPERATIONALIZATION";
    case "EXTERNAL_RESEARCH":
      return "EXTERNAL_RESEARCH";
    case "SUPPLEMENTAL":
      return "SUPPLEMENTAL";
    case "ELABORATION":
    case "PROPOSITION_SCOPED_CORRECTION":
      return "ELABORATION";
  }
}

export function resolveCourseEvidence(
  matches: readonly CourseKnowledgeMatch[],
  maxItems = 8,
): ResolvedCourseEvidence[] {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) {
    throw new Error("maxItems must be an integer between 1 and 20.");
  }

  const seen = new Set<string>();
  const resolved: ResolvedCourseEvidence[] = [];

  for (const match of matches) {
    const identity =
      match.contentSha256 ??
      `${match.documentId}:${match.chunkId}:${match.content}`;

    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);

    const controllingAuthorityEntries = controllingEntriesFor(match);
    resolved.push({
      ...match,
      controllingAuthorityEntries,
      evidenceRole: evidenceRoleFor(match, controllingAuthorityEntries),
    });
  }

  // Authority is semantic, not a global score. Preserve vector relevance
  // ordering and annotate scoped override semantics for the composer.
  resolved.sort((left, right) => right.similarity - left.similarity);

  return resolved.slice(0, maxItems);
}

function provenanceSummary(evidence: ResolvedCourseEvidence): string {
  const primary = evidence.locator.primary;
  if (!isRecord(primary)) {
    return "provenance available in source metadata";
  }

  const parts: string[] = [];
  if (Number.isInteger(primary.questionNumber)) {
    parts.push(`question ${String(primary.questionNumber)}`);
  }
  if (Number.isInteger(primary.pdfPageStart)) {
    parts.push(`PDF page ${String(primary.pdfPageStart)}`);
  }
  if (Number.isInteger(primary.slideStart)) {
    parts.push(`slide ${String(primary.slideStart)}`);
  }
  if (Number.isInteger(primary.pageStart)) {
    parts.push(`page ${String(primary.pageStart)}`);
  }
  return parts.length > 0 ? parts.join(", ") : "source locator available";
}

export function buildCourseEvidenceContext(
  evidence: readonly ResolvedCourseEvidence[],
  maxCharacters = 12_000,
): string {
  if (
    !Number.isInteger(maxCharacters) ||
    maxCharacters < 1_000 ||
    maxCharacters > 40_000
  ) {
    throw new Error("maxCharacters must be between 1000 and 40000.");
  }

  const sections: string[] = [];

  for (const item of evidence) {
    const correction =
      item.controllingAuthorityEntries.length > 0
        ? `\nScoped correction entries:\n${item.controllingAuthorityEntries
            .map(
              (entry) =>
                `- ${entry.id}` +
                (entry.type ? ` | type=${entry.type}` : "") +
                (entry.propositionScope
                  ? ` | propositionScope=${entry.propositionScope}`
                  : ""),
            )
            .join("\n")}`
        : "";

    const section = [
      `[${item.evidenceRole}]`,
      `Source: ${item.sourceTitle}`,
      `Source slug: ${item.sourceSlug}`,
      `Provenance: ${provenanceSummary(item)}`,
      `Similarity: ${item.similarity.toFixed(4)}`,
      correction.trim(),
      "Content:",
      item.content,
    ]
      .filter(Boolean)
      .join("\n");

    const candidate = [...sections, section].join("\n\n---\n\n");
    if (candidate.length > maxCharacters) {
      break;
    }
    sections.push(section);
  }

  return sections.join("\n\n---\n\n");
}
