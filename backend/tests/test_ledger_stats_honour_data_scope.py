"""账本的 CSV 导出与概览统计只算数据范围里的灵魂(重构审查 2026-11-08 后端 1.1;概览由用户 2026-11-08 定)。

此前两者只按殿过滤:「本机构」范围的判官导出得到全殿灵魂,概览数的也是全殿。
"""
import pytest

from apps.souls.models import Soul, SoulState
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def scoped_judge(judge_user, cn_tenant):
    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    inside = Soul.objects.create(name="范围内魂", tenant=cn_tenant, current_state=SoulState.ALIVE, owner_org=mine)
    Soul.objects.create(name="范围外魂", tenant=cn_tenant, current_state=SoulState.ALIVE, owner_org=theirs)
    judge_user.organization = mine
    judge_user.save(update_fields=["organization"])
    scope("JUDGE", "ORG")
    return officer_client(judge_user), inside


def test_the_csv_export_holds_only_souls_in_scope(scoped_judge):
    client, inside = scoped_judge
    response = client.get("/api/v1/ledger/stats/export/")
    assert response.status_code == 200
    body = response.content.decode()
    assert str(inside.pk) in body
    assert "范围外魂" not in body


def test_the_overview_counts_only_souls_in_scope(scoped_judge):
    client, _ = scoped_judge
    data = client.get("/api/v1/ledger/stats/overview/").json()
    assert data["total_souls"] == 1
    assert data["karma_distribution_total"] == 1
    assert sum(t["total_souls"] for t in data["tenants"]) == 1
    assert sum(s["count"] for s in data["state_distribution"]) == 1
