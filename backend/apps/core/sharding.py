"""Where each model lives once the database is split by civilization (plan D1, D2, D4, D5, D7, D8 in
docs/audit/2026-11-15-sharding/PLAN.md; docs/ARCHITECTURE-tenant-sharding.md section 7).

Nothing here routes a query yet: `config.sharding.ShardRouter` sends everything to "default" in
stage 0. These functions are the vocabulary later stages route with, and
`tests/test_shard_placement_inventory.py` pins what they derive, so a new model or foreign key
changes a pinned list instead of silently changing where rows go.

Placement is derived, not declared:
  REFERENCE  tenants.Tenant: the control database is the master, every shard holds a copy (D4).
  SHARD      has a tenant path: a direct tenant foreign key, or a chain of foreign keys to a model
             that has one. Rows follow that hall's civilization; rows with no hall stay in control (D2).
  CONTROL    everything else, plus the apps the user kept global (D1: identities, RBAC, menus) and
             the few models in CONTROL_MODELS.
"""
from django.apps import apps
from django.conf import settings
from django.db import models

CONTROL = "CONTROL"
SHARD = "SHARD"
REFERENCE = "REFERENCE"

#: D1 (user decision 2026-11-15, section 7.4): User and the RBAC / menu tables stay in the control
#: database even where they carry a tenant column (User.tenant, Impersonation.hall).
CONTROL_APPS = frozenset({"authentication", "perm", "menus"})
#: Single models the derivation would put in a shard because a nullable pointer happens to reach a
#: hall, while the row itself belongs to nobody's hall. Each needs a reason.
CONTROL_MODELS = {
    "soul_assist.AssistConfig": "the one global assistant config row; eval_soul_account is a pointer to "
                                "a test identity, not an owner",
}

#: The column a model names its owning hall by when it has several tenant foreign keys
#: (Soul.home_tenant, DispatchRecord.source_tenant, ...). D6: a soul follows `soul.tenant`.
TENANT_FIELD = "tenant"


class NoShardContext(Exception):  # noqa: N818 -- the name the plan (D7) uses
    """A SHARD model of a civilization already cut over was queried with no instance hint, no tenant
    contextvar and no `.using()` (D7). Raised from stage 3 on; stage 0 never raises it."""


def _tenant_model():
    return apps.get_model("tenants", "Tenant")


def _direct_tenant_field(model):
    """Name of the model's own tenant FK, or None. Several and none named `tenant` is a decision
    nobody made yet, so it raises instead of guessing."""
    tenant = _tenant_model()
    names = [f.name for f in model._meta.concrete_fields
             if isinstance(f, models.ForeignKey) and f.related_model is tenant]
    if not names:
        return None
    if TENANT_FIELD in names:
        return TENANT_FIELD
    if len(names) == 1:
        return names[0]
    raise ValueError(f"{model._meta.label} has tenant FKs {names} and none is named {TENANT_FIELD!r}")


def _is_control_by_decision(model):
    return model._meta.app_label in CONTROL_APPS or model._meta.label in CONTROL_MODELS


def tenant_path(model):
    """ORM lookup from `model` to its owning Tenant ("tenant", "soul__tenant", ...), or None.

    Shortest chain of forward foreign keys wins; among equal lengths a chain with no nullable
    link wins, then the alphabetically first. Chains never pass through Tenant itself or a
    CONTROL-by-decision model (a User's hall is not its rows' hall)."""
    model = model._meta.concrete_model
    if model is _tenant_model() or _is_control_by_decision(model):
        return None
    frontier = [((), False, model)]
    seen = {model}
    while frontier:
        found = []
        for path, nullable, m in frontier:
            direct = _direct_tenant_field(m) if not _is_control_by_decision(m) else None
            if direct:
                found.append((nullable, "__".join((*path, direct))))
        if found:
            return min(found)[1]
        nxt = []
        for path, nullable, m in frontier:
            for f in m._meta.concrete_fields:
                if not isinstance(f, models.ForeignKey):
                    continue
                target = f.related_model._meta.concrete_model
                if target in seen or target is _tenant_model() or _is_control_by_decision(target):
                    continue
                nxt.append(((*path, f.name), nullable or f.null, target))
        seen.update(m for _, _, m in nxt)
        frontier = nxt
    return None


def placement(model):
    if model._meta.concrete_model is _tenant_model():
        return REFERENCE
    return SHARD if tenant_path(model) else CONTROL


def alias_for_civilization(civ):
    """Database alias of a civilization's shard: CHINESE -> "civ_chinese". UNKNOWN has none (D2)."""
    from apps.souls.models import Civilization

    return f"civ_{Civilization(civ).value.lower()}"


def fanout():
    """Aliases a cross-civilization read must visit: control, then every civilization whose reads are
    cut over (settings.SHARD_READ_CIVS). Stage 0: just ["default"]. No caller yet."""
    return ["default", *(alias_for_civilization(c) for c in settings.SHARD_READ_CIVS)]
