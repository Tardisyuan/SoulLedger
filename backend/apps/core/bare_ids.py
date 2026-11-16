"""Bare ids: the foreign keys that cross the control / shard boundary (stage 1B, D3 in
docs/audit/2026-11-15-sharding/PLAN.md).

Each one is `ForeignKey(..., on_delete=DO_NOTHING, db_constraint=False)`: same `*_id` column, same
accessor, no database constraint and no ORM on_delete -- Django's delete collector only looks in the
database the deleted row came from, and the rows pointing at a control user will live in four others.
So the delete rule each of them had before 1B is kept here and applied explicitly, on every alias
`fanout()` names, from a `pre_delete` receiver on each target model (wired in `apps/souls/apps.py`) --
only when the row deleted is the authoritative one (`primary_alias`). Deleting a copy (a
shard copy before its civilization's writes are cut over, a reconcile removing an extra row) touches
no other database.
A hard delete of a User (only ever a queryset delete: `User.delete()` is a soft delete) is the main
case; SoulAccount, Soul, Actor, Organization and django-celery-beat's PeriodicTask are the others.

Which keys must be bare is a rule, not this file's choice: `tests/test_fk_inventory_across_tenants.py`
derives it from the placements and pins each edge's DB | BARE.
"""
from collections import Counter
from contextlib import contextmanager
from contextvars import ContextVar
from functools import cache

from django.apps import apps
from django.conf import settings
from django.db import models, router
from django.db.models import ProtectedError, RestrictedError
from django.db.models.deletion import Collector
from django.db.models.signals import pre_delete

#: The rule a bare id had before it was made bare, where it was not SET_NULL. Every non-null bare id
#: needs one (it cannot be nulled); `tests/test_bare_ids.py` holds that and that each key is real.
ON_DELETE = {
    "chat.ChatBlock.blocked": models.CASCADE,
    "chat.ChatBlock.blocker": models.CASCADE,
    "chat.ChatIdentity.account": models.CASCADE,
    "chat.ChatImage.uploader": models.CASCADE,
    "chat.Conversation.account_a": models.CASCADE,
    "chat.Conversation.account_b": models.CASCADE,
    "chat.InboxOfficerState.user": models.CASCADE,
    "scheduler.ScheduledJob.periodic_task": models.CASCADE,
    "social.Comment.author": models.CASCADE,
    "social.Follow.follower": models.CASCADE,
    "social.Follow.following": models.CASCADE,
    "social.Post.author": models.CASCADE,
    "social.PostMedia.uploader": models.CASCADE,
    "social.Reaction.user": models.CASCADE,
    "social.Report.target_user": models.CASCADE,
    "social.ReportEntry.reporter": models.CASCADE,
    "social.SocialInteraction.actor": models.CASCADE,
    "social.SocialInteraction.recipient": models.CASCADE,
    "social.SocialMute.user": models.CASCADE,
    "soul_accounts.CooldownShorteningRequest.account": models.PROTECT,
    "soul_accounts.InitialCredential.account": models.CASCADE,
    "soul_accounts.RebirthApplication.account": models.PROTECT,
    "soul_accounts.SoulAccount.soul": models.CASCADE,
    "soul_accounts.SoulDataExport.account": models.CASCADE,
    "soul_assist.AssistConversation.account": models.CASCADE,
    "soul_assist.AssistConversation.user": models.CASCADE,
    "soul_push.PushDelivery.soul": models.CASCADE,
    "soul_push.PushDevice.soul": models.CASCADE,
    "soul_push.PushPreference.soul": models.CASCADE,
    # Stage 2: SHARD -> SHARD edges that cross civilizations (tests/tenancy_fk_inventory.py, "crosses by
    # design" / "may cross"); the `*_bare_ids_across_civilizations` migrations.
    "chat.Conversation.initiator": models.CASCADE,
    "chat.Conversation.soul_a": models.CASCADE,
    "chat.Conversation.soul_b": models.CASCADE,
    "dispatch.CrossTenantJudgmentParticipant.judgment": models.CASCADE,
    "dispatch.DispatchRecord.soul": models.CASCADE,
    "disposition.Disposition.soul": models.CASCADE,
    "events.SoulEvent.soul": models.PROTECT,
    "judgment.Judgment.soul": models.CASCADE,
    "judgment.JudgmentAppeal.soul": models.CASCADE,
    "realms.SoulPathEntry.soul": models.CASCADE,
    "reincarnation.Reincarnation.soul": models.CASCADE,
    "sentence_plan.SentencePlan.soul": models.CASCADE,
    "soul_accounts.RebirthApplication.appeal_workflow": models.PROTECT,
    "soul_accounts.RebirthApplication.workflow": models.PROTECT,
    "souls.SoulRecord.soul": models.CASCADE,
    "workflow.ApprovalNode.segment": models.CASCADE,
    "workflow.ApprovalWorkflow.soul": models.CASCADE,
    "workflow.WorkflowSegment.workflow": models.CASCADE,
    # Stage 2 review: a residence court rules on records the home hall wrote (`*_bare_ids_stage2_review`).
    "judgment.EvidenceAdmission.record": models.RESTRICT,
    # Stage 4 gap 4c: the three M2M through tables made explicit (`*_explicit_through_bare_ids`); a through row
    # goes with either end, as Django's auto-created one did.
    "death_sync.TudiGodOfficer.tudigod": models.CASCADE,
    "death_sync.TudiGodOfficer.user": models.CASCADE,
    "judgment.CityGodOfficer.citygod": models.CASCADE,
    "judgment.CityGodOfficer.user": models.CASCADE,
    "perm.RoleDataScopeOrg.organization": models.CASCADE,
    "perm.RoleDataScopeOrg.roledatascope": models.CASCADE,
}


