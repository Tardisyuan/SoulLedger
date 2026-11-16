"""Stage 4, part A: a cut-over civilization's writes go to its shard (docs/audit/2026-11-15-sharding/PLAN.md 阶段 4;
apps/core/shard_reads.py `write_route`, apps/core/shard_sync.py `sync_direction`, apps/core/shard_ids.py).

  routing        a row of a civilization in SHARD_WRITE_CIVS is written on its shard, every other on control; a write
                 naming no row and no single civilization raises NoShardContext; a write request, a transaction and a
                 per-hall task read the shard they write (reads your writes); a global task / command reads every
                 master (MASTER) and splits a queryset update / delete per master.
  transactions   `transaction.atomic()` holds on the shard too: select_for_update works there, a failure rolls the
                 shard back with control.
  sync           a write-cut civilization syncs shard-to-control (control stays a full mirror), every other
                 control-to-shard; a write on a write-cut shard queues the debounced sync.
  ids (4a)       each shard issues integer ids from its own range; the command is idempotent and refuses a foreign id.
  inert          SHARD_WRITE_CIVS=[] routes every write exactly as stage 3 did.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_sharded_writes.py
"""
import pytest
from django.apps import apps
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.db import connections, router, transaction
from django.test import RequestFactory, override_settings

from apps.core.sharding import SHARD, NoShardContext, alias_for_civilization, placement
from tests.test_shard_sync import CIVS, sharded

GREEK, EGYPT = "civ_greek", "civ_egyptian"


def _halls():
    """One hall per civilization in control, copied to every shard (Tenant is REFERENCE, D4)."""
    from apps.tenants.models import Tenant

    halls = {civ: Tenant.objects.create(code=f"W4_{civ[:2]}", display_name=civ, declared_civilization=civ)
             for civ in CIVS}
    for alias in (alias_for_civilization(c) for c in CIVS):
        Tenant._base_manager.using(alias).bulk_create(
            [Tenant(**{f.attname: getattr(h, f.attname) for f in Tenant._meta.concrete_fields}) for h in halls.values()])
    return halls


def cut(*civs):
    """Reads and writes of `civs` cut over, their shards' id ranges assigned (gap 4a: before the first write)."""
    return override_settings(SHARD_READ_CIVS=list(CIVS), SHARD_WRITE_CIVS=list(civs))


def _assign(*civs):
    for civ in civs:
        call_command("assign_shard_id_ranges", "--civ", civ, verbosity=0)


def _in_hall(hall):
    from apps.tenants.managers import clear_current_tenant, set_current_tenant

    class Ctx:
        def __enter__(self):
            set_current_tenant(hall)

        def __exit__(self, *exc):
            clear_current_tenant()
    return Ctx()


def _where(model, pk):
    return sorted(a for a in connections if router.allow_migrate_model(a, model)
                  and model._base_manager.using(a).filter(pk=pk).exists())


# ---- routing ---------------------------------------------------------------------------------------------------

@sharded
def test_a_cut_over_civilizations_rows_are_written_on_its_shard_and_the_others_on_control():
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"):
        made = {}
        for civ, hall in halls.items():
            with _in_hall(hall):
                made[civ] = Soul.objects.create(name=f"w-{civ}", tenant=hall)
        from apps.audit.models import AuditAction, AuditLog

        nameless = AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="d2")
    assert _where(Soul, made["GREEK"].pk) == [GREEK]
    for civ in ("CHINESE", "EUROPEAN", "EGYPTIAN"):
        assert _where(Soul, made[civ].pk) == ["default"], civ
    assert _where(AuditLog, nameless.pk) == ["default"]  # D2: no hall, control


@sharded
def test_saving_and_deleting_a_row_go_to_its_master_whatever_the_context():
    """The row says where it goes: a Greek soul saved from a SYSTEM_ADMIN-like context (no hall) or from an
    Egyptian hall's context still lands on civ_greek, and its delete happens there."""
    from apps.core.shard_reads import read_context
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK", "EGYPTIAN")
    with cut("GREEK", "EGYPTIAN"):
        with _in_hall(halls["GREEK"]):
            soul = Soul.objects.create(name="moved about", tenant=halls["GREEK"])
        with _in_hall(halls["EGYPTIAN"]):
            soul.name = "renamed from Egypt"
            soul.save()
        with read_context("default"):
            assert Soul._base_manager.using(GREEK).get(pk=soul.pk).name == "renamed from Egypt"
            assert not Soul._base_manager.using("default").filter(pk=soul.pk).exists()
            assert not Soul._base_manager.using(EGYPT).filter(pk=soul.pk).exists()
            Soul.all_objects.filter(pk=soul.pk).delete()  # MASTER: split per master
    assert _where(Soul, soul.pk) == []


