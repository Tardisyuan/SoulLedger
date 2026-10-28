"""处置期满:什么时候算刑期走完,以及每日检查怎么把它记下来。

期满的定义只有一处 —— `term_has_ended` —— 每日任务、管理命令、admin 动作与序列化器
里的 `term_end` 都读它,不另写一份。

什么时候**永远不**期满(`expire_for_tenant` 连候选都不选它们):

* `is_eternal` —— 永久刑。
* `sentence_years` 为 null —— 没有记录刑期(模型注释:null 不是「永久」,也不是 0)。
* 没执行过(`is_executed=False`)—— 没在服刑。
* 灵魂失踪(`LOST`)中 —— 失踪期间刑期不走(用户 2026-10-25 决定)。召回时把失踪的天数记进
  `lost_days`,期满日顺延这么多天(`hold_term_while_lost`、`term_end` 的 `lost_days`)。

起算日(`effective_term_start`):记了 `term_start_*` 就用它;**没记而已执行的,从执行那天
(`executed_at` 的本地日期)算**(产品负责人 2026-09-25 决定)。执行时 `DispositionService`
本来就会把空的起算日记成执行日,所以这条规则只接住那之前执行的存量行 —— 不回填数据,
规则写在这里,期满检查与序列化器的 `term_end` 读同一个函数。

边界:刑期在起算日的第 N 个周年日**当天**走完。起算日缺月或缺日时,取那一年 /
那个月里**最晚**的可能 —— 宁可晚一天记期满,不提前放人。这与
`sentence_elapsed_years` 的方向相反(那边缺精度时给上界,是「已服多少年」的
读数);期满是一个会被当成事实的写入,所以取保守的一边。
"""
import calendar
import datetime
import logging

from django.db import transaction
from django.db.models import BigIntegerField, Case, F, Q, Value, When
from django.db.models.functions import Cast, Coalesce, ExtractDay, ExtractMonth, ExtractYear
from django.db.models.lookups import GreaterThanOrEqual
from django.utils import timezone

logger = logging.getLogger(__name__)

#: 粗筛读候选时 `.iterator()` 的分块大小。
EXPIRY_CHUNK = 500


def effective_term_start(term_start, executed_at):
    """刑期从哪天算起,`(year, month, day)`;算不出来时 None。见模块 docstring。"""
    if term_start is not None and term_start[0] is not None:
        return term_start
    if executed_at is None:
        return None
    day = timezone.localdate(executed_at)
    return (day.year, day.month, day.day)


def term_end(term_start, sentence_years, lost_days=0):
    """刑期走完的那一天,`(year, month, day)`;算不出来时 None。

    年份跨过公元前 / 公元交界时多加一年:没有公元 0 年,所以 1 BCE 起算的 1 年刑
    在 1 CE 走完,不是在「0 年」。月、日照抄起算日 —— 缺的就还是缺的
    (`None`),由 `term_has_ended` 决定缺精度时怎么比。
    """
    if term_start is None or sentence_years is None:
        return None
    year, month, day = term_start
    if year is None:
        return None
    end_year = year + sentence_years
    if year < 0 <= end_year:
        end_year += 1
    if lost_days and end_year >= 1:
        month = month or 12
        last = calendar.monthrange(end_year, month)[1]
        day = day or last
        # 2 月 29 日起算、期满年不是闰年:多出的一天顺到 3 月 1 日,与 `term_has_ended` 的比较一致。
        end = datetime.date(end_year, month, min(day, last)) + datetime.timedelta(days=lost_days + max(day - last, 0))
        return (end.year, end.month, end.day)
    return (end_year, month, day)


def term_has_ended(term_start, sentence_years, today: datetime.date, lost_days=0) -> bool:
    """`today` 这一天,刑期是否已经走完。见模块 docstring 的边界规则。"""
    end = term_end(term_start, sentence_years, lost_days)
    if end is None:
        return False
    end_year, end_month, end_day = end
    if end_month is None:
        # 只知道年份:那一年的最后一天。
        end_month, end_day = 12, 31
    elif end_day is None:
        end_day = calendar.monthrange(max(end_year, 1), end_month)[1]
    # 2 月 29 日起算、期满年不是闰年:3 月 1 日期满(元组比较自然给出这个答案)。
    return (today.year, today.month, today.day) >= (end_year, end_month, end_day)


