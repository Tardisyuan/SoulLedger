"""Guard G6 (docs/ARCHITECTURE-tenant-sharding.md 4.1): the global ADMIN's aggregates equal the halls' summed.

Why. Today the global overview is one query over one database. After a split it is a fan-out: ask every hall's
database, merge. The merge is new code, and a merge can drop a hall, double-count a shared realm, or truncate a
"top 10" per hall instead of globally. This file states what the merged answer must equal, using only the real
endpoints: the global number (an ADMIN with no hall) against the same endpoint asked as each hall's own ADMIN.
Today the per-hall side is the same database filtered by tenant; after a split it comes from the tenant databases
and these assertions stay as they are.

Endpoints covered: `GET /ledger/stats/overview/` (every field but `as_of`), `GET /ledger/stats/trends/`,
`GET /audit-logs/stats/`. The other ADMIN-only readers are not aggregates: `/ledger/stats/export/` is scoped to the
caller's hall even for ADMIN (an ADMIN with no hall gets an empty file), and the lists (audit log, dispatch,
recycle bin) are covered by the scoping contract.

The fixture is built so each hall's means are exact at one decimal: the endpoints publish rounded means, so a
sum can only be rebuilt from them (mean x count) when rounding lost nothing.
"""
import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User, UserRole
from apps.disposition.models import Disposition
from apps.ledger.models import BalanceSnapshot, SoulCensusSnapshot
from apps.ledger.snapshots import previous_month
from apps.realms.models import Realm
from apps.realms.path import SoulPathService
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db

OVERVIEW = "/api/v1/ledger/stats/overview/"
TRENDS = "/api/v1/ledger/stats/trends/"
AUDIT_STATS = "/api/v1/audit-logs/stats/"
HALLS = ("CN_DIYU", "EG_DUAT", "EU_HEAVEN_HELL", "GR_HADES")  # the last one is empty on purpose


def _client(user, tenant=None):
    token = RefreshToken.for_user(user)
    if tenant is not None:
        token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _get(client, url):
    response = client.get(url)
    assert response.status_code == 200, getattr(response, "data", response.content)
    return response.json()


