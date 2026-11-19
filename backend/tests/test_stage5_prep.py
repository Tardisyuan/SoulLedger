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
from django.db import connections, router

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
    if age:
        os.utime(path, (time.time() - age, time.time() - age))
    return str(path)


@sharded
def test_the_purge_dry_run_counts_keeps_d2_and_names_the_keys_that_would_strand_a_row(tmp_path):
    from apps.disposition.models import Disposition
    from apps.tenants.management.commands.purge_cut_over_tenant_rows import purge_plan

    halls, rows = _world()
    manifest = _manifest(tmp_path, "control", CN)
    with cut(*CIVS):
        before = _state()
        out = io.StringIO()
        with pytest.raises(CommandError, match="failed: no blockers"):  # the only failing precondition
            call_command("purge_cut_over_tenant_rows", "--civ", "chinese", "--dry-run", "--dump", manifest, stdout=out)
        out = out.getvalue()
        assert _state() == before
        assert "PASS writes cut over" in out and "PASS reconcile shard-to-control clean" in out
        assert "PASS dump under 24 h" in out
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

        with pytest.raises(CommandError, match="only --dry-run exists"):
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
