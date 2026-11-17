"""Cross-civilization saga (sharding stage 4 part C; docs/audit/2026-11-15-sharding/PLAN.md 阶段 4, D6).

A business transaction holds on ONE database. Once a civilization's writes are cut over (SHARD_WRITE_CIVS), a flow
whose rows belong to halls of two civilizations with different masters cannot commit in one transaction, and 4A
refuses the second database's write (WriteOutsideTransaction). Those flows -- a dispatch executed across
civilizations, a residence ended across them, a cross-civilization rebirth, a seat on another civilization's joint
bench, and the origin side's writes to a soul that resides elsewhere (D6) -- go through a message instead:

  send        writes a ShardOutbox row on the SOURCE hall's master, in the caller's transaction: it commits or rolls
              back with the business rows it accompanies. Nothing is delivered until that commit.
  relay       (Celery `sharding.relay_outbox`, kicked on commit and swept by beat every 5 minutes and by
              `sharding.sync_shards`; by hand `manage.py relay_outbox` -- a broker outage loses a kick, never a
              message, which is a row here) for each PENDING
              row on a master: on the TARGET hall's master, one transaction that inserts ShardInbox(message_id) --
              unique, so a redelivery inserts nothing and applies nothing -- and applies the handler; then, on the
              source master, one transaction that runs the handler's `done` (or `refused`) and closes the row.
  refused     only a handler raising `Refused` (the target will not take it: a hall closed meanwhile) compensates.
              Any other error leaves the row PENDING (its `attempts` and `last_error` noted); the next relay retries
              it, and the inbox makes that safe. After MAX_ATTEMPTS failures it is FAILED: a dead letter the relay
              stops trying, which `check_soul_ownership` and `relay_outbox` report (exit 1) until an operator fixes
              the cause and `relay_outbox --retry-failed` puts it back.
  order       per subject: on a master, messages of one subject are delivered in the order they were written (pk),
              and one that fails -- or is FAILED -- holds back the later ones of its subject, never anything else.
  in transit  while a move of a soul is open (PENDING or FAILED), its rows are read-only. Step 1 copied the source
              row into the message, step 2 writes that copy on the target and step 3 retires the source row, so a
              write to the soul in between would be lost; it is refused instead (`SoulInTransit`, 423 `locked`) by
              the save / delete signals and `SoulQuerySet.update` (`refuse_in_transit`). The move's own steps are
              exempt. Refusing is the fix rather than re-reading the source at step 2 (a write between steps 2 and 3
              would still be lost) or forwarding later writes (it would need a merge rule against what the arrival
              itself writes: the station, the hall, the owner).

A crash between the steps leaves a PENDING row; relaying until quiescent finishes the saga, never half of it
(tests/test_cross_civilization_saga.py injects a failure at every write and checks exactly that).

Nothing here runs while SHARD_WRITE_CIVS is empty, and a flow whose halls share a master never sends: it runs
inline, the same statements in the same transaction as before (`crosses`). Only the masters' rows are read -- a
civilization's shadow (not cut over) and control's mirror of a cut-over civilization hold copies, not messages.
"""
import json
import logging
import uuid
from contextlib import contextmanager
from contextvars import ContextVar

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from apps.core.problems import Problem
from apps.core.shard_reads import CONTROL_ALIAS, master_alias, read_context

log = logging.getLogger(__name__)

#: Failed deliveries before a message is FAILED (a dead letter). The beat sweep runs every 5 minutes.
MAX_ATTEMPTS = 10


class Refused(Exception):  # noqa: N818 -- a refusal, not a failure
    """The target hall will not take the message: the source compensates (`refused` handler)."""


class SoulInTransit(Problem):
    """A write to a soul whose move between masters is open (module doc, "in transit"): refused, 423 `locked`."""

    def __init__(self, soul_ids):
        super().__init__(423, "locked", "This soul is moving between civilizations (a dispatch, a return home or a "
                         "rebirth in flight) and cannot be changed until the move completes. Try again shortly.",
                         soul_ids=sorted(map(str, soul_ids)))


_HANDLERS = {}
#: Kinds that move a soul's primary row (payload["soul"]["id"]) to the target hall's master: until their step 3
#: closes them, reads take the source row as the primary (`arriving`).
_MOVES = set()
#: The message being delivered: its own steps read the soul where it is arriving (step 2 logs it as the target
#: hall's soul, step 3 reads it there once the source row is demoted), not as the rest of the world reads it.
_delivering = ContextVar("shard_saga_delivering", default=None)


