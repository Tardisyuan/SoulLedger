"""
Ledger domain models.

SoulRecord (the core ledger data model) is defined in souls/record_models.py
for backward compatibility. This module re-exports it as the canonical
ledger-domain interface.

DECIDED (M8-2), not pending. The TODO that stood here — "Move SoulRecord
physically to this file and create a proper app_label migration" — was costed
on 2026-08-23 and declined. Moving the app_label renames `souls_soulrecord`
(the table name is derived, not declared), edits state across 22 of the 27
`apps/souls` migrations, and carries one ContentType row plus four
`auth_permission` codenames with it, in exchange for nothing a caller can see:
`from apps.ledger.models import SoulRecord` already works, and it is the same
class object rather than a second definition. The full count, and what would
have to be deleted to reverse the decision, is in `apps/ledger/test_models.py`,
which pins it.
"""
from django.db import models

from apps.souls.record_models import RecordCategory, RecordType, SoulRecord

# Canonical alias for ledger-domain usage
LedgerRecord = SoulRecord


class BalanceSnapshot(models.Model):
    """一个租户某个月的余额快照 —— 仪表盘「平均余额 · 较上月」的上月那一半。

    余额(`Soul.merit_score - demerit_score`)是反规范化的现值,没有历史:衰减与
    转世结转都会改写它,所以**过去某月的均值无法从功过记录倒推**。唯一诚实的来源
    是当时记下来,于是这张表只从开始写的那个月起有数,不做回填。

    存「和」与「数」而不存均值:全部租户的上月均值是各租户 `balance_total` 之和除以
    `soul_count` 之和;存均值就只能求均值的均值(按租户等权,是错的)。

    `month` 是该月一日。`ledger.snapshot_balance_for_tenant` 每天覆盖当月那一行,
    所以一个过去的月份留下的是它最后一次运行时的值 —— 每天跑,就是月末那天。
    """

    tenant = models.ForeignKey(
        "tenants.Tenant", on_delete=models.CASCADE, related_name="balance_snapshots",
    )
    month = models.DateField(help_text="First day of the month this snapshot stands for.")
    soul_count = models.PositiveIntegerField()
    balance_total = models.BigIntegerField(
        help_text="Sum of merit_score - demerit_score over the tenant's souls.",
    )
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "month"], name="uniq_balance_snapshot_tenant_month",
            ),
        ]

    def __str__(self):
        return f"{self.tenant_id} {self.month:%Y-%m}"


__all__ = ["SoulRecord", "LedgerRecord", "RecordType", "RecordCategory", "BalanceSnapshot"]
