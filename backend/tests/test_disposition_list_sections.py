"""处置列表:`?section=` 分段、`section_counts` 真实计数、带判决、带灵魂状态,无 N+1。"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, Verdict
from apps.realms.models import Realm
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul, SoulState

URL = "/api/v1/disposition/"


def _client(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def judge(api_client, judge_user):
    return _client(api_client, judge_user)


def _make(tenant, name, *, executed=False, expired=False, verdict=Verdict.FAILED, realm=None):
    soul = Soul.objects.create(name=name, tenant=tenant, birth_year=1900, death_year=1950)
    soul.current_state = SoulState.REINCARNATING if executed else SoulState.DISPOSED
    soul.save(update_fields=["current_state"])
    judgment = Judgment.objects.create(
        soul=soul, tenant=tenant, civilization="CHINESE", verdict=verdict, is_final=True,
        concluded_at=timezone.now(),
    )
    now = timezone.now()
    return Disposition.objects.create(
        soul=soul, tenant=tenant, judgment=judgment, destination_realm=realm,
        is_executed=executed or expired, executed_at=now if (executed or expired) else None,
        expired_at=now if expired else None, sentence_years=10,
        term_start_year=2000, term_start_month=6, term_start_day=15,
    )


@pytest.fixture
def rows(cn_tenant, eu_tenant):
    made = {
        "pending": [_make(cn_tenant, "p1"), _make(cn_tenant, "p2")],
        "executing": [_make(cn_tenant, "x1", executed=True)],
        "expired": [_make(cn_tenant, "e1", expired=True), _make(cn_tenant, "e2", expired=True),
                    _make(cn_tenant, "e3", expired=True)],
    }
    # Another tenant's rows must count nowhere.
    _make(eu_tenant, "other-pending")
    _make(eu_tenant, "other-expired", expired=True)
    return made


def _ids(body):
    return {row["id"] for row in body["results"]}


@pytest.mark.django_db
class TestSections:
    @pytest.mark.parametrize("section", ["pending", "executing", "expired"])
    def test_section_filter_returns_exactly_that_section(self, judge, rows, section):
        body = judge.get(URL, {"section": section}).json()
        assert _ids(body) == {str(d.pk) for d in rows[section]}
        assert {row["section"] for row in body["results"]} == {section}

    def test_counts_are_for_every_section_whichever_one_is_open(self, judge, rows):
        body = judge.get(URL, {"section": "pending"}).json()
        assert len(body["results"]) == 2
        assert body["section_counts"] == {"pending": 2, "executing": 1, "expired": 3}

    def test_counts_are_totals_not_page_sizes(self, judge, cn_tenant):
        # PAGE_SIZE is 20 (config/settings.py); 23 rows span two pages.
        for i in range(23):
            _make(cn_tenant, f"many{i}", expired=True)
        body = judge.get(URL, {"section": "expired"}).json()
        assert len(body["results"]) == 20
        assert body["count"] == 23
        assert body["section_counts"] == {"pending": 0, "executing": 0, "expired": 23}
        second = judge.get(URL, {"section": "expired", "page": 2}).json()
        assert len(second["results"]) == 3
        assert second["section_counts"] == body["section_counts"]

    def test_counts_ignore_section_but_honour_the_other_filters(self, judge, rows):
        body = judge.get(URL, {"section": "pending", "soul": str(rows["expired"][0].soul_id)}).json()
        assert body["results"] == []
        assert body["section_counts"] == {"pending": 0, "executing": 0, "expired": 1}

    def test_counts_honour_archiving(self, judge, rows):
        rows["expired"][0].archive(reason="test")
        body = judge.get(URL).json()
        assert body["section_counts"]["expired"] == 2

    def test_an_unknown_section_is_a_400(self, judge, rows):
        assert judge.get(URL, {"section": "later"}).status_code == 400

    def test_the_list_without_section_still_returns_everything(self, judge, rows):
        body = judge.get(URL, {"page_size": 50}).json()
        assert body["count"] == 6
        assert body["section_counts"] == {"pending": 2, "executing": 1, "expired": 3}


@pytest.mark.django_db
class TestRowFields:
    def test_verdict_comes_from_the_judgment(self, judge, cn_tenant):
        failed = _make(cn_tenant, "failed", verdict=Verdict.FAILED)
        passed = _make(cn_tenant, "passed", verdict=Verdict.PASSED)
        by_id = {row["id"]: row for row in judge.get(URL).json()["results"]}
        assert by_id[str(failed.pk)]["verdict"] == "FAILED"
        assert by_id[str(passed.pk)]["verdict"] == "PASSED"

    def test_verdict_is_null_without_a_judgment(self, judge, cn_tenant):
        soul = Soul.objects.create(name="no judgment", tenant=cn_tenant)
        d = Disposition.objects.create(soul=soul, tenant=cn_tenant)
        body = judge.get(f"{URL}{d.pk}/").json()
        assert body["verdict"] is None

    def test_detail_carries_the_same_fields(self, judge, cn_tenant):
        d = _make(cn_tenant, "detail", expired=True)
        body = judge.get(f"{URL}{d.pk}/").json()
        assert body["verdict"] == "FAILED"
        assert body["section"] == "expired"
        assert body["soul_state"] == SoulState.DISPOSED
        assert body["soul_reborn"] is False
        assert body["term_end"] == {"year": 2010, "month": 6, "day": 15}
        assert body["expired_at"] is not None

    def test_term_end_is_null_for_an_eternal_sentence(self, judge, cn_tenant):
        d = _make(cn_tenant, "eternal", executed=True)
        Disposition.objects.filter(pk=d.pk).update(is_eternal=True)
        assert judge.get(f"{URL}{d.pk}/").json()["term_end"] is None

    def test_soul_state_is_the_current_one(self, judge, cn_tenant):
        d = _make(cn_tenant, "state", executed=True)
        Soul.objects.filter(pk=d.soul_id).update(current_state=SoulState.ALIVE)
        assert judge.get(f"{URL}{d.pk}/").json()["soul_state"] == SoulState.ALIVE

    def test_soul_reborn_and_its_filter(self, judge, cn_tenant):
        reborn = _make(cn_tenant, "reborn", expired=True)
        waiting = _make(cn_tenant, "waiting", expired=True)
        Reincarnation.objects.create(soul=reborn.soul, tenant=cn_tenant, target_realm="X", cycle_count=1)

        body = judge.get(URL, {"section": "expired"}).json()
        flags = {row["id"]: row["soul_reborn"] for row in body["results"]}
        assert flags == {str(reborn.pk): True, str(waiting.pk): False}

        hidden = judge.get(URL, {"section": "expired", "soul_reborn": "false"}).json()
        assert _ids(hidden) == {str(waiting.pk)}
        assert hidden["section_counts"]["expired"] == 1

    def test_a_rebirth_in_an_earlier_life_does_not_count(self, judge, cn_tenant):
        """cycle 1 的处置,灵魂只有 cycle_count=1 的转生(开始了 cycle 1 那一世)——
        还没有从这一世转出去。"""
        d = _make(cn_tenant, "second life", expired=True)
        Reincarnation.objects.create(soul=d.soul, tenant=cn_tenant, target_realm="X", cycle_count=1)
        Disposition.objects.filter(pk=d.pk).update(cycle=1)
        assert judge.get(f"{URL}{d.pk}/").json()["soul_reborn"] is False


def _count(client, page_size):
    with CaptureQueriesContext(connection) as ctx:
        response = client.get(URL, {"page_size": page_size})
        assert response.status_code == 200, response.data
        rows = response.json()["results"]
    return len(ctx.captured_queries), len(rows)


@pytest.mark.django_db
def test_list_query_count_does_not_grow_with_rows(judge, cn_tenant):
    """两次测量、不同的行数、比较增量(同 test_actor_list_does_not_fan_out.py 的写法)。
    每一行都有判决、有去处、灵魂在一个已转世与未转世混合的集合里 —— 这正是
    `verdict` / `realm_name` / `soul_state` / `soul_reborn` 各自可能多打一条的地方。"""
    realm = Realm.objects.create(realm_code="NPLUS1_DISP", name_local="probe", civilization="CHINESE", tenant=cn_tenant)

    def make(n, prefix):
        for i in range(n):
            d = _make(cn_tenant, f"{prefix}{i}", expired=bool(i % 2), realm=realm)
            if i % 3 == 0:
                Reincarnation.objects.create(soul=d.soul, tenant=cn_tenant, target_realm="X", cycle_count=1)

    make(3, "few")
    _count(judge, 3)  # warm-up: the first request also loads the caller's permissions
    few_q, few_rows = _count(judge, 3)
    make(12, "many")
    many_q, many_rows = _count(judge, 15)

    assert many_rows > few_rows
    assert many_q == few_q, f"{few_rows} 行 {few_q} 条 SQL,{many_rows} 行 {many_q} 条"
