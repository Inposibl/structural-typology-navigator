
import { createSupabaseServerClient } from "../../supabase/server/http-client.ts";

export const COURSE_SOURCE_AUTHORITY_RELATIONS = [
  "FOUNDATIONAL",
  "ELABORATION",
  "OPERATIONALIZATION",
  "PROPOSITION_SCOPED_CORRECTION",
  "EXTERNAL_RESEARCH",
  "SUPPLEMENTAL",
] as const;

export type CourseSourceAuthorityRelation =
  (typeof COURSE_SOURCE_AUTHORITY_RELATIONS)[number];

export type CourseSourceBinding = {
  courseId: string;
  sourceId: string;
  sourceSlug: string;
  sourceTitle: string;
  authorityRelation: CourseSourceAuthorityRelation;
  metadata: Record<string, unknown>;
};

type BindingRow = {
  course_id: string;
  source_id: string;
  authority_relation: CourseSourceAuthorityRelation;
  metadata: Record<string, unknown> | null;
  knowledge_sources:
    | {
        slug: string;
        title: string;
      }
    | Array<{
        slug: string;
        title: string;
      }>;
};

export type ListCourseSourceBindingsOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
};

export class CourseSourceBindingError extends Error {
  readonly code = "COURSE_SOURCE_BINDING_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CourseSourceBindingError";
  }
}

function normalizeCourseId(value: string): string {
  const courseId = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/u.test(courseId)) {
    throw new CourseSourceBindingError("courseId is invalid.");
  }
  return courseId;
}

function isAuthorityRelation(
  value: string,
): value is CourseSourceAuthorityRelation {
  return (COURSE_SOURCE_AUTHORITY_RELATIONS as readonly string[]).includes(
    value,
  );
}

function readJoinedSource(
  value: BindingRow["knowledge_sources"],
): { slug: string; title: string } {
  const source = Array.isArray(value) ? value[0] : value;
  if (
    !source ||
    typeof source.slug !== "string" ||
    typeof source.title !== "string"
  ) {
    throw new CourseSourceBindingError(
      "Supabase returned an invalid joined knowledge source.",
    );
  }
  return source;
}

export async function listActiveCourseSourceBindings(
  courseIdInput: string,
  options: ListCourseSourceBindingsOptions = {},
): Promise<CourseSourceBinding[]> {
  const courseId = normalizeCourseId(courseIdInput);
  const client = createSupabaseServerClient({
    env: options.env,
    fetch: options.fetch,
  });

  const query = new URLSearchParams();
  query.set("course_id", `eq.${courseId}`);
  query.set("is_active", "eq.true");
  query.set(
    "select",
    "course_id,source_id,authority_relation,metadata,knowledge_sources!inner(slug,title)",
  );
  query.set("order", "created_at.asc");

  const rows = await client.requestJson<BindingRow[]>(
    `/rest/v1/academy_course_sources?${query.toString()}`,
    {
      method: "GET",
      signal: options.signal,
    },
  );

  if (!Array.isArray(rows)) {
    throw new CourseSourceBindingError(
      "Supabase returned a non-array course-source payload.",
    );
  }

  return rows.map((row) => {
    if (
      row.course_id !== courseId ||
      typeof row.source_id !== "string" ||
      !isAuthorityRelation(row.authority_relation)
    ) {
      throw new CourseSourceBindingError(
        "Supabase returned an invalid course-source binding.",
      );
    }

    const source = readJoinedSource(row.knowledge_sources);
    return {
      courseId: row.course_id,
      sourceId: row.source_id,
      sourceSlug: source.slug,
      sourceTitle: source.title,
      authorityRelation: row.authority_relation,
      metadata: row.metadata ?? {},
    };
  });
}
