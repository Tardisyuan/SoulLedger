"""A soul moving between halls whose rows are written on different databases (sharding stage 4 part C, D6; the engine
is apps/tenants/shard_saga.py). Used only when the two halls' masters differ (`shard_saga.crosses`); a move within
one master keeps the single transaction of `DispatchService.execute` / `end_residence`, statement for statement.

The transfer state machine, EXECUTING -> EXECUTED, in three steps:

  1  source master   lock the soul, ask the same checks, write the source's own rows (leave its path station; a
                     residence ended by hand voids / pardons the residence's dispositions), and the outbox message.
                     The transfer is EXECUTING from here: the message is PENDING, and `DispatchRecord.transition_to`
                     refuses every other move of the record (`executing`) until the saga closes it.
  2  target master   (relay) the target may refuse (a hall that closed its dispatch meanwhile: `Refused`); else
                     upsert the soul there as PRIMARY (tenant = the target hall), its path station, its event, the
                     target's side of a sentence plan stop -- plus the inbox row, in one transaction.
  3  source master   (relay) the record EXECUTED (or RETURNED), and the source row DEMOTED (`_retire`); a soul moving
                     on from a residence to a third civilization also sends its home's master HOME_FOLLOWS, so the
                     home shard's copy names the new residence.

Between 2 and 3 the soul has a primary-looking row on both masters; while the message is PENDING every read across
them takes the source's row as the primary and does not see the target's (`shard_saga.arriving`, `legs`).

From step 1's commit to step 3's the soul is read-only (`shard_saga.SoulInTransit`, 423 `soul_in_transit`): step 2 writes
the row step 1 copied into the message, and step 3 retires the source row, so a write to it in between would be
lost. The steps' own writes are exempt (the message being delivered).

Compensation only when the target refused: the source's own step-1 rows back (the path station reopened); the
record was never moved, so it is APPROVED again the moment the message closes.

Gap 4d, replica identity: a demoted row keeps its pk and gets the NEW hall as `tenant` (its keys to other shard rows
blanked, as shard sync's copies are, `copy_blanks`), so `primary_alias` / `write_alias_of` read it as a row of the
new hall's master -- a copy -- and deleting it there never clears the control SoulAccount that names the soul
(`apps.core.bare_ids._on_pre_delete`). Kept where a copy is allowed (`check_soul_ownership`): control's mirror and
the home civilization's shard while the soul resides away. Elsewhere it is deleted, after the rewrite.
"""
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.utils import timezone

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.tenants import shard_saga as saga
from apps.tenants.shard_saga import Refused, handler

EXECUTE = "dispatch.execute"
RETURN = "dispatch.return"
MIGRATE = "soul.migrate"


def _subject(record):
    return f"dispatch:{record.pk}"


def executing(record):
    """The record's cross-civilization execution is in flight (step 1 committed, step 3 not yet)."""
    return saga.in_flight(_subject(record), record.tenant) if record.tenant_id else False


def _soul_model():
    from apps.souls.models import Soul

    return Soul


def _hall(pk):
    from apps.tenants.models import Tenant

    return Tenant._base_manager.using("default").get(pk=pk)


def row_values(row):
    """Every column of `row`, JSON-safe: what a step on another master writes."""
    values = {f.attname: getattr(row, f.attname) for f in row._meta.concrete_fields}
    return json.loads(json.dumps(values, cls=DjangoJSONEncoder))


soul_values = row_values


def _upsert_primary(values, alias, **changes):
    """The soul as the primary row on `alias`: the source's columns plus `changes`, inserted or overwriting a copy
    already there (the home shard's, when a soul comes home). Plain writes: no save() (it would claim the soul code
    again), no signal but the shard write guards."""
    from contextlib import nullcontext

    from apps.core.shard_reads import CONTROL_ALIAS, control_mirror_writes

    Soul = _soul_model()  # noqa: N806
    row = {**values, **changes}
    pk = row.pop("id")
    rows = Soul._base_manager.using(alias).filter(pk=pk)
    # On control the row there may be the mirror of the write-cut source civilization's: it becomes control's own.
    with control_mirror_writes() if alias == CONTROL_ALIAS else nullcontext():
        if not rows.update(**row):
            Soul._base_manager.using(alias).bulk_create([Soul(pk=pk, **row)])
    return Soul._base_manager.using(alias).get(pk=pk)


