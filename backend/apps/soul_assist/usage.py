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


def record(side, tenant, status, model="", tokens=None, *, is_eval=False):
    from apps.soul_assist.models import AssistUsage

    tokens = tokens or {}
    AssistUsage.objects.create(side=side, tenant=tenant, status=status, model=model or "", is_eval=is_eval,
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
    """按模型分组的 token 行 → (总花费, 未定价的模型)。"""
    from apps.soul_assist.config import cost

    total, unpriced = 0.0, set()
    for g in grouped:
        c = cost(prices, g["model"], g["input_tokens"] or 0, g["output_tokens"] or 0, g["cache_read_tokens"] or 0)
        if c is None:
            if (g["input_tokens"] or 0) + (g["output_tokens"] or 0):
                unpriced.add(g["model"])
        else:
            total += c
    return total, unpriced


def month_spend(prices, month=None):
    start, end = month_bounds(month)
    grouped = _rows(start, end).order_by().values("model").annotate(**_TOKENS)
    total, unpriced = _priced(prices, grouped)
    return {"cost": round(total, 6), "unpriced_models": sorted(unpriced)}


def enforce_cap():
    """本月估算花费到上限 → 关总开关、写审计、通知管理员。返回是否这一次关掉的。

    锁住配置行再复查:并发的几次回答同时越线,只有一个会关、只发一次通知。"""
    from apps.soul_assist import config
    from apps.soul_assist.models import AssistConfig

    cfg = config.effective()
    if not cfg.enabled or cfg.monthly_cap is None:
        return False
    spent = month_spend(cfg.prices)["cost"]
    if spent < cfg.monthly_cap:
        return False
    with transaction.atomic():
        AssistConfig.objects.get_or_create(pk=1)
        row = AssistConfig.objects.select_for_update().get(pk=1)
        if row.values.get("enabled", cfg.env_enabled) is False:
            return False
        config.save_changes(row, {"enabled": False}, user=None,
                            description=f"monthly cap reached: spent {spent:.4f} >= cap {cfg.monthly_cap}")
    _notify_admins(spent, cfg.monthly_cap)
    return True


def _notify_admins(spent, cap):
    from apps.authentication.models import User
    from apps.notifications.models import NotificationType, notify_user

    for admin in User.objects.filter(role="ADMIN", is_active=True).order_by("pk"):
        notify_user(admin, title="助手已自动关闭:本月花费到达上限",
                    message=f"本月估算花费 {spent:.2f} 已到上限 {cap:.2f},助手总开关已自动关闭。"
                            f"到「助手管理」页查看用量,调高上限后可重新打开。",
                    notification_type=NotificationType.SYSTEM, related_resource="assistant_config")


_ANSWERED = Q(status__in=("ok", "empty"))
_COUNTS = ("requests", "answered", "input_tokens", "output_tokens", "cache_read_tokens")


def _grouped(rows, key, prices):
    """按 `key` 分组的请求数、token 与花费(花费要按模型求,所以先按 key × 模型分组再合)。"""
    out = {}
    for g in rows.order_by().values(key, "model").annotate(requests=Count("id"), answered=Count("id", filter=_ANSWERED),
                                                **_TOKENS):
        item = out.setdefault(g[key], {**dict.fromkeys(_COUNTS, 0), "_groups": []})
        for k in _COUNTS:
            item[k] += g[k] or 0
        item["_groups"].append(g)
    for item in out.values():
        item["cost"] = round(_priced(prices, item.pop("_groups"))[0], 6)
    return out


def report(prices, month=None):
    """管理员的「实际用量」页(§4)。"""
    from apps.soul_assist import corpus
    from apps.tenants.models import Tenant

    start, end = month_bounds(month)
    rows = _rows(start, end)
    statuses = dict(rows.order_by().values_list("status").annotate(n=Count("id")))
    total = sum(statuses.values())
    empty = statuses.get("empty", 0)
    answered = statuses.get("ok", 0) + empty
    empty_share = empty / answered if answered else 0.0
    prompt_tokens = max(p["tokens"] for p in corpus_prompts(corpus))
    days = _grouped(rows.annotate(day=TruncDate("created_at")), "day", prices)
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
                                                       "not_configured")},
        "failure_rates": {"unavailable": share(statuses.get("unavailable", 0)),
                          "rate_limited": share(statuses.get("rate_limited", 0) + statuses.get("busy", 0)),
                          "empty": empty_share},
        "by_day": [{"date": day, **v} for day, v in sorted(days.items())],
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
