"""
Disposition model — where a soul goes after judgment.
"""
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.judgment.models import Judgment
from apps.souls.models import Soul
from apps.tenants.managers import TenantManager


class MemoryResetMechanism(models.TextChoices):
    """
    Canonical memory-reset mechanisms. This enum is the single source of truth
    for both Disposition.memory_reset and Realm.memory_reset_mechanism; see
    apps.realms.models.Realm, which reuses ``MemoryResetMechanism.choices``
    rather than restating the values.

    LETHE was stored as "LETIES" until migration disposition/0009 — a
    misspelling of Lethe (忘川), the Greek river of forgetfulness. The member
    name and label were always "LETHE"/"忘川 (Lethe)"; only the stored value
    was wrong. 0009 rewrites existing rows in both tables and is reversible.
    """
    MENGPO = "MENGPO", "孟婆汤 (Mengpo Soup)"
    LETHE = "LETHE", "忘川 (Lethe)"
    SPELL = "SPELL", "Spell Recitation"
    NONE = "NONE", "No Reset"


class Disposition(ArchivableMixin, AuditUserFields, models.Model):
    """
    The destination and sentence given to a soul after judgment.

    Deletion (Stage 4 §4.7): a Disposition only ever exists once its
    Judgment has concluded with a verdict (see JudgmentConclusionService),
    so in practice every Disposition is archivable-only, never deletable —
    see can_delete/delete_or_raise below.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="dispositions",
    )
    judgment = models.OneToOneField(
        Judgment,
        on_delete=models.SET_NULL,
        null=True,
        related_name="disposition",
    )
    destination_realm = models.ForeignKey(
        "realms.Realm",
        on_delete=models.SET_NULL,
        null=True,
        related_name="dispositions",
    )
    memory_reset = models.CharField(
        max_length=20,
        choices=MemoryResetMechanism.choices,
        default=MemoryResetMechanism.NONE,
    )
    is_eternal = models.BooleanField(default=False)
    # `null` means no term was recorded, NOT "eternal" — `is_eternal` above is
    # the column that answers that, and the two disagreed. A Greek FAILED
    # disposition is is_eternal=False with sentence_years=None, which the old
    # help_text read as "eternal" while the row beside it said the opposite.
    # No number is invented to settle it: Republic X's thousand years belong to
    # a different dialogue than the Gorgias 524a that GR_TARTARUS is seeded
    # from, and welding the two is the synthesis verify-greek.md §6 warns off.
    # tests/test_greek_sentence_basis.py pins the gap.
    sentence_years = models.IntegerField(
        null=True,
        blank=True,
        help_text="Sentence duration in years; null = no term recorded (see is_eternal)",
    )
    # WHEN THE TERM BEGAN BEING COUNTED — and deliberately NOT `executed_at`.
    #
    # The two answer different questions and the difference is the reason this
    # column exists rather than a property over the one below:
    #
    #   * `executed_at` is when this office carried the disposition out. It is
    #     an operator's action stamped with the server's clock, it is always
    #     recent and always CE, and it moves if the paperwork is re-done. It is
    #     a fact about the record.
    #   * `term_start` is when the soul's term started running. It is a fact
    #     about the soul's afterlife, on the same historical calendar as its
    #     birth and death — a soul judged in 399 BCE has a term that began in
    #     399 BCE and a row somebody executed on a Tuesday afternoon.
    #
    # Deriving one from the other would have said the term began the day the
    # paperwork moved, which is the shape of invention `_greek_reading` refuses
    # when it declines to derive a start from `death_year`. "The disposition was
    # executed" and "the soul began serving" are two events and they get two
    # columns.
    #
    # This is the fact `SENTENCE_MISSING_INPUTS`' TERM_START member names (see
    # apps/ledger/readings.py). With it set, `_greek_reading` reports elapsed
    # years; without it, the reading is unchanged and still says what it lacks.
    #
    # Stored as signed year + optional month/day rather than a DateField, for
    # the reason apps/souls/dates.py gives: `datetime.date` has MINYEAR = 1 and
    # these dates are routinely BCE. `term_start` on the serializer is a
    # HistoricalDateField over these three columns, not a real field.
    #
    # NULL MEANS NOT RECORDED, the same convention `sentence_years` above uses
    # and for the same reason: no invented value. Every row written before this
    # column existed is null (see disposition/0011) and stays null until someone
    # records an actual start, because there is nothing in those rows to derive
    # one from.
    term_start_year = models.IntegerField(null=True, blank=True)
    term_start_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    term_start_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    is_executed = models.BooleanField(default=False)
    executed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='dispositions',
        null=True,
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Disposition"
        verbose_name_plural = "Dispositions"
        indexes = [
            models.Index(fields=["tenant", "created_at"]),
            models.Index(fields=["soul"]),
            models.Index(fields=["is_executed"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        realm = self.destination_realm.realm_code if self.destination_realm else "UNKNOWN"
        return f"{self.soul.name} → {realm}"

    @property
    def can_delete(self) -> bool:
        """False whenever this disposition is tied to a concluded verdict
        (the ordinary case — see class docstring). A disposition whose
        judgment link was cleared (judgment FK is on_delete=SET_NULL) has
        no verdict left to check and falls back to deletable."""
        return self.judgment is None or self.judgment.verdict is None

    def delete_or_raise(self, user=None, reason=""):
        """Soft-delete this disposition, or raise DeletionNotAllowedError
        (archivable=True) when it's tied to a concluded verdict."""
        from apps.core.archive import DeletionNotAllowedError

        if not self.can_delete:
            raise DeletionNotAllowedError(
                "This disposition is tied to a concluded judgment and cannot "
                "be deleted. Archive it instead.",
                archivable=True,
            )
        self.soft_delete(user=user, reason=reason)