#: `term_end_sort_key` 给「没有期满日」的行的值:永久刑、没记刑期、没有起算日。
#: 比任何真实的期满日都大,所以升序时排最后、降序时排最前 —— 「永不期满」就是最远的那一天。
NO_TERM_END = 2**62


#: 年份先加这么多再算日序:整数除法在两边都是「向零截断」,保证被除数非负才等于向下取整。
#: 400 的倍数,不改格里历周期;够到公元前四百万年。
_YEAR_SHIFT = 400 * 10_000


def _day_number(year, month, day):
    """`(年, 月, 日)` 三个 bigint 表达式 → 连续的日序(儒略日数的写法,整数运算)。

    对 `day` 是线性的,所以 `day = 0` 是上个月最后一天、`day` 超出当月天数顺到下个月 ——
    与 `term_end` 里 2 月 29 日顺到 3 月 1 日同一个结果。`month = 13` 等于下一年 1 月。
    """
    big = BigIntegerField()
    a = (Value(14, output_field=big) - month) / Value(12, output_field=big)
    y = year + Value(_YEAR_SHIFT, output_field=big) - a
    m = month + Value(12, output_field=big) * a - Value(3, output_field=big)
    return (
        day
        + (Value(153, output_field=big) * m + Value(2, output_field=big)) / Value(5, output_field=big)
        + Value(365, output_field=big) * y
        + y / Value(4, output_field=big)
        - y / Value(100, output_field=big)
        + y / Value(400, output_field=big)
    )


def term_end_sort_key():
    """期满日的 SQL 排序键:期满那一天的日序(一个整数),升序即期满近 → 远。

    与 `effective_term_start` + `term_end` 同一条规则,在 SQL 里再写一遍 —— 列表按它排序
    分页,Python 一侧排不了分页之外的行。起算日:`term_start_year` 有值就用 `term_start_*`
    三列,否则用 `executed_at` 的本地日期(`Extract*` 与 `timezone.localdate` 取的是同一个
    当前时区)。缺月取 12 月 31 日,缺日取那个月最后一天(下个月的第 0 天),与
    `term_has_ended` 缺精度时取最晚一天相同。跨公元交界多加一年,与 `term_end` 相同。
    失踪顺延的 `lost_days` 加在日序上,只在期满年是公元后时加 —— 与 `term_end` 一致。

    算不出期满日(永久、`sentence_years` 为空、既无起算日也未执行)的行取 `NO_TERM_END`。
    先转 bigint 再算:PostgreSQL 上 `integer` 会溢出(刑期可以是上万年)。
    """
    big = BigIntegerField()
    has_start = Q(term_start_year__isnull=False)
    start_year = Case(When(has_start, then=Cast("term_start_year", big)), default=Cast(ExtractYear("executed_at"), big))
    start_month = Case(When(has_start, then=Cast("term_start_month", big)), default=Cast(ExtractMonth("executed_at"), big))
    start_day = Case(When(has_start, then=Cast("term_start_day", big)), default=Cast(ExtractDay("executed_at"), big))
    years = Cast("sentence_years", big)
    # 公元前起算、期满在公元后(`year < 0 <= year + years`)多一年。`executed_at` 不会是公元前。
    crosses_era = When(term_start_year__lt=0, term_start_year__gte=-F("sentence_years"), then=Value(1))
    end_year = start_year + years + Case(crosses_era, default=Value(0), output_field=big)
    # 缺日:下个月的第 0 天;缺月:12 月 31 日(13 月第 0 天)。
    month = Coalesce(start_month, Value(12), output_field=big)
    month_for_day = Case(When(Q(term_start_year__isnull=False, term_start_day__isnull=True), then=month + Value(1)), default=month, output_field=big)
    day = Coalesce(start_day, Value(0), output_field=big)
    lost = Case(When(Q(lost_days__gt=0), then=Cast("lost_days", big)), default=Value(0), output_field=big)
    key = _day_number(end_year, month_for_day, day) + Case(
        When(GreaterThanOrEqual(end_year, Value(1)), then=lost), default=Value(0), output_field=big
    )
    return Case(
        When(is_eternal=True, then=Value(NO_TERM_END)),
        When(sentence_years__isnull=True, then=Value(NO_TERM_END)),
        When(term_start_year__isnull=True, executed_at__isnull=True, then=Value(NO_TERM_END)),
        default=key,
        output_field=big,
    )


