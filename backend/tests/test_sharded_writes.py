"""Sharded writes: each civilization's rows go to its shard (the sharding plan (not in this repo) 阶段 4;
apps/core/shard_reads.py `write_route`, apps/core/shard_ids.py).

  routing        sharded, a row of a hall is written on its civilization's shard, a row with no hall (D2) on control; a
                 write naming no row and no single civilization raises NoShardContext; a write request, a transaction
                 and a per-hall task read the shard they write (reads your writes); a global task / command reads every
                 master (MASTER) and splits a queryset update / delete per master.
  transactions   `transaction.atomic()` holds on the shard too: select_for_update works there, a failure rolls the
                 shard back with control.
  sync           only control's rows are copied, control-to-shard; a shard's own rows are never overwritten.
  ids (4a)       each shard issues integer ids from its own range; the command is idempotent and refuses a foreign id.
  one database   not sharded, every write routes as with no router at all.

The group builds each world in the one-database form (settings_sharded keeps SHARDED False) and switches with `cut()`.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_sharded_writes.py
"""
import pytest
from django.apps import apps
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.db import connections, router, transaction
from django.test import RequestFactory, override_settings

from apps.core.sharding import SHARD, NoShardContext, placement
from tests.shard_support import CIVS, sharded

GREEK, EGYPT = "civ_greek", "civ_egyptian"


def _halls():
    """One hall per civilization in control, synced to the shards (the hall, D4, and what control made for it:
    its root unit), built in the one-database form before `cut()`."""
    from apps.org.ownership import tenant_root
    from apps.tenants.models import Tenant
    from tests.shard_support import _sync

    halls = {civ: Tenant.objects.create(code=f"W4_{civ[:2]}", display_name=civ, declared_civilization=civ)
             for civ in CIVS}
    for hall in halls.values():
        tenant_root(hall)
    _sync()
    return halls


