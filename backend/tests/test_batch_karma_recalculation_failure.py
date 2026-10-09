"""`SoulRecord.batch()` recalculates karma AFTER its records have committed (kept outside the transaction by user
decision, 2026-10-10). A failure there must not be silent: logged with the soul id, the soul marked
`needs_ledger_recalculation`, the other souls still flushed, the caller told. The periodic ledger task then fixes the
balance and clears the mark."""
import logging
from unittest import mock

import pytest

from apps.ledger.services import LedgerService
from apps.ledger.tasks import recalculate_tenant_ledgers
from apps.souls.models import Soul
from apps.souls.record_models import KarmaRecalculationError, SoulRecord
from tests import sentence_plan_support as plan
from tests.test_event_log_inside_transactions import _fail_event_inserts

pytestmark = pytest.mark.django_db(transaction=True)


def _record(soul, weight=10):
    return SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE", description="善举",
                                     weight=weight, event_year=2000)


def _fail_for(bad):
    real = LedgerService.recalculate_soul_ledger

    def side_effect(soul):
        if soul.pk == bad.pk:
            raise RuntimeError("injected: recalculation failed")
        return real(soul)
    return mock.patch.object(LedgerService, "recalculate_soul_ledger", side_effect=side_effect)


def test_a_failed_deferred_recalculation_is_reported_marked_and_does_not_stop_the_others(caplog):
    tenant = plan.tenant("CN_DIYU")
    bad = Soul.objects.create(name="败", tenant=tenant)
    good = Soul.objects.create(name="成", tenant=tenant)
    with _fail_for(bad), pytest.raises(KarmaRecalculationError) as raised, caplog.at_level(logging.ERROR), \
            SoulRecord.batch():
        _record(bad)
        _record(good)
    assert raised.value.soul_ids == [str(bad.pk)]
    assert SoulRecord.all_objects.filter(soul=bad).count() == 1, "the committed record must stay"
    bad.refresh_from_db()
    good.refresh_from_db()
    assert bad.needs_ledger_recalculation and bad.merit_score == 0
    assert not good.needs_ledger_recalculation and good.merit_score > 0, "the other soul was not flushed"
    assert any(str(bad.pk) in r.getMessage() and r.exc_info for r in caplog.records)


def test_the_ledger_task_recalculates_a_marked_soul_and_clears_the_mark():
    tenant = plan.tenant("CN_DIYU")
    bad = Soul.objects.create(name="败", tenant=tenant)
    with _fail_for(bad), pytest.raises(KarmaRecalculationError), SoulRecord.batch():
        _record(bad, weight=10)
    assert Soul.all_objects.get(pk=bad.pk).needs_ledger_recalculation
    result = recalculate_tenant_ledgers(str(tenant.pk))
    assert result["failed"] == []
    bad.refresh_from_db()
    assert not bad.needs_ledger_recalculation and bad.merit_score > 0


def test_an_event_log_failure_in_the_flush_is_reported_the_same_way():
    tenant = plan.tenant("CN_DIYU")
    soul = Soul.objects.create(name="功过", tenant=tenant)
    hits = []
    with _fail_event_inserts("KARMA_RECALCULATED", hits), pytest.raises(KarmaRecalculationError), \
            SoulRecord.batch():
        _record(soul)
    assert hits
    soul.refresh_from_db()
    assert soul.needs_ledger_recalculation and soul.merit_score == 0


def test_the_blocks_own_exception_wins_over_a_flush_failure():
    tenant = plan.tenant("CN_DIYU")
    bad = Soul.objects.create(name="败", tenant=tenant)
    with _fail_for(bad), pytest.raises(ValueError), SoulRecord.batch():
        _record(bad)
        raise ValueError("the block's own error")
    assert Soul.all_objects.get(pk=bad.pk).needs_ledger_recalculation


def test_a_clean_batch_raises_nothing_and_leaves_no_mark():
    soul = Soul.objects.create(name="清", tenant=plan.tenant("CN_DIYU"))
    with SoulRecord.batch():
        _record(soul)
    soul.refresh_from_db()
    assert not soul.needs_ledger_recalculation and soul.merit_score > 0
