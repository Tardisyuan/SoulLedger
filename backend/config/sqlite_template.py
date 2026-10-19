"""Reuse one migrated SQLite database across test runs. Used only by the root conftest.py.

On SQLite (`DATABASE_URL=sqlite:///:memory:`) every xdist worker used to replay
all ~389 migrations into its own in-memory database (~36 s per worker). Now the
first process to need it migrates once, copies the result to a file (the
*template*), and every later process -- this run's other workers, and later
runs on the same inputs -- loads that file into its own `:memory:` database with
sqlite3's `backup` API. That is how Django itself hands an in-memory database to
a spawned parallel worker (`django/db/backends/sqlite3/creation.py`,
`setup_worker_connection`): open the shared-cache memory URI, `backup` into it,
keep that handle open until Django's own connection exists. Tests keep running
on `:memory:`; only the setup changes.

Where: `<git common dir>/soulledger-sqlite-templates/`, shared by every worktree.
Name: `<alias>-<input hash>.sqlite3`. Newest three kept, older ones deleted.
Built under `fcntl.flock`, written to a temp file, `os.replace`d into place.

THE INPUT HASH (`input_hash`) is the whole risk: a template that outlives a
change to what migrating produces hands every test stale seed rows. So it is
deliberately wider than "the migrations":

* every non-test file under `backend/apps/` -- which includes all
  `apps/*/migrations/**`. Migrations import live code: field classes
  (`apps.death_sync.fields`, `encrypted_json`), `upload_to` callables
  (`apps.chat.models`, `apps.social.models`, `apps.judgment.models`),
  `apps.judgment.snapshot`, `apps.soul_assist.config/platforms`,
  `apps.perm.cache`; their transitive import closure was 127 of the 428
  non-test modules under apps/ on 2026-10-19. And code runs during migrate that
  no migration imports: `pre_migrate`/`post_migrate` receivers
  (`apps/audit/signals.py`), and any model-signal receiver connected without a
  sender, which also fires for the historical models RunPython uses. Rather
  than maintain a list of those, hash all of apps/. The price is a rebuild
  (one migrate, ~36 s) after any backend app change; a frontend-only or
  test-only change reuses the template.
  How the "files a migration reads" list was searched (2026-10-19):
      grep -rnE "open\\(|Path\\(|read_text|json\\.load|yaml|csv\\.|__file__|os\\.environ|getenv|settings\\.[A-Z_]+" apps/*/migrations/
      grep -rnE "^\\s*(from|import) (apps|config)\\b|import_module|call_command" apps/*/migrations/
  No migration opens a file: the corpora of judgment/0013 and 0015 are inline
  constants, and menus/0021 names `scripts/backups/pre_migrate_*.json` only in
  its docstring. The only setting read is `ASSISTANT_PROVIDER/BASE_URL`
  (soul_assist/0009), and only for rows that already exist -- none on a fresh
  test database. A migration that starts reading a file outside apps/ must add
  it to `EXTRA_FILES` below.
* every file under `backend/config/` (all settings modules, this file),
  and `backend/requirements.lock` (Django, contrib apps, third-party fields
  such as pgvector).
* the resolved settings that decide what migrate does (INSTALLED_APPS,
  MIGRATION_MODULES, AUTH_USER_MODEL, DATABASE_ROUTERS, the alias's ENGINE and
  TEST.MIGRATE), DJANGO_SETTINGS_MODULE, the alias, and the Python, Django and
  SQLite library versions.

Test files (`test_*.py`, `tests.py`, `conftest.py`, `tests/` directories) are
left out: migrate never imports them.

THE MONITOR: a run that migrates for real (`SOULLEDGER_SQLITE_TEMPLATE=0`,
`GATES_FULL=1`, or one that includes `migration` tests) compares what it just
migrated with the cached template of the same hash, if there is one
(`tables_that_differ`). Any difference means the hash missed an input: the
template is deleted and the run fails, naming the tables.

Off entirely (plain migrate, no check) for: non-SQLite or a file-based SQLite
test database, `--reuse-db`, `--nomigrations`, or no git common dir.
"""
import contextlib
import fcntl
import hashlib
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

