import type { ConversationMessage } from "../chat-contract.ts";
import {
  getAcademyCourse,
  getRoutingCourseSummaries,
} from "../academy/course-catalog.ts";
import {
  isAcademyCourseId,
  resolveCourseReferences,
  type AcademyCourseId,
} from "../academy/course-reference.ts";
import { getCourseIdentityScope } from "../academy/course-identity-scope.ts";
import {
  validateConversationActDecision,
  type ConversationActDecision,
} from "./conversation-act-router.ts";
import { hasEnrollmentPaymentIntent } from "../academy/payment-policy.ts";

/**
 * NAVIGATOR-INTENT-RECOVERY-ARM-B.IMPLEMENTATION-1 — the structured task-plan
 * layer of the B-on-failure recovery.
 *
 * The frozen ARM-B experimental artifacts are reproduced here byte-exactly and
 * their identities are pinned by tests against the frozen DEV evidence:
 *   - system prompt  sha256(text + "\n") = 9664648446ea97b827d1bae7b9868ae1ae2e31393a0a821e3c429ee25e9ccef3
 *   - user prefix    sha256(text + "\n") = b4fbb162e8c4da4e99689866a36b72c995a1348f56fde8098a34f08c5d6bec3a
 *   - composition    sha256(text + "\n") = 437cfa5f009f25c48b3497f341a37cb4fe03460a7da3dbc57996119077ccac65
 * The DEV validator semantics are reproduced from the frozen harness lib.mts
 * (sha256 1fe7ef83065a34a6191f79dd65212ffcb8e6ef5101a8bf7edd4861d9aafda989);
 * the DEV replay keeps the two behaviourally aligned.
 *
 * The model proposes semantic tasks only: it cannot create course identities,
 * payment destinations, supported evidence or state authority. Catalog and
 * recognizer authority stays final, and every dispatched act must pass the
 * unchanged conversation-act validator.
 */

