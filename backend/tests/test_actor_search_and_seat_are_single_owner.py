"""`?search=` 只有一个消费者;`assessor_index` 必须是整数。

## L20 —— 两个机制同时吃 `?search=`,并且取 AND

`ActorFilter.search` 是一个 CharFilter,而 viewset 上的 `search_fields` 激活了
DRF 的 `SearchFilter` —— 两者消费的是**同一个查询参数**。FilterSet 要求整串是
某个字段的子串;`SearchFilter` 要求每个空格分词都命中。AND 起来**比任何一个单独
使用都窄**,`?search=Osiris Lord` 可以两边各自都有结果而合起来是空集。

## L21 —— 一个只在 PostgreSQL 上炸的 cast

`ActorViewSet.get_queryset` 用
`Cast(KeyTextTransform("assessor_index", "powers_json"), IntegerField())`
给四十二位陪审官排座次。**这属于「SQLite 藏起来的一类」**:任一 actor 的
`assessor_index` 若是非数字字符串,SQLite 宽容为 0,PostgreSQL 上**整个
`/api/v1/actors/` 列表 500** —— 对所有调用方,不只是那一行。

API 写不了它(viewset 只读),写入面是 `seed_mythology`、管理命令、迁移和
Django admin —— 全都走 `save()`。所以守卫加在 `Actor.clean()`,并由 `save()` 调用,
与 `Statute` 同一套(`Model.save()` 不调 `full_clean()`,DRF 也不调)。
"""
import pytest
from django.core.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.actors.models import Actor, ActorRole
from apps.actors.views import ActorViewSet
from apps.authentication.models import User, UserRole
from apps.realms.models import Realm
from apps.tenants.models import Tenant


@pytest.fixture
def setup(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="EG_DUAT", defaults={"display_name": "EG_DUAT"}
    )
    realm = Realm.objects.create(
        realm_code="EG_TEST", name_en="Duat", civilization="EGYPTIAN", tenant=tenant
    )
    user = User.objects.create_user(
        username="actor-reader", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, tenant, realm


# ─────────────────────────────────────────────────────────── L20


def test_the_viewset_does_not_also_declare_search_fields():
    """`SearchFilter` is inert without it — that is the whole fix."""
    assert getattr(ActorViewSet, "search_fields", None) is None, (
        "viewset 又声明了 search_fields —— DRF 的 SearchFilter 会和 "
        "ActorFilter.search 一起吃 `?search=`,两者取 AND"
    )


@pytest.mark.django_db
def test_a_multi_word_search_matching_one_field_still_returns_the_row(setup):
    """AND 的症状:两个词分处不同字段时,合起来是空集。"""
    client, tenant, realm = setup
    Actor.objects.create(
        name="Osiris",
        name_en="Osiris",
        title="Lord of the Duat",
        role=ActorRole.JUDGE,
        realm=realm,
        tenant=tenant,
    )
    body = client.get("/api/v1/actors/?search=Lord of the Duat").json()
    rows = body["results"] if isinstance(body, dict) else body
    assert [r["name"] for r in rows] == ["Osiris"], rows


@pytest.mark.django_db
def test_search_still_narrows(setup):
    """**断存在的反面。** 一个把 search 整个忽略的实现会让上面那条绿。"""
    client, tenant, realm = setup
    Actor.objects.create(
        name="Osiris", name_en="Osiris", role=ActorRole.JUDGE, realm=realm, tenant=tenant
    )
    Actor.objects.create(
        name="Anubis", name_en="Anubis", role=ActorRole.JUDGE, realm=realm, tenant=tenant
    )
    body = client.get("/api/v1/actors/?search=Anubis").json()
    rows = body["results"] if isinstance(body, dict) else body
    assert [r["name"] for r in rows] == ["Anubis"], rows


# ─────────────────────────────────────────────────────────── L21


@pytest.mark.django_db
@pytest.mark.parametrize("bad", ["twelve", "12a", "", None, 3.5, True])
def test_a_non_integer_seat_is_refused_on_write(setup, bad):
    _client, tenant, realm = setup
    with pytest.raises(ValidationError):
        Actor.objects.create(
            name=f"bad-{bad!r}",
            role=ActorRole.JUDGE,
            realm=realm,
            tenant=tenant,
            powers_json={"assessor_index": bad},
        )


@pytest.mark.django_db
def test_an_integer_seat_still_writes(setup):
    """**断存在。** 一个拒绝所有 powers_json 的实现会让上面那组全绿。"""
    _client, tenant, realm = setup
    row = Actor.objects.create(
        name="陪审官",
        role=ActorRole.JUDGE,
        realm=realm,
        tenant=tenant,
        powers_json={"assessor_index": 7, "negative_confession": "…"},
    )
    row.refresh_from_db()
    assert row.powers_json["assessor_index"] == 7


@pytest.mark.django_db
def test_an_actor_without_a_seat_is_unaffected(setup):
    _client, tenant, realm = setup
    assert Actor.objects.create(
        name="非陪审官", role=ActorRole.OVERSEER, realm=realm, tenant=tenant
    ).pk
