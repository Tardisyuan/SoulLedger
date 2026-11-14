"""Placement is looked up by label, and data migrations never run on a civilization shard.

1. During `migrate`, `allow_migrate` and `placed_here` receive HISTORICAL models (the migration
   state's own classes). An identity check against the live Tenant would call every one of them
   CONTROL without a word. So `apps.core.sharding.placement` resolves `app_label.ModelName` against a
   table derived from the current models; a historical model is placed exactly like the live one.
2. `placed_here` is False on any `civ_*` alias for every model (apps/core/migration_ops.py): seeds and
   backfills run on control only; a shard is filled by the stage-2 sync.

Proven red once each (2026-11-15): `tenant_path` / `placement` deriving from the model passed in
instead of looking the label up -> test 1 lists every historical SHARD model as CONTROL; deleting the
`civ_` early return in `placed_here` -> test 3 fails on all three placements.
"""
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db.migrations.loader import MigrationLoader

from apps.core.migration_ops import placed_here
from apps.core.sharding import CONTROL, REFERENCE, SHARD, placement, placement_of, tenant_path


@pytest.fixture(scope="module")
def historical_apps():
    loader = MigrationLoader(None, ignore_no_migrations=True)
    return loader.project_state().apps


def test_a_historical_model_is_placed_like_the_live_one(historical_apps):
    live = {m._meta.label_lower: m for m in apps.get_models(include_auto_created=True)}
    hist = [m for m in historical_apps.get_models(include_auto_created=True) if m._meta.label_lower in live]
    assert len(hist) > 100, f"too few historical models to mean anything: {len(hist)}"
    wrong = [f"{m._meta.label}: {placement(m)}/{tenant_path(m)} vs live {placement(live[k])}/{tenant_path(live[k])}"
             for m in hist for k in [m._meta.label_lower]
             if (placement(m), tenant_path(m)) != (placement(live[k]), tenant_path(live[k]))]
    assert not wrong, "\n  ".join(["historical placement differs:", *wrong])
    kinds = {placement(m) for m in hist}
    assert kinds == {SHARD, CONTROL, REFERENCE}, kinds


def test_placement_by_name_is_what_allow_migrate_is_asked():
    assert placement_of("judgment", "statute") == SHARD
    assert placement_of("menus", "menu") == CONTROL
    assert placement_of("tenants", "tenant") == REFERENCE
    assert placement_of("gone_app", "model_since_deleted") == CONTROL


def _editor(alias):
    return SimpleNamespace(connection=SimpleNamespace(alias=alias))


@pytest.mark.parametrize("alias", ["civ_greek", "civ_chinese", "civ_test"])
def test_no_data_migration_runs_on_a_shard(alias):
    labels = {"judgment.Statute": SHARD, "menus.Menu": CONTROL, "tenants.Tenant": REFERENCE}
    assert {placement(apps.get_model(lb)) for lb in labels} == set(labels.values())
    ran = [lb for lb in labels if placed_here(_editor(alias), apps, lb)]
    assert not ran, f"placed_here allowed {ran} on {alias}"


def test_control_still_runs_them():
    assert placed_here(_editor("default"), apps, "judgment.Statute", "menus.Menu", "tenants.Tenant")
