# ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.SECURITY-CREDENTIAL-ROTATION-1

VERDICT: **PASS**

Act date: `2026-09-21`.

## 1. Incident being remediated

- [VERIFIED] During `ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.COURSE-BINDING-1`, the then-current Supabase backend secret was accidentally exposed in a tool transcript.
- [VERIFIED] The exposed credential was therefore treated as compromised.
- [VERIFIED] No secret value, fragment, screenshot, or credential material is recorded in this report.

## 2. Credential class

- [VERIFIED] The Navigator backend reads the Supabase server credential from `SUPABASE_SECRET_KEY`.
- [VERIFIED] The accepted runtime requires the modern `sb_secret_...` credential class.
- [VERIFIED] No JWT signing-secret rotation was required or performed.

## 3. Replacement credential creation

- [OPERATOR-CONFIRMED] A replacement Supabase secret key was created for project `mgtghkxebccahtqqyyjv`.
- [OPERATOR-CONFIRMED] The replacement value was not shared in chat or committed to source control.

## 4. Local environment cutover

- [OPERATOR-CONFIRMED] `.env.local` was updated so `SUPABASE_SECRET_KEY` uses the replacement secret.
- [VERIFIED] `.env.local` remained Git-ignored.
- [VERIFIED] Pre-revocation local connectivity with the replacement credential succeeded.
- [VERIFIED] The local Supabase check returned exactly 16 binding rows and 16 active rows.

## 5. Vercel environment cutover

- [OPERATOR-CONFIRMED] `SUPABASE_SECRET_KEY` was replaced in Vercel with scope `All Environments`.
- [OPERATOR-CONFIRMED] Production was redeployed after the environment-variable replacement.
- [OPERATOR-CONFIRMED] No application-code change was introduced for the redeployment.

## 6. Pre-revocation production verification

- [VERIFIED] Production Navigator successfully routed an educational request to the course `levels-of-consciousness`.
- [VERIFIED] A same-conversation course follow-up returned substantive course-grounded content describing levels of consciousness, stages of apperception, protection-of-perception patterns, and their recognition/neutralization.
- [INFERRED] This behavior is consistent with the deployed runtime successfully accessing the newly bound course corpus before the old credential was revoked.

## 7. Compromised credential revocation

- [OPERATOR-CONFIRMED] The previously exposed Supabase secret key was deleted/revoked.
- [OPERATOR-CONFIRMED] The replacement secret remained active.
- [OPERATOR-CONFIRMED] Publishable credentials and JWT signing authority were not changed.

## 8. Post-revocation production verification

- [VERIFIED] After revocation, production Navigator continued processing the existing `levels-of-consciousness` course follow-up path.
- [VERIFIED] For a question for which the selected evidence was insufficient, Navigator returned the expected factual-ceiling response instead of fabricating an answer.
- [INFERRED] The continued operation of the course-follow-up path after revocation is evidence that the deployed backend is operating with the replacement Supabase credential.

## 9. Post-revocation local verification

[VERIFIED] The local post-revocation check returned:

- total bindings: 16
- active bindings: 16
- `maslow`: 5
- `levels-of-consciousness`: 4
- `play-and-creativity`: 3
- `normative-situation`: 2
- `structural-typology`: 2

[VERIFIED] Terminal result:

`POST_REVOCATION_LOCAL_CHECK: PASS`

## 10. RAG binding non-regression

- [VERIFIED] Total `academy_course_sources` state remains exactly 16 total / 16 active.
- [VERIFIED] The accepted five Maslow bindings remain present.
- [VERIFIED] The four newly activated course families retain their exact accepted counts:
  - `levels-of-consciousness`: 4
  - `play-and-creativity`: 3
  - `normative-situation`: 2
  - `structural-typology`: 2
- [VERIFIED] No active binding exists for `professional-development-stages`.
- [VERIFIED] The security-rotation act did not alter the accepted 11-row course-binding manifest.

## 11. Focused non-regression tests

[VERIFIED] Command:

`node --import tsx --test tests/knowledge/course-retrieval.test.mts tests/knowledge/authority-resolver.test.mts`

[VERIFIED] Result:

- tests: 6
- pass: 6
- fail: 0
- cancelled: 0
- skipped: 0

## 12. Mutation boundary

- [OPERATOR-CONFIRMED] No application code was intentionally changed.
- [OPERATOR-CONFIRMED] No database schema or migration was intentionally changed.
- [OPERATOR-CONFIRMED] No RPC was intentionally changed.
- [OPERATOR-CONFIRMED] No Storage object was intentionally changed.
- [OPERATOR-CONFIRMED] No source/document/chunk data was intentionally changed.
- [VERIFIED] The accepted course-binding counts remain unchanged after credential rotation.
- [VERIFIED] The authorized operational change was limited to replacement of the exposed backend credential, runtime environment cutover, redeployment, and revocation of the exposed credential.

## 13. Security outcome

- [OPERATOR-CONFIRMED] The exposed secret has been revoked.
- [VERIFIED] The replacement secret successfully authenticates local Navigator access after revocation.
- [VERIFIED] Production Navigator remained operational after revocation.
- [VERIFIED] Course-binding non-regression remained 16/16 active.
- [VERIFIED] Focused retrieval/authority tests remained 6/6 PASS.

## 14. Git safety

No stage, commit, or push is authorized by this act.

The final repository safety state is established after serialization of this report.

## 15. Report SHA-256

The authoritative SHA-256 is the final `shasum -a 256` result produced after this report is serialized. It is not embedded here to avoid self-reference.

## 16. Exact proposed next act

`ACADEMY-MULTI-COURSE-RAG-EXPANSION-1.COURSE-BINDING-1.IV1`

This act does not start IV1.

## Final statement

**PASS.** The exposed Supabase backend credential was replaced across Vercel `All Environments`, verified locally, deployed to production, and the old credential was revoked. Post-revocation Navigator access remains operational, the accepted multi-course RAG binding state remains exactly 16/16 active, and the focused retrieval/authority suite remains 6/6 PASS.
