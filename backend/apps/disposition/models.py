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


class DispositionSection(models.TextChoices):
    """`/disposition` 页面的三段。由 `is_executed` 与 `expired_at` 推出,不另存。"""
    PENDING = "pending", "待执行"
    EXECUTING = "executing", "执行中"
    EXPIRED = "expired", "期满"


#: 每一段的过滤条件。三段互斥且覆盖全部行(`disposition_expired_only_if_executed`
#: 保证「期满」一定已执行),列表的 `?section=` 与分段计数读的是同一份。
SECTION_FILTERS = {
    DispositionSection.PENDING: models.Q(is_executed=False),
    DispositionSection.EXECUTING: models.Q(is_executed=True, expired_at__isnull=True),
    DispositionSection.EXPIRED: models.Q(expired_at__isnull=False),
}


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
        validators=[MinValueValidator(0)],
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
    # NULL MEANS NOT RECORDED, the same convention `sentence_years` above uses.
    #
    # 2026-09-25 产品负责人决定:执行即开始服刑。所以 `DispositionService._mark_executed`
    # 在执行时把**空的**起算日记成执行那天(已记的史实起算日不覆盖),而执行过却仍为空的
    # 存量行,期满计算从执行日起算(`apps.disposition.expiry.effective_term_start`)——
    # 不回填数据。上面「两列、两件事」仍然成立:判官记了起算日,两者就各是各的。
    term_start_year = models.IntegerField(null=True, blank=True)
    term_start_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    term_start_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    is_executed = models.BooleanField(default=False)
    executed_at = models.DateTimeField(null=True, blank=True)
    # 期满:刑期已经走完的那一刻被系统记下的时间。null = 还没期满(或永远不会)。
    #
    # 一个时间戳而不是一列状态,因为这个模型本来就没有状态列:它的「状态机」是
    # `is_executed` / `executed_at` 这一对,期满是在它后面接的第三步,用同一个写法。
    # 三段(待执行 / 执行中 / 期满)由这两列推出来,见 `SECTION_FILTERS`。
    #
    # 只由 `apps.disposition.expiry` 写 —— 那里说了「期满」怎么算、为什么永久刑、
    # 没记刑期、没记起算日的处置永远不写它。不写回 null:期满不可撤销,
    # 刑期被改长是另一件事(见 云端报告 disposition-expiry-precedents(已移出仓库,存于项目记忆目录) 的开放问题)。
    expired_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='dispositions',
        null=True,
    )

    # 第几世。与 SoulRecord.cycle 同义:0 是第一世。灵魂端「前世」按
    # (soul, cycle) 一次查出各世数据,不沿账号链递归
    # (docs/ARCHITECTURE-soul-app-and-domain-split.md 2026-09-17「实施约束」)。
    # 由 save() 在创建时盖章;存量行由迁移按转世时间回填。
    cycle = models.PositiveIntegerField(
        default=0,
        help_text="Life index this row belongs to; 0 is the first life.",
    )

    # 受刑计划里挂着这份处置的节点(docs/ARCHITECTURE-sentence-plan.md §2.4)。裸 UUID:
    # 节点在原属库,处置在执行地库。外地节点的处置没有本地审判(`judgment` 为空),
    # 这一列让它仍然算「系于结论」而不可删 —— 见 `can_delete`。
    sentence_node_id = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Disposition"
        verbose_name_plural = "Dispositions"
        indexes = [
            models.Index(fields=["tenant", "created_at"]),
            models.Index(fields=["soul"]),
            models.Index(fields=["is_executed"]),
            models.Index(fields=["soul", "cycle"]),
        ]
        constraints = [
            # 实测接受 −5000,且能从 API 写进去。一个负的刑期不是一个短刑期,
            # 它是一个没有意义的数,而 `is_eternal` 已经承担了「无期」这个含义。
            # `null` 仍然合法:那表示「没有记录刑期」,与「刑期是 0」不同。
            models.CheckConstraint(
                condition=models.Q(sentence_years__isnull=True)
                | models.Q(sentence_years__gte=0),
                name="disposition_sentence_years_not_negative",
            ),
            # 没执行过的处置没有在服的刑,也就谈不上期满。
            models.CheckConstraint(
                condition=models.Q(expired_at__isnull=True) | models.Q(is_executed=True),
                name="disposition_expired_only_if_executed",
            ),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def save(self, *args, **kwargs):
        # 创建时盖上当前是第几世;显式给了非 0 值的调用方(迁移、测试)不覆盖。
        # 与 SoulRecord.save 同一写法。
        if self._state.adding and self.cycle == 0 and self.soul_id is not None:
            self.cycle = self.soul.life_index
        super().save(*args, **kwargs)

    def __str__(self):
        realm = self.destination_realm.realm_code if self.destination_realm else "UNKNOWN"
        return f"{self.soul.name} → {realm}"

    @property
    def section(self) -> str:
        """这一行落在页面的哪一段 —— 与 `SECTION_FILTERS` 同一个判定。"""
        if self.expired_at is not None:
            return DispositionSection.EXPIRED
        if self.is_executed:
            return DispositionSection.EXECUTING
        return DispositionSection.PENDING

    @property
    def can_delete(self) -> bool:
        """False whenever this disposition is tied to a concluded verdict
        (the ordinary case — see class docstring). A disposition whose
        judgment link was cleared (judgment FK is on_delete=SET_NULL) has
        no verdict left to check and falls back to deletable.

        A disposition a sentence node points at is tied to a conclusion even
        with no local judgment: the away tenant carries out what the joint
        judgment decided (docs/ARCHITECTURE-sentence-plan.md §2.4)."""
        if self.sentence_node_id is not None:
            return False
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
