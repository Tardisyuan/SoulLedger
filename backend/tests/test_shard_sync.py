"""Stage 2 (shadow shards): `reconcile_shards` copies control's rows to the civilization shards and finds
every row where the two disagree (docs/audit/2026-11-15-sharding/PLAN.md, D2 / D4 / D6).

A random world -- every SHARD and REFERENCE model gets rows, in halls of all four civilizations, in a
hall of UNKNOWN civilization and with no hall -- is synced, then checked from the outside: each shard
holds exactly its civilization's rows (soul copies only where a cross-civilization dispatch was
executed), the rest are in no shard, and a random `queryset.update()` on control is reported row by row.
The models come from `placement`, never from a list here; the owner of a row from `tenant_path`.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_shard_sync.py

The seed is printed; `SHARD_SYNC_SEED=<n>` replays a world.
"""
import datetime
import decimal
import io
import os
import random
import uuid
from collections import defaultdict

import pytest
from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, models, transaction
from django.db.models import F
from django.test import override_settings
from django.utils import timezone

from apps.core.shard_sync import DEBOUNCE_KEY, compared_models, fingerprints, shard_aliases
from apps.core.sharding import CONTROL, REFERENCE, alias_for_civilization, placement, tenant_path

CIVS = ("CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK")
HAS_SHARDS = all(alias_for_civilization(c) in settings.DATABASES for c in CIVS)


def sharded(test):
    for mark in (pytest.mark.django_db(databases="__all__"),
                 pytest.mark.skipif(not HAS_SHARDS, reason="needs the four civ_* aliases (--ds=config.settings_sharded)"),
                 pytest.mark.sharded):
        test = mark(test)
    return test


# ---- a random world ----------------------------------------------------------------------------------

class World:
    """Rows built field by field from the model metadata and written with bulk_create (no save(), no
    signals: the world is data, not behaviour). A foreign key to a hall-owned model takes a row of the
    same hall, so every row's `tenant_path` ends in the hall it was built for."""

    def __init__(self, rng):
        self.rng = rng
        self.pool = defaultdict(list)  # (model, hall pk) -> rows

    def token(self, n=12):
        return "x" + uuid.UUID(int=self.rng.getrandbits(128)).hex[: max(1, n - 1)]

    def value(self, f):
        rng = self.rng
        if f.choices:
            return rng.choice([c for c, _ in f.flatchoices])
        if isinstance(f, models.BooleanField):
            return rng.random() < 0.5
        if isinstance(f, models.IntegerField):  # every size; small ones meet range checks more often
            return rng.randint(1, 3) if rng.random() < 0.6 else rng.randint(0, 500)
        if isinstance(f, models.DecimalField):
            return decimal.Decimal(rng.randint(0, 10 ** min(4, f.max_digits - f.decimal_places))) / 1
        if isinstance(f, models.FloatField):
            return rng.random() * 100
        if isinstance(f, models.DateTimeField):
            return timezone.now() - datetime.timedelta(seconds=rng.randint(0, 10 ** 7))
        if isinstance(f, models.DateField):
            return datetime.date(2026, 1, 1) - datetime.timedelta(days=rng.randint(0, 3000))
        if isinstance(f, models.TimeField):
            return datetime.time(rng.randint(0, 23), rng.randint(0, 59))
        if isinstance(f, models.DurationField):
            return datetime.timedelta(minutes=rng.randint(1, 9999))
        if isinstance(f, models.UUIDField):
            return uuid.UUID(int=rng.getrandbits(128))
        if isinstance(f, models.GenericIPAddressField):
            return f"10.0.{rng.randint(0, 255)}.{rng.randint(1, 254)}"
        if isinstance(f, models.EmailField):
            return f"{self.token()}@x.test"
        if isinstance(f, models.URLField):
            return f"https://x.test/{self.token()}"
        if isinstance(f, models.JSONField):
            return {"k": self.token()} if rng.random() < 0.5 else {}
        if isinstance(f, models.BinaryField):
            return self.token().encode()
        if isinstance(f, models.FileField):
            return f"f/{self.token()}.txt"
        if isinstance(f, (models.CharField, models.TextField)):
            return self.token(min(f.max_length or 24, 24))
        raise AssertionError(f"no random value for {f.model._meta.label}.{f.name} ({type(f).__name__})")

    def build(self, model, hall, depth):
        Tenant = apps.get_model("tenants", "Tenant")
        path = tenant_path(model)
        first_hop = path.split("__")[0] if path else None
        obj = model()
        for f in model._meta.concrete_fields:
            if isinstance(f, models.AutoField):
                continue
            if f.is_relation:
                target = f.related_model._meta.concrete_model
                if target is Tenant:
                    if hall is None and not f.null:
                        return None  # this model cannot be hall-less
                    val = hall
                elif f.null and (depth > 3 or (f.name != first_hop and self.rng.random() < 0.3)
                                 or (placement(target) == CONTROL and self.rng.random() < 0.5)):
                    val = None
                else:
                    val = self.row(target, hall, depth + 1, fresh=f.one_to_one or target is model)
                    if val is None:
                        if not f.null:
                            return None
                setattr(obj, f.attname, None if val is None else val.pk)
                continue
            if f.null and self.rng.random() < 0.2:
                setattr(obj, f.attname, None)
            elif f.has_default() and not f.choices and self.rng.random() < 0.5:
                setattr(obj, f.attname, f.get_default())
            else:
                setattr(obj, f.attname, self.value(f))
        return obj

    def row(self, model, hall, depth=0, fresh=False):
        key = (model, getattr(hall, "pk", None))
        if self.pool[key] and not fresh and self.rng.random() < 0.6:
            return self.rng.choice(self.pool[key])
        last = None
        for _ in range(60):
            obj = self.build(model, hall, depth)
            if obj is None:
                return None
            try:
                with transaction.atomic(using="default"):
                    model._base_manager.using("default").bulk_create([obj])
            except IntegrityError as e:  # a random value broke a unique / check constraint: draw again
                last = e
                continue
            self.pool[key].append(obj)
            return obj
        if self.pool[key]:  # e.g. one row per hall (a hall's root organization): that one is the row
            return self.rng.choice(self.pool[key])
        raise AssertionError(f"could not build a {model._meta.label} row: {last}")


