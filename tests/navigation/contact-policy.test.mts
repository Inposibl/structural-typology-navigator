import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_CONTACT_POLICY,
  composeAcademyContactAnswer,
  detectAcademyContactIntent,
  detectDeterministicAcademyContactIntent,
  getAcademyManagerContactCard,
} from "../../src/lib/academy/contact-policy.ts";
import type { ConversationProfile } from "../../src/lib/chat-contract.ts";

const IVAN_TY: ConversationProfile = {
  displayName: "Иван",
  addressMode: "TY",
  nameDeclined: false,
  pendingUserRequest: null,
};

const ANNA_VY: ConversationProfile = {
  displayName: "Анна",
  addressMode: "VY",
  nameDeclined: false,
  pendingUserRequest: null,
};

test("Owner-provided Academy contacts remain exact", () => {
  assert.equal(
    ACADEMY_CONTACT_POLICY.contactsPage,
    "https://structural-typology.academy/contacts",
  );
  assert.equal(
    ACADEMY_CONTACT_POLICY.fastTelegramHandle,
    "@AST_rulang",
  );
  assert.equal(
    ACADEMY_CONTACT_POLICY.manager.telegramHandle,
    "@LebedevOo",
  );
  assert.equal(
    ACADEMY_CONTACT_POLICY.manager.phoneHref,
    "tel:+79992600201",
  );
  assert.equal(
    ACADEMY_CONTACT_POLICY.manager.availability,
    "09:00–19:00 МСК, Пн–Пт",
  );
});

test("course-context request to discuss with a person selects live contact", () => {
  assert.equal(
    detectAcademyContactIntent(
      "С кем я могу обсудить этот курс?",
      { hasCourseContext: true },
    ),
    "LIVE",
  );
});


test("live-contact detection allows ordinary words between 'с кем' and 'обсудить'", () => {
  assert.equal(
    detectAcademyContactIntent(
      "С кем я могу спокойно обсудить детали курса?",
      { hasCourseContext: true },
    ),
    "LIVE",
  );
});

test("live-contact detection accepts natural manager/human phrasing", () => {
  assert.equal(
    detectAcademyContactIntent(
      "К кому можно обратиться и поговорить про обучение?",
      { hasCourseContext: false },
    ),
    "LIVE",
  );
});

test("fast written contact remains distinct from live contact", () => {
  assert.equal(
    detectAcademyContactIntent(
      "Куда быстро написать вопрос по курсу?",
      { hasCourseContext: true },
    ),
    "FAST_TEXT",
  );
});

test("unrelated contact request is not captured as Academy contact", () => {
  assert.equal(
    detectAcademyContactIntent(
      "Как связаться с поддержкой Google?",
      { hasCourseContext: false },
    ),
    null,
  );
});

test("live contact answer exposes exact manager card and direct channels", () => {
  const result = composeAcademyContactAnswer("LIVE");
  const card = getAcademyManagerContactCard();

  assert.match(result.message, /Алексею Лебедеву/u);
  assert.match(result.message, /09:00–19:00 МСК/u);
  assert.match(result.message, /https:\/\/t\.me\/LebedevOo/u);
  assert.deepEqual(result.contactCard, card);
  assert.equal(card.phone.href, "tel:+79992600201");
  assert.equal(card.imageUrl, "/academy/alexey-lebedev.png");
});

test("A10: photo, manager-specific and channel follow-ups are recognised deterministically", () => {
  // Naming the manager selects his own card and channels, not the Academy's
  // fast written chat: the canonical photo travels with that card.
  assert.equal(detectDeterministicAcademyContactIntent("а фото Алексея?"), "LIVE");
  assert.equal(
    detectDeterministicAcademyContactIntent("Дайте Telegram и телефон Алексея."),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent("Как связаться с менеджером Академии?"),
    "LIVE",
  );
  assert.equal(detectDeterministicAcademyContactIntent("Дайте контакты Академии."), "GENERAL");
  assert.equal(
    detectDeterministicAcademyContactIntent("Куда быстро написать вопрос по курсу?"),
    "FAST_TEXT",
  );

  // The manager's name is read from the canonical contact authority, so the
  // detector cannot drift from the policy it serves.
  assert.match(ACADEMY_CONTACT_POLICY.manager.name, /Алексей/u);
  assert.equal(detectDeterministicAcademyContactIntent("а фото Лебедева?"), "LIVE");
});