def cut():
    """The sharded form (settings.SHARDED, config/settings.py): every civilization's reads and writes on its shard.
    Assign the id ranges of the shards a test writes (`_assign`, gap 4a) before its first write there."""
    return override_settings(SHARDED=True)


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
def test_each_civilizations_rows_are_written_on_its_shard_and_a_hall_less_row_on_control():
    from apps.souls.models import Soul

    halls = _halls()
    _assign(*CIVS)
    with cut():
        made = {}
        for civ, hall in halls.items():
            with _in_hall(hall):
                made[civ] = Soul.objects.create(name=f"w-{civ}", tenant=hall)
        from apps.audit.models import AuditAction, AuditLog

        nameless = AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="d2")
    for civ in CIVS:
        assert _where(Soul, made[civ].pk) == [f"civ_{civ.lower()}"], civ
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
    with cut():
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
    NoShardContext sharded -- never a quiet write to control -- and runs as before in the one-database form."""
    model = apps.get_model(label)
    with cut():
        with pytest.raises(NoShardContext):
            model._base_manager.filter(pk__in=[]).delete()
        with pytest.raises(NoShardContext):
            model._base_manager.filter(pk__in=[]).update()
    with override_settings(SHARDED=False):
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
    with cut():
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
    _assign("GREEK", "CHINESE")
    admin = User.objects.create_user(username="w4-sys", password="x", role=UserRole.SYSTEM_ADMIN)
    with cut():
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
                assert Soul.lock(chinese.pk)._state.db == "civ_chinese"
                with pytest.raises(NoShardContext):  # rows in two masters cannot be locked by one statement
                    Soul.lock_many([greek.pk, chinese.pk])
            assert Soul.objects.filter(pk__in=[greek.pk, chinese.pk]).update(merit_score=7) == 2
        finally:
            set_current_request(None)
    assert Soul._base_manager.using(GREEK).get(pk=greek.pk).merit_score == 7
    assert Soul._base_manager.using("civ_chinese").get(pk=chinese.pk).merit_score == 7


@sharded
def test_a_per_hall_task_reads_and_writes_its_shard_and_a_global_one_every_master():
    """Celery (apps/core/shard_reads.py header): a per-hall task of a write-cut civilization reads the shard it
    writes; with no hall it reads every master, so a sweep finds a row only the shard has."""
    from apps.core import shard_reads
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut():
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
def test_a_halls_transaction_holds_on_its_shard_and_on_control_and_rolls_back_as_one():
    """One civilization: `atomic()` is control's transaction and the shard's (VERIFY-stage4 must-fix 2): a control
    write -- a hall-less row here; a user, a soul account in the product -- rolls back with the shard row, whether
    the block raises, says `set_rollback` (no `using`: the shard), or the shard's commit fails (the shards commit
    first). No single civilization (MASTER): the same, over every write-cut shard. Mutations: control not opened ->
    control is in autocommit and its row survives; control committed before the shard -> its row survives the
    shard's failed commit. The row locks are on real PostgreSQL: tests/test_control_locks_in_a_write_cut_hall.py."""
    from contextlib import nullcontext
    from unittest import mock

    from django.db import DatabaseError

    from apps.audit.models import AuditAction, AuditLog
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")

    def code_blocks(alias):
        return [b for b in connections[alias].atomic_blocks if not b._from_testcase]

    def both(tag):
        Soul.objects.create(name=tag, tenant=halls["GREEK"])
        AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id=tag)

    def gone(tag):
        return (not Soul._base_manager.using(GREEK).filter(name=tag).exists()
                and not AuditLog._base_manager.using("default").filter(resource_id=tag).exists())

    with cut():
        for hall in (halls["GREEK"], None):  # one civilization, then MASTER
            with _in_hall(hall) if hall else nullcontext():
                with pytest.raises(RuntimeError), transaction.atomic():
                    assert code_blocks("default") and code_blocks(GREEK)
                    assert transaction.get_connection().alias == (GREEK if hall else "default")
                    both(f"raised {hall}")
                    raise RuntimeError
                assert gone(f"raised {hall}")
                with transaction.atomic():
                    both(f"set_rollback {hall}")
                    transaction.set_rollback(True)
                assert gone(f"set_rollback {hall}")
                real, calls = connections[GREEK].savepoint_commit, []

                def fails_once(sid, calls=calls, real=real):  # the shard's commit fails; Django's cleanup does not
                    calls.append(sid)
                    if len(calls) == 1:
                        raise DatabaseError("the shard's commit failed")
                    return real(sid)

                failing = mock.patch.object(connections[GREEK], "savepoint_commit", side_effect=fails_once)
                with pytest.raises(DatabaseError), failing, transaction.atomic():
                    both(f"shard commit failed {hall}")
                assert gone(f"shard commit failed {hall}")
                with transaction.atomic():
                    both(f"kept {hall}")
                assert Soul._base_manager.using(GREEK).filter(name=f"kept {hall}").count() == 1
                assert AuditLog._base_manager.using("default").filter(resource_id=f"kept {hall}").count() == 1


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
    with cut(), _in_hall(halls["GREEK"]):
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
    with cut():
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
def test_a_direct_write_on_control_of_a_halls_row_is_refused():
    """Sharded, a hall's SHARD rows are its shard's; a write of one on control (`.using("default")`, loaddata) writes
    a row nobody reads. Refused for save, delete, queryset update / delete and bulk_create; a row with no hall (D2)
    is written as before; `control_mirror_writes()` lets bare-id deletes (and a test) through. Mutation: the guard
    off -> the write lands on control."""
    from apps.core.shard_reads import ControlMirrorWrite, control_mirror_writes
    from apps.souls.models import Soul

    halls = _halls()
    greek = Soul._base_manager.using("default").create(name="greek mirror", tenant=halls["GREEK"])
    from apps.audit.models import AuditAction, AuditLog

    hall_less = AuditLog._base_manager.using("default").create(tenant=None, action=AuditAction.READ, resource="d2",
                                                                resource_id="no hall")
    _assign("GREEK")
    with cut():
        mirror = Soul._base_manager.using("default")
        for write in (lambda: mirror.filter(pk=greek.pk).update(name="x"),
                      lambda: mirror.filter(pk=greek.pk).delete(),
                      lambda: greek.save(using="default"),
                      lambda: mirror.bulk_create([Soul(name="new mirror", tenant=halls["GREEK"])])):
            with pytest.raises(ControlMirrorWrite):
                write()
        assert AuditLog._base_manager.using("default").filter(pk=hall_less.pk).update(resource_id="still control's") == 1
        with control_mirror_writes():
            assert mirror.filter(pk=greek.pk).update(name="allowed") == 1


