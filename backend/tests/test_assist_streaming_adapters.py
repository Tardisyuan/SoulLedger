"""两个真适配器的流式翻译、截止时刻、中途关闭,以及 SSE 的异步迭代器(docs/ARCHITECTURE-soul-assist.md §13)。

注入假的 SDK 客户端(与 `test_soul_assist_providers.py` 同一个做法),不发任何网络请求。
"""
import asyncio
import contextvars
import copy
import json
import time
from types import SimpleNamespace

import anthropic
import httpx2
import openai
import pytest

from apps.soul_assist import sse
from apps.soul_assist.config import Connection
from apps.soul_assist.providers import (
    Answer,
    AnthropicProvider,
    OpenAICompatibleProvider,
    ProviderError,
    ToolSpec,
    Turn,
)

TOOLS = [ToolSpec("me", "me"), ToolSpec("rebirth", "rebirth")]
HISTORY = [Turn("user", "这一问")]
OA = Connection("apps.soul_assist.providers.OpenAICompatibleProvider", "https://api.openai.com/v1", "k", "gpt-x", "", "")
AN = Connection("apps.soul_assist.providers.AnthropicProvider", "", "k", "claude-x", "", "")


class Clock:
    def __init__(self, monkeypatch, start=100.0):
        self.now = start
        monkeypatch.setattr(time, "monotonic", lambda: self.now)


class OAStream:
    """`chat.completions.create(stream=True)` 的回应:可迭代、可关。`steps` 是 (时钟前进, 块)。"""

    def __init__(self, steps, clock=None):
        self.steps, self.clock, self.closed, self.pulled = steps, clock, False, 0

    def __iter__(self):
        for advance, chunk in self.steps:
            if self.clock:
                self.clock.now += advance
            if isinstance(chunk, Exception):
                raise chunk
            self.pulled += 1
            yield chunk

    def close(self):
        self.closed = True


def _oa_text(t):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=t, tool_calls=None))], usage=None)


def _oa_call(index, id_=None, name=None, args=None):
    part = SimpleNamespace(index=index, id=id_, function=SimpleNamespace(name=name, arguments=args))
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=[part]))], usage=None)


def _oa_usage(i, o):
    return SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=i, completion_tokens=o))


class Client:
    def __init__(self, responses):
        self.responses, self.requests, self.timeouts = list(responses), [], []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._take))
        self.messages = SimpleNamespace(stream=self._take)
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=lambda **p: self._take(beta=True, **p)))

    def with_options(self, timeout):
        self.timeouts.append(timeout)
        return self

    def _take(self, **params):
        self.requests.append(copy.deepcopy(params))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _stream(provider, calls=None, deadline=60.0, first=22.0, result=None):
    result = result if result is not None else Answer(text="")
    now = time.monotonic()
    gen = provider.stream(system="S", facts="F", history=HISTORY, tools=TOOLS,
                          call_tool=lambda name: (calls if calls is not None else []).append(name) or json.dumps({"t": name}),
                          max_rounds=3, deadline=now + deadline, first_token_deadline=now + first, result=result)
    return gen, result


# ── OpenAI 兼容 ─────────────────────────────────────────────────────────


def test_openai_streams_text_after_a_tool_round_assembled_from_fragments():
    tool_round = OAStream([(0, _oa_call(0, "c1", "rebi")), (0, _oa_call(0, None, "rth", "{")),
                           (0, _oa_call(0, None, None, "}")), (0, _oa_usage(10, 2))])
    text_round = OAStream([(0, _oa_text("答")), (0, _oa_text("案")), (0, _oa_usage(20, 3))])
    client = Client([tool_round, text_round])
    calls = []
    gen, result = _stream(OpenAICompatibleProvider(client, conn=OA), calls)
    assert list(gen) == ["答", "案"]
    assert (result.text, result.tool_calls, calls) == ("答案", ["rebirth"], ["rebirth"])
    assert result.usage == {"input": 30, "output": 5} and result.estimated is False
    first, second = client.requests
    assert first["stream"] is True and first["stream_options"] == {"include_usage": True}
    assert second["messages"][-2]["tool_calls"] == [
        {"id": "c1", "type": "function", "function": {"name": "rebirth", "arguments": "{}"}}]
    assert second["messages"][-1] == {"role": "tool", "tool_call_id": "c1", "content": json.dumps({"t": "rebirth"})}
    assert tool_round.closed and text_round.closed