test("A10 (IV1-D-F1): contact intent forms stay deterministic across the positive classes", () => {
  const positives: ReadonlyArray<readonly [string, string]> = [
    ["Как связаться с менеджером Академии?", "LIVE"],
    ["Как связаться с Алексеем?", "LIVE"],
    ["Дайте Telegram Алексея.", "LIVE"],
    ["Дайте телефон Алексея.", "LIVE"],
    ["Дайте Telegram и телефон Алексея.", "LIVE"],
    ["Куда написать в Академию?", "FAST_TEXT"],
    ["Можно позвонить менеджеру?", "LIVE"],
    ["А фото Алексея?", "LIVE"],
    ["Дайте контакты Академии.", "GENERAL"],
  ];

  for (const [query, expected] of positives) {
    assert.equal(detectDeterministicAcademyContactIntent(query), expected, query);
  }

  // A request that names the manager is answered with his canonical channels.
  assert.match(
    composeAcademyContactAnswer("LIVE", ANNA_VY).message,
    /https:\/\/t\.me\/LebedevOo/u,
  );
  assert.match(
    composeAcademyContactAnswer("LIVE", ANNA_VY).message,
    /\+7 999 260-02-01/u,
  );
});

test("A10 (IV1-D-F1): relational and semantic course language is never captured as contact", () => {
  const negatives = [
    // Relational language: "X связан с Y" is not "свяжитесь с Академией".
    "Как курс связан с психологией?",
    "Чем связаны между собой темы курса?",
    "Как связаны эти концепции?",
    "Как теория Маслоу связана с мотивацией?",
    "Какая связь между этими уровнями?",
    "Какая связь между курсами Академии?",
    "Расскажи про связку мотивации и поведения в курсе",
    // Narrative contact and human language.
    "Как наладить контакт с людьми на работе?",
    "Курс про психологию человека",
    "Как лучше общаться с другим человеком?",
    "Что делать, если человек меня не понимает?",
    "Хочу поговорить с человеком",
    // Semantic usage of the write stem.
    "Что такое написание сценария?",
    "Почему этот текст так написан?",
    // Other legitimate words that share a bounded stem.
    "Что курс говорит про позвоночник?",
    "Как курс развивает звонкий голос?",
  ];

  for (const query of negatives) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }
});

