import type { AcademyCourse } from "./course-catalog.ts";

const KNOWN_INTERNAL_OUTCOME_LABELS =
  /Mono\(S\)|Meta\(S\)|S[–-]O[–-]S|S[–-]O|S[–-]S/u;

// Public answer copy is an explicit allowlist. Canonical siteOutcomes remain
// untouched for internal/expert use. A routable course without an approved
// projection fails closed instead of exposing canonical technical language.
const PUBLIC_COURSE_OUTCOMES: Readonly<
  Record<string, readonly string[]>
> = {
  "levels-of-consciousness": [
    "освоить динамическую иерархическую модель уровней сознания",
    "научиться определять текущий уровень действия человека или команды",
    "понимать типовые искажения под давлением",
  ],
  maslow: [
    "освоить динамическую модель потребностей вместо статичной пирамиды",
    "освоить позицию рефлексивного наблюдателя",
    "понимать разнонаправленные переходы мотивации под давлением контекста",
  ],
  "play-and-creativity": [
    "освоить карту Игра → Обучение → Творчество → Рутина",
    "диагностировать текущий режим развития человека или команды",
    "управлять переходами через среду",
  ],
  "normative-situation": [
    "освоить алгоритм трансформации нормативной ситуации",
    "диагностировать нормативную ситуацию как систему",
    "понимать уровни освоения нормы",
  ],
  "structural-typology": [
    "переосмыслить MBTI как язык структуры личности",
    "освоить архитектуру типологии",
    "диагностировать неполную и полную структуру типа",
  ],
};

export function getPublicCourseOutcomes(
  course: AcademyCourse,
): readonly string[] {
  if (course.status !== "ROUTABLE") {
    return [];
  }

  const approved = PUBLIC_COURSE_OUTCOMES[course.id];
  if (!approved || approved.length === 0) {
    throw new Error(
      `Routable course ${course.id} is missing an approved public outcome projection.`,
    );
  }

  for (const outcome of approved) {
    if (!course.siteOutcomes.includes(outcome)) {
      throw new Error(
        `Public outcome projection drifted from canonical course ${course.id}.`,
      );
    }

    if (KNOWN_INTERNAL_OUTCOME_LABELS.test(outcome)) {
      throw new Error(
        `Public outcome projection for ${course.id} contains an internal label.`,
      );
    }
  }

  return approved;
}
