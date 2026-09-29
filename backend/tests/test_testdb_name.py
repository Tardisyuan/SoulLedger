"""The per-run PostgreSQL test database name (config/testdb.py). No DB server needed."""
import pytest
from pytest_django.fixtures import _set_suffix_to_test_databases

from config.testdb import ENV_VAR, run_suffix, suffix_postgres_test_databases

PG = "django.db.backends.postgresql"


def pg():
    return {"default": {"ENGINE": PG, "NAME": "soulledger"}}


def test_postgres_name_is_suffixed(monkeypatch):
    monkeypatch.delenv(ENV_VAR, raising=False)
    dbs = pg()
    suffix_postgres_test_databases(dbs, run_suffix())
    name = dbs["default"]["TEST"]["NAME"]
    assert name.startswith("test_soulledger_")
    assert name != "test_soulledger"


def test_two_runs_get_different_names(monkeypatch):
    monkeypatch.delenv(ENV_VAR, raising=False)
    a, b = pg(), pg()
    suffix_postgres_test_databases(a, run_suffix())
    suffix_postgres_test_databases(b, run_suffix())
    assert a["default"]["TEST"]["NAME"] != b["default"]["TEST"]["NAME"]


def test_env_override_wins(monkeypatch):
    monkeypatch.setenv(ENV_VAR, "ci_42")
    dbs = pg()
    suffix_postgres_test_databases(dbs, run_suffix())
    assert dbs["default"]["TEST"]["NAME"] == "test_soulledger_ci_42"


@pytest.mark.parametrize("bad", ["x; DROP DATABASE y", "UPPER", "a-b", "a" * 21])
def test_env_override_must_be_a_plain_identifier(monkeypatch, bad):
    monkeypatch.setenv(ENV_VAR, bad)
    with pytest.raises(ValueError):
        run_suffix()


def test_composes_after_the_real_xdist_suffix(monkeypatch):
    """pytest-django's own xdist step runs first (our fixture requests it)."""
    from django.conf import settings

    dbs = pg()
    monkeypatch.setattr(settings, "DATABASES", dbs)
    _set_suffix_to_test_databases("gw3")
    suffix_postgres_test_databases(dbs, "abc")
    assert dbs["default"]["TEST"]["NAME"] == "test_soulledger_gw3_abc"


def test_explicit_test_name_is_kept_as_the_base():
    dbs = pg()
    dbs["default"]["TEST"] = {"NAME": "custom"}
    suffix_postgres_test_databases(dbs, "abc")
    assert dbs["default"]["TEST"]["NAME"] == "custom_abc"


@pytest.mark.parametrize("test", [None, {}, {"NAME": ":memory:"}])
def test_sqlite_is_untouched(test):
    db = {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
    if test is not None:
        db["TEST"] = test
    dbs = {"default": db}
    before = repr(dbs)
    suffix_postgres_test_databases(dbs, "abc")
    assert repr(dbs) == before


def test_root_conftest_applies_it_to_a_real_session(tmp_path):
    """The wiring, not just the function: a child pytest with a PostgreSQL URL
    (nothing listens on port 1; the name is computed before any connection)
    loads the root conftest and must see the suffixed name on the connection.
    Without this, deleting the conftest fixture leaves every test above green.
    """
    import os
    import shutil
    import subprocess
    import sys
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    # A copy beside the probe is loaded as a real conftest; `-p conftest` is
    # not -- as a plugin it loses the override to pytest-django's fixture.
    shutil.copy(repo / "conftest.py", tmp_path / "conftest.py")
    probe = tmp_path / "test_probe.py"
    probe.write_text(
        "def test_probe(django_db_modify_db_settings):\n"
        "    from django.db import connections\n"
        "    print('NAME=' + connections['default'].settings_dict['TEST']['NAME'])\n"
    )
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", str(probe), "-c", str(repo / "pytest.ini"),
         "-q", "-s", "--no-cov", "-p", "no:cacheprovider"],
        cwd=repo,
        env={
            **os.environ,
            "PYTHONPATH": str(repo / "backend"),
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "DATABASE_URL": "postgres://u:p@127.0.0.1:1/soulledger",
            ENV_VAR: "wired",
        },
        capture_output=True, text=True, timeout=120,
    )
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out
    assert "NAME=test_soulledger_wired\n" in out, out
