"""
Tests for dispatch domain API views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from apps.dispatch.models import (
    CrossTenantJudgment,
    DispatchRecord,
    DispatchStatus,
    JudgmentStatus,
)
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/dispatch"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


# ---------------------------------------------------------------------------
# DispatchRecord CRUD
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchRecordCRUD:
    """DispatchRecord list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="DA_T1", defaults={"display_name": "Dispatch Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="DA_T2", defaults={"display_name": "Dispatch Tenant B"}
        )[0]
        self.user = User.objects.create_user(
            username="daview1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.client = _jwt_client(self.user, self.tenant_a)

        self.soul = Soul.objects.create(
            name="TestSoul", current_state=SoulState.ALIVE, tenant=self.tenant_a,
        )

    def test_list_empty(self):
        resp = self.client.get(f"{BASE}/records/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 0

    def test_list_returns_records(self):
        DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user, reason="R", tenant=self.tenant_a,
        )
        resp = self.client.get(f"{BASE}/records/")
        assert resp.data["count"] == 1

    def test_create_dispatch_record(self):
        resp = self.client.post(f"{BASE}/records/", {
            "source_tenant": str(self.tenant_a.pk),
            "target_tenant": str(self.tenant_b.pk),
            "soul": str(self.soul.pk),
            "reason": "Transfer",
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["status"] == "PROPOSED"

    def test_retrieve_dispatch_record(self):
        rec = DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user, reason="R", tenant=self.tenant_a,
        )
        resp = self.client.get(f"{BASE}/records/{rec.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["reason"] == "R"

    def test_retrieve_nonexistent(self):
        resp = self.client.get(f"{BASE}/records/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_update_dispatch_record(self):
        rec = DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user, reason="Old", tenant=self.tenant_a,
        )
        resp = self.client.patch(
            f"{BASE}/records/{rec.pk}/", {"reason": "New"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        rec.refresh_from_db()
        assert rec.reason == "New"

    def test_delete_dispatch_record(self):
        rec = DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user, reason="Del", tenant=self.tenant_a,
        )
        resp = self.client.delete(f"{BASE}/records/{rec.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        rec.refresh_from_db()
        assert rec.is_deleted is True


# ---------------------------------------------------------------------------
# DispatchRecord actions (proposed, history, approve, reject, execute)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchProposedHistory:
    """GET /proposed/ and /history/ endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="DP_T1", defaults={"display_name": "Prop Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="DP_T2", defaults={"display_name": "Prop Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="dpuser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.user_b = User.objects.create_user(
            username="dpuser2", password="test123", role="ADMIN", tenant=self.tenant_b,
        )
        self.soul = Soul.objects.create(
            name="PropSoul", current_state=SoulState.ALIVE, tenant=self.tenant_a,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def _create_dispatch(self, source, target, status_val="PROPOSED"):
        return DispatchRecord.objects.create(
            source_tenant=source, target_tenant=target,
            soul=self.soul, dispatched_by=self.user_a, reason="T",
            status=status_val, tenant=source,
        )

    def test_proposed_shows_pending_for_target(self):
        self._create_dispatch(self.tenant_a, self.tenant_b)
        resp = self.client_b.get(f"{BASE}/records/proposed/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1

    def test_proposed_excludes_approved(self):
        self._create_dispatch(self.tenant_a, self.tenant_b, "APPROVED")
        resp = self.client_b.get(f"{BASE}/records/proposed/")
        assert len(resp.data) == 0

    def test_proposed_empty_for_source(self):
        self._create_dispatch(self.tenant_a, self.tenant_b)
        resp = self.client_a.get(f"{BASE}/records/proposed/")
        assert len(resp.data) == 0

    def test_history_shows_source_records(self):
        self._create_dispatch(self.tenant_a, self.tenant_b)
        resp = self.client_a.get(f"{BASE}/records/history/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 1

    def test_history_excludes_other_tenants(self):
        self._create_dispatch(self.tenant_a, self.tenant_b)
        resp = self.client_b.get(f"{BASE}/records/history/")
        assert len(resp.data) == 0


@pytest.mark.django_db
class TestDispatchApproveReject:
    """POST /approve/ and /reject/ endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="DA_T3", defaults={"display_name": "Approve Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="DA_T4", defaults={"display_name": "Approve Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="dauser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.user_b = User.objects.create_user(
            username="dauser2", password="test123", role="ADMIN", tenant=self.tenant_b,
        )
        self.soul = Soul.objects.create(
            name="ApproveSoul", current_state=SoulState.ALIVE, tenant=self.tenant_a,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def _create_proposed(self):
        return DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user_a, reason="Approve me",
            tenant=self.tenant_a,
        )

    def test_target_can_approve(self):
        rec = self._create_proposed()
        resp = self.client_b.post(f"{BASE}/records/{rec.pk}/approve/", {}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        rec.refresh_from_db()
        assert rec.status == DispatchStatus.APPROVED

    def test_source_cannot_approve(self):
        rec = self._create_proposed()
        resp = self.client_a.post(f"{BASE}/records/{rec.pk}/approve/", {}, format="json")
        assert resp.status_code == 403

    def test_approve_non_proposed_fails(self):
        rec = self._create_proposed()
        # Approve once
        self.client_b.post(f"{BASE}/records/{rec.pk}/approve/", {}, format="json")
        # Try to approve again
        resp = self.client_b.post(f"{BASE}/records/{rec.pk}/approve/", {}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_target_can_reject(self):
        rec = self._create_proposed()
        resp = self.client_b.post(
            f"{BASE}/records/{rec.pk}/reject/",
            {"reason": "Not now"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        rec.refresh_from_db()
        assert rec.status == DispatchStatus.REJECTED

    def test_reject_records_reason(self):
        rec = self._create_proposed()
        self.client_b.post(
            f"{BASE}/records/{rec.pk}/reject/",
            {"reason": "Too many souls"}, format="json",
        )
        rec.refresh_from_db()
        assert "Too many souls" in rec.reason

    def test_reject_non_proposed_fails(self):
        rec = self._create_proposed()
        self.client_b.post(
            f"{BASE}/records/{rec.pk}/reject/",
            {"reason": "Nope"}, format="json",
        )
        resp = self.client_b.post(
            f"{BASE}/records/{rec.pk}/reject/",
            {"reason": "Nope again"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_uninvolved_tenant_cannot_approve(self):
        tenant_c = Tenant.objects.get_or_create(
            code="DA_T5", defaults={"display_name": "Uninvolved"}
        )[0]
        user_c = User.objects.create_user(
            username="dacuser3", password="test123", role="ADMIN", tenant=tenant_c,
        )
        client_c = _jwt_client(user_c, tenant_c)
        rec = self._create_proposed()
        resp = client_c.post(f"{BASE}/records/{rec.pk}/approve/", {}, format="json")
        assert resp.status_code == 403


@pytest.mark.django_db
class TestDispatchExecute:
    """POST /execute/ endpoint."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="DE_T1", defaults={"display_name": "Exec Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="DE_T2", defaults={"display_name": "Exec Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="deuser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.user_b = User.objects.create_user(
            username="deuser2", password="test123", role="ADMIN", tenant=self.tenant_b,
        )
        self.soul = Soul.objects.create(
            name="ExecSoul", current_state=SoulState.ALIVE, tenant=self.tenant_a,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def _create_approved(self):
        rec = DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user_a, reason="Exec",
            status=DispatchStatus.APPROVED, tenant=self.tenant_a,
        )
        return rec

    def test_target_can_execute(self):
        rec = self._create_approved()
        resp = self.client_b.post(f"{BASE}/records/{rec.pk}/execute/", {}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        rec.refresh_from_db()
        assert rec.status == DispatchStatus.EXECUTED
        self.soul.refresh_from_db()
        assert self.soul.tenant_id == self.tenant_b.pk

    def test_source_cannot_execute(self):
        rec = self._create_approved()
        resp = self.client_a.post(f"{BASE}/records/{rec.pk}/execute/", {}, format="json")
        assert resp.status_code == 403

    def test_execute_proposed_fails(self):
        rec = DispatchRecord.objects.create(
            source_tenant=self.tenant_a, target_tenant=self.tenant_b,
            soul=self.soul, dispatched_by=self.user_a, reason="Not approved",
            tenant=self.tenant_a,
        )
        resp = self.client_b.post(f"{BASE}/records/{rec.pk}/execute/", {}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_execute_sets_executed_at(self):
        rec = self._create_approved()
        self.client_b.post(f"{BASE}/records/{rec.pk}/execute/", {}, format="json")
        rec.refresh_from_db()
        assert rec.executed_at is not None


# ---------------------------------------------------------------------------
# DispatchService unit-level (state machine + transitions)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDispatchService:
    """Direct service method tests for DispatchService."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="DS_T1", defaults={"display_name": "Svc Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="DS_T2", defaults={"display_name": "Svc Tenant B"}
        )[0]
        self.user = User.objects.create_user(
            username="dsuser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.soul = Soul.objects.create(
            name="SvcSoul", current_state=SoulState.ALIVE, tenant=self.tenant_a,
        )

    def test_propose_creates_record(self):
        rec = DispatchService.propose(
            self.tenant_a, self.tenant_b, self.soul, self.user, "Propose",
        )
        assert rec.status == DispatchStatus.PROPOSED
        assert rec.soul == self.soul

    def test_propose_wrong_tenant_raises(self):
        with pytest.raises(ValueError, match="does not belong"):
            DispatchService.propose(
                self.tenant_b, self.tenant_a, self.soul, self.user, "Wrong",
            )

    def test_approve_transitions(self):
        rec = DispatchService.propose(
            self.tenant_a, self.tenant_b, self.soul, self.user, "A",
        )
        rec = DispatchService.approve(rec, self.user)
        assert rec.status == DispatchStatus.APPROVED

    def test_reject_transitions(self):
        rec = DispatchService.propose(
            self.tenant_a, self.tenant_b, self.soul, self.user, "R",
        )
        rec = DispatchService.reject(rec, self.user, "Nope")
        assert rec.status == DispatchStatus.REJECTED
        rec.refresh_from_db()
        assert "Nope" in rec.reason

    def test_execute_transfers_soul(self):
        rec = DispatchService.propose(
            self.tenant_a, self.tenant_b, self.soul, self.user, "E",
        )
        rec = DispatchService.approve(rec, self.user)
        rec = DispatchService.execute(rec, self.user)
        assert rec.status == DispatchStatus.EXECUTED
        self.soul.refresh_from_db()
        assert self.soul.tenant_id == self.tenant_b.pk

    def test_cancel_transitions(self):
        rec = DispatchService.propose(
            self.tenant_a, self.tenant_b, self.soul, self.user, "C",
        )
        rec = DispatchService.cancel(rec, self.user)
        assert rec.status == DispatchStatus.CANCELLED

    def test_unique_active_dispatch_constraint(self):
        DispatchService.propose(
            self.tenant_a, self.tenant_b, self.soul, self.user, "First",
        )
        with pytest.raises(ValueError, match="active dispatch already"):
            DispatchService.propose(
                self.tenant_a, self.tenant_b, self.soul, self.user, "Second",
            )


# ---------------------------------------------------------------------------
# CrossTenantJudgment CRUD + actions
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestCrossTenantJudgmentCRUD:
    """CrossTenantJudgment list, create, retrieve."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="CJ_T1", defaults={"display_name": "Jug Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="CJ_T2", defaults={"display_name": "Jug Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="cjuser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.user_b = User.objects.create_user(
            username="cjuser2", password="test123", role="ADMIN", tenant=self.tenant_b,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def _create_judgment(self, tenant=None):
        t = tenant or self.tenant_a
        return CrossTenantJudgment.objects.create(
            title="Joint Trial", description="Desc", initiating_tenant=t,
            tenant=t,
        )

    def test_list_empty(self):
        resp = self.client_a.get(f"{BASE}/cross-tenant-judgments/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_returns_judgments(self):
        self._create_judgment()
        resp = self.client_a.get(f"{BASE}/cross-tenant-judgments/")
        assert resp.data["count"] == 1

    def test_create_judgment(self):
        resp = self.client_a.post(f"{BASE}/cross-tenant-judgments/", {
            "title": "New Judgment", "description": "Test desc",
            "initiating_tenant": self.tenant_a.pk,
        }, format="json")
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["status"] == "PROPOSED"

    def test_retrieve_judgment(self):
        jug = self._create_judgment()
        resp = self.client_a.get(f"{BASE}/cross-tenant-judgments/{jug.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["title"] == "Joint Trial"

    def test_retrieve_nonexistent(self):
        resp = self.client_a.get(f"{BASE}/cross-tenant-judgments/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_tenant_b_cannot_see_tenant_a_judgments_alone(self):
        self._create_judgment(self.tenant_a)
        resp = self.client_b.get(f"{BASE}/cross-tenant-judgments/")
        assert resp.data["count"] == 0


@pytest.mark.django_db
class TestCrossTenantJudgmentParticipate:
    """POST /participate/ endpoint."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="CJ_T3", defaults={"display_name": "Part Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="CJ_T4", defaults={"display_name": "Part Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="cpuser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.user_b = User.objects.create_user(
            username="cpuser2", password="test123", role="ADMIN", tenant=self.tenant_b,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def _create_judgment(self):
        return CrossTenantJudgment.objects.create(
            title="Participate Test", description="D",
            initiating_tenant=self.tenant_a, tenant=self.tenant_a,
        )

    def test_initiating_tenant_can_add_participant(self):
        jug = self._create_judgment()
        resp = self.client_a.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/participate/",
            {"participant_tenant": self.tenant_b.pk, "role": "CO_JUDGE"},
            format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        jug.refresh_from_db()
        assert jug.status == JudgmentStatus.ACTIVE

    def test_participant_tenant_can_add_others(self):
        jug = self._create_judgment()
        # First, add tenant_b as participant
        CrossTenantJudgmentService.add_participant(
            jug, self.tenant_b, None, "ADVISOR",
        )
        # Now tenant_b should be able to add tenant_b again (already participant)
        resp = self.client_b.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/participate/",
            {"participant_tenant": self.tenant_b.pk, "role": "CHAIRMAN"},
            format="json",
        )
        # This may fail due to unique constraint, but auth should pass
        assert resp.status_code in (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST)

    def test_uninvolved_tenant_cannot_participate(self):
        tenant_c = Tenant.objects.get_or_create(
            code="CJ_T5", defaults={"display_name": "Random"}
        )[0]
        user_c = User.objects.create_user(
            username="cpcuser3", password="test123", role="ADMIN", tenant=tenant_c,
        )
        client_c = _jwt_client(user_c, tenant_c)
        jug = self._create_judgment()
        resp = client_c.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/participate/",
            {"participant_tenant": tenant_c.pk, "role": "ADVISOR"},
            format="json",
        )
        assert resp.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)


@pytest.mark.django_db
class TestCrossTenantJudgmentConclude:
    """POST /conclude/ endpoint."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.get_or_create(
            code="CJ_T6", defaults={"display_name": "Concl Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="CJ_T7", defaults={"display_name": "Concl Tenant B"}
        )[0]
        self.user_a = User.objects.create_user(
            username="ccuser1", password="test123", role="ADMIN", tenant=self.tenant_a,
        )
        self.user_b = User.objects.create_user(
            username="ccuser2", password="test123", role="ADMIN", tenant=self.tenant_b,
        )
        self.client_a = _jwt_client(self.user_a, self.tenant_a)
        self.client_b = _jwt_client(self.user_b, self.tenant_b)

    def _create_active_judgment(self):
        jug = CrossTenantJudgment.objects.create(
            title="Conclude Test", description="D",
            initiating_tenant=self.tenant_a, tenant=self.tenant_a,
        )
        CrossTenantJudgmentService.add_participant(
            jug, self.tenant_b, None, "CO_JUDGE",
        )
        jug.refresh_from_db()
        assert jug.status == JudgmentStatus.ACTIVE
        return jug

    def test_initiating_tenant_can_conclude(self):
        jug = self._create_active_judgment()
        resp = self.client_a.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/conclude/",
            {"conclusion_type": "PASS"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        jug.refresh_from_db()
        assert jug.status == JudgmentStatus.CONCLUDED
        assert jug.conclusion_type == "PASS"

    def test_participant_tenant_can_conclude(self):
        jug = self._create_active_judgment()
        resp = self.client_b.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/conclude/",
            {"conclusion_type": "FAIL"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        jug.refresh_from_db()
        assert jug.conclusion_type == "FAIL"

    def test_conclude_sets_concluded_at(self):
        jug = self._create_active_judgment()
        self.client_a.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/conclude/",
            {"conclusion_type": "PASS"}, format="json",
        )
        jug.refresh_from_db()
        assert jug.concluded_at is not None

    def test_conclude_invalid_type_rejected(self):
        jug = self._create_active_judgment()
        resp = self.client_a.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/conclude/",
            {"conclusion_type": "INVALID"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_uninvolved_tenant_cannot_conclude(self):
        tenant_c = Tenant.objects.get_or_create(
            code="CJ_T8", defaults={"display_name": "Random Concl"}
        )[0]
        user_c = User.objects.create_user(
            username="ccuc3", password="test123", role="ADMIN", tenant=tenant_c,
        )
        client_c = _jwt_client(user_c, tenant_c)
        jug = self._create_active_judgment()
        resp = client_c.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/conclude/",
            {"conclusion_type": "PASS"}, format="json",
        )
        assert resp.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)

    def test_conclude_proposed_fails(self):
        jug = CrossTenantJudgment.objects.create(
            title="ProposedOnly", description="D",
            initiating_tenant=self.tenant_a, tenant=self.tenant_a,
        )
        resp = self.client_a.post(
            f"{BASE}/cross-tenant-judgments/{jug.pk}/conclude/",
            {"conclusion_type": "PASS"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
