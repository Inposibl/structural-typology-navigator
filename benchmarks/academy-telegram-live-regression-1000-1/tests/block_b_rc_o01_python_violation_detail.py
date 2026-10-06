"""Block-B RC-O01 seam tests: bounded Python isolation violation detail.

No benchmark scenario body runs. No provider or external host is contacted:
every denied operation is refused by the isolation guard before DNS, and the
only allowed lookups are numeric loopback. The Chatbot product is not
imported (ensure_product_wrappers is stubbed for the probe attempts only).
"""

from __future__ import annotations

import builtins
import json
import os
import socket
import subprocess
import sys
import tempfile
import types
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
W_ROOT = BENCH.parent.parent.parent
sys.path.insert(0, str(BENCH))
sys.dont_write_bytecode = True

from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("block-b-rc-o01")

from execution_infrastructure import attempt_binding  # noqa: E402
from execution_infrastructure import pd_f06_isolation  # noqa: E402
from execution_infrastructure import pd_f06_product_lifecycle  # noqa: E402
from execution_infrastructure.attempt_binding import (  # noqa: E402
    PYTHON_VIOLATION_CALLSITE_FIELDS,
    PYTHON_VIOLATION_FIELDS,
    PYTHON_VIOLATION_MAX_RECORDS,
    apply_infrastructure_precedence,
    begin_attempt,
    collected_evidence,
    finish_attempt,
    python_violation_details,
)
from execution_infrastructure.pd_f04_provider_evidence import aggregate_attempt_evidence  # noqa: E402
from execution_infrastructure.pd_f06_isolation import (  # noqa: E402
    CALLSITE_FRAME_CLASSES,
    classify_host,
    events,
)

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []
RECORD_KEYS = set(PYTHON_VIOLATION_FIELDS) | {"callsite"}
CALLSITE_KEYS = set(PYTHON_VIOLATION_CALLSITE_FIELDS)


def test(name: str):
    def wrap(fn):
        def run() -> None:
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 — the suite records the failure
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
                return
            RESULTS.append((name, True, ""))
        TESTS.append(run)
        return run
    return wrap


def _canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _no_product(_root):
    raise RuntimeError("BLOCK_B_TEST_PRODUCT_NOT_LOADED")


def _probe(scenario_id: str, body) -> tuple[dict, dict]:
    """Real begin_attempt/finish_attempt; only the product import is stubbed."""
    original = pd_f06_product_lifecycle.ensure_product_wrappers
    pd_f06_product_lifecycle.ensure_product_wrappers = _no_product
    try:
        begin_attempt(scenario_id, 1, require_product=False)
        try:
            body()
        finally:
            finish_attempt()
    finally:
        pd_f06_product_lifecycle.ensure_product_wrappers = original
    return python_violation_details(scenario_id, 1), collected_evidence(scenario_id, 1) or {}


def _deny_lookup(host: str, port: int = 443) -> None:
    try:
        socket.getaddrinfo(host, port)
    except PermissionError:
        return
    raise AssertionError(f"lookup for {host!r} was not denied")


def _deny_open(path: str) -> None:
    try:
        builtins.open(path, "r")
    except PermissionError:
        return
    raise AssertionError("credential open was not denied")


def _allowed_loopback() -> None:
    socket.getaddrinfo("127.0.0.1", 9)


def _window_deny_offsets(stored: dict) -> list[int]:
    cursor = int(stored.get("python_event_cursor") or 0)
    window = events()[cursor:]
    return [i for i, e in enumerate(window) if e.get("decision") == "deny" or e.get("external_contact") is True]


def _strings(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)
    elif isinstance(value, str):
        yield value


def _assert_allowlisted(record: dict) -> None:
    if set(record) != RECORD_KEYS:
        raise AssertionError({"unexpected_keys": sorted(set(record) ^ RECORD_KEYS)})
    if set(record["callsite"]) != CALLSITE_KEYS:
        raise AssertionError({"unexpected_callsite_keys": sorted(set(record["callsite"]) ^ CALLSITE_KEYS)})
    if record["callsite"]["frame_class"] not in CALLSITE_FRAME_CLASSES:
        raise AssertionError(record["callsite"])
    home = os.path.expanduser("~")
    for text in _strings(record):
        if text.startswith("/") or home in text:
            raise AssertionError(f"path-like value leaked: {text!r}")


# ---------------------------------------------------------------- T1
@test("T1.denied_getaddrinfo_complete_bounded_record_benchmark_harness_callsite")
def t1() -> None:
    def body():
        _deny_lookup("rc-o01-probe.invalid", 443)

    details, stored = _probe("BB-RCO01-T1", body)
    expected = classify_host("rc-o01-probe.invalid")
    if details["python_violation_total"] != 1 or details["python_violations_truncated"] is not False:
        raise AssertionError(details)
    record = details["python_violations"][0]
    _assert_allowlisted(record)
    want = {
        "operation": "socket.getaddrinfo",
        "decision": "deny",
        "reason": expected["reason"],
        "destination_class": expected["destination_class"],
        "normalized_host": expected["normalized_host"],
        "port": 443,
        "path_class": None,
        "external_contact": False,
        "violation": True,
    }
    for key, value in want.items():
        if record[key] != value:
            raise AssertionError({key: record[key], "expected": value})
    if not isinstance(record["event_sequence"], int):
        raise AssertionError(record)
    site = record["callsite"]
    if site["frame_class"] != "BENCHMARK_HARNESS":
        raise AssertionError(site)
    # OWNER CONTRACT SUCCESSOR (CORR2 opaque-callsite adjudication): the
    # callsite labels are opaque correlation IDs of the raw metadata, not the
    # plaintext labels this assertion originally compared against.
    if site["module"] != pd_f06_isolation.opaque_module_id(__name__) or \
            site["function"] != pd_f06_isolation.opaque_function_id("_deny_lookup") or \
            not isinstance(site["lineno"], int):
        raise AssertionError(site)
    if not pd_f06_isolation.is_opaque_module_id(site["module"]) or not pd_f06_isolation.is_opaque_function_id(site["function"]):
        raise AssertionError(site)
    # Isolation behavior: still a deny with the classify_host reason.
    try:
        socket.getaddrinfo("rc-o01-probe.invalid", 443)
    except PermissionError as exc:
        if str(exc) != expected["reason"]:
            raise AssertionError(str(exc))
    else:
        raise AssertionError("deny behavior changed")


