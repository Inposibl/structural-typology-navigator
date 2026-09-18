import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_COURSES,
  getAcademyCourse,
} from "../../src/lib/academy/course-catalog.ts";
import {
  getPublicCourseOutcomes,
} from "../../src/lib/academy/public-course-outcomes.ts";

const INTERNAL_LABEL_PATTERN =
  /Mono\(S\)|Meta\(S\)|S[–-]O[–-]S|S[–-]O|S[–-]S/u;

test("every routable course has an explicit public outcome projection grounded in canonical outcomes", () => {
  for (const course of ACADEMY_COURSES) {
    const publicOutcomes = getPublicCourseOutcomes(course);

    if (course.status !== "ROUTABLE") {
      assert.deepEqual(publicOutcomes, []);
      continue;
    }

    assert.ok(publicOutcomes.length >= 1);
    assert.ok(publicOutcomes.length <= 3);

    for (const outcome of publicOutcomes) {
      assert.ok(
        course.siteOutcomes.includes(outcome),
        `Public outcome must be an exact canonical outcome for ${course.id}.`,
      );
      assert.doesNotMatch(outcome, INTERNAL_LABEL_PATTERN);
    }
  }
});

test("Maslow canonical technical outcome remains internal while public projection excludes it", () => {
  const maslow = getAcademyCourse("maslow");
  assert.ok(maslow);

  assert.ok(
    maslow.siteOutcomes.some((outcome) =>
      /Mono\(S\).*S–O.*S–S.*Meta\(S\)/u.test(outcome),
    ),
    "Canonical Maslow technical outcome must remain available for internal/expert use.",
  );

  const publicOutcomes = getPublicCourseOutcomes(maslow);
  assert.equal(
    publicOutcomes.some((outcome) =>
      INTERNAL_LABEL_PATTERN.test(outcome),
    ),
    false,
  );
  assert.ok(
    publicOutcomes.includes(
      "понимать разнонаправленные переходы мотивации под давлением контекста",
    ),
  );
});
