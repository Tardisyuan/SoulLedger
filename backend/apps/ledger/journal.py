"""功过总账 —— 跨灵魂的月度流水与「四柱」。

    旧管 + 新收 − 开除 = 实在

**数的是登记原值(`SoulRecord.weight`),不是 `Soul.karmic_balance`。** 后者按文明
衰减、按世(`cycle`)分段、带转生承前,是「一户此刻的余额」;总账问的是「这个月
簿子上记了什么」,两者只在「无衰减、无转生」时相等。混用它们会得到一张四柱不平
的账:期初取余额(衰减后)、本期取原值,差额无处可去。所以四柱全用原值,并在
页面上写明。

只有 MERIT / DEMERIT 两类记入;JUDGMENT / DISPOSITION 是证据行,没有收支方向。

月份边界按 `settings.TIME_ZONE`(UTC)切。每行带一个同样按 UTC 切的 `day`,前端
按它分组 —— 前端若按浏览器时区自己切日,午夜附近的一条会落进与月份边界不一致的
那一天,日小计之和就不再等于本期。
"""
from __future__ import annotations

import datetime as dt
import re
import uuid

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.core.tenant import scope_to_tenant
from apps.souls.record_models import RecordCategory, RecordType, SoulRecord

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
PAGE_SIZE = 20


class JournalParamError(ValueError):
    """A query parameter the journal cannot read; the view answers 400."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def month_bounds(month: str) -> tuple[dt.datetime, dt.datetime]:
    """[start, end) of `YYYY-MM` in the current (UTC) timezone."""
    m = MONTH_RE.match(month)
    if not m:
        raise JournalParamError("month", "month must be YYYY-MM")
    year, mon = int(m.group(1)), int(m.group(2))
    tz = timezone.get_current_timezone()
    start = dt.datetime(year, mon, 1, tzinfo=tz)
    end = dt.datetime(year + (mon == 12), mon % 12 + 1, 1, tzinfo=tz)
    return start, end


def _signed_sums(qs) -> tuple[int, int]:
    agg = qs.aggregate(
        merit=Coalesce(Sum("weight", filter=Q(record_type=RecordType.MERIT)), 0),
        demerit=Coalesce(Sum("weight", filter=Q(record_type=RecordType.DEMERIT)), 0),
    )
    return agg["merit"], agg["demerit"]


def soul_q(search: str) -> Q:
    """「灵魂姓名或 ID」:姓名包含,或整条 UUID 精确等于灵魂 id。不是 UUID 的词只按姓名。"""
    q = Q(soul__name__icontains=search)
    try:
        q |= Q(soul_id=uuid.UUID(search))
    except ValueError:
        pass
    return q


def journal_records(request, *, month: str, civilization: str = "", category: str = "", search: str = ""):
    """(本期之前, 本期) 两个查询集 —— 四柱、类目、流水与导出**都**从这里取,
    所以任何一个筛选(含搜索)同时收窄每一柱,账始终是平的。"""
    if category and category not in RecordCategory.values:
        raise JournalParamError("category", "unknown category")
    start, end = month_bounds(month)

    qs = scope_to_tenant(
        SoulRecord.objects.filter(
            record_type__in=(RecordType.MERIT, RecordType.DEMERIT),
            soul__is_deleted=False,
        ),
        request,
    )
    if civilization:
        qs = qs.filter(civilization=civilization)
    if category:
        qs = qs.filter(category=category)
    search = search.strip()
    if search:
        qs = qs.filter(soul_q(search))
    return qs.filter(recorded_at__lt=start), qs.filter(recorded_at__gte=start, recorded_at__lt=end)


def build_journal(
    request, *, month: str, page: int, civilization: str = "", category: str = "", search: str = ""
) -> dict:
    if page < 1:
        raise JournalParamError("page", "page must be >= 1")
    before, period = journal_records(
        request, month=month, civilization=civilization, category=category, search=search
    )

    before_merit, before_demerit = _signed_sums(before)
    received, disbursed = _signed_sums(period)
    opening = before_merit - before_demerit

    counts = period.aggregate(records=Count("id"), souls=Count("soul", distinct=True))

    categories = [
        {"category": row["category"], "merit": row["merit"], "demerit": row["demerit"]}
        for row in period.values("category")
        .annotate(
            merit=Coalesce(Sum("weight", filter=Q(record_type=RecordType.MERIT)), 0),
            demerit=Coalesce(Sum("weight", filter=Q(record_type=RecordType.DEMERIT)), 0),
        )
        .order_by("category")
    ]

    total = counts["records"]
    offset = (page - 1) * PAGE_SIZE
    rows = (
        period.select_related("soul")
        .order_by("-recorded_at", "-id")[offset: offset + PAGE_SIZE]
    )
    results = [
        {
            "id": r.id,
            "soul_id": r.soul_id,
            "soul_name": r.soul.name,
            "record_type": r.record_type,
            "category": r.category,
            "description": r.description,
            "weight": r.weight,
            "statute_clause": r.statute_clause,
            "recorded_at": r.recorded_at,
            "day": timezone.localtime(r.recorded_at).date(),
        }
        for r in rows
    ]

    return {
        "month": month,
        "opening": opening,
        "received": received,
        "disbursed": disbursed,
        "closing": opening + received - disbursed,
        "soul_count": counts["souls"],
        "record_count": total,
        "categories": categories,
        "page": page,
        "page_size": PAGE_SIZE,
        "count": total,
        "results": results,
    }