# ---------------------------------------------------------------- T2
@test("T2.credential_denial_persists_basename_only")
def t2() -> None:
    secret_dir = tempfile.mkdtemp(prefix="rc-o01-cred-")
    target = os.path.join(secret_dir, ".env")

    def body():
        _deny_open(target)

    details, _stored = _probe("BB-RCO01-T2", body)
    if details["python_violation_total"] != 1:
        raise AssertionError(details)
    record = details["python_violations"][0]
    _assert_allowlisted(record)
    if record["path_class"] != ".env" or record["reason"] != "CREDENTIAL_DISCOVERY_DENIED":
        raise AssertionError(record)
    if record["violation"] is not True or record["normalized_host"] is not None:
        raise AssertionError(record)
    blob = _canonical(details)
    if secret_dir in blob or os.path.basename(secret_dir) in blob:
        raise AssertionError("credential directory leaked")


# ---------------------------------------------------------------- T3
@test("T3.event_sequence_strictly_increasing_allowed_events_excluded")
def t3() -> None:
    def body():
        _allowed_loopback()
        _deny_lookup("rc-o01-seq-a.invalid")
        _allowed_loopback()
        _deny_open(os.path.join(tempfile.mkdtemp(prefix="rc-o01-seq-"), "credentials.json"))
        _deny_lookup("rc-o01-seq-b.invalid")
        _allowed_loopback()

    details, stored = _probe("BB-RCO01-T3", body)
    records = details["python_violations"]
    sequences = [r["event_sequence"] for r in records]
    if sequences != _window_deny_offsets(stored):
        raise AssertionError({"projected": sequences, "window": _window_deny_offsets(stored)})
    if len(records) != 3 or any(b <= a for a, b in zip(sequences, sequences[1:])):
        raise AssertionError(sequences)
    if any(r["decision"] != "deny" for r in records):
        raise AssertionError("an allowed event entered the violation projection")
    cursor = int(stored.get("python_event_cursor") or 0)
    allowed_in_window = [e for e in events()[cursor:] if e.get("decision") == "allow"]
    if len(allowed_in_window) < 3:
        raise AssertionError("allowed loopback events were not recorded in the window")
    if [r["operation"] for r in records] != ["socket.getaddrinfo", "open", "socket.getaddrinfo"]:
        raise AssertionError([r["operation"] for r in records])


# ---------------------------------------------------------------- T4
@test("T4.max_32_records_exact_total_truncation_flag")
def t4() -> None:
    def many(n):
        def body():
            for i in range(n):
                _deny_lookup(f"rc-o01-bound-{i:02d}.invalid")
        return body

    for n, truncated in ((0, False), (32, False), (33, True), (40, True)):
        details, stored = _probe(f"BB-RCO01-T4-{n}", many(n))
        count_surface = len(stored.get("python_violations") or [])
        if details["python_violation_total"] != n or count_surface != n:
            raise AssertionError({"n": n, "total": details["python_violation_total"], "count": count_surface})
        if details["python_violations_truncated"] is not truncated:
            raise AssertionError({"n": n, "truncated": details["python_violations_truncated"]})
        records = details["python_violations"]
        if len(records) != min(n, PYTHON_VIOLATION_MAX_RECORDS):
            raise AssertionError({"n": n, "len": len(records)})
        hosts = [r["normalized_host"] for r in records]
        if hosts != [f"rc-o01-bound-{i:02d}.invalid" for i in range(len(records))]:
            raise AssertionError("not the first records in event order")
    if PYTHON_VIOLATION_MAX_RECORDS != 32:
        raise AssertionError(PYTHON_VIOLATION_MAX_RECORDS)


# ---------------------------------------------------------------- T5
@test("T5.projection_contains_only_privacy_allowlist")
def t5() -> None:
    def body():
        _deny_lookup("rc-o01-allow.invalid")
        pd_f06_isolation._record({
            "operation": "python.synthetic",
            "decision": "deny",
            "host": "raw-host-must-not-survive.example",
            "normalized_host": "sk-abcdefghijklmnopqrstuvwxyz.example",
            "reason": "Bearer RCO01SECRETTOKEN",
            "destination": "https://user:sb_secret_rco01@example.com/path?q=1",
            "error": "connect failed api_key=sk-rco01errorvalue0000",
            "path_class": "/Users/someone/private/dir/token.json",
            "attempt_nonce": "deadbeefdeadbeef",
            "body": "conversation text that must not survive",
            "port": "443",
            "external_contact": "yes",
        })

    details, _stored = _probe("BB-RCO01-T5", body)
    if details["python_violation_total"] != 2:
        raise AssertionError(details)
    for record in details["python_violations"]:
        _assert_allowlisted(record)
    blob = _canonical(details)
    for forbidden in ("raw-host-must-not-survive", "RCO01SECRETTOKEN", "sk-abcdefghijklmnopqrstuvwxyz",
                      "sb_secret_rco01", "sk-rco01errorvalue", "deadbeefdeadbeef", "conversation text",
                      "/Users/someone", "attempt_nonce", "\"host\"", "destination\"", "error\""):
        if forbidden in blob:
            raise AssertionError(f"forbidden content survived: {forbidden!r}")
    synthetic = details["python_violations"][1]
    if synthetic["path_class"] != "token.json" or synthetic["port"] is not None:
        raise AssertionError(synthetic)
    if synthetic["external_contact"] is not False:
        raise AssertionError("non-boolean external_contact must project to False")
    if set(details) != {"python_violations", "python_violation_total", "python_violations_truncated"}:
        raise AssertionError(sorted(details))


