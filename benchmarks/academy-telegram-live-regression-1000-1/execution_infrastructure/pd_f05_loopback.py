"""Loopback Supabase REST/RPC double.

SUPABASE_URL for a future controlled run is http://127.0.0.1:<ephemeral-port>
with no userinfo, query, or fragment. The secret placeholder is accepted to
satisfy the product prefix check and is never forwarded or stored.

RETRIEVAL_INFRA_FAILURE is reserved for harness-contract violations. A wrong
but routable course id, an outside-catalog course id, and an unexpected
retrieval on a payment-gated request stay product-visible.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from .constants import (
    REQUIRED_MATCH_COUNT,
    REQUIRED_MATCH_THRESHOLD,
    ROUTABLE_COURSE_IDS,
    SUPABASE_SECRET_PLACEHOLDER,
)
from .pd_f05_fixtures import (
    fixture_is_servable,
    fixture_key,
    load_coverage,
    load_frozen_document,
    matrix_row,
    validate_p_query_embedding,
    vector_sha256,
)

BINDINGS_ROUTE = "/rest/v1/academy_course_sources"
MATCH_ROUTE = "/rest/v1/rpc/match_course_knowledge_chunks"
_MAX_BODY = 2_000_000


class LoopbackContractError(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def assert_loopback_supabase_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.username or parts.password or parts.query or parts.fragment:
        raise LoopbackContractError("SUPABASE_URL must not contain userinfo, query, or fragment")
    if parts.scheme != "http" or parts.hostname != "127.0.0.1":
        raise LoopbackContractError("SUPABASE_URL must be http://127.0.0.1:<port>")
    if not parts.port:
        raise LoopbackContractError("SUPABASE_URL port is missing")
    return f"http://127.0.0.1:{parts.port}"


def _course_from_query(query: str) -> str | None:
    params = parse_qs(query, keep_blank_values=True)
    raw = (params.get("course_id") or [None])[0]
    if raw is None:
        return None
    if raw.startswith("eq."):
        return raw[3:]
    return raw


def serve_retrieval(
    *,
    document: dict[str, Any],
    coverage: dict[str, Any],
    armed: dict[str, Any] | None,
    method: str,
    path: str,
    query: str,
    body: bytes | None,
) -> tuple[int, Any, dict[str, Any]]:
    """Return HTTP status, JSON payload, and machine evidence for one request."""
    scenario_id = None if not armed else armed.get("scenario_id")
    attempt = None if not armed else armed.get("attempt_number")
    ordinal = None if not armed else armed.get("chat_request_ordinal")
    evidence: dict[str, Any] = {
        "scenario_id": scenario_id,
        "attempt_number": attempt,
        "chat_request_ordinal": ordinal,
        "course_id": None,
        "route": path,
        "method": method,
        "match_count": None,
        "match_threshold": None,
        "fixture_id": None,
        "served_binding_count": 0,
        "served_match_count": 0,
        "unexpected_retrieval": False,
        "course_id_outside_routable_set": False,
        "classification": None,
        "reason": None,
    }

    def infra(reason: str) -> tuple[int, Any, dict[str, Any]]:
        evidence["classification"] = "RETRIEVAL_INFRA_FAILURE"
        evidence["reason"] = reason
        evidence["failure_reason"] = reason
        evidence["fixture_identity"] = evidence.get("fixture_id")
        return 503, {"classification": "RETRIEVAL_INFRA_FAILURE", "reason": reason}, evidence

    if path not in (BINDINGS_ROUTE, MATCH_ROUTE):
        return infra("route_not_in_contract")
    if path == BINDINGS_ROUTE and method != "GET":
        return infra("bindings_method")
    if path == MATCH_ROUTE and method != "POST":
        return infra("match_method")
    if not armed or scenario_id is None or attempt is None:
        return infra("unknown_armed_scenario_attempt_or_ordinal")
    row = matrix_row(coverage, str(scenario_id), int(attempt), ordinal)
    if row is None:
        return infra("unknown_armed_scenario_attempt_or_ordinal")

    unexpected = row.get("retrieval_reachable") is not True
    evidence["unexpected_retrieval"] = bool(unexpected)

    match_count = None
    match_threshold = None
    course_id = None
    if path == BINDINGS_ROUTE:
        course_id = _course_from_query(query)
    else:
        try:
            def _parse_constant(name: str):
                if name == "NaN":
                    return float("nan")
                if name == "Infinity":
                    return float("inf")
                if name == "-Infinity":
                    return float("-inf")
                raise ValueError(name)

            payload = json.loads(body.decode("utf-8") if body else "", parse_constant=_parse_constant)
        except Exception:
            return infra("match_body_unreadable")
        if not isinstance(payload, dict):
            return infra("match_body_not_object")
        course_id = payload.get("p_course_id")
        match_count = payload.get("p_match_count")
        match_threshold = payload.get("p_match_threshold")
        evidence["match_count"] = match_count
        evidence["match_threshold"] = match_threshold
        if isinstance(match_count, bool) or match_count != REQUIRED_MATCH_COUNT:
            return infra("p_match_count_must_equal_12")
        if isinstance(match_threshold, bool) or match_threshold != REQUIRED_MATCH_THRESHOLD:
            return infra("p_match_threshold_must_equal_-1")
        structural = validate_p_query_embedding(payload.get("p_query_embedding"), None)
        if structural is not None:
            evidence["query_vector_sha256"] = None
            return infra(structural)
        try:
            evidence["query_vector_sha256"] = vector_sha256(payload.get("p_query_embedding"))
        except (TypeError, ValueError):
            return infra("p_query_embedding_malformed")
    if not isinstance(course_id, str) or not course_id:
        return infra("course_id_missing")
    evidence["course_id"] = course_id

    if course_id not in ROUTABLE_COURSE_IDS:
        evidence["course_id_outside_routable_set"] = True
        evidence["classification"] = "PRODUCT_BEHAVIOR"
        evidence["reason"] = "course_id_outside_routable_set"
        empty: list = []
        return 200, empty, evidence

    key = fixture_key(str(scenario_id), int(attempt), ordinal, course_id)
    fixture = (document.get("fixtures") or {}).get(key)
    if not fixture_is_servable(fixture):
        return infra("missing_or_corrupt_fixture")
    evidence["fixture_id"] = fixture["fixture_id"]
    evidence["fixture_identity"] = fixture["fixture_id"]
    if path == MATCH_ROUTE:
        identity = validate_p_query_embedding(
            payload.get("p_query_embedding"),
            fixture.get("query_vector"),
        )
        if identity is not None:
            evidence["expected_query_vector_sha256"] = fixture.get("query_vector_sha256")
            return infra(identity)
        evidence["expected_query_vector_sha256"] = fixture.get("query_vector_sha256")
        evidence["query_vector_sha256"] = fixture.get("query_vector_sha256")
    evidence["failure_reason"] = None
    evidence["classification"] = "PRODUCT_BEHAVIOR"
    evidence["reason"] = (
        "UNEXPECTED_RETRIEVAL" if unexpected else "SERVE_NONEMPTY_FIXTURE"
    )
    if path == BINDINGS_ROUTE:
        bindings = fixture["bindings"]
        evidence["served_binding_count"] = len(bindings)
        return 200, bindings, evidence
    matches = fixture["matches"]
    evidence["served_match_count"] = len(matches)
    evidence["served_binding_count"] = len(fixture["bindings"])
    return 200, matches, evidence


class LoopbackSupabaseDouble:
    def __init__(self, document: dict[str, Any] | None = None, coverage: dict[str, Any] | None = None):
        self.document = document if document is not None else load_frozen_document()
        self.coverage = coverage if coverage is not None else load_coverage()
        self.armed: dict[str, Any] | None = None
        self.evidence: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def _remember(self, evidence: dict[str, Any]) -> dict[str, Any]:
        """Record the loopback outcome and hand it to the active attempt."""
        row = dict(evidence)
        row["failure_reason"] = row.get("failure_reason", row.get("reason"))
        row["fixture_identity"] = row.get("fixture_identity", row.get("fixture_id"))
        with self._lock:
            self.evidence.append(row)
        try:
            from .attempt_binding import publish_retrieval_evidence
            from .producer_registry import note_handoff

            publish_retrieval_evidence(row)
            note_handoff("SUPABASE_LOOPBACK", {
                "classification": row.get("classification"),
                "scenario_id": row.get("scenario_id"),
                "attempt_number": row.get("attempt_number"),
                "route": row.get("route"),
            })
        except Exception:
            pass
        return row

    def arm(
        self,
        scenario_id: str,
        attempt_number: int,
        chat_request_ordinal: int | None,
        course_id: str | None = None,
    ) -> None:
        """Replace the active request identity. The previous identity is not kept."""
        with self._lock:
            self.armed = {
                "scenario_id": scenario_id,
                "attempt_number": attempt_number,
                "chat_request_ordinal": chat_request_ordinal,
                "course_id": course_id,
            }

    def disarm(self) -> None:
        with self._lock:
            self.armed = None

    @property
    def supabase_url(self) -> str:
        if self._httpd is None:
            raise RuntimeError("loopback server is not started")
        host, port = self._httpd.server_address[:2]
        if host != "127.0.0.1":
            raise LoopbackContractError("loopback bound a non-loopback host")
        return assert_loopback_supabase_url(f"http://127.0.0.1:{port}")

    @property
    def secret_placeholder(self) -> str:
        if not SUPABASE_SECRET_PLACEHOLDER.startswith("sb_secret_"):
            raise LoopbackContractError("placeholder prefix")
        return SUPABASE_SECRET_PLACEHOLDER

    def start(self) -> str:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt: str, *args: Any) -> None:
                return None

            def _reply(self, status: int, payload: Any, evidence: dict[str, Any]) -> None:
                raw = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("x-request-id", str(evidence.get("fixture_id") or "loopback"))
                self.end_headers()
                self.wfile.write(raw)

            def _handle(self, method: str) -> None:
                length = int(self.headers.get("Content-Length", "0") or "0")
                if length > _MAX_BODY:
                    with parent._lock:
                        armed_now = None if parent.armed is None else dict(parent.armed)
                    parent._remember({
                        "classification": "RETRIEVAL_INFRA_FAILURE",
                        "reason": "body_too_large",
                        "failure_reason": "body_too_large",
                        "scenario_id": None if not armed_now else armed_now.get("scenario_id"),
                        "attempt_number": None if not armed_now else armed_now.get("attempt_number"),
                        "chat_request_ordinal": None if not armed_now else armed_now.get("chat_request_ordinal"),
                        "course_id": None,
                        "route": urlsplit(self.path).path,
                        "method": method,
                        "match_count": None,
                        "match_threshold": None,
                        "fixture_id": None,
                        "fixture_identity": None,
                        "served_binding_count": 0,
                        "served_match_count": 0,
                        "unexpected_retrieval": False,
                        "course_id_outside_routable_set": False,
                    })
                    self._reply(503, {"classification": "RETRIEVAL_INFRA_FAILURE", "reason": "body_too_large"}, {
                        "classification": "RETRIEVAL_INFRA_FAILURE",
                        "reason": "body_too_large",
                    })
                    return
                raw = self.rfile.read(length) if length else b""
                # apikey is read only to confirm the placeholder prefix, then dropped.
                apikey = self.headers.get("apikey") or ""
                parts = urlsplit(self.path)
                with parent._lock:
                    armed = None if parent.armed is None else dict(parent.armed)
                if apikey and not apikey.startswith("sb_secret_"):
                    evidence = {
                        "scenario_id": None if not armed else armed.get("scenario_id"),
                        "attempt_number": None if not armed else armed.get("attempt_number"),
                        "chat_request_ordinal": None if not armed else armed.get("chat_request_ordinal"),
                        "course_id": None,
                        "route": parts.path,
                        "method": method,
                        "match_count": None,
                        "match_threshold": None,
                        "fixture_id": None,
                        "served_binding_count": 0,
                        "served_match_count": 0,
                        "unexpected_retrieval": False,
                        "course_id_outside_routable_set": False,
                        "classification": "RETRIEVAL_INFRA_FAILURE",
                        "reason": "secret_prefix_rejected",
                    }
                    parent._remember(evidence)
                    self._reply(503, {"classification": "RETRIEVAL_INFRA_FAILURE", "reason": "secret_prefix_rejected"}, evidence)
                    return
                status, payload, evidence = serve_retrieval(
                    document=parent.document,
                    coverage=parent.coverage,
                    armed=armed,
                    method=method,
                    path=parts.path,
                    query=parts.query,
                    body=raw,
                )
                parent._remember(evidence)
                self._reply(status, payload, evidence)

            def do_GET(self) -> None:  # noqa: N802
                self._handle("GET")

            def do_POST(self) -> None:  # noqa: N802
                self._handle("POST")

        class HarnessThreadingHTTPServer(ThreadingHTTPServer):
            def process_request(self, request: Any, client_address: Any) -> None:  # type: ignore[override]
                from .pd_f06_lifecycle import note_harness_thread

                thread = threading.Thread(
                    target=self.process_request_thread,
                    args=(request, client_address),
                    name="academy-harness-loopback",
                    daemon=True,
                )
                note_harness_thread(thread)
                thread.start()

        self._httpd = HarnessThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, name="supabase-loopback", daemon=True)
        self._thread.start()
        return self.supabase_url

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None
