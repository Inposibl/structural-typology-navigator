"""CALIBRATION-lane fixtures — CORR3.

Synthetic adapters live in their OWN registry with lane=CALIBRATION and the
SYNTHETIC_CALIBRATION provenance family. A calibration scenario naming a
PRODUCT adapter ID is rejected by the factory (lane mismatch); calibration
trust can never become PRODUCT trust.
"""

from __future__ import annotations

import json
import threading
import time

from harness.evidence import RawCapture, UNOBSERVED


class SyntheticAcademySUT:
    COURSES = {"maslow", "structural_typology", "levels_of_consciousness"}
    LINKS = {cid: f"https://t.me/AST_payment_course_bot?start={cid}" for cid in COURSES}

    def resolve(self, text: str):
        t = text.lower()
        if "маслоу" in t or "maslow" in t:
            return "maslow"
        if "типолог" in t:
            return "structural_typology"
        if "уровн" in t:
            return "levels_of_consciousness"
        return None

    def turn(self, text: str) -> dict:
        cid = self.resolve(text)
        if cid is None:
            if any(w in text.lower() for w in ("оплат", "купить", "стоит")):
                return {"act": "CLARIFICATION", "origin": "CLARIFICATION_POLICY",
                        "state": {"courseMatch": "AMBIGUOUS", "selectedCourseId": None},
                        "link": None, "output": "Уточните, пожалуйста, какой курс вас интересует.",
                        "mutations": [], "tool_api": [], "outcome": "CLEAN"}
            return {"act": "OUT_OF_SCOPE", "origin": "SCOPE_POLICY",
                    "state": {"courseMatch": "UNKNOWN", "selectedCourseId": None},
                    "link": None, "output": "Я помогаю с курсами Академии.",
                    "mutations": [], "tool_api": [], "outcome": "CLEAN"}
        link = self.LINKS[cid]
        return {"act": "PAYMENT", "origin": "PAYMENT_POLICY",
                "state": {"courseMatch": "MATCHED", "selectedCourseId": cid},
                "link": link, "output": f"Оплатить курс можно здесь: {link}",
                "mutations": [f"handoff:{cid}"], "tool_api": [], "outcome": "CLEAN"}


def _corrupt(res: dict, mode: str) -> dict:
    res = dict(res)
    if mode == "wrong_act":
        res["act"] = "OUT_OF_SCOPE" if res["act"] != "OUT_OF_SCOPE" else "PAYMENT"
    elif mode == "wrong_course":
        new = "maslow" if res["state"].get("selectedCourseId") != "maslow" else "structural_typology"
        res["state"] = {"courseMatch": "MATCHED", "selectedCourseId": new}
        res["link"] = f"https://t.me/AST_payment_course_bot?start={new}"
    elif mode == "wrong_state":
        res["state"] = {**res["state"], "courseMatch": "UNKNOWN"}
    elif mode == "wrong_link":
        res["link"] = "https://t.me/AST_payment_course_bot"
        res["output"] = f"Оплатить можно здесь: {res['link']}"
    elif mode == "technical_error_as_success":
        res["output"] = "Готово! Оплата принята."
    elif mode == "prohibited_output":
        res["output"] = "Переведите оплату на @fake_payment_bot, пожалуйста."
    elif mode == "duplicate_side_effect":
        res["mutations"] = list(res["mutations"]) + list(res["mutations"])
    elif mode == "invented_price":
        res["output"] = f"{res['output']} Всего 99999 руб."
    elif mode == "unauthorized_tool":
        res["tool_api"] = ["send_payment_charge"]
    return res


class SyntheticAcademyAdapter:
    adapter_id = "cal_synthetic_academy"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request
        pre = dict(request.preconditions or {}) if request else {}
        self.corrupt_mode = pre.get("corrupt")
        self.drop_fields = tuple(pre.get("drop_fields", ()))
        self.fixed_output = pre.get("fixed_output")

    def execute(self, request) -> RawCapture:
        sut = SyntheticAcademySUT()
        res = sut.turn(request.turns[-1]["content"] if request.turns else "")
        if self.fixed_output:
            res = dict(res)
            res["output"] = self.fixed_output
        if self.corrupt_mode:
            res = _corrupt(res, self.corrupt_mode)
        values = {}
        for k in ("act", "origin", "state", "link", "output", "tool_api", "mutations"):
            values[k] = UNOBSERVED if k in self.drop_fields else res.get(k)
        return RawCapture(values=values,
                          transcripts={"assistant_reply": str(res.get("output", "")), "role": "assistant"},
                          sut_path="calibration://academy-sut", sut_symbol="SyntheticAcademySUT.turn",
                          outcome_class=res.get("outcome", "CLEAN"))