def _hall(world, civ):
    Tenant = apps.get_model("tenants", "Tenant")
    t = world.build(Tenant, None, 0)
    t.code, t.declared_civilization, t.deleted_at = f"H{world.token(8)}", civ, None
    Tenant._base_manager.bulk_create([t])
    return t


def _dispatch_across(world, soul, target):
    """An executed cross-civilization dispatch, written the way DispatchService.execute leaves it: the soul
    resides in `target` and its owning unit is one of the target hall's (D6)."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.org.models import Organization

    home = soul.home_tenant
    rec = world.row(DispatchRecord, home, fresh=True)
    DispatchRecord._base_manager.filter(pk=rec.pk).update(
        status=DispatchStatus.EXECUTED, soul=soul, source_tenant=home, target_tenant=target, tenant=home,
        target_realm=None)
    type(soul)._base_manager.filter(pk=soul.pk).update(tenant=target, owner_org=world.row(Organization, target).pk)


def _follows_the_soul():
    """Models whose rows reach their hall through the soul (`soul__tenant`, `account__soul__tenant`, ...):
    a move takes them along, and they may still point at the home hall's rows."""
    return [m for m in compared_models() if "soul__" in (tenant_path(m) or "")]


@pytest.fixture
def world():
    seed = int(os.environ.get("SHARD_SYNC_SEED") or random.SystemRandom().randrange(10 ** 6))
    print(f"SHARD_SYNC_SEED={seed}")
    w = World(random.Random(seed))
    halls = [_hall(w, civ) for civ in CIVS for _ in range(w.rng.randint(1, 2))] + [_hall(w, "")]  # "" = UNKNOWN
    for model in compared_models():
        if placement(model) == REFERENCE:
            continue
        for hall in [*halls, None]:
            w.row(model, hall, fresh=True)
    Soul = apps.get_model("souls", "Soul")
    known = [h for h in halls if h.declared_civilization]
    # Souls with nothing that follows them: such a row can point back at the home hall, which the
    # residence shard does not hold -- test_a_row_pointing_out_of_its_shard_is_reported is about that.
    followed = set()
    for m in _follows_the_soul():
        path = tenant_path(m)
        followed |= set(m._base_manager.values_list(path[: path.rindex("soul__") + 4], flat=True))
    movers = list(Soul._base_manager.filter(tenant__in=known).exclude(pk__in=followed).select_related("home_tenant"))
    for soul in w.rng.sample(movers, 3):
        _dispatch_across(w, soul, w.rng.choice([h for h in known if h.civilization != soul.home_tenant.civilization]))
    w.halls = halls
    return w