# ---- sync ------------------------------------------------------------------------------------------------------

@sharded
def test_a_sync_fix_tells_the_caches_built_from_the_rows_it_wrote():
    """The sync writes raw (no signal), so a per-process copy built from those rows (apps/core/versioned.py: the data
    scope's org tree) would keep answering the old rows until its ttl. `apply_fix` bumps every memo watching a model it
    fixed: the next read sees the new unit. Mutation: no bump -> the stale tree is served."""
    from apps.core.shard_reads import control_mirror_writes, read_context
    from apps.core.shard_sync import reconcile
    from apps.org.models import Organization
    from apps.org.ownership import tenant_root
    from apps.perm.data_scope import _shared, _tree

    halls = _halls()
    hall = halls["CHINESE"]
    root = tenant_root(hall)
    _assign("CHINESE")
    source, target = "default", "civ_chinese"
    with override_settings(SHARDED=False), read_context(target):
        def tree():
            return _shared.get(("tree", hall.pk), lambda: _tree(hall.pk))
        before = tree()
        with control_mirror_writes():  # the unit as the master has it; no signal, no bump
            Organization._base_manager.using(source).bulk_create(
                [Organization(tenant=hall, name="new unit", code="W4_CACHE", parent=root)])
        assert tree() == before  # nothing told the copy yet: the stale answer the sync must end
        reconcile(["civ_chinese"], fix=True)
        new = Organization._base_manager.using(target).get(code="W4_CACHE").pk
        assert new in tree().get(root.pk, []), "a sync fix left the cached org tree stale"


@sharded
def test_a_write_on_control_queues_the_sync_and_one_on_a_shard_does_not(monkeypatch,
                                                                        django_capture_on_commit_callbacks):
    from django.core.cache import cache

    from apps.core import shard_sync
    from apps.realms.models import Realm
    from apps.tenants import tasks

    queued = []
    monkeypatch.setattr(tasks.sync_shards, "apply_async", lambda **kw: queued.append(kw))
    for sharded_, alias, expect in ((False, GREEK, 0), (True, GREEK, 0), (True, "default", 1)):
        cache.delete(shard_sync.DEBOUNCE_KEY)
        queued.clear()
        with override_settings(SHARDED=sharded_), django_capture_on_commit_callbacks(using=alias, execute=True):
            shard_sync._on_write(Realm, using=alias)
        assert len(queued) == expect, (sharded_, alias)


# ---- the one-database form -------------------------------------------------------------------------------------

