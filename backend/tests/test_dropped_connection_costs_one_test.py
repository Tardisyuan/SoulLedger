"""连接断了只赔一条测试(config/testdb.py 的 makereport 钩子、keepalive、收尾清会话)。

2026-10-19 真 PG `-n 4`:gw2 的连接断了一次,之后 gw2 上每条测试都是
`InterfaceError: connection already closed`,共 150 条。

子进程跑一个小套件，用一个「每个方法都抛 connection already closed」的假连接
顶替 Django 手里的连接 —— 这就是 psycopg2 在链路断掉之后的样子。跑两遍:

  - 带钩子:断的那条照样红，下一条能查询;普通断言失败不关连接。
  - 用 `-p no:config.testdb` 去掉钩子:下一条也红。这一遍证明探针真的复现了事故,
    否则「下一条是绿的」什么都说明不了。

子进程用**文件**型 SQLite:Django 对内存库的 close() 是空操作(关了库就没了),
那样关连接这一步在 SQLite 上根本发生不了;文件库和 PG 一样，关了能再连。
"""
import os
import subprocess
import sys
import textwrap
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from config import testdb

REPO_ROOT = Path(__file__).resolve().parents[2]

PROBE_CONFTEST = '''
from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def django_db_modify_db_settings():
    from django.conf import settings

    settings.DATABASES["default"]["TEST"]["NAME"] = str(Path(__file__).parent / "probe.sqlite3")
'''

# 普通 db 测试排在前面(pytest-django 也会把 transactional 的挪到最后)。
PROBE = '''
import pytest
from django.db import connection

_kept = {}


class Dead:
    """A psycopg2 connection after the link died: everything raises, close() does not."""

    def close(self):
        pass

    def __getattr__(self, name):
        raise connection.Database.InterfaceError("connection already closed")

    def __setattr__(self, name, value):
        raise connection.Database.InterfaceError("connection already closed")


@pytest.mark.django_db
def test_a_plain_assertion_fails():
    connection.ensure_connection()
    _kept["conn"] = connection.connection
    assert 1 == 2


@pytest.mark.django_db
def test_b_connection_survives_an_assertion_failure():
    assert connection.connection is _kept["conn"]


@pytest.mark.django_db(transaction=True)
def test_c_link_dies():
    connection.ensure_connection()
    _kept["real"] = connection.connection   # keep the file handle referenced; not needed after
    connection.connection = Dead()
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")


@pytest.mark.django_db(transaction=True)
def test_d_next_test_can_query():
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        assert cursor.fetchone() == (1,)
'''


def run_probe(tmp_path, *extra):
    probe_dir = tmp_path / "probe"
    probe_dir.mkdir(exist_ok=True)
    (probe_dir / "conftest.py").write_text(textwrap.dedent(PROBE_CONFTEST), encoding="utf-8")
    (probe_dir / "test_probe.py").write_text(textwrap.dedent(PROBE), encoding="utf-8")
    junit = tmp_path / f"probe{len(extra)}.xml"
    proc = subprocess.run(
        [
            sys.executable, "-m", "pytest", str(probe_dir / "test_probe.py"),
            "-c", str(REPO_ROOT / "pytest.ini"),
            "-q", "--no-cov", "-p", "no:cacheprovider", "-p", "no:xdist", "--nomigrations",
            f"--junitxml={junit}", *extra,
        ],
        cwd=REPO_ROOT,
        env={
            **os.environ,
            "PYTHONPATH": str(REPO_ROOT / "backend"),
            "DJANGO_SETTINGS_MODULE": "config.settings",
            # 与父进程跑在哪个库无关：子进程永远是自己的文件 SQLite。
            "DATABASE_URL": f"sqlite:///{tmp_path / 'probe_main.sqlite3'}",
        },
        capture_output=True,
        text=True,
        timeout=300,
    )
    out = proc.stdout + proc.stderr
    assert junit.exists(), f"the nested run wrote no report:\n{out}"
    results = {}
    for case in ET.parse(junit).getroot().iter("testcase"):
        bad = [el for el in case if el.tag in ("failure", "error")]
        results[case.get("name")] = ("failed" if bad else "passed", "\n".join((el.text or "") for el in bad))
    assert set(results) == {
        "test_a_plain_assertion_fails",
        "test_b_connection_survives_an_assertion_failure",
        "test_c_link_dies",
        "test_d_next_test_can_query",
    }, out
    return results, out


def test_a_dropped_connection_costs_one_test(tmp_path):
    results, out = run_probe(tmp_path)
    # 断的那条仍然红，而且红在连接上 —— 没有被吞，也没有被重试成绿。
    assert results["test_c_link_dies"][0] == "failed", out
    assert "connection already closed" in results["test_c_link_dies"][1], out
    # 下一条重新连上了。
    assert results["test_d_next_test_can_query"] == ("passed", ""), out
    # 普通断言失败不算连接错误：连接原样保留。
    assert results["test_a_plain_assertion_fails"][0] == "failed", out
    assert results["test_b_connection_survives_an_assertion_failure"] == ("passed", ""), out


