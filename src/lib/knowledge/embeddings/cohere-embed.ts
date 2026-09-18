import { hasSourceContent, isSha256Hex } from "../../ingestion/index.ts";
import {
  createRequestSignal,
  type ServerRequestSignal,
} from "../transport/request-signal.ts";

export const COHERE_EMBED_ENDPOINT = "https://api.cohere.com/v2/embed";
export const COHERE_EMBED_MODEL = "embed-v4.0";
export const COHERE_EMBED_INPUT_TYPE = "search_document";
export const COHERE_EMBED_OUTPUT_DIMENSION = 1024;
export const COHERE_EMBED_EMBEDDING_TYPES = ["float"] as const;
export const COHERE_EMBED_TRUNCATE = "NONE";
export const COHERE_EMBED_MAX_TEXTS = 96;

export const DEFAULT_COHERE_TIMEOUT_MS = 60_000;
export const DEFAULT_COHERE_MAX_RETRIES = 2;
export const DEFAULT_COHERE_INITIAL_RETRY_DELAY_MS = 500;
export const DEFAULT_COHERE_MAX_RETRY_DELAY_MS = 8_000;
export const DEFAULT_COHERE_MAX_RETRY_AFTER_MS = 60_000;
export const MAX_ALLOWED_COHERE_RETRIES = 5;
export const MAX_ALLOWED_COHERE_RETRY_DELAY_MS = 60_000;

export const RETRYABLE_COHERE_STATUSES = [429, 500, 503, 504] as const;

export type CohereRequestErrorCode =
  | "ABORTED"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UPSTREAM_ERROR";

export type CohereEnvironment = Readonly<Record<string, string | undefined>>;

export type KnowledgeChunkText = {
  chunkIndex: number;
  content: string;
  contentSha256: string;
};

export type KnowledgeChunkEmbedding = {
  chunkIndex: number;
  contentSha256: string;
  embedding: number[];
};

export type EmbedKnowledgeChunkTextsOptions = {
  env?: CohereEnvironment;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxRetryAfterMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export class CohereInputError extends Error {
  readonly code = "INVALID_COHERE_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "CohereInputError";
  }
}

export class CohereConfigurationError extends Error {
  readonly code = "COHERE_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CohereConfigurationError";
  }
}

export class CohereResponseError extends Error {
  readonly code = "INVALID_COHERE_EMBEDDING_RESPONSE";

  constructor(message: string) {
    super(message);
    this.name = "CohereResponseError";
  }
}

export class CohereRequestError extends Error {
  readonly code: CohereRequestErrorCode;
  readonly status: number | null;
  readonly attempts: number;
  readonly retryAfterMs: number | null;

