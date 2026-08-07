"""
Tenant-isolation tests for apps.ledger.tasks.

Celery has no per-request tenant context the way HTTP does — a task that
just iterates every Soul in one run touches every tenant's data in one
execution. These tasks were fixed (M15 audit, 2026-06-09) to fan out one
subtask per tenant instead; these tests are the security-relevant
assertion the audit was missing: that a tenant's subtask only ever
touches its own tenant's souls.
"""
from unittest.mock import patch

import pytest

from apps.ledger.tasks import (
    recalculate_all_ledgers,
    recalculate_soul_ledger_task,
    recalculate_tenant_ledgers,
)
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestRecalculateAllLedgersDispatch:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.active_a = Tenant.objects.create(code="LDG_ACTIVE_A", display_name="Active A", is_active=True)
        self.active_b = Tenant.objects.create(code="LDG_ACTIVE_B", display_name="Active B", is_active=True)
        self.inactive = Tenant.objects.create(code="LDG_INACTIVE", display_name="Inactive", is_active=False)

    @patch("apps.ledger.tasks.recalculate_tenant_ledgers.delay")
    def test_dispatches_one_subtask_per_active_tenant(self, mock_delay):
        result = recalculate_all_ledgers()
        dispatched_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert dispatched_ids == {str(self.active_a.id), str(self.active_b.id)}
        assert result["tenants_dispatched"] == 2

    @patch("apps.ledger.tasks.recalculate_tenant_ledgers.delay")
    def test_does_not_dispatch_for_an_inactive_tenant(self, mock_delay):
        recalculate_all_ledgers()
        dispatched_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert str(self.inactive.id) not in dispatched_ids


@pytest.mark.django_db
class TestRecalculateTenantLedgersIsolation:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="LDG_TEN_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="LDG_TEN_B", display_name="Tenant B")
        self.soul_a = Soul.objects.create(name="Soul A", tenant=self.tenant_a, birth_year=1900, death_year=1950)
        self.soul_b = Soul.objects.create(name="Soul B", tenant=self.tenant_b, birth_year=1900, death_year=1950)

    def test_only_recalculates_souls_belonging_to_the_given_tenant(self):
        with patch("apps.ledger.services.LedgerService.recalculate_soul_ledger") as mock_recalc:
            result = recalculate_tenant_ledgers(str(self.tenant_a.id))
        recalculated_souls = [call.args[0] for call in mock_recalc.call_args_list]
        assert recalculated_souls == [self.soul_a]
        assert self.soul_b not in recalculated_souls
        assert result["updated"] == 1


@pytest.mark.django_db
class TestRecalculateSingleTenantValidation:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="LDG_SINGLE_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="LDG_SINGLE_B", display_name="Tenant B")
        self.soul = Soul.objects.create(name="Soul", tenant=self.tenant_a, birth_year=1900, death_year=1950)

    def test_no_tenant_id_recalculates_as_before(self):
        with patch("apps.ledger.services.LedgerService.recalculate_soul_ledger") as mock_recalc:
            recalculate_soul_ledger_task(str(self.soul.id))
        mock_recalc.assert_called_once_with(self.soul)

    def test_matching_tenant_id_recalculates(self):
        with patch("apps.ledger.services.LedgerService.recalculate_soul_ledger") as mock_recalc:
            recalculate_soul_ledger_task(str(self.soul.id), tenant_id=str(self.tenant_a.id))
        mock_recalc.assert_called_once_with(self.soul)

    def test_a_mismatched_tenant_id_is_refused(self):
        with patch("apps.ledger.services.LedgerService.recalculate_soul_ledger") as mock_recalc:
            result = recalculate_soul_ledger_task(str(self.soul.id), tenant_id=str(self.tenant_b.id))
        mock_recalc.assert_not_called()
        assert "error" in result
