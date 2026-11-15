"""Stage 1B (D3, docs/audit/2026-11-15-sharding/PLAN.md): a bare id keeps the delete rule it had.

The foreign keys across the control / shard boundary are `db_constraint=False, on_delete=DO_NOTHING`,
so neither the database nor Django's collector clears them any more. `apps.core.bare_ids` does, on every
alias `fanout()` names: a hard delete of a User nulls the SHARD rows' audit and pointer columns,
deletes what used to CASCADE, and is refused where it used to be PROTECT. `check_bare_ids` lists what
is left dangling -- run before reversing the 1B migrations.

Proven red 2026-11-15: `bare_ids.connect()` made a no-op -> the two hard-delete tests fail (the user
ids stay on the realm, the follow row survives, the protected account is deleted).
"""
import uuid as uuid_module
from io import StringIO

import pytest
from django.apps import apps
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import models, transaction
from django.db.models import ProtectedError

from apps.authentication.models import User, UserRole
from apps.core.bare_ids import ON_DELETE, bare_ids_to, is_bare, label, rule
from apps.realms.models import Realm
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _all_bare():
    return [f for fields in bare_ids_to().values() for f in fields]


def test_every_bare_id_that_cannot_be_nulled_names_its_rule_and_every_rule_is_a_bare_id():
    bare = {label(f): f for f in _all_bare()}
    assert len(bare) > 150, f"only {len(bare)} bare ids found; the discovery is broken, not the schema"
    unruled = sorted(k for k, f in bare.items() if not f.null and rule(f) is models.SET_NULL)
    assert not unruled, f"NOT NULL bare ids with no CASCADE / PROTECT rule (SET_NULL would fail): {unruled}"
    stale = sorted(k for k in ON_DELETE if k not in bare)
    assert not stale, f"rules for fields that are not bare ids: {stale}"


def test_discovery_sees_exactly_the_bare_foreign_keys():
    seen = {label(f) for f in _all_bare()}
    declared = {f"{m._meta.label}.{f.name}" for m in apps.get_models(include_auto_created=True)
                for f in m._meta.concrete_fields
                if isinstance(f, models.ForeignKey) and is_bare(f) and f.model is m}
    assert seen == declared and "realms.Realm.create_user" in seen and "realms.Realm.parent_realm" not in seen
    # The M2M through tables whose M2M field is db_constraint=False: both their keys, CASCADE.
    through = {"perm.RoleDataScope_orgs.organization", "perm.RoleDataScope_orgs.roledatascope",
               "judgment.CityGod_officers.user", "judgment.CityGod_officers.citygod",
               "death_sync.TudiGod_officers.user", "death_sync.TudiGod_officers.tudigod"}
    assert {label(f) for f in _all_bare() if f.model._meta.auto_created} == through


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


def test_purging_a_soul_whose_record_a_court_ruled_on_goes_through(hall):
    """EvidenceAdmission.record is RESTRICT: refused alone, lifted when the admission goes in the same delete
    (through its judgment). Since stage 2 both SoulRecord.soul and Judgment.soul are bare ids, so the two
    cascades come from bare_ids -- in one collector, or the RESTRICT would refuse the purge."""
    from apps.judgment.models import EvidenceAdmission, Judgment
    from apps.souls.models import Soul
    from apps.souls.record_models import SoulRecord

    soul = Soul.objects.create(name="ruled-on", tenant=hall)
    record = SoulRecord.objects.create(soul=soul, tenant=hall, record_type=SoulRecord._meta.get_field(
        "record_type").choices[0][0], civilization="CHINESE")
    judgment = Judgment.objects.create(soul=soul, tenant=hall, case_number="BARE-RESTRICT-1", civilization="CHINESE")
    EvidenceAdmission.objects.create(judgment=judgment, record=record, tenant=hall)

    manifest = soul.purge()
    assert not Soul.all_objects.filter(pk=soul.pk).exists()
    assert not SoulRecord._base_manager.filter(pk=record.pk).exists()
    assert manifest.get("judgment.EvidenceAdmission") == 1 and manifest.get("souls.SoulRecord") == 1, manifest


