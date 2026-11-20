"""An empty database migrates with every civilization's reads and writes cut over (the test box's settings).

Until 2026-11-21 it did not: `shard_reads` patches QuerySet for every model, a migration's historical ones
included, and disposition/0009's `.update()` on control went through `_refuse_on_control` -> `_halls`, which
queries the *current* Tenant for `declared_civilization` -- a column the half-migrated database did not have
yet. So a sharded deployment could only be built by migrating with the switches empty first
(docs/audit/sharded-only-analysis-2026-11-21.md, conclusion 3). `apps/core/shard_reads.py` `_hook` now hands
a historical model Django's own method.

A fresh process: the settings (four shard aliases, both switches) are fixed at startup.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
ALL_CIVS = "CHINESE,EUROPEAN,EGYPTIAN,GREEK"


@pytest.mark.migration
def test_an_empty_database_migrates_with_every_civilization_cut_over(tmp_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_SETTINGS_MODULE", "SHARD_"))}
    env.update(SECRET_KEY="ci-test-key-not-for-production-32-bytes-min", DEBUG="true",
               DJANGO_SETTINGS_MODULE="config.settings_sharded", DATABASE_URL=f"sqlite:///{tmp_path / 'c.db'}",
               SHARD_READ_CIVS=ALL_CIVS, SHARD_WRITE_CIVS=ALL_CIVS)
    code = ("import django; django.setup(); from django.conf import settings; "
            "from django.core.management import call_command; "
            "assert len(settings.SHARD_WRITE_CIVS) == 4, settings.SHARD_WRITE_CIVS; "
            "call_command('migrate', interactive=False, verbosity=0); "
            "call_command('migrate_shards', verbosity=0); print('MIGRATED')")
    proc = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=900)
    assert proc.returncode == 0 and "MIGRATED" in proc.stdout, proc.stderr[-4000:]
