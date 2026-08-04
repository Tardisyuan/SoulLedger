"""
Soul core model + state machine.
"""
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.models import AuditUserFields
from apps.souls.dates import parse_historical_date, to_legacy_date
from apps.souls.querysets import SoulManager


class Civilization(models.TextChoices):
    CHINESE = "CHINESE", "Chinese Diyu"
    EUROPEAN = "EUROPEAN", "European Heaven/Hell"
    EGYPTIAN = "EGYPTIAN", "Egyptian Duat"


class SoulState(models.TextChoices):
    ALIVE = "ALIVE", "Alive"
    JUDGING = "JUDGING", "Under Judgment"
    DISPOSED = "DISPOSED", "Disposed"
    REINCARNATING = "REINCARNATING", "Reincarnating"
    LOST = "LOST", "Lost/Suspended"


class Soul(AuditUserFields, models.Model):
    """
    Core soul entity. All other records link back to a Soul.
    Civilization is now derived from tenant FK.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    current_state = models.CharField(
        max_length=20,
        choices=SoulState.choices,
        default=SoulState.ALIVE,
    )
    # Historical (possibly BCE) dates, stored as signed year + optional
    # month/day rather than a DateField — see apps.souls.dates for the
    # year-0 convention. `birth_date`/`death_date` below are compatibility
    # properties, not real columns.
    birth_year = models.IntegerField(null=True, blank=True)
    birth_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    birth_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    death_year = models.IntegerField(null=True, blank=True)
    death_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    death_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    origin_location = models.CharField(max_length=255, blank=True)
    birth_name = models.CharField(max_length=255, blank=True)  # name at birth
    description = models.TextField(blank=True)

    # Karma summary (denormalised for performance, updated via signal/service)
    merit_score = models.IntegerField(default=0)
    demerit_score = models.IntegerField(default=0)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='souls',
        null=True,
    )

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Soul"
        verbose_name_plural = "Souls"
        indexes = [
            models.Index(fields=["tenant", "current_state"]),
            models.Index(fields=["current_state"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = SoulManager()

    def save(self, *args, **kwargs):
        # Set tenant from thread-local request context on first save
        is_new = self._state.adding
        if is_new and self.tenant_id is None:
            from apps.core.request_local import get_current_request
            request = get_current_request()
            if request:
                tenant = getattr(request, 'tenant', None)
                if not tenant:
                    user = getattr(request, 'user', None)
                    if user:
                        tenant = getattr(user, 'tenant', None)
                if tenant:
                    self.tenant = tenant

        # Enforce tenant requirement on creation
        if is_new and self.tenant_id is None:
            from django.core.exceptions import ValidationError
            raise ValidationError("Tenant is required when creating a Soul.")

        super().save(*args, **kwargs)

        # Log SOUL_CREATED event after first save (not on updates)
        if is_new:
            from apps.events.services import EventService
            EventService.log_soul_created(self)

    def __str__(self):
        return f"{self.name} ({self.civilization}) [{self.current_state}]"

    @property
    def civilization(self) -> str:
        """Derive civilization from tenant code."""
        if self.tenant_id is None:
            return Civilization.CHINESE
        mapping = {
            "CN_DIYU": Civilization.CHINESE,
            "EU_HEAVEN_HELL": Civilization.EUROPEAN,
            "EG_DUAT": Civilization.EGYPTIAN,
        }
        return mapping.get(self.tenant.code, Civilization.CHINESE)

    @property
    def karmic_balance(self) -> int:
        return self.merit_score - self.demerit_score

    # ------------------------------------------------------------------
    # Legacy DateField-shaped accessors, kept for callers outside this
    # app (death_sync webhook payloads, reincarnation reset, event
    # logging, and most of the existing test suite) that still read or
    # assign `soul.birth_date` / `soul.death_date` as a plain date.
    # These are NOT stored columns — birth_year/month/day are the only
    # source of truth. The getter can only represent CE dates with full
    # month/day precision; BCE or year-only records read back as None
    # here (use birth_year/birth_month/birth_day directly for those).
    # ------------------------------------------------------------------
    @property
    def birth_date(self):
        return to_legacy_date(self.birth_year, self.birth_month, self.birth_day)

    @birth_date.setter
    def birth_date(self, value):
        self.birth_year, self.birth_month, self.birth_day = parse_historical_date(value)

    @property
    def death_date(self):
        return to_legacy_date(self.death_year, self.death_month, self.death_day)

    @death_date.setter
    def death_date(self, value):
        self.death_year, self.death_month, self.death_day = parse_historical_date(value)

    def can_transition_to(self, new_state: str) -> bool:
        """
        State machine guard. Returns True if the transition is valid.
        """
        valid_transitions = {
            SoulState.ALIVE: [SoulState.JUDGING],
            SoulState.JUDGING: [SoulState.DISPOSED],
            SoulState.DISPOSED: [SoulState.REINCARNATING, SoulState.LOST],
            SoulState.REINCARNATING: [SoulState.ALIVE],
            SoulState.LOST: [],
        }
        return new_state in valid_transitions.get(self.current_state, [])

    def transition_to(self, new_state: str, reason: str = "", **kwargs) -> bool:
        """
        Attempt state transition with pessimistic locking to prevent race conditions.
        Returns True if successful.
        """
        from django.db import transaction

        from apps.events.services import log_soul_state_change

        with transaction.atomic():
            # Lock the row to prevent concurrent state mutations
            locked_soul = Soul.objects.select_for_update().get(pk=self.pk)
            if not locked_soul.can_transition_to(new_state):
                return False

            old_state = locked_soul.current_state
            locked_soul.current_state = new_state

            if new_state == SoulState.JUDGING and not locked_soul.death_date:
                from django.utils import timezone as tz
                locked_soul.death_date = tz.now().date()

            # Apply any extra field updates (e.g. death_date, origin_location from die())
            for field, value in kwargs.items():
                if hasattr(locked_soul, field):
                    setattr(locked_soul, field, value)

            locked_soul.save()

        # Log outside the transaction to avoid holding locks during external calls
        log_soul_state_change(locked_soul, old_state, new_state, reason)
        # Sync back to self instance. Copy the raw year/month/day (not via
        # the birth_date/death_date properties) so a BCE death date isn't
        # silently dropped — the legacy property getter returns None for
        # anything it can't express as a datetime.date.
        self.current_state = locked_soul.current_state
        self.death_year = locked_soul.death_year
        self.death_month = locked_soul.death_month
        self.death_day = locked_soul.death_day
        return True

    def die(self, death_date=None, location: str = "") -> "Judgment | None":
        """Mark soul as dead, transition to JUDGING, and create a Judgment record."""
        from django.db import transaction

        if self.current_state != SoulState.ALIVE:
            return None

        with transaction.atomic():
            result = self.transition_to(
                SoulState.JUDGING,
                "Death recorded, judgment initiated",
                death_date=death_date or timezone.now().date(),
                **({"origin_location": location} if location else {}),
            )
            if not result:
                return None

            from apps.judgment.models import Judgment, JudgmentMethod

            method_map = {
                Civilization.CHINESE: JudgmentMethod.STANDARD,
                Civilization.EUROPEAN: JudgmentMethod.STANDARD,
                Civilization.EGYPTIAN: JudgmentMethod.HEART_WEIGHING,
            }
            judgment = Judgment.objects.create(
                soul=self,
                civilization=self.civilization,
                tenant=self.tenant,
                judgment_method=method_map.get(self.civilization, JudgmentMethod.STANDARD),
            )
            return judgment
