"""用量、花费估算与月度上限(docs/ARCHITECTURE-assist-admin.md §4、§7 Q2)。

只读 `AssistUsage`:每次提问一行,不含原文。评测的请求(`is_eval`)不计。
花费 = token × 管理员填的价目表;不在价目表里的模型算不出花费,**报出来,不当 0**。
"""
import logging
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

logger = logging.getLogger(__name__)

#: 阶段 4 的触发线(§4):语料 token 数、「答不了」占比。到线只提示,决定由人做。
CORPUS_TOKEN_THRESHOLD = 80_000
EMPTY_SHARE_THRESHOLD = 0.15
_TOKENS = {"input_tokens": Sum("input_tokens"), "output_tokens": Sum("output_tokens"),
           "cache_read_tokens": Sum("cache_read_tokens")}


def record(side, tenant, status, model="", tokens=None, *, is_eval=False, retrieval="", provider_role="",
           fallback_reason=""):
    from apps.soul_assist.models import AssistUsage

    tokens = tokens or {}
    AssistUsage.objects.create(side=side, tenant=tenant, status=status, model=model or "", is_eval=is_eval,
                               retrieval=retrieval, provider_role=provider_role, fallback_reason=fallback_reason,
                               input_tokens=tokens.get("input", 0), output_tokens=tokens.get("output", 0),
                               cache_read_tokens=tokens.get("cache_read", 0))


def month_bounds(month=None):
    """`month` 是该月里任一时刻(aware)或 None(本月)。按 settings.TIME_ZONE 切月。"""
    now = timezone.localtime(month) if month else timezone.localtime()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start, (start + timedelta(days=32)).replace(day=1)


def _rows(start, end):
    from apps.soul_assist.models import AssistUsage

    return AssistUsage.objects.filter(created_at__gte=start, created_at__lt=end, is_eval=False)


def _priced(prices, grouped):
    """按(答的是哪一家 × 模型)分组的 token 行 → (总花费, 未定价的模型)。`prices` 是 `Prices`:
    备用答的行按备用的价目表算(§13),同名模型在两家可以不同价。"""
    from apps.soul_assist.config import cost

    total, unpriced = 0.0, set()
    for g in grouped:
        table = prices.backup if g.get("provider_role") == "backup" else prices.primary
        c = cost(table, g["model"], g["input_tokens"] or 0, g["output_tokens"] or 0, g["cache_read_tokens"] or 0)
        if c is None:
            if (g["input_tokens"] or 0) + (g["output_tokens"] or 0):
                unpriced.add(g["model"])
        else:
            total += c
    return total, unpriced


class Prices:
    """主用与备用两张价目表。只给一张 dict 的老调用方(评测)等于没有备用。"""

    def __init__(self, primary, backup=None):
        self.primary = primary or {}
        self.backup = backup or {}

    @classmethod
    def of(cls, prices):
        return prices if isinstance(prices, cls) else cls(prices)


def month_spend(prices, month=None):
    prices = Prices.of(prices)
    start, end = month_bounds(month)
    grouped = _rows(start, end).order_by().values("provider_role", "model").annotate(**_TOKENS)
    total, unpriced = _priced(prices, grouped)
    return {"cost": round(total, 6), "unpriced_models": sorted(unpriced)}


#: 本月花费到上限的这个比例时提醒一次管理员(用户 2026-09-29 定)。
ALERT_SHARE = 0.8

#: 月份按 `settings.TIME_ZONE`(UTC)滚动 —— 用户 2026-09-29 定:不改,只说清楚。北京时间比 UTC 早 8 小时,
#: 所以每月 1 日北京时间 08:00 才换月、才重开。改这句话前先看 `_month_key` 用的时区。
ROLLOVER_TEXT = "每月 1 日 08:00(北京时间)"


def _month_key(moment=None):
    return timezone.localtime(moment).strftime("%Y-%m")


