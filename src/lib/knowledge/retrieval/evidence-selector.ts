import {
  callDeepSeekJson,
  type DeepSeekClientOptions,
} from "../../navigation/deepseek-client.ts";
import type { ResolvedCourseEvidence } from "./authority-resolver.ts";

export type SelectedEvidenceQuote = {
  chunkId: number;
  quote: string;
};

export type CourseEvidenceSelection =
  | {
      status: "SUPPORTED";
      evidence: SelectedEvidenceQuote[];
    }
  | {
      status: "INSUFFICIENT";
      evidence: [];
    };

export type SelectCourseEvidenceOptions = DeepSeekClientOptions & {
  callJson?: typeof callDeepSeekJson;
};

export class CourseEvidenceSelectionError extends Error {
  readonly code = "INVALID_COURSE_EVIDENCE_SELECTION";

  constructor(message: string) {
    super(message);
    this.name = "CourseEvidenceSelectionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSelection(
  value: unknown,
  available: readonly ResolvedCourseEvidence[],
): CourseEvidenceSelection {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new CourseEvidenceSelectionError(
      "Evidence selection must be an object with status.",
    );
  }

  if (value.status === "INSUFFICIENT") {
    if (
      Object.keys(value).some((key) => !["status", "evidence"].includes(key)) ||
      !Array.isArray(value.evidence) ||
      value.evidence.length !== 0
    ) {
      throw new CourseEvidenceSelectionError(
        "INSUFFICIENT must contain an empty evidence array.",
      );
    }

    return { status: "INSUFFICIENT", evidence: [] };
  }

  if (value.status !== "SUPPORTED") {
    throw new CourseEvidenceSelectionError(
      `Unsupported evidence status: ${String(value.status)}.`,
    );
  }

  if (
    Object.keys(value).some((key) => !["status", "evidence"].includes(key)) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length < 1 ||
    value.evidence.length > 3
  ) {
    throw new CourseEvidenceSelectionError(
      "SUPPORTED must contain between one and three evidence items.",
    );
  }

  const availableByChunkId = new Map(
    available.map((item) => [item.chunkId, item]),
  );
  const identities = new Set<string>();
  const evidence: SelectedEvidenceQuote[] = [];

  for (const item of value.evidence) {
    if (
      !isRecord(item) ||
      Object.keys(item).some((key) => !["chunkId", "quote"].includes(key)) ||
      !Number.isInteger(item.chunkId) ||
      typeof item.quote !== "string"
    ) {
      throw new CourseEvidenceSelectionError(
        "Each evidence item must contain integer chunkId and quote.",
      );
    }

    const quote = item.quote.trim();
    if (quote.length < 8 || quote.length > 320) {
      throw new CourseEvidenceSelectionError(
        "Evidence quotes must contain between 8 and 320 characters.",
      );
    }

    const source = availableByChunkId.get(item.chunkId as number);
    if (!source) {
      throw new CourseEvidenceSelectionError(
        `Unknown selected chunkId ${String(item.chunkId)}.`,
      );
    }

    if (!source.content.includes(quote)) {
      throw new CourseEvidenceSelectionError(
        `Evidence quote is not verbatim grounded in chunk ${String(
          item.chunkId,
        )}.`,
      );
    }

    const identity = `${String(item.chunkId)}:${quote}`;
    if (identities.has(identity)) {
      throw new CourseEvidenceSelectionError(
        "Evidence selection must not contain duplicates.",
      );
    }
    identities.add(identity);

    evidence.push({
      chunkId: item.chunkId as number,
      quote,
    });
  }

  return {
    status: "SUPPORTED",
    evidence,
  };
}

export async function selectCourseEvidence(
  learningNeed: string,
  evidence: readonly ResolvedCourseEvidence[],
  options: SelectCourseEvidenceOptions = {},
): Promise<CourseEvidenceSelection> {
  if (evidence.length === 0) {
    return { status: "INSUFFICIENT", evidence: [] };
  }

  const callJson = options.callJson ?? callDeepSeekJson;

  const raw = await callJson(
    [
      {
        role: "system",
        content: `Ты — внутренний селектор evidence для образовательного маршрута.

Курс уже выбран серверным router до RAG. Ты НЕ выбираешь курс, НЕ рекомендуешь курс и НЕ пишешь пользовательский ответ.

Задача:
- проверить, есть ли среди retrieved chunks прямое содержательное основание для learningNeed;
- выбрать 1–3 наиболее релевантных chunks;
- вернуть только короткие ДОСЛОВНЫЕ цитаты из content выбранных chunks;
- если прямого основания недостаточно — вернуть INSUFFICIENT.

Authority:
- исходный порядок evidence отражает retrieval relevance;
- CONTROLLING_SCOPED_CORRECTION действует только в указанном proposition scope;
- correction нельзя трактовать как глобально более сильный источник вне этого scope.

JSON:
{"status":"SUPPORTED","evidence":[{"chunkId":123,"quote":"дословная цитата"}]}
или
{"status":"INSUFFICIENT","evidence":[]}

Никакого текста вне JSON.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            learningNeed,
            retrievedEvidence: evidence.map((item) => ({
              chunkId: item.chunkId,
              evidenceRole: item.evidenceRole,
              controllingAuthorityEntries: item.controllingAuthorityEntries,
              sourceTitle: item.sourceTitle,
              locator: item.locator,
              content: item.content,
            })),
          },
          null,
          2,
        ),
      },
    ],
    options,
  );

  return validateSelection(raw, evidence);
}