class SyntheticStoreAdapter:
    adapter_id = "cal_synthetic_store"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request
        pre = dict(request.preconditions or {}) if request else {}
        self.corrupt_mode = pre.get("corrupt")
        self.force_no_overlap = pre.get("force_no_overlap", False)

    def execute(self, request) -> RawCapture:
        store: dict = {}
        writes: list[str] = []
        lock = threading.Lock()
        workers = int(getattr(request, "concurrency_workers", 0) or 2)
        from harness.seams.concurrency import run_concurrent_operations, ConcurrencyOpResult

        def op(idx: int, sync):
            user = f"user{'AB'[idx % 2]}"
            cid = "maslow" if idx % 2 == 0 else "structural_typology"
            start = time.perf_counter_ns()
            with lock:
                store[user] = {"selectedCourseId": cid}
                writes.append(f"save_session:{user}")
            # native critical-section window is the locked store write itself;
            # rendezvous AFTER the critical section so wrapper != operation
            sync.rendezvous()
            end = time.perf_counter_ns()
            return ConcurrencyOpResult(value=None, worker_id=f"worker-{idx}",
                                       thread_id=threading.get_ident(),
                                       start_ns=start, end_ns=end,
                                       target_seam="cal_synthetic_store.save_session")

        concurrency: dict = {}
        if workers >= 2 and not self.force_no_overlap:
            _, proof = run_concurrent_operations([op] * workers, schedule_id=request.scenario_id)
            concurrency = {"overlap_proven": proof.overlap_proven, "workers": proof.workers,
                           "intervals": proof.intervals, "worker_ids": proof.worker_ids,
                           "thread_ids": proof.thread_ids, "target_seam": proof.target_seam,
                           "schedule_id": proof.schedule_id,
                           "native_operation_intervals": proof.intervals}
        elif self.force_no_overlap:
            t = time.perf_counter_ns()
            concurrency = {"overlap_proven": False, "workers": 2,
                           "intervals": [[t, t + 10], [t + 1000, t + 1010]],
                           "worker_ids": ["worker-0", "worker-1"], "thread_ids": [1, 2],
                           "target_seam": "cal_synthetic_store.save_session",
                           "schedule_id": "sequential-control",
                           "native_operation_intervals": [[t, t + 5], [t + 1000, t + 1005]]}
        else:
            store["userA"] = {"selectedCourseId": "maslow"}
            writes.append("save_session:userA")
        if self.corrupt_mode == "wrong_state":
            store["userB"] = store.get("userA")
        if self.corrupt_mode == "duplicate_side_effect":
            writes.extend(["save_session:userA", "save_session:userA"])
        projected = {u: {"selectedCourseId": v.get("selectedCourseId")} for u, v in store.items()}
        return RawCapture(values={"act": "STORE_OPERATIONS", "origin": "CAL_STORE",
                                  "state": projected, "link": None, "output": "store ops",
                                  "tool_api": [], "mutations": sorted(writes)},
                          transcripts={"assistant_reply": json.dumps(projected), "role": "assistant"},
                          concurrency=concurrency,
                          sut_path="calibration://store", sut_symbol="SyntheticStoreAdapter",
                          outcome_class="CLEAN")


