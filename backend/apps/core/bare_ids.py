"""Bare ids: the foreign keys that cross the control / shard boundary (stage 1B, D3 in
docs/audit/2026-11-15-sharding/PLAN.md).

Each one is `ForeignKey(..., on_delete=DO_NOTHING, db_constraint=False)`: same `*_id` column, same
accessor, no database constraint and no ORM on_delete -- Django's delete collector only looks in the
database the deleted row came from, and the rows pointing at a control user will live in four others.
So the delete rule each of them had before 1B is kept here and applied explicitly, on every alias
`fanout()` names, from a `pre_delete` receiver on each target model (wired in `apps/souls/apps.py`).
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
from django.db import models
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
    """A forward FK we cut: no constraint and no ORM on_delete. (Auto-created M2M through tables keep
    Django's CASCADE; their M2M field carries `db_constraint=False`, the ORM still clears them.)"""
    return (isinstance(field, models.ForeignKey) and not field.db_constraint
            and field.remote_field.on_delete is models.DO_NOTHING)


@cache
def bare_ids_to():
    """{target concrete model: [bare FK fields pointing at it]} over every installed model."""
    out = {}
    for m in apps.get_models():
        for f in m._meta.concrete_fields:
            if is_bare(f) and f.model is m:
                out.setdefault(f.related_model._meta.concrete_model, []).append(f)
    return out


def clear_bare_ids(target, pks, aliases):
    """Apply each bare id's own rule to the rows pointing at `pks` of `target`, on every alias:
    PROTECT refuses before anything changes, then CASCADE deletes and SET_NULL nulls."""
    fields = bare_ids_to().get(target._meta.concrete_model, [])
    for alias in aliases:
        for f in fields:
            if ON_DELETE.get(label(f)) is models.PROTECT:
                held = list(f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": pks})[:5])
                if held:
                    raise ProtectedError(f"{label(f)} still points at {target._meta.label} {list(pks)}", set(held))
    for alias in aliases:
        for f in fields:
            rows = f.model._base_manager.using(alias).filter(**{f"{f.attname}__in": pks})
            rule = ON_DELETE.get(label(f), models.SET_NULL)
            if rule is models.CASCADE:
                _, per_model = rows.delete()
                tally = _tally.get()
                if tally is not None:
                    tally.update(per_model)
            elif rule is models.SET_NULL:
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


def _on_pre_delete(sender, instance, using, **kwargs):
    from apps.core.sharding import fanout

    # ponytail: one statement per bare id per deleted row; hard deletes of these targets are rare
    # (queryset deletes in tests and admin). Batch per collector if a bulk path ever appears.
    clear_bare_ids(sender, [instance.pk], fanout())


def connect():
    for target in bare_ids_to():
        pre_delete.connect(_on_pre_delete, sender=target, dispatch_uid=f"bare_ids:{target._meta.label}")


def orphans(aliases):
    """[(edge label, alias, count)] of bare ids that name no row of their target on the control
    database. What `check_bare_ids` prints; run it before reversing the 1B migrations, because putting
    a constraint back fails on the first orphan."""
    found = []
    for target, fields in bare_ids_to().items():
        in_control = target._base_manager.using("default").values("pk")
        for alias in aliases:
            # Django refuses a subquery across databases; another alias gets the ids as a list.
            known = in_control if alias == "default" else list(in_control.values_list("pk", flat=True))
            for f in fields:
                n = (f.model._base_manager.using(alias).exclude(**{f"{f.attname}__isnull": True})
                     .exclude(**{f"{f.attname}__in": known}).count())
                if n:
                    found.append((label(f), alias, n))
    return found
