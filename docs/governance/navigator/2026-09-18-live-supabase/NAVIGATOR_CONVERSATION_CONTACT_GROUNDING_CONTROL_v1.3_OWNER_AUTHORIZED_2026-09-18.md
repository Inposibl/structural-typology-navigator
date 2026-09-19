# NAVIGATOR CONVERSATION / CONTACT / FOLLOW-UP GROUNDING CONTROL v1.3

**Date:** 2026-09-18
**Status:** OWNER-AUTHORIZED DESIGN CONTROL — NOT YET IMPLEMENTED
**Supersedes:** v1.2
**Project:** Structural Typology Academy Navigator
**Repository baseline:** `5049985613429775639daa66aace5f7674e2dd4d`
**Scope gate:** This file records the Owner-authorized product and grounding rules only. It does **not** authorize code changes, commit, push, deploy, production calls, Vercel/Supabase mutation, or corpus ingestion.

---

## 1. Purpose

This control file governs four related behaviors of the Academy Navigator:

1. mandatory user-address setup at the beginning of every new dialogue;
2. stable in-dialogue context for the user's name and preferred form of address;
3. deterministic Academy contact/escalation information;
4. stricter factual grounding for `COURSE_FOLLOW_UP` answers.

The goal is to preserve the conversational improvements already introduced while preventing unsupported claims about course content, format, safety, effectiveness, scientific status, staff, or contact channels.

---

## 2. Mandatory opening address gate

### 2.1 Required first interaction

At the beginning of **every new dialogue**, before course routing or substantive Academy guidance, the Navigator asks the user how to address them.

Canonical opening:

> Здравствуйте. Прежде чем начнём, скажите, пожалуйста, как к вам обращаться? Напишите имя и выберите: на «ты» или на «вы».

The Navigator must collect two fields:

- `displayName`
- `addressMode`: `TY` or `VY`

### 2.2 Partial answers

If the user supplies only one field, the Navigator asks only for the missing field.

Examples:

- Name only → ask: `И как вам удобнее — на «ты» или на «вы»?`
- `ты/вы` only → ask: `Как вас называть?`

If the user explicitly declines to provide a name, the dialogue may continue without a name, but the requested `ты/вы` mode must still be respected. If the user declines both, default to respectful `вы`.

### 2.3 In-dialogue persistence

For the rest of that dialogue:

- the Navigator must preserve `displayName` and `addressMode`;
- it must not switch between `ты` and `вы`;
- deterministic templates and LLM-generated responses must use the same address mode;
- the name may be used naturally when useful, but should not be mechanically repeated in every answer;
- previous assistant wording must not override the user's explicit preference.

This is **session/dialogue context**, not permission to persist the preference across unrelated future chats.

---

## 3. Conversation-act integration

The existing four-lane act architecture remains controlling:

- `NAVIGATE`
- `COURSE_FOLLOW_UP`
- `META`
- `OUT_OF_SCOPE`

A new opening state is added **before** those four lanes:

- `ADDRESS_SETUP`

Until the minimum address preference is resolved, normal routing is not run.

Once resolved, the latest user turn again has decisive priority under the existing conversational-act policy.

---

## 4. Academy contact authority — deterministic Owner-provided facts

The following contact data are **Owner-provided product facts** and should be represented as deterministic Academy metadata/configuration, not generated from model memory and not inferred from RAG.

### 4.1 Standard contact page

**URL:** https://structural-typology.academy/contacts

Approved explanation:

> В разделе «Контакты» можно связаться с Академией через форму. Это самый медленный способ получить ответ.

The URL must render as an active clickable link in the Navigator UI.

### 4.2 Fast text answer

**Telegram Academy chat:** `@AST_rulang`

Approved explanation:

> Если нужно задать вопрос и быстро получить ответ, можно написать в чат Академии в Telegram: @AST_rulang.

Implementation should render the Telegram handle as a clickable Telegram link when the UI contact layer is implemented.

### 4.3 Live communication with Academy manager

**Manager:** Алексей Лебедев
**Role:** менеджер Академии
**Availability:** 09:00–19:00 Moscow time, Monday–Friday; unavailable Saturday and Sunday.
**Purpose:** live communication and additional information needed by the user.