# ---------------------------------------------------------------- T6
@test("T6.aggregate_and_precedence_unchanged_with_detail_keys")
def t6() -> None:
    def body():
        _deny_lookup("rc-o01-neutral.invalid")
        _deny_open(os.path.join(tempfile.mkdtemp(prefix="rc-o01-neutral-"), ".env"))

    _details, stored = _probe("BB-RCO01-T6", body)
    with_keys = [dict(v) for v in stored.get("python_violations") or []]
    if not with_keys or not all("event_sequence" in v and "callsite" in v for v in with_keys):
        raise AssertionError("detail keys missing from stored violations")
    without_keys = [{k: v for k, v in item.items() if k not in ("event_sequence", "callsite")} for item in with_keys]
    common = {
        "infra_failure": False,
        "timeout_exceeded": False,
        "lifecycle_report": {},
        "provider_evidence": [],
        "retrieval_evidence": [],
        "os_f04": {},
        "node_events": [],
        "timeout_evidence": [],
        "generic_infra_failure": [],
    }
    def decision_only(result: dict) -> dict:
        # aggregate["preserved"] is a scrubbed echo of the INPUT lists; no
        # decision reads it. Everything else is decision output.
        out = json.loads(_canonical(result))
        agg = out.get("aggregate", out)
        echo = agg.pop("preserved", None)
        return {"decision": out, "echo_keys": sorted(echo or {})}

    def strip_detail(echo_list):
        return [{k: v for k, v in item.items() if k not in ("event_sequence", "callsite")} for item in echo_list]

    a = apply_infrastructure_precedence(python_violations=with_keys, **common)
    b = apply_infrastructure_precedence(python_violations=without_keys, **common)
    if _canonical(decision_only(a)) != _canonical(decision_only(b)):
        raise AssertionError({"with": decision_only(a), "without": decision_only(b)})
    if _canonical(strip_detail(a["aggregate"]["preserved"]["python_violations"])) != _canonical(
            b["aggregate"]["preserved"]["python_violations"]):
        raise AssertionError("echo differs beyond the diagnostic keys")
    parts = {"python_violations": with_keys}
    parts_b = {"python_violations": without_keys}
    if _canonical(decision_only(aggregate_attempt_evidence(parts))) != _canonical(
            decision_only(aggregate_attempt_evidence(parts_b))):
        raise AssertionError("aggregate changed")
    if a["infra_failure"] is not True:
        raise AssertionError(a)
    stops = [f.get("stop_class") for f in a["aggregate"].get("findings") or []]
    if stops.count("PYTHON_ISOLATION_VIOLATION") != 1:
        raise AssertionError(stops)
    empty = apply_infrastructure_precedence(python_violations=[], **common)
    if empty["infra_failure"] is not False:
        raise AssertionError(empty)


# ---------------------------------------------------------------- T7
@test("T7.attempt_cursor_isolation")
def t7() -> None:
    def body_a():
        _deny_lookup("rc-o01-attempt-a1.invalid")
        _deny_lookup("rc-o01-attempt-a2.invalid")

    def body_b():
        _deny_lookup("rc-o01-attempt-b1.invalid")

    details_a, _ = _probe("BB-RCO01-T7-A", body_a)
    # An event between attempts belongs to no attempt.
    try:
        socket.getaddrinfo("rc-o01-between.invalid", 443)
    except PermissionError:
        pass
    details_b, stored_b = _probe("BB-RCO01-T7-B", body_b)
    hosts_a = [r["normalized_host"] for r in details_a["python_violations"]]
    hosts_b = [r["normalized_host"] for r in details_b["python_violations"]]
    if hosts_a != ["rc-o01-attempt-a1.invalid", "rc-o01-attempt-a2.invalid"]:
        raise AssertionError(hosts_a)
    if hosts_b != ["rc-o01-attempt-b1.invalid"]:
        raise AssertionError(hosts_b)
    if details_b["python_violations"][0]["event_sequence"] != _window_deny_offsets(stored_b)[0]:
        raise AssertionError("sequence is not attempt-local")
    unknown = python_violation_details("BB-RCO01-NEVER-OPENED", 1)
    if unknown != {"python_violations": [], "python_violation_total": 0, "python_violations_truncated": False}:
        raise AssertionError(unknown)


# ---------------------------------------------------------------- P1-P5
@test("P1.callsite_capture_performs_no_external_io")
def p1() -> None:
    seen: list[str] = []
    state = {"on": False}
    forbidden = ("open", "socket.", "os.", "subprocess.", "urllib.", "http.", "shutil.", "glob.", "import", "ctypes.")

    def hook(event, _args):
        if state["on"]:
            seen.append(event)

    sys.addaudithook(hook)
    state["on"] = True
    try:
        for _ in range(25):
            pd_f06_isolation._callsite()
        pd_f06_isolation._frame_class(__file__)
    finally:
        state["on"] = False
    bad = sorted({e for e in seen if e.startswith(forbidden)})
    if bad:
        raise AssertionError(bad)


@test("P2.callsite_never_throws_on_unusual_stack_metadata")
def p2() -> None:
    namespace = {"__name__": 12345, "__builtins__": builtins, "probe": pd_f06_isolation._callsite}
    exec(compile("site = probe()", "<rc-o01-unusual>", "exec"), namespace)  # noqa: S102 — local probe frame
    site = namespace["site"]
    if site["frame_class"] != "OTHER" or site["module"] is not None:
        raise AssertionError(site)
    for value in (None, 123, "", "relative/path.py", "<string>"):
        if pd_f06_isolation._frame_class(value) != "OTHER":
            raise AssertionError(value)

    class _BrokenSys:
        def _getframe(self, *_a):
            raise RuntimeError("no frames")

    original = pd_f06_isolation.sys
    pd_f06_isolation.sys = _BrokenSys()
    try:
        broken = pd_f06_isolation._callsite()
    finally:
        pd_f06_isolation.sys = original
    if broken != {"frame_class": "OTHER", "module": None, "function": None, "lineno": None}:
        raise AssertionError(broken)


