"""Frozen retrieval fixtures for the R2-CORR2 loopback double.

Fixture identity is scenario_id / benchmark_attempt_number /
chat_request_ordinal / course_id. Every routable course id on every matrix
row has one non-empty deterministic fixture, including attempts covered by
same_classification_for_every_attempt. The bytes on disk are the authority.
The builder below only regenerates that document; the server loads the file.
"""

from __future__ import annotations

import hashlib
import json
import struct
from typing import Any

from .constants import (
    COVERAGE_PATH,
    FIXTURE_MANIFEST_PATH,
    FIXTURE_PATH,
    ROUTABLE_COURSE_IDS,
)
from .pd_f04_provider_evidence import canonical_json, sha256_bytes

FIXTURE_SCHEMA = "FROZEN_RETRIEVAL_FIXTURES_V1"
MANIFEST_SCHEMA = "FROZEN_RETRIEVAL_FIXTURES_MANIFEST_V2"
AUTHORITY_METADATA_FIELDS = (
    "course_id",
    "source_id",
    "document_id",
    "chunk_id",
    "content_sha256",
    "authority_relation",
    "source_slug",
    "source_title",
    "ready_state",
    "is_active",
    "document_status",
)


def load_coverage(path=COVERAGE_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def fixture_key(scenario_id: str, attempt: int, ordinal: int | None, course_id: str) -> str:
    ordinal_text = "null" if ordinal is None else str(ordinal)
    return f"{scenario_id}/{attempt}/{ordinal_text}/{course_id}"


def _content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_query_vector(key: str) -> list[float]:
    """Immutable 1024-d vector bound to one fixture key.

    Every component is a multiple of 1/128, so Python and Node hash the same
    bytes after JSON transport.
    """
    buf = hashlib.sha256(key.encode("utf-8")).digest()
    values: list[float] = []
    counter = 0
    while len(values) < 1024:
        buf = hashlib.sha256(buf + counter.to_bytes(2, "big")).digest()
        counter += 1
        for byte in buf:
            values.append(byte / 128 - 1)
            if len(values) == 1024:
                break
    return values


def vector_sha256(vector: list[float]) -> str:
    """Digest the exact IEEE-754 little-endian float64 bytes of the vector.

    A rounded byte is not an identity. Two finite vectors that differ in any
    component produce different digests. Runtime equality of the vector values
    remains the retrieval check.
    """
    if isinstance(vector, bool) or not isinstance(vector, list):
        raise TypeError("vector must be a list of numbers")
    raw = struct.pack("<" + str(len(vector)) + "d", *[float(item) for item in vector])
    return hashlib.sha256(raw).hexdigest()


def vector_is_valid(vector: Any) -> bool:
    if not isinstance(vector, list) or len(vector) != 1024:
        return False
    for value in vector:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        if value != value or value in (float("inf"), float("-inf")):
            return False
    return True


def validate_p_query_embedding(value: Any, expected: list[float] | None) -> str | None:
    """Return a retrieval-infra reason, or None when the vector matches."""
    if value is None:
        return "p_query_embedding_missing"
    if isinstance(value, bool) or not isinstance(value, list):
        return "p_query_embedding_not_array"
    if len(value) != 1024:
        return "p_query_embedding_dimension"
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            return "p_query_embedding_malformed"
        if item != item or item in (float("inf"), float("-inf")):
            return "p_query_embedding_non_finite"
    if expected is not None and list(value) != list(expected):
        return "p_query_embedding_wrong_vector"
    return None


def build_one_fixture(key: str, course_id: str) -> dict[str, Any]:
    content = (
        f"FROZEN-RETRIEVAL-FIXTURE {key}. "
        "Synthetic benchmark chunk. Not a live corpus excerpt."
    )
    digest = _content_sha256(content)
    fixture_id = digest[:16]
    source_id = f"fixture-source-{course_id}"
    document_id = f"fixture-doc-{course_id}"
    query_vector = build_query_vector(key)
    return {
        "fixture_id": fixture_id,
        "fixture_key": key,
        "course_id": course_id,
        "ready_state": "ready",
        "is_active": True,
        "query_vector_dimension": 1024,
        "query_vector_sha256": vector_sha256(query_vector),
        "query_vector": query_vector,
        "bindings": [
            {
                "course_id": course_id,
                "source_id": source_id,
                "authority_relation": "FOUNDATIONAL",
                "is_active": True,
                "metadata": {
                    "fixture": True,
                    "fixture_id": fixture_id,
                    "ready_state": "ready",
                },
                "knowledge_sources": {
                    "slug": f"fixture-{course_id}",
                    "title": "Frozen benchmark fixture",
                },
            }
        ],
        "documents": [
            {
                "document_id": document_id,
                "source_id": source_id,
                "course_id": course_id,
                "status": "ready",
                "is_active": True,
            }
        ],
        "matches": [
            {
                "chunk_id": 1,
                "document_id": document_id,
                "source_id": source_id,
                "course_id": course_id,
                "source_slug": f"fixture-{course_id}",
                "source_title": "Frozen benchmark fixture",
                "source_kind": "BENCHMARK_FIXTURE",
                "authority_relation": "FOUNDATIONAL",
                "is_active": True,
                "document_status": "ready",
                "course_source_metadata": {"is_active": True},
                "source_metadata": {"slug": f"fixture-{course_id}"},
                "document_metadata": {"status": "ready"},
                "content": content,
                "content_sha256": digest,
                "heading_path": ["fixture"],
                "locator": {},
                "chunk_metadata": {"chunk_id": 1},
                "similarity": 1.0,
            }
        ],
    }


def iter_fixture_slots(coverage: dict[str, Any]):
    for row in coverage["rows"]:
        repeat = int(row["repeat_count"])
        if row.get("same_classification_for_every_attempt"):
            attempts = range(1, repeat + 1)
        else:
            attempts = (int(row["attempt"]),)
        for attempt in attempts:
            for course_id in ROUTABLE_COURSE_IDS:
                yield row, attempt, course_id


def build_frozen_document(coverage: dict[str, Any] | None = None) -> dict[str, Any]:
    coverage = coverage if coverage is not None else load_coverage()
    fixtures: dict[str, Any] = {}
    for row, attempt, course_id in iter_fixture_slots(coverage):
        key = fixture_key(row["scenario_id"], attempt, row["request_ordinal"], course_id)
        fixtures[key] = build_one_fixture(key, course_id)
    return {
        "schema": FIXTURE_SCHEMA,
        "fixture_key": "scenario_id/benchmark_attempt_number/chat_request_ordinal/course_id",
        "routable_course_ids": list(ROUTABLE_COURSE_IDS),
        "fixtures": fixtures,
    }


def document_bytes(document: dict[str, Any]) -> bytes:
    return (canonical_json(document) + "\n").encode("utf-8")


def write_frozen_files(coverage: dict[str, Any] | None = None) -> dict[str, Any]:
    coverage = coverage if coverage is not None else load_coverage()
    document = build_frozen_document(coverage)
    payload = document_bytes(document)
    FIXTURE_PATH.write_bytes(payload)
    coverage_bytes = COVERAGE_PATH.read_bytes()
    vector_hashes = {
        key: fixture["query_vector_sha256"]
        for key, fixture in document["fixtures"].items()
    }
    content_hashes = {
        key: fixture["matches"][0]["content_sha256"]
        for key, fixture in document["fixtures"].items()
    }
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "fixture_file": FIXTURE_PATH.name,
        "sha256": sha256_bytes(payload),
        "byte_count": len(payload),
        "fixture_count": len(document["fixtures"]),
        "fixture_key_domain": "scenario_id/benchmark_attempt_number/chat_request_ordinal/course_id",
        "routable_course_ids": list(ROUTABLE_COURSE_IDS),
        "vector_dimension": 1024,
        "per_fixture_vector_sha256": vector_hashes,
        "per_fixture_content_sha256": content_hashes,
        "authority_metadata_schema": list(AUTHORITY_METADATA_FIELDS),
        "source_coverage": {
            course_id: sum(1 for fixture in document["fixtures"].values() if fixture["course_id"] == course_id)
            for course_id in ROUTABLE_COURSE_IDS
        },
        "coverage_matrix_sha256": sha256_bytes(coverage_bytes),
    }
    FIXTURE_MANIFEST_PATH.write_bytes(document_bytes(manifest))
    return manifest


