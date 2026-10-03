"""PD-F04 provider and infrastructure evidence.

Native evidence is recorded before product semantic projection. An
infrastructure outcome keeps the existing canonical status vocabulary and
cannot be rewritten into product PASS or product FAIL by later fallback text.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .constants import (
    CANONICAL_BENCHMARK_STATUSES,
    EVIDENCE_FIELDS,
    INFRA_RAW_OUTCOMES,
    RAW_INFRASTRUCTURE_OUTCOMES,
)

_SECRET_KEY = re.compile(
    r"(authorization|api[_-]?key|apikey|secret|token|password|bearer)",
    re.IGNORECASE,
)
_BEARER = re.compile(r"bearer\s+\S+", re.IGNORECASE)
_SB_SECRET = re.compile(r"sb_secret_\S+", re.IGNORECASE)
_BASIC = re.compile(r"authorization:\s*basic\s+\S+", re.IGNORECASE)
_BASIC_TOKEN = re.compile(r"\bBasic\s+[A-Za-z0-9+/=]{4,}", re.IGNORECASE)
_SENSITIVE_TEXT_KEY = re.compile(r"(host|model|model_identifier|thread|task)", re.IGNORECASE)
_SECRET_SHAPED = re.compile(
    r"(secret|bearer\s+\S+|sb_secret_\S+|authorization:\s*basic\s+\S+|\bsk-[A-Za-z0-9_\-]{8,})",
    re.IGNORECASE,
)
_SK_ASSIGN = re.compile(r"(api_key\s*=\s*)sk-\S+", re.IGNORECASE)
_SK_BARE = re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}")


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def body_fingerprint(data: bytes | None) -> dict[str, Any]:
    """Safe structural fingerprint. Raw provider bytes are not retained."""
    if data is None:
        return {
            "body_sha256": None,
            "body_structural_descriptor": None,
            "body_byte_length": None,
        }
    descriptor = "empty"
    if data:
        try:
            parsed = json.loads(data.decode("utf-8"))
            descriptor = "json" if isinstance(parsed, (dict, list)) else "json-scalar"
        except Exception:
            try:
                data.decode("utf-8")
                descriptor = "text"
            except Exception:
                descriptor = "non_utf8"
    return {
        "body_sha256": sha256_bytes(data),
        "body_structural_descriptor": descriptor,
        "body_byte_length": len(data),
    }


def _secret_stamp(kind: str, secret: str) -> str:
    return f"[REDACTED_{kind}:{sha256_text(secret)[:16]}]"


def _redact_text(value: str) -> str:
    value = _BEARER.sub(lambda match: _secret_stamp("BEARER", match.group(0)), value)
    value = _SB_SECRET.sub(lambda match: _secret_stamp("SUPABASE_SECRET", match.group(0)), value)
    value = _BASIC.sub(lambda match: _secret_stamp("BASIC", match.group(0)), value)
    value = _BASIC_TOKEN.sub(lambda match: _secret_stamp("BASIC", match.group(0)), value)
    value = _SK_ASSIGN.sub(lambda match: match.group(1) + _secret_stamp("SK", match.group(0)), value)
    value = _SK_BARE.sub(lambda match: _secret_stamp("SK", match.group(0)), value)
    return value


def _json_safe(value: Any) -> Any:
    """Keep the event when a value cannot be JSON-encoded."""
    try:
        json.dumps(value)
        return value
    except TypeError:
        pass
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return {
        "__nonserializable__": type(value).__name__,
        "repr": _redact_text(repr(value))[:500],
    }


def _stamp_secret_name(key: str, item: Any) -> str | None:
    if not isinstance(item, str) or not _SENSITIVE_TEXT_KEY.search(str(key)):
        return None
    if _SECRET_SHAPED.search(item):
        return _secret_stamp("SENSITIVE_TEXT", item)
    return None


def redact(value: Any) -> Any:
    """Drop credential-bearing keys and redact secret-shaped strings.

    The event itself is kept. Key names such as Authorization and apikey are
    omitted. Secret-shaped values in other fields become hash stamps that do
    not contain ``sb_secret_`` or ``Bearer ``. Task and thread names are
    stamped the same way before a raw attempt store can keep them.
    """
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if _SECRET_KEY.search(str(key)):
                continue
            stamped = _stamp_secret_name(str(key), item)
            if stamped is not None:
                out[str(key)] = stamped
                continue
            if isinstance(item, list) and _SENSITIVE_TEXT_KEY.search(str(key)):
                stamped_items = []
                for entry in item:
                    named = _stamp_secret_name(str(key), entry)
                    stamped_items.append(named if named is not None else redact(entry))
                out[str(key)] = stamped_items
                continue
            out[str(key)] = redact(item)
        return out
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return _redact_text(value)
    return value


def classify_raw_outcome(
    *,
    http_status: int | None = None,
    timeout_class: str | None = None,
    transport_error_class: str | None = None,
    malformed_response: bool = False,
    auth_failure: bool = False,
    retrieval_infra: bool = False,
    other_infra: bool = False,
) -> str:
    """Map one observable provider attempt onto a raw infrastructure outcome.

    PRODUCT_RESPONSE_OBSERVED is only returned for a well-formed HTTP 200
    that is not an auth, timeout, transport, or retrieval-infrastructure failure.
    """
    if retrieval_infra:
        return "RETRIEVAL_INFRA_FAILURE"
    if timeout_class:
        return "PROVIDER_TIMEOUT"
    if transport_error_class:
        return "PROVIDER_CONNECTION_FAILURE"
    if auth_failure or http_status in (401, 403):
        return "PROVIDER_AUTH_FAILURE"
    if malformed_response:
        return "PROVIDER_MALFORMED_RESPONSE"
    if http_status == 429:
        return "PROVIDER_HTTP_429"
    if isinstance(http_status, int) and 400 <= http_status < 500:
        return "PROVIDER_HTTP_4XX"
    if isinstance(http_status, int) and 500 <= http_status <= 599:
        return "PROVIDER_HTTP_5XX"
    if other_infra:
        return "OTHER_INFRA_FAILURE"
    if http_status == 200:
        return "PRODUCT_RESPONSE_OBSERVED"
    return "OTHER_INFRA_FAILURE"


def _as_http_status(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _first_present(record: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in record and record.get(name) is not None:
            return record.get(name)
    return None


def classify_canonical_provider(record: dict[str, Any]) -> str:
    """One classification order for every real producer.

    Timeout wins. Auth (including HTTP 401/403) wins over a generic 4xx.
    An HTTP status wins over a bare transport class, so HTTP 500 is
    PROVIDER_HTTP_5XX even when a transport class is also present.
    An explicit infrastructure raw outcome is kept when transport does not
    contradict it. PRODUCT_RESPONSE_OBSERVED does not survive a transport failure.
    """
    http_status = _as_http_status(_first_present(record, "http_status", "HTTP_status"))
    timeout = bool(record.get("timeout")) or bool(record.get("timeout_class"))
    auth = bool(record.get("auth_failure")) or http_status in (401, 403)
    malformed = bool(record.get("malformed_response"))
    transport = record.get("transport_error_class")
    if timeout:
        computed = "PROVIDER_TIMEOUT"
    elif auth:
        computed = "PROVIDER_AUTH_FAILURE"
    elif malformed:
        computed = "PROVIDER_MALFORMED_RESPONSE"
    elif http_status == 429:
        computed = "PROVIDER_HTTP_429"
    elif isinstance(http_status, int) and 400 <= http_status < 500:
        computed = "PROVIDER_HTTP_4XX"
    elif isinstance(http_status, int) and 500 <= http_status <= 599:
        computed = "PROVIDER_HTTP_5XX"
    elif transport:
        computed = "PROVIDER_CONNECTION_FAILURE"
    elif http_status == 200:
        computed = "PRODUCT_RESPONSE_OBSERVED"
    else:
        computed = "OTHER_INFRA_FAILURE"
    explicit = record.get("raw_infrastructure_outcome")
    if explicit == "PRODUCT_RESPONSE_OBSERVED" and computed != "PRODUCT_RESPONSE_OBSERVED":
        return computed
    if computed != "OTHER_INFRA_FAILURE":
        return computed
    if explicit in RAW_INFRASTRUCTURE_OUTCOMES:
        return str(explicit)
    return computed


def normalize_provider_event(event: dict[str, Any]) -> dict[str, Any]:
    """Write the one canonical provider schema and equal legacy projections.

    Aggregators read the canonical names. Legacy names are copies of those
    values so an older reader cannot observe a different status.
    """
    source = dict(event)
    http_status = _as_http_status(_first_present(source, "http_status", "HTTP_status"))
    classification = source.get("request_start_classification")
    if classification in {"NO_ACTIVE_ATTEMPT_AT_REQUEST_START", "UNARMED_DURING_ACTIVE_ATTEMPT"}:
        scenario_id = None
        attempt_number = None
    else:
        scenario_id = _first_present(source, "scenario_id", "benchmark_scenario_id")
        attempt_number = _first_present(source, "attempt_number", "benchmark_attempt_number")
    model = _first_present(source, "model_identifier", "model")
    timeout = bool(source.get("timeout")) or bool(source.get("timeout_class"))
    transport = source.get("transport_error_class")
    auth = bool(source.get("auth_failure")) or http_status in (401, 403)
    malformed = bool(source.get("malformed_response"))
    raw = classify_canonical_provider({
        **source,
        "http_status": http_status,
        "timeout": timeout,
        "auth_failure": auth,
        "malformed_response": malformed,
        "transport_error_class": transport,
    })
    timeout_class = source.get("timeout_class")
    if timeout and not timeout_class:
        timeout_class = "PROVIDER_TIMEOUT"
    if not timeout:
        timeout_class = None
    normalized = dict(source)
    normalized.update({
        "provider_class": source.get("provider_class") or "DEEPSEEK",
        "destination_class": source.get("destination_class") or "DEEPSEEK_CHAT_COMPLETIONS",
        "scenario_id": scenario_id,
        "attempt_number": attempt_number,
        "chat_request_ordinal": source.get("chat_request_ordinal"),
        "http_status": http_status,
        "transport_error_class": transport,
        "timeout": timeout,
        "auth_failure": auth,
        "malformed_response": malformed,
        "raw_infrastructure_outcome": raw,
        "provider_request_id": source.get("provider_request_id"),
        "model_identifier": model,
        "request_started_at": source.get("request_started_at"),
        "request_finished_at": source.get("request_finished_at"),
        "elapsed_ms": source.get("elapsed_ms"),
        "HTTP_status": http_status,
        "benchmark_scenario_id": scenario_id,
        "benchmark_attempt_number": attempt_number,
        "timeout_class": timeout_class,
        "request_start_classification": classification,
    })
    return normalized


def split_deepseek_from_product_log(product_code: str | None) -> dict[str, Any]:
    """The product client collapses timeout and connection failure into ABORTED.

    This function must not invent a split the product log does not contain.
    """
    return {
        "split": False,
        "product_code": product_code,
        "reason": "PRODUCT_LOG_CANNOT_SPLIT_TIMEOUT_AND_CONNECTION",
        "raw_infrastructure_outcome": None,
    }


def split_deepseek_from_observing_proxy(observation: str) -> dict[str, Any]:
    """Benchmark-side proxy observation, recorded before the product catch."""
    if observation == "timeout":
        raw = "PROVIDER_TIMEOUT"
    elif observation == "connection_failure":
        raw = "PROVIDER_CONNECTION_FAILURE"
    else:
        raise ValueError(f"unsupported proxy observation {observation!r}")
    return {
        "split": True,
        "source": "OBSERVING_PROXY",
        "raw_infrastructure_outcome": raw,
    }


def build_native_evidence(
    *,
    provider_class: str,
    destination_class: str,
    raw_infrastructure_outcome: str,
    model_identifier: str | None = None,
    benchmark_scenario_id: str | None = None,
    benchmark_attempt_number: int | None = None,
    chat_request_ordinal: int | None = None,
    request_started_at: str | None = None,
    request_finished_at: str | None = None,
    elapsed_ms: int | None = None,
    http_status: int | None = None,
    provider_request_id: str | None = None,
    timeout_class: str | None = None,
    transport_error_class: str | None = None,
    malformed_response: bool = False,
    auth_failure: bool = False,
    native_provider_retry_index: int | None = None,
    native_provider_retry_count: int | None = None,
    benchmark_repeat_index: int | None = None,
    operator_retry: bool = False,
    operator_retry_explicitly_authorized: bool = False,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Preserve one attempt before any semantic product projection.

    operator_retry stays false unless the caller explicitly authorizes it.
    Header values that could carry credentials are not copied into the record.
    """
    if raw_infrastructure_outcome not in RAW_INFRASTRUCTURE_OUTCOMES:
        raise ValueError(
            f"raw outcome {raw_infrastructure_outcome!r} is outside the accepted set"
        )
    if operator_retry and not operator_retry_explicitly_authorized:
        operator_retry = False
    fingerprint = body_fingerprint(body)
    record = {
        "provider_class": provider_class,
        "destination_class": destination_class,
        "model_identifier": model_identifier,
        "benchmark_scenario_id": benchmark_scenario_id,
        "benchmark_attempt_number": benchmark_attempt_number,
        "chat_request_ordinal": chat_request_ordinal,
        "request_started_at": request_started_at,
        "request_finished_at": request_finished_at,
        "elapsed_ms": elapsed_ms,
        "HTTP_status": http_status,
        "provider_request_id": provider_request_id,
        "timeout_class": timeout_class,
        "transport_error_class": transport_error_class,
        "malformed_response": bool(malformed_response),
        "auth_failure": bool(auth_failure),
        "native_provider_retry_index": native_provider_retry_index,
        "native_provider_retry_count": native_provider_retry_count,
        "benchmark_repeat_index": benchmark_repeat_index,
        "operator_retry": bool(operator_retry),
        "result_projection_stage": "NATIVE_BEFORE_PROJECTION",
        "raw_infrastructure_outcome": raw_infrastructure_outcome,
        "canonical_benchmark_status": None,
        **fingerprint,
    }
    # headers are accepted only so the builder can prove it dropped them.
    if headers:
        record["redaction_applied"] = True
    missing = [name for name in EVIDENCE_FIELDS if name not in record]
    if missing:
        raise ValueError(f"evidence missing fields: {missing}")
    redacted = _scrub_evidence(redact(normalize_provider_event(record)))
    redacted["result_projection_stage"] = "NATIVE_BEFORE_PROJECTION"
    redacted["HTTP_status"] = redacted.get("http_status")
    redacted["http_status"] = redacted.get("HTTP_status")
    return redacted


