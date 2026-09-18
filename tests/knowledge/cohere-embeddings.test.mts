import assert from "node:assert/strict";
import test from "node:test";

import {
  COHERE_EMBED_ENDPOINT,
  COHERE_EMBED_MAX_TEXTS,
  COHERE_EMBED_MODEL,
  COHERE_EMBED_OUTPUT_DIMENSION,
  CohereConfigurationError,
  CohereInputError,
  CohereRequestError,
  CohereResponseError,
  embedKnowledgeChunkTexts,
  type KnowledgeChunkText,
} from "../../src/lib/knowledge/embeddings/cohere-embed.ts";
import { COHERE_EMBEDDING_MODEL } from "../../src/lib/knowledge/persistence/payload.ts";

const TEST_ENV = { COHERE_API_KEY: "cohere_unit_test_not_real" };

type RecordedRequest = {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: Record<string, unknown>;
};

function recordingFetch(
  handler: (
    request: RecordedRequest,
    signal: AbortSignal | null | undefined,
  ) => Response | Promise<Response>,
): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    const request: RecordedRequest = {
      url: String(input),
      init: init ?? {},
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    requests.push(request);
    return handler(request, init?.signal);
  };
  return { fetch: fetchStub, requests };
}

function recordingSleep(): { slept: number[]; sleep: (ms: number) => Promise<void> } {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (milliseconds: number) => {
      slept.push(milliseconds);
    },
  };
}

function hex64(seed: number): string {
  return String(seed % 100)
    .padStart(2, "0")
    .repeat(32);
}

function chunk(index: number): KnowledgeChunkText {
  return {
    chunkIndex: index,
    content: `Фрагмент ${index}`,
    contentSha256: hex64(index + 10),
  };
}

function chunkRange(count: number): KnowledgeChunkText[] {
  return Array.from({ length: count }, (_unused, index) => chunk(index));
}

function vector(fill = 0.25, length = COHERE_EMBED_OUTPUT_DIMENSION): number[] {
  return new Array<number>(length).fill(fill);
}

function embedResponse(vectors: number[][]): Response {
  return Response.json({
    id: "embed-response-id",
    embeddings: { float: vectors },
    meta: { billed_units: { input_tokens: 12 } },
  });
}

function jsonBody(vectors: number[][]): Record<string, unknown> {
  return { embeddings: { float: vectors } };
}

function textResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => value,
  } as Response;
}

test("posts the exact embed-v4.0 document request to the v2 endpoint", async () => {
  const { fetch, requests } = recordingFetch(() => embedResponse([vector()]));

  const result = await embedKnowledgeChunkTexts([chunk(0)], {
    env: TEST_ENV,
    fetch,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, COHERE_EMBED_ENDPOINT);
  assert.equal(COHERE_EMBED_ENDPOINT, "https://api.cohere.com/v2/embed");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(
    requests[0].headers.get("authorization"),
    `Bearer ${TEST_ENV.COHERE_API_KEY}`,
  );
  assert.equal(requests[0].headers.get("content-type"), "application/json");
  assert.equal(requests[0].headers.get("apikey"), null);

  assert.deepEqual(Object.keys(requests[0].body), [
    "model",
    "texts",
    "input_type",
    "output_dimension",
    "embedding_types",
    "truncate",
  ]);
  assert.equal(requests[0].body.model, COHERE_EMBED_MODEL);
  assert.equal(COHERE_EMBED_MODEL, "embed-v4.0");
  assert.deepEqual(requests[0].body.texts, ["Фрагмент 0"]);
  assert.equal(requests[0].body.input_type, "search_document");
  assert.equal(requests[0].body.output_dimension, COHERE_EMBED_OUTPUT_DIMENSION);
  assert.equal(requests[0].body.output_dimension, 1024);
  assert.deepEqual(requests[0].body.embedding_types, ["float"]);
  assert.equal(requests[0].body.truncate, "NONE");
  assert.equal("inputs" in requests[0].body, false);
  assert.equal("images" in requests[0].body, false);

  assert.deepEqual(result, [
    { chunkIndex: 0, contentSha256: hex64(10), embedding: vector() },
  ]);
});

test("binds every returned vector to its chunk identity without token counts", async () => {
  const { fetch } = recordingFetch(() => embedResponse([vector(0.5), vector(0.75)]));

  const result = await embedKnowledgeChunkTexts([chunk(1), chunk(0)], {
    env: TEST_ENV,
    fetch,
  });

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((item) => item.chunkIndex),
    [0, 1],
  );
  assert.deepEqual(
    result.map((item) => item.contentSha256),
    [hex64(10), hex64(11)],
  );
  assert.deepEqual(
    result.map((item) => Object.keys(item)),
    [
      ["chunkIndex", "contentSha256", "embedding"],
      ["chunkIndex", "contentSha256", "embedding"],
    ],
  );
  assert.deepEqual(result[0].embedding, vector(0.5));
  assert.deepEqual(result[1].embedding, vector(0.75));
  assert.equal(COHERE_EMBED_MAX_TEXTS, 96);
});

