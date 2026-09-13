"""
Tenant-isolation tests for apps.judgment.tasks.

See apps/ledger/test_tasks.py's module docstring for why this fan-out
pattern exists — same M15 fix, same shape of test.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.judgment.models import Judgment
from apps.judgment.tasks import (
    auto_conclude_stale_judgments,
    auto_conclude_stale_judgments_for_tenant,
)
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestAutoConcludeStaleDispatch:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.active_a = Tenant.objects.create(code="JDG_ACTIVE_A", display_name="Active A", is_active=True)
        self.active_b = Tenant.objects.create(code="JDG_ACTIVE_B", display_name="Active B", is_active=True)
        self.inactive = Tenant.objects.create(code="JDG_INACTIVE", display_name="Inactive", is_active=False)

    @patch("apps.judgment.tasks.auto_conclude_stale_judgments_for_tenant.delay")
    def test_dispatches_one_subtask_per_active_tenant(self, mock_delay):
        result = auto_conclude_stale_judgments(days_threshold=30)
        dispatched_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert dispatched_ids == {str(self.active_a.id), str(self.active_b.id)}
        assert result["tenants_dispatched"] == 2

    @patch("apps.judgment.tasks.auto_conclude_stale_judgments_for_tenant.delay")
    def test_does_not_dispatch_for_an_inactive_tenant(self, mock_delay):
        auto_conclude_stale_judgments()
        dispatched_ids = {call.args[0] for call in mock_delay.call_args_list}
        assert str(self.inactive.id) not in dispatched_ids


@pytest.mark.django_db
class TestAutoConcludeStaleForTenantIsolation:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant_a = Tenant.objects.create(code="JDG_TEN_A", display_name="Tenant A")
        self.tenant_b = Tenant.objects.create(code="JDG_TEN_B", display_name="Tenant B")
        stale_created = timezone.now() - timedelta(days=60)
        self.soul_a = Soul.objects.create(name="Soul A", tenant=self.tenant_a, birth_year=1900, death_year=1950)
        self.soul_b = Soul.objects.create(name="Soul B", tenant=self.tenant_b, birth_year=1900, death_year=1950)
        self.judgment_a = Judgment.objects.create(
            soul=self.soul_a, tenant=self.tenant_a, civilization="EUROPEAN", is_final=False,
        )
        self.judgment_b = Judgment.objects.create(
            soul=self.soul_b, tenant=self.tenant_b, civilization="EUROPEAN", is_final=False,
        )
        Judgment.objects.filter(pk=self.judgment_a.pk).update(created_at=stale_created)
        Judgment.objects.filter(pk=self.judgment_b.pk).update(created_at=stale_created)

    def test_only_flags_judgments_belonging_to_the_given_tenant(self):
        result = auto_conclude_stale_judgments_for_tenant(str(self.tenant_a.id), days_threshold=30)

        self.judgment_a.refresh_from_db()
        self.judgment_b.refresh_from_db()
        assert "Flagged as stale" in self.judgment_a.notes
        assert "Flagged as stale" not in (self.judgment_b.notes or "")
        assert result["flagged"] == 1
        assert result["tenant"] == self.tenant_a.code


@pytest.mark.django_db
class TestStaleFlagIsWrittenOnce:
    """BD-14 / PQ-02: re-running the task must not append a second flag line,
    and the rows are written in bulk rather than one `.save()` per judgment."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(code="JDG_ONCE", display_name="Once")
        stale_created = timezone.now() - timedelta(days=60)
        self.judgments = []
        for i in range(3):
            soul = Soul.objects.create(name=f"Once {i}", tenant=self.tenant, birth_year=1900, death_year=1950)
            j = Judgment.objects.create(soul=soul, tenant=self.tenant, civilization="EUROPEAN", is_final=False, notes="kept")
            self.judgments.append(j)
        Judgment.objects.filter(tenant=self.tenant).update(created_at=stale_created)

    def test_second_run_adds_no_second_flag(self):
        first = auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        second = auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        assert first["flagged"] == 3
        assert second["flagged"] == 0
        for j in self.judgments:
            j.refresh_from_db()
            assert j.notes.startswith("kept"), "the existing notes were overwritten"
            assert j.notes.count("[SYSTEM] Flagged as stale") == 1, j.notes

    def test_rows_are_not_saved_one_by_one(self, django_assert_max_num_queries):
        # Measured with these 3 rows: per-row `.save()` was 11 queries (tenant,
        # select, then UPDATE + audit pre-save read + audit insert per row);
        # bulk is 4 (tenant, select, one bulk UPDATE, one batch audit row) and
        # does not grow with the row count.
        with django_assert_max_num_queries(5):
            auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
