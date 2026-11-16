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

from apps.core.sharding import SHARD, NoShardContext, placement
from tests.test_shard_sync import CIVS, sharded

GREEK, EGYPT = "civ_greek", "civ_egyptian"


def _halls():
    """One hall per civilization in control, synced to the shards (the hall, D4, and what control made for it:
    its root unit) -- stage 3's state, before any write is cut over."""
    from apps.org.ownership import tenant_root
    from apps.tenants.models import Tenant
    from tests.test_shard_sync import _sync

    halls = {civ: Tenant.objects.create(code=f"W4_{civ[:2]}", display_name=civ, declared_civilization=civ)
             for civ in CIVS}
    for hall in halls.values():
        tenant_root(hall)
    _sync()
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
    from apps.events.models import SoulEvent
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
            SoulEvent.all_objects.filter(soul_id=soul.pk).delete()  # MASTER: split per master (PROTECT on the soul)
            Soul.all_objects.filter(pk=soul.pk).delete()
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
            model._base_manager.filter(pk__in=[]).update()
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
def test_a_halls_transaction_is_its_shards_and_a_control_write_inside_it_commits_first():
    """One civilization: `atomic()` is the shard's transaction (a failure rolls the shard row back), and a control
    write inside it -- a hall-less row here, a code claim or a case number in the product -- is control's own
    autocommit, committed before the shard row (part B: a gap, never a reuse). No single civilization (MASTER):
    control's transaction plus the shards', all rolled back together. Mutation: atomic() opens nothing on the
    shard -> the shard row survives the rollback."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"):
        with _in_hall(halls["GREEK"]):
            with pytest.raises(RuntimeError), transaction.atomic():
                assert transaction.get_connection().alias == GREEK
                assert not [b for b in connections["default"].atomic_blocks if not b._from_testcase]
                Soul.objects.create(name="rolled back", tenant=halls["GREEK"])
                AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="x")
                raise RuntimeError
            assert not Soul._base_manager.using(GREEK).filter(name="rolled back").exists()
            assert AuditLog._base_manager.using("default").filter(resource_id="x").exists()
        with pytest.raises(RuntimeError), transaction.atomic():  # no context: MASTER
            Soul.objects.create(name="rolled back too", tenant=halls["GREEK"])
            AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="y")
            raise RuntimeError
        assert not Soul._base_manager.using(GREEK).filter(name="rolled back too").exists()
        assert not AuditLog._base_manager.using("default").filter(resource_id="y").exists()


@sharded
def test_a_write_to_a_third_database_inside_a_transaction_is_refused():
    """A Greek hall's transaction is open on civ_greek only; a row routed to civ_egyptian inside it would autocommit
    there and survive the rollback. Refused (WriteOutsideTransaction); outside a transaction it is an ordinary write.
    Mutation: no check -> the Egyptian row is written and kept."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.core.shard_reads import WriteOutsideTransaction

    halls = _halls()
    _assign("GREEK", "EGYPTIAN")

    def log(name):
        return AuditLog.objects.create(tenant=halls["EGYPTIAN"], action=AuditAction.READ, resource="soul",
                                       resource_id=name)
    with cut("GREEK", "EGYPTIAN"), _in_hall(halls["GREEK"]):
        with pytest.raises(WriteOutsideTransaction), transaction.atomic():
            log("egyptian inside a greek transaction")
        assert not AuditLog._base_manager.using(EGYPT).filter(resource_id="egyptian inside a greek transaction").exists()
        made = log("egyptian, no transaction")
    assert _where(AuditLog, made.pk) == [EGYPT]


@sharded
def test_a_hall_may_write_again_the_code_its_rolled_back_shard_write_claimed():
    """Part B's claim commits on control before the shard row; a hall's transaction that then rolls back leaves the
    claim. The same hall writing that code again is allowed (its database's UNIQUE index decides there); another
    hall's is still refused. Without this a hall's root unit, whose code is fixed (ROOT_<hall>), could never be made
    after one failed request. Mutation: no own-claim branch in claim_org_code -> the retry is refused."""
    from django.db import IntegrityError

    from apps.org.models import Organization
    from apps.org.ownership import tenant_root

    halls = _halls()
    _assign("GREEK", "EGYPTIAN")
    with cut("GREEK", "EGYPTIAN"):
        with _in_hall(halls["GREEK"]):
            root = tenant_root(halls["GREEK"])
            with pytest.raises(RuntimeError), transaction.atomic():
                Organization.objects.create(tenant=halls["GREEK"], name="u", code="W4_RETRY", parent=root)
                raise RuntimeError
            assert not Organization._base_manager.using(GREEK).filter(code="W4_RETRY").exists()
            Organization.objects.create(tenant=halls["GREEK"], name="u", code="W4_RETRY", parent=root)
        with _in_hall(halls["EGYPTIAN"]), pytest.raises(IntegrityError, match="already taken"):
            Organization.objects.create(tenant=halls["EGYPTIAN"], name="u", code="W4_RETRY",
                                        parent=tenant_root(halls["EGYPTIAN"]))


