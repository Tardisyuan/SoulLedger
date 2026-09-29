"""匾上的印字(`Tenant.seal_glyphs`):按文明校验、只有 ADMIN 能改、登录 / profile / /me/ 都带出来。"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.tenants.models import Tenant
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

HIERO = "\U00013184"  # 默认字 U+13184
HIERO_2 = "\U00013000"


@pytest.fixture
def tenants(cn_tenant, eu_tenant):
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    gr, _ = Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})
    odd, _ = Tenant.objects.get_or_create(code="XX_NOWHERE", defaults={"display_name": "Nowhere"})
    return {"CN": cn_tenant, "EU": eu_tenant, "EG": eg, "GR": gr, "XX": odd}


def _client(user):
    """真 JWT(带 tenant_code),不用 force_authenticate:非 ADMIN 的 403 必须来自
    `IsAdminPermission`,而不是来自 TenantPermission 读不到租户。"""
    token = RefreshToken.for_user(user)
    if user.tenant_id:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _patch(user, tenant, glyphs):
    return _client(user).patch(f"/api/v1/tenants/{tenant.code}/seal-glyphs/", {"seal_glyphs": glyphs}, format="json")


VALID = [
    ("CN", ["冥"]), ("CN", ["𠀀"]),  # 扩展 B 也是汉字
    ("EU", ["J"]),
    ("EG", [HIERO]), ("EG", [HIERO, HIERO_2]),
    ("GR", ["Μ"]), ("GR", ["Ω"]),
]

INVALID = [
    ("CN", ["冥", "府"]),       # 太长
    ("CN", ["冥府"]),           # 一项两个字
    ("CN", ["J"]),              # 字符集不对
    ("CN", [" "]),
    ("EU", ["j"]),              # 小写
    ("EU", ["Μ"]),              # 希腊 Mu 不是拉丁
    ("EU", ["J", "K"]),
    ("EG", [HIERO, HIERO_2, HIERO]),  # >2 → 400,不截断
    ("EG", ["冥"]),
    ("EG", [HIERO + HIERO_2]),  # 两个码位塞进一项
    ("GR", ["M"]),              # 拉丁 M(U+004D)不是 Μ(U+039C)
    ("GR", ["μ"]),              # 小写
    ("XX", ["冥"]),             # 没有文明的租户只能留空
]


@pytest.mark.parametrize("civ,glyphs", VALID)
def test_valid_glyphs_are_saved(admin_user, tenants, civ, glyphs):
    resp = _patch(admin_user, tenants[civ], glyphs)
    assert resp.status_code == 200, resp.data
    assert resp.data["seal_glyphs"] == glyphs
    tenants[civ].refresh_from_db()
    assert tenants[civ].seal_glyphs == glyphs


@pytest.mark.parametrize("civ,glyphs", INVALID)
def test_invalid_glyphs_are_refused_and_nothing_is_saved(admin_user, tenants, civ, glyphs):
    """变异:去掉 `len(glyphs) > limit` 或把希腊前缀改成 `CAPITAL LETTER` → 对应几条变绿,红。"""
    tenant = tenants[civ]
    tenant.seal_glyphs = []
    tenant.save()
    resp = _patch(admin_user, tenant, glyphs)
    assert resp.status_code == 400, resp.data
    assert "seal_glyphs" in resp.data
    tenant.refresh_from_db()
    assert tenant.seal_glyphs == []  # 不截断、不部分写入


@pytest.mark.parametrize("civ", ["CN", "EU", "EG", "GR", "XX"])
def test_empty_means_default_and_is_always_allowed(admin_user, tenants, civ):
    tenant = tenants[civ]
    tenant.seal_glyphs = ["冥"] if civ == "CN" else []
    tenant.save()
    resp = _patch(admin_user, tenant, [])
    assert resp.status_code == 200
    tenant.refresh_from_db()
    assert tenant.seal_glyphs == []


def test_a_non_list_is_refused_and_an_absent_field_changes_nothing(admin_user, cn_tenant):
    cn_tenant.seal_glyphs = ["冥"]
    cn_tenant.save()
    client = _client(admin_user)
    url = f"/api/v1/tenants/{cn_tenant.code}/seal-glyphs/"
    assert client.patch(url, {"seal_glyphs": "府"}, format="json").status_code == 400
    assert client.patch(url, {"seal_glyphs": None}, format="json").status_code == 400
    assert client.patch(url, {}, format="json").status_code == 200  # PATCH:没给就不动
    cn_tenant.refresh_from_db()
    assert cn_tenant.seal_glyphs == ["冥"]


@pytest.mark.parametrize("who", ["judge_user", "guardian_user", "viewer_user"])
def test_non_admin_cannot_change_even_their_own_tenant(request, cn_tenant, who):
    """变异:去掉 action 上的 `IsAdminPermission` → 本租户的 JUDGE 拿到 200,红。"""
    user = request.getfixturevalue(who)
    resp = _patch(user, cn_tenant, ["冥"])
    assert resp.status_code == 403
    cn_tenant.refresh_from_db()
    assert cn_tenant.seal_glyphs == []


def test_other_tenant_fields_stay_read_only(admin_user, cn_tenant):
    client = _client(admin_user)
    url = f"/api/v1/tenants/{cn_tenant.code}/"
    assert client.patch(url, {"display_name": "x"}, format="json").status_code == 405
    resp = client.patch(f"{url}seal-glyphs/", {"seal_glyphs": ["冥"], "display_name": "x"}, format="json")
    assert resp.status_code == 200
    cn_tenant.refresh_from_db()
    assert cn_tenant.display_name == "Chinese Diyu"


def test_tenant_api_reports_civilization_and_glyphs(judge_user, tenants):
    tenants["CN"].seal_glyphs = ["冥"]
    tenants["CN"].save()
    client = _client(judge_user)
    data = client.get("/api/v1/tenants/CN_DIYU/").data
    assert data["civilization"] == "CHINESE"
    assert data["seal_glyphs"] == ["冥"]
    assert client.get("/api/v1/tenants/").data["results"][0]["civilization"] == "CHINESE"


def test_login_and_profile_carry_civilization_and_glyphs(api_client, django_user_model, tenants):
    """变异:`LoginTenantRefSerializer` 去掉 civilization → 登录体少这个键,红。"""
    gr = tenants["GR"]
    gr.seal_glyphs = ["Ω"]
    gr.save()
    django_user_model.objects.create_user(username="gr_judge", password="pw-123456", role="JUDGE", tenant=gr)
    resp = api_client.post("/api/v1/auth/login/", {"username": "gr_judge", "password": "pw-123456"}, format="json")
    assert resp.status_code == 200, resp.content
    expected = {"code": "GR_HADES", "display_name": "Hades", "civilization": "GREEK", "seal_glyphs": ["Ω"]}
    assert resp.json()["user"]["tenant"] == expected

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.json()['access']}")
    profile = api_client.get("/api/v1/auth/profile/")
    assert profile.status_code == 200
    assert profile.json()["tenant"] == expected


def test_a_user_without_tenant_gets_null(api_client, django_user_model, db):
    django_user_model.objects.create_user(username="global_admin", password="pw-123456", role="ADMIN")
    resp = api_client.post("/api/v1/auth/login/", {"username": "global_admin", "password": "pw-123456"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["user"]["tenant"] is None


def test_me_carries_the_current_tenant_glyphs(cn_tenant):
    cn_tenant.seal_glyphs = ["冥"]
    cn_tenant.save()
    _, client = ready_soul(cn_tenant, name="甲")
    me = client.get("/api/v1/me/").data
    assert me["tenant"]["seal_glyphs"] == ["冥"]
    assert me["civilization"] == "CHINESE"
