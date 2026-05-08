"""
Soul core model + state machine.
"""
import uuid
from django.db import models
from django.utils import timezone


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


class Soul(models.Model):
    """
    Core soul entity. All other records link back to a Soul.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    civilization = models.CharField(
        max_length=20,
        choices=Civilization.choices,
        default=Civilization.CHINESE,
    )
    current_state = models.CharField(
        max_length=20,
        choices=SoulState.choices,
        default=SoulState.ALIVE,
    )
    birth_date = models.DateField(null=True, blank=True)
    death_date = models.DateField(null=True, blank=True)
    origin_location = models.CharField(max_length=255, blank=True)
    birth_name = models.CharField(max_length=255, blank=True)  # name at birth
    description = models.TextField(blank=True)

    # Karma summary (denormalised for performance, updated via signal/service)
    merit_score = models.IntegerField(default=0)
    demerit_score = models.IntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='souls',
        null=True,
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Soul"
        verbose_name_plural = "Souls"

    def __str__(self):
        return f"{self.name} ({self.civilization}) [{self.current_state}]"

    @property
    def karmic_balance(self) -> int:
        return self.merit_score - self.demerit_score

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

    def transition_to(self, new_state: str, reason: str = "") -> bool:
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

            locked_soul.save()

        # Log outside the transaction to avoid holding locks during external calls
        log_soul_state_change(locked_soul, old_state, new_state, reason)
        # Sync back to self instance
        self.current_state = locked_soul.current_state
        self.death_date = locked_soul.death_date
        return True

    def die(self, death_date=None, location: str = "") -> bool:
        """Shortcut: mark soul as dead and begin judgment."""
        if self.current_state != SoulState.ALIVE:
            return False
        self.death_date = death_date or timezone.now().date()
        if location:
            self.origin_location = location
        return self.transition_to(SoulState.JUDGING, "Death recorded, judgment initiated")
