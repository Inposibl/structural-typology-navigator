"""Authoritative narrative gate v3 — CORR3 (B-8; owner sections 46-47).

ARCHITECTURAL GUARANTEE: material benchmark claims can enter the authoritative
machine report ONLY through typed claim objects ([claim_id|fact_type] markers
verified against the ledger). Freeform commentary is non-authoritative and any
material-shaped content in commentary is a contradiction. Paraphrases have no
authoritative output path unless a matching typed claim exists.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LEDGER_MARK = re.compile(r"^\[(?P<cid>[A-Za-z0-9._-]+)\|(?P<fact>[A-Z_]+)\]")

_MATERIAL_SHAPE = re.compile(
    r"(\b\d[\d,]*\s+(scenarios|cases|observations|tests|seeds)\b"
    r"|\b(all|every|each|no|zero)\s+(scenarios|cases|tests|observations|seeds)\b"
    r"|\b(passed|failed|executed|tested|validated|verified|proven|exercised|completed successfully)\b"
    r"|\bconcurrent|concurrency|overlap\b"
    r"|\bfault|injection|resilience\b"
    r"|\blive\s+telegram\b"
    r"|\bproduct defect\b)", re.I)


def check_structured_report(report_doc: dict[str, Any], ledger_doc: dict[str, Any],
                            machine: dict[str, Any], out_path: str | None = None) -> dict:
    contradictions: list[dict[str, str]] = []
    ledger_claims = {c["claim_id"]: c for c in ledger_doc.get("claims", [])}

    for s in report_doc.get("sentences", []):
        text = s.get("text", "")
        if s.get("kind") == "MATERIAL":
            cid = s.get("claim_id")
            claim = ledger_claims.get(cid)
            if claim is None:
                contradictions.append({"rule": "NARR-STRUCT-1", "detail": f"material sentence cites unknown claim {cid!r}"})
                continue
            if claim["rendered_value"] not in text:
                contradictions.append({"rule": "NARR-STRUCT-2", "detail": f"material sentence for {cid} does not carry the ledger-rendered value"})
            if s.get("fact_type") != claim.get("fact_type"):
                contradictions.append({"rule": "NARR-STRUCT-5", "detail": f"claim {cid} rendered as a different fact type (type confusion prohibited)"})
            if not claim.get("authoritative", True):
                contradictions.append({"rule": "NARR-STRUCT-6", "detail": f"claim {cid} is non-authoritative (calibration-only) but rendered as material"})
        else:
            # NON_AUTHORITATIVE_COMMENTARY: any material-shaped content is a
            # contradiction — bracket markers cannot rescue it (bypass closed)
            if _MATERIAL_SHAPE.search(text):
                contradictions.append({
                    "rule": "NARR-STRUCT-3",
                    "detail": f"non-authoritative commentary carries material-shaped content: {text[:140]}"})

    # execution-vs-candidate conflation
    total_obs = machine.get("total_observations", 0)
    for s in report_doc.get("sentences", []):
        text = s.get("text", "")
        for m in re.finditer(r"\b(\d[\d,]*)\s+(scenarios|cases|tests|observations)\b", text, re.I):
            stated = int(m.group(1).replace(",", ""))
            is_material = s.get("kind") == "MATERIAL"
            claim = ledger_claims.get(s.get("claim_id") or "")
            if is_material and claim and claim["claim_type"] == "SCENARIO_COUNT" \
                    and re.search(r"execut|test|ran", text, re.I):
                contradictions.append({
                    "rule": "NARR-STRUCT-4",
                    "detail": f"a candidate-spec count ({stated}) is phrased as executed/tested: fact-type confusion"})
            if not is_material and ("execut" in text.lower() or "test" in text.lower() or "ran" in text.lower()) \
                    and stated != total_obs:
                contradictions.append({
                    "rule": "NARR-STRUCT-4",
                    "detail": f"count {stated} phrased as executed/tested without a matching EXECUTION_FACT claim "
                              f"(machine observation total is {total_obs})"})
    doc = {
        "schema": "NARRATIVE_EVIDENCE_CONSISTENCY_V3",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "machine_totals": machine,
        "contradictions": contradictions,
        "contradictions_count": len(contradictions),
        "pass": len(contradictions) == 0,
        "required_condition": "CONTRADICTIONS = 0",
    }
    if out_path:
        Path(out_path).write_text(json.dumps(doc, ensure_ascii=False, indent=2))
    return doc
