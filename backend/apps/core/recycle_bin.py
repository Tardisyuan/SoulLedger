"""
Global recycle bin — cascade-aware soft delete/restore across every
soft-deletable model, plus the small per-entity-type registry the bin API
(apps.core.recycle_bin_views) lists and restores through.

Stage 4 design (§4.7) proposal this implements: deleting a parent record
(e.g. a Soul) also soft-deletes whatever hangs off it, all under one shared
`delete_cascade_id`. The bin lists only the parent — never its cascaded
dependents as separate rows — with a dependent count, and restore reverses
the whole cascade-id set in one action, not just the parent row.

Two kinds of bin entry:
  * reference / config data (Menu, Role, ...): a 30-day window, hard delete
    available to administrators after it expires.
  * domain records that participate in a judicial process (Soul, Judgment,
    Disposition): once a verdict exists these are archivable, not
    deletable, at all — see apps.core.archive. Before a verdict exists they
    soft-delete and land in the bin the same as reference data, but there is
    no hard-delete path for them here; the design doc is explicit that the
    bin should only ever contain things that can be safely destroyed.
"""
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from django.apps import apps as django_apps
from django.utils import timezone

from apps.core.soft_delete import SoftDeleteMixin

REFERENCE_DATA_RETENTION_DAYS = 30


def new_cascade_id() -> uuid.UUID:
    return uuid.uuid4()


def cascade_soft_delete(instance, dependents, user=None, reason=""):
    """Soft-delete `instance` and every row in `dependents` under one shared
    cascade id. `dependents` is any iterable of model instances (typically
    querysets already narrowed to "not already deleted"). Returns the
    cascade id, which the caller can hand back to the client so it can be
    quoted if needed, though restore is looked up by the parent row instead.
    """
    cascade_id = new_cascade_id()
    instance.soft_delete(user=user, reason=reason, cascade_id=cascade_id)
    for dep in dependents:
        if getattr(dep, "is_deleted", False):
            continue
        dep.soft_delete(user=user, reason=reason, cascade_id=cascade_id)
    return cascade_id


def _soft_deletable_models():
    for model in django_apps.get_models():
        if issubclass(model, SoftDeleteMixin) and not model._meta.abstract:
            yield model


def _unfiltered_manager(model):
    # all_objects is declared first on every concrete SoftDeleteMixin
    # subclass precisely so it becomes _base_manager — see soft_delete.py.
    # Falling back to _base_manager covers the (currently theoretical) case
    # of a subclass that didn't redeclare all_objects itself.
    return getattr(model, "all_objects", model._base_manager)


def restore_cascade(cascade_id) -> int:
    """Restore every soft-deleted row, across every soft-deletable model,
    that shares this cascade id. Returns the number of rows restored.

    Reverses exactly the set soft_delete's cascade_id wrote — not more (rows
    from an unrelated delete are never touched), not less (every dependent
    written under this id comes back, not just the parent).
    """
    restored = 0
    for model in _soft_deletable_models():
        manager = _unfiltered_manager(model)
        for row in manager.filter(delete_cascade_id=cascade_id, is_deleted=True):
            row.restore()
            restored += 1
    return restored


def cascade_dependent_count(cascade_id, parent) -> int:
    """Count soft-deleted rows sharing `cascade_id`, excluding `parent`
    itself — the number the bin shows as "含 N 项关联"."""
    parent_model = type(parent)
    count = 0
    for model in _soft_deletable_models():
        manager = _unfiltered_manager(model)
        qs = manager.filter(delete_cascade_id=cascade_id, is_deleted=True)
        if model is parent_model:
            qs = qs.exclude(pk=parent.pk)
        count += qs.count()
    return count


@dataclass(frozen=True)
class BinEntryType:
    """One entity type the global recycle bin knows how to list/restore.

    `kind` is "reference" (config/reference data — 30-day window, hard
    delete available after expiry) or "domain" (judicial-process records —
    no hard delete offered here at all, per the design doc: the bin should
    only ever contain things safe to destroy).
    """
    entity_type: str
    model: type
    kind: str  # "reference" | "domain"
    label: Callable[[object], str]


_REGISTRY: dict[str, BinEntryType] = {}


def register_bin_type(entity_type: str, model: type, kind: str, label: Callable[[object], str]):
    if kind not in ("reference", "domain"):
        raise ValueError(f"unknown recycle bin kind: {kind!r}")
    _REGISTRY[entity_type] = BinEntryType(entity_type=entity_type, model=model, kind=kind, label=label)


def registered_types():
    return list(_REGISTRY.values())


def get_bin_type(entity_type: str) -> BinEntryType | None:
    return _REGISTRY.get(entity_type)


def list_bin_entries(tenant=None, is_admin=False):
    """List every soft-deleted PARENT row across all registered entity
    types — never their cascaded dependents, which is what would make a
    single soul's delete look like eight rows in the bin.

    A row counts as a "parent" (its own bin entry) whenever it's a
    registered type; cascaded dependents on *other* models are folded into
    its dependent_count instead of appearing as their own entries. If a
    registered type's rows can themselves be a cascade dependent of another
    registered type, this treats every registered-type row as a parent
    entry regardless — the registry today (Soul, Menu) has no such overlap.
    """
    entries = []
    for bin_type in registered_types():
        manager = _unfiltered_manager(bin_type.model)
        qs = manager.filter(is_deleted=True)
        if not is_admin and tenant is not None and hasattr(bin_type.model, "tenant_id"):
            qs = qs.filter(tenant=tenant)
        for row in qs.order_by("-deleted_at"):
            cascade_id = row.delete_cascade_id
            dependent_count = cascade_dependent_count(cascade_id, row) if cascade_id else 0
            deleted_at = row.deleted_at
            hard_delete_eligible = False
            retention_days = None
            if bin_type.kind == "reference":
                retention_days = REFERENCE_DATA_RETENTION_DAYS
                if deleted_at:
                    hard_delete_eligible = (
                        timezone.now() - deleted_at >= timedelta(days=REFERENCE_DATA_RETENTION_DAYS)
                    )
            entries.append({
                "entity_type": bin_type.entity_type,
                "kind": bin_type.kind,
                "id": row.pk,
                "label": bin_type.label(row),
                "deleted_at": deleted_at,
                "deleted_by": getattr(row.deleted_by, "username", None) if row.deleted_by_id else None,
                "delete_reason": row.delete_reason,
                "cascade_id": str(cascade_id) if cascade_id else None,
                "dependent_count": dependent_count,
                "retention_days": retention_days,
                "hard_delete_eligible": hard_delete_eligible,
            })
    entries.sort(key=lambda e: e["deleted_at"] or timezone.now(), reverse=True)
    return entries


def hard_delete(entity_type: str, pk) -> bool:
    """Permanently remove a reference-data row past its retention window.
    Returns False if the type isn't registered, isn't reference-data,
    doesn't exist, isn't soft-deleted, or hasn't cleared the retention
    window yet — the view turns each into its own error message."""
    bin_type = get_bin_type(entity_type)
    if bin_type is None or bin_type.kind != "reference":
        return False
    manager = _unfiltered_manager(bin_type.model)
    row = manager.filter(pk=pk, is_deleted=True).first()
    if row is None or not row.deleted_at:
        return False
    if timezone.now() - row.deleted_at < timedelta(days=REFERENCE_DATA_RETENTION_DAYS):
        return False
    # QuerySet.delete() issues the real SQL DELETE — SoftDeleteMixin only
    # overrides the *instance* delete() method, so going through the
    # manager/queryset here is what actually removes the row.
    manager.filter(pk=pk).delete()
    return True
