"""Stage 5 preparation (docs/audit/2026-11-15-sharding/PLAN.md 阶段 5 / 阶段 5 待清理): the two dry-run tools.

  backfill_disposition_halls   a hall-less disposition gets its judgment's hall: the dry run prints the plan and
                               writes nothing; --apply writes the row on its master (the shard, every civilization
                               write-cut as on 115) and control's mirror alike, audits it once, and a rerun does
                               nothing; the next shard-to-control sync keeps it.
  purge_cut_over_tenant_rows   --dry-run counts control's rows of a civilization, keeps D2 and control-mastered
                               rows, names the constrained keys that would strand a staying row, checks the dump.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_stage5_prep.py
"""
import io
import os
import time

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections, router, transaction
from django.test import override_settings

from apps.core.sharding import alias_for_civilization
from tests.test_shard_sync import CIVS, _sync, sharded
from tests.test_sharded_writes import _assign, _halls, cut

CN = "civ_chinese"


def _world():
    """Three hall-less dispositions as on 115, synced to the shards; ranges assigned for every civilization."""
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment
    from apps.realms.models import Realm, RealmType
    from apps.souls.models import Soul

    halls = _halls()
    realm = {civ: Realm.objects.create(realm_code=f"S5_{civ[:2]}", civilization=civ, name_local=civ,
                                       realm_type=RealmType.HELL, tenant=halls[civ]) for civ in ("CHINESE", "EGYPTIAN")}
    cn = halls["CHINESE"]
    souls = [Soul.objects.create(name=f"s5-{i}", tenant=cn) for i in range(3)]
    case_cn, case_none, case_cross = (Judgment.objects.create(soul=s, tenant=cn, is_final=True) for s in souls)
    rows = {name: Disposition.objects.create(soul=s, judgment=j, destination_realm=realm["CHINESE"], tenant=cn,
                                             is_executed=name == "move")
            for name, s, j in (("move", souls[0], case_cn), ("stay", souls[1], case_none),
                               ("blocked", souls[2], case_cross))}
    # The shape on 115, which today's validation no longer lets anyone write: no hall on the disposition (nor on
    # one judgment), and one destination realm of another civilization.
    Judgment._base_manager.filter(pk=case_none.pk).update(tenant=None)
    Disposition._base_manager.filter(pk__in=[d.pk for d in rows.values()]).update(tenant=None)
    Disposition._base_manager.filter(pk=rows["blocked"].pk).update(destination_realm=realm["EGYPTIAN"])
    # The setup's own generic CREATE rows (a disposition's names its hall as created, before the update above made
    # it hall-less) are in the table since audit rows go in with the write (2026-11-19). They are this fixture's,
    # not the command's: the tests below count the rows the command writes.
    from apps.audit.models import AuditLog

    AuditLog._base_manager.filter(description="").delete()
    _sync()
    _assign(*CIVS)
    return halls, rows


def _run(name, *args):
    out = io.StringIO()
    call_command(name, *args, stdout=out)
    return out.getvalue()


def _state():
    """Every Disposition row (whole-row digest) and the AuditLog count, on every alias that has the tables."""
    from apps.audit.models import AuditLog
    from apps.core.shard_sync import fingerprints
    from apps.disposition.models import Disposition

    return {a: (fingerprints(Disposition._base_manager.using(a).all()), AuditLog._base_manager.using(a).count())
            for a in connections if router.allow_migrate_model(a, Disposition)}


def _line(out, pk):
    return next(line for line in out.splitlines() if str(pk) in line)


@sharded
def test_the_dry_run_prints_the_plan_and_writes_nothing():
    halls, rows = _world()
    with cut(*CIVS):
        before = _state()
        out = _run("backfill_disposition_halls", "--dry-run")
        assert _state() == before
    move = _line(out, rows["move"].pk)
    assert move.startswith("MOVE") and halls["CHINESE"].code in move and f"master {CN}" in move
    assert "EXECUTED" in move
    stay = _line(out, rows["stay"].pk)
    assert stay.startswith("STAY") and "JUDGMENT_HAS_NO_HALL" in stay and "-> control" in stay
    blocked = _line(out, rows["blocked"].pk)
    assert blocked.startswith("BLOCKED") and halls["EGYPTIAN"].code in blocked
    assert "BLOCKED 1, MOVE 1, STAY 1 (dry run, nothing written" in out


