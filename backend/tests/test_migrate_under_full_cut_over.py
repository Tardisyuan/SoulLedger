"""An empty database migrates sharded (every civilization's reads and writes on its shard: the test box's form).

Until 2026-11-21 it did not: `shard_reads` patches QuerySet for every model, a migration's historical ones
included, and disposition/0009's `.update()` on control went through `_refuse_on_control` -> `_halls`, which
queries the *current* Tenant for `declared_civilization` -- a column the half-migrated database did not have
yet. So a sharded deployment could only be built by migrating with the (since retired) switches empty first
(the sharded-only analysis of 2026-11-21 (not in this repo), conclusion 3). `apps/core/shard_reads.py` `_hook` now hands
a historical model Django's own method.

A fresh process with the four shard aliases (config/settings_sharded.py, SQLite files here), migrated sharded. The
test group's settings leave SHARDED False so its tests can build a world first; SQLite shards cannot come from
SHARD_DATABASE_URL_<CIV> (PostgreSQL only), so the switch is turned on around the migration as `cut()` does.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


@pytest.mark.migration
def test_an_empty_database_migrates_with_every_civilization_cut_over(tmp_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_SETTINGS_MODULE", "SHARD_"))}
    env.update(SECRET_KEY="ci-test-key-not-for-production-32-bytes-min", DEBUG="true",
               DJANGO_SETTINGS_MODULE="config.settings_sharded", DATABASE_URL=f"sqlite:///{tmp_path / 'c.db'}")
    code = ("import django; django.setup(); from django.conf import settings; "
            "from django.core.management import call_command; from django.test import override_settings; "
            "from apps.core.sharding import cut_civilizations\n"
            "with override_settings(SHARDED=True):\n"
            "    assert len(cut_civilizations()) == 4, cut_civilizations()\n"
            "    call_command('migrate', interactive=False, verbosity=0)\n"
            "    call_command('migrate_shards', verbosity=0)\n"
            "print('MIGRATED')")
    proc = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=900)
    assert proc.returncode == 0 and "MIGRATED" in proc.stdout, proc.stderr[-4000:]
