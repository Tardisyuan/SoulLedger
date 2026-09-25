"""
Realm reference data — cross-civilization afterlife realms.
"""
import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.core.models import AuditUserFields
from apps.disposition.models import MemoryResetMechanism
from apps.souls.models import Civilization
from apps.tenants.managers import TenantManager


def resolve_localized_name(
    locale: str = "en",
    *,
    name_local: str = "",
    name_zh: str = "",
    name_en: str = "",
    name_egy: str = "",
) -> str:
    """The name-column fallback chain, as a free function.

    A free function and not only a model method because `apps/ledger/views.py`
    reaches these columns through `.values()` on an aggregate, where there is no
    model instance to call a method on. It used to read `name_en` directly and so
    answered in English for every reader — including zh-Hans ones, who saw
    `First Circle - Limbo` in an otherwise Chinese ledger.

    The obvious repair there was to copy these three lines into the view. That is
    how this repo acquired four copies of the client-IP parse and three of the
    `Accept-Language` parse, both of which had to be collapsed later
    (`apps/core/client_ip.py`, `apps/core/locale.py`). So the chain lives here
    once and `Realm.get_localized_name` calls it too.
    """
    if locale.startswith("zh"):
        return name_zh or name_en or name_local
    if locale == "egy":
        return name_egy or name_en or name_local
    return name_en or name_local


class RealmType(models.TextChoices):
    HELL = "HELL", "Hell / Punishment"
    PURGATORY = "PURGATORY", "Purgatory / Intermediate"
    BLISS = "BLISS", "Heaven / Bliss"
    NEUTRAL = "NEUTRAL", "Neutral / Between"


class RealmKind(models.TextChoices):
    """中国(地府「一线」)一站的种类。其余三个文明不用,留空(null)。"""
    HALL = "HALL", "殿"
    GATE = "GATE", "门"
    LAYER = "LAYER", "层"
    PATH = "PATH", "道"


class CommediaRegion(models.TextChoices):
    """欧洲(《神曲》「漏斗」)一站属于哪一部:地狱篇 / 炼狱篇 / 天堂篇。"""
    INFERNO = "INFERNO", "地狱"
    PURGATORIO = "PURGATORIO", "炼狱"
    PARADISO = "PARADISO", "天堂"


class RealmFork(models.TextChoices):
    """岔路一站在审判之后的哪一支。两个文明用它,各用各的两个值,互不借用。

    希腊(冥府「三岔」):左 / 右出自柏拉图《理想国》X 614c-d:正义者向右、向上,
    不义者向左、向下 —— 这是 left/right 的出处,不是设计稿的约定。设计稿的契约里曾有
    第三个值 MIDDLE,从没有任何种子行取它,2026-09-25 决定删掉(迁移 0020):中间那条
    (常说的 Asphodel)是现代教科书的三分法,见 apps/actors/mythology/realms.py
    GREEK_REALMS 的说明。

    埃及(杜阿特「称心二岔」,2026-09-26 起,迁移 0022):过 / 不过,即称心的两个结果
    (《亡灵书》125)。**不复用 LEFT / RIGHT**:那两个词是柏拉图的原话,写在杜阿特的
    行上就是替《亡灵书》说了一句它没说的「向左」。类原名 GreekFork,两个文明共用后改名。
    """
    LEFT = "LEFT", "左(塔尔塔罗斯)"
    RIGHT = "RIGHT", "右(至福岛)"
    PASS = "PASS", "过(称心通过)"
    FAIL = "FAIL", "不过(第二次死亡)"