@sharded
def test_a_direct_write_on_control_of_a_write_cut_row_is_refused():
    """Control only mirrors a write-cut civilization's rows; a write there (`.using("default")`, loaddata) would be
    undone by the next shard-to-control sync. Refused for save, delete, queryset update / delete and bulk_create;
    a row of a civilization not cut over is written as before; `control_mirror_writes()` lets bare-id deletes (and
    a test) through. Mutation: the guard off -> the write lands and the sync silently reverts it."""
    from apps.core.shard_reads import ControlMirrorWrite, control_mirror_writes
    from apps.souls.models import Soul

    halls = _halls()
    greek = Soul._base_manager.using("default").create(name="greek mirror", tenant=halls["GREEK"])
    chinese = Soul._base_manager.using("default").create(name="chinese master", tenant=halls["CHINESE"])
    _assign("GREEK")
    with cut("GREEK"):
        mirror = Soul._base_manager.using("default")
        for write in (lambda: mirror.filter(pk=greek.pk).update(name="x"),
                      lambda: mirror.filter(pk=greek.pk).delete(),
                      lambda: greek.save(using="default"),
                      lambda: mirror.bulk_create([Soul(name="new mirror", tenant=halls["GREEK"])])):
            with pytest.raises(ControlMirrorWrite):
                write()
        assert mirror.filter(pk=chinese.pk).update(name="still control's") == 1
        with control_mirror_writes():
            assert mirror.filter(pk=greek.pk).update(name="allowed") == 1


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
        from apps.core.shard_reads import control_mirror_writes

        with control_mirror_writes():  # what a write to control by mistake leaves (the guard refuses it otherwise)
            Soul._base_manager.using("default").bulk_create([stale])
        sync_shards()
        assert Soul._base_manager.using("default").filter(pk=new.pk).exists()
        assert not Soul._base_manager.using("default").filter(pk=stale.pk).exists()  # the shard is the master
        assert Soul._base_manager.using("civ_chinese").filter(pk=chinese.pk).exists()
        out_code = _reconcile_s2c("GREEK")
    assert out_code == 0


def _reconcile_s2c(civ):
    import io

    from django.core.management.base import CommandError

    out = io.StringIO()
    try:
        call_command("reconcile_shards", "--civ", civ, "--direction", "shard-to-control", stdout=out)
        return 0
    except CommandError:
        print(out.getvalue())
        return 1


@sharded
@pytest.mark.parametrize("writes", [[], ["CHINESE"]], ids=["control-to-shard", "shard-to-control"])
def test_a_sync_fix_tells_the_caches_built_from_the_rows_it_wrote(writes):
    """The sync writes raw (no signal), so a per-process copy built from those rows (apps/core/versioned.py: the data
    scope's org tree) would keep answering the old rows until its ttl. `apply_fix` bumps every memo watching a model it
    fixed: the next read sees the new unit, in either direction. Mutation: no bump -> the stale tree is served."""
    from apps.core.shard_reads import control_mirror_writes, read_context
    from apps.core.shard_sync import SHARD_TO_CONTROL, reconcile
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root
    from apps.perm.data_scope import _shared, _tree

    halls = _halls()
    hall = halls["CHINESE"]
    root = tenant_root(hall)
    _assign("CHINESE")
    source, target = ("civ_chinese", "default") if writes else ("default", "civ_chinese")
    with override_settings(SHARD_READ_CIVS=list(CIVS), SHARD_WRITE_CIVS=writes), read_context(target):
        def tree():
            return _shared.get(("tree", hall.pk), lambda: _tree(hall.pk))
        before = tree()
        with control_mirror_writes():  # the unit as the master has it; no signal, no bump
            Organization._base_manager.using(source).bulk_create(
                [Organization(tenant=hall, name="new unit", code="W4_CACHE", parent=root)])
        assert tree() == before  # nothing told the copy yet: the stale answer the sync must end
        reconcile(["civ_chinese"], fix=True, direction=SHARD_TO_CONTROL if writes else "control-to-shard")
        new = Organization._base_manager.using(target).get(code="W4_CACHE").pk
        assert new in tree().get(root.pk, []), "a sync fix left the cached org tree stale"


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
            # reads not cut: Django's own answer (the row's database); reads cut: control (stage 3 write_route)
            assert router.db_for_write(Soul, instance=on_shard) == ("default" if reads else GREEK)
            with transaction.atomic():
                assert _atomic_extra.get() and all(not held for _, held in _atomic_extra.get())
                assert [a for a in connections if a != "default" and connections[a].in_atomic_block
                        and any(not b._from_testcase for b in connections[a].atomic_blocks)] == []


# ---- integer id ranges (gap 4a) --------------------------------------------------------------------------------