def reopen_if_term_extended(disposition, today: datetime.date | None = None) -> bool:
    """期满之后刑期或起算日被改、新的期满日还没到:清掉 `expired_at`。返回是否清了。

    只在算得出一个期满日、且它在 `today` 之后时清 —— 改成永久刑、或把刑期删掉,
    都不是「刑期延长到某一天」,期满记录留着。改了但仍已走完(改短、或延长了却仍在过去)
    也留着。不 `save()`:调用方(`DispositionSerializer.update`)写。
    """
    if disposition.expired_at is None or disposition.is_eternal:
        return False
    start = effective_term_start(
        (disposition.term_start_year, disposition.term_start_month, disposition.term_start_day),
        disposition.executed_at,
    )
    if term_end(start, disposition.sentence_years) is None:
        return False
    if term_has_ended(start, disposition.sentence_years, today or timezone.localdate(), disposition.lost_days):
        return False
    disposition.expired_at = None
    return True


def candidates(tenant_id, today: datetime.date):
    """这个租户里**可能**今天期满的处置(SQL 粗筛;精确判定在 `term_has_ended`)。

    粗筛条件是「起算年 + 刑期 ≤ 今年 + 1」:那个 +1 容纳跨公元交界多出的一年
    (以及 `executed_at` 的 UTC 年与本地年在元旦前后差的那一年),所以它是精确集合的
    超集,不会漏;多选进来的由 Python 那一步排掉。起算年缺时取执行年,见
    `effective_term_start`。`lost_days` 只会把期满日往后推,所以粗筛照旧是超集。

    失踪中的灵魂不选:失踪期间刑期不走。
    """
    from apps.disposition.models import Disposition
    from apps.souls.models import SoulState

    return (
        Disposition.objects.filter(
            tenant_id=tenant_id,
            is_executed=True,
            is_eternal=False,
            expired_at__isnull=True,
            sentence_years__isnull=False,
        )
        .filter(Q(term_start_year__isnull=False) | Q(executed_at__isnull=False))
        .exclude(soul__current_state=SoulState.LOST)
        .alias(term_end_year=Coalesce(F("term_start_year"), ExtractYear("executed_at")) + F("sentence_years"))
        .filter(term_end_year__lte=today.year + 1)
        .order_by("pk")
    )


def ascend_from_purgatory(disposition, *, via: str) -> bool:
    """A European soul whose purgatory is over goes up to heaven (user decision 2026-10-27).

    Purgatory is passage, not a third destination: the saved are purged and then enter heaven
    (docs/01_欧洲天堂地狱整体架构.md §1.2, docs/03_七宗罪与地狱惩罚.md §5.1). ``via`` is ``TERM_SERVED`` (the expiry
    sweep) or ``PURGATORY_REVIEW`` (a 炼狱复核 flow approved, which counts as served). Only while the soul still
    stands in that purgatory realm; the move and its ``PURGATORY_ASCENDED`` event are one unit in the caller's
    transaction. Returns whether the soul moved."""
    from apps.events.services import EventService
    from apps.realms.models import RealmType, SoulPathEntry, realm_by_code
    from apps.realms.path import SoulPathService
    from apps.souls.models import Civilization

    realm = disposition.destination_realm
    if realm is None or realm.civilization != Civilization.EUROPEAN or realm.realm_type != RealmType.PURGATORY:
        return False
    soul = disposition.soul
    here = SoulPathEntry.all_objects.filter(soul_id=soul.pk, left_at__isnull=True).values_list("realm_id", flat=True)
    if realm.pk not in here:
        return False
    from apps.disposition.services import DispositionService

    heaven = realm_by_code(DispositionService.EU_HEAVEN, tenant_id=disposition.tenant_id)
    if heaven is None:
        logger.warning("purgatory: hall %s has no %s; soul %s stays", disposition.tenant_id,
                       DispositionService.EU_HEAVEN, soul.pk)
        return False
    # 先经地上乐园(2026-10-28,docs/03 §5.1;Purg. XXVIII-XXXIII):山顶饮 Lethe 忘罪、饮 Eunoè 忆善,
    # 「纯净、准备好登上群星」,然后才升天堂。行程上留下这一站;租户没有这一行(未重跑种子)就直接升,照旧。
    summit = realm_by_code(DispositionService.EU_EARTHLY_PARADISE, tenant_id=disposition.tenant_id)
    with transaction.atomic():
        if summit is not None and summit.pk != realm.pk:
            SoulPathService.enter(soul, summit, tenant_id=disposition.tenant_id)
        SoulPathService.enter(soul, heaven, tenant_id=disposition.tenant_id)
        EventService.log(soul, "PURGATORY_ASCENDED", {
            "disposition_id": str(disposition.pk), "from_realm": realm.realm_code, "realm": heaven.realm_code,
            "via": via,
            # 经过的山顶与两道水(Lethe 在前,Eunoè 在后);没经过山顶时两项都空。
            "through": summit.realm_code if summit is not None else "",
            "waters": ["LETHE", "EUNOE"] if summit is not None else [],
        })
    return True