def reconcile_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    """Transport-observed fields dominate a caller-supplied outcome label."""
    record = normalize_provider_event(dict(evidence))
    raw = record.get("raw_infrastructure_outcome")
    http_status = record.get("http_status")
    retrieval = bool(record.get("retrieval_failure")) or raw == "RETRIEVAL_INFRA_FAILURE"
    observed = classify_canonical_provider(record)
    if retrieval and raw != "RETRIEVAL_INFRA_FAILURE":
        observed = "RETRIEVAL_INFRA_FAILURE"
    caller_claims_product = raw == "PRODUCT_RESPONSE_OBSERVED"
    transport_failure = observed != "PRODUCT_RESPONSE_OBSERVED"
    if caller_claims_product and transport_failure:
        record["caller_raw_infrastructure_outcome"] = raw
        record["raw_infrastructure_outcome"] = observed
        record["reconciliation"] = "TRANSPORT_FIELDS_DOMINATE_CALLER_LABEL"
    return record


def _scrub_evidence(record: dict[str, Any]) -> dict[str, Any]:
    """Keep the event. Replace any secret-shaped text that survived the first pass."""
    safe = _json_safe(redact(record))
    if not isinstance(safe, dict):
        safe = {"__evidence_retained__": True, "value": safe}
    try:
        encoded = canonical_json(safe)
    except TypeError:
        safe = {"__evidence_retained__": True, "repr": _redact_text(repr(record))[:2000]}
        encoded = canonical_json(safe)
    lowered = encoded.lower()
    if "sb_secret_" in encoded or "bearer " in lowered or "authorization: basic" in lowered or "sk-" in lowered:
        safe = _json_safe(redact(safe))
    return safe