test("A10 (IV1-D-F2/M1): role and support nouns are targets, never contact actions", () => {
  // The role class is excluded, not the reported strings: the same nouns keep
  // their educational lane in every inflection and word order, so a sentence
  // that merely names who could be reached is not a request to reach them.
  const roleContentTurns = [
    "Курс для менеджеров",
    "Курс для менеджеров по продажам",
    "Роль куратора в обучении",
    "Какой курс подходит менеджерам?",
    "Есть ли курс для менеджеров?",
    "Кто такой куратор курса?",
    "Что делает менеджер проекта?",
    "Менеджерам и кураторам подходит этот курс?",
    "Поддержка мотивации",
    "Поддержка сотрудников важна",
    "В курсе есть поддержка преподавателя?",
    "Как поддержка преподавателя влияет на обучение?",
  ];

  for (const query of roleContentTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // The same role noun is contact again as soon as the utterance carries a
  // channel of its own: the noun names the target, the channel asks for it.
  assert.equal(
    detectDeterministicAcademyContactIntent("Телефон менеджера Академии"),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent("Контакты поддержки Академии"),
    "GENERAL",
  );
});

test("A10 (IV1-D-F2/M1): a question verb is content language until it is addressed to a human", () => {
  // Asking about the course is not asking for a person, and a support or
  // institution noun is ordinary course prose as well ("поддержка мотивации").
  const questionContentTurns = [
    "Можно спросить, как устроен курс?",
    "Хочу задать вопрос о Маслоу",
    "Можно спросить про уровни Маслоу?",
    "Где спросить про мотивацию?",
    "Можно задать вопрос по курсу?",
    "Хочу задать вопрос про поддержку мотивации",
    "Можно спросить про поддержку сотрудников?",
    "Хочу задать вопрос про Академию",
  ];

  for (const query of questionContentTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // A question *about* a person asks about the Academy's staff rather than for
  // them, so it is not a directed request either.
  const aboutPersonTurns = [
    "Можно спросить про куратора?",
    "Хочу задать вопрос про менеджера",
    "Где спросить про куратора?",
    "Хочу задать вопрос о менеджере",
    "Можно спросить про Алексея?",
  ];

  for (const query of aboutPersonTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // The verb is not the signal; the addressee is, and the direction is towards
  // them. The same verb addressed to a named human is a directed request, in
  // either order and in either of the two directed cases of Russian.
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Где можно задать вопрос менеджеру Академии?",
    ),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Менеджеру Академии можно задать вопрос?",
    ),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent("Можно задать вопрос Алексею?"),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent("Можно спросить у куратора?"),
    "LIVE",
  );
});

test("A10: ordinary course prose that mentions people is never captured as contact", () => {
  const ordinaryTurns = [
    "Психология человека — о чём этот курс?",
    "Как курс помогает понимать другого человека?",
    "Что в курсе про работу с человеком?",
    "Расскажите про мотивацию команды",
  ];

  for (const query of ordinaryTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // Narrative uses of "контакт" ("в контакте с людьми") are not requests, so
  // the deterministic pre-route gate never captures them.
  for (const query of [
    "Как наладить контакт с людьми на работе?",
    "Как курс помогает в контакте с людьми?",
  ]) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
  }

  // A contact request that names neither the Academy nor its manager keeps its
  // ordinary lane: it is not this Navigator's contact surface.
  assert.equal(
    detectDeterministicAcademyContactIntent("Как связаться с поддержкой Google?"),
    null,
  );
});

test("A03: contact wording follows the selected mode where it addresses the user", () => {
  const tyFast = composeAcademyContactAnswer("FAST_TEXT", IVAN_TY).message;
  const vyFast = composeAcademyContactAnswer("FAST_TEXT", ANNA_VY).message;

  assert.match(tyFast, /напиши в чат Академии/u);
  assert.doesNotMatch(tyFast, /напишите/u);
  assert.match(vyFast, /напишите в чат Академии/u);

  const mixed = composeAcademyContactAnswer("GENERAL", IVAN_TY).message;
  assert.match(mixed, /напиши в чат Академии/u);

  // The live-contact answer has no direct address, so it is mode-neutral and
  // must not be reworded for the mode.
  assert.equal(
    composeAcademyContactAnswer("LIVE", IVAN_TY).message,
    composeAcademyContactAnswer("LIVE", ANNA_VY).message,
  );
  assert.equal(
    composeAcademyContactAnswer("LIVE", ANNA_VY).message,
    composeAcademyContactAnswer("LIVE").message,
  );
});

