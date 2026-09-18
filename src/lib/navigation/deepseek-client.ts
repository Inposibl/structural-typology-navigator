
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-flash";
const DEFAULT_TIMEOUT_MS = 45_000;

export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekClientOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class DeepSeekClientError extends Error {
  readonly code:
    | "CONFIGURATION_ERROR"
    | "NETWORK_ERROR"
    | "UPSTREAM_ERROR"
    | "INVALID_RESPONSE"
    | "ABORTED";
  readonly status: number | null;

  constructor(
    code: DeepSeekClientError["code"],
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "DeepSeekClientError";
    this.code = code;
    this.status = status;
  }
}

function readApiKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env.DEEPSEEK_API_KEY?.trim();
  if (!value) {
    throw new DeepSeekClientError(
      "CONFIGURATION_ERROR",
      "DEEPSEEK_API_KEY is required.",
    );
  }
  return value;
}

function responseContent(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new DeepSeekClientError(
      "INVALID_RESPONSE",
      "DeepSeek returned an invalid response.",
    );
  }

  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new DeepSeekClientError(
      "INVALID_RESPONSE",
      "DeepSeek returned no choices.",
    );
  }

  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    throw new DeepSeekClientError(
      "INVALID_RESPONSE",
      "DeepSeek returned an invalid choice.",
    );
  }

  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    throw new DeepSeekClientError(
      "INVALID_RESPONSE",
      "DeepSeek returned an invalid message.",
    );
  }

  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string" || !content.trim()) {
    throw new DeepSeekClientError(
      "INVALID_RESPONSE",
      "DeepSeek returned empty content.",
    );
  }

  return content.trim();
}

async function callDeepSeek(
  messages: readonly DeepSeekMessage[],
  options: DeepSeekClientOptions & {
    jsonMode: boolean;
    maxTokens: number;
  },
): Promise<string> {
  const apiKey = readApiKey(options.env);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new DeepSeekClientError(
      "CONFIGURATION_ERROR",
      "A server-side fetch implementation is required.",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new DeepSeekClientError(
      "CONFIGURATION_ERROR",
      "timeoutMs must be a positive integer.",
    );
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const abortFromExternal = () => timeoutController.abort();

  if (options.signal?.aborted) {
    timeoutController.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromExternal, {
      once: true,
    });
  }

  try {
    let response: Response;
    try {
      response = await fetchImplementation(DEEPSEEK_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          stream: false,
          thinking: { type: "disabled" },
          max_tokens: options.maxTokens,
          ...(options.jsonMode
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        cache: "no-store",
        signal: timeoutController.signal,
      });
    } catch {
      throw new DeepSeekClientError(
        "ABORTED",
        "DeepSeek request was aborted or timed out.",
      );
    }

    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Best effort.
      }
      throw new DeepSeekClientError(
        "UPSTREAM_ERROR",
        "DeepSeek rejected the request.",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DeepSeekClientError(
        "INVALID_RESPONSE",
        "DeepSeek returned invalid JSON.",
        response.status,
      );
    }

    return responseContent(payload);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromExternal);
  }
}

export async function callDeepSeekJson(
  messages: readonly DeepSeekMessage[],
  options: DeepSeekClientOptions = {},
): Promise<unknown> {
  const content = await callDeepSeek(messages, {
    ...options,
    jsonMode: true,
    maxTokens: 1_800,
  });

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new DeepSeekClientError(
      "INVALID_RESPONSE",
      "DeepSeek JSON mode returned unparsable content.",
    );
  }
}

export async function callDeepSeekText(
  messages: readonly DeepSeekMessage[],
  options: DeepSeekClientOptions = {},
): Promise<string> {
  return callDeepSeek(messages, {
    ...options,
    jsonMode: false,
    maxTokens: 2_200,
  });
}
