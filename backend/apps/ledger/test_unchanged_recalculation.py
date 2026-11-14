"""A recalculation that changes nothing writes nothing (user decision 2026-11-14).

No `save()` of the soul, no KARMA_RECALCULATED event; a change is recorded exactly as before. The daily task
walks the hall in primary-key pages instead of `.iterator()`.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.events.models import SoulEvent
from apps.ledger.services import LedgerService
from apps.ledger.tasks import _souls_in_pk_pages, recalculate_tenant_ledgers
from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant


def _events(soul):
    return SoulEvent.all_objects.filter(soul=soul, event_type="KARMA_RECALCULATED").count()


def _soul_updates(queries):
    table = Soul._meta.db_table
    return [q["sql"] for q in queries if q["sql"].lstrip().upper().startswith("UPDATE") and f'"{table}"' in q["sql"]]


@pytest.mark.django_db
class TestUnchangedRecalculation:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(code="LDG_SAME", display_name="Same")
        self.soul = Soul.objects.create(name="不变", tenant=self.tenant, birth_year=1900, death_year=1950)
        SoulRecord.objects.create(soul=self.soul, record_type="MERIT", civilization="CHINESE",
                                  description="善举", weight=100, event_year=1920)
        # The insert recalculated once already; the stored scores are now current.
        assert _events(self.soul) == 1

    def test_unchanged_scores_write_no_soul_row_and_no_event(self):
        before = Soul.all_objects.get(pk=self.soul.pk).merit_score
        with CaptureQueriesContext(connection) as ctx:
            result = LedgerService.recalculate_soul_ledger(self.soul)
        assert result["merit_score"] == before
        assert _soul_updates(ctx.captured_queries) == []
        assert _events(self.soul) == 1

    def test_changed_scores_write_exactly_one_event(self):
        Soul.all_objects.filter(pk=self.soul.pk).update(merit_score=0)
        LedgerService.recalculate_soul_ledger(self.soul)
        assert _events(self.soul) == 2
        assert Soul.all_objects.get(pk=self.soul.pk).merit_score > 0

    def test_a_marked_soul_with_unchanged_scores_is_unmarked_without_an_event(self):
        Soul.all_objects.filter(pk=self.soul.pk).update(needs_ledger_recalculation=True)
        LedgerService.recalculate_soul_ledger(self.soul)
        assert not Soul.all_objects.get(pk=self.soul.pk).needs_ledger_recalculation
        assert _events(self.soul) == 1

    def test_the_daily_task_on_an_unchanged_hall_writes_no_event(self):
        result = recalculate_tenant_ledgers(str(self.tenant.pk))
        assert result["failed"] == [] and result["updated"] == 1
        assert _events(self.soul) == 1


@pytest.mark.django_db
def test_pk_pages_visit_every_soul_once_in_order():
    tenant = Tenant.objects.create(code="LDG_PAGES", display_name="Pages")
    souls = [Soul.objects.create(name=f"页{i}", tenant=tenant) for i in range(5)]
    seen = [s.pk for s in _souls_in_pk_pages(Soul.objects.filter(tenant=tenant), size=2)]
    assert seen == sorted(s.pk for s in souls)


@pytest.mark.django_db
def test_a_run_cut_off_by_the_soft_limit_saves_a_cursor_and_the_next_run_resumes_after_it(monkeypatch):
    """Regression (2026-11-14): the 7200 s limit plus a restart from the first pk skipped the tail every night,
    and the per-soul `except Exception` swallowed SoftTimeLimitExceeded."""
    from celery.exceptions import SoftTimeLimitExceeded

    tenant = Tenant.objects.create(code="LDG_CURSOR", display_name="Cursor")
    pks = sorted(Soul.objects.create(name=f"游{i}", tenant=tenant).pk for i in range(5))
    seen = []

    def cut_at_third(soul):
        if len(seen) == 2 and not hasattr(cut_at_third, "fired"):
            cut_at_third.fired = True
            raise SoftTimeLimitExceeded()
        seen.append(soul.pk)

    monkeypatch.setattr(LedgerService, "recalculate_soul_ledger", staticmethod(cut_at_third))
    with pytest.raises(SoftTimeLimitExceeded):
        recalculate_tenant_ledgers(str(tenant.pk))
    assert seen == pks[:2]

    seen.clear()
    result = recalculate_tenant_ledgers(str(tenant.pk))
    # Tail first, from just after the cursor, then wrap round to the head; every soul exactly once.
    assert seen == pks[2:] + pks[:2]
    assert result["updated"] == 5 and result["failed"] == []

    # A run that finished clears the cursor: the next one starts at the head again.
    seen.clear()
    recalculate_tenant_ledgers(str(tenant.pk))
    assert seen == pks