def _retire(alias, soul_pk, tenant_id, home_id):
    """Step 3: the source row is no longer the soul's. Rewritten first (gap 4d), then kept or deleted (module doc)."""
    from apps.audit.signals import explicit_audit_for
    from apps.core.shard_reads import CONTROL_ALIAS, control_mirror_writes
    from apps.core.shard_sync import copy_blanks

    Soul = _soul_model()  # noqa: N806
    rows = Soul._base_manager.using(alias).filter(pk=soul_pk)
    if alias == CONTROL_ALIAS:  # control keeps a mirror of the soul's new master (until stage 5)
        with control_mirror_writes():
            rows.update(tenant_id=tenant_id, home_tenant_id=home_id)
        return
    rows.update(tenant_id=tenant_id, home_tenant_id=home_id, **dict.fromkeys(copy_blanks(Soul)))
    residing_copy = alias == saga.master_of(_hall(home_id)) and tenant_id != home_id
    if not residing_copy:
        # Housekeeping of a copy, not a soul deleted: no generic DELETE audit row. The move is audited where it is
        # made (the record's own rows, `audit_return`). That row also named the NEW hall (rewritten just above), so
        # it was routed to the new hall's master while this step's transaction is on this one: on 115 the write was
        # refused (WriteOutsideTransaction) and swallowed, and where both share a master it claimed a live soul deleted.
        with explicit_audit_for(Soul(pk=soul_pk)):
            rows.delete()


def _actor(payload):
    return payload.get("actor") or None


# ---- dispatch execution ----------------------------------------------------------------------------------------

def execute(record, executor):
    """Step 1 of `DispatchService.execute` across masters."""
    from apps.dispatch.services import DispatchService
    from apps.realms.path import SoulPathService

    Soul = _soul_model()  # noqa: N806
    source = record.source_tenant
    with saga.on_master(source):
        soul = Soul.lock(record.soul_id)
        # The caller checked its own copy, read before any lock; a cancel may have committed since. Asked again under
        # the record's lock (soul first, then record: the order of the single-database execute).
        status = DispatchRecord._base_manager.select_for_update().values_list("status", flat=True).get(
            pk=record.pk)
        if status != DispatchStatus.APPROVED:
            raise ValueError(f"Cannot execute dispatch in status: {status}")
        DispatchService.check_executable(record, soul)
        if executing(record):
            raise ValueError(f"Cannot execute dispatch in status: {record.status} (already executing)")
        closed = SoulPathService.leave(soul)
        saga.send(EXECUTE, source, record.target_tenant, {
            "dispatch_id": str(record.pk), "soul": soul_values(soul), "closed_entry": closed.pk if closed else None,
            "actor": str(executor) if executor is not None else None,
        }, subject=_subject(record))
    return record


def _arrive(payload):
    """Step 2: the soul arrives on the target's master as its primary row."""
    from apps.dispatch.services import DispatchService, TargetHallClosedError, _log
    from apps.org.ownership import tenant_root
    from apps.realms.path import SoulPathService

    record = DispatchRecord._base_manager.get(pk=payload["dispatch_id"])
    target, source = record.target_tenant, record.source_tenant
    try:
        DispatchService.check_target_accepts(target)
    except TargetHallClosedError as e:
        raise Refused(str(e)) from None
    soul = _upsert_primary(payload["soul"], saga.master_of(target), tenant_id=target.pk,
                           owner_org_id=tenant_root(target).pk)
    if record.target_realm_id:
        SoulPathService.enter(soul, record.target_realm, tenant_id=target.pk)
    _log(soul, {
        "action": "DISPATCH_EXECUTED",
        "from_tenant": source.code,
        "to_tenant": target.code,
        "home_tenant": soul.home_tenant.code,
        "dispatch_id": str(record.id),
    }, _actor(payload))
    _arrive_at_plan_stop(soul, record)


def _executed(payload):
    """Step 3: the record EXECUTED, the source row demoted."""
    record = DispatchRecord._base_manager.get(pk=payload["dispatch_id"])
    if record.status != DispatchStatus.APPROVED:
        return  # closed before (a redelivery): the record has moved on, and so may the soul
    soul = payload["soul"]
    # Demoted first: until then the soul has a primary-looking row on both masters (step 2 made the target's). Every
    # other reader takes the source's as the primary while this message is pending (`shard_saga.arriving`); this step
    # reads the arrived one, so the source's must stop looking primary before `record.soul` (the audit signal of the
    # save below) is read.
    _retire(saga.master_of(record.source_tenant), soul["id"], record.target_tenant_id, soul["home_tenant_id"])
    home = _hall(soul["home_tenant_id"])
    if saga.master_of(home) not in {saga.master_of(record.source_tenant), saga.master_of(record.target_tenant)}:
        # A soul moving on from one residence to a third civilization: its home shard's copy still names the residence
        # it left, so `primary_alias` and the home hall's D6 writes would go to a master that no longer holds it.
        saga.send(HOME_FOLLOWS, record.source_tenant, home, {
            "soul_id": soul["id"], "home_id": home.pk, "from": record.source_tenant_id, "to": record.target_tenant_id})
    if not record.transition_to(
            DispatchStatus.EXECUTED, in_saga=True, executed_at=timezone.now(), source_owner_org_id=soul["owner_org_id"]):
        raise ValueError(f"Cannot execute dispatch in status: {record.status}")


HOME_FOLLOWS = "soul.home_copy_follows"


