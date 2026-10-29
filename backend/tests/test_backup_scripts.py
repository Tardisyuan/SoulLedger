"""scripts/backup-db.sh off-site copy + failure alert, and scripts/restore-drill.sh (ops gaps 13/14/15).

Both scripts run for real against fake pg_dump / rclone / curl / psql / createdb / dropdb
put first on PATH; each fake logs its argv so the tests assert what was (and was not) run.
Run from tmp_path: backup-db.sh sources ./.env when there is one.
"""
import os
import subprocess
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
BACKUP = SCRIPTS / "backup-db.sh"
DRILL = SCRIPTS / "restore-drill.sh"


def _fake(bin_dir, name, body):
    path = bin_dir / name
    path.write_text(f'#!/bin/bash\necho "$*" >> "{bin_dir}/{name}.log"\n{body}\n')
    path.chmod(0o755)


def _log(bin_dir, name):
    log = bin_dir / f"{name}.log"
    return log.read_text() if log.exists() else ""


def _env(bin_dir, **extra):
    return {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(bin_dir), "PGPASSWORD": "x", **extra}


# -- backup-db.sh -----------------------------------------------------------

def _backup(tmp_path, *, pg_dump_rc=0, rclone=True, rclone_rc=0, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    _fake(bin_dir, "pg_dump", f'''[ {pg_dump_rc} -eq 0 ] || exit {pg_dump_rc}
while [ $# -gt 0 ]; do [ "$1" = -f ] && {{ echo dump | gzip > "$2"; }}; shift; done''')
    if rclone:
        _fake(bin_dir, "rclone", f"exit {rclone_rc}")
    _fake(bin_dir, "curl", "cat >/dev/null; exit 0")
    out_dir = tmp_path / "backups"
    p = subprocess.run(["sh", str(BACKUP), str(out_dir)], cwd=tmp_path, env=_env(bin_dir, **env),
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr, bin_dir, out_dir


def test_no_offsite_and_no_webhook_says_both_and_still_backs_up(tmp_path):
    code, out, bin_dir, out_dir = _backup(tmp_path)
    assert code == 0, out
    assert "BACKUP_OFFSITE_REMOTE not set; no off-site copy" in out
    assert list(out_dir.glob("soulledger_2*.sql.gz"))
    assert _log(bin_dir, "rclone") == "" and _log(bin_dir, "curl") == ""
    assert "ALERT" not in out


def test_offsite_copies_never_syncs_then_applies_its_own_retention(tmp_path):
    code, out, bin_dir, out_dir = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl", OFFSITE_RETENTION_DAYS="45")
    assert code == 0, out
    calls = _log(bin_dir, "rclone").splitlines()
    assert calls == [
        f"copy --include soulledger_* --exclude *.partial {out_dir} box:sl",
        "delete --include soulledger_* --min-age 45d box:sl",
    ]
    assert not any(c.startswith("sync") for c in calls)


def test_offsite_retention_zero_never_deletes_offsite(tmp_path):
    code, out, bin_dir, _ = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl", OFFSITE_RETENTION_DAYS="0")
    assert code == 0, out
    assert [c.split()[0] for c in _log(bin_dir, "rclone").splitlines()] == ["copy"]


def test_a_failed_offsite_copy_exits_nonzero_alerts_and_keeps_the_local_dump(tmp_path):
    code, out, bin_dir, out_dir = _backup(tmp_path, rclone_rc=3, BACKUP_OFFSITE_REMOTE="box:sl",
                                          OPS_ALERT_WEBHOOK_URL="https://hooks.example/ops")
    assert code == 1, out
    assert "off-site copy failed" in out
    assert list(out_dir.glob("soulledger_2*.sql.gz"))
    posted = _log(bin_dir, "curl")
    assert "https://hooks.example/ops" in posted and "backup-db.sh FAILED (exit 1)" in posted
    assert "Alert sent" in out


def test_offsite_set_without_rclone_fails_instead_of_skipping(tmp_path):
    code, out, _, _ = _backup(tmp_path, rclone=False, BACKUP_OFFSITE_REMOTE="box:sl")
    assert code == 1, out
    assert "rclone is not installed" in out


def test_a_failed_dump_with_no_webhook_says_nobody_was_notified(tmp_path):
    code, out, bin_dir, out_dir = _backup(tmp_path, pg_dump_rc=1)
    assert code == 1, out
    assert "OPS_ALERT_WEBHOOK_URL not set; nobody was notified" in out
    assert "backup-db.sh FAILED (exit 1)" in out
    assert not list(out_dir.glob("soulledger_*"))
    assert _log(bin_dir, "curl") == ""


# -- restore-drill.sh -------------------------------------------------------

def _drill(tmp_path, *, live_migrations="auth.0001\nsouls.0001", restore_rc=0, backups=True):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    data = tmp_path / "data"
    data.mkdir()
    for kind, migrations in (("live", live_migrations), ("drill", "auth.0001\nsouls.0001")):
        (data / f"{kind}.tables").write_text("auth_user\nsouls_soul\n")
        (data / f"{kind}.migrations").write_text(migrations + "\n")
        (data / f"{kind}.counts").write_text("auth_user 3\nsouls_soul 7\n")
    _fake(bin_dir, "createdb", "")
    _fake(bin_dir, "dropdb", "")
    _fake(bin_dir, "psql", f'''db=""; sql=""; restore=0
while [ $# -gt 0 ]; do case "$1" in -d) db="$2"; shift;; -Atc) sql="$2"; shift;; --single-transaction) restore=1;; esac; shift; done
kind=drill; [ "$db" = soulledger ] && kind=live
if [ $restore = 1 ]; then cat >/dev/null; exit {restore_rc}; fi
case "$sql" in *pg_tables*) cat {data}/$kind.tables;; *django_migrations*) cat {data}/$kind.migrations;;
  *) cat >/dev/null; cat {data}/$kind.counts;; esac''')
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    if backups:
        for name in ("soulledger_20261001_020000.sql.gz", "soulledger_20261002_020000.sql.gz"):
            subprocess.run(f"echo dump | gzip > {backup_dir / name}", shell=True, check=True)
        (backup_dir / "soulledger_synapse_20261003_020000.dump").write_text("not a db dump")
    p = subprocess.run(["bash", str(DRILL), str(backup_dir)], cwd=tmp_path,
                       env=_env(bin_dir, PGDATABASE="soulledger"), capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr, bin_dir


def test_drill_restores_the_newest_db_dump_compares_and_drops(tmp_path):
    code, out, bin_dir = _drill(tmp_path)
    assert code == 0, out
    assert "soulledger_20261002_020000.sql.gz ->" in out and "20261001" not in out
    created = _log(bin_dir, "createdb").split()
    assert created[0].startswith("soulledger_drill_")
    assert _log(bin_dir, "dropdb").split() == ["--if-exists", created[0]]
    assert "souls_soul 7 7" in out and "Restore drill passed." in out
    assert "ALERT" not in out


def test_drill_fails_when_live_has_a_migration_the_backup_lacks_and_still_drops(tmp_path):
    code, out, bin_dir = _drill(tmp_path, live_migrations="auth.0001\nsouls.0001\nsouls.0002")
    assert code == 1, out
    assert "souls.0002" in out and "needs migrate" in out
    assert "Restore drill passed." not in out
    assert _log(bin_dir, "dropdb").startswith("--if-exists soulledger_drill_")
    assert "restore-drill.sh FAILED (exit 1)" in out


def test_a_failed_restore_still_drops_the_scratch_db(tmp_path):
    code, out, bin_dir = _drill(tmp_path, restore_rc=3)
    assert code != 0, out
    assert _log(bin_dir, "dropdb").startswith("--if-exists soulledger_drill_")
    assert "Restore drill passed." not in out


def test_no_backup_creates_nothing(tmp_path):
    code, out, bin_dir = _drill(tmp_path, backups=False)
    assert code == 1, out
    assert "no soulledger_<timestamp>.sql.gz" in out
    assert _log(bin_dir, "createdb") == "" and _log(bin_dir, "dropdb") == ""


def test_scripts_are_executable_where_compose_calls_them():
    for script in (BACKUP, DRILL):
        assert os.access(script, os.X_OK), script
