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
from functools import cache

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
    # User decision 2026-11-15: the soul's login identity is looked up globally (by code / e-mail) before
    # any hall is known, so it stays with the other identities (D1); SoulAccount.soul becomes a bare id
    # in 1B. Its MFA / device-login tables follow it because their only path ran through it. The push
    # tables are per account (one token, one login session) and are kept with it by name.
    "soul_accounts.SoulAccount": "the soul's login identity, looked up globally by code / e-mail (D1)",
    "soul_push.PushDevice": "a push token belongs to one login account and session; follows SoulAccount",
    "soul_push.PushPreference": "one row per login account; follows SoulAccount",
    "soul_push.PushDelivery": "per-account push log beside its device; follows SoulAccount",
}
#: Paths chosen by hand where the derivation would find two of equal length (it raises rather than
#: pick), or where the row belongs to a hall only through a CONTROL model. An override is the one way
#: a path may run through a CONTROL model.
TENANT_PATH_OVERRIDES = {
    "chat.ChatBlock": "blocker__soul__tenant",  # the blocker's row: every read and write filters on blocker
    # Ties with workflow__tenant: the application is the soul's; its approval workflow is opened in the
    # soul's hall, so the two agree today, and if a soul moves the application goes with the soul (D6).
    "soul_accounts.RebirthApplication": "soul__tenant",
    # Soul conversations. Officer ones (account null, user set) have no hall and stay in control (D2).
    "soul_assist.AssistConversation": "account__soul__tenant",
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


def _derive_path(model):
    """Shortest chain of forward foreign keys wins; among equal lengths a chain with no nullable link
    wins. Two chains still tied raise: name one in TENANT_PATH_OVERRIDES. Chains never pass through
    Tenant itself or a CONTROL-by-decision model (a User's hall is not its rows' hall) unless an
    override says so."""
    model = model._meta.concrete_model
    if model is _tenant_model() or _is_control_by_decision(model):
        return None
    if model._meta.label in TENANT_PATH_OVERRIDES:
        return TENANT_PATH_OVERRIDES[model._meta.label]
    frontier = [((), False, model)]
    seen = {model}
    found = []  # (hops, nullable, path); a model reached with an override counts its override's hops
    while frontier and not (found and min(found)[0] <= len(frontier[0][0])):
        for path, nullable, m in frontier:
            direct = TENANT_PATH_OVERRIDES.get(m._meta.label)
            if direct is None and not _is_control_by_decision(m):
                direct = _direct_tenant_field(m)
            if direct:
                full = "__".join((*path, direct))
                found.append((full.count("__") + 1, nullable, full))
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
    if not found:
        return None
    best = min(found)[:2]
    tied = sorted(p for h, n, p in found if (h, n) == best)
    if len(tied) > 1:
        raise ValueError(f"{model._meta.label}: tenant paths {tied} tie; name one in TENANT_PATH_OVERRIDES")
    return tied[0]


@cache
def _by_label():
    """label_lower -> (placement, tenant path), derived once from the CURRENT models, auto-created M2M
    through tables included. Looked up by label so a historical model (what a migration's RunPython,
    `allow_migrate` and `placed_here` receive) is placed like the live one: an identity check against
    the current Tenant would call every historical model CONTROL, silently."""
    out = {}
    for m in apps.get_models(include_auto_created=True):
        path = _derive_path(m)
        out[m._meta.label_lower] = (REFERENCE if m is _tenant_model() else SHARD if path else CONTROL, path)
    return out


def placement_of(app_label, model_name):
    """Placement by name, the way `allow_migrate(db, app_label, model_name)` is asked. A model no
    longer in the code is CONTROL: it can only have been created and dropped on the control database."""
    return _by_label().get(f"{app_label}.{model_name}".lower(), (CONTROL, None))[0]


@cache
def app_has_shard_tables(app_label):
    """Whether any current model of the app is SHARD or REFERENCE, i.e. has a table on a shard."""
    prefix = f"{app_label}.".lower()
    return any(k.startswith(prefix) and p != CONTROL for k, (p, _) in _by_label().items())


def tenant_path(model):
    """ORM lookup from `model` to its owning Tenant ("tenant", "soul__tenant", ...), or None.
    Live and historical models alike (resolved by label)."""
    return _by_label().get(model._meta.label_lower, (CONTROL, None))[1]


def placement(model):
    return placement_of(model._meta.app_label, model._meta.model_name)


def alias_for_civilization(civ):
    """Database alias of a civilization's shard: CHINESE -> "civ_chinese". UNKNOWN has none (D2)."""
    from apps.souls.models import Civilization

    return f"civ_{Civilization(civ).value.lower()}"


def check_cut_over_settings(read, write):
    """SHARD_READ_CIVS / SHARD_WRITE_CIVS (D8) name civilizations that have a shard, and a civilization's
    writes are cut over only after its reads. Raised at startup (`apps/souls/apps.py`), so a typo such as
    `CHINA` refuses to boot instead of surfacing at the first `fanout()`."""
    from django.core.exceptions import ImproperlyConfigured

    from apps.souls.models import Civilization

    known = set(Civilization.values)
    for name, civs in (("SHARD_READ_CIVS", read), ("SHARD_WRITE_CIVS", write)):
        bad = sorted(set(civs) - known)
        if bad:
            raise ImproperlyConfigured(f"{name} names {bad}; a shard exists only for {sorted(known)}")
    early = sorted(set(write) - set(read))
    if early:
        raise ImproperlyConfigured(f"SHARD_WRITE_CIVS {early} are not in SHARD_READ_CIVS: cut reads over first")


def fanout():
    """Aliases a cross-civilization read must visit: control, then every civilization whose reads are
    cut over (settings.SHARD_READ_CIVS). Stage 0: just ["default"]. No caller yet."""
    return ["default", *(alias_for_civilization(c) for c in settings.SHARD_READ_CIVS)]