@handler(HOME_FOLLOWS)
def _home_copy_follows(payload):
    """Step 3's message to the home hall's master: its copy of the soul names the new residence -- only while it
    still names the one left (a later move, or the soul come home, rewrote it already)."""
    from contextlib import nullcontext

    from apps.core.shard_reads import CONTROL_ALIAS, control_mirror_writes

    alias = saga.master_of(_hall(payload["home_id"]))
    with control_mirror_writes() if alias == CONTROL_ALIAS else nullcontext():
        _soul_model()._base_manager.using(alias).filter(pk=payload["soul_id"], tenant_id=payload["from"]).update(
            tenant_id=payload["to"])


def _not_executed(payload):
    """Compensation (the target refused): the source's station reopened. The record never left APPROVED."""
    from apps.realms.models import SoulPathEntry

    record = DispatchRecord._base_manager.get(pk=payload["dispatch_id"])
    if payload["closed_entry"]:
        SoulPathEntry._base_manager.using(saga.master_of(record.source_tenant)).filter(
            pk=payload["closed_entry"]).update(left_at=None)


handler(EXECUTE, done=_executed, refused=_not_executed, moves=True)(_arrive)


def _arrive_at_plan_stop(soul, record):
    """The target's half of `SentencePlanService.on_dispatch_executed`: the stop's disposition, station and event
    here; the node itself is the plan's (the home hall's) row, activated there (PLAN_NODE)."""
    from apps.disposition.default_terms import fill
    from apps.disposition.models import Disposition, MemoryResetMechanism
    from apps.events.models import EventType
    from apps.realms.models import realm_by_code
    from apps.realms.path import SoulPathService
    from apps.sentence_plan.models import SentenceNode, SentenceNodeStatus
    from apps.sentence_plan.services import _node_params, notify_judges, record_event

    node = SentenceNode.all_objects.filter(dispatch_record_id=record.pk, is_deleted=False).first()
    if node is None or node.status != SentenceNodeStatus.DISPATCHING:
        return
    realm = realm_by_code(node.realm_code, tenant_code=node.tenant_code)
    # `soul=` the arrived row itself: until step 3 the source still holds a primary-looking row, and a read of
    # `disposition.soul` (its save stamps the life index) would find two.
    disposition = Disposition.objects.create(
        soul=soul, tenant_id=record.target_tenant_id, destination_realm=realm,
        sentence_years=fill(node.sentence_years, node.realm_code, is_eternal=node.is_eternal),
        is_eternal=node.is_eternal,
        memory_reset=node.memory_reset or MemoryResetMechanism.NONE, sentence_node_id=node.pk,
        notes=f"受刑计划 {node.plan_id} 节点 {node.order}",
    )
    SoulPathService.enter(soul, realm, tenant_id=disposition.tenant_id)
    at = timezone.now()
    record_event(soul, EventType.SENTENCE_NODE_ACTIVATED, {
        "sentence_plan_id": str(node.plan_id), "node_id": str(node.pk), "order": node.order,
        "tenant_code": node.tenant_code, "disposition_id": str(disposition.pk),
    }, tenant_id=record.target_tenant_id)
    notify_judges({record.target_tenant_id}, "sentence_node_active", _node_params(soul, node), node.plan_id)
    values = {"node_id": str(node.pk), "disposition_id": str(disposition.pk), "at": at.isoformat()}
    plan_hall = node.plan.tenant
    if saga.crosses(record.target_tenant, plan_hall):
        saga.send(PLAN_NODE, record.target_tenant, plan_hall, values)
    else:
        _activate_node(values)


PLAN_NODE = "sentence_plan.node_activated"


@handler(PLAN_NODE)
def _activate_node(payload):
    """The plan's half: the stop's node DISPATCHING -> ACTIVE, under the plan's lock, on the plan's master."""
    from django.utils.dateparse import parse_datetime

    from apps.sentence_plan.models import SentenceNode, SentenceNodeStatus
    from apps.sentence_plan.services import _lock_plan, _save

    found = SentenceNode.all_objects.get(pk=payload["node_id"])
    _lock_plan(found.plan_id)
    node = SentenceNode.all_objects.select_for_update(of=("self",)).get(pk=found.pk)
    if node.status != SentenceNodeStatus.DISPATCHING:
        return
    node.status = SentenceNodeStatus.ACTIVE
    node.disposition_id = payload["disposition_id"]
    node.activated_at = parse_datetime(payload["at"])
    _save(node, "status", "disposition_id", "activated_at")


# ---- the end of a residence --------------------------------------------------------------------------------------