def expire_for_tenant(tenant, today: datetime.date | None = None) -> dict:
    """把这个租户里刑期已走完的处置标为期满。幂等:已标过的不再选中。

    每一行在自己的事务里、在行锁下复查 `expired_at` 再写 —— 两次并发的检查
    (定时一次、手动一次)不会各发一次事件。写走 `save()`,所以审计信号照常记
    一条 UPDATE(与 `execute` 写 `is_executed` 同一条路);另在灵魂时间线上记
    `DISPOSITION_EXPIRED`。调用方负责设置租户 contextvar(见 tasks.py),
    审计行才归得到租户。

    不动灵魂状态:期满的灵魂在等轮回,推进它是转生那一步的事。唯一的例外是欧洲炼狱:期满即升天堂
    (`ascend_from_purgatory`,同一事务;用户 2026-10-27 决定)。
    """
    from apps.disposition.models import Disposition
    from apps.events.services import log_disposition_expired

    if today is None:
        today = timezone.localdate()
    now = timezone.now()

    due = [
        pk
        for pk, y, m, d, executed_at, years, lost_days in candidates(tenant.pk, today).values_list(
            "pk", "term_start_year", "term_start_month", "term_start_day", "executed_at", "sentence_years",
            "lost_days",
        ).iterator(chunk_size=EXPIRY_CHUNK)
        if term_has_ended(effective_term_start((y, m, d), executed_at), years, today, lost_days)
    ]

    expired = 0
    failed = []
    for pk in due:
        # One row's failure (today: its DISPOSITION_EXPIRED event could not be written, which rolls the row's
        # expiry back with it) must neither pass silently nor stop the other rows. It is logged with the
        # original exception, counted, and reported in the result; the row stays due and is retried by the next
        # run (idempotent).
        try:
            with transaction.atomic():
                row = (
                    Disposition.objects.select_for_update(of=("self",))
                    .select_related("soul", "destination_realm")
                    .filter(pk=pk, tenant_id=tenant.pk, expired_at__isnull=True)
                    .first()
                )
                if row is None:
                    continue
                row.expired_at = now
                row.save(update_fields=["expired_at"])
                log_disposition_expired(row)
                ascend_from_purgatory(row, via="TERM_SERVED")
                expired += 1
        except Exception:
            logger.exception("disposition expiry: row %s of tenant %s left unexpired", pk, tenant.code)
            failed.append(str(pk))

    return {"tenant": tenant.code, "expired": expired, "failed": failed, "today": today.isoformat()}


def hold_term_while_lost(soul, old_state, new_state, now=None) -> None:
    """失踪与召回时刑期的停与走(用户 2026-10-25 决定)。由 `Soul.transition_to` 在同一事务里调。

    标记失踪(→ LOST):这一世在服、未期满的处置记下 `lost_since`。召回(LOST →):把
    失踪起到今天的天数(本地日期相减)加进 `lost_days`,清掉 `lost_since`。此前就已失踪、
    没有 `lost_since` 的存量行召回时不顺延 —— 不知道从哪天算起,不猜。
    """
    from apps.disposition.models import Disposition
    from apps.souls.models import SoulState

    if SoulState.LOST not in (old_state, new_state) or old_state == new_state:
        return
    now = now or timezone.now()
    running = Disposition.objects.filter(
        soul_id=soul.pk, tenant_id=soul.tenant_id, is_executed=True, expired_at__isnull=True
    )
    if new_state == SoulState.LOST:
        running.update(lost_since=now)
        return
    today = timezone.localdate(now)
    for row in running.filter(lost_since__isnull=False).select_for_update():
        row.lost_days += max((today - timezone.localdate(row.lost_since)).days, 0)
        row.lost_since = None
        row.save(update_fields=["lost_days", "lost_since"])
