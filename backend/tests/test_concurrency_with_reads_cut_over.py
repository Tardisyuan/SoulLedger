"""Stage 3: the row-lock races of tests/test_concurrency.py again, with every civilization's reads cut over to
its shard (docs/audit/2026-11-15-sharding/PLAN.md 阶段 3, "并发锁测试每个分库各跑一次").

Nothing here is synced, so the shards hold none of the rows the races fight over: a read that leaves control
fails the scenario instead of quietly racing on a stale copy. Each thread runs as the write request it stands
for in production (a POST), which reads control (`apps.core.shard_reads.reads_control`); the locks themselves
are writes and were always on control. The classes are the originals, subclassed, so a race added there runs
here too; the PostgreSQL-only markers come with them (`test_the_postgres_only_set_is_the_set_we_think_it_is`
counts the originals, not these).

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_concurrency_with_reads_cut_over.py
"""
import pytest
from django.test import RequestFactory, override_settings

from apps.core.request_local import set_current_request
from apps.core.shard_reads import CONTROL_ALIAS, read_context
from tests import test_concurrency as races
from tests.test_concurrency import (  # noqa: F401 -- the fixtures the inherited tests ask for
    cn_admin,
    cn_soul,
    cn_tenant,
    eu_admin,
    eu_tenant,
)
from tests.test_shard_sync import CIVS, HAS_SHARDS

pytestmark = [pytest.mark.sharded, pytest.mark.django_db(databases="__all__"),
              pytest.mark.skipif(not HAS_SHARDS, reason="needs --ds=config.settings_sharded")]


@pytest.fixture(autouse=True)
def _cut_over_and_post(monkeypatch):
    original = races._Thread.run

    def run(self):
        set_current_request(RequestFactory().post("/"))  # this thread's context only
        original(self)

    monkeypatch.setattr(races._Thread, "run", run)
    # The test's own setup and assertions read control (the master in stage 3), outside any request.
    with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(CONTROL_ALIAS):
        yield


def _cut_over(cls):
    return type(cls.__name__, (cls,), {"__doc__": f"{cls.__doc__}\n\n(every civilization's reads cut over)"})


_PG_ONLY = [c for c in vars(races).values() if isinstance(c, type) and c.__name__.startswith("Test")]
for _cls in _PG_ONLY:
    globals()[_cls.__name__] = _cut_over(_cls)
