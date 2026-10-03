"""Background task and thread ownership for one benchmark attempt.

Owned asyncio tasks are awaited or cancelled within a hard bound. Owned
threads are joined with a bound. A thread or task that is still alive after
that bound fails the apparatus closed. Completed executor workers are shut
down with the attempt and are not classified as leaked work. Daemon survival
is not accepted. No await in the shutdown path is unbounded.

An inner asyncio.run settles the inner loop only. It does not close the outer
attempt boundary. The runner's finish_attempt is the close point. Cleanup of
a cancellation swallower is bounded, and a watchdog outside the loop enforces
a hard deadline that in-loop tasks cannot swallow.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import threading
import time
from typing import Any


_STACK: list["AttemptBoundary"] = []
_ASYNC_INSTALLED = False
_TERMINATED_OK = frozenset({"BACKGROUND_WORK_TERMINATED", "THREADS_TERMINATED"})


def _is_harness_thread(thread: threading.Thread) -> bool:
    """Harness infrastructure is not product attempt work."""
    name = str(getattr(thread, "name", "") or "")
    if name == "academy-executor-shutdown" or name == "supabase-loopback":
        return True
    if name.startswith("academy-harness-"):
        return True
    return bool(getattr(thread, "_academy_harness_owned", False))


def note_harness_thread(thread: threading.Thread) -> None:
    setattr(thread, "_academy_harness_owned", True)


def _accurate_status(fail_closed: bool, status: str) -> str:
    if fail_closed and status in _TERMINATED_OK:
        return "LIFECYCLE_FAIL_CLOSED"
    return status


def _redact_report(report: dict[str, Any]) -> dict[str, Any]:
    """Redact task and thread names before the report can be stored."""
    from .pd_f04_provider_evidence import redact

    safe = redact(report)
    return safe if isinstance(safe, dict) else {"__evidence_retained__": True}


def _bounded_drain(loop: asyncio.AbstractEventLoop, timeout: float) -> list[str]:
    """Cancel leftover tasks and wait at most `timeout`. Do not wait forever."""
    if loop.is_closed() or loop.is_running():
        return []
    pending = [task for task in asyncio.all_tasks(loop) if not task.done()]
    names = [task.get_name() for task in pending]
    for task in pending:
        task.cancel()
    if not pending:
        return []

    async def _wait() -> None:
        await asyncio.wait(pending, timeout=timeout)

    try:
        loop.run_until_complete(_wait())
    except Exception:
        pass
    return [task.get_name() for task in pending if not task.done()]


def product_work_budget(boundary: "AttemptBoundary | None") -> float:
    """Authorized product work. The cleanup deadline is not this budget."""
    if boundary is None:
        return 120.0
    explicit = getattr(boundary, "work_budget_s", None)
    if explicit is None:
        return 120.0
    return max(0.0, float(explicit))


def background_cleanup_budget(boundary: "AttemptBoundary | None") -> float:
    """Hard bound for cleanup after product work has finished."""
    if boundary is None:
        return 2.0
    explicit = getattr(boundary, "cleanup_budget_s", None)
    if explicit is not None:
        return max(0.05, float(explicit))
    return max(0.05, float(boundary.join_timeout))


def _bounded_asyncio_run(main: Any, *, debug: Any = None, boundary: "AttemptBoundary | None" = None) -> Any:
    """asyncio.run replacement whose cleanup cannot hang on a cancellation swallower.

    The outer timer is the authorized work budget plus the separate cleanup
    budget. It is not an 8-second cap on useful product work. CancelledError
    from that timer is contained here.
    """
    if not asyncio.iscoroutine(main):
        raise ValueError(f"a coroutine was expected, got {main!r}")
    loop = asyncio.new_event_loop()
    active = boundary is not None and not boundary._finished
    work_budget = product_work_budget(boundary) if active else 120.0
    cleanup_budget = background_cleanup_budget(boundary) if active else 2.0
    hard = work_budget + cleanup_budget + 1.0
    stopped = {"value": False}

    def _force_stop() -> None:
        stopped["value"] = True
        if loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(loop.stop)
        except Exception:
            pass

    timer = threading.Timer(hard, _force_stop)
    timer.daemon = True
    timer.name = "academy-harness-deadline"
    note_harness_thread(timer)
    try:
        asyncio.set_event_loop(loop)
        if debug is not None:
            loop.set_debug(bool(debug))
        if boundary is not None and not boundary._finished:

            async def enclosed() -> Any:
                boundary.attach_running_loop()
                try:
                    return await main
                finally:
                    await boundary.settle_inner_loop(join_timeout=background_cleanup_budget(boundary))

            target: Any = enclosed()
        else:
            target = main
        timer.start()
        try:
            return loop.run_until_complete(target)
        except RuntimeError:
            if not stopped["value"]:
                raise
            if boundary is not None:
                boundary.note_deadline_expired(loop)
            return None
        except asyncio.CancelledError:
            if boundary is not None:
                boundary.note_cancelled()
                if stopped["value"]:
                    boundary.note_deadline_expired(loop)
            return None
        finally:
            timer.cancel()
            leftover = _bounded_drain(loop, 0.4)
            if boundary is not None and leftover:
                boundary.note_abandoned_tasks(leftover)
    finally:
        try:
            if not loop.is_closed():
                if loop.is_running():
                    loop.stop()
                loop.close()
        except Exception:
            pass
        try:
            asyncio.set_event_loop(None)
        except Exception:
            pass


def _ensure_async_patches() -> None:
    """Account for asyncio.run, create_task, and to_thread on the active boundary.

    The replacement runner owns loop cleanup. The stdlib asyncio.run finally
    block waits forever when a task swallows CancelledError, so it is not used
    once the apparatus is installed.
    """
    global _ASYNC_INSTALLED
    if _ASYNC_INSTALLED:
        return

    def wrapped_run(main: Any, *, debug: Any = None) -> Any:
        boundary = _STACK[-1] if _STACK else None
        if boundary is not None and boundary._finished:
            boundary = None
        return _bounded_asyncio_run(main, debug=debug, boundary=boundary)

    asyncio.run = wrapped_run
    original_create = asyncio.BaseEventLoop.create_task

    def wrapped_create(self: asyncio.BaseEventLoop, coro: Any, *, name: str | None = None) -> asyncio.Task:
        if name is None:
            task = original_create(self, coro)
        else:
            task = original_create(self, coro, name=name)
        if _STACK:
            _STACK[-1].note_task(task)
        return task

    asyncio.BaseEventLoop.create_task = wrapped_create  # type: ignore[assignment]
    if hasattr(asyncio, "to_thread"):
        original_to_thread = asyncio.to_thread

        async def wrapped_to_thread(func: Any, *args: Any, **kwargs: Any) -> Any:
            if _STACK:
                _STACK[-1].note_executor_call(getattr(func, "__name__", "to_thread"))
            return await original_to_thread(func, *args, **kwargs)

        asyncio.to_thread = wrapped_to_thread
    _ASYNC_INSTALLED = True


def _shutdown_executor(executor: concurrent.futures.ThreadPoolExecutor, timeout: float) -> bool:
    finished = threading.Event()

    def _close() -> None:
        try:
            executor.shutdown(wait=True, cancel_futures=True)
        finally:
            finished.set()

    worker = threading.Thread(target=_close, name="academy-executor-shutdown", daemon=True)
    note_harness_thread(worker)
    worker.start()
    return finished.wait(timeout)


class AttemptBoundary:
    def __init__(self) -> None:
        self.baseline_threads: set[int] = set()
        self.baseline_tasks: set[int] = set()
        self.created_threads: list[threading.Thread] = []
        self.harness_threads: list[str] = []
        self.created_tasks: list[asyncio.Task] = []
        self.report: dict[str, Any] = {}
        self.join_timeout = 2.0
        self.work_budget_s = 120.0
        self.cleanup_budget_s: float | None = None
        self.cancelled_error_contained = False
        self._finished = False
        self._start_patched = False
        self._original_start = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._previous_factory = None
        self._previous_executor = None
        self._executor: concurrent.futures.ThreadPoolExecutor | None = None
        self._owned_ids: list[int] = []
        self.to_thread_calls: list[str] = []
        self.inner_remaining_tasks: list[str] = []
        self.inner_fail_closed = False
        self.inner_executor_closed: bool | None = None
        self.deadline_expired = False
        self.abandoned_tasks: list[str] = []

    def note_task(self, task: asyncio.Task) -> None:
        if task not in self.created_tasks:
            self.created_tasks.append(task)

    def note_executor_call(self, name: str) -> None:
        self.to_thread_calls.append(name)

    def note_abandoned_tasks(self, names: list[str]) -> None:
        for name in names:
            if name not in self.abandoned_tasks:
                self.abandoned_tasks.append(name)
            if name not in self.inner_remaining_tasks:
                self.inner_remaining_tasks.append(name)
        if names:
            self.inner_fail_closed = True

    def note_cancelled(self) -> None:
        self.cancelled_error_contained = True

    def note_deadline_expired(self, loop: asyncio.AbstractEventLoop) -> None:
        self.deadline_expired = True
        self.inner_fail_closed = True
        try:
            names = [task.get_name() for task in asyncio.all_tasks(loop) if not task.done()]
        except Exception:
            names = ["UNREADABLE_TASK"]
        self.note_abandoned_tasks(names or ["HARD_DEADLINE"])

    def _push(self) -> None:
        if self not in _STACK:
            _STACK.append(self)

    def _pop_stack(self) -> None:
        try:
            _STACK.remove(self)
        except ValueError:
            pass

    def begin(self) -> None:
        _ensure_async_patches()
        self._push()
        self.baseline_threads = {
            thread.ident for thread in threading.enumerate() if thread.ident is not None
        }
        self.created_threads = []
        self._owned_ids = []
        self._finished = False
        if not self._start_patched:
            original = threading.Thread.start

            def wrapped_start(thread: threading.Thread, *args: Any, **kwargs: Any) -> None:
                if _is_harness_thread(thread):
                    if thread.name not in self.harness_threads:
                        self.harness_threads.append(thread.name)
                    return original(thread, *args, **kwargs)
                if id(thread) not in self._owned_ids:
                    self._owned_ids.append(id(thread))
                    self.created_threads.append(thread)
                return original(thread, *args, **kwargs)

            self._original_start = original
            threading.Thread.start = wrapped_start
            self._start_patched = True

    def begin_async(self) -> None:
        self.begin()
        try:
            self.baseline_tasks = {id(task) for task in asyncio.all_tasks()}
        except RuntimeError:
            self.baseline_tasks = set()
        self.attach_running_loop()

    def attach_running_loop(self) -> None:
        loop = asyncio.get_running_loop()
        if self._loop is loop and self._executor is not None:
            return
        self._loop = loop
        self._previous_factory = loop.get_task_factory()
        self._previous_executor = getattr(loop, "_default_executor", None)

        def factory(bound_loop: asyncio.AbstractEventLoop, coro: Any) -> asyncio.Task:
            task = asyncio.Task(coro, loop=bound_loop)
            if task not in self.created_tasks:
                self.created_tasks.append(task)
            return task

        loop.set_task_factory(factory)
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=4,
            thread_name_prefix="academy-attempt",
        )
        loop.set_default_executor(self._executor)

    def _restore_start(self) -> None:
        if self._start_patched and self._original_start is not None:
            threading.Thread.start = self._original_start
            self._start_patched = False

    def _restore_loop(self) -> None:
        loop = self._loop
        if loop is None:
            return
        try:
            loop.set_task_factory(self._previous_factory)
        except Exception:
            pass
        try:
            loop.set_default_executor(self._previous_executor)
        except Exception:
            setattr(loop, "_default_executor", self._previous_executor)
        self._loop = None

    async def settle_inner_loop(self, *, join_timeout: float = 2.0) -> dict[str, Any]:
        """Account for one inner event loop without closing the outer attempt.

        The stdlib loop is about to be discarded. Tasks that swallow
        CancelledError are recorded and abandoned after the bound. The outer
        boundary stays on the stack and keeps owning later product threads.
        """
        current = asyncio.current_task()
        for task in list(asyncio.all_tasks()):
            if task is current or id(task) in self.baseline_tasks:
                continue
            if task not in self.created_tasks:
                self.created_tasks.append(task)
        created = [task for task in self.created_tasks if task is not current]
        cancelled: list[str] = []
        completed: list[str] = []
        errors: list[dict[str, str]] = []
        for task in created:
            if task.done() and not task.cancelled():
                completed.append(task.get_name())
        pending = [task for task in created if not task.done()]
        for task in pending:
            task.cancel()
            cancelled.append(task.get_name())
        still: list[str] = []
        if pending:
            _done, still_pending = await asyncio.wait(pending, timeout=join_timeout)
            for task in pending:
                if task in still_pending or not task.done():
                    if task.get_name() not in still:
                        still.append(task.get_name())
                    continue
                if task.cancelled():
                    if task.get_name() not in cancelled:
                        cancelled.append(task.get_name())
                    continue
                try:
                    exc = task.exception()
                except asyncio.CancelledError:
                    if task.get_name() not in cancelled:
                        cancelled.append(task.get_name())
                    continue
                if exc is not None:
                    errors.append({"task": task.get_name(), "error_class": type(exc).__name__})
                if task.get_name() not in completed:
                    completed.append(task.get_name())
        executor_closed = True
        if self._executor is not None:
            executor_closed = _shutdown_executor(self._executor, min(join_timeout, 1.0))
            self._executor = None
        self._restore_loop()
        self.inner_remaining_tasks = list(still)
        self.inner_executor_closed = executor_closed
        self.inner_fail_closed = bool(still) or not executor_closed
        status = "BACKGROUND_WORK_UNTERMINATED" if self.inner_fail_closed else "BACKGROUND_WORK_TERMINATED"
        status = _accurate_status(self.inner_fail_closed, status)
        report = {
            "inner_loop_settled": True,
            "outer_boundary_open": True,
            "baseline_task_count": len(self.baseline_tasks),
            "created_task_count": len(created),
            "cancelled_tasks": cancelled,
            "cancelled_task_count": len(cancelled),
            "completed_tasks": completed,
            "completed_task_count": len(completed),
            "still_alive_tasks": still,
            "remaining_task_count": len(still),
            "task_errors": errors,
            "executor_closed": executor_closed,
            "to_thread_calls": list(self.to_thread_calls),
            "fail_closed": self.inner_fail_closed,
            "status": status,
            "continue_to_next_scenario": not self.inner_fail_closed,
            "harness_threads_excluded": list(self.harness_threads),
        }
        self.report = _redact_report(report)
        return self.report

    def finish(self, *, join_timeout: float = 2.0) -> dict[str, Any]:
        if self._finished and self.report:
            return self.report
        self.join_timeout = join_timeout
        deadline = time.monotonic() + join_timeout
        joined: list[str] = []
        still_alive: list[str] = []
        seen: set[int] = set()
        product_threads = [thread for thread in self.created_threads if not _is_harness_thread(thread)]
        try:
            while True:
                pending = [thread for thread in product_threads if id(thread) not in seen]
                if not pending:
                    break
                for thread in pending:
                    seen.add(id(thread))
                    remaining = max(0.0, deadline - time.monotonic())
                    thread.join(timeout=remaining)
                    if thread.is_alive():
                        still_alive.append(thread.name)
                    else:
                        joined.append(thread.name)
                if time.monotonic() >= deadline:
                    for thread in product_threads:
                        if id(thread) in seen:
                            continue
                        seen.add(id(thread))
                        if thread.is_alive():
                            still_alive.append(thread.name)
                        else:
                            joined.append(thread.name)
                    break
        finally:
            self._restore_start()
            self._pop_stack()
        task_names = list(self.inner_remaining_tasks)
        for name in self.abandoned_tasks:
            if name not in task_names:
                task_names.append(name)
        cancelled = bool(self.cancelled_error_contained)
        fail_closed = (
            bool(still_alive)
            or self.inner_fail_closed
            or self.deadline_expired
            or bool(task_names)
            or cancelled
        )
        if cancelled and not (still_alive or task_names or self.deadline_expired or self.inner_fail_closed):
            status = "LIFECYCLE_FAIL_CLOSED"
        elif task_names or self.deadline_expired:
            status = "BACKGROUND_WORK_UNTERMINATED"
        elif fail_closed:
            status = "BACKGROUND_THREAD_UNTERMINATED"
        else:
            status = "THREADS_TERMINATED"
        status = _accurate_status(fail_closed, status)
        self.report = {
            "baseline_thread_count": len(self.baseline_threads),
            "created_thread_count": len(product_threads),
            "joined_threads": joined,
            "joined_thread_count": len(joined),
            "still_alive_threads": still_alive,
            "remaining_thread_count": len(still_alive),
            "harness_threads_excluded": list(self.harness_threads),
            "ownership_classes": {
                "HARNESS_INFRA_THREAD": list(self.harness_threads),
                "PRODUCT_ATTEMPT_THREAD": [thread.name for thread in product_threads],
            },
            "still_alive_tasks": task_names,
            "remaining_task_count": len(task_names),
            "executor_closed": True if self.inner_executor_closed is None else self.inner_executor_closed,
            "to_thread_calls": list(self.to_thread_calls),
            "inner_loop_settled": bool(self.report.get("inner_loop_settled")),
            "outer_boundary_closed_by": "ATTEMPT_FINISH",
            "deadline_expired": self.deadline_expired,
            "cancelled_error_contained": cancelled,
            "fail_closed": fail_closed,
            "status": status,
            "continue_to_next_scenario": not fail_closed,
            "daemon_survival_accepted": False,
            "preexisting_threads_excluded": True,
            "finished_at": time.time(),
        }
        self.report = _redact_report(self.report)
        self._finished = True
        return self.report

    async def finish_async(self, *, join_timeout: float = 2.0) -> dict[str, Any]:
        if self._finished and self.report.get("created_task_count") is not None and not self.report.get("outer_boundary_open"):
            return self.report
        inner = await self.settle_inner_loop(join_timeout=join_timeout)
        thread_report = self.finish(join_timeout=join_timeout)
        fail_closed = bool(thread_report.get("fail_closed")) or bool(inner.get("fail_closed"))
        status = _accurate_status(fail_closed, str(thread_report.get("status") or inner.get("status") or ""))
        report = {
            **inner,
            **thread_report,
            "fail_closed": fail_closed,
            "status": status,
            "continue_to_next_scenario": not fail_closed,
            "outer_boundary_open": False,
        }
        report["status"] = _accurate_status(bool(report.get("fail_closed")), str(report.get("status") or ""))
        if report.get("cancelled_error_contained"):
            report["fail_closed"] = True
            report["continue_to_next_scenario"] = False
        self.report = _redact_report(report)
        self._finished = True
        return self.report
