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
import copy
import datetime
import decimal
import io
import os
import random
import uuid
from collections import defaultdict
from contextlib import ExitStack

import pytest
from django.apps import apps
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, models, transaction
from django.db.models import F
from django.test import override_settings
from django.utils import timezone

from apps.core.shard_sync import DEBOUNCE_KEY, DEBOUNCE_SECONDS, compared_models, fingerprints, shard_aliases
from apps.core.sharding import CONTROL, REFERENCE, SHARD, alias_for_civilization, placement, tenant_path

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
    same hall, so every row's `tenant_path` ends in the hall it was built for. That makes "nothing is
    dangling" (a) true by construction for the constrained keys; what keeps them inside one civilization
    is the pre_save guard (`apps.core.sharding.same_civilization_keys`), and
    `test_every_constrained_key_of_the_world_refuses_another_civilization` points each one across."""

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
        self.same_owner(model, obj, first_hop)
        return self.columns(obj)

    @staticmethod
    def same_owner(model, obj, first_hop):
        """A row owned through a key (`soul__tenant`) whose constrained key names a row owned through the same key
        names that row of the same owner: the product writes both from one soul (CooldownShorteningRequest's
        `application` is its own soul's RebirthApplication). Drawn apart, each followed its own soul when one of
        the two moved, and the request named an application its shard does not hold: "not copied ... dangling"
        on a seed that moved one of them (gate run 2026-11-16)."""
        from apps.core.bare_ids import is_bare

        if not first_hop:
            return
        hop = model._meta.get_field(first_hop)
        if hop.related_model is not apps.get_model("souls", "Soul"):  # only a soul moves between shards
            return
        for f in model._meta.concrete_fields:
            target = f.related_model
            if (f.is_relation and f.name != first_hop and not is_bare(f) and getattr(obj, f.attname) is not None
                    and placement(target) == SHARD and (tenant_path(target) or "").split("__")[0] == first_hop):
                owner = target._base_manager.filter(pk=getattr(obj, f.attname)).values_list(hop.attname, flat=True)
                setattr(obj, hop.attname, owner.get())

    def columns(self, obj, settle=False):
        """Draw the non-key columns. `settle`: NULL or the default where there is one (a check constraint such
        as judgment_duat_stage_only_egyptian wants the blank value outside one civilization)."""
        for f in obj._meta.concrete_fields:
            if isinstance(f, models.AutoField) or f.is_relation:
                continue
            if f.null and (settle or self.rng.random() < 0.2):
                setattr(obj, f.attname, None)
            elif f.has_default() and (settle or (not f.choices and self.rng.random() < 0.5)):
                setattr(obj, f.attname, f.get_default())
            else:
                setattr(obj, f.attname, self.value(f))
        return obj

    def row(self, model, hall, depth=0, fresh=False):
        key = (model, getattr(hall, "pk", None))
        if self.pool[key] and not fresh and self.rng.random() < 0.6:
            return self.rng.choice(self.pool[key])
        last = obj = None
        for attempt in range(60):
            # A refused row is first tried again with the same keys and settled columns: drawing everything again
            # built a new set of related rows per attempt, and the world grew to ~72k rows, most of them retry
            # debris of a check constraint on one column (2026-11-16). The next attempt draws the keys too (a
            # constraint across keys -- exactly one target, one root unit per hall -- needs other keys).
            if attempt % 2 == 0:
                obj = self.build(model, hall, depth)
                if obj is None:
                    return None
            else:
                self.columns(obj, settle=True)
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
    resides in `target`, its owning unit is one of the target hall's (D6), and the record -- owned by the
    home hall -- names a realm of the target hall (DispatchRecord.target_realm crosses by design)."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.org.models import Organization
    from apps.realms.models import Realm

    home = soul.home_tenant
    rec = world.row(DispatchRecord, home, fresh=True)
    DispatchRecord._base_manager.filter(pk=rec.pk).update(
        status=DispatchStatus.EXECUTED, soul=soul, source_tenant=home, target_tenant=target, tenant=home,
        source_owner_org=soul.owner_org_id, target_realm=world.row(Realm, target).pk)
    type(soul)._base_manager.filter(pk=soul.pk).update(tenant=target, owner_org=world.row(Organization, target).pk)
    return rec


def _return_home(world, soul, rec):
    """`DispatchService.end_residence`: the record EXECUTED -> RETURNED, the soul back in its home hall with
    its old unit. Rows the residence wrote while it was there (its records, events, judgments...) stay in
    the residence hall and keep pointing at the soul, which that shard no longer holds."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    DispatchRecord._base_manager.filter(pk=rec.pk).update(status=DispatchStatus.RETURNED)
    source_owner_org = DispatchRecord._base_manager.values_list("source_owner_org", flat=True).get(pk=rec.pk)
    type(soul)._base_manager.filter(pk=soul.pk).update(tenant=soul.home_tenant_id, owner_org=source_owner_org)


def _crossing_edges():
    """SHARD -> SHARD keys without a constraint: the ones whose two rows may be in different civilizations
    (tests/tenancy_fk_inventory.py, "crosses by design" / "may cross"). Derived from the schema."""
    from apps.core.bare_ids import bare_ids_to

    return sorted((f for fields in bare_ids_to().values() for f in fields
                   if not f.model._meta.auto_created and placement(f.model) == SHARD
                   and placement(f.related_model) == SHARD), key=lambda f: (f.model._meta.label, f.name))


def _point_across(world, f, source_halls, target_halls, target_pk=None):
    """Point one existing `f.model` row of a hall in `source_halls` at a `f.related_model` row of a hall in
    `target_halls` (or at `target_pk`). False when no row would take it (a unique key, no rows)."""
    rows = [r for h in source_halls for r in world.pool[(f.model, h.pk)]]
    targets = [target_pk] if target_pk else [r.pk for h in target_halls for r in world.pool[(f.related_model, h.pk)]]
    world.rng.shuffle(rows)
    for row in rows[:20]:
        try:
            with transaction.atomic(using="default"):
                f.model._base_manager.filter(pk=row.pk).update(**{f.attname: world.rng.choice(targets)})
            return True
        except IntegrityError:
            continue
    return False


def _seed():
    seed = int(os.environ.get("SHARD_SYNC_SEED") or random.SystemRandom().randrange(10 ** 6))
    print(f"SHARD_SYNC_SEED={seed}")
    return seed


def _seeded(request, seed):
    """The seed in this test's report (a failure shows it), not only in the captured output of whichever test
    built the module's world: a gate run lost it that way (2026-11-16)."""
    request.node.add_report_section("setup", "seed", f"SHARD_SYNC_SEED={seed}")


def _built(seed):
    try:
        return _build_world(seed)
    except BaseException as e:
        e.add_note(f"SHARD_SYNC_SEED={seed}")
        raise


@pytest.fixture
def fresh_world(request):
    """A fresh world in the test's own transaction (default only: the guard test runs in every suite)."""
    seed = _seed()
    _seeded(request, seed)
    return _built(seed)


@pytest.fixture(scope="module")
def _synced_world(django_db_setup, django_db_blocker):
    """One world per module and xdist worker, synced to the shards once (2026-11-16: built per test, the six
    tests that use it took 35+ minutes on PostgreSQL). Built inside an atomic block on every alias that is
    rolled back at the end of the module -- what Django's TestCase does for setUpTestData -- so each test's
    own transaction is a savepoint inside it, and whatever a test writes is gone before the next one."""
    aliases, stack = list(settings.DATABASES), ExitStack()
    with django_db_blocker.unblock():
        for alias in aliases:
            stack.enter_context(transaction.atomic(using=alias))
        seed = _seed()
        try:
            w = _built(seed)
            w.sync_out = _sync()
        except BaseException as e:
            e.add_note(f"SHARD_SYNC_SEED={seed}")
            for alias in aliases:
                transaction.set_rollback(True, using=alias)
            stack.close()
            raise
    yield w
    with django_db_blocker.unblock():
        for alias in aliases:
            transaction.set_rollback(True, using=alias)
        stack.close()


@pytest.fixture
def world(_synced_world, request):
    """The module's synced world, with the test's own pool (a test that adds rows adds them to its copy, and
    they are rolled back) and its own random draws, seeded from the world's seed and the test's name."""
    _seeded(request, _synced_world.seed)
    w = copy.copy(_synced_world)
    w.pool = defaultdict(list, {k: list(v) for k, v in _synced_world.pool.items()})
    w.rng = random.Random(f"{w.seed}:{request.node.name}")
    return w


def _build_world(seed):
    w = World(random.Random(seed))
    w.seed = seed
    halls = [_hall(w, civ) for civ in CIVS for _ in range(w.rng.randint(1, 2))] + [_hall(w, "")]  # "" = UNKNOWN
    for model in compared_models():
        if placement(model) == REFERENCE:
            continue
        for hall in [*halls, None]:
            w.row(model, hall, fresh=True)
    Soul = apps.get_model("souls", "Soul")
    known = [h for h in halls if h.declared_civilization]

    def abroad(civ):
        return [h for h in known if h.civilization != civ]

    # Every key that may cross civilizations does, on some row: a dispatch to another civilization's realm,
    # a joint-judgment seat (and its actor) of another civilization, a workflow segment and its stations
    # run by another civilization's realm, rows pointing at another civilization's soul...
    w.crossed = []
    for f in _crossing_edges():
        # Every civilization in turn, from a random one: a single draw found no row to re-point on some seeds
        # (SHARD_SYNC_SEED=971633, 2026-11-16), and the world crossed fewer keys than exist.
        civs = sorted({h.civilization for h in known})
        w.rng.shuffle(civs)
        if any(_point_across(w, f, [h for h in known if h.civilization == civ], abroad(civ)) for civ in civs):
            w.crossed.append(f)
    # One soul goes and comes back. While it was away its residence wrote rows pointing at it; they stay
    # there. First, so the re-pointing cannot pick another mover's dispatch record and take its residence.
    movers = list(Soul._base_manager.filter(tenant__in=known, tenant=F("home_tenant")).select_related("home_tenant"))
    soul, *moved = w.rng.sample(movers, 4)
    rec = _dispatch_across(w, soul, w.rng.choice(abroad(soul.home_tenant.civilization)))
    residence = apps.get_model("tenants", "Tenant")._base_manager.get(
        pk=type(rec)._base_manager.values_list("target_tenant", flat=True).get(pk=rec.pk))
    for f in _crossing_edges():
        if f.related_model is Soul:
            _point_across(w, f, [residence], [], target_pk=soul.pk)
    _return_home(w, soul, rec)
    # Souls that move and stay, rows that followed them included (a rebirth application keeps its home workflow).
    for mover in moved:
        _dispatch_across(w, mover, w.rng.choice(abroad(mover.home_tenant.civilization)))
    w.returned = soul.pk
    w.halls = halls
    # A soul with no hall whose home hall is set: in no shard, its home's included (D2; (c) checks it).
    hallless = Soul._base_manager.filter(tenant__isnull=True).first()
    Soul._base_manager.filter(pk=hallless.pk).update(home_tenant=w.rng.choice(known))
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
    out = io.StringIO()
    try:
        call_command("reconcile_shards", "--all", "--fix", stdout=out)
    except CommandError as e:
        raise AssertionError(f"{e}\n{out.getvalue()}") from None
    return out.getvalue()


def _reconcile(*args):
    out = io.StringIO()
    try:
        call_command("reconcile_shards", *args, stdout=out)
        return 0, out.getvalue()
    except CommandError:
        return 1, out.getvalue()


def _shard_pks(alias, model):
    return {str(pk) for pk in model._base_manager.using(alias).order_by().values_list("pk", flat=True)}


# ---- (a) (b) (c) ---------------------------------------------------------------------------------------

#: Every model with a table on a shard, derived here and not from `compared_models()` (a model the sync
#: forgot must still be a case). Labels, so the cases are named and xdist spreads them over its workers.
MODELS_ON_SHARDS = sorted(m._meta.label for m in apps.get_models(include_auto_created=True)
                          if m._meta.managed and not m._meta.proxy and placement(m) != CONTROL)


def _model(label):
    return next(m for m in apps.get_models(include_auto_created=True) if m._meta.label == label)


@sharded
@pytest.mark.parametrize("label", MODELS_ON_SHARDS)
def test_after_sync_each_shard_holds_its_civilization_of_the_model(world, label):
    """(b) (c), and nothing missing, one model per case: what each shard holds of it after the sync."""
    model = _model(label)
    Soul = apps.get_model("souls", "Soul")
    owners = _owners(model)
    everywhere = set(owners)
    held = {civ: _shard_pks(alias_for_civilization(civ), model) for civ in CIVS}
    assert any(held.values()), f"{label}: the world left it empty in every shard"
    stray = []
    for civ in CIVS:
        alias = alias_for_civilization(civ)
        if owners and next(iter(owners.values())) is None:  # REFERENCE: every row, every shard
            assert held[civ] == everywhere, (alias, label)
            continue
        want = {pk for pk, c in owners.items() if c == civ}
        if model is Soul:
            want |= {pk for pk in everywhere if owners[pk] != civ and _executed_cross_civ(pk, civ)}
        assert held[civ] >= want, (alias, label, sorted(want - held[civ])[:5])                    # nothing missing
        stray += [(alias, label, pk, owners.get(pk)) for pk in held[civ] - want]                   # (b)
    nowhere = [(label, pk) for pk, c in owners.items() if c == "" and any(pk in held[x] for x in CIVS)]  # (c)
    assert not stray, stray[:10]
    assert not nowhere, nowhere[:10]


@sharded
def test_after_sync_reconcile_is_clean_and_the_world_had_what_it_checks(world):
    code, out = _reconcile("--all")
    assert code == 0, out                                                                       # (a)
    # Nothing left out: every key that may cross civilizations is a bare id, so no row is "dangling".
    assert "not copied" not in world.sync_out + out, world.sync_out
    assert world.crossed == _crossing_edges(), "the world did not cross every crossing key"

    Soul = apps.get_model("souls", "Soul")
    # The world had what (b) and (c) are about, and a soul back from residence is in its home shard only.
    assert any("" in _owners(_model(label)).values() for label in MODELS_ON_SHARDS)
    back = Soul._base_manager.select_related("home_tenant").get(pk=world.returned)
    assert [c for c in CIVS if Soul._base_manager.using(alias_for_civilization(c)).filter(pk=back.pk).exists()] == [
        back.home_tenant.civilization]
    assert sum(_executed_cross_civ(s.pk, s.home_tenant.civilization) for s in Soul._base_manager.filter(home_tenant__isnull=False).select_related("home_tenant")) >= 3


@sharded
def test_a_constrained_key_between_two_rows_of_souls_names_one_soul(world):
    """The world writes what the product writes (World.same_owner): a row owned through its soul whose constrained
    key names another row owned through a soul names that soul's own row. Drawn apart, a move of one of the two
    souls split them across shards, and the sync reported the row "not copied" on a few seeds only."""
    from apps.core.bare_ids import is_bare

    checked = []
    for model in apps.get_models():
        hop = (tenant_path(model) or "").split("__")[0]
        if placement(model) != SHARD or not hop or model._meta.get_field(hop).related_model is not apps.get_model(
                "souls", "Soul"):
            continue
        own = model._meta.get_field(hop).attname
        for f in model._meta.concrete_fields:
            if (f.is_relation and f.name != hop and not is_bare(f) and placement(f.related_model) == SHARD
                    and (tenant_path(f.related_model) or "").split("__")[0] == hop):
                pairs = list(model._base_manager.filter(**{f"{f.name}__isnull": False}).values_list(own, f"{f.name}__{hop}"))
                assert pairs, f"{model._meta.label}.{f.name}: no row (SHARD_SYNC_SEED={world.seed})"
                apart = [p for p in pairs if p[0] != p[1]]
                assert not apart, (f"{model._meta.label}.{f.name}", apart[:3], f"SHARD_SYNC_SEED={world.seed}")
                checked.append(f"{model._meta.label}.{f.name}")
    assert "soul_accounts.CooldownShorteningRequest.application" in checked, checked


@pytest.mark.django_db
def test_every_constrained_key_of_the_world_refuses_another_civilization(fresh_world):
    """The keys the world keeps inside one hall, pointed across: every constrained SHARD -> SHARD key that is
    not the row's own hall hop (derived, not listed) is refused at save time when it names a row of another
    civilization, and accepted for a row of the same hall. Runs without shard databases."""
    from django.db.models.signals import pre_save

    from apps.core.sharding import CrossCivilizationKeyError, _refuse_cross_civilization, same_civilization_keys

    world = fresh_world
    keys = [(m, f) for m in compared_models() for f in same_civilization_keys(m)]
    assert len(keys) >= 50, len(keys)
    wired = {r[0][0] for r in pre_save.receivers}
    assert {f"same_civ:{m._meta.label}" for m, _ in keys} <= wired, "a model with such a key has no guard"
    known = [h for h in world.halls if h.declared_civilization]
    accepted, untried = [], []
    for model, f in keys:
        tried = False
        for here in world.rng.sample(known, len(known)):
            rows = world.pool[(model, here.pk)]
            same = world.pool[(f.related_model, here.pk)]
            other = [r for h in known if h.civilization != here.civilization for r in world.pool[(f.related_model, h.pk)]]
            if not (rows and same and other):
                continue
            obj = model._base_manager.get(pk=world.rng.choice(rows).pk)
            setattr(obj, f.attname, world.rng.choice(same).pk)
            # Only this key: the world moves souls afterwards, so a row's other keys may already be stale.
            _refuse_cross_civilization(model, obj, update_fields={f.name})  # same hall: accepted
            setattr(obj, f.attname, world.rng.choice(other).pk)
            try:
                _refuse_cross_civilization(model, obj, update_fields={f.name})
            except CrossCivilizationKeyError as e:
                assert list(e.message_dict) == [f.name], e.message_dict
            else:
                accepted.append(f"{model._meta.label}.{f.name}")
            tried = True
            break
        if not tried:
            untried.append(f"{model._meta.label}.{f.name}")
    assert not accepted, f"pointed at another civilization and accepted: {accepted}"
    assert not untried, f"the world had no rows to point across: {untried}"


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
    rng = world.rng
    # A model with rows in a shard and a column to change; queryset.update() sends no signal and leaves
    # update_time alone.
    civ = rng.choice(CIVS)
    alias = alias_for_civilization(civ)
    candidates = [m for m in compared_models() if _changeable(m) and m._base_manager.using(alias).count() >= 2]
    picked = []
    for _ in range(50):  # a draw equal to every picked row's value (a boolean, `{}`) is drawn again, never skipped
        model = rng.choice(candidates)
        field = rng.choice(_changeable(model))
        held = sorted(_shard_pks(alias, model))
        new = world.value(field)
        picked = [pk for pk in rng.sample(held, rng.randint(1, min(3, len(held))))
                  if model._base_manager.filter(pk=pk).values_list(field.attname, flat=True).get() != new]
        if picked:
            break
    assert picked, "fifty draws and every one equal to the rows' values"
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
    # Rows that followed the soul and still point into its old hall are bare ids: nothing is left.
    assert code == 0 and "still" not in out, out
    assert (Soul._meta.label, str(soul.pk)) in _reported(out)
    assert not Soul._base_manager.using(here).filter(pk=soul.pk).exists()
    assert _snapshot(["default"]) == control_before
    assert SoulAccount._base_manager.filter(pk=account.pk, soul_id=soul.pk).exists()


@sharded
def test_shard_to_control_brings_a_shard_write_back(world):
    civ = world.rng.choice(CIVS)
    alias = alias_for_civilization(civ)
    Soul = apps.get_model("souls", "Soul")
    soul = Soul._base_manager.using(alias).filter(tenant__in=[h.pk for h in world.halls if h.civilization == civ]).first()
    Soul._base_manager.using(alias).filter(pk=soul.pk).update(name="written-on-the-shard")

    code, out = _reconcile("--civ", civ, "--direction", "shard-to-control")
    assert code == 1 and _reported(out) == {(Soul._meta.label, str(soul.pk))}, out
    with override_settings(SHARD_READ_CIVS=[civ], SHARD_WRITE_CIVS=[civ]):  # stage 4: the shard is the master
        assert _reconcile("--civ", civ, "--direction", "shard-to-control", "--fix")[0] == 0
    assert Soul._base_manager.get(pk=soul.pk).name == "written-on-the-shard"
    assert _reconcile("--all")[0] == 0


@sharded
def test_shard_to_control_fix_is_refused_while_control_is_the_master():
    """VERIFY-stage2 item 2 (the reviewer's probe, inverted): before a civilization's writes are cut over,
    `--direction shard-to-control --fix` would revert control's newer value and raw-delete its new row."""
    from apps.realms.models import Realm
    from apps.tenants.models import Tenant

    hall = Tenant.objects.create(code="S2C_GR", display_name="g", declared_civilization="GREEK")

    def realm(name):
        return Realm.all_objects.create(realm_code=f"R{uuid.uuid4().hex[:8]}", name_en=name, name_local=name,
                                        civilization="GREEK", realm_type="HELL", tenant=hall)

    kept = realm("before")
    _sync()
    Realm.all_objects.filter(pk=kept.pk).update(name_en="newer-on-control")
    fresh = realm("written-after-the-sync")
    out = io.StringIO()
    with pytest.raises(CommandError, match=r"refused for \['GREEK'\]: not in SHARD_WRITE_CIVS"):
        call_command("reconcile_shards", "--civ", "GREEK", "--direction", "shard-to-control", "--fix", stdout=out)
    assert Realm.all_objects.get(pk=kept.pk).name_en == "newer-on-control"
    assert Realm.all_objects.filter(pk=fresh.pk).exists()
    with pytest.raises(CommandError, match="refused"):  # --all names it too
        call_command("reconcile_shards", "--all", "--direction", "shard-to-control", "--fix", stdout=io.StringIO())
    assert _reconcile("--civ", "GREEK", "--direction", "shard-to-control")[0] == 1  # reporting is still allowed


@sharded
def test_the_retry_window_rechecks_and_reports_only_what_did_not_settle(monkeypatch):
    """`--retry-window`: a row still differing is re-checked until the window ends; one an in-flight write
    settles inside it is not reported, one still differing at the end is. The clock is a fake one."""
    from apps.core import shard_sync
    from apps.realms.models import Realm
    from apps.tenants.models import Tenant

    hall = Tenant.objects.create(code="RW_GR", display_name="g", declared_civilization="GREEK")
    settles, stays = (Realm.all_objects.create(realm_code=f"R{uuid.uuid4().hex[:8]}", name_en="old", name_local="o",
                                               civilization="GREEK", realm_type="HELL", tenant=hall) for _ in range(2))
    _sync()
    Realm.all_objects.filter(pk__in=[settles.pk, stays.pk]).update(name_en="new")

    class Clock:
        now, slept = 0.0, []

        def monotonic(self):
            return self.now

        def sleep(self, s):
            self.now += max(s, 0.01)
            self.slept.append(s)
            if len(self.slept) == 2:  # the in-flight write reaches the shard during the window
                Realm._base_manager.using("civ_greek").filter(pk=settles.pk).update(name_en="new")

    clock = Clock()
    monkeypatch.setattr(shard_sync, "time", clock)
    code, out = _reconcile("--civ", "GREEK", "--retry-window", "5")
    assert code == 1 and _reported(out) == {(Realm._meta.label, str(stays.pk))}, out
    assert len(clock.slept) >= 3 and clock.now >= 5  # it kept re-checking until the window ended
    Realm._base_manager.using("civ_greek").filter(pk=settles.pk).update(name_en="old")
    code, out = _reconcile("--civ", "GREEK")  # no window: both, at once
    assert code == 1 and _reported(out) == {(Realm._meta.label, str(p)) for p in (settles.pk, stays.pk)}, out


def _leaf(model):
    """No row points at it and only its pk is unique: a row can go or be copied without breaking a key."""
    return (not model._meta.related_objects and not model._meta.unique_together
            and not [c for c in model._meta.constraints if isinstance(c, models.UniqueConstraint)]
            and not [f for f in model._meta.concrete_fields if f.unique and not f.primary_key])


@sharded
def test_a_row_missing_from_a_shard_and_one_only_there_are_both_named(world):
    """G7, from the retired shadow guard: model + pk for each side's surplus, nothing else."""
    civ = world.rng.choice(CIVS)
    alias = alias_for_civilization(civ)
    leaves = [m for m in compared_models() if _leaf(m) and not m._meta.auto_created
              and m._base_manager.using(alias).exists()]
    assert leaves, "no model without inbound keys or unique columns has rows on the shard"
    Model = world.rng.choice(leaves)
    print(f"model {Model._meta.label} on {alias}")
    gone = Model._base_manager.using(alias).order_by("pk").first()
    extra = Model._base_manager.using(alias).get(pk=gone.pk)  # a copy of it, under a new pk, on the shard only
    Model._base_manager.using(alias).filter(pk=gone.pk)._raw_delete(alias)
    if isinstance(extra.pk, uuid.UUID):
        extra.pk = uuid.uuid4()
    else:
        extra.pk = max(Model._base_manager.order_by().values_list("pk", flat=True)) + 1000
    Model._base_manager.using(alias).bulk_create([extra])

    code, out = _reconcile("--civ", civ)
    assert code == 1
    assert _reported(out) == {(Model._meta.label, str(gone.pk)), (Model._meta.label, str(extra.pk))}, out
    assert f"pk={gone.pk} missing in {alias}" in out and f"pk={extra.pk} only in {alias}" in out
    with pytest.raises(CommandError, match="unknown civilization"):
        call_command("reconcile_shards", "--civ", "NOPE", stdout=io.StringIO())


@sharded
def test_a_row_pointing_out_of_its_shard_is_reported(world, monkeypatch):
    """A row the shard cannot hold -- a constrained key names a row of another civilization -- is reported
    and not copied; the shard stays consistent and reconcile does not exit 0 until somebody decides.
    No key of the schema does that since stage 2 (they are bare ids), so one is given its constraint back
    here: a soul moved with a rebirth application whose workflow stays in the home hall."""
    from apps.soul_accounts.models import RebirthApplication

    monkeypatch.setattr(RebirthApplication._meta.get_field("workflow"), "db_constraint", True)

    app = RebirthApplication._base_manager.filter(
        soul__tenant__isnull=False, workflow__isnull=False, soul__tenant=F("workflow__tenant"),
        soul__home_tenant=F("workflow__tenant")).select_related(
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

#: Column types `_digest` (json.dumps(default=str)) cannot read stably: a BinaryField comes back from
#: PostgreSQL as a memoryview, whose str() names a memory address (every row would differ on every run);
#: pgvector's vectors are numpy arrays, whose str() elides the middle past 1000 values (a change there
#: would not be seen). None is compared today (soul_assist.HelpChunk is CONTROL); teach `_digest` first.
UNDIGESTIBLE = {"BinaryField", "VectorField", "HalfVectorField", "SparseVectorField"}


def test_no_compared_column_is_one_the_digest_cannot_read():
    found = sorted(f"{m._meta.label}.{f.name} ({type(f).__name__})" for m in compared_models()
                   for f in m._meta.concrete_fields if {c.__name__ for c in type(f).__mro__} & UNDIGESTIBLE)
    assert not found, f"compared by shard sync but not digestible as a string: {found}"

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

    from apps.core import shard_sync
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
        assert len(ours(burst)) == 1 and queued == [{"countdown": DEBOUNCE_SECONDS}]  # sent after the window
        committed()
        cache.delete(DEBOUNCE_KEY)
        with django_capture_on_commit_callbacks(execute=True) as on_shard:
            shard_sync._on_write(Realm, using="civ_greek")  # a write on a shard alias is not control's
        assert not ours(on_shard) and len(queued) == 1
        cache.add(DEBOUNCE_KEY, 1)  # back inside the first burst's window
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