def end_residence(soul, *, actor, trigger, reason="", then_advance=False):
    """Step 1 of `DispatchService.end_residence` across masters: on the residence's master -- now, in the caller's
    transaction when that is open there (or none is), else after it commits.

    The second case is another hall's transaction -- the home hall's own (its officer cancels the plan, an appeal
    withdraws the stop the soul is serving abroad, D6), or SYSTEM_ADMIN's. Where it does not hold the residence's
    master, step 1 run there would commit on its own, whatever became of the caller's (VERIFY-stage4-r2 H-A); where it
    does, step 1 would open the move inside it and leave the soul read-only (`SoulInTransit`) for the rest of the
    caller's transaction, which still writes it (an appeal's compensation moves the ledger). So the caller's
    transaction writes a RETURN_REQUESTED message on the home's master instead, with its own rows; the relay runs
    step 1 on the residence's master after the commit (`_return_requested`), the same step as below. `then_advance`: once the soul is home (RETURN_SETTLED) the
    plan moves on there -- what the single-database caller does after `end_residence` returns."""
    residence = _hall(soul.tenant_id)
    payload = {"trigger": trigger, "reason": reason, "actor": str(actor) if actor is not None else None,
               "actor_id": actor.pk if getattr(actor, "is_authenticated", False) else None,
               "then_advance": then_advance}
    if saga.inside_another_hall(residence):
        home = _hall(soul.home_tenant_id)
        subject = f"soul:{soul.pk}"
        if saga.in_flight(subject, home):
            raise ValueError("Soul is already on its way home")
        saga.send(RETURN_REQUESTED, home, residence, {"soul_id": str(soul.pk), "home_id": home.pk, **payload},
                  subject=subject)
        return None  # the caller's soul stays where it is: abroad until the relay brings it home
    with saga.on_master(residence):
        locked = _soul_model().lock(soul.pk, using=saga.master_of(residence))
        record = _leave(locked, residence, payload)
    soul.tenant_id = locked.home_tenant_id  # what the caller holds, as the single-database path leaves it
    return record


def _leave(locked, residence, payload):
    """Step 1 proper, on the residence's master: the checks, the residence's rows, the RETURN message."""
    from apps.dispatch.services import DispatchService
    from apps.realms.path import SoulPathService

    DispatchService.check_returnable(locked)
    subject = f"soul:{locked.pk}"
    if saga.in_flight(subject, residence):
        raise ValueError("Soul is already on its way home")
    record = (DispatchRecord._base_manager
              .filter(soul_id=locked.pk, status=DispatchStatus.EXECUTED, target_tenant_id=locked.tenant_id,
                      is_deleted=False)
              .order_by("-executed_at").first())
    _settle_plan_stops(locked, residence)
    SoulPathService.leave(locked)
    if payload["trigger"] == DispatchService.RETURN_MANUAL:
        DispatchService.void_residence_dispositions(locked, residence, record)
    saga.send(RETURN, residence, locked.home_tenant, {
        "soul": soul_values(locked), "dispatch_id": str(record.pk) if record else None, **payload,
    }, subject=subject)
    return record


def _settle_plan_stops(locked, residence):
    """The residence's rows of the plan stops the home hall closed while the soul was here: a withdrawn stop's
    disposition (REMOVED / CANCELLED, not executed) voided, an ended one's (ABORTED / COMPLETED) term pardoned -- the
    writes `_withdraw_stop` / `pardon_term` / `_end_serving` make on one database, which the home hall's transaction
    cannot hold here (`sentence_plan.services.rows_elsewhere`). Where it could, they are made already: a no-op."""
    from apps.core.recycle_bin import system_void
    from apps.disposition.models import Disposition
    from apps.sentence_plan.models import SentenceNode, SentenceNodeStatus
    from apps.sentence_plan.services import pardon_served

    alias = saga.master_of(residence)
    here = Disposition.all_objects.using(alias).filter(
        soul_id=locked.pk, tenant_id=residence.pk, is_deleted=False, sentence_node_id__isnull=False)
    nodes = dict(SentenceNode.all_objects.filter(pk__in=list(here.values_list("sentence_node_id", flat=True)))
                 .values_list("pk", "status"))
    now = timezone.now()
    for served in here.select_for_update(of=("self",)):
        status = nodes.get(served.sentence_node_id)
        if status in (SentenceNodeStatus.REMOVED, SentenceNodeStatus.CANCELLED) and not served.is_executed:
            system_void(Disposition.all_objects.using(alias).filter(pk=served.pk), f"plan_stop_withdrawn:{status}")
        elif status in (SentenceNodeStatus.ABORTED, SentenceNodeStatus.COMPLETED):
            pardon_served(locked, served, None, now)


RETURN_REQUESTED = "dispatch.return_requested"


@handler(RETURN_REQUESTED)
def _return_requested(payload):
    """Step 1 deferred from the home hall's transaction (`end_residence`): run on the residence's master. A soul no
    longer residing there (it came home or moved on meanwhile) has nothing to end here. A residence that will not
    let it go (a judgment opened there after the home's request found none) keeps it: the home's rows stand (the
    plan's stops closed), the soul stays, and the same action asked again sends it once the judgment is closed. The
    refusal is recorded here, where the judgment is: DISPATCH_RETURN_BLOCKED on the soul's timeline and the notice to
    both halls' officers, as a blocked automatic return on one database -- it was one log line (VERIFY-stage4-r3 N-2)."""
    from apps.dispatch.services import DispatchService, ResidenceReturnBlockedError
    from apps.tenants.managers import get_current_tenant

    residence = get_current_tenant()
    # `.first()`, not `lock()`: the message names the residence it was sent to, and another return may bring the soul
    # home before it is delivered -- on a shard that return's step 3 deletes the row here (`_retire`). A `get()` made
    # it a dead letter on subject soul:<pk>, holding back the soul's later returns and its rebirth (VERIFY-stage4-r3 N-1).
    locked = (_soul_model().all_objects.db_manager(saga.master_of(residence)).select_for_update(of=("self",))
              .filter(pk=payload["soul_id"]).first())
    if (locked is None or locked.tenant_id != residence.pk or not locked.is_residing
            or saga.in_flight(f"soul:{locked.pk}", residence)):
        _advance_once_home(payload, residence, locked)  # home already, moved on, or on its way home
        return
    try:
        _leave(locked, residence, {k: payload[k] for k in ("trigger", "reason", "actor", "actor_id", "then_advance")})
    except ResidenceReturnBlockedError as blocked:
        DispatchService.record_blocked_return(locked, blocked, None)


