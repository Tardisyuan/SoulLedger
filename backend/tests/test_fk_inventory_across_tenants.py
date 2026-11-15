"""Guard G1 (docs/ARCHITECTURE-tenant-sharding.md 4.1): every foreign key that
touches tenancy is pinned in `tests/tenancy_fk_inventory.py`, with a reason.

Why. The sharding plan (target: one database per tenant) cannot have a foreign
key that crosses databases. Today the database never checks that the two rows of
a tenant-scoped FK carry the same tenant, and 57 models point at the global
`User`. A new FK of either kind is cheap to add and expensive to find later, so
a new one fails here and names itself; the author adds a row WITH a reason, which
is when somebody reads section 3.4.

Everything is derived from `apps.get_models()`; the file pins the result, it does
not declare the categories.

Stage 1B adds each edge's constraint (DB | BARE) and the rule behind it: exactly the edges whose two
ends live in different databases are bare (`test_exactly_the_edges_across_databases_are_bare`,
derived from the placements, not from the pinned column). Proven red 2026-11-15: AuditUserFields'
create_user back to db_constraint=True -> the per-model test names every one of the 46 models, and
the rule test lists every crossing create_user.
"""
import pytest
from django.apps import apps
from django.db import models

from apps.core.models import AuditUserFields
from tests.tenancy_fk_inventory import AUDIT_USER_CONSTRAINT, AUDIT_USER_MODELS, EDGES

# Built-in apps whose tables are not ours (same exclusion as the plan's 1.2).
SKIP = {"auth", "contenttypes", "sessions", "admin", "django_celery_beat", "token_blacklist"}
AUDIT_FIELDS = {"create_user", "update_user", "deleted_by"}


def _our_models():
    return [m for m in apps.get_models() if m._meta.app_label not in SKIP]


def derive_edges():
    """{"app.Model.field->app.Target": category} for every FK / O2O / M2M."""
    Tenant = apps.get_model("tenants", "Tenant")
    User = apps.get_model("authentication", "User")
    ours = _our_models()
    scoped = {
        m for m in ours
        if any(isinstance(f, models.ForeignKey) and f.related_model is Tenant for f in m._meta.concrete_fields)
    }
    out = {}
    for m in ours:
        for f in m._meta.concrete_fields:
            if not isinstance(f, models.ForeignKey):
                continue
            t = f.related_model
            if t is Tenant:
                cat = "tenantcol"
            elif t is User and issubclass(m, AuditUserFields) and f.name in AUDIT_FIELDS:
                continue  # pinned as AUDIT_USER_MODELS
            elif t is User:
                cat = "user-other"
            elif m in scoped and t in scoped:
                cat = "S->S"
            elif m in scoped:
                cat = "S->U"
            elif t in scoped:
                cat = "U->S"
            else:
                cat = "U->U"
            out[f"{m._meta.label}.{f.name}->{t._meta.label}"] = cat
        for f in m._meta.local_many_to_many:
            out[f"{m._meta.label}.{f.name}->{f.related_model._meta.label}"] = "m2m"
    return out


def test_every_tenancy_foreign_key_is_pinned_with_a_reason():
    derived = derive_edges()
    pinned = {k: v[0] for k, v in EDGES.items()}
    new = sorted(set(derived) - set(pinned))
    gone = sorted(set(pinned) - set(derived))
    moved = sorted(f"{k}: pinned {pinned[k]}, now {derived[k]}" for k in set(derived) & set(pinned) if derived[k] != pinned[k])
    msg = []
    if new:
        msg.append("NEW foreign keys (add to EDGES in tests/tenancy_fk_inventory.py with a reason; "
                   "read ARCHITECTURE-tenant-sharding 3.4 -- a cross-database FK does not exist):\n  " + "\n  ".join(f"{k}  [{derived[k]}]" for k in new))
    if gone:
        msg.append("PINNED but no longer in the models (delete the row):\n  " + "\n  ".join(gone))
    if moved:
        msg.append("CATEGORY changed (a model gained or lost a tenant column; re-read the reason):\n  " + "\n  ".join(moved))
    assert not msg, "\n".join(msg)


def test_every_pinned_edge_has_a_real_reason():
    blank = [k for k, (_, _c, why) in EDGES.items() if len(why.strip()) < 12]
    assert not blank, f"edges without a reason: {blank}"


# --- stage 1B: DB | BARE (D3) ------------------------------------------------

