"""Stage 4, after the third review (VERIFY-stage4-r3 follow-up), on a world built sharded
(the r3 world: `test_s4_residence_hall_acts_after_the_cut._abroad_after_the_cut`):

  sync     the beat's sync of EVERY shard runs clean while a soul goes abroad and comes home (until 2026-11-21 its
           shard-to-control direction tripped over control's mirror of such a soul; that direction is gone), and the
           residence finds its dispositions.
  advance  asked in the residence's own context (its case on the soul withdrawn, which releases the stop's
           WAITING): it locked the home's plan on the residence's master. Now a message to the plan's master
           (`transfer.PLAN_ADVANCE`), and the soul comes home and the plan completes.

    scripts/run-gates.sh --tests --ds=config.settings_sharded -m sharded tests/test_s4_full_sync_and_advance_from_the_residence.py
"""
import pytest
from django.conf import settings
from django.db import transaction

from tests import test_s4_residence_hall_acts_after_the_cut as r3
from tests.shard_support import sharded
from tests.test_d6_home_hall_acts_on_a_soul_abroad import _audited
from tests.test_sharded_writes import _in_hall, cut

PAIRS = r3.PAIRS  # (CHINESE home, GREEK residence), (EGYPTIAN home, EUROPEAN residence): home sorts first


def _full_sync(where):
    """What beat's `sync_shards` does, every shard; then nothing differs."""
    from apps.core.shard_sync import compare, shard_aliases, sync

    sync(shard_aliases())
    for shard in shard_aliases():
        left = {m._meta.label: diffs for m, (_, _, diffs, _) in compare(shard).items()}
        assert not left, f"{where}: {shard} still differs after the sync: {left}"


@pytest.fixture
def full_sync(monkeypatch):
    """The r3 world's settle steps sync every shard, as the real test box does (all four cut, beat running)."""
    plain = r3._quiet

    def settle(where, mirror=None):
        plain(where)
        _full_sync(where)

    monkeypatch.setattr(r3, "_quiet", settle)


def _primary_is_in(x, hall, where):
    from apps.souls.models import Soul

    primary = Soul._base_manager.using(r3._master(hall)).get(pk=x["soul"].pk)
    assert primary.tenant_id == hall.pk, where


def _release(x, disposition, tag):
    from django.utils import timezone

    from apps.disposition.models import Disposition

    with _in_hall(x["res"]), transaction.atomic():  # the term's start recorded as historical: it has ended
        Disposition.objects.filter(pk=disposition).update(
            term_start_year=timezone.localdate().year - 10, term_start_month=1, term_start_day=1)
    r = x["res_admin"].post(f"/api/v1/disposition/{disposition}/release/", {}, format="json",
                            HTTP_IDEMPOTENCY_KEY=f"r3b-rel-{tag}")
    assert r.status_code == 200, (x["where"], r.status_code, r.content[:2000])


@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_a_full_sync_runs_clean_for_a_soul_abroad_and_home_again_and_the_residence_finds_its_stop(
        pair, full_sync):
    from apps.sentence_plan.models import SentencePlan, SentencePlanStatus

    x = r3._halls(pair)
    where = x["where"]
    tag = f"fs{pair[0][:2]}"
    with cut():
        node = r3._abroad_after_the_cut(x, tag)  # every settle in it synced every shard
        _primary_is_in(x, x["res"], where)
        disposition = node.disposition_id
        # The residence's stop (its join crosses masters): found.
        r = x["res_admin"].get(f"/api/v1/disposition/{disposition}/")
        assert r.status_code == 200, (where, r.status_code, r.content[:500])
        listed = x["res_admin"].get("/api/v1/disposition/").json()["results"]
        assert [d["id"] for d in listed] == [str(disposition)], (where, listed)
        r = x["res_admin"].post(f"/api/v1/disposition/{disposition}/execute/", {}, format="json",
                                HTTP_IDEMPOTENCY_KEY=f"r3b-exec-{tag}")
        assert r.status_code == 200, (where, r.status_code, r.content[:2000])
        r3._quiet(where)
        _release(x, disposition, tag)
        r3._quiet(where)  # the soul came home
        _primary_is_in(x, x["home"], where)
        plan = SentencePlan._base_manager.using(r3._master(x["home"])).get(pk=x["plan"].pk)
        assert plan.status == SentencePlanStatus.COMPLETED, (where, plan.status)


@sharded
@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p[0]}-{p[1]}")
def test_the_residence_withdrawing_its_case_releases_the_waiting_stop_and_the_plan_moves_on_at_home(pair, full_sync):
    from apps.judgment.models import Judgment
    from apps.ledger.services import REBIRTH_CAPABLE_CIVILIZATIONS
    from apps.sentence_plan.models import SentenceNode, SentenceNodeStatus, SentencePlan, SentencePlanStatus
    from apps.souls.models import Soul, SoulState

    x = r3._halls(pair)
    where = x["where"]
    tag = f"wd{pair[0][:2]}"
    with cut():
        node = r3._abroad_after_the_cut(x, tag)
        disposition = node.disposition_id
        assert x["res_admin"].post(f"/api/v1/disposition/{disposition}/execute/", {}, format="json",
                                   HTTP_IDEMPOTENCY_KEY=f"r3b-exec-{tag}").status_code == 200, where
        r3._quiet(where)
        # The residence opens a case on the soul serving there; then the term ends: the stop waits for the case.
        with _in_hall(x["res"]):
            here = Soul._base_manager.using(r3._master(x["res"])).get(pk=x["soul"].pk)
            case = Judgment.objects.create(soul=here, civilization=x["res"].civilization, court="暂居地之案",
                                           tenant=x["res"])
        r3._quiet(where)
        _release(x, disposition, tag)
        r3._quiet(where)
        stop = SentenceNode._base_manager.using(r3._master(x["home"])).get(pk=node.pk)
        assert stop.status == SentenceNodeStatus.WAITING, (where, stop.status)
        assert Soul._base_manager.using(r3._master(x["res"])).get(pk=x["soul"].pk).tenant_id == x["res"].pk, where
        # The residence withdraws its case (its own context): `advance` is the plan's master's to run.
        r = x["res_admin"].delete(f"/api/v1/judgment/{case.pk}/", {"reason": "撤案"}, format="json")
        assert r.status_code == 204, (where, r.status_code, r.content[:2000])
        assert len(r3._pending("sentence_plan.advance")) == 1, where
        assert Judgment._base_manager.using(r3._master(x["res"])).get(pk=case.pk).is_deleted, where
        r3._quiet(where)
        stop = SentenceNode._base_manager.using(r3._master(x["home"])).get(pk=node.pk)
        assert stop.status == SentenceNodeStatus.COMPLETED, (where, stop.status)
        plan = SentencePlan._base_manager.using(r3._master(x["home"])).get(pk=x["plan"].pk)
        assert plan.status == SentencePlanStatus.COMPLETED, (where, plan.status)
        soul = Soul._base_manager.using(r3._master(x["home"])).get(pk=x["soul"].pk)
        want = SoulState.REINCARNATING if pair[0] in REBIRTH_CAPABLE_CIVILIZATIONS else SoulState.SETTLED
        assert (soul.tenant_id, soul.current_state) == (x["home"].pk, want), (where, soul.tenant_id, soul.current_state)
        assert not Soul._base_manager.using(r3._master(x["res"])).filter(pk=soul.pk).exists(), where
        _primary_is_in(x, x["home"], where)
        _audited(where, resource="sentencenode", resource_id=str(node.pk), action="UPDATE")
        assert not any(Judgment._base_manager.using(a).filter(pk=case.pk, is_deleted=False).exists()
                       for a in settings.DATABASES), f"{where}: the withdrawn case stands somewhere"