test("A10 (IV1-D-M1/R1): an about-frame survives the words between it and its object", () => {
  // The frame is carried by the preposition, so the words that describe its
  // object cannot hide it, and neither does the distance between them: the same
  // question keeps its content lane however many words the frame spans. The
  // first two forms below are the independently proven M-1 failures; both entry
  // points are checked, because the shortcut and the post-classification
  // detector must agree about the direction.
  const aboutTurns = [
    "Хочу спросить про Алексея Лебедева",
    "Можно задать вопрос про работу менеджера?",
    "Можно спросить про нашего куратора?",
    "Можно спросить про нового куратора?",
    "Можно спросить про куратора курса?",
    "Хочу задать вопрос о менеджере Академии",
    "У меня вопрос о нашем кураторе",
    "Хочу спросить об Алексее",
    "Вопрос про поддержку Академии",
    "Можно спросить про поддержку преподавателя?",
    "Можно спросить про обязанности куратора",
    "Хочу задать вопрос про нашего нового менеджера Академии",
    // The reverse word order carries the frame in front of its object.
    "О менеджере можно спросить?",
    "Про Алексея можно спросить?",
  ];

  for (const query of aboutTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }
});

test("A10 (IV1-D-M1/R1): the frame is a preposition token, and the addressee signal survives it", () => {
  // Letters inside ordinary words are not prepositions: "просто" is not "про"
  // and "общее" is not "об", so each of these remains a directed request.
  const directedWithLookalikes = [
    "Можно спросить у просто отличного куратора?",
    "Можно спросить общее мнение у куратора?",
  ];

  for (const query of directedWithLookalikes) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
  }

  // A directed question keeps the deterministic contact lane in either word
  // order and in both directed cases of Russian.
  const directedTurns = [
    "Можно спросить у куратора?",
    "Можно спросить у Алексея?",
    "Можно задать вопрос менеджеру Академии?",
    "Можно задать вопрос Алексею?",
    "Где задать вопрос менеджеру?",
    "Менеджеру Академии можно задать вопрос?",
    "У куратора можно спросить?",
    "Как написать менеджеру Академии?",
    "Как связаться с менеджером Академии?",
    "Дайте Telegram и телефон Алексея.",
  ];

  for (const query of directedTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      "LIVE",
      query,
    );
  }
});

test("A10 (D-R1-F1): a long about-frame is not cut short by its own description", () => {
  // The frame is bounded by the clause, never by a word count. In every form
  // below the preposition stands eleven words or more from the person it governs
  // (counted, not assumed), and nothing else in the clause relates that person to
  // the question, so a word-window would read the pair as directed contact and
  // answer with the manager's card instead of letting the classifier decide.
  const longSpanAboutTurns = [
    // 11 words between "про" and "менеджера".
    "Хочу спросить про работу с руководителями крупных международных команд в период организационных изменений менеджера",
    // 11 words between "про" and "куратора".
    "Хочу спросить про особенности взаимодействия преподавателя с участниками программы на разных этапах обучения куратора",
    // 11 words between "про" and "Алексея".
    "Хочу спросить про особенности найма и адаптации новых сотрудников в крупных распределённых командах Алексея",
    // 21 words: no word-window of any size is a safe abstraction here.
    "Хочу спросить про подходы к развитию управленческих навыков у руководителей крупных международных компаний в период быстрых организационных изменений и про типичные ошибки наставников менеджера",
  ];

  for (const query of longSpanAboutTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }
});

test("A10 (D-R1-F1): the about-frame is bounded by the clause, not by the utterance", () => {
  // The span is clause-local, so the two halves must be bound together: an
  // earlier clause's preposition cannot suppress a later clause's directed
  // request, and the current clause's preposition still applies.
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Хочу спросить про курс. Можно задать вопрос менеджеру Академии?",
    ),
    "LIVE",
  );
  assert.equal(
    detectAcademyContactIntent(
      "Хочу спросить про курс. Можно задать вопрос менеджеру Академии?",
      { hasCourseContext: true },
    ),
    "LIVE",
  );

  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Курс мне нравится. Хочу спросить про нашего куратора?",
    ),
    null,
  );
  assert.equal(
    detectAcademyContactIntent(
      "Курс мне нравится. Хочу спросить про нашего куратора?",
      { hasCourseContext: true },
    ),
    null,
  );

  // A separate explicit contact action is contact on its own channel, whatever
  // the earlier clause was about.
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Хочу спросить про курс, а потом написать менеджеру",
    ),
    "LIVE",
  );
});

