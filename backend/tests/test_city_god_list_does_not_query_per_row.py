"""城隍列表的查询数不随城隍个数增长(重构审查 2026-11-08 后端 1.4;土地公列表 2026-10-29 已同样修过)。

此前每行两条:`officers.order_by(...)` 绕过预取,`open_case_count` 一行一个 COUNT。
"""
from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.judgment.models import CityGod
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

GODS = "/api/v1/judgment/city-gods/"


def _god(tenant, i, officer):
    god = CityGod.objects.create(tenant=tenant, name=f"城隍{i}", regions=[f"县{i}"])
    god.officers.add(officer)
    Soul.objects.create(name=f"魂{i}", tenant=tenant, current_state=SoulState.ALIVE,
                        origin_location=f"县{i}").die(death_date=date.today())
    return god


def test_the_list_costs_the_same_for_one_city_god_and_for_five(cn_tenant, django_assert_max_num_queries):
    lead = sp.officer("lead", "ADMIN", cn_tenant)
    clerk = sp.officer("clerk", "JUDGE", cn_tenant)
    client = officer_client(lead)
    _god(cn_tenant, 0, clerk)
    client.get(GODS)  # warm per-request caches that are not per-row
    with CaptureQueriesContext(connection) as one:
        assert client.get(GODS).status_code == 200
    for i in range(1, 5):
        _god(cn_tenant, i, clerk)
    with django_assert_max_num_queries(len(one)):
        response = client.get(GODS)
    rows = response.json()
    rows = rows.get("results", rows) if isinstance(rows, dict) else rows
    assert len(rows) == 5
    assert all(r["open_case_count"] == 1 for r in rows), rows
    assert all([o["id"] for o in r["officers"]] == [clerk.pk] for r in rows)
