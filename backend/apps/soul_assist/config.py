"""助手的生效配置:库(管理页)覆盖 env(docs/ARCHITECTURE-assist-admin.md §2)。

- **没写进 `AssistConfig.values` 的键用 env。** 没人保存过时,行为与只有 env 时相同。
- **env 的总开关是硬上限**:`ASSISTANT_ENABLED` 为假时,页面开关怎么设都是关(`Effective.enabled`)。
- **进程内缓存,保存时失效。** 行的快照留在本进程内存里(API key 明文不进 Redis);
  各进程靠共享缓存里的一个版本号知道要不要重读 —— 保存时换版本号,每次读只多一次缓存 GET。
"""
import hashlib
import hmac
import uuid
from dataclasses import astuple, dataclass

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

PROVIDERS = {
    "anthropic": "apps.soul_assist.providers.AnthropicProvider",
    "openai_compatible": "apps.soul_assist.providers.OpenAICompatibleProvider",
}
EFFORTS = ("", "low", "medium", "high")
#: 页面可改的键(API key、评测身份另有字段)。
EDITABLE = ("enabled", "provider", "base_url", "model", "effort", "fallbacks", "soul_per_hour", "officer_per_hour",
            "monthly_cap", "prices", "eval_spend_cap")
#: 连接相关的键:改了它们,供应商客户端就要换。
CONNECTION_KEYS = ("provider", "base_url", "api_key", "model", "effort", "fallbacks")
DEFAULT_EVAL_SPEND_CAP = 5.0
#: 模型名改动前必须在这段时间内测通同一套候选(§3.1)。
TESTED_TTL_SECONDS = 15 * 60
VERSION_KEY = "soul_assist:config_version"
TESTED_KEY = "soul_assist:tested:"
AUDIT_RESOURCE = "assistant_config"


@dataclass(frozen=True)
class Connection:
    """供应商需要的全部。可哈希:`providers._provider` 按它缓存客户端。"""

    provider: str  # 类路径
    base_url: str
    api_key: str
    model: str
    effort: str
    fallbacks: str  # Anthropic 的 fallbacks 参数;"" 即关

    def fingerprint(self) -> str:
        """加密钥的哈希:里面有 API key,缓存键上不能是可逆的东西。"""
        return hmac.new(settings.SECRET_KEY.encode(), repr(astuple(self)).encode(), hashlib.sha256).hexdigest()


def env_connection() -> Connection:
    return Connection(settings.ASSISTANT_PROVIDER, settings.ASSISTANT_BASE_URL, settings.ASSISTANT_API_KEY,
                      settings.ASSISTANT_MODEL, settings.ASSISTANT_EFFORT, settings.ASSISTANT_ANTHROPIC_FALLBACKS)


@dataclass(frozen=True, eq=False)
class Effective:
    connection: Connection
    switch: bool  # 页面上的总开关(没改过 = env 的值)
    env_enabled: bool
    soul_per_hour: int | None  # None = 用 DEFAULT_THROTTLE_RATES["assist"]
    officer_per_hour: int | None
    monthly_cap: float | None  # None = 不设上限
    prices: dict  # 模型名 → {"input", "output", "cache_read"?},每百万 token
    eval_spend_cap: float
    api_key_set_at: object  # None = key 来自 env
    eval_soul_account_id: object
    eval_officer_id: object
    overridden: tuple  # 页面改过的键

    @property
    def enabled(self) -> bool:
        return self.env_enabled and self.switch

    def rate(self, side) -> str:
        n = self.soul_per_hour if side == "soul" else self.officer_per_hour
        return settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["assist"] if n is None else f"{n}/hour"


_local = {"version": None, "row": None}


def _snapshot(row):
    if row is None:
        return None
    return {"values": dict(row.values or {}), "api_key": row.api_key, "api_key_set_at": row.api_key_set_at,
            "eval_soul_account_id": row.eval_soul_account_id, "eval_officer_id": row.eval_officer_id}


def _row():
    from apps.soul_assist.models import AssistConfig

    version = cache.get(VERSION_KEY)
    if version is None:
        cache.add(VERSION_KEY, uuid.uuid4().hex, None)
        version = cache.get(VERSION_KEY)
    if version is None or _local["version"] != version:
        _local["row"] = _snapshot(AssistConfig.objects.filter(pk=1).first())
        _local["version"] = version
    return _local["row"]


def invalidate():
    """保存之后调:立刻换一次(本进程与已提交前就来读的进程),提交后再换一次(防读到提交前的旧行)。"""
    def bump():
        cache.set(VERSION_KEY, uuid.uuid4().hex, None)
        _local["version"] = None

    bump()
    transaction.on_commit(bump)


def provider_path(name_or_path):
    return PROVIDERS.get(name_or_path, name_or_path)


def provider_name(path):
    return next((name for name, p in PROVIDERS.items() if p == path), path.rsplit(".", 1)[-1])


