"""FANOUT merges that answer like the single database where the stage-3 review (VERIFY-stage3.md sections 2, 4, 6)
found they did not, or found no test that would notice: sliced counts (M2), reverse() / last() / latest(),
values().distinct().count(), a sliced exists(), in_bulk; and the CONTROL_READS set (M9). Each read is asked
twice -- in the one-database form, then sharded and read in FANOUT -- and the answers must be equal.
"""
import re
from pathlib import Path

from django.apps import apps
from django.db.models import F
from django.test import override_settings

from apps.core.shard_reads import CONTROL_READS, FANOUT, read_context
from apps.core.sharding import CONTROL, placement
from tests.test_shard_sync import CIVS, _sync, sharded


def _world(n=3):
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant

    for civ in CIVS:
        hall = Tenant.objects.create(code=f"MRG_{civ[:2]}", display_name=civ, declared_civilization=civ)
        for i in range(n):
            Soul.objects.create(name=f"{'abAB'[i % 4]}-{civ}-{i}", tenant=hall, current_state=SoulState.JUDGING,
                                merit_score=i % 2, death_year=None if i % 3 == 0 else 2000 + i % 2)
    _sync()
    return Soul._base_manager


def both(read):
    with override_settings(SHARDED=False):
        base = read()
    with override_settings(SHARDED=True), read_context(FANOUT):
        cut = read()
    return base, cut


def _same(reads):
    bad = {}
    for name, read in reads.items():
        base, cut = both(read)
        if base != cut:
            bad[name] = (base, cut)
    assert not bad, "\n".join(f"{k}: single {v[0]!r} | fanout {v[1]!r}" for k, v in bad.items())


@sharded
def test_sliced_counts_and_exists_take_the_offset():
    souls = _world()
    n = souls.count()
    _same({f"[{lo}:{hi}].{op}": (lambda lo=lo, hi=hi, op=op: getattr(souls.order_by("pk")[lo:hi], op)())
           for lo, hi in ((0, 3), (2, None), (3, 5), (n - 1, None), (n, None), (n + 2, None), (n - 2, n + 5))
           for op in ("count", "exists")})


@sharded
def test_reverse_last_and_latest_take_the_reversed_order():
    souls = _world()
    _same({
        "last": lambda: souls.order_by("name", "pk").last().pk,
        "last by Meta.ordering": lambda: souls.last().pk,
        "latest": lambda: souls.latest("create_time", "pk").pk,
        "earliest": lambda: souls.earliest("create_time", "pk").pk,
        "reverse()[:4]": lambda: [s.pk for s in souls.order_by("name", "pk").reverse()[:4]],
        "reverse nulls_last": lambda: list(souls.order_by(F("death_year").asc(nulls_last=True), "pk").reverse()
                                           .values_list("pk", flat=True)),
        "reverse default nulls": lambda: list(souls.order_by("-death_year", "pk").reverse()
                                              .values_list("pk", flat=True)[:7]),
    })


@sharded
def test_distinct_and_grouped_counts_leave_the_order_keys_out():
    souls = _world()
    _same({
        "values().distinct().count()": lambda: souls.values("merit_score").distinct().count(),
        "values_list().distinct().count()": lambda: souls.values_list("death_year", flat=True).distinct().count(),
        "ordered values().distinct().count()": lambda: souls.order_by("name").values("merit_score").distinct().count(),
    })


@sharded
def test_in_bulk_reads_the_merge():
    souls = _world()
    ids = list(souls.using("default").order_by("pk").values_list("pk", flat=True))
    _same({
        "by pk": lambda: sorted(map(str, souls.in_bulk(ids[::2]))),
        "all": lambda: sorted(map(str, souls.in_bulk())),
        "empty": lambda: souls.in_bulk([]),
        "by a unique field": lambda: sorted(souls.in_bulk([s.soul_code for s in souls.using("default")[:3]],
                                                          field_name="soul_code")),
    })


# ---- CONTROL_READS ------------------------------------------------------------------------------------------

#: SHARD models read from control after the cut-over (apps/core/shard_reads.py says why, one by one). Adding one
#: hides its shard from every read; removing one sends a query through a control table to a shard.
EXPECTED_CONTROL_READS = {"social.Post", "social.Comment", "social.Reaction", "social.PostMedia",
                          "social.SocialMute", "scheduler.ScheduledJob"}


def test_control_reads_is_the_set_we_think_it_is():
    assert set(CONTROL_READS) == EXPECTED_CONTROL_READS


def _reaches_control(model, lookup):
    for hop in lookup.split("__"):
        f = model._meta.get_field(hop)
        if not f.is_relation:
            return False
        model = f.related_model
        if placement(model) == CONTROL:
            return True
    return False


def test_each_control_read_still_filters_through_a_control_table():
    """The rule: a SHARD model is read from control while its app's code filters it through a CONTROL table (no
    shard has one). Its reason names those lookups; each must reach a CONTROL model from the model, and the
    app's code must still contain one of them -- else the entry is stale and its rows should come from shards."""
    stale = {}
    for label, reason in CONTROL_READS.items():
        model = apps.get_model(label)
        lookups = re.findall(r"\b[a-z][a-z_]*__[a-z_]+\b", reason)
        source = "".join(p.read_text() for p in Path(model._meta.app_config.path).rglob("*.py")
                         if "test" not in p.name and "migrations" not in p.parts)
        if not lookups or not all(_reaches_control(model, lk) for lk in lookups):
            stale[label] = f"its reason names no lookup through a CONTROL table: {lookups}"
        elif not any(lk in source for lk in lookups):
            stale[label] = f"apps/{model._meta.app_label} no longer filters by {lookups}"
    assert not stale, stale