@test("P3.missing_optional_fields_remain_safe")
def p3() -> None:
    for raw in ({}, {"violation": True}, {"operation": None, "callsite": "not-a-dict"}, "not-a-dict", None):
        projected = attempt_binding._project_violation(raw)
        _assert_allowlisted(projected)
        if projected["callsite"]["frame_class"] != "OTHER":
            raise AssertionError(projected)


@test("P4.caller_mutation_cannot_change_stored_evidence")
def p4() -> None:
    def body():
        _deny_lookup("rc-o01-mutation.invalid")

    first, stored = _probe("BB-RCO01-P4", body)
    stored_before = _canonical(stored.get("python_violations"))
    first["python_violations"][0]["operation"] = "MUTATED"
    first["python_violations"][0]["callsite"]["module"] = "MUTATED"
    first["python_violations"].append({"injected": True})
    first["python_violation_total"] = 999
    second = python_violation_details("BB-RCO01-P4", 1)
    if second["python_violations"][0]["operation"] != "socket.getaddrinfo" or second["python_violation_total"] != 1:
        raise AssertionError(second)
    if _canonical((collected_evidence("BB-RCO01-P4", 1) or {}).get("python_violations")) != stored_before:
        raise AssertionError("stored evidence mutated through the projection")


@test("P5.repeated_accessor_calls_are_deterministic")
def p5() -> None:
    def body():
        _deny_lookup("rc-o01-determinism-1.invalid")
        _deny_open(os.path.join(tempfile.mkdtemp(prefix="rc-o01-det-"), ".env.local"))

    first, _ = _probe("BB-RCO01-P5", body)
    runs = {_canonical(python_violation_details("BB-RCO01-P5", 1)) for _ in range(5)}
    if runs != {_canonical(first)}:
        raise AssertionError("accessor output not deterministic")


# ------------------------------------------------- P6-P12 (CORR1)
# CORR1 PRIVACY-VALUE-BOUNDARY-1: a key allowlist is not a value privacy
# guarantee. Every serialized string must independently satisfy a bounded
# safe grammar or degrade to null. All adversarial values below are synthetic
# fixtures, never actual secrets; every network attempt is denied by the
# guard before DNS.
_ADVERSARIAL_VALUES = (
    "/Users/iv1-synthetic/private/module.py",
    "https://iv1-user:plainpassword@api.telegram.org/private?payload=synthetic_payload_iv1",
    "user:password@host.example",
    "?payload=conversation+text+secret",
    "Bearer RCO01SECRETTOKEN sk-rco01abcdefghijklmnopqrstuvwxyz",
    "line-one\nline-two\ttab",
    "A" * 5000,
    "Пользователь написал: привет, вот мой токен sb_secret_rco01value",
    "C:\\Users\\someone\\credentials\\token.json",
    "'; DROP TABLE evidence--",
    "some free conversation text with spaces",
)
_PROHIBITED_MARKERS = (
    "/Users/iv1-synthetic", "plainpassword", "iv1-user", "RCO01SECRETTOKEN",
    "sk-rco01abcdefghijklmnopqrstuvwxyz", "sb_secret_rco01value",
    "Пользователь", "DROP TABLE", "user:password", "?payload=",
)


def _project_field(field: str, value) -> dict:
    return attempt_binding._project_violation({field: value, "callsite": {}})


@test("P6.path_valued_module_becomes_null")
def p6() -> None:
    leak = "/Users/iv1-synthetic/private/module.py"
    src = "def P6_SYNTHETIC_FRAME():\n    socket.getaddrinfo('p6-path-module.invalid', 443)\nP6_SYNTHETIC_FRAME()"

    def body():
        namespace = {"__name__": leak, "socket": socket, "__builtins__": builtins}
        try:
            exec(compile(src, "<p6-path-module>", "exec"), namespace)  # noqa: S102 — synthetic frame
        except PermissionError:
            pass

    details, _ = _probe("BB-RCO01-P6", body)
    site = details["python_violations"][0]["callsite"]
    if site["module"] is not None:
        raise AssertionError(site)
    if leak in _canonical(details):
        raise AssertionError("path-valued module leaked")
    for unsafe in _ADVERSARIAL_VALUES:
        # OWNER CONTRACT SUCCESSOR (CORR2): invalid raw labels yield NO id.
        if pd_f06_isolation.opaque_module_id(unsafe) is not None:
            raise AssertionError(f"module grammar accepted unsafe value: {unsafe[:60]!r}")
        if attempt_binding._project_callsite({"module": unsafe})["module"] is not None:
            raise AssertionError(f"projection kept unsafe module: {unsafe[:60]!r}")
    safe_id = pd_f06_isolation.opaque_module_id("academy.foo.bar")
    if not pd_f06_isolation.is_opaque_module_id(safe_id) or safe_id == "academy.foo.bar":
        raise AssertionError("valid dotted module label did not become an opaque id")
    if pd_f06_isolation.opaque_module_id("__main__") == "__main__":
        raise AssertionError("__main__ serialized raw")


@test("P7.payload_valued_function_becomes_null_or_safe_code_label")
def p7() -> None:
    payload = "https://iv1-user:plainpassword@host/private?payload=synthetic_p7"
    code = compile("site = probe()", "<p7-payload-function>", "exec").replace(co_name=payload)
    namespace = {"__name__": "tests.p7_synthetic_module", "probe": pd_f06_isolation._callsite, "__builtins__": builtins}
    exec(code, namespace)  # noqa: S102 — synthetic frame with payload co_name
    site = namespace["site"]
    if site["function"] is not None or site["module"] != pd_f06_isolation.opaque_module_id("tests.p7_synthetic_module"):
        raise AssertionError(site)
    for unsafe in _ADVERSARIAL_VALUES:
        # OWNER CONTRACT SUCCESSOR (CORR2): invalid raw labels yield NO id.
        if pd_f06_isolation.opaque_function_id(unsafe) is not None:
            raise AssertionError(f"function grammar accepted unsafe value: {unsafe[:60]!r}")
        if attempt_binding._project_callsite({"function": unsafe})["function"] is not None:
            raise AssertionError(f"projection kept unsafe function: {unsafe[:60]!r}")
    # Identifier-shaped and special code labels become bounded opaque ids.
    for label in ("SYNTHETIC_CONVERSATION_PAYLOAD_IV1", "_deny_lookup", "<module>", "<lambda>", "<listcomp>"):
        ident = pd_f06_isolation.opaque_function_id(label)
        if not pd_f06_isolation.is_opaque_function_id(ident) or ident == label:
            raise AssertionError(label)


