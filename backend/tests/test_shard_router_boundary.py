"""Stage 1B rules of `config.sharding.ShardRouter`, asked through Django's public `django.db.router`
(plan docs/audit/2026-11-15-sharding/PLAN.md, 阶段 1B). Everything here is about a civilization alias
(`civ_*`); production has none until stage 2, so `tests/test_shard_router_is_neutral.py` still holds.

  allow_migrate   on a shard: every SHARD and REFERENCE table, no CONTROL table -- for the live models,
                  the auto-created M2M tables, and the historical models `migrate` really passes in.
                  On default (the control database) and any non-shard alias: everything.
  allow_relation  across databases: refused for two SHARD rows, allowed when one side is CONTROL or
                  REFERENCE (a bare id, a Tenant copy).
  CONTROL reads   from a shard row's hint go to default; SHARD and REFERENCE ones keep the hint.

Placement is taken from `apps.core.sharding.placement` (pinned by tests/test_shard_placement_inventory.py);
the expected answer is written from the rule, not read from the router.

Proven red 2026-11-15: `allow_migrate` answering True for CONTROL on a shard -> the live, through-table
and historical tests all list the control tables (authentication.User, perm.*, menus.*...).
"""
import pytest
from django.apps import apps
from django.db import router
from django.db.migrations.loader import MigrationLoader

from apps.core.sharding import CONTROL, REFERENCE, SHARD, placement

SHARDS = ["civ_greek", "civ_chinese"]
MODELS = sorted(apps.get_models(include_auto_created=True), key=lambda m: m._meta.label)


def _wrong(alias, models_):
    out = []
    for m in models_:
        expected = placement(m) != CONTROL
        if router.allow_migrate_model(alias, m) is not expected:
            out.append(f"{m._meta.label} ({placement(m)}): {not expected}")
    return out


@pytest.mark.parametrize("alias", SHARDS)
def test_a_shard_migrates_shard_and_reference_tables_and_no_control_table(alias):
    kinds = {placement(m) for m in MODELS}
    assert kinds == {CONTROL, SHARD, REFERENCE}, kinds
    assert any(m._meta.auto_created for m in MODELS)  # the through tables are asked too
    wrong = _wrong(alias, MODELS)
    assert not wrong, f"{alias}:\n  " + "\n  ".join(wrong)


def test_a_shard_places_the_historical_models_migrate_passes_in():
    hist = MigrationLoader(None, ignore_no_migrations=True).project_state().apps
    live = {m._meta.label_lower for m in MODELS}
    models_ = [m for m in hist.get_models(include_auto_created=True) if m._meta.label_lower in live]
    assert len(models_) > 100
    wrong = _wrong("civ_greek", models_)
    assert not wrong, "historical:\n  " + "\n  ".join(wrong)
    statute, menu = hist.get_model("judgment", "Statute"), hist.get_model("menus", "Menu")
    assert router.allow_migrate_model("civ_greek", statute) and not router.allow_migrate_model("civ_greek", menu)


@pytest.mark.parametrize("alias", ["default", "tenant_shadow", "some_other_alias"])
def test_any_other_alias_migrates_everything(alias):
    refused = [m._meta.label for m in MODELS if not router.allow_migrate_model(alias, m)]
    assert not refused, f"{alias} refuses {refused}"


def test_a_data_migration_runs_on_a_shard_only_for_an_app_with_tables_there():
    """RunPython / RunSQL carry no model name. An app with no table on a shard has nothing to run there
    (third-party ones such as token_blacklist never call `placed_here`); our shard apps are left to
    `placed_here` (tests/test_placement_by_label.py) and their RunSQL. On default every app runs."""
    by_app = {}
    for m in MODELS:
        by_app.setdefault(m._meta.app_label, set()).add(placement(m))
    wrong = []
    for app_label, kinds in sorted(by_app.items()):
        expected = kinds != {CONTROL}
        if router.allow_migrate("civ_greek", app_label) is not expected:
            wrong.append(f"{app_label} {sorted(kinds)}: {not expected}")
        if router.allow_migrate("default", app_label) is not True:
            wrong.append(f"{app_label} refused on default")
    assert not wrong, "\n  ".join(wrong)
    assert by_app["token_blacklist"] == {CONTROL} and SHARD in by_app["souls"]


def _on(model, alias, **fields):
    obj = model(**fields)
    obj._state.db = alias
    return obj


def test_relations_across_databases():
    User, Realm, Tenant = (apps.get_model(x) for x in ("authentication.User", "realms.Realm", "tenants.Tenant"))
    shard_realm = _on(Realm, "civ_greek")
    cases = {
        "SHARD on a shard -> CONTROL on default": (shard_realm, _on(User, "default"), True),
        "SHARD on a shard -> REFERENCE on default": (shard_realm, _on(Tenant, "default"), True),
        "SHARD on a shard -> SHARD on default": (shard_realm, _on(Realm, "default"), False),
        "SHARD on one shard -> SHARD on another": (shard_realm, _on(Realm, "civ_chinese"), False),
        "SHARD -> SHARD, same shard": (shard_realm, _on(Realm, "civ_greek"), True),
        "CONTROL -> CONTROL, same database": (_on(User, "default"), _on(User, "default"), True),
    }
    got = {k: (router.allow_relation(a, b), router.allow_relation(b, a)) for k, (a, b, _) in cases.items()}
    assert got == {k: (ok, ok) for k, (_, _, ok) in cases.items()}


def test_a_control_model_hinted_from_a_shard_row_is_read_from_control():
    User, Realm, Tenant = (apps.get_model(x) for x in ("authentication.User", "realms.Realm", "tenants.Tenant"))
    hint = _on(Realm, "civ_greek")
    got = {m._meta.label: (router.db_for_read(m, instance=hint), router.db_for_write(m, instance=hint))
           for m in (User, Realm, Tenant)}
    assert got == {"authentication.User": ("default", "default"),
                   "realms.Realm": ("civ_greek", "civ_greek"),
                   "tenants.Tenant": ("civ_greek", "civ_greek")}


@pytest.mark.parametrize("read,write,error", [
    ([], [], None),
    (["GREEK"], [], None),
    (["GREEK", "EGYPTIAN"], ["GREEK"], None),
    (["CHINA"], [], "SHARD_READ_CIVS names \\['CHINA'\\]"),
    (["GREEK"], ["greek"], "SHARD_WRITE_CIVS names \\['greek'\\]"),
    ([], ["GREEK"], "not in SHARD_READ_CIVS"),
    (["GREEK", "CHINESE"], [], "needs DATABASES entries \\['civ_chinese'\\]"),
])
def test_the_cut_over_settings_name_real_civilizations_and_reads_go_first(read, write, error):
    """D8: a typo or a missing shard database refuses to boot (apps/souls/apps.py) instead of failing
    at the first fanout()."""
    from django.core.exceptions import ImproperlyConfigured

    from apps.core.sharding import check_cut_over_settings

    databases = {"default": {}, "civ_greek": {}, "civ_egyptian": {}}
    if error is None:
        check_cut_over_settings(read, write, databases)
    else:
        with pytest.raises(ImproperlyConfigured, match=error):
            check_cut_over_settings(read, write, databases)


def test_the_cut_over_check_reads_the_real_databases_setting_by_default():
    from django.core.exceptions import ImproperlyConfigured

    from apps.core.sharding import check_cut_over_settings

    check_cut_over_settings([], [])
    with pytest.raises(ImproperlyConfigured, match="civ_egyptian"):
        check_cut_over_settings(["EGYPTIAN"], [])  # no settings file here configures civ_egyptian
