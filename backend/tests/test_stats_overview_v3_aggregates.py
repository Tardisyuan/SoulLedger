"""`/ledger/stats/overview/` 为仪表盘 v3 加的四样:平均余额(全体与每个状态)、等宽直方图、
界域前十的容量与在押、`as_of`。

每条都断反面:均值不是桶中点估出来的;没有灵魂的状态是 null 不是 0;直方图的边界是
半开区间、两端开口、格子之和等于总数;「在押」数的是未离开的行程站,不是处置条数;
别的租户的灵魂不进均值。
"""
import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User, UserRole
from apps.disposition.models import Disposition
from apps.realms.models import Realm, RealmType, SoulPathEntry
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

URL = "/api/v1/ledger/stats/overview/"


@pytest.fixture
def world(db):
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    eu, _ = Tenant.objects.get_or_create(code="EU_HEAVEN_HELL", defaults={"display_name": "EU"})
    admin = User.objects.create_user(username="stats-v3", password="x", role=UserRole.ADMIN, tenant=cn)
    # A real token, so TenantMiddleware sets request.tenant = CN and the view scopes to it.
    token = RefreshToken.for_user(admin)
    token["tenant_code"] = cn.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client, cn, eu


def _soul(tenant, merit, demerit, state=SoulState.ALIVE, name="魂"):
    return Soul.objects.create(name=name, tenant=tenant, merit_score=merit, demerit_score=demerit, current_state=state)


def _get(client, tenant):
    response = client.get(URL)
    assert response.status_code == 200, response.data
    return response.json()


@pytest.mark.django_db
class TestAverageBalance:
    def test_the_overall_mean_is_exact_not_a_bucket_midpoint(self, world):
        client, cn, _ = world
        # Balances 1000, 7, -3: the old ±10-padded midpoints would read (60 + 0 + 0)/3 = 20.0.
        _soul(cn, 1000, 0)
        _soul(cn, 7, 0)
        _soul(cn, 0, 3)
        body = _get(client, cn)
        assert body["average_balance"] == round((1000 + 7 - 3) / 3, 1) == 334.7

    def test_each_state_has_its_own_mean_and_an_empty_state_is_null(self, world):
        client, cn, _ = world
        _soul(cn, 10, 0, SoulState.ALIVE)
        _soul(cn, 20, 5, SoulState.ALIVE)
        _soul(cn, 0, 40, SoulState.JUDGING)
        rows = {r["state"]: r for r in _get(client, cn)["state_distribution"]}
        assert rows["ALIVE"]["count"] == 2
        assert rows["ALIVE"]["average_balance"] == 12.5
        assert rows["JUDGING"]["average_balance"] == -40.0
        # Nobody disposed: no mean exists — null, never 0.
        assert rows["DISPOSED"]["count"] == 0
        assert rows["DISPOSED"]["average_balance"] is None

    def test_no_souls_means_no_average(self, world):
        client, cn, _ = world
        assert _get(client, cn)["average_balance"] is None

    def test_another_tenants_souls_do_not_move_the_mean(self, world):
        client, cn, eu = world
        _soul(cn, 10, 0)
        _soul(eu, 0, 9000)
        body = _get(client, cn)
        assert body["average_balance"] == 10.0
        assert {r["state"]: r["average_balance"] for r in body["state_distribution"]}["ALIVE"] == 10.0