  constructor(
    code: CohereRequestErrorCode,
    message: string,
    options: {
      status?: number | null;
      attempts?: number;
      retryAfterMs?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "CohereRequestError";
    this.code = code;
    this.status = options.status ?? null;
    this.attempts = options.attempts ?? 1;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

type RetrySettings = {
  timeoutMs: number;
  maxRetries: number;
  initialRetryDelayMs: number;
  maxRetryDelayMs: number;
  maxRetryAfterMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
};

type EmbedContext = {
  apiKey: string;
  fetchImplementation: typeof globalThis.fetch;
  settings: RetrySettings;
  signal?: AbortSignal;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readCohereApiKey(env: CohereEnvironment = process.env): string {
  const apiKey = env.COHERE_API_KEY?.trim();
  if (!apiKey) {
    throw new CohereConfigurationError("COHERE_API_KEY is required.");
  }
  return apiKey;
}

function readPositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new CohereConfigurationError(
      `${fieldName} must be a positive integer.`,
    );
  }
  return value as number;
}

function readRetrySettings(
  options: EmbedKnowledgeChunkTextsOptions,
): RetrySettings {
  const timeoutMs = readPositiveInteger(
    options.timeoutMs ?? DEFAULT_COHERE_TIMEOUT_MS,
    "timeoutMs",
  );

  const maxRetries = options.maxRetries ?? DEFAULT_COHERE_MAX_RETRIES;
  if (
    !Number.isInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > MAX_ALLOWED_COHERE_RETRIES
  ) {
    throw new CohereConfigurationError(
      `maxRetries must be an integer between 0 and ${MAX_ALLOWED_COHERE_RETRIES}.`,
    );
  }

  const initialRetryDelayMs = readPositiveInteger(
    options.initialRetryDelayMs ?? DEFAULT_COHERE_INITIAL_RETRY_DELAY_MS,
    "initialRetryDelayMs",
  );
  const maxRetryDelayMs = readPositiveInteger(
    options.maxRetryDelayMs ?? DEFAULT_COHERE_MAX_RETRY_DELAY_MS,
    "maxRetryDelayMs",
  );
  const maxRetryAfterMs = readPositiveInteger(
    options.maxRetryAfterMs ?? DEFAULT_COHERE_MAX_RETRY_AFTER_MS,
    "maxRetryAfterMs",
  );

  if (
    initialRetryDelayMs > maxRetryDelayMs ||
    maxRetryDelayMs > MAX_ALLOWED_COHERE_RETRY_DELAY_MS ||
    maxRetryAfterMs > MAX_ALLOWED_COHERE_RETRY_DELAY_MS
  ) {
    throw new CohereConfigurationError(
      `Retry delays must be ordered and must not exceed ${MAX_ALLOWED_COHERE_RETRY_DELAY_MS} milliseconds.`,
    );
  }

  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  if (typeof sleep !== "function" || typeof random !== "function") {
    throw new CohereConfigurationError(
      "sleep and random must be functions when provided.",
    );
  }

  return {
    timeoutMs,
    maxRetries,
    initialRetryDelayMs,
    maxRetryDelayMs,
    maxRetryAfterMs,
    sleep,
    random,
  };
}

function normalizeChunkTexts(
  chunks: readonly KnowledgeChunkText[],
): KnowledgeChunkText[] {
  if (!Array.isArray(chunks)) {
    throw new CohereInputError("chunks must be an array.");
  }

  const seenChunkIndexes = new Set<number>();
  const normalized = chunks.map((chunk, position) => {
    if (typeof chunk !== "object" || chunk === null) {
      throw new CohereInputError(`Chunk ${position} must be an object.`);
    }
    if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) {
      throw new CohereInputError(
        `Chunk ${position} chunkIndex must be a non-negative integer.`,
      );
    }
    if (seenChunkIndexes.has(chunk.chunkIndex)) {
      throw new CohereInputError(
        `Chunk ${position} repeats chunkIndex ${chunk.chunkIndex}.`,
      );
    }
    seenChunkIndexes.add(chunk.chunkIndex);

    if (
      typeof chunk.content !== "string" ||
      !hasSourceContent(chunk.content)
    ) {
      throw new CohereInputError(
        `Chunk ${chunk.chunkIndex} content cannot be blank.`,
      );
    }
    if (!isSha256Hex(chunk.contentSha256)) {
      throw new CohereInputError(
        `Chunk ${chunk.chunkIndex} contentSha256 must be a lowercase SHA-256 value.`,
      );
    }

    return {
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentSha256: chunk.contentSha256,
    };
  });

  return normalized.sort((left, right) => left.chunkIndex - right.chunkIndex);
}

function batchChunkTexts(
  chunks: readonly KnowledgeChunkText[],
): KnowledgeChunkText[][] {
  const batches: KnowledgeChunkText[][] = [];
  for (let start = 0; start < chunks.length; start += COHERE_EMBED_MAX_TEXTS) {
    batches.push(chunks.slice(start, start + COHERE_EMBED_MAX_TEXTS));
  }
  return batches;
}

function buildEmbedRequest(batch: readonly KnowledgeChunkText[]): {
  model: string;
  texts: string[];
  input_type: string;
  output_dimension: number;
  embedding_types: string[];
  truncate: string;
} {
  return {
    model: COHERE_EMBED_MODEL,
    texts: batch.map((chunk) => chunk.content),
    input_type: COHERE_EMBED_INPUT_TYPE,
    output_dimension: COHERE_EMBED_OUTPUT_DIMENSION,
    embedding_types: [...COHERE_EMBED_EMBEDDING_TYPES],
    truncate: COHERE_EMBED_TRUNCATE,
  };
}

function parseBatchEmbeddings(
  payload: unknown,
  expectedCount: number,
): number[][] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new CohereResponseError(
      "Cohere embedding response must be a JSON object.",
    );
  }

  const embeddings = (payload as { embeddings?: unknown }).embeddings;
  if (
    typeof embeddings !== "object" ||
    embeddings === null ||
    Array.isArray(embeddings)
  ) {
    throw new CohereResponseError(
      "Cohere embedding response must contain an embeddings object.",
    );
  }

  const float = (embeddings as { float?: unknown }).float;
  if (!Array.isArray(float)) {
    throw new CohereResponseError(
      "Cohere embedding response must contain an embeddings.float array.",
    );
  }
  if (float.length !== expectedCount) {
    throw new CohereResponseError(
      `Cohere returned ${float.length} embeddings for ${expectedCount} chunk texts.`,
    );
  }

  return float.map((vector, position) => {
    if (!Array.isArray(vector)) {
      throw new CohereResponseError(
        `Cohere embedding ${position} must be an array.`,
      );
    }
    if (vector.length !== COHERE_EMBED_OUTPUT_DIMENSION) {
      throw new CohereResponseError(
        `Cohere embedding ${position} must contain exactly ${COHERE_EMBED_OUTPUT_DIMENSION} values.`,
      );
    }
    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new CohereResponseError(
          `Cohere embedding ${position} must contain only finite numbers.`,
        );
      }
    }
    return vector as number[];
  });
}