def effective() -> Effective:
    row = _row() or {"values": {}, "api_key": "", "api_key_set_at": None, "eval_soul_account_id": None,
                     "eval_officer_id": None}
    v = row["values"]
    env = env_connection()
    fallbacks = env.fallbacks if "fallbacks" not in v else ("default" if v["fallbacks"] else "")
    connection = Connection(
        provider=provider_path(v["provider"]) if "provider" in v else env.provider,
        base_url=v.get("base_url", env.base_url),
        api_key=row["api_key"] if row["api_key_set_at"] else env.api_key,
        model=v.get("model", env.model),
        effort=v.get("effort", env.effort),
        fallbacks=fallbacks,
    )
    return Effective(
        connection=connection, switch=v.get("enabled", settings.ASSISTANT_ENABLED),
        env_enabled=settings.ASSISTANT_ENABLED, soul_per_hour=v.get("soul_per_hour"),
        officer_per_hour=v.get("officer_per_hour"), monthly_cap=v.get("monthly_cap"), prices=v.get("prices", {}),
        eval_spend_cap=v.get("eval_spend_cap", DEFAULT_EVAL_SPEND_CAP), api_key_set_at=row["api_key_set_at"],
        eval_soul_account_id=row["eval_soul_account_id"], eval_officer_id=row["eval_officer_id"],
        overridden=tuple(sorted(v)) + (("api_key",) if row["api_key_set_at"] else ()),
    )


def candidate(data, base: Connection) -> Connection:
    """候选配置:请求里给了的键覆盖 `base`。`api_key` 不给就沿用 —— 页面上的 key 只写不读。"""
    return Connection(
        provider=provider_path(data["provider"]) if "provider" in data else base.provider,
        base_url=data.get("base_url", base.base_url),
        api_key=base.api_key if data.get("api_key") is None else data["api_key"],
        model=data.get("model", base.model),
        effort=data.get("effort", base.effort),
        fallbacks=base.fallbacks if "fallbacks" not in data else ("default" if data["fallbacks"] else ""),
    )


# ── 价格与花费(没有写死的供应商价格:价目表由管理员在页面上填)─────────────────


def cost(prices, model, input_tokens=0, output_tokens=0, cache_read_tokens=0):
    """估算花费;这个模型不在价目表里就是 None(调用方要把「未定价」说出来,不能当 0)。
    缓存读取没填价就按输入价算 —— 宁可高估,月度上限才不会晚到。"""
    price = (prices or {}).get(model)
    if price is None:
        return None
    return (input_tokens * price["input"] + output_tokens * price["output"]
            + cache_read_tokens * price.get("cache_read", price["input"])) / 1_000_000


# ── 连通测试的凭证 ─────────────────────────────────────────────────────────


def remember_tested(conn: Connection):
    cache.set(TESTED_KEY + conn.fingerprint(), timezone.now().isoformat(), TESTED_TTL_SECONDS)


def was_tested(conn: Connection) -> bool:
    return cache.get(TESTED_KEY + conn.fingerprint()) is not None


# ── 保存与审计 ─────────────────────────────────────────────────────────────

_UNSET = object()


def current_value(eff: Effective, key):
    """页面上显示的、某个键现在生效的值(审计里的「旧值」)。"""
    c = eff.connection
    return {
        "enabled": eff.switch, "provider": provider_name(c.provider), "base_url": c.base_url, "model": c.model,
        "effort": c.effort, "fallbacks": bool(c.fallbacks), "soul_per_hour": per_hour(eff, "soul"),
        "officer_per_hour": per_hour(eff, "officer"), "monthly_cap": eff.monthly_cap, "prices": eff.prices,
        "eval_spend_cap": eff.eval_spend_cap,
    }[key]


def per_hour(eff: Effective, side) -> int:
    return int(eff.rate(side).split("/")[0])


def save_changes(row, values=None, *, user, description="assistant config updated", request=None,
                 api_key=_UNSET, refs=None):
    """写 `values` 里的键、可选的 API key(`""` = 清除)与评测身份(`refs`:字段名 → id),再写一条审计。

    **审计里 API key 只记 "replaced" / "cleared",不记值**;其余键记 [旧值, 新值]。"""
    before = effective()
    changes = {}
    for key, new in (values or {}).items():
        old = current_value(before, key)
        if old != new:
            changes[key] = [old, new]
        row.values = {**row.values, key: new}
    if api_key is not _UNSET:
        changes["api_key"] = "cleared" if api_key == "" else "replaced"
        row.api_key = api_key
        row.api_key_set_at = timezone.now()
    for field, new in (refs or {}).items():
        old = getattr(row, field)
        if old != new:
            changes[field] = [None if old is None else str(old), None if new is None else str(new)]
        setattr(row, field, new)
    row.save()
    invalidate()
    audit(user, description, changes, request)
    return changes


def audit(user, description, changes, request=None, resource_id="config"):
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=None, user=user, action="UPDATE", resource=AUDIT_RESOURCE, resource_id=resource_id,
        description=description[:500], changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )
