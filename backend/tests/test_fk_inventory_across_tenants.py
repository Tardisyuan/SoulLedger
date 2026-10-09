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
"""
import pytest
from django.apps import apps
from django.db import models

from apps.core.models import AuditUserFields
from tests.tenancy_fk_inventory import AUDIT_USER_MODELS, EDGES

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
    blank = [k for k, (_, why) in EDGES.items() if len(why.strip()) < 12]
    assert not blank, f"edges without a reason: {blank}"


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
