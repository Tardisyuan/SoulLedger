"""`POST /perm/import/` 校验它的 body,而且要么全做、要么全不做。

2026-09-12 审计 BP-01(P0)。此前的 view 是:

    overwrite = request.data.get('overwrite', False)
    stats = do_import(data, overwrite=overwrite)

`PermissionImportRequestSerializer` 声明了完整的 body 形状,却从未被实例化 ——
它只给 drf-spectacular 看。于是三件事同时成立,全部实测:

  {"overwrite": "false", "roles": []}          → 200,而且**全部** RolePermission 被清
                                                 (字符串 "false" 为真)
  {"overwrite": true,
   "permissions": [{"codename": "x"}]}         → KeyError → 500,而授权**已经删了**
                                                 (三条 `.all().delete()` 在循环之前,
                                                  没有 atomic)
  body 是一个 list                              → AttributeError → 500

ADMIN-only,所以不是提权;但它是一个由错别字触发、无法回滚的全局授权清空,
而回应它的是一个 200。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.perm.models import Permission, Role, RolePermission
from apps.tenants.models import Tenant

IMPORT = "/api/v1/perm/import/"
EXPORT = "/api/v1/perm/export/"


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def seeded(db):
    """A role holding two grants, so "the grants are still there" is a real assertion."""
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    role, _ = Role.objects.get_or_create(name="IMPORT_PROBE", defaults={"display_name": "Import probe"})
    for codename in ("imp.read", "imp.write"):
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "imp"}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    admin = User.objects.create_user(username="imp_admin", password="x", role="ADMIN", tenant=tenant)
    viewer = User.objects.create_user(username="imp_viewer", password="x", role="VIEWER", tenant=tenant)
    return {"tenant": tenant, "role": role, "admin": admin, "viewer": viewer}


def _grants_of(role):
    return sorted(RolePermission.objects.filter(role=role).values_list("permission__codename", flat=True))


@pytest.mark.django_db
def test_a_viewer_cannot_import_at_all(seeded):
    """守卫先用非管理员身份钉住 —— `IsAdminPermission` 是这条 P0 不是提权的唯一理由。"""
    client = _client_for(seeded["viewer"], seeded["tenant"])
    before = _grants_of(seeded["role"])
    response = client.post(IMPORT, {"overwrite": True, "roles": []}, format="json")
    assert response.status_code == 403, response.content
    assert _grants_of(seeded["role"]) == before


@pytest.mark.django_db
def test_a_string_overwrite_is_rejected_and_deletes_nothing(seeded):
    client = _client_for(seeded["admin"], seeded["tenant"])
    before = _grants_of(seeded["role"])
    total_before = RolePermission.objects.count()
    assert before == ["imp.read", "imp.write"]

    response = client.post(IMPORT, {"overwrite": "false", "roles": []}, format="json")

    assert response.status_code == 400, response.content
    assert "overwrite" in response.data, response.data
    # 断言「错的东西不在」:授权一条都没少 —— 修之前这条请求答 200 并清空全表。
    assert _grants_of(seeded["role"]) == before
    assert RolePermission.objects.count() == total_before


@pytest.mark.django_db
def test_a_malformed_entry_is_rejected_before_anything_is_deleted(seeded):
    client = _client_for(seeded["admin"], seeded["tenant"])
    before = _grants_of(seeded["role"])

    response = client.post(
        IMPORT,
        {"overwrite": True, "permissions": [{"codename": "x"}]},
        format="json",
    )

    assert response.status_code == 400, response.content
    assert "permissions" in response.data, response.data
    assert _grants_of(seeded["role"]) == before, (
        "修之前:KeyError 500,而 overwrite 的三条 delete 已经执行"
    )


@pytest.mark.django_db
def test_a_list_body_is_a_400_not_a_500(seeded):
    client = _client_for(seeded["admin"], seeded["tenant"])
    response = client.post(IMPORT, [{"overwrite": True}], format="json")
    assert response.status_code == 400, response.content


@pytest.mark.django_db
def test_a_failure_mid_import_rolls_the_overwrite_back(seeded, monkeypatch):
    """校验挡住的是**形状**;这一条挡住的是形状正确、执行中途出错的情形。

    在第二个 Permission 建到一半时抛错。没有 `transaction.atomic()`,overwrite 那
    三条 delete 早已提交,而回应是 500 —— 授权没了、没人知道。
    """
    client = _client_for(seeded["admin"], seeded["tenant"])
    before = _grants_of(seeded["role"])

    # Patch the call the import loop actually makes. This was
    # `Permission.objects.get_or_create` until 3ecd5af switched the loop to
    # `Permission.revive_or_create`; the patch then intercepted nothing, the
    # simulated failure never fired, and this test went red with
    # "DID NOT RAISE" — the right outcome for a test whose subject moved.
    real_revive_or_create = Permission.revive_or_create
    calls = {"n": 0}

    def exploding_revive_or_create(codename, **defaults):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("simulated failure half-way through the import")
        return real_revive_or_create(codename, **defaults)

    monkeypatch.setattr(Permission, "revive_or_create", exploding_revive_or_create)

    payload = {
        "overwrite": True,
        "permissions": [
            {"codename": "imp.a", "name": "A", "category": "imp"},
            {"codename": "imp.b", "name": "B", "category": "imp"},
        ],
        "roles": [{"name": "IMPORT_PROBE", "display_name": "Import probe"}],
        "role_permissions": [{"role": "IMPORT_PROBE", "permission": "imp.read"}],
    }
    with pytest.raises(RuntimeError):
        client.post(IMPORT, payload, format="json")

    assert calls["n"] == 2, "前置条件:第二次 get_or_create 真的被打断了"
    assert _grants_of(seeded["role"]) == before, (
        "导入中途失败,overwrite 删掉的授权没有回滚"
    )
    assert not Permission.objects.filter(codename="imp.a").exists(), (
        "第一条 Permission 留下来了 —— 导入不是一个事务"
    )


@pytest.mark.django_db
def test_a_real_export_round_trips_with_overwrite(seeded):
    """正向对照:合法的文档照旧能导入,校验没有把真文档挡在门外。"""
    client = _client_for(seeded["admin"], seeded["tenant"])
    exported = client.get(EXPORT)
    assert exported.status_code == 200
    document = exported.json()
    document["overwrite"] = True

    response = client.post(IMPORT, document, format="json")

    assert response.status_code == 200, response.content
    assert response.data["stats"]["role_permissions"] == RolePermission.objects.count()
    assert _grants_of(seeded["role"]) == ["imp.read", "imp.write"]
