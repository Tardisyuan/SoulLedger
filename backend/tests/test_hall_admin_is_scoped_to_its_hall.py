"""殿管理员限本殿(用户 2026-10-29 决定 O)。

只有**没绑殿**(tenant 为空)的 ADMIN 是全局的;绑了殿的 ADMIN 只读写本殿 —— 别殿的行 404,全站配置
(殿本身、角色与权限矩阵、菜单、助手供应商)403,也不能任命 ADMIN(否则可借一个新 ADMIN 升格)。
判定只在 `apps/core/tenant.py::is_tenant_exempt` 一处;下面每条都同时问全局 ADMIN,证明放行没被一起关掉。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.core.tenant import is_tenant_exempt
from apps.souls.models import Soul
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "埃及杜阿特"})[0]
    bound = User.objects.create_user(username="cn_admin", password="x", role="ADMIN", tenant=cn)
    glob = User.objects.create_user(username="g_admin", password="x", role="ADMIN", tenant=None)
    eg_judge = User.objects.create_user(username="eg_judge", password="x", role="JUDGE", tenant=eg)
    cn_judge = User.objects.create_user(username="cn_judge", password="x", role="JUDGE", tenant=cn)
    own = Soul.objects.create(name="本殿", tenant=cn, current_state="ALIVE", birth_date="1990-01-15")
    other = Soul.objects.create(name="别殿", tenant=eg, current_state="ALIVE", birth_date="1990-01-15")
    return {"cn": cn, "eg": eg, "bound": bound, "glob": glob, "eg_judge": eg_judge, "cn_judge": cn_judge,
            "own": own, "other": other, "b": _client(bound), "g": _client(glob)}


def test_only_the_hall_less_admin_is_exempt(world):
    assert is_tenant_exempt(world["glob"])
    assert not is_tenant_exempt(world["bound"])
    assert not is_tenant_exempt(world["cn_judge"])
    world["glob"].hall_view = world["cn"].pk
    assert not is_tenant_exempt(world["glob"])


def test_bound_admin_reads_and_writes_its_own_hall_only(world):
    b, g = world["b"], world["g"]
    names = {row["name"] for row in _rows(b.get("/api/v1/souls/"))}
    assert "本殿" in names and "别殿" not in names
    assert b.get(f"/api/v1/souls/{world['own'].pk}/").status_code == 200
    assert b.get(f"/api/v1/souls/{world['other'].pk}/").status_code == 404
    assert b.patch(f"/api/v1/souls/{world['other'].pk}/", {"name": "改"}, format="json").status_code == 404
    world["other"].refresh_from_db()
    assert world["other"].name == "别殿"
    # 全局 ADMIN 照旧跨殿
    assert {"本殿", "别殿"} <= {row["name"] for row in _rows(g.get("/api/v1/souls/"))}
    assert g.get(f"/api/v1/souls/{world['other'].pk}/").status_code == 200


def test_bound_admin_sees_only_its_halls_users_and_login_log(world):
    b, g = world["b"], world["g"]
    users = {row["username"] for row in _rows(b.get("/api/v1/users/"))}
    assert "cn_judge" in users and "eg_judge" not in users and "g_admin" not in users
    assert b.get(f"/api/v1/users/{world['eg_judge'].pk}/").status_code == 404
    assert "eg_judge" in {row["username"] for row in _rows(g.get("/api/v1/users/"))}


@pytest.mark.parametrize("method,url,body", [
    ("post", "/api/v1/tenants/", {"code": "GR_HADES", "display_name": "x"}),
    ("get", "/api/v1/tenants/overview/", None),
    ("post", "/api/v1/tenants/EG_DUAT/deactivate/", None),
    ("post", "/api/v1/perm/roles/create/", {"name": "SCRIBE", "display_name": "Scribe"}),
    ("post", "/api/v1/perm/roles/init/", None),
    ("post", "/api/v1/menus/", {"name": "x", "path": "/x"}),
    ("get", "/api/v1/assist-admin/config/", None),
])
def test_bound_admin_cannot_touch_configuration_shared_by_every_hall(world, method, url, body):
    res = getattr(world["b"], method)(url, body, format="json") if body is not None else getattr(world["b"], method)(url)
    assert res.status_code == 403, res.content
    # 同一个请求,全局 ADMIN 不是 403(成功或校验错都行 —— 这里只证明门没被一起关上)。
    res = getattr(world["g"], method)(url, body, format="json") if body is not None else getattr(world["g"], method)(url)
    assert res.status_code != 403, res.content


def test_bound_admin_cannot_impersonate_someone_of_another_hall(world):
    res = world["b"].post("/api/v1/auth/impersonate/", {"user_id": world["eg_judge"].pk, "reason": "查看"}, format="json")
    assert res.status_code == 404


def test_bound_admin_cannot_create_a_user_elsewhere_or_appoint_an_admin(world):
    b = world["b"]
    pw = "a-long-enough-password-1"
    elsewhere = b.post("/api/v1/users/", {"username": "x1", "password": pw, "role": "JUDGE", "tenant": world["eg"].pk},
                       format="json")
    assert elsewhere.status_code == 400 and "tenant" in elsewhere.json()
    admin = b.post("/api/v1/users/", {"username": "x2", "password": pw, "role": "ADMIN"}, format="json")
    assert admin.status_code == 400 and "role" in admin.json()
    assert not User.objects.filter(username__in=["x1", "x2"]).exists()
    # 本殿的普通官员照建,落在本殿
    ok = b.post("/api/v1/users/", {"username": "x3", "password": pw, "role": "JUDGE"}, format="json")
    assert ok.status_code == 201, ok.content
    assert User.objects.get(username="x3").tenant_id == world["cn"].pk

    promote = b.post(f"/api/v1/users/{world['cn_judge'].pk}/assign_roles/", {"role": "ADMIN"}, format="json")
    assert promote.status_code == 403
    patch = b.patch(f"/api/v1/users/{world['cn_judge'].pk}/", {"role": "ADMIN"}, format="json")
    assert patch.status_code == 400
    world["cn_judge"].refresh_from_db()
    assert world["cn_judge"].role == "JUDGE"

    # 全局 ADMIN 可以任命
    assert world["g"].post(f"/api/v1/users/{world['cn_judge'].pk}/assign_roles/", {"role": "ADMIN"},
                           format="json").status_code == 200


def test_bound_admin_cannot_invite_into_another_hall(world):
    res = world["b"].post("/api/v1/users/invite/", {"email": "a@example.com", "role": "JUDGE", "tenant": "EG_DUAT"},
                          format="json")
    assert res.status_code == 400
    assert not User.objects.filter(email="a@example.com").exists()


def test_bound_admin_never_reaches_the_hall_less_admin(world):
    """重置密码 / 两步验证 / 停用 / 删除 / 改角色:全局 ADMIN 对绑殿 ADMIN 不存在(404)。"""
    b, gid = world["b"], world["glob"].pk
    for method, url, body in [
        ("post", f"/api/v1/users/{gid}/reset_password/", {}),
        ("post", f"/api/v1/users/{gid}/reset-mfa/", {"reason": "x"}),
        ("post", f"/api/v1/users/{gid}/deactivate/", {}),
        ("delete", f"/api/v1/users/{gid}/", None),
        ("post", f"/api/v1/users/{gid}/assign_roles/", {"role": "JUDGE"}),
        ("patch", f"/api/v1/users/{gid}/", {"role": "JUDGE"}),
    ]:
        res = getattr(b, method)(url, body, format="json") if body is not None else getattr(b, method)(url)
        assert res.status_code == 404, (url, res.status_code)
    world["glob"].refresh_from_db()
    assert world["glob"].is_active and world["glob"].role == "ADMIN"


def test_bound_admin_edits_its_own_halls_settings_only(world):
    b = world["b"]
    assert b.patch("/api/v1/tenants/EG_DUAT/settings/", {"description": "x"}, format="json").status_code == 404
    assert b.get("/api/v1/tenants/EG_DUAT/mfa-roles/").status_code == 404
    assert b.patch("/api/v1/tenants/CN_DIYU/settings/", {"description": "本殿"}, format="json").status_code == 200


def test_bound_admin_restores_its_own_halls_rows_only(world):
    other = world["other"].delete_with_cascade(user=world["glob"])
    own = world["own"].delete_with_cascade(user=world["bound"])
    b = world["b"]
    assert b.post("/api/v1/recycle-bin/restore/", {"cascade_id": str(other)}, format="json").status_code == 404
    assert Soul.all_objects.get(pk=world["other"].pk).is_deleted
    assert b.post("/api/v1/recycle-bin/restore/", {"cascade_id": str(own)}, format="json").status_code == 200
    assert not Soul.all_objects.get(pk=world["own"].pk).is_deleted
    # 全局 ADMIN 照旧能恢复任何殿的
    assert world["g"].post("/api/v1/recycle-bin/restore/", {"cascade_id": str(other)}, format="json").status_code == 200
    assert not Soul.all_objects.get(pk=world["other"].pk).is_deleted


def test_assist_hall_switch_is_own_hall_for_a_bound_admin(world):
    b = world["b"]
    rows = b.get("/api/v1/assist-admin/halls/")
    assert rows.status_code == 200 and [r["code"] for r in rows.json()] == ["CN_DIYU"]
    assert b.patch(f"/api/v1/assist-admin/halls/{world['eg'].pk}/", {"assistant_enabled": True},
                   format="json").status_code == 404
    world["eg"].refresh_from_db()
    assert (world["eg"].settings or {}).get("assistant_enabled") is not True
    assert b.patch(f"/api/v1/assist-admin/halls/{world['cn'].pk}/", {"assistant_enabled": True},
                   format="json").status_code == 200
    assert {r["code"] for r in world["g"].get("/api/v1/assist-admin/halls/").json()} >= {"CN_DIYU", "EG_DUAT"}


def test_copy_from_goes_into_the_callers_hall_or_the_one_the_global_admin_names(world):
    from apps.social.models import SensitiveWord

    SensitiveWord.objects.create(tenant=world["eg"], word="禁词")
    url = "/api/v1/social-moderation/sensitive-words/copy-from/"
    b = world["b"]
    assert b.post(url, {"source_tenant": "EG_DUAT", "target_tenant": "EG_DUAT"}, format="json").status_code == 404
    assert b.post(url, {"source_tenant": "EG_DUAT"}, format="json").status_code == 200
    assert SensitiveWord.objects.filter(tenant=world["cn"], word="禁词").exists()
    g = world["g"]
    assert g.post(url, {"source_tenant": "CN_DIYU"}, format="json").status_code == 400  # no target named
    gr = Tenant.objects.create(code="GR_HADES", display_name="哈迪斯")
    assert g.post(url, {"source_tenant": "EG_DUAT", "target_tenant": "GR_HADES"}, format="json").status_code == 200
    assert SensitiveWord.objects.filter(tenant=gr, word="禁词").exists()


def test_can_end_counts_a_moderator_held_as_an_extra_role(world):
    from types import SimpleNamespace

    from apps.dispatch.services import CrossTenantJudgmentService

    judgment = SimpleNamespace(create_user_id=None, initiating_tenant_id=world["cn"].pk)
    world["cn_judge"].extra_roles = ["MODERATOR"]
    assert CrossTenantJudgmentService.can_end(judgment, world["cn_judge"], world["cn"])
    assert not CrossTenantJudgmentService.can_end(judgment, world["eg_judge"], world["eg"])
    assert not CrossTenantJudgmentService.can_end(judgment, world["bound"], world["eg"])
    assert CrossTenantJudgmentService.can_end(judgment, world["glob"], None)


def _rows(res):
    assert res.status_code == 200, res.content
    body = res.json()
    return body["results"] if isinstance(body, dict) else body
