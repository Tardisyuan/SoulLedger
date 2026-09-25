"""`POST /disposition/` with a destination realm writes the soul's path (产品负责人 2026-09-25).

Like `create_from_judgment`: the open station is closed and the realm opened, in
the create's own transaction. A disposition filed under an AMENDMENT or REOPEN
judgment does not move the soul, and neither does one with no realm.
"""
import pytest
from django.utils import timezone

from apps.judgment.models import Judgment, JudgmentKind
from apps.realms.models import Realm, SoulPathEntry
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

URL = "/api/v1/disposition/"


def _realm(code, tenant):
    return Realm.objects.create(
        realm_code=code, civilization="CHINESE", name_local=code, name_zh=code, realm_type="HELL", tenant=tenant,
    )


@pytest.fixture
def judge(django_user_model, cn_tenant):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    for codename in ("disposition.read", "disposition.execute"):
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "disposition"})
        RolePermission.objects.get_or_create(role=role, permission=permission)
    user = django_user_model.objects.create_user(username="manual_judge", password="x", role="JUDGE",
                                                 tenant=cn_tenant)
    return officer_client(user)


@pytest.fixture
def at_court(cn_tenant):
    """A disposed soul still standing in the court it was judged in."""
    court = _realm("DY_COURT_05_YANLUO", cn_tenant)
    soul = Soul.objects.create(name="手判之魂", tenant=cn_tenant, current_state=SoulState.DISPOSED)
    SoulPathEntry.all_objects.create(soul=soul, realm=court, sequence=1, entered_at=timezone.now(),
                                     tenant=cn_tenant)
    return soul, court


def _path(soul):
    return list(SoulPathEntry.all_objects.filter(soul=soul).order_by("sequence"))


def test_a_manual_disposition_moves_the_soul_to_its_realm(judge, cn_tenant, at_court):
    soul, court = at_court
    hell = _realm("DY_COURT_09_PINGDENG", cn_tenant)
    response = judge.post(URL, {"soul": str(soul.pk), "destination_realm": str(hell.pk)}, format="json")
    assert response.status_code == 201, response.data
    first, second = _path(soul)
    assert first.realm_id == court.pk and first.left_at is not None
    assert (second.realm_id, second.sequence, second.left_at, second.tenant_id) == (hell.pk, 2, None, cn_tenant.pk)
    assert first.left_at == second.entered_at


def test_no_realm_writes_nothing(judge, at_court):
    soul, _ = at_court
    response = judge.post(URL, {"soul": str(soul.pk)}, format="json")
    assert response.status_code == 201, response.data
    (only,) = _path(soul)
    assert only.left_at is None


@pytest.mark.parametrize("kind", [JudgmentKind.AMENDMENT, JudgmentKind.REOPEN])
def test_an_amendment_or_reopen_disposition_does_not_move_the_soul(judge, cn_tenant, at_court, kind):
    soul, _ = at_court
    hell = _realm("DY_COURT_09_PINGDENG", cn_tenant)
    judgment = Judgment.objects.create(soul=soul, civilization="CHINESE", tenant=cn_tenant, kind=kind)
    response = judge.post(
        URL, {"soul": str(soul.pk), "destination_realm": str(hell.pk), "judgment": str(judgment.pk)}, format="json",
    )
    assert response.status_code == 201, response.data
    (only,) = _path(soul)
    assert only.left_at is None
    assert not SoulPathEntry.all_objects.filter(soul=soul, realm=hell).exists()