Approved explanation:

> Если нужно живое общение, можно обратиться к менеджеру Академии Алексею Лебедеву. Он доступен с 09:00 до 19:00 по московскому времени, кроме субботы и воскресенья, и сможет предоставить необходимую дополнительную информацию.

### 4.4 Manager image authority

Owner supplied the manager photograph in the authorizing message.

Asset binding for this control record:

- supplied file: `d42ad4ac-5bb4-48f9-a808-5cb4103a6309.png`
- SHA-256: `313706390ed01a00cf5746616b83d8dac739df4773910f6746b29fa948ef8765`
- bytes: `193601`

The image may be used for an Academy manager contact card once implementation is separately authorized.

### 4.5 Direct contact locators for Алексей Лебедев

The Owner has now supplied exact direct-contact details for Алексей Лебедев:

- **Telegram:** `@LebedevOo`
- **Telegram URL:** https://t.me/LebedevOo
- **Phone:** `+7 999 260-02-01`
- **Telephone URI:** `tel:+79992600201`

These values are deterministic Owner-provided Academy contact metadata.

Implementation rules:

- render `@LebedevOo` as an active Telegram link;
- render `+7 999 260-02-01` as an active telephone link where the client supports `tel:` URIs;
- do not alter, normalize to a different number, or invent alternative Alexey contact channels;
- retain the authorized availability window: **09:00–19:00 MSK, Monday–Friday**;
- when the user requests live communication, Alexey's direct contact should be preferred over the generic contact form;
- the Academy Telegram chat `@AST_rulang` remains the preferred channel for a quick written answer when live conversation is not required.

---

## 5. Contact escalation policy

Contact information must **not** be appended mechanically to every Navigator answer.

It should be surfaced when one of the following is true:

1. the user explicitly asks whom/how to contact;
2. the user asks about course details not supported by the current catalog/RAG;
3. the user wants fast clarification from the Academy;
4. the user asks for live human communication;
5. the Navigator reaches a factual ceiling on format, schedule, instructor/curator, exercises, psychological-safety procedures, delivery mechanics, pricing, enrollment, or similar operational details.

Recommended escalation order:

1. **Need a quick written answer** → Telegram `@AST_rulang`
2. **Need live human communication** → Алексей Лебедев via `@LebedevOo` or `+7 999 260-02-01`, during stated Moscow-time hours
3. **Standard/non-urgent contact** → https://structural-typology.academy/contacts via form; explicitly described as the slowest option

When the user's request clearly implies one channel, show that channel first rather than dumping all contacts.

---

## 6. COURSE_FOLLOW_UP grounding rule

### 6.1 Core authority rule

Every substantive statement in a course follow-up must belong to one of the following classes.

#### A. `COURSE_FACT`

Directly supported by:

- canonical Academy catalog metadata; or
- retrieved/authority-resolved course corpus evidence; or
- deterministic Owner-provided Academy metadata recorded in this control file.

These may be stated directly.

#### B. `SUPPORTED_INFERENCE`

A conservative inference from supported course facts.

It must be framed as an inference, for example:

- `Из этого следует...`
- `Для вашей задачи это может означать...`
- `Практический смысл здесь, вероятно, в том...`

It must not be presented as an explicit course promise, method, outcome, safety guarantee, or empirical finding unless the source actually says so.

#### C. `UNSUPPORTED / OUTSIDE_CURRENT_AUTHORITY`

If the answer would require information not present in the authorized sources, the Navigator must say so plainly and either:

- stop at the factual ceiling; or
- offer the relevant Academy contact route.

It must **not** fill the gap from generic model knowledge.

---

## 7. Prohibited unsupported expansions

Unless directly supported by authorized evidence, the Navigator must not assert:

- that the classical Maslow pyramid is scientifically disproven, scientifically proven, or empirically invalid;
- any general research consensus about Maslow or another theory;
- that a particular course format is individual, group, cohort, facilitated, asynchronous, synchronous, or team-based;
- that the course provides psychological-safety procedures;
- that a course lowers psychological risk;
- that a course will prevent conflict, resistance, attrition, or painful experiences;
- that a particular exercise, methodology, workshop, diagnostic, or facilitation practice exists;
- that a course is effective for a specific outcome beyond supported catalog/RAG claims;
- that a named teacher, curator, manager, or support person is involved unless deterministically authorized;
- that a page “usually has” a form, contact, button, or feature unless that feature is actually authorized/verified;
- invented contact channels or availability.

The phrase `обычно есть` must never be used to bridge missing product facts.

---

## 8. Scientific / external-knowledge questions

If a user asks questions such as:

- `Научно ли доказана теория?`
- `Что говорят исследования?`
- `Насколько это подтверждено эмпирически?`

and the current Academy corpus does not contain sufficient evidence, the Navigator must not answer from uncited general model memory inside the course-follow-up lane.

Approved pattern:

> В доступных мне материалах курса нет достаточных данных, чтобы надёжно ответить на вопрос о научной подтверждённости. Я могу объяснить, что именно заявляет сам курс, а вопрос об эмпирической базе лучше вынести отдельно — либо к материалам/источникам, если они будут добавлены, либо к Академии.

A future separately authorized external-research lane may change this rule, but it is not part of the current Navigator authority.

---

## 9. Sensitive team / psychological-safety questions

When a user asks whether training may expose painful personal issues, cause discomfort, trigger resistance, or create team risk:

- do not diagnose;
- do not guarantee safety;
- do not invent facilitation practices;
- do not infer that the course is a group process unless supported;
- distinguish what the course actually teaches from how a user might independently apply it;
- if delivery/safety procedures are not documented, say so and offer a human Academy contact.

The Navigator may say that a framework is intended for understanding rather than diagnosis **only if that distinction is supported by the authorized course material**.

---

## 10. Example corrected responses

### 10.1 Unknown group format

Instead of:

> В доступных сведениях нет формата, но по логике лучше пройти самому...

Use:

> В доступных мне материалах нет подтверждения, рассчитан ли курс на индивидуальное или командное прохождение. Поэтому я не буду придумывать, какой формат Академия считает предпочтительным. Если вам нужно быстро уточнить это, можно написать в Telegram Академии @AST_rulang. Для живого разговора можно обратиться к менеджеру Алексею Лебедеву в рабочее время.

### 10.2 Unknown safety procedures

Instead of inventing a safe facilitation method:

> В доступных мне материалах нет описания процедур психологической безопасности или работы с чувствительными темами, поэтому гарантировать, как именно это организовано, я не могу. Если для вас это критично до начала обучения, лучше уточнить у Академии до прохождения курса.

### 10.3 Contact question

> Если нужен быстрый письменный ответ — напишите в Telegram Академии: @AST_rulang.
> Если нужно живое общение — можно обратиться к менеджеру Академии Алексею Лебедеву в Telegram @LebedevOo или по телефону +7 999 260-02-01 с 09:00 до 19:00 по московскому времени, с понедельника по пятницу.
> Стандартный вариант — раздел контактов https://structural-typology.academy/contacts и форма связи; это самый медленный способ получить ответ.

---

## 11. UI requirements for a later implementation act

When separately authorized, the UI should support:

1. active clickable Academy contact link;
2. active clickable Telegram handle;
3. manager contact card with:
   - supplied photograph;
   - `Алексей Лебедев`;
   - `Менеджер Академии`;
   - `09:00–19:00 МСК, Пн–Пт`;
   - short purpose text;
   - active Telegram CTA to `https://t.me/LebedevOo`;
   - active phone CTA to `tel:+79992600201`;
4. consistent `ты/вы` rendering in all Navigator-generated text;
5. no raw RAG citations unless explicitly requested, preserving the current CORR3 policy.

---

## 12. Required implementation architecture for the next code act

The next implementation should remain course-generic and separate concerns:

### A. `conversation-profile`
Responsible only for:

- `ADDRESS_SETUP`
- `displayName`
- `addressMode`
- missing-field resolution
- dialogue-local persistence

### B. `academy-contact-policy`
Deterministic config for:

- contact page;
- Telegram chat;
- manager identity/photo/hours;
- escalation priority.

This information must not be generated by DeepSeek and must not be stored as course RAG.

