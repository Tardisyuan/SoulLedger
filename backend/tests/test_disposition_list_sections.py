"""处置列表:`?section=` 分段、`section_counts` 真实计数、带判决、带灵魂状态,无 N+1。"""
import datetime

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


# ── ?ordering=term_end:执行中段按期满近 → 远 ─────────────────────────────────


def _serving(tenant, name, *, start=(None, None, None), years=10, eternal=False, executed_at=None, order=0):
    soul = Soul.objects.create(name=name, tenant=tenant, birth_year=1900, death_year=1950)
    y, m, d = start
    row = Disposition.objects.create(
        soul=soul, tenant=tenant, is_executed=True,
        executed_at=executed_at or timezone.make_aware(datetime.datetime(2020, 1, 1, 12)),
        sentence_years=years, is_eternal=eternal,
        term_start_year=y, term_start_month=m, term_start_day=d,
    )
    # 建档先后显式钉住:平局靠它断。
    Disposition.all_objects.filter(pk=row.pk).update(created_at=BASE + datetime.timedelta(seconds=order))
    return row


BASE = timezone.make_aware(datetime.datetime(2026, 1, 1))


@pytest.fixture
def serving(cn_tenant, eu_tenant):
    made = {
        # 2010-06-15
        "a": _serving(cn_tenant, "a", start=(2000, 6, 15), years=10, order=1),
        # 起算日没记,从执行日(2001-03-01)起算:2006-03-01
        "null_start": _serving(
            cn_tenant, "null_start", years=5, order=2,
            executed_at=timezone.make_aware(datetime.datetime(2001, 3, 1, 12)),
        ),
        # 只知道年份:按那一年最晚一天,2010-12-31,排在 a 之后
        "year_only": _serving(cn_tenant, "year_only", start=(2003, None, None), years=7, order=3),
        # 与 a 同一天期满,插入在 a 之后、建档时间却更早:平局按建档先后,排在 a 之前
        "tie": _serving(cn_tenant, "tie", start=(2000, 6, 15), years=10, order=0),
        # 公元前 5 年 6 月起算 10 年:跨公元交界多一年,公元 6 年 6 月期满 ——
        # 不加那一年就是公元 5 年,会排到下面公元 6 年 1 月那一行之前
        "bce": _serving(cn_tenant, "bce", start=(-5, 6, 1), years=10, order=5),
        "ce": _serving(cn_tenant, "ce", start=(1, 1, 1), years=5, order=8),
        # 永久与没记刑期:没有期满日,排最后,彼此按建档先后
        "eternal": _serving(cn_tenant, "eternal", start=(1990, 1, 1), years=1, eternal=True, order=6),
        "no_years": _serving(cn_tenant, "no_years", start=(1990, 1, 1), years=None, order=7),
    }
    # 别的租户、期满更早的一行:不在这里出现。
    _serving(eu_tenant, "foreign", start=(1000, 1, 1), years=1, order=0)
    return made


@pytest.mark.django_db
class TestOrderingByTermEnd:
    EXPECTED = ["ce", "bce", "null_start", "tie", "a", "year_only", "eternal", "no_years"]

    @staticmethod
    def _names(body):
        return [row["soul_name"] for row in body["results"]]

    def test_soonest_first_eternal_and_no_end_last_ties_by_creation(self, judge, serving):
        body = judge.get(URL, {"section": "executing", "ordering": "term_end"}).json()
        assert self._names(body) == self.EXPECTED

    def test_the_sql_key_agrees_with_the_serializer_term_end(self, judge, serving):
        """SQL 的排序键与序列化器的 `term_end`(Python 的 effective_term_start + term_end)同源:
        按服务端顺序读出的 `term_end` 不降,没有期满日的都在尾巴上。"""
        rows = judge.get(URL, {"section": "executing", "ordering": "term_end"}).json()["results"]
        ends = [r["term_end"] for r in rows]
        dated = [e for e in ends if e is not None]
        assert ends == dated + [None] * (len(ends) - len(dated))
        key = [(e["year"], e["month"] or 12, e["day"] or 31) for e in dated]
        assert key == sorted(key)
        # 起算日为空的那一行,期满日确实是从执行日推的。
        assert (ends[2]["year"], ends[2]["month"], ends[2]["day"]) == (2006, 3, 1)

    def test_tenant_scoped(self, judge, serving):
        assert "foreign" not in self._names(judge.get(URL, {"ordering": "term_end"}).json())

    def test_other_orderings_are_untouched(self, judge, serving):
        body = judge.get(URL, {"section": "executing", "ordering": "-created_at"}).json()
        assert self._names(body) == ["ce", "no_years", "eternal", "bce", "year_only", "null_start", "a", "tie"]