@pytest.fixture
def world():
    """Four halls, mixed data, the global ADMIN's client and one ADMIN client per hall."""
    halls = {code: plan.tenant(code) for code in HALLS}
    cn, eg, eu = halls["CN_DIYU"], halls["EG_DUAT"], halls["EU_HEAVEN_HELL"]

    def soul(hall, merit, demerit, state, name):
        return Soul.objects.create(name=name, tenant=hall, merit_score=merit, demerit_score=demerit,
                                   current_state=state)

    # (merit, demerit, state): CN mean -41.0, EG mean 2.0, EU mean 10.0; per-state means exact too. EG holds the
    # two souls that fall outside the +-300 histogram and the +-99999 bucket edges the old code lost.
    rows = {
        cn: [(10, 0, "ALIVE"), (30, 0, "ALIVE"), (60, 0, "DISPOSED"), (0, 300, "DISPOSED"), (0, 5, "JUDGING")],
        eg: [(5, 0, "ALIVE"), (5, 0, "ALIVE"), (200000, 0, "DISPOSED"), (0, 200000, "DISPOSED"), (0, 0, "JUDGING")],
        eu: [(50, 0, "ALIVE"), (20, 0, "DISPOSED"), (20, 0, "DISPOSED"), (0, 50, "REINCARNATING")],
    }
    souls = {hall: [soul(hall, m, d, st, f"{hall.code}-{i}") for i, (m, d, st) in enumerate(spec)]
             for hall, spec in rows.items()}

    # Executed, unarchived dispositions by realm. SHARED_R is used by two halls: its global count is a sum.
    # Noise that must not count: not executed, archived, no realm.
    realms = {code: plan.realm(code, civ) for code, civ in (
        ("CN_R", "CHINESE"), ("EG_R", "EGYPTIAN"), ("EU_R", "EUROPEAN"), ("SHARED_R", "CHINESE"))}
    Realm.objects.filter(pk=realms["SHARED_R"].pk).update(capacity=10)

    def disposed(hall, who, realm, **extra):
        return Disposition.objects.create(soul=souls[hall][who], tenant=hall, destination_realm=realm, **extra)

    disposed(cn, 2, realms["CN_R"], is_executed=True)
    disposed(cn, 3, realms["SHARED_R"], is_executed=True)
    disposed(eg, 2, realms["EG_R"], is_executed=True)
    disposed(eg, 3, realms["SHARED_R"], is_executed=True)
    disposed(eg, 4, realms["SHARED_R"], is_executed=True)
    disposed(eu, 1, realms["EU_R"], is_executed=True)
    disposed(eu, 2, realms["EU_R"], is_executed=False)
    disposed(eu, 3, realms["EU_R"], is_executed=True, is_archived=True)
    disposed(eu, 0, None, is_executed=True)
    SoulPathService.enter(souls[eg][3], realms["SHARED_R"], tenant_id=eg.pk)  # one soul held in the shared realm

    # 15 audit rows over the three halls, interleaved in time, so "latest 10" cuts across halls.
    base = timezone.now() - dt.timedelta(hours=1)
    kinds = [(AuditAction.CREATE, "soul"), (AuditAction.UPDATE, "soul"), (AuditAction.UPDATE, "judgment"),
             (AuditAction.DELETE, "disposition"), (AuditAction.EXECUTE, "dispatch_record")]
    order = [cn, eg, eu, cn, eg, cn, eu, eg, cn, eu, cn, eg, cn, eu, eg]
    for i, hall in enumerate(order):
        action, resource = kinds[i % len(kinds)]
        log = AuditLog.objects.create(tenant=hall, action=action, resource=resource, resource_id=str(i),
                                      description=f"{hall.code} {i}")
        AuditLog.objects.filter(pk=log.pk).update(timestamp=base + dt.timedelta(minutes=i))

    # Last month's balance snapshots: means -20, 5, 30 over 4, 6, 2 souls.
    last = previous_month(timezone.now().date())
    for hall, n, total in ((cn, 4, -80), (eg, 6, 30), (eu, 2, 60)):
        BalanceSnapshot.objects.create(tenant=hall, month=last, soul_count=n, balance_total=total)

    # Census rows: overlapping and non-overlapping days, overlapping and distinct keys in every map.
    today = timezone.now().date()
    census = [
        (cn, 0, 5, {"ALIVE": 2, "DISPOSED": 2, "JUDGING": 1}, {"CHINESE": 5}, {"CN_R": 1, "SHARED_R": 1}),
        (cn, 1, 4, {"ALIVE": 2, "DISPOSED": 2}, {"CHINESE": 4}, {"CN_R": 1}),
        (cn, 2, 4, {"ALIVE": 3, "DISPOSED": 1}, {"CHINESE": 4}, {}),
        (eg, 0, 5, {"ALIVE": 2, "DISPOSED": 2, "JUDGING": 1}, {"EGYPTIAN": 5}, {"EG_R": 1, "SHARED_R": 2}),
        (eg, 1, 3, {"ALIVE": 3}, {"EGYPTIAN": 3}, {"SHARED_R": 1}),
        (eu, 0, 4, {"ALIVE": 1, "DISPOSED": 2, "REINCARNATING": 1}, {"EUROPEAN": 4}, {"EU_R": 1}),
        (eu, 3, 2, {"ALIVE": 2}, {"EUROPEAN": 2}, {}),
    ]
    for hall, ago, n, by_state, by_civ, by_realm in census:
        SoulCensusSnapshot.objects.create(tenant=hall, day=today - dt.timedelta(days=ago), soul_count=n,
                                          by_state=by_state, by_civilization=by_civ, by_realm=by_realm)

    admins = {code: User.objects.create_user(username=f"admin-{code}", password="x", role=UserRole.ADMIN, tenant=t)
              for code, t in halls.items()}
    global_admin = User.objects.create_user(username="admin-global", password="x", role=UserRole.ADMIN, tenant=None)
    assert not AuditLog.objects.filter(tenant__isnull=True).exists(), "fixture must start with no hall-less audit rows"
    return {
        "halls": halls,
        "global": _client(global_admin),
        "per_hall": {code: _client(admins[code], halls[code]) for code in HALLS},
    }


def _both(world, url):
    """(global answer, {hall code: that hall's answer})."""
    return _get(world["global"], url), {code: _get(c, url) for code, c in world["per_hall"].items()}


def _sum_counts(per_hall, pick):
    """Element-wise sum of lists of {key..., count} rows that every hall returns in the same order."""
    return [sum(counts) for counts in zip(*(pick(body) for body in per_hall.values()), strict=True)]


