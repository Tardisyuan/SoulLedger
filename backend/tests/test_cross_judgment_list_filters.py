"""跨域审判列表的筛选(审计 2026-10-17 第 11 条):状态、「我方发起 / 我方参与」、标题搜索。

此前 `filterset_class = None`,列表只能翻页。筛选只在 `get_queryset` 已限定的行(发起方或参与方)之内再分,
不放宽范围:别殿之间的案子无论怎么筛都不出现。导出走同一个 `filter_queryset`。
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db
User = get_user_model()
URL = "/api/v1/dispatch/cross-tenant-judgments/"


@pytest.fixture
def world(db):
    a, b, c = (Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]
               for code in ("CJF_A", "CJF_B", "CJF_C"))

    def case(title, initiator, status="PROPOSED", seats=()):
        row = CrossTenantJudgment.all_objects.create(
            title=title, description="d", initiating_tenant=initiator, tenant=initiator, status=status)
        for tenant in seats:
            CrossTenantJudgmentParticipant.objects.create(judgment=row, participant_tenant=tenant, role="ADVISOR")
        return row

    mine = case("冥河之案", a, seats=(b,))
    theirs = case("忘川之案", b, status="ACTIVE", seats=(a, a))  # 本殿坐了两个席位:不能回来两次
    strangers = case("奈何之案", b, seats=(c,))
    user = User.objects.create_user(username="cjf_judge", password="x", role="JUDGE", tenant=a)
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = a.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client, mine, theirs, strangers


def _titles(client, **params):
    response = client.get(URL, params)
    assert response.status_code == 200, response.data
    return [row["title"] for row in response.json()["results"]]


def test_side_splits_what_this_hall_started_from_what_it_sits_on(world):
    client, *_ = world
    assert _titles(client) and set(_titles(client)) == {"冥河之案", "忘川之案"}
    assert _titles(client, side="initiated") == ["冥河之案"]
    assert _titles(client, side="participating") == ["忘川之案"]


def test_status_and_search_narrow_within_the_same_rows(world):
    client, *_ = world
    assert _titles(client, status="ACTIVE") == ["忘川之案"]
    assert _titles(client, search="冥河") == ["冥河之案"]
    # 别殿之间的案子不因筛选而出现。
    assert _titles(client, search="奈何") == []
    assert client.get(URL, {"side": "elsewhere"}).status_code == 400


def test_export_takes_the_same_filters(world):
    client, *_ = world
    response = client.get(URL + "export/", {"side": "participating"})
    assert response.status_code == 200
    body = response.content.decode("utf-8-sig")
    assert "忘川之案" in body and "冥河之案" not in body
