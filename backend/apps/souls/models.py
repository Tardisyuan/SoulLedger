"""
Soul core model + state machine.
"""
import logging
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.souls.dates import parse_historical_date, to_legacy_date
from apps.souls.querysets import SoulManager

logger = logging.getLogger(__name__)


class Civilization(models.TextChoices):
    CHINESE = "CHINESE", "Chinese Diyu"
    EUROPEAN = "EUROPEAN", "European Heaven/Hell"
    EGYPTIAN = "EGYPTIAN", "Egyptian Duat"
    # GREEK IS A FOURTH COSMOLOGY, NOT A REGION OF THE EUROPEAN ONE.
    #
    # It used to be filed under EUROPEAN, and that was never a claim anybody
    # checked: Hades, Aeacus and Rhadamanthus stood in EU_PLATO_MEADOW — Plato's
    # fork in the road, Gorgias 524a — while carrying the civilization of a
    # tenant whose other rows are the Nicene Creed's judgment and Dante's nine
    # circles. The two systems answer different questions with different
    # instruments: Dante's judgment is *poena* after *culpa* is forgiven, and
    # Plato's is a fixed term served (Republic X, 615a-b). One enum member
    # cannot carry both, and while it did, the Greek rows were reachable only
    # through the European tenant and inherited European routing, European
    # case types and the European ledger reading by default.
    #
    # WHAT DELIBERATELY DID NOT MOVE. Minos, Cerberus and Charon stay EUROPEAN,
    # because their text anchor in this repository is Dante and not the Greeks:
    # Minos allots the circle at the entrance to the second (Inf. V.4-15),
    # Cerberus stands over the gluttons in the third (Inf. VI), Charon works
    # Acheron at the gate of hell (Inf. III). Plato's Minos is a *separate row*
    # under GREEK — the two are different offices in different underworlds
    # (Gorg. 524a's final arbiter at the fork vs the coiling tail of Inf. V),
    # which is what the actor row itself has said all along.
    GREEK = "GREEK", "Greek Underworld"


# The one place tenant codes and cosmologies meet. A tenant is an
# administrative record; a civilization is a claim about what happens to the
# dead. Which tenant speaks for which cosmology is a fact about this
# deployment's configuration, so it is written down once, here, rather than
# re-derived at each call site.
TENANT_CIVILIZATION = {
    "CN_DIYU": Civilization.CHINESE,
    "EU_HEAVEN_HELL": Civilization.EUROPEAN,
    "EG_DUAT": Civilization.EGYPTIAN,
    # GREEK NEEDS ITS OWN TENANT OR IT CAN NEVER HOLD A SOUL.
    #
    # `Soul.civilization` is derived from the soul's tenant through this map and
    # from nothing else (see the property below). A GREEK enum member with no
    # tenant code pointing at it would therefore be unreachable by construction:
    # no soul could ever read GREEK, so its routing branch, its ledger reading
    # and its workflow templates would all be dead code that no test could
    # distinguish from working code.
    "GR_HADES": Civilization.GREEK,
}

# The same fact read backwards: which tenant speaks for a given cosmology.
# Derived rather than written out a second time, because the copies are what
# went wrong — this mapping existed in three more places (the Soul filterset,
# the multitenant backfill command, the seed script), each free to drift from
# the one above and from each other, and one of them defaulted an unrecognised
# civilization to the Chinese tenant. Callers that need this direction (a
# filter turning ?civilization=EGYPTIAN into a tenant lookup, a seeder deciding
# where a row belongs) import it instead of writing their own.
#
# Inverting assumes one tenant per cosmology, which is what this deployment
# configures. A second CHINESE tenant would silently lose to whichever came
# last in TENANT_CIVILIZATION — a reason to revisit the shape of both maps if
# that ever becomes a real configuration, not a reason to keep hand-written
# copies around.
CIVILIZATION_TENANT = {
    civilization: code for code, civilization in TENANT_CIVILIZATION.items()
}

# What a soul's cosmology is when nothing in the configuration says.
#
# This used to be Civilization.CHINESE — an unrecognised tenant code fell
# through to the first entry in the map. That was never a decision anyone
# made, it was the default argument of a dict lookup showing through, and it
# had a consequence nobody chose either: Chinese Diyu was then the one
# rebirth-capable cosmology modelled here (Greek has since joined it), so
# *unknown* silently meant *reborn*. A soul in a
# misconfigured or freshly created tenant was handed a next life on the
# strength of a typo. Guessing wrong about a cosmology is not a cosmetic error
# — it decides whether a soul is annihilated, admitted, or sent round again.
#
# Deliberately NOT a member of the Civilization TextChoices above. Two reasons,
# and the second is the load-bearing one:
#
#   1. "Unknown" is not a civilization. No one worships in it and nothing
#      happens to you there. It is the absence of an answer, and giving it a
#      seat alongside Diyu and the Duat would make the absence look like one
#      more afterlife on the list — in every dropdown, filter, and chart legend
#      that renders Civilization.choices.
#   2. Civilization.choices is the `choices=` argument of model fields in five
#      apps (actors, judgment, realms, workflow, souls). Adding a member
#      rewrites all five field definitions and demands an AlterField migration
#      in each — a schema change across the codebase to express "we don't
#      know", which is a large blast radius for a value no row should ever
#      legitimately store.
#
# Being a plain str keeps it safe everywhere a civilization is read as text
# (serializers, event payloads, __str__, CSV export) while failing every
# `== Civilization.X` and every `in REBIRTH_CAPABLE_CIVILIZATIONS` membership
# test — which is exactly the behaviour wanted. Unknown must not be quietly
# routed anywhere; it must fall to whatever each caller does when it does not
# recognise a cosmology.
UNKNOWN_CIVILIZATION = "UNKNOWN"


