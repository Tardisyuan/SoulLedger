"""管理员改殿的设置 / 印字时写审计(`apps/tenants/views.py::audit_hall_change`):
谁、哪个殿、每个变了的字段 `[旧, 新]`;没变不写;非 ADMIN 被拒也不写。

`transaction=True`:`apps/audit/signals.py` 的泛化 UPDATE 行走 `transaction.on_commit`,
只有真提交才落盘;不这样,「没写审计」的断言对着一张永远空的表,`oncommit_guard` 会红。
泛化行与视图那条都是 `resource="tenant"`,按 `description` 前缀 `hall ` 分开。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING

pytestmark = pytest.mark.django_db(transaction=True)


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _patch(user, tenant, path, body):
    return _client(user).patch(f"/api/v1/tenants/{tenant.code}/{path}/", body, format="json",
                               HTTP_USER_AGENT="pytest-ua", REMOTE_ADDR="10.9.8.7")


def _rows():
    return list(AuditLog.objects.filter(resource="tenant", description__startswith="hall ").order_by("id"))


def test_settings_edit_writes_one_row_with_old_and_new_per_changed_field(admin_user, cn_tenant):
    cn_tenant.description = "旧说明"
    cn_tenant.hall_name_en = "Old Court"
    cn_tenant.settings = {"assistant_enabled": True, REBIRTH_COOLDOWN_SETTING: 30}
    cn_tenant.save()
    AuditLog.objects.all().delete()

    resp = _patch(admin_user, cn_tenant, "settings", {
        "description": "新说明", "dispatch_enabled": not cn_tenant.dispatch_enabled,
        "hall_name_en": "Old Court",  # 原样提交:不该出现在 changes 里
        "soul_rebirth_cooldown_days": 45,
    })
    assert resp.status_code == 200, resp.data
    (row,) = _rows()
    assert row.action == "UPDATE"
    assert row.resource_id == cn_tenant.code
    assert row.description == f"hall settings {cn_tenant.code}"
    assert row.changes == {
        "description": ["旧说明", "新说明"],
        "dispatch_enabled": [not resp.data["dispatch_enabled"], resp.data["dispatch_enabled"]],
        "soul_rebirth_cooldown_days": [30, 45],
    }
    assert row.user_id == admin_user.pk
    assert row.tenant_id == cn_tenant.pk
    assert row.ip_address == "10.9.8.7"
    assert row.user_agent == "pytest-ua"


def test_removing_the_cooldown_records_old_to_none(admin_user, cn_tenant):
    cn_tenant.settings = {REBIRTH_COOLDOWN_SETTING: 3}
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, "settings", {"soul_rebirth_cooldown_days": None})
    assert resp.status_code == 200, resp.data
    (row,) = _rows()
    assert row.changes == {"soul_rebirth_cooldown_days": [3, None]}


def test_seal_glyph_edit_writes_a_row(admin_user, cn_tenant):
    cn_tenant.seal_glyphs = ["冥"]
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, "seal-glyphs", {"seal_glyphs": ["府"]})
    assert resp.status_code == 200, resp.data
    (row,) = _rows()
    assert row.description == f"hall seal glyphs {cn_tenant.code}"
    assert row.changes == {"seal_glyphs": [["冥"], ["府"]]}
    assert row.user_id == admin_user.pk and row.tenant_id == cn_tenant.pk


@pytest.mark.parametrize("path,body", [
    ("settings", lambda t: {"description": t.description, "hall_name": t.hall_name}),
    ("settings", lambda t: {}),
    ("seal-glyphs", lambda t: {"seal_glyphs": list(t.seal_glyphs)}),
], ids=["same-values", "empty-body", "same-glyphs"])
def test_nothing_changed_writes_nothing(admin_user, cn_tenant, path, body):
    """变异:`audit_hall_change` 去掉 `if not changes: return` → 红。"""
    cn_tenant.seal_glyphs = ["冥"]
    cn_tenant.save()
    resp = _patch(admin_user, cn_tenant, path, body(cn_tenant))
    assert resp.status_code == 200, resp.data
    assert _rows() == []


def test_actor_and_hall_are_the_editor_and_the_edited_hall(eu_admin_user, cn_tenant, eu_tenant):
    """EU 的 ADMIN 改 CN 的殿:`user` 是 EU 管理员,`tenant` 是被改的 CN 殿,不是管理员自己的。"""
    resp = _patch(eu_admin_user, cn_tenant, "settings", {"hall_name": "第五殿"})
    assert resp.status_code == 200, resp.data
    (row,) = _rows()
    assert row.user_id == eu_admin_user.pk
    assert row.tenant_id == cn_tenant.pk != eu_tenant.pk


@pytest.mark.parametrize("path,body", [
    ("settings", {"hall_name": "第五殿"}),
    ("seal-glyphs", {"seal_glyphs": ["府"]}),
])
def test_non_admin_is_refused_and_leaves_no_row(judge_user, cn_tenant, path, body):
    resp = _patch(judge_user, cn_tenant, path, body)
    assert resp.status_code == 403, resp.data
    cn_tenant.refresh_from_db()
    assert cn_tenant.hall_name != "第五殿" and cn_tenant.seal_glyphs != ["府"]
    assert _rows() == []


# ── 每次编辑恰好一行(泛化 UPDATE 行被 `explicit_audit_for` 压掉)────────────────────────


def _all_tenant_rows(code):
    return list(AuditLog.objects.filter(resource__in=("tenant", "assistant_config"), action="UPDATE")
                .filter(resource_id__in=(code, f"tenant:{code}")))


@pytest.mark.parametrize("path,body,prefix", [
    ("settings", {"hall_name": "第五殿"}, "hall settings"),
    ("seal-glyphs", {"seal_glyphs": ["府"]}, "hall seal glyphs"),
])
def test_one_edit_leaves_exactly_one_row(admin_user, cn_tenant, path, body, prefix):
    """变异:视图里去掉 `with explicit_audit_for(tenant)` → 两行(另一条是泛化的),红。"""
    AuditLog.objects.all().delete()
    assert _patch(admin_user, cn_tenant, path, body).status_code == 200
    (row,) = AuditLog.objects.filter(resource="tenant")
    assert row.description == f"{prefix} {cn_tenant.code}"


def test_the_assistant_hall_switch_leaves_exactly_one_row(admin_user, cn_tenant):
    AuditLog.objects.all().delete()
    resp = _client(admin_user).patch(f"/api/v1/assist-admin/halls/{cn_tenant.pk}/",
                                     {"assistant_enabled": True}, format="json")
    assert resp.status_code == 200, resp.data
    assert AuditLog.objects.filter(resource="tenant").count() == 0
    (row,) = _all_tenant_rows(cn_tenant.code)
    assert row.description == f"hall assistant switch {cn_tenant.code}"


def test_other_saves_still_get_their_generic_row(cn_tenant, eu_tenant):
    """压制只认 (模型, pk) 且只在块内:块外的同一殿、块内的另一殿都照写泛化行。"""
    from apps.audit.signals import explicit_audit_for

    AuditLog.objects.all().delete()
    with explicit_audit_for(cn_tenant):
        cn_tenant.description = "块内"
        cn_tenant.save()
        eu_tenant.description = "别的殿"
        eu_tenant.save()
    cn_tenant.description = "块外"
    cn_tenant.save()
    rows = AuditLog.objects.filter(resource="tenant", action="UPDATE")
    assert sorted(r.resource_id for r in rows) == sorted([str(eu_tenant.pk), str(cn_tenant.pk)])
