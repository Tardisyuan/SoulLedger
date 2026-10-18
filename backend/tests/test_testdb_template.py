"""Template-cloned worker databases (config/testdb.py, wired in the root conftest.py).
No DB server needed; the real-PostgreSQL run is what proves the clone works."""
import pytest

from config.testdb import template_names, use_templates, wants_template

PG = "django.db.backends.postgresql"
SQLITE = "django.db.backends.sqlite3"


def dbs(**extra):
    out = {"default": {"ENGINE": PG, "NAME": "soulledger"}}
    out.update(extra)
    return out


def test_template_name_carries_the_run_suffix():
    assert template_names(dbs(), "abc") == {"default": "test_soulledger_tpl_abc"}


def test_every_postgres_alias_gets_its_own_template_and_mirrors_none():
    d = dbs(
        tenant_shadow={"ENGINE": PG, "NAME": "soulledger_shadow"},
        replica={"ENGINE": PG, "NAME": "soulledger", "TEST": {"MIRROR": "default"}},
    )
    assert template_names(d, "abc") == {
        "default": "test_soulledger_tpl_abc",
        "tenant_shadow": "test_soulledger_shadow_tpl_abc",
    }


def test_explicit_test_name_is_the_base():
    d = dbs()
    d["default"]["TEST"] = {"NAME": "custom"}
    assert template_names(d, "abc") == {"default": "custom_tpl_abc"}


def test_sqlite_never_gets_a_template():
    d = {"default": {"ENGINE": SQLITE, "NAME": ":memory:"}}
    assert template_names(d, "abc") == {}
    assert not wants_template(d, distributing=True, reuse_db=False, nomigrations=False)


def test_postgres_under_xdist_wants_one():
    assert wants_template(dbs(), distributing=True, reuse_db=False, nomigrations=False)


@pytest.mark.parametrize("flags", [
    {"distributing": False, "reuse_db": False, "nomigrations": False},  # -n 0: old behaviour
    {"distributing": True, "reuse_db": True, "nomigrations": False},
    {"distributing": True, "reuse_db": False, "nomigrations": True},
])
def test_postgres_falls_back_to_per_worker_migrate(flags):
    assert not wants_template(dbs(), **flags)


def test_worker_side_sets_django_test_template():
    d = dbs()
    use_templates(d, {"default": "test_soulledger_tpl_abc", "gone": "x"})
    assert d["default"]["TEST"]["TEMPLATE"] == "test_soulledger_tpl_abc"
    assert "gone" not in d


def test_worker_without_templates_is_untouched():
    d = dbs()
    before = repr(d)
    use_templates(d, {})
    assert repr(d) == before