def test_openai_closing_mid_stream_closes_the_http_stream_and_estimates_usage():
    """停止:关掉生成器 → SDK 的流被关(连接断开,供应商不再生成);没收到用量就按文本估。
    变异:去掉 finally 里的 `response.close()` → 红。"""
    upstream = OAStream([(0, _oa_text("一二三")), (0, _oa_text("四")), (0, _oa_text("五")), (0, _oa_usage(9, 9))])
    gen, result = _stream(OpenAICompatibleProvider(Client([upstream]), conn=OA))
    assert next(gen) == "一二三"
    gen.close()
    assert upstream.closed and upstream.pulled == 1
    assert result.estimated and result.usage["output"] == 3 and result.usage["input"] > 0


def test_openai_a_request_that_never_started_costs_nothing():
    request = httpx2.Request("POST", "http://x.invalid")
    gen, result = _stream(OpenAICompatibleProvider(Client([openai.APIConnectionError(request=request)]), conn=OA))
    with pytest.raises(ProviderError) as caught:
        list(gen)
    assert caught.value.reason == "connection" and result.usage == {} and not result.estimated


def test_the_first_token_deadline_ends_a_silent_stream(monkeypatch):
    """首字截止:对方一直不出字(只发空块)。变异:`_due` 恒返回总截止 → 不超时 → 红。"""
    clock = Clock(monkeypatch)
    upstream = OAStream([(5, _oa_text(None)), (5, _oa_text(None)), (15, _oa_text(None)), (1, _oa_text("迟"))], clock)
    gen, _ = _stream(OpenAICompatibleProvider(Client([upstream]), conn=OA), deadline=60, first=22)
    with pytest.raises(ProviderError) as caught:
        list(gen)
    assert caught.value.reason == "timeout" and upstream.closed and upstream.pulled == 3


def test_after_the_first_text_only_the_total_deadline_applies(monkeypatch):
    clock = Clock(monkeypatch)
    upstream = OAStream([(1, _oa_text("先")), (30, _oa_text("慢")), (10, _oa_text("但到")), (20, _oa_text("超"))],
                        clock)
    gen, result = _stream(OpenAICompatibleProvider(Client([upstream]), conn=OA), deadline=60, first=22)
    got = []
    with pytest.raises(ProviderError) as caught:
        for piece in gen:
            got.append(piece)
    assert got == ["先", "慢", "但到"]  # 第 61 秒才到的那一段不再发
    assert caught.value.reason == "timeout" and result.text == "先慢但到"


def test_the_request_timeout_is_the_time_left_to_the_deadline_that_applies(monkeypatch):
    clock = Clock(monkeypatch)
    client = Client([OAStream([(0, _oa_text("好"))], clock)])
    list(_stream(OpenAICompatibleProvider(client, conn=OA), deadline=60, first=12)[0])
    assert client.timeouts == [12.0]


@pytest.mark.parametrize("exc,reason", [
    (httpx2.ReadTimeout("slow"), "timeout"),
    (httpx2.RemoteProtocolError("peer closed"), "connection"),
    (httpx2.ReadError("reset"), "connection"),
])
def test_network_errors_mid_stream_are_classified_for_failover(exc, reason):
    """流读到一半,HTTP 库的异常不经 SDK 包装原样冒出来 —— 也要能触发改用备用。"""
    upstream = OAStream([(0, exc)])
    gen, _ = _stream(OpenAICompatibleProvider(Client([upstream]), conn=OA))
    with pytest.raises(ProviderError) as caught:
        list(gen)
    assert caught.value.reason == reason


@pytest.mark.parametrize("status,reason", [(402, "quota"), (500, "server_error"), (503, "server_error"),
                                           (529, "server_error"), (429, "rate_limited"), (401, None), (403, None),
                                           (404, None), (400, None), (422, None)])
def test_status_codes_map_to_failover_reasons(status, reason):
    request = httpx2.Request("POST", "http://x.invalid")
    response = httpx2.Response(status, request=request)
    exc = openai.OpenAI(api_key="x")._make_status_error("err", body=None, response=response)
    gen, _ = _stream(OpenAICompatibleProvider(Client([exc]), conn=OA))
    with pytest.raises(ProviderError) as caught:
        list(gen)
    assert caught.value.reason == reason and caught.value.status == status


# ── Anthropic ───────────────────────────────────────────────────────────


class ANLive:
    def __init__(self, events, final, snapshot=None, clock=None):
        self.events, self.final, self.clock = events, final, clock
        self.current_message_snapshot = snapshot
        self.entered = self.exited = False

    def __enter__(self):
        self.entered = True
        return self

    def __exit__(self, *exc):
        self.exited = True  # SDK 在这里关掉 HTTP 流

    def __iter__(self):
        for advance, event in self.events:
            if self.clock:
                self.clock.now += advance
            yield event

    def get_final_message(self):
        return self.final