#: SHARD models whose writes follow the civilization (every one but the control-mastered).
def _written_models():
    from apps.core.shard_reads import control_mastered

    return sorted((m for m in apps.get_models() if placement(m) == SHARD and not control_mastered(m)
                   and m._meta.managed and not m._meta.proxy), key=lambda m: m._meta.label)


@sharded
@pytest.mark.parametrize("label", [m._meta.label for m in _written_models()])
def test_a_write_naming_no_row_and_no_civilization_is_refused(label):
    """No row, no request, no hall, no explicit context: a queryset delete / update of every SHARD model raises
    NoShardContext once one civilization's writes are cut over -- never a quiet write to control -- and runs as
    before while none is."""
    model = apps.get_model(label)
    with cut("GREEK"):
        with pytest.raises(NoShardContext):
            model._base_manager.filter(pk__in=[]).delete()
        with pytest.raises(NoShardContext):
            model._base_manager.filter(pk__in=[]).update(pk=None)
    with override_settings(SHARD_READ_CIVS=list(CIVS), SHARD_WRITE_CIVS=[]):
        model._base_manager.filter(pk__in=[]).delete()


@sharded
def test_a_write_request_reads_the_shard_it_writes():
    """A POST of a write-cut hall reads its shard (where its writes are), so it sees the row written a moment ago
    there, which control does not have until the next sync; a GET reads the same shard. Mutation: a write request
    reads control after the cut-over -> red."""
    from apps.core.request_local import set_current_request
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"):
        with _in_hall(halls["GREEK"]):
            soul = Soul.objects.create(name="unsynced write", tenant=halls["GREEK"])
        assert _where(Soul, soul.pk) == [GREEK]
        for method in ("post", "patch", "get"):
            request = getattr(RequestFactory(), method)("/")
            request.tenant = halls["GREEK"]
            set_current_request(request)
            try:
                assert Soul.objects.filter(pk=soul.pk).exists(), method
                with transaction.atomic():
                    assert Soul.lock(soul.pk).pk == soul.pk, method  # select_for_update on the shard
            finally:
                set_current_request(None)


@sharded
def test_a_system_admin_write_request_reads_every_master_and_locks_where_the_row_is():
    from apps.authentication.models import User, UserRole
    from apps.core.request_local import set_current_request
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    admin = User.objects.create_user(username="w4-sys", password="x", role=UserRole.SYSTEM_ADMIN)
    with cut("GREEK"):
        with _in_hall(halls["GREEK"]):
            greek = Soul.objects.create(name="greek master", tenant=halls["GREEK"])
        with _in_hall(halls["CHINESE"]):
            chinese = Soul.objects.create(name="chinese master", tenant=halls["CHINESE"])
        request = RequestFactory().post("/")
        request.user = admin
        set_current_request(request)
        try:
            assert set(Soul.objects.filter(pk__in=[greek.pk, chinese.pk]).values_list("name", flat=True)) == {
                "greek master", "chinese master"}
            with transaction.atomic():
                assert Soul.lock(greek.pk)._state.db == GREEK
                assert Soul.lock(chinese.pk)._state.db == "default"
                with pytest.raises(NoShardContext):  # rows in two masters cannot be locked by one statement
                    Soul.lock_many([greek.pk, chinese.pk])
            assert Soul.objects.filter(pk__in=[greek.pk, chinese.pk]).update(merit_score=7) == 2
        finally:
            set_current_request(None)
    assert Soul._base_manager.using(GREEK).get(pk=greek.pk).merit_score == 7
    assert Soul._base_manager.using("default").get(pk=chinese.pk).merit_score == 7


@sharded
def test_a_per_hall_task_reads_and_writes_its_shard_and_a_global_one_every_master():
    """Celery (apps/core/shard_reads.py header): a per-hall task of a write-cut civilization reads the shard it
    writes; with no hall it reads every master, so a sweep finds a row only the shard has."""
    from apps.core import shard_reads
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"):
        token = shard_reads._celery_signal.set(True)
        try:
            with _in_hall(halls["GREEK"]):
                soul = Soul.objects.create(name="task wrote", tenant=halls["GREEK"])
                assert Soul.objects.filter(pk=soul.pk).exists()
                Soul.objects.filter(pk=soul.pk).update(merit_score=3)
            assert Soul._base_manager.filter(pk=soul.pk, merit_score=3).exists()  # MASTER read: the shard's row
        finally:
            shard_reads._celery_signal.reset(token)
    assert _where(Soul, soul.pk) == [GREEK]


