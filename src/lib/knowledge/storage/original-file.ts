import { createHash } from "node:crypto";

import { isSha256Hex } from "../../ingestion/index.ts";
import {
  readSupabaseServerConfig,
  type SupabaseServerEnvironment,
} from "../../supabase/server/http-client.ts";
import {
  ACADEMY_KNOWLEDGE_BUCKET,
  isDeterministicOriginalFileStoragePath,
} from "../persistence/storage-path.ts";
import {
  createRequestSignal,
  type ServerRequestSignal,
} from "../transport/request-signal.ts";

// Supabase documents standard uploads as suitable up to 6 MB and recommends
// resumable (TUS) uploads above that, so this client refuses larger payloads
// instead of silently degrading to a single-shot request.
export const MAX_STANDARD_UPLOAD_BYTES = 6 * 1024 * 1024;

export const DEFAULT_STORAGE_TIMEOUT_MS = 30_000;

const STORAGE_OBJECT_PATH = "/storage/v1/object";

// Storage failure bodies are small JSON markers such as {"code":
// "KeyAlreadyExists"}; anything larger is not parsed at all.
const MAX_FAILURE_BODY_BYTES = 8 * 1024;

export type StorageRequestErrorCode =
  | "ABORTED"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UPSTREAM_ERROR";

export class StorageConfigurationError extends Error {
  readonly code = "STORAGE_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export class StorageUploadLimitError extends Error {
  readonly code = "STORAGE_UPLOAD_LIMIT_EXCEEDED";
  readonly byteLength: number;
  readonly maxByteLength: number;

  constructor(byteLength: number, maxByteLength: number) {
    super(
      `Original file of ${byteLength} bytes exceeds the ${maxByteLength} byte standard upload limit.`,
    );
    this.name = "StorageUploadLimitError";
    this.byteLength = byteLength;
    this.maxByteLength = maxByteLength;
  }
}

export class StorageUploadRejectedError extends Error {
  readonly code = "STORAGE_UPLOAD_REJECTED";
  readonly status: number;

  constructor(status: number) {
    super("Storage rejected the standard upload of the original file.");
    this.name = "StorageUploadRejectedError";
    this.status = status;
  }
}

// Storage rejects object keys outside its accepted character set, which is
// reachable whenever a deterministic path carries a non-ASCII filename.
export class StorageKeyRejectedError extends Error {
  readonly code = "STORAGE_KEY_REJECTED";
  readonly path: string;

  constructor(path: string) {
    super(`Storage rejected the object key ${path}.`);
    this.name = "StorageKeyRejectedError";
    this.path = path;
  }
}

// Raised by read-only verification when the expected object is absent. A ready
// document never repairs its own Storage state.
export class StorageObjectMissingError extends Error {
  readonly code = "STORAGE_OBJECT_MISSING";
  readonly path: string;

  constructor(path: string) {
    super(`Stored original file ${path} does not exist.`);
    this.name = "StorageObjectMissingError";
    this.path = path;
  }
}

export class StorageIdentityConflictError extends Error {  readonly code = "STORAGE_IDENTITY_CONFLICT";
  readonly path: string;
  readonly storedFileSha256: string | null;
  readonly incomingFileSha256: string;

  constructor(
    path: string,
    storedFileSha256: string | null,
    incomingFileSha256: string,
  ) {
    super(
      storedFileSha256 === null
        ? `Stored object at ${path} holds different bytes than the incoming original file (stored bytes do not match ${incomingFileSha256}).`
        : `Stored object at ${path} holds different bytes than the incoming original file (stored ${storedFileSha256}, incoming ${incomingFileSha256}).`,
    );
    this.name = "StorageIdentityConflictError";
    this.path = path;
    this.storedFileSha256 = storedFileSha256;
    this.incomingFileSha256 = incomingFileSha256;
  }
}

export class StorageRequestError extends Error {
  readonly code: StorageRequestErrorCode;
  readonly status: number | null;

  constructor(
    code: StorageRequestErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "StorageRequestError";
    this.code = code;
    this.status = status;
  }
}

