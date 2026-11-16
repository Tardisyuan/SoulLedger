"""Ops for several databases (sharding review 2026-11-16, 2.7 / 3.6): readiness asks every configured alias, and every
PostgreSQL alias carries a statement timeout."""
import copy

import pytest
from django.db import connections

from apps.core import health

READY = "/health/ready/"


@pytest.fixture
def fresh_ready():
    health._ready_last[:] = [float("-inf"), True]
    yield
    health._ready_last[:] = [float("-inf"), True]


@pytest.fixture
def an_alias_that_is_down():
    """One more configured database that refuses connections: a copy of `default` pointed nowhere."""
    down = copy.deepcopy(connections.settings["default"])
    if "sqlite" in down["ENGINE"]:
        down["NAME"] = "/nonexistent-dir-for-this-test/shard.sqlite3"
    else:
        down.update(HOST="127.0.0.1", PORT="1")
    connections.settings["civ_down"] = down
    yield
    try:
        connections["civ_down"].close()
        del connections["civ_down"]
    except Exception:  # noqa: BLE001 -- never opened
        pass
    del connections.settings["civ_down"]


@pytest.mark.django_db
def test_ready_is_ok_with_every_database_up(client, fresh_ready):
    assert client.get(READY).status_code == 200


@pytest.mark.django_db
def test_ready_is_503_when_one_configured_database_is_down(client, fresh_ready, an_alias_that_is_down):
    response = client.get(READY)
    assert response.status_code == 503, response.content
    assert response.json() == {"status": "degraded"}


def test_every_postgresql_alias_gets_the_statement_timeout():
    from config.settings import _apply_statement_timeout

    dbs = {"default": {"ENGINE": "django.db.backends.postgresql"},
           "civ_greek": {"ENGINE": "config.shard_db.postgresql", "OPTIONS": {"options": "-c search_path=public"}},
           "other": {"ENGINE": "django.db.backends.sqlite3"}}
    _apply_statement_timeout(dbs, 30000)
    assert dbs["default"]["OPTIONS"]["options"] == "-c statement_timeout=30000"
    assert dbs["civ_greek"]["OPTIONS"]["options"] == "-c search_path=public -c statement_timeout=30000"
    assert "OPTIONS" not in dbs["other"]
    untouched = {"default": {"ENGINE": "django.db.backends.postgresql"}}
    _apply_statement_timeout(untouched, 0)
    assert untouched == {"default": {"ENGINE": "django.db.backends.postgresql"}}


def test_the_configured_postgresql_aliases_carry_it():
    from django.conf import settings

    pg = {a: db for a, db in settings.DATABASES.items() if "postgresql" in db["ENGINE"]}
    if not pg or not settings.DB_STATEMENT_TIMEOUT_MS:
        pytest.skip("no PostgreSQL alias in this run, or the timeout is switched off")
    for alias, db in pg.items():
        assert f"statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS}" in db.get("OPTIONS", {}).get("options", ""), alias