test("sends 96 chunk texts in a single request", async () => {
  const { fetch, requests } = recordingFetch(() =>
    embedResponse(chunkRange(96).map(() => vector())),
  );

  const result = await embedKnowledgeChunkTexts(chunkRange(96), {
    env: TEST_ENV,
    fetch,
  });

  assert.equal(requests.length, 1);
  assert.equal((requests[0].body.texts as string[]).length, 96);
  assert.equal(result.length, 96);
});

test("splits 97 chunk texts into contiguous batches of 96 and 1", async () => {
  const { fetch, requests } = recordingFetch((request) =>
    embedResponse(
      (request.body.texts as string[]).map(() => vector()),
    ),
  );

  const result = await embedKnowledgeChunkTexts(chunkRange(97), {
    env: TEST_ENV,
    fetch,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => (request.body.texts as string[]).length),
    [96, 1],
  );
  assert.ok(
    (requests[0].body.texts as string[]).every(
      (text, position) => text === `Фрагмент ${position}`,
    ),
  );
  assert.deepEqual(requests[1].body.texts, ["Фрагмент 96"]);
  assert.equal(result.length, 97);
  assert.deepEqual(
    result.map((item) => item.chunkIndex),
    Array.from({ length: 97 }, (_unused, index) => index),
  );
  assert.ok(
    result.every(
      (item, index) => item.contentSha256 === hex64(index + 10),
    ),
  );
});

test("keeps chunk order and identity stable across shuffled batch boundaries", async () => {
  const shuffled = [...chunkRange(97)].reverse();
  const { fetch, requests } = recordingFetch((request) =>
    embedResponse((request.body.texts as string[]).map(() => vector())),
  );

  const result = await embedKnowledgeChunkTexts(shuffled, {
    env: TEST_ENV,
    fetch,
  });

  assert.deepEqual(
    result.map((item) => item.chunkIndex),
    Array.from({ length: 97 }, (_unused, index) => index),
  );
  assert.deepEqual(requests[0].body.texts, chunkRange(96).map((item) => item.content));
  assert.deepEqual(requests[1].body.texts, ["Фрагмент 96"]);
  assert.ok(
    result.every((item, index) => item.contentSha256 === hex64(index + 10)),
  );
});

test("rejects a response with fewer embeddings than batch texts", async () => {
  const { fetch } = recordingFetch(() => embedResponse([vector()]));

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0), chunk(1)], { env: TEST_ENV, fetch }),
    (error: unknown) => {
      assert.ok(error instanceof CohereResponseError);
      assert.equal(error.code, "INVALID_COHERE_EMBEDDING_RESPONSE");
      assert.match(error.message, /1 embeddings for 2 chunk texts/);
      return true;
    },
  );
});

test("rejects embeddings that are not exactly 1024 values", async () => {
  for (const length of [1023, 1025]) {
    const { fetch } = recordingFetch(() =>
      embedResponse([vector(0.25, length)]),
    );

    await assert.rejects(
      embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch }),
      (error: unknown) => {
        assert.ok(error instanceof CohereResponseError);
        assert.match(error.message, /exactly 1024 values/);
        return true;
      },
      `length ${length}`,
    );
  }
});

test("rejects embeddings holding non-numeric values", async () => {
  for (const value of [["x"], [null], [{}]]) {
    const { fetch } = recordingFetch(() =>
      textResponse(jsonBody([[value as unknown as number, ...vector().slice(1)]])),
    );

    await assert.rejects(
      embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch }),
      CohereResponseError,
      JSON.stringify(value),
    );
  }
});

test("rejects NaN and Infinity in a parsed success payload", async () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const { fetch } = recordingFetch(() =>
      textResponse(jsonBody([[value, ...vector().slice(1)]])),
    );

    await assert.rejects(
      embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch }),
      (error: unknown) => {
        assert.ok(error instanceof CohereResponseError);
        assert.match(error.message, /finite numbers/);
        return true;
      },
      String(value),
    );
  }
});

test("rejects a malformed success payload", async () => {
  const { fetch: failingJson } = recordingFetch(
    () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => {
          throw new Error("invalid json");
        },
      }) as unknown as Response,
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch: failingJson }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.code, "INVALID_RESPONSE");
      return true;
    },
  );

  const { fetch: wrongShape } = recordingFetch(() =>
    textResponse({ embeddings: { int8: [[1]] } }),
  );
  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch: wrongShape }),
    CohereResponseError,
  );

  const { fetch: notAnObject } = recordingFetch(() => textResponse("nope"));
  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch: notAnObject }),
    CohereResponseError,
  );
});