@test("P8.malformed_url_never_survives_in_normalized_host")
def p8() -> None:
    url = "https://iv1-user:plainpassword@api.telegram.org/private?payload=synthetic_payload_iv1"

    def body():
        try:
            socket.getaddrinfo(url, 443)
        except PermissionError:
            return
        raise AssertionError("malformed URL lookup was not denied")

    details, _ = _probe("BB-RCO01-P8", body)
    record = details["python_violations"][0]
    if record["normalized_host"] is not None:
        raise AssertionError(record["normalized_host"])
    if record["decision"] != "deny" or record["violation"] is not True:
        raise AssertionError(record)
    blob = _canonical(details)
    for forbidden in ("https://", "iv1-user", "plainpassword", "/private", "payload=synthetic_payload_iv1"):
        if forbidden in blob:
            raise AssertionError(f"URL structure survived: {forbidden!r}")
    for unsafe in _ADVERSARIAL_VALUES:
        if attempt_binding._safe_host_label(unsafe) is not None:
            raise AssertionError(f"host projection kept unsafe value: {unsafe[:60]!r}")
    for unsafe in ("host:8080", "host/path", "host?q=1", "host#frag", "user@host", "  ", "\x00host"):
        if attempt_binding._safe_host_label(unsafe) is not None:
            raise AssertionError(f"host projection kept unsafe value: {unsafe!r}")
    # A trailing dot is host normalization, not URL structure: it degrades to
    # the same bounded host label, exactly like the upstream normalizer.
    if attempt_binding._safe_host_label("host.example.") != "host.example":
        raise AssertionError("trailing-dot host not normalized")
    # No new sensitive fields are minted from URL parsing.
    if set(record) != RECORD_KEYS:
        raise AssertionError(sorted(record))


@test("P9.normpath_equivalent_paths_classify_identically")
def p9() -> None:
    bench_tests = BENCH / "tests"
    normal = str(bench_tests / "example_probe.py")
    variants = (
        normal,
        str(bench_tests / "." / "example_probe.py"),
        str(bench_tests / "tests_sibling" / ".." / "example_probe.py"),
        str(BENCH) + "//tests/example_probe.py",
        str(BENCH) + "/./tests/./example_probe.py",
        str(BENCH.parent / "does-not-exist" / ".." / BENCH.name / "tests" / "example_probe.py"),
    )
    classes = {pd_f06_isolation._frame_class(v) for v in variants}
    if len(classes) != 1 or classes != {"BENCHMARK_HARNESS"}:
        raise AssertionError({"classes": [pd_f06_isolation._frame_class(v) for v in variants]})
    nav = BENCH.parent.parent
    iv1_pair_normal = str(BENCH / "tests" / "example.py")
    iv1_pair_equivalent = str(nav / ".." / nav.name / "benchmarks" / "academy-telegram-live-regression-1000-1" / "tests" / "example.py")
    if os.path.normpath(iv1_pair_normal) != os.path.normpath(iv1_pair_equivalent):
        raise AssertionError("IV1 pair is not normpath-equivalent")
    if pd_f06_isolation._frame_class(iv1_pair_normal) != pd_f06_isolation._frame_class(iv1_pair_equivalent):
        raise AssertionError("IV1 F3 pair still classifies differently")
    # Canonicalization is lexical only: no audit-visible I/O.
    seen: list[str] = []
    state = {"on": False}

    def hook(event, _args):
        if state["on"]:
            seen.append(event)

    sys.addaudithook(hook)
    state["on"] = True
    try:
        for v in variants:
            pd_f06_isolation._frame_class(v)
    finally:
        state["on"] = False
    forbidden = ("open", "socket.", "os.", "subprocess.", "urllib.", "http.", "shutil.", "glob.", "import", "ctypes.")
    bad = sorted({e for e in seen if e.startswith(forbidden)})
    if bad:
        raise AssertionError(bad)
    # The comparison root itself is canonicalized the same way.
    original = os.environ.get("ACADEMY_CHATBOT_ROOT")
    try:
        os.environ["ACADEMY_CHATBOT_ROOT"] = str(BENCH) + "/./"
        env_classes = {pd_f06_isolation._frame_class(v) for v in variants}
    finally:
        if original is None:
            os.environ.pop("ACADEMY_CHATBOT_ROOT", None)
        else:
            os.environ["ACADEMY_CHATBOT_ROOT"] = original
    if env_classes != {"PRODUCT_CHATBOT"}:
        raise AssertionError(env_classes)


@test("P10.valid_module_and_function_labels_remain_useful")
def p10() -> None:
    def body():
        _deny_lookup("rc-o01-p10.invalid")

    details, _ = _probe("BB-RCO01-P10", body)
    site = details["python_violations"][0]["callsite"]
    # OWNER CONTRACT SUCCESSOR (CORR2): useful = deterministic opaque ids of
    # the same raw labels, stable across repeated accessor calls.
    expected_module = pd_f06_isolation.opaque_module_id(__name__)
    expected_function = pd_f06_isolation.opaque_function_id("_deny_lookup")
    if site["module"] != expected_module or site["function"] != expected_function or not isinstance(site["lineno"], int):
        raise AssertionError(site)
    again = python_violation_details("BB-RCO01-P10", 1)["python_violations"][0]["callsite"]
    if again != site:
        raise AssertionError("opaque ids not stable across accessor calls")
    namespace = {"__name__": "tests.block_b_probe", "probe": pd_f06_isolation._callsite, "__builtins__": builtins}
    exec(compile("site = probe()", "<p10-module-label>", "exec"), namespace)  # noqa: S102
    if namespace["site"] != {"frame_class": "OTHER", "module": pd_f06_isolation.opaque_module_id("tests.block_b_probe"),
                             "function": pd_f06_isolation.opaque_function_id("<module>"), "lineno": 1}:
        raise AssertionError(namespace["site"])
    exec(compile("f = lambda: probe()\nsite = f()", "<p10-lambda-label>", "exec"), namespace)  # noqa: S102
    if namespace["site"]["function"] != pd_f06_isolation.opaque_function_id("<lambda>"):
        raise AssertionError(namespace["site"])


