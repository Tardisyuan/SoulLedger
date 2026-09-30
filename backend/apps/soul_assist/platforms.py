"""「供应商」区块的平台预设、获取模型、参考价(设计稿 provider-platforms,2026-09-30)。

- **预设 = 适配器 + 地址,管理员不能改**;要改就选「自定义」。平台本身不是连接:选预设只是替管理员填好
  `provider` / `base_url`,连通测试与「改了连接要先测通」的规则照旧(`config.candidate`)。
- **出网只有 `_get` 一处**(列模型、取 LiteLLM 价目表)。测试里根 conftest 的 autouse fixture 把它换成直接失败。
- **已存的 key 不出服务器**:列模型用的是 `config.candidate` 算出的连接,换了地址不给 key 同样被拒。

每个预设的地址都读过厂商官方文档(2026-09-30)。「工具」一列:文档里有一句说支持函数调用才写 yes,
读不到就写 model(看模型,测试连接时实测):

| id          | 适配器            | Base URL                                              | 工具  | 文档                                                            |
|-------------|-------------------|-------------------------------------------------------|-------|-----------------------------------------------------------------|
| deepseek    | openai_compatible | https://api.deepseek.com                              | yes   | api-docs.deepseek.com(「base_url (OpenAI) \\| https://api.deepseek.com」); guides/tool_calls:「Tool Calls allows the model to call external tools」 |
| openai      | openai_compatible | https://api.openai.com/v1                             | yes   | developers.openai.com/api/reference/resources/models/methods/list; api/docs/guides/function-calling |
| anthropic   | anthropic         | https://api.anthropic.com                             | yes   | platform.claude.com/docs/en/api/models/list; agents-and-tools/tool-use/overview:「Tool use (also called function calling) lets Claude call functions」 |
| qwen        | openai_compatible | https://dashscope.aliyuncs.com/compatible-mode/v1     | yes   | help.aliyun.com/zh/model-studio/regions(北京,DashScope 域名;2026-09-30 起不再加新特性,新主推带 WorkspaceId 的域名,不能做固定预设); qwen-function-calling |
| kimi        | openai_compatible | https://api.moonshot.cn/v1                            | yes   | platform.kimi.com/docs/guide/start-using-kimi-api; use-kimi-api-to-complete-tool-calls |
| glm         | openai_compatible | https://open.bigmodel.cn/api/paas/v4                  | yes   | docs.bigmodel.cn/cn/guide/develop/openai/introduction(「调用带函数的对话」) |
| doubao      | openai_compatible | https://ark.cn-beijing.volces.com/api/v3              | model | volcengine.com/docs/82379/1330626 —— 页面由 JS 渲染,抓不到正文;地址取自搜索摘要,工具那句没读到 |
| gemini      | openai_compatible | https://generativelanguage.googleapis.com/v1beta/openai | yes | ai.google.dev/gemini-api/docs/openai(function calling 一节) |
| siliconflow | openai_compatible | https://api.siliconflow.cn/v1                         | model | docs.siliconflow.cn/cn/userguide/quickstart;function-calling:「可以通过模型广场查看当前支持tools的模型」 |
| openrouter  | openai_compatible | https://openrouter.ai/api/v1                          | model | openrouter.ai/docs/quickstart |
| ollama      | openai_compatible | http://localhost:11434/v1                             | model | docs.ollama.com/api/openai-compatibility(localhost = 服务器本机;不要 key) |
| custom      | —(页面上选)      | —(页面上填)                                           | model | |
"""
import logging
from dataclasses import dataclass
from datetime import date

import requests
from django.core.cache import cache

from apps.soul_assist import config

logger = logging.getLogger(__name__)

TOOLS = ("yes", "no", "model")


@dataclass(frozen=True)
class Platform:
    provider: str | None  # config.PROVIDERS 的名字;custom 为 None
    base_url: str | None
    tools: str
    litellm_prefix: str | None  # LiteLLM 价目表里这家的键前缀;None = 直接按模型名查
    needs_key: bool = True