test("A10 (D-R2-F1): a long topic span does not hide the addressee that follows it", () => {
  // The structural value of the long-span cases above is kept — the distance
  // between "про" and the person is the same — but here the person is related to
  // the question in their own right. A topic, however long, is not a veto: the
  // utterance asks that person about a described subject, and the deterministic
  // lane owns it.
  const longSpanDirectedTurns = [
    "Хочу спросить про работу с руководителями крупных международных команд в период организационных изменений у менеджера",
    "Хочу спросить про особенности взаимодействия преподавателя с участниками программы на разных этапах обучения у куратора",
    "Хочу спросить про особенности найма и адаптации новых сотрудников в крупных распределённых командах у Алексея",
    "Хочу спросить про подходы к развитию управленческих навыков у руководителей крупных международных компаний в период быстрых организационных изменений и про типичные ошибки наставников у менеджера",
    // The dative recipient carries the same relation across the same distance.
    "Можно задать вопрос о расписании следующего потока и о порядке зачисления новых участников программы нашему менеджеру",
  ];

  for (const query of longSpanDirectedTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      "LIVE",
      query,
    );
  }
});

test("A10 (D-R2-F1): a topic is not an addressee, and an addressee is not a topic", () => {
  // TOPIC and ADDRESSEE are independent dimensions of one question. A person who
  // appears only as the object of "про"/"о"/"об" is what the question is about,
  // and no amount of describing them turns the utterance into a request for them.
  const aboutOnlyTurns = [
    "Хочу спросить про Алексея Лебедева",
    "Хочу спросить про работу менеджера",
    "Можно задать вопрос про работу менеджера?",
    "Можно спросить про нашего куратора?",
    "Можно спросить про нового куратора?",
    "Можно спросить про обязанности куратора?",
    "Хочу задать вопрос о менеджере Академии",
    "Хочу спросить об Алексее",
    "Про Алексея можно спросить?",
    "О менеджере можно спросить?",
    "Что можно спросить про менеджера?",
    "Хочу узнать о менеджере Академии",
    // A directed preposition that governs someone else does not direct this one.
    "Хочу спросить у вас про менеджера",
  ];

  for (const query of aboutOnlyTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // The same vocabulary is a directed request as soon as a relation to the person
  // is stated — by "у" or by the dative — whatever the topic is and whichever of
  // the two stands first.
  const topicWithAddresseeTurns = [
    "Хочу спросить у Алексея про курс",
    "Хочу спросить про курс у Алексея",
    "Можно спросить у менеджера про программу?",
    "Можно спросить про программу у менеджера?",
    "Можно задать вопрос менеджеру про оплату?",
    "Можно задать вопрос про оплату менеджеру?",
    "Хочу задать вопрос куратору про обучение",
    "Хочу задать вопрос про обучение куратору",
    "Можно задать вопрос менеджеру о расписании",
    "Можно задать вопрос о расписании менеджеру",
    "Хочу спросить про структуру нового курса у нашего менеджера",
    "Можно задать вопрос о расписании следующего потока нашему менеджеру",
    // One person is asked and the other is only spoken about.
    "Можно спросить у менеджера про Алексея?",
  ];

  for (const query of topicWithAddresseeTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      "LIVE",
      query,
    );
  }
});

