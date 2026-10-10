"""`POST /perm/import/` with `dry_run: true` - the import dialog's summary step.

A dry run runs the whole merge, answers with the stats a real import would give,
and leaves NOTHING behind: no row of any of the five tables, no audit row (the
audit signal writes on commit, and a rolled-back transaction never commits), and
no permission-cache invalidation.

`transaction=True` on purpose: inside pytest's wrapping transaction `on_commit`
callbacks never fire, so a leaked audit row would be invisible. The real import
at the end of the first test is the control - it must write audit rows, or the
"no audit row" assertion could never have failed.
"""
from unittest import mock

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.perm.models import FieldPermission, Permission, Role, RolePermission, RowLevelDataScope
from apps.tenants.models import Tenant

IMPORT = "/api/v1/perm/import/"
TABLES = (Permission, Role, RolePermission, FieldPermission, RowLevelDataScope, AuditLog)

FILE = {
    "permissions": [
        {"codename": "dry.read", "name": "dry.read", "category": "dry"},
        {"codename": "recycle_bin.restore", "name": "restore", "category": "bin"},
    ],
    "roles": [
        {"name": "JUDGE", "display_name": "Judge", "scope": "ORG"},  # exists
        {"name": "DRY_NEW", "display_name": "New", "scope": "ORG"},
    ],
    "role_permissions": [
        {"role": "DRY_NEW", "permission": "dry.read"},  # created
        {"role": "JUDGE", "permission": "recycle_bin.restore"},  # ADMIN-only rule
        {"role": "MODERATOR", "permission": "workflow.approve"},  # role-forbidden rule
        {"role": "GHOST", "permission": "dry.read"},  # unknown role
    ],
    "field_permissions": [{"role": "DRY_NEW", "model_name": "soul", "field_name": "name"}],
    "data_scopes": [{"role": "DRY_NEW", "model_name": "soul", "scope_type": "ALL"}],
}



@pytest.fixture(autouse=True)
def _overwrite_import_on(settings):
    """Overwrite import is off by default (PERM_IMPORT_OVERWRITE_ENABLED); this file tests it."""
    settings.PERM_IMPORT_OVERWRITE_ENABLED = True

@pytest.fixture
def world(transactional_db):
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    for name in ("ADMIN", "JUDGE", "MODERATOR"):
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    for codename in ("workflow.approve", "recycle_bin.restore"):
        Permission.objects.get_or_create(codename=codename, defaults={"name": codename, "category": "wf"})
    admin = User.objects.create_user(username="dry_admin", password="x", role="ADMIN", tenant=tenant)
    token = RefreshToken.for_user(admin)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _counts():
    return {m.__name__: m.all_objects.count() if hasattr(m, "all_objects") else m.objects.count() for m in TABLES}


@pytest.mark.django_db(transaction=True)
def test_a_dry_run_reports_the_real_stats_and_leaves_no_row_audit_row_or_cache_clear(world):
    before = _counts()
    with mock.patch("apps.perm.views.invalidate_all_permissions") as invalidate:
        dry = world.post(IMPORT, {**FILE, "dry_run": True}, format="json")
        assert dry.status_code == 200, dry.content
        assert _counts() == before, "a dry run must not leave any row, audit rows included"
        invalidate.assert_not_called()

        real = world.post(IMPORT, FILE, format="json")
        assert real.status_code == 200, real.content
        invalidate.assert_called_once()

    # Control: the real import does write rows AND audit rows, so the equality above could fail.
    after = _counts()
    assert after["Role"] == before["Role"] + 1
    assert after["AuditLog"] > before["AuditLog"]
    assert dry.data["stats"] == real.data["stats"]


@pytest.mark.django_db(transaction=True)
def test_the_stats_count_created_and_skipped_per_section_with_the_reason_for_each_skip(world):
    stats = world.post(IMPORT, {**FILE, "dry_run": True}, format="json").data["stats"]

    assert stats["permissions"] == {"created": 1, "skipped": 1}  # recycle_bin.restore exists already
    assert stats["roles"] == {"created": 1, "skipped": 1}
    assert stats["role_permissions"] == {"created": 1, "skipped": 3}
    assert stats["field_permissions"] == {"created": 1, "skipped": 0}
    assert stats["data_scopes"] == {"created": 1, "skipped": 0}
    reasons = {(d["section"], d["key"]): d["reason"] for d in stats["skipped_details"]}
    assert reasons[("roles", "JUDGE")] == "already_exists"
    assert reasons[("role_permissions", "JUDGE / recycle_bin.restore")] == "admin_only"
    assert reasons[("role_permissions", "MODERATOR / workflow.approve")] == "role_forbidden"
    assert reasons[("role_permissions", "GHOST / dry.read")] == "unknown_reference"
    assert len(stats["skipped_details"]) == sum(stats[k]["skipped"] for k in ("permissions", "roles", "role_permissions", "field_permissions", "data_scopes"))


@pytest.mark.django_db(transaction=True)
def test_dry_run_must_be_a_real_boolean(world):
    response = world.post(IMPORT, {**FILE, "dry_run": "false"}, format="json")
    assert response.status_code == 400
