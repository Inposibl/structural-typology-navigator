import type { AcademyCourseId } from "./course-reference.ts";
import {
  ACADEMY_COMMERCIAL_AUTHORITY_ID,
  type AuthorityAvailability,
} from "./commercial-authority.ts";

/**
 * NAVIGATOR-LIVE-ACCEPTANCE-1.OWNER-DEFECT-REMEDIATION-1 — the Owner's dated
 * commercial-conditions decision of 2026-10-24.
 *
 * This is an addendum, not a replacement: the dated price snapshot
 * OWNER-COMMERCIAL-AUTHORITY-2026-09-19 stays byte-unchanged and remains the
 * only price authority. The addendum records exactly the five Owner facts:
 *   1. no installment plans are offered;
 *   2. a public discount exists for full prepayment of «Структурная типология
 *      личности»;
 *   3. for other courses a discretionary discount may be considered only for
 *      previous Academy students present in the Academy's records;
 *   4. such a discount requires approval by the human curator;
 *   5. no discount percentage or amount was supplied.
 *
 * No amount is representable here (both are UNAVAILABLE), alumni status is
 * never checked by the Navigator, and eligibility is never decided
 * automatically.
 */
export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM_ID =
  "OWNER-COMMERCIAL-POLICY-ADDENDUM-2026-10-24";
export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM_AS_OF = "2026-10-24";
export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM_VERSION =
  `${ACADEMY_COMMERCIAL_POLICY_ADDENDUM_ID}@${ACADEMY_COMMERCIAL_POLICY_ADDENDUM_AS_OF}`;

export const ACADEMY_COMMERCIAL_POLICY_ADDENDUM = {
  authorityId: ACADEMY_COMMERCIAL_POLICY_ADDENDUM_ID,
  asOfDate: ACADEMY_COMMERCIAL_POLICY_ADDENDUM_AS_OF,
  supplements: ACADEMY_COMMERCIAL_AUTHORITY_ID,
  valueSourceClass: "OWNER_DECISION",
  installments: { offered: false },
  publicPrepaymentDiscount: {
    courseIds: ["structural-typology"],
    condition: "FULL_PREPAYMENT",
    amount: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
  },
  discretionaryAlumniDiscount: {
    appliesTo: "COURSES_OTHER_THAN_PUBLIC_PREPAYMENT_DISCOUNT",
    eligibility: "PREVIOUS_ACADEMY_STUDENTS_IN_ACADEMY_RECORDS",
    approval: "HUMAN_CURATOR",
    automaticEligibilityDecision: false,
    navigatorChecksAlumniStatus: false,
    amount: { status: "UNAVAILABLE", reason: "NO_AUTHORITATIVE_VALUE" },
  },
} as const satisfies {
  authorityId: string;
  asOfDate: string;
  supplements: string;
  valueSourceClass: string;
  installments: { offered: boolean };
  publicPrepaymentDiscount: {
    courseIds: readonly AcademyCourseId[];
    condition: "FULL_PREPAYMENT";
    amount: AuthorityAvailability;
  };
  discretionaryAlumniDiscount: {
    appliesTo: string;
    eligibility: string;
    approval: "HUMAN_CURATOR";
    automaticEligibilityDecision: false;
    navigatorChecksAlumniStatus: false;
    amount: AuthorityAvailability;
  };
};