export const ARM_B_EXTRACTION_SYSTEM_PROMPT = "Ты — внутренний анализатор запросов образовательного Навигатора Академии структурной типологии.\n\nТВОЯ ЗАДАЧА:\nразложить ИМЕННО ПОСЛЕДНЮЮ реплику пользователя на отдельные задачи и упоминания курсов и вернуть только JSON. Ты не пишешь пользователю ответ и не выбираешь действие системы.\n\nЗАДАЧИ (tasks):\n- задача — то, что пользователь в последней реплике просит объяснить, сообщить или сделать;\n- каждая самостоятельная просьба — отдельная задача; вопрос о содержании курса и вопрос о цене, оплате, потоке или подборе курса — это разные задачи, не объединяй их;\n- не пропускай ни одной просьбы последней реплики, даже короткой или заданной в конце;\n- более ранние реплики разговора — только контекст: задачи берутся только из последней реплики пользователя. Если последняя реплика отсылает к ранее названному курсу словами «этот курс», «он», «там», укажи этот курс в courseIds.\n\nТИПЫ ЗАДАЧ (type):\n- EDU — содержательный вопрос о материале или пользе ОДНОГО курса каталога: что курс даёт, чему учит, как объясняет, что разбирает, что в нём говорится о теме. courseIds — ровно один id курса;\n- COMPARE — просьба сравнить курсы каталога или объяснить различие между ними. courseIds — id сравниваемых курсов каталога;\n- PRICE — цена или стоимость участия;\n- SCHEDULE — расписание, дни или время занятий;\n- COHORT — ближайший или следующий поток, дата старта;\n- ENROLLMENT_WINDOW — сроки набора, до какого числа можно записаться;\n- PAYMENT — оплатить, купить, записаться, как оплатить, способы, условия или рассрочка оплаты;\n- RECOMMEND — просьба подобрать или порекомендовать курс либо оценить, подходит ли курс пользователю или новичку;\n- UNKNOWN_COURSE — вопрос о курсе или программе, которой нет в каталоге (courses), если она не отнесена явно к сторонней платформе или школе;\n- FOREIGN — вопрос о курсе или обучении сторонней платформы, школы или академии (Coursera, Udemy, Skillbox и т.п.);\n- OUT_OF_SCOPE — тема, не связанная с курсами и обучением в Академии.\nДля PRICE, SCHEDULE, COHORT, ENROLLMENT_WINDOW, PAYMENT и RECOMMEND courseIds — курсы каталога, к которым относится просьба; если курс не определён, оставь courseIds пустым. Для UNKNOWN_COURSE, FOREIGN и OUT_OF_SCOPE courseIds пустой.\n\nРОЛЬ (role) задачи или упоминания:\n- ACTIVE — пользователь просит это сейчас;\n- BACKGROUND — курс упомянут как прошлый опыт или контекст («я уже прошёл…», «раньше смотрел…»);\n- RETRACTED — пользователь сам отозвал этот вопрос или поправился («нет, этот вопрос снят», «ой, я имел в виду другое»);\n- REPORTED — чужой вопрос или пересказ чужих слов («коллега спросил…»);\n- REJECTED — пользователь отказывается от курса или от рекомендации.\nВ tasks перечисляй задачи с ролью ACTIVE. Курс, который назван не как предмет текущей просьбы (BACKGROUND, RETRACTED, REPORTED, REJECTED), не делай ACTIVE-задачей, но обязательно занеси его в mentions с этой ролью.\n\nУПОМИНАНИЯ (mentions):\n- отдельная запись для каждого курса каталога, названного в последней реплике (полным названием, коротко или пересказом), и для каждого названия курса или программы в кавычках «…», которого нет в каталоге;\n- courseId — id курса из courses или null, если такого курса в каталоге нет;\n- surface — дословный фрагмент последней реплики, которым курс назван;\n- role — роль этого курса в последней реплике.\n\nevidence задачи — дословная подстрока последней реплики пользователя длиной от 3 до 240 символов, которая показывает эту задачу. Копируй посимвольно, без изменений и без добавления кавычек.\n\nОГРАНИЧЕНИЯ:\n- используй только id из courses; не выдумывай id;\n- не подменяй неизвестный или сторонний курс похожим курсом каталога;\n- не больше 4 задач.\n\nJSON FORMAT:\n{\"tasks\":[{\"type\":\"EDU\",\"courseIds\":[\"course-id\"],\"role\":\"ACTIVE\",\"evidence\":\"точная цитата\"},{\"type\":\"PRICE\",\"courseIds\":[\"course-id\"],\"role\":\"ACTIVE\",\"evidence\":\"точная цитата\"}],\"mentions\":[{\"courseId\":\"course-id\",\"surface\":\"точная цитата\",\"role\":\"ACTIVE\"},{\"courseId\":null,\"surface\":\"точная цитата\",\"role\":\"ACTIVE\"}]}\n\nНикакого текста вне JSON.";

export const ARM_B_USER_PREFIX = "Разложи последнюю реплику пользователя на задачи и упоминания курсов и верни JSON.";

/** The frozen composition lines file, verbatim; parsed once below. */
const ARM_B_COMPOSITION_LINES_JSON = "{\n  \"PAYMENT\": \"Об оплате и записи: в этом ответе я не даю платёжных ссылок и не оформляю оплату. Если хотите оплатить курс, напишите об этом отдельным сообщением с названием курса.\",\n  \"RECOMMEND\": \"Подходит ли вам курс, лучше решить отдельно: опишите, пожалуйста, вашу задачу, и я помогу с выбором.\",\n  \"UNDISPATCHED\": \"Часть вашего сообщения («{{EVIDENCE}}») я в этом ответе не разобрал — задайте её, пожалуйста, отдельным сообщением.\",\n  \"NAMED_CLAUSE\": \" В вашем сообщении названы: {{TITLES}}.\"\n}";

export const ARM_B_COMPOSITION_LINES: Readonly<{
  PAYMENT: string;
  RECOMMEND: string;
  UNDISPATCHED: string;
  NAMED_CLAUSE: string;
}> = JSON.parse(ARM_B_COMPOSITION_LINES_JSON);