@test("P11.valid_hostname_and_ip_diagnostics_remain_available")
def p11() -> None:
    def body():
        _deny_lookup("RC-O01-Mixed-Case.Example.INVALID")
        for host in ("2001:DB8::1", "[2001:db8::2]", "8.8.8.8", "api.telegram.org"):
            try:
                socket.getaddrinfo(host, 443)
            except PermissionError:
                continue
            raise AssertionError(f"lookup for {host!r} was not denied")

    details, _ = _probe("BB-RCO01-P11", body)
    hosts = [r["normalized_host"] for r in details["python_violations"]]
    if hosts != [
        "rc-o01-mixed-case.example.invalid",
        "2001:db8::1",
        "2001:db8::2",
        "8.8.8.8",
        "api.telegram.org",
    ]:
        raise AssertionError(hosts)
    if attempt_binding._safe_host_label("[2001:db8::3]") != "[2001:db8::3]":
        raise AssertionError("bracketed IPv6 literal not preserved")
    if attempt_binding._safe_host_label("127.0.0.1") != "127.0.0.1":
        raise AssertionError("IPv4 literal not preserved")


@test("P12.value_level_privacy_adversarial_corpus_cannot_leak")
def p12() -> None:
    string_fields = ("operation", "decision", "reason", "destination_class", "normalized_host", "path_class")
    serialized = []
    for field in string_fields:
        for value in _ADVERSARIAL_VALUES:
            projected = _project_field(field, value)
            _assert_allowlisted(projected)
            out = projected[field]
            serialized.append(out)
            if out is None:
                continue
            if len(out) > attempt_binding._LABEL_MAX[field]:
                raise AssertionError({field: len(out)})
            if any(ch in out for ch in "/\\:@?# \t\n") or any(ord(ch) < 0x20 for ch in out):
                raise AssertionError({field: out})
    for field in ("module", "function"):
        for value in _ADVERSARIAL_VALUES:
            site = attempt_binding._project_callsite({field: value})
            out = site[field]
            serialized.append(out)
            if out is None:
                continue
            if len(out) > (128 if field == "module" else 64):
                raise AssertionError({field: len(out)})
            # OWNER CONTRACT SUCCESSOR (CORR2): serialized callsite values are
            # opaque ids only — never raw labels.
            if not (pd_f06_isolation.is_opaque_module_id(out) or pd_f06_isolation.is_opaque_function_id(out)):
                raise AssertionError({field: out})
    blob = _canonical({"records": [_project_field(f, v) for f in string_fields for v in _ADVERSARIAL_VALUES]
                       + [attempt_binding._project_callsite({f: v}) for f in ("module", "function") for v in _ADVERSARIAL_VALUES]})
    for marker in _PROHIBITED_MARKERS:
        if marker in blob:
            raise AssertionError(f"prohibited marker survived: {marker!r}")


# ------------------------------------------------- P13-P21 (CORR2)
# CORR2 OPAQUE-CALLSITE-AND-SCOPED-IPV6-CLOSURE-1 (Owner adjudication):
# plaintext module/function metadata is not a privacy-safe surface, scoped
# IPv6 is not part of the diagnostic surface, and enum-like fields carry
# exact authoritative producer values only. All vectors are synthetic.
_OPAQUE_RE = {"module": "m:[0-9a-f]{32}", "function": "f:[0-9a-f]{32}"}


@test("P13.real_module_payload_metadata_never_plaintext")
def p13() -> None:
    payload = "I_need_help_my_password_is_plaintext42"
    module = types.ModuleType(payload)
    module.__dict__["__builtins__"] = builtins
    module.__dict__["socket"] = socket
    src = "def P13_CARRIER():\n    socket.getaddrinfo('p13-module-payload.invalid', 443)\nP13_CARRIER()"

    def body():
        try:
            exec(compile(src, "<p13-real-module>", "exec"), module.__dict__)  # noqa: S102 — real ModuleType globals
        except PermissionError:
            pass

    details, _ = _probe("BB-RCO01-P13", body)
    site = details["python_violations"][0]["callsite"]
    if not pd_f06_isolation.is_opaque_module_id(site["module"]):
        raise AssertionError(site)
    if site["module"] != pd_f06_isolation.opaque_module_id(payload):
        raise AssertionError({"site": site, "expected_id_of": payload})
    blob = _canonical(details)
    if payload in blob:
        raise AssertionError("identifier-shaped module payload appeared plaintext")


@test("P14.real_function_payload_label_never_plaintext")
def p14() -> None:
    for tag, name in (("a", "PLAINAUTHCREDENTIALSAMPLE42"), ("b", "SYNTHETIC_CONVERSATION_PAYLOAD_IV1")):
        src = f"def {name}():\n    socket.getaddrinfo('p14-fn-{tag}.invalid', 443)\n{name}()"

        def body(src=src):
            ns = {"__name__": "tests.p14_probe", "socket": socket, "__builtins__": builtins}
            try:
                exec(compile(src, f"<p14-real-function-{tag}>", "exec"), ns)  # noqa: S102 — real code object
            except PermissionError:
                pass

        details, _ = _probe(f"BB-RCO01-P14-{tag.upper()}", body)
        site = details["python_violations"][0]["callsite"]
        if not pd_f06_isolation.is_opaque_function_id(site["function"]):
            raise AssertionError(site)
        if site["function"] != pd_f06_isolation.opaque_function_id(name):
            raise AssertionError({"site": site, "expected_id_of": name})
        if name in _canonical(details):
            raise AssertionError("identifier-shaped function payload appeared plaintext")


