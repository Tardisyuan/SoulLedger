"""
Tenant-isolation tests for apps.judgment.tasks.

See apps/ledger/test_tasks.py's module docstring for why this fan-out
pattern exists — same M15 fix, same shape of test.
"""
import importlib
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.judgment.models import Judgment
from apps.judgment.tasks import (
    STALE_MARKER,
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
        Judgment.objects.filter(pk=self.judgment_a.pk).update(created_at=stale_created, update_time=stale_created)
        Judgment.objects.filter(pk=self.judgment_b.pk).update(created_at=stale_created, update_time=stale_created)

    def test_only_flags_judgments_belonging_to_the_given_tenant(self):
        result = auto_conclude_stale_judgments_for_tenant(str(self.tenant_a.id), days_threshold=30)

        self.judgment_a.refresh_from_db()
        self.judgment_b.refresh_from_db()
        assert self.judgment_a.stale_since is not None
        assert self.judgment_b.stale_since is None
        assert result["flagged"] == 1
        assert result["tenant"] == self.tenant_a.code


@pytest.mark.django_db
class TestStaleFlagIsWrittenOnce:
    """BD-14 / PQ-02: re-running the task must not re-stamp a flagged row, the
    flag is a column (notes, status and verdict untouched), and the rows are
    written in bulk rather than one `.save()` per judgment."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(code="JDG_ONCE", display_name="Once")
        stale_created = timezone.now() - timedelta(days=60)
        self.judgments = []
        for i in range(3):
            soul = Soul.objects.create(name=f"Once {i}", tenant=self.tenant, birth_year=1900, death_year=1950)
            j = Judgment.objects.create(soul=soul, tenant=self.tenant, civilization="EUROPEAN", is_final=False, notes="kept")
            self.judgments.append(j)
        Judgment.objects.filter(tenant=self.tenant).update(created_at=stale_created, update_time=stale_created)

    def test_second_run_does_not_restamp(self):
        first = auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        stamps = {j.pk: Judgment.objects.get(pk=j.pk).stale_since for j in self.judgments}
        second = auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        assert first["flagged"] == 3
        assert second["flagged"] == 0
        for j in self.judgments:
            j.refresh_from_db()
            assert j.stale_since is not None and j.stale_since == stamps[j.pk]

    def test_flag_is_the_column_and_nothing_else_moves(self):
        auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        for j in self.judgments:
            j.refresh_from_db()
            assert j.stale_since is not None
            assert j.notes == "kept", "the flag must not be written into notes any more"
            assert STALE_MARKER not in j.notes
            # 用户 2026-10-17:滞留只是标记,永不自动结案。
            assert j.verdict is None
            assert j.is_final is False
            assert j.concluded_at is None
            assert j.update_time < timezone.now() - timedelta(days=30), "flagging is not activity"

    def test_a_case_touched_recently_is_not_stale_however_old(self):
        Judgment.objects.filter(pk=self.judgments[0].pk).update(update_time=timezone.now())
        result = auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        assert result["flagged"] == 2
        assert Judgment.objects.get(pk=self.judgments[0].pk).stale_since is None

    def test_rows_are_not_saved_one_by_one(self, django_assert_max_num_queries):
        # Measured with these 3 rows: per-row `.save()` was 11 queries (tenant,
        # select, then UPDATE + audit pre-save read + audit insert per row);
        # bulk is 4 (tenant, select, one bulk UPDATE, one batch audit row) and
        # does not grow with the row count.
        # 2026-10-29: the batch audit row now takes the edited rows' tenant; with
        # `tenant_id` deferred that was one extra SELECT per row (7 on real PG).
        with django_assert_max_num_queries(5):
            auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)

    def test_the_batch_audit_row_is_filed_under_the_rows_hall(self):
        from apps.audit.models import AuditLog

        auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        rows = AuditLog.objects.filter(action="BATCH_UPDATE", changes__details__field="stale_since")
        assert rows.count() == 1
        assert rows.get().tenant_id == self.tenant.id
        assert not rows.filter(tenant__isnull=True).exists()


@pytest.mark.django_db
class TestStaleClearsOnActivity:
    """`stale_since` 在案子下一次有进展时清掉:任何 `Judgment.save()`(含只给
    `update_fields` 的认领那组写法)与判词草稿的自动保存(它不走 `save()`)。"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(code="JDG_CLEAR", display_name="Clear")
        soul = Soul.objects.create(name="Clear", tenant=self.tenant, birth_year=1900, death_year=1950)
        self.judgment = Judgment.objects.create(soul=soul, tenant=self.tenant, civilization="EUROPEAN")
        Judgment.objects.filter(pk=self.judgment.pk).update(stale_since=timezone.now())
        self.judgment.refresh_from_db()
        assert self.judgment.stale_since is not None

    def test_a_full_save_clears_it(self):
        self.judgment.court = "Hall"
        self.judgment.save()
        assert Judgment.objects.get(pk=self.judgment.pk).stale_since is None

    def test_a_save_with_update_fields_clears_it_in_the_database(self):
        self.judgment.court = "Hall"
        self.judgment.save(update_fields=["court"])
        assert Judgment.objects.get(pk=self.judgment.pk).stale_since is None

    def test_a_draft_autosave_clears_it(self):
        from apps.judgment.services import JudgmentDraftService

        JudgmentDraftService.save(self.judgment, self.judgment.draft_version, {"notes": "draft"})
        assert Judgment.objects.get(pk=self.judgment.pk).stale_since is None

    def test_the_flagging_task_itself_does_not_clear_it(self):
        other = Judgment.objects.get(pk=self.judgment.pk)
        Judgment.objects.filter(pk=other.pk).update(
            created_at=timezone.now() - timedelta(days=60), update_time=timezone.now() - timedelta(days=60),
        )
        auto_conclude_stale_judgments_for_tenant(str(self.tenant.id), days_threshold=30)
        assert Judgment.objects.get(pk=self.judgment.pk).stale_since is not None


class TestMigrationStripsTheOldMarker:
    """judgment/0037 的纯函数部分:删掉标记行、读出时刻。数据库那半是两行 `.update()`。"""

    migration = importlib.import_module("apps.judgment.migrations.0037_judgment_stale_since")

    def test_marker_line_is_removed_and_its_time_read(self):
        notes = f"kept\n{STALE_MARKER} on 2026-09-01T03:00:00+00:00"
        stripped, stamp = self.migration.strip_marker(notes)
        assert stripped == "kept"
        assert stamp is not None and stamp.isoformat() == "2026-09-01T03:00:00+00:00"

    def test_every_marker_line_goes_and_the_first_time_wins(self):
        notes = (
            f"a\n{STALE_MARKER} on 2026-08-01T00:00:00+00:00\nb"
            f"\n{STALE_MARKER} on 2026-09-01T00:00:00+00:00"
        )
        stripped, stamp = self.migration.strip_marker(notes)
        assert stripped == "a\nb"
        assert stamp.month == 8

    def test_a_marker_without_a_readable_time_gives_none(self):
        stripped, stamp = self.migration.strip_marker(f"{STALE_MARKER}")
        assert stripped == ""
        assert stamp is None

    def test_the_migration_and_the_task_share_one_literal(self):
        assert self.migration.MARKER == STALE_MARKER