ENV_VAR = "SOULLEDGER_SQLITE_TEMPLATE"
DIR_NAME = "soulledger-sqlite-templates"
KEEP = 3

#: Repo files outside apps/ and config/ that migrating reads (relative to backend/). None today.
EXTRA_FILES = ("requirements.lock",)


def _is_test_file(rel: Path) -> bool:
    name = rel.name
    return (
        name.startswith("test_") and name.endswith(".py")
        or name in ("tests.py", "conftest.py")
        or "tests" in rel.parts[:-1]
    )


def input_files(backend_dir: Path) -> list:
    """Every file the hash covers, as paths relative to backend_dir, sorted."""
    out = []
    for top in ("apps", "config"):
        for path in (backend_dir / top).rglob("*"):
            rel = path.relative_to(backend_dir)
            if path.is_file() and "__pycache__" not in rel.parts and path.suffix != ".pyc" and not _is_test_file(rel):
                out.append(rel)
    out += [Path(f) for f in EXTRA_FILES if (backend_dir / f).is_file()]
    return sorted(out)


def input_hash(backend_dir: Path, extra: dict) -> str:
    h = hashlib.sha256()
    for rel in input_files(backend_dir):
        h.update(rel.as_posix().encode() + b"\0")
        h.update(hashlib.sha256((backend_dir / rel).read_bytes()).digest())
    h.update(repr(sorted(extra.items())).encode())
    return h.hexdigest()[:20]


def settings_inputs(settings, alias: str) -> dict:
    import django

    db = settings.DATABASES[alias]
    return {
        "alias": alias,
        "settings_module": os.environ.get("DJANGO_SETTINGS_MODULE", ""),
        "installed_apps": list(settings.INSTALLED_APPS),
        "migration_modules": sorted((getattr(settings, "MIGRATION_MODULES", {}) or {}).items()),
        "auth_user_model": settings.AUTH_USER_MODEL,
        "routers": [str(r) for r in settings.DATABASE_ROUTERS],
        "engine": db.get("ENGINE"),
        "test_migrate": (db.get("TEST") or {}).get("MIGRATE", True),
        "python": sys.version,
        "django": django.__version__,
        "sqlite": sqlite3.sqlite_version,
    }


def mode(env, *, reuse_db: bool, nomigrations: bool, has_migration_tests: bool) -> str:
    """'off' (plain migrate), 'verify' (migrate, then check the template), or 'use'."""
    if reuse_db or nomigrations:
        return "off"
    if env.get(ENV_VAR) == "0" or env.get("GATES_FULL") == "1" or has_migration_tests:
        return "verify"
    return "use"


def template_dir(cwd: Path):
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"], cwd=cwd, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return (cwd / out).resolve() / DIR_NAME


# --- comparing two databases (the monitor) ----------------------------------

#: A datetime value. Two real migrates of the same tree differ ONLY in these
#: (measured 2026-10-19: `manage.py migrate` twice into two files; the six
#: differing tables were django_migrations.applied and the create/update times
#: of rows seeded by menus/perm/soul_assist data migrations). Masked, so the
#: check compares row counts and every other value.
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)?$")


def _row_key(row) -> str:
    return repr(tuple("<datetime>" if isinstance(v, str) and _DATETIME.match(v) else v for v in row))


def _table_digests(conn) -> dict:
    """{name: digest} for every schema object and every table's rows (incl. sqlite_sequence)."""
    out = {}
    objs = conn.execute("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").fetchall()
    for kind, name, _tbl, sql in objs:
        out[f"schema:{kind}:{name}"] = hashlib.sha256(repr(sql).encode()).hexdigest()
    tables = [name for kind, name, _t, _s in objs if kind == "table"]
    for table in tables:
        rows = conn.execute(f'SELECT * FROM "{table}"').fetchall()
        # Sort by value, not rowid: same rows inserted in another order are the same table.
        h = hashlib.sha256()
        for r in sorted(_row_key(r) for r in rows):
            h.update(r.encode() + b"\0")
        out[f"rows:{table}"] = h.hexdigest()
    return out