def _field(edge):
    label, name = edge.split("->")[0].rsplit(".", 1)
    return apps.get_model(label)._meta.get_field(name)


def _constraint(f):
    has = f.remote_field.db_constraint if f.many_to_many else f.db_constraint
    return "DB" if has else "BARE"


def _crosses(f):
    """The two ends live in different databases (placements, plan D1/D4/D5): a CONTROL table is only
    in the control database, a SHARD row moves to its civilization's, a REFERENCE row is in all."""
    from apps.core.sharding import CONTROL, SHARD, placement

    src, dst = placement(f.model), placement(f.related_model)
    return (dst == CONTROL and src != CONTROL) or (dst == SHARD and src != SHARD)


def test_each_pinned_constraint_is_the_fields_db_constraint():
    wrong = sorted(f"{k}: pinned {c}, field says {_constraint(_field(k))}"
                   for k, (_, c, _w) in EDGES.items() if c != _constraint(_field(k)))
    assert not wrong, "constraint column out of date:\n  " + "\n  ".join(wrong)


def test_exactly_the_edges_across_databases_are_bare():
    """The rule, from the placements, over every FK / M2M of our models (the audit columns included):
    an edge across databases must be BARE; any other must keep its constraint, except the audit trio,
    which is bare everywhere from its one declaration."""
    must_be_bare, needlessly_bare = [], []
    for m in _our_models():
        for f in [*m._meta.concrete_fields, *m._meta.local_many_to_many]:
            if not isinstance(f, (models.ForeignKey, models.ManyToManyField)):
                continue
            edge = f"{m._meta.label}.{f.name}->{f.related_model._meta.label}"
            audit = f.name in AUDIT_FIELDS and issubclass(m, AuditUserFields)
            if _crosses(f) and _constraint(f) != "BARE":
                must_be_bare.append(edge)
            if not _crosses(f) and not audit and _constraint(f) == "BARE":
                needlessly_bare.append(edge)
    assert not must_be_bare, ("Across databases but still a constraint (D3: db_constraint=False, "
                              "on_delete=DO_NOTHING):\n  " + "\n  ".join(sorted(must_be_bare)))
    assert not needlessly_bare, ("Bare though both ends share a database (the constraint was dropped "
                                 "for nothing):\n  " + "\n  ".join(sorted(needlessly_bare)))


def test_a_bare_foreign_key_has_no_orm_on_delete():
    """D3: Django's delete collector looks only in the deleted row's database, so a bare FK's rule is
    applied by apps.core.bare_ids on every alias instead -- CASCADE / SET_NULL here would apply it twice
    on control and never on a shard."""
    wrong = sorted(f"{m._meta.label}.{f.name}: {f.remote_field.on_delete.__name__}"
                   for m in _our_models() for f in m._meta.concrete_fields
                   if isinstance(f, models.ForeignKey) and not f.db_constraint
                   and f.remote_field.on_delete is not models.DO_NOTHING)
    assert not wrong, "bare but still has an ORM on_delete:\n  " + "\n  ".join(wrong)


@pytest.mark.parametrize("label", AUDIT_USER_MODELS)
def test_each_audit_models_user_columns_are_bare(label):
    model = apps.get_model(label)
    wrong = [f"{n}: {_constraint(model._meta.get_field(n))}" for n in sorted(AUDIT_FIELDS)
             if _constraint(model._meta.get_field(n)) != AUDIT_USER_CONSTRAINT]
    assert not wrong, f"{label}: audit columns must be {AUDIT_USER_CONSTRAINT}: {wrong}"


def test_the_audit_user_columns_sit_on_exactly_the_pinned_models():
    derived = sorted(m._meta.label for m in _our_models() if issubclass(m, AuditUserFields))
    assert derived == sorted(AUDIT_USER_MODELS), (
        "AuditUserFields (create_user / update_user / deleted_by -> User) changed. "
        f"added: {sorted(set(derived) - set(AUDIT_USER_MODELS))}; removed: {sorted(set(AUDIT_USER_MODELS) - set(derived))}"
    )


@pytest.mark.parametrize("label", AUDIT_USER_MODELS)
def test_each_audit_model_really_has_the_three_columns(label):
    model = apps.get_model(label)
    names = {f.name for f in model._meta.concrete_fields}
    assert names >= AUDIT_FIELDS, f"{label} inherits AuditUserFields but lacks {AUDIT_FIELDS - names}"