def enforce_cap():
    """每次非评测回答之后调。本月估算花费:
    - 到上限的 80% → 本月第一次时提醒管理员;
    - 到上限 → 关总开关、记下「上限关于本月」、写审计、通知管理员。返回是否这一次关掉的。

    都锁住配置行再复查:并发的几次回答同时越线,只关一次、每种通知只发一次。"""
    from apps.soul_assist import config
    from apps.soul_assist.models import AssistConfig

    cfg = config.effective()
    if not cfg.enabled or cfg.monthly_cap is None:
        return False
    spent = month_spend(Prices(cfg.prices, cfg.backup_prices))["cost"]
    if spent < cfg.monthly_cap * ALERT_SHARE:
        return False
    month = _month_key()
    closed = alerted = False
    with transaction.atomic():
        AssistConfig.objects.get_or_create(pk=1)
        row = AssistConfig.objects.select_for_update().get(pk=1)
        if spent < cfg.monthly_cap:
            if row.cap_alert_sent_for != month:
                row.cap_alert_sent_for = month
                row.save(update_fields=["cap_alert_sent_for"])
                alerted = True
        elif row.values.get("enabled", cfg.env_enabled) is not False:
            row.cap_closed_for = month
            row.cap_alert_sent_for = month  # 直接越过 80% 到了上限:不再补发那条提醒
            config.save_changes(row, {"enabled": False}, user=None,
                                description=f"monthly cap reached: spent {spent:.4f} >= cap {cfg.monthly_cap}")
            closed = True
    if alerted:
        _notify_admins("助手本月花费已到上限的 80%",
                       f"本月估算花费 {spent:.2f},上限 {cfg.monthly_cap:.2f}。到上限时助手会自动关闭;每月 1 日早上 8 点(北京时间)换月。")
    if closed:
        _notify_admins("助手已自动关闭:本月花费到达上限",
                       f"本月估算花费 {spent:.2f} 已到上限 {cfg.monthly_cap:.2f},助手总开关已自动关闭。"
                       f"次月 1 日早上 8 点(北京时间)会自动重开;也可以到「助手管理」页调高上限后手动打开。")
    return closed


def maybe_reopen():
    """总开关是**因月度上限**关的,而现在已是之后的月份 → 重开、写审计、通知管理员。返回是否这一次重开的。

    管理员手动关的不开(手动改开关会清空 `cap_closed_for`,见 config.save_changes)。
    celery beat 未部署,所以不靠定时任务:每次读开关时顺手查一次(快照里就有这一格,平时不碰库)。"""
    from apps.soul_assist import config
    from apps.soul_assist.models import AssistConfig

    cfg = config.effective()
    # env 总开关关着:部署方一票否决,重开了也不生效 —— 不翻开关、不写审计、不发「已重开」的通知。
    if not cfg.env_enabled or cfg.switch or not cfg.cap_closed_for or cfg.cap_closed_for == _month_key():
        return False
    with transaction.atomic():
        row = AssistConfig.objects.select_for_update().filter(pk=1).first()
        if row is None or not row.cap_closed_for or row.cap_closed_for == _month_key():
            return False
        if row.values.get("enabled", cfg.env_enabled) is not False:
            return False
        row.cap_closed_for = ""
        config.save_changes(row, {"enabled": True}, user=None,
                            description="reopened: a new month after the monthly-cap close")
    _notify_admins("助手已自动重开:新的一个月",
                   "上个月助手因花费到达上限被自动关闭,本月已自动重开(每月 1 日早上 8 点北京时间换月)。")
    return True


def _notify_admins(title, message):
    from apps.authentication.models import User
    from apps.notifications.models import NotificationType, notify_user

    for admin in User.objects.filter(role="ADMIN", is_active=True).order_by("pk"):
        try:
            notify_user(admin, title=title, message=message,
                        notification_type=NotificationType.SYSTEM, related_resource="assistant_config")
        except Exception:  # 开关已经关了(或开了):通知发不出去要留下痕迹,不能无声地丢
            logger.exception("assistant config notification to admin %s failed: %s", admin.pk, title)


_ANSWERED = Q(status__in=("ok", "empty"))
#: 「改用备用」只数备用**答出**的提问(Design 7a):备用也失败(503、中断)算作失败,不计入这一行。
_BACKUP_ANSWERED = _ANSWERED & Q(provider_role="backup") & ~Q(fallback_reason="")
#: 「主用失败前花掉的 token」那一行只记账,不是一次请求(AssistUsage.STATUSES)。
_REQUEST = ~Q(status="failed_over")
_COUNTS = ("requests", "answered", "input_tokens", "output_tokens", "cache_read_tokens")
FALLBACK_REASONS = ("connection", "timeout", "rate_limited", "server_error", "quota", "circuit_open")


def _grouped(rows, key, prices, split=False):
    """按 `key` 分组的请求数、token 与花费(花费要按哪一家 × 模型求,所以先这样分组再合)。
    `split`:再给主用 / 备用各自的花费(`primary_cost` + `backup_cost` = `cost`;没走到供应商的行算主用,它们是 0)。"""
    out = {}
    for g in rows.order_by().values(*dict.fromkeys((key, "provider_role", "model"))).annotate(
            requests=Count("id", filter=_REQUEST), answered=Count("id", filter=_ANSWERED), **_TOKENS):
        item = out.setdefault(g[key], {**dict.fromkeys(_COUNTS, 0), "_groups": []})
        for k in _COUNTS:
            item[k] += g[k] or 0
        item["_groups"].append(g)
    for item in out.values():
        groups = item.pop("_groups")
        item["cost"] = round(_priced(prices, groups)[0], 6)
        if split:
            backup = [g for g in groups if g["provider_role"] == "backup"]
            item["backup_cost"] = round(_priced(prices, backup)[0], 6)
            item["primary_cost"] = round(_priced(prices, [g for g in groups if g not in backup])[0], 6)
    return out