@sharded
def test_not_sharded_every_write_routes_as_with_no_router():
    """SHARDED False: db_for_write answers "default" for every model, Django's own answer (the row's database) with a
    row as the hint, and `transaction.atomic()` opens nothing on a shard."""
    from apps.core.shard_reads import _atomic_extra
    from apps.souls.models import Soul

    halls = _halls()
    soul = Soul.objects.create(name="stage 3", tenant=halls["GREEK"])
    on_shard = Soul._base_manager.using("default").get(pk=soul.pk)
    on_shard._state.db = GREEK
    with override_settings(SHARDED=False):
        for model in apps.get_models(include_auto_created=True):
            assert router.db_for_write(model) == "default", model._meta.label
        assert router.db_for_write(Soul, instance=on_shard) == GREEK
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
    with cut():
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
    from apps.core.shard_ids import _set_next

    # A PostgreSQL sequence is not rolled back with the test: an earlier test on this database may have moved it
    # into the range already (gate 2026-11-16). Put it back below the range, as a shard that never had it assigned.
    _set_next(GREEK, AuditLog, 1)
    with cut(), _in_hall(halls["GREEK"]):
        # A soul's uuid pk needs no range, but its CREATE audit row (an integer pk, on the shard) goes in with it
        # since 2026-11-19: the create is refused too. Before, that row was an on-commit write, refused and swallowed.
        with pytest.raises(ImproperlyConfigured, match="assign_shard_id_ranges"):
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


# ---- found by the 2026-11-16 review (ADVICE-sharding-fable.md 1.1) and part B's caveats -------------------------

@sharded
def test_a_hall_created_sharded_is_seeded_on_its_shard():
    """POST /tenants/ for a Greek hall, sharded: the hall row is control's, its seed (realms,
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
    with cut():
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

        sync_shards()  # what beat / the debounce runs
        call_command("reconcile_shards", "--civ", "GREEK", verbosity=0)  # CommandError if anything differs


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
    with cut(), _in_hall(halls["GREEK"]):
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
def test_reconcile_fix_never_overwrites_a_shards_own_rows():
    """`reconcile_shards --civ GREEK --fix` sharded: the shard is the master of its SHARD rows, so a row only the shard has stays (only REFERENCE and the
    control-mastered models are copied that way). Mutation: `_sides` compares them anyway -> the row is deleted."""
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut():
        with _in_hall(halls["GREEK"]):
            soul = Soul.objects.create(name="shard only", tenant=halls["GREEK"])
        call_command("reconcile_shards", "--civ", "GREEK", "--fix", verbosity=0)
        assert Soul._base_manager.using(GREEK).filter(pk=soul.pk).exists()


@sharded
def test_a_soul_creates_a_row_whose_first_key_is_a_control_row():
    """A soul's request acts as MASTER. `ChatIdentity(account=..., soul=...)` assigns the control row (the account)
    first, and Django asks the router where the new row goes with only that row in hand: an answer of "not yet",
    never NoShardContext (simulator 2026-11-21: the first open of 书信 was a 500). The row lands on its soul's shard."""
    from apps.authentication.models import User
    from apps.chat.models import ChatIdentity
    from apps.core.shard_reads import read_context
    from apps.soul_accounts.models import AccountOrigin, SoulAccount
    from apps.souls.models import Soul

    halls = _halls()
    _assign("GREEK")
    with cut():
        with _in_hall(halls["GREEK"]):
            soul = Soul.objects.create(name="first letter", tenant=halls["GREEK"])
            user = User.objects.create_user(username="first-letter", password="x", role="SOUL",
                                            tenant=halls["GREEK"])
            account = SoulAccount.objects.create(user=user, soul=soul, cycle=0, origin=AccountOrigin.OFFICER)
        with read_context("default"):  # no hall: MASTER, as a soul's request
            identity, made = ChatIdentity.objects.get_or_create(
                account=account, defaults={"soul": soul, "localpart": "soul_first", "matrix_user_id": "@soul_first:x"})
    assert made
    assert _where(ChatIdentity, identity.pk) == [GREEK]


