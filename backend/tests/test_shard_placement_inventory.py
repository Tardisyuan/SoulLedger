"""Stage 0 of the civilization split (the sharding plan (not in this repo) D5): where every model
lives, derived by `apps.core.sharding.placement` from `apps.get_models()`, is pinned in
`tests/tenancy_placement.py` -- the same new / gone / moved diff as G1
(`tests/test_fk_inventory_across_tenants.py`).

Why. Placement is derived from foreign keys, so adding a tenant column, dropping one, or adding a
foreign key can move a whole table to another database without anybody writing the word "shard".
Here it fails and names the model.

The second pin is the cut list: every foreign key from a SHARD model to a CONTROL model. Those
cannot stay database constraints once the shard is a separate database (D3: they become bare ids in
stage 1B). It is derived the same way; a new one is a new cut that stage 1B must make. The third is
the other direction, CONTROL -> SHARD (User.actor, SoulAccount.soul, ...): the same cut, seen from the
control side. Auto-created M2M through tables are placed and pinned like any model: 1B's allow_migrate
is asked about them by their own model_name.
"""
import pytest
from django.apps import apps
from django.db import models

from apps.core.sharding import CONTROL, REFERENCE, SHARD, placement, tenant_path
from tests.tenancy_placement import CONTROL_TO_SHARD_EDGES, PLACEMENT, SHARD_TO_CONTROL_EDGES

# Built-in apps, as in G1. Their models are still placed (all CONTROL), just not pinned one by one.
SKIP = {"auth", "contenttypes", "sessions", "admin", "django_celery_beat", "token_blacklist"}


def _ours():
    return [m for m in apps.get_models(include_auto_created=True) if m._meta.app_label not in SKIP]


def derive_placement():
    return {m._meta.label: (placement(m), tenant_path(m)) for m in _ours()}


def derive_cut_edges(src=SHARD, dst=CONTROL):
    out = set()
    for m in _ours():
        if placement(m) != src:
            continue
        for f in [*m._meta.concrete_fields, *m._meta.local_many_to_many]:
            if isinstance(f, (models.ForeignKey, models.ManyToManyField)) and placement(f.related_model) == dst:
                out.add(f"{m._meta.label}.{f.name}->{f.related_model._meta.label}")
    return out


def test_every_model_placement_is_pinned_with_a_reason():
    derived = derive_placement()
    pinned = {k: (p, path) for k, (p, path, _) in PLACEMENT.items()}
    new = sorted(set(derived) - set(pinned))
    gone = sorted(set(pinned) - set(derived))
    moved = sorted(f"{k}: pinned {pinned[k]}, now {derived[k]}"
                   for k in set(derived) & set(pinned) if derived[k] != pinned[k])
    msg = []
    if new:
        msg.append("NEW models (add to PLACEMENT in tests/tenancy_placement.py with a reason):\n  "
                   + "\n  ".join(f"{k}  {derived[k]}" for k in new))
    if gone:
        msg.append("PINNED but no longer a model (delete the row):\n  " + "\n  ".join(gone))
    if moved:
        msg.append("MOVED (a tenant column or a foreign key changed where this table's rows live):\n  "
                   + "\n  ".join(moved))
    assert not msg, "\n".join(msg)


def test_every_pinned_placement_has_a_real_reason():
    blank = [k for k, (_, _, why) in PLACEMENT.items() if len(why.strip()) < 12]
    assert not blank, f"placements without a reason: {blank}"


def test_exactly_one_reference_model_and_it_is_the_tenant():
    refs = [m for m in apps.get_models(include_auto_created=True) if placement(m) == REFERENCE]
    assert refs == [apps.get_model("tenants", "Tenant")]


def test_builtin_models_are_all_control():
    stray = [m._meta.label for m in apps.get_models(include_auto_created=True)
             if m._meta.app_label in SKIP and placement(m) != CONTROL]
    assert not stray, f"a built-in model reaches a hall and would leave the control database: {stray}"


@pytest.mark.parametrize("label", sorted(k for k, v in PLACEMENT.items() if v[0] == SHARD))
def test_each_shard_tenant_path_resolves_to_the_tenant_on_meta(label):
    """Walk the path through `_meta.get_field`: every hop is a forward FK and the last lands on Tenant.
    A path that only reads right (a renamed field, a reverse accessor) fails here."""
    model = apps.get_model(label)
    path = tenant_path(model)
    assert path, f"{label} is SHARD with no tenant path"
    current = model
    for hop in path.split("__"):
        f = current._meta.get_field(hop)
        assert isinstance(f, models.ForeignKey) and f.concrete, f"{label}: {hop!r} on {current._meta.label} is not a forward FK"
        current = f.related_model
    assert current is apps.get_model("tenants", "Tenant"), f"{label}: {path} ends on {current._meta.label}"
    # And the ORM accepts it as a lookup (no query is run).
    str(model._base_manager.filter(**{f"{path}__isnull": False}).query)


def test_shard_to_control_foreign_keys_are_the_pinned_cut_list():
    derived = derive_cut_edges()
    pinned = set(SHARD_TO_CONTROL_EDGES)
    new, gone = sorted(derived - pinned), sorted(pinned - derived)
    assert not (new or gone), (
        "The SHARD -> CONTROL foreign keys changed (stage 1B turns each into a bare id, D3).\n"
        f"  new (add to SHARD_TO_CONTROL_EDGES): {new}\n  gone (delete): {gone}"
    )


def test_control_to_shard_foreign_keys_are_pinned():
    derived = derive_cut_edges(CONTROL, SHARD)
    pinned = set(CONTROL_TO_SHARD_EDGES)
    new, gone = sorted(derived - pinned), sorted(pinned - derived)
    assert not (new or gone), (
        "The CONTROL -> SHARD foreign keys changed (each is a cut stage 1B must make).\n"
        f"  new (add to CONTROL_TO_SHARD_EDGES): {new}\n  gone (delete): {gone}"
    )


def test_every_through_table_is_pinned():
    """Vacuity check for the include_auto_created above: the M2M tables really are in the inventory."""
    through = {m._meta.label for m in _ours() if m._meta.auto_created}
    assert through and through <= set(PLACEMENT), sorted(through - set(PLACEMENT))