@sharded
def test_a_failure_in_a_transaction_rolls_the_shard_back_with_control():
    from apps.audit.models import AuditAction, AuditLog
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"), _in_hall(halls["GREEK"]):
        with pytest.raises(RuntimeError), transaction.atomic():
            Soul.objects.create(name="rolled back", tenant=halls["GREEK"])
            AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="x")
            raise RuntimeError
        assert not Soul._base_manager.using(GREEK).filter(name="rolled back").exists()
        assert not AuditLog._base_manager.using("default").filter(resource_id="x").exists()


# ---- sync direction ------------------------------------------------------------------------------------------

@sharded
def test_a_write_cut_civilization_syncs_shard_to_control_and_the_others_control_to_shard():
    """Mutation: the sync direction not flipped -> the shard's new row never reaches control and control's stale
    Greek row is copied over the shard's."""
    from apps.souls.models import Soul
    from apps.tenants.tasks import sync_shards

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"):
        with _in_hall(halls["GREEK"]):
            new = Soul.objects.create(name="shard-born", tenant=halls["GREEK"])
        with _in_hall(halls["CHINESE"]):
            chinese = Soul.objects.create(name="control-born", tenant=halls["CHINESE"])
        stale = Soul(name="written to control by mistake", tenant=halls["GREEK"])
        Soul._base_manager.using("default").bulk_create([stale])
        sync_shards()
        assert Soul._base_manager.using("default").filter(pk=new.pk).exists()
        assert not Soul._base_manager.using("default").filter(pk=stale.pk).exists()  # the shard is the master
        assert Soul._base_manager.using("civ_chinese").filter(pk=chinese.pk).exists()
        out_code = _reconcile_s2c("GREEK")
    assert out_code == 0


def _reconcile_s2c(civ):
    from django.core.management.base import CommandError

    try:
        call_command("reconcile_shards", "--civ", civ, "--direction", "shard-to-control", verbosity=0)
        return 0
    except CommandError:
        return 1


@sharded
def test_a_write_on_a_write_cut_shard_queues_the_sync(monkeypatch, django_capture_on_commit_callbacks):
    from django.core.cache import cache

    from apps.core import shard_sync
    from apps.realms.models import Realm
    from apps.tenants import tasks

    queued = []
    monkeypatch.setattr(tasks.sync_shards, "apply_async", lambda **kw: queued.append(kw))
    for writes, expect in (([], 0), (["GREEK"], 1)):
        cache.delete(shard_sync.DEBOUNCE_KEY)
        queued.clear()
        with override_settings(SHARD_READ_CIVS=list(CIVS), SHARD_WRITE_CIVS=writes), \
                django_capture_on_commit_callbacks(using=GREEK, execute=True):
            shard_sync._on_write(Realm, using=GREEK)
        assert len(queued) == expect, writes


# ---- inert while nothing is cut over -------------------------------------------------------------------------

@sharded
def test_with_no_write_cut_every_write_routes_as_in_stage_3():
    """SHARD_WRITE_CIVS=[]: db_for_write answers what stage 3 did for every model, with and without a shard row
    as the hint (control for a SHARD row read from a shard while reads are cut, Django's own answer otherwise),
    and `transaction.atomic()` opens nothing on a shard."""
    from apps.core.shard_reads import _atomic_extra
    from apps.souls.models import Soul

    halls = _halls()
    soul = Soul.objects.create(name="stage 3", tenant=halls["GREEK"])
    on_shard = Soul._base_manager.using("default").get(pk=soul.pk)
    on_shard._state.db = GREEK
    for reads in ([], list(CIVS)):
        with override_settings(SHARD_READ_CIVS=reads, SHARD_WRITE_CIVS=[]):
            for model in apps.get_models(include_auto_created=True):
                assert router.db_for_write(model) == "default", model._meta.label
            assert router.db_for_write(Soul, instance=on_shard) == "default"
            with transaction.atomic():
                assert _atomic_extra.get() and not any(_atomic_extra.get())
                assert [a for a in connections if a != "default" and connections[a].in_atomic_block
                        and any(not b._from_testcase for b in connections[a].atomic_blocks)] == []


