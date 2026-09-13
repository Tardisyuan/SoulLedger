"""
Tenant-isolation tests for apps.death_sync.tasks.

See apps/ledger/test_tasks.py's module docstring for why this fan-out
pattern exists — same M15 fix. cleanup_old_requests_for_tenant is the
highest-stakes of them: it deletes rows, so its test
asserts the other tenant's row survives, not just that it's excluded from
a queryset.
"""
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.death_sync.models import (
    DeathRegistrationRequest,
    ExternalApiKey,
)
from apps.death_sync.tasks import (
    cleanup_old_requests,
    cleanup_old_requests_for_tenant,
)
from apps.souls.models import Soul
from apps.tenants.models import Tenant


def _api_key(tenant):
    raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        tenant=tenant, name="Test Key", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )


def _registration(tenant):
    soul = Soul.objects.create(name="Soul", tenant=tenant, birth_year=1900, death_year=1950)
    return DeathRegistrationRequest.objects.create(
        tenant=tenant, idempotency_key=f"idem-{tenant.code}", source_system="HOSPITAL",
        source_payload={"test": True}, soul=soul,
    )


@pytest.mark.django_db
class TestCleanupOldRequestsDispatch:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.active = Tenant.objects.create(code="CLN_ACTIVE", display_name="Active", is_active=True)
        self.inactive = Tenant.objects.create(code="CLN_INACTIVE", display_name="Inactive", is_active=False)

    @patch("apps.death_sync.tasks.cleanup_old_requests_for_tenant.delay")
    def test_dispatches_only_for_active_tenants(self, mock_delay):
        result = cleanup_old_requests()
        dispatched_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert dispatched_ids == {str(self.active.id)}
        assert result["tenants_dispatched"] == 1


@pytest.mark.django_db
class TestCleanupOldRequestsForTenantIsolation:
    """The highest-stakes of the three tasks fixed here — a DELETE, so this
    asserts the other tenant's old row survives, not just that a queryset
    excludes it."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="CLN_TEN_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="CLN_TEN_B", display_name="Tenant B")
        self.old_a = _registration(self.tenant_a)
        self.old_b = _registration(self.tenant_b)
        old_timestamp = timezone.now() - timezone.timedelta(days=100)
        DeathRegistrationRequest.objects.filter(pk=self.old_a.pk).update(request_timestamp=old_timestamp)
        DeathRegistrationRequest.objects.filter(pk=self.old_b.pk).update(request_timestamp=old_timestamp)

    def test_only_deletes_old_requests_for_the_given_tenant(self):
        result = cleanup_old_requests_for_tenant(str(self.tenant_a.id), days=90, batch_size=1000)
        assert not DeathRegistrationRequest.objects.filter(pk=self.old_a.pk).exists()
        assert DeathRegistrationRequest.objects.filter(pk=self.old_b.pk).exists()
        assert result["deleted"] == 1