def test_a_hard_delete_of_a_record_a_court_ruled_on_is_refused(hall):
    """The other half of RESTRICT, now applied by bare_ids (EvidenceAdmission.record is a bare id since the
    stage 2 review): the record alone does not go, and nothing changes."""
    from django.db.models import RestrictedError

    from apps.judgment.models import EvidenceAdmission, Judgment
    from apps.souls.models import Soul
    from apps.souls.record_models import SoulRecord

    soul = Soul.objects.create(name="ruled-on-alone", tenant=hall)
    record = SoulRecord.objects.create(soul=soul, tenant=hall, record_type="DEMERIT", civilization="CHINESE")
    judgment = Judgment.objects.create(soul=soul, tenant=hall, case_number="BARE-RESTRICT-2", civilization="CHINESE")
    admission = EvidenceAdmission.objects.create(judgment=judgment, record=record, tenant=hall)
    unruled = SoulRecord.objects.create(soul=soul, tenant=hall, record_type="DEMERIT", civilization="CHINESE")

    with pytest.raises(RestrictedError, match="EvidenceAdmission.record"), transaction.atomic():
        SoulRecord._base_manager.filter(pk=record.pk).delete()
    assert SoulRecord._base_manager.filter(pk=record.pk).exists()
    assert EvidenceAdmission._base_manager.filter(pk=admission.pk, record_id=record.pk).exists()
    SoulRecord._base_manager.filter(pk=unruled.pk).delete()  # a record nobody ruled on still goes
    assert not SoulRecord._base_manager.filter(pk=unruled.pk).exists()


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


#: The batches of AlterField migrations that made keys bare, by name suffix, and how many each has: 1B (the
#: control / shard boundary) and stage 2 (SHARD -> SHARD edges across civilizations). A new batch is a
#: new line here, so its rules are checked against the state just before it.
BARE_ID_STAGES = [("_bare_ids_across_databases", 24, 150), ("_bare_ids_across_civilizations", 12, 20),
                  ("_bare_id_stage2_review", 1, 0)]


@pytest.mark.parametrize(("suffix", "migrations", "at_least"), BARE_ID_STAGES)
def test_each_bare_ids_rule_is_the_on_delete_it_had_before_its_stage(suffix, migrations, at_least):
    """ON_DELETE is written by hand; the truth is the migration state just before the batch that made the
    key bare. Every bare id that was still a constrained key then keeps exactly that rule (a key missing
    from ON_DELETE means SET_NULL); one already bare then got its rule from an earlier batch."""
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(None, ignore_no_migrations=True)
    stage = {k for k in loader.disk_migrations if k[1].endswith(suffix)}
    assert len(stage) == migrations, sorted(stage)
    parents = sorted({p.key for k in stage for p in loader.graph.node_map[k].parents} - stage)
    reached = {k for p in parents for k in loader.graph.forwards_plan(p)}
    assert not reached & stage, f"the 'before' state includes a {suffix} migration"
    before = loader.project_state(parents)

    compared, wrong = 0, []
    for f in _all_bare():
        if f.model._meta.auto_created:
            continue  # a through-table row: CASCADE at both ends, before and after (Django's own rule)
        old = before.models.get((f.model._meta.app_label, f.model._meta.model_name))
        if old is None or f.name not in old.fields:
            continue  # born bare after this batch: it had no earlier rule
        was = old.fields[f.name]
        if not was.db_constraint and was.remote_field.on_delete is models.DO_NOTHING:
            continue  # already bare before this batch
        compared += 1
        if was.remote_field.on_delete is not rule(f):
            wrong.append(f"{label(f)}: was {was.remote_field.on_delete.__name__}, ON_DELETE says {rule(f).__name__}")
    assert compared > at_least, compared
    assert not wrong, "\n  ".join(wrong)


GONE = 10_000_000


