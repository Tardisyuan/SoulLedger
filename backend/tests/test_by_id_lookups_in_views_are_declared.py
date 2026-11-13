"""Every by-id lookup in a view, on a tenanted model, without a tenant filter is declared (security review 2026-10-27 #6).

`test_unscoped_query_sites_are_declared.py` does not scan `Model.objects`, and the viewset contract
only sees querysets. So `User.objects.filter(pk=body["user_id"])` in an action is safe only because
of a check in another file. This walks view modules (`views.py`, `*_views.py`, `views/`, and the
modules in `OTHER_VIEW_FILES` that hold views under another name) for
`<Model>.<manager>.get/filter(pk=… | id=… | pk__in=… | id__in=…)` where the model has a `tenant` column
and that call has no `tenant…` keyword, and requires each to be listed in `BY_ID_SITES` with what keeps
it in-hall. Keyed by (file, model) with a count: the enclosing function is not part of the key
(2026-11-13, same decision as `test_unscoped_query_sites_are_declared.py`), so a rename is silent and
one more lookup of that model in that file is not.
"""
import ast
import collections
from pathlib import Path

from django.apps import apps

from tests.tenancy_unscoped_sites import BY_ID_SITES

BACKEND = Path(__file__).resolve().parents[1]
MANAGERS = {"objects", "all_objects", "_base_manager", "_default_manager"}
LOOKUPS = {"get", "filter", "get_or_create", "update_or_create"}
KEYS = {"pk", "id", "pk__in", "id__in"}
# View modules the name test below does not recognise (test review 2026-11-13, 3.3). Listed by hand: a
# new view module with an unusual name is not seen until it is added here.
OTHER_VIEW_FILES = {
    "apps/perm/members.py", "apps/perm/data_scope_api.py", "apps/perm/explain.py",
    "apps/soul_accounts/contact_email.py", "apps/core/app_version.py", "apps/core/health.py",
}


def _tenanted():
    return {m.__name__ for m in apps.get_models() if any(f.name == "tenant" for f in m._meta.fields)}


def _is_view(path: Path) -> bool:
    rel = path.relative_to(BACKEND).as_posix()
    if "/tests/" in rel or "/migrations/" in rel or path.name.startswith("test_") or path.name == "tests.py":
        return False
    return (path.name == "views.py" or path.name.endswith("_views.py") or path.parent.name == "views"
            or rel in OTHER_VIEW_FILES)


def _manager_model(call):
    """The `X` of `X.<manager>.a().b()…` at the bottom of this call chain, or None."""
    node = call.func.value if isinstance(call.func, ast.Attribute) else None
    while node is not None:
        if isinstance(node, ast.Attribute) and node.attr in MANAGERS and isinstance(node.value, ast.Name):
            return node.value.id
        node = node.func.value if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) else None
    return None


def _sites_in(tree, rel, tenanted, found):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in LOOKUPS:
            kws = {k.arg for k in node.keywords if k.arg}
            model = _manager_model(node)
            if model in tenanted and kws & KEYS and not any(k.startswith("tenant") for k in kws):
                found[(rel, model)] += 1


def scan(tenanted) -> collections.Counter:
    found = collections.Counter()
    for path in sorted((BACKEND / "apps").rglob("*.py")):
        if _is_view(path):
            _sites_in(ast.parse(path.read_text()), path.relative_to(BACKEND).as_posix(), tenanted, found)
    return found


def test_every_by_id_lookup_in_a_view_is_declared_and_every_declaration_still_exists():
    found = scan(_tenanted())
    declared = {(f, m): n for f, m, n, _why in BY_ID_SITES}
    assert len(declared) == len(BY_ID_SITES), "duplicate rows in BY_ID_SITES"
    new = sorted(k for k in found if k not in declared)
    gone = sorted(k for k in declared if k not in found)
    recount = sorted(f"{k}: declared {declared[k]}, found {found[k]}" for k in found if k in declared and found[k] != declared[k])
    msg = []
    if new:
        msg.append("UNDECLARED by-id lookup with no tenant filter (add a row to BY_ID_SITES in "
                   "tests/tenancy_unscoped_sites.py naming the check that keeps it in the caller's hall, "
                   "or add tenant= to the query):\n  " + "\n  ".join(f"{f}  {m}  x{found[(f, m)]}" for f, m in new))
    if gone:
        msg.append("DECLARED but no longer in the code (delete the row):\n  " + "\n  ".join(map(str, gone)))
    if recount:
        msg.append("COUNT changed (another by-id lookup of that model appeared in the file, or one went; "
                   "read it and add its check to the row's reason):\n  " + "\n  ".join(recount))
    assert not msg, "\n".join(msg)


def test_every_declaration_has_a_reason():
    assert all(len(why.strip()) >= 12 for *_k, why in BY_ID_SITES)


def test_the_scanner_sees_the_shapes_it_is_meant_to_see():
    """Proves the walk is not vacuous: a lookup by request id (one or a list) is found, one with tenant= or
    exclude() is not; and the function name is not part of the key."""
    src = (
        "class V:\n"
        "    def post(self, request):\n"
        "        User.objects.filter(pk=request.data['x']).first()\n"
        "        User.objects.select_related('tenant').get(id=1)\n"
        "        User.objects.filter(pk=1, tenant=request.tenant)\n"
        "        User.objects.exclude(pk=1)\n"
        "        Unrelated.objects.get(pk=1)\n"
        "    def put(self, request):\n"
        "        User.objects.filter(pk__in=request.data['ids'])\n"
        "        User.objects.filter(id__in=[1], tenant_id=2)\n"
    )
    found = collections.Counter()
    _sites_in(ast.parse(src), "x.py", {"User"}, found)
    assert found == {("x.py", "User"): 3}, found
    renamed = collections.Counter()
    _sites_in(ast.parse(src.replace("def post", "def create")), "x.py", {"User"}, renamed)
    assert renamed == found


def test_the_other_view_files_exist():
    """A hand-kept list of paths rots silently when a file is renamed."""
    assert not [f for f in OTHER_VIEW_FILES if not (BACKEND / f).is_file()]