# ── overview ───────────────────────────────────────────────────────────────


def test_the_overview_counts_equal_the_sum_over_halls(world):
    whole, halls = _both(world, OVERVIEW)

    assert whole["total_souls"] == sum(h["total_souls"] for h in halls.values()) == 14
    assert [r["count"] for r in whole["state_distribution"]] == _sum_counts(
        halls, lambda b: [r["count"] for r in b["state_distribution"]])
    assert [r["count"] for r in whole["karma_distribution"]] == _sum_counts(
        halls, lambda b: [r["count"] for r in b["karma_distribution"]])
    assert whole["karma_distribution_total"] == sum(h["karma_distribution_total"] for h in halls.values())
    assert [r["count"] for r in whole["balance_histogram"]["buckets"]] == _sum_counts(
        halls, lambda b: [r["count"] for r in b["balance_histogram"]["buckets"]])
    assert whole["balance_histogram"]["total"] == sum(h["balance_histogram"]["total"] for h in halls.values())
    # The bucket edges are the same everywhere; only counts may differ.
    for body in halls.values():
        assert [(r["min"], r["max"]) for r in body["balance_histogram"]["buckets"]] == [
            (r["min"], r["max"]) for r in whole["balance_histogram"]["buckets"]]
        assert [r["label"] for r in body["karma_distribution"]] == [r["label"] for r in whole["karma_distribution"]]


def test_the_overview_means_are_the_weighted_means_of_the_halls(world):
    whole, halls = _both(world, OVERVIEW)

    n = {code: body["total_souls"] for code, body in halls.items()}
    total = sum(body["average_balance"] * n[code] for code, body in halls.items() if n[code])
    assert whole["average_balance"] == round(total / sum(n.values()), 1)
    assert halls["GR_HADES"]["average_balance"] is None  # an empty hall has no mean, and adds nothing

    for i, row in enumerate(whole["state_distribution"]):
        counts = [(body["state_distribution"][i]["count"], body["state_distribution"][i]["average_balance"])
                  for body in halls.values()]
        have = [(c, m) for c, m in counts if c]
        assert row["count"] == sum(c for c, _ in have)
        expected = round(sum(c * m for c, m in have) / row["count"], 1) if have else None
        assert row["average_balance"] == expected, row["state"]


def test_the_overview_previous_month_comparison_is_the_weighted_snapshot_mean(world):
    whole, halls = _both(world, OVERVIEW)

    weights = {"CN_DIYU": 4, "EG_DUAT": 6, "EU_HEAVEN_HELL": 2}  # soul_count in the fixture's snapshots
    prev = sum(halls[code]["average_balance_prev_month"] * w for code, w in weights.items()) / sum(weights.values())
    assert whole["average_balance_prev_month"] == round(prev, 1) == 0.8
    assert halls["GR_HADES"]["average_balance_prev_month"] is None
    assert halls["GR_HADES"]["average_balance_delta"] is None
    # delta = current mean - previous mean, taken on the raw values and rounded once.
    n = {code: body["total_souls"] for code, body in halls.items()}
    current = sum(body["average_balance"] * n[code] for code, body in halls.items() if n[code]) / sum(n.values())
    assert whole["average_balance_delta"] == round(current - prev, 1)


def test_the_overview_hall_rows_are_the_halls_own_rows(world):
    whole, halls = _both(world, OVERVIEW)

    by_code = {row["tenant_code"]: row for row in whole["tenants"]}
    assert set(by_code) == {"CN_DIYU", "EG_DUAT", "EU_HEAVEN_HELL"}, "an empty hall has no row, in either answer"
    for code, body in halls.items():
        assert body["tenants"] == ([by_code[code]] if code in by_code else [])
    assert [row["tenant_code"] for row in whole["tenants"]] == sorted(by_code)


def test_the_overview_realm_counts_are_summed_across_halls_and_the_rest_is_shared(world):
    whole, halls = _both(world, OVERVIEW)

    expected = {}
    for body in halls.values():
        for row in body["souls_by_realm"]:
            slot = expected.setdefault(row["realm_code"], {**row, "count": 0})
            slot["count"] += row["count"]
            # capacity and held belong to the realm, not to the asking hall: every hall reports the same figure.
            assert (slot["held"], slot["capacity"]) == (row["held"], row["capacity"])
    assert {r["realm_code"]: r for r in whole["souls_by_realm"]} == expected
    assert [r["realm_code"] for r in whole["souls_by_realm"]] == sorted(expected)
    shared = expected["SHARED_R"]
    assert (shared["count"], shared["held"], shared["capacity"]) == (3, 1, 10), "two halls fill one realm"