test("A10 (D-R2-F1): the paired contrasts prove a relation, not a vocabulary", () => {
  // Each pair differs by the relation alone: the same role noun, the same topic
  // words, the same question verb. If the detector were reading vocabulary, both
  // halves of a pair would land in the same lane.
  const pairs: ReadonlyArray<readonly [string, string]> = [
    [
      "Хочу спросить про работу менеджера",
      "Хочу спросить про работу у менеджера",
    ],
    ["Хочу спросить про Алексея", "Хочу спросить про курс у Алексея"],
    [
      "Можно задать вопрос про обязанности куратора",
      "Можно задать вопрос куратору про обязанности",
    ],
  ];

  for (const [about, directed] of pairs) {
    assert.equal(detectDeterministicAcademyContactIntent(about), null, about);
    assert.equal(
      detectAcademyContactIntent(about, { hasCourseContext: true }),
      null,
      about,
    );
    assert.equal(
      detectDeterministicAcademyContactIntent(directed),
      "LIVE",
      directed,
    );
    assert.equal(
      detectAcademyContactIntent(directed, { hasCourseContext: true }),
      "LIVE",
      directed,
    );
  }
});

test("A10 (D-R2-F1): the dative recipient is a form, not a stem", () => {
  // Only the recipient form of the singular is a recipient. The genitive of a
  // topic, the prepositional of an about-object and the dative plural of a class
  // are different words, and the question must be given to them as well: a dative
  // with no question construction is not a recipient of anything.
  const nonRecipientTurns = [
    "Можно задать вопрос про работу менеджера?",
    "Хочу задать вопрос о менеджере Академии",
    "Какой курс подходит менеджерам?",
    "Менеджерам и кураторам подходит этот курс?",
    "Можно спросить, что менеджеру нужно для обучения?",
  ];

  for (const query of nonRecipientTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // The manager's recipient forms are derived from the canonical contact
  // authority, so the detector cannot drift from the policy it serves.
  assert.equal(ACADEMY_CONTACT_POLICY.manager.name, "Алексей Лебедев");
  assert.equal(
    detectDeterministicAcademyContactIntent("Можно задать вопрос Алексею?"),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent("Можно задать вопрос Лебедеву?"),
    "LIVE",
  );
});

test("A10 (D-R3-F1): an explicit governor outranks the recipient form", () => {
  // A dative form says what a word *can* be; its governor says what it *is*
  // here. "к" and "по" take the dative themselves, so a dative they govern is
  // already accounted for: "вопрос о требованиях к менеджеру" asks about the
  // requirements towards the manager and gives the manager no question at all.
  const governedTurns = [
    "Можно задать вопрос о требованиях к менеджеру?",
    "Можно задать вопрос про требования к менеджеру?",
    "Хочу задать вопрос о доверии к куратору.",
    "Можно задать вопрос об отношении команды к Алексею?",
    "Хочу задать вопрос о подходе преподавателя к менеджеру.",
    "Хочу задать вопрос по требованиям к менеджеру.",
    "Можно спросить про отношение к Алексею?",
    "Можно задать вопрос об отношении к Алексею?",
    // The governor is local to the noun phrase, and its own modifiers stand
    // between it and the head it governs: the relation survives them.
    "Можно задать вопрос о требованиях к нашему новому менеджеру?",
    "Можно задать вопрос об отношении команды к самому Алексею?",
    "Хочу задать вопрос по новым требованиям к нашему куратору.",
    // The role noun on its own is not a recipient either.
    "У меня вопрос по менеджеру",
    "Можно спросить по работе куратора?",
  ];

  for (const query of governedTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // With no governor to account for it, the same form is the recipient of the
  // question its clause gives: "про", "о" and "об" cannot govern a dative, so a
  // topic in front of it takes nothing away.
  const recipientTurns = [
    "Можно задать вопрос менеджеру о требованиях к команде?",
    "Можно задать вопрос менеджеру о требованиях?",
    "Хочу задать вопрос куратору о доверии",
    "Можно задать вопрос Алексею об отношении команды?",
    "Можно задать вопрос про оплату менеджеру?",
  ];

  for (const query of recipientTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      "LIVE",
      query,
    );
  }
});

test("A10 (D-R3-F1): a topic preposition reaches one phrase, not the whole clause", () => {
  // "к" and "по" take the dative themselves, but a preposition takes *one* noun
  // phrase: once "по оплате" has its own, it does not reach past it. The dative
  // that follows is then free, and a free dative in a question construction is
  // its recipient. Only a governor that actually reaches the candidate accounts
  // for its form.
  const topicThenRecipientTurns = [
    "Можно задать вопрос по оплате менеджеру?",
    "Можно задать вопрос по программе куратору?",
    "Можно задать вопрос по расписанию Алексею?",
    "Можно задать вопрос менеджеру по оплате?",
    // The recipient's own modifiers do not change the reading.
    "Можно задать вопрос по оплате нашему менеджеру?",
    "Можно задать вопрос по расписанию самому Алексею?",
    // The same shape with a described topic: "по работе" is the subject of the
    // question and the manager is still the one being asked.
    "Можно задать вопрос о новых правилах по работе менеджеру?",
  ];

  for (const query of topicThenRecipientTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      "LIVE",
      query,
    );
  }

  // Where nothing intervenes, the preposition does reach the candidate, and the
  // agreeing modifiers of its own phrase are not an interruption.
  const topicIncludingPersonTurns = [
    "Можно задать вопрос по менеджеру?",
    "Можно задать вопрос по требованиям к менеджеру?",
    "Можно задать вопрос по требованиям к нашему новому менеджеру?",
    "Можно задать вопрос по работе нашего нового менеджера?",
  ];

  for (const query of topicIncludingPersonTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }
});

