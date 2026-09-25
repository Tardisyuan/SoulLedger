"""处置期满:什么时候算刑期走完,以及每日检查怎么把它记下来。

期满的定义只有一处 —— `term_has_ended` —— 每日任务、管理命令、admin 动作与序列化器
里的 `term_end` 都读它,不另写一份。

什么时候**永远不**期满(`expire_for_tenant` 连候选都不选它们):

* `is_eternal` —— 永久刑。
* `sentence_years` 为 null —— 没有记录刑期(模型注释:null 不是「永久」,也不是 0)。
* 没执行过(`is_executed=False`)—— 没在服刑。

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

from django.db import transaction
from django.db.models import F, Q
from django.db.models.functions import Coalesce, ExtractYear
from django.utils import timezone

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


def term_end(term_start, sentence_years):
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
    return (end_year, month, day)


def term_has_ended(term_start, sentence_years, today: datetime.date) -> bool:
    """`today` 这一天,刑期是否已经走完。见模块 docstring 的边界规则。"""
    end = term_end(term_start, sentence_years)
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
    if term_has_ended(start, disposition.sentence_years, today or timezone.localdate()):
        return False
    disposition.expired_at = None
    return True


def candidates(tenant_id, today: datetime.date):
    """这个租户里**可能**今天期满的处置(SQL 粗筛;精确判定在 `term_has_ended`)。

    粗筛条件是「起算年 + 刑期 ≤ 今年 + 1」:那个 +1 容纳跨公元交界多出的一年
    (以及 `executed_at` 的 UTC 年与本地年在元旦前后差的那一年),所以它是精确集合的
    超集,不会漏;多选进来的由 Python 那一步排掉。起算年缺时取执行年,见
    `effective_term_start`。
    """
    from apps.disposition.models import Disposition

    return (
        Disposition.objects.filter(
            tenant_id=tenant_id,
            is_executed=True,
            is_eternal=False,
            expired_at__isnull=True,
            sentence_years__isnull=False,
        )
        .filter(Q(term_start_year__isnull=False) | Q(executed_at__isnull=False))
        .alias(term_end_year=Coalesce(F("term_start_year"), ExtractYear("executed_at")) + F("sentence_years"))
        .filter(term_end_year__lte=today.year + 1)
        .order_by("pk")
    )


def expire_for_tenant(tenant, today: datetime.date | None = None) -> dict:
    """把这个租户里刑期已走完的处置标为期满。幂等:已标过的不再选中。

    每一行在自己的事务里、在行锁下复查 `expired_at` 再写 —— 两次并发的检查
    (定时一次、手动一次)不会各发一次事件。写走 `save()`,所以审计信号照常记
    一条 UPDATE(与 `execute` 写 `is_executed` 同一条路);另在灵魂时间线上记
    `DISPOSITION_EXPIRED`。调用方负责设置租户 contextvar(见 tasks.py),
    审计行才归得到租户。

    不动灵魂状态:期满的灵魂在等轮回,推进它是转生那一步的事。
    """
    from apps.disposition.models import Disposition
    from apps.events.services import log_disposition_expired

    if today is None:
        today = timezone.localdate()
    now = timezone.now()

    due = [
        pk
        for pk, y, m, d, executed_at, years in candidates(tenant.pk, today).values_list(
            "pk", "term_start_year", "term_start_month", "term_start_day", "executed_at", "sentence_years"
        ).iterator(chunk_size=EXPIRY_CHUNK)
        if term_has_ended(effective_term_start((y, m, d), executed_at), years, today)
    ]

    expired = 0
    for pk in due:
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
            expired += 1

    return {"tenant": tenant.code, "expired": expired, "today": today.isoformat()}
