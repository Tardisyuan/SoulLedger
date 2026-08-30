"""Actor 列表接口的 SQL 条数不随 actor 数量增长。

`apps/actors/views.py` 的 queryset 此前没有任何 `select_related`,而三个序列化器
都有 `realm_code = CharField(source="realm.realm_code")` —— `realm` 是外键,于是
每序列化一个 actor 就多打一条 SQL。实测:85 个 actor → **86 条**。

守卫写成「条数不随行数增长」而不是「条数 <= N」:后者要么松到抓不住 N+1,要么
紧到每次加一个 `select_related` 都得回来改数字,最后被人整体删掉。**两次测量、
不同的行数、比较增量**,是唯一不需要维护一个魔数的写法。
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework_simplejwt.tokens import RefreshToken

from apps.actors.models import Actor
from apps.realms.models import Realm

URL = "/api/v1/actors/"


@pytest.fixture
def client(api_client, admin_user):
    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


def make_actors(tenant, n, prefix):
    realm, _ = Realm.objects.get_or_create(
        realm_code=f"NPLUS1_{prefix}",
        defaults={"name_local": f"N+1 Probe {prefix}", "civilization": "CHINESE", "tenant": tenant},
    )
    for i in range(n):
        Actor.objects.create(
            name=f"{prefix}_actor_{i}",
            civilization="CHINESE",
            role="JUDGE",
            realm=realm,
            tenant=tenant,
            is_active=True,
        )


def count_queries(client, page_size):
    with CaptureQueriesContext(connection) as ctx:
        response = client.get(URL, {"page_size": page_size})
        assert response.status_code == 200, response.data
        # 分页是惰性的:不摸一下 results,序列化还没发生,数出来的是分页 count 那一条。
        assert len(response.data["results"]) > 0
    return len(ctx.captured_queries), len(response.data["results"])


@pytest.mark.django_db
def test_query_count_does_not_grow_with_the_number_of_actors(client, cn_tenant):
    make_actors(cn_tenant, 5, "small")
    few_queries, few_rows = count_queries(client, 5)

    make_actors(cn_tenant, 25, "large")
    many_queries, many_rows = count_queries(client, 30)

    assert many_rows > few_rows, "前置条件:第二次确实序列化了更多行"
    assert many_queries == few_queries, (
        f"{few_rows} 行用了 {few_queries} 条 SQL,{many_rows} 行用了 {many_queries} 条 —— "
        f"多出来的每一条都是一个外键在序列化时才去取。查 queryset 的 select_related。"
    )


@pytest.mark.django_db
def test_realm_code_is_actually_serialized(client, cn_tenant):
    """上面那条的前提。

    `realm_code` 要是哪天从序列化器里消失了,N+1 自然也就没有了 —— 上面那条会以
    「条数没增长」通过,而它守的东西已经不存在。这一条说出那个前提。
    """
    make_actors(cn_tenant, 2, "field")
    response = client.get(URL, {"page_size": 5})
    assert response.status_code == 200
    row = next(r for r in response.data["results"] if r["name"].startswith("field_"))
    assert row["realm_code"] == "NPLUS1_field"
