"""审判期限(v4 D10,用户 2026-11-06)。**系统自设,非出典。**

docs/ 里没有审判期限:地府的七七斋期是《十王经》的时间表,项目采的是《玉历》的空间化十殿(docs/11 §3);
埃及的 70 天是开审**之前**的防腐(`held_until`,docs/02_奥西里斯 §1.1);希腊《理想国》616b 的「草地七日」
说的是灵魂在草地停留,不是判官的期限;欧洲的私审判没有天数。所以天数是用户定的系统设定:地府 7、希腊 7、
埃及 12、欧洲 7(`apps/tenants/models.py::DEFAULT_DEADLINE_DAYS`),殿管理员可在殿设置里改
(`Tenant.settings["judgment_deadline_days"]`,与转生冷却天数同一先例)。

* **从「可认领」起算**(`Judgment.claimable_since`,由 `Judgment.save` 经 `refresh_claimable_since` 维护):
  开案那一刻;要城隍初审的,解送那一刻;押在枉死城或在防腐的,`held_until` 那天(殿的时区)0 点;
  提前释放的,释放那一刻。还在城隍处、或永远到不了审判殿(`DUAT_BARRED`)的没有起点,不计期限。
* **待定期间不计**:撤销待定时把这一段加进 `deferred_total`(`claims._apply_undefer`);正在待定的,
  剩余时间停在放进待定的那一刻,也不算过期(v4 `queue.deferred_hint`「仍归本人，不计期限」)。
* 期限不存:`claimable_since + deferred_total + 殿的天数`。殿改了天数,未结的案子当场按新天数算。

已知的边:希腊未葬 / 无渡资的亡魂(`claims.ferry_barred`)读的是灵魂此刻的记录,补记「已葬」不经过案子的
`save()`,所以它的起点仍是开案那一刻。ponytail: 要精确就在补记时也 `save()` 一次案子。
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import DateTimeField, ExpressionWrapper, F, Q
from django.utils import timezone

#: queryset 上的别名:起点加上已结束的待定。过期 = 它早于 `now - 天数`。
DUE_BASE = "deadline_base"


def _hall_tz(judgment) -> ZoneInfo:
    tenant = judgment.tenant if judgment.tenant_id is not None else None
    return ZoneInfo(tenant.hall_timezone if tenant is not None else "UTC")


def refresh_claimable_since(judgment, now=None) -> bool:
    """按案子此刻的列重算 `claimable_since`;变了返回 True(调用方把列加进 update_fields)。结案后不再动。"""
    from apps.judgment.models import AT_CITY_GOD, DUAT_BARRED

    if judgment.verdict is not None or judgment.is_final:
        return False
    now = now or timezone.now()
    if judgment.city_god_status in AT_CITY_GOD or judgment.duat_stage in DUAT_BARRED:
        new = None
    else:
        new = judgment.claimable_since
        if new is None or new > now:  # 第一次可认领,或原定的 held_until 被提前了
            new = now
        if judgment.held_until is not None:
            held = datetime.combine(judgment.held_until, time.min, tzinfo=_hall_tz(judgment))
            new = max(new, held)
    if new == judgment.claimable_since:
        return False
    judgment.claimable_since = new
    return True


def deadline_at(judgment):
    """截止时刻;不计期限(未到可认领、已结案、殿没有天数)是 None。"""
    if judgment.claimable_since is None or judgment.verdict is not None or judgment.is_final:
        return None
    days = judgment.tenant.judgment_deadline_days if judgment.tenant_id is not None else None
    if days is None:
        return None
    return judgment.claimable_since + judgment.deferred_total + timedelta(days=days)


def remaining_seconds(judgment, now=None):
    """离截止还有多少秒,过了是负数;正在待定的停在放进待定的那一刻。不计期限是 None。"""
    due = deadline_at(judgment)
    if due is None:
        return None
    return int((due - (judgment.deferred_at or now or timezone.now())).total_seconds())


def is_overdue(judgment, now=None) -> bool:
    left = remaining_seconds(judgment, now)
    return left is not None and left < 0 and judgment.deferred_at is None


def with_due_base(queryset):
    return queryset.alias(**{DUE_BASE: ExpressionWrapper(F("claimable_since") + F("deferred_total"),
                                                         output_field=DateTimeField())})


def overdue_q(queryset, now=None) -> Q:
    """「已过期限」的谓词,给 `with_due_base(queryset)` 用。天数按每一行所在的殿:queryset 里出现几个殿,
    就 OR 几段(一个殿的官员只有一段;跨殿的 ADMIN 才多)。与 `is_overdue` 同一条规则。"""
    from apps.tenants.models import Tenant

    now = now or timezone.now()
    tenant_ids = set(queryset.order_by().values_list("tenant_id", flat=True).distinct())
    per_hall = Q(pk__isnull=True)  # 恒假:没有一个殿计期限时,谁也不过期(不用 `pk__in=[]`,它在聚合的 filter 里会整条落空)
    for tenant in Tenant.objects.filter(pk__in=tenant_ids):
        days = tenant.judgment_deadline_days
        if days is not None:
            per_hall |= Q(tenant_id=tenant.pk, **{f"{DUE_BASE}__lt": now - timedelta(days=days)})
    return Q(deferred_at__isnull=True, claimable_since__isnull=False, verdict__isnull=True, is_final=False) & per_hall
