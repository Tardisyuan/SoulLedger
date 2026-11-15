"""Test settings for the `sharded` group (stage 2, docs/audit/2026-11-15-sharding/PLAN.md): the normal
settings plus all four civilization shards, `civ_chinese` / `civ_european` / `civ_egyptian` / `civ_greek`,
behind the production `config.sharding.ShardRouter`. Select with `--ds=config.settings_sharded -m sharded`;
under any other settings a `sharded` test skips (root conftest.py).

PostgreSQL: each shard is a copy of `default` on the shard engine, NAME `<default NAME>_<alias>`; its TEST
NAME is left to the root conftest, which appends the per-run suffix (config/testdb.py) and, under xdist,
clones it from a per-alias template like every other PostgreSQL alias.
SQLite: each shard is its own in-memory database on the SQLite shard engine, so it is migrated once into
the cached template (config/sqlite_template.py) like `default`, not four times per run into files.
"""
import copy

from .settings import *  # noqa: F401,F403
from .settings import DATABASES

#: The aliases are spelled here (apps are not loaded yet); the root conftest refuses a run in which
#: some but not all of `apps.core.sharding.civilization_aliases()` are configured.
SHARD_ALIASES = ("civ_chinese", "civ_european", "civ_egyptian", "civ_greek")

for _alias in SHARD_ALIASES:
    _shard = copy.deepcopy(DATABASES["default"])
    _shard.get("TEST", {}).pop("NAME", None)  # never default's test database
    if "postgresql" in _shard["ENGINE"]:
        _shard["ENGINE"] = "config.shard_db.postgresql"
        _shard["NAME"] = f"{_shard['NAME']}_{_alias}"
    else:
        _shard["ENGINE"] = "config.shard_db.sqlite3"
        _shard["NAME"] = ":memory:"
    DATABASES[_alias] = _shard
