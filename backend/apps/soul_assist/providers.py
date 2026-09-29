"""模型供应商:两个适配器 + 测试用的假实现(docs/ARCHITECTURE-soul-assist.md §3)。

**工具循环放在适配器里,不放在服务层。** 一次回答里的工具调用块是各家原生格式
(Anthropic 的 tool_use / tool_result 块、带 thinking 块的 assistant 内容;OpenAI 的
tool_calls / role=tool 消息),在同一次请求里原样来回最不容易错。跨请求回放的历史只有
`user` / `assistant` 正文(§4.2),所以服务层与适配器之间只需要 `Turn` 这一种中性结构。

超时按**截止时刻**算:每次调用的 timeout = 剩下的时间,重试关掉(SDK 默认 10 分钟、
重试 2 次)。服务端必须先于 App 的 25 秒放弃(§3)。
"""
import functools
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


def _fail(exc, secret=""):
    """供应商的 4xx 与宕机对灵魂都是 503;日志里分开,否则配置错误(模型不支持 effort 等)
    和对方宕机看起来一模一样。不记请求体:里面是灵魂的原文。对方的错误正文可能回显 key(`secret`),
    先抹掉再截断 —— 先截断会留下 key 的前半截。"""
    body = str(getattr(exc, "body", ""))
    if secret:
        body = body.replace(secret, "[redacted]")
    logger.warning("assistant provider failed: %s status=%s body=%s", type(exc).__name__,
                   getattr(exc, "status_code", None), body[:500])
    return ProviderError(type(exc).__name__, _kind(exc))


def _unexpected(exc, conn):
    """SDK 异常类之外的失败也是「不可用」(503、记一行用量),不是 500:没配 key 时 Anthropic 的 SDK
    在**请求时**抛 TypeError。没有 key 就归为 auth,好让连通测试说出原因。只记异常类名。"""
    logger.warning("assistant provider failed: %s (not an SDK API error)", type(exc).__name__)
    return ProviderError(type(exc).__name__, "other" if conn.api_key else "auth")


def _kind(exc):
    """管理页连通测试要说出「为什么不通」(docs/ARCHITECTURE-assist-admin.md §3.1)。两家 SDK 的异常类同名。
    「不支持工具调用」只在对方的 400 正文提到 tool 时才认得出,认不出就是 other。"""
    name = type(exc).__name__
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return "auth"
    if name == "NotFoundError":
        return "model_not_found"
    if name == "APITimeoutError":
        return "timeout"
    if name == "RateLimitError":
        return "rate_limited"
    if name == "APIConnectionError":
        return "connection"
    if name in ("BadRequestError", "UnprocessableEntityError") and "tool" in str(getattr(exc, "body", "")).lower():
        return "tools_unsupported"
    return "other"


class ProviderError(Exception):
    """供应商不可用:超时、连不上、对方 4xx/5xx。服务层把它翻成 503 `assistant_unavailable`。
    `kind` 只给管理页用,灵魂与官员看到的仍是同一个 503。"""

    def __init__(self, message, kind="other"):
        super().__init__(message)
        self.kind = kind


@dataclass(frozen=True)
class Turn:
    role: str  # "user" | "assistant"
    text: str


@dataclass(frozen=True)
class ToolSpec:
    """工具都不收参数:数据范围由服务端的 `account` 决定,模型无从指定(§4.1)。"""

    name: str
    description: str


@dataclass
class Answer:
    text: str
    tool_calls: list = field(default_factory=list)  # 按调用顺序的工具名
    usage: dict = field(default_factory=dict)


#: 调用工具的回调:工具名 → 已序列化的 JSON 字符串。
CallTool = Callable[[str], str]

_EMPTY_OBJECT = {"type": "object", "properties": {}, "additionalProperties": False}


class Provider(Protocol):
    def answer(self, *, system: str, facts: str, history: list, tools: list,
               call_tool: CallTool, max_rounds: int, deadline: float) -> Answer: ...


def _remaining(deadline):
    left = deadline - time.monotonic()
    if left <= 0:
        raise ProviderError("timeout", "timeout")
    return left


def _add_usage(total, **counts):
    for key, value in counts.items():
        total[key] = total.get(key, 0) + (value or 0)