function readRetryAfterMs(
  value: string | null,
  maxRetryAfterMs: number,
): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  // Only the delta-seconds form is honored; HTTP-date forms fall back to the
  // computed backoff instead of guessing a wall-clock delay.
  if (!/^[0-9]+$/u.test(trimmed)) {
    return null;
  }
  const seconds = Number(trimmed);
  if (!Number.isSafeInteger(seconds)) {
    return null;
  }
  return Math.min(seconds * 1000, maxRetryAfterMs);
}

function computeBackoffMs(attempt: number, settings: RetrySettings): number {
  const exponential = settings.initialRetryDelayMs * 2 ** (attempt - 1);
  const bounded = Math.min(exponential, settings.maxRetryDelayMs);
  const half = bounded / 2;
  return Math.round(half + settings.random() * half);
}

function classifyInterruption(
  requestSignal: ServerRequestSignal,
  attempts: number,
): CohereRequestError | null {
  if (!requestSignal.signal.aborted) {
    return null;
  }
  return new CohereRequestError(
    requestSignal.didTimeout() ? "TIMEOUT" : "ABORTED",
    requestSignal.didTimeout()
      ? "Cohere request timed out."
      : "Cohere request was aborted.",
    { attempts },
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; the classified error already stands.
  }
}

async function attemptEmbeddingBatch(
  batch: readonly KnowledgeChunkText[],
  context: EmbedContext,
  attempts: number,
): Promise<number[][]> {
  const requestSignal = createRequestSignal(
    context.signal,
    context.settings.timeoutMs,
  );

  try {
    let response: Response;
    try {
      response = await context.fetchImplementation(COHERE_EMBED_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${context.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildEmbedRequest(batch)),
        signal: requestSignal.signal,
      });
    } catch {
      throw (
        classifyInterruption(requestSignal, attempts) ??
        new CohereRequestError(
          "NETWORK_ERROR",
          "Cohere request failed before receiving a response.",
          { attempts },
        )
      );
    }

    if (!response.ok) {
      const retryAfterMs = readRetryAfterMs(
        response.headers.get("retry-after"),
        context.settings.maxRetryAfterMs,
      );
      await cancelBody(response);
      throw new CohereRequestError(
        "UPSTREAM_ERROR",
        "Cohere rejected the embedding request.",
        { status: response.status, attempts, retryAfterMs },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw (
        classifyInterruption(requestSignal, attempts) ??
        new CohereRequestError(
          "INVALID_RESPONSE",
          "Cohere returned an invalid JSON response.",
          { status: response.status, attempts },
        )
      );
    }

    return parseBatchEmbeddings(payload, batch.length);
  } finally {
    requestSignal.cleanup();
  }
}

function retryDelayMsFor(
  error: unknown,
  attempt: number,
  settings: RetrySettings,
): number | null {
  if (!(error instanceof CohereRequestError)) {
    return null;
  }
  if (error.code === "ABORTED") {
    return null;
  }

  const retryable =
    error.code === "TIMEOUT" ||
    error.code === "NETWORK_ERROR" ||
    (error.code === "UPSTREAM_ERROR" &&
      error.status !== null &&
      (RETRYABLE_COHERE_STATUSES as readonly number[]).includes(error.status));

  if (!retryable) {
    return null;
  }

  return error.retryAfterMs ?? computeBackoffMs(attempt, settings);
}

async function requestEmbeddingBatch(
  batch: readonly KnowledgeChunkText[],
  context: EmbedContext,
): Promise<number[][]> {
  let attempts = 1;

  for (;;) {
    try {
      return await attemptEmbeddingBatch(batch, context, attempts);
    } catch (error) {
      const retryDelayMs = retryDelayMsFor(error, attempts, context.settings);
      if (retryDelayMs === null || attempts > context.settings.maxRetries) {
        throw error;
      }

      await context.settings.sleep(retryDelayMs);

      if (context.signal?.aborted) {
        throw new CohereRequestError("ABORTED", "Cohere request was aborted.", {
          attempts,
        });
      }
      attempts += 1;
    }
  }
}

export async function embedKnowledgeChunkTexts(
  chunks: readonly KnowledgeChunkText[],
  options: EmbedKnowledgeChunkTextsOptions = {},
): Promise<KnowledgeChunkEmbedding[]> {
  const orderedChunks = normalizeChunkTexts(chunks);
  if (orderedChunks.length === 0) {
    return [];
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new CohereConfigurationError(
      "A server-side fetch implementation is required.",
    );
  }

  const context: EmbedContext = {
    apiKey: readCohereApiKey(options.env),
    fetchImplementation,
    settings: readRetrySettings(options),
    signal: options.signal,
  };

  const embeddings: KnowledgeChunkEmbedding[] = [];
  for (const batch of batchChunkTexts(orderedChunks)) {
    const vectors = await requestEmbeddingBatch(batch, context);
    batch.forEach((chunk, position) => {
      embeddings.push({
        chunkIndex: chunk.chunkIndex,
        contentSha256: chunk.contentSha256,
        embedding: vectors[position],
      });
    });
  }

  return embeddings;
}
