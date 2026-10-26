import type { AcademyCourseId } from "./course-reference.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY as PREVIOUS_COMMERCIAL_AUTHORITY,
  type AuthorityAvailability,
} from "./commercial-authority-2026-09-19.ts";

export type { AuthorityAvailability };

export const ACADEMY_COMMERCIAL_AUTHORITY_ID =
  "OWNER-COMMERCIAL-AUTHORITY-2026-10-26";
export const ACADEMY_COMMERCIAL_AUTHORITY_AS_OF = "2026-10-26";
export const ACADEMY_COMMERCIAL_AUTHORITY_VERSION =
  `${ACADEMY_COMMERCIAL_AUTHORITY_ID}@${ACADEMY_COMMERCIAL_AUTHORITY_AS_OF}`;

export const ACADEMY_COMMERCIAL_AUTHORITY = {
  authorityId: ACADEMY_COMMERCIAL_AUTHORITY_ID,
  asOfDate: ACADEMY_COMMERCIAL_AUTHORITY_AS_OF,
  supersedes: PREVIOUS_COMMERCIAL_AUTHORITY.authorityId,
  valueSourceClass: "OWNER_ACCEPTED_TIKHON_PROJECTION",
  currency: "RUB",
  source: {
    system: "TIKHON",
    endpoint: "/api/v1/public/courses",
    checkedAtUtc: "2026-10-26T14:37:02.345384Z",
  },
  pricesRub: {
    ...PREVIOUS_COMMERCIAL_AUTHORITY.pricesRub,
    "normative-situation": { status: "SUPPORTED", value: 60_000 },
  },
  structuralTypologyPricingRub: {
    fullPrepayment: {
      id: "full_prepayment",
      title: "Полный курс (Уровни 1, 2, 3)",
      priceRub: 160_000,
      basePriceRub: 200_000,
      discountPercent: 20,
      condition: "FULL_PREPAYMENT",
    },
    levels: [
      { id: "level_1", title: "Введение в теорию", priceRub: 50_000 },
      { id: "level_2", title: "Основной курс", priceRub: 100_000 },
      { id: "level_3", title: "Экспертный уровень", priceRub: 50_000 },
    ],
  },
  transactionalMetadata: PREVIOUS_COMMERCIAL_AUTHORITY.transactionalMetadata,
} as const satisfies {
  authorityId: string;
  asOfDate: string;
  supersedes: string;
  valueSourceClass: string;
  currency: "RUB";
  source: { system: "TIKHON"; endpoint: string; checkedAtUtc: string };
  pricesRub: Record<AcademyCourseId, AuthorityAvailability>;
  structuralTypologyPricingRub: {
    fullPrepayment: {
      id: string;
      title: string;
      priceRub: number;
      basePriceRub: number;
      discountPercent: number;
      condition: "FULL_PREPAYMENT";
    };
    levels: readonly { id: string; title: string; priceRub: number }[];
  };
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
