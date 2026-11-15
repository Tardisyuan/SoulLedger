"""Stage 1B (D3, docs/audit/2026-11-15-sharding/PLAN.md): a bare id keeps the delete rule it had.

The foreign keys across the control / shard boundary are `db_constraint=False, on_delete=DO_NOTHING`,
so neither the database nor Django's collector clears them any more. `apps.core.bare_ids` does, on every
alias `fanout()` names: a hard delete of a User nulls the SHARD rows' audit and pointer columns,
deletes what used to CASCADE, and is refused where it used to be PROTECT. `check_bare_ids` lists what
is left dangling -- run before reversing the 1B migrations.

Proven red 2026-11-15: `bare_ids.connect()` made a no-op -> the two hard-delete tests fail (the user
ids stay on the realm, the follow row survives, the protected account is deleted).
"""
from io import StringIO

import pytest
from django.apps import apps
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import models, transaction
from django.db.models import ProtectedError

from apps.authentication.models import User, UserRole
from apps.core.bare_ids import ON_DELETE, bare_ids_to, is_bare, label
from apps.realms.models import Realm
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _all_bare():
    return [f for fields in bare_ids_to().values() for f in fields]


def test_every_bare_id_that_cannot_be_nulled_names_its_rule_and_every_rule_is_a_bare_id():
    bare = {label(f): f for f in _all_bare()}
    assert len(bare) > 150, f"only {len(bare)} bare ids found; the discovery is broken, not the schema"
    unruled = sorted(k for k, f in bare.items() if not f.null and k not in ON_DELETE)
    assert not unruled, f"NOT NULL bare ids with no CASCADE / PROTECT rule (SET_NULL would fail): {unruled}"
    stale = sorted(k for k in ON_DELETE if k not in bare)
    assert not stale, f"rules for fields that are not bare ids: {stale}"


def test_discovery_sees_exactly_the_bare_foreign_keys():
    seen = {label(f) for f in _all_bare()}
    declared = {f"{m._meta.label}.{f.name}" for m in apps.get_models() for f in m._meta.concrete_fields
                if isinstance(f, models.ForeignKey) and is_bare(f) and f.model is m}
    assert seen == declared and "realms.Realm.create_user" in seen and "realms.Realm.parent_realm" not in seen


@pytest.fixture
def hall():
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]


def _realm(hall, code, user):
    return Realm.objects.create(realm_code=code, name_en=code, name_local=code, civilization="CHINESE",
                                realm_type="HELL", tenant=hall, create_user=user, update_user=user)


def test_a_hard_deleted_user_is_nulled_on_shard_rows_and_its_cascades_go(hall):
    from apps.social.models import Follow

    gone = User.objects.create_user(username="bare-gone", password="x", role=UserRole.JUDGE, tenant=hall)
    stays = User.objects.create_user(username="bare-stays", password="x", role=UserRole.JUDGE, tenant=hall)
    third = User.objects.create_user(username="bare-third", password="x", role=UserRole.JUDGE, tenant=hall)
    theirs, other = _realm(hall, "BR1", gone), _realm(hall, "BR2", stays)
    follow = Follow.objects.create(follower=gone, following=stays, tenant=hall)
    kept = Follow.objects.create(follower=stays, following=third, tenant=hall)

    User.all_objects.filter(pk=gone.pk).delete()  # the hard path; User.delete() is a soft delete

    theirs.refresh_from_db()
    other.refresh_from_db()
    assert (theirs.create_user_id, theirs.update_user_id) == (None, None)
    assert (other.create_user_id, other.update_user_id) == (stays.pk, stays.pk)  # absence of over-reach
    assert not Follow.all_objects.filter(pk=follow.pk).exists()
    assert Follow.all_objects.filter(pk=kept.pk).exists()


def test_the_soft_delete_of_a_user_touches_no_bare_id(hall):
    user = User.objects.create_user(username="bare-soft", password="x", role=UserRole.JUDGE, tenant=hall)
    realm = _realm(hall, "BR3", user)
    user.delete()
    realm.refresh_from_db()
    assert User.all_objects.get(pk=user.pk).is_deleted and realm.create_user_id == user.pk


def test_a_protected_bare_id_refuses_the_delete_and_nothing_changes(hall):
    from apps.chat.models import ChatIdentity
    from apps.soul_accounts.models import AccountOrigin, RebirthApplication, SoulAccount
    from apps.souls.models import Soul
    from apps.workflow.models import ApprovalWorkflow

    soul = Soul.objects.create(name="protected", tenant=hall)
    user = User.objects.create_user(username="bare-soul", password="x", role="SOUL", tenant=hall)
    account = SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
    identity = ChatIdentity.objects.create(account=account, soul=soul, localpart="soul_bare",
                                           matrix_user_id="@soul_bare:x")
    wf = ApprovalWorkflow.objects.create(number="WF-BARE-1", workflow_name="rebirth", tenant=hall, soul=soul)
    form = RebirthApplication._meta.get_field("desired_form").choices[0][0]
    RebirthApplication.objects.create(soul=soul, account=account, cycle=0, desired_form=form,
                                      status="UNDER_REVIEW", workflow=wf)

    # Raised from pre_delete, i.e. inside the collector's transaction (Django's own PROTECT raised before
    # it): a caller that wants to carry on wraps the delete in its own atomic block, as here.
    with pytest.raises(ProtectedError, match="RebirthApplication.account"), transaction.atomic():
        SoulAccount.objects.filter(pk=account.pk).delete()
    assert SoulAccount.objects.filter(pk=account.pk).exists()
    assert ChatIdentity.objects.filter(pk=identity.pk).exists()  # nothing of the account went either


def test_a_purged_souls_manifest_still_counts_what_went_through_bare_ids(hall):
    """Soul.purge reports every row it removed (tests/test_soul_purge.py). The soul's accounts, and their
    letters identity, now go through bare ids, which Django's own delete() count cannot see."""
    from apps.chat.models import ChatIdentity
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="purged", tenant=hall)
    user = User.objects.create_user(username="bare-purged", password="x", role="SOUL", tenant=hall)
    account = SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
    ChatIdentity.objects.create(account=account, soul=soul, localpart="soul_purged", matrix_user_id="@soul_purged:x")
    tables = [m for m in apps.get_models() if m._meta.managed and not m._meta.proxy]

    def counts():
        return {m._meta.label: m._base_manager.count() for m in tables}

    before = counts()
    manifest = soul.purge()
    after = counts()
    deleted = {k: before[k] - after[k] for k in before if after[k] < before[k]}
    assert manifest == deleted
    assert {"souls.Soul": 1, "soul_accounts.SoulAccount": 1, "chat.ChatIdentity": 1}.items() <= manifest.items()


def test_check_bare_ids_names_an_orphan_and_passes_without_one(hall):
    user = User.objects.create_user(username="bare-orphan", password="x", role=UserRole.JUDGE, tenant=hall)
    realm = _realm(hall, "BR4", user)
    out = StringIO()
    call_command("check_bare_ids", stdout=out)
    assert "no orphan bare ids" in out.getvalue()

    Realm.all_objects.filter(pk=realm.pk).update(create_user_id=user.pk + 10_000)
    out = StringIO()
    with pytest.raises(CommandError, match="1 bare id column"):
        call_command("check_bare_ids", stdout=out)
    assert "realms.Realm.create_user on default: 1 orphan id(s)" in out.getvalue()
    assert "realms.Realm.update_user" not in out.getvalue()
