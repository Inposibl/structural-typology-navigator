"""Focused local self-tests for execution-infrastructure IMPLEMENTATION-1.

No benchmark scenario is executed. No real provider is contacted.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

BENCH = Path(__file__).resolve().parent.parent
NAVIGATOR = BENCH.parent.parent
sys.path.insert(0, str(BENCH))

# CORR6 MINOR-3: private temp root, own process group, and a child reaper.
from execution_infrastructure.process_hygiene import install_suite_hygiene  # noqa: E402

install_suite_hygiene("implementation-1")

from execution_infrastructure.constants import (  # noqa: E402
    CANONICAL_BENCHMARK_STATUSES,
    CHATBOT_TEST_BASE,
    COVERAGE_PATH,
    CONTROLLING_COVERAGE_PATH,
    LOGGING_STOP_CLASS,
    PRELOAD_PATH,
    ROUTABLE_COURSE_IDS,
    SUPABASE_SECRET_PLACEHOLDER,
)
from execution_infrastructure.controlled_next_mode import evaluate_commands  # noqa: E402
from execution_infrastructure.execution_gate import (  # noqa: E402
    ScenarioExecutionForbidden,
    execute_controlled,
)
from execution_infrastructure.os_f04_streams import ProcessLifetimeStreams  # noqa: E402
from execution_infrastructure.pd_f04_provider_evidence import (  # noqa: E402
    adjudicate,
    build_native_evidence,
    canonical_json,
    classify_raw_outcome,
    split_deepseek_from_observing_proxy,
    split_deepseek_from_product_log,
)
from execution_infrastructure.pd_f05_fixtures import (  # noqa: E402
    build_query_vector,
    fixture_is_servable,
    fixture_key,
    load_coverage,
    load_frozen_document,
)
from execution_infrastructure.pd_f05_loopback import (  # noqa: E402
    LoopbackSupabaseDouble,
    assert_loopback_supabase_url,
    serve_retrieval,
)
from execution_infrastructure.pd_f06_isolation import (  # noqa: E402
    classify_host,
    clear_events,
    credential_candidates,
    deny_connect,
    disposable_environment,
    events,
    install_network_guard,
    is_credential_path,
    uninstall_network_guard,
)
from execution_infrastructure.pd_f06_lifecycle import AttemptBoundary  # noqa: E402
from execution_infrastructure.snapshot_rule import (  # noqa: E402
    disclose_sanctioned_symlink,
    snapshot_document,
    snapshot_sha256,
)
from execution_infrastructure import PARALLEL_SCENARIO_EXECUTION  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
TESTS: list = []


def test(name: str):
    def deco(fn):
        def wrapper():
            try:
                fn()
                RESULTS.append((name, True, ""))
            except Exception as exc:  # noqa: BLE001 — the battery reports every failure
                RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        wrapper.__name__ = name
        TESTS.append(wrapper)
        return wrapper
    return deco


def _evidence(raw: str, **kwargs):
    return build_native_evidence(
        provider_class=kwargs.pop("provider_class", "DEEPSEEK"),
        destination_class=kwargs.pop("destination_class", "chat.completions"),
        raw_infrastructure_outcome=raw,
        model_identifier=kwargs.pop("model_identifier", "deepseek-flash"),
        benchmark_scenario_id="A-0005",
        benchmark_attempt_number=1,
        chat_request_ordinal=1,
        benchmark_repeat_index=1,
        native_provider_retry_index=1,
        native_provider_retry_count=0,
        **kwargs,
    )


def _assert_not_product(adjudication: dict) -> None:
    status = adjudication["canonical_benchmark_status"]
    if status in {"PASS", "FAIL"}:
        raise AssertionError(status)
    if adjudication["infra_evidence_dominates"] is not True:
        raise AssertionError("dominance did not hold")
    if adjudication["product_claim_allowed"] is not False:
        raise AssertionError("product claim was allowed")


FALLBACK = {
    "semantic_status": "PASS",
    "visible_text": "synthetic success fallback",
    "synthetic_success": True,
}


@test("PD-F04.timeout_cannot_become_product_pass_or_fail")
def _():
    native = _evidence(
        "PROVIDER_TIMEOUT",
        timeout_class="CALLER_BUDGET",
        http_status=None,
    )
    adjudication = adjudicate(native, FALLBACK)
    _assert_not_product(adjudication)
    if adjudication["canonical_benchmark_status"] != "TIMEOUT":
        raise AssertionError(adjudication["canonical_benchmark_status"])


@test("PD-F04.http_429_cannot_become_product_pass_or_fail")
def _():
    raw = classify_raw_outcome(http_status=429)
    if raw != "PROVIDER_HTTP_429":
        raise AssertionError(raw)
    adjudication = adjudicate(_evidence(raw, http_status=429), FALLBACK)
    _assert_not_product(adjudication)
    if adjudication["canonical_benchmark_status"] != "INFRA_FAILURE":
        raise AssertionError(adjudication["canonical_benchmark_status"])


@test("PD-F04.http_500_cannot_become_product_pass_or_fail")
def _():
    raw = classify_raw_outcome(http_status=500)
    if raw != "PROVIDER_HTTP_5XX":
        raise AssertionError(raw)
    adjudication = adjudicate(_evidence(raw, http_status=500), dict(FALLBACK, semantic_status="FAIL"))
    _assert_not_product(adjudication)


@test("PD-F04.malformed_body_cannot_become_ordinary_success")
def _():
    raw = classify_raw_outcome(http_status=200, malformed_response=True)
    if raw != "PROVIDER_MALFORMED_RESPONSE":
        raise AssertionError(raw)
    adjudication = adjudicate(
        _evidence(raw, http_status=200, malformed_response=True),
        FALLBACK,
    )
    _assert_not_product(adjudication)


@test("PD-F04.native_evidence_survives_projection")
def _():
    native = _evidence("PROVIDER_HTTP_429", http_status=429, provider_request_id="req-synthetic")
    before = native["raw_infrastructure_outcome"]
    adjudication = adjudicate(native, FALLBACK)
    evidence = adjudication["evidence"]
    if evidence["raw_infrastructure_outcome"] != before:
        raise AssertionError("projection erased the raw outcome")
    if evidence["result_projection_stage"] != "AFTER_PRODUCT_PROJECTION":
        raise AssertionError(evidence["result_projection_stage"])
    if evidence["provider_request_id"] != "req-synthetic":
        raise AssertionError("provider request id dropped")
    if evidence["benchmark_scenario_id"] != "A-0005":
        raise AssertionError("scenario id dropped")
    if native["result_projection_stage"] != "NATIVE_BEFORE_PROJECTION":
        raise AssertionError("builder did not mark the pre-projection stage")


@test("PD-F04.secrets_are_not_persisted")
def _():
    record = _evidence(
        "PRODUCT_RESPONSE_OBSERVED",
        http_status=200,
        headers={
            "Authorization": "Bearer benchmark-placeholder-not-a-secret",
            "apikey": SUPABASE_SECRET_PLACEHOLDER,
        },
        body=b'{"ok":true}',
    )
    encoded = canonical_json(record)
    if "benchmark-placeholder-not-a-secret" in encoded or "sb_secret_" in encoded:
        raise AssertionError("credential material was stored")
    if "Authorization" in encoded or "apikey" in encoded:
        raise AssertionError("credential header name was stored")
    if record["body_sha256"] is None or record["body_structural_descriptor"] != "json":
        raise AssertionError("body fingerprint missing")


@test("PD-F04.operator_retry_stays_false_without_authorization")
def _():
    record = _evidence("PRODUCT_RESPONSE_OBSERVED", http_status=200, operator_retry=True)
    if record["operator_retry"] is not False:
        raise AssertionError("operator retry was implied")


@test("PD-F04.absence_of_infra_error_is_not_a_product_pass")
def _():
    missing = adjudicate(None, FALLBACK)
    if missing["canonical_benchmark_status"] != "NOT_OBSERVABLE":
        raise AssertionError(missing["canonical_benchmark_status"])
    if missing["product_claim_allowed"] is not False:
        raise AssertionError("pass was inferred without an observation")
    observed = adjudicate(
        _evidence("PRODUCT_RESPONSE_OBSERVED", http_status=200),
        {"semantic_status": "FAIL", "visible_text": "real product answer"},
    )
    if observed["canonical_benchmark_status"] != "FAIL":
        raise AssertionError(observed["canonical_benchmark_status"])


@test("PD-F04.proxy_splits_timeout_from_connection_and_product_log_does_not")
def _():
    collapsed = split_deepseek_from_product_log("ABORTED")
    if collapsed["split"] is not False or collapsed["raw_infrastructure_outcome"] is not None:
        raise AssertionError(collapsed)
    timeout = split_deepseek_from_observing_proxy("timeout")
    connection = split_deepseek_from_observing_proxy("connection_failure")
    if timeout["raw_infrastructure_outcome"] != "PROVIDER_TIMEOUT":
        raise AssertionError(timeout)
    if connection["raw_infrastructure_outcome"] != "PROVIDER_CONNECTION_FAILURE":
        raise AssertionError(connection)


@test("PD-F04.canonical_vocabulary_is_unchanged")
def _():
    expected = {
        "PASS", "FAIL", "HOLD", "TIMEOUT", "NONDETERMINISTIC", "INFRA_FAILURE",
        "SKIPPED_UNSAFE", "BENCHMARK_DEFECT", "NOT_EXECUTED", "NOT_OBSERVABLE",
    }
    if set(CANONICAL_BENCHMARK_STATUSES) != expected:
        raise AssertionError(sorted(CANONICAL_BENCHMARK_STATUSES))
    if "PROVIDER_HTTP_429" in CANONICAL_BENCHMARK_STATUSES:
        raise AssertionError("raw subtype was promoted to a canonical status")
    if classify_raw_outcome(http_status=401) != "PROVIDER_AUTH_FAILURE":
        raise AssertionError("auth status was not classified")
    if classify_raw_outcome(retrieval_infra=True, http_status=200) != "RETRIEVAL_INFRA_FAILURE":
        raise AssertionError("retrieval infra was not classified")


def _http_json(url: str, method: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "apikey": SUPABASE_SECRET_PLACEHOLDER,
            "content-type": "application/json",
            "accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


@test("PD-F05.loopback_is_local_and_rejects_userinfo")
def _():
    try:
        assert_loopback_supabase_url("http://user:pw@127.0.0.1:9")
    except Exception:
        pass
    else:
        raise AssertionError("userinfo was accepted")
    server = LoopbackSupabaseDouble()
    try:
        url = server.start()
        if not url.startswith("http://127.0.0.1:"):
            raise AssertionError(url)
        if "@" in url or "?" in url or "#" in url:
            raise AssertionError(url)
        if server.secret_placeholder != SUPABASE_SECRET_PLACEHOLDER:
            raise AssertionError("placeholder changed")
    finally:
        server.stop()


@test("PD-F05.five_routable_fixtures_cover_retrieval_matrix")
def _():
    coverage = load_coverage()
    document = load_frozen_document()
    if list(ROUTABLE_COURSE_IDS) != [
        "levels-of-consciousness", "maslow", "play-and-creativity",
        "normative-situation", "structural-typology",
    ]:
        raise AssertionError("routable set drifted")
    required = []
    for row in coverage["rows"]:
        if row["fixture_handling"] == "NOT_IN_NAVIGATOR_RETRIEVAL_PATH":
            continue
        required.append(row)
        for course_id in ROUTABLE_COURSE_IDS:
            key = fixture_key(row["scenario_id"], 1, row["request_ordinal"], course_id)
            if not fixture_is_servable(document["fixtures"].get(key)):
                raise AssertionError(f"missing fixture {key}")
    ids = {(row["scenario_id"], row["request_ordinal"]) for row in required}
    for needle in (("A-0005", 1), ("A-0007", 1), ("A-0007", 2), ("A-0007", 3), ("D-0003", 1), ("D-0004", 1)):
        if needle not in ids:
            raise AssertionError(needle)
    coverage_hash = hashlib.sha256(COVERAGE_PATH.read_bytes()).hexdigest()
    controlling_hash = hashlib.sha256(CONTROLLING_COVERAGE_PATH.read_bytes()).hexdigest()
    if coverage_hash != controlling_hash:
        raise AssertionError("coverage matrix does not match the CORR2 preflight")


@test("PD-F05.wrong_routable_course_stays_product_behavior")
def _():
    server = LoopbackSupabaseDouble()
    try:
        url = server.start()
        server.arm("A-0007", 1, 1)
        status, payload = _http_json(
            url + "/rest/v1/academy_course_sources?course_id=eq.maslow&is_active=eq.true",
            "GET",
        )
        if status != 200 or not payload:
            raise AssertionError((status, payload))
        if payload[0]["course_id"] != "maslow":
            raise AssertionError(payload)
        evidence = server.evidence[-1]
        if evidence["classification"] == "RETRIEVAL_INFRA_FAILURE":
            raise AssertionError("wrong routable course was masked as infra")
        if evidence["unexpected_retrieval"] is not False:
            raise AssertionError("reachable request was marked unexpected")
    finally:
        server.stop()


@test("PD-F05.outside_routable_course_is_empty_product_behavior")
def _():
    document = load_frozen_document()
    coverage = load_coverage()
    armed = {"scenario_id": "A-0007", "attempt_number": 1, "chat_request_ordinal": 1}
    for course_id in ("not-a-course", "professional-development-stages"):
        status, payload, evidence = serve_retrieval(
            document=document,
            coverage=coverage,
            armed=armed,
            method="GET",
            path="/rest/v1/academy_course_sources",
            query=f"course_id=eq.{course_id}",
            body=None,
        )
        if status != 200 or payload != []:
            raise AssertionError((course_id, status, payload))
        if evidence["course_id_outside_routable_set"] is not True:
            raise AssertionError(course_id)
        if evidence["classification"] == "RETRIEVAL_INFRA_FAILURE":
            raise AssertionError(course_id)


@test("PD-F05.unknown_harness_request_is_retrieval_infra")
def _():
    document = load_frozen_document()
    coverage = load_coverage()
    status, payload, evidence = serve_retrieval(
        document=document,
        coverage=coverage,
        armed={"scenario_id": "Z-9999", "attempt_number": 1, "chat_request_ordinal": 1},
        method="GET",
        path="/rest/v1/academy_course_sources",
        query="course_id=eq.maslow",
        body=None,
    )
    if status != 503 or evidence["classification"] != "RETRIEVAL_INFRA_FAILURE":
        raise AssertionError((status, payload, evidence))


@test("PD-F05.match_count_and_threshold_are_exact")
def _():
    document = load_frozen_document()
    coverage = load_coverage()
    armed = {"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 1}
    bad_count, _payload, count_evidence = serve_retrieval(
        document=document, coverage=coverage, armed=armed, method="POST",
        path="/rest/v1/rpc/match_course_knowledge_chunks", query="",
        body=json.dumps({
            "p_course_id": "maslow", "p_query_embedding": [0],
            "p_match_count": 11, "p_match_threshold": -1,
        }).encode("utf-8"),
    )
    bad_threshold, _payload, threshold_evidence = serve_retrieval(
        document=document, coverage=coverage, armed=armed, method="POST",
        path="/rest/v1/rpc/match_course_knowledge_chunks", query="",
        body=json.dumps({
            "p_course_id": "structural-typology", "p_query_embedding": [0],
            "p_match_count": 12, "p_match_threshold": 0,
        }).encode("utf-8"),
    )
    good, payload, good_evidence = serve_retrieval(
        document=document, coverage=coverage, armed=armed, method="POST",
        path="/rest/v1/rpc/match_course_knowledge_chunks", query="",
        body=json.dumps({
            "p_course_id": "levels-of-consciousness",
            "p_query_embedding": build_query_vector(
                fixture_key("A-0005", 1, 1, "levels-of-consciousness")
            ),
            "p_match_count": 12, "p_match_threshold": -1,
        }).encode("utf-8"),
    )
    if bad_count != 503 or count_evidence["reason"] != "p_match_count_must_equal_12":
        raise AssertionError(count_evidence)
    if bad_threshold != 503 or threshold_evidence["reason"] != "p_match_threshold_must_equal_-1":
        raise AssertionError(threshold_evidence)
    if good != 200 or not payload or good_evidence["served_match_count"] < 1:
        raise AssertionError(good_evidence)


@test("PD-F05.payment_gate_retrieval_is_unexpected_not_infra")
def _():
    document = load_frozen_document()
    coverage = load_coverage()
    status, payload, evidence = serve_retrieval(
        document=document, coverage=coverage,
        armed={"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 2},
        method="GET", path="/rest/v1/academy_course_sources",
        query="course_id=eq.maslow", body=None,
    )
    if status != 200 or not payload:
        raise AssertionError((status, payload))
    if evidence["unexpected_retrieval"] is not True:
        raise AssertionError(evidence)
    if evidence["classification"] == "RETRIEVAL_INFRA_FAILURE":
        raise AssertionError(evidence)
    d0005, d_payload, d_evidence = serve_retrieval(
        document=document, coverage=coverage,
        armed={"scenario_id": "D-0005", "attempt_number": 1, "chat_request_ordinal": 1},
        method="GET", path="/rest/v1/academy_course_sources",
        query="course_id=eq.play-and-creativity", body=None,
    )
    if d0005 != 200 or not d_payload or d_evidence["unexpected_retrieval"] is not True:
        raise AssertionError(d_evidence)


@test("PD-F05.missing_or_corrupt_fixture_is_infra")
def _():
    document = json.loads(json.dumps(load_frozen_document()))
    coverage = load_coverage()
    key = fixture_key("A-0005", 1, 1, "maslow")
    document["fixtures"].pop(key)
    status, _payload, evidence = serve_retrieval(
        document=document, coverage=coverage,
        armed={"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 1},
        method="GET", path="/rest/v1/academy_course_sources",
        query="course_id=eq.maslow", body=None,
    )
    if status != 503 or evidence["reason"] != "missing_or_corrupt_fixture":
        raise AssertionError(evidence)
    corrupt = json.loads(json.dumps(load_frozen_document()))
    corrupt["fixtures"][key]["bindings"] = []
    status, _payload, evidence = serve_retrieval(
        document=corrupt, coverage=coverage,
        armed={"scenario_id": "A-0005", "attempt_number": 1, "chat_request_ordinal": 1},
        method="GET", path="/rest/v1/academy_course_sources",
        query="course_id=eq.maslow", body=None,
    )
    if status != 503 or evidence["reason"] != "missing_or_corrupt_fixture":
        raise AssertionError(evidence)


@test("PD-F05.loopback_evidence_omits_the_secret_placeholder")
def _():
    server = LoopbackSupabaseDouble()
    try:
        url = server.start()
        server.arm("D-0003", 1, 1)
        status, _payload = _http_json(
            url + "/rest/v1/rpc/match_course_knowledge_chunks",
            "POST",
            {
                "p_course_id": "normative-situation",
                "p_query_embedding": build_query_vector(
                    fixture_key("D-0003", 1, 1, "normative-situation")
                ),
                "p_match_count": 12,
                "p_match_threshold": -1,
            },
        )
        if status != 200:
            raise AssertionError(status)
        encoded = json.dumps(server.evidence)
        if SUPABASE_SECRET_PLACEHOLDER in encoded or "apikey" in encoded:
            raise AssertionError("secret material entered loopback evidence")
        if server.evidence[-1]["served_match_count"] < 1:
            raise AssertionError(server.evidence[-1])
    finally:
        server.stop()


@test("PD-F06.real_credential_paths_are_not_discovered")
def _():
    sentinel = "SYNTHETIC-SENTINEL-NOT-A-CREDENTIAL"
    with tempfile.TemporaryDirectory(prefix="academy-iso-") as tmp:
        root = Path(tmp)
        operator = root / "operator"
        nested = operator / "nested" / "cwd"
        nested.mkdir(parents=True)
        (operator / ".env").write_text(sentinel + "\n", encoding="utf-8")
        (operator / "credentials").mkdir()
        (operator / "credentials" / "gcp_service_account.json").write_text("{}\n", encoding="utf-8")
        spec = disposable_environment(root / "disposable")
        env = dict(spec["env"])
        env["PYTHONPATH"] = str(BENCH)
        env["ACADEMY_OPERATOR_SENTINEL_DIR"] = str(operator)
        completed = subprocess.run(
            [sys.executable, "-m", "execution_infrastructure.isolation_probe"],
            cwd=str(nested),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if completed.returncode != 0:
            raise AssertionError(completed.stderr)
        if sentinel in completed.stdout or sentinel in completed.stderr:
            raise AssertionError("sentinel content left the probe")
        report = json.loads(completed.stdout)
        if report["denied_operator_env"] is not True or report["parent_env_denied"] is not True:
            raise AssertionError(report)
        if report["google_denied"] is not True or report["visible_credential_names"] != []:
            raise AssertionError(report)
        if report["home_is_operator"] is not False:
            raise AssertionError(report)
        for candidate in credential_candidates(spec):
            if candidate.exists():
                raise AssertionError(candidate)
        if not is_credential_path(operator / ".env"):
            raise AssertionError("env path was not classified as a credential")


@test("PD-F06.google_destination_is_denied_before_dns")
def _():
    real_getaddrinfo = socket.getaddrinfo
    calls: list[str] = []

    def spy(host, port, *args, **kwargs):
        calls.append(str(host))
        raise AssertionError("original getaddrinfo was called")

    socket.getaddrinfo = spy
    try:
        install_network_guard()
        try:
            socket.getaddrinfo("sheets.googleapis.com", 443)
        except PermissionError:
            pass
        else:
            raise AssertionError("sheets lookup was allowed")
        outcome = deny_connect("oauth2.googleapis.com", 443)
        if outcome["denied"] is not True or outcome["external_contact"] is not False:
            raise AssertionError(outcome)
        if calls:
            raise AssertionError(calls)
        recorded = events()
        if not any(item.get("destination_class") == "GOOGLE_SHEETS_API" for item in recorded):
            raise AssertionError(recorded)
        if not any(item.get("destination_class") == "GOOGLE_OAUTH_TOKEN" for item in recorded):
            raise AssertionError(recorded)
    finally:
        uninstall_network_guard()
        socket.getaddrinfo = real_getaddrinfo
        clear_events()


@test("PD-F06.sheets_thread_cannot_escape_the_attempt")
def _():
    install_network_guard()
    try:
        clear_events()
        boundary = AttemptBoundary()
        boundary.begin()

        def sheets_side_effect():
            try:
                socket.create_connection(("sheets.googleapis.com", 443), timeout=0.2)
            except PermissionError:
                return

        worker = threading.Thread(target=sheets_side_effect, name="sheets-side-effect")
        worker.start()
        report = boundary.finish(join_timeout=2)
        if worker.is_alive():
            raise AssertionError("sheets thread survived the attempt boundary")
        if report["fail_closed"] is not False:
            raise AssertionError(report)
        if not any(item.get("host") == "sheets.googleapis.com" and item.get("decision") == "deny" for item in events()):
            raise AssertionError(events())
        if any(item.get("external_contact") for item in events()):
            raise AssertionError("external contact was recorded")
    finally:
        uninstall_network_guard()
        clear_events()


@test("PD-F06.owned_asyncio_task_is_cancelled")
def _():
    async def body():
        boundary = AttemptBoundary()
        boundary.begin_async()

        async def sleeper():
            await asyncio.sleep(30)

        task = asyncio.create_task(sleeper(), name="owned-sheets-task")
        report = await boundary.finish_async(join_timeout=0.5)
        if not task.done():
            raise AssertionError("task still pending")
        if report["fail_closed"] is not False:
            raise AssertionError(report)
        if "owned-sheets-task" not in report["cancelled_tasks"]:
            raise AssertionError(report)

    asyncio.run(body())


@test("PD-F06.owned_thread_is_joined")
def _():
    boundary = AttemptBoundary()
    boundary.begin()
    seen = []

    def worker():
        time.sleep(0.05)
        seen.append("done")

    threading.Thread(target=worker, name="owned-worker").start()
    report = boundary.finish(join_timeout=2)
    if seen != ["done"] or report["fail_closed"] is not False:
        raise AssertionError(report)
    if "owned-worker" not in report["joined_threads"]:
        raise AssertionError(report)


@test("PD-F06.unterminated_thread_fails_closed")
def _():
    release = threading.Event()
    boundary = AttemptBoundary()
    boundary.begin()

    def worker():
        release.wait(timeout=30)

    worker_thread = threading.Thread(target=worker, name="unterminated-worker")
    try:
        worker_thread.start()
        report = boundary.finish(join_timeout=0.2)
        if report["fail_closed"] is not True:
            raise AssertionError(report)
        if report["status"] != "BACKGROUND_THREAD_UNTERMINATED":
            raise AssertionError(report)
        if report["daemon_survival_accepted"] is not False:
            raise AssertionError("daemon survival was accepted")
    finally:
        release.set()
        worker_thread.join(timeout=2)


@test("PD-F06.python_default_deny_allows_only_loopback")
def _():
    if classify_host("127.0.0.1")["allow"] is not True:
        raise AssertionError("loopback denied")
    for host in ("api.telegram.org", "api.cohere.com", "example.com", "structural-typology-navigator.vercel.app"):
        decision = classify_host(host)
        if decision["allow"] is not False:
            raise AssertionError(host)
    held = []
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(2)
    port = listener.getsockname()[1]
    install_network_guard()
    try:
        def accept_one():
            try:
                conn, _addr = listener.accept()
                conn.close()
            except Exception:
                return
        acceptor = threading.Thread(target=accept_one)
        acceptor.start()
        client = socket.create_connection(("127.0.0.1", port), timeout=2)
        client.close()
        acceptor.join(timeout=2)
        held.append("loopback-ok")
    finally:
        uninstall_network_guard()
        listener.close()
        clear_events()
    if held != ["loopback-ok"]:
        raise AssertionError(held)


@test("OS-F04.delayed_log_is_captured_on_open_process_streams")
def _():
    streams = ProcessLifetimeStreams()
    streams.install()
    stdout_id = id(sys.stdout)
    stderr_id = id(sys.stderr)
    boundary = AttemptBoundary()
    boundary.begin()

    def worker():
        time.sleep(0.05)
        logging.getLogger("academy.execution.delayed").info("DELAYED-LOG-CAPTURED")

    threading.Thread(target=worker, name="delayed-log").start()
    try:
        thread_report = boundary.finish(join_timeout=2)
        streams.note_background_terminated()
        if "DELAYED-LOG-CAPTURED" not in streams.captured_text():
            raise AssertionError(streams.captured_text())
        if thread_report["fail_closed"]:
            raise AssertionError(thread_report)
        if not streams.streams_intact() or id(sys.stdout) != stdout_id or id(sys.stderr) != stderr_id:
            raise AssertionError("process streams were replaced or closed")
        shutdown = streams.shutdown(scenario_ordinal=1)
        order = shutdown["events"]
        positions = [order.index(name) for name in (
            "tasks-terminated", "handlers-flushed", "handlers-removed",
            "handlers-closed", "final-flush", "scan",
        )]
        if positions != sorted(positions):
            raise AssertionError(order)
        if shutdown["execution_status"] == LOGGING_STOP_CLASS:
            raise AssertionError(shutdown)
        if shutdown["streams_intact"] is not True or sys.stdout.closed or sys.stderr.closed:
            raise AssertionError("process streams were closed")
        if shutdown["last_resort_closed"] is not False:
            raise AssertionError("lastResort was closed")
        if "DELAYED-LOG-CAPTURED" not in streams.captured_text():
            raise AssertionError("delayed record disappeared at teardown")
    finally:
        if streams.installed:
            streams.shutdown()


@test("OS-F04.synthetic_logging_marker_fails_closed")
def _():
    streams = ProcessLifetimeStreams()
    streams.install()
    streams.note_background_terminated()
    streams.inject_synthetic_marker("--- Logging error ---")
    shutdown = streams.shutdown(scenario_ordinal=7)
    if shutdown["execution_status"] != "STOPPED_APPARATUS_LOGGING_FAILURE":
        raise AssertionError(shutdown["execution_status"])
    if shutdown["continue_to_next_scenario"] is not False:
        raise AssertionError("execution continued after a logging marker")
    if shutdown["stop_record"]["retry"] is not False or shutdown["stop_record"]["scenario_ordinal"] != 7:
        raise AssertionError(shutdown["stop_record"])
    second = ProcessLifetimeStreams()
    second.install()
    second.note_background_terminated()
    second.inject_synthetic_marker("ValueError: I/O operation on closed file")
    value_shutdown = second.shutdown(scenario_ordinal=8)
    if value_shutdown["execution_status"] != "STOPPED_APPARATUS_LOGGING_FAILURE":
        raise AssertionError(value_shutdown)


@test("snapshot.same_bytes_same_hash_and_mtime_is_ignored")
def _():
    def build(root: Path, text: bytes) -> None:
        (root / "a.txt").write_bytes(text)
        objects = root / ".git" / "objects" / "ab"
        objects.mkdir(parents=True)
        (objects / "cd").write_bytes(b"object-bytes")
        (root / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        refs = root / ".git" / "refs" / "heads"
        refs.mkdir(parents=True)
        (refs / "main").write_text("abc\n", encoding="utf-8")
        (root / ".git" / "index").write_bytes(b"index")
        target = root / ".git" / "_testbase"
        target.mkdir()
        (target / "sentinel").write_text("do-not-follow\n", encoding="utf-8")
        (root / "tests").mkdir()
        (root / "tests" / "_testbase").symlink_to("../.git/_testbase")

    with tempfile.TemporaryDirectory(prefix="academy-snap-a-") as left_tmp, tempfile.TemporaryDirectory(prefix="academy-snap-b-") as right_tmp:
        left = Path(left_tmp)
        right = Path(right_tmp)
        build(left, b"same")
        build(right, b"same")
        os.utime(left / ".git" / "objects" / "ab" / "cd", (10, 10))
        os.utime(right / ".git" / "objects" / "ab" / "cd", (4000, 4000))
        if snapshot_sha256(left) != snapshot_sha256(right):
            raise AssertionError("identical bytes produced different snapshot hashes")
        before = snapshot_sha256(left)
        os.utime(left / ".git" / "objects" / "ab" / "cd", (1, 1))
        if snapshot_sha256(left) != before:
            raise AssertionError(".git/objects mtime changed byte identity")
        document = snapshot_document(left)
        paths = {entry["path"] for entry in document["entries"]}
        if any(path.startswith(".git/objects/") for path in paths):
            raise AssertionError("git objects were included")
        link = next(entry for entry in document["entries"] if entry["path"] == "tests/_testbase")
        if link["type"] != "symlink" or link["symlink_target"] != "../.git/_testbase" or link["followed"] is not False:
            raise AssertionError(link)
        if not document["sanctioned_symlink_disclosures"]:
            raise AssertionError("sanctioned symlink was omitted")
        if link["sanctioned_provisioning_symlink"] is not True:
            raise AssertionError(link)
        (left / "a.txt").write_bytes(b"changed")
        if snapshot_sha256(left) == before:
            raise AssertionError("covered byte change did not change the snapshot hash")


@test("snapshot.real_testbase_symlink_is_disclosed_and_not_followed")
def _():
    disclosure = disclose_sanctioned_symlink(CHATBOT_TEST_BASE)
    if disclosure["present"] is not True or disclosure["target"] != "../.git/_testbase":
        raise AssertionError(disclosure)
    if disclosure["followed"] is not False or disclosure["deleted"] is not False:
        raise AssertionError(disclosure)
    if disclosure["part_of_152_file_hash_bound_authority_object"] is not False:
        raise AssertionError(disclosure)


@test("mode.next_dev_fails_closed_and_build_plus_start_is_required")
def _():
    rejected = evaluate_commands([["next", "dev"]])
    if rejected["ok"] is not False or rejected["next_dev_for_controlled_run"] is not True:
        raise AssertionError(rejected)
    missing = evaluate_commands([["next", "start"]])
    if missing["ok"] is not False:
        raise AssertionError(missing)
    accepted = evaluate_commands([["next", "build"], ["next", "start"]])
    if accepted["ok"] is not True or accepted["mode"] != "NEXT_BUILD_PLUS_NEXT_START":
        raise AssertionError(accepted)
    if accepted["next_dev_for_controlled_run"] is not False:
        raise AssertionError(accepted)


@test("gate.scenario_execution_is_refused_and_serial")
def _():
    if PARALLEL_SCENARIO_EXECUTION is not False:
        raise AssertionError("parallel scenario execution was enabled")
    try:
        execute_controlled({"run_scenario": True, "scenario_id": "A-0005"})
    except ScenarioExecutionForbidden:
        return
    raise AssertionError("scenario execution was accepted")


def _run_node() -> list[tuple[str, bool, str]]:
    with tempfile.TemporaryDirectory(prefix="academy-node-") as tmp:
        ledger = str(Path(tmp) / "ledger.json")
        output = str(Path(tmp) / "node-results.json")
        env = os.environ.copy()
        for key in (
            "COHERE_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "DEEPSEEK_API_KEY",
            "OPENAI_API_KEY", "BOT_TOKEN",
        ):
            env.pop(key, None)
        env["NAVIGATOR_ROOT"] = str(NAVIGATOR)
        env["ACADEMY_EXECUTION_FORBID_LIVE_PROVIDERS"] = "1"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            ["node", str(PRELOAD_PATH.parent / "post_patch_sentinel_selftest.cjs"), ledger, output],
            cwd=str(BENCH),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if not Path(output).exists():
            raise RuntimeError(completed.stderr or completed.stdout or "node self-test wrote no results")
        payload = json.loads(Path(output).read_text(encoding="utf-8"))
        if completed.returncode != 0 and not payload.get("tests"):
            raise RuntimeError(payload.get("error") or completed.stderr)
        rows = []
        for item in payload["tests"]:
            detail = item.get("detail") or ""
            if payload.get("error") and item["name"] == payload["tests"][-1]["name"] and not item["pass"]:
                detail = detail or payload["error"]
            rows.append((f"NODE.{item['name']}", bool(item["pass"]), detail))
        if payload.get("error") and all(row[1] for row in rows):
            rows.append(("NODE.harness", False, payload["error"]))
        return rows


def main() -> int:
    for fn in TESTS:
        fn()
    try:
        RESULTS.extend(_run_node())
    except Exception as exc:  # noqa: BLE001
        RESULTS.append(("NODE.harness", False, f"{type(exc).__name__}: {exc}"))
    passed = sum(1 for _name, ok, _detail in RESULTS if ok)
    failed = len(RESULTS) - passed
    print(json.dumps({
        "focused_tests_total": len(RESULTS),
        "focused_tests_pass": passed,
        "focused_tests_fail": failed,
        "results": [
            {"name": name, "pass": ok, "detail": detail}
            for name, ok, detail in RESULTS
        ],
    }, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