def _an_message(stop, *blocks, i=10, o=2):
    return SimpleNamespace(stop_reason=stop, content=list(blocks),
                           usage=SimpleNamespace(input_tokens=i, output_tokens=o, cache_read_input_tokens=7))


def _text_event(t):
    return SimpleNamespace(type="text", text=t)


def test_anthropic_streams_text_after_a_tool_round_through_the_sdk_helper():
    use = SimpleNamespace(type="tool_use", id="u1", name="rebirth", input={})
    tool_round = ANLive([(0, SimpleNamespace(type="content_block_stop"))], _an_message("tool_use", use))
    text_round = ANLive([(0, _text_event("可")), (0, _text_event("以"))],
                        _an_message("end_turn", SimpleNamespace(type="text", text="可以")))
    client = Client([tool_round, text_round])
    calls = []
    gen, result = _stream(AnthropicProvider(client, conn=AN), calls)
    assert list(gen) == ["可", "以"]
    assert (result.text, result.tool_calls, calls) == ("可以", ["rebirth"], ["rebirth"])
    assert result.usage == {"input": 20, "output": 4, "cache_read": 14}
    assert client.requests[1]["messages"][-2] == {"role": "assistant", "content": [use]}
    assert client.requests[1]["messages"][-1]["content"][0]["tool_use_id"] == "u1"
    assert tool_round.exited and text_round.exited


def test_anthropic_fallbacks_stream_through_the_beta_helper():
    conn = Connection(AN.provider, "", "k", "claude-x", "low", "default")
    client = Client([ANLive([(0, _text_event("好"))], _an_message("end_turn"))])
    list(_stream(AnthropicProvider(client, conn=conn))[0])
    assert client.requests[0]["beta"] is True and client.requests[0]["fallbacks"] == "default"
    assert client.requests[0]["output_config"] == {"effort": "low"}


def test_anthropic_closing_mid_stream_exits_the_sdk_stream_and_keeps_the_real_input_tokens():
    snapshot = SimpleNamespace(usage=SimpleNamespace(input_tokens=321, output_tokens=1, cache_read_input_tokens=0))
    live = ANLive([(0, _text_event("一二")), (0, _text_event("三"))], None, snapshot)
    gen, result = _stream(AnthropicProvider(Client([live]), conn=AN))
    assert next(gen) == "一二"
    gen.close()
    assert live.exited and result.estimated
    assert result.usage["input"] == 321 and result.usage["output"] == 2


def test_anthropic_status_errors_carry_the_status():
    request = httpx2.Request("POST", "http://x.invalid")
    exc = anthropic.Anthropic(api_key="x")._make_status_error(
        "overloaded", body=None, response=httpx2.Response(529, request=request))
    gen, _ = _stream(AnthropicProvider(Client([exc]), conn=AN))
    with pytest.raises(ProviderError) as caught:
        list(gen)
    assert caught.value.reason == "server_error"


# ── SSE:ASGI 下的异步迭代器 ───────────────────────────────────────────────


def test_the_async_body_notices_a_disconnect_and_closes_the_sync_generator():
    """Django 在客户端断开时取消任务:取消落在「同步线程正等着供应商」的那一步上。之后不能再发,
    而同步生成器必须在它自己的线程里被关掉(GeneratorExit → 存下已发出的部分、关掉供应商的流)。
    变异:删掉 `_async` finally 里的 `await step(events.close)` → 生成器没被关 → 红。"""
    stopped = []

    def events():
        try:
            yield {"event": "delta", "text": "一"}
            time.sleep(0.3)  # 同步线程在等供应商的下一段
            yield {"event": "delta", "text": "二"}
            yield {"event": "delta", "text": "三"}
        except GeneratorExit:
            stopped.append(True)
            raise

    gen = events()

    async def main():
        body = sse._async(b"meta", gen, contextvars.copy_context(), lambda e: e)
        got = []

        async def consume():
            async for chunk in body:
                got.append(chunk)

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.1)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return got

    got = asyncio.run(main())
    assert stopped == [True]
    assert b"".join(got).decode().count("event: delta") == 1


def test_asgi_gets_an_async_body_and_wsgi_a_sync_one():
    def events():
        yield {"event": "meta"}
        yield {"event": "delta", "text": "x"}

    asgi = sse.response(SimpleNamespace(scope={}), events(), lambda e: e)
    wsgi = sse.response(SimpleNamespace(), events(), lambda e: e)
    assert asgi.is_async and not wsgi.is_async
    assert b"".join(wsgi.streaming_content) == b'event: meta\ndata: {"event": "meta"}\n\nevent: delta\ndata: {"event": "delta", "text": "x"}\n\n'
