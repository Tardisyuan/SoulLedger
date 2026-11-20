"""Every audit row is written through one entry: `apps.audit.signals.write_audit_row` (-> `_write_row`).

`_write_row` picks the row's database (the master of the hall it names), writes inside the business transaction and
defers to on_commit only when it cannot join it. A direct `AuditLog.objects.create(...)` asks the router on the User /
Tenant assignment -- NoShardContext for SYSTEM_ADMIN with every civilization write-cut (an export was a 500 that way)
-- or lands on the context's database instead of the hall's master.

  guard    no code in backend/apps outside apps/audit (tests and migrations excepted: a migration has only the
           historical model) builds an AuditLog row itself or imports `_write_row`. AST, not grep: docstrings here
           quote the removed calls.
  sharded  each converted path, driven through its real entry point with all four civilizations write-cut, leaves
           exactly one row of its kind, on the master of the hall it names, and none on any other database:

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_audit_rows_have_one_entry.py
"""
import ast
from pathlib import Path

import pytest

from tests.test_control_locks_in_a_write_cut_hall import _client
from tests.test_shard_sync import CIVS, sharded
from tests.test_sharded_writes import _assign, _halls, _in_hall, cut

APPS = Path(__file__).resolve().parents[1] / "apps"
WRITES = {"create", "bulk_create", "get_or_create", "update_or_create", "save"}


def _root(node):
    while isinstance(node, (ast.Attribute, ast.Call)):
        node = node.value if isinstance(node, ast.Attribute) else node.func
    return node.id if isinstance(node, ast.Name) else None


def direct_audit_writes(tree):
    names = {a.asname or a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
             for a in n.names if a.name == "AuditLog"}
    found = []
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and any(a.name == "_write_row" for a in n.names):
            found.append((n.lineno, "imports _write_row"))
        if not isinstance(n, ast.Call):
            continue
        if isinstance(n.func, ast.Name) and n.func.id in names:
            found.append((n.lineno, "AuditLog(...)"))
        elif isinstance(n.func, ast.Attribute) and n.func.attr in WRITES and _root(n.func) in names:
            found.append((n.lineno, f"AuditLog....{n.func.attr}(...)"))
    return found


def _sources():
    for path in sorted(APPS.rglob("*.py")):
        rel = path.relative_to(APPS)
        if rel.parts[0] == "audit" or "tests" in rel.parts or rel.name == "tests.py" or "migrations" in rel.parts:
            continue
        yield rel, path


def test_no_code_outside_apps_audit_writes_an_audit_row_itself():
    offenders = [f"apps/{rel}:{line} {what}" for rel, path in _sources()
                 for line, what in direct_audit_writes(ast.parse(path.read_text()))]
    assert not offenders, "write audit rows with apps.audit.signals.write_audit_row:\n" + "\n".join(offenders)


@pytest.mark.parametrize("src", [
    "from apps.audit.models import AuditLog\nAuditLog.objects.create(action='X')",
    "from apps.audit.models import AuditLog as A\nA._base_manager.using('default').create(action='X')",
    "from apps.audit.models import AuditLog\nAuditLog(action='X').save()",
    "from apps.audit.signals import _write_row",
])
def test_the_scan_sees_each_shape(src):
    assert direct_audit_writes(ast.parse(src))


def test_the_scan_reads_the_files_it_names():
    assert any(rel.parts[0] == "perm" for rel, _ in _sources())
    assert "write_audit_row" in (APPS / "perm" / "views.py").read_text()


# ---- sharded: each converted path, all four civilizations write-cut ------------------------------------------------

@pytest.fixture
def world():
    """One hall per civilization, every civilization write-cut (115's state since 2026-11-17)."""
    halls = _halls()
    _assign(*CIVS)
    with cut(*CIVS):
        yield halls


def _system_admin(name):
    from apps.authentication.models import User

    return User.objects.create_user(username=name, password="x", role="SYSTEM_ADMIN")


def _rows(**filters):
    from django.db import connections

    from apps.audit.models import AuditLog

    return {a: AuditLog._base_manager.using(a).filter(**filters).count() for a in connections}


def _on(alias, n=1, **filters):
    seen = _rows(**filters)
    assert seen == {a: n * (a == alias) for a in seen}, seen


def _ok(response, code=200):
    assert response.status_code == code, response.content[:400]


