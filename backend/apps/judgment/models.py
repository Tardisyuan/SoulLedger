"""
Judgment model — records of soul judgment proceedings.
"""
import uuid

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F
from django.utils import timezone

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.judgment import snapshot
from apps.souls.models import Civilization, Soul
from apps.tenants.managers import TenantManager


class Verdict(models.TextChoices):
    PASSED = "PASSED", "Passed / Saved"
    FAILED = "FAILED", "Failed / Condemned"
    PURGATORY = "PURGATORY", "Purgatory / Intermediate"
    RETRY = "RETRY", "Retry / Appeal"


def hears_again(civilization, verdict) -> bool:
    """这个裁决不是一个去处,而是「这件案子再审一次」(用户 2026-10-29,四文明统一)。

    * RETRY,任何文明:原审结案另开一案(`weighing.open_retrial`),不建处置、不动计划与灵魂状态。
    * PURGATORY,欧洲以外:地府的 `DY_00_PURGATORY` 是待审所,希腊的草地是「还没被送走」(docs/02_希腊 §5.2:
      PURGATORY / RETRY 留在 `EU_PLATO_MEADOW`,「不是第三条路」),埃及的 Duat 入口是天平摇摆(02 §5.3)——
      三处都不是刑罚,只是没判完;docs/11 第八步「不服判决 → …… → 重新审理」是同一个动作。
    * 欧洲的 PURGATORY 是真正的去处:炼狱收确定得救者、按刑期涤罪后升天堂(docs/01_欧洲 §1.2),照旧发落。

    重开审判与申诉改判本身就是「再审」,所以在那里这些裁决被拒绝(`sentence_plan.requests._refuse_undecided`)。"""
    if verdict == Verdict.RETRY:
        return True
    return verdict == Verdict.PURGATORY and civilization != "EUROPEAN"


def acquitted_to_rebirth(civilization, verdict) -> bool:
    """地府判无罪:不发落、不建刑期节点,结案(流程走完)后直接候转世(用户 2026-10-29)。

    docs/11 §3.1 第六步「无罪 → 直接投胎」;docs/05 §2.1「第一殿初判 · 善人 → 直接批准投胎」;
    §3.3「善人径投」(《玉历》一殿)。此前 PASSED 去 `DY_01_HEAVEN`,种子把它标成永久(`is_eternal=True`),
    执行后灵魂成了 SETTLED,永不转世 —— 与这三处都相反。souls/0051 回填了那批灵魂。"""
    return verdict == Verdict.PASSED and civilization == "CHINESE"


class JudgmentMethod(models.TextChoices):
    STANDARD = "STANDARD", "Standard Trial (Chinese/European/Greek)"
    HEART_WEIGHING = "HEART_WEIGHING", "Heart Weighing (Egyptian)"
    DIABOLICAL_TRIAL = "DIABOLICAL_TRIAL", "Diabolical Trial (European Hell)"


class DuatStage(models.TextChoices):
    """Where an Egyptian case stands before the hall (`Judgment.duat_stage`)."""
    EMBALMING = "EMBALMING", "木乃伊制作中"
    EARLY_DEATH = "EARLY_DEATH", "早夭 · 直入芦苇原"
    NAMELESS = "NAMELESS", "无名者 · 不入冥界"
    IMPROPER_BURIAL = "IMPROPER_BURIAL", "葬仪不当 · 旅程未竟"


#: Stages that never reach the hall: the case can be neither claimed nor concluded.
DUAT_BARRED = (DuatStage.NAMELESS, DuatStage.IMPROPER_BURIAL)
#: docs/02 §1.1: 制作木乃伊(70 天后完成)。
EMBALMING_DAYS = 70


class WeighingResult(models.TextChoices):
    """What the scale said at an Egyptian conclusion (docs/02 §3.1, §5; 01 §3.3).

    LIGHTER  = not heavier than the feather (02 §5.1: 心脏重量 ≤ 羽毛重量) → PASSED
    HEAVIER  = heavier (02 §5.2) → FAILED, Ammit
    WAVERING = 摇摆不定 (02 §5.3): Thoth records it, the case is weighed again —
               no destination (user decision 2026-10-27).
    """
    LIGHTER = "LIGHTER", "未重于羽"
    HEAVIER = "HEAVIER", "重于羽"
    WAVERING = "WAVERING", "天平摇摆 · 再称"


class CityGodStatus(models.TextChoices):
    PENDING = "PENDING", "待初审"
    RETURNED = "RETURNED", "退回补正"
    SENT_ON = "SENT_ON", "已解送"


#: 案子还在城隍那里:十殿不能认领、改派、结案,十殿的队列不列它。
AT_CITY_GOD = (CityGodStatus.PENDING, CityGodStatus.RETURNED)


class ChineseOffence(models.TextChoices):
    """罪目(地府):十殿按罪行类型分殿,不按轻重(docs/01_地府整体架构.md「第三层:十殿阎罗」表,
    docs/11_地府审判制度与冥律.md §2.2「审判范围(《玉历》罪目)」、§3.1 第四步「根据罪行类型分配至对应殿位」)。

    成员就是二至九殿所掌的罪类,殿号在 `OFFENCE_COURT`。一殿(孽镜台、读生死簿)与十殿(六桥、发放投生)
    不掌刑,没有罪目。五逆不经各殿、直入阿鼻(docs/11 §3.3),落在九殿。
    """
    ABDUCTION = "ABDUCTION", "拐骗少年男女"
    SEIZING_PROPERTY = "SEIZING_PROPERTY", "欺占他人财物"
    MAIMING = "MAIMING", "损坏人耳目手足"
    DEFYING_ELDERS = "DEFYING_ELDERS", "忤逆尊长"
    INCITING_LITIGATION = "INCITING_LITIGATION", "教唆兴讼"
    BETRAYING_TRUST = "BETRAYING_TRUST", "背恩失节"
    WITHHOLDING_DUES = "WITHHOLDING_DUES", "抗粮赖租"
    TRADE_FRAUD = "TRADE_FRAUD", "交易欺诈"
    RESENTMENT = "RESENTMENT", "怨怼"
    INGRATITUDE = "INGRATITUDE", "忘恩"
    ENVY = "ENVY", "嫉妒"
    MISERLINESS = "MISERLINESS", "悭吝"
    CURSING_HEAVEN = "CURSING_HEAVEN", "怨天尤地"
    SACRILEGE = "SACRILEGE", "亵渎神佛"
    DISRESPECTING_SCRIPT = "DISRESPECTING_SCRIPT", "不敬字纸经书"
    BONES_FOR_MEDICINE = "BONES_FOR_MEDICINE", "取骸合药"
    SEPARATING_KIN = "SEPARATING_KIN", "离散骨肉"
    NEGLECTING_PARENTS = "NEGLECTING_PARENTS", "亲存不养"
    UNBURIED_PARENTS = "UNBURIED_PARENTS", "亲殁不葬"
    MURDER = "MURDER", "杀人"
    ARSON = "ARSON", "放火"
    POISONING = "POISONING", "制毒"
    FIVE_HEINOUS = "FIVE_HEINOUS", "五逆"


def refuse_passed_if_five_heinous(judgment, verdict) -> None:
    """400 `five_heinous_must_fail` when `verdict` is PASSED and the case's offence is 五逆 (user 2026-10-29,
    review J): 五逆直入阿鼻(docs/11 §3.3),无罪不在其列。At conclusion (original and reopened), at an appeal
    amended to PASSED, and at the approval of a flow whose judgment was concluded PASSED before this rule."""
    if verdict != Verdict.PASSED or getattr(judgment, "offence", "") != ChineseOffence.FIVE_HEINOUS:
        return
    from apps.sentence_plan.requests import PlanChangeRefusedError

    raise PlanChangeRefusedError("The offence is one of the five heinous crimes; the verdict cannot be PASSED",
                                 "five_heinous_must_fail")


#: 罪目 → 殿号(`Realm.tier`,`DispositionService.CHINESE_HELL_TIERS` 的键)。
OFFENCE_COURT = {
    ChineseOffence.ABDUCTION: 2, ChineseOffence.SEIZING_PROPERTY: 2, ChineseOffence.MAIMING: 2,
    ChineseOffence.DEFYING_ELDERS: 3, ChineseOffence.INCITING_LITIGATION: 3, ChineseOffence.BETRAYING_TRUST: 3,
    ChineseOffence.WITHHOLDING_DUES: 4, ChineseOffence.TRADE_FRAUD: 4,
    ChineseOffence.RESENTMENT: 5, ChineseOffence.INGRATITUDE: 5, ChineseOffence.ENVY: 5,
    ChineseOffence.MISERLINESS: 5,
    ChineseOffence.CURSING_HEAVEN: 6, ChineseOffence.SACRILEGE: 6, ChineseOffence.DISRESPECTING_SCRIPT: 6,
    ChineseOffence.BONES_FOR_MEDICINE: 7, ChineseOffence.SEPARATING_KIN: 7,
    ChineseOffence.NEGLECTING_PARENTS: 8, ChineseOffence.UNBURIED_PARENTS: 8,
    ChineseOffence.MURDER: 9, ChineseOffence.ARSON: 9, ChineseOffence.POISONING: 9,
    ChineseOffence.FIVE_HEINOUS: 9,
}


