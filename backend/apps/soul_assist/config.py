"""助手的生效配置:库(管理页)覆盖 env(docs/ARCHITECTURE-assist-admin.md §2)。

- **没写进 `AssistConfig.values` 的键用 env。** 没人保存过时,行为与只有 env 时相同。
- **env 的总开关是硬上限**:`ASSISTANT_ENABLED` 为假时,页面开关怎么设都是关(`Effective.enabled`)。
- **进程内缓存,保存时失效。** 行的快照留在本进程内存里(API key 明文不进 Redis);
  各进程靠共享缓存里的一个版本号知道要不要重读 —— 保存时换版本号,每次读只多一次缓存 GET。
"""
import hashlib
import hmac
import json
import logging
import uuid
from dataclasses import astuple, dataclass, replace
from dataclasses import field as dc_field
from urllib.parse import urlsplit, urlunsplit

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
EDITABLE = ("enabled", "platform", "provider", "base_url", "model", "effort", "fallbacks", "soul_per_hour", "officer_per_hour",
            "monthly_cap", "prices", "eval_spend_cap")
#: 连接相关的键:改了它们,供应商客户端就要换。
CONNECTION_KEYS = ("provider", "base_url", "api_key", "model", "effort", "fallbacks")
DEFAULT_EVAL_SPEND_CAP = 5.0
#: 模型名改动前必须在这段时间内测通同一套候选(§3.1)。
TESTED_TTL_SECONDS = 15 * 60
VERSION_KEY = "soul_assist:config_version"
TESTED_KEY = "soul_assist:tested:"
#: 向量检索的键(docs/ARCHITECTURE-soul-assist.md §7.6),由 `embedding/` 接口改。前三个是「连接」:改了要先测通。
EMBEDDING_KEYS = ("embedding_url", "embedding_model", "embedding_dims", "retrieval_k", "retrieval_min_similarity")
EMBEDDING_CONNECTION_KEYS = ("embedding_url", "embedding_model", "embedding_dims")
AUDIT_RESOURCE = "assistant_config"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Connection:
    """供应商需要的全部。可哈希:`providers._provider` 按它缓存客户端。"""

    provider: str  # 类路径
    base_url: str
    api_key: str = dc_field(repr=False)  # 不进 repr:Sentry 的栈帧变量与日志里的 %r 都走 repr
    model: str
    effort: str
    fallbacks: str  # Anthropic 的 fallbacks 参数;"" 即关

    def fingerprint(self) -> str:
        """加密钥的哈希:里面有 API key,缓存键上不能是可逆的东西。"""
        return hmac.new(settings.SECRET_KEY.encode(), repr(astuple(self)).encode(), hashlib.sha256).hexdigest()


def env_connection() -> Connection:
    return Connection(settings.ASSISTANT_PROVIDER, settings.ASSISTANT_BASE_URL, settings.ASSISTANT_API_KEY,
                      settings.ASSISTANT_MODEL, settings.ASSISTANT_EFFORT, settings.ASSISTANT_ANTHROPIC_FALLBACKS)


@dataclass(frozen=True)
class Embedding:
    """取向量要的全部。`dims` 为 None = 模型原生维度(不传 Ollama 的 `dimensions`)。"""

    url: str
    model: str
    dims: int | None

    def fingerprint(self) -> str:
        return hmac.new(settings.SECRET_KEY.encode(), repr(("embedding",) + astuple(self)).encode(),
                        hashlib.sha256).hexdigest()


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
    eval_soul_account_id: object
    eval_officer_id: object
    overridden: tuple  # 页面改过的键
    cap_closed_for: str = ""  # 非空 = 总开关因月度上限被关于该月("YYYY-MM"),见 usage.maybe_reopen
    embedding: Embedding = None
    retrieval_k: int = 5
    retrieval_min_similarity: float = 0.0
    stored_platform: str = ""  # 页面存的平台 id;显示用 `platforms.current`(对不上连接就按连接认)
    #: 备用供应商(§13):主用在出第一段文本之前连不上 / 超时 / 429 / 5xx / 402 时改用它。没配为 None。
    backup: Connection = None
    backup_prices: dict = dc_field(default_factory=dict)  # 备用的价目表,与主用的分开(同名模型可能不同价)
    backup_platform: str = ""
    #: 页面按平台存的 key(用户 2026-10-01 定):`platforms.key_slot` → {"key", "set_at"};"" = 已清除。
    #: 主用与备用共用;没存过的平台若正是 env 配的那个,用 env 的 key(`stored_key`)。
    keys: dict = dc_field(default_factory=dict)

    def key_state(self, conn):
        """页面上显示的「已设置 · 末 4 位 · 设置于」;永不含 key 本身。"""
        slot = key_slot(conn)
        entry = self.keys.get(slot)
        key = conn.api_key
        return {"set": bool(key), "last4": key[-4:] if len(key) >= 12 else None,
                "set_at": entry["set_at"] if entry else None, "source": "page" if entry else "env"}

    @property
    def enabled(self) -> bool:
        return self.env_enabled and self.switch

    def rate(self, side) -> str:
        n = self.soul_per_hour if side == "soul" else self.officer_per_hour
        return settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["assist"] if n is None else f"{n}/hour"


