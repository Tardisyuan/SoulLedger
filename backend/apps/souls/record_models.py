"""
Soul record model — merit/demerit/judgment evidence attached to a soul.
"""
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import AuditUserFields
from apps.souls.dates import parse_historical_date, to_legacy_date
from apps.souls.models import Civilization, Soul
from apps.tenants.managers import TenantManager


class RecordType(models.TextChoices):
    MERIT = "MERIT", "Merit"
    DEMERIT = "DEMERIT", "Demerit"
    JUDGMENT = "JUDGMENT", "Judgment Evidence"
    DISPOSITION = "DISPOSITION", "Disposition Record"


class RecordCategory(models.TextChoices):
    # Merit categories
    CHARITY = "CHARITY", "Charity / Generosity"
    COMPASSION = "COMPASSION", "Compassion / Kindness"
    HONESTY = "HONESTY", "Honesty / Integrity"
    COURAGE = "COURAGE", "Courage / Bravery"
    WISDOM = "WISDOM", "Wisdom / Knowledge"
    PIETY = "PIETY", "Piety / Devotion"
    # Demerit categories
    CRUELTY = "CRUELTY", "Cruelty / Violence"
    DECEPTION = "DECEPTION", "Deception / Lying"
    COWARDICE = "COWARDICE", "Cowardice"
    GREED = "GREED", "Greed / Avarice"
    BLASPHEMY = "BLASPHEMY", "Blasphemy / Impiety"
    MURDER = "MURDER", "Murder / Killing"
    OTHER = "OTHER", "Other"


class SoulRecord(AuditUserFields, models.Model):
    """
    Individual event/record attached to a soul.
    evidence_json stores flexible structured evidence.
    Inherits AuditUserFields for audit trail and soft delete.

    Batch mode: Use SoulRecord.batch() context manager to defer karma
    recalculation until the batch completes, avoiding O(N²) cascade.

    Usage:
        with SoulRecord.batch():
            for item in items:
                SoulRecord.objects.create(soul=soul, ...)
        # Karma recalculation runs once per unique soul here
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="records",
    )
    record_type = models.CharField(max_length=20, choices=RecordType.choices)
    category = models.CharField(
        max_length=20,
        choices=RecordCategory.choices,
        default=RecordCategory.OTHER,
        help_text="Standardized category for this record",
    )
    civilization = models.CharField(
        max_length=20,
        choices=Civilization.choices,
        default=Civilization.CHINESE,
        help_text="Derived from soul's tenant (kept for query convenience)",
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="soul_records",
        null=True,
        blank=True,
    )
    objects = TenantManager()
    description = models.TextField()
    weight = models.IntegerField(
        default=1,
        help_text="Significance weight (1-100). Affects karma calculation.",
    )
    # Historical (possibly BCE) event date — see apps.souls.dates.
    # `event_date` below is a compatibility property, not a real column.
    event_year = models.IntegerField(
        null=True, blank=True, help_text="Signed year the event occurred, e.g. -612 = 612 BCE",
    )
    event_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    event_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    is_milestone = models.BooleanField(
        default=False,
        help_text="If true, weight is doubled (major life event)",
    )
    evidence_json = models.JSONField(default=dict, blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)

    # Acknowledgment of the `event_after_death` DateProblem WARNING — see
    # apps.souls.dates. There is no persistent "problem" row anywhere in
    # this system; DateProblems are computed fresh on every request. So
    # "acknowledged" cannot be a bare boolean: if it were, editing the
    # soul's death_date (or this record's event_date) later would silently
    # keep hiding a warning that is now about a *different* pair of dates
    # than the one an operator actually reviewed. These three fields
    # record who/when, plus a fingerprint of exactly the two values the
    # warning depends on, so a later mismatch makes the acknowledgment
    # stop applying instead of lying. See
    # apps.souls.dates.date_warning_fingerprint and
    # SoulViewSet.acknowledge_record_date_warning.
    date_warning_acknowledged_by = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="acknowledged_soul_record_date_warnings",
        help_text=(
            "Who acknowledged this record's event_after_death warning, if "
            "anyone. Always set from the acknowledging request's "
            "authenticated user, never from client-supplied data."
        ),
    )
    date_warning_acknowledged_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the event_after_death warning was acknowledged.",
    )
    date_warning_ack_fingerprint = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text=(
            "Snapshot of (event_date, soul.death_date) at acknowledgment "
            "time — see apps.souls.dates.date_warning_fingerprint. If "
            "either date has since changed, this no longer matches the "
            "live fingerprint: the acknowledgment stops applying and the "
            "warning reappears. Not cleared automatically — see the "
            "acknowledge endpoint's docstring for why."
        ),
    )

    # Batch mode flags (class-level, not instance)
    _batch_mode = False
    _deferred_souls = set()

    class Meta:
        ordering = ["-recorded_at"]
        verbose_name = "Soul Record"
        verbose_name_plural = "Soul Records"
        indexes = [
            models.Index(fields=["soul", "record_type"], name="idx_soulrecord_soul_type"),
            models.Index(fields=["soul", "recorded_at"], name="idx_soulrecord_soul_date"),
            models.Index(fields=["tenant", "recorded_at"], name="idx_soulrecord_tenant_date"),
            models.Index(fields=["record_type"], name="idx_soulrecord_type"),
            models.Index(fields=["civilization"], name="idx_soulrecord_civ"),
        ]

    def __str__(self):
        return f"{self.record_type}: {self.description[:50]}"

    @property
    def event_date(self):
        """Legacy DateField-shaped accessor. Not a stored column — see
        event_year/event_month/event_day. Returns None for BCE or
        year-only events (they can't be represented as datetime.date)."""
        return to_legacy_date(self.event_year, self.event_month, self.event_day)

    @event_date.setter
    def event_date(self, value):
        self.event_year, self.event_month, self.event_day = parse_historical_date(value)

    @classmethod
    def batch(cls):
        """Context manager for batch record creation.
        Defers karma recalculation until the batch completes.

        Usage:
            with SoulRecord.batch():
                for item in items:
                    SoulRecord.objects.create(soul=soul, ...)
        """

        class BatchContext:
            def __enter__(self_batch):
                cls._batch_mode = True
                cls._deferred_souls = set()
                return self_batch

            def __exit__(self_batch, exc_type, exc_val, exc_tb):
                cls._batch_mode = False
                # Flush deferred karma recalculations
                cls._flush_karma_recalculations()
                cls._deferred_soul_ids = set()
                return False

        return BatchContext()

    @classmethod
    def _flush_karma_recalculations(cls):
        """Run karma recalculation once per unique soul."""
        from apps.ledger.services import LedgerService
        for soul_id in cls._deferred_souls:
            try:
                soul = Soul.objects.get(pk=soul_id)
                LedgerService.recalculate_soul_ledger(soul)
            except Soul.DoesNotExist:
                pass

    def save(self, *args, **kwargs):
        is_new = self._state.adding
        # Auto-populate tenant from soul if not set
        if self.tenant is None and self.soul_id is not None:
            self.tenant = self.soul.tenant
        super().save(*args, **kwargs)
        if is_new:
            if SoulRecord._batch_mode:
                # Defer karma recalculation until batch completes
                SoulRecord._deferred_souls.add(self.soul_id)
            else:
                self._update_soul_karma()

    def _update_soul_karma(self):
        """Recalculate karma. Uses cache debounce only for bulk operations."""
        from apps.ledger.services import LedgerService
        LedgerService.recalculate_soul_ledger(self.soul)