class SoulState(models.TextChoices):
    ALIVE = "ALIVE", "Alive"
    JUDGING = "JUDGING", "Under Judgment"
    DISPOSED = "DISPOSED", "Disposed"
    REINCARNATING = "REINCARNATING", "Reincarnating"
    # Where a soul stops. Two of the four cosmologies modelled here have no next
    # life: Egyptian judgment ends at Aaru or in Ammit's jaws, and European
    # (Dante) judgment ends at Heaven, Hell, or Purgatory-then-Heaven — the
    # Purgatorio empties upward, never back into a new birth. (Diyu has one, and
    # so does Plato's circuit: Republic X 617d-620d.) Every executed
    # disposition used to move its soul to REINCARNATING regardless, so a soul
    # admitted to the Field of Reeds was labelled as queued for a rebirth its
    # cosmology does not have. The rebirth *machinery* already refused those
    # souls (REBIRTH_CAPABLE_CIVILIZATIONS in apps/ledger/services.py); it was
    # only the label that lied, and a label that lies is what the dashboards
    # and the state filters read.
    #
    # "Settled" in the ledger sense — the account is closed — rather than
    # "at rest" or "eternal", which would be false for a soul Ammit has
    # devoured. What Aaru and the Devourer have in common is not peace; it is
    # that nothing further is owed either way.
    SETTLED = "SETTLED", "Settled (Final)"
    LOST = "LOST", "Lost/Suspended"


