"""GET /api/v1/realms/occupancy/ — 在押:每个界域此刻的人数。

数的是未离开的行程站;离开过的站、别的租户的站、已删灵魂的站都不算。
另有今日进 / 出(殿的时区)与在押者的平均停留天数,定义见 `RealmViewSet.occupancy`。
"""
import datetime as dt
from unittest import mock

import pytest

from apps.realms.models import SoulPathEntry
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as plan

URL = "/api/v1/realms/occupancy/"
T0 = dt.datetime(2026, 6, 1, tzinfo=dt.UTC)


def _stop(soul, realm, seq, *, left=False, tenant=None):
    return SoulPathEntry.all_objects.create(
        soul=soul, realm=realm, sequence=seq, entered_at=T0 + dt.timedelta(days=seq),
        left_at=T0 + dt.timedelta(days=seq + 1) if left else None,
        tenant=tenant or soul.tenant,
    )


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]}
        )
        RolePermission.objects.get_or_create(role=role, permission=permission)


def _login(client, user, *codenames):
    """A real caller: role grants in the DB and a `tenant_code` claim — the
    shape tests/test_judgment_evidence_and_draft.py uses. `force_authenticate`
    sets no tenant, which would test the fail-closed branch instead."""
    from rest_framework_simplejwt.tokens import RefreshToken

    _grant(user.role, *codenames)
    token = RefreshToken.for_user(user)
    if user.tenant_id:  # the hall-less ADMIN carries no hall
        token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_counts_open_stops_only_in_the_callers_tenant(api_client, judge_user):
    cn = plan.tenant("CN_DIYU")
    eg = plan.tenant("EG_DUAT")
    court = plan.realm("OCC_COURT", "CHINESE")
    gate = plan.realm("OCC_GATE", "CHINESE")
    a = Soul.objects.create(name="甲", tenant=cn, current_state=SoulState.JUDGING)
    b = Soul.objects.create(name="乙", tenant=cn, current_state=SoulState.JUDGING)
    gone = Soul.objects.create(name="删", tenant=cn, current_state=SoulState.JUDGING)
    away = Soul.objects.create(name="外", tenant=eg, current_state=SoulState.JUDGING)
    _stop(a, court, 1, left=True)
    _stop(a, gate, 2)
    _stop(b, court, 1)
    _stop(gone, court, 1)
    Soul.all_objects.filter(pk=gone.pk).update(is_deleted=True)
    _stop(away, court, 1)

    _login(api_client, judge_user, "realms.read")
    response = api_client.get(URL)
    assert response.status_code == 200
    got = {row["realm_id"]: row["count"] for row in response.json()}
    assert got == {str(court.pk): 1, str(gate.pk): 1}


@pytest.mark.django_db
def test_admin_sees_every_tenant(api_client, admin_user):
    eg = plan.tenant("EG_DUAT")
    hall = plan.realm("OCC_HALL", "EGYPTIAN")
    soul = Soul.objects.create(name="外", tenant=eg, current_state=SoulState.JUDGING)
    _stop(soul, hall, 1)
    _login(api_client, admin_user, "realms.read")
    [row] = api_client.get(URL).json()
    assert (row["realm_id"], row["count"], row["left_today"]) == (str(hall.pk), 1, 0)


@pytest.mark.django_db
def test_anonymous_is_refused(api_client):
    assert api_client.get(URL).status_code in (401, 403)


# 殿在上海:此刻是上海 6 月 10 日 01:00 = UTC 6 月 9 日 17:00。UTC 的「今天」与殿的「今天」在这里不同。
NOW = dt.datetime(2026, 6, 9, 17, 0, tzinfo=dt.UTC)
HALL_MIDNIGHT = dt.datetime(2026, 6, 9, 16, 0, tzinfo=dt.UTC)


def _entry(soul, realm, seq, entered, left=None, tenant=None):
    return SoulPathEntry.all_objects.create(
        soul=soul, realm=realm, sequence=seq, entered_at=entered, left_at=left, tenant=tenant or soul.tenant,
    )


@pytest.mark.django_db
def test_today_counts_use_the_hall_timezone_and_average_stay_is_over_souls_held_now(api_client, judge_user):
    cn = judge_user.tenant
    cn.settings = {**(cn.settings or {}), "timezone": "Asia/Shanghai"}
    cn.save(update_fields=["settings"])
    eg = plan.tenant("EG_DUAT")
    court = plan.realm("OCC_FLOW_COURT", "CHINESE")
    gate = plan.realm("OCC_FLOW_GATE", "CHINESE")
    a = Soul.objects.create(name="甲", tenant=cn, current_state=SoulState.JUDGING)
    b = Soul.objects.create(name="乙", tenant=cn, current_state=SoulState.JUDGING)
    c = Soul.objects.create(name="丙", tenant=cn, current_state=SoulState.JUDGING)
    away = Soul.objects.create(name="外", tenant=eg, current_state=SoulState.JUDGING)
    # 甲:昨天(殿的时区 23:00,UTC 已是「今天」)进 court,殿的今天 00:30 离开去 gate。
    _entry(a, court, 1, HALL_MIDNIGHT - dt.timedelta(hours=1), left=HALL_MIDNIGHT + dt.timedelta(minutes=30))
    _entry(a, gate, 2, HALL_MIDNIGHT + dt.timedelta(minutes=30))
    # 乙:四天前进 court,还在。丙:两天前进 court,还在 —— court 在押 2,平均 (4 + 2) / 2 = 3 天。
    _entry(b, court, 1, NOW - dt.timedelta(days=4))
    _entry(c, court, 1, NOW - dt.timedelta(days=2))
    # 别的租户今天进 court:不算。
    _entry(away, court, 1, NOW - dt.timedelta(minutes=5))

    _login(api_client, judge_user, "realms.read")
    with mock.patch("apps.realms.views.timezone", mock.Mock(now=lambda: NOW)):  # 只换这个视图的「此刻」
        response = api_client.get(URL)
    assert response.status_code == 200
    got = {row["realm_id"]: row for row in response.json()}
    assert set(got) == {str(court.pk), str(gate.pk)}
    assert got[str(court.pk)] == {
        "realm_id": str(court.pk), "count": 2, "arrived_today": 0, "left_today": 1, "avg_stay_days": 3.0,
    }
    assert got[str(gate.pk)]["count"] == 1
    assert got[str(gate.pk)]["arrived_today"] == 1
    assert got[str(gate.pk)]["left_today"] == 0
    assert got[str(gate.pk)]["avg_stay_days"] == 0.0


@pytest.mark.django_db
def test_a_realm_everyone_left_today_still_reports_its_flow(api_client, judge_user):
    court = plan.realm("OCC_EMPTIED", "CHINESE")
    a = Soul.objects.create(name="甲", tenant=judge_user.tenant, current_state=SoulState.JUDGING)
    now = dt.datetime.now(dt.UTC)
    _entry(a, court, 1, now - dt.timedelta(days=30), left=now)
    _login(api_client, judge_user, "realms.read")
    [row] = api_client.get(URL).json()
    assert row == {"realm_id": str(court.pk), "count": 0, "arrived_today": 0, "left_today": 1, "avg_stay_days": None}
