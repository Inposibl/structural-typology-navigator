"""Real isolated concurrency seam — CORR2 (M-6, owner section 39).

Overlap must occur at the ACTUAL PRODUCT OPERATION being claimed. Every
operation records: worker identity, thread/task identity, operation
start/end, and the TARGET SEAM symbol being exercised. The overlap proof
carries all of it; the oracle refuses claims where measured worker count /
distinct identities do not match the claim, or where no seam was recorded.

Both thread-based and same-loop asyncio scheduling are provided (the Alexey
per-user lock seam is an asyncio.Lock and must be contended on one loop).
"""

from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class OverlapProof:
    workers: int
    intervals: list[list[int]]
    worker_ids: list[str]
    thread_ids: list[int]
    target_seam: str
    schedule_id: str
    overlap_proven: bool
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class ConcurrencyOpResult:
    value: Any
    worker_id: str
    thread_id: int
    start_ns: int
    end_ns: int
    target_seam: str


class InFlightSync:
    def __init__(self, barrier: threading.Barrier) -> None:
        self._barrier = barrier

    def rendezvous(self, timeout: float = 10.0) -> None:
        self._barrier.wait(timeout=timeout)


def run_concurrent_operations(
    operations: list[Callable[[int, InFlightSync], ConcurrencyOpResult]],
    *,
    schedule_id: str,
    start_barrier_timeout: float = 10.0,
) -> tuple[list[Any], OverlapProof]:
    """Thread-based concurrent execution with seam-level instrumentation.

    Each operation returns a ConcurrencyOpResult carrying its own measured
    window (start/end are captured AROUND the product operation by the
    operation itself), worker identity, and the target seam symbol."""
    n = len(operations)
    if n < 2:
        raise ValueError("Concurrency requires at least two operations.")
    barrier = threading.Barrier(n)
    rendezvous_barrier = threading.Barrier(n)
    results: list[Any] = [None] * n
    op_results: list[ConcurrencyOpResult] = []
    errors: list[BaseException | None] = [None] * n

    def worker(idx: int, op: Callable[[int, InFlightSync], ConcurrencyOpResult]) -> None:
        try:
            barrier.wait(timeout=start_barrier_timeout)
            res = op(idx, InFlightSync(rendezvous_barrier))
            results[idx] = res.value
            op_results.append(res)
        except BaseException as exc:  # noqa: BLE001 - surfaced, never scored
            errors[idx] = exc

    threads = [
        threading.Thread(target=worker, args=(i, operations[i]), name=f"conc-{schedule_id}-{i}")
        for i in range(n)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for i, err in enumerate(errors):
        if err is not None:
            raise RuntimeError(f"concurrent worker {i} raised: {err!r}") from err

    op_results.sort(key=lambda r: r.start_ns)
    intervals = [[r.start_ns, r.end_ns] for r in op_results]
    worker_ids = [r.worker_id for r in op_results]
    thread_ids = [r.thread_id for r in op_results]
    seams = {r.target_seam for r in op_results}
    overlap = (
        n >= 2
        and len(intervals) == n
        and len(seams) == 1
        and None not in seams
        and max(i[0] for i in intervals) < min(i[1] for i in intervals)
    )
    proof = OverlapProof(
        workers=n,
        intervals=intervals,
        worker_ids=worker_ids,
        thread_ids=thread_ids,
        target_seam=(seams.pop() if len(seams) == 1 else ";".join(sorted(seams))),
        schedule_id=schedule_id,
        overlap_proven=overlap,
        evidence={
            "max_start_ns": max(i[0] for i in intervals) if intervals else None,
            "min_end_ns": min(i[1] for i in intervals) if intervals else None,
            "distinct_threads": len(set(thread_ids)),
        },
    )
    return results, proof


async def run_concurrent_async(
    operations: list[Callable[[], Awaitable[ConcurrencyOpResult]]],
    *,
    schedule_id: str,
) -> tuple[list[Any], OverlapProof]:
    """Same-event-loop asyncio execution for asyncio-native seams (e.g. the
    Alexey per-user asyncio.Lock): all tasks are scheduled on ONE loop, so the
    lock contention the product implements is the contention we measure."""
    op_results = await asyncio.gather(*(op() for op in operations))
    results = [r.value for r in op_results]
    op_results = sorted(op_results, key=lambda r: r.start_ns)
    intervals = [[r.start_ns, r.end_ns] for r in op_results]
    worker_ids = [r.worker_id for r in op_results]
    thread_ids = [r.thread_id for r in op_results]
    seams = {r.target_seam for r in op_results}
    n = len(operations)
    overlap = (
        n >= 2
        and len(intervals) == n
        and len(seams) == 1
        and None not in seams
        and max(i[0] for i in intervals) < min(i[1] for i in intervals)
    )
    proof = OverlapProof(
        workers=n,
        intervals=intervals,
        worker_ids=worker_ids,
        thread_ids=thread_ids,
        target_seam=(seams.pop() if len(seams) == 1 else ";".join(sorted(seams))),
        schedule_id=schedule_id,
        overlap_proven=overlap,
        evidence={"scheduler": "asyncio.same_loop", "distinct_tasks": len(worker_ids)},
    )
    return results, proof