# ---- integer id ranges (gap 4a) --------------------------------------------------------------------------------

@sharded
def test_two_civilizations_create_organizations_with_disjoint_ids_in_their_ranges():
    """Mutation: assign_shard_id_ranges skips the setval -> the first write is refused (ensure_ranges), and
    without that check both shards issue the same small ids."""
    from apps.core.shard_ids import id_range
    from apps.org.models import Organization

    halls = _halls()
    _assign("GREEK", "EGYPTIAN")
    made = {}
    with cut("GREEK", "EGYPTIAN"):
        for civ in ("GREEK", "EGYPTIAN"):
            with _in_hall(halls[civ]):
                root = Organization.objects.create(tenant=halls[civ], name="root", code=f"W4R_{civ}")
                made[civ] = [root.pk, *(Organization.objects.create(
                    tenant=halls[civ], name=f"u{i}", code=f"W4U_{civ}{i}", parent=root).pk for i in range(2))]
    for civ, pks in made.items():
        low, high = id_range(civ)
        assert all(low <= pk < high for pk in pks), (civ, pks)
    assert not set(made["GREEK"]) & set(made["EGYPTIAN"])


@sharded
def test_the_first_write_to_a_shard_without_its_range_is_refused():
    from apps.souls.models import Soul

    halls = _halls()
    from apps.audit.models import AuditAction, AuditLog

    with cut("GREEK"), _in_hall(halls["GREEK"]):
        with pytest.raises(ImproperlyConfigured, match="assign_shard_id_ranges"):
            Soul.objects.create(name="too early", tenant=halls["GREEK"])
        _assign("GREEK")
        AuditLog.objects.create(tenant=halls["GREEK"], action=AuditAction.READ, resource="soul", resource_id="ok")


@sharded
def test_assigning_ranges_is_idempotent_and_refuses_a_foreign_id():
    from django.core.management.base import CommandError

    from apps.audit.models import AuditAction, AuditLog
    from apps.core.shard_ids import SPAN, id_range, next_id

    _halls()
    _assign("GREEK")
    first = next_id(GREEK, AuditLog)
    _assign("GREEK")
    assert next_id(GREEK, AuditLog) == first and id_range("GREEK")[0] <= first < id_range("GREEK")[1]
    AuditLog._base_manager.using(EGYPT).bulk_create([AuditLog(pk=4 * SPAN + 1, action=AuditAction.READ,
                                                              resource="soul", resource_id="foreign")])
    with pytest.raises(CommandError, match="another civilization"):
        call_command("assign_shard_id_ranges", "--civ", "EGYPTIAN", verbosity=0)
    with pytest.raises(CommandError, match="another civilization"):
        call_command("assign_shard_id_ranges", "--all", "--check", verbosity=0)


def test_the_range_numbering_covers_every_civilization():
    from apps.core.shard_ids import INDEX, SPAN, id_range
    from apps.souls.models import Civilization

    assert set(INDEX) == set(Civilization.values)
    assert sorted(id_range(c) for c in INDEX) == [(i * SPAN, (i + 1) * SPAN) for i in range(1, 5)]
    assert (len(INDEX) + 1) * SPAN < 2 ** 63


# ---- the 4.0 rehearsal command -----------------------------------------------------------------------------------

@sharded
def test_the_rehearsal_writes_through_the_services_and_reconciles_clean_both_ways():
    """`manage.py rehearse_write_cutover` on a synced world (two Greek halls, so a dispatch within the civilization is
    possible): business writes land on the shard, come back to control by the reverse sync, and both reconciles are
    clean. Its report names what it did; a routing error would fail it."""
    import io

    from apps.souls.models import Soul
    from apps.tenants.models import Tenant
    from tests.test_shard_sync import _sync

    _halls()
    Tenant.objects.create(code="W4_GR2", display_name="GREEK 2", declared_civilization="GREEK")
    _sync()
    out = io.StringIO()
    call_command("rehearse_write_cutover", "--civ", "GREEK", "--writes", "16", "--seed", "4", stdout=out)
    report = out.getvalue()
    assert "rehearsal: clean" in report and "ok soul created" in report, report
    on_control = set(Soul._base_manager.using("default").filter(name__startswith="rehearsal-4-").values_list("pk", flat=True))
    on_shard = set(Soul._base_manager.using(GREEK).filter(name__startswith="rehearsal-4-").values_list("pk", flat=True))
    assert on_control and on_control == on_shard  # written on the shard, brought back by the reverse sync
