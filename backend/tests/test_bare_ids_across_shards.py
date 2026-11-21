"""Bare-id delete rules across databases, through the real `pre_delete` receivers (apps/core/bare_ids.py),
on real civilization shards (stage-1B re-review, items G and H; runs in the `sharded` group).

G  a PROTECT source that exists only on a shard (RebirthApplication.account) blocks deleting the control
   SoulAccount it names. Mutation: the PROTECT probe looks only at the first alias -> red.
H  the M2M through rows (CityGodOfficer, TudiGodOfficer on a shard) are cleared when the control user they
   name is deleted -- by the delete, not by calling clear_bare_ids. Mutation: bare_ids_to() leaves out the
   through tables -> red. The RoleDataScopeOrg direction (org deleted on its shard, through rows on control)
   was a strict xfail until stage 4 made the three through tables explicit (gap 4c).
Writing these found a stage-2 defect, fixed in apps/core/bare_ids.py: clear_bare_ids and orphans asked every
alias for every bare id, so once fanout() named a shard, every hard delete of a user died on a CONTROL source
table (User.create_user ...) that a shard does not have.

`fanout()` names every shard only when sharded (settings.SHARDED), so each test places its rows in the one-database
form and switches to the sharded one for the delete it asks about (which also makes the shard the primary).

    cd backend && SECRET_KEY=ci-test-key-not-for-production-32-bytes-min DEBUG=true \\
      DATABASE_URL=sqlite:///:memory: REDIS_URL=redis://127.0.0.1:6399/0 .venv/bin/python -m pytest \\
      --ds=config.settings_sharded -m sharded --no-cov tests/test_bare_ids_across_shards.py
"""
import pytest
from django.db import transaction
from django.db.models import ProtectedError

SHARD = "civ_greek"

pytestmark = [pytest.mark.sharded, pytest.mark.django_db(databases="__all__")]


@pytest.fixture
def greek(settings):
    """A Greek hall in control and its copy on the shard (D4)."""
    from apps.tenants.models import Tenant

    hall = Tenant.objects.get_or_create(code="GR_BARE_X", defaults={"display_name": "GR",
                                                                     "declared_civilization": "GREEK"})[0]
    Tenant._base_manager.using(SHARD).bulk_create(
        [Tenant(**{f.attname: getattr(hall, f.attname) for f in Tenant._meta.concrete_fields})])
    yield hall


def _user(name):
    from apps.authentication.models import User

    return User.objects.create_user(username=name, password="x", role="JUDGE")


# --- G ------------------------------------------------------------------------

def test_a_protect_row_only_on_a_shard_blocks_deleting_the_control_account(greek, settings):
    from apps.authentication.models import User
    from apps.soul_accounts.models import AccountOrigin, RebirthApplication, SoulAccount
    from apps.souls.models import Soul

    soul = Soul.objects.create(name="g-protect", tenant=greek)
    user = User.objects.create_user(username="g-protect", password="x", role="SOUL", tenant=greek)
    account = SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
    from apps.workflow.models import ApprovalWorkflow

    Soul._base_manager.using(SHARD).bulk_create([Soul(pk=soul.pk, name=soul.name, tenant_id=greek.pk)])
    workflow = ApprovalWorkflow(number="WF-GRX-1", soul_id=soul.pk, workflow_name="rebirth", tenant_id=greek.pk)
    ApprovalWorkflow._base_manager.using(SHARD).bulk_create([workflow])
    RebirthApplication._base_manager.using(SHARD).bulk_create([RebirthApplication(
        soul_id=soul.pk, account_id=account.pk, cycle=0, workflow_id=workflow.pk,
        desired_form=RebirthApplication._meta.get_field("desired_form").choices[0][0],
        status=RebirthApplication._meta.get_field("status").choices[0][0])])
    assert not RebirthApplication._base_manager.using("default").filter(account_id=account.pk).exists()

    settings.SHARDED = True
    with pytest.raises(ProtectedError, match="RebirthApplication.account"), transaction.atomic(using="default"):
        SoulAccount._base_manager.using("default").filter(pk=account.pk).delete()
    assert SoulAccount._base_manager.using("default").filter(pk=account.pk).exists()