def _advance_once_home(payload, residence, row):
    """The caller's plan still moves on once the soul is home (`then_advance`), though another return brought it: that
    one's settling may not advance (a residence ending a stop itself does not ask to). Sent on the soul's subject, so
    the relay delivers it after a return still in flight on this master; `advance` is a function of the plan's state."""
    if not payload.get("then_advance"):
        return
    home_id = payload.get("home_id") or (row.home_tenant_id if row is not None else None)
    if home_id is None:  # a message sent before it carried `home_id`, its row here gone: any master's copy names it
        home_id = _soul_model()._base_manager.filter(pk=payload["soul_id"]).values_list(
            "home_tenant_id", flat=True).first()
    saga.send(RETURN_SETTLED, residence, _hall(home_id), {
        "soul_id": payload["soul_id"], "home_id": home_id, "dispatch_id": None, "trigger": payload["trigger"],
        "then_advance": True, "at": timezone.now().isoformat()}, subject=f"soul:{payload['soul_id']}")


def _come_home(payload):
    """Step 2: the soul primary on its home's master again, the event and the audit row there."""
    from apps.authentication.models import User
    from apps.dispatch.services import DispatchService, _log
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root

    values = payload["soul"]
    home, residence = _hall(values["home_tenant_id"]), _hall(values["tenant_id"])
    record = DispatchRecord._base_manager.filter(pk=payload["dispatch_id"]).first() if payload["dispatch_id"] else None
    source = record.source_owner_org_id if record is not None else None
    owner = (Organization.objects.filter(pk=source, tenant_id=home.pk).first() if source else None) or tenant_root(home)
    soul = _upsert_primary(values, saga.master_of(home), tenant_id=home.pk, owner_org_id=owner.pk)
    _log(soul, {
        "action": "DISPATCH_RETURNED",
        "trigger": payload["trigger"],
        "from_tenant": residence.code,
        "to_tenant": home.code,
        "dispatch_id": str(record.id) if record else None,
        "reason": payload["reason"],
    }, _actor(payload))
    actor = User.objects.filter(pk=payload["actor_id"]).first() if payload.get("actor_id") else None
    DispatchService.audit_return(soul, record, residence, home, actor, payload["trigger"], payload["reason"])


def _left_residence(payload):
    """Step 3: the residence's row of the soul retired; then the record and the plan, on the home's master (the
    record's save reads `record.soul`, which is single again only now)."""
    values = payload["soul"]
    residence, home = _hall(values["tenant_id"]), _hall(values["home_tenant_id"])
    _retire(saga.master_of(residence), values["id"], home.pk, home.pk)
    subject = f"settles:{payload['message_id']}"
    if not saga.sent(subject, residence):  # once, however often this step is redelivered
        saga.send(RETURN_SETTLED, residence, home, {
            "soul_id": values["id"], "home_id": home.pk, "dispatch_id": payload["dispatch_id"],
            "trigger": payload["trigger"], "then_advance": payload.get("then_advance", False),
            "reason": payload.get("reason", ""), "at": timezone.now().isoformat()}, subject=subject)


handler(RETURN, done=_left_residence, moves=True)(_come_home)

RETURN_SETTLED = "dispatch.return_settled"


@handler(RETURN_SETTLED)
def _return_settled(payload):
    """The home's rows of a return: the record RETURNED (on its own master), a manual return's plan moved on, and a
    residence without a plan ended by its disposition moved on at home -- what the single-database `_return_home`
    does once `end_residence` returns; across masters the soul is not home until now (VERIFY-stage4-r3 N-4)."""
    from apps.dispatch.services import DispatchService

    home = _hall(payload["home_id"])
    record = DispatchRecord._base_manager.filter(pk=payload["dispatch_id"]).first() if payload["dispatch_id"] else None
    if record is not None:
        returned = {"dispatch_id": str(record.pk), "at": payload["at"]}
        if saga.crosses(home, record.tenant):
            saga.send(RECORD_RETURNED, home, record.tenant, returned)
        else:
            _record_returned(returned)
    if payload["trigger"] == DispatchService.RETURN_MANUAL or payload.get("then_advance"):
        from apps.sentence_plan.services import SentencePlanService

        Soul = _soul_model()  # noqa: N806
        soul = Soul._base_manager.using(saga.master_of(home)).get(pk=payload["soul_id"])
        if payload["trigger"] == DispatchService.RETURN_MANUAL:
            DispatchService.advance_plan_after_manual_return(soul, record)
        else:  # the rest of the caller's `advance` / cancel, now that the soul is home (`end_residence`)
            SentencePlanService.advance(soul)
    elif payload["trigger"] == DispatchService.RETURN_ON_DISPOSITION:
        from apps.disposition.services import DispositionService

        DispositionService.move_on_once_home(payload["soul_id"], f"Residence ended; {payload.get('reason', '')}")


