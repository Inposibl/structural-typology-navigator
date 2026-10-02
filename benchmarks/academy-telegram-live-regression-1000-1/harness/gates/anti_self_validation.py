"""Anti-self-validation static gate v2 — CORR2 (B-1, owner section 11).

Detects every path by which expected material could populate actual/runtime
evidence, including the IV2 counterexample classes:

- direct + alias flow (expected_dict aliases, helper functions);
- dict-unpack and nested-object flows;
- subscript access: spec["expected"], scenario["EXPECTED_*"];
- observe-sink flow: any .observe()/set_observed() call whose value argument
  references expected material;
- case-specific branches keyed by scenario_id as Name OR
  subscript/attribute;
- actual initialization from non-UNOBSERVED literals;
- canned ObservedValue literals in adjudication code;
- unconditional PASS returns outside the canonical derivation point;
- scanner pointed at user input;
- AST PARSE FAILURE IS ITSELF A VIOLATION (owner: do not exclude parse
  failures from violation totals).
"""

from __future__ import annotations

import ast
import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_RE = ("expected", "pass_conditions", "fail_conditions")
ACTUAL_RE = ("actual",)

RULES = {
    "ASV-1": "expected->actual data flow (direct, alias, unpack, subscript, nested, kwarg)",
    "ASV-2": "actual field initialized from a non-UNOBSERVED literal",
    "ASV-3": "unconditional PASS return (no governing guard) in adjudication code",
    "ASV-4": "bare pass used in place of an oracle body",
    "ASV-5": "prohibited-output scanning pointed at user input instead of system output",
    "ASV-6": "hard-coded per-scenario verdict branch (scenario/test-id constant comparison)",
    "ASV-7": "canned literal output constructed as runtime actual evidence",
    "ASV-8": "AST parse failure (unparseable file fails the gate)",
}


@dataclass
class Finding:
    rule: str
    file: str
    line: int
    detail: str


def _name_matches(name: str, fragments: tuple[str, ...]) -> bool:
    low = name.lower()
    return any(f in low for f in fragments)


def _expected_ref(node: ast.AST) -> str | None:
    """Any reference to expected material inside an expression: names,
    attributes, string constants, subscript keys/slices, nested anywhere."""
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and _name_matches(sub.id, EXPECTED_RE) and "expected_invariant" not in sub.id.lower():
            return f"Name({sub.id})"
        if isinstance(sub, ast.Attribute) and _name_matches(sub.attr, EXPECTED_RE):
            return f"Attribute({sub.attr})"
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and sub.value.upper().startswith(("EXPECTED_", "PASS_CONDITIONS", "FAIL_CONDITIONS")):
            return f"Constant({sub.value!r})"
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and sub.value.lower() in ("expected", "expected_state", "expected_act", "expected_origin", "expected_link"):
            return f"Constant({sub.value!r})"
    return None


def _actual_target(targets: list[ast.expr]) -> str | None:
    for t in targets:
        for sub in ast.walk(t):
            if isinstance(sub, ast.Name) and _name_matches(sub.id, ACTUAL_RE):
                return sub.id
            if isinstance(sub, ast.Attribute) and _name_matches(sub.attr, ACTUAL_RE):
                return sub.attr
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and _name_matches(sub.value, ACTUAL_RE):
                return sub.value
    return None


