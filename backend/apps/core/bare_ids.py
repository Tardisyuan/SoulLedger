"""Bare ids: the foreign keys that cross the control / shard boundary (stage 1B, D3 in
docs/audit/2026-11-15-sharding/PLAN.md).

Each one is `ForeignKey(..., on_delete=DO_NOTHING, db_constraint=False)`: same `*_id` column, same
accessor, no database constraint and no ORM on_delete -- Django's delete collector only looks in the
database the deleted row came from, and the rows pointing at a control user will live in four others.
So the delete rule each of them had before 1B is kept here and applied explicitly, on every alias
`fanout()` names, from a `pre_delete` receiver on each target model (wired in `apps/souls/apps.py`) --
only when the row deleted is the authoritative one (`primary_alias`). Deleting a copy (the test shadow,
a shard copy before its civilization's writes are cut over, a reconcile removing an extra row) touches
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
from django.db.models import ProtectedError
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
}


def label(field) -> str:
    return f"{field.model._meta.label}.{field.name}"


def is_bare(field) -> bool:
    """A forward FK with no database constraint: the ones we cut (on_delete=DO_NOTHING), and both FKs of
    an auto-created M2M through table whose M2M field has `db_constraint=False` (RoleDataScope_orgs,
    CityGod_officers, TudiGod_officers). Those keep Django's CASCADE, but Django clears them only on the
    database the deleted row is in, and reversing 1B puts their constraints back -- so they are checked
    for orphans and cleared across databases like the others."""
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
            if rule(f) is models.PROTECT:
                held = list(f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": pks})[:5])
                if held:
                    raise ProtectedError(f"{label(f)} still points at {target._meta.label} {list(pks)}", set(held))
    for alias in aliases:
        for f in on[alias]:
            rows = f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": pks})
            how = rule(f)
            if how is models.CASCADE:
                _, per_model = rows.delete()
                tally = _tally.get()
                if tally is not None:
                    tally.update(per_model)
            elif how is models.SET_NULL:
                rows.update(**{f.attname: None})


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
    CONTROL / REFERENCE rows, and SHARD rows with no hall (D2), are always on "default"."""
    from apps.core.sharding import SHARD, alias_for_civilization, placement, tenant_path

    if not settings.SHARD_WRITE_CIVS or placement(type(instance)) != SHARD:
        return "default"
    hall = instance
    for step in tenant_path(type(instance)).split("__"):
        hall = getattr(hall, step, None)
        if hall is None:
            return "default"
    civ = hall.civilization
    return alias_for_civilization(civ) if civ in settings.SHARD_WRITE_CIVS else "default"


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
                known = target._base_manager.using(alias).values("pk")
            else:
                # Django refuses a subquery across databases: the ids of every home, as one list.
                # ponytail: every pk in memory; batch it if a target table outgrows that.
                known = {pk for a in where for pk in target._base_manager.using(a).values_list("pk", flat=True)}
            for f in fields:
                if not router.allow_migrate_model(alias, f.model):
                    continue  # the pointing table is not on this alias (a CONTROL source on a shard)
                n = (f.model._base_manager.using(alias).exclude(**{f"{f.attname}__isnull": True})
                     .exclude(**{f"{f.attname}__in": known}).count())
                if n:
                    found.append((label(f), alias, n))
    return found