CUSTOM = "custom"
PLATFORMS = {
    "deepseek": Platform("openai_compatible", "https://api.deepseek.com", "yes", "deepseek"),
    "openai": Platform("openai_compatible", "https://api.openai.com/v1", "yes", None),
    "anthropic": Platform("anthropic", "https://api.anthropic.com", "yes", None),
    "qwen": Platform("openai_compatible", "https://dashscope.aliyuncs.com/compatible-mode/v1", "yes", "dashscope"),
    "kimi": Platform("openai_compatible", "https://api.moonshot.cn/v1", "yes", "moonshot"),
    "glm": Platform("openai_compatible", "https://open.bigmodel.cn/api/paas/v4", "yes", "zai"),
    "doubao": Platform("openai_compatible", "https://ark.cn-beijing.volces.com/api/v3", "model", "volcengine"),
    "gemini": Platform("openai_compatible", "https://generativelanguage.googleapis.com/v1beta/openai", "yes", "gemini"),
    "siliconflow": Platform("openai_compatible", "https://api.siliconflow.cn/v1", "model", None),
    "openrouter": Platform("openai_compatible", "https://openrouter.ai/api/v1", "model", "openrouter"),
    "ollama": Platform("openai_compatible", "http://localhost:11434/v1", "model", "ollama", needs_key=False),
    CUSTOM: Platform(None, None, "model", None),
}

#: 选项集:serializer 与 settings.SPECTACULAR_SETTINGS 的 ENUM_NAME_OVERRIDES(AssistPlatformEnum)共用。
PLATFORM_IDS = tuple(PLATFORMS)
LIST_TIMEOUT_SECONDS = 10
ANTHROPIC_DEFAULT = "https://api.anthropic.com"


def _norm(url):
    return (url or "").rstrip("/")


def infer(conn: config.Connection) -> str:
    """没存过平台(或存的平台与连接对不上)时,按适配器 + 地址认出预设;认不出就是自定义。"""
    for pid, p in PLATFORMS.items():
        if p.provider and config.provider_path(p.provider) == conn.provider and _norm(p.base_url) == _norm(conn.base_url):
            return pid
    return CUSTOM


def current(stored, conn: config.Connection) -> str:
    """存的是预设而连接已不是它(比如 env 换了地址)→ 按连接重新认,不显示一个假的预设。"""
    if stored == CUSTOM:
        return CUSTOM
    p = PLATFORMS.get(stored)
    if p and config.provider_path(p.provider) == conn.provider and _norm(p.base_url) == _norm(conn.base_url):
        return stored
    return infer(conn)


def table():
    return [{"id": pid, "provider": p.provider, "base_url": p.base_url, "tools": p.tools, "needs_key": p.needs_key}
            for pid, p in PLATFORMS.items()]


def _get(url, headers, timeout):
    """唯一出网的地方。不重试。"""
    return requests.get(url, headers=headers, timeout=timeout)


# ── 获取模型 ───────────────────────────────────────────────────────────────


def _status_kind(code):
    if code in (401, 403):
        return "auth"
    if code in (402, 429):
        return "rate_limited"
    return "other"


