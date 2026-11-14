"""`date_range_q`(事件与审计的 `?start_date=` / `?end_date=`)与它替换掉的 `__date__gte/lte` 选出同样的行。

半开区间 `[start 0 点, end 次日 0 点)` 是为了让 `create_time` / `timestamp` 上的索引用得上(be-scale 4.4);
同一时区下它只换写法不换意思:这里在日界两侧各放一行,逐组参数比两种写法的结果,UTC 与非 UTC 各比一次。
切日的时区是调用者所在殿的(`caller_hall_tz`,用户 2026-11-14 决定),无殿为 UTC。
"""
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.audit.views import caller_hall_tz, date_range_q
from apps.events.models import EventType, SoulEvent
from apps.souls.models import Soul

PARAMS = [
    {"start_date": "2026-10-10"},
    {"end_date": "2026-10-10"},
    {"start_date": "2026-10-10", "end_date": "2026-10-10"},
    {"start_date": "2026-10-09", "end_date": "2026-10-11"},
    {"start_date": "2026-10-11", "end_date": "2026-10-09"},  # 空区间
]


def _old(qs, params):
    """被替换掉的写法,原样。"""
    if params.get("start_date"):
        qs = qs.filter(create_time__date__gte=date.fromisoformat(params["start_date"]))
    if params.get("end_date"):
        qs = qs.filter(create_time__date__lte=date.fromisoformat(params["end_date"]))
    return qs


@pytest.fixture
def boundary_events(cn_tenant):
    soul = Soul.objects.create(name="Boundary", tenant=cn_tenant)
    # 每个日界(UTC 与 +08:00 的)两侧各一行:前一微秒、恰好 0 点、后一微秒。
    instants = []
    for midnight in (datetime(2026, 10, d, tzinfo=UTC) for d in (9, 10, 11, 12)):
        for shift in (timedelta(hours=0), timedelta(hours=-8)):
            for eps in (timedelta(microseconds=-1), timedelta(0), timedelta(microseconds=1)):
                instants.append(midnight + shift + eps)
    for when in instants:
        e = SoulEvent.objects.create(soul=soul, tenant=cn_tenant, event_type=EventType.STATE_CHANGED, payload={})
        SoulEvent.objects.filter(pk=e.pk).update(create_time=when)  # auto_now_add,只能事后改
    return SoulEvent.all_objects.filter(soul=soul)


@pytest.mark.django_db
@pytest.mark.parametrize("tz", ["UTC", "Asia/Shanghai"])
@pytest.mark.parametrize("params", PARAMS)
def test_the_range_selects_the_rows_date_lookup_selected(boundary_events, tz, params):
    new = set(boundary_events.filter(date_range_q(params, "create_time", ZoneInfo(tz))).values_list("pk", flat=True))
    with timezone.override(tz):  # `__date` 按当前时区取日期
        old = set(_old(boundary_events, params).values_list("pk", flat=True))
    assert new == old
    if params == {"start_date": "2026-10-10", "end_date": "2026-10-10"}:
        assert new, "the fixture must put rows inside the day, or the equality above proves nothing"


@pytest.mark.django_db
def test_a_one_day_range_excludes_the_next_midnight_and_keeps_its_own(boundary_events):
    """不比旧写法、直接断言日界:当天 0 点在内,次日 0 点不在内。"""
    got = set(
        boundary_events.filter(
            date_range_q({"start_date": "2026-10-10", "end_date": "2026-10-10"}, "create_time", ZoneInfo("UTC"))
        )
        .values_list("create_time", flat=True)
    )
    assert datetime(2026, 10, 10, tzinfo=UTC) in got
    assert datetime(2026, 10, 11, tzinfo=UTC) not in got
    assert datetime(2026, 10, 10, tzinfo=UTC) - timedelta(microseconds=1) not in got
    assert datetime(2026, 10, 11, tzinfo=UTC) - timedelta(microseconds=1) in got


@pytest.mark.django_db
def test_the_ends_of_the_calendar_do_not_overflow(boundary_events):
    """`9999-12-31` 的次日与东区的 `0001-01-01` 0 点 datetime 都表示不了:那一端不设界,不抛 OverflowError。"""
    everything = set(boundary_events.values_list("pk", flat=True))
    q = date_range_q({"start_date": "0001-01-01", "end_date": "9999-12-31"}, "create_time", ZoneInfo("Asia/Shanghai"))
    assert set(boundary_events.filter(q).values_list("pk", flat=True)) == everything


@pytest.mark.django_db
def test_the_day_is_cut_in_the_callers_hall_and_utc_without_one(cn_tenant):
    """东八区的殿:10-10 这一天是 UTC 10-09 16:00 到 10-10 16:00。无殿的请求按 UTC。"""
    cn_tenant.settings = {**(cn_tenant.settings or {}), "timezone": "Asia/Shanghai"}
    cn_tenant.save(update_fields=["settings"])
    hall = SimpleNamespace(tenant=cn_tenant, user=None)
    assert caller_hall_tz(hall) == ZoneInfo("Asia/Shanghai")
    assert caller_hall_tz(SimpleNamespace(tenant=None, user=None)) == ZoneInfo("UTC")
    assert caller_hall_tz(None) == ZoneInfo("UTC")

    day = {"start_date": "2026-10-10", "end_date": "2026-10-10"}
    q = date_range_q(day, "create_time", caller_hall_tz(hall))
    assert dict(q.children) == {
        "create_time__gte": datetime(2026, 10, 9, 16, tzinfo=UTC),
        "create_time__lt": datetime(2026, 10, 10, 16, tzinfo=UTC),
    }