test("A10 (D-R4-F1): the directed 'у' reaches one phrase, not every later role", () => {
  // "у" takes one noun phrase too. Once the colleague has taken it, the manager
  // further along is only whose opinion is meant — the question is put to the
  // colleague, and no deterministic contact may be read from the leftover "у".
  const consumedTurns = [
    "Можно спросить у коллеги мнение менеджера?",
    "Хочу спросить у преподавателя мнение куратора?",
    "Можно спросить у коллеги мнение Алексея?",
    "Можно спросить у коллеги отношение к менеджеру?",
    "Можно спросить у преподавателя вопрос о менеджере?",
    "Можно спросить у коллеги про работу менеджера?",
    "Можно спросить у коллеги, что делает менеджер?",
    // The modifiers of either phrase do not restore the reach.
    "Можно спросить у нашего коллеги мнение нового менеджера?",
    "Можно спросить у опытного преподавателя мнение нашего куратора?",
  ];

  for (const query of consumedTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), null, query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      null,
      query,
    );
  }

  // Where nothing has taken the phrase, "у" reaches the candidate across its own
  // agreeing modifiers, and across the adverbs that modify them.
  const directedTurns = [
    "Можно спросить у менеджера?",
    "Можно спросить у нашего менеджера?",
    "Можно спросить у куратора?",
    "Можно спросить у Алексея?",
    "Хочу спросить у Алексея про курс",
    "Хочу спросить про курс у Алексея",
    "Можно спросить у нашего куратора про программу?",
    "Можно спросить у нашего нового менеджера?",
    "Можно спросить у очень опытного куратора?",
  ];

  for (const query of directedTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), "LIVE", query);
    assert.equal(
      detectAcademyContactIntent(query, { hasCourseContext: true }),
      "LIVE",
      query,
    );
  }
});

test("A10 (D-R4-F1): the directed/consumed pairs prove the locality", () => {
  // Each pair opens with the same "у" and names the same role. Only the question
  // of whether that "у" still reaches the role differs.
  const pairs: ReadonlyArray<readonly [string, string]> = [
    [
      "Можно спросить у менеджера?",
      "Можно спросить у коллеги мнение менеджера?",
    ],
    [
      "Можно спросить у куратора?",
      "Хочу спросить у преподавателя мнение куратора?",
    ],
    [
      "Можно спросить у Алексея?",
      "Можно спросить у коллеги мнение Алексея?",
    ],
  ];

  for (const [directed, consumed] of pairs) {
    assert.equal(
      detectDeterministicAcademyContactIntent(directed),
      "LIVE",
      directed,
    );
    assert.equal(
      detectAcademyContactIntent(directed, { hasCourseContext: true }),
      "LIVE",
      directed,
    );
    assert.equal(
      detectDeterministicAcademyContactIntent(consumed),
      null,
      consumed,
    );
    assert.equal(
      detectAcademyContactIntent(consumed, { hasCourseContext: true }),
      null,
      consumed,
    );
  }
});