def handler(kind, *, done=None, refused=None, moves=False):
    """Register `apply(payload)` for messages of `kind`, run on the target hall's master; `done(payload)` and
    `refused(payload)` run on the source hall's master after it. `moves`: the message moves a soul (`arriving`)."""
    def register(apply):
        _HANDLERS[kind] = (apply, done, refused)
        if moves:
            _MOVES.add(kind)
        return apply
    return register


def master_of(hall):
    return master_alias(hall.civilization)


def crosses(*halls):
    """Whether rows of `halls` are written on more than one database: then one transaction cannot hold them."""
    return bool(settings.SHARD_WRITE_CIVS) and len({master_of(h) for h in halls if h is not None}) > 1


def _models():
    from apps.tenants.models import ShardInbox, ShardMessageState, ShardOutbox

    return ShardOutbox, ShardInbox, ShardMessageState


def _open():
    """The states of a message not closed: PENDING, and FAILED (a dead letter is a saga still in flight)."""
    _, _, state = _models()
    return (state.PENDING, state.FAILED)


def in_flight(subject, hall):
    """A saga on `subject` sent from `hall` is still open (PENDING or FAILED)."""
    outbox, _, _ = _models()
    return outbox._base_manager.using(master_of(hall)).filter(subject=subject, state__in=_open()).exists()


def arriving():
    """[(soul pk, target hall pk)] of every soul move still open on any master: between step 2 (the target's row
    written as primary) and step 3 (the source's row demoted) a soul has a primary-looking row on two masters, and
    a read across them takes the SOURCE row as the primary -- the target's is not visible until the move closes
    (`apps.core.shard_reads.legs`). Empty while no civilization writes to its shard."""
    if not settings.SHARD_WRITE_CIVS or not _MOVES:
        return []
    outbox, _, _ = _models()
    out = []
    for alias, hall_ids in masters():
        rows = (outbox._base_manager.using(alias).filter(tenant_id__in=hall_ids, state__in=_open(), kind__in=_MOVES)
                .exclude(message_id=_delivering.get()).values_list("payload", "target_tenant_id"))
        out.extend((payload["soul"]["id"], target) for payload, target in rows)
    return out


def sent(subject, hall):
    """A message on `subject` was sent from `hall`, in whatever state."""
    outbox, _, _ = _models()
    return outbox._base_manager.using(master_of(hall)).filter(subject=subject).exists()


@contextmanager
def on_master(hall):
    """A transaction on `hall`'s master, acting as that hall: its writes, its `atomic()` and its reads that may act
    are that master's, whatever request or task we are in (the request's own hall would otherwise decide)."""
    from apps.core import request_local
    from apps.tenants import managers

    alias = master_of(hall)
    user = request_local._user_var.set(request_local.get_current_user())  # the actor stays; the request's hall goes
    request = request_local._request_var.set(None)
    tenant = managers._tenant_var.set(hall)
    try:
        with read_context(alias), transaction.atomic(using=alias):
            yield alias
    finally:
        managers._tenant_var.reset(tenant)
        request_local._user_var.reset(user)
        request_local._request_var.reset(request)


def send(kind, source, target, payload, *, subject=""):
    """Write the message on `source`'s master in the open transaction there (or its own one); delivered after commit."""
    outbox, _, _ = _models()
    if kind not in _HANDLERS:
        raise ValueError(f"no saga handler for {kind!r}")
    alias = master_of(source)
    # The caller's business transaction must be open on the source's master: an outbox committed on its own would be
    # delivered even when the business rows roll back.
    from apps.core.shard_reads import _refuse_outside

    _refuse_outside(alias)
    message_id = uuid.uuid4()
    # The handlers see their own message id (`message_id`): a `done` that sends the next message names it by it.
    payload = json.loads(json.dumps({**payload, "message_id": message_id}, cls=DjangoJSONEncoder))
    with transaction.atomic(using=alias):
        msg = outbox._base_manager.using(alias).create(
            message_id=message_id, tenant=source, target_tenant=target, kind=kind, subject=subject, payload=payload)
        transaction.on_commit(_kick, using=alias)
    return msg


