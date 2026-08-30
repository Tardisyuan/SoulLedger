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
        # The validators the help_text has been promising since this column
        # landed. `event_month` and `event_day` immediately below carry
        # Min/Max validators; `weight` -- the one field on this model that
        # arithmetic is done with -- carried none, and
        # `apps/souls/serializers.py` writes it straight through.
        #
        # Measured before this change:
        #     full_clean() accepted weight=-500   (help_text says 1-100)
        #     merit_score=-495  demerit_score=99  balance=-594
        #     LIFE pool = {'merit': -495.02, ..., 'unusable_merit': -495.02}
        # A negative-weight DEMERIT record drives `demerit_score` negative,
        # which makes the Egyptian `heart_weight` negative and
        # `heavier_than_feather` False -- a soul weighed lighter than the
        # feather by adding sins to it. There was no upper bound either, which
        # fed the bucket-overflow finding next door.
        #
        # 115 holds 64 records, weights 5..22, so this closes an input gap
        # rather than repairing live damage -- which is why no data migration
        # accompanies it.
        validators=[MinValueValidator(1), MaxValueValidator(100)],
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
    # ── 零積不抵整發: the two inputs the rule needs, and nothing more ────────
    #
    # 《太微仙君功過格·凡例》 second sentence: 「零積之十功不能折一次之十過也」
    # — ten merits earned a fraction at a time do not discharge one fault worth
    # ten at a stroke. `apps/ledger/fungibility.py` implements the first half of
    # that 凡例 (offset only within a pool) and could not implement this half,
    # because 一次 is a count of occasions and nothing here counted them. These
    # are the two fields its `GRANULARITY_MISSING_INPUTS` named, added under the
    # names it chose so the join it described is the join that exists.
    #
    # BOTH NULLABLE, AND THE RULE ONLY FIRES WHEN BOTH ARE PRESENT ON BOTH
    # SIDES OF AN OFFSET. Every row written before this migration has neither,
    # and there is no backfill that would not be an invention — the reason four
    # proxies were refused in fungibility.py is that no existing column implies
    # an occasion count. A record missing either field is granularity-unknown
    # and nets exactly as it did before, which is stated in the reading rather
    # than left for a reader to infer.
    #
    # WHY THE CLAUSE AND NOT THE STATUTE. 救濟門#7 carries two granularities in
    # one article — 「百錢為一功」 against 「一錢散施，積至百錢為一功」 — so an
    # article reference cannot say which reading scored this deed. The clause
    # can: `payload_json["clauses"]` on the seeded Statute is a list of
    # {condition_zh, points}, and `points` is the per-occasion value that 一次
    # means.
    #
    # WHY `condition_zh` AND NOT AN INDEX. A positional index into that list
    # shifts if the corpus is re-transcribed, silently repointing every record
    # that used it. The condition text is verbatim from 正統道藏; it changes
    # only when the reading of the source changes, which is exactly when a
    # reference to it *should* break rather than quietly follow.
    statute_clause = models.CharField(
        max_length=200, blank=True, default="",
        help_text=(
            "Which scoring clause this deed was scored under, as "
            "'<Statute.code>:<clause condition_zh>' — e.g. '救濟門#7:賑濟窮民百錢'. "
            "Blank means unknown, which makes this record granularity-blind."
        ),
    )
    occurrence_count = models.PositiveIntegerField(
        null=True, blank=True,
        help_text=(
            "How many separate occasions this row's weight covers. NOT a row "
            "count: one row may document a year of alms or three rows one "
            "killing. 1 means 一次 — earned or incurred at a stroke. Null means "
            "unknown, which makes this record granularity-blind."
        ),
    )

    # ── Which circle of Dante's Hell this deed belongs to, if any ──────────
    #
    # `_route_european` sorts by culpa — a magnitude ladder — and its own
    # docstring §3 says why: Dante does not layer Hell by how much wrong was
    # done. Virgil states the basis at Inf. XI.79-84 as Aristotle's
    # tripartition, and the wall of Dis is the poem's only real divider. The
    # ladder could not be replaced because nothing recorded a KIND.
    #
    # This is that field, and it cites rather than classifies. `EU-INF-*` is a
    # seeded corpus of 26 articles — the nine circles plus their seventeen
    # subdivisions — carrying `circle`, `kind` (girone/bolgia/zona), `index`,
    # the canto range, and the Aristotelian heading Virgil gives each. Citing
    # `EU-INF-C8-B2` says "eighth circle, second bolgia"; citing
    # `EU-INF-C9-Z1` says "Caina", which IS "treachery to kin". So the
    # vocabulary is the poem's, read off the corpus, and no taxonomy is
    # invented here.
    #
    # THAT DISTINCTION IS THE WHOLE POINT. docs/lore-verification/README.md §1
    # says completing the missing categories is "the one repair that is
    # certainly wrong", and 8308204 is what happened when it was tried — seven
    # Purgatorio terraces fitted to nine Inferno circles, three of them to
    # circles Dante gives them nowhere. A citation cannot make that mistake:
    # an article either exists in the corpus or the write is refused.
    #
    # TWO CIRCLES ARE DELIBERATELY NOT REACHABLE THIS WAY, and the corpus says
    # so itself by carrying `aristotle: None` for them. Limbo (C1) is not a sin
    # — it holds virtuous pagans and the unbaptised — and heresy (C6) is a
    # belief held in life rather than a deed done. Both are facts about a
    # person, so they live on `Soul`; see `baptism` and `denied_immortality`
    # there. A record citing either is refused on write.
    inferno_article = models.CharField(
        max_length=32, blank=True, default="",
        help_text=(
            "Which Inferno article this deed belongs under, as a Statute code "
            "in the EU-INF-* corpus — e.g. 'EU-INF-C7-G1' (seventh circle, "
            "first girone) or 'EU-INF-C9-Z1' (Caina). Blank means unclassified, "
            "which leaves the European router on its culpa ladder for this deed."
        ),
    )

    is_milestone = models.BooleanField(
        default=False,
        help_text=(
            "Marks a turning point in the life. Display only — the lifecycle "
            "timeline stars and tints it. It does NOT change the deed's weight."
        ),
    )
    # The help_text used to promise "weight is doubled". Nothing ever doubled
    # it: LedgerService applies _decay_weight and nothing else. Restoring the
    # promise would have been the wrong repair on three counts. `weight` is
    # already settable on the same serializer, so a multiplier would be a
    # second, hidden way to set it — and ticking a display checkbox is a
    # surprising way to move an audited balance. The decay rate is per-tenant
    # configuration (see _decay_rate_for); a flat 2x applied identically to all
    # three cosmologies is the flattening this ledger exists to refuse. And the
    # field is already load-bearing as a marker: SoulLifecycleTimeline stars it.
    # LedgerServiceMilestoneTests pins the decision so it cannot drift back.
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