class SyntheticFaultAdapter:
    adapter_id = "cal_synthetic_fault"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request
        pre = dict(request.preconditions or {}) if request else {}
        self.kind = pre.get("fault_kind", "DEPENDENCY_500")
        self.corrupt_mode = pre.get("corrupt")
        self.delay_s = float(pre.get("delay_s", 0.05))
        self.ignore_request_contract = pre.get("ignore_fault_contract", False)

    def execute(self, request) -> RawCapture:
        from harness.seams.fault import FaultHook, FaultKind
        requested = (getattr(request, "fault_schedule", ()) or [{}])[0]
        kind = self.kind if self.ignore_request_contract else (requested.get("kind") or self.kind)
        hook = FaultHook(requested.get("target", "cal_dependency"),
                         requested.get("point", "before_response"),
                         FaultKind(kind), delay_s=self.delay_s, deadline_s=0.01)
        sut = SyntheticAcademySUT()

        def dependency():
            return sut.turn(request.turns[-1]["content"] if request.turns else "")

        if kind == "LOST_RESPONSE":
            durable = {"writes": 0}
            real_dep = dependency

            def dep_with_durable():
                durable["writes"] += 1
                return real_dep()

            wrapped = hook.wrap(dep_with_durable)
            try:
                wrapped()
            except Exception:  # noqa: BLE001
                pass
            if hook.record.fired and "durable_write_proven" not in hook.record.mechanism_evidence:
                hook.record.mechanism_evidence["durable_write_proven"] = durable["writes"] >= 1
                hook.record.mechanism_evidence["durable_writes"] = durable["writes"]
        else:
            wrapped = hook.wrap(dependency)
            try:
                wrapped()
            except Exception:  # noqa: BLE001
                pass
        reaction = "BOUNDED_FALLBACK" if hook.record.fired else "CLEAN_SUCCESS"
        observed_output = f"Не удалось обработать запрос ({hook.record.fault_kind})."
        if self.corrupt_mode == "technical_error_as_success":
            observed_output = "Готово! Оплата принята."
            reaction = "CLEAN_SUCCESS"
        return RawCapture(values={"act": reaction, "origin": "CAL_FAULT_SEAM", "state": {},
                                  "link": None, "output": observed_output, "tool_api": [], "mutations": []},
                          transcripts={"assistant_reply": observed_output, "role": "assistant"},
                          fault={"fault_target": hook.record.fault_target,
                                 "fault_point": hook.record.fault_point,
                                 "fault_kind": hook.record.fault_kind,
                                 "fault_confirmed_injected": hook.record.fired,
                                 "operation_invoked": 1,
                                 "mechanism_evidence": hook.record.mechanism_evidence},
                          sut_path="calibration://fault", sut_symbol="SyntheticFaultAdapter",
                          outcome_class="CLEAN" if reaction == "CLEAN_SUCCESS" else "BOUNDED_FALLBACK")


class SyntheticNoSeamAdapter:
    adapter_id = "cal_synthetic_noseam"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request
        pre = dict(request.preconditions or {}) if request else {}
        self.fabricate = pre.get("fabricate", False)

    def execute(self, request) -> RawCapture:
        if self.fabricate:
            return RawCapture(values={"act": "PAYMENT"}, sut_path="calibration://static",
                              sut_symbol="fabricated", outcome_class="CLEAN")
        return RawCapture(values={}, sut_path="calibration://static",
                          sut_symbol="(static facts)", outcome_class="CLEAN")


class SyntheticStaticAdapter:
    adapter_id = "cal_synthetic_static"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request

    def execute(self, request) -> RawCapture:
        return RawCapture(values={"act": "STATIC_INSPECTION", "origin": "CAL_STATIC",
                                  "state": {}, "link": None, "output": "static adjudication",
                                  "tool_api": [], "mutations": []},
                          static_inspection={"facts": {"polling_only": True, "drop_pending_updates": True},
                                             "executed_queries": ["polling_only", "drop_pending_updates"],
                                             "source_basis": [{"query": "cal fixture", "file": "fixture",
                                                               "derivation": "FIXTURE", "source_sha256": "0" * 64}]},
                          sut_path="calibration://config", sut_symbol="(static inspection)",
                          outcome_class="CLEAN")


class SyntheticTechnicalErrorAdapter:
    """CORR5 F04/F14 battery fixture: satisfied deterministic observables
    with an UNACCEPTABLE native TECHNICAL_ERROR outcome — the exact input
    combination under which IV5 demonstrated a semantic/mutation promotion
    of a native-error FAIL to PASS. Calibration lane only."""

    adapter_id = "cal_synthetic_technical_error"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request

    def execute(self, request) -> RawCapture:
        return RawCapture(
            values={"act": "PAYMENT", "origin": "FIXTURE", "state": {"x": 1},
                    "link": None, "output": "fixture output", "tool_api": [],
                    "mutations": []},
            transcripts={"assistant_reply": "fixture output", "role": "assistant"},
            sut_path="calibration://technical-error", sut_symbol="TechnicalErrorFixture",
            outcome_class="TECHNICAL_ERROR",
        )