def _orphan_source(edge, hall):
    """One row on `edge`'s source side naming a real target: (a queryset of just that row, the column,
    a value that names no row of the target)."""
    import uuid

    from django_celery_beat.models import CrontabSchedule, PeriodicTask

    from apps.actors.models import Actor
    from apps.chat.models import ChatIdentity
    from apps.death_sync.models import TudiGod
    from apps.judgment.models import CityGod
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root
    from apps.perm.models import Role, RoleDataScope
    from apps.scheduler.models import ScheduledJob
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    user = User.objects.create_user(username=f"orph-{edge}"[:150], password="x", role=UserRole.JUDGE, tenant=hall)
    org = Organization.objects.create(name="orph", code=f"ORPH_{edge}"[-50:], category="", tenant=hall,
                                      parent=tenant_root(hall))
    col = edge.rsplit(".", 1)[1]
    if edge == "realms.Realm.create_user":
        return Realm.all_objects.filter(pk=_realm(hall, "BRO", user).pk), "create_user_id", user.pk + GONE
    if edge == "authentication.User.organization":
        User.all_objects.filter(pk=user.pk).update(organization=org)
        return User.all_objects.filter(pk=user.pk), "organization_id", org.pk + GONE
    if edge == "authentication.User.actor":
        actor = Actor.objects.create(name="orph", civilization="CHINESE", role="JUDGE", tenant=hall)
        User.all_objects.filter(pk=user.pk).update(actor=actor)
        return User.all_objects.filter(pk=user.pk), "actor_id", uuid.uuid4()
    if edge in ("soul_accounts.SoulAccount.soul", "chat.ChatIdentity.account"):
        soul = Soul.objects.create(name="orph", tenant=hall)
        account = SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
        if col == "soul":
            return SoulAccount.objects.filter(pk=account.pk), "soul_id", uuid.uuid4()
        ident = ChatIdentity.objects.create(account=account, soul=soul, localpart="soul_orph",
                                            matrix_user_id="@soul_orph:x")
        return ChatIdentity.objects.filter(pk=ident.pk), "account_id", uuid.uuid4()
    if edge == "scheduler.ScheduledJob.periodic_task":
        cron, _ = CrontabSchedule.objects.get_or_create(minute="0", hour="3", timezone="UTC")
        pt = PeriodicTask.objects.create(name="orph", task="orph", crontab=cron)
        job = ScheduledJob.objects.create(periodic_task=pt, job_key="tests.orph")
        return ScheduledJob.objects.filter(pk=job.pk), "periodic_task_id", pt.pk + GONE
    if edge.startswith("perm.RoleDataScope_orgs."):
        scope = RoleDataScope.objects.create(role=Role.objects.get_or_create(name="orph")[0], scope="DEFINE")
        scope.orgs.add(org)
        rows = RoleDataScope.orgs.through.objects.filter(roledatascope=scope)
        return rows, f"{col}_id", (org.pk if col == "organization" else scope.pk) + GONE
    if edge in CROSS_CIVILIZATION_EDGES:
        return _crossing_orphan_source(edge, hall, user)
    god_model = CityGod if edge.startswith("judgment.") else TudiGod
    god = god_model.objects.create(tenant=hall, name="orph")
    god.officers.add(user)
    rows = god_model.officers.through.objects.filter(user=user)
    return rows, f"{col}_id", (user.pk + GONE if col == "user" else uuid.uuid4())


def _gone(obj):
    return uuid_module.uuid4() if isinstance(obj.pk, uuid_module.UUID) else obj.pk + GONE


