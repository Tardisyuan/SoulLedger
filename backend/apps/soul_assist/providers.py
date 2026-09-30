"""模型供应商:两个适配器 + 测试用的假实现(docs/ARCHITECTURE-soul-assist.md §3)。

**工具循环放在适配器里,不放在服务层。** 一次回答里的工具调用块是各家原生格式
(Anthropic 的 tool_use / tool_result 块、带 thinking 块的 assistant 内容;OpenAI 的
tool_calls / role=tool 消息),在同一次请求里原样来回最不容易错。跨请求回放的历史只有
`user` / `assistant` 正文(§4.2),所以服务层与适配器之间只需要 `Turn` 这一种中性结构。

超时按**截止时刻**算:每次调用的 timeout = 剩下的时间,重试关掉(SDK 默认 10 分钟、
重试 2 次)。服务端必须先于 App 的 25 秒放弃(§3)。

**流式(`stream()`,§13)** 与 `answer()` 同一个工具循环,只是每轮都以流式请求发出、文本一到就 yield。
两个截止时刻:第一段文本之前是 `first_token_deadline`,之后是 `deadline`(总时长)。调用方关掉这个生成器
(灵魂断开或停止)时,`with` 关掉 SDK 的流 —— HTTP 连接断开,供应商不再生成;这一轮没收到用量,就按
收到的文本粗估并置 `result.estimated`。
"""
import functools
import json
import logging
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Protocol

from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


def _fail(exc, secret="", result=None):
    """供应商的 4xx 与宕机对灵魂都是 503;日志里分开,否则配置错误(模型不支持 effort 等)
    和对方宕机看起来一模一样。不记请求体:里面是灵魂的原文。对方的错误正文可能回显 key(`secret`),
    先抹掉再截断 —— 先截断会留下 key 的前半截。"""
    body = str(getattr(exc, "body", ""))
    if secret:
        body = body.replace(secret, "[redacted]")
    status = getattr(exc, "status_code", None)
    logger.warning("assistant provider failed: %s status=%s body=%s", type(exc).__name__, status, body[:500])
    return _with_usage(ProviderError(type(exc).__name__, _kind(exc), status=status), result)


def _unexpected(exc, conn, result=None):
    """SDK 异常类之外的失败也是「不可用」(503、记一行用量),不是 500:没配 key 时 Anthropic 的 SDK
    在**请求时**抛 TypeError。没有 key 就归为 auth,好让连通测试说出原因。只记异常类名。

    流式读到一半的网络错误不经 SDK 包装,原样是 HTTP 库的异常(httpx / httpx2 同名):按类名认出
    超时与断连 —— 两者都要能触发改用备用(§13)。"""
    logger.warning("assistant provider failed: %s (not an SDK API error)", type(exc).__name__)
    names = {c.__name__ for c in type(exc).__mro__}
    kind = ("timeout" if "TimeoutException" in names else "connection" if "TransportError" in names
            else "other" if conn.api_key else "auth")
    return _with_usage(ProviderError(type(exc).__name__, kind), result)


def _with_usage(error, result):
    """失败前已经花掉的 token(工具轮成功、下一轮才失败):改用备用时这部分也要记账。"""
    if result is not None:
        error.usage = dict(result.usage)
    return error


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


#: 可以改用备用的失败(§13,用户 2026-10-01 定):连不上、超时、429、5xx、402。
#: 401/403(auth)、404(model_not_found)、不支持工具、配置错误都**不**切换 —— 那是这边的配置错了,
#: 备用救不了它,切过去只会把错误藏起来。
SWITCHING_REASONS = ("connection", "timeout", "rate_limited", "server_error", "quota")


