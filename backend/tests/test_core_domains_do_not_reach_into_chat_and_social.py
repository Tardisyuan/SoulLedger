"""The core domain does not grow new imports of chat or social (2026-11-12, user decision).

docs/ARCHITECTURE-soul-app-and-domain-split.md keeps the core domain — apps.judgment, apps.souls,
apps.workflow, apps.disposition, apps.sentence_plan, apps.dispatch — in one database and splits off only
what sits at its edge; chat and social are the first candidates. The day they move to a service of their
own, every import of them from the core is a call that has to become an API. So the imports that exist
today are listed here, and the list only shrinks:

  - a new one (a new file, a new module, or one more import in a listed file) fails, and says where;
  - one that disappeared also fails, until it is taken off the list — a list that only ever grew
    wrong would stop meaning "what is there".

Read with `ast`, so an import inside a function counts (half of the existing ones are). Test files and
migrations are not the core's runtime code and are not read.

The split itself waits for numbers: CLAUDE.md records the threshold (the `/me/` p95 above 500 ms, or the
primary database's CPU above 60% for a week).
"""
import ast
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
CORE = ("judgment", "souls", "workflow", "disposition", "sentence_plan", "dispatch")
EDGE = ("chat", "social")

# "<file under backend/> -> <module>": how many import statements. Measured 2026-11-12.
BASELINE = {
    "apps/judgment/attachment_views.py -> apps.social.media_views": 1,
    "apps/judgment/attachments.py -> apps.social": 1,
    "apps/judgment/attachments.py -> apps.social.media": 1,
    "apps/judgment/attachments.py -> apps.social.soul_circle": 1,
    "apps/judgment/handover.py -> apps.chat.models": 2,
}


def _runtime_files(app: str):
    for path in sorted((BACKEND / "apps" / app).rglob("*.py")):
        rel = path.relative_to(BACKEND)
        if {"migrations", "tests"} & set(rel.parts) or path.name.startswith("test_") \
                or path.name in ("tests.py", "conftest.py"):
            continue
        yield rel, path


def _imported_modules(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module == "apps":  # `from apps import chat`
                yield from (f"apps.{alias.name}" for alias in node.names)
            else:
                yield node.module


def _edge_imports() -> Counter:
    found = Counter()
    for app in CORE:
        for rel, path in _runtime_files(app):
            for module in _imported_modules(ast.parse(path.read_text(encoding="utf-8"))):
                if any(module == f"apps.{e}" or module.startswith(f"apps.{e}.") for e in EDGE):
                    found[f"{rel.as_posix()} -> {module}"] += 1
    return found


def test_the_core_imports_chat_and_social_only_where_it_already_did():
    found = _edge_imports()
    new = {k: n - BASELINE.get(k, 0) for k, n in found.items() if n > BASELINE.get(k, 0)}
    assert not new, (
        "the core domain gained imports of apps.chat / apps.social — each one is a call to rewrite as an API "
        f"when they split off. Go through a service or event in the edge app instead: {new}")


def test_the_baseline_is_not_stale():
    found = _edge_imports()
    gone = {k: n - found.get(k, 0) for k, n in BASELINE.items() if found.get(k, 0) < n}
    assert not gone, f"these imports are gone — take them off BASELINE (good): {gone}"


def test_the_scan_sees_an_import_inside_a_function():
    """The check is only as good as its reader: half the existing imports are function-local."""
    tree = ast.parse("def f():\n    from apps.chat.models import Thread\n    import apps.social.media\n"
                     "from apps import chat\n")
    assert sorted(_imported_modules(tree)) == ["apps.chat", "apps.chat.models", "apps.social.media"]
