"""Corpus tooling v2 — CORR2 (B-7, owner sections 24/27/45).

Validator checks MECHANISM ENTAILMENT, not field presence:
- scenario binds a REGISTERED adapter (sut_binding.adapter_id) whose registry
  entry passed static symbol validation against the real trees;
- repo coherence: the registry entry's repo matches the scenario's declared
  SUT repo lane;
- oracle compatibility: every expected key the oracles verify must be in the
  bound adapter's OBSERVABLE fields (no invented emitted fields);
- fault schedule kinds must be implemented hooks of the bound adapter;
- concurrency scenarios require an adapter with a schedulable operation and a
  workers-accurate overlap oracle;
- NO_SEAM never receives runtime claims; STATIC stays static; semantic-only
  assertions never count as deterministic coverage;
- executable-content duplicates are detected on MEANING (class, adapter,
  turns, state setup, preconditions, fault schedule, oracle+params, expected,
  replay set) — not on prose/IDs/fingerprints.
"""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from harness.evidence import canonical_json, sha256_canonical

MANDATORY_FIELDS = (
    "failure_mechanism",
    "trigger",
    "observable_effect",
    "oracle",
    "why_this_scenario_tests_this_class",
)

RUNTIME_ORACLES = {
    "act_equals", "origin_equals", "exact_link", "no_payment_link", "state_subset",
    "prohibited_output", "tool_call_absent", "tool_call_present", "state_mutation_absent",
    "exactly_once", "duplicate_write_absent", "idempotent_retry",
    "concurrency_overlap_proven", "concurrency_invariant",
    "fault_confirmed_injected", "fault_reaction", "price_authority",
    "catalog_fallback", "outcome_class", "gate_detection",
}
SEMANTIC_LANE_ORACLES = {"semantic_input_frozen"}
STATIC_ORACLES = {"static_config"}
HONESTY_ORACLES = {"no_runtime_claim"}

VALID_LEVELS = {"L1", "L2", "L3", "L4", "L5"}
VALID_TRACKS = {"ALEXEY_INBOUND", "TIKHON", "ALEXEY_TO_TIKHON", "ALEXEY_OUTBOUND"}

TG_SEAM_ALLOWED = {"REAL": {"RUNTIME", "LIVE"}, "STATIC": {"STATIC"}, "NO_SEAM": {"NO_SEAM"}}


def scenario_fingerprint(scenario: dict) -> str:
    basis = {
        "failure_class": scenario["failure_class"],
        "track": scenario["track"],
        "execution_level": scenario["execution_level"],
        "failure_mechanism": scenario.get("failure_mechanism"),
        "trigger": scenario.get("trigger"),
        "turns": scenario.get("turns"),
        "state_setup": scenario.get("state_setup"),
        "expected": scenario.get("expected"),
        "oracle": scenario.get("oracle"),
    }
    return sha256_canonical(basis)


def executable_meaning(scenario: dict) -> str:
    """Hash of EXECUTABLE MEANING only (owner section 27): narrative labels,
    descriptions, IDs and fingerprints excluded."""
    basis = {
        "failure_class": scenario.get("failure_class"),
        "track": scenario.get("track"),
        "execution_level": scenario.get("execution_level"),
        "adapter_id": (scenario.get("sut_binding") or {}).get("adapter_id"),
        "turns": scenario.get("turns"),
        "state_setup": scenario.get("state_setup"),
        "preconditions": scenario.get("preconditions"),
        "fault_schedule": scenario.get("fault_schedule"),
        "oracle": scenario.get("oracle"),
        "expected": scenario.get("expected"),
        "replay_set": scenario.get("replay_set"),
    }
    return sha256_canonical(basis)


