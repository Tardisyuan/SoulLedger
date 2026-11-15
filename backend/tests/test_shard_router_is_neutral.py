"""Stage 0 contract of `config.sharding.ShardRouter`, still true after 1B: it is installed and routes nothing.
(1B's rules only answer for a `civ_*` alias, which production does not have yet; they are in
tests/test_shard_router_boundary.py.)

Every model (auto-created M2M through tables included) is asked through Django's public `django.db.router` for a read and a write
alias, with no context, inside each of the four civilizations' halls (the tenant contextvar from
apps/tenants/managers.py), and with an instance hint carrying that hall. Every answer is "default". All of them, not a sample:
a router that misroutes one model is the shape later stages get wrong, and the 2026-11-15 review's
one-model mutation (ChatBlock writes to civ_chinese) was caught by a 20-model sample 1 run in 5.

Mutation that turns it red (applied once, 2026-11-15): make `ShardRouter.db_for_write` return
`alias_for_civilization(get_current_tenant().civilization)` unconditionally -- every write case goes
red (and the no-context ones raise). The second mutation, `return "default"` in db_for_read, turns
`test_an_instance_hint_keeps_its_own_database` red: neutral means "as if there were no router", and
with no router a row read with `.using(alias)` keeps reading its relations from that alias.
"""
import pytest
from django.apps import apps
from django.db import router

from apps.core.sharding import tenant_path
from apps.souls.models import Civilization
from apps.tenants.managers import clear_current_tenant, set_current_tenant
from apps.tenants.models import Tenant
from config.sharding import ShardRouter

MODELS = sorted(apps.get_models(include_auto_created=True), key=lambda m: m._meta.label)
HALLS = {civ.value: Tenant(code=f"S0_{civ.value}", declared_civilization=civ.value) for civ in Civilization}


def _instance(model, hall):
    obj = model()
    path = tenant_path(model)
    if hall is not None and path and "__" not in path:
        setattr(obj, path, hall)
    return obj


@pytest.fixture(autouse=True)
def _no_tenant_leak():
    clear_current_tenant()
    yield
    clear_current_tenant()


def test_the_shard_router_is_installed():
    assert any(isinstance(r, ShardRouter) for r in router.routers), (
        f"ShardRouter is not in DATABASE_ROUTERS; this whole file would pass vacuously ({router.routers})")


def test_the_four_halls_really_are_four_civilizations():
    assert sorted(str(h.civilization) for h in HALLS.values()) == sorted(Civilization.values)


@pytest.mark.parametrize("civ", [None, *HALLS], ids=lambda c: c or "no-context")
def test_an_instance_hint_keeps_its_own_database(civ):
    """What Django does with no router at all: a hinted instance's `_state.db` wins."""
    hall = HALLS.get(civ)
    if hall is not None:
        set_current_tenant(hall)
    wrong = []
    for model in MODELS:
        obj = _instance(model, hall)
        obj._state.db = "some_other_alias"
        for op, fn in (("read", router.db_for_read), ("write", router.db_for_write)):
            got = fn(model, instance=obj)
            if got != "some_other_alias":
                wrong.append(f"{model._meta.label} {op} -> {got}")
    assert not wrong, f"hall={civ}:\n  " + "\n  ".join(wrong)


@pytest.mark.parametrize("civ", [None, *HALLS], ids=lambda c: c or "no-context")
def test_reads_and_writes_go_to_default(civ):
    hall = HALLS.get(civ)
    if hall is not None:
        set_current_tenant(hall)
    wrong = []
    for model in MODELS:
        for hint in ({}, {"instance": _instance(model, hall)}):
            for op, fn in (("read", router.db_for_read), ("write", router.db_for_write)):
                try:
                    got = fn(model, **hint)
                except Exception as exc:  # a router that raises is not neutral either
                    got = f"raised {exc!r}"
                if got != "default":
                    wrong.append(f"{model._meta.label} {op} {'instance' if hint else 'bare'} -> {got}")
    assert not wrong, f"hall={civ}:\n  " + "\n  ".join(wrong)
