"""余额月快照:写(定时任务 / 管理命令)与读(仪表盘「较上月」)。

月份按 UTC 切(`TIME_ZONE = "UTC"`),与 `apps/ledger/journal.py` 切月的口径一致。
模型与「为什么不回填」见 `apps.ledger.models.BalanceSnapshot`。
"""
from datetime import date, timedelta

from django.db.models import Count, F, Sum
from django.utils import timezone

from apps.disposition.models import Disposition
from apps.ledger.models import BalanceSnapshot, SoulCensusSnapshot
from apps.souls.models import Soul


def month_start(day: date) -> date:
    return day.replace(day=1)


def previous_month(day: date) -> date:
    return month_start(month_start(day) - timedelta(days=1))


def snapshot_tenant(tenant, *, today: date | None = None) -> BalanceSnapshot:
    """覆盖 `tenant` 当月那一行。余额式子与 `LedgerOverviewStatsView` 的平均余额同一个。"""
    today = today or timezone.now().date()
    agg = Soul.objects.filter(tenant=tenant).aggregate(
        n=Count("id"), total=Sum(F("merit_score") - F("demerit_score")),
    )
    row, _ = BalanceSnapshot.objects.update_or_create(
        tenant=tenant,
        month=month_start(today),
        defaults={"soul_count": agg["n"], "balance_total": agg["total"] or 0},
    )
    return row


def previous_month_average(snapshots, *, today: date | None = None) -> float | None:
    """`snapshots`(调用方已按租户划界)里上个月的加权平均余额;没有快照或没有灵魂时 None。

    不四舍五入:「较上月」的差要用两边的原值相减再取一位,否则差会带两次舍入误差。
    """
    today = today or timezone.now().date()
    agg = snapshots.filter(month=previous_month(today)).aggregate(
        n=Sum("soul_count"), total=Sum("balance_total"),
    )
    if not agg["n"]:
        return None
    return agg["total"] / agg["n"]


#: 普查快照保留天数;超过的在每次写入时顺手删掉(行数有界,见 SoulCensusSnapshot)。
CENSUS_RETENTION_DAYS = 731


def census_tenant(tenant, *, today: date | None = None) -> SoulCensusSnapshot:
    """覆盖 `tenant` 当天的普查行:按状态、文明、界域各数一遍。幂等(键是 tenant + day)。"""
    today = today or timezone.now().date()
    by_state = {
        r["current_state"]: r["n"]
        for r in Soul.objects.filter(tenant=tenant).values("current_state").annotate(n=Count("id"))
    }
    total = sum(by_state.values())
    by_realm = {
        r["destination_realm__realm_code"]: r["n"]
        for r in Disposition.objects.filter(tenant=tenant, is_executed=True, is_archived=False)
        .exclude(destination_realm__isnull=True)
        .values("destination_realm__realm_code")
        .annotate(n=Count("id"))
    }
    row, _ = SoulCensusSnapshot.objects.update_or_create(
        tenant=tenant,
        day=today,
        defaults={
            "soul_count": total,
            "by_state": by_state,
            "by_civilization": {tenant.civilization: total} if total else {},
            "by_realm": by_realm,
        },
    )
    SoulCensusSnapshot.objects.filter(
        tenant=tenant, day__lt=today - timedelta(days=CENSUS_RETENTION_DAYS),
    ).delete()
    return row