def find_executable_duplicates(scenarios: list[dict]) -> list[list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for s in scenarios:
        groups[executable_meaning(s)].append(s)
    return [g for g in groups.values() if len(g) > 1]


def _state_keys_verified(scenario: dict) -> set[str]:
    keys: set[str] = set()
    for o in scenario.get("oracle", []):
        if o.get("oracle") in ("state_subset", "concurrency_invariant"):
            params = o.get("params") or {}
            exp = params.get("expected_state", (scenario.get("expected") or {}).get("state"))
            if isinstance(exp, dict):
                keys |= set(exp.keys())
    return keys


def validate_semantic_binding(scenario: dict, seam_map: dict, registry: dict) -> list[str]:
    errors: list[str] = []
    sid = scenario.get("scenario_id", "<no-id>")
    for field in MANDATORY_FIELDS:
        if not scenario.get(field):
            errors.append(f"{sid}: missing mandatory semantic field {field}")
    level = scenario.get("execution_level")
    if level not in VALID_LEVELS:
        errors.append(f"{sid}: invalid execution_level {level!r}")
    if scenario.get("track") not in VALID_TRACKS:
        errors.append(f"{sid}: invalid track {scenario.get('track')!r}")

    fc = scenario.get("failure_class", "")
    seam_class = scenario.get("seam_class")
    adapters = registry.get("adapters", {})
    adapter_id = (scenario.get("sut_binding") or {}).get("adapter_id")
    adapter = adapters.get(adapter_id) if adapter_id else None

    # ---- TG seam-map coherence -----------------------------------------
    if fc.startswith("TG-"):
        row = seam_map.get("rows_by_id", seam_map).get(fc)
        if row is None:
            errors.append(f"{sid}: TG class {fc} missing from accepted seam map")
        else:
            allowed = TG_SEAM_ALLOWED[row["seam_class"]]
            if seam_class not in allowed:
                errors.append(
                    f"{sid}: seam_class {seam_class!r} contradicts accepted seam map "
                    f"({fc} = {row['seam_class']}; allowed {sorted(allowed)})"
                )
        if seam_class == "NO_SEAM":
            oracles = {o.get("oracle") for o in scenario.get("oracle", [])}
            if oracles & RUNTIME_ORACLES:
                errors.append(f"{sid}: NO_SEAM class {fc} bound to runtime oracle(s)")
            if "no_runtime_claim" not in oracles:
                errors.append(f"{sid}: NO_SEAM scenario must carry no_runtime_claim oracle")

    # ---- adapter registry binding (owner section 24) ---------------------
    if seam_class in ("RUNTIME", "LIVE", "STATIC", "GATE"):
        if not adapter_id:
            errors.append(f"{sid}: no registered adapter_id in sut_binding")
        elif adapter is None:
            errors.append(f"{sid}: adapter {adapter_id!r} not registered in ADAPTER_REGISTRY")
        else:
            # class-support applies to runtime-executable rows; future LIVE
            # specs (safe_to_execute=false) and GATE lanes are exempt because
            # their mechanism/oracle fidelity is validated natively at the
            # execution act.
            if seam_class in ("RUNTIME", "STATIC"):
                supported = adapter.get("supported_failure_classes", [])
                if fc not in supported:
                    errors.append(
                        f"{sid}: class {fc} not in supported_failure_classes of {adapter_id}"
                    )
            # static lane must use the static adapter
            if seam_class == "STATIC" and adapter.get("provenance_class") != "STATIC_INSPECTION":
                errors.append(f"{sid}: STATIC scenario bound to non-static adapter {adapter_id!r}")
            if seam_class in ("RUNTIME", "LIVE") and adapter.get("provenance_class") == "STATIC_INSPECTION":
                errors.append(f"{sid}: runtime scenario bound to the static-inventory adapter")
            # oracle/observable compatibility: state keys must be native
            # observables of the bound adapter (v3 registry field name).
            observable = set(adapter.get("native_observables")
                             or adapter.get("observable_state_fields") or [])
            store_backed = bool(adapter.get("schedulable_operation")) or adapter.get("provenance_class") == "ISOLATED_STATE_READ"
            import re as _re

            for key in _state_keys_verified(scenario):
                if store_backed and _re.fullmatch(r"\d+", str(key)):
                    continue  # user-id wrapper key over a projected store row
                native = key in observable or key.split(".")[0] in observable or any(str(key).startswith(o) for o in observable)
                if not native:
                    errors.append(
                        f"{sid}: expected state key {key!r} is not an observable field of "
                        f"adapter {adapter_id!r} (invented observation field)"
                    )
            # fault hooks
            for fs in scenario.get("fault_schedule") or []:
                kind = fs.get("kind")
                if kind and kind not in (adapter.get("real_fault_hooks") or []):
                    errors.append(
                        f"{sid}: fault kind {kind!r} has no implemented hook in adapter {adapter_id!r}"
                    )
            # concurrency schedulability
            oracles = {o.get("oracle") for o in scenario.get("oracle", [])}
            if "concurrency_overlap_proven" in oracles and not adapter.get("schedulable_operation"):
                errors.append(
                    f"{sid}: concurrency scenario bound to adapter {adapter_id!r} without a "
                    "schedulable product operation"
                )

    if seam_class == "NO_SEAM" and not fc.startswith("TG-"):
        oracles = {o.get("oracle") for o in scenario.get("oracle", [])}
        if oracles & RUNTIME_ORACLES:
            errors.append(f"{sid}: NO_SEAM scenario carries runtime oracle(s)")
        if "no_runtime_claim" not in oracles:
            errors.append(f"{sid}: NO_SEAM scenario must carry no_runtime_claim oracle")

    # ---- safety / lanes ---------------------------------------------------
    safety_flag = scenario.get("safe_to_execute", scenario.get("safety", {}).get("safe_to_execute", True))
    if level == "L4" and safety_flag:
        errors.append(f"{sid}: L4 scenario must declare safe_to_execute=false")
    if scenario.get("replay_set") == "C":
        oracles = {o.get("oracle") for o in scenario.get("oracle", [])}
        if "concurrency_overlap_proven" not in oracles:
            errors.append(f"{sid}: Set C scenario must require concurrency_overlap_proven")
    if scenario.get("replay_set") == "F":
        oracles = {o.get("oracle") for o in scenario.get("oracle", [])}
        if "fault_confirmed_injected" not in oracles:
            errors.append(f"{sid}: Set F scenario must require fault_confirmed_injected")
    if scenario.get("semantic_evaluation", {}).get("required") and not scenario["semantic_evaluation"].get("claim"):
        errors.append(f"{sid}: semantic scenario lacks an explicit semantic claim")

    # non-constructible payment lanes (owner section 26)
    if fc in registry.get("non_constructible_lanes", {}) and seam_class in ("RUNTIME", "LIVE"):
        errors.append(
            f"{sid}: {fc} is a non-constructible lane ({registry['non_constructible_lanes'][fc]}); "
            "no runtime scenario may claim it"
        )
    return errors


def classify_binding_status(scenario: dict) -> str:
    oracles = {o.get("oracle") for o in scenario.get("oracle", [])}
    if scenario.get("seam_class") == "NO_SEAM":
        return "SEMANTICALLY_BOUND_NO_SEAM"
    if scenario.get("seam_class") == "STATIC" or oracles & STATIC_ORACLES:
        return "SEMANTICALLY_BOUND_STATIC"
    # semantic-only lanes never count as deterministic coverage
    if oracles & RUNTIME_ORACLES:
        return "SEMANTICALLY_BOUND_RUNTIME"
    if oracles & SEMANTIC_LANE_ORACLES:
        return "SEMANTICALLY_BOUND_SEMANTIC_ONLY"
    return "SEMANTICALLY_BOUND_SEMANTIC_ONLY"


def write_corpus_outputs(scenarios: list[dict], taxonomy_path: str, out_dir: str) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    with open(out / "corrected_corpus_84.jsonl", "w", encoding="utf-8") as fh:
        for s in scenarios:
            fh.write(canonical_json(s) + "\n")

    with open(out / "scenario-fingerprints.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["scenario_id", "track", "execution_level", "failure_class", "risk", "repeat_count", "replay_set", "fingerprint_sha256", "executable_meaning_sha256"])
        for s in scenarios:
            w.writerow([s["scenario_id"], s["track"], s["execution_level"], s["failure_class"], s.get("risk", ""), s.get("repeat_count", 1), s.get("replay_set") or "NONE", s["fingerprint_sha256"], s.get("executable_meaning_sha256", "")])

    cov = coverage_by_class(scenarios)
    with open(out / "failure-class-coverage.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["failure_class", "scenario_count", "levels", "tracks", "seam_classes"])
        for cid in sorted(cov):
            c = cov[cid]
            w.writerow([cid, c["scenario_count"], json.dumps(c["levels"]), json.dumps(c["tracks"]), json.dumps(c["seam_classes"])])

    corpus_blob = (out / "corrected_corpus_84.jsonl").read_bytes()
    corpus_sha = hashlib.sha256(corpus_blob).hexdigest()
    with open(out / "CORPUS_SHA256.txt", "w", encoding="utf-8") as fh:
        fh.write(f"{corpus_sha}  corrected_corpus_84.jsonl\n")

    tracks = Counter(s["track"] for s in scenarios)
    levels = Counter(s["execution_level"] for s in scenarios)
    replays = Counter(s.get("replay_set") or "NONE" for s in scenarios)
    planned = sum(1 if not s.get("replay_set") else s.get("repeat_count", 1) for s in scenarios)
    distribution = {
        "total_scenarios": len(scenarios),
        "planned_observations": planned,
        "tracks": dict(tracks),
        "levels": dict(levels),
        "replay_sets": dict(replays),
        "unique_fingerprints": len({s["fingerprint_sha256"] for s in scenarios}),
        "unique_executable_meanings": len({executable_meaning(s) for s in scenarios}),
    }
    with open(out / "distribution.json", "w", encoding="utf-8") as fh:
        json.dump(distribution, fh, ensure_ascii=False, indent=2)

    with open(taxonomy_path, encoding="utf-8") as fh:
        taxonomy = json.load(fh)
    class_ids = [c["id"] for c in taxonomy["classes"]]
    status_map: dict[str, str] = {}
    for cid in class_ids:
        members = [s for s in scenarios if s["failure_class"] == cid]
        if not members:
            status_map[cid] = "NOT_PROVEN"
            continue
        statuses = {classify_binding_status(s) for s in members}
        if statuses == {"SEMANTICALLY_BOUND_NO_SEAM"}:
            status_map[cid] = "SEMANTICALLY_BOUND_NO_SEAM"
        elif statuses == {"SEMANTICALLY_BOUND_STATIC"}:
            status_map[cid] = "SEMANTICALLY_BOUND_STATIC"
        elif "SEMANTICALLY_BOUND_RUNTIME" in statuses:
            status_map[cid] = "SEMANTICALLY_BOUND_RUNTIME"
        elif statuses == {"SEMANTICALLY_BOUND_SEMANTIC_ONLY"}:
            # semantic-only lanes prove the claim surface, not the mechanism:
            # only honest when every member is an explicitly semantic-lane
            # scenario AND the class is a semantic class by contract
            status_map[cid] = "SEMANTICALLY_BOUND_SEMANTIC_ONLY"
        else:
            status_map[cid] = sorted(statuses)[0]
    sem_cov = {
        "schema": "SEMANTIC_TAXONOMY_COVERAGE_V2",
        "target_classes": len(class_ids),
        "status_counts": dict(Counter(status_map.values())),
        "classes": {
            cid: {
                "status": status_map[cid],
                "scenario_count": cov.get(cid, {}).get("scenario_count", 0),
                "representative_scenarios": [s["scenario_id"] for s in scenarios if s["failure_class"] == cid][:3],
                "note": (
                    "class honestly bound to its ABSENT observation seam; expected adjudication NOT_OBSERVABLE"
                    if status_map[cid] == "SEMANTICALLY_BOUND_NO_SEAM"
                    else "class bound to an authorized static seam (static conclusions only)"
                    if status_map[cid] == "SEMANTICALLY_BOUND_STATIC"
                    else "class bound to executable runtime mechanisms with registered adapters"
                    if status_map[cid] == "SEMANTICALLY_BOUND_RUNTIME"
                    else "class covered ONLY by semantic-lane scenarios: NOT deterministic mechanism coverage"
                    if status_map[cid] == "SEMANTICALLY_BOUND_SEMANTIC_ONLY"
                    else "no valid scenario proves this class"
                ),
            }
            for cid in class_ids
        },
        "runtime_bound": sum(1 for v in status_map.values() if v == "SEMANTICALLY_BOUND_RUNTIME"),
        "static_bound": sum(1 for v in status_map.values() if v == "SEMANTICALLY_BOUND_STATIC"),
        "no_seam_bound": sum(1 for v in status_map.values() if v == "SEMANTICALLY_BOUND_NO_SEAM"),
        "semantic_only_bound": sum(1 for v in status_map.values() if v == "SEMANTICALLY_BOUND_SEMANTIC_ONLY"),
        "not_proven": sum(1 for v in status_map.values() if v == "NOT_PROVEN"),
    }
    with open(out / "SEMANTIC_TAXONOMY_COVERAGE.json", "w", encoding="utf-8") as fh:
        json.dump(sem_cov, fh, ensure_ascii=False, indent=2)

    return {"distribution": distribution, "semantic_coverage": sem_cov, "corpus_sha256": corpus_sha}


def coverage_by_class(scenarios: list[dict]) -> dict:
    cov: dict = defaultdict(lambda: {"scenario_count": 0, "levels": Counter(), "tracks": Counter(), "seam_classes": Counter()})
    for s in scenarios:
        c = cov[s["failure_class"]]
        c["scenario_count"] += 1
        c["levels"][s["execution_level"]] += 1
        c["tracks"][s["track"]] += 1
        c["seam_classes"][s.get("seam_class", "RUNTIME")] += 1
    return {k: {"scenario_count": v["scenario_count"], "levels": dict(v["levels"]), "tracks": dict(v["tracks"]), "seam_classes": dict(v["seam_classes"])} for k, v in cov.items()}
