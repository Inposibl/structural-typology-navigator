"""CORR6 concurrent hygiene probe.

Runs focused suites at the same time, each in its own process group with its
own private temporary root, then checks that every run passed, that no
JSONDecodeError appeared, that the roots and hygiene reports are distinct and
clean, that no child process outlived its suite, and that no canonical
artifact byte changed.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

BENCH = Path(__file__).resolve().parents[1]
CANONICAL_PARENT = Path("/Users/entp_psyche/Desktop/InvestProjects2026/execution-infrastructure")
DEFAULT_SUITES = (
    "execution_infrastructure_implementation_1_corr1",
    "execution_infrastructure_implementation_1_corr1",
    "execution_infrastructure_implementation_1_corr2",
)


def _canonical_digest() -> dict[str, str]:
    rows: dict[str, str] = {}
    for root in sorted(CANONICAL_PARENT.glob("ACADEMY_TELEGRAM_EXECUTION_INFRASTRUCTURE_*")):
        for path in sorted(root.rglob("*")):
            # Replicas are excluded, and so is anything credential-shaped:
            # this probe never opens credential fixtures.
            if (
                path.is_file()
                and not path.is_symlink()
                and "navigator-replica" not in path.parts
                and not any("credential" in part.lower() or part.startswith(".env") for part in path.parts)
            ):
                rows[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    return rows


def _benchmark_processes() -> list[dict[str, Any]]:
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True, check=False).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and (
            "corr2_preload_keepalive" in parts[2]
            or "next/dist/bin/next" in parts[2]
            or "academy-execution-preload" in parts[2]
            or "next-server (v" in parts[2]
        ):
            rows.append({"pid": int(parts[0]), "ppid": int(parts[1]), "command": parts[2][:200]})
    return rows


def run_probe(suites: tuple[str, ...] = DEFAULT_SUITES) -> dict[str, Any]:
    base = Path(tempfile.mkdtemp(prefix="academy-corr6-concurrent-"))
    canonical_before = _canonical_digest()
    processes_before = {row["pid"] for row in _benchmark_processes()}
    launched = []
    for index, suite in enumerate(suites):
        report = base / f"{index}-{suite}.hygiene.json"
        env = dict(os.environ)
        env.update({
            "PYTHONDONTWRITEBYTECODE": "1",
            "ACADEMY_SUITE_HYGIENE_REPORT": str(report),
        })
        for key in ("ACADEMY_CORR4_ARTIFACT_ROOT", "ACADEMY_CORR5_ARTIFACT_ROOT", "ACADEMY_CORR6_ARTIFACT_ROOT",
                    "ACADEMY_AUTHOR_ARTIFACT_ROOT", "ACADEMY_CORR5_TOPOLOGY", "ACADEMY_CORR4_TOPOLOGY"):
            env.pop(key, None)
        stdout = (base / f"{index}-{suite}.stdout").open("w", encoding="utf-8")
        stderr = (base / f"{index}-{suite}.stderr").open("w", encoding="utf-8")
        process = subprocess.Popen(
            [sys.executable, "-B", f"tests/{suite}.py"],
            cwd=str(BENCH), env=env, stdout=stdout, stderr=stderr,
        )
        launched.append((index, suite, process, report, stdout, stderr))
    rows = []
    for index, suite, process, report, stdout, stderr in launched:
        code = process.wait(timeout=900)
        stdout.close()
        stderr.close()
        text = (base / f"{index}-{suite}.stdout").read_text(encoding="utf-8")
        err = (base / f"{index}-{suite}.stderr").read_text(encoding="utf-8", errors="replace")
        start = text.find('{\n  "focused')
        summary = json.loads(text[start:]) if start >= 0 else {}
        hygiene = json.loads(report.read_text(encoding="utf-8")) if report.exists() else {}
        rows.append({
            "suite": suite,
            "returncode": code,
            "pass": summary.get("focused_tests_pass"),
            "fail": summary.get("focused_tests_fail"),
            "json_decode_error_seen": "JSONDecodeError" in text or "JSONDecodeError" in err,
            "temp_root": hygiene.get("temp_root"),
            "hygiene_clean": hygiene.get("no_child_process_left"),
            "survivors_at_exit": hygiene.get("survivors_at_exit"),
            "tracked_child_count": hygiene.get("tracked_child_count"),
        })
    time.sleep(1.0)
    processes_after = _benchmark_processes()
    new_processes = [row for row in processes_after if row["pid"] not in processes_before]
    canonical_after = _canonical_digest()
    roots = [row["temp_root"] for row in rows]
    document = {
        "act": "IMPLEMENTATION-1.CORR6",
        "provider_contact": "NONE",
        "benchmark_scenarios_executed": 0,
        "base": str(base),
        "concurrent_suites": list(suites),
        "runs": rows,
        "distinct_temp_roots": len(set(roots)) == len(roots) and all(roots),
        "pre_existing_benchmark_processes": sorted(processes_before),
        "new_orphan_processes": new_processes,
        "canonical_files_checked": len(canonical_before),
        "canonical_artifacts_unchanged": canonical_before == canonical_after,
    }
    document["ok"] = bool(
        all(row["returncode"] == 0 and row["fail"] == 0 for row in rows)
        and not any(row["json_decode_error_seen"] for row in rows)
        and all(row["hygiene_clean"] is True for row in rows)
        and document["distinct_temp_roots"]
        and not new_processes
        and document["canonical_artifacts_unchanged"]
    )
    return document


def main() -> int:
    sys.dont_write_bytecode = True
    document = run_probe()
    text = json.dumps(document, indent=2, sort_keys=True) + "\n"
    target = os.environ.get("ACADEMY_CORR6_HYGIENE_OUT")
    if target:
        Path(target).write_text(text, encoding="utf-8")
    print(text)
    return 0 if document["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
