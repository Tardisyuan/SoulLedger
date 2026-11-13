"""业务模块 AI 接入点的离线桩供应商(`apps/soul_assist/features.py`)。

`StubProvider` 是 `FakeProvider` 的一个变体:回答由 `StubProvider.reply(system, facts, prompt)` 现算,好让一份
评测集里的每一条拿到各自的回答;`StubProvider.fail` 给了就抛它(模拟供应商不可用)。调用照样记进
`FakeProvider.calls`,测试据此断言送了什么、没送什么。不连任何网络。
"""
import pytest

from apps.soul_assist.providers import Answer, FakeProvider, ProviderError

PROVIDER = "tests.ai_feature_support.StubProvider"


class StubProvider(FakeProvider):
    reply = staticmethod(lambda system, facts, prompt: "")
    fail = None  # ProviderError 的 kind,如 "timeout"

    def answer(self, *, system, facts, history, tools, call_tool, max_rounds, deadline):
        self._record(system=system, facts=facts, history=history, tools=tools, max_rounds=max_rounds,
                     deadline=deadline)
        if type(self).fail:
            raise ProviderError("stub down", type(self).fail)
        return Answer(text=type(self).reply(system, facts, history[-1].text), usage={"input": 3, "output": 2})


@pytest.fixture(name="stub")
def stub_fixture(settings):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = PROVIDER
    FakeProvider.calls = []
    StubProvider.fail = None
    StubProvider.reply = staticmethod(lambda system, facts, prompt: "")
    yield StubProvider
    FakeProvider.calls = []
    StubProvider.fail = None


def enable(tenant, on=True):
    tenant.settings = {**(tenant.settings or {}), "assistant_enabled": on}
    tenant.save(update_fields=["settings"])
