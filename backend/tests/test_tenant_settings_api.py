"""`PATCH /tenants/{code}/settings/`:只有 ADMIN 能改、只收已知字段、`settings` 里别的键不被冲掉。

此前这些字段只有后端规则没有入口:`hall_name*` 连 `TenantSerializer` 都不带,
`soul_rebirth_cooldown_days` 只能改库。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.soul_accounts.rebirth import cooldown_days
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING

pytestmark = pytest.mark.django_db


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _patch(user, tenant, body):
    return _client(user).patch(f"/api/v1/tenants/{tenant.code}/settings/", body, format="json")


def test_admin_updates_the_known_fields_and_the_response_carries_them(admin_user, cn_tenant):
    resp = _patch(admin_user, cn_tenant, {
        "description": "第五殿,阎罗王坐镇",
        "dispatch_enabled": False,
        "hall_name": "第五殿", "hall_name_en": "The Fifth Court", "hall_name_egy": "Yanluo Wesekhet",
        "soul_rebirth_cooldown_days": 45,
    })
    assert resp.status_code == 200, resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.description == "第五殿,阎罗王坐镇"
    assert cn_tenant.dispatch_enabled is False
    assert cn_tenant.hall_names == {"zh-Hans": "第五殿", "en": "The Fifth Court", "egy": "Yanluo Wesekhet"}
    assert cooldown_days(cn_tenant) == 45
    for k in ("hall_name", "hall_name_en", "hall_name_egy"):
        assert resp.data[k] == getattr(cn_tenant, k)
    assert resp.data["settings"][REBIRTH_COOLDOWN_SETTING] == 45


def test_cooldown_merges_into_settings_instead_of_replacing_them(admin_user, cn_tenant):
    """变异:`update()` 里改成 `instance.settings = {REBIRTH_COOLDOWN_SETTING: days}` → 红。"""
    cn_tenant.settings = {"assistant_enabled": True, "other": [1, 2]}
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, {"soul_rebirth_cooldown_days": 7})
    assert resp.status_code == 200, resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings == {"assistant_enabled": True, "other": [1, 2], REBIRTH_COOLDOWN_SETTING: 7}


def test_null_cooldown_removes_the_key_and_falls_back_to_the_default(admin_user, cn_tenant):
    cn_tenant.settings = {"assistant_enabled": True, REBIRTH_COOLDOWN_SETTING: 3}
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, {"soul_rebirth_cooldown_days": None})
    assert resp.status_code == 200, resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings == {"assistant_enabled": True}
    assert cooldown_days(cn_tenant) == 30


@pytest.mark.parametrize("bad", [-1, "soon", 1.5, {"a": 1}])
def test_cooldown_outside_the_range_is_refused_and_nothing_is_written(admin_user, cn_tenant, bad):
    """变异:去掉 `min_value=0` → `-1` 那条变绿,红。"""
    cn_tenant.settings = {"assistant_enabled": True}
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, {"soul_rebirth_cooldown_days": bad, "description": "x"})
    assert resp.status_code == 400, resp.data
    assert "soul_rebirth_cooldown_days" in resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings == {"assistant_enabled": True}
    assert cn_tenant.description == ""


def test_unknown_keys_and_a_raw_settings_blob_are_ignored(admin_user, cn_tenant):
    cn_tenant.settings = {"assistant_enabled": True}
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, {"settings": {"assistant_enabled": False}, "display_name": "x",
                                          "code": "Y", "is_active": False})
    assert resp.status_code == 200, resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings == {"assistant_enabled": True}
    assert cn_tenant.display_name == "Chinese Diyu"
    assert cn_tenant.code == "CN_DIYU"
    assert cn_tenant.is_active is True


def test_hall_name_longer_than_the_column_is_a_400_not_a_truncation(admin_user, cn_tenant):
    resp = _patch(admin_user, cn_tenant, {"hall_name": "殿" * 61})
    assert resp.status_code == 400
    assert "hall_name" in resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.hall_name == ""


@pytest.mark.parametrize("who", ["judge_user", "guardian_user", "viewer_user"])
def test_non_admin_cannot_change_even_their_own_tenant(request, cn_tenant, who):
    """变异:去掉 action 上的 `IsAdminPermission` → 本租户的 JUDGE 拿到 200,红。"""
    user = request.getfixturevalue(who)
    resp = _patch(user, cn_tenant, {"description": "x"})
    assert resp.status_code == 403
    cn_tenant.refresh_from_db()
    assert cn_tenant.description == ""


def test_the_list_carries_the_hall_names_so_the_form_can_start_from_them(judge_user, cn_tenant):
    cn_tenant.hall_name_en = "The Fifth Court"
    cn_tenant.save()
    resp = _client(judge_user).get("/api/v1/tenants/")
    assert resp.status_code == 200
    row = next(r for r in resp.data["results"] if r["code"] == cn_tenant.code)
    assert row["hall_name_en"] == "The Fifth Court"
