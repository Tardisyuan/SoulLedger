"""冥界年报(v4 第八批 S14,`annual.*`)。`GET /judgment/annual/?year=YYYY`,默认今年。

范围与概览相同:调用者的审判列表(`JudgmentViewSet.get_queryset`:租户 + 数据范围),年按殿的时区
(`Tenant.hall_timezone`)从 1 月 1 日 0 点起。定稿屏上的每个数怎么算:

* `received` —— 这一年开案的案子涉及多少个灵魂(按灵魂去重:重审另开的一件不再算一个)。
  `annual.lead` 后面那个大数。
* `placed` —— 其中有了去处的灵魂:它这一年开的某件案子已结案,且裁决不是「再审一次」(`models.hears_again`:
  RETRY,或欧洲以外的 PURGATORY)。`annual.total_rest` 的 `{{m}}`。按 `soul.civilization` 判,
  ponytail:与 `case_civilization` 只在「原属地开案、灵魂暂居别处」那一种案子上不同,年报不为它多查一次殿。
* `by_civ` —— `received` 按灵魂的文明分(`annual.by_civ`),只列有数的文明。一殿只看得到自己,就只有一行。
* `concluded` / `avg_days` —— 这一年结案的件数、可认领到结案扣掉待定的平均天数(与概览同一口径,`hall_stats.span_seconds`)。
* `longest` —— 这一年结案里用时最长的一件(`annual.longest`):案号、灵魂名、整天数(四舍五入)。
* `most_cited` —— 这一年结案的案子里被引用最多的条文(`annual.most_cited`),并列取条码小的;
  `corpus_size` 是同一殿同一语料的条数(定稿「§ 27 / 42」的 42)。
* `returned` / `returned_pct` —— 退回重审(与概览同一定义:判 RETRY 的件数 + 城隍「退回补正」的次数)及其占这一年结案的
  百分比(一位小数,没有结案为 null);`last_year_returned_pct` 是上一年的同一个数(`annual.returned_down|up`)。
* `monthly` / `last_year_monthly` —— 每月结案数,各 12 个(`annual.monthly`)。

ponytail: 用时与分月在 Python 里算(两年的结案行);一殿一年几十万件时改成数据库里按月分组。
"""
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.db.models import Count, Q
from django.utils import timezone

from apps.judgment.hall_stats import average_days, span_seconds

#: 「再审一次」的裁决(`models.hears_again`),写成查询:RETRY,或欧洲以外的 PURGATORY。
HEARS_AGAIN_Q = Q(verdict="RETRY") | (Q(verdict="PURGATORY") & ~Q(soul__civilization="EUROPEAN"))
CIV_ORDER = ("CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK")


def _year_bounds(year: int, tz: ZoneInfo):
    return (datetime.combine(datetime(year, 1, 1).date(), time.min, tzinfo=tz),
            datetime.combine(datetime(year + 1, 1, 1).date(), time.min, tzinfo=tz))


def _concluded_in(queryset, start, end):
    return queryset.filter(is_final=True, concluded_at__isnull=False, concluded_at__gte=start, concluded_at__lt=end)


def _returned(queryset, rows, tenant_ids, start, end) -> int:
    from apps.events.models import SoulEvent

    return sum(1 for row in rows if row[4] == "RETRY") + SoulEvent.objects.filter(
        tenant_id__in=tenant_ids, event_type="CITY_GOD_RETURNED", create_time__gte=start, create_time__lt=end).count()


def _pct(part: int, whole: int) -> float | None:
    return round(100 * part / whole, 1) if whole else None


def _monthly(rows, tz) -> list[int]:
    months = [0] * 12
    for row in rows:
        months[row[0].astimezone(tz).month - 1] += 1
    return months


def _most_cited(concluded, locale):
    from apps.judgment.models import Statute

    top = (concluded.filter(citations__is_deleted=False)
           .values("citations__statute").annotate(n=Count("pk"))
           .order_by("-n", "citations__statute__code").first())
    if not top:
        return None
    statute = Statute.objects.get(pk=top["citations__statute"])
    return {
        "code": statute.code,
        "corpus": statute.corpus,
        "ordinal": statute.ordinal,
        "corpus_size": Statute.objects.filter(tenant_id=statute.tenant_id, corpus=statute.corpus).count(),
        "display_title": statute.get_localized_title(locale),
        "citations": top["n"],
    }


def report(queryset, tenant, year=None, locale="zh-Hans", now=None) -> dict:
    tz_name = tenant.hall_timezone if tenant is not None else "UTC"
    tz = ZoneInfo(tz_name)
    year = year or (now or timezone.now()).astimezone(tz).year
    start, end = _year_bounds(year, tz)
    last_start, _ = _year_bounds(year - 1, tz)

    # `.order_by()`:模型的默认排序会被 Django 带进 SELECT DISTINCT,按灵魂去重就不去重了。
    opened = queryset.filter(created_at__gte=start, created_at__lt=end).order_by()
    received = opened.values("soul").distinct().count()
    placed = opened.filter(is_final=True).exclude(HEARS_AGAIN_Q).values("soul").distinct().count()
    by_civ = {row["soul__civilization"]: row["n"]
              for row in opened.values("soul__civilization").annotate(n=Count("soul", distinct=True))}

    fields = ("concluded_at", "claimable_since", "created_at", "deferred_total", "verdict", "case_number", "soul__name")
    concluded = _concluded_in(queryset, start, end)
    rows = list(concluded.values_list(*fields))
    last_rows = list(_concluded_in(queryset, last_start, start).values_list(*fields))
    longest = max(rows, key=lambda row: span_seconds(*row[:4]), default=None)

    tenant_ids = set(queryset.order_by().values_list("tenant_id", flat=True).distinct())
    returned = _returned(queryset, rows, tenant_ids, start, end)
    last_returned = _returned(queryset, last_rows, tenant_ids, last_start, start)

    return {
        "timezone": tz_name,
        "year": year,
        "received": received,
        "placed": placed,
        "by_civ": [{"civilization": civ, "received": by_civ[civ]} for civ in CIV_ORDER if by_civ.get(civ)],
        "concluded": len(rows),
        "avg_days": average_days(rows),
        "longest": None if longest is None else {
            "case_number": longest[5],
            "soul_name": longest[6],
            "days": round(span_seconds(*longest[:4]) / 86400),
        },
        "most_cited": _most_cited(concluded, locale),
        "returned": returned,
        "returned_pct": _pct(returned, len(rows)),
        "last_year_returned_pct": _pct(last_returned, len(last_rows)),
        "monthly": _monthly(rows, tz),
        "last_year_monthly": _monthly(last_rows, tz),
    }
