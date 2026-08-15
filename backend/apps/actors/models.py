"""
Actor models — deities, judges, guardians, executors across civilizations.
"""
import uuid

from django.db import models
from django.db.models import Q

from apps.core.models import AuditUserFields
from apps.souls.models import Civilization
from apps.tenants.managers import TenantManager


class ActorRole(models.TextChoices):
    JUDGE = "JUDGE", "Judge"
    EXECUTOR = "EXECUTOR", "Executor / Punisher"
    GUARDIAN = "GUARDIAN", "Guardian"
    CONDUIT = "CONDUIT", "Soul Conduit / Guide"
    OVERSEER = "OVERSEER", "Overseer / Admin"


class Actor(AuditUserFields, models.Model):
    """
    A supernatural entity (deity, judge, warden, etc.)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, help_text="Primary / local name")
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    role = models.CharField(max_length=20, choices=ActorRole.choices)
    realm = models.ForeignKey(
        "realms.Realm",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="actors",
    )
    # Localised name fields
    name_zh = models.CharField(max_length=255, blank=True)
    name_en = models.CharField(max_length=255, blank=True)
    name_egy = models.CharField(
        max_length=255,
        blank=True,
        help_text="Egyptian name — transliteration or hieroglyphs (𓂀)",
    )
    title = models.CharField(max_length=255, blank=True)
    title_zh = models.CharField(max_length=255, blank=True)
    title_en = models.CharField(max_length=255, blank=True)
    title_egy = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    powers_json = models.JSONField(default=dict, blank=True)
    icon_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='actors',
        null=True,
    )

    class Meta:
        ordering = ["civilization", "role", "name"]
        verbose_name = "Actor"
        verbose_name_plural = "Actors"
        indexes = [
            models.Index(fields=["civilization", "role"]),
            models.Index(fields=["tenant", "civilization"]),
            models.Index(fields=["role"]),
            models.Index(fields=["is_active"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['tenant', 'civilization', 'name'],
                name='unique_actor_tenant_civ_name'
            ),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.name} ({self.role})"

    def get_localized_name(self, locale: str = "en") -> str:
        if locale.startswith("zh"):
            return self.name_zh or self.name_en or self.name
        if locale == "egy":
            return self.name_egy or self.name_en or self.name
        return self.name_en or self.name

    def get_localized_title(self, locale: str = "en") -> str:
        if locale.startswith("zh"):
            return self.title_zh or self.title_en or self.title
        if locale == "egy":
            return self.title_egy or self.title_en or self.title
        return self.title_en or self.title

    def written_names(self) -> list[str]:
        """Every string this repository uses to denote this being.

        The four name columns, plus the recorded aliases. See
        `ALIASES_KEY` for what an alias is and why it is not a fifth column.
        """
        return [
            *(n for n in (self.name, self.name_zh, self.name_en, self.name_egy) if n),
            *self.aliases(),
        ]

    def aliases(self) -> list[str]:
        """The other written forms of this being's name, or []."""
        powers = self.powers_json
        if not isinstance(powers, dict):
            return []
        recorded = powers.get(ALIASES_KEY)
        return [a for a in recorded if isinstance(a, str)] if isinstance(recorded, list) else []


#: The key under `Actor.powers_json` holding other written forms of the row's
#: name — 「欧西里斯」 for the row whose `name_zh` is 「奥西里斯」, `Heru` for the
#: row whose `name_egy` is `Hor`. Both are one being spelled two ways by two
#: files in this repository, and until this key existed the correspondence was
#: an inference recorded in a comment rather than data.
#:
#: NOT a fifth name column: `name` is the identity key (and is Chinese for the
#: Chinese cast, English for the Egyptian one), while `name_zh`/`name_en`/
#: `name_egy` each hold exactly one canonical rendering per language. What is
#: needed here is an open-ended *set* per row that is not per-language, so it
#: goes in the JSON payload — the same column, and for the same reason, that
#: already carries the assessors' `assessor_index` and confession clause.
#: `apps/actors/mythology/actors_egyptian.py::EGYPTIAN_ACTOR_ALIASES` is the
#: seeded content and states what does and does not qualify as an alias;
#: `actors_european.py::EUROPEAN_ACTOR_ALIASES` is the other table.
ALIASES_KEY = "aliases"


def resolve_actor_by_any_name(queryset, name: str):
    """The one actor in `queryset` that `name` denotes, or None.

    Columns first, aliases second, so a string that is somebody's canonical name
    can never be captured by another row that lists it as an alias. Ordered by
    `name` at both stages so the answer does not depend on row order.

    The alias pass is evaluated in Python rather than as a `powers_json`
    containment lookup: JSON containment is unsupported on SQLite, which the
    test suite runs on, and `queryset` is expected to be one tenant's cast for
    one civilization — tens of rows. `apps/actors/mythology/seeding.py` makes
    the same choice for `assessor_index` and records the same reason.

    Callers are responsible for scoping `queryset` to a tenant and civilization
    and for choosing the manager: `Actor.name` is unique only per tenant, and a
    migration must use `_base_manager` because `Actor.objects` is tenant-scoped
    and there is no tenant in context under `migrate`.
    """
    # The empty string is not a name, and matching it is not harmless: the
    # optional columns are `blank=True`, so `Q(name_zh="")` matches every row
    # that has no Chinese name — all forty-two assessors, among others. An
    # empty probe would resolve to whichever of them sorts first. The previous
    # `Q(name=...) | Q(name_zh=...)` lookup in workflow/services.py had the
    # same hole; nothing reached it because `_resolve_approver` returns early
    # on a falsy `actor` key, but the guard belongs on the resolver, which is
    # now called from more than one place.
    if not name:
        return None

    ordered = queryset.order_by("name")
    exact = ordered.filter(
        Q(name=name) | Q(name_zh=name) | Q(name_en=name) | Q(name_egy=name)
    ).first()
    if exact is not None:
        return exact

    for actor in ordered:
        if name in actor.aliases():
            return actor
    return None
