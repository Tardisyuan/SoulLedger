"""What the sharded tests share: the four civilizations, whether this run has their shard aliases, the
`sharded` mark and the `reconcile_shards` calls. Moved out of `tests/test_shard_sync.py` (2026-11-26), which
re-exports them: importing a test module from another one re-imports its tests and couples the two suites.
"""
import io

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.sharding import alias_for_civilization

CIVS = ("CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK")
HAS_SHARDS = all(alias_for_civilization(c) in settings.DATABASES for c in CIVS)


def sharded(test):
    for mark in (pytest.mark.django_db(databases="__all__"),
                 pytest.mark.skipif(not HAS_SHARDS, reason="needs the four civ_* aliases (--ds=config.settings_sharded)"),
                 pytest.mark.sharded):
        test = mark(test)
    return test


def _sync():
    out = io.StringIO()
    try:
        call_command("reconcile_shards", "--all", "--fix", stdout=out)
    except CommandError as e:
        raise AssertionError(f"{e}\n{out.getvalue()}") from None
    return out.getvalue()


def _reconcile(*args):
    out = io.StringIO()
    try:
        call_command("reconcile_shards", *args, stdout=out)
        return 0, out.getvalue()
    except CommandError:
        return 1, out.getvalue()