def label(field) -> str:
    return f"{field.model._meta.label}.{field.name}"


def is_bare(field) -> bool:
    """A forward FK with no database constraint: the ones we cut (on_delete=DO_NOTHING), and both FKs of
    an auto-created M2M through table whose M2M field has `db_constraint=False` (none since stage 4 gap 4c
    made RoleDataScope.orgs, CityGod.officers and TudiGod.officers explicit through models with DO_NOTHING
    keys: Django cleared an auto-created one only on the database the deleted row is in, where the table
    may not be). Checked for orphans and cleared across databases like the others."""
    if not isinstance(field, models.ForeignKey) or field.db_constraint:
        return False
    return field.model._meta.auto_created or field.remote_field.on_delete is models.DO_NOTHING


def rule(field):
    """The delete rule a bare id keeps: a through-table row goes with either end (CASCADE)."""
    if field.model._meta.auto_created:
        return models.CASCADE
    return ON_DELETE.get(label(field), models.SET_NULL)


@cache
def bare_ids_to():
    """{target concrete model: [bare FK fields pointing at it]} over every installed model."""
    out = {}
    for m in apps.get_models(include_auto_created=True):
        for f in m._meta.concrete_fields:
            if is_bare(f) and f.model is m:
                out.setdefault(f.related_model._meta.concrete_model, []).append(f)
    return out


