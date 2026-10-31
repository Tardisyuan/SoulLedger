"""scripts/backup-db.sh off-site copy + failure alert + age encryption + strict mode, and
scripts/restore-drill.sh (db, media, Synapse, decryption) — ops gaps 13/14/15, review 2026-10-31 B14/B16/B17.

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


# Fake age: `-o OUT IN` copies IN to OUT behind a header (encrypt), and `-d -i ID` strips
# it again — refusing when the identity file does not exist or the input lacks the header.
AGE = '''out=""; in=""; dec=0; id=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; -d) dec=1;; -i) id="$2"; shift;; -r) shift;; *) in="$1";; esac; shift; done
if [ $dec = 1 ]; then [ -f "$id" ] && [ "$(head -c 8 "$in")" = "AGEFAKE:" ] || exit 1; tail -c +9 "$in" > "$out"
else { printf AGEFAKE:; cat "$in"; } > "$out"; fi'''


# -- backup-db.sh -----------------------------------------------------------

def _backup(tmp_path, *, pg_dump_rc=0, rclone=True, rclone_rc=0, age=True, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    _fake(bin_dir, "pg_dump", f'''[ {pg_dump_rc} -eq 0 ] || exit {pg_dump_rc}
while [ $# -gt 0 ]; do [ "$1" = -f ] && {{ echo dump | gzip > "$2"; }}; shift; done''')
    if rclone:
        _fake(bin_dir, "rclone", f"exit {rclone_rc}")
    _fake(bin_dir, "curl", "cat >/dev/null; exit 0")
    if age:
        _fake(bin_dir, "age", AGE)
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
    code, out, bin_dir, out_dir = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl", OFFSITE_RETENTION_DAYS="45",
                                          ALLOW_PLAINTEXT_OFFSITE="1")
    assert code == 0, out
    calls = _log(bin_dir, "rclone").splitlines()
    assert calls == [
        f"copy --include soulledger_* --exclude *.partial {out_dir} box:sl",
        "delete --include soulledger_* --min-age 45d box:sl",
    ]
    assert not any(c.startswith("sync") for c in calls)


def test_offsite_retention_zero_never_deletes_offsite(tmp_path):
    code, out, bin_dir, _ = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl", OFFSITE_RETENTION_DAYS="0",
                                    ALLOW_PLAINTEXT_OFFSITE="1")
    assert code == 0, out
    assert [c.split()[0] for c in _log(bin_dir, "rclone").splitlines()] == ["copy"]


def test_a_failed_offsite_copy_exits_nonzero_alerts_and_keeps_the_local_dump(tmp_path):
    code, out, bin_dir, out_dir = _backup(tmp_path, rclone_rc=3, BACKUP_OFFSITE_REMOTE="box:sl",
                                          OPS_ALERT_WEBHOOK_URL="https://hooks.example/ops",
                                          ALLOW_PLAINTEXT_OFFSITE="1")
    assert code == 1, out
    assert "off-site copy failed" in out
    assert list(out_dir.glob("soulledger_2*.sql.gz"))
    posted = _log(bin_dir, "curl")
    assert "https://hooks.example/ops" in posted and "backup-db.sh FAILED (exit 1)" in posted
    assert "Alert sent" in out


def test_offsite_set_without_rclone_fails_instead_of_skipping(tmp_path):
    code, out, _, _ = _backup(tmp_path, rclone=False, BACKUP_OFFSITE_REMOTE="box:sl", ALLOW_PLAINTEXT_OFFSITE="1")
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

def _tar(path, files):
    src = path.parent / (path.name + ".src")
    src.mkdir()
    for name, text in files.items():
        (src / name).write_text(text)
    subprocess.run(["tar", "-czf", str(path), "-C", str(src), "."], check=True)


KEY = "ed25519 a_AbCd 0123456789abcdef\n"


def _drill(tmp_path, *, live_migrations="auth.0001\nsouls.0001", restore_rc=0, backups=True, media=True,
           synapse=False, synapse_data=True, live_key=None, encrypted=False, **env):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "age", AGE)
    _fake(bin_dir, "pg_restore", "exit 0")
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
case "$db" in synapse_drill_*) echo "2 users, 10 events, 1 rooms"; exit 0;; esac
case "$sql" in *pg_tables*) cat {data}/$kind.tables;; *django_migrations*) cat {data}/$kind.migrations;;
  *) cat >/dev/null; cat {data}/$kind.counts;; esac''')
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    if backups:
        for name in ("soulledger_20261001_020000.sql.gz", "soulledger_20261002_020000.sql.gz"):
            subprocess.run(f"echo dump | gzip > {backup_dir / name}", shell=True, check=True)
    if media:
        _tar(backup_dir / "soulledger_media_20261002_020000.tar.gz", {"a.png": "x", "b.png": "y"})
    if synapse:
        (backup_dir / "soulledger_synapse_20261002_020000.dump").write_text("custom-format dump")
        if synapse_data:
            _tar(backup_dir / "soulledger_synapse_data_20261002_020000.tar.gz",
                 {"homeserver.yaml": "server_name: x\n", "x.signing.key": KEY})
    if live_key is not None:
        live = tmp_path / "live_synapse"
        live.mkdir()
        (live / "homeserver.yaml").write_text("server_name: x\n")
        (live / "x.signing.key").write_text(live_key)
        env["SYNAPSE_DATA_DIR"] = str(live)
    if encrypted:
        for f in list(backup_dir.iterdir()):
            if f.is_file():
                (f.parent / (f.name + ".age")).write_bytes(b"AGEFAKE:" + f.read_bytes())
                f.unlink()
    p = subprocess.run(["bash", str(DRILL), str(backup_dir)], cwd=tmp_path,
                       env=_env(bin_dir, PGDATABASE="soulledger", **env), capture_output=True, text=True)
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
    for script in (BACKUP, DRILL, SCRIPTS / "nginx-entrypoint.sh"):
        assert os.access(script, os.X_OK), script


# -- review 2026-10-31 B14: alerts that reach nobody are loud and non-zero ----------

def test_ops_alert_without_a_webhook_is_loud_and_returns_nonzero(tmp_path):
    p = subprocess.run(["sh", "-c", f'. "{SCRIPTS / "ops-alert.sh"}"; ops_alert "disk on fire"; echo "rc=$?"'],
                       env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
    assert "rc=1" in p.stdout
    assert "ALERT NOT DELIVERED (OPS_ALERT_WEBHOOK_URL not set; nobody was notified)" in p.stderr
    assert "disk on fire" in p.stderr and "#####" in p.stderr


def test_ops_alert_that_was_delivered_returns_zero_and_is_quiet(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "curl", "exit 0")
    p = subprocess.run(["sh", "-c", f'. "{SCRIPTS / "ops-alert.sh"}"; ops_alert "x"; echo "rc=$?"'],
                       env={"PATH": f"{bin_dir}:/usr/bin:/bin", "OPS_ALERT_WEBHOOK_URL": "https://hooks.example/o"},
                       capture_output=True, text=True)
    assert "rc=0" in p.stdout and "Alert sent" in p.stderr
    assert "NOT DELIVERED" not in p.stderr


def test_strict_backup_without_webhook_writes_the_dump_but_exits_3_and_is_not_ok(tmp_path):
    code, out, _, out_dir = _backup(tmp_path, BACKUP_STRICT="1", ALLOW_NO_OFFSITE="1")
    assert code == 3, out
    assert list(out_dir.glob("soulledger_2*.sql.gz"))
    assert "OPS_ALERT_WEBHOOK_URL is not set" in out and "ALERT NOT DELIVERED" in out
    assert "backup-db.sh incomplete (exit 3)" in out
    assert not (out_dir / ".backup-ok").exists()
    assert "Done." not in out


def test_strict_backup_without_offsite_exits_3_unless_waived(tmp_path):
    code, out, _, out_dir = _backup(tmp_path, BACKUP_STRICT="1", OPS_ALERT_WEBHOOK_URL="https://hooks.example/o")
    assert code == 3, out
    assert "BACKUP_OFFSITE_REMOTE is not set" in out
    code, out, _, out_dir = _backup(tmp_path, BACKUP_STRICT="1", OPS_ALERT_WEBHOOK_URL="https://hooks.example/o",
                                    ALLOW_NO_OFFSITE="1")
    assert code == 0, out
    assert (out_dir / ".backup-ok").exists()
    assert "WARNING" not in out


def test_strict_waivers_both_given_exit_0_and_a_dev_run_needs_none(tmp_path):
    code, out, _, out_dir = _backup(tmp_path, BACKUP_STRICT="1", ALLOW_NO_ALERTS="1", ALLOW_NO_OFFSITE="1")
    assert code == 0, out
    assert (out_dir / ".backup-ok").exists()
    code, out, _, _ = _backup(tmp_path)  # no BACKUP_STRICT: a manual / dev run
    assert code == 0, out
    assert "WARNING" not in out and "ALERT" not in out


# -- B16: age encryption; plaintext never goes off-site by default -----------------

def test_offsite_without_encryption_is_refused_with_exit_3_and_rclone_untouched(tmp_path):
    code, out, bin_dir, out_dir = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl")
    assert code == 3, out
    assert "off-site copy REFUSED: backups are not encrypted" in out
    assert _log(bin_dir, "rclone") == ""
    assert list(out_dir.glob("soulledger_2*.sql.gz"))


def test_with_a_recipient_every_file_gets_an_age_twin_and_only_those_go_offsite(tmp_path):
    media = tmp_path / "media"
    media.mkdir()
    (media / "a.png").write_text("x")
    code, out, bin_dir, out_dir = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl", OFFSITE_RETENTION_DAYS="0",
                                          BACKUP_AGE_RECIPIENT="age1" + "q" * 58, MEDIA_DIR=str(media))
    assert code == 0, out
    plain = sorted(f.name for f in out_dir.glob("soulledger_*") if not f.name.endswith(".age"))
    enc = sorted(f.name[:-4] for f in out_dir.glob("soulledger_*.age"))
    assert len(plain) == 2 and plain == enc
    assert all(f.read_bytes().startswith(b"AGEFAKE:") for f in out_dir.glob("*.age"))
    assert not list(out_dir.glob("*.partial"))
    assert _log(bin_dir, "rclone").splitlines() == [f"copy --include soulledger_*.age {out_dir} box:sl"]
    assert "UNENCRYPTED" not in out


def test_plaintext_offsite_only_with_its_waiver_and_says_so(tmp_path):
    code, out, bin_dir, _ = _backup(tmp_path, BACKUP_OFFSITE_REMOTE="box:sl", OFFSITE_RETENTION_DAYS="0",
                                    ALLOW_PLAINTEXT_OFFSITE="1")
    assert code == 0, out
    assert "copying UNENCRYPTED backups off-site" in out
    assert _log(bin_dir, "rclone").startswith("copy --include soulledger_* --exclude *.partial")


def test_a_recipient_without_age_installed_fails(tmp_path):
    code, out, _, out_dir = _backup(tmp_path, age=False, BACKUP_AGE_RECIPIENT="age1" + "q" * 58)
    assert code == 1, out
    assert "age is not installed" in out
    assert not list(out_dir.glob("*.age")) and not (out_dir / ".backup-ok").exists()


# -- B17: the drill restores media and chat too, and decrypts -------------------------

def test_drill_extracts_media_and_restores_synapse_into_scratch(tmp_path):
    code, out, bin_dir = _drill(tmp_path, synapse=True, live_key=KEY)
    assert code == 0, out
    assert "Media: " in out and "2 files" in out
    created = _log(bin_dir, "createdb").splitlines()
    assert created[1].startswith("-T template0 -E UTF8 --lc-collate=C --lc-ctype=C synapse_drill_")
    restored = _log(bin_dir, "pg_restore")
    assert "-d synapse_drill_" in restored and "--exit-on-error" in restored
    assert "2 users, 10 events, 1 rooms" in out
    assert "x.signing.key present, identical to the live one" in out
    dropped = _log(bin_dir, "dropdb").split()
    assert any(d.startswith("soulledger_drill_") for d in dropped)
    assert any(d.startswith("synapse_drill_") for d in dropped)
    assert "Restore drill passed." in out


def test_drill_fails_when_the_backed_up_signing_key_differs_from_the_live_one(tmp_path):
    code, out, bin_dir = _drill(tmp_path, synapse=True, live_key="ed25519 a_AbCd OTHER\n")
    assert code == 1, out
    assert "signing key differs" in out and "Restore drill passed." not in out
    assert "synapse_drill_" in _log(bin_dir, "dropdb")


def test_drill_fails_without_a_media_backup(tmp_path):
    code, out, _ = _drill(tmp_path, media=False)
    assert code == 1, out
    assert "no soulledger_media_" in out and "Restore drill passed." not in out


def test_drill_fails_when_chat_is_live_but_its_data_backup_is_missing(tmp_path):
    code, out, bin_dir = _drill(tmp_path, synapse=True, synapse_data=False)
    assert code == 1, out
    assert "chat is in use but its backup is incomplete" in out
    assert _log(bin_dir, "pg_restore") == ""


def test_drill_without_chat_says_it_skipped_chat(tmp_path):
    code, out, bin_dir = _drill(tmp_path)
    assert code == 0, out
    assert "Chat: no Synapse backup" in out and _log(bin_dir, "pg_restore") == ""


def test_drill_with_an_identity_restores_the_encrypted_copies(tmp_path):
    ident = tmp_path / "key.txt"
    ident.write_text("AGE-SECRET-KEY-1FAKE\n")
    code, out, bin_dir = _drill(tmp_path, synapse=True, encrypted=True, BACKUP_AGE_IDENTITY=str(ident))
    assert code == 0, out
    assert "soulledger_20261002_020000.sql.gz.age ->" in out
    decrypted = [c for c in _log(bin_dir, "age").splitlines() if c.startswith("-d")]
    assert len(decrypted) == 4  # db, media, synapse db, synapse data
    assert "Restore drill passed." in out


def test_drill_with_the_wrong_identity_fails_loudly(tmp_path):
    code, out, _ = _drill(tmp_path, encrypted=True, BACKUP_AGE_IDENTITY=str(tmp_path / "missing-key"))
    assert code == 1, out
    assert "cannot decrypt" in out and "Restore drill passed." not in out


def test_drill_standalone_skips_the_live_comparison(tmp_path):
    code, out, _ = _drill(tmp_path, live_migrations="auth.0001\nsouls.0001\nsouls.0002", DRILL_STANDALONE="1")
    assert code == 0, out
    assert "no live comparison" in out and "needs migrate" not in out
    assert "souls_soul 7" in out
