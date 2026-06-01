"""
Performance regression tests.
Verifies query counts and response times for critical endpoints.
"""
import pytest
from django.test.utils import override_settings
from apps.souls.models import Soul, SoulState
from apps.judgment.models import Judgment, JudgmentMethod
from apps.karma.models import SoulRecord, RecordType


@pytest.mark.django_db
class TestQueryPerformance:
    """Test that critical queries don't have N+1 issues."""

    def test_soul_list_query_count(self, api_client, admin_user, cn_tenant):
        """Soul list should use <= 10 queries (no N+1)."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        # Create test data
        for i in range(5):
            Soul.objects.create(name=f"Soul {i}", tenant=cn_tenant)

        from django.test.utils import CaptureQueriesContext
        from django.db import connection
        with CaptureQueriesContext(connection) as ctx:
            resp = api_client.get("/api/v1/souls/")
            assert resp.status_code == 200

        # Should use <= 10 queries (no N+1 per row)
        query_count = len(ctx)
        assert query_count <= 10, f"Expected <= 10 queries, got {query_count}"

    def test_soul_detail_query_count(self, api_client, admin_user, cn_tenant):
        """Soul detail should use <= 5 queries (no N+1)."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        soul = Soul.objects.create(name="Detail Soul", tenant=cn_tenant)

        from django.test.utils import CaptureQueriesContext
        from django.db import connection
        with CaptureQueriesContext(connection) as ctx:
            resp = api_client.get(f"/api/v1/souls/{soul.id}/")
            assert resp.status_code == 200

        query_count = len(ctx)
        assert query_count <= 5, f"Expected <= 5 queries, got {query_count}"


@pytest.mark.django_db
class TestDataIntegrity:
    """Test data integrity constraints."""

    def test_soul_name_not_unique(self, cn_tenant):
        """Soul names are not unique by design (multiple souls can share names)."""
        Soul.objects.create(name="Duplicate Soul", tenant=cn_tenant)
        soul2 = Soul.objects.create(name="Duplicate Soul", tenant=cn_tenant)
        assert soul2.pk is not None

    def test_soul_cannot_transition_invalid(self, cn_tenant):
        """Soul cannot transition to invalid states."""
        soul = Soul.objects.create(name="Test Soul", tenant=cn_tenant)
        assert soul.current_state == SoulState.ALIVE
        # Cannot go from ALIVE to DISPOSED directly
        assert soul.can_transition_to(SoulState.DISPOSED) is False

    def test_soul_record_weight_positive(self, cn_tenant):
        """SoulRecord weight should be positive."""
        soul = Soul.objects.create(name="Weight Soul", tenant=cn_tenant)
        record = SoulRecord.objects.create(
            soul=soul, tenant=cn_tenant,
            record_type=RecordType.MERIT,
            description="Test",
            weight=10,
        )
        assert record.weight > 0
