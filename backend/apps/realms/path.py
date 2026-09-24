"""A soul's route through the realms: the one writer of `SoulPathEntry`.

Two verbs, and every flow that moves a soul calls one of them inside its own
transaction, so a rolled-back move leaves no path row behind:

* `enter(soul, realm)` — the soul is now in `realm`. The open entry (if any)
  is closed at the same instant and a new one opened. Entering the realm the
  soul is already in writes nothing: a Greek RETRY leaves the soul on the
  meadow it was judged on, and that is not a second visit.
* `leave(soul)` — the soul is no longer in the realm it was in, and nobody
  has said where it went (reborn, dispatched without a stop, returned home).

`enter(soul, None)` is `leave(soul)`: a verdict routed to a realm this tenant
does not have (`DispositionService.create_from_judgment` with an unmapped
tenant) certainly took the soul out of the court, and where it went is not
known. Recording "left" is true; inventing a destination would not be.

The callers, and the ones deliberately not hooked, are listed in the
realm-path-fields cloud report (kept in the project memory directory).

Death is the first station (maintainer decision, 2026-09-25): the ALIVE ->
JUDGING edge in `Soul.transition_to` calls `enter_on_death`, which puts the
soul in its civilization's entry realm (`ENTRY_REALM_CODES`). Souls that died
before that hook have their first station written once, by
`manage.py backfill_soul_entry_path`, from the recorded death date — never
from `created_at`.
"""
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from apps.realms.models import Realm, SoulPathEntry
from apps.souls.models import Civilization

# Where a soul stands the moment it dies, before any court has taken its case.
# Codes verified against apps/actors/mythology/realms.py (the seed).
ENTRY_REALM_CODES = {
    Civilization.CHINESE: "DY_00_PURGATORY",   # 待审所
    Civilization.EGYPTIAN: "EG_DUAT_ENTRY",    # 杜阿特入口
    Civilization.GREEK: "GR_ACHERON",          # 冥府:阿刻戎渡口
    Civilization.EUROPEAN: "EU_ACHERON",       # 地狱篇:阿刻戎渡口
}


def entry_realm_for(soul):
    """The live entry realm of the soul's civilization in the soul's own tenant, or None."""
    code = ENTRY_REALM_CODES.get(soul.civilization)
    if code is None or soul.tenant_id is None:
        return None
    return Realm.all_objects.filter(tenant_id=soul.tenant_id, realm_code=code, is_deleted=False).first()


class SoulPathService:

    @staticmethod
    def _open_entry(soul_id):
        return (
            SoulPathEntry.all_objects.select_for_update()
            .filter(soul_id=soul_id, left_at__isnull=True)
            .first()
        )

    @classmethod
    def enter(cls, soul, realm, *, tenant_id=None, at=None):
        """Record that `soul` is now in `realm`. Returns the open entry (or None).

        `tenant_id` is the tenant the stop happens in; defaults to the realm's.
        """
        if realm is None:
            cls.leave(soul, at=at)
            return None
        at = at or timezone.now()
        with transaction.atomic():
            current = cls._open_entry(soul.pk)
            if current is not None and current.realm_id == realm.pk:
                return current
            if current is not None:
                current.left_at = at
                current.save(update_fields=["left_at"])
            last = SoulPathEntry.all_objects.filter(soul_id=soul.pk).aggregate(n=Max("sequence"))["n"]
            return SoulPathEntry.all_objects.create(
                soul_id=soul.pk,
                realm=realm,
                sequence=(last or 0) + 1,
                entered_at=at,
                tenant_id=tenant_id if tenant_id is not None else realm.tenant_id,
            )

    @classmethod
    def enter_on_death(cls, soul, *, at=None):
        """First station: the civilization's entry realm. No such realm in the tenant writes nothing."""
        realm = entry_realm_for(soul)
        if realm is None:
            return None
        return cls.enter(soul, realm, tenant_id=soul.tenant_id, at=at)

    @classmethod
    def leave(cls, soul, *, realm=None, at=None):
        """Close the soul's open entry. With `realm`, only if that is where it is.

        Returns the closed entry, or None when there was nothing (matching) open.
        """
        with transaction.atomic():
            current = cls._open_entry(soul.pk)
            if current is None:
                return None
            if realm is not None and current.realm_id != realm.pk:
                return None
            current.left_at = at or timezone.now()
            current.save(update_fields=["left_at"])
            return current
