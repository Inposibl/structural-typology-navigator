import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildOriginalFileStoragePath } from "../../src/lib/knowledge/persistence/storage-path.ts";
import {
  DEFAULT_STORAGE_TIMEOUT_MS,
  MAX_STANDARD_UPLOAD_BYTES,
  StorageConfigurationError,
  StorageIdentityConflictError,
  StorageKeyRejectedError,
  StorageObjectMissingError,
  StorageRequestError,
  StorageUploadLimitError,
  StorageUploadRejectedError,
  uploadOrVerifyOriginalFile,
  verifyExistingOriginalFile,
} from "../../src/lib/knowledge/storage/original-file.ts";
import {
  SupabaseConfigurationError,
  type SupabaseServerEnvironment,
} from "../../src/lib/supabase/server/http-client.ts";

const TEST_ENV: SupabaseServerEnvironment = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test_not_real",
};

const NORMALIZED_SHA = "a".repeat(64);
const OBJECT_PATH = buildOriginalFileStoragePath(
  "academy-course",
  NORMALIZED_SHA,
  "Курс № 1.md",
);
const OBJECT_URL = `https://example.supabase.co/storage/v1/object/academy-knowledge/${OBJECT_PATH.split("/")
  .map((segment) => encodeURIComponent(segment))
  .join("/")}`;

const CONTENT_TYPE = "text/markdown";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function uploadOptions(
  bytes: Uint8Array,
  overrides: Partial<Parameters<typeof uploadOrVerifyOriginalFile>[0]> = {},
): Parameters<typeof uploadOrVerifyOriginalFile>[0] {
  return {
    bucket: "academy-knowledge",
    path: OBJECT_PATH,
    bytes,
    contentType: CONTENT_TYPE,
    normalizedDocumentSha256: NORMALIZED_SHA,
    env: TEST_ENV,
    ...overrides,
  };
}

const EXISTING_OBJECT_BODY = JSON.stringify({
  statusCode: "409",
  error: "Duplicate",
  message: "The resource already exists",
  code: "KeyAlreadyExists",
});

type RecordedRequest = { url: string; method: string; init: RequestInit };

function recordingFetch(
  handler: (request: RecordedRequest) => Response | Promise<Response>,
): { fetch: typeof globalThis.fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      init: init ?? {},
    };
    requests.push(request);
    return handler(request);
  };
  return { fetch: fetchStub, requests };
}

function uploadedResponse(): Response {
  return Response.json({
    Key: "academy-knowledge/object",
    Id: "11111111-1111-4111-8111-111111111111",
  });
}

test("hashes the exact raw bytes instead of the normalized document content", async () => {
  const bytes = bytesOf("\uFEFF# Раздел\r\n\r\nПервый абзац.\r\n");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  const result = await uploadOrVerifyOriginalFile(
    uploadOptions(bytes, { fetch }),
  );

  assert.equal(result.status, "uploaded");
  assert.equal(result.originalFileSha256, sha256OfBytes(bytes));
  assert.equal(result.byteLength, bytes.byteLength);
  assert.notEqual(result.originalFileSha256, NORMALIZED_SHA);

  const sentBytes = requests[0].init.body as unknown as Uint8Array;
  assert.deepEqual(Array.from(sentBytes), Array.from(bytes));
});

test("distinguishes BOM-prefixed bytes from BOM-stripped bytes", async () => {
  const withBom = bytesOf("\uFEFFДокумент");
  const withoutBom = bytesOf("Документ");
  const { fetch } = recordingFetch(() => uploadedResponse());

  const first = await uploadOrVerifyOriginalFile(
    uploadOptions(withBom, { fetch }),
  );
  const second = await uploadOrVerifyOriginalFile(
    uploadOptions(withoutBom, { fetch }),
  );

  assert.notEqual(first.originalFileSha256, second.originalFileSha256);
  assert.equal(first.originalFileSha256, sha256OfBytes(withBom));
  assert.equal(second.originalFileSha256, sha256OfBytes(withoutBom));
});

