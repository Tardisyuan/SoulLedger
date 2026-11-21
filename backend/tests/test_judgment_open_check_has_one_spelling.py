"""「这件案子结了没有」只有一种写法:`Judgment.is_concluded`(审计 2026-11-20 §4 #3)。

此前约二十处各写一遍 `verdict is not None or is_final`(或它的反面),顺序、取反、要不要连带软删 / 归档各不相同,
读的人要逐处比对才知道它们是不是同一个问题。现在运行代码里一个布尔表达式同时拿 `.verdict` 与 `None` 比、又读
`.is_final`,这里就红,并点名文件和行。软删、归档不在助手里:要连带它们的地方在助手旁边自己写出来。

用 `ast` 读,测试与迁移不读。`EXEMPT` 只收问的不是同一个问题的地方,每条写明为什么。
"""
import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

EXEMPT = {
    # 助手本身。
    "apps/judgment/models.py:is_concluded",
    # 模块级:`NOT_CONCLUDED_Q` 的定义,和 `judgment_pending_idx` 的条件(写成字面量,`makemigrations --check` 比的是它)。
    "apps/judgment/models.py:",
    # 「已结且已封」(两者都要),不是「已结」(任一即可):只写了裁决、未封的案子在这里算未结。与助手答案不同,未改。
    "apps/judgment/appeals.py:appeal_refusal",
}


def _verdict_vs_none(node) -> bool:
    return (isinstance(node, ast.Compare) and isinstance(node.left, ast.Attribute) and node.left.attr == "verdict"
            and any(isinstance(c, ast.Constant) and c.value is None for c in node.comparators))


def _kwarg_spelling(node) -> bool:
    """`filter(verdict__isnull=True, is_final=False)` / `Q(...)`:查询侧的同一个问题,用 `OPEN_Q` / `NOT_CONCLUDED_Q`。
    `verdict__isnull=False, is_final=True`(「已结且已封」)是另一个问题,同 `appeal_refusal`,不算。"""
    if not isinstance(node, ast.Call):
        return False
    kw = {k.arg: k.value for k in node.keywords}
    verdict = kw.get("verdict__isnull")
    return "is_final" in kw and isinstance(verdict, ast.Constant) and verdict.value is True


def _offences(tree):
    stack = [(tree, "")]
    while stack:
        node, func = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func = node.name
        if _kwarg_spelling(node):
            yield node.lineno, func
        if isinstance(node, ast.BoolOp):
            parts = list(ast.walk(node))
            if any(_verdict_vs_none(p) for p in parts) and any(
                    isinstance(p, ast.Attribute) and p.attr == "is_final" for p in parts):
                yield node.lineno, func
                continue
        stack.extend((child, func) for child in ast.iter_child_nodes(node))


def _runtime_files():
    for path in sorted((BACKEND / "apps").rglob("*.py")):
        rel = path.relative_to(BACKEND)
        if {"migrations", "tests"} & set(rel.parts) or path.name.startswith("test_") or path.name == "tests.py":
            continue
        yield rel, path


def test_the_open_check_is_spelled_once():
    found, seen = [], set()
    for rel, path in _runtime_files():
        for line, func in _offences(ast.parse(path.read_text(encoding="utf-8"))):
            key = f"{rel.as_posix()}:{func}"
            seen.add(key)
            if key not in EXEMPT:
                found.append(f"{rel.as_posix()}:{line} (in {func or 'module'})")
    assert not found, "use `judgment.is_concluded` / `is_open`, or `OPEN_Q` / `NOT_CONCLUDED_Q` in a query " \
        "(add `is_archived` beside it where archived cases are excluded):\n" \
        + "\n".join(found)
    assert not EXEMPT - seen, f"exemptions that no longer match anything: {sorted(EXEMPT - seen)}"


def test_the_scanner_sees_each_spelling():
    src = """
def a(j): return j.verdict is not None or j.is_final
def b(j): return j.is_final or j.verdict is not None
def c(j): return j.verdict is None and not j.is_final and x
def d(j): return j.is_concluded or j.is_deleted
def e(j): return j.verdict is None
def f(qs): return qs.filter(verdict__isnull=True, is_final=False)
def g(qs): return qs.filter(OPEN_Q, verdict__isnull=False)
def h(qs): return qs.filter(verdict__isnull=False, is_final=True)
"""
    assert sorted(f for _, f in _offences(ast.parse(src))) == ["a", "b", "c", "f"]
