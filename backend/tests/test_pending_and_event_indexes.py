"""be-scale 4.3 / 4.5 的四条索引:在模型 Meta 里(`makemigrations --check` 守着迁移与它一致),
且迁移用的是 `CREATE INDEX CONCURRENTLY`(`atomic = False`)。查询计划要在真 PostgreSQL 上看,这里只守声明。"""
import importlib

import pytest
from django.db.models import Q

from apps.core.migration_ops import AddIndexConcurrently
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment
from apps.judgment.views import PENDING
from apps.notifications.models import UserNotification
from apps.souls.models import Soul

EXPECTED = [
    (Judgment, "judgment_pending_idx", ["tenant", "claimed_by", "created_at"],
     Q(verdict__isnull=True, is_final=False, is_archived=False, is_deleted=False),
     "apps.judgment.migrations.0053_judgment_pending_idx"),
    (SoulEvent, "soulevent_tenant_type_time_idx", ["tenant", "event_type", "create_time"], None,
     "apps.events.migrations.0034_soulevent_tenant_type_time_idx"),
    (Soul, "soul_needs_recalc_idx", ["tenant"], Q(needs_ledger_recalculation=True),
     "apps.souls.migrations.0058_soul_needs_recalc_idx"),
    (UserNotification, "notif_unread_idx", ["user", "created_at"], Q(is_read=False),
     "apps.notifications.migrations.0020_notif_unread_idx"),
]


@pytest.mark.parametrize(("model", "name", "fields", "condition", "migration"), EXPECTED, ids=[e[1] for e in EXPECTED])
def test_the_index_is_declared_and_added_concurrently(model, name, fields, condition, migration):
    declared = {i.name: i for i in model._meta.indexes}
    assert name in declared
    assert declared[name].fields == fields
    assert declared[name].condition == condition

    module = importlib.import_module(migration)
    assert module.Migration.atomic is False
    ops = [op for op in module.Migration.operations if isinstance(op, AddIndexConcurrently)]
    assert [op.index.name for op in ops] == [name]
    assert ops[0].index.fields == fields and ops[0].index.condition == condition


def test_the_pending_index_condition_is_implied_by_the_queue_predicate():
    """计划器只在查询的 WHERE 蕴含索引条件时用部分索引。队列的 `PENDING` 必须逐列含着索引条件里的
    每一项(`is_deleted` 由 TenantManager 加)—— `PENDING` 改了列而索引没跟着改,这里红。"""
    pending = str(Judgment.objects.filter(PENDING).query)
    for column in ('"verdict" IS NULL', '"is_final"', '"is_archived"', '"is_deleted"'):
        assert column in pending, column