test("uploads the first version with upsert disabled and the caller content type", async () => {
  const bytes = bytesOf("Первый вариант");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  const result = await uploadOrVerifyOriginalFile(
    uploadOptions(bytes, { fetch }),
  );

  assert.deepEqual(result, {
    status: "uploaded",
    originalFileSha256: sha256OfBytes(bytes),
    byteLength: bytes.byteLength,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, OBJECT_URL);
  assert.equal(requests[0].method, "POST");

  const headers = new Headers(requests[0].init.headers);
  assert.equal(headers.get("x-upsert"), "false");
  assert.equal(headers.get("content-type"), CONTENT_TYPE);
  assert.equal(headers.get("apikey"), TEST_ENV.SUPABASE_SECRET_KEY);
  assert.equal(headers.get("authorization"), null);
  assert.ok(
    requests.every((request) =>
      [...new Headers(request.init.headers)].every(
        ([name, value]) =>
          name.toLowerCase() !== "authorization" || !value.includes("sb_secret"),
      ),
    ),
  );
});

test("uploads to the ASCII physical key without percent encoding", async () => {
  const bytes = bytesOf("Синтетика");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  await uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch }));

  assert.equal(requests[0].url, OBJECT_URL);
  assert.ok(!requests[0].url.includes("%"), requests[0].url);
  assert.ok(!requests[0].url.includes(" "));
  assert.match(
    requests[0].url,
    /\/storage\/v1\/object\/academy-knowledge\/sources\/[A-Za-z0-9._-]+\/[0-9a-f]{64}\/[A-Za-z0-9._-]+$/u,
  );
});

test("fails closed before any request when a caller bypasses the path builder", async () => {
  const bytes = bytesOf("Синтетика");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());
  const bypassedPath = `sources/синтетический-курс/${NORMALIZED_SHA}/Лекция № 1.md`;

  await assert.rejects(
    uploadOrVerifyOriginalFile(
      uploadOptions(bytes, { fetch, path: bypassedPath }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof StorageConfigurationError);
      assert.match(error.message, /ascii-segment/u);
      return true;
    },
  );
  assert.equal(requests.length, 0);
});

test("accepts a payload exactly at the standard upload ceiling", async () => {
  const bytes = new Uint8Array(MAX_STANDARD_UPLOAD_BYTES).fill(7);
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  const result = await uploadOrVerifyOriginalFile(
    uploadOptions(bytes, { fetch }),
  );

  assert.equal(result.byteLength, MAX_STANDARD_UPLOAD_BYTES);
  assert.equal(result.originalFileSha256, sha256OfBytes(bytes));
  assert.equal(requests.length, 1);
});

test("rejects a payload above the ceiling before any network IO", async () => {
  const bytes = new Uint8Array(MAX_STANDARD_UPLOAD_BYTES + 1).fill(7);
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageUploadLimitError);
      assert.equal(error.code, "STORAGE_UPLOAD_LIMIT_EXCEEDED");
      assert.equal(error.byteLength, MAX_STANDARD_UPLOAD_BYTES + 1);
      assert.equal(error.maxByteLength, MAX_STANDARD_UPLOAD_BYTES);
      assert.ok(!error.message.includes(TEST_ENV.SUPABASE_SECRET_KEY!));
      return true;
    },
  );
  assert.equal(requests.length, 0);
});

test("returns already_present when the stored bytes are identical", async () => {
  const bytes = bytesOf("Идентичные байты");
  const { fetch, requests } = recordingFetch((request) =>
    request.method === "POST"
      ? new Response(EXISTING_OBJECT_BODY, { status: 400 })
      : new Response(bytes as unknown as BodyInit, { status: 200 }),
  );

  const result = await uploadOrVerifyOriginalFile(
    uploadOptions(bytes, { fetch }),
  );

  assert.deepEqual(result, {
    status: "already_present",
    originalFileSha256: sha256OfBytes(bytes),
    byteLength: bytes.byteLength,
  });
  assert.deepEqual(
    requests.map((request) => request.method),
    ["POST", "GET"],
  );
  assert.equal(requests[1].url, OBJECT_URL);
  assert.equal(
    new Headers(requests[1].init.headers).get("apikey"),
    TEST_ENV.SUPABASE_SECRET_KEY,
  );
});