@sharded
def test_two_civilizations_create_organizations_with_disjoint_ids_in_their_ranges():
    """Mutation: assign_shard_id_ranges skips the setval -> the first write is refused (ensure_ranges), and
    without that check both shards issue the same small ids."""
    from apps.core.shard_ids import id_range
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root

    halls = _halls()  # each hall's root unit exists (stage 3's state); the new units hang under it
    _assign("GREEK", "EGYPTIAN")
    made = {}
    with cut("GREEK", "EGYPTIAN"):
        for civ in ("GREEK", "EGYPTIAN"):
            with _in_hall(halls[civ]):
                root = tenant_root(halls[civ])
                made[civ] = [Organization.objects.create(tenant=halls[civ], name=f"u{i}", code=f"W4U_{civ}{i}",
                                                         parent=root).pk for i in range(3)]
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
        Soul.objects.create(name="a uuid pk needs no range", tenant=halls["GREEK"])
        with pytest.raises(ImproperlyConfigured, match="assign_shard_id_ranges"):
            AuditLog.objects.create(tenant=halls["GREEK"], action=AuditAction.READ, resource="soul", resource_id="no")
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
    with pytest.raises(CommandError, match="id range problem"):
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


# ---- found by the 2026-11-16 review (ADVICE-sharding-fable.md 1.1) and part B's caveats -------------------------

@sharded
def test_a_hall_created_after_its_civilizations_write_cut_over_is_seeded_on_its_shard():
    """POST /tenants/ for a Greek hall with Greek writes cut over: the hall row is control's, its seed (realms,
    statutes, templates) goes to civ_greek, whose foreign keys to the hall must hold at that shard's commit -- so the
    hall is copied into every shard in the same request (`shard_sync._copy_hall`). 201, the seed on the shard and
    nowhere else, reconcile clean. Mutation: no copy -> the shard's commit fails (no hall there)."""
    from apps.authentication.models import User, UserRole
    from apps.judgment.models import Statute
    from apps.realms.models import Realm
    from apps.tenants.models import Tenant
    from tests.soul_account_support import officer_client

    _halls()
    _assign("GREEK")
    admin = User.objects.create_user(username="w4-hall", password="x", role=UserRole.SYSTEM_ADMIN)  # only it builds halls
    with cut("GREEK"):
        res = officer_client(admin).post("/api/v1/tenants/", {"code": "GR_W4NEW", "display_name": "new",
                                                              "civilization": "GREEK"}, format="json")
        assert res.status_code == 201, res.data
        hall = Tenant._base_manager.using("default").get(code="GR_W4NEW")
        for alias in (a for a in connections if a.startswith("civ_")):
            assert Tenant._base_manager.using(alias).filter(pk=hall.pk).exists(), alias
        for model in (Realm, Statute):
            assert model._base_manager.using(GREEK).filter(tenant=hall).exists(), model
            assert not model._base_manager.using("default").filter(tenant=hall).exists(), model
        from apps.tenants.tasks import sync_shards

        sync_shards()  # what beat / the debounce runs: shard-to-control for GREEK, control-to-shard for the rest
        assert _reconcile_s2c("GREEK") == 0


@sharded
def test_a_case_number_is_spent_on_control_before_the_shard_row_and_never_reused():
    """JudgmentCaseCounter is CONTROL; a Greek case is written on civ_greek. The number is drawn in control's own
    transaction first (no lock held across the shard's commit): a shard insert that fails leaves a gap, and the next
    case takes the next number -- never the spent one."""
    from unittest import mock

    from apps.judgment.models import Judgment, JudgmentCaseCounter, format_case_number
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"), _in_hall(halls["GREEK"]):
        soul = Soul.objects.create(name="numbered", tenant=halls["GREEK"])
        counters = JudgmentCaseCounter.objects.using("default")
        with mock.patch.object(Judgment, "save_base", side_effect=RuntimeError("shard insert failed")), \
                pytest.raises(RuntimeError):
            Judgment(soul=soul, tenant=halls["GREEK"], civilization="GREEK").save()
        spent = {c.key: c.last for c in counters.all()}
        assert spent and not Judgment._base_manager.using(GREEK).filter(soul_id=soul.pk).exists()
        case = Judgment(soul=soul, tenant=halls["GREEK"], civilization="GREEK")
        case.save()
        key = next(k for k in spent if k != "WF")  # the case counter (<prefix>-<year>), not the WF row
        assert counters.get(key=key).last == spent[key] + 1
        prefix, year = key.rsplit("-", 1)
        assert case.case_number == format_case_number(prefix, int(year), spent[key] + 1)
        assert _where(Judgment, case.pk) == [GREEK]


@sharded
def test_reconcile_fix_control_to_shard_never_overwrites_a_write_cut_shard():
    """`reconcile_shards --civ GREEK --fix` in its default direction (control-to-shard) while Greek writes are cut
    over: the shard is the master of its SHARD rows, so a row only the shard has stays (only REFERENCE and the
    control-mastered models are copied that way). Mutation: `_sides` compares them anyway -> the row is deleted."""
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut("GREEK"):
        with _in_hall(halls["GREEK"]):
            soul = Soul.objects.create(name="shard only", tenant=halls["GREEK"])
        call_command("reconcile_shards", "--civ", "GREEK", "--fix", verbosity=0)
        assert Soul._base_manager.using(GREEK).filter(pk=soul.pk).exists()
