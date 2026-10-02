"""Typed machine claim ledger v4 — CORR4 (B-15; IV4 owner sections 25-28).

- A material benchmark claim can ONLY be established from a REGISTERED
  artifact source: the source schema is validated EXACTLY (schema-specific
  string, not substring coincidence), the source identity/hash is recorded at
  creation, and the computation is the typed computation for that claim type.
  There is NO payload path for authoritative claims: a caller payload can
  establish counts, validity, coverage, safety or RAG conclusions NEVER.
  Synthetic inline payloads are permitted ONLY for CALIBRATION and are tagged
  non-authoritative; the authoritative renderer refuses them.
- Render-time revalidation (B-15): material() automatically revalidates every
  claim's source identity; a changed or MISSING source refuses rendering. No
  separate reverify_for_render() call is required (it remains available).
- SCHEMA-SPECIFIC CLAIMS: SELF_TEST_COUNT/BATTERY_COUNT require the exact
  result schema; CORPUS_SHA derives the digest by hashing the corpus artifact
  itself; CORPUS_SHA_EQUALITY compares INDEPENDENTLY derived identities; CASE
  STATUS_COUNT requires the machine execution report schema and an explicit
  status; FILE_ABSENCE_COUNT uses the registered file inventory. No generic
  default-zero interpretation for a wrong document.
- AUTHORITATIVE VS COMMENTARY: the authoritative report contains ONLY typed
  machine claims; free commentary lives in a structurally separate
  NON_AUTHORITATIVE_COMMENTARY channel, is labeled as such in every rendered
  form, and can never be interpreted as benchmark evidence.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..evidence import sanitize_obj

FACT_TYPES = ("CANDIDATE_SPEC_FACT", "EXECUTION_FACT", "STATIC_SOURCE_FACT",
              "SEMANTIC_EVALUATION_FACT", "AUDIT_FACT")

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Typed computations. Each validates the EXACT SOURCE SCHEMA and computes
# exactly one thing. Wrong-document probes fail instead of defaulting to zero.
# ---------------------------------------------------------------------------

def _require_schema(doc: dict, allowed: tuple, source: str, claim: str) -> None:
    if doc.get("schema") not in allowed:
        raise ValueError(
            f"{claim} requires source schema {allowed} exactly, got {doc.get('schema')!r} "
            f"({source}); a wrong document cannot establish this claim"
        )


def _require_keys(doc: dict, keys: tuple, source: str) -> None:
    missing = [k for k in keys if k not in doc]
    if missing:
        raise ValueError(f"source {source} fails its schema: missing {missing}")


def _compute_scenario_count(doc: dict, f: dict, source: str) -> int:
    _require_schema(doc, ("CORPUS_DISTRIBUTION_V3", "CORPUS_DISTRIBUTION_V4"), source,
                    "SCENARIO_COUNT")
    corpus_jsonl = Path(source).parent / "corrected_corpus_84.jsonl"
    if not corpus_jsonl.exists():
        raise ValueError(f"corpus jsonl sibling missing: {corpus_jsonl}")
    rows = sum(1 for line in corpus_jsonl.read_text().splitlines() if line.strip())
    if doc.get("total_scenarios") not in (None, rows):
        raise ValueError("distribution artifact disagrees with the physical corpus row count")
    return rows


def _compute_executed_case_count(doc: dict, f: dict, source: str) -> int:
    _require_schema(doc, ("CORR4_MACHINE_REPORT_V4",), source, "EXECUTED_CASE_COUNT")
    _require_keys(doc, ("records", "total_observations"), source)
    if doc["total_observations"] != len(doc["records"]):
        raise ValueError("machine report total_observations != len(records) (wrong document)")
    return sum(1 for r in doc["records"] if r.get("adapter_invocations", 0) > 0)


_ALLOWED_VERDICTS = ("PASS", "FAIL", "HOLD", "TIMEOUT", "NONDETERMINISTIC", "INFRA_FAILURE",
                     "SKIPPED_UNSAFE", "BENCHMARK_DEFECT", "NOT_EXECUTED", "NOT_OBSERVABLE")


def _compute_case_status_count(doc: dict, f: dict, source: str) -> int:
    _require_schema(doc, ("CORR4_MACHINE_REPORT_V4",), source, "CASE_STATUS_COUNT")
    _require_keys(doc, ("records", "total_observations"), source)
    field_name = f.get("field")
    value = f.get("value")
    if field_name not in ("primary_verdict", "scenario_aggregate_verdict"):
        raise ValueError("CASE_STATUS_COUNT requires an explicit status field filter")
    if value not in _ALLOWED_VERDICTS:
        raise ValueError(f"CASE_STATUS_COUNT requires an explicit status value, got {value!r}")
    if doc["total_observations"] != len(doc["records"]):
        raise ValueError("machine report total_observations != len(records)")
    return sum(1 for r in doc["records"] if r.get(field_name) == value)


def _compute_self_test_count(doc: dict, f: dict, source: str) -> dict:
    _require_schema(doc, ("CORR2_SELF_TEST_RESULTS_V2", "CORR3_SELF_TEST_RESULTS_V3",
                          "CORR4_SELF_TEST_RESULTS_V4",
                          "STATE_MACHINE_INVARIANT_RESULTS_V1"), source, "SELF_TEST_COUNT")
    _require_keys(doc, ("passed", "total", "all_pass"), source)
    if doc["passed"] > doc["total"]:
        raise ValueError("self-test passed > total (wrong document)")
    return {"passed": doc["passed"], "total": doc["total"], "all_pass": doc["all_pass"]}


def _compute_battery_count(doc: dict, f: dict, source: str) -> dict:
    _require_schema(doc, ("IV2_REGRESSION_BATTERY", "IV2_REGRESSION_BATTERY_V1", "IV3_REGRESSION_BATTERY", "IV3_REGRESSION_BATTERY_V1",
                          "IV4_REGRESSION_BATTERY", "IV5_REGRESSION_BATTERY"), source, "BATTERY_COUNT")
    _require_keys(doc, ("passed", "total", "all_pass"), source)
    if doc["passed"] > doc["total"]:
        raise ValueError("battery passed > total (wrong document)")
    return {"passed": doc["passed"], "total": doc["total"], "all_pass": doc["all_pass"]}


def _compute_canary_gate(doc: dict, f: dict, source: str) -> str:
    _require_schema(doc, ("CANARY_RESULTS_V3", "CANARY_RESULTS_V4",
                         "CORR3_CANARY_CALIBRATION_V3", "CORR4_CANARY_CALIBRATION_V4"),
                    source, "CANARY_GATE")
    _require_keys(doc, ("summary",), source)
    gate = doc["summary"].get(f.get("gate", ""))
    if gate is None:
        raise ValueError(f"canary gate {f.get('gate')!r} not present in source summary")
    return gate


def _compute_static_audit(doc: dict, f: dict, source: str) -> int:
    _require_schema(doc, ("ANTI_SELF_VALIDATION_STATIC_AUDIT_V2",
                          "ANTI_SELF_VALIDATION_STATIC_AUDIT_V3"), source, "STATIC_AUDIT")
    _require_keys(doc, ("violations", "pass"), source)
    return doc["violations"]


def _corpus_sibling(source: str) -> Path:
    corpus_jsonl = Path(source).parent / "corrected_corpus_84.jsonl"
    if not corpus_jsonl.exists():
        raise ValueError(f"corpus jsonl sibling missing: {corpus_jsonl}")
    return corpus_jsonl


def _compute_corpus_sha(doc: dict, f: dict, source: str) -> str:
    """CORPUS_SHA derives the digest by HASHING the corpus artifact itself — a
    valid SHA-256 representation derived from the artifact, never a caller
    string or the first token of arbitrary text."""
    digest = sha256_file(_corpus_sibling(source))
    if not _HEX64.fullmatch(digest):
        raise ValueError("derived corpus digest is not a valid SHA-256")
    return digest


def _compute_corpus_sha_equality(doc: dict, f: dict, source: str) -> str:
    """CORPUS_SHA_EQUALITY compares INDEPENDENTLY derived identities: the
    digest computed by hashing the corpus artifact vs the digest recorded in
    the CORPUS_SHA256.txt sidecar artifact. Two arbitrary equal caller strings
    cannot satisfy this claim."""
    derived = sha256_file(_corpus_sibling(source))
    sidecar = Path(source).parent / "CORPUS_SHA256.txt"
    if not sidecar.exists():
        raise ValueError(f"CORPUS_SHA_EQUALITY sidecar missing: {sidecar}")
    recorded = sidecar.read_text().split()[0].strip() if sidecar.read_text().split() else ""
    if not _HEX64.fullmatch(recorded):
        raise ValueError("sidecar does not carry a valid SHA-256")
    if derived != recorded:
        raise ValueError(
            f"independently derived corpus digest {derived[:12]} != recorded authority "
            f"{recorded[:12]}"
        )
    return "EQUAL"


def _compute_seed_id_set(doc: dict, f: dict, source: str) -> str:
    """SEED_ID_SET reads the SEED_SYNC_REPORT artifact: expected_ids (the
    pinned 30-ID authority embedded in the artifact schema) vs actual_ids
    computed by the seed-sync pipeline from the physical seed file."""
    _require_schema(doc, ("SEED_SYNC_REPORT_V4",), source, "SEED_ID_SET")
    expected = doc.get("expected_ids") or []
    actual = doc.get("actual_ids") or []
    if len(expected) != 30:
        raise ValueError("SEED_ID_SET authority must pin exactly 30 seed IDs")
    if actual != expected:
        raise ValueError(f"seed ID set mismatch: {len(actual)} actual vs {len(expected)} expected")
    return "PRESERVED"


def _compute_file_absence_count(doc: dict, f: dict, source: str) -> int:
    """FILE_ABSENCE_COUNT counts matches inside the REGISTERED file inventory
    artifact (schema EVIDENCE_INVENTORY_V4) — never a caller glob over the
    live filesystem, never a default zero for a wrong document."""
    _require_schema(doc, ("EVIDENCE_INVENTORY_V4",), source, "FILE_ABSENCE_COUNT")
    _require_keys(doc, ("files",), source)
    pattern = f.get("pattern", "")
    if not pattern:
        raise ValueError("FILE_ABSENCE_COUNT requires an explicit pattern filter")
    import fnmatch

    return sum(1 for rel in doc["files"] if fnmatch.fnmatch(rel, pattern))


def _compute_class_coverage(doc: dict, f: dict, source: str) -> Any:
    _require_schema(doc, ("SEMANTIC_TAXONOMY_COVERAGE_V3", "SEMANTIC_TAXONOMY_COVERAGE_V4"),
                    source, "CLASS_COVERAGE")
    _require_keys(doc, ("status_counts", "classes"), source)
    if f.get("aggregate") == "status_counts":
        return doc["status_counts"]
    return sum(1 for c in doc["classes"].values() if c.get("scenario_count", 0) > 0)


def _compute_effective_duplicate_groups(doc: dict, f: dict, source: str) -> int:
    _require_schema(doc, ("EFFECTIVE_DUPLICATE_REPORT_V3", "EFFECTIVE_DUPLICATE_REPORT_V4",
                          "EFFECTIVE_STIMULUS_REPORT_V4"), source,
                    "EFFECTIVE_DUPLICATE_GROUPS")
    _require_keys(doc, ("remaining_duplicate_groups",), source)
    return len(doc["remaining_duplicate_groups"])


def _compute_taxonomy_count(doc: dict, f: dict, source: str) -> int:
    _require_schema(doc, ("TAXONOMY_84_V1", "TAXONOMY_84_V2", "CORR1_TAXONOMY_V1"), source, "TAXONOMY_COUNT")
    _require_keys(doc, ("classes",), source)
    classes = doc["classes"]
    if len(classes) != 84:
        raise ValueError(f"taxonomy class count {len(classes)} != 84 (controlling authority)")
    return len(classes)


CLAIM_TYPES = {
    # type: (fact_type, allowed filters, computation, meaning)
    "SCENARIO_COUNT": ("CANDIDATE_SPEC_FACT", set(), _compute_scenario_count,
                       "number of actual corpus rows (candidate specs)"),
    "EXECUTED_CASE_COUNT": ("EXECUTION_FACT", set(), _compute_executed_case_count,
                            "number of observations actually executed against an adapter"),
    "CASE_STATUS_COUNT": ("EXECUTION_FACT", {"field", "value"}, _compute_case_status_count,
                          "count of executed observations with a given status"),
    "SELF_TEST_COUNT": ("AUDIT_FACT", set(), _compute_self_test_count,
                        "harness self-test results"),
    "BATTERY_COUNT": ("AUDIT_FACT", set(), _compute_battery_count,
                      "regression battery results"),
    "CANARY_GATE": ("AUDIT_FACT", {"gate"}, _compute_canary_gate,
                    "a named calibration gate result"),
    "STATIC_AUDIT": ("AUDIT_FACT", set(), _compute_static_audit,
                     "anti-self-validation static audit violation count"),
    "CORPUS_SHA": ("CANDIDATE_SPEC_FACT", set(), _compute_corpus_sha,
                   "corrected corpus SHA-256 (identity, not execution)"),
    "CORPUS_SHA_EQUALITY": ("AUDIT_FACT", set(), _compute_corpus_sha_equality,
                            "independently derived corpus digest EQUALS the recorded authority"),
    "SEED_ID_SET": ("CANDIDATE_SPEC_FACT", set(), _compute_seed_id_set,
                    "the exact 30 mandatory seed ID set is preserved (computed from artifacts)"),
    "FILE_ABSENCE_COUNT": ("AUDIT_FACT", {"pattern"}, _compute_file_absence_count,
                           "count of files matching a pattern inside the registered inventory"),
    "TAXONOMY_COUNT": ("STATIC_SOURCE_FACT", set(), _compute_taxonomy_count,
                       "84-class controlling taxonomy count (must equal 84)"),
    "CLASS_COVERAGE": ("CANDIDATE_SPEC_FACT", {"aggregate"},
                       _compute_class_coverage, "semantic taxonomy coverage status"),
    "EFFECTIVE_DUPLICATE_GROUPS": ("CANDIDATE_SPEC_FACT", set(),
                                   _compute_effective_duplicate_groups,
                                   "remaining effective duplicate groups"),
}


# claim types whose computation derives everything from the physical sibling
# artifacts (the corpus jsonl / the sha sidecar) and never parses the source
# document as JSON
_NON_JSON_SOURCES = {"CORPUS_SHA", "CORPUS_SHA_EQUALITY"}


# ---------------------------------------------------------------------------
# F10 (IV5): COMPLETE claim dependency closure.
#
# Every material claim DECLARES every artifact/input that materially
# influences its computation (no implicit sibling dependency): the corpus
# JSONL behind SCENARIO_COUNT/CORPUS_SHA/CORPUS_SHA_EQUALITY, the sidecar
# behind the equality claim, the seed artifact/matrix/corpus behind SEED sync
# claims. At RENDER time the whole closure is revalidated — a changed,
# missing or schema-broken dependency refuses rendering. Revalidating only
# the registered primary source is structurally insufficient (IV5 F10
# counterexample: the sibling corpus changed after claim creation and the
# cached old digest + EQUAL still rendered).
# ---------------------------------------------------------------------------

def _corpus_jsonl_dep(source: str) -> dict:
    src = Path(source)
    candidates = [src.parent / "corrected_corpus_84.jsonl",
                  src.parent.parent / "corpus" / "corrected_corpus_84.jsonl"]
    for p in candidates:
        if p.exists():
            return {"role": "corpus_jsonl", "path": str(p), "schema_identity": "JSONL_ROWS"}
    raise ValueError(f"corpus jsonl dependency missing: {candidates[0]}")


def _sidecar_dep(source: str) -> dict:
    p = Path(source).parent / "CORPUS_SHA256.txt"
    if not p.exists():
        raise ValueError(f"corpus sha sidecar dependency missing: {p}")
    return {"role": "corpus_sha_sidecar", "path": str(p), "schema_identity": "SHA256_TEXT"}


def _seed_artifact_dep(source: str) -> dict:
    p = Path(source).parent / "seeds_30_corrected.jsonl"
    if not p.exists():
        raise ValueError(f"seed artifact dependency missing: {p}")
    return {"role": "seed_artifact", "path": str(p), "schema_identity": "JSONL_ROWS"}


def _seed_matrix_dep(source: str) -> dict:
    p = Path(source).parent.parent / "corpus" / "SEED_NATIVE_CONTRACT_MATRIX.json"
    if not p.exists():
        raise ValueError(f"seed contract matrix dependency missing: {p}")
    return {"role": "seed_contract_matrix", "path": str(p), "schema_identity": "SEED_NATIVE_CONTRACT_MATRIX"}


# additional dependencies per claim type, resolved relative to the registered
# source artifact (the source itself is ALWAYS a dependency)
_CLAIM_DEPENDENCY_RESOLVERS: dict[str, list] = {
    "SCENARIO_COUNT": [_corpus_jsonl_dep],
    "CORPUS_SHA": [_corpus_jsonl_dep],
    "CORPUS_SHA_EQUALITY": [_corpus_jsonl_dep, _sidecar_dep],
    "SEED_ID_SET": [_seed_artifact_dep, _seed_matrix_dep, _corpus_jsonl_dep],
}


def _dependency_schema_of(path: str, declared: str | None) -> str | None:
    """Schema identity of a dependency as CURRENTLY readable (None when the
    artifact carries no schema field). A schema drift invalidates the closure."""
    p = Path(path)
    if not p.is_file():
        return None
    if declared in ("JSONL_ROWS", "SHA256_TEXT"):
        return declared  # non-JSON artifacts keep their declared identity
    try:
        doc = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if isinstance(doc, dict) and isinstance(doc.get("schema"), str):
        return doc["schema"]
    return declared


class ClaimEngine:
    def __init__(self) -> None:
        self.claims: list[dict[str, Any]] = []
        self._source_hashes: dict[str, str] = {}

    def _source_digest(self, path: str) -> str:
        p = Path(path)
        if p.is_dir():
            h = hashlib.sha256()
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    h.update(str(f.relative_to(p)).encode())
                    h.update(sha256_file(f).encode())
            return h.hexdigest()
        return sha256_file(p)

    def register(self, claim_id: str, claim_type: str, source_artifact: str,
                 filter_spec: dict | None = None, render: str = "{value}",
                 calibration_payload: dict | None = None) -> dict:
        """Register a typed claim. AUTHORITATIVE claims REQUIRE a real,
        existing, schema-valid source artifact; there is no payload path for
        them. `calibration_payload` creates a NON-AUTHORITATIVE calibration
        claim which the authoritative renderer refuses to render (B-15)."""
        if claim_type not in CLAIM_TYPES:
            raise ValueError(f"unregistered claim type {claim_type!r}")
        if "{value}" not in render:
            raise ValueError("render template must embed {value} (structural derivation)")
        fact_type, allowed_filters, computation, meaning = CLAIM_TYPES[claim_type]
        f = dict(filter_spec or {})
        disallowed = set(f) - allowed_filters
        if disallowed:
            raise ValueError(f"claim type {claim_type!r} does not allow filters {sorted(disallowed)}")
        p = Path(source_artifact) if source_artifact else None
        if calibration_payload is not None:
            doc = dict(calibration_payload)
            digest = "calibration:" + hashlib.sha256(
                json.dumps(doc, sort_keys=True).encode()).hexdigest()[:16]
            authoritative = False
            fact_type = "CALIBRATION_ONLY_FACT"
        else:
            if p is None or not p.exists():
                raise FileNotFoundError(
                    f"authoritative claim source artifact missing: {source_artifact} "
                    "(caller payloads cannot establish material claims)")
            digest = self._source_digest(source_artifact)
            if p.is_file():
                if claim_type in _NON_JSON_SOURCES:
                    doc = {}
                else:
                    try:
                        doc = json.loads(p.read_text())
                    except json.JSONDecodeError as exc:
                        raise ValueError(
                            f"claim source is not valid JSON: {source_artifact}: {exc}") from exc
            else:
                doc = {"schema": "DIRECTORY_SOURCE"}
            doc["_source"] = source_artifact
            doc["_digest"] = digest
            authoritative = True
        value = computation(doc, f, source_artifact)
        if p and p.exists():
            self._source_hashes[source_artifact] = digest
        # F10: declare the COMPLETE dependency closure of this computation
        dependencies = []
        if authoritative and p is not None and p.exists() and p.is_file():
            dependencies.append({
                "role": "source_artifact", "path": str(p),
                "content_sha256": digest,
                "schema_identity": (doc.get("schema") if isinstance(doc.get("schema"), str)
                                    else None),
            })
            for resolver in _CLAIM_DEPENDENCY_RESOLVERS.get(claim_type, []):
                dep = resolver(source_artifact)
                dep_path = Path(dep["path"])
                if not dep_path.exists():
                    raise ValueError(
                        f"claim {claim_id} dependency missing at creation: {dep['path']}")
                dependencies.append({
                    "role": dep["role"], "path": str(dep_path),
                    "content_sha256": sha256_file(dep_path),
                    "schema_identity": _dependency_schema_of(str(dep_path),
                                                             dep.get("schema_identity")),
                })
        claim = {
            "claim_id": claim_id, "claim_type": claim_type, "fact_type": fact_type,
            "authoritative": authoritative,
            "semantic_meaning": meaning if authoritative else
            "CALIBRATION-ONLY synthetic payload; never benchmark evidence",
            "source_artifact": source_artifact, "source_artifact_sha256": digest,
            "dependencies": dependencies,
            "filter": filter_spec or {},
            "computed_value": value,
            "render_template": render,
            "rendered_value": render.format(value=value),
            "match": True,
        }
        self.claims.append(claim)
        return claim

    # backwards-compatible name for the old compute() entry point
    def compute(self, claim_type: str, source_artifact: str,
                filter_spec: dict | None = None, payload: dict | None = None) -> Any:
        if payload is not None:
            raise ValueError(
                "compute(payload=...) is removed for material claims: synthetic inline "
                "payloads are CALIBRATION-ONLY (pass calibration_payload to register)")
        if claim_type not in CLAIM_TYPES:
            raise ValueError(f"unregistered claim type {claim_type!r}")
        _, _, computation, _ = CLAIM_TYPES[claim_type]
        p = Path(source_artifact)
        if not p.exists():
            raise FileNotFoundError(f"claim source artifact missing: {source_artifact}")
        doc = json.loads(p.read_text())
        doc["_source"] = source_artifact
        return computation(doc, dict(filter_spec or {}), source_artifact)

    def reverify_for_render(self) -> None:
        """RENDER-TIME re-verification of the WHOLE dependency closure
        (owner section 44; B-15 + IV5 F10). Every declared dependency —
        the registered source AND every sibling artifact that materially
        influences the computation — is revalidated: a missing, changed or
        schema-broken dependency refuses rendering. Revalidating only the
        primary registered source is structurally insufficient."""
        for c in self.claims:
            if not c.get("authoritative"):
                continue
            src = c.get("source_artifact")
            if not src:
                raise ValueError(f"authoritative claim {c['claim_id']} has no source artifact")
            p = Path(src)
            if not p.exists():
                raise ValueError(
                    f"claim {c['claim_id']} source missing: {src}; rendering refused")
            current = self._source_digest(src)
            if current != c.get("source_artifact_sha256"):
                raise ValueError(
                    f"claim {c['claim_id']} source changed after creation: rendering invalidated")
            for dep in c.get("dependencies") or []:
                dep_path = Path(dep["path"])
                if not dep_path.exists():
                    raise ValueError(
                        f"claim {c['claim_id']} dependency ({dep['role']}) missing: "
                        f"{dep['path']}; rendering refused")
                dep_digest = (sha256_file(dep_path) if dep_path.is_file()
                              else self._source_digest(str(dep_path)))
                if dep_digest != dep.get("content_sha256"):
                    raise ValueError(
                        f"claim {c['claim_id']} dependency ({dep['role']}) changed after "
                        f"creation: {dep['path']}; rendering invalidated")
                current_schema = _dependency_schema_of(str(dep_path),
                                                       dep.get("schema_identity"))
                declared_schema = dep.get("schema_identity")
                if (isinstance(declared_schema, str)
                        and declared_schema not in ("JSONL_ROWS", "SHA256_TEXT")
                        and current_schema != declared_schema):
                    raise ValueError(
                        f"claim {c['claim_id']} dependency ({dep['role']}) no longer "
                        f"satisfies its schema: expected {declared_schema!r}, now "
                        f"{current_schema!r}; rendering refused")

    def by_id(self, claim_id: str) -> dict | None:
        return next((c for c in self.claims if c["claim_id"] == claim_id), None)

    def dependency_closure_report(self) -> dict:
        """F10: the declared dependency closure of every material claim."""
        return {
            "schema": "CLAIM_DEPENDENCY_CLOSURE_REPORT_V1",
            "method": (
                "every material claim declares EVERY artifact/input that materially "
                "influences its computation (source + resolved siblings); rendering "
                "revalidates the whole closure — changed, missing or schema-broken "
                "dependencies refuse rendering"
            ),
            "claims": [
                {
                    "claim_id": c["claim_id"],
                    "claim_type": c["claim_type"],
                    "dependencies": c.get("dependencies") or [],
                }
                for c in self.claims if c.get("authoritative")
            ],
            "total_declared_dependencies": sum(
                len(c.get("dependencies") or [])
                for c in self.claims if c.get("authoritative")),
        }

    def to_json(self, path: str | None = None) -> dict:
        doc = {
            "schema": "REPORT_CLAIM_LEDGER_V4",
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source_hashes": dict(self._source_hashes),
            "claims": self.claims,
            "claims_total": len(self.claims),
            "authoritative_claims_total": sum(1 for c in self.claims if c.get("authoritative")),
            "all_match": bool(self.claims),
        }
        if path:
            Path(path).write_text(json.dumps(doc, ensure_ascii=False, indent=2))
        return doc


class ReportRenderer:
    """Material report sentences ONLY from typed AUTHORITATIVE claim objects,
    tagged with the claim's FACT TYPE (owner section 46). Free commentary
    exists ONLY in the structurally separate NON_AUTHORITATIVE_COMMENTARY
    channel and is labeled as such in every rendered form (B-15).

    material() automatically revalidates the ledger's source identities — a
    changed or missing source refuses rendering without any caller-side
    remember-to-reverify step."""

    def __init__(self, ledger: ClaimEngine) -> None:
        self.ledger = ledger
        self.sentences: list[dict[str, Any]] = []

    def material(self, claim_id: str) -> str:
        claim = self.ledger.by_id(claim_id)
        if claim is None:
            raise ValueError(f"unknown claim {claim_id!r}")
        if not claim.get("authoritative"):
            raise ValueError(
                f"claim {claim_id!r} is CALIBRATION-ONLY: non-authoritative synthetic "
                "payloads cannot render as material benchmark claims")
        self.ledger.reverify_for_render()  # B-15: automatic render-time revalidation
        sentence = (f"[{claim_id}|{claim['fact_type']}] {claim['rendered_value']}")
        sentence = str(sanitize_obj(sentence))  # B-17
        self.sentences.append({"kind": "MATERIAL", "claim_id": claim_id,
                               "fact_type": claim["fact_type"], "text": sentence})
        return sentence

    def commentary(self, text: str) -> str:
        text = str(sanitize_obj(str(text)))
        self.sentences.append({"kind": "NON_AUTHORITATIVE_COMMENTARY", "claim_id": None,
                               "fact_type": None, "text": text})
        return text

    def render_markdown(self) -> str:
        """Structural separation (B-15): the authoritative section contains
        ONLY typed claims; all commentary is rendered in an explicitly labeled
        separate NON_AUTHORITATIVE_COMMENTARY section and is never presented
        as evidence."""
        self.ledger.reverify_for_render()
        material = [s["text"] for s in self.sentences if s["kind"] == "MATERIAL"]
        commentary = [s["text"] for s in self.sentences
                      if s["kind"] == "NON_AUTHORITATIVE_COMMENTARY"]
        parts = ["## AUTHORITATIVE MACHINE CLAIMS (typed ledger only)"]
        parts.extend(material)
        parts.append("")
        parts.append("## NON_AUTHORITATIVE_COMMENTARY (never benchmark evidence)")
        parts.extend(f"COMMENTARY: {c}" for c in commentary)
        return "\n".join(parts) + "\n"
