"""
Tests for souls app - Soul CRUD + state transitions + records.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.souls.models import (
    UNKNOWN_CIVILIZATION,
    Civilization,
    Soul,
    SoulState,
)
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/souls"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestSoulCRUD:
    """Soul list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T1", defaults={"display_name": "Soul Test Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="soul_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(
            name="Test Soul", tenant=self.tenant, current_state=SoulState.ALIVE
        )

    def test_list_souls(self):
        resp = self.admin_client.get(f"{BASE}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_souls_unauthenticated(self):
        resp = APIClient().get(f"{BASE}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_soul(self):
        resp = self.admin_client.post(f"{BASE}/", {
            "name": "New Soul", "birth_date": "2000-01-01"
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["name"] == "New Soul"

    def test_retrieve_soul(self):
        resp = self.admin_client.get(f"{BASE}/{self.soul.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["name"] == "Test Soul"

    def test_update_soul(self):
        resp = self.admin_client.patch(f"{BASE}/{self.soul.pk}/", {
            "name": "Updated Soul"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        self.soul.refresh_from_db()
        assert self.soul.name == "Updated Soul"

    def test_delete_soul(self):
        resp = self.admin_client.delete(f"{BASE}/{self.soul.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        self.soul.refresh_from_db()
        assert self.soul.is_deleted

    def test_soul_not_found(self):
        resp = self.admin_client.get(f"{BASE}/00000000-0000-0000-0000-000000000000/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestSoulDieAction:
    """Soul die action - marks soul dead and begins judgment."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T2", defaults={"display_name": "Soul Die Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="die_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def test_die_alive_soul(self):
        soul = Soul.objects.create(name="Die Soul", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/die/", {
            "location": "Underworld", "death_date": "2024-01-01"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

    def test_die_already_dead(self):
        soul = Soul.objects.create(name="Dead Soul", tenant=self.tenant, current_state=SoulState.JUDGING)
        resp = self.client.post(f"{BASE}/{soul.pk}/die/", format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestSoulTransitionAction:
    """Soul transition action - manual state transitions."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T3", defaults={"display_name": "Soul Trans Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="trans_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def test_transition_alive_to_judging(self):
        soul = Soul.objects.create(name="Trans Soul", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/transition/", {
            "new_state": SoulState.JUDGING, "reason": "Death recorded"
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

    def test_transition_invalid(self):
        soul = Soul.objects.create(name="Bad Trans", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/transition/", {
            "new_state": SoulState.DISPOSED, "reason": "Skip"
        }, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_transition_judging_to_disposed(self):
        soul = Soul.objects.create(name="J2D", tenant=self.tenant, current_state=SoulState.JUDGING)
        resp = self.client.post(f"{BASE}/{soul.pk}/transition/", {
            "new_state": SoulState.DISPOSED
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED


@pytest.mark.django_db
class TestSoulRecordsAction:
    """Soul add_record and records actions."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T4", defaults={"display_name": "Soul Records Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="rec_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)
        self.soul = Soul.objects.create(name="Record Soul", tenant=self.tenant)

    def test_add_record(self):
        resp = self.client.post(f"{BASE}/{self.soul.pk}/add_record/", {
            "record_type": "MERIT",
            "civilization": "CHINESE",
            "description": "Helped an old lady",
            "weight": 5,
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert SoulRecord.objects.filter(soul=self.soul).count() == 1

    def test_list_records_empty(self):
        resp = self.client.get(f"{BASE}/{self.soul.pk}/records/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data == []

    def test_list_records_with_data(self):
        SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT",
            civilization="CHINESE", description="Good deed", weight=3
        )
        resp = self.client.get(f"{BASE}/{self.soul.pk}/records/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1

    def test_records_soul_not_found(self):
        resp = self.client.get(f"{BASE}/00000000-0000-0000-0000-000000000000/records/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestSoulHistoricalDates:
    """BC-capable birth_date/death_date/event_date — see apps.souls.dates."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T5", defaults={"display_name": "Soul BC Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="bc_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.client = _jwt_client(self.admin, self.tenant)

    def test_create_soul_with_bce_birth_year(self):
        """A structured {"year": -612} input records 612 BCE."""
        resp = self.client.post(f"{BASE}/", {
            "name": "Ancient Egyptian Soul", "birth_date": {"year": -612},
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["birth_date"] == {"year": -612, "month": None, "day": None}
        soul = Soul.objects.get(pk=resp.data["id"])
        assert soul.birth_year == -612
        assert soul.birth_month is None
        # Legacy DateField-shaped accessor can't represent BCE — must not
        # silently pretend it's some CE date.
        assert soul.birth_date is None

    def test_create_soul_with_full_bce_date(self):
        resp = self.client.post(f"{BASE}/", {
            "name": "Egyptian Pharaoh", "birth_date": {"year": -612, "month": 3, "day": 15},
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["birth_date"] == {"year": -612, "month": 3, "day": 15}

    def test_legacy_string_date_still_accepted(self):
        """Existing clients posting a plain "YYYY-MM-DD" string keep working."""
        resp = self.client.post(f"{BASE}/", {
            "name": "Modern Soul", "birth_date": "1990-01-15",
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["birth_date"] == {"year": 1990, "month": 1, "day": 15}

    def test_year_zero_rejected(self):
        resp = self.client.post(f"{BASE}/", {
            "name": "Invalid Soul", "birth_date": {"year": 0},
        }, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_die_action_accepts_bce_death_date(self):
        soul = Soul.objects.create(name="Dying Ancient", tenant=self.tenant, current_state=SoulState.ALIVE)
        resp = self.client.post(f"{BASE}/{soul.pk}/die/", {
            "death_date": {"year": -30},  # death of Cleopatra, roughly
        }, format="json")
        assert resp.status_code == status.HTTP_200_OK
        soul.refresh_from_db()
        assert soul.death_year == -30

    def test_add_record_with_bce_event_date(self):
        soul = Soul.objects.create(name="Record Soul BCE", tenant=self.tenant)
        resp = self.client.post(f"{BASE}/{soul.pk}/add_record/", {
            "record_type": "MERIT",
            "civilization": "EGYPTIAN",
            "description": "Built a temple",
            "weight": 10,
            "event_date": {"year": -1200},
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["event_date"] == {"year": -1200, "month": None, "day": None}
        record = SoulRecord.objects.get(pk=resp.data["id"])
        assert record.event_year == -1200
        assert record.event_date is None  # legacy accessor: can't express BCE

    def test_soul_created_via_orm_with_legacy_birth_date_kwarg(self):
        """Soul.objects.create(birth_date=...) (as used throughout the test
        suite) keeps working via the birth_date property setter."""
        soul = Soul.objects.create(name="ORM Soul", tenant=self.tenant, birth_date="1985-06-15")
        assert soul.birth_year == 1985
        assert soul.birth_month == 6
        assert soul.birth_day == 15
        assert soul.birth_date is not None


@pytest.mark.django_db
class TestSettledIsTerminal:
    """SETTLED is where souls whose cosmology has no next life stop.

    See SoulState.SETTLED and Soul.can_transition_to for why nothing — not
    even LOST — leads out of it.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="SOUL_T6", defaults={"display_name": "Soul Settled Tenant"}
        )[0]

    def _soul(self, state):
        return Soul.objects.create(name=f"{state} Soul", tenant=self.tenant, current_state=state)

    def test_disposed_can_settle(self):
        assert self._soul(SoulState.DISPOSED).can_transition_to(SoulState.SETTLED)

    def test_disposed_keeps_its_other_two_exits(self):
        soul = self._soul(SoulState.DISPOSED)
        assert soul.can_transition_to(SoulState.REINCARNATING)
        assert soul.can_transition_to(SoulState.LOST)

    def test_nothing_leaves_settled(self):
        soul = self._soul(SoulState.SETTLED)
        for state in SoulState.values:
            assert not soul.can_transition_to(state), state

    def test_settled_is_not_reachable_from_anywhere_but_disposed(self):
        for state in SoulState.values:
            if state == SoulState.DISPOSED:
                continue
            assert not self._soul(state).can_transition_to(SoulState.SETTLED), state

    def test_transition_to_refuses_to_move_a_settled_soul(self):
        """Guarding can_transition_to is not enough on its own — the write
        path has to refuse too, because ReincarnationService.execute still
        asks every disposed soul to become REINCARNATING."""
        soul = self._soul(SoulState.SETTLED)
        assert soul.transition_to(SoulState.REINCARNATING, "should not happen") is False
        soul.refresh_from_db()
        assert soul.current_state == SoulState.SETTLED


@pytest.mark.django_db
class TestCivilizationGateDoesNotFailOpen:
    """An unrecognised tenant code must not resolve to a cosmology.

    It used to resolve to CHINESE — the default argument of a dict lookup,
    not a decision — and CHINESE is the one rebirth-capable cosmology
    modelled here, so *unknown* silently meant *reborn*.
    """

    KNOWN = {
        "CN_DIYU": Civilization.CHINESE,
        "EU_HEAVEN_HELL": Civilization.EUROPEAN,
        "EG_DUAT": Civilization.EGYPTIAN,
    }

    def _soul_in(self, code):
        tenant = Tenant.objects.get_or_create(
            code=code, defaults={"display_name": code}
        )[0]
        return Soul.objects.create(name=f"{code} Soul", tenant=tenant)

    @pytest.mark.parametrize("code,expected", list(KNOWN.items()))
    def test_configured_tenant_codes_still_map(self, db, code, expected):
        assert self._soul_in(code).civilization == expected

    def test_unrecognised_tenant_code_is_unknown_not_chinese(self, db):
        soul = self._soul_in("GR_HADES_NOT_WIRED_UP_YET")
        assert soul.civilization == UNKNOWN_CIVILIZATION
        assert soul.civilization != Civilization.CHINESE

    def test_unknown_is_not_one_of_the_civilization_choices(self, db):
        """"Unknown" is the absence of an answer, not a fourth afterlife. If it
        ever becomes a Civilization member it will appear in every dropdown
        and chart legend built from Civilization.choices."""
        assert UNKNOWN_CIVILIZATION not in Civilization.values

    def test_unknown_civilization_is_not_rebirth_capable(self, db):
        """The point of the whole fix. A soul whose cosmology nobody has
        configured must not be handed a next life on the strength of a typo."""
        from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS

        assert self._soul_in("MISCONFIGURED").civilization not in REBIRTH_CAPABLE_CIVILIZATIONS

    def test_tenantless_soul_is_unknown_too(self, db):
        """Soul.save() refuses to create one, but legacy rows exist and the
        property must not invent a cosmology for them either."""
        soul = self._soul_in("CN_DIYU")
        soul.tenant = None
        assert soul.civilization == UNKNOWN_CIVILIZATION