class ProviderError(Exception):
    """供应商不可用:超时、连不上、对方 4xx/5xx。服务层把它翻成 503 `assistant_unavailable`。
    `kind` 只给管理页用,灵魂与官员看到的仍是同一个 503。`status` 是对方的 HTTP 状态码(有才有)。"""

    def __init__(self, message, kind="other", status=None):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.usage = {}

    @property
    def reason(self):
        """改用备用的理由(`SWITCHING_REASONS` 之一),不该切换时为 None。5xx 与 402 在 `kind` 里是 other
        (连通测试的文案不变),这里按状态码分出来。"""
        if self.kind in ("connection", "timeout", "rate_limited"):
            return self.kind
        if self.kind == "other" and self.status is not None:
            if self.status == 402:
                return "quota"
            if self.status >= 500:
                return "server_error"
        return None


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
    #: 流被中途关掉(停止、断连、出错),最后一轮没拿到供应商报的用量,token 数里有按文本粗估的部分。
    estimated: bool = False


#: 调用工具的回调:工具名 → 已序列化的 JSON 字符串。
CallTool = Callable[[str], str]

_EMPTY_OBJECT = {"type": "object", "properties": {}, "additionalProperties": False}


class Provider(Protocol):
    def answer(self, *, system: str, facts: str, history: list, tools: list,
               call_tool: CallTool, max_rounds: int, deadline: float) -> Answer: ...

    def stream(self, *, system: str, facts: str, history: list, tools: list, call_tool: CallTool,
               max_rounds: int, deadline: float, first_token_deadline: float, result: Answer) -> Iterator[str]: ...


def _remaining(deadline):
    left = deadline - time.monotonic()
    if left <= 0:
        raise ProviderError("timeout", "timeout")
    return left


def _due(result, deadline, first_token_deadline):
    """流式里此刻适用的截止时刻:还没出过文本就是首字截止(不晚于总截止),出过就是总截止。"""
    return deadline if result.text else min(deadline, first_token_deadline)


def _estimate_round(result, request, text):
    """流中途被关、这一轮没拿到用量:输入按请求体、输出按收到的文本粗估(`usage.estimate_tokens`)。
    只在对方**已经开始回应**时调(连都没连上的请求不收钱,不能算成花费)。"""
    from apps.soul_assist.usage import estimate_tokens

    _add_usage(result.usage, input=estimate_tokens(json.dumps(request, ensure_ascii=False, default=str)),
               output=estimate_tokens(text))
    result.estimated = True


def _append(result, piece, fresh):
    """`fresh`:这是本轮第一段文本。前面已有别轮的文本(工具轮之前的开场白)就先隔一个空行。
    返回要发给客户端的串(= 追加进 `result.text` 的串)。"""
    out = "\n\n" + piece if fresh and result.text else piece
    result.text += out
    return out


def _add_usage(total, **counts):
    for key, value in counts.items():
        total[key] = total.get(key, 0) + (value or 0)