@test("P15.opaque_id_domain_separation_and_collision_corpus")
def p15() -> None:
    raw = "SYNTHETIC_SHARED_LABEL_TEXT42"
    module_id = pd_f06_isolation.opaque_module_id(raw)
    function_id = pd_f06_isolation.opaque_function_id(raw)
    if module_id is None or function_id is None:
        raise AssertionError("valid raw label rejected")
    if module_id == function_id:
        raise AssertionError("module and function ids are not domain-separated")
    if pd_f06_isolation.opaque_module_id(raw) != module_id or pd_f06_isolation.opaque_function_id(raw) != function_id:
        raise AssertionError("opaque ids not deterministic for the same raw")
    module_corpus = ["academy.foo.bar", "__main__", "tests.block_b_probe", "a", "socket",
                     "PLAINAUTHCREDENTIALSAMPLE42", raw]
    function_corpus = ["_deny_lookup", "<module>", "<lambda>", "<listcomp>",
                       "PLAINAUTHCREDENTIALSAMPLE42", "a", raw]
    module_ids = [pd_f06_isolation.opaque_module_id(v) for v in module_corpus]
    function_ids = [pd_f06_isolation.opaque_function_id(v) for v in function_corpus]
    if None in module_ids or None in function_ids:
        raise AssertionError("a grammar-valid corpus label yielded no id")
    if len(set(module_ids)) != len(module_corpus) or len(set(function_ids)) != len(function_corpus):
        raise AssertionError("distinct raw labels collided within the corpus")
    if set(module_ids) & set(function_ids):
        raise AssertionError("module and function id spaces overlap in the corpus")


@test("P16.opaque_ids_stable_across_calls_and_fresh_processes")
def p16() -> None:
    corpus = ["academy.foo.bar", "__main__", "tests.block_b_probe",
              "_deny_lookup", "<module>", "<lambda>", "PLAINAUTHCREDENTIALSAMPLE42"]
    expected = {v: (pd_f06_isolation.opaque_module_id(v), pd_f06_isolation.opaque_function_id(v)) for v in corpus}
    if any(pd_f06_isolation.opaque_module_id(v) != m or pd_f06_isolation.opaque_function_id(v) != f
           for v, (m, f) in expected.items()):
        raise AssertionError("ids not stable across repeated in-process calls")
    script = (
        "import sys, json\n"
        f"sys.path.insert(0, {str(BENCH)!r})\n"
        "sys.dont_write_bytecode = True\n"
        "from execution_infrastructure import pd_f06_isolation as g\n"
        f"print(json.dumps({{v: [g.opaque_module_id(v), g.opaque_function_id(v)] for v in {corpus!r}}}))\n"
    )
    results = []
    for _ in range(2):
        proc = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=120, cwd=str(W_ROOT))
        if proc.returncode != 0:
            raise AssertionError(proc.stderr[-500:])
        results.append(json.loads(proc.stdout.strip().splitlines()[-1]))
    if results[0] != results[1]:
        raise AssertionError("ids differ between fresh processes")
    for v, (m, f) in expected.items():
        if results[0][v] != [m, f]:
            raise AssertionError({"value": v, "in_process": [m, f], "fresh_process": results[0][v]})


@test("P17.injected_raw_labels_not_rehashed_by_projection")
def p17() -> None:
    raw_module = "INJECTED_RAW_MODULE_LEAK42"
    raw_function = "/Users/leak/injected.py"
    projected = attempt_binding._project_callsite({"frame_class": "OTHER", "module": raw_module, "function": raw_function, "lineno": 1})
    if projected["module"] is not None or projected["function"] is not None:
        raise AssertionError(projected)
    if projected["module"] == pd_f06_isolation.opaque_module_id(raw_module):
        raise AssertionError("projection re-hashed an injected raw label")

    def body():
        attempt_binding.publish_python_violation({
            "operation": "open", "decision": "deny", "violation": True,
            "callsite": {"frame_class": "OTHER", "module": raw_module, "function": raw_function, "lineno": 1},
        })

    details, _ = _probe("BB-RCO01-P17", body)
    records = [r for r in details["python_violations"] if r["operation"] == "open"]
    if not records:
        raise AssertionError("published record not retained in store projection")
    site = records[0]["callsite"]
    if site["module"] is not None or site["function"] is not None:
        raise AssertionError(site)
    blob = _canonical(details)
    for marker in (raw_module, raw_function, "/Users/leak"):
        if marker in blob:
            raise AssertionError(f"injected raw label survived: {marker!r}")


@test("P18.all_scoped_ipv6_variants_become_null")
def p18() -> None:
    vectors = (
        "fe80::1%eth0",
        "fe80::1%25",
        "fe80::1%user:plainpassword@host?payload=iv1#fragment",
        "[fe80::1%user:plainpassword@host?payload=iv1#fragment]",
        "fe80::1%\\Users\\someone\\private",
    )
    for value in vectors:
        if attempt_binding._safe_host_label(value) is not None:
            raise AssertionError(f"scoped IPv6 survived projection: {value!r}")

    def body():
        for host in ("fe80::1%eth0", "fe80::1%user:plainpassword@host?payload=iv1#fragment"):
            try:
                socket.getaddrinfo(host, 443)
            except PermissionError:
                continue
            raise AssertionError(f"lookup for {host!r} was not denied")

    details, _ = _probe("BB-RCO01-P18", body)
    blob = _canonical(details)
    for record in details["python_violations"]:
        if record["normalized_host"] is not None:
            raise AssertionError(record["normalized_host"])
    for marker in ("fe80", "%eth0", "plainpassword", "payload=iv1", "users\\someone"):
        if marker in blob:
            raise AssertionError(f"scoped IPv6 content survived: {marker!r}")


