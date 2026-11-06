"""本殿概览的几个数(v4 概览屏 `overview.*`,用户 2026-11-06)。`GET /judgment/hall-stats/`。

范围是调用者的审判列表(`JudgmentViewSet.get_queryset`:租户 + 数据范围),时间按殿的时区
(`Tenant.hall_timezone`,系统自设)。每个数怎么算:

* `pending` / `overdue` —— 未结案件(与队列同一谓词),其中已过期限的(`deadline.overdue_q`,待定中的不算)。
  对应 `overview.count_unit`「件 · 其中 {n} 件已过期限」。
* `concluded_this_month` —— 本月(殿的时区,1 日 0 点起)结案的件数。`overview.stat`「本月已结」。
* `month_done_pct` —— 本月已结 /(本月已结 + 此刻未结),四舍五入到整数;两者都是 0 时为 null。
  `overview.month_done_pct`。这是系统的定义,不是出典。
* `avg_days` —— 本月结案的案子从可认领到结案的平均天数,扣掉待定(与期限同一口径),一位小数;没有为 null。
  `claimable_since` 为空的老案子按开案时间算。
* `returned_this_month` —— 「退回重审」(用户 2026-11-06:两种都算):本月判 RETRY 的件数,加本月城隍「退回补正」
  的次数(`CITY_GOD_RETURNED` 事件;同一件退两次算两次)。
* `weeks` —— 近 12 周(周一起,含本周)每周结案数,与 13 周前那一周(`previous_quarter`,「上季同期」)。

ponytail: 平均用时与分周在 Python 里算(本月与近 25 周的结案行);一殿一季上万件时改成数据库里分组。
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.judgment import deadline

WEEKS = 12
QUARTER_WEEKS = 13


def overview(queryset, pending_q, tenant, now=None) -> dict:
    from apps.events.models import SoulEvent

    now = now or timezone.now()
    tz_name = tenant.hall_timezone if tenant is not None else "UTC"
    tz = ZoneInfo(tz_name)
    today = now.astimezone(tz).date()
    month_start = datetime.combine(today.replace(day=1), time.min, tzinfo=tz)

    pending = queryset.filter(pending_q)
    pending_count = pending.count()
    overdue = deadline.with_due_base(pending).filter(deadline.overdue_q(pending)).count()

    concluded = queryset.filter(is_final=True, concluded_at__isnull=False)
    month_rows = list(concluded.filter(concluded_at__gte=month_start)
                      .values_list("concluded_at", "claimable_since", "created_at", "deferred_total", "verdict"))
    done = len(month_rows)
    spans = [(at - (since or created) - (held or timedelta(0))).total_seconds()
             for at, since, created, held, _verdict in month_rows]
    avg_days = round(sum(spans) / len(spans) / 86400, 1) if spans else None

    tenant_ids = set(queryset.order_by().values_list("tenant_id", flat=True).distinct())
    returned = sum(1 for *_rest, verdict in month_rows if verdict == "RETRY") + SoulEvent.objects.filter(
        tenant_id__in=tenant_ids, event_type="CITY_GOD_RETURNED", create_time__gte=month_start).count()

    week0 = today - timedelta(days=today.weekday()) - timedelta(weeks=WEEKS - 1)
    earliest = datetime.combine(week0 - timedelta(weeks=QUARTER_WEEKS), time.min, tzinfo=tz)
    per_week = {}
    for at in concluded.filter(concluded_at__gte=earliest).values_list("concluded_at", flat=True):
        day = at.astimezone(tz).date()
        start = day - timedelta(days=day.weekday())
        per_week[start] = per_week.get(start, 0) + 1
    weeks = [{"week_start": week0 + timedelta(weeks=i),
              "concluded": per_week.get(week0 + timedelta(weeks=i), 0),
              "previous_quarter": per_week.get(week0 + timedelta(weeks=i - QUARTER_WEEKS), 0)}
             for i in range(WEEKS)]

    return {
        "timezone": tz_name,
        "pending": pending_count,
        "overdue": overdue,
        "concluded_this_month": done,
        "month_done_pct": round(100 * done / (done + pending_count)) if done + pending_count else None,
        "avg_days": avg_days,
        "returned_this_month": returned,
        "weeks": weeks,
    }
