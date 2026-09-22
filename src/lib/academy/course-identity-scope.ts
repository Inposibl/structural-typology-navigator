/**
 * EXPERIMENT-3.COURSE-IDENTITY-SURFACE-1 — experiment-local course identity scope.
 *
 * Why this file exists
 * --------------------
 * COURSE_BINDING-ROOT-CAUSE-1 established that the COURSE_CONTENT router binds a
 * course from `{id, title, status}` alone, and that 11 of 12 wrong bindings had no
 * adequate router-visible identity signal. A title is an entry point, not a corpus
 * description: `maslow` advertises «Иерархия потребностей» while its corpus is
 * largely about emotions, aggression, substitution and resources.
 *
 * This module is the single governed subject-matter descriptor per course. It is
 * deliberately NOT a course catalogue and NOT routing instructions: it answers one
 * question — *what subject matter legitimately appears in this course's corpus,
 * including domains the public title does not suggest?*
 *
 * AUTHORING CONTRACT (enforced by the act, checked mechanically)
 * -------------------------------------------------------------
 * - **Corpus-derived.** Every domain phrase traces to a heading in, or a phrase of,
 *   the course's own bound corpus. `descriptor-term-derivation.json` records the
 *   occurrence count of each candidate term inside that course's live chunks; every
 *   term used below was verified present in the course it is claimed for.
 * - **Authority-first.** Courses and source roles come from
 *   `ACADEMY_RAG_AUTHORITY_MAP_1_OWNER_DECISION_CLOSURE_2026-09-20.md`.
 * - **No benchmark input.** No DEVELOPMENT / HOLDOUT / ADVERSARIAL item text, no
 *   gold proposition, no evidence identity, no item id, and no "choose this course
 *   when …" instruction appears here or influenced the wording. Descriptors were
 *   authored from headings and corpus vocabulary only.
 * - **Course-specific and bounded.** One sentence per domain cluster; the core
 *   subject is named first and additional breadth after, so the descriptor states
 *   what the corpus is *about*, not merely what it mentions.
 * - **PDS.** `professional-development-stages` has no bound corpus (0 sources,
 *   0 chunks), so no corpus-derived descriptor can be authored for it. It carries
 *   `null`, stays `LISTED_UNROUTABLE`, and remains un-bindable: activation is
 *   governed by `isRecommendableCourseId`, not by this field.
 */

import type { AcademyCourseId } from "./course-reference.ts";

/**
 * One bounded scope descriptor per course, or `null` where no corpus-derived
 * descriptor exists. Order of the clauses is significant: the leading clause is
 * the course's core subject.
 */
export const COURSE_IDENTITY_SCOPE: Readonly<Record<AcademyCourseId, string | null>> = {
  maslow:
    "Психология потребностей, эмоций и мотивации: иерархия потребностей Маслоу; базовые эмоции и модель Плутчика; различение эмоций и чувств; замещение эмоций и сублимация; принципы удовольствия и реальности; агрессия; субъект-объектная и субъект-субъектная активность (S–O, S–S, S–O–S); ресурсы; безопасность, принадлежность, признание; самоактуализация.",
  "levels-of-consciousness":
    "Иерархия уровней сознания как основной предмет курса: обыденное, моральное, социальное (синкретическое), специальное и теоретическое (интегральное) сознание; сознание и бессознательное; уровни и стратегии защиты восприятия; динамика и переходы между уровнями.",
  "play-and-creativity":
    "Творчество и игра как ресурс профессионального роста: как становятся экспертами; четыре инструмента мышления лидера; как рождаются живые теории управления; как мыслят лидеры и дилеммы реальности; различение изменения и развития.",
  "normative-situation":
    "Теория «Нормативная ситуация»: признаки и структура НС; основные способы коммуникации между субъектами НС; скрытые интересы как фактор деградации НС; роли и взаимодействие субъектов; алгоритм трансформации НС; практические рекомендации.",
  "structural-typology":
    "Структурная типология и типология Майерс-Бриггс: 16 типов и предпочтения E/I, S/N, T/F, P/J; темпераменты Кейрси; стеки функций; архетипы коллективного бессознательного — Тень, Эго, Персона, Самость, Анима и Анимус — и Тень в Норме, Стрессе и Неврозе; концепция «Среда взаимодействия»; стадии развития интеллекта; глава об уровнях сознания внутри книги.",
  "professional-development-stages": null,
};

/**
 * The descriptor for a course, or `null` when the course has none. A course
 * without a descriptor is still offered to the router — with its title and
 * status, exactly as before — so this field can enrich an identity but never
 * becomes a gate on one.
 */
export function getCourseIdentityScope(courseId: string): string | null {
  return (
    COURSE_IDENTITY_SCOPE[courseId as AcademyCourseId] ?? null
  );
}