@sharded
def test_apply_never_loses_the_row_it_moves_not_even_once_controls_mirror_is_purged():
    """Step 0c's question (2026-11-20, a G7 run reported the hall-less disposition gone after --apply): after --apply the
    disposition exists on its new master exactly once, with its soul, its judgment and its realm, and control's copy
    is a mirror; with that mirror purged (stage 5, raw, as G6 does) it is still there, once, on its master; and the
    shard-to-control sync brings the mirror back rather than deleting the master's row. Each of these is a moment a
    lost row would show."""
    from apps.core.shard_reads import control_mirror_writes
    from apps.core.shard_sync import sync
    from apps.disposition.models import Disposition

    halls, rows = _world()
    cn = halls["CHINESE"]
    d = rows["move"]

    def where():
        return sorted(a for a in connections if Disposition._base_manager.using(a).filter(pk=d.pk).exists())

    with cut(*CIVS):
        _run("backfill_disposition_halls", "--apply")
        assert where() == [CN, "default"]  # the master, and control's mirror until stage 5
        row = Disposition._base_manager.using(CN).get(pk=d.pk)
        assert (row.tenant_id, row.soul_id, row.judgment_id, row.destination_realm_id) == (
            cn.pk, d.soul_id, d.judgment_id, d.destination_realm_id)
        from apps.judgment.models import Judgment

        assert Judgment._base_manager.using(CN).filter(pk=d.judgment_id).exists()  # the key holds on the master
        with control_mirror_writes():
            Disposition._base_manager.using("default").filter(pk=d.pk)._raw_delete("default")
        assert where() == [CN]
        sync([CN])
        assert where() == [CN, "default"]
        assert Disposition._base_manager.using("default").get(pk=d.pk).tenant_id == cn.pk


@sharded
def test_apply_moves_the_row_to_its_master_audits_it_once_and_is_idempotent():
    from apps.audit.models import AuditLog
    from apps.disposition.models import Disposition

    halls, rows = _world()
    cn = halls["CHINESE"]
    with cut(*CIVS):
        out = _run("backfill_disposition_halls", "--apply")
        assert "DONE 1" in out
        moved = rows["move"].pk
        assert Disposition._base_manager.using(CN).get(pk=moved).tenant_id == cn.pk
        assert Disposition._base_manager.using("default").get(pk=moved).tenant_id == cn.pk
        audit = AuditLog._base_manager.using(CN).filter(resource="disposition", resource_id=str(moved))
        assert list(audit.values_list("tenant_id", "changes")) == [(cn.pk, {"tenant": [None, cn.code]})]
        for name in ("stay", "blocked"):  # untouched: still hall-less, on control only
            pk = rows[name].pk
            assert Disposition._base_manager.using("default").get(pk=pk).tenant_id is None
            assert not any(Disposition._base_manager.using(a).filter(pk=pk).exists() for a in connections
                           if a.startswith("civ_"))

        before = _state()
        again = _run("backfill_disposition_halls", "--apply")
        assert str(moved) not in again and "DONE" not in again
        assert _state() == before

        from apps.core.shard_sync import sync

        sync([CN])  # the beat's sync, shard-to-control for a write-cut shard: it copies the audit row to control and
        # keeps the disposition (control's row equals the shard's; had control been changed first it would delete it)
        assert Disposition._base_manager.using("default").get(pk=moved).tenant_id == cn.pk
        assert f"{CN}: 0 row(s) differ" in _run("reconcile_shards", "--civ", "CHINESE", "--direction",
                                                "shard-to-control")