def _kick():
    from apps.tenants.tasks import relay_outbox

    try:
        relay_outbox.delay()
    except Exception:  # broker down: the message is a PostgreSQL row; the beat sweep (`sharding.relay_outbox`,
        # every 5 minutes) or `manage.py relay_outbox` delivers it once the broker -- or just the worker -- is back
        log.warning("saga relay not queued; the next relay_outbox sweep relays it", exc_info=True)


def masters():
    """(alias, halls whose master it is) for every master: control (with the halls of no write-cut civilization),
    then each write-cut shard."""
    from apps.tenants.models import Tenant

    halls = list(Tenant._base_manager.using(CONTROL_ALIAS).all())
    out = {}
    for hall in halls:
        out.setdefault(master_of(hall), []).append(hall.pk)
    return sorted(out.items())


def pending(alias, hall_ids):
    """The PENDING messages of `hall_ids` on `alias` in the order they were written: the pk, one master's sequence,
    not an application server's clock."""
    outbox, _, state = _models()
    return list(outbox._base_manager.using(alias).filter(tenant_id__in=hall_ids, state=state.PENDING).order_by("pk"))


def failed():
    """[(alias, message)] of every dead letter (FAILED) on every master."""
    outbox, _, state = _models()
    return [(alias, m) for alias, ids in masters()
            for m in outbox._base_manager.using(alias).filter(tenant_id__in=ids, state=state.FAILED).order_by("pk")]


def relay():
    """Deliver every PENDING message on every master once, in order per subject (module doc). Returns how many were
    closed (DONE or REFUSED)."""
    outbox, _, state = _models()
    closed = 0
    for alias, hall_ids in masters():
        held_back = set(outbox._base_manager.using(alias).filter(tenant_id__in=hall_ids, state=state.FAILED)
                        .exclude(subject="").values_list("subject", flat=True))
        for msg in pending(alias, hall_ids):
            if msg.subject and msg.subject in held_back:
                continue
            try:
                closed += deliver(msg)
            except SoulInTransit:  # waits for a move of its soul to close: not a failure of its own, not counted
                log.info("saga message %s (%s) waits for a soul in transit", msg.message_id, msg.kind)
                held_back.add(msg.subject)
            except Exception as e:  # stays PENDING (FAILED after MAX_ATTEMPTS); the inbox makes the retry safe
                log.exception("saga message %s (%s) not delivered", msg.message_id, msg.kind)
                _note_failure(alias, msg, e)
                held_back.add(msg.subject)
    return closed


def _note_failure(alias, msg, error):
    outbox, _, state = _models()
    dead = msg.attempts + 1 >= MAX_ATTEMPTS
    with on_master(msg.tenant):
        outbox._base_manager.using(alias).filter(pk=msg.pk, state=state.PENDING).update(
            attempts=F("attempts") + 1, last_error=f"{type(error).__name__}: {error}"[:2000],
            state=state.FAILED if dead else state.PENDING)
    if dead:
        log.error("saga message %s (%s) FAILED after %s attempts: %s", msg.message_id, msg.kind, MAX_ATTEMPTS, error)


def retry_failed():
    """Every dead letter back to PENDING, its attempts reset (once its cause is fixed). Returns how many."""
    outbox, _, state = _models()
    n = 0
    for alias, ids in masters():
        with transaction.atomic(using=alias):
            n += outbox._base_manager.using(alias).filter(tenant_id__in=ids, state=state.FAILED).update(
                state=state.PENDING, attempts=0)
    return n


def relay_until_quiet(rounds=10):
    """Relay until no message is pending (a step may send the next one)."""
    for _ in range(rounds):
        if not any(pending(alias, ids) for alias, ids in masters()):
            return
        relay()
    raise RuntimeError(f"saga messages still pending after {rounds} rounds")


def deliver(msg):
    """Apply `msg` on its target (once: the inbox), then close it on its source. 1 if closed, 0 if it was not open."""
    token = _delivering.set(msg.message_id)
    try:
        return _deliver(msg)
    finally:
        _delivering.reset(token)