test("fails closed when the stored bytes differ and never overwrites them", async () => {
  const bytes = bytesOf("Новый оригинал");
  const storedBytes = bytesOf("Чужой объект");
  const { fetch, requests } = recordingFetch((request) =>
    request.method === "POST"
      ? new Response(EXISTING_OBJECT_BODY, { status: 400 })
      : new Response(storedBytes as unknown as BodyInit, { status: 200 }),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageIdentityConflictError);
      assert.equal(error.code, "STORAGE_IDENTITY_CONFLICT");
      assert.equal(error.storedFileSha256, sha256OfBytes(storedBytes));
      assert.equal(error.incomingFileSha256, sha256OfBytes(bytes));
      assert.equal(error.path, OBJECT_PATH);
      return true;
    },
  );

  assert.deepEqual(
    requests.map((request) => request.method),
    ["POST", "GET"],
  );
  const overwriteHeaders = requests
    .map((request) => new Headers(request.init.headers).get("x-upsert"))
    .filter((value) => value !== null);
  assert.deepEqual(overwriteHeaders, ["false"]);
});

test("treats any other existing-object rejection as an upstream failure", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch, requests } = recordingFetch(
    () => new Response(JSON.stringify({ code: "InvalidRequest" }), { status: 400 }),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.code, "UPSTREAM_ERROR");
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(requests.length, 1);
});

test("reports a standard upload size rejection distinctly", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch } = recordingFetch(
    () =>
      new Response(JSON.stringify({ code: "EntityTooLarge" }), { status: 413 }),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageUploadRejectedError);
      assert.equal(error.code, "STORAGE_UPLOAD_REJECTED");
      assert.equal(error.status, 413);
      return true;
    },
  );
});

test("reports a rejected object key distinctly from an upstream failure", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch, requests } = recordingFetch(
    () =>
      new Response(
        JSON.stringify({
          statusCode: "400",
          error: "InvalidKey",
          message: `Invalid key: ${OBJECT_PATH}`,
          code: "InvalidKey",
        }),
        { status: 400 },
      ),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageKeyRejectedError);
      assert.equal(error.code, "STORAGE_KEY_REJECTED");
      assert.equal(error.path, OBJECT_PATH);
      return true;
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
});

test("refuses to buffer a stored object that cannot match the incoming bytes", async () => {
  const bytes = bytesOf("Короткий оригинал");
  let bodyWasCancelled = false;
  const { fetch } = recordingFetch((request) => {
    if (request.method === "POST") {
      return new Response(EXISTING_OBJECT_BODY, { status: 400 });
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(64));
        },
        cancel() {
          bodyWasCancelled = true;
        },
      }),
      { status: 200 },
    );
  });

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageIdentityConflictError);
      assert.equal(error.storedFileSha256, null);
      return true;
    },
  );
  assert.ok(bodyWasCancelled);
});

test("rejects a stored object whose declared length differs from the incoming bytes", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch } = recordingFetch((request) =>
    request.method === "POST"
      ? new Response(EXISTING_OBJECT_BODY, { status: 400 })
      : new Response("x", {
          status: 200,
          headers: { "content-length": String(bytes.byteLength + 10) },
        }),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    StorageIdentityConflictError,
  );
});

test("fails closed when the stored object cannot be read", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch } = recordingFetch((request) =>
    request.method === "POST"
      ? new Response(EXISTING_OBJECT_BODY, { status: 400 })
      : new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.code, "UPSTREAM_ERROR");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("classifies a timeout while waiting for the upload response", async () => {
  const bytes = bytesOf("Оригинал");
  const fetchStub: typeof globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted by timeout")),
        { once: true },
      );
    });

  await assert.rejects(
    uploadOrVerifyOriginalFile(
      uploadOptions(bytes, { fetch: fetchStub, timeoutMs: 20 }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.status, null);
      return true;
    },
  );
});

test(
  "keeps the timeout active while the stored object body is read",
  { timeout: 1_000 },
  async () => {
    const bytes = bytesOf("Оригинал");
    const fetchStub: typeof globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        return new Response(EXISTING_OBJECT_BODY, { status: 400 });
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new Error("aborted by timeout")),
              { once: true },
            );
          },
        }),
      } as Response;
    };

    await assert.rejects(
      uploadOrVerifyOriginalFile(
        uploadOptions(bytes, { fetch: fetchStub, timeoutMs: 20 }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof StorageRequestError);
        assert.equal(error.code, "TIMEOUT");
        return true;
      },
    );
  },
);

