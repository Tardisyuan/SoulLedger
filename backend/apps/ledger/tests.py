"""
Tests for ledger domain API views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.ledger.services import (
    INHERITANCE_DEMERIT,
    INHERITANCE_MERIT,
    LedgerService,
    RebirthNotApplicable,
)
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/ledger"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestLedgerBalanceView:
    """GET /ledger/balance/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KB_T1", defaults={"display_name": "Ledger Balance Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="kb_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Buddhist Monk",
            current_state=SoulState.JUDGING,
            merit_score=100,
            demerit_score=20,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_balance_returns_ledger_summary(self):
        resp = self.client.get(f"{BASE}/balance/{self.soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert resp.data["soul_name"] == "Buddhist Monk"
        assert "merit_score" in resp.data
        assert "demerit_score" in resp.data
        assert "karmic_balance" in resp.data

    def test_balance_404_for_nonexistent_soul(self):
        resp = self.client.get(f"{BASE}/balance/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
        assert resp.data["error"] == "NOT_FOUND"

    def test_balance_tenant_isolation(self):
        """Soul from tenant B should not be accessible by tenant A."""
        tenant_b = Tenant.objects.get_or_create(
            code="KB_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        foreign_soul = Soul.objects.create(
            name="Foreign Soul",
            current_state=SoulState.ALIVE,
            tenant=tenant_b,
        )
        resp = self.client.get(f"{BASE}/balance/{foreign_soul.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_balance_no_auth_returns_401(self):
        client = APIClient()
        resp = client.get(f"{BASE}/balance/{self.soul.id}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestLedgerRecalculateView:
    """POST /ledger/calculate/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KR_T1", defaults={"display_name": "Ledger Recalc Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="kr_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Recalc Soul",
            current_state=SoulState.JUDGING,
            merit_score=50,
            demerit_score=10,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_recalculate_returns_updated_scores(self):
        resp = self.client.post(f"{BASE}/calculate/{self.soul.id}/", format="json")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert "merit_score" in resp.data
        assert "demerit_score" in resp.data
        assert "karmic_balance" in resp.data

    def test_recalculate_404_for_nonexistent_soul(self):
        resp = self.client.post(f"{BASE}/calculate/{uuid.uuid4()}/", format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_recalculate_tenant_isolation(self):
        tenant_b = Tenant.objects.get_or_create(
            code="KR_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        foreign_soul = Soul.objects.create(
            name="Foreign Soul",
            current_state=SoulState.ALIVE,
            tenant=tenant_b,
        )
        resp = self.client.post(f"{BASE}/calculate/{foreign_soul.id}/", format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestLedgerEffectiveView:
    """GET /ledger/effective/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KE_T1", defaults={"display_name": "Ledger Effective Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="ke_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Effective Soul",
            current_state=SoulState.JUDGING,
            merit_score=80,
            demerit_score=30,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_effective_returns_effective_ledger(self):
        resp = self.client.get(f"{BASE}/effective/{self.soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert "effective_merit" in resp.data
        assert "effective_demerit" in resp.data
        assert "effective_balance" in resp.data

    def test_effective_404_for_nonexistent_soul(self):
        resp = self.client.get(f"{BASE}/effective/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestLedgerInheritanceView:
    """GET /ledger/inheritance/<soul_id>/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        # CN_DIYU, not an invented code: inheritance only means anything for a
        # cosmology that has a next life, and the tenant code is what says
        # which cosmology this is. An unrecognised code used to fall through
        # to CHINESE, so this fixture passed by accident — see
        # UNKNOWN_CIVILIZATION in apps/souls/models.py.
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        self.user = User.objects.create_user(
            username="ki_user", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.soul = Soul.objects.create(
            name="Inherit Soul",
            current_state=SoulState.REINCARNATING,
            merit_score=60,
            demerit_score=10,
            tenant=self.tenant,
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_inheritance_returns_inherited_ledger(self):
        resp = self.client.get(f"{BASE}/inheritance/{self.soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["soul_id"] == str(self.soul.id)
        assert "inherited_merit" in resp.data
        assert "inherited_demerit" in resp.data
        assert "inheritance_merit_rate" in resp.data
        assert "inheritance_demerit_rate" in resp.data
        # Absence, not just presence. The rates were added *to replace* a
        # rendered English sentence; a body carrying both would mean the
        # frontend could go on reading the sentence and the drift this pass
        # closed would still be open with a green test sitting next to it.
        assert "inheritance_note" not in resp.data

    def test_inheritance_404_for_nonexistent_soul(self):
        resp = self.client.get(f"{BASE}/inheritance/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestInheritanceMeritDemeritSplit:
    """Merit thins on the way through the gate; unripened demerit does not."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        # CN_DIYU for the same reason as TestLedgerInheritanceView above: a
        # merit/demerit carryover split is only defined where there is
        # something to carry into.
        self.tenant = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
        )[0]
        # Deeds dated in the soul's year of death, so decay is exactly 1.0 and
        # the only thing moving the numbers is the inheritance factor.
        self.soul = Soul.objects.create(
            name="Ledger Soul",
            current_state=SoulState.REINCARNATING,
            death_year=2000,
            tenant=self.tenant,
        )
        SoulRecord.objects.create(
            soul=self.soul, record_type="MERIT", civilization="CHINESE",
            description="Repaired the bridge", weight=100, event_year=2000,
        )
        SoulRecord.objects.create(
            soul=self.soul, record_type="DEMERIT", civilization="CHINESE",
            description="Burned the granary", weight=100, event_year=2000,
        )

    def test_merit_carries_at_twenty_percent_demerit_in_full(self):
        result = LedgerService.get_reincarnation_inheritance(self.soul)
        assert result["inherited_merit"] == 20
        # Not 20. A symmetric factor made dying an 80% amnesty; unripened
        # karma does not thin out on the way through the gate — the one place
        # the Buddhist word is the right one, and the reason demerit is the
        # one side of this ledger that does not net down.
        assert result["inherited_demerit"] == 100

    def test_the_rates_are_the_constants_and_no_prose_ships_with_them(self):
        """The response reports the split as numbers, and says nothing in words.

        This replaced a test that asserted "20%" and "100%" appeared inside an
        English `inheritance_note`. That note was rendered copy living in the
        service layer, and the frontend had *separately* hard-coded 20 and 100
        into SoulKarmaLedgerCard.tsx, so moving either constant desynced three
        places at once. Pinning identity against the constants — rather than a
        formatted string, or the literals 0.2/1.0 — means a change to the policy
        moves the wire value with it and cannot be half-applied.
        """
        result = LedgerService.get_reincarnation_inheritance(self.soul)
        assert result["inheritance_merit_rate"] == INHERITANCE_MERIT
        assert result["inheritance_demerit_rate"] == INHERITANCE_DEMERIT
        # The asymmetry is the point of the pair — equal rates would satisfy
        # both lines above while erasing what they exist to report.
        assert result["inheritance_merit_rate"] < result["inheritance_demerit_rate"]
        # And no sentence came back with them, in any key.
        assert "inheritance_note" not in result
        assert not any(isinstance(v, str) and " " in v for v in result.values()), (
            "the inheritance response is numbers and an id; a value with a "
            "space in it is prose that has crept back into the service layer"
        )


@pytest.mark.django_db
class TestInheritanceCivilizationGate:
    """Inheritance presupposes rebirth, and two of the four cosmologies
    here are terminal — Aaru/Ammit and Heaven/Hell/Purgatory."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenants = {
            civ: Tenant.objects.get_or_create(
                code=code, defaults={"display_name": code}
            )[0]
            for civ, code in (
                ("CHINESE", "CN_DIYU"),
                ("EUROPEAN", "EU_HEAVEN_HELL"),
                ("EGYPTIAN", "EG_DUAT"),
                ("GREEK", "GR_HADES"),
            )
        }

    def _client_and_soul(self, civ):
        tenant = self.tenants[civ]
        user = User.objects.create_user(
            username=f"kg_{civ.lower()}", password="test123", role="ADMIN", tenant=tenant
        )
        soul = Soul.objects.create(
            name=f"{civ} Soul",
            current_state=SoulState.REINCARNATING,
            tenant=tenant,
        )
        return _jwt_client(user, tenant), soul

    @pytest.mark.parametrize("civ", ["CHINESE", "GREEK"])
    def test_rebirth_capable_soul_still_gets_a_number(self, civ):
        """Both sides of REBIRTH_CAPABLE_CIVILIZATIONS, by name.

        GREEK joined that frozenset in f92ed35 (Republic X 617d-620d: the soul
        chooses a new life at the Spindle). It reaches this endpoint's 200 path,
        so it reaches the *new response shape* too, and the rates have to be on
        a Greek body for the same reason they are on a Chinese one — the card
        that draws them is not civilization-gated.
        """
        client, soul = self._client_and_soul(civ)
        resp = client.get(f"{BASE}/inheritance/{soul.id}/")
        assert resp.status_code == status.HTTP_200_OK
        assert "inherited_merit" in resp.data
        assert resp.data["inheritance_merit_rate"] == INHERITANCE_MERIT
        assert resp.data["inheritance_demerit_rate"] == INHERITANCE_DEMERIT
        assert "inheritance_note" not in resp.data

    @pytest.mark.parametrize("civ", ["EGYPTIAN", "EUROPEAN"])
    def test_terminal_cosmology_returns_409(self, civ):
        client, soul = self._client_and_soul(civ)
        resp = client.get(f"{BASE}/inheritance/{soul.id}/")
        # 409 rather than 404: the soul exists, the operation is what its
        # cosmology does not permit.
        assert resp.status_code == status.HTTP_409_CONFLICT
        assert resp.data["code"] == "REBIRTH_NOT_APPLICABLE"
        assert resp.data["civilization"] == civ
        assert resp.data["detail"]

    def test_gate_is_a_set_not_a_hardcoded_civilization(self):
        """Adding a rebirth-capable civilization must be a one-line change.

        It was, and GREEK is the line: Republic X 617d-620d has the soul choose
        a new life at the Spindle of Necessity. The membership is asserted as an
        exact set rather than by length, so that a cosmology gaining or losing a
        next life is visible here by name — a count would go green again the
        moment one was swapped for another.
        """
        from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
        assert isinstance(REBIRTH_CAPABLE_CIVILIZATIONS, frozenset)
        assert set(REBIRTH_CAPABLE_CIVILIZATIONS) == {"CHINESE", "GREEK"}

    def test_service_raises_rather_than_returning_a_number(self):
        _, soul = self._client_and_soul("EGYPTIAN")
        with pytest.raises(RebirthNotApplicable):
            LedgerService.get_reincarnation_inheritance(soul)


@pytest.mark.django_db
class TestLedgerOverviewStatsView:
    """GET /ledger/stats/overview/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KO_T1", defaults={"display_name": "Ledger Stats Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="ko_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="ko_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        # Create some souls for stats
        Soul.objects.create(name="S1", current_state=SoulState.ALIVE, merit_score=10, demerit_score=2, tenant=self.tenant)
        Soul.objects.create(name="S2", current_state=SoulState.JUDGING, merit_score=50, demerit_score=5, tenant=self.tenant)
        Soul.objects.create(name="S3", current_state=SoulState.DISPOSED, merit_score=5, demerit_score=80, tenant=self.tenant)
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)

    def test_admin_can_access_overview(self):
        resp = self.admin_client.get(f"{BASE}/stats/overview/")
        assert resp.status_code == status.HTTP_200_OK
        assert "total_souls" in resp.data
        assert "state_distribution" in resp.data
        assert "tenants" in resp.data
        assert "karma_distribution" in resp.data
        assert "recent_activity" in resp.data
        assert "souls_by_realm" in resp.data

    def test_overview_includes_soul_count(self):
        resp = self.admin_client.get(f"{BASE}/stats/overview/")
        assert resp.data["total_souls"] == 3

    def test_non_admin_gets_403(self):
        resp = self.viewer_client.get(f"{BASE}/stats/overview/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN
        assert resp.data["error"] == "FORBIDDEN"

    def test_overview_tenant_scoping(self):
        """Admin with tenant sees only their tenant's souls."""
        tenant_b = Tenant.objects.get_or_create(
            code="KO_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        Soul.objects.create(name="Foreign", current_state=SoulState.ALIVE, tenant=tenant_b)
        resp = self.admin_client.get(f"{BASE}/stats/overview/")
        # Should see 3 (own tenant), not 4 (total)
        assert resp.data["total_souls"] == 3


@pytest.mark.django_db
class TestLedgerExportStatsView:
    """GET /ledger/stats/export/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="KX_T1", defaults={"display_name": "Ledger Export Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="kx_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="kx_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        Soul.objects.create(
            name="Export Soul",
            current_state=SoulState.ALIVE,
            merit_score=15,
            demerit_score=3,
            tenant=self.tenant,
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)

    def test_admin_can_export_csv(self):
        resp = self.admin_client.get(f"{BASE}/stats/export/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp["Content-Type"] == "text/csv"
        assert "attachment" in resp["Content-Disposition"]
        content = resp.content.decode()
        assert "Soul ID" in content
        assert "Export Soul" in content

    def test_export_contains_csv_header(self):
        resp = self.admin_client.get(f"{BASE}/stats/export/")
        content = resp.content.decode()
        header = content.split("\n")[0]
        assert "Soul ID,Name,Civilization,State" in header

    def test_non_admin_gets_403(self):
        resp = self.viewer_client.get(f"{BASE}/stats/export/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_export_includes_soul_data(self):
        resp = self.admin_client.get(f"{BASE}/stats/export/")
        content = resp.content.decode()
        assert "15" in content  # merit_score
        assert "3" in content   # demerit_score
        assert "Export Soul" in content


@pytest.mark.django_db
class TestLedgerTenantIsolation:
    """Cross-tenant soul visibility across ledger endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="KA_T1", defaults={"display_name": "Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="KA_T2", defaults={"display_name": "Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="ka_user_a", password="test123", role="ADMIN", tenant=self.tenant_a
        )
        self.user_b = User.objects.create_user(
            username="ka_user_b", password="test123", role="ADMIN", tenant=self.tenant_b
        )
        self.soul_a = Soul.objects.create(
            name="Soul A",
            current_state=SoulState.ALIVE,
            merit_score=50,
            demerit_score=10,
            tenant=self.tenant_a,
        )
        self.soul_b = Soul.objects.create(
            name="Soul B",
            current_state=SoulState.JUDGING,
            merit_score=30,
            demerit_score=5,
            tenant=self.tenant_b,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def test_balance_tenant_isolation(self):
        """Tenant A cannot access Tenant B's soul."""
        resp = self.client_a.get(f"{BASE}/balance/{self.soul_b.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_balance_own_tenant_works(self):
        resp = self.client_a.get(f"{BASE}/balance/{self.soul_a.id}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_recalculate_tenant_isolation(self):
        resp = self.client_a.post(f"{BASE}/calculate/{self.soul_b.id}/", format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_effective_tenant_isolation(self):
        resp = self.client_a.get(f"{BASE}/effective/{self.soul_b.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_inheritance_tenant_isolation(self):
        resp = self.client_a.get(f"{BASE}/inheritance/{self.soul_b.id}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND
