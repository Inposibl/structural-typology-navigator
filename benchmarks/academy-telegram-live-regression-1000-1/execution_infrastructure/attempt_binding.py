"""One attempt evidence object for the controlled runner.

Every material infrastructure event for a scenario attempt is published into
that attempt. finish_attempt keeps the object. The runner reads it back and
passes it to apply_infrastructure_precedence before the verdict.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import urllib.request
from typing import Any

from .pd_f04_provider_evidence import aggregate_attempt_evidence, normalize_provider_event, redact
from .pd_f06_isolation import is_opaque_function_id, is_opaque_module_id
from .pd_f06_lifecycle import AttemptBoundary, _accurate_status

_ATTEMPT: dict[str, Any] | None = None
_ORDINAL = 0
_BOUNDARY: AttemptBoundary | None = None
_CURRENT: dict[str, Any] | None = None
_STORE: dict[tuple[str, int], dict[str, Any]] = {}
_LOOPBACK: Any = None
_ARMED: dict[str, Any] | None = None
_QUARANTINE: list[dict[str, Any]] = []


def _blank(scenario_id: str, attempt_number: int) -> dict[str, Any]:
    return {
        "scenario_id": str(scenario_id),
        "attempt_number": int(attempt_number),
        "provider_evidence": [],
        "retrieval_evidence": [],
        "node_events": [],
        "python_violations": [],
        "lifecycle_reports": [],
        "lifecycle": {},
        "os_f04": {},
        "timeout_evidence": [],
        "generic_infra_failure": [],
        "quarantine": [],
        "infra_failure": False,
        "timeout_exceeded": False,
    }


def register_active_loopback(loopback: Any) -> None:
    global _LOOPBACK
    _LOOPBACK = loopback


def active_loopback() -> Any:
    return _LOOPBACK


def active_attempt() -> dict[str, Any] | None:
    return None if _ATTEMPT is None else dict(_ATTEMPT)


def armed_request_identity() -> dict[str, Any] | None:
    if _ARMED is None:
        return None
    return dict(_ARMED)


def _identity_matches(record: dict[str, Any]) -> bool:
    if _ATTEMPT is None:
        return False
    scenario = record.get("scenario_id", record.get("benchmark_scenario_id"))
    attempt = record.get("attempt_number", record.get("benchmark_attempt_number"))
    if scenario is None or attempt is None:
        return False
    return str(scenario) == _ATTEMPT["scenario_id"] and int(attempt) == int(_ATTEMPT["attempt_number"])


def _quarantine(kind: str, record: dict[str, Any]) -> None:
    safe = _safe_record(record)
    _QUARANTINE.append({"kind": kind, "record": safe})
    if _CURRENT is not None:
        _CURRENT["quarantine"].append({"kind": kind, "record": safe})


def _note_process_level(kind: str, record: dict[str, Any]) -> None:
    """A request that started with no attempt never joins a later attempt."""
    safe = _safe_record(record)
    _QUARANTINE.append({
        "kind": kind,
        "classification": "NO_ACTIVE_ATTEMPT_AT_REQUEST_START",
        "record": safe,
    })


def _safe_record(record: dict[str, Any]) -> dict[str, Any]:
    safe = redact(record)
    return safe if isinstance(safe, dict) else {"__evidence_retained__": True}


def _note_unarmed(kind: str, record: dict[str, Any]) -> None:
    """An active attempt with no request identity still owns the failure.

    No active attempt is process-level evidence only. It is not attributed
    to an attempt that does not exist.
    """
    safe = _safe_record(record)
    if _CURRENT is None:
        _QUARANTINE.append({
            "kind": kind,
            "classification": "NO_ACTIVE_ATTEMPT",
            "record": safe,
        })
        return
    entry = {
        "kind": kind,
        "classification": "UNARMED_INFRA_EVENT",
        "record": safe,
    }
    _QUARANTINE.append(entry)
    _CURRENT["quarantine"].append(entry)
    if not _event_material(kind, safe):
        return
    timeoutish = (
        safe.get("raw_infrastructure_outcome") == "PROVIDER_TIMEOUT"
        or safe.get("timeout") is True
        or bool(safe.get("timeout_class"))
    )
    if timeoutish and kind == "provider":
        _CURRENT["timeout_evidence"].append({
            "source": "UNARMED_INFRA_EVENT",
            "kind": kind,
            "reason": safe.get("reason") or safe.get("raw_infrastructure_outcome"),
        })
        _CURRENT["timeout_exceeded"] = True
        return
    visible = dict(safe)
    visible["classification"] = "UNARMED_INFRA_EVENT"
    visible["violation"] = True
    if kind == "provider":
        _CURRENT["provider_evidence"].append(visible)
    else:
        _CURRENT["node_events"].append(visible)
    _CURRENT["generic_infra_failure"].append({
        "source": "UNARMED_INFRA_EVENT",
        "kind": kind,
        "reason": safe.get("reason") or safe.get("raw_infrastructure_outcome") or "UNARMED",
    })
    _CURRENT["infra_failure"] = True


def _event_material(kind: str, event: dict[str, Any]) -> bool:
    from .constants import INFRA_RAW_OUTCOMES

    if kind == "node":
        if event.get("reason") in _MATERIAL_FETCH_DENY:
            return True
        if event.get("decision") == "deny" or event.get("external_contact") is True:
            return True
        return False
    if kind == "provider":
        if event.get("raw_infrastructure_outcome") in INFRA_RAW_OUTCOMES:
            return True
        http = event.get("http_status", event.get("HTTP_status"))
        if isinstance(http, int) and http >= 400:
            return True
        if event.get("timeout") or event.get("timeout_class") or event.get("transport_error_class"):
            return True
    return False


def _note_stale(kind: str, record: dict[str, Any]) -> None:
    """A stamped event for another attempt stays visible and fails closed."""
    record = _safe_record(record)
    entry = {
        "kind": kind,
        "classification": "STALE_OR_MISMATCHED_INFRA_EVENT",
        "record": record,
    }
    _QUARANTINE.append(entry)
    if _CURRENT is None:
        return
    _CURRENT["quarantine"].append(entry)
    _CURRENT["generic_infra_failure"].append({
        "source": "STALE_OR_MISMATCHED_INFRA_EVENT",
        "kind": kind,
        "scenario_id": record.get("scenario_id", record.get("benchmark_scenario_id")),
        "attempt_number": record.get("attempt_number", record.get("benchmark_attempt_number")),
        "active_scenario_id": _CURRENT.get("scenario_id"),
        "active_attempt_number": _CURRENT.get("attempt_number"),
    })
    _CURRENT["infra_failure"] = True


def _stale_or_quarantine(kind: str, record: dict[str, Any]) -> None:
    scenario = record.get("scenario_id", record.get("benchmark_scenario_id"))
    attempt = record.get("attempt_number", record.get("benchmark_attempt_number"))
    if _ATTEMPT is None and _CURRENT is None:
        _note_unarmed(kind, record)
        return
    if scenario is None or attempt is None:
        _note_unarmed(kind, record)
        return
    _note_stale(kind, record)


def _started_without_attempt(record: dict[str, Any]) -> bool:
    return record.get("request_start_classification") == "NO_ACTIVE_ATTEMPT_AT_REQUEST_START"


def publish_provider_evidence(record: dict[str, Any]) -> bool:
    normalized = normalize_provider_event(record)
    normalized = _safe_record(normalized)
    if _started_without_attempt(normalized):
        _note_process_level("provider", normalized)
        return False
    if not _identity_matches(normalized):
        _stale_or_quarantine("provider", normalized)
        return False
    assert _CURRENT is not None
    _CURRENT["provider_evidence"].append(normalized)
    return True


def publish_retrieval_evidence(record: dict[str, Any]) -> bool:
    record = _safe_record(record)
    if _CURRENT is None:
        _quarantine("retrieval", record)
        return False
    scenario = record.get("scenario_id")
    attempt = record.get("attempt_number")
    if scenario is None and attempt is None and _ATTEMPT is not None:
        record = dict(record)
        record["scenario_id"] = _ATTEMPT["scenario_id"]
        record["attempt_number"] = _ATTEMPT["attempt_number"]
    elif not _identity_matches(record):
        _stale_or_quarantine("retrieval", record)
        return False
    _CURRENT["retrieval_evidence"].append(record)
    return True


def publish_python_violation(record: dict[str, Any]) -> bool:
    record = _safe_record(record)
    if _CURRENT is None:
        _quarantine("python", record)
        return False
    _CURRENT["python_violations"].append(record)
    return True


def publish_node_event(record: dict[str, Any]) -> bool:
    record = _safe_record(record)
    if not _identity_matches(record):
        _stale_or_quarantine("node", record)
        return False
    assert _CURRENT is not None
    _CURRENT["node_events"].append(record)
    return True


def publish_lifecycle_report(report: dict[str, Any]) -> None:
    if _CURRENT is None or not isinstance(report, dict):
        return
    _CURRENT["lifecycle_reports"].append(_safe_record(report))


def publish_timeout_evidence(record: dict[str, Any]) -> None:
    record = _safe_record(record)
    if _CURRENT is None:
        _quarantine("timeout", record)
        return
    _CURRENT["timeout_evidence"].append(record)
    _CURRENT["timeout_exceeded"] = True


def publish_generic_infra_failure(record: dict[str, Any]) -> None:
    record = _safe_record(record)
    if _CURRENT is None:
        _quarantine("generic_infra", record)
        return
    _CURRENT["generic_infra_failure"].append(record)
    _CURRENT["infra_failure"] = True


def open_evidence_attempt(scenario_id: str, attempt_number: int) -> dict[str, Any]:
    """Open the evidence object without importing product code."""
    global _ATTEMPT, _ORDINAL, _CURRENT, _ARMED
    disarm_request_identity()
    _ATTEMPT = {
        "scenario_id": str(scenario_id),
        "attempt_number": int(attempt_number),
        # A fresh nonce per open attempt. Product authority is bound to it,
        # so authority from attempt A is not valid in attempt B even when the
        # scenario id and attempt number repeat.
        "attempt_nonce": secrets.token_hex(16),
    }
    _ORDINAL = 0
    _ARMED = None
    evidence = _blank(scenario_id, attempt_number)
    _CURRENT = evidence
    _STORE[(str(scenario_id), int(attempt_number))] = evidence
    _post_control("/attempt-open", {
        "scenario_id": str(scenario_id),
        "attempt_number": int(attempt_number),
    })
    return evidence


def close_evidence_attempt() -> dict[str, Any]:
    """Store the open evidence and clear the active attempt pointer."""
    global _ATTEMPT, _CURRENT
    disarm_request_identity()
    evidence = _CURRENT or _blank("?", 0)
    if _ATTEMPT is not None:
        _STORE[(str(_ATTEMPT["scenario_id"]), int(_ATTEMPT["attempt_number"]))] = evidence
    _CURRENT = None
    _ATTEMPT = None
    _post_control("/attempt-close", {})
    return evidence


def begin_attempt(scenario_id: str, attempt_number: int, *, require_product: bool = True) -> AttemptBoundary:
    global _BOUNDARY
    from .os_f04_streams import fd2_cursor, install_process_stderr_tee, stderr_chunk_count
    from .pd_f06_isolation import (
        event_count,
        import_guard_installed,
        install_import_guard,
        install_network_guard,
        network_guard_installed,
    )

    install_network_guard()
    install_import_guard()
    install_process_stderr_tee()
    evidence = open_evidence_attempt(scenario_id, attempt_number)
    evidence["python_event_cursor"] = event_count()
    evidence["stderr_cursor"] = stderr_chunk_count()
    evidence["fd2_cursor"] = fd2_cursor()
    cursors = _node_cursors()
    evidence["node_cursor"] = cursors["events"]
    evidence["provider_cursor"] = cursors["provider_events"]
    evidence["guards_installed"] = bool(network_guard_installed() and import_guard_installed())
    observer = _installed_observer()
    if observer is not None:
        observer.bind_attempt(str(scenario_id), int(attempt_number), None)
        evidence["provider_observer_bound"] = True
    boundary = AttemptBoundary()
    boundary.begin()
    _BOUNDARY = boundary
    if not evidence["guards_installed"]:
        boundary.product_wrap_error = "PYTHON_ISOLATION_NOT_INSTALLED_BEFORE_PRODUCT_IMPORT"
        return boundary
    try:
        from .constants import CHATBOT_TEST_BASE
        from .pd_f06_product_lifecycle import ensure_product_wrappers

        ensure_product_wrappers(CHATBOT_TEST_BASE)
    except Exception as exc:  # noqa: BLE001 — product lane fails closed; calibration does not invent a product failure
        message = f"{type(exc).__name__}: {exc}"
        if require_product:
            boundary.product_wrap_error = message
        else:
            boundary.product_wrap_skipped = message
    return boundary


def _installed_observer() -> Any:
    from .pd_f04_provider_evidence import installed_observer

    return installed_observer()


def _merge_lifecycle(outer: dict[str, Any], reports: list[dict[str, Any]]) -> dict[str, Any]:
    merged = dict(outer or {})
    rows = [outer] + [item for item in reports if isinstance(item, dict)]
    fail = any(bool(item.get("fail_closed")) for item in rows)
    remaining_tasks = sum(int(item.get("remaining_task_count") or 0) for item in rows)
    remaining_threads = sum(int(item.get("remaining_thread_count") or 0) for item in rows)
    executor_failure = any(item.get("executor_closed") is False for item in rows)
    if remaining_tasks:
        merged["remaining_task_count"] = remaining_tasks
    if remaining_threads:
        merged["remaining_thread_count"] = remaining_threads
    if executor_failure:
        merged["executor_closed"] = False
    cancelled = any(bool(item.get("cancelled_error_contained")) for item in rows)
    if cancelled:
        merged["cancelled_error_contained"] = True
    if fail or remaining_tasks or remaining_threads or executor_failure or cancelled:
        merged["fail_closed"] = True
        merged["continue_to_next_scenario"] = False
        status = str(merged.get("status") or "BACKGROUND_WORK_UNTERMINATED")
        if cancelled and status in {"THREADS_TERMINATED", "BACKGROUND_WORK_TERMINATED"}:
            status = "LIFECYCLE_FAIL_CLOSED"
        merged["status"] = _accurate_status(True, status)
    merged["reports"] = list(reports)
    return merged


def finish_attempt() -> dict[str, Any]:
    global _BOUNDARY
    from .os_f04_streams import os_f04_report_since
    from .pd_f06_isolation import events
    from .producer_registry import note_handoff

    try:
        boundary = _BOUNDARY
        evidence = _CURRENT
        if boundary is None:
            report = {
                "fail_closed": True,
                "status": "NO_BOUNDARY",
                "continue_to_next_scenario": False,
            }
        else:
            report = boundary.finish()
            if getattr(boundary, "product_wrap_error", None):
                report = dict(report)
                report["fail_closed"] = True
                report["status"] = "PRODUCT_LIFECYCLE_UNAVAILABLE"
                report["continue_to_next_scenario"] = False
                report["product_wrap_error"] = boundary.product_wrap_error
            elif getattr(boundary, "product_wrap_skipped", None):
                report = dict(report)
                report["product_wrappers"] = "NOT_INSTALLED"
                report["product_wrap_skipped"] = boundary.product_wrap_skipped
        _BOUNDARY = None
        if evidence is None:
            return report
        evidence["os_f04"] = os_f04_report_since(
            stderr_cursor=int(evidence.get("stderr_cursor") or 0),
            fd2_at=int(evidence.get("fd2_cursor") or 0),
        )
        note_handoff("OS_F04", {"execution_status": (evidence.get("os_f04") or {}).get("execution_status")})
        cursor = int(evidence.get("python_event_cursor") or 0)
        for offset, event in enumerate(events()[cursor:]):
            item = dict(event)
            if item.get("decision") == "deny" or item.get("external_contact") is True:
                item["violation"] = True
                # Block-B RC-O01: attempt-local position in recorded event order.
                item["event_sequence"] = offset
                # Same recursive redaction as every other raw evidence record.
                evidence["python_violations"].append(_safe_record(item))
        if evidence["python_violations"]:
            note_handoff("PYTHON_ISOLATION", {"count": len(evidence["python_violations"])})
        _collect_node_window(evidence)
        evidence["lifecycle"] = _safe_record(_merge_lifecycle(report, list(evidence.get("lifecycle_reports") or [])))
        if evidence["lifecycle"].get("cancelled_error_contained"):
            evidence["generic_infra_failure"].append(_safe_record({
                "source": "LIFECYCLE_CANCELLATION",
                "reason": "LIFECYCLE_CANCELLATION",
            }))
            evidence["infra_failure"] = True
        note_handoff("PD_F06_LIFECYCLE", {"status": evidence["lifecycle"].get("status")})
        if evidence.get("timeout_evidence") or evidence.get("generic_infra_failure"):
            note_handoff("GENERIC_TIMEOUT_TRANSPORT", {
                "timeouts": len(evidence.get("timeout_evidence") or []),
                "generic": len(evidence.get("generic_infra_failure") or []),
            })
        return evidence["lifecycle"]
    finally:
        if _CURRENT is not None:
            close_evidence_attempt()
        else:
            disarm_request_identity()


# Block-B RC-O01: bounded, allowlisted projection of the Python isolation
# violations kept for one attempt. Diagnostic only; no verdict reads it.
# Block C serializes it next to the unchanged python_violation_count.
# CORR1 PRIVACY-VALUE-BOUNDARY-1: a key allowlist is not a value privacy
# guarantee — every serialized string must satisfy a bounded safe grammar
# or degrade to null.
# CORR2 OPAQUE-CALLSITE-AND-SCOPED-IPV6-CLOSURE-1 (Owner adjudication):
# callsite.module/function serialize ONLY exact opaque correlation IDs
# (m:/f: + 32 hex); injected raw labels are never re-hashed into IDs.
# Enum-like diagnostic fields use exact finite producer-value allowlists.
# Scoped IPv6 degrades to null before any ipaddress representation.
PYTHON_VIOLATION_MAX_RECORDS = 32
PYTHON_VIOLATION_FIELDS = (
    "event_sequence",
    "operation",
    "decision",
    "reason",
    "destination_class",
    "normalized_host",
    "port",
    "path_class",
    "external_contact",
    "violation",
)
PYTHON_VIOLATION_CALLSITE_FIELDS = ("frame_class", "module", "function", "lineno")
_CALLSITE_FRAME_CLASSES = frozenset({
    "PRODUCT_CHATBOT", "BENCHMARK_HARNESS", "THIRD_PARTY", "STDLIB", "OTHER",
})
_LABEL_MAX = {
    "operation": 64,
    "decision": 16,
    "reason": 64,
    "destination_class": 64,
    "normalized_host": 253,
    "path_class": 128,
}
# Exact authoritative producer sets, derived from the isolation source
# (pd_f06_isolation.py) only. The projection returns a known value or null —
# never an arbitrary value merely because it matches a charset.
# operation: every _record(...) operation literal in the guard
# (guarded_open/os.open/audit.open + the nine guarded socket entry points).
OPERATION_VALUES = frozenset({
    "open",
    "os.open",
    "audit.open",
    "socket.getaddrinfo",
    "socket.create_connection",
    "socket.connect",
    "socket.connect_ex",
    "socket.gethostbyname",
    "socket.gethostbyname_ex",
    "socket.gethostbyaddr",
    "socket.sendto",
    "socket.sendmsg",
})
# decision: the two literals the guard records.
DECISION_VALUES = frozenset({"allow", "deny"})
# reason: classify_host's LOOPBACK/DEFAULT_DENY and the credential-path
# PermissionError reason CREDENTIAL_DISCOVERY_DENIED.
REASON_VALUES = frozenset({
    "LOOPBACK",
    "DEFAULT_DENY",
    "CREDENTIAL_DISCOVERY_DENIED",
})
# destination_class: classify_host's enumerated classes, plus the fixed
# normalized-host echoes produced for _DENY_EXACT entries that carry no
# google/telegram/sheets name and for the _GOOGLE_SUFFIXES apex itself.
# Arbitrary gstatic-suffixed subdomain echoes are NOT authoritative values
# and degrade to null (the open-ended echo family is closed here).
DESTINATION_CLASS_VALUES = frozenset({
    "LOOPBACK",
    "GOOGLE",
    "GOOGLE_SHEETS_API",
    "GOOGLE_OAUTH_TOKEN",
    "TELEGRAM",
    "ALL_OTHER_HOSTS",
    "UNKNOWN",
    "api.cohere.com",
    "api.deepseek.com",
    "suggestions.dadata.ru",
    "structural-typology-navigator.vercel.app",
    "gstatic.com",
})
# Enumerated diagnostic tokens: letters, digits, underscore and dot only, with
# at least one alphanumeric character. Used for path_class only (basename-only
# contract); the four enum fields above use exact value membership.
_TOKEN_LABEL_RE = re.compile(r"[A-Za-z0-9_.]+")
# Hostnames: dot-separated labels of letters, digits and inner hyphens.
_HOST_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
_HOSTNAME_RE = re.compile(_HOST_LABEL + r"(?:\." + _HOST_LABEL + r")*")


def _bounded_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _allowlisted(value: Any, allowed: frozenset) -> str | None:
    """A known authoritative producer value, or None. Exact membership only."""
    return value if isinstance(value, str) and value in allowed else None


def _safe_enum_label(value: Any, limit: int) -> str | None:
    """Bounded diagnostic token only (letters/digits/underscore/dot); else None."""
    if not isinstance(value, str) or not value or len(value) > limit:
        return None
    if _TOKEN_LABEL_RE.fullmatch(value) is None or not any(c.isalnum() for c in value):
        return None
    return value


def _safe_host_label(value: Any) -> str | None:
    """Serialize only a genuinely host-like value: an unscoped IP literal in
    canonical form, or bounded dot-separated host labels.

    A URL, userinfo, port, path, query, fragment, scoped IPv6 (any ``%``
    zone/scope content), control character, embedded credential or arbitrary
    payload never satisfies this projection and is never parsed into new
    sensitive fields; unsafe values degrade to null.
    """
    if not isinstance(value, str) or not value:
        return None
    # Scoped IPv6 is not part of this diagnostic surface: reject any "%"
    # BEFORE any ipaddress representation can carry the scope verbatim.
    if "%" in value:
        return None
    # Reject values that carry control characters or whitespace anywhere.
    # The value is never cleaned into a safe-looking host: cleaning a payload
    # would be a transport, not a projection.
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F or ch.isspace() for ch in value):
        return None
    text = value
    if text.endswith("."):
        text = text.rstrip(".")
    if not text or len(text) > _LABEL_MAX["normalized_host"]:
        return None
    bracketed = text.startswith("[") and text.endswith("]")
    candidate = text[1:-1] if bracketed else text
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        address = None
    if address is not None:
        if address.version == 6:
            return f"[{address.compressed}]" if bracketed else address.compressed
        return None if bracketed else address.compressed
    if bracketed:
        return None
    lowered = text.lower()
    if len(lowered) > 253 or _HOSTNAME_RE.fullmatch(lowered) is None:
        return None
    return lowered


def _safe_basename(value: Any) -> str | None:
    """Basename only, even if a producer ever supplied a path."""
    if not isinstance(value, str) or not value:
        return None
    return os.path.basename(value.replace("\\", "/").rstrip("/")) or None


def _project_callsite(callsite: Any) -> dict[str, Any]:
    site = callsite if isinstance(callsite, dict) else {}
    frame_class = site.get("frame_class")
    module = site.get("module")
    function = site.get("function")
    return {
        "frame_class": frame_class if frame_class in _CALLSITE_FRAME_CLASSES else "OTHER",
        # Accept only values already in the exact opaque-ID grammar. Injected
        # raw labels are NOT re-hashed into IDs; they degrade to null.
        "module": module if is_opaque_module_id(module) else None,
        "function": function if is_opaque_function_id(function) else None,
        "lineno": _bounded_int(site.get("lineno")),
    }


def _project_violation(record: Any) -> dict[str, Any]:
    source = record if isinstance(record, dict) else {}
    projected: dict[str, Any] = {
        "event_sequence": _bounded_int(source.get("event_sequence")),
        "operation": _allowlisted(source.get("operation"), OPERATION_VALUES),
        "decision": _allowlisted(source.get("decision"), DECISION_VALUES),
        "reason": _allowlisted(source.get("reason"), REASON_VALUES),
        "destination_class": _allowlisted(source.get("destination_class"), DESTINATION_CLASS_VALUES),
        "normalized_host": _safe_host_label(source.get("normalized_host")),
        "port": _bounded_int(source.get("port")),
        "path_class": _safe_enum_label(_safe_basename(source.get("path_class")), _LABEL_MAX["path_class"]),
        "external_contact": source.get("external_contact") is True,
        "violation": source.get("violation") is True,
        "callsite": _project_callsite(source.get("callsite")),
    }
    # The stored record is already redacted; the projection is redacted again.
    return _safe_record(projected)


def python_violation_details(scenario_id: str, attempt_number: int) -> dict[str, Any]:
    """Read-only projection for per-attempt snapshot serialization.

    Returns fresh objects; the stored attempt evidence is never exposed.
    python_violation_total equals len(python_violations) in the store, which
    is the existing python_violation_count surface.
    """
    stored = _STORE.get((str(scenario_id), int(attempt_number))) or {}
    records = list(stored.get("python_violations") or [])
    return {
        "python_violations": [
            _project_violation(record) for record in records[:PYTHON_VIOLATION_MAX_RECORDS]
        ],
        "python_violation_total": len(records),
        "python_violations_truncated": len(records) > PYTHON_VIOLATION_MAX_RECORDS,
    }


def collected_evidence(scenario_id: str, attempt_number: int) -> dict[str, Any] | None:
    stored = _STORE.get((str(scenario_id), int(attempt_number)))
    if stored is None:
        return None
    return stored


def quarantine() -> list[dict[str, Any]]:
    return list(_QUARANTINE)


def _post_control(path: str, payload: dict[str, Any] | None = None) -> None:
    """Tell the preload whether an attempt is open. Absent preload is a no-op."""
    base = _control_base()
    if not base:
        return
    request = urllib.request.Request(
        base + path,
        data=json.dumps(payload or {}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            response.read()
    except Exception:
        return


def _control_base() -> str | None:
    state_path = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    if not state_path or not os.path.exists(state_path):
        return None
    try:
        state = json.loads(open(state_path, "r", encoding="utf-8").read())
        return f"http://127.0.0.1:{int(state['port'])}"
    except Exception:
        return None


def _read_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8") or "{}")


def _node_cursors() -> dict[str, int]:
    """Ledger cursors. -1 when no preload is configured, -2 when the fetch fails."""
    state_path = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    if not state_path:
        return {"events": -1, "provider_events": -1}
    base = _control_base()
    if base is None:
        return {"events": -2, "provider_events": -2}
    try:
        body = _read_json(base + "/ledger")
    except Exception:
        return {"events": -2, "provider_events": -2}
    return {
        "events": len(body.get("events") or []),
        "provider_events": len(body.get("provider_events") or []),
    }


def _node_ledger_length() -> int:
    """Event count, -1 when no preload is configured, -2 when the fetch fails."""
    return _node_cursors()["events"]


_MATERIAL_FETCH_DENY = frozenset({
    "DEFAULT_DENY",
    "LIVE_PROVIDER_FORBIDDEN_IN_THIS_ACT",
    "COHERE_REAL_SOCKET_DENY",
})


def _collect_node_window(evidence: dict[str, Any]) -> None:
    from .producer_registry import note_handoff

    cursor = evidence.get("node_cursor")
    if cursor == -1:
        return
    base = _control_base()
    if cursor == -2 or base is None:
        evidence["generic_infra_failure"].append(_safe_record({
            "source": "NODE_LEDGER",
            "reason": "NODE_LEDGER_UNAVAILABLE",
        }))
        evidence["infra_failure"] = True
        return
    try:
        body = _read_json(base + "/ledger")
    except Exception as exc:  # noqa: BLE001
        evidence["generic_infra_failure"].append(_safe_record({
            "source": "NODE_LEDGER",
            "reason": "NODE_LEDGER_UNAVAILABLE",
            "error_class": type(exc).__name__,
        }))
        evidence["infra_failure"] = True
        return
    events = list(body.get("events") or [])
    window = events[int(cursor):] if isinstance(cursor, int) and cursor >= 0 else events
    for event in window:
        if _started_without_attempt(event):
            _note_process_level("node", event)
            continue
        scenario = event.get("scenario_id")
        attempt = event.get("attempt_number")
        if scenario is None or attempt is None:
            _note_unarmed("node", event)
            continue
        if str(scenario) != evidence["scenario_id"] or int(attempt) != int(evidence["attempt_number"]):
            _note_stale("node", event)
            continue
        item = dict(event)
        if item.get("decision") == "deny" and item.get("reason") in _MATERIAL_FETCH_DENY:
            item["violation"] = True
            note_handoff("NODE_FETCH_DENY_OBSERVER", {"reason": item.get("reason")})
        elif item.get("decision") == "deny" or item.get("external_contact") is True:
            item["violation"] = True
        evidence["node_events"].append(item)
    provider_cursor = evidence.get("provider_cursor")
    provider_events = list(body.get("provider_events") or [])
    if isinstance(provider_cursor, int) and provider_cursor >= 0:
        provider_window = provider_events[provider_cursor:]
    else:
        provider_window = provider_events
    for event in provider_window:
        if not isinstance(event, dict):
            continue
        normalized = normalize_provider_event(event)
        if _started_without_attempt(normalized):
            _note_process_level("provider", normalized)
            continue
        scenario = normalized.get("scenario_id")
        attempt = normalized.get("attempt_number")
        if scenario is None or attempt is None:
            _note_unarmed("provider", normalized)
            continue
        if str(scenario) != evidence["scenario_id"] or int(attempt) != int(evidence["attempt_number"]):
            _note_stale("provider", normalized)
            continue
        evidence["provider_evidence"].append(normalized)
        note_handoff("NODE_PROVIDER_OBSERVER", {
            "raw_infrastructure_outcome": normalized.get("raw_infrastructure_outcome"),
            "http_status": normalized.get("http_status"),
        })


def arm_request_identity(
    scenario_id: str,
    attempt_number: int,
    chat_request_ordinal: int | None,
    course_id: str | None = None,
) -> dict[str, Any]:
    """Arm Node and the Supabase loopback with the same request identity."""
    global _ARMED
    if _LOOPBACK is None:
        raise RuntimeError("SUPABASE_LOOPBACK_NOT_REGISTERED")
    payload = {
        "scenario_id": str(scenario_id),
        "attempt_number": int(attempt_number),
        "chat_request_ordinal": chat_request_ordinal,
        "course_id": course_id,
    }
    _LOOPBACK.arm(str(scenario_id), int(attempt_number), chat_request_ordinal, course_id)
    try:
        node = _post_arm(payload)
    except Exception:
        _LOOPBACK.disarm()
        _ARMED = None
        raise
    _ARMED = dict(payload)
    loopback_armed = dict(getattr(_LOOPBACK, "armed", None) or {})
    return {"request": payload, "node": node, "loopback": loopback_armed}


def arm_chat_request_for_active_attempt(course_id: str | None = None) -> dict[str, Any] | None:
    """Arm the preload and the loopback for the chat POST that is about to happen.

    No active attempt means this call is not part of a controlled scenario.
    """
    global _ORDINAL
    if _ATTEMPT is None:
        return None
    _ORDINAL += 1
    observer = _installed_observer()
    if observer is not None:
        observer.bind_attempt(_ATTEMPT["scenario_id"], int(_ATTEMPT["attempt_number"]), _ORDINAL)
    armed = arm_request_identity(
        _ATTEMPT["scenario_id"],
        int(_ATTEMPT["attempt_number"]),
        _ORDINAL,
        course_id,
    )
    return armed["request"]


def disarm_request_identity() -> None:
    """Clear Node and loopback request identity. Absent preload is a no-op."""
    global _ARMED
    loopback = _LOOPBACK
    if loopback is not None:
        try:
            loopback.disarm()
        except Exception:
            pass
    _post_disarm()
    _ARMED = None


def _post_disarm() -> None:
    state_path = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    if not state_path or not os.path.exists(state_path):
        return
    try:
        state = json.loads(open(state_path, "r", encoding="utf-8").read())
        port = int(state["port"])
    except Exception:
        return
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/disarm",
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            response.read()
    except Exception:
        return


def _post_arm(payload: dict[str, Any]) -> dict[str, Any]:
    state_path = os.environ.get("ACADEMY_EXECUTION_PRELOAD_STATE")
    if not state_path:
        raise RuntimeError("PRELOAD_ARM_REQUIRED")
    try:
        state = json.loads(open(state_path, "r", encoding="utf-8").read())
        port = int(state["port"])
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("PRELOAD_ARM_REQUIRED") from exc
    raw = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/arm",
        data=raw,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            raise RuntimeError("PRELOAD_ARM_REQUIRED")
        body = json.loads(response.read().decode("utf-8") or "{}")
    return body if isinstance(body, dict) else {"body": body}


def apply_infrastructure_precedence(
    *,
    infra_failure: bool,
    timeout_exceeded: bool,
    lifecycle_report: dict[str, Any] | None = None,
    provider_evidence: Any = None,
    retrieval_evidence: list[dict[str, Any]] | None = None,
    os_f04: dict[str, Any] | None = None,
    python_violations: list[dict[str, Any]] | None = None,
    node_events: list[dict[str, Any]] | None = None,
    timeout_evidence: list[dict[str, Any]] | None = None,
    generic_infra_failure: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Infrastructure aggregate wins before semantic adjudication."""
    aggregate = aggregate_attempt_evidence({
        "lifecycle": lifecycle_report or {},
        "provider_evidence": provider_evidence,
        "retrieval_evidence": retrieval_evidence or [],
        "os_f04": os_f04 or {},
        "python_violations": python_violations or [],
        "node_events": node_events or [],
        "timeout_evidence": timeout_evidence or [],
        "generic_infra_failure": generic_infra_failure or [],
    })
    infra = bool(infra_failure)
    timeout = bool(timeout_exceeded)
    if aggregate.get("dominates"):
        if aggregate.get("canonical_benchmark_status") == "TIMEOUT":
            timeout = True
            infra = False
        else:
            infra = True
    continue_to_next = (
        aggregate.get("continue_to_next_scenario", True) is not False
        and not infra
        and not timeout
    )
    return {
        "infra_failure": infra,
        "timeout_exceeded": timeout,
        "aggregate": aggregate,
        "continue_to_next_scenario": continue_to_next,
    }