_local = {"version": None, "row": None}


def load_keys(text) -> dict:
    """`AssistConfig.api_keys`(解密后的 JSON)→ dict。读不出来(换了 ENCRYPTION_KEY 等)就当没存过、记一条错误:
    助手因此报「缺 key」,管理员在页面上看得见,而不是每个请求都 500。"""
    try:
        keys = json.loads(text or "{}")
    except ValueError:
        logger.error("assistant api key store is unreadable; treating it as empty")
        return {}
    return keys if isinstance(keys, dict) else {}


def _snapshot(row):
    if row is None:
        return None
    return {"values": dict(row.values or {}), "api_keys": load_keys(row.api_keys),
            "eval_soul_account_id": row.eval_soul_account_id, "eval_officer_id": row.eval_officer_id,
            "cap_closed_for": row.cap_closed_for}


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


def effective(row=None) -> Effective:
    """`row` 给了(已锁住的 `AssistConfig`)就按它算,不读进程快照 —— 锁里的判断要基于锁住的那一行。"""
    row = (_snapshot(row) if row is not None else _row()) or {"values": {}, "api_keys": {}, "eval_soul_account_id": None,
                                                              "eval_officer_id": None, "cap_closed_for": ""}
    v = row["values"]
    keys = row["api_keys"]
    env = env_connection()
    fallbacks = env.fallbacks if "fallbacks" not in v else ("default" if v["fallbacks"] else "")
    connection = _keyed(keys, Connection(
        provider=provider_path(v["provider"]) if "provider" in v else env.provider,
        base_url=v.get("base_url", env.base_url),
        api_key="",
        model=v.get("model", env.model),
        effort=v.get("effort", env.effort),
        fallbacks=fallbacks,
    ))
    backup = backup_connection(v.get("backup"))
    return Effective(
        connection=connection, switch=v.get("enabled", settings.ASSISTANT_ENABLED),
        env_enabled=settings.ASSISTANT_ENABLED, soul_per_hour=v.get("soul_per_hour"),
        officer_per_hour=v.get("officer_per_hour"), monthly_cap=v.get("monthly_cap"), prices=v.get("prices", {}),
        eval_spend_cap=v.get("eval_spend_cap", DEFAULT_EVAL_SPEND_CAP),
        eval_soul_account_id=row["eval_soul_account_id"], eval_officer_id=row["eval_officer_id"],
        overridden=tuple(sorted(v)) + (("api_key",) if key_slot(connection) in keys else ()),
        cap_closed_for=row.get("cap_closed_for", ""),
        embedding=Embedding(v.get("embedding_url", settings.ASSISTANT_EMBEDDING_URL),
                            v.get("embedding_model", settings.ASSISTANT_EMBEDDING_MODEL),
                            v.get("embedding_dims", settings.ASSISTANT_EMBEDDING_DIMS)),
        retrieval_k=v.get("retrieval_k", settings.ASSISTANT_RETRIEVAL_K),
        retrieval_min_similarity=v.get("retrieval_min_similarity", settings.ASSISTANT_RETRIEVAL_MIN_SIMILARITY),
        stored_platform=v.get("platform", ""),
        backup=None if backup is None else _keyed(keys, backup),
        backup_prices=(v.get("backup") or {}).get("prices", {}),
        backup_platform=(v.get("backup") or {}).get("platform", ""),
        keys=keys,
    )