def refresh_stored_vector_digests() -> dict[str, Any]:
    """Rewrite stored vector digests in place. Vector values are not rebuilt."""
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for fixture in payload["fixtures"].values():
        fixture["query_vector_sha256"] = vector_sha256(fixture["query_vector"])
    raw = document_bytes(payload)
    FIXTURE_PATH.write_bytes(raw)
    manifest = json.loads(FIXTURE_MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["sha256"] = sha256_bytes(raw)
    manifest["byte_count"] = len(raw)
    manifest["per_fixture_vector_sha256"] = {
        key: fixture["query_vector_sha256"]
        for key, fixture in payload["fixtures"].items()
    }
    FIXTURE_MANIFEST_PATH.write_bytes(document_bytes(manifest))
    return {"byte_count": len(raw), "fixtures": len(payload["fixtures"]), "sha256": manifest["sha256"]}


def load_frozen_document() -> dict[str, Any]:
    payload = FIXTURE_PATH.read_bytes()
    manifest_payload = FIXTURE_MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_payload.decode("utf-8"))
    actual = sha256_bytes(payload)
    if actual != manifest["sha256"] or len(payload) != manifest["byte_count"]:
        raise FixtureCorruption(
            f"frozen fixture file sha256 {actual} does not match manifest {manifest['sha256']}"
        )
    document = json.loads(payload.decode("utf-8"))
    if document.get("schema") != FIXTURE_SCHEMA:
        raise FixtureCorruption("frozen fixture schema mismatch")
    if len(document.get("fixtures") or {}) != manifest["fixture_count"]:
        raise FixtureCorruption("frozen fixture count mismatch")
    return document