@sharded
def test_a_souls_follow_lists_show_the_souls_it_follows():
    """Follow edges live on the civilization's shard and users on control. The following / followers lists used a
    Follow subquery inside the User query, which compiled on control and found no edge: both lists were empty
    sharded, and so were the mutual marks (simulator 2026-11-21). Two Greek souls follow each other: each list
    shows the other, both marks true."""
    from apps.social.services import FollowService
    from tests.soul_account_support import ready_soul

    halls = _halls()
    _assign("GREEK")
    with cut():
        with _in_hall(halls["GREEK"]):
            a, client = ready_soul(halls["GREEK"], name="follows one")
            b, _ = ready_soul(halls["GREEK"], name="is followed")
            FollowService.follow(a.user, b.user, halls["GREEK"])
            FollowService.follow(b.user, a.user, halls["GREEK"])
        for path in ("/api/v1/me/social/following/", "/api/v1/me/social/followers/"):
            body = client.get(path).json()
            assert [(r["user_id"], r["is_following"], r["is_followed_by"]) for r in body["results"]] == [
                (b.user_id, True, True)], (path, body)


@sharded
def test_a_subquery_over_the_other_side_of_the_control_shard_line_is_refused():
    """Django compiles a statement on its outer model's database, subqueries included. A User query (control) with
    a Follow subquery (the civilization's shard) found no edge and answered empty / false with no error
    (apps/social/soul_views.py until 184793e22); the reverse reads a table the shard does not have. Both raise
    CrossDatabaseSubquery. A subquery on the same side, or over a hall (REFERENCE, on both), runs."""
    from django.db.models import Exists, OuterRef

    from apps.authentication.models import User
    from apps.core.shard_reads import CrossDatabaseSubquery
    from apps.social.models import Follow
    from apps.tenants.models import Tenant

    halls = _halls()
    with cut(), _in_hall(halls["GREEK"]):
        with pytest.raises(CrossDatabaseSubquery, match="social.Follow"):
            list(User.objects.filter(pk__in=Follow.objects.values_list("following_id", flat=True)))
        with pytest.raises(CrossDatabaseSubquery, match="social.Follow"):
            User.objects.annotate(f=Exists(Follow.objects.filter(follower_id=OuterRef("pk")))).filter(f=True).exists()
        with pytest.raises(CrossDatabaseSubquery, match="authentication.User"):
            list(Follow.objects.filter(follower_id__in=User.objects.filter(role="SOUL").values("pk")))

        assert list(User.objects.filter(pk__in=User.objects.filter(role="SOUL").values("pk"))) == []
        assert list(Follow.objects.filter(follower_id__in=Follow.objects.values("following_id"))) == []
        assert User.objects.filter(tenant__in=Tenant.objects.filter(pk=halls["GREEK"].pk)).count() == 0


@sharded
def test_the_moderation_queue_counts_open_reports_across_shard_and_control():
    """Posts are control's, reports the shard's. The queue's open-report count was a Count("reports") join compiled
    on control, which counted none sharded; it is read for the shown rows by ids now."""
    from apps.authentication.models import User
    from apps.social.models import Post, Report, ReportStatus, Visibility
    from tests.shard_support import _sync
    from tests.soul_account_support import officer_client, ready_soul

    halls = _halls()
    hall = halls["GREEK"]
    author, _ = ready_soul(hall, name="reported author")  # the one-database form, then synced (as _halls)
    row = Post.objects.create(author=author.user, content="reported", visibility=Visibility.PUBLIC, tenant=hall)
    admin = User.objects.create_user(username="gr-moderator", password="x", role="ADMIN", tenant=hall)
    _sync()
    _assign("GREEK")
    with cut():
        with _in_hall(hall):
            Report.objects.create(post=row, tenant=hall, target_type="POST", target_user=author.user,
                                  status=ReportStatus.OPEN)
        status = Post.objects.get(pk=row.pk).moderation_status
        res = officer_client(admin).get("/api/v1/social-moderation/posts/", {"moderation_status": status})
        assert res.status_code == 200, res.content
        rows = res.json()["results"] if isinstance(res.json(), dict) else res.json()
        assert [(r["id"], r["open_report_count"]) for r in rows] == [(str(row.pk), 1)], rows