def key_slot(conn) -> str:
    from apps.soul_assist import platforms

    return platforms.key_slot(conn)


def stored_key(keys, conn) -> str | None:
    """这套连接该用的已存 key:页面为它的平台存过的(可能是 "" = 已清除);没存过而它正是 env 配的平台,
    用 env 的 key(env 的 key 就是 env 那个平台的);都没有为 None。"""
    slot = key_slot(conn)
    if slot in keys:
        return keys[slot]["key"]
    env = env_connection()
    if env.api_key and slot == key_slot(env):
        return env.api_key
    return None


def _keyed(keys, conn):
    return replace(conn, api_key=stored_key(keys, conn) or "")


def backup_connection(stored) -> Connection | None:
    """`values["backup"]`(页面存的名字与值)→ 连接,不含 key(key 按平台取,`_keyed`)。备用没有 env 来源。"""
    if not stored:
        return None
    return Connection(provider=provider_path(stored["provider"]), base_url=stored.get("base_url", ""),
                      api_key="", model=stored["model"], effort=stored.get("effort", ""),
                      fallbacks="default" if stored.get("fallbacks") else "")


#: 还没配备用时,候选配置以它为底:什么都没有,所以给了 `provider` 就必须同时给 key(`candidate`)。
NO_CONNECTION = Connection("", "", "", "", "", "")


class KeyRequiredError(Exception):
    """换了供应商或地址却没给 key:已存的 key 不能发到一个新的端点去。"""


def unredact(data, base: Connection):
    """页面拿到的 base_url 去掉了 `user:pass@`(`redact_url`);整表回传时它等于已存地址的去敏形式,
    按「没改」处理、还原成已存的完整地址 —— 否则每次保存都像换了地址,还会要求重填 key。"""
    if "base_url" in data and base.base_url and "@" in base.base_url and data["base_url"] == redact_url(base.base_url):
        return {**data, "base_url": base.base_url}
    return data


def candidate(data, base: Connection, keys=None) -> Connection:
    """候选配置:请求里给了的键覆盖 `base`。`api_key` 不给就沿用 —— 页面上的 key 只写不读。

    **换了 `provider` 或 `base_url` 而没给 key**:用目标平台**已存**的那一格(`stored_key`,按主机认,
    所以只会是为那台主机存的 key);那一格没有才 `KeyRequiredError`。`base` 的 key 绝不跟着去新地址。
    `keys` 缺省读生效配置;锁着配置行的调用方传锁住那一行的。"""
    data = unredact(data, base)
    moved = (("provider" in data and provider_path(data["provider"]) != base.provider)
             or ("base_url" in data and data["base_url"] != base.base_url))
    target = Connection(
        provider=provider_path(data["provider"]) if "provider" in data else base.provider,
        base_url=data.get("base_url", base.base_url),
        api_key="",
        model=data.get("model", base.model),
        effort=data.get("effort", base.effort),
        fallbacks=base.fallbacks if "fallbacks" not in data else ("default" if data["fallbacks"] else ""),
    )
    if data.get("api_key") is not None:
        return replace(target, api_key=data["api_key"])
    if not moved:
        return replace(target, api_key=base.api_key)
    key = stored_key(effective().keys if keys is None else keys, target)
    if not key:
        raise KeyRequiredError
    return replace(target, api_key=key)


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


def embedding_candidate(data, base: Embedding) -> Embedding:
    return Embedding(data.get("embedding_url", base.url), data.get("embedding_model", base.model),
                     data["embedding_dims"] if "embedding_dims" in data else base.dims)


def remember_tested(conn):  # Connection 或 Embedding:两者的 fingerprint 带不同前缀,互不冒充
    cache.set(TESTED_KEY + conn.fingerprint(), timezone.now().isoformat(), TESTED_TTL_SECONDS)