class Gate(ast.NodeVisitor):
    def __init__(self, relpath: str, source: str, scope: str) -> None:
        self.relpath = relpath
        self.scope = scope
        self.findings: list[Finding] = []
        self._func_stack: list[str] = []
        # alias table: local names bound to expected-ish expressions
        self._expected_aliases: set[str] = set()

    def _add(self, rule: str, node: ast.AST, detail: str) -> None:
        self.findings.append(Finding(rule=rule, file=self.relpath, line=node.lineno, detail=detail))

    # ---- alias tracking --------------------------------------------------
    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._func_stack.append(node.name)
        saved = set(self._expected_aliases)
        if node.name.lower().startswith(("oracle_", "score_", "evaluate_")):
            for stmt in ast.walk(node):
                if isinstance(stmt, ast.Pass) and any(isinstance(s, ast.Pass) for s in node.body):
                    self._add("ASV-4", stmt, f"bare pass in oracle function {node.name}")
        self.generic_visit(node)
        # closure-safe: aliases persist beyond the scope (IV3 closure leak)
        self._expected_aliases |= saved
        self._func_stack.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Lambda(self, node: ast.Lambda) -> None:
        if ref := _expected_ref(node.body):
            self._add("ASV-1", node, f"lambda body references expected material {ref}")
        for sub in ast.walk(node.body):
            if isinstance(sub, ast.Name) and sub.id in self._expected_aliases:
                self._add("ASV-1", node, f"lambda body fed from expected alias {sub.id!r}")
                break
        self.generic_visit(node)

    def _track_alias(self, node: ast.AST, targets: list[ast.expr], value: ast.AST) -> None:
        """If a local name is bound to expected material, mark it as an
        expected alias; ANY later use of it in an observe-sink or actual
        assignment is a violation."""
        ref = _expected_ref(value)
        if ref:
            for t in targets:
                if isinstance(t, ast.Name):
                    self._expected_aliases.add(t.id)
                    # the alias assignment itself is only a violation when the
                    # target is an actual-ish name; otherwise just track it
                    if _name_matches(t.id, ACTUAL_RE):
                        self._add("ASV-1", node, f"actual target {t.id!r} aliases expected reference {ref}")

    def _check_actual_assign(self, node: ast.AST, targets: list[ast.expr], value: ast.AST) -> None:
        actual_target = _actual_target(targets)
        if actual_target is not None:
            if ref := _expected_ref(value):
                self._add("ASV-1", node, f"target {actual_target!r} assigned from expected reference {ref}")
            alias_hit = None
            for sub in ast.walk(value):
                if isinstance(sub, ast.Name) and sub.id in self._expected_aliases:
                    alias_hit = sub.id
                    break
            if alias_hit:
                self._add("ASV-1", node, f"actual target {actual_target!r} assigned from expected alias {alias_hit!r}")
            if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr in ("observe", "set_observed"):
                for arg in value.args:
                    if ref := _expected_ref(arg):
                        self._add("ASV-1", node, f"observe-sink on {actual_target!r} fed from expected reference {ref}")
                    if isinstance(arg, ast.Name) and arg.id in self._expected_aliases:
                        self._add("ASV-1", node, f"observe-sink on {actual_target!r} fed from expected alias {arg.id!r}")
            if isinstance(value, ast.Constant) and isinstance(value.value, (str, int, float, bool)) and value.value != "UNOBSERVED":
                self._add("ASV-2", node, f"actual target {actual_target!r} initialized from literal {value.value!r}")
            if isinstance(value, ast.Call) and getattr(value.func, "id", "") == "ObservedValue":
                for kw in value.keywords:
                    if kw.arg == "value" and isinstance(kw.value, ast.Constant) and kw.value.value != "UNOBSERVED":
                        if self.scope in ("harness", "corpus"):
                            self._add("ASV-7", node, f"ObservedValue(value={kw.value.value!r}) literal in adjudication code")
            if isinstance(value, ast.Dict):
                for k, v in zip(value.keys, value.values):
                    if isinstance(k, ast.Constant) and isinstance(k.value, str) and k.value.upper().startswith(("EXPECTED_", "PASS_CONDITIONS", "FAIL_CONDITIONS")):
                        self._add("ASV-1", node, f"actual dict {actual_target!r} contains expected key {k.value!r}")

    def visit_Assign(self, node: ast.Assign) -> None:
        self._track_alias(node, node.targets, node.value)
        self._check_actual_assign(node, node.targets, node.value)
        # tuple-unpack targets: d1, d2 = sc['expected'], other
        if isinstance(node.value, ast.Tuple):
            for elt in node.value.elts:
                if _expected_ref(elt):
                    for t in node.targets:
                        if isinstance(t, ast.Tuple):
                            for e in t.elts:
                                if isinstance(e, ast.Name):
                                    self._expected_aliases.add(e.id)
        # dict-unpack flow: d = {**sc["expected"]}
        if isinstance(node.value, ast.Dict):
            for k in node.value.keys:
                if k is None:  # ** unpacking
                    self._expected_aliases.update(
                        t.id for t in node.targets if isinstance(t, ast.Name)
                    )
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self._track_alias(node, [node.target], node.value)
            self._check_actual_assign(node, [node.target], node.value)
        self.generic_visit(node)

    def _observe_sink(self, node: ast.Call) -> None:
        """Any .observe(...)/set_observed(...) call fed from expected material
        or an expected alias — regardless of the target name. Alias detection
        walks the whole argument tree (subscripts of aliases count)."""
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr in ("observe", "set_observed"):
            for arg in node.args:
                if ref := _expected_ref(arg):
                    self._add("ASV-1", node, f"observe-sink fed from expected reference {ref}")
                for sub in ast.walk(arg):
                    if isinstance(sub, ast.Name) and sub.id in self._expected_aliases:
                        self._add("ASV-1", node, f"observe-sink fed from expected alias {sub.id!r}")
                        break
            for kw in node.keywords:
                if kw.arg in ("value",) or kw.arg is None:
                    if ref := _expected_ref(kw.value):
                        self._add("ASV-1", node, f"observe-sink kwarg fed from expected reference {ref}")
                    for sub in ast.walk(kw.value):
                        if isinstance(sub, ast.Name) and sub.id in self._expected_aliases:
                            self._add("ASV-1", node, f"observe-sink kwarg fed from expected alias {sub.id!r}")
                            break

    def visit_Call(self, node: ast.Call) -> None:
        f = node.func
        fname = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else "")
        self._observe_sink(node)
        # keyword-argument flow: build(actual_act=sc["EXPECTED_ACT"])
        for kw in node.keywords:
            if kw.arg and _name_matches(kw.arg, ACTUAL_RE):
                if ref := _expected_ref(kw.value):
                    self._add("ASV-1", node, f"actual keyword {kw.arg!r} assigned from expected reference {ref}")
                if isinstance(kw.value, ast.Name) and kw.value.id in self._expected_aliases:
                    self._add("ASV-1", node, f"actual keyword {kw.arg!r} assigned from expected alias {kw.value.id!r}")
        if fname == "scan_prohibited_output":
            if not any(kw.arg in ("system_output", "tool_output", "external_output") for kw in node.keywords):
                self._add("ASV-5", node, "scan_prohibited_output called with no output stream")
            for kw in node.keywords:
                if kw.arg == "user_input":
                    self._add("ASV-5", node, "prohibited scan must not receive user input")
        self.generic_visit(node)

    def visit_Return(self, node: ast.Return) -> None:
        if self._func_stack:
            fname = self._func_stack[-1].lower()
            canonical_point = self._func_stack[-1] == "derive_primary_verdict"
            if not canonical_point and any(tok in fname for tok in ("verdict", "derive", "score", "adjudicat")):
                v = node.value
                is_pass_literal = isinstance(v, ast.Constant) and v.value == "PASS"
                if isinstance(v, ast.Call) and getattr(v.func, "attr", "") == "PASS":
                    is_pass_literal = True
                if is_pass_literal:
                    self._add("ASV-3", node, f"function {self._func_stack[-1]} returns PASS literal")
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        test = node.test
        hard_coded = False
        if isinstance(test, ast.Compare):
            left = test.left
            # scenario_id as a Name OR subscript spec['scenario_id'] OR attribute
            idish = (
                (isinstance(left, ast.Name) and _name_matches(left.id, ("scenario_id", "test_id")))
                or (isinstance(left, ast.Subscript) and isinstance(left.slice, ast.Constant) and isinstance(left.slice.value, str) and _name_matches(left.slice.value, ("scenario_id", "test_id")))
                or (isinstance(left, ast.Attribute) and _name_matches(left.attr, ("scenario_id", "test_id")))
            )
            if idish:
                for comparator in test.comparators:
                    if isinstance(comparator, ast.Constant) and isinstance(comparator.value, str):
                        hard_coded = True
        if hard_coded:
            for stmt in node.body:
                if isinstance(stmt, (ast.Assign, ast.Return)):
                    self._add("ASV-6", node, "hard-coded branch on scenario/test id in adjudication code")
        self.generic_visit(node)


def audit_tree(root: str) -> list[Finding]:
    findings: list[Finding] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        for fn in sorted(filenames):
            if not fn.endswith(".py"):
                continue
            path = Path(dirpath) / fn
            rel = str(path.relative_to(root))
            parts = path.relative_to(root).parts
            if parts[0] == "harness":
                scope = "canary" if "canary" in fn else "harness"
            elif parts[0] == "corpus":
                scope = "corpus"
            elif parts[0] == "canaries":
                scope = "canary"
            elif parts[0] == "adapters":
                scope = "adapters"
            elif parts[0] == "tests":
                scope = "tests"
            else:
                scope = "harness"
            try:
                source = path.read_text(encoding="utf-8")
                tree = ast.parse(source)
            except SyntaxError as exc:
                # PARSE FAILURE IS ITSELF A VIOLATION (owner section 11)
                findings.append(Finding(rule="ASV-8", file=rel, line=exc.lineno or 0, detail=f"AST parse failure: {exc}"))
                continue
            gate = Gate(rel, source, scope)
            gate.visit(tree)
            findings.extend(f for f in gate.findings if scope != "tests" or f.rule == "ASV-1")
    return findings


def run_audit(bench_root: str, out_path: str | None = None) -> dict:
    all_findings = audit_tree(bench_root)
    # tests/ and battery files contain DELIBERATE forged fixtures (regression
    # specimens): their ASV findings are recorded, not violations. The audit's
    # violation surface is the harness implementation + corpus + adapters +
    # canaries. Parse failures (ASV-8) are violations anywhere.
    violations = [f for f in all_findings
                  if not f.file.startswith(("tests/",)) or f.rule == "ASV-8"]
    specimen = [asdict(f) for f in all_findings
                if f.file.startswith(("tests/",)) and f.rule != "ASV-8"]
    result = {
        "schema": "ANTI_SELF_VALIDATION_STATIC_AUDIT_V3",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "root": bench_root,
        "rules": RULES,
        "files_scanned": count_py_files(bench_root),
        "specimen_findings_note": ("tests/ files contain deliberate forged fixtures; "
                                   "their ASV findings are recorded, not violations"),
        "specimen_findings": specimen,
        "findings": [asdict(f) for f in violations],
        "violations": len(violations),
        "pass": len(violations) == 0,
        "required_condition": "violations = 0 (parse failures count as violations)",
    }
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)
    return result


def count_py_files(root: str) -> int:
    n = 0
    for dirpath, _d, filenames in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        n += sum(1 for f in filenames if f.endswith(".py"))
    return n