@test("P19.plain_unscoped_ip_and_hostname_diagnostics_remain_useful")
def p19() -> None:
    table = {
        "::1": "::1",
        "2001:db8::1": "2001:db8::1",
        "[2001:db8::1]": "[2001:db8::1]",
        "127.0.0.1": "127.0.0.1",
        "8.8.8.8": "8.8.8.8",
        "api.telegram.org": "api.telegram.org",
        "RC-O19-Mixed.Example.INVALID": "rc-o19-mixed.example.invalid",
    }
    for value, expected in table.items():
        if attempt_binding._safe_host_label(value) != expected:
            raise AssertionError({value: attempt_binding._safe_host_label(value)})

    def body():
        for host in ("2001:db8::1", "8.8.8.8", "api.telegram.org"):
            try:
                socket.getaddrinfo(host, 443)
            except PermissionError:
                continue
            raise AssertionError(f"lookup for {host!r} was not denied")

    details, _ = _probe("BB-RCO01-P19", body)
    hosts = [r["normalized_host"] for r in details["python_violations"]]
    if hosts != ["2001:db8::1", "8.8.8.8", "api.telegram.org"]:
        raise AssertionError(hosts)


@test("P20.enum_fields_accept_exactly_authoritative_producer_values")
def p20() -> None:
    allowlists = {
        "operation": attempt_binding.OPERATION_VALUES,
        "decision": attempt_binding.DECISION_VALUES,
        "reason": attempt_binding.REASON_VALUES,
        "destination_class": attempt_binding.DESTINATION_CLASS_VALUES,
    }
    for field, allowed in allowlists.items():
        for value in allowed:
            if _project_field(field, value)[field] != value:
                raise AssertionError({field: value})
        if "" in allowed or None in allowed:
            raise AssertionError(field)
    rejected = {
        "operation": ("python.synthetic", "TOTALLY_NEW_OPERATION", "socket.newcall", "open "), 
        "decision": ("maybe", "Allow", "DENY", "deny "),
        "reason": ("SOMETHING_ELSE", "LOOPBACK_EXTRA", "default_deny"),
        "destination_class": ("ALL_OTHER_HOST", "api.cohere.com.evil.tld", "x.gstatic.com",
                              "user:pass@evil.gstatic.com", "TELEGRAM_EXTRA"),
    }
    for field, values in rejected.items():
        for value in values:
            out = _project_field(field, value)[field]
            if out is not None:
                raise AssertionError({field: value, "out": out})


@test("P21.full_serialized_string_matrix_no_plaintext_channel")
def p21() -> None:
    string_fields = ("operation", "decision", "reason", "destination_class", "normalized_host", "path_class")
    vectors = list(_ADVERSARIAL_VALUES) + [
        "fe80::1%eth0",
        "fe80::1%user:plainpassword@host?payload=iv1#fragment",
        "fe80::1%\\Users\\someone\\private",
        "user:pass@evil.gstatic.com",
        "x.gstatic.com",
        "I_need_help_my_password_is_plaintext42",
        "PLAINAUTHCREDENTIALSAMPLE42",
    ]
    records = []
    for field in string_fields:
        for value in vectors:
            projected = _project_field(field, value)
            _assert_allowlisted(projected)
            out = projected[field]
            if out is not None:
                if field in ("operation", "decision", "reason", "destination_class"):
                    if out not in getattr(attempt_binding, {
                        "operation": "OPERATION_VALUES", "decision": "DECISION_VALUES",
                        "reason": "REASON_VALUES", "destination_class": "DESTINATION_CLASS_VALUES"}[field]):
                        raise AssertionError({field: out})
                elif len(out) > attempt_binding._LABEL_MAX[field]:
                    raise AssertionError({field: len(out)})
                if any(ch in out for ch in "/\\:@%?# \t\n") or any(ord(c) < 0x20 for c in out):
                    raise AssertionError({field: out})
            records.append(projected)
    for field in ("module", "function"):
        for value in vectors:
            site = attempt_binding._project_callsite({field: value})
            out = site[field]
            if out is None:
                records.append(site)
                continue
            if not (pd_f06_isolation.is_opaque_module_id(out) or pd_f06_isolation.is_opaque_function_id(out)):
                raise AssertionError({field: out})
            value_is_opaque = pd_f06_isolation.is_opaque_module_id(value) or pd_f06_isolation.is_opaque_function_id(value)
            if not value_is_opaque:
                # A raw value must pass through as null, never as its own id.
                if field == "module" and out == pd_f06_isolation.opaque_module_id(value):
                    raise AssertionError({field: "raw value was re-hashed into an id"})
                if field == "function" and out == pd_f06_isolation.opaque_function_id(value):
                    raise AssertionError({field: "raw value was re-hashed into an id"})
            records.append(site)
    blob = _canonical({"records": records})
    # Structural markers only. Identifier-shaped alphanumeric tokens are NOT
    # blanket-banned: a syntactically valid hostname label (Owner-adjudicated
    # acceptable, authorization section 12) and a basename-only path_class
    # token (section 14, retained contract) may legitimately carry them. The
    # field-level checks above already keep such tokens out of callsite IDs
    # and the exact enum allowlists.
    for marker in _PROHIBITED_MARKERS + ("fe80", "%eth0", "evil.gstatic"):
        if marker in blob:
            raise AssertionError(f"prohibited marker survived: {marker!r}")


def main() -> int:
    for fn in TESTS:
        fn()
    passed = sum(1 for _name, ok, _detail in RESULTS if ok)
    mandatory = [r for r in RESULTS if r[0].startswith("T")]
    summary = {
        "suite": "block_b_rc_o01_python_violation_detail",
        "tests_total": len(RESULTS),
        "tests_pass": passed,
        "mandatory_total": len(mandatory),
        "mandatory_pass": sum(1 for r in mandatory if r[1]),
        "results": [{"name": n, "ok": ok, "detail": d} for n, ok, d in RESULTS],
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0 if passed == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