RECORD_RETURNED = "dispatch.record_returned"


@handler(RECORD_RETURNED)
def _record_returned(payload):
    from django.utils.dateparse import parse_datetime

    record = DispatchRecord._base_manager.get(pk=payload["dispatch_id"])
    if record.status != DispatchStatus.RETURNED and not record.transition_to(
            DispatchStatus.RETURNED, in_saga=True, returned_at=parse_datetime(payload["at"])):
        raise ValueError(f"Cannot return dispatch in status: {record.status}")


# ---- a seat on another civilization's joint bench --------------------------------------------------------------

SEAT = "dispatch.joint_seat"


def seat(bench_hall, participant, workflow):
    """`CrossTenantJudgmentService.add_participant` across masters: the bench's checks ran in the bench's transaction;
    the seat (and, the workflow running, its hall's approval segment) is the invited hall's, written there by the
    relay. The unsaved seat is returned with its id, as the caller's response shows it."""
    from apps.core.request_local import get_current_user

    participant.create_user = participant.update_user = get_current_user()
    saga.send(SEAT, bench_hall, participant.participant_tenant, {
        "seat": row_values(participant), "workflow": str(workflow.pk) if workflow is not None else None,
    }, subject=f"joint:{participant.judgment_id}")
    return participant


@handler(SEAT)
def _seated(payload):
    from apps.dispatch.models import CrossTenantJudgmentParticipant
    from apps.workflow import segments
    from apps.workflow.models import ApprovalWorkflow

    seat = CrossTenantJudgmentParticipant(**payload["seat"])
    seat.save(force_insert=True)
    if payload["workflow"]:
        segments.append_foreign(ApprovalWorkflow._base_manager.get(pk=payload["workflow"]), seat.participant_tenant)


# ---- a seat's sentence on another civilization's bench (VERIFY-stage4-r3 H-1) ------------------------------------

SENTENCE = "dispatch.joint_sentence"
#: The sentence fields of a seat, by attname: what a refused sentence puts back.
SENTENCE_FIELDS = ("sentence_realm_code", "sentence_years", "sentence_is_eternal", "sentence_memory_reset",
                   "sentence_notes", "sentence_submitted_at", "sentence_submitted_by_id")


def _sentence_subject(seat_pk):
    return f"sentence:{seat_pk}"


def sentence(seat, previous):
    """`CrossTenantJudgmentService.submit_sentence` where the bench is another master's: the seat's hall wrote its seat
    (its own row, on its master, in its transaction); the bench takes the sentence on its own master, under the lock
    `conclude` takes there, only while it is open -- else the seat is put back (`_sentence_refused`)."""
    saga.send(SENTENCE, seat.tenant, _hall(seat.judgment.tenant_id), {
        "judgment_id": str(seat.judgment_id), "seat_id": str(seat.pk), "previous": previous,
        "at": seat.sentence_submitted_at.isoformat()}, subject=_sentence_subject(seat.pk))


def sentence_in_flight(judgment):
    """A seat's sentence sent to `judgment`'s bench and not yet taken: `conclude` waits for it. Asked after it read
    the seats, so a sentence committed before then is refused here and one committed after it is refused by the bench
    (CONCLUDED) and put back: the plan gets the sentences the seats end up holding."""
    from django.conf import settings

    from apps.dispatch.models import CrossTenantJudgmentParticipant

    if not settings.SHARD_WRITE_CIVS:
        return False
    seats = CrossTenantJudgmentParticipant._base_manager.filter(judgment_id=judgment.pk, is_deleted=False)
    return any(saga.in_flight(_sentence_subject(pk), _hall(hall_id))
               for pk, hall_id in seats.values_list("pk", "participant_tenant_id")
               if saga.crosses(_hall(hall_id), judgment.tenant))


def _sentence_on_bench(payload):
    from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, JudgmentStatus
    from apps.dispatch.services import CrossTenantJudgmentService

    bench = CrossTenantJudgment._base_manager.select_for_update(of=("self",)).get(pk=payload["judgment_id"])
    if bench.status not in (JudgmentStatus.PROPOSED, JudgmentStatus.ACTIVE):
        raise Refused(f"the bench is {bench.status}")
    CrossTenantJudgmentService.notify_sentence(bench, CrossTenantJudgmentParticipant._base_manager.get(
        pk=payload["seat_id"]))