test("retries a transient failure and succeeds", async () => {
  const { sleep, slept } = recordingSleep();
  let attempts = 0;
  const { fetch, requests } = recordingFetch(() => {
    attempts += 1;
    return attempts === 1
      ? new Response(JSON.stringify({ message: "unavailable" }), { status: 503 })
      : embedResponse([vector()]);
  });

  const result = await embedKnowledgeChunkTexts([chunk(0)], {
    env: TEST_ENV,
    fetch,
    sleep,
    random: () => 0,
  });

  assert.equal(requests.length, 2);
  assert.equal(result.length, 1);
  assert.deepEqual(slept, [250]);
});

test("retries timeouts and network failures but never caller aborts", async () => {
  const { sleep } = recordingSleep();
  let attempts = 0;
  const timeoutFetch: typeof globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      attempts += 1;
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted by timeout")),
        { once: true },
      );
    });

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch: timeoutFetch,
      timeoutMs: 20,
      maxRetries: 1,
      sleep,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.attempts, 2);
      return true;
    },
  );
  assert.equal(attempts, 2);

  const controller = new AbortController();
  controller.abort();
  const { fetch: abortFetch, requests } = recordingFetch(() => {
    throw new Error("aborted by test");
  });

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch: abortFetch,
      signal: controller.signal,
      sleep,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.code, "ABORTED");
      assert.equal(error.attempts, 1);
      return true;
    },
  );
  assert.equal(requests.length, 1);
});

test("stops retrying when the caller aborts during backoff", async () => {
  const controller = new AbortController();
  const { fetch, requests } = recordingFetch(
    () => new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch,
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.code, "ABORTED");
      return true;
    },
  );
  assert.equal(requests.length, 1);
});

test("fails safely when retries are exhausted", async () => {
  const { sleep, slept } = recordingSleep();
  const { fetch, requests } = recordingFetch(
    () => new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch,
      sleep,
      maxRetries: 2,
      random: () => 0.5,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.code, "UPSTREAM_ERROR");
      assert.equal(error.status, 503);
      assert.equal(error.attempts, 3);
      return true;
    },
  );
  assert.equal(requests.length, 3);
  assert.equal(slept.length, 2);
});

test("never retries permanent request, auth, and validation failures", async () => {
  for (const status of [400, 401, 403, 404, 422, 498, 501]) {
    const { sleep, slept } = recordingSleep();
    const { fetch, requests } = recordingFetch(
      () => new Response(JSON.stringify({ message: "rejected" }), { status }),
    );

    await assert.rejects(
      embedKnowledgeChunkTexts([chunk(0)], {
        env: TEST_ENV,
        fetch,
        sleep,
        maxRetries: 2,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CohereRequestError);
        assert.equal(error.status, status);
        assert.equal(error.attempts, 1);
        return true;
      },
      `status ${status}`,
    );
    assert.equal(requests.length, 1, `status ${status}`);
    assert.deepEqual(slept, [], `status ${status}`);
  }
});

test("never retries a malformed success payload", async () => {
  const { sleep, slept } = recordingSleep();
  const { fetch, requests } = recordingFetch(() =>
    embedResponse([vector(0.25, 1023)]),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch,
      sleep,
      maxRetries: 2,
    }),
    CohereResponseError,
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(slept, []);
});

test("honors a valid Retry-After header", async () => {
  const { sleep, slept } = recordingSleep();
  let attempts = 0;
  const { fetch } = recordingFetch(() => {
    attempts += 1;
    return attempts === 1
      ? new Response(JSON.stringify({ message: "slow down" }), {
          status: 429,
          headers: { "retry-after": "2" },
        })
      : embedResponse([vector()]);
  });

  const result = await embedKnowledgeChunkTexts([chunk(0)], {
    env: TEST_ENV,
    fetch,
    sleep,
    random: () => 1,
  });

  assert.deepEqual(slept, [2000]);
  assert.equal(result.length, 1);
});

test("caps Retry-After and falls back to jittered backoff when it is invalid", async () => {
  const capped = recordingSleep();
  const { fetch: cappedFetch } = recordingFetch(
    () =>
      new Response(JSON.stringify({ message: "slow down" }), {
        status: 429,
        headers: { "retry-after": "999999" },
      }),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch: cappedFetch,
      sleep: capped.sleep,
      maxRetries: 1,
      random: () => 1,
    }),
    CohereRequestError,
  );
  assert.deepEqual(capped.slept, [60_000]);

  const invalid = recordingSleep();
  const { fetch: invalidFetch } = recordingFetch(
    () =>
      new Response(JSON.stringify({ message: "slow down" }), {
        status: 429,
        headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      }),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch: invalidFetch,
      sleep: invalid.sleep,
      maxRetries: 1,
      random: () => 0.5,
      initialRetryDelayMs: 500,
    }),
    CohereRequestError,
  );
  assert.deepEqual(invalid.slept, [375]);
});

