"""Scenario-contract compilation gate v1 — CORR5 (owner sections 12 and 37).

compile_scenario_contract(spec, adapter_capability) turns a scenario
specification into a MACHINE-READABLE compiled contract BEFORE corpus
acceptance. Compilation failure means the scenario definition is invalid and
must not enter the accepted corpus.

Each compiled row identifies (owner section 37):
    scenario ID / failure class / adapter / provider mode / route
    precondition / observable fields / oracle mapping / semantic requirement /
    concurrency mechanism / fault mechanism / static query contract /
    replay eligibility / future authority required.

Required closure properties (owner section 12):
    - every material expected field compiles EXACTLY ONCE to an
      (oracle, observable) pair unless explicitly documented as a
      joint/multi-oracle assertion;
    - no vacuous oracle (a required oracle with an empty controlling
      assertion set cannot compile);
    - no declared expectation without an adjudicator;
    - no runtime claim on a NO_SEAM scenario;
    - no fixture provider presented as real product authority (provider
      fixtures compile ONLY on consumption-measurement rows, never on
      policy-measurement rows, which must declare
      FUTURE_LOCAL_NAVIGATOR_SERVER instead);
    - concurrency/fault mechanisms reference REGISTERED mechanism identities;
    - route preconditions are explicit for L2 orchestration rows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .oracle import (
    ERROR_OUTCOME_CLASSES,
    ORACLE_FIELD_NEEDS,
    ORACLE_REGISTRY,
    STATE_ADJUDICATORS,
    LINK_ADJUDICATORS,
    COURSE_ID_ADJUDICATORS,
    validate_expectation_consistency,
    validate_semantic_completeness,
)
from .mechanisms import CONCURRENCY_MECHANISMS, FAULT_MECHANISMS

# adapters whose measurement target is CONSUMPTION of a provider response
# (Rule D: a benchmark-local fixture may provide controlled inputs there)
FIXTURE_CONSUMPTION_ADAPTERS = frozenset({
    "alexey_user_turn", "outbound_lead_lifecycle",
})
# adapters whose measurement target includes actual Navigator policy
# generation: provider_fixture is FORBIDDEN; FUTURE_LOCAL_NAVIGATOR_SERVER
# authority is required instead
POLICY_MEASUREMENT_ADAPTERS = frozenset({
    "navigator_l2_chat_api", "navigator_l1_payment_policy",
    "navigator_l1_course_reference", "navigator_l1_commercial_authority",
})

# expected fields that are EXPLICITLY DOCUMENTED joint/multi-oracle
# assertions (a single expectation adjudicated by more than one oracle by
# design, owner section 12)
JOINT_ASSERTIONS = {
    # expected.state on Set C rows: the concurrency_invariant adjudicates the
    # post-interleaving state while same_user_serialization_proven /
    # different_user_independence_proven adjudicates the mechanism proof
    "state|replay_C": ("concurrency_invariant", "concurrency_proof"),
}


@dataclass
class AdapterCapability:
    adapter_id: str
    native_observables: tuple[str, ...] = ()
    native_fault_hooks: tuple[str, ...] = ()
    provenance_class: str = ""


@dataclass
class CompiledContract:
    scenario_id: str
    compiled: bool
    defects: list[str] = field(default_factory=list)
    failure_class: str = ""
    adapter: str = ""
    provider_mode: str = "NONE"
    route_precondition: str = "NOT_APPLICABLE"
    observable_fields: list[str] = field(default_factory=list)
    oracle_mapping: list[dict] = field(default_factory=list)
    semantic_requirement: str = "NOT_REQUIRED"
    concurrency_mechanism: str = "NONE"
    fault_mechanism: str = "NONE"
    static_query_contract: list[dict] = field(default_factory=list)
    replay_eligibility: str = "NONE"
    future_authority_required: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "scenario_id": self.scenario_id,
            "compiled": self.compiled,
            "defects": self.defects,
            "failure_class": self.failure_class,
            "adapter": self.adapter,
            "provider_mode": self.provider_mode,
            "route_precondition": self.route_precondition,
            "observable_fields": self.observable_fields,
            "oracle_mapping": self.oracle_mapping,
            "semantic_requirement": self.semantic_requirement,
            "concurrency_mechanism": self.concurrency_mechanism,
            "fault_mechanism": self.fault_mechanism,
            "static_query_contract": self.static_query_contract,
            "replay_eligibility": self.replay_eligibility,
            "future_authority_required": self.future_authority_required,
        }


def _oracle_observable(name: str, params: dict) -> str:
    """The observable a compiled oracle adjudicates (PROVENANCE_CLASS +
    measurement kind are recorded in the oracle mapping itself)."""
    if name in ("state_subset", "concurrency_invariant", "gate_detection",
                "decision_kind", "course_reference_kind", "course_ids_match"):
        return "state"
    if name == "catalog_fallback":
        return "state.flow"
    if name in ("act_equals", "outcome_class", "fault_reaction"):
        return "act"
    if name == "origin_equals":
        return "origin"
    if name in ("exact_link",):
        return "link"
    if name in ("prohibited_output", "price_authority", "no_payment_link"):
        return "output"
    if name in ("tool_call_absent", "tool_call_present"):
        return "tool_api"
    if name in ("state_mutation_absent", "exactly_once", "duplicate_write_absent",
                "idempotent_retry"):
        return "mutations"
    if name in ("same_user_serialization_proven", "different_user_independence_proven",
                "concurrency_overlap_proven"):
        return "concurrency"
    if name == "fault_confirmed_injected":
        return "fault"
    if name == "static_config":
        return "static_facts"
    if name == "no_runtime_claim":
        return "no_runtime_claim"
    if name == "semantic_input_frozen":
        return "semantic_input"
    return "?"


MEASUREMENT_KINDS = {
    "act_equals": "EQUALITY", "origin_equals": "EQUALITY", "exact_link": "EQUALITY",
    # BENCHMARK-SUCCESSOR-IMPLEMENTATION-1 (RC-B02): state_subset compiles with
    # its OWN successor measurement kind so compiled contracts distinguish the
    # new RECURSIVE_NESTED_MAPPING_SUBSET comparison mode from
    # concurrency_invariant, which keeps the predecessor SUBSET_EQUALITY kind
    # unchanged.
    "state_subset": "RECURSIVE_NESTED_MAPPING_SUBSET",
    "concurrency_invariant": "SUBSET_EQUALITY",
    "gate_detection": "FLAG_ALL", "decision_kind": "EQUALITY",
    "course_reference_kind": "EQUALITY", "course_ids_match": "SET_EQUALITY",
    "catalog_fallback": "EQUALITY", "prohibited_output": "ABSENCE",
    "price_authority": "MEMBERSHIP", "no_payment_link": "ABSENCE",
    "tool_call_absent": "ABSENCE", "tool_call_present": "PRESENCE",
    "state_mutation_absent": "ABSENCE", "exactly_once": "CARDINALITY",
    "duplicate_write_absent": "CARDINALITY", "idempotent_retry": "CARDINALITY",
    "same_user_serialization_proven": "MECHANISM_PROOF",
    "different_user_independence_proven": "MECHANISM_PROOF",
    "concurrency_overlap_proven": "MECHANISM_PROOF",
    "fault_confirmed_injected": "MECHANISM_PROOF", "fault_reaction": "MEMBERSHIP",
    "static_config": "FACT_EQUALITY", "no_runtime_claim": "ABSENCE",
    "semantic_input_frozen": "LIFECYCLE", "outcome_class": "MEMBERSHIP",
}


# A-0298 only. These two accusative strings are the authorized disclosure
# surface of the nominative purchase titles already introduced in the setup
# steps. They are not a morphology engine and they do not apply to any other row.
_A0298_SURFACES = (
    ("Структурная типология", "Структурную типологию"),
    ("Иерархия уровней сознания", "Иерархию уровней сознания"),
)


def _a0298_authorized_surface(sid: str, marker: str, intro_text: str) -> bool:
    if sid != "A-0298":
        return False
    return any(marker == surface and nominative in intro_text
               for nominative, surface in _A0298_SURFACES)


_A0105_UTTERANCES = ("Меня зовут Варвара", "Забудь моё имя", "Как меня зовут?")


def _a0105_causal_defects(spec: dict) -> list[str]:
    """A-0105 is three causal requests. One history batch is not the contract."""
    sid = spec.get("scenario_id", "A-0105")
    setup = spec.get("state_setup") or {}
    steps = setup.get("multi_step") or []
    defects: list[str] = []
    if setup.get("causal_profile_propagation") is not True:
        defects.append(
            f"{sid}: profile-name forgetting requires causal_profile_propagation; "
            "three utterances inside one request are not the measurement")
    if len(steps) != 3:
        defects.append(
            f"{sid}: profile-name forgetting requires exactly three causal requests, "
            f"found {len(steps)}")
    contents = []
    request_ids = []
    for index, step in enumerate(steps[:3], start=1):
        if not isinstance(step, dict):
            defects.append(f"{sid}: causal step {index} is not a request")
            contents.append(None)
            request_ids.append(None)
            continue
        messages = step.get("messages")
        request_ids.append(step.get("requestId"))
        if not isinstance(messages, list) or len(messages) != 1 or not isinstance(messages[0], dict):
            defects.append(
                f"{sid}: causal step {index} must be one user utterance, not a history batch")
            contents.append(None)
            continue
        if messages[0].get("role") != "user":
            defects.append(f"{sid}: causal step {index} must be a user utterance")
        contents.append(messages[0].get("content"))
    if tuple(contents) != _A0105_UTTERANCES:
        defects.append(
            f"{sid}: causal utterance order must be introduction, forgetting, recall")
    if len(request_ids) != 3 or len(set(request_ids)) != 3 or any(not item for item in request_ids):
        defects.append(f"{sid}: the three causal requests need distinct request ids")
    initial = steps[0].get("profile") if steps and isinstance(steps[0], dict) else None
    top = setup.get("profile") if isinstance(setup.get("profile"), dict) else {}
    if (not isinstance(initial, dict) or "displayName" not in initial
            or initial.get("displayName") is not None):
        defects.append(f"{sid}: introduction request must start with displayName null")
    if "displayName" not in top or top.get("displayName") is not None:
        defects.append(f"{sid}: initial profile displayName must be null")
    return defects


def compile_scenario_contract(spec: dict, adapter_capability: AdapterCapability) -> CompiledContract:
    """Deterministic compilation of one scenario contract. Compilation
    failure = scenario definition invalid (owner section 12)."""
    sid = spec.get("scenario_id", "?")
    defects: list[str] = []
    adapter = spec.get("adapter_id") or (spec.get("sut_binding") or {}).get("adapter_id", "")
    cc = CompiledContract(scenario_id=sid, compiled=False, failure_class=spec.get("failure_class", ""),
                          adapter=adapter)

    # ---- pre-existing validators (definition/completeness/consistency) -----
    defects += validate_semantic_completeness(spec)
    defects += validate_expectation_consistency(spec, adapter_capability.native_observables)

    oracles = spec.get("oracle") or []
    names = [o.get("oracle") for o in oracles]
    cc.oracle_mapping = [
        {"oracle_id": o.get("oracle"),
         "observable_source": _oracle_observable(o.get("oracle") or "", o.get("params") or {}),
         "oracle_parameter": sorted((o.get("params") or {}).keys()),
         "provenance_class": ("STATIC_INSPECTION" if o.get("oracle") == "static_config"
                              else "PRODUCT_RUNTIME"),
         "measurement_kind": MEASUREMENT_KINDS.get(o.get("oracle"), "?"),
         "required": bool(o.get("required", True))}
        for o in oracles
    ]
    for o in oracles:
        if o.get("oracle") not in ORACLE_REGISTRY:
            defects.append(f"{sid}: oracle {o.get('oracle')!r} is not registered")

    # ---- no vacuous oracle (F03) --------------------------------------------
    for o in oracles:
        if o.get("oracle") == "static_config":
            exps = (o.get("params") or {}).get("expectations")
            if not exps:
                defects.append(f"{sid}: required static_config oracle has an empty "
                               "expectation set (vacuous oracle; F03)")
            cc.static_query_contract = list(exps or [])

    # ---- CORR1 (BENCHMARK-SUCCESSOR-IMPLEMENTATION-1.CORR1.
    # CONTRACT-COMPILE-VALIDATION-1): the Owner-accepted successor contract
    # requires non-mapping expected_state to be rejected DURING CONTRACT
    # COMPILATION — a later oracle-stage guard is not a substitute. The
    # effective expected_state resolves with the oracle's controlling
    # precedence WITHOUT a truthiness fallback: an explicitly supplied
    # params.expected_state is inspected as-is (a falsey malformed value can
    # never hide behind `or {}`); otherwise the predecessor fallback source
    # spec.expected.state applies; absent on both sources retains the
    # predecessor empty-mapping behavior. An empty mapping `{}` stays a valid
    # empty expectation, and every Owner-accepted RC-B02 shape compiles.
    for o in oracles:
        if o.get("oracle") != "state_subset":
            continue
        o_params = o.get("params") or {}
        if "expected_state" in o_params:
            effective_expected_state = o_params.get("expected_state")
            expected_state_source = "params.expected_state (explicit)"
        else:
            effective_expected_state = (spec.get("expected") or {}).get("state")
            expected_state_source = "expected.state (predecessor fallback)"
            if effective_expected_state is None:
                continue
        if not isinstance(effective_expected_state, dict):
            defects.append(
                f"{sid}: state_subset {expected_state_source} must be a mapping; "
                f"got {type(effective_expected_state).__name__} "
                "(non-mapping expected_state rejected at contract compilation; "
                "CORR1.CONTRACT-COMPILE-VALIDATION-1)")

    # ---- every material expected field compiles exactly once (F02) ---------
    expected = spec.get("expected") or {}
    expected_fields: list[tuple[str, str]] = []
    for key in ("act", "origin", "link", "flow"):
        if key in expected:
            expected_fields.append((key, f"expected.{key}"))
    for k in (expected.get("state") or {}):
        expected_fields.append((k, f"expected.state.{k}"))
    adjudicator_fields: dict[str, list[str]] = {}
    for o in oracles:
        oname = o.get("oracle")
        params = o.get("params") or {}
        if oname == "act_equals":
            adjudicator_fields.setdefault("act", []).append(oname)
        if oname == "origin_equals":
            adjudicator_fields.setdefault("origin", []).append(oname)
        if oname in LINK_ADJUDICATORS:
            adjudicator_fields.setdefault("link", []).append(oname)
        if oname == "catalog_fallback" and ("expected_flow" in params or "flow" in expected):
            adjudicator_fields.setdefault("flow", []).append(oname)
        if oname == "gate_detection":
            for k in (params.get("required_detections") or []):
                adjudicator_fields.setdefault(str(k), []).append(oname)
        if oname in STATE_ADJUDICATORS:
            # CORR2 (CORR1.IV1 blocking finding F2): the malformed-root guard
            # is scoped to state_subset ONLY — its compile-time defect is
            # recorded by the CORR1 validation loop above, so the walk below
            # must never re-crash on a malformed state_subset root. Every
            # OTHER state adjudicator keeps the failed-predecessor `or {}`
            # walk exactly, including its TypeError on truthy non-mapping
            # roots (out-of-scope semantics are preserved, not repaired).
            es = params.get("expected_state")
            if oname == "state_subset":
                if isinstance(es, dict):
                    for k in es:
                        adjudicator_fields.setdefault(str(k), []).append(oname)
            else:
                for k in (es or {}):
                    adjudicator_fields.setdefault(str(k), []).append(oname)
    joint_ok = bool(spec.get("replay_set") == "C")
    for field_key, decl in expected_fields:
        adjudicators = adjudicator_fields.get(field_key, [])
        if not adjudicators:
            defects.append(f"{sid}: declared expectation {decl} compiles to NO adjudicator "
                           "(expectation without an oracle; F02)")
        elif len(adjudicators) > 1 and not joint_ok:
            defects.append(f"{sid}: declared expectation {decl} compiles MORE THAN ONCE "
                           f"({adjudicators}) without a documented joint assertion")

    # ---- provider fixture contract (F06 / Rule D) + IV6-F06A/F06B -------------
    provider_fixture = spec.get("provider_fixture") or {}
    if provider_fixture:
        if adapter in POLICY_MEASUREMENT_ADAPTERS:
            defects.append(
                f"{sid}: provider_fixture is FORBIDDEN on policy-measurement adapter "
                f"{adapter!r} (actual Navigator policy generation is the measurement "
                "target; declare FUTURE_LOCAL_NAVIGATOR_SERVER instead)")
        elif adapter not in FIXTURE_CONSUMPTION_ADAPTERS:
            defects.append(
                f"{sid}: provider_fixture declared on non-consumption adapter {adapter!r}")
        else:
            cc.provider_mode = "FIXTURE_PROVIDER"
        from adapters.product import validate_navigator_response_fixture
        registered_ids = set()
        for entry in provider_fixture.get("responses") or []:
            fid = (entry or {}).get("fixture_id")
            if not fid:
                defects.append(
                    f"{sid}: provider fixture response entry without a registered "
                    "fixture_id (explicit identity selection requires registration; "
                    "IV6-F06A)")
            else:
                registered_ids.add(fid)
            try:
                validate_navigator_response_fixture(
                    (entry or {}).get("response"),
                    where=f"{sid} provider fixture entry")
            except ValueError as exc:
                defects.append(str(exc))
        # IV6-F06A: every DECLARED selection identity must be registered
        declared_single = provider_fixture.get("fixture_id")
        if declared_single is not None and declared_single not in registered_ids:
            defects.append(
                f"{sid}: declared PROVIDER_FIXTURE_ID {declared_single!r} is not a "
                "registered fixture identity (unregistered provider fixture identity; "
                "IV6-F06A)")
        for uid, fid in (provider_fixture.get("fixture_by_user") or {}).items():
            if fid not in registered_ids:
                defects.append(
                    f"{sid}: declared PROVIDER_FIXTURE_ID {fid!r} for user {uid!r} is "
                    "not a registered fixture identity (IV6-F06A)")
        for idx, fid in (provider_fixture.get("fixture_by_worker") or {}).items():
            if fid not in registered_ids:
                defects.append(
                    f"{sid}: declared PROVIDER_FIXTURE_ID {fid!r} for worker {idx!r} is "
                    "not a registered fixture identity (operation-local selection)")
        per_user = bool((spec.get("preconditions") or {}).get("per_user_mode"))
        distinct_users = provider_fixture.get("fixture_by_user") or {}
        if per_user and provider_fixture.get("responses") \
                and not distinct_users and not provider_fixture.get("fixture_by_worker") \
                and provider_fixture.get("mode") != "state_aware":
            defects.append(
                f"{sid}: different-user provider contract selects one fixture identity "
                "for every task; fixture identity must be bound per user or per "
                "operation (a shared selector is not task isolation)")
        # IV6-F06A: text-keyed selection is retired
        if provider_fixture.get("responses") and any(
                (e or {}).get("stimulus_contains") for e in provider_fixture["responses"]):
            defects.append(
                f"{sid}: stimulus-keyed fixture selection is retired — fixture "
                "selection must be explicit by identity (IV6-F06A)")
        default = provider_fixture.get("default")
        if default is not None:
            try:
                validate_navigator_response_fixture(default, where=f"{sid} provider fixture default")
            except ValueError as exc:
                defects.append(str(exc))

    # ---- future authority declarations --------------------------------------
    future: list[str] = []
    pre = spec.get("preconditions") or {}
    if pre.get("navigator_transport") == "real_local":
        future.append("FUTURE_LOCAL_NAVIGATOR_SERVER")
    if spec.get("execution_level") == "L4" or adapter == "live_telegram_transport":
        future.append("FUTURE_LIVE_TELEGRAM_SANCTIONED_IDENTITY")
    if spec.get("semantic_evaluation", {}).get("required"):
        future.append("INDEPENDENT_SEMANTIC_EVALUATOR")
    cc.future_authority_required = future

    # ---- concurrency mechanism identity (F12) -------------------------------
    if spec.get("replay_set") == "C":
        proof_oracles = {"same_user_serialization_proven",
                         "different_user_independence_proven",
                         "concurrency_overlap_proven"} & set(names)
        if not proof_oracles:
            defects.append(f"{sid}: replay C without a concurrency-proof oracle")
        mech_id = spec.get("concurrency_mechanism_id") or (
            (spec.get("concurrency_schedule") or [{}])[0].get("mechanism_id")
            if spec.get("concurrency_schedule") else None)
        if mech_id is None:
            # derive from the declared user topology for compile-time identity
            per_user = bool(pre.get("per_user_mode"))
            mech_id = ("ALEXEY.DIFFERENT_USER_INDEPENDENCE" if per_user
                       else "ALEXEY.SAME_USER_SERIALIZATION")
        rec = CONCURRENCY_MECHANISMS.get(mech_id)
        if rec is None:
            defects.append(f"{sid}: concurrency mechanism {mech_id!r} is not registered")
        else:
            cc.concurrency_mechanism = mech_id
            if rec.oracle not in proof_oracles:
                defects.append(
                    f"{sid}: registered concurrency mechanism {mech_id!r} requires its "
                    f"typed proof oracle {rec.oracle!r}")
            if adapter and adapter != rec.supported_adapter:
                defects.append(
                    f"{sid}: concurrency mechanism {mech_id!r} does not support adapter "
                    f"{adapter!r}")
        cc.replay_eligibility = "C"

    # ---- fault mechanism identity (F13) --------------------------------------
    fault_schedule = spec.get("fault_schedule") or []
    if fault_schedule or spec.get("replay_set") == "F":
        mech_id = (fault_schedule[0].get("mechanism_id") if fault_schedule else None)
        if mech_id is None:
            defects.append(
                f"{sid}: fault scenario without a REGISTERED FAULT_MECHANISM_ID "
                "(free-form kind/target/point labels are not mechanism authority; F13)")
        else:
            rec = FAULT_MECHANISMS.get(mech_id)
            if rec is None:
                defects.append(f"{sid}: FAULT_MECHANISM_ID {mech_id!r} is not registered")
            else:
                cc.fault_mechanism = mech_id
                if adapter and adapter != rec.supported_adapter:
                    defects.append(
                        f"{sid}: fault mechanism {mech_id!r} does not support adapter {adapter!r}")
                if adapter_capability.native_fault_hooks is not None \
                        and rec.kind not in adapter_capability.native_fault_hooks:
                    defects.append(
                        f"{sid}: fault kind {rec.kind!r} is not a capability of the bound "
                        f"adapter {adapter!r}")
                # free-form scenario labels must AGREE with the registry record
                declared = fault_schedule[0]
                for label, registered in (("kind", rec.kind),
                                          ("target", rec.physical_fixture_seam),
                                          ("point", rec.point)):
                    if declared.get(label) and str(declared[label]) != str(registered):
                        defects.append(
                            f"{sid}: scenario fault {label} {declared[label]!r} disagrees "
                            f"with the registered mechanism {label} {registered!r}")
        if not ({"fault_confirmed_injected", "fault_reaction"} & set(names)):
            defects.append(f"{sid}: fault scenario without fault-confirmation adjudicator")
        cc.replay_eligibility = spec.get("replay_set") or "F"

    # ---- L2 route preconditions (F15) + IV6 semantic upgrades -----------------
    if adapter == "navigator_l2_chat_api":
        profile = (spec.get("state_setup") or {}).get("profile")
        complete = isinstance(profile, dict) and (
            (profile.get("displayName") is not None or profile.get("nameDeclined"))
            and profile.get("addressMode") is not None)
        onboarding_mechanism = any(
            kw in str(spec.get("failure_mechanism", "")).lower()
            for kw in ("онбординг", "знакомств", "имя", "представ", "address mode",
                       "profile completeness", "выбор обращения", "command text as profile",
                       "first contact", "first-contact", "profile slot", "name collection"))
        declared_route = spec.get("route_precondition")
        if declared_route in ("COMPLETE_PROFILE_PROVIDED", "ONBOARDING_IS_THE_MECHANISM"):
            cc.route_precondition = declared_route
            # coherence: the declared trajectory classification must MATCH the
            # supplied profile (IV6-F15: a complete profile must not bypass a
            # first-contact measurement; an orchestration row must not ship
            # an incomplete profile)
            if declared_route == "ONBOARDING_IS_THE_MECHANISM" and complete:
                defects.append(
                    f"{sid}: route_precondition ONBOARDING_IS_THE_MECHANISM but a "
                    "COMPLETE profile is supplied (a complete profile bypasses the "
                    "declared setup lane, including when the mechanism is itself "
                    "onboarding; IV6-F15)")
            if declared_route == "COMPLETE_PROFILE_PROVIDED" and not complete:
                defects.append(
                    f"{sid}: route_precondition COMPLETE_PROFILE_PROVIDED but the "
                    "supplied profile is incomplete (IV6-F15)")
        elif complete:
            cc.route_precondition = "COMPLETE_PROFILE_PROVIDED"
        elif onboarding_mechanism:
            cc.route_precondition = "ONBOARDING_IS_THE_MECHANISM"
            if complete:
                defects.append(
                    f"{sid}: onboarding-mechanism row ships a COMPLETE profile — "
                    "premature slot/state fill bypasses the declared first-contact "
                    "measurement (IV6-F15)")
        else:
            defects.append(
                f"{sid}: navigator_l2_chat_api row without a complete profile route "
                "precondition and without an onboarding failure mechanism: the request "
                "cannot reach the intended orchestration path (F15)")
        # IV6-F15 §34: cross-session / forgetting / memory claims require an
        # explicit multi-step causal trajectory (>=2 steps, distinct session ids)
        mech_text = str(spec.get("failure_mechanism", "")).lower()
        cross_session_claim = "cross-session" in mech_text
        if cross_session_claim:
            ss_setup = spec.get("state_setup") or {}
            steps = ss_setup.get("multi_step") or []
            request_ids = [s.get("requestId") for s in steps if isinstance(s, dict)]
            if ss_setup.get("cross_session_mode") == "probe_without_prior_context":
                # declared single-step leakage probe BY DESIGN: no prior session
                # exists; the single request measures non-fabrication honestly
                pass
            elif len(steps) < 2 or len(set(request_ids)) != len(request_ids):
                defects.append(
                    f"{sid}: cross-session mechanism without an explicit "
                    "multi-step trajectory (>=2 causal steps with DISTINCT session "
                    "identifiers): a single request cannot establish cross-session "
                    "behavior (IV6-F15 §34)")
            else:
                intro_steps = steps[:-1]
                intro_text = "\n".join(
                    str(message.get("content") or "")
                    for step in intro_steps if isinstance(step, dict)
                    for message in (step.get("messages") or [])
                    if isinstance(message, dict))
                for oracle in oracles:
                    if oracle.get("oracle") != "prohibited_output":
                        continue
                    for marker in (oracle.get("params") or {}).get("prohibited") or []:
                        if marker == "Traceback":
                            continue
                        if str(marker) in intro_text:
                            continue
                        if _a0298_authorized_surface(sid, str(marker), intro_text):
                            continue
                        defects.append(
                            f"{sid}: prohibited marker {marker!r} is not an "
                            "introduced fact of the setup steps; the later probe "
                            "cannot test a fact the trajectory did not establish")
        if sid == "A-0105":
            defects.extend(_a0105_causal_defects(spec))
        # every L2 row requires the attested future local Navigator server at
        # execution time (loopback-only URL from the authenticated env)
        if "FUTURE_LOCAL_NAVIGATOR_SERVER" not in future:
            future.append("FUTURE_LOCAL_NAVIGATOR_SERVER")
            cc.future_authority_required = future
        # IV6 §38: a Set S row must reach its declared variable path — an
        # onboarding/control row cannot honestly claim stochastic replay
        if spec.get("replay_set") == "S" and cc.route_precondition != "COMPLETE_PROFILE_PROVIDED":
            defects.append(
                f"{sid}: Set S row whose route precondition is "
                f"{cc.route_precondition!r} cannot reach the declared variable "
                "orchestration path (IV6-F15 §35)")
        if cc.route_precondition == "COMPLETE_PROFILE_PROVIDED" or spec.get("replay_set") == "S":
            import re as _re_s
            turn_text = " ".join(str(t.get("content") or "")
                                 for t in (spec.get("turns") or [])
                                 if isinstance(t, dict))
            if _re_s.search(r"позов\w*\s+менеджер", turn_text, _re_s.IGNORECASE):
                defects.append(
                    f"{sid}: manager-request control stimulus cannot reach the "
                    "declared variable orchestration path (IV6-F15 §35)")

    # ---- IV6 §38: state expectation must match the ACTUAL adapter projection -
    expected_state = expected.get("state")
    if isinstance(expected_state, dict) and expected_state:
        if adapter == "alexey_user_turn":
            user_keys = [k for k in expected_state if k.isdigit()]
            non_user = [k for k in expected_state if not k.isdigit()]
            if non_user:
                defects.append(
                    f"{sid}: alexey_user_turn persists USER-KEYED state "
                    f"({{user_id: {{selectedCourseId, displayName}}}}); flat keys "
                    f"{non_user} address a projection the adapter never emits — "
                    "correctly persisted values would FAIL (IV6-F02)")
            if user_keys and spec.get("replay_set") != "C":
                # single-user rows: exactly one user key expected
                if len(user_keys) != 1:
                    defects.append(
                        f"{sid}: single-user alexey measurement must project exactly "
                        f"one user key, found {user_keys} (IV6-F02)")

    # ---- observable fields & semantic requirement -----------------------------
    cc.observable_fields = sorted({f for o in oracles
                                   for f in ORACLE_FIELD_NEEDS.get(o.get("oracle"), set())})
    if spec.get("semantic_evaluation", {}).get("required"):
        cc.semantic_requirement = "REQUIRED"
        if "semantic_input_frozen" not in names:
            defects.append(f"{sid}: semantic requirement without the lifecycle oracle")

    # ---- NO_SEAM runtime-claim rule -------------------------------------------
    if spec.get("seam_class") == "NO_SEAM":
        runtime_names = [n for n in names
                         if n not in ("static_config", "no_runtime_claim",
                                      "semantic_input_frozen")]
        if runtime_names:
            defects.append(f"{sid}: NO_SEAM scenario with runtime oracle(s) {runtime_names}")

    # ---- static query contract completeness + RELEVANCE (F03 + IV6-F03) ------
    static_queries = pre.get("static_queries") or []
    if adapter == "static_source_inventory":
        declared_facts = {q.get("fact") for q in static_queries}
        import re as _re
        _ident = _re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")
        for q in static_queries:
            qtype = q.get("query_type")
            if qtype in ("SYMBOL_EXISTS", "SYMBOL_ABSENT", "CALL_SITE_EXISTS",
                         "HANDLER_REGISTERED"):
                subject = q.get("symbol") or q.get("call")
                if subject and not _ident.fullmatch(str(subject)):
                    defects.append(
                        f"{sid}: {qtype} subject {subject!r} is not a code identifier — "
                        "callback data/prose cannot be a callee or symbol; the declared "
                        "question must be answered by a typed query matching the native "
                        "construct (IV6-F03 §21)")
            if not q.get("declared_question"):
                defects.append(
                    f"{sid}: static query {q.get('fact')!r} lacks its DECLARED_QUESTION "
                    "(the compiled expectation must identify what question it answers; "
                    "IV6-F03 §22)")
            question = str(q.get("declared_question") or "")
            answered = _re.search(r"answered by ([A-Z_]+)", question)
            if answered and answered.group(1) != qtype:
                defects.append(
                    f"{sid}: declared question says it is answered by "
                    f"{answered.group(1)} but the query type is {qtype}")
            dotted = _re.findall(r"\b([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)",
                                 question)
            if dotted and q.get("class") and not any(
                    cls == q.get("class") and col == q.get("column") for cls, col in dotted):
                defects.append(
                    f"{sid}: declared question names {dotted} but the query subject "
                    f"is {q.get('class')}.{q.get('column')}")
            named_handlers = _re.findall(r"\bcb_[A-Za-z0-9_]+\b", question)
            if named_handlers and q.get("handler") and q.get("handler") not in named_handlers:
                defects.append(
                    f"{sid}: declared question names handler {named_handlers} but the "
                    f"query handler is {q.get('handler')!r}")
            named_filters = _re.findall(r"\b[a-z0-9_]+:[A-Za-z0-9_:]+", question)
            if named_filters and q.get("filter_data") \
                    and q.get("filter_data") not in named_filters:
                defects.append(
                    f"{sid}: declared question names filter {named_filters} but the "
                    f"query filter is {q.get('filter_data')!r}")
            callbackish = any(token in question.lower()
                              for token in ("callback", "confirm:", "f.data"))
            answered_matches = bool(answered and answered.group(1) == qtype)
            if callbackish and not answered_matches and qtype != "CALLBACK_FILTER_HANDLER":
                defects.append(
                    f"{sid}: declared callback-registration question is not answered "
                    f"by CALLBACK_FILTER_HANDLER (query type {qtype} substitutes a "
                    "different question)")
            resolutionish = any(token in question.lower() for token in (
                "allowed_updates", "resolve_used_update_types", "resolved update"))
            if resolutionish and qtype == "HANDLER_DECORATOR_TYPES" and not answered_matches:
                defects.append(
                    f"{sid}: resolved allowed_updates question must not be replaced "
                    "by a handler-decorator inventory (B-0030 question substitution)")
            if qtype == "HANDLER_DECORATOR_TYPES" and "allowed_updates" in str(
                    spec.get("failure_mechanism") or "").lower():
                defects.append(
                    f"{sid}: mechanism requires resolved allowed_updates, but the "
                    "query is a handler-decorator inventory (question substitution)")
        for o in oracles:
            if o.get("oracle") == "static_config":
                for exp in (o.get("params") or {}).get("expectations") or []:
                    if exp.get("path") not in declared_facts:
                        defects.append(
                            f"{sid}: static expectation {exp.get('path')!r} has no matching "
                            "registered static query (QUERY_ID/FACT binding required; F03)")

    # ---- concurrency schedule contract (IV6-F12A/F12B) ------------------------
    if spec.get("replay_set") == "C":
        sched = (pre.get("concurrency_schedule") or {}
                 or (spec.get("provider_fixture") or {}).get("contention_schedule") or {})
        try:
            pause = float(sched.get("provider_pause_s", 0) or 0)
        except (TypeError, ValueError):
            pause = 0.0
        if pause <= 0:
            defects.append(
                f"{sid}: Set C row without a benchmark-controlled contention schedule "
                "(contention_schedule.provider_pause_s > 0 at the awaited provider "
                "boundary): same-loop tasks cannot yield real measured contention and "
                "independent operations cannot demonstrate simultaneous progress "
                "(IV6-F12A/F12B)")

    cc.compiled = not defects
    cc.defects = defects
    return cc


def compile_retention_claim(removed: dict, retained: dict, claim: dict) -> list[str]:
    """Reject an authoritative retention proof that is not a real equivalence.

    SEMANTIC_EQUIVALENCE=YES is accepted only when the removed row and the
    named retained row share a computed semantic-obligation id. Constant flags
    that disagree with that relationship are defects.
    """
    defects: list[str] = []
    removed_id = claim.get("REMOVED_ID")
    if removed_id != removed.get("scenario_id"):
        defects.append("retention claim removed id does not match the removed row")
    if claim.get("NEAREST_RETAINED_EQUIVALENT") != retained.get("scenario_id"):
        defects.append("retention claim nearest id does not match the retained row")
    same = claim.get("_computed_obligation_id") == claim.get("_retained_obligation_id")
    if claim.get("SEMANTIC_EQUIVALENCE") == "YES" and not same:
        defects.append(
            "SEMANTIC_EQUIVALENCE=YES but the rows do not share a semantic obligation")
    if claim.get("SEMANTIC_EQUIVALENCE") == "YES" and claim.get("MANDATORY_SEED") == "YES":
        defects.append("a mandatory seed cannot be removed by an equivalence claim")
    if claim.get("UNIQUE_REQUIRED_OBLIGATION_LOST") == "NO" and claim.get(
            "_computed_unique_loss") is True:
        defects.append("claim says no unique loss but the obligation has no retained row")
    if same and claim.get("MATERIAL_CAUSAL_CONDITION_PRESERVED") != "YES":
        defects.append("shared obligation must record preserved causal condition")
    if same and claim.get("MATERIAL_STATE_DISTINCTION_PRESERVED") != "YES":
        defects.append("shared obligation must record preserved state distinction")
    return defects


def compile_corpus(rows: dict[str, dict], registry: dict) -> dict:
    """Compile every scenario contract in the corpus (owner section 37).
    Returns the SCENARIO_COMPILED_CONTRACTS document."""
    caps = {}
    for aid, a in (registry.get("adapters") or {}).items():
        caps[aid] = AdapterCapability(
            adapter_id=aid,
            native_observables=tuple(a.get("native_observables") or []),
            native_fault_hooks=tuple(a.get("real_fault_hooks") or []),
            provenance_class=a.get("provenance_class", ""),
        )
    compiled_rows = []
    n_ok = 0
    for sid in sorted(rows):
        cap = caps.get(rows[sid].get("adapter_id"), AdapterCapability(adapter_id="?"))
        cc = compile_scenario_contract(rows[sid], cap)
        compiled_rows.append(cc.to_json())
        if cc.compiled:
            n_ok += 1
    return {
        "schema": "SCENARIO_COMPILED_CONTRACTS_V1",
        "method": (
            "deterministic compile_scenario_contract(spec, adapter_capability) over every "
            "corpus row before acceptance: every material expected field compiles exactly "
            "once (documented joint assertions excepted), no vacuous oracle, no declared "
            "expectation without an adjudicator, no runtime claim on NO_SEAM, no fixture "
            "provider presented as product authority, registered mechanism identities, "
            "explicit L2 route preconditions"
        ),
        "total": len(rows),
        "compiled_ok": n_ok,
        "compile_failed": len(rows) - n_ok,
        "all_compile": n_ok == len(rows),
        "contracts": compiled_rows,
    }
