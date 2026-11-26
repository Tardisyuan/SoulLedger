"""Date filters on a timestamp column: `?start_date=` / `?end_date=`, cut at midnight in the caller's hall's zone.

Moved out of `apps/audit/views.py` (2026-11-26): the event list uses them too; that module re-exports them.
"""
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Q

from apps.core.query_params import parse_date_param  # noqa: F401  re-exported
from apps.core.tenant import request_tenant


def _midnight(day, tz):
    """`day` 0 点(`tz`)的 aware datetime;落在 datetime 能表示的范围外(0001-01-01 在东区)时是 None ——
    那一端不设界,与 `__date` 在那一天的结果相同。"""
    try:
        return datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    except OverflowError:
        return None


def caller_hall_tz(request) -> ZoneInfo:
    """切日用的时区:**调用者所在殿**的 `Tenant.hall_timezone`(设置 → 文明默认 → UTC)。
    没有殿的请求(无租户的全局管理员等)用 UTC —— `hall_timezone` 只在有殿时才答得出。

    跨殿的视图(全局管理员看所有殿的审计)同样按调用者的殿切日,而不是每行按它自己的殿:
    与本殿概览 / 年报同一个先例(`apps/judgment/hall_stats.py` `overview`、`apps/judgment/annual.py` `report`,
    都取请求的殿,无殿为 UTC)。逐行按殿的 `Judgment.concluded_tz` 只用于写出一件文书的日期,不用于筛选:
    一个「某日」的筛选框只能有一条日界。"""
    tenant = request_tenant(request) if request is not None else None
    return ZoneInfo(tenant.hall_timezone if tenant is not None else "UTC")


def date_range_q(params, field, tz) -> Q:
    """`?start_date=` / `?end_date=`(两端都含)在 `field` 上的半开区间:
    `field >= start 0 点` 且 `field < end 次日 0 点`,0 点按 `tz`(调用方给 `caller_hall_tz(request)`)。

    此前是 `field__date__gte/lte`(按 UTC 取日期):列先换时区再取日期,索引用不上(be-scale 4.4)。
    按殿的时区切日是用户 2026-11-14 的决定 —— 非 UTC 殿的结果因此与此前不同(东八区的殿,UTC 16:00 之后的
    行归到下一天)。同一时区下与 `__date` 选出的行相同(`tests/test_date_range_filter.py`)。"""
    q = Q()
    start = parse_date_param(params, "start_date")
    if start and (lower := _midnight(start, tz)) is not None:
        q &= Q(**{f"{field}__gte": lower})
    end = parse_date_param(params, "end_date")
    if end and end < date.max and (upper := _midnight(end + timedelta(days=1), tz)) is not None:
        q &= Q(**{f"{field}__lt": upper})
    return q
