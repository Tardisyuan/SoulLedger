"""
Tests for Judgment API endpoints.
Tests judgment creation, conclusion, retrieval, and permission controls.
"""
import pytest
from django.utils import timezone

from apps.judgment.models import Judgment, JudgmentMethod, Verdict
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestJudgmentAPI:
    """Test Judgment API endpoints."""

    @pytest.fixture
    def eg_tenant(self, db):
        tenant, _ = Tenant.objects.get_or_create(
            code="EG_DUAT",
            defaults={"display_name": "Egyptian Duat"}
        )
        return tenant

    @pytest.fixture
    def eg_admin_user(self, eg_tenant, django_user_model):
        return django_user_model.objects.create_user(
            username="eg_admin",
            password="admin123",
            role="ADMIN",
            tenant=eg_tenant,
        )

    @pytest.fixture
    def soul(self, cn_tenant):
        return Soul.objects.create(
            name="测试灵魂",
            birth_date="1990-01-01",
            origin_location="北京",
            current_state=SoulState.ALIVE,
            tenant=cn_tenant,
        )

    @pytest.fixture
    def eg_soul(self, eg_tenant):
        return Soul.objects.create(
            name="Egyptian Soul",
            birth_date="1990-01-01",
            origin_location="Cairo",
            current_state=SoulState.ALIVE,
            tenant=eg_tenant,
        )

    @pytest.fixture
    def authenticated_client(self, api_client, admin_user):
        api_client.force_authenticate(user=admin_user)
        return api_client

    @pytest.fixture
    def eg_authenticated_client(self, api_client, eg_admin_user):
        api_client.force_authenticate(user=eg_admin_user)
        return api_client

    # -------------------------------------------------------------------------
    # POST /api/v1/judgment/ - Create judgment
    # -------------------------------------------------------------------------

    def test_create_judgment(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/ creates a new judgment."""
        data = {
            "soul": str(soul.id),
            "civilization": soul.civilization,
            "court": "第一殿",
            "confession": "Test confession",
            "notes": "Test notes",
        }
        response = authenticated_client.post("/api/v1/judgment/", data, format="json")

        assert response.status_code == 201
        assert response.data["court"] == "第一殿"
        assert str(response.data["soul"]) == str(soul.id)
        assert response.data["is_final"] is False
        assert response.data["verdict"] is None

    def test_create_judgment_transitions_soul_to_judging(self, authenticated_client, soul):
        """Creating a judgment transitions soul from ALIVE to JUDGING."""
        data = {
            "soul": str(soul.id),
            "civilization": soul.civilization,
            "court": "第一殿",
        }
        response = authenticated_client.post("/api/v1/judgment/", data, format="json")

        assert response.status_code == 201
        soul.refresh_from_db()
        assert soul.current_state == SoulState.JUDGING

    def test_create_judgment_with_judge(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/ with judge field associates judge."""
        data = {
            "soul": str(soul.id),
            "civilization": soul.civilization,
            "court": "第一殿",
            "judge": None,  # No judge for this test
        }
        response = authenticated_client.post("/api/v1/judgment/", data, format="json")

        assert response.status_code == 201
        assert response.data["court"] == "第一殿"

    def test_create_judgment_egyptian_heart_weighing(self, eg_authenticated_client, eg_soul):
        """POST /api/v1/judgment/ with HEART_WEIGHING method for Egyptian souls."""
        data = {
            "soul": str(eg_soul.id),
            "civilization": eg_soul.civilization,
            "court": "Hall of Two Truths",
            "judgment_method": JudgmentMethod.HEART_WEIGHING,
        }
        response = eg_authenticated_client.post("/api/v1/judgment/", data, format="json")

        assert response.status_code == 201
        # Serializer doesn't output judgment_method, but court should be set
        assert response.data["court"] == "Hall of Two Truths"

    # -------------------------------------------------------------------------
    # POST /api/v1/judgment/{id}/conclude/ - Conclude judgment
    # -------------------------------------------------------------------------

    def test_conclude_judgment_passed(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ with PASSED verdict."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.PASSED, "notes": "Excellent karma"}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 200
        judgment.refresh_from_db()
        assert judgment.is_final is True
        assert judgment.verdict == Verdict.PASSED
        assert judgment.notes == "Excellent karma"
        assert judgment.concluded_at is not None

    def test_conclude_judgment_failed(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ with FAILED verdict routes to hell."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.FAILED, "notes": "Murderer"}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 200
        judgment.refresh_from_db()
        assert judgment.is_final is True
        assert judgment.verdict == Verdict.FAILED
        # Disposition should be created
        assert hasattr(judgment, 'disposition')
        assert judgment.disposition is not None

    def test_conclude_judgment_purgatory(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ with PURGATORY verdict."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.PURGATORY, "notes": "Inconclusive"}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 200
        judgment.refresh_from_db()
        assert judgment.verdict == Verdict.PURGATORY

    def test_conclude_judgment_retry(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ with RETRY verdict."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.RETRY, "notes": "Request appeal"}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 200
        judgment.refresh_from_db()
        assert judgment.verdict == Verdict.RETRY

    def test_conclude_judgment_already_concluded(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ returns 400 if already final."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            is_final=True,
            verdict=Verdict.PASSED,
            concluded_at=timezone.now(),
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.FAILED, "notes": "Try to change"}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 400
        assert "already concluded" in str(response.data)

    def test_conclude_judgment_creates_workflow(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ with create_workflow=true creates workflow."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.PASSED, "notes": "Test", "create_workflow": True}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 200
        # Check workflow was created via related name
        workflow = getattr(judgment, 'approval_workflow', None)
        assert workflow is not None

    def test_conclude_invalid_verdict(self, authenticated_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ with invalid verdict returns 400."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": "INVALID_VERDICT"}

        response = authenticated_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )

        assert response.status_code == 400

    # -------------------------------------------------------------------------
    # GET /api/v1/judgment/{id}/ - Retrieve judgment
    # -------------------------------------------------------------------------

    def test_retrieve_judgment(self, authenticated_client, soul, cn_tenant):
        """GET /api/v1/judgment/{id}/ returns judgment details."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            verdict=Verdict.PASSED,
            is_final=True,
            concluded_at=timezone.now(),
            tenant=cn_tenant,
        )
        response = authenticated_client.get(f"/api/v1/judgment/{judgment.id}/")

        assert response.status_code == 200
        assert response.data["court"] == "第一殿"
        assert str(response.data["soul"]) == str(soul.id)
        assert response.data["verdict"] == Verdict.PASSED
        assert response.data["is_final"] is True

    def test_retrieve_judgment_with_soul_name(self, authenticated_client, soul, cn_tenant):
        """GET /api/v1/judgment/{id}/ includes soul_name in response."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        response = authenticated_client.get(f"/api/v1/judgment/{judgment.id}/")

        assert response.status_code == 200
        assert "soul_name" in response.data
        assert response.data["soul_name"] == soul.name

    def test_retrieve_nonexistent_judgment(self, authenticated_client):
        """GET /api/v1/judgment/{id}/ for nonexistent ID returns 404."""
        import uuid
        response = authenticated_client.get(f"/api/v1/judgment/{uuid.uuid4()}/")
        assert response.status_code == 404

    # -------------------------------------------------------------------------
    # Permission tests
    # -------------------------------------------------------------------------

    def test_unauthenticated_create_denied(self, api_client, soul):
        """POST /api/v1/judgment/ by unauthenticated user returns 401."""
        data = {"soul": str(soul.id), "civilization": soul.civilization, "court": "第一殿"}
        response = api_client.post("/api/v1/judgment/", data, format="json")
        assert response.status_code == 401

    def test_unauthenticated_retrieve_denied(self, api_client, soul, cn_tenant):
        """GET /api/v1/judgment/{id}/ by unauthenticated user returns 401."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        response = api_client.get(f"/api/v1/judgment/{judgment.id}/")
        assert response.status_code == 401

    def test_unauthenticated_conclude_denied(self, api_client, soul, cn_tenant):
        """POST /api/v1/judgment/{id}/conclude/ by unauthenticated user returns 401."""
        judgment = Judgment.objects.create(
            soul=soul,
            civilization=soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )
        data = {"verdict": Verdict.PASSED}
        response = api_client.post(
            f"/api/v1/judgment/{judgment.id}/conclude/",
            data,
            format="json"
        )
        assert response.status_code == 401

    # -------------------------------------------------------------------------
    # Tenant isolation tests
    # -------------------------------------------------------------------------

    def test_judgment_list_includes_all_for_admin(
        self, authenticated_client, cn_tenant, eg_tenant, django_user_model
    ):
        """GET /api/v1/judgment/ returns judgments from all tenants for ADMIN users."""
        # Create judgment for CN tenant
        cn_soul = Soul.objects.create(
            name="CN Soul",
            birth_date="1990-01-01",
            origin_location="Beijing",
            current_state=SoulState.ALIVE,
            tenant=cn_tenant,
        )
        Judgment.objects.create(
            soul=cn_soul,
            civilization=cn_soul.civilization,
            court="第一殿",
            tenant=cn_tenant,
        )

        # Create judgment for EG tenant
        eg_soul = Soul.objects.create(
            name="EG Soul",
            birth_date="1990-01-01",
            origin_location="Cairo",
            current_state=SoulState.ALIVE,
            tenant=eg_tenant,
        )
        Judgment.objects.create(
            soul=eg_soul,
            civilization=eg_soul.civilization,
            court="Hall of Two Truths",
            tenant=eg_tenant,
        )

        # Authenticated as CN admin (ADMIN role bypasses tenant filtering)
        response = authenticated_client.get("/api/v1/judgment/")

        assert response.status_code == 200
        results = response.data["results"] if "results" in response.data else response.data
        # ADMIN can see all judgments across tenants
        courts = {j["court"] for j in results}
        assert "第一殿" in courts
        assert "Hall of Two Truths" in courts
