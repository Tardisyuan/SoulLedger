"""Every `is_tenant_exempt(...)` call outside tests is classified in `tests/tenancy_exempt_sites.py` (stage 1A).

Since 2026-11-15 the function answers True for SYSTEM_ADMIN only. A caller written before that meant "the
hall-less ADMIN sees everything"; a caller written after must say what a civilization ADMIN gets there. A new
call in a file (or one fewer) turns this red until its row says SYSTEM_ONLY or CIVILIZATION, with the reason.

Mechanism: an AST walk of non-test, non-migration code under `apps/` and `config/`; a site is a `Call` whose
function is named `is_tenant_exempt`, counted per file. Comments, strings and the `def` never match.
"""
import ast
import collections
from pathlib import Path

from tests.tenancy_exempt_sites import SITES, TAGS

BACKEND = Path(__file__).resolve().parents[1]
SCAN_DIRS = ("apps", "config")


def _is_test_or_migration(path: Path) -> bool:
    rel = path.relative_to(BACKEND).as_posix()
    return (
        "/tests/" in rel or "/migrations/" in rel
        or path.name.startswith("test_") or path.name in ("tests.py", "conftest.py")
    )


def _called_name(node):
    func = node.func
    return func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None


def scan() -> collections.Counter:
    found = collections.Counter()
    for d in SCAN_DIRS:
        for path in sorted((BACKEND / d).rglob("*.py")):
            if _is_test_or_migration(path):
                continue
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.Call) and _called_name(node) == "is_tenant_exempt":
                    found[path.relative_to(BACKEND).as_posix()] += 1
    return found


def test_every_exempt_call_is_classified_and_every_row_still_exists():
    found = scan()
    assert len({(f, tag) for f, _n, tag, _why in SITES}) == len(SITES), "duplicate (file, tag) rows in SITES"
    declared = collections.Counter()
    for f, n, _tag, _why in SITES:
        declared[f] += n
    new = sorted(f for f in found if f not in declared)
    gone = sorted(f for f in declared if f not in found)
    recount = sorted(f"{f}: declared {declared[f]}, found {found[f]}" for f in found if f in declared and found[f] != declared[f])
    msg = []
    if new:
        msg.append("UNCLASSIFIED is_tenant_exempt(...) call (add a row to tests/tenancy_exempt_sites.py: does a "
                   "civilization ADMIN get its civilization's halls here, or only SYSTEM_ADMIN?):\n  "
                   + "\n  ".join(f"{f}  x{found[f]}" for f in new))
    if gone:
        msg.append("CLASSIFIED but no longer in the code (delete the row):\n  " + "\n  ".join(gone))
    if recount:
        msg.append("COUNT changed (classify the new call, or drop the one that went):\n  " + "\n  ".join(recount))
    assert not msg, "\n".join(msg)


def test_every_row_has_a_known_tag_and_a_reason():
    bad = [f for f, n, tag, why in SITES if tag not in TAGS or len(why.strip()) < 12 or n < 1]
    assert not bad, bad


def test_the_scanner_sees_a_call_and_not_a_mention():
    tree = ast.parse("from x import is_tenant_exempt\n# is_tenant_exempt(u)\ns = 'is_tenant_exempt(u)'\n"
                     "def is_tenant_exempt(u): ...\nif is_tenant_exempt(u) or m.is_tenant_exempt(v): pass\n")
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and _called_name(n) == "is_tenant_exempt"]
    assert len(calls) == 2
