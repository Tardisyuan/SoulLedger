"""Stage 3 changes nothing until a civilization is named in SHARD_READ_CIVS (production has none; neither does
any test settings file but the sharded group's own cut-over cases). Without it:

* a residence read builds the very join it built before stage 3 (same SQL);
* `with_fanout` hands back the queryset it was given;
* the QuerySet hooks do not ask the router anything new: a read with no context is answered from "default"
  (tests/test_shard_router_is_neutral.py holds that for every model and every hint);
* a write of a row read from a shard keeps Django's own answer (the row's database) -- stage 2 untouched.
"""
import pytest
from django.db.models import F, Q
from django.test import override_settings

from apps.core.shard_reads import FANOUT, read_context, route, with_fanout, write_route
from apps.core.tenant import residence_read_q
from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.tenants.models import Tenant


def test_with_fanout_is_the_identity():
    qs = Judgment.objects.all()
    assert with_fanout(qs) is qs


@pytest.mark.django_db
def test_a_residence_read_is_the_join_it_always_was():
    hall = Tenant.objects.create(code="INERT_H", display_name="h", declared_civilization="GREEK")
    q = residence_read_q(Judgment, hall)
    before = Q(soul__home_tenant=hall) & Q(soul__tenant__isnull=False) & Q(tenant=F("soul__tenant"))
    assert str(Judgment.objects.filter(q).query) == str(Judgment.objects.filter(before).query)


def test_routing_answers_nothing_new():
    for model in (Soul, Judgment, Tenant):
        assert route(model, {}) is None
        with read_context(FANOUT):
            assert route(model, {}) is None
    obj = Soul()
    obj._state.db = "civ_greek"
    assert write_route(Soul, {"instance": obj}) is None


def test_the_same_with_shards_configured_but_nothing_cut_over():
    with override_settings(SHARD_READ_CIVS=[]):
        test_routing_answers_nothing_new()
        test_with_fanout_is_the_identity()