test("passes a caller abort through and classifies it distinctly", async () => {
  const bytes = bytesOf("Оригинал");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    uploadOrVerifyOriginalFile(
      uploadOptions(bytes, {
        signal: controller.signal,
        fetch: async (_input, init) => {
          assert.equal(init?.signal?.aborted, true);
          throw new Error("aborted by test");
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.code, "ABORTED");
      assert.ok(!error.message.includes(TEST_ENV.SUPABASE_SECRET_KEY!));
      return true;
    },
  );
});

test("does not leak the secret key or an upstream body on failure", async () => {
  const bytes = bytesOf("Оригинал");
  const upstreamBody = `storage diagnostics ${TEST_ENV.SUPABASE_SECRET_KEY}`;
  const { fetch } = recordingFetch(
    () => new Response(upstreamBody, { status: 500 }),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.status, 500);
      assert.ok(!String(error).includes(TEST_ENV.SUPABASE_SECRET_KEY!));
      assert.ok(!String(error).includes(upstreamBody));
      return true;
    },
  );
});

test("cancels the upload response body instead of buffering it", async () => {
  const bytes = bytesOf("Оригинал");
  let bodyWasCancelled = false;
  const { fetch } = recordingFetch(
    () =>
      new Response(
        new ReadableStream({
          cancel() {
            bodyWasCancelled = true;
          },
        }),
        { status: 200 },
      ),
  );

  const result = await uploadOrVerifyOriginalFile(
    uploadOptions(bytes, { fetch }),
  );

  assert.equal(result.status, "uploaded");
  assert.equal(bodyWasCancelled, true);
});

test("bounds an oversized rejection body instead of parsing it", async () => {
  const bytes = bytesOf("Оригинал");
  let bodyWasCancelled = false;
  const { fetch } = recordingFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(16 * 1024));
          },
          cancel() {
            bodyWasCancelled = true;
          },
        }),
        { status: 500 },
      ),
  );

  await assert.rejects(
    uploadOrVerifyOriginalFile(uploadOptions(bytes, { fetch })),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.code, "UPSTREAM_ERROR");
      assert.equal(error.status, 500);
      return true;
    },
  );
  assert.equal(bodyWasCancelled, true);
});

test("verifies an existing object without ever writing to Storage", async () => {
  const bytes = bytesOf("Существующий оригинал");
  const { fetch, requests } = recordingFetch(
    () => new Response(bytes as unknown as BodyInit, { status: 200 }),
  );

  const result = await verifyExistingOriginalFile({
    bucket: "academy-knowledge",
    path: OBJECT_PATH,
    bytes,
    normalizedDocumentSha256: NORMALIZED_SHA,
    env: TEST_ENV,
    fetch,
  });

  assert.deepEqual(result, {
    status: "verified",
    originalFileSha256: sha256OfBytes(bytes),
    byteLength: bytes.byteLength,
  });
  assert.deepEqual(
    requests.map((request) => request.method),
    ["GET"],
  );
  assert.equal(requests[0].url, OBJECT_URL);
});

test("reports a missing object from the real Storage not-found body", async () => {
  const bytes = bytesOf("Оригинал");
  const notFoundBody = JSON.stringify({
    statusCode: "404",
    error: "not_found",
    message: "Object not found",
    code: "NoSuchKey",
  });
  const { fetch } = recordingFetch(
    () => new Response(notFoundBody, { status: 400 }),
  );

  await assert.rejects(
    verifyExistingOriginalFile({
      bucket: "academy-knowledge",
      path: OBJECT_PATH,
      bytes,
      normalizedDocumentSha256: NORMALIZED_SHA,
      env: TEST_ENV,
      fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StorageObjectMissingError);
      assert.equal(error.code, "STORAGE_OBJECT_MISSING");
      assert.equal(error.path, OBJECT_PATH);
      return true;
    },
  );
});

