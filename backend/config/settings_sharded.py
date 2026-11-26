"""Test settings for the `sharded` group (stage 2, the sharding plan (not in this repo)): the normal
settings plus all four civilization shards, `civ_chinese` / `civ_european` / `civ_egyptian` / `civ_greek`,
behind the production `config.sharding.ShardRouter`. Select with `--ds=config.settings_sharded -m sharded`;
under any other settings a `sharded` test skips (root conftest.py).

PostgreSQL: each shard is a copy of `default` on the shard engine, NAME `<default NAME>_<alias>`; its TEST
NAME is left to the root conftest, which appends the per-run suffix (config/testdb.py) and, under xdist,
clones it from a per-alias template like every other PostgreSQL alias.
SQLite: each shard is its own in-memory database on the plain SQLite engine, migrated once into the cached
template (config/sqlite_template.py) like `default`, not four times per run into files. No shard engine is
needed there: SQLite rebuilds a table on every AlterField from the current model, so 1B's bare keys come out
bare (tests/test_control_boundary.py holds it: no foreign key to a missing table).
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
        _shard["NAME"] = ":memory:"
    DATABASES[_alias] = _shard

#: config/settings.py derives SHARDED from the aliases it saw (none here). Kept False on purpose: each test builds its
#: world in the one-database form and switches to the sharded one with `cut()` (tests/test_sharded_writes.py), and the
#: equivalence tests (tests/test_sharded_*_equal_single_db.py) ask the same question in both forms.
SHARDED = False