@sharded
def test_apply_after_a_crash_between_the_two_commits_finishes_controls_side_only():
    """The shard row written, control's still hall-less (a crash after the first commit): a rerun updates control
    and writes no second audit row."""
    from apps.audit.models import AuditLog
    from apps.disposition.management.commands import backfill_disposition_halls as cmd
    from apps.disposition.models import Disposition

    halls, rows = _world()
    with cut(*CIVS):
        real = cmd.control_mirror_writes

        def crash():
            raise RuntimeError("crash between the commits")
        cmd.control_mirror_writes = crash
        try:
            with pytest.raises(RuntimeError):
                _run("backfill_disposition_halls", "--apply")
        finally:
            cmd.control_mirror_writes = real
        moved = rows["move"].pk
        assert Disposition._base_manager.using("default").get(pk=moved).tenant_id is None
        _run("backfill_disposition_halls", "--apply")
        assert Disposition._base_manager.using("default").get(pk=moved).tenant_id == halls["CHINESE"].pk
        assert AuditLog._base_manager.using(CN).filter(resource_id=str(moved)).count() == 1


def _manifest(tmp_path, *who, age=0):
    lines = []
    for w in who:
        name = f"soulledger_{w}_20261119.sql.gz"
        (tmp_path / name).write_bytes(b"x")
        lines.append(f"{w} {name}")
    path = tmp_path / "soulledger_manifest_20261119.txt"
    path.write_text("\n".join(lines) + "\n")
    if age:  # negative: written a moment from now (a coarse file clock could otherwise date it before a stamp)
        for p in [path, *(tmp_path / line.split()[1] for line in lines)]:
            os.utime(p, (time.time() - age, time.time() - age))
    return str(path)


def purged(*civs):
    """Every civilization's reads and writes cut over (115's state), `civs` purged (SHARD_PURGED_CIVS)."""
    return override_settings(SHARD_READ_CIVS=list(CIVS), SHARD_WRITE_CIVS=list(CIVS), SHARD_PURGED_CIVS=list(civs))


def _stop(tmp_path, civ="CHINESE"):
    """PREP §4 steps 3 and 5 inside `purged(civ)`: the beat's sync runs with the switch (stamping the stop), then a
    dump is taken: a manifest of control and the shard written after the stamp."""
    from apps.tenants.tasks import sync_shards

    sync_shards()
    return _manifest(tmp_path, "control", alias_for_civilization(civ), age=-2)


@sharded
def test_the_purge_dry_run_counts_keeps_d2_and_names_the_keys_that_would_strand_a_row(tmp_path):
    from apps.disposition.models import Disposition
    from apps.tenants.management.commands.purge_cut_over_tenant_rows import purge_plan

    halls, rows = _world()
    with purged("CHINESE"):
        manifest = _stop(tmp_path)
        before = _state()
        out = io.StringIO()
        with pytest.raises(CommandError, match="failed: no blockers"):  # the only failing precondition
            call_command("purge_cut_over_tenant_rows", "--civ", "chinese", "--dry-run", "--dump", manifest, stdout=out)
        out = out.getvalue()
        assert _state() == before
        assert "PASS writes cut over" in out and "PASS reconcile shard-to-control clean" in out
        assert "PASS sync stopped: since" in out and "PASS dump under 24 h, after the sync stopped" in out
        assert "UNCHECKED restore drill" in out
        assert "purge judgment.Judgment 2" in out  # the two Chinese cases; the hall-less one stays (D2)
        assert "purge disposition.Disposition" not in out  # all three are hall-less
        assert "block disposition.Disposition.judgment 2 row(s)" in out
        assert "block disposition.Disposition.destination_realm 2 row(s)" in out  # "move" and "stay": the Chinese realm
        assert "block judgment.Judgment.owner_org 1 row(s)" in out  # the hall-less case still names its old unit
        assert "keep  social.Post (control-mastered)" in out
        assert purge_plan("CHINESE")[Disposition].count() == 0

        _run("backfill_disposition_halls", "--apply")
        out = io.StringIO()
        with pytest.raises(CommandError):
            call_command("purge_cut_over_tenant_rows", "--civ", "CHINESE", "--dry-run", "--dump", manifest, stdout=out)
        assert "block disposition.Disposition.judgment 1 row(s)" in out.getvalue()  # only "blocked" is left
        assert "purge disposition.Disposition 1" in out.getvalue()
        assert rows["move"].pk in purge_plan("CHINESE")[Disposition].values_list("pk", flat=True)

        with pytest.raises(CommandError, match="--dry-run --confirm is required"):
            _run("purge_cut_over_tenant_rows", "--civ", "CHINESE")