/** DEV extraction payload shape (harness bMessages), minus the provider call. */
export function buildPlanExtractionUserContent(
  messages: readonly ConversationMessage[],
): string {
  const catalog = getRoutingCourseSummaries().map((course) => ({
    id: course.id,
    title: course.title,
    status: course.status,
    scope: getCourseIdentityScope(course.id),
  }));

  return (
    ARM_B_USER_PREFIX +
    "\n\n" +
    JSON.stringify(
      {
        latestUserMessageIndex: messages.length - 1,
        courses: catalog,
        conversation: messages.map((message, messageIndex) => ({
          messageIndex,
          role: message.role,
          content: message.content,
        })),
      },
      null,
      2,
    )
  );
}

// ---------------------------------------------------------------- frozen lexicon

export const TASK_PLAN_TYPES = [
  "EDU",
  "COMPARE",
  "PRICE",
  "SCHEDULE",
  "COHORT",
  "ENROLLMENT_WINDOW",
  "PAYMENT",
  "RECOMMEND",
  "UNKNOWN_COURSE",
  "FOREIGN",
  "OUT_OF_SCOPE",
] as const;

export const TASK_PLAN_ROLES = [
  "ACTIVE",
  "BACKGROUND",
  "RETRACTED",
  "REPORTED",
  "REJECTED",
] as const;

export type TaskPlanType = (typeof TASK_PLAN_TYPES)[number];
export type TaskPlanRole = (typeof TASK_PLAN_ROLES)[number];

export type TaskPlanTask = {
  type: TaskPlanType;
  courseIds: string[];
  role: TaskPlanRole;
  evidence: string;
};

export type TaskPlanMention = {
  courseId: string | null;
  surface: string;
  role: TaskPlanRole;
};

export type TaskPlan = {
  tasks: TaskPlanTask[];
  mentions?: TaskPlanMention[];
};

const METADATA_FIELD: Partial<Record<TaskPlanType, "PRICE" | "SCHEDULE" | "COHORT" | "ENROLLMENT_WINDOW">> = {
  PRICE: "PRICE",
  SCHEDULE: "SCHEDULE",
  COHORT: "COHORT",
  ENROLLMENT_WINDOW: "ENROLLMENT_WINDOW",
};

/** Frozen PRICE cue (harness lib.mts), veto-only corroboration. */
const PRICE_CUE = /сколько\s+стоит|стоимост|цен[аыуе]|обойд[её]тс|₽|руб/iu;
/** Frozen quoted-object scanner (harness lib.mts). */
const QUOTED = /«([^»]{3,120})»/gu;

const keysOnly = (value: unknown, allowed: string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));