@pytest.mark.django_db
class TestBalanceHistogram:
    def test_fixed_width_buckets_with_open_ends(self, world):
        client, cn, _ = world
        hist = _get(client, cn)["balance_histogram"]
        assert hist["bucket_width"] == 50
        bounds = [(b["min"], b["max"]) for b in hist["buckets"]]
        assert bounds[0] == (None, -300)
        assert bounds[-1] == (300, None)
        assert bounds[1:-1] == [(lo, lo + 50) for lo in range(-300, 300, 50)]
        assert len(bounds) == 14

    def test_edges_are_half_open_and_every_soul_lands_in_exactly_one_bucket(self, world):
        client, cn, _ = world
        for merit, demerit in [(0, 301), (0, 300), (0, 1), (0, 0), (49, 0), (50, 0), (299, 0), (300, 0), (200000, 0)]:
            _soul(cn, merit, demerit)
        body = _get(client, cn)
        counts = {(b["min"], b["max"]): b["count"] for b in body["balance_histogram"]["buckets"]}
        assert counts[(None, -300)] == 1        # -301
        assert counts[(-300, -250)] == 1        # -300 belongs to the bucket it opens
        assert counts[(-50, 0)] == 1            # -1
        assert counts[(0, 50)] == 2             # 0 and 49
        assert counts[(50, 100)] == 1           # 50
        assert counts[(250, 300)] == 1          # 299
        assert counts[(300, None)] == 2         # 300 and 200000
        assert body["balance_histogram"]["total"] == body["total_souls"] == 9
        assert sum(counts.values()) == 9

    def test_the_old_seven_buckets_are_still_there(self, world):
        """欢迎页、调派提案页、/admin/stats 还读 `karma_distribution`。"""
        client, cn, _ = world
        _soul(cn, 3, 0)
        body = _get(client, cn)
        assert [b["label"] for b in body["karma_distribution"]] == [
            "< -50", "-50 to -20", "-20 to -5", "-5 to 5", "5 to 20", "20 to 50", ">= 50",
        ]
        assert body["karma_distribution_total"] == 1


@pytest.mark.django_db
class TestRealmCapacity:
    def _realm(self, tenant, code, capacity):
        return Realm.objects.create(
            realm_code=code, name_local=code, civilization="CHINESE", realm_type=RealmType.HELL,
            tenant=tenant, capacity=capacity,
        )

    def _disposed_into(self, tenant, realm, n, *, standing):
        """n executed dispositions into `realm`; `standing` of those souls are still there."""
        for i in range(n):
            soul = _soul(tenant, 0, 0, SoulState.DISPOSED, name=f"{realm.realm_code}-{i}")
            Disposition.objects.create(soul=soul, tenant=tenant, destination_realm=realm, is_executed=True)
            SoulPathEntry.objects.create(
                soul=soul, realm=realm, sequence=1, tenant=tenant,
                entered_at=timezone.now() - dt.timedelta(days=2),
                left_at=None if i < standing else timezone.now() - dt.timedelta(days=1),
            )

    def test_held_counts_souls_still_there_against_capacity(self, world):
        client, cn, _ = world
        half = self._realm(cn, "V3_HALF", 8)
        full = self._realm(cn, "V3_FULL", 2)
        unrecorded = self._realm(cn, "V3_OPEN", None)
        self._disposed_into(cn, half, 6, standing=4)
        self._disposed_into(cn, full, 3, standing=3)
        self._disposed_into(cn, unrecorded, 1, standing=1)
        rows = {r["realm_code"]: r for r in _get(client, cn)["souls_by_realm"]}
        # `count` is every disposition ever executed; `held` only the ones still standing.
        assert (rows["V3_HALF"]["count"], rows["V3_HALF"]["held"], rows["V3_HALF"]["capacity"]) == (6, 4, 8)
        assert (rows["V3_FULL"]["held"], rows["V3_FULL"]["capacity"]) == (3, 2)
        assert rows["V3_OPEN"]["capacity"] is None
        assert rows["V3_OPEN"]["held"] == 1

    def test_held_agrees_with_the_rule_placement_refuses_by(self, world):
        from apps.disposition.destination import realm_held

        client, cn, _ = world
        realm = self._realm(cn, "V3_SAME", 5)
        self._disposed_into(cn, realm, 4, standing=2)
        row = next(r for r in _get(client, cn)["souls_by_realm"] if r["realm_code"] == "V3_SAME")
        assert row["held"] == realm_held(realm.pk) == 2


@pytest.mark.django_db
def test_as_of_is_when_the_aggregate_was_computed(world):
    client, cn, _ = world
    before = timezone.now()
    as_of = dt.datetime.fromisoformat(_get(client, cn)["as_of"].replace("Z", "+00:00"))
    assert before <= as_of <= timezone.now()