# --- H ------------------------------------------------------------------------

@pytest.mark.parametrize("model_path", ["apps.judgment.models.CityGod", "apps.death_sync.models.TudiGod"])
def test_deleting_a_control_user_clears_its_through_rows_on_the_shard(greek, model_path, settings):
    import importlib

    from apps.authentication.models import User

    module, name = model_path.rsplit(".", 1)
    model = getattr(importlib.import_module(module), name)
    through = model.officers.through
    gone, kept = _user(f"h-gone-{name}"), _user(f"h-kept-{name}")
    god = model(tenant_id=greek.pk, name=f"{name} of Hades")
    model._base_manager.using(SHARD).bulk_create([god])
    through._base_manager.using(SHARD).bulk_create(
        [through(**{f"{name.lower()}_id": god.pk, "user_id": u.pk}) for u in (gone, kept)])

    settings.SHARDED = True
    User._base_manager.using("default").filter(pk=gone.pk).delete()  # a hard delete of the control user

    left = set(through._base_manager.using(SHARD).values_list("user_id", flat=True))
    assert left == {kept.pk}, left  # its own row went, the other officer's stayed


def test_deleting_an_organization_on_its_shard_clears_the_control_scope_rows(greek, settings):
    """The other direction: sharded, the shard's Organization is the primary; deleting it
    there clears RoleDataScopeOrg rows on control. Until gap 4c this was a strict xfail: Django's collector on
    the shard cascaded into RoleDataScope.orgs' auto-created through table, a CONTROL table absent there (no such
    table: perm_role_data_scope_orgs). Mutation: the through key back to CASCADE -> red."""
    from apps.org.models import Organization
    from apps.perm.models import Role, RoleDataScope

    settings.SHARDED = True
    from django.core.management import call_command

    call_command("assign_shard_id_ranges", "--civ", "GREEK", verbosity=0)  # gap 4a: before the first shard write
    root = Organization(tenant_id=greek.pk, name="ROOT", code="GRX_ROOT")  # one live root per hall
    Organization._base_manager.using(SHARD).bulk_create([root])
    root = Organization._base_manager.using(SHARD).get(code="GRX_ROOT")  # its id, on any engine
    orgs = [Organization(tenant_id=greek.pk, name=n, code=f"GRX_{n}", parent_id=root.pk) for n in ("GONE", "KEPT")]
    Organization._base_manager.using(SHARD).bulk_create(orgs)
    orgs = list(Organization._base_manager.using(SHARD).filter(code__in=["GRX_GONE", "GRX_KEPT"]).order_by("code"))  # GONE, KEPT
    role = Role.objects.create(name="grx_scope", display_name="scope")
    scope = RoleDataScope.objects.create(role=role, scope="ORG")
    through = RoleDataScope.orgs.through
    through._base_manager.using("default").bulk_create(
        [through(roledatascope_id=scope.pk, organization_id=o.pk) for o in orgs])

    Organization._base_manager.using(SHARD).filter(pk=orgs[0].pk).delete()

    left = set(through._base_manager.using("default").values_list("organization_id", flat=True))
    assert left == {orgs[1].pk}, left


def test_orphans_reads_each_bare_id_where_its_table_is(greek):
    """`check_bare_ids` over control and a shard: a CONTROL source (User.create_user...) is read on control
    only; a shard row naming a user control does not have is an orphan, one naming a live user is not."""
    from apps.core.bare_ids import orphans
    from apps.judgment.models import CityGod

    through = CityGod.officers.through
    god = CityGod(tenant_id=greek.pk, name="orphan check")
    CityGod._base_manager.using(SHARD).bulk_create([god])
    live = _user("orphan-live")
    through._base_manager.using(SHARD).bulk_create([through(citygod_id=god.pk, user_id=live.pk)])
    assert orphans(["default", SHARD]) == []
    through._base_manager.using(SHARD).bulk_create([through(citygod_id=god.pk, user_id=live.pk + 10_000)])
    assert orphans(["default", SHARD]) == [("judgment.CityGodOfficer.user", SHARD, 1)]
