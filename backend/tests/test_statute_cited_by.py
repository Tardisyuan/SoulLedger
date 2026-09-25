"""语料页「被引用 N 件」与它下面的清单(`GET /judgment/?statute=<id>`)必须永远一致。

件数是 `StatuteViewSet` 上的 `citation_count` 注解,清单是判决列表加 `statute` 过滤。
两者算在**同一个集合**上 —— 调用者的判决列表(租户 + 暂居只读 + 行级 DataScope),
所以一个被 DataScope 挡掉部分判决的人,看到的件数随之变小,而不是一个清单里数不出来的数。
"""
import pytest

from apps.judgment.models import Judgment, JudgmentCitation
from apps.perm.models import Role, RowLevelDataScope
from apps.souls.models import Civilization, Soul, SoulState
from tests.test_judgment_statutes import make_statute

pytestmark = pytest.mark.django_db


@pytest.fixture
def judge_headers(judge_user):
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.perm.models import Permission, RolePermission

    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    permission, _ = Permission.objects.get_or_create(
        codename="judgment.read", defaults={"name": "judgment.read", "category": "judgment"})
    RolePermission.objects.get_or_create(role=role, permission=permission)
    token = RefreshToken.for_user(judge_user)
    token["tenant_code"] = judge_user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


def _cite(tenant, statute, court, name):
    soul = Soul.objects.create(name=name, current_state=SoulState.JUDGING, tenant=tenant)
    case = Judgment.objects.create(soul=soul, civilization=Civilization.CHINESE, court=court, tenant=tenant)
    JudgmentCitation.objects.create(judgment=case, statute=statute, tenant=tenant)
    return case


def _count(client, headers, statute):
    rows = client.get("/api/v1/judgment/statutes/", {"code": statute.code}, **headers).data["results"]
    return rows[0]["citation_count"]


def _listed(client, headers, statute):
    response = client.get("/api/v1/judgment/", {"statute": str(statute.id), "ordering": "-created_at"}, **headers)
    assert response.status_code == 200
    return [row["id"] for row in response.data["results"]], response.data["count"]


@pytest.fixture
def world(cn_tenant):
    statute = make_statute(cn_tenant, "CN-HL-O01")
    other = make_statute(cn_tenant, "CN-HL-O02", ordinal=2)
    first = [_cite(cn_tenant, statute, "第一殿", f"甲{i}") for i in range(2)]
    second = _cite(cn_tenant, statute, "第二殿", "乙")
    _cite(cn_tenant, other, "第一殿", "丙")
    return statute, first, second


def test_count_and_list_agree_for_a_data_scoped_judge(api_client, judge_headers, world):
    statute, first, second = world
    RowLevelDataScope.objects.create(
        role=Role.objects.get(name="JUDGE"), model_name="Judgment", scope_type="READ",
        filter_conditions={"court": "第一殿"}, is_active=True,
    )
    ids, total = _listed(api_client, judge_headers, statute)
    assert _count(api_client, judge_headers, statute) == total == 2
    assert set(ids) == {str(j.id) for j in first}
    # Absence: the out-of-scope judgment is neither counted nor listed.
    assert str(second.id) not in ids


def test_without_a_scope_both_see_all_three_newest_first(api_client, judge_headers, world):
    statute, first, second = world
    ids, total = _listed(api_client, judge_headers, statute)
    assert _count(api_client, judge_headers, statute) == total == 3
    expected = [str(j.id) for j in Judgment.objects.filter(citations__statute=statute).order_by("-created_at")]
    assert ids == expected


def test_a_soft_deleted_citation_is_in_neither(api_client, judge_headers, world):
    statute, first, _ = world
    JudgmentCitation.all_objects.filter(judgment=first[0]).update(is_deleted=True)
    ids, total = _listed(api_client, judge_headers, statute)
    assert _count(api_client, judge_headers, statute) == total == 2
    assert str(first[0].id) not in ids


def test_another_tenants_judgment_is_in_neither(api_client, judge_headers, world, eu_tenant):
    statute, _, _ = world
    # A row the service would refuse (cross-tenant), written straight through the ORM.
    foreign = _cite(eu_tenant, statute, "第一殿", "外")
    ids, total = _listed(api_client, judge_headers, statute)
    assert _count(api_client, judge_headers, statute) == total == 3
    assert str(foreign.id) not in ids
