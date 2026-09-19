import { getAcademyCourse } from "./course-catalog.ts";

export type AcademyCourseId =
  | "structural-typology"
  | "levels-of-consciousness"
  | "maslow"
  | "normative-situation"
  | "play-and-creativity"
  | "professional-development-stages";

export type CourseReferenceResolution =
  | { kind: "ZERO"; courseIds: [] }
  | { kind: "ONE"; courseIds: [AcademyCourseId] }
  | {
      kind: "MULTIPLE";
      courseIds: [AcademyCourseId, AcademyCourseId, ...AcademyCourseId[]];
    };

/**
 * Canonical references only: Cyrillic stems plus the canonical English and
 * slug forms of the same catalog entries. Latin lookarounds are used instead
 * of \b, which never matches between Cyrillic letters and would also match
 * inside a longer Latin word.
 */
const COURSE_ALIASES: ReadonlyArray<{
  courseId: AcademyCourseId;
  patterns: readonly RegExp[];
}> = [
  {
    courseId: "structural-typology",
    patterns: [
      /структурн[а-яё]*\s+типолог/iu,
      /типолог[а-яё]*\s+личност/iu,
      /майерс[а-яё-]*\s+бриггс/iu,
      /(?<![a-z])structural[-\s]+typolog/iu,
      /\bmbti\b/iu,
    ],
  },
  {
    courseId: "levels-of-consciousness",
    patterns: [
      /уровн[а-яё]*\s+сознани/iu,
      /(?<![a-z])levels[-\s]+of[-\s]+consciousness(?![a-z])/iu,
      /иерархи[а-яё]*\s+уровн[а-яё]*\s+сознани/iu,
    ],
  },
  {
    courseId: "maslow",
    patterns: [
      /маслоу/iu,
      /(?<![a-z])maslow(?![a-z])/iu,
      /иерархи[а-яё]*\s+потребност/iu,
    ],
  },
  {
    courseId: "normative-situation",
    patterns: [
      /нормативн[а-яё]*\s+ситуац/iu,
      /(?<![a-z])normative[-\s]+situation(?![a-z])/iu,
    ],
  },
  {
    courseId: "play-and-creativity",
    patterns: [
      /игр[а-яё]*\s+(?:и|&)\s+творчеств/iu,
      /творчеств[а-яё]*\s+(?:и|&)\s+игр/iu,
      /(?<![a-z])play[-\s]+(?:and|&)[-\s]+creativit/iu,
    ],
  },
  {
    courseId: "professional-development-stages",
    patterns: [
      /стади[а-яё]*\s+профессиональн[а-яё]*\s+развити/iu,
      /профессиональн[а-яё]*\s+развити[а-яё]*\s+взросл/iu,
      /(?<![a-z])professional[-\s]+development[-\s]+stages?(?![a-z])/iu,
    ],
  },
];

export function isAcademyCourseId(value: string): value is AcademyCourseId {
  return getAcademyCourse(value) !== null;
}

export function resolveCourseReferences(
  query: string,
): CourseReferenceResolution {
  const courseIds = COURSE_ALIASES.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(query)),
  ).map((entry) => entry.courseId);

  if (courseIds.length === 0) return { kind: "ZERO", courseIds: [] };
  if (courseIds.length === 1) {
    return { kind: "ONE", courseIds: [courseIds[0]] };
  }

  return {
    kind: "MULTIPLE",
    courseIds: courseIds as [
      AcademyCourseId,
      AcademyCourseId,
      ...AcademyCourseId[],
    ],
  };
}