def _deliver(msg):
    outbox, inbox, state = _models()
    apply, done, refused = _HANDLERS[msg.kind]
    target = msg.target_tenant
    outcome = state.DONE
    try:
        with on_master(target) as alias:
            try:
                with transaction.atomic(using=alias):
                    inbox._base_manager.using(alias).create(message_id=msg.message_id, tenant=target, kind=msg.kind)
            except IntegrityError:
                pass  # applied before: a redelivery
            else:
                apply(msg.payload)
    except Refused as e:
        log.info("saga message %s (%s) refused by %s: %s", msg.message_id, msg.kind, target.code, e)
        outcome = state.REFUSED
    with on_master(msg.tenant) as alias:
        row = outbox._base_manager.using(alias).select_for_update().filter(pk=msg.pk, state=state.PENDING).first()
        if row is None:
            return 0
        after = done if outcome == state.DONE else refused
        if after is not None:
            after(msg.payload)
        outbox._base_manager.using(alias).filter(pk=row.pk).update(state=outcome, done_at=timezone.now())
    return 1


# ---- writes to a row on another master (D6) -------------------------------------------------------------------

def hall_of(instance):
    from apps.core.shard_reads import _hall_of

    return _hall_of(instance)


def held(instance):
    """Whether a write of `instance` can join the code's transaction: no civilization writes to its shard, no code
    transaction is open (the write is its own), or one is open on the row's master."""
    from django.db import connections

    from apps.core.shard_reads import _code_transaction_open, write_alias_of

    if not settings.SHARD_WRITE_CIVS or not _code_transaction_open():
        return True
    return any(not b._from_testcase for b in connections[write_alias_of(instance)].atomic_blocks)


def save_fields(instance, fields, *, source):
    """`instance.save(update_fields=fields)` -- or, where the code's transaction is not open on the row's master (an
    origin-side write to a soul residing in another civilization, D6), a message that saves those fields there.
    `source` is the hall whose master holds the transaction (the origin)."""
    if held(instance):
        instance.save(update_fields=list(fields))
        return None
    values = {f: getattr(instance, instance._meta.get_field(f).attname) for f in fields}
    return send("row.save", source, hall_of(instance), {
        "model": instance._meta.label, "pk": str(instance.pk),
        "values": json.loads(json.dumps(values, cls=DjangoJSONEncoder))},
        subject=f"row:{instance._meta.label}:{instance.pk}")  # two saves of one row land in the order made


@handler("row.save")
def _row_save(payload):
    from django.apps import apps

    model = apps.get_model(payload["model"])
    obj = model._base_manager.select_for_update().get(pk=payload["pk"])
    for name, value in payload["values"].items():
        field = model._meta.get_field(name)
        setattr(obj, field.attname, field.to_python(value))
    obj.save(update_fields=list(payload["values"]))


# ---- a soul in transit is read-only (module doc) ---------------------------------------------------------------

def _moving(aliases, soul_ids=None):
    """Souls (of `soul_ids`, or any) with a move open on any of `aliases` -- except the move being delivered, whose
    own steps write the soul."""
    outbox, _, _ = _models()
    out = set()
    for alias in aliases:
        rows = outbox._base_manager.using(alias).filter(state__in=_open(), kind__in=_MOVES)
        if soul_ids is not None:
            rows = rows.filter(payload__soul__id__in=[str(pk) for pk in soul_ids])
        out |= set(rows.exclude(message_id=_delivering.get()).values_list("payload__soul__id", flat=True))
    return out


def _refuse_row(sender, instance, using=None, raw=False, **kwargs):
    """pre_save / pre_delete of a Soul: refused while a move of it is open on the database written (the source's
    master, where step 1 wrote the move's message; every read takes the source row as the soul until step 3)."""
    if raw or not settings.SHARD_WRITE_CIVS or not _MOVES or instance._state.adding:
        return
    moving = _moving([using or CONTROL_ALIAS], [instance.pk])
    if moving:
        raise SoulInTransit(moving)


def refuse_in_transit(queryset):
    """`SoulQuerySet.update`: refused when it touches a soul with a move open on any master."""
    if not settings.SHARD_WRITE_CIVS or not _MOVES:
        return
    moving = _moving([alias for alias, _ in masters()])
    if moving:
        hit = set(map(str, queryset.filter(pk__in=moving).values_list("pk", flat=True)))
        if hit:
            raise SoulInTransit(hit)


def connect_transit_guard():
    from django.db.models.signals import pre_delete, pre_save

    from apps.souls.models import Soul

    pre_save.connect(_refuse_row, sender=Soul, dispatch_uid="shard_saga:soul_in_transit_save")
    pre_delete.connect(_refuse_row, sender=Soul, dispatch_uid="shard_saga:soul_in_transit_delete")
