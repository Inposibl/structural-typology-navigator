
import { createSupabaseServerClient } from "../../supabase/server/http-client.ts";
import { embedKnowledgeQuery } from "../embeddings/cohere-query.ts";
import {
  listActiveCourseSourceBindings,
  type CourseSourceBinding,
  type CourseSourceAuthorityRelation,
} from "./course-source-bindings.ts";

export type CourseKnowledgeMatch = {
  chunkId: number;
  documentId: string;
  sourceId: string;
  courseId: string;
  sourceSlug: string;
  sourceTitle: string;
  sourceKind: string;
  authorityRelation: CourseSourceAuthorityRelation;
  courseSourceMetadata: Record<string, unknown>;
  sourceMetadata: Record<string, unknown>;
  documentMetadata: Record<string, unknown>;
  content: string;
  contentSha256: string | null;
  headingPath: string[];
  locator: Record<string, unknown>;
  chunkMetadata: Record<string, unknown>;
  similarity: number;
};

type RpcRow = {
  chunk_id: number;
  document_id: string;
  source_id: string;
  course_id: string;
  source_slug: string;
  source_title: string;
  source_kind: string;
  authority_relation: CourseSourceAuthorityRelation;
  course_source_metadata: Record<string, unknown> | null;
  source_metadata: Record<string, unknown> | null;
  document_metadata: Record<string, unknown> | null;
  content: string;
  content_sha256: string | null;
  heading_path: string[];
  locator: Record<string, unknown> | null;
  chunk_metadata: Record<string, unknown> | null;
  similarity: number;
};

export type RetrieveCourseKnowledgeResult = {
  hasActiveSources: boolean;
  bindings: CourseSourceBinding[];
  matches: CourseKnowledgeMatch[];
};

export type RetrieveCourseKnowledgeDependencies = {
  listBindings?: typeof listActiveCourseSourceBindings;
  embedQuery?: typeof embedKnowledgeQuery;
};

export type RetrieveCourseKnowledgeOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  matchThreshold?: number;
  matchCount?: number;
  dependencies?: RetrieveCourseKnowledgeDependencies;
};

export class CourseKnowledgeRetrievalError extends Error {
  readonly code = "COURSE_KNOWLEDGE_RETRIEVAL_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CourseKnowledgeRetrievalError";
  }
}

function normalizeCourseId(value: string): string {
  const courseId = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/u.test(courseId)) {
    throw new CourseKnowledgeRetrievalError("courseId is invalid.");
  }
  return courseId;
}

function normalizeMatchCount(value: number | undefined): number {
  const count = value ?? 12;
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new CourseKnowledgeRetrievalError(
      "matchCount must be an integer between 1 and 50.",
    );
  }
  return count;
}

function normalizeThreshold(value: number | undefined): number {
  const threshold = value ?? -1;
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    throw new CourseKnowledgeRetrievalError(
      "matchThreshold must be between -1 and 1.",
    );
  }
  return threshold;
}

function normalizeRow(
  row: RpcRow,
  expectedCourseId: string,
): CourseKnowledgeMatch {
  if (
    !Number.isInteger(row.chunk_id) ||
    typeof row.document_id !== "string" ||
    typeof row.source_id !== "string" ||
    row.course_id !== expectedCourseId ||
    typeof row.source_slug !== "string" ||
    typeof row.source_title !== "string" ||
    typeof row.source_kind !== "string" ||
    typeof row.content !== "string" ||
    !Array.isArray(row.heading_path) ||
    typeof row.similarity !== "number" ||
    !Number.isFinite(row.similarity)
  ) {
    throw new CourseKnowledgeRetrievalError(
      "Supabase returned an invalid course knowledge match.",
    );
  }

  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    sourceId: row.source_id,
    courseId: row.course_id,
    sourceSlug: row.source_slug,
    sourceTitle: row.source_title,
    sourceKind: row.source_kind,
    authorityRelation: row.authority_relation,
    courseSourceMetadata: row.course_source_metadata ?? {},
    sourceMetadata: row.source_metadata ?? {},
    documentMetadata: row.document_metadata ?? {},
    content: row.content,
    contentSha256: row.content_sha256,
    headingPath: row.heading_path,
    locator: row.locator ?? {},
    chunkMetadata: row.chunk_metadata ?? {},
    similarity: row.similarity,
  };
}

export async function retrieveCourseKnowledge(
  courseIdInput: string,
  queryInput: string,
  options: RetrieveCourseKnowledgeOptions = {},
): Promise<RetrieveCourseKnowledgeResult> {
  const courseId = normalizeCourseId(courseIdInput);
  const query = queryInput.trim();

  if (!query) {
    throw new CourseKnowledgeRetrievalError("query cannot be blank.");
  }

  const listBindings =
    options.dependencies?.listBindings ?? listActiveCourseSourceBindings;
  const embedQuery = options.dependencies?.embedQuery ?? embedKnowledgeQuery;

  const bindings = await listBindings(courseId, {
    env: options.env,
    fetch: options.fetch,
    signal: options.signal,
  });

  if (bindings.length === 0) {
    return {
      hasActiveSources: false,
      bindings: [],
      matches: [],
    };
  }

  const queryEmbedding = await embedQuery(query, {
    env: options.env,
    fetch: options.fetch,
    signal: options.signal,
  });

  if (
    !Array.isArray(queryEmbedding) ||
    queryEmbedding.length !== 1024 ||
    queryEmbedding.some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    throw new CourseKnowledgeRetrievalError(
      "Query embedding must contain exactly 1024 finite numbers.",
    );
  }

  const client = createSupabaseServerClient({
    env: options.env,
    fetch: options.fetch,
  });

  const rows = await client.requestJson<RpcRow[]>(
    "/rest/v1/rpc/match_course_knowledge_chunks",
    {
      method: "POST",
      body: JSON.stringify({
        p_course_id: courseId,
        p_query_embedding: queryEmbedding,
        p_match_threshold: normalizeThreshold(options.matchThreshold),
        p_match_count: normalizeMatchCount(options.matchCount),
      }),
      signal: options.signal,
    },
  );

  if (!Array.isArray(rows)) {
    throw new CourseKnowledgeRetrievalError(
      "Supabase returned a non-array course retrieval payload.",
    );
  }

  return {
    hasActiveSources: true,
    bindings,
    matches: rows.map((row) => normalizeRow(row, courseId)),
  };
}