def was_tested(conn) -> bool:
    return cache.get(TESTED_KEY + conn.fingerprint()) is not None


# ── 保存与审计 ─────────────────────────────────────────────────────────────

_UNSET = object()


def current_value(eff: Effective, key):
    """页面上显示的、某个键现在生效的值(审计里的「旧值」)。"""
    c = eff.connection
    if key == "platform":
        from apps.soul_assist import platforms

        return platforms.current(eff.stored_platform, c)
    return {
        "enabled": eff.switch, "provider": provider_name(c.provider), "base_url": c.base_url, "model": c.model,
        "effort": c.effort, "fallbacks": bool(c.fallbacks), "soul_per_hour": per_hour(eff, "soul"),
        "officer_per_hour": per_hour(eff, "officer"), "monthly_cap": eff.monthly_cap, "prices": eff.prices,
        "eval_spend_cap": eff.eval_spend_cap,
        "embedding_url": eff.embedding.url, "embedding_model": eff.embedding.model,
        "embedding_dims": eff.embedding.dims, "retrieval_k": eff.retrieval_k,
        "retrieval_min_similarity": eff.retrieval_min_similarity,
        "backup": stored_backup(eff),
    }[key]


def stored_backup(eff: Effective):
    """备用配置在 `values["backup"]` 里的样子(名字而不是类路径);没配为 None。"""
    b = eff.backup
    if b is None:
        return None
    from apps.soul_assist import platforms

    return {"platform": platforms.current(eff.backup_platform, b), "provider": provider_name(b.provider),
            "base_url": b.base_url, "model": b.model, "effort": b.effort, "fallbacks": bool(b.fallbacks),
            "prices": eff.backup_prices}


def per_hour(eff: Effective, side) -> int:
    return int(eff.rate(side).split("/")[0])


def _audit_value(key, value):
    """审计里的地址去掉 `user:pass@`;备用配置是一个 dict,里面的地址同样去敏。"""
    if key in ("base_url", "embedding_url"):
        return redact_url(value)
    if key == "backup" and value:
        return {**value, "base_url": redact_url(value.get("base_url", ""))}
    return value


def save_changes(row, values=None, *, user, description="assistant config updated", request=None,
                 keys=None, refs=None):
    """写 `values` 里的键、按平台存的 key(`keys`:`key_slot` → key,`""` = 清除)与评测身份(`refs`:
    字段名 → id),再写一条审计。

    **审计里 key 只按平台记 "replaced" / "cleared",不记值**;其余键记 [旧值, 新值]。"""
    before = effective(row)
    changes = {}
    for key, new in (values or {}).items():
        old = current_value(before, key)
        # 只写真的变了的键:页面整表提交时,没动的键继续跟 env,也不算「动了开关」。
        if old == new:
            continue
        changes[key] = [_audit_value(key, old), _audit_value(key, new)]
        row.values = {**row.values, key: new}
    if user is not None and "enabled" in changes:
        # 管理员亲手改了总开关:不再有「上限关的、下月自动开」这回事(用户 2026-09-29 定)。
        row.cap_closed_for = ""
    if keys:
        store = load_keys(row.api_keys)
        for slot, key in keys.items():
            store[slot] = {"key": key, "set_at": timezone.now().isoformat()}
        row.api_keys = json.dumps(store)
        changes["api_keys"] = {slot: "cleared" if key == "" else "replaced" for slot, key in keys.items()}
    for field, new in (refs or {}).items():
        old = getattr(row, field)
        if old != new:
            changes[field] = [None if old is None else str(old), None if new is None else str(new)]
        setattr(row, field, new)
    row.save()
    invalidate()
    audit(user, description, changes, request)
    return changes


def redact_url(url):
    """审计里的地址去掉 `user:pass@`:那是凭证,审计行比配置活得久。"""
    parts = urlsplit(url or "")
    if "@" not in parts.netloc:
        return url
    return urlunsplit(parts._replace(netloc=parts.netloc.rsplit("@", 1)[1]))


def audit(user, description, changes, request=None, resource_id="config"):
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=None, user=user, action="UPDATE", resource=AUDIT_RESOURCE, resource_id=resource_id,
        description=description[:500], changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )
