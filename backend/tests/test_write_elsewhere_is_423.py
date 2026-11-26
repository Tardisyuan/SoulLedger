"""A write refused because its row is on another master answers 423 `write_elsewhere`, not 500
(the 2026-11-20 error triage (not in this repo) #2; VERIFY-stage4-r3 N-6; apps/core/problems.py `exception_handler`).

`WriteOutsideTransaction` (a write to a shard the request's transaction does not hold) and `StepOutsideTransaction`
(a saga step on such a master) are raised before anything is written and roll the whole transaction back -- safe,
but the officer saw an opaque 500 and error monitoring a false alarm. The HTTP case: the home hall's officer opens
an account for its soul while the soul resides in another civilization, every civilization write-cut.

    scripts/run-gates.sh --tests --ds=config.settings_sharded -m sharded tests/test_write_elsewhere_is_423.py
"""
import pytest
from django.conf import settings

from tests.shard_support import sharded
from tests.test_d6_home_hall_acts_on_a_soul_abroad import _abroad, _client
from tests.test_sharded_writes import cut


@pytest.mark.parametrize("which", ["write", "step"])
def test_the_handler_maps_both_refusals_to_423_write_elsewhere(which):
    from apps.core.problems import exception_handler
    from apps.core.shard_reads import WriteOutsideTransaction
    from apps.tenants.shard_saga import StepOutsideTransaction

    exc = {"write": WriteOutsideTransaction, "step": StepOutsideTransaction}[which]("a write to civ_x")
    response = exception_handler(exc, {})
    assert response is not None, "unmapped: Django answers 500"
    assert (response.status_code, response.data["code"]) == (423, "write_elsewhere"), response.data
    assert "civ_x" not in response.data.get("detail", ""), "the internal message reached the client"


@sharded
def test_the_home_hall_opening_an_account_for_its_soul_abroad_gets_423_and_nothing_is_written():
    from apps.core.shard_reads import CONTROL_ALIAS, read_context
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul
    from apps.tenants.models import ShardOutbox

    w = {"seed": 5, "home": "CHINESE", "residence": "EGYPTIAN", "third": "GREEK", "executed": True,
         "third_cut": True}
    x = _abroad(w)
    soul = x["soul"]

    def rows():
        with read_context(CONTROL_ALIAS):
            return ({(a, s.soul_code, s.contact_email, s.tenant_id) for a in settings.DATABASES
                     for s in Soul._base_manager.using(a).filter(pk=soul.pk)},
                    SoulAccount._base_manager.filter(soul_id=soul.pk).count(),  # control-mastered: one table
                    sum(ShardOutbox._base_manager.using(a).count() for a in settings.DATABASES))

    before = rows()
    client = _client(x["home"], "w423_home")
    with cut():
        r = client.post("/api/v1/soul-accounts/accounts/provision/",
                        {"soul_id": str(soul.pk), "contact_email": "w423@abroad.test"}, format="json")
    assert r.status_code == 423 and r.json()["code"] == "write_elsewhere", (r.status_code, r.content[:500])
    assert rows() == before, "a refused write left something behind"