def _provider_events(value: Any) -> list[dict[str, Any]]:
    if not value:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _select_provider(value: Any) -> dict[str, Any] | None:
    events = [normalize_provider_event(event) for event in _provider_events(value)]
    if not events:
        return None
    for event in events:
        raw = event.get("raw_infrastructure_outcome")
        if raw in INFRA_RAW_OUTCOMES:
            return reconcile_evidence(event)
    return reconcile_evidence(events[-1])


def aggregate_attempt_evidence(parts: dict[str, Any]) -> dict[str, Any]:
    """Deterministic attempt aggregate. Infrastructure dominates product semantics."""
    findings: list[dict[str, Any]] = []

    os_f04 = parts.get("os_f04") or {}
    markers = list(os_f04.get("markers") or [])
    if markers or os_f04.get("execution_status") == "STOPPED_APPARATUS_LOGGING_FAILURE":
        findings.append({
            "source": "OS_F04",
            "canonical_benchmark_status": "INFRA_FAILURE",
            "raw_infrastructure_outcome": "OTHER_INFRA_FAILURE",
            "stop_class": "STOPPED_APPARATUS_LOGGING_FAILURE",
        })

    lifecycle = parts.get("lifecycle") or {}
    if lifecycle.get("fail_closed") or lifecycle.get("remaining_task_count") or lifecycle.get("remaining_thread_count") or lifecycle.get("executor_closed") is False:
        findings.append({
            "source": "LIFECYCLE",
            "canonical_benchmark_status": "INFRA_FAILURE",
            "raw_infrastructure_outcome": "OTHER_INFRA_FAILURE",
            "stop_class": lifecycle.get("status") or "BACKGROUND_WORK_UNTERMINATED",
        })

    for event in parts.get("python_violations") or []:
        if event.get("external_contact") is True or event.get("violation") is True:
            findings.append({
                "source": "PYTHON_ISOLATION",
                "canonical_benchmark_status": "INFRA_FAILURE",
                "raw_infrastructure_outcome": "OTHER_INFRA_FAILURE",
                "stop_class": "PYTHON_ISOLATION_VIOLATION",
            })
            break

    allowed_node_reasons = {"LOOPBACK", "DEEPSEEK_CHAT_COMPLETIONS", "LOCAL_IPC"}
    for event in parts.get("node_events") or []:
        if event.get("violation") is True or event.get("external_contact") is True:
            findings.append({
                "source": "NODE_LEDGER",
                "canonical_benchmark_status": "INFRA_FAILURE",
                "raw_infrastructure_outcome": "OTHER_INFRA_FAILURE",
                "stop_class": "NODE_LEDGER_VIOLATION",
            })
            break
        if event.get("decision") == "allow" and event.get("reason") not in allowed_node_reasons:
            findings.append({
                "source": "NODE_LEDGER",
                "canonical_benchmark_status": "INFRA_FAILURE",
                "raw_infrastructure_outcome": "OTHER_INFRA_FAILURE",
                "stop_class": "NODE_LEDGER_VIOLATION",
            })
            break

    for event in parts.get("retrieval_evidence") or []:
        if event.get("classification") == "RETRIEVAL_INFRA_FAILURE":
            findings.append({
                "source": "RETRIEVAL",
                "canonical_benchmark_status": "INFRA_FAILURE",
                "raw_infrastructure_outcome": "RETRIEVAL_INFRA_FAILURE",
                "stop_class": "RETRIEVAL_INFRA_FAILURE",
            })
            break

    if parts.get("generic_infra_failure"):
        findings.append({
            "source": "GENERIC_INFRA",
            "canonical_benchmark_status": "INFRA_FAILURE",
            "raw_infrastructure_outcome": "OTHER_INFRA_FAILURE",
            "stop_class": "GENERIC_INFRA_FAILURE",
        })

    if parts.get("timeout_evidence"):
        findings.append({
            "source": "TIMEOUT",
            "canonical_benchmark_status": "TIMEOUT",
            "raw_infrastructure_outcome": "PROVIDER_TIMEOUT",
            "stop_class": "PROVIDER_TIMEOUT",
        })

    provider_events = [normalize_provider_event(event) for event in _provider_events(parts.get("provider_evidence"))]
    provider = _select_provider(provider_events)
    if provider is not None:
        raw = provider.get("raw_infrastructure_outcome")
        if raw in INFRA_RAW_OUTCOMES:
            canonical = "TIMEOUT" if raw == "PROVIDER_TIMEOUT" else "INFRA_FAILURE"
            findings.append({
                "source": "NAVIGATOR_PROVIDER",
                "canonical_benchmark_status": canonical,
                "raw_infrastructure_outcome": raw,
                "stop_class": raw,
            })

    preserved = {
        "provider_evidence": [_scrub_evidence(event) for event in provider_events],
        "retrieval_evidence": [_scrub_evidence(event) for event in (parts.get("retrieval_evidence") or []) if isinstance(event, dict)],
        "python_violations": [_scrub_evidence(event) for event in (parts.get("python_violations") or []) if isinstance(event, dict)],
        "node_events": [_scrub_evidence(event) for event in (parts.get("node_events") or []) if isinstance(event, dict)],
        "os_f04": _scrub_evidence(os_f04 if isinstance(os_f04, dict) else {"value": os_f04}),
        "lifecycle": _scrub_evidence(lifecycle if isinstance(lifecycle, dict) else {"value": lifecycle}),
        "timeout_evidence": [_scrub_evidence(event) for event in (parts.get("timeout_evidence") or []) if isinstance(event, dict)],
        "generic_infra_failure": [_scrub_evidence(event) for event in (parts.get("generic_infra_failure") or []) if isinstance(event, dict)],
    }
    if not findings:
        return {
            "dominates": False,
            "canonical_benchmark_status": None,
            "raw_infrastructure_outcome": None if provider is None else provider.get("raw_infrastructure_outcome"),
            "continue_to_next_scenario": True,
            "findings": [],
            "provider_evidence": provider,
            "preserved": preserved,
        }
    winner = findings[0]
    return {
        "dominates": True,
        "canonical_benchmark_status": winner["canonical_benchmark_status"],
        "raw_infrastructure_outcome": winner["raw_infrastructure_outcome"],
        "stop_class": winner["stop_class"],
        "continue_to_next_scenario": False,
        "findings": findings,
        "provider_evidence": _scrub_evidence(redact(provider)) if provider is not None else None,
        "preserved": preserved,
    }


