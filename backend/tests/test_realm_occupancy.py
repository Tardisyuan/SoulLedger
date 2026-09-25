"""GET /api/v1/realms/occupancy/ — 在押:每个界域此刻的人数。

数的是未离开的行程站;离开过的站、别的租户的站、已删灵魂的站都不算。
"""
import datetime as dt

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
    assert api_client.get(URL).json() == [{"realm_id": str(hall.pk), "count": 1}]


@pytest.mark.django_db
def test_anonymous_is_refused(api_client):
    assert api_client.get(URL).status_code in (401, 403)