@sharded
def test_role_permissions_replaced_by_a_system_admin(world):
    """perm/views.py assign: `user=` on a row with no hall asked the router in MASTER -- NoShardContext, a 500."""
    from apps.perm.models import Permission, Role

    role = Role.objects.create(name="ONE_ENTRY", display_name="T")
    perm = Permission.objects.create(codename="one_entry.read", name="T", category="test")
    _ok(_client(_system_admin("oe_assign")).post("/api/v1/perm/role-permissions/assign/",
                                                     {"role": role.name, "permission_ids": [perm.pk]}, format="json"))
    _on("default", action="PERMISSION_CHANGE", resource="role", resource_id=str(role.pk))


@sharded
def test_a_role_copied_by_a_system_admin(world):
    """perm/views.py copy_role: the same `user=` on a hall-less row. (`PUT roles/<pk>/data-scope/` is not driven:
    under the cut it 500s before its audit row, in `role_config`'s read of RoleDataScope -- NoShardContext, a read
    across every shard through a path that cannot merge. A defect of that read, not of the audit write.)"""
    from apps.perm.models import Role

    source = Role.objects.create(name="OE_SRC", display_name="源")
    _ok(_client(_system_admin("oe_copy")).post(f"/api/v1/perm/roles/{source.pk}/copy/",
                                               {"name": "OE_COPY", "display_name": "副"}, format="json"), 201)
    _on("default", action="PERMISSION_CHANGE", resource="role", resource_id=str(Role.objects.get(name="OE_COPY").pk))


@sharded
def test_the_scheduler_rebuilt_by_a_system_admin(world):
    """scheduler/views.py `_audit`: a global action (no hall) with `user=` -- NoShardContext before."""
    _ok(_client(_system_admin("oe_sched")).post("/api/v1/scheduler/jobs/rebuild/"))
    _on("default", action="EXECUTE", resource="ScheduledJob", resource_id="rebuild")


@sharded
@pytest.mark.parametrize("civ", ["GREEK", "CHINESE"])
def test_a_hall_deactivated_and_activated_by_a_system_admin(world, civ):
    """tenants/views.py `_set_active`: the row names the hall, so it is on the hall's master."""
    from apps.core.shard_reads import master_alias

    hall = world[civ]
    client = _client(_system_admin(f"oe_hall_{civ}"))
    for verb in ("deactivate", "activate"):
        _ok(client.post(f"/api/v1/tenants/{hall.code}/{verb}/"))
    _on(master_alias(civ), 2, resource="tenant", resource_id=hall.code)


@sharded
def test_a_unit_deleted_with_its_souls_moved_by_a_system_admin(world):
    """org/views.py `_move_owned`: `tenant_id=` with `user=` -- the User assignment asked the router in MASTER."""
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root
    from apps.souls.models import Soul

    hall = world["GREEK"]
    with _in_hall(hall):
        root = tenant_root(hall)
        gone = Organization.objects.create(name="将删", code="OE_GONE", category="", tenant=hall, parent=root)
        Soul.objects.create(name="随机构迁", tenant=hall, owner_org=gone)
    _ok(_client(_system_admin("oe_org")).delete(f"/api/v1/organizations/{gone.pk}/?move_to={root.pk}"), 204)
    _on("civ_greek", action="BATCH_UPDATE", resource="organization", resource_id=str(gone.pk))


@sharded
@pytest.mark.parametrize("who", ["JUDGE", "SYSTEM_ADMIN"])
def test_a_comment_on_a_judgment_of_a_write_cut_hall(world, who):
    """judgment/views.py comments: the row on the judgment's hall's master, whoever writes it."""
    from apps.authentication.models import User
    from tests import sentence_plan_support as plan

    hall = world["GREEK"]
    with _in_hall(hall):
        _, case = plan.open_case(hall, name="评议魂")
    user = User.objects.create_user(username=f"oe_{who.lower()}", password="x", role=who,
                                    tenant=hall if who == "JUDGE" else None)
    _ok(_client(user).post(f"/api/v1/judgment/{case.pk}/comments/", {"body": "同意"}, format="json"), 201)
    _on("civ_greek", action="CREATE", resource="judgment.comment", resource_id=str(case.pk))


@sharded
def test_a_halls_assistant_switched_by_the_system_admin(world):
    """soul_assist/config.py `audit`: `tenant=None` (the assistant's config is global) with `user=`."""
    hall = world["EGYPTIAN"]
    _ok(_client(_system_admin("oe_assist")).patch(f"/api/v1/assist-admin/halls/{hall.pk}/",
                                                  {"assistant_enabled": True}, format="json"))
    _on("default", resource="assistant_config", resource_id=f"tenant:{hall.code}")