# ---- what each shard must hold, derived here ---------------------------------------------------------

def _owners(model):
    """{pk: civilization of the hall the control row belongs to, '' for no hall / an UNKNOWN hall};
    None values for a REFERENCE model."""
    Tenant = apps.get_model("tenants", "Tenant")
    rows = model._base_manager.values_list("pk", *([tenant_path(model)] if placement(model) != REFERENCE else []))
    if placement(model) == REFERENCE:
        return {str(r[0]): None for r in rows}
    civ = {t.pk: (t.civilization if t.civilization in CIVS else "") for t in Tenant._base_manager.all()}
    return {str(pk): civ.get(hall, "") for pk, hall in rows}


def _executed_cross_civ(soul_pk, civ):
    """The soul has an executed dispatch whose other end is in `civ`, i.e. it resides elsewhere and `civ`
    is home, or the reverse."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    for rec in DispatchRecord._base_manager.filter(soul_id=soul_pk, status=DispatchStatus.EXECUTED).select_related(
            "source_tenant", "target_tenant"):
        ends = {rec.source_tenant.civilization, rec.target_tenant.civilization}
        if len(ends) == 2 and civ in ends:
            return True
    return False


def _sync():
    call_command("reconcile_shards", "--all", "--fix", stdout=io.StringIO())


def _reconcile(*args):
    out = io.StringIO()
    try:
        call_command("reconcile_shards", *args, stdout=out)
        return 0, out.getvalue()
    except CommandError:
        return 1, out.getvalue()


def _shard_pks(alias, model):
    return {str(pk) for pk in model._base_manager.using(alias).values_list("pk", flat=True)}


# ---- (a) (b) (c) ---------------------------------------------------------------------------------------

@sharded
def test_after_sync_each_shard_holds_its_civilization_and_reconcile_is_clean(world):
    _sync()
    code, out = _reconcile("--all")
    assert code == 0, out                                                                       # (a)

    Soul = apps.get_model("souls", "Soul")
    models_compared = [m for m in apps.get_models(include_auto_created=True)
                       if m._meta.managed and not m._meta.proxy and placement(m) != CONTROL]
    with_data = {m._meta.label for m in models_compared
                 if any(m._base_manager.using(alias_for_civilization(c)).exists() for c in CIVS)}
    assert with_data == {m._meta.label for m in models_compared}, "models the world left empty in every shard"

    nowhere, stray = [], []
    for model in models_compared:
        owners = _owners(model)
        everywhere = set(owners)
        for civ in CIVS:
            alias = alias_for_civilization(civ)
            held = _shard_pks(alias, model)
            if owners and next(iter(owners.values())) is None:  # REFERENCE: every row, every shard
                assert held == everywhere, (alias, model._meta.label)
                continue
            want = {pk for pk, c in owners.items() if c == civ}
            if model is Soul:
                want |= {pk for pk in everywhere if owners[pk] != civ and _executed_cross_civ(pk, civ)}
            assert held >= want, (alias, model._meta.label, sorted(want - held)[:5])             # nothing missing
            stray += [(alias, model._meta.label, pk, owners.get(pk)) for pk in held - want]        # (b)
        nowhere += [(model._meta.label, pk) for pk, c in owners.items() if c == ""
                    and any(pk in _shard_pks(alias_for_civilization(x), model) for x in CIVS)]     # (c)
    assert not stray, stray[:10]
    assert not nowhere, nowhere[:10]
    # The world had what (b) and (c) are about.
    assert any("" in _owners(m).values() for m in models_compared)
    assert sum(_executed_cross_civ(s.pk, s.home_tenant.civilization) for s in Soul._base_manager.filter(home_tenant__isnull=False).select_related("home_tenant")) >= 3


# ---- (d) a write that sends no signal ------------------------------------------------------------------

def _reported(out):
    """{(model label, pk)} named on a difference line."""
    found = set()
    for line in out.splitlines():
        parts = line.split()
        if parts[:1] == ["still"]:
            parts = parts[1:]
        if len(parts) > 2 and parts[1].startswith("pk="):
            found.add((parts[0], parts[1][3:]))
    return found


def _snapshot(aliases):
    return {(a, m._meta.label): fingerprints(m._base_manager.using(a).all()) for a in aliases for m in compared_models()}


def _changeable(model):
    """Columns an update can change without moving rows to another shard (a hall's declared civilization
    would move every row of the hall, which is a different test)."""
    return [f for f in model._meta.concrete_fields
            if not f.is_relation and not f.primary_key and not getattr(f, "auto_now", False)
            and not getattr(f, "auto_now_add", False) and not f.unique
            and f.name != "declared_civilization"]


@sharded
def test_a_random_update_on_control_is_reported_exactly_and_fixed(world):
    _sync()
    rng = world.rng
    # A model with rows in a shard and a column to change; queryset.update() sends no signal and leaves
    # update_time alone.
    civ = rng.choice(CIVS)
    alias = alias_for_civilization(civ)
    candidates = [m for m in compared_models() if _changeable(m) and m._base_manager.using(alias).count() >= 2]
    model = rng.choice(candidates)
    field = rng.choice(_changeable(model))
    held = sorted(_shard_pks(alias, model))
    new = world.value(field)
    picked = [pk for pk in rng.sample(held, rng.randint(1, min(3, len(held))))
              if model._base_manager.filter(pk=pk).values_list(field.attname, flat=True).get() != new]
    if not picked:
        pytest.skip(f"seed drew a value equal to every picked row's ({model._meta.label}.{field.name})")
    print(f"update {model._meta.label}.{field.name} on {picked}")
    model._base_manager.filter(pk__in=picked).update(**{field.attname: new})
    others = [a for a in ["default", *shard_aliases()] if a != alias]
    before = _snapshot(others)

    code, out = _reconcile("--civ", civ)
    assert code == 1
    assert _reported(out) == {(model._meta.label, str(pk)) for pk in picked}, out

    code, out = _reconcile("--civ", civ, "--fix")
    assert code == 0, out
    assert _reconcile("--civ", civ)[0] == 0
    assert _snapshot(others) == before, "a fix on one shard changed another database"


@sharded
def test_dropping_a_row_from_a_shard_leaves_control_alone(world):
    """The fix deletes on the shard without the bare-id delete rules (apps/core/bare_ids.py), which would
    CASCADE the soul's login account and SET_NULL its other bare ids on every alias."""
    from apps.soul_accounts.models import SoulAccount

    _sync()
    Soul = apps.get_model("souls", "Soul")
    account = next(a for a in SoulAccount._base_manager.filter(soul__tenant__isnull=False).select_related("soul__tenant")
                   if a.soul.tenant.civilization in CIVS and a.soul.tenant_id == a.soul.home_tenant_id)
    soul, here = account.soul, alias_for_civilization(account.soul.tenant.civilization)
    elsewhere = next(h for h in world.halls if h.declared_civilization and h.civilization != soul.tenant.civilization)
    from apps.org.models import Organization

    Soul._base_manager.filter(pk=soul.pk).update(
        tenant=elsewhere, home_tenant=elsewhere, owner_org=world.row(Organization, elsewhere).pk)
    control_before = _snapshot(["default"])

    code, out = _reconcile("--all", "--fix")
    # What may be left is a row that followed the soul and still points into its old hall (dangling).
    left = [line for line in out.splitlines() if line.startswith("still")]
    assert all("not copied" in line and f"pk={soul.pk} " not in line for line in left), out
    assert code == (1 if left else 0), out
    assert (Soul._meta.label, str(soul.pk)) in _reported(out)
    assert not Soul._base_manager.using(here).filter(pk=soul.pk).exists()
    assert _snapshot(["default"]) == control_before
    assert SoulAccount._base_manager.filter(pk=account.pk, soul_id=soul.pk).exists()


