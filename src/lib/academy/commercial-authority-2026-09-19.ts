import type { AcademyCourseId } from "./course-reference.ts";

export const ACADEMY_COMMERCIAL_AUTHORITY_ID =
  "OWNER-COMMERCIAL-AUTHORITY-2026-09-19";
export const ACADEMY_COMMERCIAL_AUTHORITY_AS_OF = "2026-09-19";
export const ACADEMY_COMMERCIAL_AUTHORITY_VERSION =
  `${ACADEMY_COMMERCIAL_AUTHORITY_ID}@${ACADEMY_COMMERCIAL_AUTHORITY_AS_OF}`;

export type AuthorityAvailability =
  | { status: "SUPPORTED"; value: number }
  | { status: "UNAVAILABLE"; reason: "NO_AUTHORITATIVE_VALUE" };

export const ACADEMY_COMMERCIAL_AUTHORITY = {
  authorityId: ACADEMY_COMMERCIAL_AUTHORITY_ID,
  asOfDate: ACADEMY_COMMERCIAL_AUTHORITY_AS_OF,
  valueSourceClass: "OWNER_ACCEPTED_R0_PROJECTION",
  pricesRub: {
    "structural-typology": { status: "SUPPORTED", value: 200_000 },
    "levels-of-consciousness": { status: "SUPPORTED", value: 45_000 },
    maslow: { status: "SUPPORTED", value: 60_000 },
    "normative-situation": { status: "SUPPORTED", value: 45_000 },
    "play-and-creativity": { status: "SUPPORTED", value: 60_000 },
    "professional-development-stages": {
      status: "UNAVAILABLE",
      reason: "NO_AUTHORITATIVE_VALUE",
    },
  },
  transactionalMetadata: {
    schedule: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
    cohort: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
    enrollmentWindow: {
      status: "UNAVAILABLE",
      reason: "NO_AUTHORITATIVE_VALUE",
    },
  },
} as const satisfies {
  authorityId: string;
  asOfDate: string;
  valueSourceClass: string;
  pricesRub: Record<AcademyCourseId, AuthorityAvailability>;
  transactionalMetadata: Record<
    "schedule" | "cohort" | "enrollmentWindow",
    AuthorityAvailability
  >;
};

export function getAuthoritativeCoursePrice(
  courseId: AcademyCourseId,
): AuthorityAvailability {
  return ACADEMY_COMMERCIAL_AUTHORITY.pricesRub[courseId];
}
