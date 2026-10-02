"""RAG diagnostic capture contract + benign local fixture suite — CORR5 F05
(IV5 owner sections 15-16, 39; CORR4 B-08 owner sections 15-17, 41).

The contract artifact documents the corrected capture order AND the typed
source-bound observability contract:
  1. send the local test request;
  2. capture the ACTUAL server-returned request-ID response header
     (native route.ts mints logRequestId = randomUUID() and returns it in
     X-Navigator-Request-Id; the client body requestId is NOT log authority);
  3. correlate NAVIGATOR_TURN / NAVIGATOR_GROUNDING events by THAT server
     identity;
  4. freeze the matching raw structured log events;
  5. derive diagnostic fields from those frozen events with evidence refs;
  6. every field is validated against its EXACT native type/enum contract
     (RAG_DIAGNOSTIC_SCHEMA) — no integer may satisfy an enum/string field,
     no arbitrary string may satisfy a finite enum; an invalid enum/value is
     retained as raw evidence but is UNOBSERVED for authority;
  7. the schema records the sha256 of the native observability source files;
     if a future bound TEST_BASE contains different source bytes, the RAG
     diagnostic contract requires REVALIDATION before execution
     (source-contract validity, not a product verdict).

The fixture suite verifies the collector against benign synthetic log files
under a temp directory ONLY — no Navigator server, no network.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
if str(BENCH) not in sys.path:
    sys.path.insert(0, str(BENCH))

from adapters.product import (  # noqa: E402
    RAG_ALL_FIELDS,
    RAG_DIAGNOSTIC_SCHEMA_FIELDS,
    collect_rag_diagnostics,
)
from harness.evidence import UNOBSERVED  # noqa: E402

RAG_SOURCE_FILES = (
    "src/lib/navigation/navigator-observability.ts",
    "src/app/api/chat/route.ts",
)


def _sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _source_hashes() -> dict[str, str]:
    """sha256 of the native observability source files at the recorded
    working tree (read-only; the artifact pins the contract to these bytes)."""
    out = {}
    for rel in RAG_SOURCE_FILES:
        p = BENCH.parent.parent / rel
        out[rel] = _sha256_file(p) if p.exists() else None
    return out


RAG_DIAGNOSTIC_CAPTURE_CONTRACT = {
    "schema": "RAG_DIAGNOSTIC_CAPTURE_CONTRACT_V5",
    "correlation_authority": {
        "step_1": "send the local test request (client body requestId is a label only)",
        "step_2": ("capture the actual SERVER-RETURNED request-id header "
                   "X-Navigator-Request-Id (native logRequestId = randomUUID()); "
                   "body['requestId'] is never log authority unless native server "
                   "behavior changes and source establishes equivalence"),
        "step_3": "correlate NAVIGATOR_TURN / NAVIGATOR_GROUNDING events by that server identity",
        "step_4": "freeze the matching RAW structured log events into the capture",
        "step_5": "derive diagnostic fields FROM the frozen events with evidence references",
        "step_6": ("validate every field against its EXACT native type/enum contract "
                   "(RAG_DIAGNOSTIC_SCHEMA.json); an invalid enum/value becomes "
                   "INVALID and UNOBSERVED for authority per the documented rule"),
    },
    "fields": {
        f: {
            "source_event": spec["source_event"],
            "nullable": spec["nullable"],
            "type": spec["type"],
            "allowed_values": (list(spec["allowed_values"])
                               if spec["allowed_values"] else None),
            "source_native_symbol": spec["source_native_symbol"],
        }
        for f, spec in RAG_DIAGNOSTIC_SCHEMA_FIELDS.items()
    },
    "validation_rules": {
        "counts": "activeBindingCount / retrievedMatchCount / resolvedEvidenceCount must be non-negative integers (bool excluded)",
        "booleans": "ragInvoked / repairAttempted must be actual booleans",
        "enums": ("finite enums accept ONLY their declared native members; "
                  "conversationAct/reasonCode additionally allow null per the native "
                  "contract; courseId is string-or-null"),
        "malformed_values": ("a malformed value is retained as raw evidence but marked "
                             "valid=false and authority_value=UNOBSERVED: it never "
                             "becomes a valid diagnostic conclusion"),
        "missing_events": "absent event -> UNOBSERVED (never response-text keyword detection)",
        "wrong_request_id": "events carrying a foreign requestId are ignored entirely",
        "malformed_json_lines": "ignored (documented); absence of matching events leaves all fields UNOBSERVED",
    },
    "event_selection_semantics": (
        "Grounding may emit more than one event. The FINAL grounding event in file "
        "sequence represents stage/repairAttempted/reasonCode (a later repair/final "
        "event materially updates them); the full ordered sequence and event count "
        "are preserved in the capture. The LAST NAVIGATOR_TURN event represents the "
        "turn fields."),
    "evidence_binding": (
        "Every derived field carries: event type, server request id, raw event "
        "evidence id (event:serverRequestId:sequence:digest), field name, and field "
        "value digest. No diagnostic exists merely as an auxiliary scalar."),
    "native_source_basis": (
        "src/app/api/chat/route.ts: logRequestId = randomUUID(); turn/grounding logs "
        "and the X-Navigator-Request-Id response header use that identity. Turn "
        "fields are top-level properties of the turn log; grounding fields are "
        "stage/repairAttempted/reasonCode."),
    "source_bound_contract": {
        "native_source_sha256": _source_hashes(),
        "revalidation_rule": ("if a future bound TEST_BASE contains different source "
                             "bytes for these files, the RAG diagnostic contract "
                             "REQUIRES REVALIDATION of the typed schema against the "
                             "new source before execution: this is source-contract "
                             "validity, not a product verdict"),
    },
}


def _write_log(path: Path, events: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        for e in events:
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")


def _turn(rid: str, **over) -> dict:
    # NATIVE enum values only (F05): the fixture carries contract-valid values
    base = {"event": "NAVIGATOR_TURN", "requestId": rid, "conversationAct": "META",
            "courseId": None, "ragInvoked": True, "activeBindingCount": 2,
            "retrievedMatchCount": 5, "resolvedEvidenceCount": 3,
            "evidenceSelectionStatus": "SUPPORTED", "answerOrigin": "RAG_EVIDENCE",
            "fallback": "NONE"}
    base.update(over)
    return base


def _ground(rid: str, stage: str, repair: bool, reason: str | None = None) -> dict:
    return {"event": "NAVIGATOR_GROUNDING", "requestId": rid, "stage": stage,
            "repairAttempted": repair, "reasonCode": reason}


def run_rag_fixture_suite(out_path: str | None = None) -> dict:
    """Benign local fixture suite (owner section 41). No server, no network."""
    cases: list[dict] = []

    def case(name: str, events, server_id: str | None, check) -> None:
        with tempfile.TemporaryDirectory(prefix="rag-fixture-") as td:
            log = Path(td) / "navigator.jsonl"
            _write_log(log, events)
            diag = collect_rag_diagnostics({"navigator_l2_log_path": str(log)}, server_id)
            outcome = check(diag)
            if isinstance(outcome, tuple):
                ok, detail = outcome
            else:
                ok, detail = outcome, ""
            cases.append({"case": name, "pass": bool(ok), "detail": detail})

    SRV = "server-uuid-1"

    # 1. matching server-returned request id: all 12 fields captured, VALID
    #    under the exact native enums, with evidence refs
    def c1(d):
        unobs = [f for f in RAG_ALL_FIELDS if d["fields"][f]["value"] is UNOBSERVED]
        refs = all(d["fields"][f].get("raw_event_evidence_id")
                   for f in RAG_ALL_FIELDS if d["fields"][f]["value"] is not UNOBSERVED)
        valid = all(d["fields"][f]["valid"] for f in RAG_ALL_FIELDS)
        return (not unobs) and refs and valid \
            and d["correlation"]["server_request_id"] == SRV, \
            f"unobserved={unobs} evidence_refs={refs} all_valid={valid}"
    case("matching server request id captures all fields valid with evidence refs",
         [_turn(SRV), _ground(SRV, "PRIMARY_AUDIT_PASS", False, None)], SRV, c1)

    # 2. foreign request id ignored
    case("foreign request id ignored (all UNOBSERVED)",
         [_turn("other-id"), _ground("other-id", "PRIMARY_AUDIT_PASS", False)], SRV,
         lambda d: all(d["fields"][f]["value"] is UNOBSERVED for f in RAG_ALL_FIELDS))

    # 3. no events -> UNOBSERVED
    case("no events -> UNOBSERVED", [], SRV,
         lambda d: all(d["fields"][f]["value"] is UNOBSERVED for f in RAG_ALL_FIELDS))

    # 4. field-name text under an unrelated event is not a diagnostic
    case("field-name text under unrelated event ignored",
         [{"event": "OTHER", "requestId": SRV, "conversationAct": "FAKE"}], SRV,
         lambda d: d["fields"]["conversationAct"]["value"] is UNOBSERVED)

    # 5. malformed JSON line ignored
    with tempfile.TemporaryDirectory(prefix="rag-fixture-") as td:
        log = Path(td) / "navigator.jsonl"
        log.write_text("this is not json\n" + json.dumps(_turn(SRV)) + "\n")
        d = collect_rag_diagnostics({"navigator_l2_log_path": str(log)}, SRV)
        cases.append({"case": "malformed JSON line ignored", "pass": d["fields"]["ragInvoked"]["value"] is True,
                      "detail": "valid line still parsed"})

    # 6. incorrect field types -> invalid diagnostics (not valid)
    case("wrong value types marked invalid",
         [_turn(SRV, ragInvoked="yes", activeBindingCount=-9, retrievedMatchCount=[1])], SRV,
         lambda d: (d["fields"]["ragInvoked"]["valid"] is False
                    and d["fields"]["activeBindingCount"]["valid"] is False
                    and d["fields"]["retrievedMatchCount"]["valid"] is False
                    and d["valid"] is False))

    # 7. multiple grounding events -> deterministic FINAL event representation
    def c7(d):
        f = d["fields"]
        return (f["groundingStage"]["value"] == "REPAIR_AUDIT_PASS"
                and f["repairAttempted"]["value"] is True
                and f["reasonCode"]["value"] == "UNSUPPORTED_CLAIM"
                and d["grounding_event_count"] == 2
                and d["grounding_stage_sequence"] == ["PRIMARY_AUDIT_FAIL",
                                                      "REPAIR_AUDIT_PASS"]), \
            f"stage={f['groundingStage']['value']} count={d['grounding_event_count']}"
    case("multiple grounding events: final event represents stage/repair/reason",
         [_turn(SRV), _ground(SRV, "PRIMARY_AUDIT_FAIL", False, "UNSUPPORTED_CLAIM"),
          _ground(SRV, "REPAIR_AUDIT_PASS", True, "UNSUPPORTED_CLAIM")], SRV, c7)

    # 8. raw events frozen in the capture
    case("matching raw events frozen",
         [_turn(SRV), _ground(SRV, "PRIMARY_AUDIT_PASS", False, None)], SRV,
         lambda d: len(d["raw_events"]) == 2 and all(
             "raw_event_evidence_id" in e and "raw_event" in e for e in d["raw_events"]))

    # 9. no server-returned header -> documented UNOBSERVED reason
    case("no server header on response -> UNOBSERVED with reason",
         [_turn(SRV)], None,
         lambda d: all(d["fields"][f]["value"] is UNOBSERVED for f in RAG_ALL_FIELDS)
         and d["correlation"]["reason"].startswith("no server-returned"))

    # ---- F05 (IV5): exact native types/enums --------------------------------
    # 10. a NUMBER may not satisfy an enum/string field (the IV5 counterexample
    #     fixtures put numeric 17 into every enum field)
    def c10(d):
        f = d["fields"]
        enum_fields = ("conversationAct", "evidenceSelectionStatus", "answerOrigin",
                       "fallback", "groundingStage", "reasonCode")
        return all(f[fl]["valid"] is False for fl in enum_fields) \
            and all(f[fl]["authority_value"] is UNOBSERVED for fl in enum_fields) \
            and f["courseId"]["valid"] is False, \
            "numeric values must not satisfy enum/string fields"
    case("numeric values never satisfy enum/string fields (invalid + UNOBSERVED authority)",
         [_turn(SRV, conversationAct=17, evidenceSelectionStatus=17, answerOrigin=17,
                fallback=17, courseId=17),
          _ground(SRV, 17, "yes", 17)], SRV, c10)

    # 11. an arbitrary string may not satisfy a finite enum
    case("arbitrary string never satisfies a finite enum",
         [_turn(SRV, answerOrigin="WEIRD_ORIGIN", fallback="SOME_FALLBACK",
                evidenceSelectionStatus="MAYBE")], SRV,
         lambda d: (d["fields"]["answerOrigin"]["valid"] is False
                    and d["fields"]["fallback"]["valid"] is False
                    and d["fields"]["evidenceSelectionStatus"]["valid"] is False
                    and d["fields"]["answerOrigin"]["authority_value"] is UNOBSERVED))

    # 12. booleans never satisfy count fields
    case("boolean never satisfies a count field",
         [_turn(SRV, activeBindingCount=True, retrievedMatchCount=False)], SRV,
         lambda d: (d["fields"]["activeBindingCount"]["valid"] is False
                    and d["fields"]["retrievedMatchCount"]["valid"] is False))

    # 13. null is legal ONLY where the native contract declares it
    case("null legal only where nullable",
         [_turn(SRV, conversationAct=None, courseId=None, answerOrigin=None),
          _ground(SRV, "PRIMARY_AUDIT_PASS", False, None)], SRV,
         lambda d: (d["fields"]["conversationAct"]["valid"] is True
                    and d["fields"]["courseId"]["valid"] is True
                    and d["fields"]["answerOrigin"]["valid"] is False
                    and d["fields"]["reasonCode"]["valid"] is True))

    passed = sum(1 for c in cases if c["pass"])
    result = {
        "schema": "RAG_FIXTURE_SUITE_V5",
        "cases": cases,
        "passed": passed, "total": len(cases),
        "all_pass": passed == len(cases),
        "no_navigator_server": True,
        "no_network": True,
        "rag_diagnostic_capture_ready": passed == len(cases),
        "typed_schema_enforced": True,
    }
    if out_path:
        Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def write_contract(out_path: str | None = None) -> dict:
    if out_path:
        Path(out_path).write_text(json.dumps(RAG_DIAGNOSTIC_CAPTURE_CONTRACT,
                                             ensure_ascii=False, indent=2))
    return RAG_DIAGNOSTIC_CAPTURE_CONTRACT


def write_schema(out_path: str | None = None) -> dict:
    """F05: the typed RAG diagnostic schema artifact (generated from the
    declared typed registry; source-bound via the capture contract)."""
    doc = {
        "schema": "RAG_DIAGNOSTIC_SCHEMA_V1",
        "method": ("typed observability registry: each diagnostic field declares its "
                   "source event, source identity (native symbol), type, nullability "
                   "and allowed values where finite; generic JSON scalar acceptance "
                   "is insufficient (IV5 F05)"),
        "fields": {
            f: {
                "FIELD": f,
                "SOURCE_EVENT": spec["source_event"],
                "SOURCE_IDENTITY": spec["source_native_symbol"],
                "NULLABLE": spec["nullable"],
                "TYPE": spec["type"],
                "ALLOWED_VALUES": (list(spec["allowed_values"])
                                   if spec["allowed_values"] else None),
            }
            for f, spec in RAG_DIAGNOSTIC_SCHEMA_FIELDS.items()
        },
        "invalid_value_rule": ("a value failing its exact native type/enum contract is "
                              "retained as raw evidence but is INVALID and "
                              "UNOBSERVED for authority (authority_value)"),
        "source_bound_contract": RAG_DIAGNOSTIC_CAPTURE_CONTRACT["source_bound_contract"],
    }
    if out_path:
        Path(out_path).write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    return doc


if __name__ == "__main__":
    write_contract(str(BENCH / "artifacts" / "RAG_DIAGNOSTIC_CAPTURE_CONTRACT.json"))
    write_schema(str(BENCH / "artifacts" / "RAG_DIAGNOSTIC_SCHEMA.json"))
    result = run_rag_fixture_suite(str(BENCH / "artifacts" / "RAG_FIXTURE_SUITE_RESULTS.json"))
    print("RAG fixture suite:", f"{result['passed']}/{result['total']}",
          "all_pass:", result["all_pass"])
    for c in result["cases"]:
        if not c["pass"]:
            print("  FAIL:", c["case"], c.get("detail", ""))