def tables_that_differ(a, b) -> list:
    """Sorted table/object names whose schema or rows differ between two sqlite3 connections."""
    da, db_ = _table_digests(a), _table_digests(b)
    keys = set(da) | set(db_)
    return sorted({k.split(":")[-1] for k in keys if da.get(k) != db_.get(k)})


# --- wiring -------------------------------------------------------------------

@contextlib.contextmanager
def _locked(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory / ".lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _save(raw_conn, path: Path) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    dst = sqlite3.connect(tmp)
    try:
        raw_conn.backup(dst)
    finally:
        dst.close()
    os.replace(tmp, path)
    olds = sorted(path.parent.glob("*.sqlite3"), key=lambda p: p.stat().st_mtime, reverse=True)[KEEP:]
    for old in olds:
        with contextlib.suppress(FileNotFoundError):
            old.unlink()


class TemplateDriftError(RuntimeError):
    pass


def install(*, run_mode: str, directory: Path, backend_dir: Path):
    """Patch SQLite's create_test_db for this process. Returns an undo callable."""
    from django.conf import settings
    from django.core.management import call_command
    from django.db.backends.sqlite3.creation import DatabaseCreation

    original = DatabaseCreation.create_test_db

    def create_test_db(self, verbosity=1, autoclobber=False, serialize=True, keepdb=False):
        name = self._get_test_db_name()
        if keepdb or not self.is_in_memory_db(name):
            return original(self, verbosity, autoclobber, serialize, keepdb)
        alias = self.connection.alias
        path = directory / f"{alias}-{input_hash(backend_dir, settings_inputs(settings, alias))}.sqlite3"

        if run_mode == "verify":
            result = original(self, verbosity, autoclobber, serialize, keepdb)
            if path.exists():
                # Compare through a plain copy: Django's own sqlite3 connection parses
                # declared types (datetime objects), the template's returns text.
                fresh, tpl = sqlite3.connect(":memory:"), sqlite3.connect(f"file:{path}?mode=ro", uri=True)
                try:
                    self.connection.connection.backup(fresh)
                    diff = tables_that_differ(fresh, tpl)
                finally:
                    fresh.close()
                    tpl.close()
                if diff:
                    path.unlink(missing_ok=True)
                    raise TemplateDriftError(
                        f"SQLite test template {path.name}: same input hash, but a real migrate produced "
                        f"different contents -> the hash in config/sqlite_template.py is missing an input. "
                        f"Template deleted. Differing tables/objects: {', '.join(diff)}"
                    )
                print(f"\nSQLite test template {path.name} verified against a real migrate.", file=sys.stderr)
            return result

        def clone():
            self.connection.close()
            settings.DATABASES[alias]["NAME"] = name
            self.connection.settings_dict["NAME"] = name
            src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            keep = sqlite3.connect(name, uri=True)
            try:
                src.backup(keep)
                src.close()
                self.connection.ensure_connection()
            finally:
                keep.close()
            # Guard against Django still holding a connection to some other database.
            with self.connection.cursor() as c:
                c.execute("SELECT count(*) FROM django_migrations")
                if not c.fetchone()[0]:
                    raise RuntimeError(f"SQLite template clone of {path} is empty on alias {alias!r}")
            with contextlib.suppress(OSError):
                os.utime(path)  # pruning keeps the most recently used
            if serialize:
                self.connection._test_serialized_contents = self.serialize_db_to_string()
            call_command("createcachetable", database=alias)
            return name

        if path.exists():
            with contextlib.suppress(sqlite3.OperationalError):  # pruned under us: build below
                return clone()
        with _locked(directory):
            if path.exists():
                return clone()
            result = original(self, verbosity, autoclobber, serialize, keepdb)
            _save(self.connection.connection, path)
            return result

    DatabaseCreation.create_test_db = create_test_db
    return lambda: setattr(DatabaseCreation, "create_test_db", original)