def _crossing_orphan_source(edge, hall, user):
    """Stage 2 targets: Realm, CrossTenantJudgment, ApprovalWorkflow, WorkflowSegment."""
    from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, DispatchRecord
    from apps.souls.models import Soul
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, SegmentState, WorkflowSegment

    if edge == "dispatch.DispatchRecord.target_realm":
        realm = _realm(hall, "ORT", user)
        rec = DispatchRecord.objects.create(source_tenant=hall, target_realm=realm)
        return DispatchRecord.objects.filter(pk=rec.pk), "target_realm_id", _gone(realm)
    if edge == "judgment.EvidenceAdmission.record":
        from apps.judgment.models import EvidenceAdmission, Judgment
        from apps.souls.record_models import SoulRecord

        soul = Soul.objects.create(name="orph-ev", tenant=hall)
        record = SoulRecord.objects.create(soul=soul, tenant=hall, record_type="DEMERIT", civilization="CHINESE")
        judgment = Judgment.objects.create(soul=soul, tenant=hall, case_number="ORPH-EV", civilization="CHINESE")
        row = EvidenceAdmission.objects.create(judgment=judgment, record=record, tenant=hall)
        return EvidenceAdmission.objects.filter(pk=row.pk), "record_id", _gone(record)
    if edge == "dispatch.CrossTenantJudgmentParticipant.judgment":
        joint = CrossTenantJudgment.objects.create(title="o", description="o", initiating_tenant=hall)
        seat = CrossTenantJudgmentParticipant.objects.create(judgment=joint, participant_tenant=hall)
        return CrossTenantJudgmentParticipant.objects.filter(pk=seat.pk), "judgment_id", _gone(joint)
    wf = ApprovalWorkflow.objects.create(number="WF-ORPH", workflow_name="o", tenant=hall,
                                         soul=Soul.objects.create(name="orph-wf", tenant=hall))
    seg = WorkflowSegment.objects.create(workflow=wf, order=1, tenant=hall, civilization="CHINESE", name="o",
                                         state=SegmentState.values[0])
    if edge == "workflow.WorkflowSegment.workflow":
        return WorkflowSegment.objects.filter(pk=seg.pk), "workflow_id", _gone(wf)
    node = ApprovalNode.objects.create(workflow=wf, node_name="o", node_order=1, segment=seg)
    return ApprovalNode.objects.filter(pk=node.pk), "segment_id", _gone(seg)


#: One edge per target the stage-2 batch added (SHARD -> SHARD across civilizations).
CROSS_CIVILIZATION_EDGES = [
    "dispatch.DispatchRecord.target_realm",               # -> Realm
    "dispatch.CrossTenantJudgmentParticipant.judgment",   # -> CrossTenantJudgment
    "workflow.WorkflowSegment.workflow",                  # -> ApprovalWorkflow
    "workflow.ApprovalNode.segment",                      # -> WorkflowSegment
    "judgment.EvidenceAdmission.record",                  # -> SoulRecord (stage 2 review)
]

#: One edge per target model of a bare id (the next test holds that every target is reached), plus
#: every through-table column.
ORPHAN_EDGES = [
    *CROSS_CIVILIZATION_EDGES,
    "realms.Realm.create_user",              # -> User
    "soul_accounts.SoulAccount.soul",        # -> Soul
    "chat.ChatIdentity.account",             # -> SoulAccount
    "authentication.User.organization",      # -> Organization
    "authentication.User.actor",             # -> Actor
    "scheduler.ScheduledJob.periodic_task",  # -> PeriodicTask
    "perm.RoleDataScope_orgs.organization",
    "perm.RoleDataScope_orgs.roledatascope",
    "judgment.CityGod_officers.user",
    "judgment.CityGod_officers.citygod",
    "death_sync.TudiGod_officers.user",
    "death_sync.TudiGod_officers.tudigod",
]


def test_the_orphan_edges_reach_every_target_of_a_bare_id():
    fields = {label(f): f for f in _all_bare()}
    assert set(ORPHAN_EDGES) <= set(fields)
    reached = {fields[e].related_model._meta.concrete_model for e in ORPHAN_EDGES}
    assert reached == set(bare_ids_to()), sorted(m._meta.label for m in set(bare_ids_to()) - reached)


@pytest.mark.parametrize("edge", ORPHAN_EDGES)
def test_check_bare_ids_reports_an_orphan_on_any_edge_and_only_that_edge(hall, edge):
    from apps.core.bare_ids import orphans

    rows, attname, gone = _orphan_source(edge, hall)
    assert rows.count() == 1
    assert orphans(["default"]) == []
    rows.update(**{attname: gone})
    assert orphans(["default"]) == [(edge, "default", 1)]
    out = StringIO()
    with pytest.raises(CommandError, match="1 bare id column"):
        call_command("check_bare_ids", stdout=out)
    assert f"{edge} on default: 1 orphan id(s)" in out.getvalue()


