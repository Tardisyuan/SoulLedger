"""Guard G2 (docs/ARCHITECTURE-tenant-sharding.md 4.1): every use of an unscoped
manager outside tests is declared in `tests/tenancy_unscoped_sites.py`.

`test_tenant_scoping_contract.py` guards viewset querysets. It cannot see a
service, a Celery task or a signal handler that goes round the manager with
`Model.all_objects` / `._base_manager` / `._default_manager`, or that reads the
global table with `Tenant.objects`. After a database split each of those needs a
routing decision, so a new one must be declared (with a reason) and a declared
one that vanished must be deleted -- the list cannot rot in either direction.

Mechanism: an AST walk of non-test, non-migration code under `apps/` and
`config/`; a site is an `Attribute` node, keyed by (file, enclosing
Class.function, expression text) with an occurrence count. Comments and strings
never match. `Model.objects` is NOT scanned: it is unscoped by tenant too (the
manager filters soft deletes only), and scanning it would list every query in
the codebase; the viewset contract and `scope_to_tenant` own that surface.
"""
import ast
import collections
from pathlib import Path

from tests.tenancy_unscoped_sites import SITES, TAGS

BACKEND = Path(__file__).resolve().parents[1]
SCAN_DIRS = ("apps", "config")
ATTRS = {"all_objects", "_base_manager", "_default_manager"}


def _is_test_or_migration(path: Path) -> bool:
    rel = path.relative_to(BACKEND).as_posix()
    return (
        "/tests/" in rel or "/migrations/" in rel
        or path.name.startswith("test_") or path.name in ("tests.py", "conftest.py")
    )


def _sites_in(tree, rel, found):
    stack: list[str] = []

    def visit(node):
        pushed = isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        if pushed:
            stack.append(node.name)
        if isinstance(node, ast.Attribute):
            base = ast.unparse(node.value)
            if node.attr in ATTRS or (node.attr == "objects" and base.split(".")[-1] == "Tenant"):
                found[(rel, ".".join(stack) or "<module>", f"{base}.{node.attr}")] += 1
        for child in ast.iter_child_nodes(node):
            visit(child)
        if pushed:
            stack.pop()

    visit(tree)


def scan() -> collections.Counter:
    found = collections.Counter()
    for d in SCAN_DIRS:
        for path in sorted((BACKEND / d).rglob("*.py")):
            if not _is_test_or_migration(path):
                _sites_in(ast.parse(path.read_text()), path.relative_to(BACKEND).as_posix(), found)
    return found


def test_every_unscoped_manager_use_is_declared_and_every_declaration_still_exists():
    found = scan()
    declared = {(f, q, e): n for f, q, e, n, _tag, _why in SITES}
    assert len(declared) == len(SITES), "duplicate rows in SITES"

    new = sorted(k for k in found if k not in declared)
    gone = sorted(k for k in declared if k not in found)
    recount = sorted(f"{k}: declared {declared[k]}, found {found[k]}" for k in found if k in declared and found[k] != declared[k])
    msg = []
    if new:
        msg.append("UNDECLARED unscoped-manager use (add a row to SITES in tests/tenancy_unscoped_sites.py "
                   "saying why it cannot touch another tenant's rows):\n  " + "\n  ".join(f"{f}  {q}  {e}  x{found[(f, q, e)]}" for f, q, e in new))
    if gone:
        msg.append("DECLARED but no longer in the code (delete the row):\n  " + "\n  ".join(map(str, gone)))
    if recount:
        msg.append("COUNT changed (another use appeared or went; re-read the function):\n  " + "\n  ".join(recount))
    assert not msg, "\n".join(msg)


def test_every_declaration_has_a_known_tag_and_a_reason():
    bad = [(f, q, e) for f, q, e, _n, tag, why in SITES if tag not in TAGS or len(why.strip()) < 12]
    assert not bad, f"bad tag or empty reason: {bad}"
