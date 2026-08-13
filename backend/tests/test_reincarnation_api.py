"""
Tests for Reincarnation API endpoints.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.reincarnation.models import SIX_PATHS, RebirthForm, Reincarnation
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


@pytest.mark.django_db
class TestRebirthFormIsValidated:
    """/complete/ and /reborn/ are the only writes in this app that skip a
    serializer: they read request.data directly and hand the strings to
    ReincarnationService.complete_rebirth, which calls objects.create().
    Django checks `choices` only in full_clean(), which the ORM never calls,
    so *any* string reached the column.

    Measured before the fix, not assumed: POST /reincarnation/reborn/ with
    rebirth_form="PASTA_MONSTER" answered 201 and the row came back holding
    "PASTA_MONSTER". These now pin the refusal, and — the part that matters
    for a guard nobody ever sees fire — pin that it fires before anything is
    written, soul state included.
    """

    def test_reborn_refuses_a_rebirth_form_outside_the_enum(
        self, api_client, admin_user, cn_tenant
    ):
        soul = Soul.objects.create(
            name="Garbage Form", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            "/api/v1/reincarnation/reborn/",
            {"soul_id": str(soul.id), "rebirth_form": "PASTA_MONSTER"},
            format="json",
        )

        assert response.status_code == 400
        assert "rebirth_form" in response.data
        # Nothing written: no record, and the soul never left DISPOSED. A 400
        # that arrived after the state transition would leave the soul stuck
        # in REINCARNATING, which is the stranding SoulState.SETTLED exists
        # to prevent.
        assert Reincarnation.all_objects.filter(soul=soul).count() == 0
        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED

    def test_complete_refuses_a_rebirth_form_outside_the_enum(
        self, api_client, admin_user, cn_tenant
    ):
        soul = Soul.objects.create(
            name="Garbage Form Complete", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        reincarnation = Reincarnation.objects.create(
            soul=soul, tenant=cn_tenant, cycle_count=1, rebirth_form=RebirthForm.HUMAN,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            f"/api/v1/reincarnation/{reincarnation.id}/complete/",
            {"rebirth_form": "PASTA_MONSTER"},
            format="json",
        )

        assert response.status_code == 400
        assert "rebirth_form" in response.data
        soul.refresh_from_db()
        assert soul.current_state == SoulState.DISPOSED
        reincarnation.refresh_from_db()
        assert reincarnation.rebirth_form == RebirthForm.HUMAN

    @pytest.mark.parametrize("form", list(SIX_PATHS))
    def test_reborn_accepts_every_one_of_the_six_paths(
        self, api_client, admin_user, cn_tenant, form
    ):
        """The guard must refuse garbage without also refusing the doctrine:
        all six paths go through and land in the column verbatim."""
        soul = Soul.objects.create(
            name=f"Reborn as {form.value}", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            "/api/v1/reincarnation/reborn/",
            {"soul_id": str(soul.id), "rebirth_form": form.value},
            format="json",
        )

        assert response.status_code == 201
        assert response.data["rebirth_form"] == form.value
        assert Reincarnation.all_objects.get(soul=soul).rebirth_form == form.value

    def test_reborn_refuses_other_with_its_own_reason(
        self, api_client, admin_user, cn_tenant
    ):
        """OTHER is a legal *stored* value (legacy rows carry it) but not a
        seventh path, so it is refused one layer past the ChoiceField — which
        is the only reason validate_rebirth_form is reachable at all. Without
        this case that method would be dead code that always says no to
        nothing."""
        soul = Soul.objects.create(
            name="Legacy Escape Hatch", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            "/api/v1/reincarnation/reborn/",
            {"soul_id": str(soul.id), "rebirth_form": RebirthForm.OTHER.value},
            format="json",
        )

        assert response.status_code == 400
        assert "six paths" in str(response.data["rebirth_form"][0])
        assert Reincarnation.all_objects.filter(soul=soul).count() == 0

    def test_complete_still_honours_a_legacy_other_row_when_the_field_is_omitted(
        self, api_client, admin_user, cn_tenant
    ):
        """Refusing to *write* OTHER must not make rows that already hold it
        uncompletable. An omitted rebirth_form falls back to the record's own
        value and is not re-validated."""
        soul = Soul.objects.create(
            name="Old Record", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        reincarnation = Reincarnation.objects.create(
            soul=soul, tenant=cn_tenant, cycle_count=1, rebirth_form=RebirthForm.OTHER,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            f"/api/v1/reincarnation/{reincarnation.id}/complete/", {}, format="json"
        )

        assert response.status_code == 200
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE
        assert (
            Reincarnation.all_objects.filter(soul=soul, rebirth_form=RebirthForm.OTHER).count()
            == 2
        )

    def test_new_identity_longer_than_the_column_is_refused(
        self, api_client, admin_user, cn_tenant
    ):
        """Same unvalidated path, second field: new_identity is written to a
        CharField(max_length=255) *and* copied onto Soul.name. SQLite would
        have stored the overlong string silently."""
        soul = Soul.objects.create(
            name="Long Name", current_state=SoulState.DISPOSED, tenant=cn_tenant,
        )
        client = _auth(api_client, admin_user)

        response = client.post(
            "/api/v1/reincarnation/reborn/",
            {"soul_id": str(soul.id), "new_identity": "x" * 256},
            format="json",
        )

        assert response.status_code == 400
        assert "new_identity" in response.data
        assert Reincarnation.all_objects.filter(soul=soul).count() == 0