@sharded
def test_shard_to_control_brings_a_shard_write_back(world):
    _sync()
    civ = world.rng.choice(CIVS)
    alias = alias_for_civilization(civ)
    Soul = apps.get_model("souls", "Soul")
    soul = Soul._base_manager.using(alias).filter(tenant__in=[h.pk for h in world.halls if h.civilization == civ]).first()
    Soul._base_manager.using(alias).filter(pk=soul.pk).update(name="written-on-the-shard")

    code, out = _reconcile("--civ", civ, "--direction", "shard-to-control")
    assert code == 1 and _reported(out) == {(Soul._meta.label, str(soul.pk))}, out
    assert _reconcile("--civ", civ, "--direction", "shard-to-control", "--fix")[0] == 0
    assert Soul._base_manager.get(pk=soul.pk).name == "written-on-the-shard"
    assert _reconcile("--all")[0] == 0


@sharded
def test_a_row_pointing_out_of_its_shard_is_reported(world):
    """A row the shard cannot hold -- a constrained key names a row of another civilization, here a soul
    moved with a rebirth application whose workflow stays in the home hall -- is reported and not
    copied; the shard stays consistent and reconcile does not exit 0 until somebody decides."""
    from apps.soul_accounts.models import RebirthApplication

    app = RebirthApplication._base_manager.filter(
        soul__tenant__isnull=False, workflow__isnull=False, soul__tenant=F("workflow__tenant")).select_related(
        "soul__home_tenant").first()
    soul = app.soul
    target = next(h for h in world.halls if h.declared_civilization and h.civilization != soul.tenant.civilization)
    _dispatch_across(world, soul, target)
    there = alias_for_civilization(target.civilization)

    code, out = _reconcile("--all", "--fix")
    assert code == 1
    assert f"{RebirthApplication._meta.label} pk={app.pk} not copied to {there}" in out, out
    assert not RebirthApplication._base_manager.using(there).filter(pk=app.pk).exists()
    assert type(soul)._base_manager.using(there).filter(pk=soul.pk).exists()


