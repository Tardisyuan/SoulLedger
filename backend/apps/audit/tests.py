"""
Tests for audit app - AuditLog views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.

Five tests here absorbed a same-named twin from ``tests/test_audit.py``
(2026-09-13; the "7 + 5 duplicate tests" finding of the 2026-09-12 audit).
They were kept here rather than there because this fixture writes the rows it
filters -- a CREATE and an UPDATE, a ``soul`` and a ``judgment`` -- so a filter
assertion is checked against rows the test itself put in the table. The twins'
resource and user filters wrote nothing and ran against whatever other writes
had left there. Each merged test says which half came from where.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/audit-logs"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestAuditLogModel:
    """AuditLog model basics."""

    def test_audit_log_str(self):
        tenant = Tenant.objects.create(code="AUD_M", display_name="Audit Model T")
        user = User.objects.create_user(username="aud_m_user", password="test123", role="ADMIN", tenant=tenant)
        log = AuditLog.objects.create(
            tenant=tenant, user=user, action=AuditAction.CREATE,
            resource="soul", resource_id="123", description="Created a soul"
        )
        assert "CREATE" in str(log)
        assert "soul" in str(log)


@pytest.mark.django_db
class TestAuditLogListRetrieve:
    """AuditLog list and retrieve endpoints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="AUD_T1", defaults={"display_name": "Audit Test Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="aud_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.viewer = User.objects.create_user(
            username="aud_viewer", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        self.viewer_client = _jwt_client(self.viewer, self.tenant)
        self.log1 = AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.CREATE,
            resource="soul", description="Test log 1"
        )
        self.log2 = AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.UPDATE,
            resource="judgment", description="Test log 2"
        )

    def test_list_audit_logs_admin(self):
        resp = self.admin_client.get(f"{BASE}/")
        assert resp.status_code == status.HTTP_200_OK

    def test_list_audit_logs_unauthenticated(self):
        resp = APIClient().get(f"{BASE}/")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_retrieve_audit_log(self):
        resp = self.admin_client.get(f"{BASE}/{self.log1.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["resource"] == "soul"

    def test_retrieve_not_found(self):
        resp = self.admin_client.get(f"{BASE}/99999/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_filter_by_resource(self, django_capture_on_commit_callbacks):
        """Merged: the per-row check is the ``tests/test_audit.py`` twin's; this
        fixture's ``judgment`` row is what it can fail on. ``results``
        non-empty is new: it keeps the loop from passing on an empty page.

        2026-09-14: the second twin, ``TestAuditApiEndpoint::test_filter_by_resource``,
        is merged too. What it had that this did not was an API write -- a
        soul POSTed and answered 201 -- ahead of the filter. That write now
        happens here, with its on_commit audit row executed (this class is not
        transactional; see test_filter_by_action), and the soul's own row must
        be in the page, which neither copy asserted before.
        """
        with django_capture_on_commit_callbacks(execute=True):
            created = self.admin_client.post("/api/v1/souls/", {
                "name": "Resource Filter Test",
                "birth_date": "1990-01-01",
            })
        assert created.status_code == 201

        resp = self.admin_client.get(f"{BASE}/", {"resource": "soul"})
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["results"]
        for log in resp.data["results"]:
            assert "soul" in log["resource"].lower()
        assert str(created.data["id"]) in {str(log["resource_id"]) for log in resp.data["results"]}

    def test_filter_by_action(self, django_capture_on_commit_callbacks):
        """Merged: the API-produced CREATE/UPDATE and the exact-set assertion
        are the ``tests/test_audit.py`` twin's (BT-09 there: with CREATE rows
        only, an inert filter passed). This fixture's UPDATE row discriminates
        too.

        2026-09-14: the second twin, ``TestAuditApiEndpoint::test_filter_by_action``,
        is merged here as well, and it exposed that the merge above was only
        half real. This class is ``django_db`` without ``transaction=True``, so
        the audit signal's ``on_commit`` callbacks never ran: the POST and
        PATCH wrote no audit rows at all, and the assertions passed on the
        fixture rows alone. Measured: with the CREATE branch of
        ``_on_post_save`` made to ``return``, this test stayed green and only
        the twin went red. ``django_capture_on_commit_callbacks(execute=True)``
        makes the API writes real, and the soul's own CREATE row is now
        required in the filtered page.
        """
        with django_capture_on_commit_callbacks(execute=True):
            resp = self.admin_client.post("/api/v1/souls/", {
                "name": "Filter Test Soul",
                "birth_date": "1990-01-01",
            })
        assert resp.status_code == 201
        soul_id = str(resp.data["id"])
        with django_capture_on_commit_callbacks(execute=True):
            resp = self.admin_client.patch(
                f"/api/v1/souls/{soul_id}/", {"name": "Filter Test Soul Renamed"}
            )
        assert resp.status_code == 200

        resp = self.admin_client.get(f"{BASE}/", {"action": "CREATE"})
        assert resp.status_code == status.HTTP_200_OK
        actions = {log["action"] for log in resp.data["results"]}
        assert actions == {"CREATE"}, f"expected only CREATE rows, got {actions}"
        assert soul_id in {str(log["resource_id"]) for log in resp.data["results"]}, (
            "the API-created soul's CREATE row is not in the page -- the "
            "filter is being checked against fixture rows only"
        )

    def test_filter_by_user_id(self):
        """Merged: the per-row check is the ``tests/test_audit.py`` twin's.

        The viewer's row is new: every fixture row is the admin's, so without
        it an inert ``user_id`` filter satisfies the loop (measured 2026-09-13:
        row removed + filter made inert -> still passed).
        """
        AuditLog.objects.create(
            tenant=self.tenant, user=self.viewer, action=AuditAction.VIEW,
            resource="soul", description="viewer's log"
        )
        resp = self.admin_client.get(f"{BASE}/", {"user_id": self.admin.pk})
        assert resp.status_code == status.HTTP_200_OK
        for log in resp.data["results"]:
            assert str(log.get("user")) == str(self.admin.id) or log.get("user_display") == self.admin.username


@pytest.mark.django_db
class TestAuditLogActions:
    """AuditLog custom actions: actions, resources, stats, timeline, by_trace."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="AUD_T2", defaults={"display_name": "Audit Actions Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="audact_admin", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.admin_client = _jwt_client(self.admin, self.tenant)
        AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.CREATE,
            resource="soul", description="log a", trace_id="trace-abc"
        )
        AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.UPDATE,
            resource="soul", description="log b", trace_id="trace-abc"
        )
        AuditLog.objects.create(
            tenant=self.tenant, user=self.admin, action=AuditAction.DELETE,
            resource="judgment", description="log c", trace_id="trace-other"
        )

    def test_actions_endpoint(self):
        """Merged: the six newer action types are the ``tests/test_audit.py``
        twin's."""
        resp = self.admin_client.get(f"{BASE}/actions/")
        assert resp.status_code == status.HTTP_200_OK
        assert isinstance(resp.data, list)
        assert any(a["value"] == "CREATE" for a in resp.data)
        actions = [a["value"] for a in resp.data]
        assert "VIEW" in actions
        assert "EXPORT" in actions
        assert "IMPORT" in actions
        assert "BATCH_CREATE" in actions
        assert "BATCH_UPDATE" in actions
        assert "BATCH_DELETE" in actions

    def test_resources_endpoint(self):
        """Merged: ``isinstance(list)`` is the ``tests/test_audit.py`` twin's --
        ``in`` alone is also true of a dict keyed by resource."""
        resp = self.admin_client.get(f"{BASE}/resources/")
        assert resp.status_code == status.HTTP_200_OK
        assert isinstance(resp.data, list)
        assert "soul" in resp.data
        assert "judgment" in resp.data

    def test_stats_endpoint(self):
        """Merged 2026-09-14 with ``tests/test_audit.py::TestAuditLogViewSet::
        test_stats_endpoint_admin_only`` -- same assertions, different caller.
        That one authenticated the ADMIN with ``force_authenticate``, so the
        request carried no JWT ``tenant_code`` and ``request.tenant`` was None;
        this one's JWT sets it. Both callers are kept."""
        forced = APIClient()
        forced.force_authenticate(user=self.admin)
        for client in (self.admin_client, forced):
            resp = client.get(f"{BASE}/stats/")
            assert resp.status_code == status.HTTP_200_OK
            assert "action_distribution" in resp.data
            assert "total_logs" in resp.data

    def test_timeline_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/timeline/")
        assert resp.status_code == status.HTTP_200_OK

    def test_timeline_with_resource_filter(self):
        resp = self.admin_client.get(f"{BASE}/timeline/", {"resource": "soul"})
        assert resp.status_code == status.HTTP_200_OK

    def test_by_trace_endpoint(self):
        resp = self.admin_client.get(f"{BASE}/trace/trace-abc/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 2

    def test_by_trace_not_found(self):
        resp = self.admin_client.get(f"{BASE}/trace/nonexistent/")
        assert resp.status_code == status.HTTP_200_OK
        assert len(resp.data) == 0
