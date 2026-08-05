"""
Tests for Reincarnation API endpoints.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.reincarnation.models import Reincarnation
from apps.souls.models import Soul, SoulState


def _auth(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.mark.django_db
class TestReincarnationAPI:
    """Test /api/v1/reincarnation/ endpoints."""

    def test_list_reincarnations(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/reincarnation/ returns reincarnations."""
        client = _auth(api_client, admin_user)
        soul = Soul.objects.create(name="RebornSoul", tenant=cn_tenant)
        Reincarnation.objects.create(
            soul=soul, tenant=cn_tenant,
            cycle_count=1, rebirth_form="HUMAN",
        )
        response = client.get("/api/v1/reincarnation/")
        assert response.status_code == 200

    def test_list_reincarnations_unauthenticated(self, api_client):
        """GET /api/v1/reincarnation/ without auth returns 401."""
        response = api_client.get("/api/v1/reincarnation/")
        assert response.status_code == 401

    def test_reincarnation_select_related(self, api_client, admin_user, cn_tenant):
        """Reincarnation endpoint uses select_related."""
        client = _auth(api_client, admin_user)
        soul = Soul.objects.create(name="SRSoul", tenant=cn_tenant)
        Reincarnation.objects.create(
            soul=soul, tenant=cn_tenant,
            cycle_count=1, rebirth_form="ANIMAL",
        )
        response = client.get("/api/v1/reincarnation/")
        assert response.status_code == 200
        results = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        assert len(results) >= 1


@pytest.mark.django_db
class TestRebirthEndpointsRespectTheStateMachine:
    """/complete/ and /reborn/ used to write DISPOSED → REINCARNATING directly.

    Both assigned current_state and called save(), never asking
    Soul.can_transition_to. For a terminal cosmology that produced the exact
    stranding SoulState.SETTLED exists to prevent: the soul was written to
    REINCARNATING, complete_rebirth then raised RebirthNotApplicable, and
    REINCARNATING's only legal exit is the rebirth that will keep being
    refused. Nothing could move the soul afterwards.
    """

    def test_reborn_refuses_a_terminal_cosmology_without_writing_the_state(
        self, api_client, admin_user, eu_tenant
    ):
        soul = Soul.objects.create(
            name="Dante's Pilgrim", current_state=SoulState.DISPOSED, tenant=eu_tenant,
        )
        client = _auth(api_client, admin_user)  # ADMIN bypasses tenant filtering

        response = client.post(
            "/api/v1/reincarnation/reborn/", {"soul_id": str(soul.id)}, format="json"
        )

        assert response.status_code == 409
        # The specific fact, not a generic state-machine refusal: the operator
        # needs to know this cosmology has no next life, not that some
        # transition was disallowed.
        assert response.data["code"] == "REBIRTH_NOT_APPLICABLE"
        assert response.data["civilization"] == "EUROPEAN"
        assert "no next life" in response.data["detail"]

        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED
        assert Reincarnation.objects.filter(soul=soul).count() == 0

    def test_complete_refuses_a_terminal_cosmology_without_writing_the_state(
        self, api_client, eu_admin_user, eu_tenant
    ):
        soul = Soul.objects.create(
            name="Purgatorio Soul", current_state=SoulState.DISPOSED, tenant=eu_tenant,
        )
        reincarnation = Reincarnation.objects.create(
            soul=soul, tenant=eu_tenant, cycle_count=1, rebirth_form="HUMAN",
        )
        client = _auth(api_client, eu_admin_user)

        response = client.post(
            f"/api/v1/reincarnation/{reincarnation.id}/complete/", {}, format="json"
        )

        assert response.status_code == 409
        assert response.data["code"] == "REBIRTH_NOT_APPLICABLE"
        assert response.data["civilization"] == "EUROPEAN"

        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED

    def test_reborn_refuses_a_settled_soul_and_says_so_as_a_state_conflict(
        self, api_client, admin_user, cn_tenant
    ):
        """SETTLED is absorbing. A rebirth-capable cosmology gets past the
        cosmology gate, so this is the state machine's own refusal — and it
        reads differently from the terminal-cosmology one on purpose."""
        soul = Soul.objects.create(
            name="Closed Case", current_state=SoulState.SETTLED, tenant=cn_tenant,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            "/api/v1/reincarnation/reborn/", {"soul_id": str(soul.id)}, format="json"
        )

        assert response.status_code == 409
        assert response.data["error"] == "INVALID_STATE_TRANSITION"
        assert response.data["current_state"] == SoulState.SETTLED
        assert response.data["target_state"] == SoulState.REINCARNATING
        # No "code"/"civilization" — that shape belongs to the cosmology
        # refusal, and the two must not be confusable.
        assert "code" not in response.data

        soul.refresh_from_db()
        assert soul.current_state == SoulState.SETTLED
        assert Reincarnation.objects.filter(soul=soul).count() == 0

    def test_reborn_still_completes_a_disposed_chinese_soul(
        self, api_client, admin_user, cn_tenant
    ):
        """The legal transition is unchanged — it just goes through the state
        machine now instead of around it."""
        soul = Soul.objects.create(
            name="Diyu Soul", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            "/api/v1/reincarnation/reborn/",
            {"soul_id": str(soul.id), "new_identity": "Next Life"},
            format="json",
        )

        assert response.status_code == 201
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE
        assert Reincarnation.objects.filter(soul=soul).count() == 1