### C. `course-follow-up-grounding`
Responsible for:

- source-backed course facts;
- bounded supported inference;
- factual-ceiling response;
- contact escalation on missing operational facts.

### D. existing conversational-act router
Retains:

- latest-user-turn priority;
- `NAVIGATE`
- `COURSE_FOLLOW_UP`
- `META`
- `OUT_OF_SCOPE`

No regression to old whole-conversation course capture is permitted.

---

## 13. Regression requirements for the next code act

At minimum, automated tests must cover:

1. first dialogue turn always asks name + `ты/вы`;
2. routing does not run before address setup completes;
3. partial profile answer asks only for the missing field;
4. chosen `ты/вы` mode persists across multiple turns;
5. user name is retained without forced repetition;
6. unrelated new topic still becomes `OUT_OF_SCOPE`;
7. course follow-up remains bound to the actual mentioned course;
8. unsupported scientific claim is not generated as fact;
9. unsupported course format is not invented;
10. unsupported psychological-safety guarantee is not invented;
11. contact-page URL is exact and active;
12. Telegram handle is exact and active;
13. manager name/hours are exact;
14. Alexey Telegram is exactly `@LebedevOo` / `https://t.me/LebedevOo`;
15. Alexey phone is exactly `+79992600201` / `tel:+79992600201`;
16. no alternative Alexey contact locator is invented;
17. missing course-operational fact triggers the correct contact escalation;
18. initial recommendation still hides raw RAG citations;
19. explicit source request may still show grounded evidence;
20. no regression to canonical internal outcome-label leakage.

---

## 14. Controlling decisions

**OWNER-ACCEPTED / AUTHORIZED FOR DESIGN CONTROL**

- Mandatory dialogue-opening address setup: **YES**
- Ask for name: **YES**
- Ask `ты` or `вы`: **YES**
- Retain address context during dialogue: **YES**
- Contacts page: **https://structural-typology.academy/contacts**
- Contact form characterized as slowest method: **YES**
- Fast-answer Telegram: **@AST_rulang**
- Live manager: **Алексей Лебедев**
- Manager availability: **09:00–19:00 MSK, Monday–Friday**
- Manager photo supplied: **YES**
- Direct Alexey Telegram: **@LebedevOo**
- Direct Alexey Telegram URL: **https://t.me/LebedevOo**
- Direct Alexey phone: **+79992600201**
- Direct Alexey telephone URI: **tel:+79992600201**
- COURSE_FOLLOW_UP grounding hardening: **ACCEPTED**
- Fact / inference / unsupported separation: **ACCEPTED**
- No generic-model filling of course evidence gaps: **ACCEPTED**
- Contact escalation on factual ceiling: **ACCEPTED**
- Payment conversion handoff via `@AST_payment_course_bot`: **ACCEPTED**
- Course-specific payment deep links: **ACCEPTED**
- Explicit enrollment/payment intent bypasses ordinary course follow-up RAG: **ACCEPTED**

---


## 15. Enrollment / payment conversion policy

### 15.1 Product goal

When the Navigator has brought a user to a concrete course choice and the user expresses enrollment/payment intent, the Navigator must make the next commercial step immediate and unambiguous.

Examples of enrollment/payment intent include:

- `Хочу на этот курс`
- `Как записаться?`
- `Хочу оплатить`
- `Как купить курс?`
- `Куда платить?`
- `Мне подходит курс, хочу участвовать`

This is a deterministic product action, not a generative guess.

### 15.2 Payment bot authority

**Telegram payment bot:** `@AST_payment_course_bot`
**General URL:** https://t.me/AST_payment_course_bot

For a known selected course, the Navigator must use the course-specific `?start=` parameter exactly as defined below.

| Academy course | Internal course id | Exact payment URL |
| --- | --- | --- |
| Структурная типология личности | `structural-typology` | https://t.me/AST_payment_course_bot?start=structural_typology |
| Иерархия уровней сознания | `levels-of-consciousness` | https://t.me/AST_payment_course_bot?start=levels_of_consciousness |
| Иерархия потребностей А. Маслоу | `maslow` | https://t.me/AST_payment_course_bot?start=maslow |
| Нормативная ситуация | `normative-situation` | https://t.me/AST_payment_course_bot?start=normative_situation |
| Игра и творчество | `play-and-creativity` | https://t.me/AST_payment_course_bot?start=play_and_creativity |
| Course not resolved | — | https://t.me/AST_payment_course_bot |

