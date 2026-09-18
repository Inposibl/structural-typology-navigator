export type SupabaseServerEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type SupabaseServerConfig = {
  baseUrl: string;
  secretKey: string;
};

export type SupabaseServerClientOptions = {
  env?: SupabaseServerEnvironment;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export class SupabaseConfigurationError extends Error {
  readonly code = "SUPABASE_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

type SupabaseRequestErrorCode =
  | "ABORTED"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UPSTREAM_ERROR";

export class SupabaseRequestError extends Error {
  readonly code: SupabaseRequestErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    code: SupabaseRequestErrorCode,
    message: string,
    options: { status?: number; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = "SupabaseRequestError";
    this.code = code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

function normalizeSupabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SupabaseConfigurationError("SUPABASE_URL must be a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SupabaseConfigurationError(
      "SUPABASE_URL must use HTTP or HTTPS.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SupabaseConfigurationError(
      "SUPABASE_URL must not contain credentials, query parameters, or a fragment.",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

export function readSupabaseServerConfig(
  env: SupabaseServerEnvironment = process.env,
): SupabaseServerConfig {
  const rawUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();

  if (!rawUrl) {
    throw new SupabaseConfigurationError("SUPABASE_URL is required.");
  }
  if (!secretKey) {
    throw new SupabaseConfigurationError("SUPABASE_SECRET_KEY is required.");
  }
  if (!secretKey.startsWith("sb_secret_")) {
    throw new SupabaseConfigurationError(
      "SUPABASE_SECRET_KEY must use the modern sb_secret_ format.",
    );
  }

  return {
    baseUrl: normalizeSupabaseUrl(rawUrl),
    secretKey,
  };
}

function createRequestSignal(
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    },
  };
}

function requestIdFrom(response: Response): string | null {
  return response.headers.get("x-request-id") ?? response.headers.get("cf-ray");
}

function interruptedRequestError(
  requestSignal: ReturnType<typeof createRequestSignal>,
): SupabaseRequestError {
  const timedOut = requestSignal.didTimeout();
  return new SupabaseRequestError(
    timedOut ? "TIMEOUT" : "ABORTED",
    timedOut
      ? "Supabase request timed out."
      : "Supabase request was aborted.",
  );
}

export function createSupabaseServerClient(
  options: SupabaseServerClientOptions = {},
): {
  requestJson: <T>(path: string, init: RequestInit) => Promise<T>;
} {
  const config = readSupabaseServerConfig(options.env);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (typeof fetchImplementation !== "function") {
    throw new SupabaseConfigurationError("A server-side fetch implementation is required.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SupabaseConfigurationError("timeoutMs must be a positive integer.");
  }

  return {
    async requestJson<T>(path: string, init: RequestInit): Promise<T> {
      if (!path.startsWith("/") || path.startsWith("//")) {
        throw new SupabaseConfigurationError(
          "Supabase request paths must be root-relative.",
        );
      }

      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      headers.set("Content-Type", "application/json");
      headers.set("apikey", config.secretKey);
      headers.delete("Authorization");

      const requestSignal = createRequestSignal(init.signal, timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImplementation(`${config.baseUrl}${path}`, {
            ...init,
            headers,
            signal: requestSignal.signal,
          });
        } catch {
          if (requestSignal.signal.aborted) {
            throw interruptedRequestError(requestSignal);
          }
          throw new SupabaseRequestError(
            "NETWORK_ERROR",
            "Supabase request failed before receiving a response.",
          );
        }

        if (!response.ok) {
          try {
            await response.body?.cancel();
          } catch {
            // Body cancellation is best-effort; the sanitized HTTP error wins.
          }
          throw new SupabaseRequestError(
            "UPSTREAM_ERROR",
            "Supabase rejected the server request.",
            {
              status: response.status,
              requestId: requestIdFrom(response),
            },
          );
        }

        try {
          return (await response.json()) as T;
        } catch {
          if (requestSignal.signal.aborted) {
            throw interruptedRequestError(requestSignal);
          }
          throw new SupabaseRequestError(
            "INVALID_RESPONSE",
            "Supabase returned an invalid JSON response.",
            {
              status: response.status,
              requestId: requestIdFrom(response),
            },
          );
        }
      } finally {
        requestSignal.cleanup();
      }
    },
  };
}
