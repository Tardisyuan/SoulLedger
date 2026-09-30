"""两个真适配器的格式翻译(docs/ARCHITECTURE-soul-assist.md §3)。

注入假的 SDK 客户端,断言发出去的请求体与对响应的解析 —— 翻译层是最容易错的地方,
而 `FakeProvider` 完全绕过它。不发任何网络请求。
"""
import copy
import json
import time
from types import SimpleNamespace

import anthropic
import httpx2
import openai
import pytest

from apps.soul_assist.providers import AnthropicProvider, OpenAICompatibleProvider, ProviderError, ToolSpec, Turn

TOOLS = [ToolSpec("me", "me"), ToolSpec("rebirth", "rebirth")]
HISTORY = [Turn("user", "前一问"), Turn("assistant", "前一答"), Turn("user", "这一问")]


class FakeClient:
    """录下每次调用的参数,按脚本返回。`with_options` 记下 timeout 并返回自己。"""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.timeouts = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._beta_create))

    def with_options(self, timeout):
        self.timeouts.append(timeout)
        return self

    def _create(self, **params):
        self.requests.append(copy.deepcopy(params))  # 真 SDK 在调用时就序列化了请求体
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def _beta_create(self, **params):
        return self._create(beta=True, **params)


def _run(provider, calls):
    return provider.answer(system="SYSTEM", facts="FACTS", history=HISTORY, tools=TOOLS,
                           call_tool=lambda name: calls.append(name) or json.dumps({"tool": name}),
                           max_rounds=3, deadline=time.monotonic() + 20)


# ── OpenAI 兼容 ─────────────────────────────────────────────────────────


def _oa(content=None, tool_calls=None):
    message = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2))


def _oa_call(id_, name):
    return SimpleNamespace(id=id_, function=SimpleNamespace(name=name, arguments="{}"))


def test_openai_tool_round_then_text(settings):
    settings.ASSISTANT_MODEL = "gpt-x"
    client = FakeClient([_oa(tool_calls=[_oa_call("c1", "rebirth")]), _oa(content="答")])
    calls = []
    result = _run(OpenAICompatibleProvider(client), calls)

    assert result.text == "答" and result.tool_calls == ["rebirth"] and calls == ["rebirth"]
    assert result.usage == {"input": 20, "output": 4}
    first, second = client.requests
    assert first["model"] == "gpt-x" and first["tool_choice"] == "auto"
    assert [m["role"] for m in first["messages"]] == ["system", "system", "user", "assistant", "user"]
    assert first["tools"][0]["function"]["parameters"]["properties"] == {}
    tool_msg = second["messages"][-1]
    assert tool_msg == {"role": "tool", "tool_call_id": "c1", "content": json.dumps({"tool": "rebirth"})}
    assert second["messages"][-2]["tool_calls"][0]["id"] == "c1"
    assert all(0 < t <= 20 for t in client.timeouts)


def test_openai_last_round_forbids_tools():
    client = FakeClient([_oa(tool_calls=[_oa_call(f"c{i}", "me")]) for i in range(3)] + [_oa(content="完")])
    result = _run(OpenAICompatibleProvider(client), [])
    assert result.text == "完" and result.tool_calls == ["me"] * 3
    assert [r["tool_choice"] for r in client.requests] == ["auto", "auto", "auto", "none"]


def test_deepseek_gets_thinking_mode_off_and_others_get_nothing_extra():
    from apps.soul_assist.config import Connection

    def conn(base_url):
        return Connection(provider="apps.soul_assist.providers.OpenAICompatibleProvider", base_url=base_url,
                          api_key="k", model="deepseek-flash", effort="", fallbacks="")

    deepseek = FakeClient([_oa(tool_calls=[_oa_call("c1", "me")]), _oa(content="答")])
    _run(OpenAICompatibleProvider(deepseek, conn=conn("https://api.deepseek.com")), [])
    assert [r.get("extra_body") for r in deepseek.requests] == [{"thinking": {"type": "disabled"}}] * 2

    other = FakeClient([_oa(content="答")])
    _run(OpenAICompatibleProvider(other, conn=conn("https://api.openai.com/v1")), [])
    assert "extra_body" not in other.requests[0]


def test_openai_errors_become_provider_errors():
    request = httpx2.Request("POST", "http://example.invalid")
    client = FakeClient([openai.APITimeoutError(request=request)])
    with pytest.raises(ProviderError):
        _run(OpenAICompatibleProvider(client), [])


# ── Anthropic ───────────────────────────────────────────────────────────


def _an(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=list(blocks),
              usage=SimpleNamespace(input_tokens=10, output_tokens=2, cache_read_input_tokens=7))


def _text(t):
    return SimpleNamespace(type="text", text=t)


def _use(id_, name):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input={})


