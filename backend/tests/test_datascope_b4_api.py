"""数据范围 B4:权限接口(`apps/perm/data_scope_api.py`)、导出导入段 `role_data_scopes`、复制角色带范围、
机构接口按范围收窄。设计 local-gates/rbac-2026-10-29/datascope-design.md「接口(B4)」。
"""
import pytest

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User
from apps.org.ownership import tenant_root
from apps.perm import data_scope
from apps.perm.data_scope_api import LABELS, role_config
from apps.perm.export import export_permissions, import_permissions
from apps.perm.models import Permission, Role, RoleDataScope, RolePermission
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

RESOURCES = "/api/v1/perm/data-scope/resources/"


def url(role):
    return f"/api/v1/perm/roles/{role.pk}/data-scope/"


@pytest.fixture
def w(cn_tenant, eu_tenant):
    for name in ("ADMIN", "JUDGE"):
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    a = org(cn_tenant, "甲司")
    e = org(eu_tenant, "欧司")
    admin = User.objects.create_user(username="b4_admin", password="x", role="ADMIN", tenant=None)
    hall_admin = User.objects.create_user(username="b4_hall_admin", password="x", role="ADMIN", tenant=cn_tenant)
    judge = User.objects.create_user(username="b4_judge", password="x", role="JUDGE", tenant=cn_tenant, organization=a)
    return type("W", (), dict(a=a, e=e, admin=admin, hall_admin=hall_admin, judge=judge,
                              role=Role.objects.get(name="JUDGE"), admin_role=Role.objects.get(name="ADMIN"),
                              tenant=cn_tenant))


GOOD = lambda w: {  # noqa: E731
    "default": {"scope": "ORG", "orgs": []},
    "overrides": [{"resource": "soul", "scope": "DEFINE", "orgs": [w.e.pk, w.a.pk]},
                  {"resource": "judgment", "scope": "ALL", "orgs": []}],
}


def test_resources_are_the_registry_with_a_label_per_language(w):
    client = officer_client(w.admin)
    zh = client.get(RESOURCES, HTTP_ACCEPT_LANGUAGE="zh-Hans").data
    en = client.get(RESOURCES, HTTP_ACCEPT_LANGUAGE="en").data
    keys = {e.resource for e in data_scope.REGISTRY.values()}
    assert [r["key"] for r in zh] == [r["key"] for r in en] and set(r["key"] for r in zh) == keys
    assert {r["key"]: r["label"] for r in zh}["soul"] == "灵魂"
    assert {r["key"]: r["label"] for r in en}["soul"] == "Souls"
    assert set(LABELS) == keys, "every registered resource needs a label, and no stale ones"


def test_an_unconfigured_role_reads_as_all(w):
    response = officer_client(w.admin).get(url(w.role))
    assert response.status_code == 200
    assert response.data == {"default": {"scope": "ALL", "orgs": []}, "default_configured": False, "overrides": []}


def test_the_hall_less_admin_replaces_the_whole_config_and_it_is_audited(w):
    scope("JUDGE", "SELF", resource="appeal")  # replaced, not merged
    client = officer_client(w.admin)
    response = client.put(url(w.role), GOOD(w), format="json")
    assert response.status_code == 200, response.content
    expected = {
        "default": {"scope": "ORG", "orgs": []},
        "default_configured": True,
        "overrides": [{"resource": "judgment", "scope": "ALL", "orgs": []},
                      {"resource": "soul", "scope": "DEFINE", "orgs": sorted([w.a.pk, w.e.pk])}],
    }
    assert response.data == expected
    assert client.get(url(w.role)).data == expected
    assert not RoleDataScope.objects.filter(role=w.role, resource="appeal").exists()
    row = AuditLog.objects.get(action=AuditAction.PERMISSION_CHANGE, resource="role", resource_id=str(w.role.pk))
    assert row.changes["data_scope"]["new"] == expected
    assert row.changes["data_scope"]["old"]["overrides"] == [{"resource": "appeal", "scope": "SELF", "orgs": []}]
    # The solver reads what was written: the judge's souls are A (and the foreign E, dropped by hall isolation).
    assert data_scope.org_ids(w.judge, "soul") >= {w.a.pk, w.e.pk}
    assert data_scope.org_ids(w.judge, "judgment") is None