class WrongfulDeathCause(models.TextChoices):
    """枉死城的死因分类(docs/10_枉死城详解.md §2.2 五类、§6.1 `death_cause`)。产品设定,文档已注明无一手依据。"""
    ACCIDENT = "ACCIDENT", "意外身亡"
    VICTIM = "VICTIM", "刑事被害"
    SUICIDE = "SUICIDE", "自杀"
    WAR = "WAR", "战争死亡"
    OTHER = "OTHER", "其他"


class GrievanceLevel(models.TextChoices):
    """冤情等级(docs/10 §6.1 'none','minor','major','severe')。"""
    NONE = "NONE", "无冤情"
    MINOR = "MINOR", "轻"
    MAJOR = "MAJOR", "重"
    SEVERE = "SEVERE", "极重"


class GrievanceStatus(models.TextChoices):
    """枉死城的冤情申诉(docs/10 §4.2、§6.2):提出 → 审核 → 属实则提前释放 / 超度(规则在 `apps/judgment/wangsi.py`)。"""
    FILED = "FILED", "已申诉"
    UPHELD = "UPHELD", "属实 · 提前释放"
    #: 阳寿已到(或案子已结)之后才审:属实,但已出城,没有放人这一步(2026-10-29)。
    UPHELD_LATE = "UPHELD_LATE", "属实 · 期满出城"
    #: 属实且超度:出城到莲花台,免审结案(docs/10 §4.3,2026-10-29 用户决定)。
    DELIVERED = "DELIVERED", "属实 · 超度"
    REJECTED = "REJECTED", "不属实"


#: docs/10 §4.2「若确属冤死且冤情重大 → 可提前释放」:只有这两级的冤情,申诉属实才放人。
GRIEVANCE_RELEASE_LEVELS = (GrievanceLevel.MAJOR, GrievanceLevel.SEVERE)


class CityGodRank(models.TextChoices):
    """城隍四级(docs/08_城隍体系详解.md §二),与人间地方行政对应。"""
    PROVINCE = "PROVINCE", "都省城隍"
    PREFECTURE = "PREFECTURE", "府城隍"
    DEPARTMENT = "DEPARTMENT", "州城隍"
    COUNTY = "COUNTY", "县城隍"


class CityGodBureau(models.TextChoices):
    """城隍下属的司(docs/08 §三):阴阳司为首,其下仿六部各四司,共二十四司。值是司名的拼音。
    按部分组的表在 `packages/core/src/domain/cityGods.ts::CITY_GOD_BUREAU_GROUPS`(只用于显示)。"""
    YINYANG = "YINYANG", "阴阳司"
    GONGCAO = "GONGCAO", "功曹司"
    DIANJI = "DIANJI", "典籍司"
    JIBU = "JIBU", "记簿司"
    DUGUAN = "DUGUAN", "都官司"
    CAIBO = "CAIBO", "财帛司"
    TUDI = "TUDI", "土地司"
    LIANGMO = "LIANGMO", "粮秣司"
    KAOJIE = "KAOJIE", "考劫司"
    JISI = "JISI", "祭祀司"
    YIZHU = "YIZHU", "仪注司"
    HUOFU = "HUOFU", "祸福司"
    MINGYI = "MINGYI", "冥衣司"
    BINGZHANG = "BINGZHANG", "兵杖司"
    XINGXUN = "XINGXUN", "刑讯司"
    JUBU = "JUBU", "拘捕司"
    XUNCHA = "XUNCHA", "巡察司"
    XINGFA = "XINGFA", "刑罚司"
    ANBU = "ANBU", "案簿司"
    QUANDIAN = "QUANDIAN", "权典司"
    XUMING = "XUMING", "续命司"
    YINGZAO = "YINGZAO", "营造司"
    QIAODAO = "QIAODAO", "桥道司"
    CIJI = "CIJI", "祠祭司"
    SHUYUN = "SHUYUN", "输运司"


def open_judgments(soul):
    """这个灵魂**未结案**的审判,不分租户。

    Judgment 没有状态列;它的状态机就是这三列:
    * 未结案 = `verdict IS NULL` 且 `is_final = False` 且 `is_deleted = False`。
    * 结案 = `conclude/` 写下裁决(`verdict` 非空、`is_final=True`)。
    * 撤案 = 无裁决时软删除(`delete_or_raise`)。有裁决的审判不能删、只能归档,
      所以「已归档」一定已结案;无裁决的审判不能归档(`archive` 400)。

    两个调用方共用这一份定义:`JudgmentSerializer.validate_soul`(一个灵魂同时只能有
    一个未结案审判)与 `DispatchService.end_residence`(有未结案审判时不回归)。
    """
    return Judgment.all_objects.filter(
        soul=soul, verdict__isnull=True, is_final=False, is_deleted=False
    )


class JudgmentKind(models.TextChoices):
    """这份审判对受刑计划做什么(docs/ARCHITECTURE-sentence-plan.md §2.4)。

    ORIGINAL 结案生成计划;AMENDMENT(灵魂所在地的加 / 减项审判)与 REOPEN(原属的重开审判)
    结案**不建处置、不动灵魂状态**,只改计划(`apps/sentence_plan/requests.py`)。
    AMENDMENT 由开案时自动定:灵魂有进行中的计划(`JudgmentViewSet.perform_create`);
    REOPEN 只由原审判官批准 REOPEN 请求时由系统开(`requests._open_reopen_judgment`)。
    """
    ORIGINAL = "ORIGINAL", "原审判"
    AMENDMENT = "AMENDMENT", "加项 / 减项审判"
    REOPEN = "REOPEN", "重开审判"


def case_number_prefix(tenant) -> str:
    """案号的前缀:租户代码第一段(`CN_DIYU` → `CN`),没有租户是 `SL`(Design 的品牌前缀)。

    前缀带租户,是因为同一个人(ADMIN)会在跨租户的列表里看到几个文明的案子:
    `SL-2026-0001` 在四个文明各有一件,印在纸上就分不出是哪一件。
    """
    if tenant is None:
        return "SL"
    head = "".join(ch for ch in tenant.code.split("_")[0].upper() if ch.isalnum())
    return head[:8] or "SL"


def format_case_number(prefix: str, year: int, seq: int) -> str:
    """`CN-2026-0007`。序号至少四位、不截断(第一万件是 `-10000`)。"""
    return f"{prefix}-{year}-{seq:04d}"


class JudgmentCaseCounter(models.Model):
    """案号发号器:每个「前缀-年」一行,`last` 是已发出的最大序号。

    为什么是一张计数表而不是 `max(序号) + 1`:两件同时开的案子会读到同一个 max。
    这里 `UPDATE … SET last = last + 1` 在 PostgreSQL 上锁住这一行直到开案的事务提交,
    第二件案子在锁上等、拿到的是加过一次的值;事务回滚则号一起回滚,所以不留空号。
    键是前缀而不是租户:两个租户的代码第一段相同(`CN_DIYU` 与 `CN_TEST`)时共用一行,
    于是 `case_number` 可以全局唯一,而每个租户自己的号仍然单调递增。

    ponytail: 一个租户一年一行,同租户的开案在这一行上串行;开案是人手动作,
    要是哪天成了批量导入的瓶颈,再换 PostgreSQL SEQUENCE。
    """
    key = models.CharField(max_length=20, primary_key=True, help_text="<prefix>-<year>")
    last = models.PositiveIntegerField(default=0)

    @classmethod
    def bump(cls, key: str) -> int:
        """把 `key` 这一行加一并返回新值。必须在写入编号的同一个事务里调:行锁握到提交,回滚则号一起回滚。

        审批编号(`ApprovalWorkflow.number`,`WF-0582`)也从这里发,键是不带年份的 `WF`(案号的键都是
        `<prefix>-<year>`,带连字符,碰不到它)。"""
        cls.objects.get_or_create(key=key)
        cls.objects.filter(key=key).update(last=F("last") + 1)
        return cls.objects.get(key=key).last

    @classmethod
    def next_number(cls, tenant) -> str:
        """发下一个号。必须在写入案子的同一个事务里调(`Judgment.save` 这样做)。"""
        prefix = case_number_prefix(tenant)
        year = timezone.localdate().year
        return format_case_number(prefix, year, cls.bump(f"{prefix}-{year}"))


