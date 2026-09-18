
export type CourseStatus = "ROUTABLE" | "LISTED_UNROUTABLE";

export type AcademyCourse = {
  id: string;
  title: string;
  status: CourseStatus;
  url: string | null;
  meetings: number;
  learningNeeds: readonly string[];
  siteOutcomes: readonly string[];
  audienceSignals: readonly string[];
  negativeFitSignals?: readonly string[];
  routingBlockReason?: string;
};

export const ACADEMY_COURSE_CATALOG_SNAPSHOT_DATE = "2026-09-18";

export const ACADEMY_COURSES: readonly AcademyCourse[] = [
  {
    id: "levels-of-consciousness",
    title: "Иерархия уровней сознания",
    status: "ROUTABLE",
    url: "https://structural-typology.academy/courses/levels-of-consciousness",
    meetings: 4,
    learningNeeds: [
      "понимание изменений восприятия, мышления и поведения под давлением ситуации",
      "распознавание повторяющихся тупиков в коммуникации",
      "понимание искажений восприятия и решений под давлением",
      "анализ состояния человека или команды в стрессовых и конфликтных режимах",
      "повышение точности управленческой коммуникации и решений",
    ],
    siteOutcomes: [
      "освоить динамическую иерархическую модель уровней сознания",
      "научиться определять текущий уровень действия человека или команды",
      "понимать типовые искажения под давлением",
      "освоить инструменты возврата ясности и повышения качества решений",
    ],
    audienceSignals: [
      "собственник/CEO",
      "топ-менеджер",
      "руководитель команды",
      "консультант по трансформации",
      "executive coach / leadership consultant",
    ],
  },
  {
    id: "maslow",
    title: "Иерархия потребностей А. Маслоу: новая парадигма",
    status: "ROUTABLE",
    url: "https://structural-typology.academy/courses/maslow",
    meetings: 6,
    learningNeeds: [
      "понимание изменения мотивации и приоритетов под влиянием контекста",
      "понимание того, какие потребности фактически определяют поведение здесь и сейчас",
      "различение режимов взаимодействия и роли ресурсов",
      "понимание повторяющихся мотивационных и коммуникационных тупиков",
      "необходимость точнее работать с мотивацией человека или команды",
    ],
    siteOutcomes: [
      "освоить динамическую модель потребностей вместо статичной пирамиды",
      "освоить позицию рефлексивного наблюдателя",
      "понимать режимы Mono(S), S–O, S–S, S–O–S, Meta(S)",
      "понимать разнонаправленные переходы мотивации под давлением контекста",
    ],
    audienceSignals: [
      "психолог-практик",
      "руководитель команды",
      "операционный руководитель",
      "топ-менеджер",
      "консультант",
      "исследователь социального взаимодействия",
      "executive coach",
    ],
  },
  {
    id: "play-and-creativity",
    title: "Игра и творчество в жизни взрослых людей",
    status: "ROUTABLE",
    url: "https://structural-typology.academy/courses/play-and-creativity",
    meetings: 6,
    learningNeeds: [
      "понимание, почему развитие или изменения застревают",
      "переход от идей и экспериментов к устойчивому навыку или практике",
      "управление трансформацией команды без саботажа и выгорания",
      "настройка среды: правила, свобода, нагрузка, обратная связь и критерии качества",
      "проектирование обучения, адаптации и upskilling",
    ],
    siteOutcomes: [
      "освоить карту Игра → Обучение → Творчество → Рутина",
      "диагностировать текущий режим развития человека или команды",
      "управлять переходами через среду",
      "закреплять результат в воспроизводимую практику",
    ],
    audienceSignals: [
      "лидер изменений",
      "руководитель",
      "HR/T&D/L&D",
      "эксперт или специалист с потолком развития",
      "тимлид",
      "product/project manager",
      "преподаватель/наставник/coach",
    ],
  },
  {
    id: "normative-situation",
    title: "Нормативная ситуация",
    status: "ROUTABLE",
    url: "https://structural-typology.academy/courses/normative-situation",
    meetings: 6,
    learningNeeds: [
      "формальные правила существуют, но фактически не работают",
      "система держится на ручном управлении",
      "люди игнорируют корпоративные правила и цели",
      "сопротивление изменениям и деградация нормы",
      "необходимость распределить ответственность и закрепить процедуры",
      "необходимость различать формальные и реально действующие нормы",
      "диагностика скрытых интересов и сопротивления внутри организационной среды",
    ],
    siteOutcomes: [
      "освоить алгоритм трансформации нормативной ситуации",
      "диагностировать нормативную ситуацию как систему",
      "понимать уровни освоения нормы",
      "распознавать механизмы деградации, сопротивления и конфликтов",
      "фиксировать новую норму, ответственность и процедуры",
    ],
    audienceSignals: [
      "собственник/CEO",
      "COO/операционный директор",
      "HRD/OD/L&D",
      "change-management consultant",
      "фасилитатор",
      "compliance/risk/legal",
    ],
  },
  {
    id: "professional-development-stages",
    title: "Стадии профессионального развития взрослого человека",
    status: "LISTED_UNROUTABLE",
    url: null,
    meetings: 4,
    learningNeeds: [],
    siteOutcomes: [],
    audienceSignals: [],
    routingBlockReason:
      "Курс присутствует в текущем каталоге, но публичной страницы с достаточным описанием для честной маршрутизации пока нет.",
  },
  {
    id: "structural-typology",
    title: "Структурная типология личности с использованием типологии Майерс-Бриггс",
    status: "ROUTABLE",
    url: "https://structural-typology.academy/courses/structural-typology",
    meetings: 25,
    learningNeeds: [
      "глубокое понимание структуры личности, а не типирование по поверхностным описаниям",
      "повторяющиеся сложные коммуникационные тупики и ошибки интерпретации других людей",
      "конфликты ожиданий и несовместимость ролей",
      "понимание влияния среды взаимодействия на развитие и деградацию личности",
      "необходимость сложного диагностического аппарата для людей, команд и организационной среды",
      "путаница в MBTI и ошибочные самоопределения",
    ],
    siteOutcomes: [
      "переосмыслить MBTI как язык структуры личности",
      "освоить архитектуру типологии",
      "диагностировать неполную и полную структуру типа",
      "понимать влияние среды взаимодействия",
      "использовать структурную модель для коммуникации и управления",
    ],
    audienceSignals: [
      "собственник/CEO",
      "COO",
      "HRD/OD",
      "executive coach",
      "управленческий консультант",
      "руководитель трансформаций",
    ],
    negativeFitSignals: [
      "ищет быстрые лайфхаки или пару приемов",
      "хочет использовать типологию как инструмент давления или ярлыков",
      "не готов удерживать сложные абстрактные модели",
      "находится в остром эмоциональном срыве и ищет облегчение, а не когнитивную нагрузку",
    ],
  },
] as const;