def test_setting_all_back_stores_an_all_row_that_widens_an_extra_role(w):
    """显式「全部」存一行 ALL(P-12,2026-11-12):GET 读回来与没配一样,但兼任时它让结果变成全部;没配的不会。"""
    client = officer_client(w.admin)
    client.put(url(w.role), GOOD(w), format="json")
    response = client.put(url(w.role), {"default": {"scope": "ALL"}, "overrides": []}, format="json")
    assert response.status_code == 200
    assert response.data == {"default": {"scope": "ALL", "orgs": []}, "default_configured": True, "overrides": []}
    assert client.get(url(w.role)).data["default_configured"] is True
    assert list(RoleDataScope.objects.filter(role=w.role).values_list("resource", "scope")) == [("", "ALL")]

    viewer = Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})[0]
    client.put(url(viewer), {"default": {"scope": "ORG"}, "overrides": []}, format="json")
    w.judge.role, w.judge.extra_roles = "VIEWER", ["JUDGE"]
    assert data_scope.org_ids(w.judge, "soul") is None  # JUDGE 显式全部 → 全部
    RoleDataScope.objects.filter(role=w.role).delete()  # 回到「没配」
    assert data_scope.org_ids(w.judge, "soul") == {w.a.pk}


@pytest.mark.parametrize("default", ["omitted", None], ids=["omitted", "null"])
def test_an_override_saved_on_an_unconfigured_role_adds_no_default_row(w, default):
    """从没配过的角色只改一项覆盖再保存:不多出默认 ALL 那一行(否则兼任时它让结果变成全部)。"""
    body = {"overrides": [{"resource": "soul", "scope": "SELF"}]}
    if default is None:
        body["default"] = None
    response = officer_client(w.admin).put(url(w.role), body, format="json")
    assert response.status_code == 200, response.content
    assert response.data["default_configured"] is False
    assert list(RoleDataScope.objects.filter(role=w.role).values_list("resource", "scope")) == [("soul", "SELF")]

    scope("VIEWER", "ORG")
    w.judge.role, w.judge.extra_roles = "VIEWER", ["JUDGE"]
    assert data_scope.org_ids(w.judge, "judgment") == {w.a.pk}, "JUDGE 没配默认,兼任时不放宽"


@pytest.mark.parametrize("start", ["unconfigured", "all"])
def test_toggling_only_the_default_all_row_is_audited(w, start):
    """没配 ↔ 显式全部:GET 的 default 两边都是 ALL,但兼任时结果不同,所以要记审计。"""
    client = officer_client(w.admin)
    if start == "all":
        scope("JUDGE", "ALL")
    body = {"overrides": []} if start == "all" else {"default": {"scope": "ALL"}, "overrides": []}
    assert client.put(url(w.role), body, format="json").status_code == 200
    row = AuditLog.objects.get(action=AuditAction.PERMISSION_CHANGE, resource="role", resource_id=str(w.role.pk))
    change = row.changes["data_scope"]
    assert change["old"]["default_configured"] is (start == "all")
    assert change["new"]["default_configured"] is (start != "all")
    assert change["old"]["default"] == change["new"]["default"] == {"scope": "ALL", "orgs": []}


def test_copying_an_unconfigured_role_leaves_the_copy_unconfigured(w):
    """复制逐行照抄:源角色没配,副本也没有行(不会凭空多一行 ALL)。"""
    response = officer_client(w.admin).post(f"/api/v1/perm/roles/{w.role.pk}/copy/",
                                            {"name": "CLERK", "display_name": "书吏"}, format="json")
    assert response.status_code == 201, response.content
    assert not RoleDataScope.objects.filter(role__name="CLERK").exists()


@pytest.mark.parametrize("who", ["hall_admin", "judge"])
def test_only_a_hall_less_settings_holder_writes(w, who):
    user = getattr(w, who)
    if who == "judge":  # holds the read code, still may not write
        perm = Permission.objects.get_or_create(codename="system.settings", defaults={"name": "s", "category": "system"})[0]
        RolePermission.objects.get_or_create(role=w.role, permission=perm)
    client = officer_client(user)
    assert client.get(url(w.role)).status_code == 200
    assert client.put(url(w.role), GOOD(w), format="json").status_code == 403
    assert not RoleDataScope.objects.filter(role=w.role).exists()