def test_without_the_hook_every_later_test_fails(tmp_path):
    """对照：去掉钩子，下一条也红 —— 探针复现的正是那 150 条。"""
    results, out = run_probe(tmp_path, "-p", "no:config.testdb")
    assert results["test_c_link_dies"][0] == "failed", out
    assert results["test_d_next_test_can_query"][0] == "failed", out
    assert "connection already closed" in results["test_d_next_test_can_query"][1], out


# --- 判据 ------------------------------------------------------------------


@pytest.mark.parametrize(
    "exc",
    [
        "django.InterfaceError:connection already closed",
        "django.OperationalError:could not receive data from server: Operation timed out",
        "django.OperationalError:server closed the connection unexpectedly",
        "django.OperationalError:terminating connection due to administrator command",
        "psycopg2.InterfaceError:connection already closed",
        "psycopg2.OperationalError:could not receive data from server: Operation timed out",
    ],
)
def test_connection_level_errors_count(exc):
    import psycopg2
    from django import db

    module, _, message = exc.partition(":")
    kind, _, name = module.partition(".")
    cls = getattr(db if kind == "django" else psycopg2, name)
    assert testdb.is_connection_lost(cls(message))


def test_a_wrapped_connection_error_counts_through_its_cause():
    from django.db import OperationalError

    try:
        try:
            raise OperationalError("server closed the connection unexpectedly")
        except OperationalError as inner:
            raise RuntimeError("request failed") from inner
    except RuntimeError as outer:
        assert testdb.is_connection_lost(outer)


@pytest.mark.parametrize(
    "exc",
    [
        AssertionError("assert 1 == 2"),
        AssertionError("connection already closed"),   # 字样对，类型不对
        ValueError("could not receive data"),
    ],
)
def test_ordinary_failures_do_not_count(exc):
    assert not testdb.is_connection_lost(exc)


def test_other_database_errors_do_not_count():
    from django.db import IntegrityError, OperationalError

    assert not testdb.is_connection_lost(OperationalError("database is locked"))
    assert not testdb.is_connection_lost(IntegrityError("duplicate key value"))


# --- keepalive -------------------------------------------------------------


def _pg(**options):
    db = {"ENGINE": "django.db.backends.postgresql", "NAME": "soulledger"}
    if options:
        db["OPTIONS"] = options
    return db


def test_postgres_aliases_get_keepalives_and_sqlite_does_not():
    databases = {
        "default": _pg(),
        "other": _pg(connect_timeout=3),
        "local": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
    }
    testdb.add_keepalives(databases)
    assert databases["default"]["OPTIONS"] == {
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
        "connect_timeout": 10,
    }
    assert databases["other"]["OPTIONS"]["connect_timeout"] == 3   # 已有的设置优先
    assert databases["other"]["OPTIONS"]["keepalives"] == 1
    assert "OPTIONS" not in databases["local"]   # sqlite3.connect 不认这些参数


def test_the_plugin_puts_keepalives_on_the_settings(monkeypatch):
    from django.conf import settings

    databases = {"default": _pg()}
    monkeypatch.setattr(settings, "DATABASES", databases)
    testdb.pytest_configure(config=None)
    assert databases["default"]["OPTIONS"]["keepalives_idle"] == 30


def test_pytest_ini_loads_the_plugin():
    addopts = next(
        line for line in (REPO_ROOT / "pytest.ini").read_text(encoding="utf-8").splitlines()
        if line.startswith("addopts")
    )
    assert "-p config.testdb" in addopts


# --- 收尾清会话 ---------------------------------------------------------------


class _Cursor:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))


@pytest.mark.parametrize("name", ["test_soulledger_gw2_3f9a0c1e", "test_soulledger_3f9a0c1e"])
def test_terminates_sessions_on_a_test_database(name):
    cursor = _Cursor()
    testdb.terminate_other_sessions(cursor, name)
    [(sql, params)] = cursor.calls
    assert "pg_terminate_backend" in sql and "pg_backend_pid()" in sql
    assert params == [name]


@pytest.mark.parametrize(
    "name",
    ["soulledger", "test_soulledger", "test_other_gw2", "postgres", "test_soulledger_x; DROP", "", None],
)
def test_refuses_anything_but_a_test_soulledger_database(name):
    cursor = _Cursor()
    assert not testdb.is_disposable_test_db(name)
    with pytest.raises(ValueError):
        testdb.terminate_other_sessions(cursor, name)
    assert cursor.calls == []