test("bounds exponential backoff by the configured ceiling", async () => {
  const { sleep, slept } = recordingSleep();
  const { fetch } = recordingFetch(
    () => new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch,
      sleep,
      maxRetries: 2,
      initialRetryDelayMs: 1_000,
      maxRetryDelayMs: 1_500,
      random: () => 1,
    }),
    CohereRequestError,
  );
  assert.deepEqual(slept, [1_000, 1_500]);
});

test("classifies a timeout distinctly from a caller abort", async () => {
  const { sleep } = recordingSleep();
  const fetchStub: typeof globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted by timeout")),
        { once: true },
      );
    });

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch: fetchStub,
      timeoutMs: 20,
      maxRetries: 0,
      sleep,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.attempts, 1);
      return true;
    },
  );
});

test("does not leak the API key or an upstream body", async () => {
  const upstreamBody = `cohere diagnostics ${TEST_ENV.COHERE_API_KEY}`;
  const { fetch } = recordingFetch(
    () => new Response(upstreamBody, { status: 401 }),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], { env: TEST_ENV, fetch }),
    (error: unknown) => {
      assert.ok(error instanceof CohereRequestError);
      assert.equal(error.status, 401);
      assert.ok(!String(error).includes(TEST_ENV.COHERE_API_KEY));
      assert.ok(!String(error).includes(upstreamBody));
      assert.ok(!String(error).includes("Bearer"));
      return true;
    },
  );
});

test("cancels an unread rejection body without reading it", async () => {
  let bodyWasCancelled = false;
  const { fetch } = recordingFetch(
    () =>
      new Response(
        new ReadableStream({
          cancel() {
            bodyWasCancelled = true;
          },
        }),
        { status: 500 },
      ),
  );

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], {
      env: TEST_ENV,
      fetch,
      maxRetries: 0,
    }),
    CohereRequestError,
  );
  assert.equal(bodyWasCancelled, true);
});

test("rejects invalid chunk identities before any network IO", async () => {
  const { fetch, requests } = recordingFetch(() => embedResponse([vector()]));
  const cases: Array<[string, KnowledgeChunkText[]]> = [
    ["duplicate index", [chunk(0), chunk(0)]],
    ["negative index", [{ ...chunk(0), chunkIndex: -1 }]],
    ["fractional index", [{ ...chunk(0), chunkIndex: 0.5 }]],
    ["blank content", [{ ...chunk(0), content: "   " }]],
    ["invalid content hash", [{ ...chunk(0), contentSha256: "not-a-sha" }]],
    [
      "uppercase content hash",
      [{ ...chunk(0), contentSha256: "AB".repeat(32) }],
    ],
  ];

  for (const [label, chunks] of cases) {
    await assert.rejects(
      embedKnowledgeChunkTexts(chunks, { env: TEST_ENV, fetch }),
      CohereInputError,
      label,
    );
  }
  assert.equal(requests.length, 0);
});

test("returns no embeddings and issues no request for an empty chunk list", async () => {
  const { fetch, requests } = recordingFetch(() => embedResponse([]));

  const result = await embedKnowledgeChunkTexts([], { env: TEST_ENV, fetch });

  assert.deepEqual(result, []);
  assert.equal(requests.length, 0);
});

test("fails closed on missing or unusable Cohere configuration", async () => {
  const { fetch, requests } = recordingFetch(() => embedResponse([vector()]));

  await assert.rejects(
    embedKnowledgeChunkTexts([chunk(0)], { env: {}, fetch }),
    (error: unknown) => {
      assert.ok(error instanceof CohereConfigurationError);
      assert.match(error.message, /COHERE_API_KEY is required/);
      return true;
    },
  );

  const invalidOptions = [
    { maxRetries: 6 },
    { maxRetries: -1 },
    { timeoutMs: 0 },
    { initialRetryDelayMs: 5_000, maxRetryDelayMs: 1_000 },
    { maxRetryAfterMs: 120_000 },
  ];

  for (const options of invalidOptions) {
    await assert.rejects(
      embedKnowledgeChunkTexts([chunk(0)], {
        env: TEST_ENV,
        fetch,
        ...options,
      }),
      CohereConfigurationError,
      JSON.stringify(options),
    );
  }
  assert.equal(requests.length, 0);
});

test("keeps the stored embedding model identifier aligned with the API contract", () => {
  assert.equal(
    `cohere/${COHERE_EMBED_MODEL}@${COHERE_EMBED_OUTPUT_DIMENSION}`,
    COHERE_EMBEDDING_MODEL,
  );
});
