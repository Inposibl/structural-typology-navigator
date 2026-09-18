
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_COURSES,
  OFFICIAL_TRACK_SEQUENCES,
  getAcademyCourse,
  getRoutingCourseSummaries,
  isContiguousOfficialCourseSequence,
  isRecommendableCourseId,
} from "../../src/lib/academy/course-catalog.ts";

test("catalog exposes exactly five routable courses and one listed-unroutable course", () => {
  assert.equal(
    ACADEMY_COURSES.filter((course) => course.status === "ROUTABLE").length,
    5,
  );
  assert.equal(
    ACADEMY_COURSES.filter(
      (course) => course.status === "LISTED_UNROUTABLE",
    ).length,
    1,
  );
  assert.equal(
    getAcademyCourse("professional-development-stages")?.status,
    "LISTED_UNROUTABLE",
  );
});

test("only current routable course ids are recommendable", () => {
  assert.equal(isRecommendableCourseId("maslow"), true);
  assert.equal(isRecommendableCourseId("normative-situation"), true);
  assert.equal(
    isRecommendableCourseId("professional-development-stages"),
    false,
  );
  assert.equal(isRecommendableCourseId("invented-course"), false);
});

test("official course sequences are contiguous-only authority", () => {
  assert.equal(OFFICIAL_TRACK_SEQUENCES.length, 2);
  assert.equal(
    isContiguousOfficialCourseSequence(["levels-of-consciousness", "maslow"]),
    true,
  );
  assert.equal(
    isContiguousOfficialCourseSequence(["maslow", "play-and-creativity"]),
    true,
  );
  assert.equal(
    isContiguousOfficialCourseSequence([
      "levels-of-consciousness",
      "normative-situation",
    ]),
    false,
  );
  assert.equal(
    isContiguousOfficialCourseSequence([
      "maslow",
      "structural-typology",
    ]),
    false,
  );
});

test("router catalog projection excludes course outcomes while canonical catalog retains them", () => {
  const routing = getRoutingCourseSummaries();

  assert.equal(routing.length, ACADEMY_COURSES.length);
  for (const course of routing) {
    assert.equal("siteOutcomes" in course, false);
  }

  assert.ok(
    (getAcademyCourse("maslow")?.siteOutcomes.length ?? 0) > 0,
    "Canonical course outcomes must remain available outside the router projection.",
  );
});