class OpenAICompatibleProvider:
    """OpenAI Chat Completions 协议:OpenAI、Azure OpenAI、Ollama、DeepSeek 等只差 base_url。"""

    def __init__(self, client=None, conn=None):
        self.conn = conn
        if client is None:
            import openai

            c = self._conn()
            try:
                client = openai.OpenAI(api_key=c.api_key or "unused", base_url=c.base_url or None, max_retries=0)
            except Exception as exc:
                raise _unexpected(exc, c) from exc
        self.client = client

    def _conn(self):
        """`get_provider` 传入生效配置;直接构造(测试)时读 env。"""
        from apps.soul_assist.config import env_connection

        return self.conn or env_connection()

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        import openai

        conn = self._conn()
        model = conn.model
        messages = [{"role": "system", "content": system}, {"role": "system", "content": facts}]
        messages += [{"role": t.role, "content": t.text} for t in history]
        specs = [{"type": "function", "function": {"name": t.name, "description": t.description,
                                                   "parameters": _EMPTY_OBJECT}} for t in tools]
        result = Answer(text="")
        for round_no in range(max_rounds + 1):
            last = round_no == max_rounds
            try:
                response = self.client.with_options(timeout=_remaining(deadline)).chat.completions.create(
                    model=model, messages=messages, tools=specs,
                    tool_choice="none" if last else "auto",
                )
            except ProviderError:
                raise
            except openai.APIError as exc:
                raise _fail(exc, conn.api_key) from exc
            except Exception as exc:
                raise _unexpected(exc, conn) from exc
            usage = getattr(response, "usage", None)
            if usage is not None:
                _add_usage(result.usage, input=usage.prompt_tokens, output=usage.completion_tokens)
            if not response.choices:
                raise ProviderError("empty choices", "other")
            message = response.choices[0].message
            calls = message.tool_calls or []
            if not calls or last:
                result.text = message.content or ""
                return result
            messages.append({"role": "assistant", "content": message.content,
                             "tool_calls": [{"id": c.id, "type": "function",
                                             "function": {"name": c.function.name,
                                                          "arguments": c.function.arguments}} for c in calls]})
            for call in calls:
                result.tool_calls.append(call.function.name)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": call_tool(call.function.name)})
        return result


class AnthropicProvider:
    """Anthropic Messages API,官方 SDK。system 的帮助语料放缓存前缀,事实头放在断点之后(§4.4)。"""

    MAX_TOKENS = 4096

    def __init__(self, client=None, conn=None):
        self.conn = conn
        if client is None:
            import anthropic

            c = self._conn()
            try:
                client = anthropic.Anthropic(api_key=c.api_key or None, base_url=c.base_url or None, max_retries=0)
            except Exception as exc:
                raise _unexpected(exc, c) from exc
        self.client = client

    _conn = OpenAICompatibleProvider._conn

    @staticmethod
    def _request(client, conn, **params):
        """带服务端拒答回退(`fallbacks`)时走 beta 端点;设成空串即关掉。"""
        extra = {}
        if conn.effort:
            extra["output_config"] = {"effort": conn.effort}
        if conn.fallbacks:
            return client.beta.messages.create(betas=["server-side-fallback-2026-07-01"],
                                               fallbacks=conn.fallbacks, **extra, **params)
        return client.messages.create(**extra, **params)

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        import anthropic

        conn = self._conn()
        blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
                  {"type": "text", "text": facts}]
        messages = [{"role": t.role, "content": t.text} for t in history]
        specs = [{"name": t.name, "description": t.description, "input_schema": _EMPTY_OBJECT} for t in tools]
        result = Answer(text="")
        for round_no in range(max_rounds + 1):
            last = round_no == max_rounds
            try:
                response = self._request(
                    self.client.with_options(timeout=_remaining(deadline)), conn,
                    model=conn.model, max_tokens=self.MAX_TOKENS, system=blocks,
                    messages=messages, tools=specs,
                    tool_choice={"type": "none"} if last else {"type": "auto"},
                )
            except ProviderError:
                raise
            except anthropic.APIError as exc:
                raise _fail(exc, conn.api_key) from exc
            except Exception as exc:
                raise _unexpected(exc, conn) from exc
            usage = response.usage
            _add_usage(result.usage, input=usage.input_tokens, output=usage.output_tokens,
                       cache_read=getattr(usage, "cache_read_input_tokens", 0))
            uses = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not uses or last:
                # refusal / max_tokens / end_turn:取文本块;拒答时可能为空,服务层给固定的「答不了」。
                result.text = "".join(b.text for b in response.content if b.type == "text")
                return result
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for use in uses:
                result.tool_calls.append(use.name)
                results.append({"type": "tool_result", "tool_use_id": use.id, "content": call_tool(use.name)})
            messages.append({"role": "user", "content": results})
        return result


class FakeProvider:
    """测试用。`script` 是一串回合:每回合要么 `{"tools": [...]}`(要调的工具名),要么
    `{"text": "..."}`。它测的是**管道**(工具范围、循环上限、落库),不是模型行为 ——
    调哪个工具是脚本写死的(§8)。"""

    script: list = []
    calls: list = []  # 每次 answer() 收到的参数,供断言

    def __init__(self, client=None, conn=None):
        self.conn = conn

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        type(self).calls.append({"system": system, "facts": facts, "history": list(history),
                                 "tools": [t.name for t in tools], "max_rounds": max_rounds,
                                 "model": (self.conn.model if self.conn else None)})
        result = Answer(text="", usage={"input": 1, "output": 1})
        rounds = 0
        for step in type(self).script:
            if "raise" in step:
                raise ProviderError(step["raise"], step.get("kind", "other"))
            if "tools" in step and rounds < max_rounds:
                rounds += 1
                for name in step["tools"]:
                    result.tool_calls.append(name)
                    step.setdefault("results", []).append(json.loads(call_tool(name)))
                continue
            if "text" in step:
                result.text = step["text"]
                return result
        return result


def get_provider(conn) -> Provider:
    """`conn` 是 `config.Connection`:正式提问传生效配置(库覆盖 env,`apps/soul_assist/config.py`),评测传候选配置。"""
    return _provider(conn)


@functools.lru_cache(maxsize=8)
def _provider(conn):
    """每套配置一个客户端:复用连接池,不必每问一次 TLS 握手。配置一变,键就变。"""
    return import_string(conn.provider)(conn=conn)
