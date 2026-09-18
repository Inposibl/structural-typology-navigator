import assert from "node:assert/strict";
import test from "node:test";

import {
  NavigatorStageError,
} from "../../src/lib/navigation/navigator-observability.ts";
import {
  retrieveCourseKnowledge,
} from "../../src/lib/knowledge/retrieval/retrieve-course-knowledge.ts";

const binding = {
  courseId: "maslow",
  sourceId: "source-id",
  sourceSlug: "source-slug",
  sourceTitle: "Source",
  authorityRelation: "FOUNDATIONAL" as const,
  metadata: {},
};

async function expectStage(
  expectedStage: "BINDINGS" | "COHERE" | "COURSE_RPC",
  operation: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof NavigatorStageError);
    assert.equal(error.stage, expectedStage);
    return true;
  });
}

test("course retrieval classifies binding failures as BINDINGS", async () => {
  await expectStage("BINDINGS", () =>
    retrieveCourseKnowledge("maslow", "мотивация", {
      dependencies: {
        listBindings: async () => {
          throw new Error("binding failure");
        },
      },
    }),
  );
});

test("course retrieval classifies query embedding failures as COHERE", async () => {
  await expectStage("COHERE", () =>
    retrieveCourseKnowledge("maslow", "мотивация", {
      dependencies: {
        listBindings: async () => [binding],
        embedQuery: async () => {
          throw Object.assign(new Error("cohere failure"), {
            code: "UPSTREAM_ERROR",
            status: 429,
          });
        },
      },
    }),
  );
});

test("course retrieval classifies Supabase RPC failures as COURSE_RPC", async () => {
  await expectStage("COURSE_RPC", () =>
    retrieveCourseKnowledge("maslow", "мотивация", {
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test",
      },
      fetch: async () =>
        new Response(null, {
          status: 503,
          headers: {
            "x-request-id": "supabase-test-request",
          },
        }),
      dependencies: {
        listBindings: async () => [binding],
        embedQuery: async () => Array.from({ length: 1024 }, () => 0),
      },
    }),
  );
});