class FixtureCorruption(Exception):
    pass


def fixture_is_servable(fixture: dict[str, Any] | None) -> bool:
    if not isinstance(fixture, dict):
        return False
    bindings = fixture.get("bindings")
    matches = fixture.get("matches")
    if not isinstance(bindings, list) or not bindings:
        return False
    if not isinstance(matches, list) or not matches:
        return False
    content = matches[0].get("content") if isinstance(matches[0], dict) else None
    if not isinstance(content, str) or not content.strip():
        return False
    if not vector_is_valid(fixture.get("query_vector")):
        return False
    binding = bindings[0]
    match = matches[0]
    document_meta = match.get("document_metadata") if isinstance(match, dict) else None
    return (
        isinstance(binding, dict)
        and binding.get("is_active") is True
        and isinstance(match, dict)
        and match.get("is_active") is True
        and isinstance(document_meta, dict)
        and document_meta.get("status") == "ready"
        and bool(match.get("content_sha256"))
        and fixture.get("query_vector_sha256") == vector_sha256(fixture["query_vector"])
    )


def matrix_row(coverage: dict[str, Any], scenario_id: str, attempt: int, ordinal: int | None):
    found = []
    for row in coverage["rows"]:
        if row["scenario_id"] != scenario_id:
            continue
        repeat = int(row["repeat_count"])
        if row.get("same_classification_for_every_attempt"):
            if not (1 <= int(attempt) <= repeat):
                continue
        elif int(attempt) != int(row["attempt"]):
            continue
        if row["request_ordinal"] != ordinal:
            continue
        found.append(row)
    if len(found) != 1:
        return None
    return found[0]


if __name__ == "__main__":
    written = write_frozen_files()
    print(canonical_json(written))