test("A10 (D-R3-F1): the governed/recipient pairs prove the precedence", () => {
  // Each pair carries the same words in the same dative form. Only the governor
  // differs, and it alone decides the lane.
  const pairs: ReadonlyArray<readonly [string, string]> = [
    [
      "Можно задать вопрос о требованиях к менеджеру?",
      "Можно задать вопрос менеджеру о требованиях?",
    ],
    [
      "Можно задать вопрос об отношении к Алексею?",
      "Можно задать вопрос Алексею об отношении команды?",
    ],
    [
      "Хочу задать вопрос о доверии к куратору",
      "Хочу задать вопрос куратору о доверии",
    ],
    // The same preposition on both sides: "по" reaches the manager in the first
    // and is already satisfied by the payment in the second.
    [
      "Можно задать вопрос по менеджеру?",
      "Можно задать вопрос по оплате менеджеру?",
    ],
  ];

  for (const [governed, recipient] of pairs) {
    assert.equal(
      detectDeterministicAcademyContactIntent(governed),
      null,
      governed,
    );
    assert.equal(
      detectAcademyContactIntent(governed, { hasCourseContext: true }),
      null,
      governed,
    );
    assert.equal(
      detectDeterministicAcademyContactIntent(recipient),
      "LIVE",
      recipient,
    );
    assert.equal(
      detectAcademyContactIntent(recipient, { hasCourseContext: true }),
      "LIVE",
      recipient,
    );
  }
});

test("A10 (D-R3-F1): an explicit contact action is untouched by the governor rule", () => {
  // The recipient rule decides whom a *question* is addressed to. A channel asks
  // for the Academy on its own terms, so "к менеджеру" next to a contact action
  // is still contact: the governor class must never become a global veto.
  const channelTurns: ReadonlyArray<readonly [string, string]> = [
    ["Как связаться с менеджером Академии?", "LIVE"],
    ["Как написать менеджеру?", "LIVE"],
    ["Можно позвонить менеджеру?", "LIVE"],
    ["Дайте Telegram и телефон Алексея.", "LIVE"],
    ["Дайте контакты Академии.", "GENERAL"],
  ];

  for (const [query, expected] of channelTurns) {
    assert.equal(detectDeterministicAcademyContactIntent(query), expected, query);
  }

  // The live-contact request through "к кому" keeps its own lane as well.
  assert.equal(
    detectAcademyContactIntent(
      "К кому можно обратиться и поговорить про обучение?",
      { hasCourseContext: false },
    ),
    "LIVE",
  );
});

test("A10 (D-R2-F1): the relation is clause-local in both directions", () => {
  // A later clause can establish a directed request on its own...
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Хочу спросить про курс. Можно задать вопрос менеджеру?",
    ),
    "LIVE",
  );
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Хочу спросить про курс. Можно спросить у менеджера?",
    ),
    "LIVE",
  );

  // ...and with no such clause, an about-question stays about, whatever follows.
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Хочу спросить про менеджера. Курс мне пока непонятен.",
    ),
    null,
  );
  assert.equal(
    detectAcademyContactIntent(
      "Хочу спросить про менеджера. Курс мне пока непонятен.",
      { hasCourseContext: true },
    ),
    null,
  );

  // A question verb in one clause does not direct a person named in another: the
  // manager is described there, not addressed.
  assert.equal(
    detectDeterministicAcademyContactIntent(
      "Хочу спросить, какой опыт у менеджера",
    ),
    null,
  );
});
