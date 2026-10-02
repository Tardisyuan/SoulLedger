"""余额月快照与仪表盘「平均余额 · 较上月」。

断反面:当月的快照不算「上月」;别的租户的快照不进本租户的上月;全部租户的上月是加权的
(和除以数),不是各租户均值的均值;没有上月快照时两项都是 null,不是 0。
"""
import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.ledger.models import BalanceSnapshot
from apps.ledger.snapshots import month_start, previous_month, snapshot_tenant
from apps.ledger.tasks import snapshot_balance_for_tenant
from apps.souls.models import Soul
from apps.tenants.models import Tenant

URL = "/api/v1/ledger/stats/overview/"


def _client(user, tenant=None):
    token = RefreshToken.for_user(user)
    if tenant is not None:
        token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    eu, _ = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})
    admin = User.objects.create_user(username="snap-admin", password="x", role=UserRole.ADMIN, tenant=cn)
    return cn, eu, admin


def _soul(tenant, merit, demerit):
    return Soul.objects.create(name="魂", tenant=tenant, merit_score=merit, demerit_score=demerit)


def _prev(tenant, count, total):
    return BalanceSnapshot.objects.create(
        tenant=tenant, month=previous_month(timezone.now().date()), soul_count=count, balance_total=total,
    )


def test_month_arithmetic_crosses_the_year():
    assert previous_month(dt.date(2026, 1, 15)) == dt.date(2025, 12, 1)
    assert previous_month(dt.date(2026, 3, 1)) == dt.date(2026, 2, 1)
    assert month_start(dt.date(2026, 10, 31)) == dt.date(2026, 10, 1)


@pytest.mark.django_db
class TestWriting:
    def test_a_snapshot_is_the_sum_and_count_of_the_tenants_souls_only(self, world):
        cn, eu, _ = world
        _soul(cn, 30, 10)
        _soul(cn, 0, 5)
        _soul(eu, 9000, 0)
        row = snapshot_tenant(cn, today=dt.date(2026, 9, 17))
        assert (row.month, row.soul_count, row.balance_total) == (dt.date(2026, 9, 1), 2, 15)

    def test_a_second_run_in_the_month_overwrites_rather_than_adds_a_row(self, world):
        cn, _, _ = world
        _soul(cn, 10, 0)
        snapshot_tenant(cn, today=dt.date(2026, 9, 1))
        _soul(cn, 20, 0)
        snapshot_tenant(cn, today=dt.date(2026, 9, 30))
        rows = list(BalanceSnapshot.objects.filter(tenant=cn).values_list("month", "soul_count", "balance_total"))
        assert rows == [(dt.date(2026, 9, 1), 2, 30)]

    def test_a_tenant_without_souls_snapshots_zero_not_null(self, world):
        cn, _, _ = world
        row = snapshot_tenant(cn, today=dt.date(2026, 9, 1))
        assert (row.soul_count, row.balance_total) == (0, 0)

    def test_the_task_and_the_command_write_this_months_row(self, world):
        cn, eu, _ = world
        _soul(cn, 4, 0)
        result = snapshot_balance_for_tenant(str(cn.pk))
        assert result["soul_count"] == 1
        this_month = month_start(timezone.now().date())
        assert BalanceSnapshot.objects.filter(tenant=cn, month=this_month).exists()
        assert not BalanceSnapshot.objects.filter(tenant=eu).exists()

        eu.is_active = True
        eu.save()
        call_command("snapshot_balances")
        active = set(Tenant.objects.filter(is_active=True).values_list("pk", flat=True))
        written = set(BalanceSnapshot.objects.filter(month=this_month).values_list("tenant_id", flat=True))
        assert written == active
        assert BalanceSnapshot.objects.filter(tenant=cn).count() == 1


