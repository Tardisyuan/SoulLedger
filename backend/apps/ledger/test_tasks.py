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

from apps.ledger.tasks import recalculate_tenant_ledgers
from apps.souls.models import Soul
from apps.tenants.models import Tenant


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


# `TestRecalculateSingleTenantValidation` removed 2026-09-13 (DB-03): it tested
# `recalculate_soul_ledger_task` (celery name `ledger.recalculate_single`),
# deleted as dead code — no scheduler and no production caller anywhere in
# the tree (see `apps/ledger/tasks.py`).
