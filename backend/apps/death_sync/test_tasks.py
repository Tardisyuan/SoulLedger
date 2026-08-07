"""
Tenant-isolation tests for apps.death_sync.tasks.

See apps/ledger/test_tasks.py's module docstring for why this fan-out
pattern exists — same M15 fix. cleanup_old_requests_for_tenant is the
highest-stakes of the three fixed here: it deletes rows, so its test
asserts the other tenant's row survives, not just that it's excluded from
a queryset.
"""
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.death_sync.models import (
    DeathRegistrationRequest,
    ExternalApiKey,
    WebhookConfig,
    WebhookDeliveryLog,
    WebhookDeliveryStatus,
)
from apps.death_sync.tasks import (
    cleanup_old_requests,
    cleanup_old_requests_for_tenant,
    deliver_webhook,
    retry_failed_webhooks,
    retry_failed_webhooks_for_tenant,
)
from apps.souls.models import Soul
from apps.tenants.models import Tenant


def _api_key(tenant):
    raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        tenant=tenant, name="Test Key", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )


def _webhook_config(tenant):
    return WebhookConfig.objects.create(
        tenant=tenant, api_key=_api_key(tenant),
        url="https://example.com/webhook", signing_secret="test_secret", is_active=True,
    )


def _registration(tenant):
    soul = Soul.objects.create(name="Soul", tenant=tenant, birth_year=1900, death_year=1950)
    return DeathRegistrationRequest.objects.create(
        tenant=tenant, idempotency_key=f"idem-{tenant.code}", source_system="HOSPITAL",
        source_payload={"test": True}, soul=soul,
    )


@pytest.mark.django_db
class TestRetryFailedWebhooksDispatch:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.active_a = Tenant.objects.create(code="WH_ACTIVE_A", display_name="Active A", is_active=True)
        self.active_b = Tenant.objects.create(code="WH_ACTIVE_B", display_name="Active B", is_active=True)
        self.inactive = Tenant.objects.create(code="WH_INACTIVE", display_name="Inactive", is_active=False)

    @patch("apps.death_sync.tasks.retry_failed_webhooks_for_tenant.delay")
    def test_dispatches_one_subtask_per_active_tenant(self, mock_delay):
        result = retry_failed_webhooks()
        dispatched_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert dispatched_ids == {str(self.active_a.id), str(self.active_b.id)}
        assert result["tenants_dispatched"] == 2


@pytest.mark.django_db
class TestRetryFailedWebhooksForTenantIsolation:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="WH_TEN_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="WH_TEN_B", display_name="Tenant B")

        def make_retrying_log(tenant):
            config = _webhook_config(tenant)
            registration = _registration(tenant)
            return WebhookDeliveryLog.objects.create(
                webhook=config, registration=registration,
                status=WebhookDeliveryStatus.RETRYING,
                next_retry_at=timezone.now() - timezone.timedelta(minutes=1),
            )

        self.log_a = make_retrying_log(self.tenant_a)
        self.log_b = make_retrying_log(self.tenant_b)

    @patch("apps.death_sync.tasks.deliver_webhook.delay")
    def test_only_retries_deliveries_for_the_given_tenant(self, mock_delay):
        result = retry_failed_webhooks_for_tenant(str(self.tenant_a.id))
        retried_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert retried_ids == {str(self.log_a.id)}
        assert str(self.log_b.id) not in retried_ids
        assert result["dispatched"] == 1


@pytest.mark.django_db
class TestDeliverWebhookTenantValidation:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="WH_DLV_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="WH_DLV_B", display_name="Tenant B")
        config = _webhook_config(self.tenant_a)
        registration = _registration(self.tenant_a)
        self.log = WebhookDeliveryLog.objects.create(
            webhook=config, registration=registration, status=WebhookDeliveryStatus.RETRYING,
        )

    def test_a_mismatched_tenant_id_is_refused(self):
        with patch("apps.death_sync.webhook_service.WebhookService.deliver_webhook") as mock_deliver:
            deliver_webhook(str(self.log.id), tenant_id=str(self.tenant_b.id))
        mock_deliver.assert_not_called()

    def test_a_matching_tenant_id_proceeds(self):
        with patch("apps.death_sync.webhook_service.WebhookService.deliver_webhook", return_value=None) as mock_deliver:
            deliver_webhook(str(self.log.id), tenant_id=str(self.tenant_a.id))
        mock_deliver.assert_called_once()


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