def report(prices, month=None):
    """管理员的「实际用量」页(§4)。"""
    from apps.soul_assist import corpus
    from apps.tenants.models import Tenant

    prices = Prices.of(prices)
    start, end = month_bounds(month)
    rows = _rows(start, end)
    statuses = dict(rows.filter(_REQUEST).order_by().values_list("status").annotate(n=Count("id")))
    retrievals = dict(rows.order_by().values_list("retrieval").annotate(n=Count("id")))
    reasons = dict(rows.filter(_BACKUP_ANSWERED).order_by().values_list("fallback_reason").annotate(n=Count("id")))
    roles = _grouped(rows.exclude(provider_role=""), "provider_role", prices)
    total = sum(statuses.values())
    empty = statuses.get("empty", 0)
    answered = statuses.get("ok", 0) + empty
    empty_share = empty / answered if answered else 0.0
    prompt_tokens = max(p["tokens"] for p in corpus_prompts(corpus))
    dated = rows.annotate(day=TruncDate("created_at"))
    days = _grouped(dated, "day", prices, split=True)
    day_reasons = {}
    for day, reason, n in (dated.filter(_BACKUP_ANSWERED).order_by().values_list("day", "fallback_reason")
                           .annotate(n=Count("id"))):
        day_reasons.setdefault(day, {})[reason] = n
    halls = _grouped(rows, "tenant", prices)
    codes = dict(Tenant.objects.filter(pk__in=[k for k in halls if k is not None]).values_list("pk", "code"))
    spend = month_spend(prices, month)

    def share(n):
        return n / total if total else 0.0

    return {
        "month": start.strftime("%Y-%m"),
        "spent": spend["cost"], "unpriced_models": spend["unpriced_models"],
        "requests": total,
        "by_status": {s: statuses.get(s, 0) for s in ("ok", "empty", "unavailable", "busy", "rate_limited",
                                                       "not_configured", "stopped", "interrupted")},
        # 「改用备用」:备用**答出**的提问数与理由分布(备用也失败的是失败,不在这里);花费按主用 / 备用分开(§13)。
        "fallbacks": {"count": sum(reasons.values()),
                      "by_reason": {r: reasons.get(r, 0) for r in FALLBACK_REASONS}},
        "by_provider": [{"role": role, **v} for role, v in sorted(roles.items())],
        "failure_rates": {"unavailable": share(statuses.get("unavailable", 0)),
                          "rate_limited": share(statuses.get("rate_limited", 0) + statuses.get("busy", 0)),
                          "empty": empty_share},
        "by_retrieval": {r: retrievals.get(r, 0) for r in ("vector", "fallback", "fallback_low_similarity")},
        "by_day": [{"date": day, **v, "fallbacks": sum(day_reasons.get(day, {}).values()),
                    "fallback_reasons": {r: day_reasons.get(day, {}).get(r, 0) for r in FALLBACK_REASONS}}
                   for day, v in sorted(days.items())],
        "by_side": [{"side": side, **v} for side, v in sorted(_grouped(rows, "side", prices).items())],
        "by_hall": [{"tenant_id": k, "code": codes.get(k), **v} for k, v in halls.items()],
        "phase4": {"corpus_tokens": prompt_tokens, "corpus_threshold": CORPUS_TOKEN_THRESHOLD,
                   "corpus_reached": prompt_tokens >= CORPUS_TOKEN_THRESHOLD,
                   "empty_share": empty_share, "empty_threshold": EMPTY_SHARE_THRESHOLD,
                   "empty_reached": answered > 0 and empty_share >= EMPTY_SHARE_THRESHOLD},
    }


def estimate_tokens(text):
    """ponytail: 粗估 —— 非 ASCII 字符各算 1 个,ASCII 每 4 个字符算 1 个。只用于阈值提示与评测预估;
    要精确就调供应商的 count_tokens。"""
    ascii_chars = sum(1 for ch in text if ord(ch) < 128)
    return (len(text) - ascii_chars) + ascii_chars // 4


def corpus_prompts(corpus):
    """每种语言 × 受众一份 system prompt(一次请求实际带上的那份)的 token 估计。"""
    return [{"locale": locale, "audience": audience,
             "tokens": estimate_tokens(corpus.system_prompt(locale, audience))}
            for locale in corpus.LOCALES for audience in corpus.AUDIENCES]


def month_of(text):
    """"YYYY-MM" → 该月第一天(aware);格式不对抛 ValueError。"""
    return timezone.make_aware(datetime.strptime(text, "%Y-%m"))
