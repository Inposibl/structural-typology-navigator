"""Shared constants for the execution-infrastructure candidate.

Values here restate the Owner-accepted CORR2 contract. They are benchmark
local. They are not product configuration.
"""

from __future__ import annotations

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
CONTRACTS_DIR = PACKAGE_ROOT / "contracts"
NODE_DIR = PACKAGE_ROOT / "node"
PRELOAD_PATH = NODE_DIR / "academy-execution-preload.cjs"
COVERAGE_PATH = CONTRACTS_DIR / "retrieval_fixture_coverage.json"
FIXTURE_PATH = CONTRACTS_DIR / "frozen_retrieval_fixtures.json"
FIXTURE_MANIFEST_PATH = CONTRACTS_DIR / "frozen_retrieval_fixtures.manifest.json"

CONTROLLING_COVERAGE_PATH = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/"
    "execution-infrastructure/"
    "ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_CLOSURE_1_PREFLIGHT_1_CORR2/"
    "RETRIEVAL_FIXTURE_COVERAGE.json"
)

CHATBOT_TEST_BASE = Path(
    "/Users/entp_psyche/Desktop/InvestProjects2026/"
    "test-bases/ACADEMY_TELEGRAM_LIVE_REGRESSION_1000_1/chatbot"
)
SANCTIONED_SYMLINK_RELATIVE = "tests/_testbase"
SANCTIONED_SYMLINK_TARGET = "../.git/_testbase"

CANONICAL_BENCHMARK_STATUSES = frozenset({
    "PASS",
    "FAIL",
    "HOLD",
    "TIMEOUT",
    "NONDETERMINISTIC",
    "INFRA_FAILURE",
    "SKIPPED_UNSAFE",
    "BENCHMARK_DEFECT",
    "NOT_EXECUTED",
    "NOT_OBSERVABLE",
})

RAW_INFRASTRUCTURE_OUTCOMES = frozenset({
    "PRODUCT_RESPONSE_OBSERVED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_HTTP_429",
    "PROVIDER_HTTP_4XX",
    "PROVIDER_HTTP_5XX",
    "PROVIDER_CONNECTION_FAILURE",
    "PROVIDER_AUTH_FAILURE",
    "PROVIDER_MALFORMED_RESPONSE",
    "RETRIEVAL_INFRA_FAILURE",
    "OTHER_INFRA_FAILURE",
})

INFRA_RAW_OUTCOMES = RAW_INFRASTRUCTURE_OUTCOMES - {"PRODUCT_RESPONSE_OBSERVED"}

ROUTABLE_COURSE_IDS = (
    "levels-of-consciousness",
    "maslow",
    "play-and-creativity",
    "normative-situation",
    "structural-typology",
)
LISTED_UNROUTABLE_COURSE_IDS = ("professional-development-stages",)

REQUIRED_MATCH_COUNT = 12
REQUIRED_MATCH_THRESHOLD = -1
FROZEN_QUERY_VECTOR_DIMENSION = 1024

COHERE_EMBED_URL = "https://api.cohere.com/v2/embed"
DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions"
SENTINEL_HEADER = "x-academy-harness-cohere-sentinel"
SENTINEL_VALUE = "CORR2-SENTINEL-1"
COHERE_STOP_CLASS = "COHERE_INTERPOSITION_STARTUP_PROOF_FAILURE"
LOGGING_STOP_CLASS = "STOPPED_APPARATUS_LOGGING_FAILURE"

SUPABASE_SECRET_PLACEHOLDER = "sb_secret_benchmark_placeholder"
COHERE_KEY_PLACEHOLDER = "benchmark-placeholder-not-a-secret"

CONTROLLED_NEXT_MODE = "NEXT_BUILD_PLUS_NEXT_START"

EVIDENCE_FIELDS = (
    "provider_class",
    "destination_class",
    "model_identifier",
    "benchmark_scenario_id",
    "benchmark_attempt_number",
    "chat_request_ordinal",
    "request_started_at",
    "request_finished_at",
    "elapsed_ms",
    "HTTP_status",
    "provider_request_id",
    "timeout_class",
    "transport_error_class",
    "malformed_response",
    "auth_failure",
    "native_provider_retry_index",
    "native_provider_retry_count",
    "benchmark_repeat_index",
    "operator_retry",
    "result_projection_stage",
    "raw_infrastructure_outcome",
    "canonical_benchmark_status",
    "body_sha256",
    "body_structural_descriptor",
    "body_byte_length",
)