def test_anthropic_tool_round_then_text(settings):
    settings.ASSISTANT_MODEL = "claude-opus-5"
    settings.ASSISTANT_EFFORT = "low"
    settings.ASSISTANT_ANTHROPIC_FALLBACKS = ""
    thinking = SimpleNamespace(type="thinking", thinking="")
    tool_turn = _an("tool_use", thinking, _use("u1", "sentence_plan"))
    client = FakeClient([tool_turn, _an("end_turn", _text("受刑中。"))])
    calls = []
    result = _run(AnthropicProvider(client), calls)

    assert result.text == "受刑中。" and result.tool_calls == ["sentence_plan"]
    assert result.usage == {"input": 20, "output": 4, "cache_read": 14}
    first, second = client.requests
    assert "beta" not in first
    assert first["output_config"] == {"effort": "low"}
    # 语料在缓存前缀,事实头在断点之后(§4.4)。
    assert first["system"] == [{"type": "text", "text": "SYSTEM", "cache_control": {"type": "ephemeral"}},
                               {"type": "text", "text": "FACTS"}]
    assert first["tools"][0]["input_schema"]["properties"] == {}
    # 整段 assistant 内容(含 thinking 块)原样送回,工具结果放在一条 user 消息里。
    assert second["messages"][-2] == {"role": "assistant", "content": tool_turn.content}
    assert second["messages"][-1] == {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "u1", "content": json.dumps({"tool": "sentence_plan"})}]}


def test_anthropic_fallbacks_go_through_the_beta_endpoint(settings):
    settings.ASSISTANT_ANTHROPIC_FALLBACKS = "default"
    client = FakeClient([_an("end_turn", _text("好"))])
    _run(AnthropicProvider(client), [])
    request = client.requests[0]
    assert request["beta"] is True and request["fallbacks"] == "default"
    assert request["betas"] == ["server-side-fallback-2026-07-01"]


def test_anthropic_refusal_yields_empty_text_not_an_error(settings):
    settings.ASSISTANT_ANTHROPIC_FALLBACKS = ""
    client = FakeClient([_an("refusal")])
    assert _run(AnthropicProvider(client), []).text == ""


def test_anthropic_last_round_forbids_tools(settings):
    settings.ASSISTANT_ANTHROPIC_FALLBACKS = ""
    client = FakeClient([_an("tool_use", _use(f"u{i}", "me")) for i in range(3)] + [_an("end_turn", _text("完"))])
    assert _run(AnthropicProvider(client), []).tool_calls == ["me"] * 3
    assert [r["tool_choice"] for r in client.requests] == [{"type": "auto"}] * 3 + [{"type": "none"}]


def test_anthropic_errors_become_provider_errors(settings):
    settings.ASSISTANT_ANTHROPIC_FALLBACKS = ""
    request = httpx2.Request("POST", "http://example.invalid")
    client = FakeClient([anthropic.APIConnectionError(request=request)])
    with pytest.raises(ProviderError):
        _run(AnthropicProvider(client), [])


def test_a_passed_deadline_fails_before_any_request():
    client = FakeClient([_oa(content="不该到这")])
    with pytest.raises(ProviderError):
        OpenAICompatibleProvider(client).answer(system="S", facts="F", history=HISTORY, tools=TOOLS,
                                                call_tool=lambda n: "{}", max_rounds=3,
                                                deadline=time.monotonic() - 1)
    assert client.requests == []


def test_openai_validation_errors_and_empty_choices_become_provider_errors():
    """未被接住的 SDK 异常会成 500,而 500 会把原文带进 Sentry(审查 2)。"""
    request = httpx2.Request("POST", "http://example.invalid")
    response = httpx2.Response(200, request=request)
    bad = openai.APIResponseValidationError(response=response, body=None)
    with pytest.raises(ProviderError):
        _run(OpenAICompatibleProvider(FakeClient([bad])), [])
    empty = SimpleNamespace(choices=[], usage=None)
    with pytest.raises(ProviderError):
        _run(OpenAICompatibleProvider(FakeClient([empty])), [])


def test_without_tools_neither_adapter_sends_tools_or_tool_choice(settings):
    """连通测试在平台拒收工具时不带工具再发一次:OpenAI 拒收空的 `tools` 数组,Anthropic 不许只给
    `tool_choice`。变异:任一适配器改回无条件带 `tools=specs` → 红。"""
    settings.ASSISTANT_ANTHROPIC_FALLBACKS = ""

    def plain(provider):
        return provider.answer(system="S", facts="F", history=HISTORY, tools=[], call_tool=lambda n: "{}",
                               max_rounds=1, deadline=time.monotonic() + 20)

    oa = FakeClient([_oa(content="OK")])
    assert plain(OpenAICompatibleProvider(oa)).text == "OK"
    an = FakeClient([_an("end_turn", _text("OK"))])
    assert plain(AnthropicProvider(an)).text == "OK"
    for request in oa.requests + an.requests:
        assert "tools" not in request and "tool_choice" not in request
