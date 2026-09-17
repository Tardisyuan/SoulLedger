"""推送测试共用(不是测试文件,pytest 不收集)。**没有任何一条路径访问 Expo。**"""
import pytest

from apps.soul_push.expo import PushTransientError  # noqa: F401 — 测试从这里取

TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"
TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"


class FakeSender:
    """按 Expo 的形状回答。`script` 里放下一次 send 的行为:异常实例就抛,callable 就用它算 tickets。
    默认全部 ok。类属性记录调用 —— 每个测试由 `push_on` fixture 清零。"""

    batches: list = []
    receipt_calls: list = []
    script: list = []
    receipt_answers: dict = {}

    @classmethod
    def reset(cls):
        cls.batches, cls.receipt_calls, cls.script, cls.receipt_answers = [], [], [], {}

    def send(self, messages):
        FakeSender.batches.append(list(messages))
        behaviour = FakeSender.script.pop(0) if FakeSender.script else None
        if isinstance(behaviour, Exception):
            raise behaviour
        if callable(behaviour):
            return behaviour(messages)
        return [{"status": "ok", "id": f"ticket-{len(FakeSender.batches)}-{i}"} for i in range(len(messages))]

    def receipts(self, ids):
        FakeSender.receipt_calls.append(list(ids))
        return {i: FakeSender.receipt_answers[i] for i in ids if i in FakeSender.receipt_answers}


class ExplodingSender:
    """未启用推送时,发送端口根本不该被构造。"""

    def __init__(self):
        raise AssertionError("推送未启用却构造了发送端口")


@pytest.fixture
def enqueued(monkeypatch):
    """替掉入队,记下被入队的投递 id。"""
    from apps.soul_push import services

    calls = []
    monkeypatch.setattr(services, "enqueue", lambda ids: calls.append(list(ids)))
    return calls


@pytest.fixture
def push_on(settings):
    settings.SOUL_PUSH_ENABLED = True
    settings.SOUL_PUSH_SENDER = "tests.soul_push_support.FakeSender"
    FakeSender.reset()
    yield FakeSender
    FakeSender.reset()


def register(client, token=TOKEN_A, platform="IOS"):
    return client.post("/api/v1/me/push-tokens/", {"token": token, "platform": platform}, format="json")
