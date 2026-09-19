import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_CONTACT_POLICY,
  composeAcademyContactAnswer,
  detectAcademyContactIntent,
  getAcademyManagerContactCard,
} from "../../src/lib/academy/contact-policy.ts";

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
