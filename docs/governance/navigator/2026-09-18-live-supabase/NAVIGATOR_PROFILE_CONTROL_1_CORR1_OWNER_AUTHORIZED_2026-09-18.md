# NAVIGATOR PROFILE CONTROL 1.CORR1

**Date:** 2026-09-18
**Status:** OWNER-AUTHORIZED LOCAL CORRECTION CANDIDATE
**Baseline:** `9078bb1eeb90f703905daaacc2b45b2d6209da32`
**Parent control:** `NAVIGATOR_CONVERSATION_CONTACT_GROUNDING_CONTROL_v1.3_OWNER_AUTHORIZED_2026-09-18.md`

## Problem

Production dialogue showed that the initial `ADDRESS_SETUP` gate existed, but its state machine was not sufficiently isolated from educational routing.

Observed failure chain:

1. `Хуй с горы на ты` correctly exposed `TY`, but the name parser rejected the three-word display name.
2. The unconsumed text was incorrectly promoted to `pendingUserRequest`.
3. A later short answer completed the profile and released the false pending request into conversational routing.
4. After profile completion, rename / address-mode / restart commands had no deterministic control lane and could be classified as `NAVIGATE`, `META`, or `OUT_OF_SCOPE`.

## Controlling correction

### Required-slot gate

`displayName | explicit name decline` and `addressMode` remain required dialogue-local slots.

Until both are resolved:

- educational conversational-act routing does not run;
- course routing does not run;
- course RAG does not run;
- only a clearly segmented substantive task may be retained as `pendingUserRequest`.

Unknown residue is not automatically promoted to a task.

### Display name

The display name is a conversational label, not an identity-validation field.

The setup parser must accept reasonable multi-word names / aliases / nicknames up to the existing 80-character limit, including examples such as:

- `Иван Петров`
- `Доктор Хаус`
- `Хуй с горы`

The parser must not reinterpret a clearly substantive task as a name.

### PROFILE_CONTROL lane

Before the four-lane conversation-act router, a deterministic `PROFILE_CONTROL` layer handles:

- explicit rename (`меня зовут Иван`, `зови меня Иван`);
- explicit `ты/вы` switch (`давай на вы`, `обращайся ко мне на ты`);
- stop using name (`не называй меня по имени`);
- dialogue restart (`давай сначала`, `сбрось диалог`).

These commands do not reach the educational router.

### Restart semantics

A restart:

- clears dialogue-local profile;
- clears old conversation/course binding in the client;
- returns to mandatory `ADDRESS_SETUP`;
- does not preserve the prior educational thread.

### Task segmentation

`pendingUserRequest` remains available only for a clearly separate substantive task, such as:

`Николай. Мне нужен курс про мотивацию команды`

or:

`Иван, на ты. Хочу разобраться с мотивацией команды`

A residue that does not match the explicit substantive-task surface is not retained as a future routing request.

## Professional pattern basis

This correction follows mature conversation-state patterns rather than treating every turn as free-form intent routing:

1. **Google Dialogflow CX form parameters** — required parameters are collected before form filling concludes; session parameters carry structured dialogue state during the session.
   - https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter
2. **Rasa slots and sessions** — slots are explicit conversational state and can be reset deliberately rather than inferred from arbitrary historical text.
   - https://rasa.com/docs/reference/primitives/slots/
   - https://rasa.com/docs/reference/config/domain/
3. **Microsoft Bot Framework state** — conversation state is distinct from broader user state and is used to retain transient information between turns in a specific dialogue.
   - https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-concept-state

## Regression requirements

At minimum:

- `Хуй с горы на ты` → `displayName="Хуй с горы"`, `addressMode=TY`, no routing;
- `Доктор Хаус` during setup → name accepted, mode still requested;
- `я хочу учиться еба` during unresolved setup → task retained, not name, no routing;
- `Иван, на ты. Хочу разобраться с мотивацией команды` → profile completed and only the separated task proceeds;
- `меня зовут Иван` after setup → profile update, no course routing;
- `давай на вы` → profile update, no course routing;
- `ты чё дебил?` → not interpreted as a `ты/вы` setting command;
- `ну ладно ладно. давай сначала` → full dialogue reset and fresh `ADDRESS_SETUP`;
- reset clears old client-side course context.

## Scope

This act is local implementation only.

Not authorized/performed:

- commit;
- push;
- deploy;
- production request;
- Vercel mutation;
- Supabase mutation.