def test_clearing_a_deleted_organization_removes_its_through_table_rows(hall):
    """Django clears a through table only on the deleted row's own database; bare_ids does it on each
    alias it is given. Called directly: on one database Django's collector would hide a miss."""
    from apps.core.bare_ids import clear_bare_ids
    from apps.org.models import Organization

    rows, _, _ = _orphan_source("perm.RoleDataScope_orgs.organization", hall)
    row = rows.get()
    gone, scope = row.organization, row.roledatascope
    kept = Organization.objects.create(name="kept", code="ORPH_KEPT", category="", tenant=hall, parent=gone.parent)
    scope.orgs.add(kept)
    clear_bare_ids(Organization, [gone.pk], ["default"])
    assert list(scope.orgs.values_list("pk", flat=True)) == [kept.pk]  # its row went, the other stayed


@pytest.fixture
def greek_hall():
    return Tenant.objects.get_or_create(code="GR_BARE", defaults={"display_name": "GR",
                                                                   "declared_civilization": "GREEK"})[0]


def test_a_shard_rows_primary_moves_to_its_shard_only_when_its_writes_are_cut_over(hall, greek_hall, settings):
    from apps.core.bare_ids import primary_alias
    from apps.souls.models import Soul

    greek, chinese = Soul.objects.create(name="g", tenant=greek_hall), Soul.objects.create(name="c", tenant=hall)
    user = User.objects.create_user(username="bare-primary", password="x", role=UserRole.JUDGE, tenant=greek_hall)
    assert [primary_alias(x) for x in (greek, chinese, user)] == ["default"] * 3
    settings.SHARD_READ_CIVS = settings.SHARD_WRITE_CIVS = ["GREEK"]
    assert [primary_alias(x) for x in (greek, chinese, user)] == ["civ_greek", "default", "default"]
    settings.SHARD_WRITE_CIVS = []  # reads alone do not move the authoritative copy
    assert primary_alias(greek) == "default"


def test_deleting_a_copy_that_is_not_the_primary_applies_no_rule(hall, greek_hall, settings, monkeypatch):
    """With Greek writes cut over, the control database's Greek Soul is a leftover copy: deleting it must
    not cascade to the control SoulAccount naming the soul (the shard's Soul is the real one). The
    primary's delete still does. tests/test_shard_aliases.py has the same on a real shard."""
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    def account_of(soul, name):
        user = User.objects.create_user(username=name, password="x", role="SOUL", tenant=soul.tenant)
        return SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)

    greek, chinese = Soul.objects.create(name="g", tenant=greek_hall), Soul.objects.create(name="c", tenant=hall)
    kept, gone = account_of(greek, "bare-copy-g"), account_of(chinese, "bare-copy-c")
    settings.SHARD_READ_CIVS = settings.SHARD_WRITE_CIVS = ["GREEK"]
    # fanout() would name civ_greek, which this settings file has no database for; the rows are here.
    monkeypatch.setattr("apps.core.sharding.fanout", lambda: ["default"])
    greek.purge()
    assert SoulAccount.objects.filter(pk=kept.pk).exists()
    chinese.purge()  # Chinese writes are not cut over: default is its primary, the rule applies
    assert not SoulAccount.objects.filter(pk=gone.pk).exists()


# --- Django admin ---------------------------------------------------------------
# A bare-id PROTECT is raised from pre_delete, which the admin's confirmation page (its own collector)
# cannot see: an admin delete that reached one would 500 instead of showing "cannot delete". None can
# today -- Soul's admin delete is off, SoulAccount has no admin, and User -> SoulAccount is a real
# PROTECT the admin shows. This holds that, for every registered admin.