test("reports a missing object from a plain 404 and fails closed on other errors", async () => {
  const bytes = bytesOf("Оригинал");

  const { fetch: notFoundFetch } = recordingFetch(
    () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
  );
  await assert.rejects(
    verifyExistingOriginalFile({
      bucket: "academy-knowledge",
      path: OBJECT_PATH,
      bytes,
      normalizedDocumentSha256: NORMALIZED_SHA,
      env: TEST_ENV,
      fetch: notFoundFetch,
    }),
    StorageObjectMissingError,
  );

  const { fetch: upstreamFetch } = recordingFetch(
    () => new Response("storage exploded", { status: 500 }),
  );
  await assert.rejects(
    verifyExistingOriginalFile({
      bucket: "academy-knowledge",
      path: OBJECT_PATH,
      bytes,
      normalizedDocumentSha256: NORMALIZED_SHA,
      env: TEST_ENV,
      fetch: upstreamFetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StorageRequestError);
      assert.equal(error.code, "UPSTREAM_ERROR");
      assert.equal(error.status, 500);
      return true;
    },
  );
});

test("rejects different stored bytes during read-only verification", async () => {
  const bytes = bytesOf("original-bytes-1");
  const storedBytes = bytesOf("original-bytes-2");
  assert.equal(storedBytes.byteLength, bytes.byteLength);
  const { fetch, requests } = recordingFetch(
    () => new Response(storedBytes as unknown as BodyInit, { status: 200 }),
  );

  await assert.rejects(
    verifyExistingOriginalFile({
      bucket: "academy-knowledge",
      path: OBJECT_PATH,
      bytes,
      normalizedDocumentSha256: NORMALIZED_SHA,
      env: TEST_ENV,
      fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StorageIdentityConflictError);
      assert.equal(error.storedFileSha256, sha256OfBytes(storedBytes));
      assert.equal(error.incomingFileSha256, sha256OfBytes(bytes));
      return true;
    },
  );
  assert.ok(
    requests.every((request) => request.method === "GET"),
    JSON.stringify(requests.map((request) => request.method)),
  );
});

test("fails closed on invalid arguments before any request", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  await assert.rejects(
    verifyExistingOriginalFile({
      bucket: "academy-knowledge",
      path: `sources/синтетический-курс/${NORMALIZED_SHA}/Лекция.md`,
      bytes,
      normalizedDocumentSha256: NORMALIZED_SHA,
      env: TEST_ENV,
      fetch,
    }),
    StorageConfigurationError,
  );
  assert.equal(requests.length, 0);
});

test("fails closed on invalid arguments before any network IO", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());
  const cases: Array<[string, Parameters<typeof uploadOrVerifyOriginalFile>[0]]> = [
    ["wrong bucket", uploadOptions(bytes, { fetch, bucket: "public-bucket" })],
    ["blank path", uploadOptions(bytes, { fetch, path: "" })],
    [
      "path without the normalized hash segment",
      uploadOptions(bytes, {
        fetch,
        path: buildOriginalFileStoragePath(
          "academy-course",
          "b".repeat(64),
          "Курс.md",
        ),
      }),
    ],
    [
      "traversal path",
      uploadOptions(bytes, { fetch, path: `sources/a/../${NORMALIZED_SHA}/x.md` }),
    ],
    [
      "normalized sha of the wrong shape",
      uploadOptions(bytes, { fetch, normalizedDocumentSha256: "not-a-sha" }),
    ],
    ["blank content type", uploadOptions(bytes, { fetch, contentType: "   " })],
    ["empty bytes", uploadOptions(new Uint8Array(0), { fetch })],
  ];

  for (const [label, options] of cases) {
    await assert.rejects(
      uploadOrVerifyOriginalFile(options),
      StorageConfigurationError,
      label,
    );
  }
  assert.equal(requests.length, 0);
});

test("fails closed when the server configuration is missing", async () => {
  const bytes = bytesOf("Оригинал");

  await assert.rejects(
    uploadOrVerifyOriginalFile(
      uploadOptions(bytes, { env: { SUPABASE_URL: TEST_ENV.SUPABASE_URL } }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof SupabaseConfigurationError);
      assert.match(error.message, /SUPABASE_SECRET_KEY is required/);
      return true;
    },
  );
});

test("rejects an unusable timeout before any network IO", async () => {
  const bytes = bytesOf("Оригинал");
  const { fetch, requests } = recordingFetch(() => uploadedResponse());

  await assert.rejects(
    uploadOrVerifyOriginalFile(
      uploadOptions(bytes, { fetch, timeoutMs: 0 }),
    ),
    StorageConfigurationError,
  );
  assert.equal(requests.length, 0);
  assert.equal(DEFAULT_STORAGE_TIMEOUT_MS, 30_000);
});
