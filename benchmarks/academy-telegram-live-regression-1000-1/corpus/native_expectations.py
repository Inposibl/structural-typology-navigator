"""Native-expectation derivation for Navigator L1 seams (CORR3).

Derives EXPECTED values for navigator_l1 payment/course scenarios by a
FAITHFUL port of the controlling native regex contracts in
src/lib/academy/payment-policy.ts (ENROLLMENT_INTENT_PATTERNS) and
course-reference.ts (COURSE_ALIASES). This is expectation derivation from the
controlling contract source — the native adapter computes ACTUALs from the
real TypeScript at execution time; any divergence is an honest product FAIL.

\\b caveat: TS \\b is ASCII-based; Python's is unicode-aware. Corpus queries
never place Latin alias words adjacent to Cyrillic letters, so the port is
exact for the corpus domain; recorded here as a known boundary.
"""

from __future__ import annotations

import re

INTENT_PATTERNS = [
    re.compile(r"хочу\s+на\s+(?:этот\s+)?курс", re.I | re.U),
    re.compile(r"хочу\s+(?:оплатить|записаться|купить|участвовать|оформить)", re.I | re.U),
    re.compile(r"как\s+(?:записаться|оплатить|купить|оформить)", re.I | re.U),
    re.compile(r"куда\s+(?:платить|оплачивать|перевести)", re.I | re.U),
    re.compile(r"готов[а-яё]*\s+(?:оплатить|записаться|идти\s+на\s+курс|участвовать)", re.I | re.U),
    re.compile(r"(?:запишите|запиши)\s+меня", re.I | re.U),
    re.compile(r"(?:пришлите|пришли)\s+(?:ссылку\s+)?(?:на\s+)?оплат", re.I | re.U),
    re.compile(r"(?:^|\n)\s*(?:оплатить|записаться|купить|оформить)(?![а-яё])", re.I | re.U),
]

COURSE_ALIASES = [
    ("structural-typology", [r"структурн[а-яё]*\s+типолог", r"типолог[а-яё]*\s+личност",
                             r"майерс[а-яё-]*\s+бриггс", r"(?<![a-z])structural[-\s]+typolog",
                             r"\bmbti\b"]),
    ("levels-of-consciousness", [r"уровн[а-яё]*\s+сознани", r"(?<![a-z])levels[-\s]+of[-\s]+consciousness(?![a-z])",
                                 r"иерархи[а-яё]*\s+уровн[а-яё]*\s+сознани"]),
    ("maslow", [r"маслоу", r"(?<![a-z])maslow(?![a-z])", r"иерархи[а-яё]*\s+потребност"]),
    ("normative-situation", [r"нормативн[а-яё]*\s+ситуац", r"(?<![a-z])normative[-\s]+situation(?![a-z])"]),
    ("play-and-creativity", [r"игр[а-яё]*\s+(?:и|&)\s+творчеств", r"творчеств[а-яё]*\s+(?:и|&)\s+игр",
                             r"(?<![a-z])play[-\s]+(?:and|&)[-\s]+creativit"]),
]

PAYMENT_COURSES = {"structural-typology", "levels-of-consciousness", "maslow",
                   "normative-situation", "play-and-creativity"}

PAY_URLS = {
    "structural-typology": "https://t.me/AST_payment_course_bot?start=structural_typology",
    "levels-of-consciousness": "https://t.me/AST_payment_course_bot?start=levels_of_consciousness",
    "maslow": "https://t.me/AST_payment_course_bot?start=maslow",
    "normative-situation": "https://t.me/AST_payment_course_bot?start=normative_situation",
    "play-and-creativity": "https://t.me/AST_payment_course_bot?start=play_and_creativity",
}
GENERAL_URL = "https://t.me/AST_payment_course_bot"


def resolve_course_references(query: str) -> tuple[str, list[str]]:
    ids = []
    for course_id, patterns in COURSE_ALIASES:
        if any(re.search(p, query, re.I | re.U) for p in patterns):
            ids.append(course_id)
    if not ids:
        return "ZERO", []
    if len(ids) == 1:
        return "ONE", ids
    return "MULTIPLE", ids


def has_enrollment_intent(query: str) -> bool:
    return any(p.search(query) for p in INTENT_PATTERNS)


def expected_payment_decision(query: str, act_state: str = "NAVIGATE",
                              context: dict | None = None) -> dict:
    """Derive the expected native decision per the controlling contract."""
    context = context or {}
    if not has_enrollment_intent(query):
        return {"decisionKind": "NONE", "courseId": None, "paymentUrl": None,
                "refKind": resolve_course_references(query)[0]}
    if act_state == "OUT_OF_SCOPE":
        return {"decisionKind": "NONE", "courseId": None, "paymentUrl": None,
                "refKind": resolve_course_references(query)[0]}
    kind, ids = resolve_course_references(query)
    if kind == "MULTIPLE":
        return {"decisionKind": "CLARIFY_MULTIPLE", "courseId": None, "paymentUrl": None,
                "refKind": kind}
    explicit = ids[0] if kind == "ONE" else None
    if explicit is not None and explicit not in PAYMENT_COURSES:
        return {"decisionKind": "COURSE_NOT_PAYABLE", "courseId": explicit,
                "paymentUrl": None, "refKind": kind}
    selected = context.get("selectedCourseId") if context.get("selectedCourseId") in PAYMENT_COURSES else (
        None)  # act COURSE_FOLLOW_UP not used by corpus L1 rows
    if explicit is not None and explicit in PAYMENT_COURSES:
        if selected is not None and selected != explicit:
            return {"decisionKind": "CONFIRM_COURSE_CHANGE", "courseId": explicit,
                    "paymentUrl": None, "refKind": kind}
        return {"decisionKind": "ACTION", "courseId": explicit,
                "paymentUrl": PAY_URLS[explicit], "refKind": kind}
    if context.get("staleCourseReference"):
        return {"decisionKind": "REESTABLISH_COURSE", "courseId": None, "paymentUrl": None,
                "refKind": kind}
    if context.get("courseMatch") == "NO_CURRENT_COURSE_MATCH":
        return {"decisionKind": "PRESERVE_NO_MATCH", "courseId": None, "paymentUrl": None,
                "refKind": kind}
    if selected is not None:
        return {"decisionKind": "ACTION", "courseId": selected,
                "paymentUrl": PAY_URLS[selected], "refKind": kind}
    if act_state != "META":
        return {"decisionKind": "ACTION", "courseId": None, "paymentUrl": GENERAL_URL,
                "refKind": kind}
    return {"decisionKind": "NONE", "courseId": None, "paymentUrl": None, "refKind": kind}


def expected_authority(query: str) -> dict:
    kind, ids = resolve_course_references(query)
    if kind == "ONE":
        # authority table: structural-typology 200000, levels 45000, maslow 60000,
        # normative 45000, play 60000, professional-development-stages UNAVAILABLE
        prices = {"structural-typology": 200000, "levels-of-consciousness": 45000,
                  "maslow": 60000, "normative-situation": 45000, "play-and-creativity": 60000}
        cid = ids[0]
        if cid in prices:
            return {"refKind": kind, "priceStatus": "SUPPORTED", "priceValue": prices[cid]}
        return {"refKind": kind, "priceStatus": "UNAVAILABLE", "priceValue": None}
    return {"refKind": kind, "priceStatus": "NOT_RESOLVED", "priceValue": None}