def adjudicate(
    native_evidence: dict[str, Any] | None,
    product_projection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Apply infrastructure dominance after a product projection exists.

    product_projection may contain semantic_status PASS or FAIL and a
    visible fallback string. Those fields do not erase an infrastructure
    outcome recorded in native_evidence.
    """
    product_projection = dict(product_projection or {})
    if native_evidence is None:
        return {
            "canonical_benchmark_status": "NOT_OBSERVABLE",
            "raw_infrastructure_outcome": None,
            "infra_evidence_dominates": False,
            "product_claim_allowed": False,
            "reason": "NO_OBSERVATION_NO_PRODUCT_CLAIM",
            "evidence": None,
        }
    evidence = _scrub_evidence(redact(reconcile_evidence(dict(native_evidence))))
    raw = evidence.get("raw_infrastructure_outcome")
    if raw not in RAW_INFRASTRUCTURE_OUTCOMES:
        raise ValueError(f"evidence raw outcome {raw!r} is not accepted")
    evidence["result_projection_stage"] = "AFTER_PRODUCT_PROJECTION"
    semantic = product_projection.get("semantic_status")
    if raw in INFRA_RAW_OUTCOMES:
        canonical = "TIMEOUT" if raw == "PROVIDER_TIMEOUT" else "INFRA_FAILURE"
        if canonical not in CANONICAL_BENCHMARK_STATUSES:
            raise ValueError(canonical)
        evidence["canonical_benchmark_status"] = canonical
        return {
            "canonical_benchmark_status": canonical,
            "raw_infrastructure_outcome": raw,
            "infra_evidence_dominates": True,
            "product_claim_allowed": False,
            "product_semantic_status_discarded": semantic,
            "visible_text_retained_as_non_adjudicating_evidence": (
                product_projection.get("visible_text") is not None
            ),
            "reason": "INFRA_EVIDENCE_DOMINATES_PRODUCT_SEMANTIC_ADJUDICATION",
            "evidence": evidence,
        }
    if semantic not in ("PASS", "FAIL", "HOLD"):
        evidence["canonical_benchmark_status"] = "NOT_OBSERVABLE"
        return {
            "canonical_benchmark_status": "NOT_OBSERVABLE",
            "raw_infrastructure_outcome": raw,
            "infra_evidence_dominates": False,
            "product_claim_allowed": False,
            "reason": "PRODUCT_RESPONSE_WITHOUT_SEMANTIC_ADJUDICATION",
            "evidence": evidence,
        }
    evidence["canonical_benchmark_status"] = semantic
    return {
        "canonical_benchmark_status": semantic,
        "raw_infrastructure_outcome": raw,
        "infra_evidence_dominates": False,
        "product_claim_allowed": True,
        "reason": "PRODUCT_RESPONSE_OBSERVED",
        "evidence": evidence,
    }


_OBSERVER: "AttemptProviderObserver | None" = None


class AttemptProviderObserver:
    """Synthetic transport observer. It does not call DeepSeek."""

    def __init__(self) -> None:
        self.instance_id = sha256_text(str(id(self)))[:16]
        self.installed = False
        self.bound: dict[str, Any] | None = None
        self.unbound: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self._request_snapshot: dict[str, Any] | None = None
        self._request_generation = 0

    def install(self) -> "AttemptProviderObserver":
        global _OBSERVER
        _OBSERVER = self
        self.installed = True
        return self

    def bind_attempt(self, scenario_id: str, attempt_number: int, chat_request_ordinal: int | None = None) -> None:
        self.bound = {
            "scenario_id": str(scenario_id),
            "attempt_number": int(attempt_number),
            "chat_request_ordinal": chat_request_ordinal,
        }

    def begin_request_capture(self) -> dict[str, Any]:
        """Freeze request identity at start. Completion must keep this snapshot."""
        from .attempt_binding import active_attempt, armed_request_identity

        attempt = active_attempt()
        self._request_generation += 1
        if attempt is None:
            self._request_snapshot = {
                "scenario_id": None,
                "attempt_number": None,
                "chat_request_ordinal": None,
                "request_generation": self._request_generation,
                "request_start_classification": "NO_ACTIVE_ATTEMPT_AT_REQUEST_START",
            }
            return dict(self._request_snapshot)
        armed = armed_request_identity()
        bound = self.bound or {}
        bound_here = (
            bound.get("scenario_id") == attempt["scenario_id"]
            and int(bound.get("attempt_number") or -1) == int(attempt["attempt_number"])
        )
        if armed is None and not bound_here:
            self._request_snapshot = {
                "scenario_id": None,
                "attempt_number": None,
                "chat_request_ordinal": None,
                "request_generation": self._request_generation,
                "request_start_classification": "UNARMED_DURING_ACTIVE_ATTEMPT",
            }
            return dict(self._request_snapshot)
        ordinal = bound.get("chat_request_ordinal")
        self._request_snapshot = {
            "scenario_id": attempt["scenario_id"],
            "attempt_number": int(attempt["attempt_number"]),
            "chat_request_ordinal": ordinal,
            "request_generation": self._request_generation,
            "request_start_classification": "ARMED" if armed else "ATTEMPT_BOUND",
        }
        return dict(self._request_snapshot)

    def observe_synthetic_transport(self, **kwargs: Any) -> dict[str, Any]:
        from .attempt_binding import active_attempt, publish_provider_evidence

        attempt = active_attempt()
        snapshot = self._request_snapshot
        if snapshot is None:
            if attempt is None or self.bound is None:
                self.unbound.append({"reason": "UNBOUND", "fields": _json_safe(kwargs)})
                return {"accepted": False, "reason": "UNBOUND"}
            if (
                self.bound["scenario_id"] != attempt["scenario_id"]
                or int(self.bound["attempt_number"]) != int(attempt["attempt_number"])
            ):
                self.unbound.append({"reason": "IDENTITY_MISMATCH", "fields": _json_safe(kwargs)})
                return {"accepted": False, "reason": "IDENTITY_MISMATCH"}
            snapshot = {
                "scenario_id": attempt["scenario_id"],
                "attempt_number": int(attempt["attempt_number"]),
                "chat_request_ordinal": self.bound.get("chat_request_ordinal"),
                "request_generation": None,
            }
        http_status = kwargs.get("http_status")
        timeout_class = kwargs.get("timeout_class")
        raw = kwargs.get("raw_infrastructure_outcome")
        if raw not in RAW_INFRASTRUCTURE_OUTCOMES:
            raw = classify_raw_outcome(
                http_status=http_status if isinstance(http_status, int) else None,
                timeout_class=timeout_class,
                transport_error_class=kwargs.get("transport_error_class"),
            )
        evidence = build_native_evidence(
            provider_class=kwargs.get("provider_class") or "DEEPSEEK",
            destination_class=kwargs.get("destination_class") or "DEEPSEEK_CHAT_COMPLETIONS",
            raw_infrastructure_outcome=raw,
            benchmark_scenario_id=snapshot.get("scenario_id"),
            benchmark_attempt_number=snapshot.get("attempt_number"),
            chat_request_ordinal=snapshot.get("chat_request_ordinal"),
            http_status=http_status if isinstance(http_status, int) else None,
            timeout_class=timeout_class,
            transport_error_class=kwargs.get("transport_error_class"),
        )
        evidence["scenario_id"] = snapshot.get("scenario_id")
        evidence["attempt_number"] = snapshot.get("attempt_number")
        evidence["chat_request_ordinal"] = snapshot.get("chat_request_ordinal")
        evidence["request_generation"] = snapshot.get("request_generation")
        evidence["request_start_classification"] = snapshot.get("request_start_classification")
        evidence["benchmark_scenario_id"] = snapshot.get("scenario_id")
        evidence["benchmark_attempt_number"] = snapshot.get("attempt_number")
        evidence["synthetic_transport"] = True
        for key in ("note", "host", "model", "model_identifier", "thread"):
            if key in kwargs:
                evidence[key] = kwargs[key]
        accepted = publish_provider_evidence(evidence)
        if accepted:
            self.events.append(redact(evidence))
        self._request_snapshot = None
        return {"accepted": accepted, "evidence": evidence}


def installed_observer() -> AttemptProviderObserver | None:
    return _OBSERVER if _OBSERVER is not None and _OBSERVER.installed else None