@sharded
def test_the_purge_dry_run_refuses_a_civilization_whose_writes_are_on_control(tmp_path):
    _world()
    with cut("GREEK"):
        out = io.StringIO()
        with pytest.raises(CommandError, match="writes cut over"):
            call_command("purge_cut_over_tenant_rows", "--civ", "CHINESE", "--dry-run",
                         "--dump", _manifest(tmp_path, "control", CN), stdout=out)


def test_the_dump_must_be_a_fresh_manifest_of_control_and_this_shard(tmp_path):
    from apps.tenants.management.commands.purge_cut_over_tenant_rows import dump_problem

    assert dump_problem(None, CN) == "no --dump given"
    assert dump_problem(_manifest(tmp_path, "control", CN), CN) is None
    assert "does not list civ_chinese" in dump_problem(_manifest(tmp_path, "control", "civ_greek"), CN)
    assert "h old" in dump_problem(_manifest(tmp_path, "control", CN, age=25 * 3600), CN)
    path = _manifest(tmp_path, "control", CN)
    (tmp_path / f"soulledger_{CN}_20261119.sql.gz").write_bytes(b"")
    assert "missing or empty" in dump_problem(path, CN)


def test_the_dump_must_be_newer_than_the_stop(tmp_path):
    """G5: a manifest (or a listed dump) written before the sync stopped is refused; after it, accepted."""
    from datetime import UTC, datetime, timedelta

    from apps.tenants.management.commands.purge_cut_over_tenant_rows import dump_problem

    path = _manifest(tmp_path, "control", CN, age=60)
    stop = datetime.now(UTC) - timedelta(seconds=30)
    assert "written before the sync stopped" in dump_problem(path, CN, since=stop)
    assert dump_problem(path, CN, since=stop - timedelta(minutes=5)) is None
    assert dump_problem(path, CN) is None  # no stamp given: only the 24 h rule


def test_a_purged_civilization_must_be_write_cut():
    from django.core.exceptions import ImproperlyConfigured

    from apps.core.sharding import check_cut_over_settings

    databases = {"default": {}, "civ_greek": {}}
    check_cut_over_settings(["GREEK"], ["GREEK"], databases, purged=["GREEK"])
    with pytest.raises(ImproperlyConfigured, match="SHARD_PURGED_CIVS \\['GREEK'\\] are not in SHARD_WRITE_CIVS"):
        check_cut_over_settings(["GREEK"], [], databases, purged=["GREEK"])


@sharded
def test_a_purged_civilization_is_not_synced_back_but_its_reference_rows_still_go_out():
    """G1 / M10: with CHINESE in SHARD_PURGED_CIVS the beat's sync leaves a changed control row of it alone (and
    stamps the stop), keeps copying REFERENCE rows control-to-shard, and a shard write queues no sync. Taken back
    off: the same sync rewrites control's row from the shard, the stamp is gone, the write queues a sync."""
    from apps.core import shard_sync
    from apps.core.shard_reads import control_mirror_writes
    from apps.judgment.models import Judgment
    from apps.social.models import Post
    from apps.tenants.models import Tenant
    from apps.tenants.tasks import sync_shards

    halls, _rows = _world()
    cn = halls["CHINESE"]
    case = Judgment._base_manager.using(CN).filter(tenant=cn).first()

    def stale_control():
        with control_mirror_writes():
            Judgment._base_manager.using("default").filter(pk=case.pk).update(is_final=False)

    def queued():
        with transaction.atomic(using=CN):
            shard_sync._on_write(Judgment, using=CN)
            return any(f is shard_sync._enqueue for _, f, _ in connections[CN].run_on_commit)

    with purged("CHINESE"):
        stale_control()
        Tenant._base_manager.using("default").filter(pk=cn.pk).update(display_name="renamed")  # REFERENCE (D4)
        sync_shards()
        assert Judgment._base_manager.using("default").get(pk=case.pk).is_final is False  # not synced back
        assert Tenant._base_manager.using(CN).get(pk=cn.pk).display_name == "renamed"  # still synced out
        assert shard_sync._sides(Post, CN, "CHINESE", [cn.pk], shard_sync.CONTROL_TO_SHARD) is not None  # G3
        assert shard_sync.sync_stopped_at("CHINESE") is not None
        assert shard_sync.sync_stopped_at("GREEK") is None
        assert not queued()
        assert f"{CN}: 0 row(s) differ" in _run("reconcile_shards", "--civ", "CHINESE", "--direction",
                                                "shard-to-control")

    with cut(*CIVS):
        sync_shards()
        assert Judgment._base_manager.using("default").get(pk=case.pk).is_final is True
        assert shard_sync.sync_stopped_at("CHINESE") is None
        assert queued()