class Realm(AuditUserFields, models.Model):
    """
    A destination realm within an afterlife system.
    Examples: 奈何狱 (Chinese), Heaven (EU), Aaru (EG)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    realm_code = models.CharField(max_length=50, unique=True)
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    # Local name in native script (保留原生语言)
    name_local = models.CharField(max_length=255, help_text="Native/local name")
    # Three localised name fields
    name_zh = models.CharField(
        max_length=255,
        blank=True,
        help_text="Simplified Chinese name",
    )
    name_en = models.CharField(
        max_length=255,
        blank=True,
        help_text="English name",
    )
    name_egy = models.CharField(
        max_length=255,
        blank=True,
        help_text="Egyptian name (transliteration or hieroglyphs)",
    )
    realm_type = models.CharField(max_length=20, choices=RealmType.choices)
    tier = models.IntegerField(
        default=1,
        help_text="Severity or bliss tier",
    )
    parent_realm = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sub_realms",
    )
    description = models.TextField(blank=True)
    # Constrained to MemoryResetMechanism rather than restating the values:
    # this was a bare CharField, so the realm-side vocabulary
    # (MENGPO/LETHE/SPELL/NONE) agreed with apps.disposition only by
    # coincidence and nothing would have reported a drift. Blank stays legal —
    # realms with no reset mechanism at all store "".
    memory_reset_mechanism = models.CharField(
        max_length=100,
        blank=True,
        choices=MemoryResetMechanism.choices,
    )
    is_eternal = models.BooleanField(default=False)
    is_judgment_required = models.BooleanField(
        default=True,
        help_text="Whether this realm requires a formal judgment process before entry",
    )
    cycle_limit = models.IntegerField(null=True, blank=True)

    # ------------------------------------------------------------------
    # 行程拓扑(官员端「行程拓扑」图所需;契约见 云端报告 realm-path-fields(已移出仓库,存于项目记忆目录))。
    #
    # 全部可空:一个文明用不到的列就是 null,而 null 的意思是「不适用或没有出处」,
    # 不是 0。已有的列不重复:契约里的 id / parent_id / code / is_eternal 就是
    # `id` / `parent_realm` / `realm_code` / `is_eternal`。
    #
    # `order` 不是 `tier`。`tier` 是「同一 realm_type 内的轻重 / 福报名次」(Meta 的
    # ordering 就是按 civilization, realm_type, tier 排),所以 DY_01_HEAVEN、
    # DY_00_PURGATORY 与第一殿都是 tier 1;`order` 是一条路线上的先后,只给路线上
    # 真的有位置的行。对十殿两者恰好相等,对别的行不相等。
    # ------------------------------------------------------------------
    order = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)],
        help_text="Position along the civilization's route (Chinese: court number 1-10)",
    )
    kind = models.CharField(
        max_length=10, null=True, blank=True, choices=RealmKind.choices,
        help_text="Chinese only: 殿 / 门 / 层 / 道",
    )
    capacity = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="How many souls the realm holds at once; null = not recorded",
    )
    level = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(9)],
        help_text="European only: circle (Inferno) or terrace (Purgatorio) number",
    )
    sublevel = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)],
        help_text="European only: ring (7th circle) or bolgia (8th circle) number",
    )
    region = models.CharField(
        max_length=12, null=True, blank=True, choices=CommediaRegion.choices,
        help_text="European only: which cantica the realm belongs to",
    )
    hour = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(12)],
        help_text="Egyptian only: hour of the night, 1-12",
    )
    gate = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)],
        help_text="Egyptian only: gate number",
    )
    is_judgment_hall = models.BooleanField(
        null=True, blank=True,
        help_text="Egyptian only: the hall where the heart is weighed; null elsewhere",
    )
    fork = models.CharField(
        max_length=6, null=True, blank=True, choices=RealmFork.choices,
        help_text="Greek (LEFT/RIGHT) and Egyptian (PASS/FAIL): which road out of the judgment place",
    )

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='realms',
        null=True,
    )

    class Meta:
        ordering = ["civilization", "realm_type", "tier"]
        verbose_name = "Realm"
        verbose_name_plural = "Realms"
        indexes = [
            models.Index(fields=["civilization", "realm_type"]),
            models.Index(fields=["tenant", "civilization"]),
            models.Index(fields=["realm_code"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.realm_code} ({self.name_en})"

    def get_localized_name(self, locale: str = "en") -> str:
        """
        Return the appropriate localized name based on locale.
        locale: 'zh-Hans', 'en', 'egy'
        """
        return resolve_localized_name(
            locale,
            name_local=self.name_local,
            name_zh=self.name_zh,
            name_en=self.name_en,
            name_egy=self.name_egy,
        )


class SoulPathEntry(models.Model):
    """灵魂行程的一站:进入某个界域的时刻,和离开的时刻(还在就是 null)。

    行由 `apps.realms.path.SoulPathService` 写,在各流程自己的事务里。本表出现之前的
    移动没有可信的进入时间,不回填;唯一的例外是死亡那一站(2026-09-25 用户决定):
    `manage.py backfill_soul_entry_path` 按记录的死亡日期,给还没有任何一站的亡魂
    写入口界域,离开时间留空。

    `tenant` 是这一站发生在哪个租户(界域所在的租户),不是灵魂的原属 —— 暂居在外时
    的那几站属于暂居地。读路径用 `scope_to_tenant`,与处置同一规则(含暂居只读例外)。
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        "souls.Soul", on_delete=models.CASCADE, related_name="path_entries",
    )
    # SET_NULL 与 Disposition.destination_realm 同一取法:界域是软删的,硬删极少;
    # 硬删了,这一站仍然发生过。
    realm = models.ForeignKey(
        Realm, null=True, on_delete=models.SET_NULL, related_name="path_entries",
    )
    sequence = models.PositiveIntegerField(help_text="1-based position in the soul's path")
    entered_at = models.DateTimeField()
    left_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="soul_path_entries",
        null=True,
    )

    class Meta:
        ordering = ["soul", "sequence"]
        verbose_name = "Soul path entry"
        verbose_name_plural = "Soul path entries"
        indexes = [
            models.Index(fields=["tenant", "soul"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["soul", "sequence"], name="soulpath_unique_sequence"),
            # 一个灵魂同一时刻只在一处。
            models.UniqueConstraint(
                fields=["soul"], condition=models.Q(left_at__isnull=True),
                name="soulpath_one_open_entry_per_soul",
            ),
            models.CheckConstraint(
                condition=models.Q(left_at__isnull=True) | models.Q(left_at__gte=models.F("entered_at")),
                name="soulpath_left_not_before_entered",
            ),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        realm = self.realm.realm_code if self.realm_id else "?"
        return f"{self.soul_id} #{self.sequence} {realm}"