class Judgment(ArchivableMixin, AuditUserFields, models.Model):
    """
    A single judgment proceeding for a soul.

    Deletion (Stage 4 §4.7): a pending judgment (verdict is null) is an
    ordinary soft delete. Once a verdict has been recorded, the judgment
    is part of the soul's judicial history and is archivable instead — see
    can_delete/delete_or_archive below and ArchivableMixin.archive().
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # 案号:给人读、给人抄的编号(`CN-2026-0007`),开案时由 `save()` 从 `JudgmentCaseCounter`
    # 发。`id` 仍是 API 与路由用的身份;案号只是它的人类名字,永不改、永不复用(软删的案子
    # 留着它的号)。存量行由 judgment/0032 按 (前缀, 年, created_at, id) 回填。
    case_number = models.CharField(max_length=32, unique=True, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="judgments",
    )
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    judge = models.ForeignKey(
        "actors.Actor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="judgments_conducted",
    )
    court = models.CharField(max_length=255, blank=True, help_text="Court name, e.g. 第一殿")
    # 审判所在的界域(行程拓扑的一站)。`court` 是自由文本,`realm` 是外键;两者并存,
    # 不互相推导 —— 存量行由 judgment/0024 只在 `court` 与某一殿的名字**逐字**相同时回填,
    # 其余留空。写入时的租户校验在 JudgmentSerializer.validate_realm_id。
    realm = models.ForeignKey(
        "realms.Realm",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="judgments",
    )
    evidence_json = models.JSONField(default=dict)
    confession = models.TextField(blank=True)
    # 案由:官员写的一两句案情概述(官员端「案由」一段读它)。**不是 `confession`**——后者是灵魂的供词。
    summary = models.TextField(blank=True, default="")
    judgment_method = models.CharField(
        max_length=30,
        choices=JudgmentMethod.choices,
        default=JudgmentMethod.STANDARD,
        help_text="Method of judgment (affects disposition routing)",
    )
    verdict = models.CharField(
        max_length=20,
        choices=Verdict.choices,
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)
    is_final = models.BooleanField(default=False)
    #: 横死(2026-10-24):the soul died before its recorded fated date (Soul.fated_death_*). It waits in 枉死城;
    #: `held_until` is that date, and the judgment cannot be claimed before it.
    untimely = models.BooleanField(default=False)
    held_until = models.DateField(null=True, blank=True)
    #: 枉死城(docs/10):死因分类与冤情等级由官员登记(PATCH,只在枉死的案子上);冤情申诉经
    #: `apps/judgment/wangsi.py` 写。申诉属实且冤情重大 → 提前释放:`held_until` 清空,案子当即可以认领。
    wrongful_death_cause = models.CharField(max_length=10, choices=WrongfulDeathCause.choices, blank=True, default="")
    grievance_level = models.CharField(max_length=10, choices=GrievanceLevel.choices, blank=True, default="")
    grievance_status = models.CharField(max_length=12, choices=GrievanceStatus.choices, blank=True, default="")
    grievance_plea = models.TextField(blank=True, default="")
    grievance_note = models.TextField(blank=True, default="")
    grievance_decided_at = models.DateTimeField(null=True, blank=True)
    #: 这一次申诉提出的时刻(`wangsi.file_grievance` 写)。官员端待办按它排、显示它 —— `update_time` 随改冤情等级也会动。
    grievance_filed_at = models.DateTimeField(null=True, blank=True)
    #: 罪目(地府):自动选殿按它(`DispositionService._route_chinese`);空 = 没填,退回按严重度。
    offence = models.CharField(max_length=30, choices=ChineseOffence.choices, blank=True, default="")
    #: 埃及入殿前的一段(review P2-9,docs/02 §1.1、01 §4.2),死亡登记时由 `Soul.opening_fields` 写:
    #: EMBALMING = 木乃伊 70 天,`held_until` 是那一天;NAMELESS / IMPROPER_BURIAL 永远候着(不入冥界 /
    #: 走不完旅程),不能认领、不能结案;EARLY_DEATH 不称心,`Soul.die` 当场送芦苇原。空 = 不涉及。
    duat_stage = models.CharField(max_length=20, choices=DuatStage.choices, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    concluded_at = models.DateTimeField(null=True, blank=True)
    # 结案那一刻采信后的业力净值(功 − 过,剔除本案不采信的记录,与 `get_ledger_summary`
    # 同一套衰减)。灵魂的余额之后还会变(新记录、衰减、转世),结案时的数不会:审判台对已结案
    # 案子显示的「采信后余额」与「据 · 先例」的排序都读它。每个文明都记 —— 先例对所有文明
    # 都按功 − 过排;审判台只在读法是余额(中国)时显示它。null = 这一列出现之前结的案,
    # 或结案时案子不属于灵魂当前这一世(没有可重算的底)。
    concluded_balance = models.IntegerField(null=True, blank=True)
    # 埃及称心的结果,结案时冻结(托特记录,docs/02 §2.1、§5.1)。`heart_weight` 是采信后的
    # 过 − 功(不低于 0,02 §3.2);羽重是常量 MAAT_FEATHER_WEIGHT。非称心的案子两列都是 null。
    weighing_result = models.CharField(max_length=10, choices=WeighingResult.choices, null=True, blank=True)
    heart_weight = models.IntegerField(null=True, blank=True)
    # 天平摇摆而再称时,新开的那件案子指回这一件(apps/judgment/weighing.py)。
    retrial_of = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='judgments',
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

    # 受刑计划(docs/ARCHITECTURE-sentence-plan.md)。`amends_plan_id` 是裸 UUID:
    # 计划在原属库,加减项审判在执行地库,分库后不能是外键。存量行全是 ORIGINAL。
    kind = models.CharField(max_length=10, choices=JudgmentKind.choices, default=JudgmentKind.ORIGINAL)
    amends_plan_id = models.UUIDField(null=True, blank=True, db_index=True)

    # 判词草稿。判词本身就是 `notes`:结案前它就是草稿(详情页的文本框从它起步,
    # `notesTouched` 守着它),结案时 `conclude/` 用请求里的 notes 覆盖它。所以这里
    # 只补草稿缺的三样:选中但未落的裁决、上次自动保存的时间、并发前提。
    # `verdict` 不能兼作草稿 —— 它非空就是「已结案」(见 `open_judgments`)。
    #
    # `draft_version` 而不是 AuditUserFields 的 `version`:后者每次 save 都加一,
    # 与草稿无关的写(归档、改 court)也会让正在写判词的审判官吃一个假 409。
    # 这一列只在草稿内容(notes / draft_verdict)变了时加一,见
    # `JudgmentDraftService.save`。
    draft_verdict = models.CharField(max_length=20, choices=Verdict.choices, null=True, blank=True)
    draft_saved_at = models.DateTimeField(null=True, blank=True)
    draft_version = models.PositiveIntegerField(default=0)
    # 「戊 · 发落」的草稿:选了但还没随结案发出的目的地与刑期。与判词同一个 `draft/`、
    # 同一个 `draft_version` 前提;结案时清空(发落已写进结案本身)。只是草稿,不校验
    # 容量与裁决可去 —— 那些在结案事务里(apps/disposition/destination.py::resolve_placement)。
    draft_destination_realm = models.ForeignKey(
        "realms.Realm", null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    draft_term_years = models.PositiveIntegerField(null=True, blank=True)
    draft_eternal = models.BooleanField(default=False)
    # 认领与暂缓(审判队列按「谁在办」分组)。**不是 `judge`**:`judge` 是神话里的审判者
    # (一个 Actor),这两列是办这件案子的官员(一个 User)。
    #
    # 列在 Judgment 上而不是另起一张表:一件案子同一时刻只有一个认领人,认领竞争锁的
    # 就是这一行(与结案读的是同一行),队列分组是单表谓词、不用子查询。历史不靠第二张表:
    # 每次认领 / 释放 / 改派 / 暂缓都走 `save(update_fields=…)`,审计信号为它写一行带
    # 前后值的 UPDATE(apps/audit/signals.py `_on_pre_save`);结案**不清**认领人,
    # 所以已结案的案子仍答得出「最后是谁办的」。写入只经 `apps/judgment/claims.py`。
    claimed_by = models.ForeignKey(
        "authentication.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="claimed_judgments",
    )
    claimed_at = models.DateTimeField(null=True, blank=True)
    # 暂缓:持久化,与认领正交(暂缓不释放认领)。`deferred_at` 非空即在「暂缓」组,
    # 且默认不出现在 `/judgment/next/`。理由必填,由 `JudgmentDeferSerializer` 在边界
    # 上校验长度 —— 500 是列宽,PostgreSQL 会强制它而 SQLite 不会(见 CLAUDE.md)。
    deferred_at = models.DateTimeField(null=True, blank=True)
    deferred_by = models.ForeignKey(
        "authentication.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deferred_judgments",
    )
    defer_reason = models.CharField(max_length=500, blank=True, default="")
    # 「请管理员改派」的持久标记(`claims.request_reassign` 写,改派 / 释放 / 认领时清)。
    # 此前只有 10 分钟的限流缓存,官员端重开就忘了「已请求」。
    reassign_requested_at = models.DateTimeField(null=True, blank=True)
    reassign_requested_by = models.ForeignKey(
        "authentication.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reassign_requested_judgments",
    )
    reassign_reason = models.CharField(max_length=500, blank=True, default="")
    # 滞留:未结案且 30 天无进展。只由定时任务 `judgment.auto_conclude_stale` 用
    # bulk_update 盖章(**不结案**,用户 2026-10-17 决定),此前是往 `notes` 末尾追加一行
    # `[SYSTEM] Flagged as stale`(存量行由 judgment/0037 迁过来)。案子之后**任何一次**
    # `save()`(结案、认领 / 释放 / 改派 / 暂缓、PATCH、草稿)都算有了进展,在下面的
    # `save()` 里清掉;下一次是否再标,看 `update_time` 是否又过了 30 天。
    stale_since = models.DateTimeField(null=True, blank=True)
    # 落判的官员(结案请求的 `by`)。申诉复核要排除他(apps/judgment/appeals.py);只看 `claimed_by` 不够 ——
    # 无人认领的案子谁都能结,ADMIN / 殿主也能结别人认领的。null = 这一列之前结的案,或进程内结案。
    concluded_by = models.ForeignKey(
        "authentication.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="concluded_judgments",
    )
    # 城隍初审(2026-10-24 用户决定,只在地府):登记的死亡先交出身地对应的城隍初审,解送之后才进十殿的队列。
    # 写入只经 `apps/judgment/city_gods.py`。`city_god_status` 空 = 没有初审这一站(别的文明、没有匹配的城隍、
    # 官员手开的案子),与过去一样直接进十殿。PENDING / RETURNED 时十殿不能认领、改派、结案,队列里也看不到。
    city_god = models.ForeignKey(
        "judgment.CityGod", null=True, blank=True, on_delete=models.PROTECT, related_name="judgments",
    )
    city_god_status = models.CharField(max_length=10, choices=CityGodStatus.choices, blank=True, default="")
    #: 最近一次初审动作(解送 / 退回)的批语。
    city_god_note = models.TextField(blank=True, default="")
    sent_on_at = models.DateTimeField(null=True, blank=True)
    sent_on_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="sent_on_judgments",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Judgment"
        verbose_name_plural = "Judgments"
        indexes = [
            models.Index(fields=["soul", "verdict"]),
            models.Index(fields=["tenant", "created_at"]),
            models.Index(fields=["verdict"]),
            models.Index(fields=["is_final"]),
            models.Index(fields=["soul", "cycle"]),
            models.Index(fields=["tenant", "deferred_at", "claimed_by"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def save(self, *args, **kwargs):
        # 创建时盖上当前是第几世;显式给了非 0 值的调用方(迁移、测试)不覆盖。
        # 与 SoulRecord.save 同一写法。
        if self._state.adding and self.cycle == 0 and self.soul_id is not None:
            self.cycle = self.soul.life_index
        # 埃及的每一件案子都称心 —— 手开的、重开的、再称的,不只是死亡登记那一件(docs/01 §3.3、
        # 02 §1.1;用户 2026-10-27)。此前只有 `Soul.die` 设 HEART_WEIGHING,其余默认 STANDARD,
        # 按功德净值 ≥ 50 送芦苇原。
        if self._state.adding and self.civilization == "EGYPTIAN":
            self.judgment_method = JudgmentMethod.HEART_WEIGHING
        # 任何一次写入都是「有进展」,滞留标记随之清掉(见 `stale_since`)。只给了
        # `update_fields` 的写(认领那组)也要把这一列带上,否则清的只是内存里的值。
        if not self._state.adding and self.stale_since is not None:
            self.stale_since = None
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = [*kwargs["update_fields"], "stale_since"]
        if self._state.adding and not self.case_number:
            # 发号与写入在同一个事务里:写入失败,号跟着回滚,不留空号。
            with transaction.atomic():
                self.case_number = JudgmentCaseCounter.next_number(self.tenant)
                super().save(*args, **kwargs)
            return
        super().save(*args, **kwargs)

    def __str__(self):
        v = self.verdict or "PENDING"
        return f"Judgment of {self.soul.name}: {v}"

    def conclude(self, verdict: str, notes: str = "", create_workflow: bool | None = None,
                 statute_ids=None, plan_changes=None, **placement) -> bool:
        from apps.judgment.services import JudgmentConclusionService
        return JudgmentConclusionService.conclude_judgment(
            self, verdict, notes, create_workflow, statute_ids=statute_ids, plan_changes=plan_changes,
            **placement,
        )

    @property
    def can_delete(self) -> bool:
        """False once a verdict has been recorded — see class docstring."""
        return self.verdict is None

    def delete_or_raise(self, user=None, reason=""):
        """Soft-delete this judgment, or raise DeletionNotAllowedError
        (archivable=True) once it carries a verdict."""
        from apps.core.archive import DeletionNotAllowedError

        if not self.can_delete:
            raise DeletionNotAllowedError(
                "This judgment has a recorded verdict and cannot be deleted. "
                "Archive it instead.",
                archivable=True,
            )
        from django.db import transaction

        from apps.sentence_plan.services import SentencePlanService

        with transaction.atomic():
            self.soft_delete(user=user, reason=reason)
            # 撤案可能是受刑计划等着的最后一件事(刑满暂留的回归、重审结束),设计稿 §3.3。
            SentencePlanService.advance(self.soul)


# ---------------------------------------------------------------------------
# The cited basis of a verdict
# ---------------------------------------------------------------------------


class StatuteCorpus(models.TextChoices):
    """Which body of rules an article belongs to.

    Not one flat "sin category" list, and not one shared article schema. The
    three cosmologies in this system do not have the same kind of rulebook, in
    exactly the way apps/ledger/readings.py says they do not have the same kind
    of ledger reading:

      * NEGATIVE_CONFESSION is not a code of offences at all. It is 42 things
        the deceased *denies* having done, one per assessor, recited in the
        Hall of Two Truths. Citing one is citing a denial the heart failed to
        sustain — the polarity is inverted from a statute, and flattening the
        two together would state the Egyptian material as prohibitions it does
        not contain.
      * DEADLY_SIN is the seven capital sins, one article per terrace of Mount
        Purgatory (EU-DS-T1..T7). It was seeded in 6017f04 against Dante's nine
        circles, withdrawn in 8308204 because that frame does not exist — the
        Inferno is layered on Aristotle's tripartite scheme (Inf. XI.79-84) and
        pride, envy and sloth get no circle at all — and re-anchored to
        Purgatorio X-XXVII, which is the structure the seven actually order.
        The articles carry `purgatorio_terrace`; the `dante_circle` the first
        attempt carried is retired, being a coordinate the poem does not have.
      * INFERNO is the OTHER European corpus and a different structure in a
        different canticle: the nine circles of Inferno IV-XXXIV plus the
        seventh circle's three gironi, the eighth's ten bolge and the ninth's
        four zones of Cocytus, 26 articles under EU-INF-*. Two European
        corpora rather than one enlarged one, because the seven capital sins
        order the terraces and Aristotle's tripartition orders the circles
        (Inf. XI.79-84), and the single finding of
        docs/lore-verification/verify-christian-structure.md is that joining
        the two produces a chart that exists nowhere in Dante. No article here
        cites a terrace and no terrace article cites a circle.

        THIS IS NOT `dante_circle` RETURNING. That key was a circle number
        hung on a capital sin — a coordinate for pride, envy and sloth that
        the poem does not give them. Here the circle is not an attribute of
        anything: the circle IS the article, the way the terrace article for
        wrath IS the third terrace. No row in any corpus carries the retired
        key, and tests/test_purgatorio_terraces.py still asserts it of every
        seeded statute.

        AND IT ROUTES NOTHING. Which circle a soul belongs in needs a kind of
        sin; `RecordCategory` is a 功過格 taxonomy, and baptismal state,
        doctrinal position and the identity of a betrayed trust have no field
        anywhere in this system. `_route_european` still sorts by a demerit
        magnitude and the contradiction tests in
        backend/tests/test_european_hell_basis.py still pass. An article is
        something a judge can cite by hand.
      * HELL_LAW (冥律) is EMPTY, and its emptiness is a finding rather than a
        backlog item. It was seeded in 6017f04 and withdrawn: there is no
        codified 冥律 to transcribe — 《玉历宝钞》 is a hall-by-hall morality
        tract with no articles, no numbering and no sentence lengths. The
        withdrawal note in seed_mythology.py has the detail; migration
        judgment/0012 retired the rows.

        GONGGUOGE ARRIVING DOES NOT CHANGE THIS. The finding was about 冥律,
        not about the Chinese side having nothing: 《太微仙君功過格》 is real
        and is now seeded, and no codified 冥律 stands in the transmitted
        canon this system draws on. That claim is narrower than the one this
        paragraph used to make ("a document nobody has ever produced"). Qing
        spirit-writing morality books do include texts presenting themselves
        as infernal codes with schedules of penalty — 《冥罰淫律》 and the
        《金科輯要》 family — and whether any of them is "codified" in the
        sense meant here has not been checked against their own text. The
        finding holds for the Daozang and the standard tracts; it was
        overstated as a claim about every text that has ever existed. HELL_LAW stays empty, and refilling it with the 功過格
        articles would re-assert the very thing 8308204 withdrew.
      * GONGGUOGE (功過格) is 《太微仙君功過格》 (1171, Daozang 洞真部戒律類),
        74 transcribed articles under CN-GGG-*: 35 功 and 39 過, in four gates
        each. Signed, enumerated, point-valued — the shape `polarity` was built
        for — and the ONLY corpus here whose articles carry positive entries.
        It is also the one corpus this system uses for something its own text
        does not claim: a 功過格 is an account book the LIVING keep on
        themselves, whose sanctions are 奪紀奪算 (years struck off a life),
        the 300/1300-good thresholds for immortality and 餘慶餘殃 falling on
        descendants. 太微 names no hell anywhere. Every seeded row carries that
        appropriation in `source_notes` rather than being quietly filed as
        infernal law, which is exactly how the withdrawn HELL_LAW corpus
        started.

      * GORGIAS and REPUBLIC_ER are the GREEK pair, and they are two for the
        same reason DEADLY_SIN and INFERNO are two. Both are Plato, both are
        the judgement of the dead, and they do not describe one afterlife:
        Gorgias 526b-c stamps a soul, sends it to Tartarus or the Isles, and
        stops — no term, no return, no arithmetic anywhere in it — while
        Republic X 615a-b sentences it to a thousand-year circuit at tenfold
        the wrong, and 621a-b sends it back to be born again. A single Greek
        corpus would assert a terminal sentence AND a return, which is neither
        dialogue.

        NEITHER SOURCE ENUMERATES, and that is the fact these two were built
        around. The other four corpora all inherit a series from their
        document — 74 numbered articles, 42 assessors, 7 terraces, 9 circles.
        The Platonic myths inherit none, so the article here is a RULE OF THE
        COURT (see StatutePolarity.PROCEDURE): the reform, the bench, the
        venue, the rule of evidence, the purpose of punishment, the rate and
        the unit. Twenty-three articles under GR-GRG-* and GR-ER-* (GORGIAS 12,
        REPUBLIC_ER 11), of which twenty-one are PROCEDURE, one carries MERIT,
        and exactly one carries OFFENCE polarity — Republic X 615b, which names
        three wrongs after "for example" and closes with "any other evil
        behaviour". That catch-all is NOT a gap to be filled; expanding it is
        precisely how the withdrawn HELL_LAW corpus was written.

        GREEK'S EMPTINESS WAS THE ONLY UNDECLARED ONE. HELL_LAW is empty and
        says so. GREEK had no corpus at all, so it had no entry in
        CORPUS_PROVENANCE and could not have had one — the guard walked
        StatuteCorpus members, and a civilization that appears in no corpus is
        invisible to a check that iterates corpora. That guard now walks
        civilizations.

    THE EMPTY VALUE IS KEPT ON PURPOSE. Rows still carry it — the ones 0012
    soft-deleted, and any it refused to touch because a judgment had already
    cited them — and a value that has left the enum is a row whose `corpus` no
    longer renders, no longer validates, and no longer reverses. An empty choice
    costs nothing; an unreadable stored value costs a decided case its stated
    grounds. The same applies to the retired EU-DS-01..07 rows, which are
    DEADLY_SIN tombstones sitting beside the seven live terrace articles.

    WHY GONGGUOGE IS A NEW VALUE AND NOT A REFILL OF HELL_LAW. A 功過格 is an
    account book the living keep on themselves; 冥律 claims to be a penal code
    hell administers. Reusing the name would file the one under the other and
    resurrect exactly the framing that had to be withdrawn — and it would do it
    silently, because the codes and the prose would all look correct. The
    citation keys are new for the same reason the terraces' are (CN-GGG-*, not
    CN-HL-*): judgment/0012 deliberately left cited articles live, so a
    CN-HL-O01 may still exist on a deployed database, and `_upsert` matches on
    `code`.

    So `corpus` says what kind of thing the reader is looking at, and
    CORPUS_CIVILIZATION below pins each one to the single cosmology it belongs
    to. A statute may not be filed under a corpus its civilization does not
    have; `Statute.clean` refuses it.
    """
    HELL_LAW = "HELL_LAW", "冥律 — Hell Law (Chinese)"
    GONGGUOGE = "GONGGUOGE", "功過格 — Ledger of Merit and Demerit (Chinese)"
    NEGATIVE_CONFESSION = "NEGATIVE_CONFESSION", "Declaration of Innocence (Egyptian)"
    DEADLY_SIN = "DEADLY_SIN", "Seven Deadly Sins (European)"
    INFERNO = "INFERNO", "Inferno — the Circles of Dante's Hell (European)"
    GORGIAS = "GORGIAS", "Gorgias — the Judgement of the Dead (Greek)"
    REPUBLIC_ER = "REPUBLIC_ER", "Republic X — the Myth of Er (Greek)"


#: The one civilization each corpus belongs to. A dict rather than a naming
#: convention on the code, so adding a corpus is one line here and an obvious
#: one to review.
CORPUS_CIVILIZATION = {
    StatuteCorpus.HELL_LAW: Civilization.CHINESE,
    StatuteCorpus.GONGGUOGE: Civilization.CHINESE,
    StatuteCorpus.NEGATIVE_CONFESSION: Civilization.EGYPTIAN,
    StatuteCorpus.DEADLY_SIN: Civilization.EUROPEAN,
    StatuteCorpus.INFERNO: Civilization.EUROPEAN,
    StatuteCorpus.GORGIAS: Civilization.GREEK,
    StatuteCorpus.REPUBLIC_ER: Civilization.GREEK,
}
#: Two corpora may share a civilization — Chinese has both the empty HELL_LAW
#: and the seeded GONGGUOGE, and Europe has both DEADLY_SIN (the terraces) and
#: INFERNO (the circles) — so this is deliberately not inverted into a
#: civilization -> corpus lookup anywhere. `Statute.clean` reads it in the one
#: direction that is a function.


class StatutePolarity(models.TextChoices):
    """Whether citing this article counts against the soul or for it.

    MERIT has rows behind it again: the 35 功 of GONGGUOGE. It was kept while
    the corpus that had them was withdrawn (see StatuteCorpus) because the
    distinction is real wherever the Chinese material lands — 功過相抵, merit
    offsetting fault, is the arithmetic a 功過格 is entirely made of, and
    without a polarity a judgment citing 賑濟窮民 would read as an accusation
    of almsgiving. What was fabricated was a numbering, not the idea that a
    ledger has two columns.

    Note what MERIT/OFFENCE does NOT say: that any merit article offsets any
    offence article. 《文昌帝君功過格》凡例 rules the opposite outright —
    「功過有不可折者。如用財之百功，不可折致死人之百過」 — and each seeded
    row carries a `payload_json["fungibility_class"]` saying which pool it
    belongs to. See apps/ledger/fungibility.py.

    DENIAL is the Egyptian case and is deliberately not folded into OFFENCE:
    "I have not stolen" is a claim the deceased makes, and what a judgment
    cites is the failure of that claim, not a prohibition on theft.

    PROCEDURE is the Greek case and it answers a different question from the
    other three. Those three all say which way an article cuts; this one says
    that it does not cut, because it is not about the soul's account at all.
    "The judge too shall be naked, that is to say, dead" (Gorg. 523e) is a rule
    the court is bound by. Filing it as OFFENCE would read as an accusation and
    filing it as MERIT as a credit; both would be a claim about the soul, and
    the article makes none.

    IT WAS ADDED BECAUSE A WHOLE COSMOLOGY NEEDED IT, not to round the enum
    out. Twenty-one of the twenty-three Greek articles are procedural, because
    Plato's two myths describe a court and a circuit and never a code of
    offences — see StatuteCorpus. A Greek judgment cites what the court is
    obliged to do; there is no Greek equivalent of 殺生 to cite instead.
    """
    OFFENCE = "OFFENCE", "Offence — counts against the soul"
    MERIT = "MERIT", "Merit — counts for the soul"
    DENIAL = "DENIAL", "Denial the deceased must sustain"
    PROCEDURE = "PROCEDURE", "Rule of the court — neither for nor against"


class Statute(AuditUserFields, models.Model):
    """One citable article of one cosmology's rulebook.

    A model rather than a text column on Judgment, for three reasons that are
    all about reuse rather than tidiness:

      1. An article is cited by many judgments. 杀生 is one rule; a free-text
         "依据：杀生" on each judgment is N spellings of it, and no query can
         ask "every case decided under this article" — which is the first
         question an explainable verdict invites.
      2. Articles are multilingual reference data and this codebase already has
         a shape for that: `title_zh/title_en/title_egy` + `get_localized_*`,
         the same convention Realm and Actor use. A JSON blob on Judgment would
         be a second, private one.
      3. The three corpora carry structurally different facts (a hell to serve
         in; a merit score; a terrace of Purgatory). `payload_json` holds the
         corpus-specific part, and `Statute` holds only what all three actually
         share: identity, provenance, and which way it cuts.

    DERIVED ARTICLES. `source_actor` is how the Egyptian 42 exist here without
    a second hand-maintained copy of the text. Those clauses are already in the
    database — `Actor.powers_json["negative_confession"]`, one per assessor,
    seeded from Budge with its edition recorded (see seed_mythology). A Statute
    row for assessor N carries the citation identity and points at that Actor;
    its body text is READ from the actor at display time by
    `get_localized_text`, and its own `text_*` columns stay empty. Copying the
    42 clauses across would make the seeder the second author of a text it does
    not own, and the two copies would drift the first time one was corrected.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    corpus = models.CharField(max_length=30, choices=StatuteCorpus.choices)
    code = models.CharField(
        max_length=40,
        help_text=(
            "Stable citation key, e.g. CN-GGG-F-JJ-01 / EG-NC-07 / EU-DS-T3 / "
            "EU-INF-C8-B02. CN-HL-* and EU-DS-01..07 are withdrawn keys and "
            "are not reused."
        ),
    )
    #: Position within the corpus. Explicit, for the reason the assessors'
    #: `assessor_index` is explicit: alphabetical ordering of 42 gods, or of
    #: seven sins in Gregory's order, is wrong in a way that looks fine.
    ordinal = models.IntegerField(default=0)
    polarity = models.CharField(
        max_length=10,
        choices=StatutePolarity.choices,
        default=StatutePolarity.OFFENCE,
    )

    title_zh = models.CharField(max_length=255, blank=True)
    title_en = models.CharField(max_length=255, blank=True)
    title_egy = models.CharField(max_length=255, blank=True)
    text_zh = models.TextField(blank=True)
    text_en = models.TextField(blank=True)
    text_egy = models.TextField(blank=True)

    #: Where this article comes from, in enough detail to check it. Never
    #: blank on a seeded row — an article with no provenance is the failure
    #: this whole feature exists to avoid.
    #: TextField and not CharField(500). The 500-char cap was silently violated
    #: from the day INFERNO arrived: `INFERNO_SOURCE` is 524 characters and
    #: `DEADLY_SIN_SOURCE` is 492, and neither is padding — the Inferno's
    #: provenance has to say, in the citation itself, that the layering is
    #: Aristotle's tripartition and NOT the seven capital sins, because that
    #: confusion is exactly what the corpus exists to prevent.
    #:
    #: Nothing caught it because SQLite does not enforce varchar length and the
    #: whole suite runs on SQLite. It surfaced the first time seed_mythology met
    #: a real PostgreSQL (2026-08-27): `DataError: value too long for type
    #: character varying(500)`, with no column named. A cap that only one of the
    #: two engines enforces is not a constraint, it is a landmine.
    source = models.TextField(blank=True)
    #: Verbatim caveats, carried rather than smoothed over — the same
    #: discipline as the assessors' `source_notes`. A list of strings.
    source_notes = models.JSONField(default=list, blank=True)
    #: Corpus-specific structured facts: `purgatorio_terrace`, `latin`,
    #: `opposing_virtue_*` and the terrace's realm_code for the seven sins,
    #: `assessor_index` for the Forty-Two, and for GONGGUOGE the two-level
    #: 門 classification plus the scoring structure a single scalar cannot
    #: hold — `clauses` (救濟門#4 alone carries twelve conditional values),
    #: `nullifiers` (「則無功」), `cap`, `derived`, `money_rate` and
    #: `fungibility_class`. Point values live in `clauses[].points` as JSON
    #: numbers rather than in a column, because 半功/半過 is 0.5 and the
    #: article is a table of conditions, not one number. For INFERNO it holds
    #: `circle`, the subdivision's kind/index/name, `parent_code` and
    #: `within_dis` — the wall of Dis, which is the poem's only real divider.
    #: NOT `dante_circle` — that key was retired with the first attempt at the
    #: seven, and `circle` on a circle article is not it: one was a coordinate
    #: invented for a sin, the other is the article's own identity. See
    #: StatuteCorpus.
    payload_json = models.JSONField(default=dict, blank=True)

    #: The row this article's text is derived from. Set for the Egyptian 42;
    #: null for everything transcribed from a document.
    source_actor = models.ForeignKey(
        "actors.Actor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="derived_statutes",
        help_text="Derivation source; the article body is read from this row.",
    )
    #: Which key of `source_actor.powers_json` holds the body text.
    source_actor_field = models.CharField(max_length=50, blank=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="statutes",
        null=True,
    )

    #: 版本:第几次修订(1 起)与这一版自哪天起施行。只在条文本身变了时加一 ——
    #: `VERSIONED_FIELDS` 之一变了(`save()` 比对库里那一行),所以 `seed_mythology` 重跑
    #: 不改字就不升版,`--update` 改了正文才升。存量行由 judgment/0032 定为第 1 版、
    #: 施行日 = 入库那天(`create_time`)。
    #: 不是一张版本历史表:旧文本已经由结案时的引用快照(`JudgmentCitation.snapshot_*`)
    #: 保住了,需要的只是「现在读到的是第几版、从哪天起」。
    #: 埃及四十二条的正文读自 `source_actor`,改那位陪审神的条文不会让这里升版。
    revision = models.PositiveIntegerField(default=1)
    effective_from = models.DateField(default=timezone.localdate)

    class Meta:
        ordering = ["civilization", "corpus", "ordinal", "code"]
        verbose_name = "Statute"
        verbose_name_plural = "Statutes"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                # Scoped to live rows. Without this, soft-deleting a row leaves
                # its key occupied by something no filtered queryset can see:
                # re-creating the same key then fails a uniqueness check
                # against a row that is invisible to every read path.
                # See tests/test_soft_delete_frees_unique_keys.py.
                # This one has already bitten once: migration 0018 had to stop
                # using `row.delete()` because the soft-deleted row kept the
                # code and the rename then failed a UNIQUE check.
                condition=models.Q(is_deleted=False),
                name="unique_statute_tenant_code",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "corpus"]),
            models.Index(fields=["civilization", "corpus", "ordinal"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.code} {self.title_en or self.title_zh}"

    def save(self, *args, **kwargs):
        """`clean()` is not called by anything Django runs on a write.

        `Model.save()` does not call `full_clean()`, DRF serializers do not
        call it either (`is_valid()` runs *serializer* validators), and
        `update_or_create` goes straight to `save()`. So the corpus/civilization
        cross-check below was reachable only from a ModelForm — and the only
        form in this project is the admin's. **Every path that actually writes
        statutes — `seed_mythology`, migrations' data steps, the shell — went
        around it.** A check nothing calls is [[verification-mechanisms-fail-
        silently-here]]: it reads as enforcement and enforces nothing.

        `self.clean()`, not `self.full_clean()`: `full_clean` would also run
        field-level validation (blank/choices/max_length) on rows that
        migrations write with deliberately partial values, which would turn a
        narrow invariant into a broad and untested one.
        """
        self.clean()
        if not self._state.adding:
            self._bump_revision_if_text_changed(kwargs)
        return super().save(*args, **kwargs)

    #: 这些列变了,读者读到的就是另一条律文 —— 升一版。`ordinal` / `tenant` 不在内:
    #: 换位置、补租户不改条文。
    VERSIONED_FIELDS = (
        "polarity", "title_zh", "title_en", "title_egy", "text_zh", "text_en", "text_egy",
        "source", "source_notes", "payload_json", "source_actor_id", "source_actor_field",
    )

    def _bump_revision_if_text_changed(self, save_kwargs):
        stored = Statute.all_objects.filter(pk=self.pk).values(*self.VERSIONED_FIELDS, "revision").first()
        if stored is None:
            return
        if all(stored[f] == getattr(self, f) for f in self.VERSIONED_FIELDS):
            return
        self.revision = stored["revision"] + 1
        self.effective_from = timezone.localdate()
        update_fields = save_kwargs.get("update_fields")
        if update_fields is not None:
            save_kwargs["update_fields"] = {*update_fields, "revision", "effective_from"}

    def clean(self):
        expected = CORPUS_CIVILIZATION.get(self.corpus)
        if expected is not None and self.civilization != expected:
            raise ValidationError(
                {
                    "corpus": (
                        f"{self.corpus} belongs to {expected}, not "
                        f"{self.civilization}. A corpus is one cosmology's "
                        f"rulebook; filing an article under another's states a "
                        f"rule that tradition does not have."
                    )
                }
            )

    @property
    def derived_text(self) -> str:
        """The body text held on `source_actor`, or "" when this is not a
        derived article.

        Reads through `source_actor_field` rather than hardcoding
        `negative_confession`, so a second derived corpus does not have to
        rename the Egyptian one to reuse this. The rendering lives in
        `apps/judgment/snapshot.py` so the conclusion snapshot and the
        serializer share one definition of "the text"."""
        return snapshot.derived_text(self)

    def get_localized_title(self, locale: str = "en") -> str:
        return snapshot.localized_title(self, locale)

    def get_localized_text(self, locale: str = "en") -> str:
        """The article body in the requested locale.

        Falls through to `derived_text` last rather than first: a derived
        article that later acquires a real translation should show it, and the
        Egyptian clauses have no Chinese rendering at all (neither do the
        assessors' names — see seed_mythology on `name_zh`)."""
        return snapshot.localized_text(self, locale)


class CitationSnapshotKind(models.TextChoices):
    # 结案时在同一事务里拍下的。
    CONCLUDED = "CONCLUDED", "Concluded"
    # 这一列出现之前就结了的案子,由迁移用「迁移那天」的文字补录 —— 不是结案时的文字。
    BACKFILLED = "BACKFILLED", "Backfilled"


class JudgmentCitation(AuditUserFields, models.Model):
    """One article cited as the basis of one judgment.

    A through-model with its own columns rather than a plain M2M, because the
    interesting part is per-citation: *why* this article applies to this case
    (`note`), and who entered it and when — which AuditUserFields already
    carries, and which is the whole point of making a verdict explainable.

    `statute` is PROTECT. A cited article is evidence of how a case was
    decided; letting it be deleted out from under a concluded judgment would
    turn a recorded basis into a dangling id. Retiring an article means
    soft-deleting it (`is_deleted`), which keeps existing citations readable
    while taking it out of the picker.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(
        Judgment,
        on_delete=models.CASCADE,
        related_name="citations",
    )
    statute = models.ForeignKey(
        Statute,
        on_delete=models.PROTECT,
        related_name="citations",
    )
    note = models.TextField(
        blank=True,
        help_text="How this article applies to this case.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # 结案时这条律条渲染出来的样子(apps/judgment/snapshot.py)。标题与正文按语言各一份
    # ({"zh","en","egy"}),埃及四十二条存的是从 `Actor.powers_json` 渲染出的正文。
    # 未结案的案子这几列全空:它们读现行文本。
    snapshot_title = models.JSONField(null=True, blank=True)
    snapshot_text = models.JSONField(null=True, blank=True)
    snapshot_source = models.TextField(blank=True, default="")
    snapshot_hash = models.CharField(max_length=64, blank=True, default="")
    snapshot_at = models.DateTimeField(null=True, blank=True)
    snapshot_kind = models.CharField(
        max_length=10, choices=CitationSnapshotKind.choices, blank=True, default="",
    )

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="judgment_citations",
        null=True,
    )

    class Meta:
        # Reads in the corpus's own order, not in the order somebody happened
        # to click them: a list of grounds is a list of articles, and the
        # 功過格/Forty-Two sequences are load-bearing.
        ordering = ["statute__corpus", "statute__ordinal", "created_at"]
        verbose_name = "Judgment citation"
        verbose_name_plural = "Judgment citations"
        constraints = [
            models.UniqueConstraint(
                fields=["judgment", "statute"],
                # Scoped to live rows. Without this, soft-deleting a row leaves
                # its key occupied by something no filtered queryset can see:
                # re-creating the same key then fails a uniqueness check
                # against a row that is invisible to every read path.
                # See tests/test_soft_delete_frees_unique_keys.py.
                condition=models.Q(is_deleted=False),
                name="unique_citation_judgment_statute",
            ),
        ]
        indexes = [
            models.Index(fields=["judgment"]),
            models.Index(fields=["tenant", "created_at"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.judgment_id} cites {self.statute.code}"


class EvidenceAdmission(AuditUserFields, models.Model):
    """Whether one ledger record is admitted as evidence in one judgment.

    Per judgment, not a flag on `SoulRecord`: the same deed can be admitted in
    one case and not in another — an amendment case, a reopened retrial, or a
    second court reading the same life — and a column on the record would make
    the second court's ruling overwrite the first's. It is the same shape as
    `JudgmentCitation`, one row per (judgment, thing) carrying why.

    NO ROW MEANS ADMITTED. The ledger is the evidence by default; a row is
    written when an officer rules on a record, and it keeps `admitted=True`
    when a ruling is reversed, so who reversed it and when stays on the row
    (AuditUserFields). `reason` is required when not admitting — enforced in
    `EvidenceAdmissionService` and again by the check constraint below.

    `record` is RESTRICT, not CASCADE: a hard delete of a record a court has
    ruled on is refused, while deleting the soul (which cascades to both the
    record and the judgment) still goes through.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(Judgment, on_delete=models.CASCADE, related_name="evidence_admissions")
    record = models.ForeignKey(
        "souls.SoulRecord", on_delete=models.RESTRICT, related_name="admissions",
    )
    admitted = models.BooleanField(default=True)
    reason = models.TextField(blank=True, help_text="Why the record is not admitted. Required when admitted is false.")
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="evidence_admissions",
        null=True,
    )

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Evidence admission"
        verbose_name_plural = "Evidence admissions"
        constraints = [
            models.UniqueConstraint(
                fields=["judgment", "record"],
                # Scoped to live rows, as `unique_citation_judgment_statute` is.
                condition=models.Q(is_deleted=False),
                name="unique_admission_judgment_record",
            ),
            models.CheckConstraint(
                condition=models.Q(admitted=True) | ~models.Q(reason=""),
                name="admission_refusal_has_reason",
            ),
        ]
        indexes = [
            models.Index(fields=["judgment", "admitted"]),
            models.Index(fields=["tenant", "created_at"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.judgment_id} {'admits' if self.admitted else 'excludes'} {self.record_id}"


class NegativeConfession(AuditUserFields, models.Model):
    """One of the 42 denials of BD 125B, as heard in one weighed case (docs/02_奥西里斯审判详解.md §2.2, §四).

    The deceased denies, before each of the 42 assessors in turn, one wrong; the officer records whether the
    denial was true. `statute` is that assessor's EG-NC-NN article (the clause itself lives on the assessor,
    `Statute.derived_text`), so the text is never copied here.

    NO ROW MEANS NOT YET HEARD. Per judgment, like `EvidenceAdmission`: a retrial weighs again and hears the
    confession again. Frozen with the case once it is concluded (`apps/judgment/confessions.py`), so what stands
    beside `weighing_result` is what was heard before the scale was read.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(Judgment, on_delete=models.CASCADE, related_name="negative_confessions")
    statute = models.ForeignKey("judgment.Statute", on_delete=models.PROTECT, related_name="confessions_heard")
    #: True = the denial is true (如实); False = it is not (不实). Null = heard, not yet decided.
    truthful = models.BooleanField(null=True, blank=True)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="negative_confessions",
        null=True,
    )

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["judgment", "statute"],
                condition=models.Q(is_deleted=False),
                name="unique_confession_judgment_statute",
            ),
        ]
        indexes = [models.Index(fields=["tenant", "created_at"])]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.judgment_id} {self.statute_id} {self.truthful}"


class JudgmentComment(AuditUserFields, models.Model):
    """评议: a note one officer leaves on a judgment for the others who can read it.

    Not the verdict text (`Judgment.notes`) and not evidence: it changes nothing about the case, so
    it may be written on open and concluded cases alike. Append-only from the API (no edit, no
    delete); `author` is who wrote it, `tenant` copies the judgment's hall at creation.
    """
    MAX_LENGTH = 2000

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(Judgment, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        "authentication.User", on_delete=models.SET_NULL, null=True, related_name="judgment_comments",
    )
    body = models.TextField(max_length=MAX_LENGTH)
    created_at = models.DateTimeField(auto_now_add=True)
    tenant = models.ForeignKey(
        "tenants.Tenant", on_delete=models.CASCADE, related_name="judgment_comments", null=True,
    )

    class Meta:
        ordering = ["created_at"]
        verbose_name = "Judgment comment"
        verbose_name_plural = "Judgment comments"
        indexes = [
            models.Index(fields=["judgment", "created_at"]),
            models.Index(fields=["tenant", "created_at"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.judgment_id} comment by {self.author_id}"


def _case_attachment_path(instance, filename):
    # 文件名由 attachments.py 随机生成,客户端的文件名只存在 `name` 列里、从不落盘。
    return f"private/case_attachments/{timezone.now():%Y/%m}/{filename}"


class CaseAttachment(models.Model):
    """案卷附件(2026-10-15,Design 第二十八批 W4):一份案卷上的一张图片或一份 PDF。

    文件与朋友圈图片、书信图片同一条路:Django 默认存储的 `private/` 前缀(nginx 与 DEBUG 路由都不公开),
    只经 `GET /api/v1/case-attachments/<id>/?t=<签名>` 出去,签名 10 分钟,每次取文件重算权限
    (`apps/judgment/attachments.py::may_view`)。
    租户:`tenant` 在上传时抄自案子(与 `JudgmentComment` 同一写法);读写都先经案子的租户划界。
    `deleted_at` 非空 = 已删:文件真删,行留着给审计对账。结案后不能删(见 `attachments.delete`)。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(Judgment, on_delete=models.CASCADE, related_name="attachments")
    tenant = models.ForeignKey(
        "tenants.Tenant", on_delete=models.CASCADE, related_name="case_attachments", null=True,
    )
    uploader = models.ForeignKey(
        "authentication.User", on_delete=models.SET_NULL, null=True, related_name="+",
    )
    name = models.CharField(max_length=255, help_text="上传时的文件名,只用于显示与下载。")
    file = models.FileField(upload_to=_case_attachment_path, max_length=200)
    byte_size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["judgment", "deleted_at", "created_at"]),
            models.Index(fields=["tenant", "created_at"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.judgment_id} attachment {self.name}"


# ---------------------------------------------------------------------------
# 申诉(灵魂对已结案审判的异议,用户 2026-10-24 决定)
# ---------------------------------------------------------------------------


#: 结案后多少天内可以申诉;每件审判最多申诉几次(撤回的也算一次)。
APPEAL_WINDOW_DAYS = 30
APPEAL_MAX_ROUNDS = 2


class AppealStatus(models.TextChoices):
    PENDING = "PENDING", "待复核"
    IN_REVIEW = "IN_REVIEW", "复核中"
    UPHELD = "UPHELD", "维持原判"
    AMENDED = "AMENDED", "改判"
    WITHDRAWN = "WITHDRAWN", "已撤回"
    #: 灵魂被阿米特吞噬(第二次死亡):申诉随之作废,无补偿、不改判(用户 2026-10-27,P2-10)。
    VOID = "VOID", "已作废"


#: 还没有结论的申诉:一件审判同一时刻至多一份(部分唯一约束)。
OPEN_APPEAL_STATUSES = (AppealStatus.PENDING, AppealStatus.IN_REVIEW)


class JudgmentAppeal(AuditUserFields, models.Model):
    """灵魂对一件已结案审判的申诉。写入只经 `apps/judgment/appeals.py`。

    复核人(`reviewer`)不能是作出原判的官员 —— 结案人(`Judgment.concluded_by`)或认领人。
    `original_verdict` 是提出时的裁决;改判后 `Judgment.verdict` 换成 `new_verdict`,原判只留在这里。
    `tenant` = 审判的租户(原审所在的殿),复核也在那里。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(Judgment, on_delete=models.CASCADE, related_name="appeals")
    soul = models.ForeignKey(Soul, on_delete=models.CASCADE, related_name="judgment_appeals")
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="judgment_appeals", null=True)
    round = models.PositiveSmallIntegerField()
    reason = models.TextField()
    #: 新证据:灵魂写的文字。不收附件(案卷附件只给官员上传)。
    evidence = models.TextField(blank=True, default="")
    status = models.CharField(max_length=10, choices=AppealStatus.choices, default=AppealStatus.PENDING)
    original_verdict = models.CharField(max_length=20, choices=Verdict.choices)
    new_verdict = models.CharField(max_length=20, choices=Verdict.choices, null=True, blank=True)
    reviewer = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="reviewed_appeals",
    )
    claimed_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default="")
    #: 上诉到本文明的多站申诉流程(`CaseType.APPEAL`,用户 2026-10-27):一次复核维持之后,灵魂用剩下的次数
    #: 「上诉」。有它时由流程定结论:驳回 = 维持原判,走完 = 申诉成立,由终审那位官员照常改判(`appeals.decide`)。
    workflow = models.OneToOneField(
        "workflow.ApprovalWorkflow", null=True, blank=True, on_delete=models.SET_NULL, related_name="judgment_appeal",
    )

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["-create_time"]
        constraints = [
            # Live rows only: a soft-deleted appeal must not hold its round or block a new one.
            models.UniqueConstraint(fields=["judgment", "round"], condition=models.Q(is_deleted=False),
                                    name="unique_appeal_round"),
            models.UniqueConstraint(
                fields=["judgment"],
                condition=models.Q(status__in=["PENDING", "IN_REVIEW"], is_deleted=False),
                name="unique_open_appeal_per_judgment",
            ),
            models.CheckConstraint(condition=models.Q(round__gte=1, round__lte=APPEAL_MAX_ROUNDS),
                                   name="appeal_round_in_range"),
        ]
        indexes = [models.Index(fields=["tenant", "status"])]

    def __str__(self):
        return f"Appeal {self.round} on {self.judgment_id} ({self.status})"


class CityGod(AuditUserFields, models.Model):
    """一位城隍(2026-10-24 用户决定,只在地府):登记与拘拿的前站。一殿可以有多位,各管几处出身地。

    `regions` 是地名(「杭州」「浙江」「临安县」),与灵魂的出身地(`Soul.origin_location`,自由文本)按
    「包含」匹配,规则在 `apps/judgment/city_gods.py::match`。不用 `Soul.origin_region`:那一列只有
    EUROPE / ASIA 两个值,是希腊冥界分判官用的(Gorgias 524a),地府的灵魂几乎全是 ASIA,分不出城隍。
    `is_default` = 本殿的兜底城隍:出身地没有匹配任何一位时交给它;本殿没有兜底时直接进十殿。
    `officers` = 分在这位城隍名下的官员(初审由他们办;殿管理员 `judgment.assign` 也能办)。

    不复用 `org.Organization`:官员只能属于一个组织(`User.organization` 是单个外键,数据范围也读它),
    分到城隍名下不能把他从所在的殿挪走;组织树也没有地名这一列。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="city_gods")
    name = models.CharField(max_length=100)
    regions = models.JSONField(default=list, blank=True)
    is_default = models.BooleanField(default=False)
    officers = models.ManyToManyField("authentication.User", blank=True, related_name="city_gods")
    #: 四级之一(docs/08 §二);空 = 未定级(这一列之前建的城隍)。
    rank = models.CharField(max_length=12, choices=CityGodRank.choices, blank=True, default="")
    #: 这位城隍设了哪些司(`CityGodBureau` 的值);docs/08:「级别越高,下属二十四司配置越齐全」—— 按实际配置记,不按级别推。
    bureaus = models.JSONField(default=list, blank=True)

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "name"], condition=models.Q(is_deleted=False),
                                    name="unique_city_god_name_per_hall"),
            models.UniqueConstraint(fields=["tenant"], condition=models.Q(is_default=True, is_deleted=False),
                                    name="one_default_city_god_per_hall"),
        ]

    def __str__(self):
        return self.name