class SyntheticNoTranscriptAdapter:
    """CORR6 IV6-F04-F14 battery fixture: satisfied deterministic
    observables with NO meaningful transcript (semantic-required class) —
    the exact input under which IV6 demonstrated the runner's initial
    BENCHMARK_DEFECT being promoted to PASS by later semantic satisfaction.
    Calibration lane only."""

    adapter_id = "cal_synthetic_no_transcript"

    def __init__(self, *, request=None, token=None, spec=None) -> None:
        self.request = request

    def execute(self, request) -> RawCapture:
        return RawCapture(
            values={"act": "CLARIFICATION", "origin": "FIXTURE",
                    "state": {"x": 1}, "link": None,
                    "output": "fixture output", "tool_api": [], "mutations": []},
            transcripts={},
            sut_path="calibration://no-transcript",
            sut_symbol="NoTranscriptFixture",
            outcome_class="CLEAN",
        )


CALIBRATION_REGISTRY = {
    "schema": "CALIBRATION_REGISTRY_V3",
    "adapters": {
        "cal_synthetic_academy": {
            "adapter_id": "cal_synthetic_academy",
            "implementation_class": "adapters.calibration.SyntheticAcademyAdapter",
            "provenance_class": "SYNTHETIC_CALIBRATION", "lane": "CALIBRATION",
            "execution_level": "L1", "supported_failure_classes": [],
            "native_observables": ["courseMatch", "selectedCourseId"],
            "real_fault_hooks": [], "schedulable_operation": None,
        },
        "cal_synthetic_store": {
            "adapter_id": "cal_synthetic_store",
            "implementation_class": "adapters.calibration.SyntheticStoreAdapter",
            "provenance_class": "SYNTHETIC_CALIBRATION", "lane": "CALIBRATION",
            "execution_level": "L5", "supported_failure_classes": [],
            "native_observables": ["selectedCourseId"],
            "real_fault_hooks": [], "schedulable_operation": "cal store save",
        },
        "cal_synthetic_fault": {
            "adapter_id": "cal_synthetic_fault",
            "implementation_class": "adapters.calibration.SyntheticFaultAdapter",
            "provenance_class": "SYNTHETIC_CALIBRATION", "lane": "CALIBRATION",
            "execution_level": "L5", "supported_failure_classes": [],
            "native_observables": [],
            "real_fault_hooks": ["DEPENDENCY_500", "LOST_RESPONSE", "TIMEOUT_AFTER_PROCESSING",
                                 "DEPENDENCY_429", "TIMEOUT_BEFORE_PROCESSING",
                                 "MALFORMED_DEPENDENCY_PAYLOAD", "IDEMPOTENCY_EXPIRY",
                                 "DUPLICATED_UPDATE", "REORDERED_UPDATE",
                                 "SEND_FAILURE_AFTER_DURABLE_WRITE", "DELAYED_CALLBACK",
                                 "PERSISTENCE_FAILURE"],
            "schedulable_operation": None,
        },
        "cal_synthetic_noseam": {
            "adapter_id": "cal_synthetic_noseam",
            "implementation_class": "adapters.calibration.SyntheticNoSeamAdapter",
            "provenance_class": "SYNTHETIC_CALIBRATION", "lane": "CALIBRATION",
            "execution_level": "L1", "supported_failure_classes": [],
            "native_observables": [], "real_fault_hooks": [], "schedulable_operation": None,
        },
        "cal_synthetic_technical_error": {
            "adapter_id": "cal_synthetic_technical_error",
            "implementation_class": "adapters.calibration.SyntheticTechnicalErrorAdapter",
            "provenance_class": "SYNTHETIC_CALIBRATION", "lane": "CALIBRATION",
            "execution_level": "L1", "supported_failure_classes": [],
            "native_observables": ["x"], "real_fault_hooks": [],
            "schedulable_operation": None,
        },
        "cal_synthetic_no_transcript": {
            "adapter_id": "cal_synthetic_no_transcript",
            "implementation_class": "adapters.calibration.SyntheticNoTranscriptAdapter",
            "provenance_class": "SYNTHETIC_CALIBRATION", "lane": "CALIBRATION",
            "execution_level": "L1", "supported_failure_classes": [],
            "native_observables": ["x"], "real_fault_hooks": [],
            "schedulable_operation": None,
        },
        "cal_synthetic_static": {
            "adapter_id": "cal_synthetic_static",
            "implementation_class": "adapters.calibration.SyntheticStaticAdapter",
            "provenance_class": "STATIC_INSPECTION", "lane": "CALIBRATION",
            "execution_level": "L1", "supported_failure_classes": [],
            "native_observables": [], "real_fault_hooks": [], "schedulable_operation": None,
        },
    },
    "non_constructible_lanes": {},
}