export type UploadOrVerifyOriginalFileOptions = {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  normalizedDocumentSha256: string;
  env?: SupabaseServerEnvironment;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type OriginalFileStorageResult = {
  status: "uploaded" | "already_present";
  originalFileSha256: string;
  byteLength: number;
};

type StorageFailureBody = {
  code?: unknown;
  error?: unknown;
  statusCode?: unknown;
};

function sha256HexOfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// lib.dom types BodyInit as ArrayBuffer-backed views while Node's Buffer is
// typed as ArrayBufferLike-backed; fetch uploads the exact view range either
// way, so the only difference is the type declaration.
function toUploadBody(bytes: Uint8Array): BodyInit {
  return bytes as unknown as BodyInit;
}

// Mirrors the physical key contract produced by the application path builder:
// the third segment is the normalized document hash and every other segment
// stays inside the Supabase-safe ASCII class.
function assertDeterministicStoragePath(
  path: string,
  normalizedDocumentSha256: string,
): void {
  if (!isDeterministicOriginalFileStoragePath(path, normalizedDocumentSha256)) {
    throw new StorageConfigurationError(
      "path must use the deterministic sources/<ascii-segment>/<sha256>/<ascii-segment> original file contract.",
    );
  }
}

type OriginalFileKeyRequest = {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  normalizedDocumentSha256: string;
};

function assertOriginalFileKeyRequest(options: OriginalFileKeyRequest): void {
  if (options.bucket !== ACADEMY_KNOWLEDGE_BUCKET) {
    throw new StorageConfigurationError(
      `Original files may only be uploaded to the ${ACADEMY_KNOWLEDGE_BUCKET} bucket.`,
    );
  }

  if (typeof options.path !== "string" || options.path.length === 0) {
    throw new StorageConfigurationError("path is required.");
  }
  assertDeterministicStoragePath(options.path, options.normalizedDocumentSha256);

  if (!isSha256Hex(options.normalizedDocumentSha256)) {
    throw new StorageConfigurationError(
      "normalizedDocumentSha256 must be a lowercase SHA-256 value.",
    );
  }

  if (!(options.bytes instanceof Uint8Array)) {
    throw new StorageConfigurationError("bytes must be a Uint8Array.");
  }

  if (options.bytes.byteLength === 0) {
    throw new StorageConfigurationError("bytes must contain at least one byte.");
  }

  if (options.bytes.byteLength > MAX_STANDARD_UPLOAD_BYTES) {
    throw new StorageUploadLimitError(
      options.bytes.byteLength,
      MAX_STANDARD_UPLOAD_BYTES,
    );
  }
}

function assertUploadRequest(options: UploadOrVerifyOriginalFileOptions): void {
  assertOriginalFileKeyRequest(options);

  if (
    typeof options.contentType !== "string" ||
    options.contentType.trim().length === 0
  ) {
    throw new StorageConfigurationError(
      "contentType is required and cannot be blank.",
    );
  }
}

function assertFetchAndTimeout(
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
): void {
  if (typeof fetchImplementation !== "function") {
    throw new StorageConfigurationError(
      "A server-side fetch implementation is required.",
    );
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new StorageConfigurationError("timeoutMs must be a positive integer.");
  }
}

function buildObjectUrl(baseUrl: string, bucket: string, path: string): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${baseUrl}${STORAGE_OBJECT_PATH}/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function classifyInterruption(
  requestSignal: ServerRequestSignal,
): StorageRequestError | null {
  if (!requestSignal.signal.aborted) {
    return null;
  }
  return new StorageRequestError(
    requestSignal.didTimeout() ? "TIMEOUT" : "ABORTED",
    requestSignal.didTimeout()
      ? "Storage request timed out."
      : "Storage request was aborted.",
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; the caller's outcome already stands.
  }
}

async function withStorageRequest<T>(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  control: { timeoutMs: number; externalSignal?: AbortSignal },
  consume: (
    response: Response,
    requestSignal: ServerRequestSignal,
  ) => Promise<T>,
): Promise<T> {
  const requestSignal = createRequestSignal(
    control.externalSignal,
    control.timeoutMs,
  );

  try {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        ...init,
        signal: requestSignal.signal,
      });
    } catch {
      throw (
        classifyInterruption(requestSignal) ??
        new StorageRequestError(
          "NETWORK_ERROR",
          "Storage request failed before receiving a response.",
        )
      );
    }

    return await consume(response, requestSignal);
  } finally {
    requestSignal.cleanup();
  }
}

function readDeclaredLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (header === null) {
    return null;
  }
  const declaredLength = Number(header);
  return Number.isInteger(declaredLength) && declaredLength >= 0
    ? declaredLength
    : null;
}

function parseFailureBody(text: string): StorageFailureBody | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as StorageFailureBody;
    }
    return null;
  } catch {
    return null;
  }
}

function isExistingObjectConflict(
  status: number,
  body: StorageFailureBody | null,
): boolean {
  if (status === 409) {
    return true;
  }
  if (status !== 400 || body === null) {
    return false;
  }
  return (
    body.code === "KeyAlreadyExists" ||
    body.statusCode === "409" ||
    body.statusCode === 409 ||
    body.error === "Duplicate"
  );
}

function isUploadSizeRejection(
  status: number,
  body: StorageFailureBody | null,
): boolean {
  return status === 413 || body?.code === "EntityTooLarge";
}

// Storage reports a missing object as HTTP 400 with an internal 404 marker, so
// the absence of an object is detected from the body rather than the status.
function isMissingObjectResponse(
  status: number,
  body: StorageFailureBody | null,
): boolean {
  if (status === 404) {
    return true;
  }
  if (status !== 400 || body === null) {
    return false;
  }
  return (
    body.code === "NoSuchKey" ||
    body.statusCode === "404" ||
    body.statusCode === 404 ||
    body.error === "not_found"
  );
}

function isKeyRejection(
  status: number,
  body: StorageFailureBody | null,
): boolean {
  return status === 400 && body?.code === "InvalidKey";
}

type UploadAttempt =
  | { outcome: "uploaded" }
  | { outcome: "existing_object" }
  | { outcome: "key_rejected" }
  | { outcome: "upload_rejected"; status: number }
  | { outcome: "failed"; status: number };

// Reads at most maxBytes bytes and reports null once the response body proves
// longer, so a foreign object stored at the deterministic path can never be
// buffered in full and rejection bodies stay bounded as well.
async function readBoundedBytes(
  response: Response,
  maxBytes: number,
  requestSignal: ServerRequestSignal,
): Promise<Uint8Array | null> {
  const declaredLength = readDeclaredLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelBody(response);
    return null;
  }

  if (response.body === null) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    const interruption = classifyInterruption(requestSignal);
    if (interruption !== null) {
      throw interruption;
    }
    throw new StorageRequestError(
      "INVALID_RESPONSE",
      "Storage response body could not be read.",
    );
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readFailureText(
  response: Response,
  requestSignal: ServerRequestSignal,
): Promise<string> {
  const failureBytes = await readBoundedBytes(
    response,
    MAX_FAILURE_BODY_BYTES,
    requestSignal,
  );
  return failureBytes === null
    ? ""
    : new TextDecoder().decode(failureBytes);
}