def clear_bare_ids(target, pks, aliases):
    """Apply each bare id's own rule to the rows pointing at `pks` of `target`, on every alias:
    PROTECT refuses before anything changes, then CASCADE deletes and SET_NULL nulls."""
    fields = bare_ids_to().get(target._meta.concrete_model, [])
    # Only where the pointing table exists: a CONTROL source (User.create_user...) is not on a shard, and
    # asking a shard for it failed every hard delete of a user once fanout() named one (stage 2).
    on = {alias: [f for f in fields if router.allow_migrate_model(alias, f.model)] for alias in aliases}
    for alias in aliases:
        for f in on[alias]:
            # RESTRICT is refused like PROTECT unless an enclosing bare-id delete already weighed it against
            # everything it deletes (`_restrict_bare` below, e.g. a purged soul's records and judgments).
            how = rule(f)
            if how is models.PROTECT or (how is models.RESTRICT and not _settled.get()):
                held = list(f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": pks})[:5])
                if held:
                    error = ProtectedError if how is models.PROTECT else RestrictedError
                    raise error(f"{label(f)} still points at {target._meta.label} {list(pks)}", set(held))
    for alias in aliases:
        # One collector for every CASCADE on the alias, as Django's own would have been: a RESTRICT met on
        # the way (EvidenceAdmission.record -> SoulRecord) is lifted when the restricting row goes in the
        # same delete (through Judgment), which one collector per field could not see (stage 2: both
        # SoulRecord.soul and Judgment.soul are bare).
        collector = Collector(using=alias, origin=target)
        for f in on[alias]:
            rows = f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": pks})
            how = rule(f)
            if how is models.CASCADE:
                collector.collect(rows, fail_on_restricted=False)
            elif how is models.SET_NULL:
                rows.update(**{f.attname: None})
        _restrict_bare(collector, alias)
        _refuse_restricted(collector)
        token = _settled.set(True)
        try:
            _, per_model = collector.delete()
        finally:
            _settled.reset(token)
        tally = _tally.get()
        if tally is not None:
            tally.update(per_model)


#: True while a bare-id collector deletes what `_restrict_bare` already checked: the pre_delete of each row
#: it deletes calls `clear_bare_ids` again, and that call must not refuse a RESTRICT the outer one lifted.
_settled = ContextVar("bare_id_restrict_settled", default=False)


def _restrict_bare(collector, alias):
    """Register the bare RESTRICT ids pointing at what `collector` holds as Django's own RESTRICT would be,
    so `_refuse_restricted` lifts them when the restricting rows go in the same delete.
    ponytail: only a delete that starts in bare_ids sees the whole set; a plain Django delete that removes a
    record and its admission together (a Tenant hard delete; none in the code) is refused by the nested
    check instead. Teach the Django collector path if one appears."""
    for model, instances in list(collector.data.items()):
        for f in bare_ids_to().get(model._meta.concrete_model, []):
            if rule(f) is models.RESTRICT and router.allow_migrate_model(alias, f.model):
                refs = f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": [o.pk for o in instances]})
                collector.add_restricted_objects(f, list(refs))


def _refuse_restricted(collector):
    """Django's end-of-collect RESTRICT check (`Collector.collect(fail_on_restricted=True)`), once over
    everything collected above."""
    for model, instances in collector.data.items():
        collector.clear_restricted_objects_from_set(model, instances)
    for qs in collector.fast_deletes:
        collector.clear_restricted_objects_from_queryset(qs.model, qs)
    held = {o for fields in collector.restricted_objects.values() for objs in fields.values() for o in objs}
    if held:
        raise RestrictedError("rows are referenced through restricted foreign keys", held)


#: The rows a CASCADE above deleted, for a caller that reports what a delete removed: Django's
#: `delete()` counts only what its own collector reached, and a bare id is not reached any more.
_tally = ContextVar("bare_id_cascades", default=None)


@contextmanager
def counting_cascades():
    """`with counting_cascades() as extra:` -- `extra` (a Counter of "app.Model" -> rows) gains every
    row a bare-id CASCADE deleted inside the block, nested ones included (Soul.purge's manifest)."""
    tally = Counter()
    token = _tally.set(tally)
    try:
        yield tally
    finally:
        _tally.reset(token)


def primary_alias(instance):
    """The alias holding the authoritative row of `instance`: its civilization's shard once that
    civilization's writes are cut over (settings.SHARD_WRITE_CIVS, stage 4), else the control database.
    CONTROL / REFERENCE rows, and SHARD rows with no hall (D2), are always on "default". The same answer as
    the write router's (`apps.core.shard_reads.write_alias_of`)."""
    from apps.core.sharding import SHARD, placement

    if not settings.SHARD_WRITE_CIVS or placement(type(instance)) != SHARD:
        return "default"
    from apps.core.shard_reads import write_alias_of

    return write_alias_of(instance)


def _on_pre_delete(sender, instance, using, **kwargs):
    from apps.core.sharding import fanout

    if using != primary_alias(instance):
        return  # a copy: Django's collector clears its own database; the other databases keep theirs
    # ponytail: one statement per bare id per deleted row; hard deletes of these targets are rare
    # (queryset deletes in tests and admin). Batch per collector if a bulk path ever appears.
    clear_bare_ids(sender, [instance.pk], fanout())


def connect():
    for target in bare_ids_to():
        pre_delete.connect(_on_pre_delete, sender=target, dispatch_uid=f"bare_ids:{target._meta.label}")


def homes(target, aliases):
    """The aliases among `aliases` whose rows of `target` count as real: "default" for a CONTROL model;
    for a SHARD / REFERENCE one, every alias it is migrated on (control and the shards), because a SHARD
    row lives in its civilization's shard once that is cut over."""
    from apps.core.sharding import CONTROL, placement

    if placement(target) == CONTROL:
        return ["default"]
    return [a for a in aliases if router.allow_migrate_model(a, target)]


def orphans(aliases):
    """[(edge label, alias, count)] of bare ids, on each alias, that name no row of their target on any
    of the target's `homes`. What `check_bare_ids` prints; run it before reversing the 1B migrations,
    because putting a constraint back fails on the first orphan."""
    found = []
    for target, fields in bare_ids_to().items():
        where = homes(target, aliases)
        for alias in aliases:
            if where == [alias]:
                known = target._base_manager.using(alias).order_by().values("pk")
            else:
                # Django refuses a subquery across databases: the ids of every home, as one list. order_by()
                # here and above: a target ordered through a foreign key (WorkflowSegment: "workflow") is read
                # with an INNER JOIN, which drops a row whose bare id crosses to another database.
                # ponytail: every pk in memory; batch it if a target table outgrows that.
                known = {pk for a in where for pk in target._base_manager.using(a).order_by().values_list("pk", flat=True)}
            for f in fields:
                if not router.allow_migrate_model(alias, f.model):
                    continue  # the pointing table is not on this alias (a CONTROL source on a shard)
                n = (f.model._base_manager.using(alias).exclude(**{f"{f.attname}__isnull": True})
                     .exclude(**{f"{f.attname}__in": known}).count())
                if n:
                    found.append((label(f), alias, n))
    return found
