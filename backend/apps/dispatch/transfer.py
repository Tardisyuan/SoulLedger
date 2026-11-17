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
  3  source master   (relay) the record EXECUTED (or RETURNED), and the source row DEMOTED (`_retire`).

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
    # Demoted first: until then the soul has a primary-looking row on both masters (step 2 made the target's), and a
    # read through `record.soul` (the audit signal of the save below) would find two.
    # ponytail: that window is open between step 2 and step 3 for every reader; it closes with the relay (seconds).
    # A read-side dedupe of a soul seen on two masters would close it for good.
    _retire(saga.master_of(record.source_tenant), soul["id"], record.target_tenant_id, soul["home_tenant_id"])
    if not record.transition_to(
            DispatchStatus.EXECUTED, in_saga=True, executed_at=timezone.now(), source_owner_org_id=soul["owner_org_id"]):
        raise ValueError(f"Cannot execute dispatch in status: {record.status}")


def _not_executed(payload):
    """Compensation (the target refused): the source's station reopened. The record never left APPROVED."""
    from apps.realms.models import SoulPathEntry

    record = DispatchRecord._base_manager.get(pk=payload["dispatch_id"])
    if payload["closed_entry"]:
        SoulPathEntry._base_manager.using(saga.master_of(record.source_tenant)).filter(
            pk=payload["closed_entry"]).update(left_at=None)


handler(EXECUTE, done=_executed, refused=_not_executed)(_arrive)


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

def end_residence(soul, *, actor, trigger, reason=""):
    """Step 1 of `DispatchService.end_residence` across masters: on the residence's master."""
    from apps.dispatch.services import DispatchService
    from apps.realms.path import SoulPathService

    Soul = _soul_model()  # noqa: N806
    residence = _hall(soul.tenant_id)
    with saga.on_master(residence):
        locked = Soul.lock(soul.pk)
        DispatchService.check_returnable(locked)
        subject = f"soul:{locked.pk}"
        if saga.in_flight(subject, residence):
            raise ValueError("Soul is already on its way home")
        record = (DispatchRecord._base_manager
                  .filter(soul_id=locked.pk, status=DispatchStatus.EXECUTED, target_tenant_id=locked.tenant_id,
                          is_deleted=False)
                  .order_by("-executed_at").first())
        SoulPathService.leave(locked)
        if trigger == DispatchService.RETURN_MANUAL:
            DispatchService.void_residence_dispositions(locked, residence, record)
        saga.send(RETURN, residence, locked.home_tenant, {
            "soul": soul_values(locked), "dispatch_id": str(record.pk) if record else None, "trigger": trigger,
            "reason": reason, "actor": str(actor) if actor is not None else None,
            "actor_id": actor.pk if getattr(actor, "is_authenticated", False) else None,
        }, subject=subject)
    soul.tenant_id = locked.home_tenant_id  # what the caller holds, as the single-database path leaves it
    return record


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
            "trigger": payload["trigger"], "at": timezone.now().isoformat()}, subject=subject)


handler(RETURN, done=_left_residence)(_come_home)

RETURN_SETTLED = "dispatch.return_settled"


@handler(RETURN_SETTLED)
def _return_settled(payload):
    """The home's rows of a return: the record RETURNED (on its own master), a manual return's plan moved on."""
    from apps.dispatch.services import DispatchService

    home = _hall(payload["home_id"])
    record = DispatchRecord._base_manager.filter(pk=payload["dispatch_id"]).first() if payload["dispatch_id"] else None
    if record is not None:
        returned = {"dispatch_id": str(record.pk), "at": payload["at"]}
        if saga.crosses(home, record.tenant):
            saga.send(RECORD_RETURNED, home, record.tenant, returned)
        else:
            _record_returned(returned)
    if payload["trigger"] == DispatchService.RETURN_MANUAL:
        Soul = _soul_model()  # noqa: N806
        soul = Soul._base_manager.using(saga.master_of(home)).get(pk=payload["soul_id"])
        DispatchService.advance_plan_after_manual_return(soul, record)


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


handler(MIGRATE, done=_migrate_leave)(_migrate_arrive)