def list_models(conn: config.Connection) -> dict:
    """{status: ok | no_list | failed, error_kind, models: [{name, context}]}。模型名在各家 API 里叫 `id`,
    这里叫 `name`:页面上它是给人读、给人填的名字,不是记录的标识。
    404 / 405 = 平台不提供模型列表(如火山方舟),**不算出错**。"""
    anthropic = conn.provider == config.provider_path("anthropic")
    base = _norm(conn.base_url) or (ANTHROPIC_DEFAULT if anthropic else "")
    if anthropic:
        url, headers = base + "/v1/models?limit=1000", {"x-api-key": conn.api_key, "anthropic-version": "2023-06-01"}
    else:
        url, headers = base + "/models", ({"Authorization": f"Bearer {conn.api_key}"} if conn.api_key else {})

    def failed(kind):
        return {"status": "failed", "error_kind": kind, "models": []}

    if not base:
        return failed("connection")
    try:
        resp = _get(url, headers, LIST_TIMEOUT_SECONDS)
    except requests.Timeout:
        return failed("timeout")
    except requests.RequestException as exc:
        logger.warning("assistant list models failed: %s", type(exc).__name__)
        return failed("connection")
    if resp.status_code in (404, 405):
        return {"status": "no_list", "error_kind": None, "models": []}
    if resp.status_code != 200:
        return failed(_status_kind(resp.status_code))
    try:
        data = resp.json()["data"]
        models = [{"name": str(m["id"]),
                   "context": m.get("context_length") or m.get("max_input_tokens") or m.get("context_window")}
                  for m in data]
    except (ValueError, KeyError, TypeError):
        return {"status": "no_list", "error_kind": None, "models": []}
    models = [{**m, "context": m["context"] if isinstance(m["context"], int) else None} for m in models]
    return {"status": "ok", "error_kind": None, "models": sorted(models, key=lambda m: m["name"])}


# ── 参考价(LiteLLM 公开价目表)──────────────────────────────────────────────

LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
LITELLM_TIMEOUT_SECONDS = 5
PRICE_CACHE_KEY = "soul_assist:litellm_prices"
PRICE_CACHE_SECONDS = 24 * 3600
#: 取失败时记住「取不到」这么久:别让每次打开页面都等 5 秒超时。
PRICE_FAIL_SECONDS = 5 * 60


def _per_million(v):
    return round(v * 1_000_000, 6)


def _fetch_table():
    """{as_of: "YYYY-MM-DD", prices: {键: [输入, 输出, 缓存读或 None]}}(美元 / 百万 token);取不到为 None。
    只留有输入输出单价的行:整份表 3 MB,缓存里只放用得到的。"""
    try:
        resp = _get(LITELLM_URL, {}, LITELLM_TIMEOUT_SECONDS)
        raw = resp.json() if resp.status_code == 200 else None
    except (requests.RequestException, ValueError) as exc:
        logger.warning("litellm price table unavailable: %s", type(exc).__name__)
        raw = None
    if not isinstance(raw, dict):
        return None
    prices = {}
    for key, row in raw.items():
        if not isinstance(row, dict):
            continue
        cin, cout, cread = row.get("input_cost_per_token"), row.get("output_cost_per_token"), \
            row.get("cache_read_input_token_cost")
        if isinstance(cin, (int, float)) and isinstance(cout, (int, float)):
            prices[key] = [_per_million(cin), _per_million(cout),
                           _per_million(cread) if isinstance(cread, (int, float)) else None]
    return {"as_of": date.today().isoformat(), "prices": prices}


def _table():
    cached = cache.get(PRICE_CACHE_KEY)
    if cached is None:
        cached = _fetch_table() or {"as_of": None, "prices": None}
        cache.set(PRICE_CACHE_KEY, cached, PRICE_CACHE_SECONDS if cached["prices"] is not None else PRICE_FAIL_SECONDS)
    return cached


def reference_price(platform, model) -> dict:
    """{found, input, output, cache_read, as_of}。先查「前缀/模型名」,再查模型名本身。"""
    t = _table()
    prices = t["prices"] or {}
    p = PLATFORMS.get(platform)
    keys = ([f"{p.litellm_prefix}/{model}"] if p and p.litellm_prefix else []) + [model]
    row = next((prices[k] for k in keys if k in prices), None)
    if row is None:
        return {"found": False, "input": None, "output": None, "cache_read": None, "as_of": t["as_of"]}
    return {"found": True, "input": row[0], "output": row[1], "cache_read": row[2], "as_of": t["as_of"]}