const stripQuotes = (value: string): string =>
  value.replace(/[«»"“”]/gu, "").trim();

// ---------------------------------------------------------------- literal course presence

/** Exact title/URL presence of one catalog course, in the given messages. */
export function courseLiteralIn(
  courseId: string,
  messages: readonly ConversationMessage[],
): boolean {
  const course = getAcademyCourse(courseId);
  if (!course) return false;
  return messages.some(
    (message) =>
      typeof message.content === "string" &&
      (message.content.includes(course.title) ||
        (course.url !== null && message.content.includes(course.url))),
  );
}

/** Any catalog course (including LISTED_UNROUTABLE) literally present. */
export function anyCourseLiteral(
  messages: readonly ConversationMessage[],
): boolean {
  return getRoutingCourseSummaries().some((course) =>
    courseLiteralIn(course.id, messages),
  );
}

/** Courses whose exact title/URL appears in the LATEST message, catalog order. */
export function namedCoursesInLatest(
  messages: readonly ConversationMessage[],
): string[] {
  const latest = messages.at(-1);
  if (!latest) return [];
  return getRoutingCourseSummaries()
    .filter((course) => courseLiteralIn(course.id, [latest]))
    .map((course) => course.id);
}

// ---------------------------------------------------------------- validation

export type TaskPlanVerdict = {
  ok: boolean;
  problems: string[];
  active: TaskPlanTask[];
  detectedCourseIds: string[];
};

/**
 * Deterministic plan validation — the frozen DEV validator, unchanged. A plan
 * that passes JSON-schema shape is not automatically semantically correct; the
 * literal/mention accounting below are constraints and vetoes, not proof of
 * complete semantic understanding.
 */
export function validateTaskPlan(
  plan: unknown,
  messages: readonly ConversationMessage[],
): TaskPlanVerdict {
  const latest: string = messages.at(-1)?.content ?? "";
  const problems: string[] = [];
  if (!keysOnly(plan, ["tasks", "mentions"])) problems.push("TOP_LEVEL_SHAPE");
  const tasks: TaskPlanTask[] = Array.isArray((plan as TaskPlan)?.tasks)
    ? ((plan as TaskPlan).tasks as TaskPlanTask[])
    : [];
  const mentions: TaskPlanMention[] =
    (plan as TaskPlan)?.mentions === undefined
      ? []
      : Array.isArray((plan as TaskPlan).mentions)
        ? ((plan as TaskPlan).mentions as TaskPlanMention[])
        : (problems.push("MENTIONS_NOT_ARRAY"), []);

  if (tasks.length < 1 || tasks.length > 4) problems.push("TASK_COUNT");
  for (const task of tasks) {
    if (!keysOnly(task, ["type", "courseIds", "role", "evidence"])) {
      problems.push("TASK_SHAPE");
      continue;
    }
    if (!TASK_PLAN_TYPES.includes(task.type)) problems.push("TASK_TYPE");
    if (!TASK_PLAN_ROLES.includes(task.role)) problems.push("TASK_ROLE");
    if (
      !Array.isArray(task.courseIds) ||
      task.courseIds.some((id) => typeof id !== "string")
    ) {
      problems.push("TASK_COURSE_IDS_SHAPE");
      continue;
    }
    for (const id of task.courseIds) {
      if (!isAcademyCourseId(id)) problems.push("UNKNOWN_ID");
    }
    if (new Set(task.courseIds).size !== task.courseIds.length) {
      problems.push("DUPLICATE_ID");
    }
    if (task.type === "EDU" && task.courseIds.length !== 1) {
      problems.push("EDU_COURSE_COUNT");
    }
    if (task.type === "COMPARE" && task.courseIds.length < 2) {
      problems.push("COMPARE_COURSE_COUNT");
    }
    if (
      ["UNKNOWN_COURSE", "FOREIGN", "OUT_OF_SCOPE"].includes(task.type) &&
      task.courseIds.length !== 0
    ) {
      problems.push("NONCATALOG_TASK_WITH_IDS");
    }
    if (
      typeof task.evidence !== "string" ||
      task.evidence.trim().length < 3 ||
      task.evidence.length > 240 ||
      !latest.includes(task.evidence)
    ) {
      problems.push("EVIDENCE_NOT_VERBATIM");
    }
  }
  for (const mention of mentions) {
    if (
      !keysOnly(mention, ["courseId", "surface", "role"]) ||
      (mention.courseId !== null && typeof mention.courseId !== "string") ||
      typeof mention.surface !== "string" ||
      !TASK_PLAN_ROLES.includes(mention.role)
    ) {
      problems.push("MENTION_SHAPE");
      continue;
    }
    if (
      typeof mention.courseId === "string" &&
      !isAcademyCourseId(mention.courseId)
    ) {
      problems.push("UNKNOWN_MENTION_ID");
    }
  }

  const accounted = new Set<string>();
  for (const task of tasks) {
    for (const id of Array.isArray(task?.courseIds) ? task.courseIds : []) {
      accounted.add(id);
    }
  }
  for (const mention of mentions) {
    if (typeof mention?.courseId === "string") accounted.add(mention.courseId);
  }
  const detected = [
    ...new Set([
      ...resolveCourseReferences(latest).courseIds,
      ...namedCoursesInLatest(messages),
    ]),
  ];
  for (const id of detected) {
    if (!accounted.has(id)) problems.push("UNACCOUNTED_COURSE_MENTION");
  }
  const catalogTitles = new Set(
    getRoutingCourseSummaries().map((course) => course.title),
  );
  const surfaces = mentions
    .filter((mention) => typeof mention?.surface === "string")
    .map((mention) => stripQuotes(mention.surface));
  for (const match of latest.matchAll(QUOTED)) {
    if (
      !catalogTitles.has(match[1]) &&
      !surfaces.some((surface) => surface.includes(match[1]))
    ) {
      problems.push("UNACCOUNTED_QUOTED_OBJECT");
    }
  }
  const active = tasks.filter((task) => task?.role === "ACTIVE");
  if (active.length === 0) problems.push("NO_ACTIVE_TASK");
  if (hasEnrollmentPaymentIntent(latest) && !active.some((task) => task.type === "PAYMENT")) {
    problems.push("PAYMENT_CUE_WITHOUT_TASK");
  }
  if (PRICE_CUE.test(latest) && !active.some((task) => task.type === "PRICE")) {
    problems.push("PRICE_CUE_WITHOUT_TASK");
  }

  return { ok: problems.length === 0, problems, active, detectedCourseIds: detected };
}

// ---------------------------------------------------------------- segments

/**
 * One dispatch unit of an accepted plan. ACT segments carry a validated act for
 * an existing authorized handler; LINE segments are the frozen fixed
 * composition lines (explicit limitations, never manufactured answers).
 */
export type RecoverySegment =
  | {
      kind: "ACT";
      taskIndices: number[];
      taskTypes: TaskPlanType[];
      evidenceSpan: string | null;
      act: ConversationActDecision;
    }
  | {
      kind: "LINE";
      taskIndices: number[];
      taskTypes: TaskPlanType[];
      evidenceSpan: string | null;
      lineKind: "PAYMENT" | "RECOMMEND" | "UNDISPATCHED";
      text: string;
      validatorRejection: string | null;
    };

/** The frozen UNDISPATCHED line for one task's own evidence span. */
export function undispatchedLineText(evidence: string): string {
  return ARM_B_COMPOSITION_LINES.UNDISPATCHED.replace("{{EVIDENCE}}", evidence);
}

/**
 * Successor mapping: a segment is an execution unit, not a task identity.
 * Only semantically identical scopes share work. Comparisons are independent.
 * Frozen extraction/schema/validator artifacts above remain unchanged.
 */
export function mapPlanToRecoverySegments(
  active: readonly TaskPlanTask[],
  messages: readonly ConversationMessage[],
): RecoverySegment[] {
  const segments: RecoverySegment[] = [];
  const shared = new Map<string, Extract<RecoverySegment, { kind: "ACT" }>>();
  const single = active.length === 1;
  const addAct = (
    task: TaskPlanTask,
    taskIndex: number,
    act: ConversationActDecision,
    key?: string,
  ): void => {
    const existing = key === undefined ? undefined : shared.get(key);
    if (existing !== undefined) {
      existing.taskIndices.push(taskIndex);
      existing.taskTypes.push(task.type);
      if (existing.act.state === "FACTUAL" && act.state === "FACTUAL") {
        const prior = existing.act.intents[0];
        const next = act.intents[0];
        if (prior.kind === "CURRENT_METADATA" && next.kind === "CURRENT_METADATA") {
          prior.fields = [...new Set([...prior.fields, ...next.fields])];
        }
      }
      return;
    }
    const segment: Extract<RecoverySegment, { kind: "ACT" }> = {
      kind: "ACT",
      taskIndices: [taskIndex],
      taskTypes: [task.type],
      evidenceSpan: task.evidence,
      act,
    };
    segments.push(segment);
    if (key !== undefined) shared.set(key, segment);
  };
  const addLine = (
    task: TaskPlanTask,
    taskIndex: number,
    lineKind: "PAYMENT" | "RECOMMEND" | "UNDISPATCHED",
    rejection: string | null = null,
  ): void => {
    segments.push({
      kind: "LINE",
      taskIndices: [taskIndex],
      taskTypes: [task.type],
      evidenceSpan: task.evidence,
      lineKind,
      text: lineKind === "UNDISPATCHED"
        ? undispatchedLineText(task.evidence)
        : ARM_B_COMPOSITION_LINES[lineKind],
      validatorRejection: rejection,
    });
  };

  active.forEach((task, index) => {
    if (task.type === "EDU") {
      const courseId = task.courseIds[0];
      if (courseLiteralIn(courseId, messages)) {
        addAct(task, index, {
          state: "COURSE_FOLLOW_UP", courseId, evidenceRequested: false,
        }, JSON.stringify(["EDU", courseId, task.evidence]));
      } else if (!anyCourseLiteral(messages)) {
        addAct(task, index, {
          state: "COURSE_CONTENT", courseId, evidenceRequested: false,
          contentIntentEvidence: task.evidence,
        }, JSON.stringify(["EDU", courseId, task.evidence]));
      } else {
        addLine(task, index, "UNDISPATCHED");
      }
    } else if (task.type === "COMPARE") {
      if (task.courseIds.length !== 2) {
        addLine(task, index, "UNDISPATCHED", "FACTUAL_INTENT_UNREPRESENTABLE");
      } else {
        addAct(task, index, {
          state: "FACTUAL",
          intents: [{
            kind: "COURSE_COMPARISON",
            courseIds: task.courseIds as AcademyCourseId[],
            hasUnknownCourse: false,
          }],
        });
      }
    } else if (METADATA_FIELD[task.type] !== undefined) {
      const courseIds = [...task.courseIds] as AcademyCourseId[];
      const scope = courseIds.length > 0 ? "REFERENCED" as const : "SELECTED" as const;
      addAct(task, index, {
        state: "FACTUAL",
        intents: [{
          kind: "CURRENT_METADATA", courseIds,
          fields: [METADATA_FIELD[task.type]!], scope,
        }],
      }, JSON.stringify(["METADATA", scope, [...courseIds].sort()]));
    } else if (task.type === "PAYMENT" || task.type === "RECOMMEND") {
      if (single) addAct(task, index, { state: "NAVIGATE" });
      else addLine(task, index, task.type);
    } else {
      addAct(task, index, { state: "OUT_OF_SCOPE" }, "NON_CATALOG");
    }
  });

  // Full-conversation validation remains the final act/course authority.
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind !== "ACT") continue;
    try {
      const act = validateConversationActDecision(segment.act, messages);
      segments[index] = act.state === "COURSE_REFERENCE_UNRESOLVED"
        ? demotedSegment(segment, "VALIDATOR_UNRESOLVED")
        : { ...segment, act };
    } catch {
      segments[index] = demotedSegment(segment, "VALIDATOR_REJECTED");
    }
  }
  assertSegmentTaskPartition(active.length, segments);
  return segments;
}

/** Every accepted task has exactly one execution/limitation owner. */
export function assertSegmentTaskPartition(
  taskCount: number,
  segments: readonly RecoverySegment[],
): void {
  const seen = new Set<number>();
  for (const segment of segments) {
    if (segment.taskIndices.length === 0 || segment.taskIndices.length !== segment.taskTypes.length) {
      throw new Error("Recovery segment has inconsistent task ownership.");
    }
    for (const index of segment.taskIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= taskCount || seen.has(index)) {
        throw new Error("Recovery segments duplicate or misidentify a task.");
      }
      seen.add(index);
    }
  }
  if (seen.size !== taskCount) throw new Error("Recovery segment partition is missing a task.");
}

function demotedSegment(
  segment: Extract<RecoverySegment, { kind: "ACT" }>,
  validatorRejection: string,
): RecoverySegment {
  return {
    kind: "LINE",
    taskIndices: segment.taskIndices,
    taskTypes: segment.taskTypes,
    evidenceSpan: segment.evidenceSpan,
    lineKind: "UNDISPATCHED",
    text: undispatchedLineText(segment.evidenceSpan ?? ""),
    validatorRejection,
  };
}