@sharded
def test_judgment_hall_gives_a_hall_less_judgment_its_souls_hall_and_its_disposition_follows():
    """User decision 2026-11-19 (#9): `--judgment-hall <id>=<hall>` gives a hall-less judgment its soul's hall
    (dry run MOVE, writes nothing; --apply puts it and then its disposition on the shard, audits once; a rerun does
    nothing). Without the option the disposition stays; a hall that is not its soul's is refused."""
    from apps.audit.models import AuditLog
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment

    halls, rows = _world()
    cn, stay = halls["CHINESE"], rows["stay"].pk
    case = Disposition._base_manager.using("default").get(pk=stay).judgment_id
    with cut(*CIVS):
        assert _line(_run("backfill_disposition_halls", "--dry-run"), stay).startswith("STAY")
        out = _run("backfill_disposition_halls", "--dry-run", "--judgment-hall", f"{case}={halls['EGYPTIAN'].code}")
        assert _line(out, f"judgment {case} soul").startswith("BLOCKED") and "neither its soul's hall" in out
        assert _line(out, stay).startswith("STAY")
        with pytest.raises(CommandError, match="expected <judgment id>=<hall code>"):
            _run("backfill_disposition_halls", "--judgment-hall", f"{case}")

        before = _state()
        out = _run("backfill_disposition_halls", "--dry-run", "--judgment-hall", f"{case}={cn.code}")
        assert _state() == before
        assert _line(out, f"judgment {case} soul").startswith("MOVE")
        move = _line(out, stay)
        assert move.startswith("MOVE") and "JUDGMENT_HALL_GIVEN" in move and f"master {CN}" in move
        assert Judgment._base_manager.using("default").get(pk=case).tenant_id is None
        assert not Judgment._base_manager.using(CN).filter(pk=case).exists()

        _run("backfill_disposition_halls", "--apply", "--judgment-hall", f"{case}={cn.code}")
        connections[CN].check_constraints()  # the shard's keys hold (what its commit would check)
        from apps.core.shard_sync import sync

        sync([CN])  # the beat's shard-to-control sync: brings the audit rows to control, changes nothing else
        for alias in ("default", CN):
            assert Judgment._base_manager.using(alias).get(pk=case).tenant_id == cn.pk, alias
            assert Disposition._base_manager.using(alias).get(pk=stay).tenant_id == cn.pk, alias
        assert AuditLog._base_manager.using(CN).filter(resource="judgment", resource_id=str(case)).count() == 1
        assert f"{CN}: 0 row(s) differ" in _run("reconcile_shards", "--civ", "CHINESE", "--direction",
                                                "shard-to-control")

        before = _state()
        again = _run("backfill_disposition_halls", "--apply", "--judgment-hall", f"{case}={cn.code}")
        assert f"judgment {case} soul" not in again and str(stay) not in again and "DONE" not in again
        assert _state() == before
        assert AuditLog._base_manager.using(CN).filter(resource="judgment", resource_id=str(case)).count() == 1


