"""What control knows of where a soul's rows are, so a soul's own request asks no other civilization's shard
(`apps.core.shard_reads.soul_read_context`; tests/test_soul_reads_one_shard.py). Three kinds of GlobalCode row --
control rows, not codes: `global_codes.check` reads only its own KINDS.

  SOUL_MOVING   value = the soul's pk, tenant_id = the SOURCE hall of its open move (a saga message of a kind that
                `moves`). Written with the message (step 1, `shard_saga.send`) and deleted when the message closes
                (`shard_saga._deliver`), each in the source master's business transaction, which holds control's too.
                `shard_reads._primary_soul` reads the soul on that master first: until step 3 the source row is the
                primary and the target's is arriving. Before this every soul lookup asked every master's outbox.
  SOUL_LIVES_IN value = the soul's pk, tenant_id = the hall its last completed move took it to (`moved`). Where
                `_primary_soul` asks first when no move is open, rather than the hall its account was opened in: a
                soul residing away read its home shard's copy, then each master until its own.
  SOUL_ROWS_IN  value = "<soul pk>:<CIVILIZATION>": a row naming the soul through a crossing key may be on that
                civilization's shard while the soul is not its own there. Noted when such a row is saved on a shard
                where the soul has no row of that shard's civilization (`_on_save`), and when a move takes the soul off
                a shard (`moved`). `shard_reads._rows_abroad` asks it instead of every other shard.

Stale the safe way only: a row left over (a control write that committed while the shard's rolled back, a soul whose
rows abroad were deleted since) costs a read of the other shards. One missing would answer a soul's ACROSS view from
its primary alone; that happens only when control's commit fails after the shard's committed (the window
`shard_reads._install_atomic` describes) or for crossing rows written without a save signal (`bulk_create`, a
queryset `update` of the key). `manage.py note_soul_whereabouts` notes SOUL_ROWS_IN and SOUL_LIVES_IN from what the
shards hold: run it once where the shards already hold rows (115, which predates this) and after such a failure.
SOUL_LIVES_IN only orders the masters `_primary_soul` asks (stale or missing costs queries, never an answer). A move
whose step 1 committed without its SOUL_MOVING row (the same window) reads, until its step 3, as `_primary_soul` finds
it on the master it asks first -- the arriving row if that is the target.
"""
from django.conf import settings

from apps.core.shard_reads import CONTROL_ALIAS

MOVING = "SOUL_MOVING"
ROWS_IN = "SOUL_ROWS_IN"
LIVES_IN = "SOUL_LIVES_IN"


def _codes():
    from apps.tenants.models import GlobalCode

    return GlobalCode.objects.using(CONTROL_ALIAS)


def mark_moving(soul_pk, source_hall_pk):
    """Step 1 of a move: the soul's primary stays on `source_hall_pk`'s master until the move closes."""
    _codes().filter(kind=MOVING, value=str(soul_pk)).delete()
    _codes().create(kind=MOVING, value=str(soul_pk), tenant_id=source_hall_pk)


def moved(soul_pk, source_hall_pk, arrived_hall_pk=None, left_civ=None):
    """The move closed: DONE (`arrived_hall_pk`, the hall it took the soul to) or REFUSED (None: it stayed). `left_civ`:
    the civilization of the shard the soul left, whose rows naming it are now abroad; None when the source master was
    control (its rows are read by `_rows_abroad`'s control query)."""
    _codes().filter(kind=MOVING, value=str(soul_pk), tenant_id=source_hall_pk).delete()
    if arrived_hall_pk is not None:
        _lives_in(soul_pk, arrived_hall_pk)
    if left_civ:
        note_rows_in(left_civ, [soul_pk])


def _lives_in(soul_pk, hall_pk):
    from apps.tenants.models import GlobalCode

    _codes().filter(kind=LIVES_IN, value=str(soul_pk)).exclude(tenant_id=hall_pk).delete()
    GlobalCode.objects.using(CONTROL_ALIAS).bulk_create(
        [GlobalCode(kind=LIVES_IN, value=str(soul_pk), tenant_id=hall_pk)], ignore_conflicts=True)