The parameter values are product identifiers and must not be generated, transliterated, or normalized at runtime.

### 15.3 Owner-provided bot destination facts

The Owner provided the following current bot behavior:

- `structural_typology` → program for Structural Typology, Sunday schedule and level selection 1/2/3 or all three with a 20% discount for 160,000 ₽;
- `levels_of_consciousness` → four-meeting course, price 40,000 ₽ and nearest cohort;
- `maslow` → six-meeting course, price 60,000 ₽ and Monday schedule;
- `normative_situation` → six-meeting course, price 60,000 ₽ and Thursday schedule;
- `play_and_creativity` → six-meeting course, price 60,000 ₽ and Tuesday schedule;
- no `start` parameter → Academy catalogue / general enrollment entry point.

These are deterministic Owner-provided enrollment facts. They are not RAG-derived.

The Navigator does not need to repeat all of these details every time. Their primary function is to guarantee that the correct bot destination is selected. If a user directly asks for price/schedule and the value is exposed by this deterministic policy, the Navigator may state it as current Academy enrollment metadata.

### 15.4 Response behavior

When a specific course is resolved:

> Отлично! Для оформления участия, выбора удобного потока и оплаты перейдите к Помощнику по оплате курсов в Telegram: <COURSE_PAYMENT_URL>. Он за 1 минуту оформит заявку и пришлёт реквизиты или счёт для бухгалтерии.

When enrollment intent is clear but the course is not resolved:

> Для записи и оплаты откройте Помощника по оплате курсов в Telegram: https://t.me/AST_payment_course_bot. Там можно выбрать программу из каталога Академии.

The URL must be rendered as an active clickable link.

### 15.5 Routing priority

Enrollment/payment intent is a deterministic conversion action and has priority over ordinary explanatory `COURSE_FOLLOW_UP`.

For a latest user turn with clear enrollment/payment intent:

1. resolve the selected course from the already-bound `COURSE_FOLLOW_UP` course when available;
2. otherwise resolve an explicitly named supported course from the latest user turn;
3. otherwise use the general payment-bot URL;
4. bypass course RAG retrieval and follow-up generation for that turn;
5. do not ask additional course-selection questions merely after the user has already committed to a known course.

The payment action must not be triggered by weak language such as merely asking what a course costs, what it contains, or whether it might fit. There must be explicit enrollment/payment intent.

### 15.6 Scope limitations

No payment URL is currently authorized for courses not listed in the table above.

Do not invent a `?start=` identifier for:

- `professional-development-stages`;
- future/unlisted programs;
- arbitrary course names.

If such a program is explicitly selected and no payment identifier exists, use the general bot URL and do not fabricate a deep link.

### 15.7 Required regression coverage

The implementation must verify at minimum:

1. `Хочу на этот курс` after Maslow recommendation → exact `?start=maslow`;
2. `Мне подходит курс по уровням сознания, хочу оплатить` → exact `?start=levels_of_consciousness`;
3. explicit Structural Typology enrollment → exact `?start=structural_typology`;
4. Normative Situation enrollment → exact `?start=normative_situation`;
5. Play & Creativity enrollment → exact `?start=play_and_creativity`;
6. `Как записаться?` without a resolved course → general `https://t.me/AST_payment_course_bot`;
7. mere price/content question does not trigger checkout;
8. enrollment action bypasses RAG and does not regenerate the course recommendation;
9. unlisted course never receives an invented `?start=` value;
10. payment link remains active/clickable in the Navigator UI.

## 16. Current stop point

This document is the authorized stopping point.

**Not performed:**

- no source-code changes;
- no tests changed;
- no repository write;
- no commit;
- no push;
- no deploy;
- no production request;
- no Vercel mutation;
- no Supabase mutation;
- no RAG ingestion.

The next risk-bearing act requires separate Owner authorization.