class Soul(ArchivableMixin, AuditUserFields, models.Model):
    """
    Core soul entity. All other records link back to a Soul.
    Civilization is now derived from tenant FK.

    Deletion (Stage 4 §4.7): a soul with no concluded judgment can still be
    soft-deleted, cascading to its karma/demerit records (SoulRecord) and any
    pending (verdict-less) judgments under one delete_cascade_id — see
    delete_with_cascade() and apps.core.recycle_bin. Once any judgment on
    this soul has a verdict, the soul is archivable instead: see
    has_concluded_judgment and ArchivableMixin.archive().
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
    # 阳寿 / 生死簿 (2026-10-24, 地府 only): the date this life was allotted to end, entered by an officer.
    # A death registered before it is untimely (横死): the soul waits in 枉死城 and its judgment cannot be
    # claimed until this date (Soul.die). Empty = not recorded, judged as usual.
    fated_death_year = models.IntegerField(null=True, blank=True)
    fated_death_month = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)]
    )
    fated_death_day = models.SmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    origin_location = models.CharField(max_length=255, blank=True)

    #: Which judge of the Greek meadow tries this soul (2026-10-19): Gorgias 524a gives Rhadamanthus the dead
    #: of Asia and Aeacus those of Europe, Minos only when they are in doubt. A recorded fact, not inferred from
    #: `origin_location` — that is free text. Blank is 不详, and the Greek flow then goes straight to Minos
    #: (`apps/workflow/conditions.py` reads blank as UNKNOWN).
    class OriginRegion(models.TextChoices):
        EUROPE = "EUROPE", "欧洲"
        ASIA = "ASIA", "亚洲"

    origin_region = models.CharField(max_length=8, choices=OriginRegion.choices, blank=True, default="")

    #: 埃及(2026-10-27,review P2-9):亡者未得审判的三种情形(docs/01 §4.2),官员登记,与阳寿同样是在死亡
    #: 登记之前记下的事实。空 = 葬仪如常:木乃伊 70 天后启程入殿(02 §1.1)。葬仪不当包括 03 §六 的通关要素
    #: (身体完整、咒语、自我介绍、知神名)—— 它们都是葬仪备下的。只有埃及读它(`Soul.opening_fields`)。
    class DuatPassage(models.TextChoices):
        EARLY_DEATH = "EARLY_DEATH", "婴儿或早夭"
        NAMELESS = "NAMELESS", "无名者"
        IMPROPER_BURIAL = "IMPROPER_BURIAL", "葬仪不当"

    duat_passage = models.CharField(max_length=20, choices=DuatPassage.choices, blank=True, default="")
    birth_name = models.CharField(max_length=255, blank=True)  # name at birth
    description = models.TextField(blank=True)

    # Karma summary (denormalised for performance, updated via signal/service)
    # ── The two Inferno circles that are not about anything a soul DID ─────
    #
    # `SoulRecord.inferno_article` cites the corpus for deeds, which reaches
    # seven of the nine circles. Two are not deed classifications and the
    # corpus says so by carrying `aristotle: None` for both — Virgil's Inf. XI
    # tripartition gives them no heading, because one is not a sin and the
    # other is a belief.
    #
    # BOTH ARE FACTS ABOUT A PERSON, WHICH IS WHY THEY ARE HERE. On a record
    # they would let two deeds of one soul disagree about whether that soul was
    # baptised, which is not a thing that can be true.

    #: Limbo (Inf. IV) holds "those who did not sin, and yet had merit" —
    #: virtuous pagans who lived before Christ, and the unbaptised. Not a
    #: punishment: Virgil is there himself. So this records whether baptism was
    #: HAD, not whether it was refused, and NOT_APPLICABLE is for the souls
    #: Dante puts there by era rather than by choice.
    #:
    #: UNRECORDED is the default and the only honest one for existing rows.
    #: Nothing in this database has ever asked, and inferring it from a death
    #: date would be inventing a baptismal record from a calendar.
    class Baptism(models.TextChoices):
        UNRECORDED = "UNRECORDED", "未记录"
        BAPTISED = "BAPTISED", "已受洗"
        UNBAPTISED = "UNBAPTISED", "未受洗"
        BEFORE_CHRIST = "BEFORE_CHRIST", "生于基督之前"

    baptism = models.CharField(
        max_length=16, choices=Baptism.choices, default=Baptism.UNRECORDED,
        help_text=(
            "Whether this soul was baptised. Limbo (Inf. IV) is the only "
            "circle this reaches, and it is not a punishment — Virgil is there. "
            "UNRECORDED means nobody asked, which is every row written before "
            "this column existed."
        ),
    )

    #: Dante's heretics (Inf. IX-XI) are not the generally heterodox. They are
    #: the Epicureans, "who with the body make the spirit die" (Inf. X.13-15,
    #: Longfellow) — Farinata and Cavalcante are there for that specific claim.
    #: `RecordCategory.BLASPHEMY` is NOT this: blasphemy is violence against
    #: God, the third ring of the seventh circle (Inf. XIV), and reading one as
    #: the other is the shape of the mistake 8308204 was withdrawn for.
    #:
    #: Named for the claim rather than for the label, so that "was this person
    #: a heretic" — a question this system cannot answer and Dante does not ask
    #: — never gets typed into it.
    denied_immortality = models.BooleanField(
        null=True, blank=True, default=None,
        help_text=(
            "Whether this soul held, in life, that the spirit dies with the "
            "body (Inf. X.13-15) — the specific claim Dante's sixth circle "
            "punishes. NOT a general heresy flag, and not blasphemy, which is "
            "Inf. XIV. Null means unrecorded."
        ),
    )

    merit_score = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    demerit_score = models.IntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    # Set when a deferred recalculation (`SoulRecord.batch()`, which runs after its records have committed)
    # failed: the records exist but merit/demerit are stale. Cleared by the next successful
    # `LedgerService.recalculate_soul_ledger` (the periodic `recalculate_tenant_ledgers` run reaches every soul).
    needs_ledger_recalculation = models.BooleanField(default=False, db_index=True)
    # What the previous life handed to this one. `complete_rebirth` writes
    # the carried-over share here as well as into merit_score/demerit_score,
    # because the latter two are re-derived by every recalculation: without a
    # base to start from, the first deed of the new life reset the score to
    # that deed alone (or, before records carried a life index, to the whole
    # previous life again). 0/0 for a soul never reborn.
    inherited_merit = models.IntegerField(
        default=0, validators=[MinValueValidator(0)],
    )
    inherited_demerit = models.IntegerField(
        default=0, validators=[MinValueValidator(0)],
    )
    #: 本世饮孟婆汤的时刻(2026-10-25,只在地府):地府的灵魂转世前必须有它(`complete_rebirth` 409 `soup_not_taken`)。
    #: 每世一次:转世完成时清空。只经 `apps/reincarnation/services.py::drink_soup` 写。
    soup_taken_at = models.DateTimeField(null=True, blank=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='souls',
        null=True,
    )
    # 原属租户(2026-09-17 用户决定:跨文明调拨是**暂居**,不是迁籍)。
    #
    # `tenant` 是「此刻由谁管辖」:审判、处置、功过读法、官员可见性都跟它走,
    # 调拨执行时它切到目标租户,目标文明的官员据此执行处置 —— 租户隔离沿用现状。
    # `home_tenant` 是「属于哪个文明」:转生资格、转生申请与申诉、灵魂账号都跟它走,
    # 调拨不改它。`tenant != home_tenant` 就是暂居;处置执行完毕或官员手动结束暂居时
    # `tenant` 回到 `home_tenant`(apps/dispatch/services.py::DispatchService.end_residence)。
    #
    # 可空只因为 `tenant` 可空;新建时由 save() 置为 tenant,迁移 0036 把存量回填为当前 tenant。
    home_tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='home_souls',
        null=True,
        editable=False,
        help_text="原属租户:调拨暂居期间不变;转生资格按它的文明计算。",
    )

    # 灵魂编号 —— 灵魂端 App 的登录名(docs/ARCHITECTURE-soul-app-and-domain-split.md
    # 2026-09-17「登录名」)。此前 Soul 上没有任何稳定的业务编号(只有 UUID 主键),
    # 所以新增。全局唯一而非租户内唯一:登录请求不带租户,身份是全局的(同文档 §3)。
    # 可空:只在第一次开通账号时分配(apps/soul_accounts/services.py),分配后不再变,
    # 所以不需要为存量灵魂回填 —— 从没开过号的灵魂没有登录名也不需要。
    soul_code = models.CharField(
        max_length=16, unique=True, null=True, blank=True, editable=False,
        help_text="灵魂编号:灵魂端登录名,首次开通账号时分配,之后不变。",
    )
    # 联系方式:只用于投递初始密码。个人信息 —— 不在 SoulSerializer 的字段里
    # (官员侧只能经 soul_account.read 看到脱敏值),审计 diff 里值被遮蔽
    # (apps/audit/signals.py::PII_FIELD_NAMES)。
    contact_email = models.EmailField(blank=True, default="")
    contact_phone = models.CharField(
        max_length=20, blank=True, default="",
        validators=[RegexValidator(r"^\+?[1-9]\d{6,14}$", "手机号须为 7-15 位数字,可带 + 前缀")],
    )

    # CSV 批量导入的批次号(apps/souls/importer.py)。同一次提交创建的灵魂共用一个,
    # 列表据此过滤出「这一批」。手工新建、调拨等其他来源的灵魂为空。
    import_batch = models.UUIDField(null=True, blank=True, editable=False, db_index=True)

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Soul"
        verbose_name_plural = "Souls"
        indexes = [
            models.Index(fields=["tenant", "current_state"]),
            models.Index(fields=["current_state"]),
            # The default list order is `-create_time`, always inside one tenant;
            # without this PostgreSQL sorts the tenant's rows on every page.
            models.Index(fields=["tenant", "-create_time"], name="souls_soul_tenant_created_idx"),
            models.Index(fields=["tenant", "name"], name="souls_soul_tenant_name_idx"),
        ]
        constraints = [
            # 参与算术或路由决策的字段,过去一个约束都没有。`full_clean()` 实跑:
            # `merit_score` 接受 −999999。对照:同一批模型里 birth/death/event 的
            # month/day 都带 Min/Max —— **带约束的都是日期,参与算术的一个都没有。**
            #
            # validator 与 CheckConstraint 两道都加,守的不是同一条路:validator
            # 被 DRF 的 ModelSerializer 抄进序列化器字段(API),CheckConstraint 由
            # 数据库执行(ORM 直写、shell、迁移的数据步骤)。只加前者会得到一条
            # `Model.save()` 不执行的规则 —— 见 `Statute.clean()` 那条。
            #
            # 下限 0:`_route_european` 的注释断言「culpa 是过失总额所以永不为负」,
            # 而那句话此前是替一个没有任何约束的列做的保证。
            models.CheckConstraint(
                condition=models.Q(merit_score__gte=0),
                name="soul_merit_score_not_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(demerit_score__gte=0),
                name="soul_demerit_score_not_negative",
            ),
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
        # 停用的殿不收新灵魂(2026-10-25 用户决定):数据都留着,只是不再登记。
        if is_new and not self.tenant.is_active:
            from django.core.exceptions import ValidationError
            raise ValidationError("This hall is deactivated and accepts no new souls.", code="hall_inactive")
        if is_new and self.home_tenant_id is None:
            self.home_tenant_id = self.tenant_id

        if not is_new:
            super().save(*args, **kwargs)
            return

        # SOUL_CREATED is part of the soul's creation: one transaction, so a failed event insert un-creates it.
        from django.db import transaction

        from apps.events.services import EventService
        with transaction.atomic():
            super().save(*args, **kwargs)
            EventService.log_soul_created(self)

    def __str__(self):
        return f"{self.name} ({self.civilization}) [{self.current_state}]"

    @property
    def civilization(self) -> str:
        """Derive civilization from tenant code.

        Returns UNKNOWN_CIVILIZATION — not a Civilization member — when the
        tenant is missing or its code is not in TENANT_CIVILIZATION. See that
        constant for why an unrecognised tenant must not resolve to Chinese
        Diyu, and why "unknown" is not itself one of the choices.
        """
        if self.tenant_id is None:
            return UNKNOWN_CIVILIZATION
        return self.tenant.civilization

    @property
    def home_civilization(self) -> str:
        """原属文明:转生资格只问这个(暂居不改变灵魂属于哪个宇宙观)。
        `civilization` 仍是管辖文明 —— 审判方法、处置路由、功过读法按它。"""
        if self.home_tenant_id is None:
            # 只有绕过 save() 的写法(bulk_create)会留下空值;那样的灵魂从未被调拨过,
            # 退回管辖文明,而不是把它判成「未知文明、没有转生」。
            return self.civilization
        return self.home_tenant.civilization

    @property
    def is_residing(self) -> bool:
        """被调拨到别的文明暂居中。"""
        return self.home_tenant_id is not None and self.tenant_id != self.home_tenant_id

    @property
    def karmic_balance(self) -> int:
        return self.merit_score - self.demerit_score

    @property
    def has_concluded_judgment(self) -> bool:
        """True once any judgment on this soul carries a verdict.

        Stage 4 §4.7: this is the gate between "soft-deletable" and
        "archivable instead" for a soul — not current_state, and not
        is_final, because a verdict can exist before a judgment is marked
        final. A soul with only pending (verdict-less) judgments is still
        an ordinary soft delete.
        """
        return self.judgments.filter(verdict__isnull=False).exists()

    def delete_with_cascade(self, user=None, reason=""):
        """Soft-delete this soul and cascade to its dependent karma/demerit
        records and pending judgments, all under one delete_cascade_id —
        see apps.core.recycle_bin.cascade_soft_delete. Refuses (raises
        DeletionNotAllowedError) once the soul has a concluded judgment; call
        archive() instead in that case.

        Only SoulRecord and pending Judgment rows are cascaded — the two
        dependent types the design doc names explicitly. Other soul-linked
        records (dispatch history, workflow approvals, ...) are not cascaded
        here; they would need the same treatment in a later pass.
        """
        from apps.core.archive import DeletionNotAllowedError
        from apps.core.recycle_bin import cascade_soft_delete
        from apps.judgment.models import Judgment
        from apps.souls.record_models import SoulRecord

        if self.has_concluded_judgment:
            raise DeletionNotAllowedError(
                "This soul has a concluded judgment and cannot be deleted. "
                "Archive it instead.",
                archivable=True,
            )

        dependents = list(SoulRecord.objects.filter(soul=self)) + list(
            Judgment.objects.filter(soul=self, verdict__isnull=True)
        )
        return cascade_soft_delete(self, dependents, user=user, reason=reason)

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

    @property
    def life_index(self) -> int:
        """0 until the first rebirth, N after the N-th. Equals the
        `cycle_count` of the Reincarnation that began this life."""
        return self.reincarnations.count()

    def current_life_records(self):
        """This life's records only. The ledger, the summary endpoint and the
        routing helpers all read through here; `self.records` is every life."""
        return self.records.filter(cycle=self.life_index)

    #: Edges only a named system action may take, never a person (user 2026-10-27). `can_transition_to` allows
    #: one only when the caller passes its `system` reason; `POST /souls/{id}/transition/` passes none.
    #: DISPOSED → JUDGING: a refused Egyptian weighing is weighed again (apps/judgment/weighing.py
    #: ::reweigh_after_rejection), its unexecuted disposition voided first.
    SYSTEM_ONLY_TRANSITIONS = {("DISPOSED", "JUDGING"): "weighing_rejected"}

    def can_transition_to(self, new_state: str, *, system: str | None = None) -> bool:
        """
        State machine guard. Returns True if the transition is valid.
        `system` names the system action asking for a system-only edge (SYSTEM_ONLY_TRANSITIONS).
        """
        only_for = self.SYSTEM_ONLY_TRANSITIONS.get((self.current_state, new_state))
        if only_for is not None:
            return system == only_for
        valid_transitions = {
            SoulState.ALIVE: [SoulState.JUDGING],
            SoulState.JUDGING: [SoulState.DISPOSED],
            # A disposed soul goes one of three ways: back round the wheel, to
            # a final destination its cosmology has no exit from, or missing.
            # Which of the first two is not a choice — see
            # DispositionService.execute.
            SoulState.DISPOSED: [
                SoulState.REINCARNATING,
                SoulState.SETTLED,
                SoulState.LOST,
            ],
            # Back to DISPOSED only when a finished sentence plan is reopened (2026-10-18 user decision): a
            # cross-realm judgment concluded PASS after the plan completed adds its stops to that plan
            # (apps/sentence_plan/requests.py::append_cross_stops). Not reachable through
            # `POST /souls/{id}/transition/` (apps/souls/views.py refuses it there).
            SoulState.REINCARNATING: [SoulState.ALIVE, SoulState.DISPOSED],
            # SETTLED has exactly one exit, back to DISPOSED, and one writer of it: a cross-realm judgment
            # concluded PASS after the soul's sentence plan finished reopens that plan and appends the
            # foreign stops (apps/sentence_plan/requests.py::append_cross_stops; 2026-10-18 user decision).
            # The plan is unfinished business, so the case was not closed after all. Not reachable through
            # `POST /souls/{id}/transition/` (apps/souls/views.py refuses it there), and correcting a
            # mistaken settlement is still `correct_settlement`, its own event.
            #
            # SETTLED deliberately does not keep LOST reachable the way
            # DISPOSED does. LOST means the disposition was
            # never carried through and the soul went missing on the way to
            # its realm — something that can only happen in transit. Once a
            # soul is in Aaru, or in Ammit, or in the Empyrean, there is no
            # transit left to fail; mislaying the *record* afterwards is a
            # bookkeeping problem, not a change in what became of the soul.
            # Letting an administrative mistake re-open a cosmologically closed
            # case is exactly the lie this state exists to stop telling.
            SoulState.SETTLED: [SoulState.DISPOSED],
            # Recalled: found again, back in transit to the realm its disposition named (2026-10-24 user
            # decision: a minimal way in and out, no pursuit workflow). Both moves need a written reason
            # (apps/souls/views.py::transition); the STATE_CHANGED event and the audit row keep it.
            SoulState.LOST: [SoulState.DISPOSED],
        }
        return new_state in valid_transitions.get(self.current_state, [])

    def transition_to(
        self, new_state: str, reason: str = "", *, account_origin: str = "OFFICER", actor: str = "system",
        system: str | None = None, **kwargs
    ) -> bool:
        """
        Attempt state transition with pessimistic locking to prevent race conditions.
        Returns True if successful.
        """
        from django.db import transaction

        from apps.events.services import log_soul_state_change

        with transaction.atomic():
            # Lock the row to prevent concurrent state mutations.
            #
            # `all_objects`, then check `is_deleted` explicitly. `Soul.objects`
            # filters soft-deleted rows out, so this used to raise
            # `Soul.DoesNotExist` for a soft-deleted soul instead of returning
            # False — a 500 where the contract says "returns False when the
            # move is not available". Both view entry points already exclude
            # deleted rows, so nothing reaches it today; the service layer is
            # callable from elsewhere and should refuse cleanly.
            locked_soul = Soul.all_objects.select_for_update().get(pk=self.pk)
            if locked_soul.is_deleted:
                logger.warning(
                    "Refused %s for %s: the soul is soft-deleted.",
                    new_state,
                    self.pk,
                )
                return False
            if not locked_soul.can_transition_to(new_state, system=system):
                return False

            old_state = locked_soul.current_state
            locked_soul.current_state = new_state

            # A terminal cosmology has no next life. `SoulState.SETTLED`
            # exists to say so, and `apps/reincarnation/views.py` states
            # plainly that writing REINCARNATING onto such a soul "is the
            # outcome SoulState.SETTLED exists to prevent" -- which is why
            # complete() and reborn() both call `assert_rebirth_capable`
            # first.
            #
            # That gate was installed on those two doors only.
            # `POST /souls/{id}/transition/` drove the same edge with no check
            # at all: measured 2026-08-29, an EG_DUAT soul in DISPOSED went
            # REINCARNATING then ALIVE in two 200s, ending with
            # reincarnations=0, merit and demerit uninherited, and its previous
            # life's description intact -- no Meng Po, no Lethe, no spell of
            # forgetting. GUARDIAN, JUDGE and MODERATOR all managed it.
            #
            # The check belongs here rather than on the action, because "which
            # doors have the gate" is the question that produced the hole. Any
            # future writer of this edge inherits it.
            # 暂居中不进轮回、也不进终局(2026-09-17:调拨是暂居)。下一世还是终局,
            # 由原文明在灵魂回归之后决定;暂居租户替它决定,等于把迁籍从后门做回来。
            if locked_soul.is_residing and new_state in (SoulState.REINCARNATING, SoulState.SETTLED):
                logger.warning(
                    "Refused %s for %s: the soul is residing away from its home tenant.",
                    new_state,
                    self.pk,
                )
                return False

            if new_state == SoulState.REINCARNATING:
                from apps.ledger.services import (
                    REBIRTH_CAPABLE_CIVILIZATIONS,
                )

                # 原属文明:暂居不改变灵魂有没有下一世。
                if locked_soul.home_civilization not in REBIRTH_CAPABLE_CIVILIZATIONS:
                    logger.warning(
                        "Refused REINCARNATING for %s: %s is a terminal "
                        "cosmology.",
                        self.pk,
                        locked_soul.home_civilization,
                    )
                    return False

            # `death_date` is a legacy compatibility property, not a column.
            # `apps/souls/dates.py::to_legacy_date` returns None for anything
            # `datetime.date` cannot express -- every BCE year, and every
            # partial date missing a month or a day. Testing it here read
            # "Python cannot represent this" as "no death date was recorded",
            # and overwrote the real one with today.
            #
            # Measured 2026-08-29 through the API: a soul created with
            # death_date {"year": -399, "month": 5, "day": 7} read back
            # correctly and stored death_year=-399/5/7, while the legacy
            # property was None. One transition to JUDGING rewrote it to
            # 2026-08-29. Nothing was missing; the date was complete.
            #
            # This is the second consumer to disagree with the validator that
            # accepts these dates (the first was LedgerService._day_of_year and
            # February 29th). Egyptian and Greek material is BCE by nature, and
            # the ledger's decay anchor is the death date -- so the whole decay
            # baseline moved with it.
            #
            # `death_year` is the column. A year of 0 is a real year in this
            # project's convention, so the test is `is None`, not falsiness.
            if new_state == SoulState.JUDGING and locked_soul.death_year is None:
                from django.utils import timezone as tz
                locked_soul.death_date = tz.now().date()

            # Apply any extra field updates (e.g. death_date, origin_location from die())
            #
            # A kwarg this model does not have is a **typo**, not an option.
            # `if hasattr(...)` dropped it silently and `transition_to` still
            # returned True: `deathdate=` and `orgin_location=` were both
            # accepted and both discarded. No caller misspells one today —
            # which is exactly why nothing would have caught the first that did.
            for field, value in kwargs.items():
                if not hasattr(locked_soul, field):
                    raise TypeError(
                        f"Soul has no field {field!r} — transition_to() will "
                        f"not silently drop it"
                    )
                setattr(locked_soul, field, value)

            locked_soul.save()

            # 进入死亡(ALIVE -> JUDGING)的**唯一**一个关口:`die()`(死亡同步、
            # `souls/{id}/die`)、`souls/{id}/transition`、建审判时的自动转入,全部走到
            # 这里。灵魂账号在这里开,与状态变化同一个事务:状态回滚,账号也回滚;
            # 密码在事务提交后才发。开号失败不回滚死亡本身 —— 见 provision_on_death。
            if old_state == SoulState.ALIVE and new_state == SoulState.JUDGING:
                from apps.soul_accounts.services import provision_on_death

                provision_on_death(locked_soul, account_origin)

                # 行程第一站:本文明的入口界域(待审所 / 杜阿特入口 / 阿刻戎渡口),
                # 与状态变化同一个事务。建审判时随后的 `_enter_judgment_realm` 再把它送上殿。
                from apps.realms.path import SoulPathService

                SoulPathService.enter_on_death(locked_soul)

            # Inside the transaction: the event row is part of the transition's record, and a failed insert
            # must roll the transition back. (It used to be written after the lock was released; the bus only
            # writes a row, it makes no external call.)
            # 失踪期间刑期不走,召回后顺延(2026-10-25),与状态变化同一个事务。
            from apps.disposition.expiry import hold_term_while_lost

            hold_term_while_lost(locked_soul, old_state, new_state)

            log_soul_state_change(locked_soul, old_state, new_state, reason, actor)

        # Sync back to self instance. Copy the raw year/month/day (not via
        # the birth_date/death_date properties) so a BCE death date isn't
        # silently dropped — the legacy property getter returns None for
        # anything it can't express as a datetime.date.
        self.current_state = locked_soul.current_state
        self.death_year = locked_soul.death_year
        self.death_month = locked_soul.death_month
        self.death_day = locked_soul.death_day
        return True

    def correct_settlement(self, user=None, reason: str = "") -> bool:
        """Revert a SETTLED soul to DISPOSED to fix a data-entry error.

        Deliberately does not go through transition_to/can_transition_to —
        SETTLED's only transition (back to DISPOSED) belongs to reopening a
        finished sentence plan (see the comment there on why re-opening a
        cosmologically closed case must never look like an ordinary
        transition). This is a correction, not
        a transition: ADMIN-only (enforced by the view's permission
        codename, not here), requires a reason, and is logged as its own
        SETTLEMENT_CORRECTED event so the lifecycle timeline never renders
        it as if the soul walked DISPOSED->SETTLED backwards. Reverts to
        DISPOSED rather than clearing to ALIVE/JUDGING, since only the
        settlement itself was in error — the judgment and disposition that
        led to it are untouched, and normal machinery can re-run from
        DISPOSED once the record is fixed.
        """
        from django.db import transaction

        if not reason:
            raise ValueError("A reason is required to correct a settlement.")

        with transaction.atomic():
            locked_soul = Soul.objects.select_for_update().get(pk=self.pk)
            if locked_soul.current_state != SoulState.SETTLED:
                raise ValueError("Only a SETTLED soul can have its settlement corrected.")

            old_state = locked_soul.current_state
            locked_soul.current_state = SoulState.DISPOSED
            locked_soul.save()

            from apps.events.services import EventService
            EventService.log_settlement_corrected(
                locked_soul, old_state, SoulState.DISPOSED, reason,
                actor=getattr(user, "username", "system") if user else "system",
            )
        self.current_state = locked_soul.current_state
        return True

    def die(self, death_date=None, location: str = "", account_origin: str = "OFFICER") -> "Judgment | None":
        """Mark soul as dead, transition to JUDGING, and create a Judgment record."""
        from django.db import transaction

        if self.current_state != SoulState.ALIVE:
            return None

        with transaction.atomic():
            result = self.transition_to(
                SoulState.JUDGING,
                "Death recorded, judgment initiated",
                account_origin=account_origin,
                death_date=death_date or timezone.now().date(),
                **({"origin_location": location} if location else {}),
            )
            if not result:
                return None

            from apps.judgment import city_gods
            from apps.judgment.models import Judgment, JudgmentMethod

            # ALL FOUR NAMED, and GREEK's entry changes no behaviour — the
            # `.get(..., STANDARD)` below already produced it. What it changes
            # is that it stops being an accident. This map had three members
            # and a fallback, so a Greek soul took `STANDARD` because nobody
            # had written anything else, and `STANDARD`'s own label reads
            # "Standard Trial (Chinese/European)" — a method whose name
            # excludes the civilization it was silently handing out.
            #
            # STANDARD is right: Gorgias 524a is a trial. Three judges hear the
            # case at the fork and Minos decides when the other two are in
            # doubt, which is a proceeding, not a weighing and not a
            # disputation with a devil. The label is widened to say so.
            #
            # The fallback stays for a FIFTH civilization, which will hit it
            # the same way Greek did — see `apps/ledger/services.py`'s decay
            # map for the shape that does this better: it is also incomplete,
            # and `apps/ledger/test_decay.py` pins the absence so the omission
            # is a statement rather than a gap.
            method_map = {
                Civilization.CHINESE: JudgmentMethod.STANDARD,
                Civilization.EUROPEAN: JudgmentMethod.STANDARD,
                Civilization.EGYPTIAN: JudgmentMethod.HEART_WEIGHING,
                Civilization.GREEK: JudgmentMethod.STANDARD,
            }
            # 阳寿: dying before the recorded fated date is untimely; the judgment is held until that date
            # (枉死城) and cannot be claimed before it (apps/judgment/claims.py).
            self.refresh_from_db(fields=["death_year", "death_month", "death_day", "origin_location",
                                         "fated_death_year", "fated_death_month", "fated_death_day",
                                         "duat_passage"])
            judgment = Judgment.objects.create(
                soul=self,
                civilization=self.civilization,
                tenant=self.tenant,
                judgment_method=method_map.get(self.civilization, JudgmentMethod.STANDARD),
                **self.opening_fields(to_legacy_date(self.death_year, self.death_month, self.death_day)),
            )
            city_gods.received(judgment)
            if self.civilization == Civilization.EGYPTIAN:
                self._after_egyptian_death(judgment)
            return judgment

    def _after_egyptian_death(self, judgment):
        """docs/01 §4.2: 早夭者不受审,直入芦苇原 —— 不称心(`weighing.applies`)、不走称心流程,当场结案 PASSED,
        处置照常由官员执行;无名者与葬仪不当者到不了殿,案子留在杜阿特入口候着(`claims._assert_not_held`)。
        其余的(含木乃伊 70 天)照旧挂到两真之殿。"""
        from apps.judgment.models import DUAT_BARRED, DuatStage, Verdict

        if judgment.duat_stage == DuatStage.EARLY_DEATH:
            from apps.judgment.services import JudgmentConclusionService

            JudgmentConclusionService.conclude_judgment(
                judgment, Verdict.PASSED, notes="Early death: straight to the Field of Reeds (docs/01 §4.2).",
                create_workflow=False)
        elif judgment.duat_stage not in DUAT_BARRED:
            # ponytail: 木乃伊 70 天期间行程已写到殿上(案子归殿);要「70 天后才入殿」得有个到期任务来挪行程。
            self._arrive_in_the_hall(judgment)

    def follow_duat_passage(self, old):
        """An officer changed `duat_passage` after death (2026-10-27); the open first-instance case follows it.

        * NAMELESS ↔ IMPROPER_BURIAL: only the case's `duat_stage` changes; it stays held at the Duat entry.
        * NAMELESS / IMPROPER_BURIAL → blank (a burial found proper): the case sets out as it would have at death —
          embalming and its 70 days by the same rule (`_duat_fields`), then the hall.
        * blank → NAMELESS / IMPROPER_BURIAL: an unclaimed case leaves the hall for the Duat entry and is held for
          ever, as at death registration (`opening_fields`: that stage, nothing held until a date, no realm). A case
          an officer has claimed is being decided: refused (`DjangoValidationError`, the serializer's 400).

        One `DUAT_PASSAGE_CHANGED` per soul whose case moved, in the caller's transaction (SoulSerializer.update).
        """
        from django.core.exceptions import ValidationError as DjangoValidationError

        from apps.events.services import EventService
        from apps.judgment.models import DUAT_BARRED, Judgment, JudgmentKind
        from apps.realms.path import SoulPathService

        new = self.duat_passage
        if old == new or (old not in DUAT_BARRED and new not in DUAT_BARRED):
            return
        cases = list(Judgment.objects.select_for_update(of=("self",)).filter(
            soul=self, kind=JudgmentKind.ORIGINAL, verdict__isnull=True, is_final=False, is_deleted=False))
        if old in DUAT_BARRED:
            cases = [case for case in cases if case.duat_stage in DUAT_BARRED]
        if not cases:
            return
        if new in DUAT_BARRED and old not in DUAT_BARRED and any(case.claimed_by_id for case in cases):
            raise DjangoValidationError("An officer has claimed this soul's case; it is being decided.")
        for case in cases:
            if new in DUAT_BARRED:
                fields = {"duat_stage": new}
                if old not in DUAT_BARRED:
                    fields.update(held_until=None, realm=None)
            else:
                died = to_legacy_date(self.death_year, self.death_month, self.death_day)
                fields = {"duat_stage": "", "held_until": None, **self._duat_fields(died)}
            for name, value in fields.items():
                setattr(case, name, value)
            case.save(update_fields=list(fields))
            if new not in DUAT_BARRED:
                self._arrive_in_the_hall(case)
        if new in DUAT_BARRED and old not in DUAT_BARRED:
            SoulPathService.enter_on_death(self)  # 回到杜阿特入口(租户没有入口这一站就不写)
        EventService.log(self, "DUAT_PASSAGE_CHANGED", {
            "from": old, "to": new, "judgments": [str(case.pk) for case in cases]})

    def _arrive_in_the_hall(self, judgment):
        """埃及:亡者穿过杜阿特,抵达两真之殿受审(docs/02 §1.1、01 §2.1)。案子挂在殿上,行程从杜阿特入口
        走到殿里;租户没有这一殿就什么都不写。两组门(七道 ꜥrrwt、廿一道 sbḫt)不入行程 —— 门的位置是 Design
        B 组画布定的,拓扑之外没有业务把灵魂送进去,这里不替它们决定。"""
        from apps.realms.models import Realm
        from apps.realms.path import SoulPathService

        hall = Realm.all_objects.filter(
            tenant_id=self.tenant_id, realm_code="EG_HALL_TWO_TRUTHS", is_deleted=False).first()
        if hall is None:
            return
        judgment.realm = hall
        judgment.save(update_fields=["realm"])
        SoulPathService.enter(self, hall, tenant_id=self.tenant_id)

    def opening_fields(self, died) -> dict:
        """The columns a first-instance case of this death carries: 枉死城 (died before the fated date, Diyu only)
        and 城隍初审 (Diyu: the city god of the birthplace takes it first). `Soul.die` and a case opened by hand
        for a living soul (`JudgmentViewSet.perform_create`, 2026-10-27) both go through here."""
        from apps.judgment import city_gods

        fated = to_legacy_date(self.fated_death_year, self.fated_death_month, self.fated_death_day)
        untimely = bool(self.civilization == Civilization.CHINESE and fated and died and died < fated)
        return {"untimely": untimely, "held_until": fated if untimely else None, **city_gods.initial_fields(self),
                **self._duat_fields(died)}

    def _duat_fields(self, died) -> dict:
        """埃及入殿前(docs/02 §1.1、01 §4.2):登记了未得审判的情形就照它;否则木乃伊 70 天,候到那一天。
        死亡日期不是完整的公元日期(公元前、只有年份)时不候 —— 与阳寿同一条规矩。"""
        if self.civilization != Civilization.EGYPTIAN:
            return {}
        from datetime import timedelta

        from apps.judgment.models import EMBALMING_DAYS, DuatStage

        if self.duat_passage:
            return {"duat_stage": self.duat_passage}
        if not died:
            return {}
        return {"duat_stage": DuatStage.EMBALMING, "held_until": died + timedelta(days=EMBALMING_DAYS)}