def whereabouts(soul_pk):
    """(source hall pk of the soul's open move, hall pk its last move took it to): each None when not noted. One
    control query."""
    found = dict(_codes().filter(kind__in=(MOVING, LIVES_IN), value=str(soul_pk)).values_list("kind", "tenant_id"))
    return found.get(MOVING), found.get(LIVES_IN)


def note_rows_in(civ, soul_pks):
    from apps.tenants.models import GlobalCode

    rows = [GlobalCode(kind=ROWS_IN, value=f"{pk}:{civ}") for pk in soul_pks]
    # ON CONFLICT DO NOTHING: a duplicate is no error, and no IntegrityError aborts control's open transaction.
    GlobalCode.objects.using(CONTROL_ALIAS).bulk_create(rows, ignore_conflicts=True)


def rows_abroad(soul_pk, civ):
    """A row naming the soul may be on a shard of a civilization other than `civ` (the soul's primary's)."""
    from apps.souls.models import Civilization

    return _codes().filter(kind=ROWS_IN, value__in=[f"{soul_pk}:{c}" for c in Civilization.values if c != civ]).exists()


def _keys(model):
    from apps.core.shard_reads import _keys_to_soul

    return [f for f in _keys_to_soul() if f.model._meta.concrete_model is model._meta.concrete_model]


def _not_own(alias, civ, soul_pks):
    """Of `soul_pks`, those with no row of `civ` on `alias` (a soul living elsewhere, or a copy of one)."""
    from apps.core.tenant import civilization_halls
    from apps.souls.models import Soul

    own = set(Soul._base_manager.using(alias).filter(pk__in=soul_pks, tenant__in=civilization_halls(civ))
              .values_list("pk", flat=True))
    return [pk for pk in soul_pks if pk not in own]


def _on_save(sender, instance, using=None, raw=False, **kwargs):
    from apps.core.shard_sync import civilization_of
    from config.sharding import is_shard_alias

    if raw or not settings.SHARDED or not is_shard_alias(using):
        return
    pks = list({getattr(instance, f.attname) for f in _keys(sender)} - {None})
    if not pks:
        return
    civ = civilization_of(using)
    away = _not_own(using, civ, pks)
    if away:
        note_rows_in(civ, away)


def note_from_shards(aliases):
    """SOUL_ROWS_IN for every crossing row on `aliases` (shards) naming a soul that is not its own there, and
    SOUL_LIVES_IN for every soul with an account whose primary is on one of them. Idempotent. Returns {alias: (souls
    with rows there and their primary elsewhere, account souls living there)}."""
    from apps.core.shard_reads import _keys_to_soul
    from apps.core.shard_sync import civilization_of
    from apps.core.tenant import civilization_halls
    from apps.soul_accounts.models import SoulAccount
    from apps.souls.models import Soul

    accounts = list(SoulAccount._base_manager.using(CONTROL_ALIAS).values_list("soul_id", flat=True))
    out = {}
    for alias in aliases:
        civ = civilization_of(alias)
        own = Soul._base_manager.using(alias).filter(tenant__in=civilization_halls(civ)).values("pk")  # a subquery
        away = set()
        for f in _keys_to_soul():
            away |= set(f.model._base_manager.using(alias).exclude(**{f"{f.attname}__isnull": True})
                        .exclude(**{f"{f.attname}__in": own}).values_list(f.attname, flat=True).distinct())
        note_rows_in(civ, sorted(away, key=str))
        living = list(Soul._base_manager.using(alias).filter(pk__in=accounts, tenant__in=civilization_halls(civ))
                      .values_list("pk", "tenant_id"))
        for pk, hall_pk in living:
            _lives_in(pk, hall_pk)
        out[alias] = (len(away), len(living))
    return out


def connect():
    from django.db.models.signals import post_save

    from apps.core.shard_reads import _keys_to_soul

    for model in {f.model._meta.concrete_model for f in _keys_to_soul()}:
        post_save.connect(_on_save, sender=model, dispatch_uid=f"soul_directory:{model._meta.label}")
