"""Opt-in settings for the `multidb` test group: the normal settings plus a second
alias and `config.multidb.ShadowTenantRouter`. Select with `--ds=config.settings_multidb`;
without it the alias does not exist and the group skips. One database stays the
production shape -- see docs/ARCHITECTURE-tenant-sharding.md 4.1 (G3).
"""
import copy
import tempfile
from pathlib import Path

from .multidb import SHADOW_ALIAS
from .settings import *  # noqa: F401,F403
from .settings import DATABASES
from .testdb import run_suffix

_suffix = run_suffix()
_shadow = copy.deepcopy(DATABASES["default"])
if "sqlite" in _shadow["ENGINE"]:
    # A second file, not :memory:, so the shadow is something you can open and look at.
    _dir = Path(tempfile.gettempdir())
    _shadow["NAME"] = str(_dir / f"soulledger_tenant_shadow_{_suffix}.sqlite3")
    _shadow["TEST"] = {"NAME": str(_dir / f"soulledger_test_tenant_shadow_{_suffix}.sqlite3")}
else:
    # Own database name; the root conftest appends the per-run suffix to its TEST name
    # (config/testdb.py), as it does for `default`.
    _shadow["NAME"] = f"{_shadow['NAME']}_shadow"
DATABASES[SHADOW_ALIAS] = _shadow
DATABASE_ROUTERS = ["config.multidb.ShadowTenantRouter"]