def _vendor_params(conn):
    """DeepSeek turns thinking mode on by default, and in thinking mode every later request that carries
    `tools` must send back each earlier turn's `reasoning_content` or the API answers 400 (api-docs.deepseek.com,
    guides/thinking_mode, read 2026-09-30). History here keeps only the answer text (§4.2), so a second question
    in a conversation would fail. Thinking also spends the 22 s budget. Turn it off for that host."""
    if "deepseek.com" in (conn.base_url or ""):
        return {"extra_body": {"thinking": {"type": "disabled"}}}
    return {}


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

    @staticmethod
    def _start(system, facts, history, tools):
        messages = [{"role": "system", "content": system}, {"role": "system", "content": facts}]
        messages += [{"role": t.role, "content": t.text} for t in history]
        specs = [{"type": "function", "function": {"name": t.name, "description": t.description,
                                                   "parameters": _EMPTY_OBJECT}} for t in tools]
        return messages, specs

    @staticmethod
    def _params(conn, messages, specs, last):
        # 不带工具时连 tool_choice 也不能给:OpenAI 拒收空的 tools 数组(连通测试的「不带工具再试」走这里)
        with_tools = {"tools": specs, "tool_choice": "none" if last else "auto"} if specs else {}
        return {"model": conn.model, "messages": messages, **with_tools, **_vendor_params(conn)}

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        import openai

        conn = self._conn()
        messages, specs = self._start(system, facts, history, tools)
        result = Answer(text="")
        for round_no in range(max_rounds + 1):
            last = round_no == max_rounds
            try:
                response = self.client.with_options(timeout=_remaining(deadline)).chat.completions.create(
                    **self._params(conn, messages, specs, last))
            except ProviderError as exc:
                _with_usage(exc, result)
                raise
            except openai.APIError as exc:
                raise _fail(exc, conn.api_key, result) from exc
            except Exception as exc:
                raise _unexpected(exc, conn, result) from exc
            usage = getattr(response, "usage", None)
            if usage is not None:
                _add_usage(result.usage, input=usage.prompt_tokens, output=usage.completion_tokens)
            if not response.choices:
                raise _with_usage(ProviderError("empty choices", "other"), result)
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

    def stream(self, *, system, facts, history, tools, call_tool, max_rounds, deadline, first_token_deadline,
               result):
        """同 `answer`,但每轮 `stream=True`,文本到一段 yield 一段;工具调用的片段按 `index` 拼起来。
        用量要 `stream_options.include_usage`(在最后一个没有 choices 的块里)。"""
        import openai

        conn = self._conn()
        messages, specs = self._start(system, facts, history, tools)
        for round_no in range(max_rounds + 1):
            last = round_no == max_rounds
            params = self._params(conn, messages, specs, last)
            calls, text, fresh, started, got_usage, response = {}, "", True, False, False, None
            try:
                response = self.client.with_options(
                    timeout=_remaining(_due(result, deadline, first_token_deadline))).chat.completions.create(
                    **params, stream=True, stream_options={"include_usage": True})
                for chunk in response:
                    started = True
                    # 先看钟再发:到点之后才到的那一段不再发出去(首字之前按首字截止,之后按总截止)
                    _remaining(_due(result, deadline, first_token_deadline))
                    usage = getattr(chunk, "usage", None)
                    if usage is not None:
                        _add_usage(result.usage, input=usage.prompt_tokens, output=usage.completion_tokens)
                        got_usage = True
                    if chunk.choices:
                        delta = chunk.choices[0].delta
                        for part in getattr(delta, "tool_calls", None) or []:
                            call = calls.setdefault(part.index, {"id": "", "name": "", "arguments": ""})
                            call["id"] = part.id or call["id"]
                            if part.function is not None:
                                call["name"] += part.function.name or ""
                                call["arguments"] += part.function.arguments or ""
                        if delta.content:
                            text += delta.content
                            yield _append(result, delta.content, fresh)
                            fresh = False
            except ProviderError as exc:
                _with_usage(exc, result)
                raise
            except openai.APIError as exc:
                raise _fail(exc, conn.api_key, result) from exc
            except Exception as exc:
                raise _unexpected(exc, conn, result) from exc
            finally:
                if response is not None:
                    response.close()
                if started and not got_usage:
                    _estimate_round(result, params, text + "".join(c["arguments"] for c in calls.values()))
            if not calls or last:
                return
            ordered = [calls[i] for i in sorted(calls)]
            messages.append({"role": "assistant", "content": text or None,
                             "tool_calls": [{"id": c["id"], "type": "function",
                                             "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                                            for c in ordered]})
            for call in ordered:
                result.tool_calls.append(call["name"])
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": call_tool(call["name"])})


class AnthropicProvider:
    """Anthropic Messages API,官方 SDK。system 的帮助语料放缓存前缀,事实头放在断点之后(§4.4)。"""

    MAX_TOKENS = 4096

    def __init__(self, client=None, conn=None):
        self.conn = conn
        if client is None:
            import anthropic

            c = self._conn()
            if not c.api_key:
                # 不能交 None 给 SDK:它会退回去读进程环境里的 ANTHROPIC_API_KEY,
                # 管理员在页面上「清除 key」就成了空话。没有 key 就是鉴权失败。
                raise ProviderError("no api key", "auth")
            try:
                client = anthropic.Anthropic(api_key=c.api_key, base_url=c.base_url or None, max_retries=0)
            except Exception as exc:
                raise _unexpected(exc, c) from exc
        self.client = client

    _conn = OpenAICompatibleProvider._conn

    @staticmethod
    def _request(client, conn, stream=False, **params):
        """带服务端拒答回退(`fallbacks`)时走 beta 端点;设成空串即关掉。`stream` 用 SDK 的 `.stream()`
        助手:它把事件拼回完整的 message(含 thinking 块与签名),工具循环照原样回传。"""
        extra = {}
        if conn.effort:
            extra["output_config"] = {"effort": conn.effort}
        if conn.fallbacks:
            messages = client.beta.messages
            call = messages.stream if stream else messages.create
            return call(betas=["server-side-fallback-2026-07-01"], fallbacks=conn.fallbacks, **extra, **params)
        return (client.messages.stream if stream else client.messages.create)(**extra, **params)

    def _start(self, conn, system, facts, history, tools):
        blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
                  {"type": "text", "text": facts}]
        messages = [{"role": t.role, "content": t.text} for t in history]
        specs = [{"name": t.name, "description": t.description, "input_schema": _EMPTY_OBJECT} for t in tools]
        return blocks, messages, specs

    def _params(self, conn, blocks, messages, specs, last):
        return {"model": conn.model, "max_tokens": self.MAX_TOKENS, "system": blocks, "messages": messages,
                **({"tools": specs, "tool_choice": {"type": "none"} if last else {"type": "auto"}} if specs else {})}

    @staticmethod
    def _usage(result, usage):
        _add_usage(result.usage, input=usage.input_tokens, output=usage.output_tokens,
                   cache_read=getattr(usage, "cache_read_input_tokens", 0))

    def _next(self, result, response, messages, call_tool, last):
        """一轮的回应 → 还要不要下一轮。工具轮把 assistant 内容与工具结果接进 `messages`。"""
        uses = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not uses or last:
            return False
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for use in uses:
            result.tool_calls.append(use.name)
            results.append({"type": "tool_result", "tool_use_id": use.id, "content": call_tool(use.name)})
        messages.append({"role": "user", "content": results})
        return True

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        import anthropic

        conn = self._conn()
        blocks, messages, specs = self._start(conn, system, facts, history, tools)
        result = Answer(text="")
        for round_no in range(max_rounds + 1):
            last = round_no == max_rounds
            try:
                response = self._request(self.client.with_options(timeout=_remaining(deadline)), conn,
                                         **self._params(conn, blocks, messages, specs, last))
            except ProviderError as exc:
                _with_usage(exc, result)
                raise
            except anthropic.APIError as exc:
                raise _fail(exc, conn.api_key, result) from exc
            except Exception as exc:
                raise _unexpected(exc, conn, result) from exc
            self._usage(result, response.usage)
            if not self._next(result, response, messages, call_tool, last):
                # refusal / max_tokens / end_turn:取文本块;拒答时可能为空,服务层给固定的「答不了」。
                result.text = "".join(b.text for b in response.content if b.type == "text")
                return result
        return result

    def stream(self, *, system, facts, history, tools, call_tool, max_rounds, deadline, first_token_deadline,
               result):
        import anthropic

        conn = self._conn()
        blocks, messages, specs = self._start(conn, system, facts, history, tools)
        for round_no in range(max_rounds + 1):
            last = round_no == max_rounds
            params = self._params(conn, blocks, messages, specs, last)
            text, fresh, live, message = "", True, None, None
            try:
                manager = self._request(
                    self.client.with_options(timeout=_remaining(_due(result, deadline, first_token_deadline))),
                    conn, stream=True, **params)
                with manager as live:
                    for event in live:
                        _remaining(_due(result, deadline, first_token_deadline))
                        if event.type == "text" and event.text:
                            text += event.text
                            yield _append(result, event.text, fresh)
                            fresh = False
                    message = live.get_final_message()
            except ProviderError as exc:
                _with_usage(exc, result)
                raise
            except anthropic.APIError as exc:
                raise _fail(exc, conn.api_key, result) from exc
            except Exception as exc:
                raise _unexpected(exc, conn, result) from exc
            finally:
                if message is None and live is not None:
                    # message_start 带来了真的输入 token;输出只能按收到的文本估
                    snapshot = getattr(live, "current_message_snapshot", None)
                    if snapshot is not None:
                        _add_usage(result.usage, input=snapshot.usage.input_tokens,
                                   cache_read=getattr(snapshot.usage, "cache_read_input_tokens", 0))
                        _estimate_round(result, {}, text)
                    else:
                        _estimate_round(result, params, text)
            self._usage(result, message.usage)
            if not self._next(result, message, messages, call_tool, last):
                return


class FakeProvider:
    """测试用。`script` 是一串回合:每回合要么 `{"tools": [...]}`(要调的工具名),要么
    `{"text": "..."}`。它测的是**管道**(工具范围、循环上限、落库),不是模型行为 ——
    调哪个工具是脚本写死的(§8)。

    流式另认:`{"deltas": ["a", "b"], "more": True}`(逐段 yield;`more` = 之后还有步骤,不在此收尾)、
    `{"raise": …, "kind": …, "status": …}`(可放在 deltas 之后,模拟出过字以后才出错)。
    `scripts` 按模型名覆盖 `script`,给主用 / 备用各写一套。`pulled` 记下真正产出过的段 —— 客户端停止后
    不再增长,即「不再调用供应商」。"""

    script: list = []
    scripts: dict = {}
    calls: list = []  # 每次 answer() / stream() 收到的参数,供断言
    pulled: list = []

    def __init__(self, client=None, conn=None):
        self.conn = conn

    def _script(self):
        model = self.conn.model if self.conn else None
        return type(self).scripts.get(model, type(self).script)

    def _record(self, **params):
        type(self).calls.append({**params, "tools": [t.name for t in params["tools"]], "history": list(params["history"]),
                                 "model": (self.conn.model if self.conn else None)})

    @staticmethod
    def _raise(step, result=None):
        error = ProviderError(step["raise"], step.get("kind", "other"), status=step.get("status"))
        raise _with_usage(error, result)

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        self._record(system=system, facts=facts, history=history, tools=tools, max_rounds=max_rounds,
                     deadline=deadline)
        result = Answer(text="", usage={"input": 1, "output": 1})
        rounds = 0
        for step in self._script():
            if "raise" in step:
                self._raise(step)
            if "tools" in step and rounds < max_rounds:
                rounds += 1
                for name in step["tools"]:
                    result.tool_calls.append(name)
                    step.setdefault("results", []).append(json.loads(call_tool(name)))
                continue
            if "text" in step or "deltas" in step:
                result.text = step.get("text", "".join(step.get("deltas", [])))
                return result
        return result

    def stream(self, *, system, facts, history, tools, call_tool, max_rounds, deadline, first_token_deadline,
               result):
        self._record(system=system, facts=facts, history=history, tools=tools, max_rounds=max_rounds,
                     deadline=deadline, first_token_deadline=first_token_deadline)
        rounds = 0
        for step in self._script():
            if "raise" in step:
                self._raise(step, result)
            if not result.usage:  # 对方开始回应才花钱:一上来就失败的请求没有用量
                _add_usage(result.usage, input=1, output=1)
            if "tools" in step and rounds < max_rounds:
                rounds += 1
                for name in step["tools"]:
                    result.tool_calls.append(name)
                    call_tool(name)
                continue
            if "text" in step or "deltas" in step:
                fresh = True
                for piece in step.get("deltas", [step.get("text")]):
                    type(self).pulled.append(piece)
                    yield _append(result, piece, fresh)
                    fresh = False
                if not step.get("more"):
                    return


def get_provider(conn) -> Provider:
    """`conn` 是 `config.Connection`:正式提问传生效配置(库覆盖 env,`apps/soul_assist/config.py`),评测传候选配置。"""
    return _provider(conn)


@functools.lru_cache(maxsize=8)
def _provider(conn):
    """每套配置一个客户端:复用连接池,不必每问一次 TLS 握手。配置一变,键就变。"""
    return import_string(conn.provider)(conn=conn)