def test_without_the_settings_code_even_reading_is_refused(w):
    Permission.objects.get_or_create(codename="system.settings", defaults={"name": "s", "category": "system"})
    client = officer_client(w.judge)
    assert client.get(url(w.role)).status_code == 403
    assert client.get(RESOURCES).status_code == 403


def test_the_admin_role_is_fixed(w):
    response = officer_client(w.admin).put(url(w.admin_role), GOOD(w), format="json")
    assert response.status_code == 400 and response.data["code"] == "admin_role"
    assert not RoleDataScope.objects.filter(role=w.admin_role).exists()


@pytest.mark.parametrize("body", [
    {"default": {"scope": "DEFINE", "orgs": []}, "overrides": []},
    {"default": {"scope": "ALL"}, "overrides": [{"resource": "soul", "scope": "DEFINE"}]},
    {"default": {"scope": "DEFINE", "orgs": [987654]}, "overrides": []},
    {"default": {"scope": "ALL"}, "overrides": [{"resource": "nope", "scope": "ORG"}]},
    {"default": {"scope": "ALL"}, "overrides": [{"resource": "soul", "scope": "ORG"}, {"resource": "soul", "scope": "SELF"}]},
    {"default": {"scope": "EVERYTHING"}, "overrides": []},
], ids=["define-empty", "override-define-empty", "unknown-org", "unknown-resource", "duplicate", "bad-scope"])
def test_bad_configs_are_refused_and_change_nothing(w, body):
    scope("JUDGE", "ORG")
    response = officer_client(w.admin).put(url(w.role), body, format="json")
    assert response.status_code == 400, response.content
    assert list(RoleDataScope.objects.filter(role=w.role).values_list("resource", "scope")) == [("", "ORG")]


def test_an_unknown_role_is_404(w):
    assert officer_client(w.admin).get("/api/v1/perm/roles/987654/data-scope/").status_code == 404


def test_export_then_import_gives_back_the_same_scopes(w):
    officer_client(w.admin).put(url(w.role), GOOD(w), format="json")
    before = role_config(w.role)
    exported = export_permissions()
    assert {"role": "JUDGE", "resource": "soul", "scope": "DEFINE", "orgs": sorted([w.a.code, w.e.code])} \
        in exported["role_data_scopes"]
    assert "data_scopes" not in exported
    RoleDataScope.objects.filter(role=w.role).delete()
    stats = import_permissions({"role_data_scopes": exported["role_data_scopes"]})
    assert stats["role_data_scopes"]["created"] == 3
    assert role_config(w.role) == before


def test_a_copy_carries_the_data_scope_and_the_source_keeps_its_own(w):
    client = officer_client(w.admin)
    client.put(url(w.role), GOOD(w), format="json")
    response = client.post(f"/api/v1/perm/roles/{w.role.pk}/copy/", {"name": "ASSESSOR", "display_name": "陪审"},
                           format="json")
    assert response.status_code == 201, response.content
    copy = Role.objects.get(name="ASSESSOR")
    assert role_config(copy) == role_config(w.role) != {
        "default": {"scope": "ALL", "orgs": []}, "default_configured": False, "overrides": []}
    assert RoleDataScope.objects.filter(role=w.role).count() == 3


def test_the_org_list_and_tree_follow_the_org_scope(w):
    perm = Permission.objects.get_or_create(codename="org.read", defaults={"name": "org", "category": "org"})[0]
    RolePermission.objects.get_or_create(role=w.role, permission=perm)
    peer = org(w.tenant, "乙司")
    child = org(w.tenant, "甲司一科", parent=w.a)
    client = officer_client(w.judge)

    def listed(path):
        data = client.get(path).data
        return {row["id"] for row in (data["results"] if isinstance(data, dict) else data)}

    unscoped = listed("/api/v1/organizations/")
    assert {w.a.pk, child.pk, peer.pk, tenant_root(w.tenant).pk} <= unscoped  # no config = all of the hall
    scope("JUDGE", "ORG_CHILD", resource="org")
    assert listed("/api/v1/organizations/") == {w.a.pk, child.pk}
    assert listed("/api/v1/organizations/tree/") == {w.a.pk}, "the top of what the judge sees, not the hall root"
    assert client.get(f"/api/v1/organizations/{peer.pk}/").status_code == 404
