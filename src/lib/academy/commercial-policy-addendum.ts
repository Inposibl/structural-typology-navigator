import type { AcademyCourseId } from "./course-reference.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_ID,
  type AuthorityAvailability,
} from "./commercial-authority.ts";

const prepayment = ACADEMY_COMMERCIAL_AUTHORITY.structuralTypologyPricingRub.fullPrepayment;

export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM_ID =
  "OWNER-COMMERCIAL-POLICY-ADDENDUM-2026-10-26";
export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM_AS_OF = "2026-10-26";
export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION =
  `${ACADEMY_COMMERCIAL_POLICY_ADDENDUM_ID}@${ACADEMY_COMMERCIAL_POLICY_ADDENDUM_AS_OF}`;

export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM = {
  authorityId: ACADEMY_COMMERCIAL_POLICY_ADDENDUM_ID,
  asOfDate: ACADEMY_COMMERCIAL_POLICY_ADDENDUM_AS_OF,
  supersedes: "OWNER-COMMERCIAL-POLICY-ADDENDUM-2026-10-24",
  supplements: ACADEMY_COMMERCIAL_AUTHORITY_ID,
  valueSourceClass: "OWNER_DECISION",
  installments: { offered: false },
  publicPrepaymentDiscount: {
    courseIds: ["structural-typology"],
    condition: "FULL_PREPAYMENT",
    discountPercent: prepayment.discountPercent,
    amount: { status: "SUPPORTED", value: prepayment.basePriceRub - prepayment.priceRub },
  },
  discretionaryAlumniDiscount: {
    appliesTo: "COURSES_OTHER_THAN_PUBLIC_PREPAYMENT_DISCOUNT",
    eligibility: "PREVIOUS_ACADEMY_STUDENTS_IN_ACADEMY_RECORDS",
    approval: "HUMAN_CURATOR",
    approvalMode: "MANUAL",
    automaticEligibilityDecision: false,
    navigatorChecksAlumniStatus: false,
    tikhonAppliesAlumniDiscount: false,
    amount: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
  },
} as const satisfies {
  authorityId: string;
  asOfDate: string;
  supersedes: string;
  supplements: string;
  valueSourceClass: string;
  installments: { offered: boolean };
  publicPrepaymentDiscount: {
    courseIds: readonly AcademyCourseId[];
    condition: "FULL_PREPAYMENT";
    discountPercent: number;
    amount: AuthorityAvailability;
  };
  discretionaryAlumniDiscount: {
    appliesTo: string;
    eligibility: string;
    approval: "HUMAN_CURATOR";
    approvalMode: "MANUAL";
    automaticEligibilityDecision: false;
    navigatorChecksAlumniStatus: false;
    tikhonAppliesAlumniDiscount: false;
    amount: AuthorityAvailability;
  };
};