export const OFFICIAL_TRACK_SEQUENCES = [
  [
    "levels-of-consciousness",
    "maslow",
    "play-and-creativity",
    "normative-situation",
  ],
  ["levels-of-consciousness", "structural-typology"],
] as const;

export function getAcademyCourse(courseId: string): AcademyCourse | null {
  return ACADEMY_COURSES.find((course) => course.id === courseId) ?? null;
}

export function isRecommendableCourseId(courseId: string): boolean {
  return ACADEMY_COURSES.some(
    (course) => course.id === courseId && course.status === "ROUTABLE",
  );
}


export function getRoutingCourseSummaries(): Array<{
  id: string;
  title: string;
  status: CourseStatus;
  meetings: number;
  learningNeeds: readonly string[];
  siteOutcomes: readonly string[];
  negativeFitSignals: readonly string[];
  routingBlockReason: string | null;
}> {
  return ACADEMY_COURSES.map((course) => ({
    id: course.id,
    title: course.title,
    status: course.status,
    meetings: course.meetings,
    learningNeeds: course.learningNeeds,
    siteOutcomes: course.siteOutcomes,
    negativeFitSignals: course.negativeFitSignals ?? [],
    routingBlockReason: course.routingBlockReason ?? null,
  }));
}

export function getRoutableCourseSummaries(): Array<{
  id: string;
  title: string;
  meetings: number;
  learningNeeds: readonly string[];
  siteOutcomes: readonly string[];
  negativeFitSignals: readonly string[];
}> {
  return ACADEMY_COURSES.filter((course) => course.status === "ROUTABLE").map(
    (course) => ({
      id: course.id,
      title: course.title,
      meetings: course.meetings,
      learningNeeds: course.learningNeeds,
      siteOutcomes: course.siteOutcomes,
      negativeFitSignals: course.negativeFitSignals ?? [],
    }),
  );
}

export function isContiguousOfficialCourseSequence(
  courseIds: readonly string[],
): boolean {
  if (courseIds.length <= 1) {
    return true;
  }

  return OFFICIAL_TRACK_SEQUENCES.some((track) => {
    for (let start = 0; start <= track.length - courseIds.length; start += 1) {
      const slice = track.slice(start, start + courseIds.length);
      if (slice.every((courseId, index) => courseId === courseIds[index])) {
        return true;
      }
    }
    return false;
  });
}
