"""`/me/sentence-plan/` stations carry `elapsed_years` for a curable soul in Tartarus (user 2026-11-07).

The soul App's route lights the thousand-year step and writes 「第 n 年」 from it; the officer's map reads the same
figure from the ledger's SENTENCE reading. One number, so this pins the station to that reading
(`LedgerService._term_start_for` + `sentence_elapsed_years`), and pins the cases that get none: the incurable
(eternal), any other realm, a station not being served, and no recorded term start.
"""
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.ledger.readings import sentence_elapsed_years
from apps.sentence_plan.soul_view import thousand_years_run
from apps.souls.models import Soul
from tests import sentence_plan_support as plan

pytestmark = pytest.mark.django_db


def _soul(start=(1726, 11, 6)):
    gr = plan.tenant("GR_HADES")
    soul = Soul.objects.create(name="塔尔塔罗斯魂", tenant=gr)
    judgment = Judgment.objects.create(soul=soul, tenant=gr, civilization="GREEK", verdict="FAILED", is_final=True,
                                       concluded_at=timezone.now())
    Disposition.objects.create(soul=soul, tenant=gr, judgment=judgment, sentence_years=1000,
                               term_start_year=start[0], term_start_month=start[1], term_start_day=start[2])
    return soul


def _node(realm="GR_TARTARUS", eternal=False):
    return SimpleNamespace(realm_code=realm, is_eternal=eternal)


def test_a_curable_soul_in_tartarus_gets_the_ledgers_years():
    soul = _soul()
    years = thousand_years_run(soul, _node(), "active")
    assert years == sentence_elapsed_years((1726, 11, 6))
    assert years is not None and years >= 299
    assert thousand_years_run(soul, _node(), "waiting") == years


@pytest.mark.parametrize("node, status", [
    (_node(eternal=True), "eternal"),   # incurable: the eternal example of Gorgias 525c, no count
    (_node(eternal=True), "active"),
    (_node("GR_ISLES_OF_THE_BLESSED"), "active"),
    (_node(), "done"),
    (_node(), "pending"),
])
def test_the_rest_get_no_years(node, status):
    assert thousand_years_run(_soul(), node, status) is None


def test_no_term_start_no_years():
    assert thousand_years_run(_soul((None, None, None)), _node(), "active") is None