export async function uploadOrVerifyOriginalFile(
  options: UploadOrVerifyOriginalFileOptions,
): Promise<OriginalFileStorageResult> {
  assertUploadRequest(options);

  const originalFileSha256 = sha256HexOfBytes(options.bytes);
  const byteLength = options.bytes.byteLength;
  const config = readSupabaseServerConfig(options.env);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STORAGE_TIMEOUT_MS;

  assertFetchAndTimeout(fetchImplementation, timeoutMs);

  const objectUrl = buildObjectUrl(config.baseUrl, options.bucket, options.path);
  const control = { timeoutMs, externalSignal: options.signal };

  const uploadAttempt = await withStorageRequest<UploadAttempt>(
    fetchImplementation,
    objectUrl,
    {
      method: "POST",
      headers: {
        apikey: config.secretKey,
        "Content-Type": options.contentType,
        "x-upsert": "false",
        Accept: "application/json",
      },
      body: toUploadBody(options.bytes),
    },
    control,
    async (response, requestSignal) => {
      if (response.ok) {
        await cancelBody(response);
        return { outcome: "uploaded" };
      }

      const text = await readFailureText(response, requestSignal);

      const body = parseFailureBody(text);

      if (isExistingObjectConflict(response.status, body)) {
        return { outcome: "existing_object" };
      }
      if (isKeyRejection(response.status, body)) {
        return { outcome: "key_rejected" };
      }
      if (isUploadSizeRejection(response.status, body)) {
        return { outcome: "upload_rejected", status: response.status };
      }
      return { outcome: "failed", status: response.status };
    },
  );

  if (uploadAttempt.outcome === "uploaded") {
    return { status: "uploaded", originalFileSha256, byteLength };
  }

  if (uploadAttempt.outcome === "key_rejected") {
    throw new StorageKeyRejectedError(options.path);
  }

  if (uploadAttempt.outcome === "upload_rejected") {
    throw new StorageUploadRejectedError(uploadAttempt.status);
  }

  if (uploadAttempt.outcome === "failed") {
    throw new StorageRequestError(
      "UPSTREAM_ERROR",
      "Storage rejected the original file upload.",
      uploadAttempt.status,
    );
  }

  const storedBytes = await withStorageRequest<Uint8Array | null>(
    fetchImplementation,
    objectUrl,
    {
      method: "GET",
      headers: { apikey: config.secretKey },
    },
    control,
    async (response, requestSignal) => {
      if (!response.ok) {
        await cancelBody(response);
        throw new StorageRequestError(
          "UPSTREAM_ERROR",
          "Stored original file could not be read for verification.",
          response.status,
        );
      }

      // The stored object must be exactly as long as the incoming bytes; any
      // other length cannot be the same file.
      const declaredLength = readDeclaredLength(response);
      if (declaredLength !== null && declaredLength !== byteLength) {
        await cancelBody(response);
        return null;
      }

      return readBoundedBytes(response, byteLength, requestSignal);
    },
  );

  if (storedBytes === null) {
    throw new StorageIdentityConflictError(
      options.path,
      null,
      originalFileSha256,
    );
  }

  const storedFileSha256 = sha256HexOfBytes(storedBytes);
  if (storedFileSha256 !== originalFileSha256) {
    throw new StorageIdentityConflictError(
      options.path,
      storedFileSha256,
      originalFileSha256,
    );
  }

  return {
    status: "already_present",
    originalFileSha256,
    byteLength: storedBytes.byteLength,
  };
}

export type VerifyExistingOriginalFileOptions = {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  normalizedDocumentSha256: string;
  env?: SupabaseServerEnvironment;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type VerifiedOriginalFile = {
  status: "verified";
  originalFileSha256: string;
  byteLength: number;
};

// Read-only counterpart of uploadOrVerifyOriginalFile. It never uploads,
// overwrites, or deletes: the object must already exist and hold exactly the
// incoming bytes. Ready-state repair stays an operator concern.
export async function verifyExistingOriginalFile(
  options: VerifyExistingOriginalFileOptions,
): Promise<VerifiedOriginalFile> {
  assertOriginalFileKeyRequest(options);

  const originalFileSha256 = sha256HexOfBytes(options.bytes);
  const byteLength = options.bytes.byteLength;
  const config = readSupabaseServerConfig(options.env);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STORAGE_TIMEOUT_MS;

  assertFetchAndTimeout(fetchImplementation, timeoutMs);

  const storedBytes = await withStorageRequest<Uint8Array | null>(
    fetchImplementation,
    buildObjectUrl(config.baseUrl, options.bucket, options.path),
    {
      method: "GET",
      headers: { apikey: config.secretKey },
    },
    { timeoutMs, externalSignal: options.signal },
    async (response, requestSignal) => {
      if (!response.ok) {
        const failureBody = parseFailureBody(
          await readFailureText(response, requestSignal),
        );
        if (isMissingObjectResponse(response.status, failureBody)) {
          throw new StorageObjectMissingError(options.path);
        }
        throw new StorageRequestError(
          "UPSTREAM_ERROR",
          "Stored original file could not be read for verification.",
          response.status,
        );
      }

      const declaredLength = readDeclaredLength(response);
      if (declaredLength !== null && declaredLength !== byteLength) {
        await cancelBody(response);
        return null;
      }

      return readBoundedBytes(response, byteLength, requestSignal);
    },
  );

  if (storedBytes === null) {
    throw new StorageIdentityConflictError(
      options.path,
      null,
      originalFileSha256,
    );
  }

  const storedFileSha256 = sha256HexOfBytes(storedBytes);
  if (storedFileSha256 !== originalFileSha256) {
    throw new StorageIdentityConflictError(
      options.path,
      storedFileSha256,
      originalFileSha256,
    );
  }

  return {
    status: "verified",
    originalFileSha256,
    byteLength: storedBytes.byteLength,
  };
}
