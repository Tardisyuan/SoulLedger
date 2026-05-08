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
            SoulState.JUDGING: [SoulState.DISPOSED, SoulState.JUDGING],
            SoulState.DISPOSED: [SoulState.REINCARNATING, SoulState.LOST],
            SoulState.REINCARNATING: [SoulState.ALIVE],
            SoulState.LOST: [],
        }
        return new_state in valid_transitions.get(self.current_state, [])

    def transition_to(self, new_state: str, reason: str = "") -> bool:
        """
        Attempt state transition. Returns True if successful.
        Logs the transition via the events app.
        """
        if not self.can_transition_to(new_state):
            return False

        from apps.events.services import log_soul_state_change
        old_state = self.current_state
        self.current_state = new_state

        if new_state == SoulState.JUDGING and not self.death_date:
            self.death_date = timezone.now().date()

        self.save()
        log_soul_state_change(self, old_state, new_state, reason)
        return True

    def die(self, death_date=None, location: str = "") -> bool:
        """Shortcut: mark soul as dead and begin judgment."""
        if self.current_state != SoulState.ALIVE:
            return False
        self.death_date = death_date or timezone.now().date()
        if location:
            self.origin_location = location
        return self.transition_to(SoulState.JUDGING, "Death recorded, judgment initiated")
