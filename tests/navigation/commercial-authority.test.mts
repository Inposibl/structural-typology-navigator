import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_AS_OF,
  ACADEMY_COMMERCIAL_AUTHORITY_ID,
  ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
  getAuthoritativeCoursePrice,
} from "../../src/lib/academy/commercial-authority.ts";

test("A30: the R0 authority identity, date and five prices are exact", () => {
  assert.equal(
    ACADEMY_COMMERCIAL_AUTHORITY_ID,
    "OWNER-COMMERCIAL-AUTHORITY-2026-09-19",
  );
  assert.equal(ACADEMY_COMMERCIAL_AUTHORITY_AS_OF, "2026-09-19");
  assert.equal(
    ACADEMY_COMMERCIAL_AUTHORITY_VERSION,
    "OWNER-COMMERCIAL-AUTHORITY-2026-09-19@2026-09-19",
  );
  assert.deepEqual(getAuthoritativeCoursePrice("structural-typology"), {
    status: "SUPPORTED",
    value: 200_000,
  });
  assert.deepEqual(getAuthoritativeCoursePrice("levels-of-consciousness"), {
    status: "SUPPORTED",
    value: 45_000,
  });
  assert.deepEqual(getAuthoritativeCoursePrice("maslow"), {
    status: "SUPPORTED",
    value: 60_000,
  });
  assert.deepEqual(getAuthoritativeCoursePrice("normative-situation"), {
    status: "SUPPORTED",
    value: 45_000,
  });
  assert.deepEqual(getAuthoritativeCoursePrice("play-and-creativity"), {
    status: "SUPPORTED",
    value: 60_000,
  });
});

test("A30: unsupported price and transactional metadata remain unavailable", () => {
  assert.deepEqual(
    getAuthoritativeCoursePrice("professional-development-stages"),
    { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
  );
  assert.deepEqual(ACADEMY_COMMERCIAL_AUTHORITY.transactionalMetadata, {
    schedule: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
    cohort: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
    enrollmentWindow: {
      status: "UNAVAILABLE",
      reason: "NO_AUTHORITATIVE_VALUE",
    },
  });
});