@sharded
def test_the_purge_deletes_controls_copy_only_and_a_rerun_deletes_nothing(tmp_path):
    """G6 / G9 / G2: --confirm must repeat the civilization and needs every check; it deletes the civilization's
    mirror rows on control and nothing else -- not the control-mastered Post, not a D2 row, not the hall, not another
    civilization's rows, not the shard's -- in one transaction (an org deleted before the souls naming it: the keys
    are deferred). `reconcile_shards --assert-control-empty` fails before, passes after; a rerun deletes 0."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.authentication.models import User
    from apps.core.shard_sync import purge_plan
    from apps.disposition.models import Disposition
    from apps.judgment.models import Judgment
    from apps.org.models import Organization
    from apps.social.models import Post
    from apps.souls.models import Soul
    from apps.tenants.models import Tenant

    halls, rows = _world()
    cn = halls["CHINESE"]
    post = Post.objects.create(author=User.objects.create_user(username="s5-post", password="x"), content="kept",
                               tenant=cn)
    d2 = AuditLog.objects.using("default").create(tenant=None, action=AuditAction.UPDATE, resource="s5",
                                                  resource_id="1")
    _sync()
    case = Disposition._base_manager.using("default").get(pk=rows["stay"].pk).judgment_id
    with cut(*CIVS):
        _run("backfill_disposition_halls", "--apply", "--judgment-hall", f"{case}={cn.code}")
    # The one blocker left is "blocked" (a Chinese judgment, an Egyptian realm): the user's to resolve; here, gone.
    Disposition._base_manager.using("default").filter(pk=rows["blocked"].pk)._raw_delete("default")

    def confirm(*extra, manifest):
        return _run("purge_cut_over_tenant_rows", "--civ", "CHINESE", *extra, "--dump", manifest)

    def counts():
        return {m: qs.count() for m, qs in purge_plan("CHINESE").items()}

    others = {c: Organization._base_manager.using("default").filter(tenant=halls[c]).count() for c in CIVS}
    with cut(*CIVS):  # not purged yet: --confirm refuses on "sync stopped"
        before = counts()
        with pytest.raises(CommandError, match="failed: sync stopped"):
            confirm("--confirm", "CHINESE", manifest=_manifest(tmp_path, "control", CN))
        assert counts() == before

    with purged("CHINESE"):
        manifest = _stop(tmp_path)
        assert before[Judgment] == 3 and before[Soul] == 3 and before[Organization] >= 1
        for wrong in ("chinese", "GREEK"):
            with pytest.raises(CommandError, match="does not repeat the civilization"):
                confirm("--confirm", wrong, manifest=manifest)
        assert counts() == before
        with pytest.raises(CommandError, match="still holds"):
            _run("reconcile_shards", "--civ", "CHINESE", "--assert-control-empty")
        assert "dry run: nothing deleted" in confirm("--dry-run", manifest=manifest)
        assert counts() == before

        out = confirm("--confirm", "CHINESE", manifest=manifest)
        assert f"deleted total {sum(before.values())} row(s)" in out and "deleted judgment.Judgment 3" in out
        assert not any(counts().values())
        connections["default"].check_constraints()  # no staying row names a deleted one (the deferred keys)
        assert "control holds 0 purgeable row(s)" in _run("reconcile_shards", "--civ", "CHINESE",
                                                          "--assert-control-empty")
        # What a purge must not touch:
        assert Post._base_manager.using("default").filter(pk=post.pk).exists()  # control-mastered
        assert AuditLog._base_manager.using("default").filter(pk=d2.pk).exists()  # D2
        assert Tenant._base_manager.using("default").filter(pk=cn.pk).exists()  # REFERENCE
        assert not Disposition._base_manager.using("default").filter(pk=rows["move"].pk).exists()
        assert Disposition._base_manager.using(CN).filter(pk=rows["move"].pk).exists()  # the master is untouched
        assert Judgment._base_manager.using(CN).filter(tenant=cn).count() == 3
        assert {c: Organization._base_manager.using("default").filter(tenant=halls[c]).count() for c in CIVS} == {
            **others, "CHINESE": 0}
        assert f"{CN}: 0 row(s) differ" in _run("reconcile_shards", "--civ", "CHINESE")  # REFERENCE and Post, out

        assert "deleted total 0 row(s)" in confirm("--confirm", "CHINESE", manifest=manifest)
