"""暂居殿删不掉来访灵魂(审计 2026-11-11 A1-01)。

灵魂调拨到 B 殿暂居时,`tenant = B`、`home_tenant = A`,它的记录与未结审判属 A 殿。
`Soul.delete_with_cascade` 的级联只按 `soul` 取行,此前 B 殿持 `soul.delete` 的官员一删,
A 殿的记录与审判同串进回收站,而这一串跨两殿,两殿的绑殿管理员都恢复不了。
现在暂居中的灵魂一律拒删(单删 409、批量 409 `not_deletable`,`archivable` 为 false),什么都不动。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.core.archive import DeletionNotAllowedError
from apps.judgment.models import Judgment
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordType, SoulRecord
from apps.tenants.models import Tenant


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    home, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    host, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})
    role = Role.objects.create(name="HOST_RECYCLER", display_name="回收员")
    for codename in ("soul.read", "soul.delete"):
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "soul"}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    clerk = User.objects.create_user(username="host_clerk", password="x", role="HOST_RECYCLER", tenant=host)

    soul = Soul.objects.create(name="来访", tenant=home, current_state=SoulState.JUDGING)
    record = SoulRecord.objects.create(soul=soul, record_type=RecordType.MERIT, description="施粥", weight=3)
    pending = Judgment.objects.create(soul=soul, civilization=Civilization.CHINESE, tenant=home)
    # 调拨执行后的形状:现居 B 殿,原属仍是 A 殿。
    Soul.all_objects.filter(pk=soul.pk).update(tenant=host, home_tenant=home)
    soul = Soul.all_objects.get(pk=soul.pk)
    assert soul.is_residing
    yield {"soul": soul, "record": record, "pending": pending, "clerk": _client_for(clerk, host)}
    invalidate_all_permissions()


def _untouched(world):
    assert not Soul.all_objects.get(pk=world["soul"].pk).is_deleted
    assert not SoulRecord.all_objects.get(pk=world["record"].pk).is_deleted
    assert not Judgment.all_objects.get(pk=world["pending"].pk).is_deleted


@pytest.mark.django_db
def test_the_model_refuses_a_residing_soul(world):
    with pytest.raises(DeletionNotAllowedError) as exc:
        world["soul"].delete_with_cascade()
    assert exc.value.archivable is False
    _untouched(world)


@pytest.mark.django_db
def test_the_host_hall_cannot_delete_a_visiting_soul(world):
    response = world["clerk"].delete(f"/api/v1/souls/{world['soul'].pk}/")
    assert response.status_code == 409, response.content
    assert response.json()["archivable"] is False
    assert response.json()["code"] == "soul_residing"
    _untouched(world)


@pytest.mark.django_db
def test_the_host_hall_cannot_batch_recycle_a_visiting_soul(world):
    response = world["clerk"].post(
        "/api/v1/souls/batch-recycle/", {"ids": [str(world["soul"].pk)]}, format="json"
    )
    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "not_deletable"
    assert body["archivable"] is False
    _untouched(world)


@pytest.mark.django_db
def test_after_the_residence_ends_the_soul_is_deletable_again(world):
    soul = world["soul"]
    Soul.all_objects.filter(pk=soul.pk).update(tenant=soul.home_tenant)
    Soul.all_objects.get(pk=soul.pk).delete_with_cascade()
    assert Soul.all_objects.get(pk=soul.pk).is_deleted
    assert Judgment.all_objects.get(pk=world["pending"].pk).is_deleted