def _sentence_refused(payload):
    """On the seat's master: the bench closed before the sentence reached it -- the seat as it was, unless it was
    filled again since (a later sentence has its own message)."""
    from django.utils.dateparse import parse_datetime

    from apps.dispatch.models import CrossTenantJudgmentParticipant

    seat = CrossTenantJudgmentParticipant._base_manager.select_for_update(of=("self",)).filter(
        pk=payload["seat_id"]).first()
    if seat is None or seat.sentence_submitted_at != parse_datetime(payload["at"]):
        return
    for attname, value in payload["previous"].items():
        field = next(f for f in seat._meta.concrete_fields if f.attname == attname)
        setattr(seat, attname, field.to_python(value))
    seat.save(update_fields=list(payload["previous"]))


handler(SENTENCE, refused=_sentence_refused)(_sentence_on_bench)


# ---- a plan stop executed or served in another civilization (VERIFY-stage4-r3 H-2) ---------------------------------

STOP_DONE = "sentence_plan.stop_done"


def plan_hall_elsewhere(disposition):
    """The hall of the plan `disposition`'s stop belongs to, when the code's transaction does not hold its master (the
    residence executes a stop of a home plan written on another database), else None."""
    from django.conf import settings

    from apps.sentence_plan.models import SentencePlan
    from apps.sentence_plan.services import SentencePlanService

    if not settings.SHARD_WRITE_CIVS:
        return None
    found = SentencePlanService.node_for_disposition(disposition)
    if found is None:
        return None
    hall = _hall(SentencePlan.all_objects.filter(pk=found.plan_id).values_list("tenant_id", flat=True).get())
    return None if saga.joins(hall) else hall


def stop_done(locked, disposition, plan_hall, *, served):
    """The residence's half of `on_disposition_executed` (`served=False`) / `on_term_served`: its own rows only -- the
    disposition is written by the caller; the soul leaves the stop's realm here when the stop is over (no term left,
    no open judgment holding it: the node the plan's master will mark COMPLETED). The node, the plan and what follows
    (`advance`) are the plan's rows: the plan's master does them (`_stop_done`)."""
    from apps.disposition.expiry import serving
    from apps.disposition.services import DispositionService
    from apps.judgment.models import open_judgments

    if not disposition.is_eternal and not serving(disposition) and not open_judgments(locked).exists():
        DispositionService._leave_served_realm(disposition, locked)
    saga.send(STOP_DONE, locked.tenant, plan_hall, {
        "soul_id": str(locked.pk), "disposition_id": str(disposition.pk), "residence_id": disposition.tenant_id,
        "served": served},
        subject=f"stop:{disposition.pk}")


@handler(STOP_DONE)
def _stop_done(payload):
    """On the plan's master, as the plan's hall: the stop's node (ACTIVE -> ETERNAL / WAITING / COMPLETED, or still
    serving), the plan, and `advance` -- which, the stop over, asks the residence to send the soul home (a
    RETURN_REQUESTED: this transaction does not hold the residence's master) or dispatches it to the next stop."""
    from apps.dispatch.services import DispatchService, ResidenceReturnBlockedError
    from apps.disposition.models import Disposition
    from apps.judgment.models import open_judgments
    from apps.sentence_plan.models import SentenceNodeStatus
    from apps.sentence_plan.services import SentencePlanService

    soul = _soul_model().lock(payload["soul_id"])
    disposition = Disposition.all_objects.using(saga.master_of(_hall(payload["residence_id"]))).get(
        pk=payload["disposition_id"])  # the residence's row, where it is written
    node = (SentencePlanService.on_term_served if payload["served"] else SentencePlanService.on_disposition_executed)(
        soul, disposition)
    if node is None:
        return  # the node moved on meanwhile (the home hall cancelled, an appeal withdrew it)
    if node.status == SentenceNodeStatus.WAITING and soul.is_residing:
        open_ids = list(open_judgments(soul).values_list("pk", flat=True))
        DispatchService.record_blocked_return(soul, ResidenceReturnBlockedError(open_ids), disposition)
    SentencePlanService.advance(soul)


# ---- `advance` asked by another civilization's hall (VERIFY-stage4-r3 follow-up, the shape of H-2) ----------------

PLAN_ADVANCE = "sentence_plan.advance"


def advance_elsewhere(soul):
    """`SentencePlanService.advance` asked in a hall whose master is not the plan's -- the residence closes or withdraws
    its case on the soul (the stop's WAITING then releases), concludes an amendment: the plan, its nodes and what
    `advance` writes are the home hall's rows, on another database. A message to the plan's hall instead, delivered
    after the caller's commit (`advance` is a function of the plan's state: later is the same answer). True if sent.
    No hall acting (MASTER, a command, no context: the transaction holds every master), or the plan's own master:
    False, `advance` runs here."""
    from django.conf import settings

    if not settings.SHARD_WRITE_CIVS:
        return False
    from apps.core.request_local import get_current_request
    from apps.sentence_plan.services import in_progress_plan
    from apps.tenants.managers import get_current_tenant

    acting = getattr(get_current_request(), "tenant", None) or get_current_tenant()
    if acting is None:
        return False
    plan = in_progress_plan(soul)
    if plan is None or not saga.crosses(acting, plan.tenant):
        return False
    saga.send(PLAN_ADVANCE, acting, plan.tenant, {"soul_id": str(soul.pk)}, subject=f"advance:{soul.pk}")
    return True