def test_the_latest_ten_activity_rows_are_the_latest_ten_over_all_halls(world):
    whole, halls = _both(world, OVERVIEW)

    merged = sorted((r for body in halls.values() for r in body["recent_activity"]),
                    key=lambda r: r["timestamp"], reverse=True)[:10]
    assert [r["id"] for r in whole["recent_activity"]] == [r["id"] for r in merged]
    assert len(whole["recent_activity"]) == 10
    # More than ten rows exist and no single hall supplies all ten, so a per-hall cut would drop some.
    assert max(len(b["recent_activity"]) for b in halls.values()) < 15 and AuditLog.objects.count() == 15
    assert {r["description"].split()[0] for r in whole["recent_activity"]} == {"CN_DIYU", "EG_DUAT", "EU_HEAVEN_HELL"}


# ── trends ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("window", ["30d", "90d", "12m"])
def test_the_trend_points_are_the_halls_points_added_day_by_day(world, window):
    whole, halls = _both(world, f"{TRENDS}?range={window}")

    expected = {}
    for body in halls.values():
        assert (body["range"], body["since"], body["until"]) == (whole["range"], whole["since"], whole["until"])
        for point in body["points"]:
            slot = expected.setdefault(point["day"], {"day": point["day"], "soul_count": 0, "by_state": {},
                                                      "by_civilization": {}, "by_realm": {}})
            slot["soul_count"] += point["soul_count"]
            for field in ("by_state", "by_civilization", "by_realm"):
                for key, n in point[field].items():
                    slot[field][key] = slot[field].get(key, 0) + n
    assert whole["points"] == [expected[day] for day in sorted(expected)]
    assert len(whole["points"]) == 4  # days 0, 1, 2 and 3 back: the union of the halls' days
    assert halls["GR_HADES"]["points"] == []


# ── audit statistics ───────────────────────────────────────────────────────


def test_the_audit_statistics_are_the_halls_statistics_added(world):
    whole, halls = _both(world, AUDIT_STATS)

    assert whole["total_logs"] == sum(h["total_logs"] for h in halls.values()) == 15
    actions, resources = {}, {}
    for body in halls.values():
        for row in body["action_distribution"]:
            actions[row["action"]] = actions.get(row["action"], 0) + row["count"]
        for row in body["top_resources"]:
            resources[row["resource"]] = resources.get(row["resource"], 0) + row["count"]
    assert {r["action"]: r["count"] for r in whole["action_distribution"]} == actions
    assert {r["resource"]: r["count"] for r in whole["top_resources"]} == resources
    assert sum(actions.values()) == sum(resources.values()) == whole["total_logs"]
    # Both answers are ordered by count, descending.
    for rows in (whole["action_distribution"], whole["top_resources"]):
        assert [r["count"] for r in rows] == sorted((r["count"] for r in rows), reverse=True)


# ── what the halls cannot add up to ────────────────────────────────────────


def test_rows_that_belong_to_no_hall_are_in_the_global_answer_only(world):
    """`Soul.tenant` and `AuditLog.tenant` are nullable ("no hall" is a legal state). The global answer counts such
    rows; no hall's answer can. After a split they live in no tenant database at all, so this gap, pinned at
    exactly the orphans, is the thing a fan-out merge has to account for or consciously drop."""
    orphan = Soul.objects.create(name="无殿", tenant=plan.tenant("CN_DIYU"), merit_score=1,
                                 current_state=SoulState.ALIVE)
    Soul.all_objects.filter(pk=orphan.pk).update(tenant=None)  # create() refuses it; the column allows it
    AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="x")
    whole, halls = _both(world, OVERVIEW)
    audit, audit_halls = _both(world, AUDIT_STATS)

    assert whole["total_souls"] - sum(h["total_souls"] for h in halls.values()) == 1
    assert audit["total_logs"] - sum(h["total_logs"] for h in audit_halls.values()) == 1
    assert None in {row["tenant_code"] for row in whole["tenants"]}
