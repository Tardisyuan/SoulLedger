"""余额月快照:写(定时任务 / 管理命令)与读(仪表盘「较上月」)。

月份按 UTC 切(`TIME_ZONE = "UTC"`),与 `apps/ledger/journal.py` 切月的口径一致。
模型与「为什么不回填」见 `apps.ledger.models.BalanceSnapshot`。
"""
from datetime import date, timedelta

from django.db.models import Count, F, Sum
from django.utils import timezone

from apps.ledger.models import BalanceSnapshot
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
