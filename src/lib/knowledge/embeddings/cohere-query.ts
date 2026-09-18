
import {
  COHERE_EMBED_ENDPOINT,
  COHERE_EMBED_MODEL,
  COHERE_EMBED_OUTPUT_DIMENSION,
} from "./cohere-embed.ts";
import { createRequestSignal } from "../transport/request-signal.ts";

export const COHERE_QUERY_INPUT_TYPE = "search_query";
export const COHERE_QUERY_EMBEDDING_TYPES = ["float"] as const;
export const COHERE_QUERY_TRUNCATE = "NONE";
export const DEFAULT_COHERE_QUERY_TIMEOUT_MS = 60_000;
export const DEFAULT_COHERE_QUERY_MAX_RETRIES = 2;

const RETRYABLE_STATUSES = new Set([429, 500, 503, 504]);

export type EmbedKnowledgeQueryOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class CohereQueryError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "CONFIGURATION_ERROR"
    | "ABORTED"
    | "TIMEOUT"
    | "NETWORK_ERROR"
    | "UPSTREAM_ERROR"
    | "INVALID_RESPONSE";
  readonly status: number | null;
  readonly attempts: number;

  constructor(
    code: CohereQueryError["code"],
    message: string,
    options: { status?: number | null; attempts?: number } = {},
  ) {
    super(message);
    this.name = "CohereQueryError";
    this.code = code;
    this.status = options.status ?? null;
    this.attempts = options.attempts ?? 1;
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readApiKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env.COHERE_API_KEY?.trim();
  if (!value) {
    throw new CohereQueryError(
      "CONFIGURATION_ERROR",
      "COHERE_API_KEY is required.",
    );
  }
  return value;
}

function parseVector(payload: unknown): number[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new CohereQueryError(
      "INVALID_RESPONSE",
      "Cohere query response must be an object.",
    );
  }

  const embeddings = (payload as { embeddings?: unknown }).embeddings;
  if (
    typeof embeddings !== "object" ||
    embeddings === null ||
    Array.isArray(embeddings)
  ) {
    throw new CohereQueryError(
      "INVALID_RESPONSE",
      "Cohere query response must contain embeddings.",
    );
  }

  const vectors = (embeddings as { float?: unknown }).float;
  if (!Array.isArray(vectors) || vectors.length !== 1) {
    throw new CohereQueryError(
      "INVALID_RESPONSE",
      "Cohere query response must contain exactly one float embedding.",
    );
  }

  const vector = vectors[0];
  if (
    !Array.isArray(vector) ||
    vector.length !== COHERE_EMBED_OUTPUT_DIMENSION ||
    vector.some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    throw new CohereQueryError(
      "INVALID_RESPONSE",
      `Cohere query embedding must contain exactly ${COHERE_EMBED_OUTPUT_DIMENSION} finite values.`,
    );
  }

  return vector as number[];
}

export async function embedKnowledgeQuery(
  queryInput: string,
  options: EmbedKnowledgeQueryOptions = {},
): Promise<number[]> {
  const query = queryInput.trim();
  if (!query) {
    throw new CohereQueryError("INVALID_INPUT", "Query cannot be blank.");
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new CohereQueryError(
      "CONFIGURATION_ERROR",
      "A server-side fetch implementation is required.",
    );
  }

  const timeoutMs =
    options.timeoutMs ?? DEFAULT_COHERE_QUERY_TIMEOUT_MS;
  const maxRetries =
    options.maxRetries ?? DEFAULT_COHERE_QUERY_MAX_RETRIES;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CohereQueryError(
      "CONFIGURATION_ERROR",
      "timeoutMs must be a positive integer.",
    );
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new CohereQueryError(
      "CONFIGURATION_ERROR",
      "maxRetries must be an integer between 0 and 5.",
    );
  }

  const apiKey = readApiKey(options.env);
  const sleep = options.sleep ?? defaultSleep;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    const requestSignal = createRequestSignal(options.signal, timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetchImplementation(COHERE_EMBED_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: COHERE_EMBED_MODEL,
            texts: [query],
            input_type: COHERE_QUERY_INPUT_TYPE,
            output_dimension: COHERE_EMBED_OUTPUT_DIMENSION,
            embedding_types: [...COHERE_QUERY_EMBEDDING_TYPES],
            truncate: COHERE_QUERY_TRUNCATE,
          }),
          signal: requestSignal.signal,
        });
      } catch {
        if (requestSignal.signal.aborted) {
          const timedOut = requestSignal.didTimeout();
          const error = new CohereQueryError(
            timedOut ? "TIMEOUT" : "ABORTED",
            timedOut
              ? "Cohere query request timed out."
              : "Cohere query request was aborted.",
            { attempts },
          );
          if (!timedOut || attempts > maxRetries) throw error;
          await sleep(Math.min(500 * 2 ** (attempts - 1), 8_000));
          continue;
        }

        const error = new CohereQueryError(
          "NETWORK_ERROR",
          "Cohere query request failed before receiving a response.",
          { attempts },
        );
        if (attempts > maxRetries) throw error;
        await sleep(Math.min(500 * 2 ** (attempts - 1), 8_000));
        continue;
      }

      if (!response.ok) {
        const status = response.status;
        try {
          await response.body?.cancel();
        } catch {
          // Best effort.
        }

        const error = new CohereQueryError(
          "UPSTREAM_ERROR",
          "Cohere rejected the query embedding request.",
          { status, attempts },
        );

        if (!RETRYABLE_STATUSES.has(status) || attempts > maxRetries) {
          throw error;
        }

        await sleep(Math.min(500 * 2 ** (attempts - 1), 8_000));
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new CohereQueryError(
          "INVALID_RESPONSE",
          "Cohere returned invalid JSON.",
          { status: response.status, attempts },
        );
      }

      return parseVector(payload);
    } finally {
      requestSignal.cleanup();
    }
  }
}