@pytest.mark.django_db
class TestComparedWithLastMonth:
    def test_no_previous_snapshot_means_null_not_zero(self, world):
        cn, _, admin = world
        _soul(cn, 10, 0)
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance"] == 10.0
        assert body["average_balance_prev_month"] is None
        assert body["average_balance_delta"] is None

    def test_this_months_snapshot_is_not_last_month(self, world):
        cn, _, admin = world
        _soul(cn, 10, 0)
        snapshot_tenant(cn)
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance_prev_month"] is None

    def test_delta_is_now_minus_last_month(self, world):
        cn, _, admin = world
        _soul(cn, 10, 0)
        _soul(cn, 0, 3)  # now: (10 - 3) / 2 = 3.5
        _prev(cn, count=3, total=14)  # last month: 14 / 3 = 4.666…
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance_prev_month"] == 4.7
        assert body["average_balance_delta"] == -1.2

    def test_delta_is_taken_before_rounding(self, world):
        cn, _, admin = world
        _soul(cn, 2, 0)
        _soul(cn, 1, 0)
        _soul(cn, 1, 0)  # now: 4 / 3 = 1.333… (shown 1.3)
        _prev(cn, count=50, total=63)  # last month: 1.26 (shown 1.3)
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance"] == body["average_balance_prev_month"] == 1.3
        # 1.333… - 1.26 = 0.073… -> 0.1. Subtracting the shown values would say 0.0.
        assert body["average_balance_delta"] == 0.1

    def test_another_tenants_snapshot_does_not_count(self, world):
        cn, eu, admin = world
        _soul(cn, 10, 0)
        _prev(eu, count=1, total=-5000)
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance_prev_month"] is None
        _prev(cn, count=1, total=8)
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance_prev_month"] == 8.0
        assert body["average_balance_delta"] == 2.0

    def test_admin_without_a_tenant_gets_the_weighted_mean_of_all_tenants(self, world):
        cn, eu, _ = world
        root = User.objects.create_user(username="snap-root", password="x", role=UserRole.ADMIN, tenant=None)
        _soul(cn, 10, 0)
        _prev(cn, count=1, total=100)   # 100
        _prev(eu, count=3, total=0)     # 0
        body = _client(root).get(URL).json()
        # (100 + 0) / (1 + 3) = 25, not (100 + 0) / 2 = 50.
        assert body["average_balance_prev_month"] == 25.0

    def test_a_previous_snapshot_with_no_souls_has_no_average(self, world):
        cn, _, admin = world
        _soul(cn, 10, 0)
        _prev(cn, count=0, total=0)
        body = _client(admin, cn).get(URL).json()
        assert body["average_balance_prev_month"] is None
        assert body["average_balance_delta"] is None


@pytest.mark.django_db
def test_one_snapshot_per_tenant_and_month_is_a_database_constraint(world):
    from django.db import IntegrityError, transaction

    cn, _, _ = world
    _prev(cn, count=1, total=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        _prev(cn, count=2, total=2)


def test_ledger_0002_round_trip(migration_round_trip):
    """Schema only: forward creates the table, reverse drops it, the tenants survive both."""
    from django.db import connection

    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        state.get_model("tenants", "Tenant")._base_manager.create(code="RT_SNAP", display_name="RT")

    def tables():
        return set(connection.introspection.table_names())

    def snapshot(state):
        rows = snapshot_rows(
            state.get_model("tenants", "Tenant")._base_manager.filter(code="RT_SNAP"),
            key="code", fields={"display_name": "display_name"},
        )
        # Schema-only migration: the table's presence is the data it changes.
        rows["table:ledger_balancesnapshot"] = {"exists": "ledger_balancesnapshot" in tables()}
        return rows

    def check_forward(state):
        assert "ledger_balancesnapshot" in tables()
        tenant = state.get_model("tenants", "Tenant")._base_manager.get(code="RT_SNAP")
        state.get_model("ledger", "BalanceSnapshot")._base_manager.create(
            tenant=tenant, month=dt.date(2026, 9, 1), soul_count=1, balance_total=-3,
        )

    def check_reverse(state):
        assert "ledger_balancesnapshot" not in tables()

    migration_round_trip(
        before=("ledger", "0001_rename_celery_task_names"),
        after=("ledger", "0002_balance_snapshot"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
