import {
  ACADEMY_COMMERCIAL_AUTHORITY,
  ACADEMY_COMMERCIAL_AUTHORITY_AS_OF,
  getAuthoritativeCoursePrice,
} from "../academy/commercial-authority.ts";
import type { AcademyCourseId } from "../academy/course-reference.ts";

function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

export function commercialAuthorityDateRu(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${ACADEMY_COMMERCIAL_AUTHORITY_AS_OF}T00:00:00Z`))
    .replace(/ г\.$/u, " года");
}

export function formatAuthoritativeCoursePrice(courseId: AcademyCourseId): string | null {
  const price = getAuthoritativeCoursePrice(courseId);
  if (price.status !== "SUPPORTED") return null;
  if (courseId !== "structural-typology") return formatRub(price.value);
  const pricing = ACADEMY_COMMERCIAL_AUTHORITY.structuralTypologyPricingRub;
  const prepayment = pricing.fullPrepayment;
  return [
    `${formatRub(price.value)} (базовая стоимость)`,
    `при полной предоплате — ${formatRub(prepayment.priceRub)} (публичная скидка ${prepayment.discountPercent}%)`,
    `по уровням: ${pricing.levels.map((level) => `«${level.title}» — ${formatRub(level.priceRub)}`).join("; ")}`,
  ].join("; ");
}