def _deleted_with(model):
    """Every model a delete of `model` removes: Django's CASCADE edges and the bare ids' CASCADE rules."""
    from apps.core.bare_ids import rule

    seen, todo = {model}, [model]
    while todo:
        m = todo.pop()
        nxt = [r.related_model for r in m._meta.related_objects
               if getattr(r.field.remote_field, "on_delete", None) is models.CASCADE]
        nxt += [f.model for f in bare_ids_to().get(m._meta.concrete_model, []) if rule(f) is models.CASCADE]
        for n in nxt:
            if n._meta.concrete_model not in seen:
                seen.add(n._meta.concrete_model)
                todo.append(n._meta.concrete_model)
    return seen


def test_no_admin_delete_can_reach_a_bare_id_protect(rf):
    from django.contrib import admin

    from apps.core.bare_ids import rule

    held = {f.related_model._meta.concrete_model: label(f) for f in _all_bare() if rule(f) is models.PROTECT}
    assert held, "no bare PROTECT found; the discovery is broken"
    request = rf.get("/")
    request.user = User(is_superuser=True, is_staff=True, is_active=True)
    wrong = sorted(f"{model._meta.label} -> {m._meta.label} (held by {held[m]})"
                   for model, model_admin in admin.site._registry.items()
                   if model_admin.has_delete_permission(request)
                   for m in _deleted_with(model) if m in held)
    assert not wrong, ("an admin delete reaching a bare-id PROTECT 500s instead of showing 'cannot delete'; "
                       "turn the delete off there or check the bare ids first:\n  " + "\n  ".join(wrong))


def test_the_admin_refuses_a_soul_delete_that_a_bare_id_protects_instead_of_failing(hall, client):
    from apps.soul_accounts.models import AccountOrigin, RebirthApplication, SoulAccount
    from apps.souls.models import Soul
    from apps.workflow.models import ApprovalWorkflow

    soul = Soul.objects.create(name="admin-protected", tenant=hall)
    owner = User.objects.create_user(username="bare-admin-soul", password="x", role="SOUL", tenant=hall)
    account = SoulAccount.objects.create(user=owner, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
    wf = ApprovalWorkflow.objects.create(number="WF-BARE-ADM", workflow_name="rebirth", tenant=hall, soul=soul)
    form = RebirthApplication._meta.get_field("desired_form").choices[0][0]
    RebirthApplication.objects.create(soul=soul, account=account, cycle=0, desired_form=form,
                                      status="UNDER_REVIEW", workflow=wf)
    client.force_login(User.objects.create_superuser(username="bare-admin", email="a@x.test", password="x"))

    url = f"/admin/souls/soul/{soul.pk}/delete/"
    assert client.get(url).status_code == 403
    assert client.post(url, {"post": "yes"}).status_code == 403
    bulk = client.post("/admin/souls/soul/", {"action": "delete_selected", "_selected_action": [soul.pk], "post": "yes"})
    assert bulk.status_code in (200, 302)  # the action is not offered; nothing runs
    assert Soul.all_objects.filter(pk=soul.pk).exists() and SoulAccount.objects.filter(pk=account.pk).exists()


def test_the_admin_shows_cannot_delete_for_a_user_with_a_soul_account(hall, client):
    """User -> SoulAccount is a real PROTECT, which the admin's confirmation page sees."""
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    owner = User.objects.create_user(username="bare-admin-user", password="x", role="SOUL", tenant=hall)
    account = SoulAccount.objects.create(user=owner, soul=Soul.objects.create(name="u", tenant=hall), cycle=0,
                                         origin=AccountOrigin.OFFICER)
    client.force_login(User.objects.create_superuser(username="bare-admin2", email="b@x.test", password="x"))

    response = client.post("/admin/authentication/user/", {"action": "delete_selected",
                                                           "_selected_action": [owner.pk], "post": "yes"})
    assert response.status_code == 200
    assert "would require deleting the following protected related objects" in response.content.decode()
    assert User.all_objects.filter(pk=owner.pk).exists() and SoulAccount.objects.filter(pk=account.pk).exists()