# ---- production shape and the on-commit trigger (no shard databases needed) ----------------------------

@pytest.mark.django_db
def test_without_shard_databases_the_command_and_the_task_do_nothing():
    from apps.tenants.tasks import sync_shards

    with override_settings(DATABASES={"default": settings.DATABASES["default"]}):
        assert shard_aliases() == []
        out = io.StringIO()
        call_command("reconcile_shards", "--all", "--fix", stdout=out)
        assert "no shard database is configured" in out.getvalue()
        assert sync_shards() == {"skipped": "no_shard_databases"}


@pytest.mark.django_db
def test_one_commit_burst_queues_one_sync(monkeypatch, django_capture_on_commit_callbacks):
    from django.core.cache import cache

    from apps.realms.models import Realm
    from apps.tenants import tasks
    from apps.tenants.models import Tenant

    queued = []
    monkeypatch.setattr(tasks.sync_shards, "apply_async", lambda **kw: queued.append(kw))
    cache.delete(DEBOUNCE_KEY)
    hall = Tenant.objects.create(code="SYNC_H", display_name="h")
    only_default = {"default": settings.DATABASES["default"]}
    with_shard = {**only_default, "civ_greek": settings.DATABASES["default"]}

    def realms(n):
        for _ in range(n):
            Realm.objects.create(realm_code=f"R{uuid.uuid4().hex[:8]}", name_en="r", name_local="r",
                                 civilization="GREEK", realm_type="HELL", tenant=hall)

    def ours(callbacks):
        return [c for c in callbacks if getattr(c, "__module__", "") == "apps.core.shard_sync"]

    def committed():
        # The test's own transaction never commits; a real commit empties run_on_commit.
        conn = transaction.get_connection()
        conn.run_on_commit[:] = [c for c in conn.run_on_commit if c[1].__module__ != "apps.core.shard_sync"]

    committed()  # creating the hall queued one already when this settings file has shards
    with override_settings(DATABASES=with_shard):
        with django_capture_on_commit_callbacks(execute=True) as burst, transaction.atomic():
            realms(3)
        assert len(ours(burst)) == 1 and len(queued) == 1
        committed()
        with django_capture_on_commit_callbacks(execute=True) as later:
            realms(2)  # another commit inside the debounce window
        assert len(ours(later)) == 1 and len(queued) == 1
        committed()
        cache.delete(DEBOUNCE_KEY)  # the window passed
        with django_capture_on_commit_callbacks(execute=True):
            realms(1)
        assert len(queued) == 2
        committed()
    with override_settings(DATABASES=only_default):
        with django_capture_on_commit_callbacks(execute=True) as quiet:
            realms(1)
        assert not ours(quiet)

