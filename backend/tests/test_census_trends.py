"""灵魂普查日快照与 `GET /ledger/stats/trends/`(仪表盘「趋势」)。

断反面:同一天跑两次是一行不是两行;别的租户的灵魂不进本租户的普查;非 ADMIN 看不到别殿的点;
ADMIN 不带租户时按天相加;范围外的日子不出现;非法 range 是 400 不是默认值;
没有快照是空数组不是补零的点;任务注册了且是 TENANT 作用域。
"""
import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.ledger.models import SoulCensusSnapshot
from apps.ledger.snapshots import CENSUS_RETENTION_DAYS, census_tenant
from apps.ledger.tasks import snapshot_census_for_tenant
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.scheduler import registry
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

URL = "/api/v1/ledger/stats/trends/"


def _today():
    return timezone.now().date()


def _client(user, tenant=None):
    token = RefreshToken.for_user(user)
    if tenant is not None:
        token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    eu, _ = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})
    role = Role.objects.create(name="CENSUS_READER", display_name="CENSUS_READER")
    perm, _ = Permission.objects.get_or_create(
        codename="ledger.read", defaults={"name": "ledger.read", "category": "ledger"},
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    admin = User.objects.create_user(username="cen-admin", password="x", role=UserRole.ADMIN, tenant=cn)
    reader = User.objects.create_user(username="cen-reader", password="x", role="CENSUS_READER", tenant=cn)
    yield cn, eu, admin, reader
    invalidate_all_permissions()


def _row(tenant, day, **kw):
    kw.setdefault("soul_count", 0)
    return SoulCensusSnapshot.objects.create(tenant=tenant, day=day, **kw)


@pytest.mark.django_db
class TestWriting:
    def test_counts_by_state_and_civilization_for_this_tenant_only(self, world):
        cn, eu, _, _ = world
        Soul.objects.create(name="a", tenant=cn, current_state=SoulState.ALIVE)
        Soul.objects.create(name="b", tenant=cn, current_state=SoulState.ALIVE)
        Soul.objects.create(name="c", tenant=cn, current_state=SoulState.JUDGING)
        Soul.objects.create(name="d", tenant=eu, current_state=SoulState.ALIVE)
        row = census_tenant(cn, today=_today())
        assert row.soul_count == 3
        assert row.by_state == {"ALIVE": 2, "JUDGING": 1}
        assert row.by_civilization == {cn.civilization: 3}
        assert row.by_realm == {}

    def test_running_twice_in_a_day_leaves_one_row_with_the_later_values(self, world):
        cn, _, _, _ = world
        Soul.objects.create(name="a", tenant=cn)
        census_tenant(cn, today=_today())
        Soul.objects.create(name="b", tenant=cn)
        census_tenant(cn, today=_today())
        rows = list(SoulCensusSnapshot.objects.filter(tenant=cn))
        assert len(rows) == 1 and rows[0].soul_count == 2

    def test_an_empty_tenant_snapshots_zero_with_no_civilization_key(self, world):
        cn, _, _, _ = world
        row = census_tenant(cn, today=_today())
        assert (row.soul_count, row.by_state, row.by_civilization) == (0, {}, {})

    def test_rows_past_retention_are_dropped_and_the_edge_is_kept(self, world):
        cn, eu, _, _ = world
        today = _today()
        old = today - dt.timedelta(days=CENSUS_RETENTION_DAYS + 1)
        edge = today - dt.timedelta(days=CENSUS_RETENTION_DAYS)
        _row(cn, old)
        _row(cn, edge)
        _row(eu, old)
        census_tenant(cn, today=today)
        assert set(SoulCensusSnapshot.objects.filter(tenant=cn).values_list("day", flat=True)) == {edge, today}
        assert SoulCensusSnapshot.objects.filter(tenant=eu, day=old).exists()  # other tenants untouched

    def test_the_task_writes_today_for_exactly_its_tenant(self, world):
        cn, eu, _, _ = world
        Soul.objects.create(name="a", tenant=cn)
        result = snapshot_census_for_tenant(str(cn.pk))
        assert result["soul_count"] == 1
        assert SoulCensusSnapshot.objects.filter(tenant=cn, day=_today()).exists()
        assert not SoulCensusSnapshot.objects.filter(tenant=eu).exists()


def test_the_job_is_registered_per_tenant_and_a_worker_can_run_it():
    from config.celery import app

    app.loader.import_default_modules()
    spec = registry.get("ledger.snapshot_census_for_tenant")
    assert spec is not None and spec.scope == registry.TENANT and spec.cron == "50 23 * * *"
    assert spec.key in app.tasks
    assert spec.description_key == "scheduler.jobs.ledger_snapshot_census_for_tenant"


@pytest.mark.django_db
class TestApi:
    def test_admin_without_a_hall_gets_the_per_day_sum_across_tenants(self, world):
        cn, eu, admin, _ = world
        today = _today()
        _row(cn, today, soul_count=3, by_state={"ALIVE": 3}, by_realm={"R1": 1})
        _row(eu, today, soul_count=2, by_state={"ALIVE": 1, "JUDGING": 1}, by_realm={"R1": 2, "R2": 1})
        body = _client(admin).get(URL, {"range": "30d"}).json()
        assert len(body["points"]) == 1
        p = body["points"][0]
        assert p["day"] == today.isoformat() and p["soul_count"] == 5
        assert p["by_state"] == {"ALIVE": 4, "JUDGING": 1}
        assert p["by_realm"] == {"R1": 3, "R2": 1}

    def test_a_non_admin_sees_only_their_own_hall(self, world):
        cn, eu, _, reader = world
        _row(cn, _today(), soul_count=3)
        _row(eu, _today(), soul_count=2)
        body = _client(reader, cn).get(URL).json()
        assert [p["soul_count"] for p in body["points"]] == [3]

    def test_a_caller_without_ledger_read_is_refused(self, world):
        cn, _, _, _ = world
        nobody = User.objects.create_user(username="cen-none", password="x", role="NOBODY", tenant=cn)
        assert _client(nobody, cn).get(URL).status_code == 403

    def test_range_bounds_the_days_returned(self, world):
        cn, _, admin, _ = world
        today = _today()
        for ago in (0, 29, 30, 89, 90, 364, 365):
            _row(cn, today - dt.timedelta(days=ago), soul_count=ago)

        def counts(r):
            return [p["soul_count"] for p in _client(admin).get(URL, {"range": r}).json()["points"]]

        assert counts("30d") == [29, 0]
        assert counts("90d") == [89, 30, 29, 0]
        assert counts("12m") == [364, 90, 89, 30, 29, 0]

    def test_default_range_is_30_days_and_points_ascend(self, world):
        cn, _, admin, _ = world
        _row(cn, _today(), soul_count=1)
        _row(cn, _today() - dt.timedelta(days=5), soul_count=2)
        body = _client(admin).get(URL).json()
        assert body["range"] == "30d"
        assert [p["day"] for p in body["points"]] == sorted(p["day"] for p in body["points"])

    def test_an_unknown_range_is_400_not_a_silent_default(self, world):
        _, _, admin, _ = world
        r = _client(admin).get(URL, {"range": "7d"})
        assert r.status_code == 400 and r.json()["error"] == "INVALID_RANGE"

    def test_no_snapshots_is_an_empty_list_not_zero_filled(self, world):
        _, _, admin, _ = world
        assert _client(admin).get(URL, {"range": "90d"}).json()["points"] == []