@handler(PLAN_ADVANCE)
def _plan_advance(payload):
    """On the plan's master, as the plan's hall."""
    from apps.sentence_plan.services import SentencePlanService

    SentencePlanService.advance(_soul_model().lock(payload["soul_id"]))


# ---- an amendment concluded where the soul serves (REPORT-all-stages §3 item 4) ---------------------------------------

PLAN_REQUEST = "sentence_plan.amendment_request"


def plan_elsewhere(plan_id):
    """The plan, read only, when the code's transaction does not hold its master (the residence concludes an
    amendment of a home plan written on another database), else None: lock and write it here."""
    from django.conf import settings

    from apps.sentence_plan.models import SentencePlan

    if not settings.SHARD_WRITE_CIVS:
        return None
    plan = SentencePlan.all_objects.get(pk=plan_id)
    return None if saga.joins(_hall(plan.tenant_id)) else plan


def file_amendment_request(judgment, plan, changes, reason):
    """`request_from_amendment` across masters: the conclusion checked the request (`_assert_open_for`, the changes
    normalized) in the residence's transaction; the request is the plan's row, filed by its hall after the commit.
    On the soul's advance subject, so it lands before the `advance` the same conclusion asks (`advance_elsewhere`):
    a pending request keeps the soul at its stop (§4.2)."""
    saga.send(PLAN_REQUEST, judgment.tenant, plan.tenant, {
        "soul_id": str(judgment.soul_id), "plan_id": str(plan.pk), "from_tenant_code": judgment.tenant.code,
        "changes": changes, "reason": reason or "", "judgment_id": str(judgment.pk)},
        subject=f"advance:{judgment.soul_id}")


@handler(PLAN_REQUEST)
def _amendment_request(payload):
    """On the plan's master, as the plan's hall, under the soul's and the plan's locks; the plan checked again. A plan
    that will not take it now (a request filed between the conclusion's check and this delivery, the plan closed or
    held meanwhile) keeps the verdict and leaves its changes unasked: recorded here, as `record_blocked_return` does --
    SENTENCE_REQUEST_NOT_FILED on the soul's timeline (the plan's hall) and a notice to that hall's judges, the
    message DONE. It was one log line (VERIFY-stage5 3, REPORT-all-stages §3 item 4)."""
    from apps.events.models import EventType
    from apps.sentence_plan import requests
    from apps.sentence_plan.models import SentenceRequestKind
    from apps.sentence_plan.services import _lock_plan, hall_params, notify_judges, record_event, soul_params

    soul = _soul_model().lock(payload["soul_id"])
    plan = _lock_plan(payload["plan_id"])
    try:
        requests._assert_open_for(plan, SentenceRequestKind.AMEND)
        requests._create_request(plan, soul, from_tenant_code=payload["from_tenant_code"],
                                 kind=SentenceRequestKind.AMEND, changes=payload["changes"], reason=payload["reason"],
                                 user=None, judgment_id=payload["judgment_id"])
    except requests.PlanChangeRefusedError as e:
        record_event(soul, EventType.STATE_CHANGED, {
            "action": "SENTENCE_REQUEST_NOT_FILED", "code": e.code, "sentence_plan_id": str(plan.pk),
            "judgment_id": payload["judgment_id"], "from_tenant": payload["from_tenant_code"],
        }, tenant_id=plan.tenant_id)
        notify_judges({plan.tenant_id}, "sentence_request_pending", {
            **soul_params(soul), **hall_params([payload["from_tenant_code"]]), "kind": "sentence_request_not_filed"},
            plan.pk)


# ---- a cross-civilization rebirth (迁籍) ----------------------------------------------------------------------

def migrate(soul, target_hall):
    """`complete_rebirth` across masters: the next life belongs to the target civilization. Step 1 is the caller's
    transaction (it holds the soul's lock on the origin's master); the soul arrives on the target's master in step 2
    (with that hall's root unit, made there) and the origin's row is retired in step 3. The caller's soul is left
    as the single-database save leaves it, except `owner_org`, which is the target's to make."""
    origin = _hall(soul.tenant_id)
    saga.send(MIGRATE, origin, target_hall, {"soul": soul_values(soul), "target": target_hall.pk},
              subject=f"soul:{soul.pk}")
    soul.tenant_id = soul.home_tenant_id = target_hall.pk
    soul.owner_org_id = None
    return soul


def _migrate_arrive(payload):
    from apps.org.ownership import tenant_root

    target = _hall(payload["target"])
    _upsert_primary(payload["soul"], saga.master_of(target), tenant_id=target.pk, home_tenant_id=target.pk,
                    owner_org_id=tenant_root(target).pk)


def _migrate_leave(payload):
    values = payload["soul"]
    _retire(saga.master_of(_hall(values["tenant_id"])), values["id"], payload["target"], payload["target"])


handler(MIGRATE, done=_migrate_leave, moves=True)(_migrate_arrive)
