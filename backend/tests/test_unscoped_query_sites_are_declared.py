"""Guard G2 (docs/ARCHITECTURE-tenant-sharding.md 4.1): every use of an unscoped
manager outside tests is declared in `tests/tenancy_unscoped_sites.py`.

`test_tenant_scoping_contract.py` guards viewset querysets. It cannot see a
service, a Celery task or a signal handler that goes round the manager with
`Model.all_objects` / `._base_manager` / `._default_manager`, or that reads the
global table with `Tenant.objects`. After a database split each of those needs a
routing decision, so a new one must be declared (with a reason) and a declared
one that vanished must be deleted -- the list cannot rot in either direction.

Mechanism: an AST walk of non-test, non-migration code under `apps/` and
`config/`; a site is an `Attribute` node, keyed by (file, expression text) with
an occurrence count. The enclosing function is NOT part of the key (2026-11-13):
renaming or moving one inside its file changes nothing about tenancy and must not
turn this red. A declaration is one row per (file, expression, tag); the scanner
cannot see a tag, so it compares its count with the sum over that pair's tags.
Comments and strings never match. `Model.objects` is NOT scanned: it is unscoped by tenant too (the
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
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            base = ast.unparse(node.value)
            if node.attr in ATTRS or (node.attr == "objects" and base.split(".")[-1] == "Tenant"):
                found[(rel, f"{base}.{node.attr}")] += 1


def scan() -> collections.Counter:
    found = collections.Counter()
    for d in SCAN_DIRS:
        for path in sorted((BACKEND / d).rglob("*.py")):
            if not _is_test_or_migration(path):
                _sites_in(ast.parse(path.read_text()), path.relative_to(BACKEND).as_posix(), found)
    return found


def test_every_unscoped_manager_use_is_declared_and_every_declaration_still_exists():
    found = scan()
    assert len({(f, e, tag) for f, e, _n, tag, _why in SITES}) == len(SITES), "duplicate (file, expression, tag) rows in SITES"
    declared = collections.Counter()
    for f, e, n, _tag, _why in SITES:
        declared[(f, e)] += n

    new = sorted(k for k in found if k not in declared)
    gone = sorted(k for k in declared if k not in found)
    recount = sorted(f"{k}: declared {declared[k]}, found {found[k]}" for k in found if k in declared and found[k] != declared[k])
    msg = []
    if new:
        msg.append("UNDECLARED unscoped-manager use (add a row to SITES in tests/tenancy_unscoped_sites.py "
                   "saying why it cannot touch another tenant's rows):\n  " + "\n  ".join(f"{f}  {e}  x{found[(f, e)]}" for f, e in new))
    if gone:
        msg.append("DECLARED but no longer in the code (delete the row):\n  " + "\n  ".join(map(str, gone)))
    if recount:
        msg.append("COUNT changed (another use of that expression appeared in the file, or one went; read the new "
                   "use and add it to the row of its tag -- or a new row -- with its reason):\n  " + "\n  ".join(recount))
    assert not msg, "\n".join(msg)


def test_every_declaration_has_a_known_tag_and_a_reason():
    bad = [(f, e) for f, e, n, tag, why in SITES if tag not in TAGS or len(why.strip()) < 12 or n < 1]
    assert not bad, f"bad tag or empty reason: {bad}"


def test_the_key_ignores_the_enclosing_function_and_nothing_else():
    """What the 2026-11-13 relaxation is: a rename is silent; one more use, or another expression, is not."""
    def keys(src):
        found = collections.Counter()
        _sites_in(ast.parse(src), "x.py", found)
        return found

    before = keys("class A:\n    def f(self):\n        Soul.all_objects.get(pk=1)\n")
    assert before == {("x.py", "Soul.all_objects"): 1}
    assert keys("def renamed():\n    Soul.all_objects.get(pk=1)\n") == before
    assert keys("def f():\n    Soul.all_objects.get(pk=1)\n    Soul.all_objects.count()\n") != before
    assert keys("def f():\n    Soul._base_manager.get(pk=1)\n") != before
