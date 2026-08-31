"""一张叫「分布」的图,柱子加起来必须等于旁边印着的总数。

原来的七个桶只铺满 `[-99999, 99999)`。2026-08-29 实测四个灵魂:
`total_souls=4`、`sum(karma_distribution)=2` —— 余额 ±200000 的两个**不在任何
桶里**,而记录 weight 没有上界,所以那种余额是可达的。没有任何测试断言过桶之和;
`matrix_snapshot` 和 `tests/test_ledger_stats.py` 都只断言键存在。

**「键存在」是一个永远不会红的检查。** 它在桶算错、桶漏人、桶重叠时全都是绿的。

顺带钉住边界:`> 50` 这个标签配的过滤条件是 `[50, 99999)`,而它下面那个桶是
`[20, 50)` —— 余额**恰好 50** 的灵魂被算进了「大于 50」。标签现在写 `>= 50`。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.fixture
def client_and_tenant(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    user = User.objects.create_user(
        username="ledger-stats", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client, tenant


def _soul(tenant, name, merit, demerit):
    return Soul.objects.create(
        name=name, tenant=tenant, merit_score=merit, demerit_score=demerit
    )


@pytest.mark.django_db
def test_the_buckets_account_for_every_soul_including_the_extremes(client_and_tenant):
    client, tenant = client_and_tenant
    _soul(tenant, "极正", 200000, 0)      # 旧实现:不在任何桶里
    _soul(tenant, "极负", 0, 200000)      # 旧实现:不在任何桶里
    _soul(tenant, "中间", 3, 0)
    _soul(tenant, "偏负", 0, 30)

    body = client.get("/api/v1/ledger/stats/overview/").json()
    counted = sum(b["count"] for b in body["karma_distribution"])
    assert counted == body["total_souls"], (
        f"分布图的柱子加起来是 {counted},而它旁边印的总数是 "
        f"{body['total_souls']};桶:{body['karma_distribution']}"
    )
    assert body["karma_distribution_total"] == body["total_souls"]


@pytest.mark.django_db
def test_a_balance_of_exactly_fifty_is_not_reported_as_greater_than_fifty(
    client_and_tenant,
):
    client, tenant = client_and_tenant
    _soul(tenant, "正好五十", 50, 0)
    body = client.get("/api/v1/ledger/stats/overview/").json()
    buckets = {b["label"]: b["count"] for b in body["karma_distribution"]}
    assert "> 50" not in buckets, (
        f"标签仍写着 `> 50`,而它的过滤条件是 `[50, ...)` —— 余额恰好 50 的灵魂"
        f"会被算进去。桶:{buckets}"
    )
    assert buckets[">= 50"] == 1, buckets


@pytest.mark.django_db
def test_no_soul_is_counted_twice(client_and_tenant):
    """**断重叠,不只是断遗漏。** 把两个端桶改成无界时,最容易犯的错是让它们
    与相邻的桶重叠 —— 那样和会**大于**总数,而只断「和 >= 总数」的测试会绿。"""
    client, tenant = client_and_tenant
    for i, (m, d) in enumerate(
        [(0, 200), (0, 60), (0, 30), (0, 10), (0, 0), (10, 0), (30, 0), (60, 0), (200, 0)]
    ):
        _soul(tenant, f"soul-{i}", m, d)
    body = client.get("/api/v1/ledger/stats/overview/").json()
    counted = sum(b["count"] for b in body["karma_distribution"])
    assert counted == body["total_souls"] == 9, (
        f"{counted} vs {body['total_souls']};桶:{body['karma_distribution']}"
    )
