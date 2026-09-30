"""流式回答、改用备用与断路器(docs/ARCHITECTURE-soul-assist.md §13)—— 管道,全部离线。

供应商是 `FakeProvider`(按模型名各一套脚本:主用 `claude-opus-5`,备用 `backup-model`);两个真适配器的
流式翻译在 `test_assist_streaming_adapters.py`。
"""
import gc
import json

import pytest
from django.core.cache import cache

from apps.soul_assist import config, failover, service
from apps.soul_assist.models import AssistConfig, AssistConversation, AssistMessage, AssistUsage
from apps.soul_assist.providers import FakeProvider
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

ASK = "/api/v1/me/assist/"
PRIMARY = "claude-opus-5"
BACKUP = "backup-model"


@pytest.fixture(autouse=True)
def assistant_on(settings):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_MODEL = PRIMARY
    FakeProvider.script = [{"deltas": ["你", "好"]}]
    FakeProvider.scripts, FakeProvider.calls, FakeProvider.pulled = {}, [], []
    yield
    FakeProvider.script, FakeProvider.scripts, FakeProvider.calls, FakeProvider.pulled = [], {}, [], []


@pytest.fixture
def soul(cn_tenant):
    cn_tenant.settings = {**(cn_tenant.settings or {}), "assistant_enabled": True}
    cn_tenant.save(update_fields=["settings"])
    return ready_soul(cn_tenant)


def _backup(prices=None):
    """配一个备用(同样是 FakeProvider,模型名不同,脚本按模型名分开)。"""
    row, _ = AssistConfig.objects.get_or_create(pk=1)
    row.values = {**row.values, "backup": {"platform": "custom", "provider": "anthropic", "base_url": "",
                                           "model": BACKUP, "effort": "", "fallbacks": False,
                                           "prices": prices or {}}}
    row.save()
    config.invalidate()


@pytest.fixture
def fake_adapters(monkeypatch):
    monkeypatch.setitem(config.PROVIDERS, "anthropic", "apps.soul_assist.providers.FakeProvider")


def _events(response):
    """SSE 正文 → [(事件名, data)]。每个事件的 JSON 也带 `event`,与 `event:` 行一致。"""
    assert response["Content-Type"].startswith("text/event-stream")
    raw = b"".join(response.streaming_content).decode()
    out = []
    for block in raw.strip().split("\n\n"):
        name, data = block.split("\n")
        payload = json.loads(data.removeprefix("data: "))
        assert name == f"event: {payload['event']}"
        out.append((payload["event"], payload))
    return out


def _stream(client, **extra):
    return client.post(ASK, {"question": "怎么申请转生?", "screen": "applications", "stream": True, **extra},
                       format="json", HTTP_ACCEPT_LANGUAGE="zh-Hans")


def _inflight():
    return cache.get(service.INFLIGHT_KEY) or 0


# ── 事件序列 ──────────────────────────────────────────────────────────────


def test_the_stream_is_meta_then_deltas_then_done_and_stores_what_was_sent(soul):
    """变异:`sse.response` 不发 meta(从第二个事件开始)→ 红;done 的 conversation_id 与 meta 的不同 → 红。"""
    _, client = soul
    response = _stream(client)
    assert response.status_code == 200
    assert response["X-Accel-Buffering"] == "no" and response["Cache-Control"] == "no-cache"
    events = _events(response)
    assert [e for e, _ in events] == ["meta", "delta", "delta", "done"]
    meta, done = events[0][1], events[-1][1]
    assert "".join(d["text"] for e, d in events if e == "delta") == "你好"
    assert done["conversation_id"] == meta["conversation_id"]
    assert done["answer"]["content"] == "你好" and done["answer"]["interruption"] == ""
    assert done["usage"] == {"input_tokens": 1, "output_tokens": 1, "cache_read_tokens": 0}
    stored = AssistMessage.objects.get(role="assistant")
    assert (stored.content, stored.interruption, str(stored.conversation_id)) == ("你好", "", meta["conversation_id"])
    assert AssistUsage.objects.get().status == "ok"
    assert _inflight() == 0


def test_a_tool_round_is_not_streamed_only_the_text_is(soul):
    _, client = soul
    FakeProvider.script = [{"tools": ["me"]}, {"deltas": ["可", "以"]}]
    events = _events(_stream(client))
    assert [e for e, _ in events] == ["meta", "delta", "delta", "done"]
    blob = json.dumps([d for _, d in events], ensure_ascii=False)
    assert "home_civilization" not in blob and '"me"' not in blob  # 工具结果与工具名都不出去
    assert AssistMessage.objects.get(role="assistant").tool_calls == ["me"]


def test_the_officer_endpoint_streams_too(cn_tenant, django_user_model):
    cn_tenant.settings = {"assistant_enabled": True}
    cn_tenant.save(update_fields=["settings"])
    officer = django_user_model.objects.create_user(username="clerk", password="x", role="JUDGE", tenant=cn_tenant)
    response = officer_client(officer).post("/api/v1/assist/", {"question": "怎么派单?", "screen": "dispatch",
                                                                "stream": True}, format="json")
    assert [e for e, _ in _events(response)] == ["meta", "delta", "delta", "done"]


def test_without_the_flag_the_answer_is_the_same_json_as_before(soul):
    """非流式不变:一次 JSON,不是事件流。"""
    _, client = soul
    response = client.post(ASK, {"question": "q", "screen": "applications"}, format="json")
    assert response.status_code == 200 and response["Content-Type"] == "application/json"
    assert set(response.data) == {"conversation_id", "answer"} and response.data["answer"]["content"] == "你好"


def test_errors_before_the_stream_are_still_json_with_a_status(soul, settings):
    _, client = soul
    settings.ASSISTANT_MAX_CONCURRENT = 0
    busy = _stream(client)
    assert busy.status_code == 429 and busy.data["code"] == "assistant_busy"
    settings.ASSISTANT_MAX_CONCURRENT = 8
    missing = _stream(client, conversation_id="00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404 and missing.data["code"] == "not_found"
    assert _inflight() == 0


def test_an_empty_answer_streams_the_fixed_reply(soul):
    _, client = soul
    FakeProvider.script = [{"deltas": ["  "]}]
    events = _events(_stream(client))
    texts = [d["text"] for e, d in events if e == "delta"]
    assert texts[-1] == service.EMPTY_ANSWER["zh-Hans"]
    assert events[-1][1]["answer"]["content"] == service.EMPTY_ANSWER["zh-Hans"]
    assert AssistUsage.objects.get().status == "empty"


# ── 停止 / 断开 ───────────────────────────────────────────────────────────


def test_closing_the_stream_stops_the_provider_and_stores_the_partial_as_stopped(soul):
    """客户端关流 = 停止。变异:删掉 `_run` 里的 `except GeneratorExit: out.finish("stopped")` → 什么都不存 → 红。"""
    _, client = soul
    FakeProvider.script = [{"deltas": ["一", "二", "三", "四"]}]
    response = _stream(client)
    chunks = iter(response.streaming_content)
    assert b"event: meta" in next(chunks)
    assert "一" in next(chunks).decode()
    # 客户端断开。测试客户端把正文包在 `closing_iterator_wrapper` 里(`response._iterator`),关它就是关流:
    # 它摘掉 close_old_connections 再调 response.close() → 关掉 SSE 的生成器。直接调 response.close() 不行:
    # 那个包装的 finally 会先把 close_old_connections 接回去,随后 request_finished 在 PostgreSQL 上关掉本测试
    # 事务的连接(SQLite 内存库不关,所以只在真 PG 上红过)。
    response._iterator.close()

    assert FakeProvider.pulled == ["一"]  # 停下之后供应商不再被拉取
    stored = AssistMessage.objects.get(role="assistant")
    assert (stored.content, stored.interruption) == ("一", "stopped")
    row = AssistUsage.objects.get()
    assert (row.status, row.input_tokens, row.output_tokens) == ("stopped", 1, 1)
    assert _inflight() == 0


def test_a_stream_dropped_before_it_is_read_releases_the_slot_and_stores_nothing(soul):
    """响应头之前客户端就走了:生成器只走到 meta,从没被迭代;回收时关掉,名额还回来,没花钱不记账。"""
    account, _ = soul
    events = service.answer(account, "q", "applications", locale="zh-Hans", stream=True)
    assert next(events)["event"] == "meta"
    assert _inflight() == 1
    del events
    gc.collect()
    assert _inflight() == 0
    assert not AssistMessage.objects.exists() and not AssistUsage.objects.exists()


# ── 出错 ─────────────────────────────────────────────────────────────────


def test_a_failure_before_any_text_is_an_unavailable_error_and_stores_nothing(soul):
    _, client = soul
    FakeProvider.script = [{"raise": "down", "kind": "auth", "status": 401}]
    events = _events(_stream(client))
    assert [e for e, _ in events] == ["meta", "error"]
    assert events[1][1] == {"event": "error", "kind": "unavailable", "text_sent": False,
                            "detail": service.UNAVAILABLE_DETAIL}
    assert not AssistMessage.objects.exists()
    assert AssistUsage.objects.get().status == "unavailable"
    assert _inflight() == 0


def test_a_failure_after_text_is_interrupted_keeps_the_text_and_does_not_switch(soul, fake_adapters):
    """出过字以后不改用备用。变异:切换条件去掉 `not out.sent` → 备用被调、两段回答拼在一起 → 红。"""
    _, client = soul
    _backup()
    FakeProvider.script = [{"deltas": ["半"], "more": True}, {"raise": "reset", "kind": "connection"}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["备用"]}]}
    events = _events(_stream(client))
    assert [e for e, _ in events] == ["meta", "delta", "error"]
    error = events[-1][1]
    assert (error["kind"], error["text_sent"]) == ("interrupted", True)
    stored = AssistMessage.objects.get(role="assistant")
    assert (stored.content, stored.interruption, stored.pk) == ("半", "interrupted", error["message_id"])
    assert [c["model"] for c in FakeProvider.calls] == [PRIMARY]
    assert AssistUsage.objects.get().status == "interrupted"
    assert _inflight() == 0


# ── 改用备用 ──────────────────────────────────────────────────────────────

SWITCHING = [("connection", None, "connection"), ("timeout", None, "timeout"), ("rate_limited", 429, "rate_limited"),
             ("other", 500, "server_error"), ("other", 529, "server_error"), ("other", 402, "quota")]


@pytest.mark.parametrize("kind,status,reason", SWITCHING)
def test_a_primary_failure_before_text_switches_to_the_backup(soul, fake_adapters, kind, status, reason):
    _, client = soul
    _backup()
    FakeProvider.script = [{"raise": "x", "kind": kind, "status": status}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["备", "用"]}]}
    events = _events(_stream(client))
    assert [e for e, _ in events] == ["meta", "delta", "delta", "done"]
    assert events[-1][1]["answer"]["content"] == "备用"
    assert [c["model"] for c in FakeProvider.calls] == [PRIMARY, BACKUP]
    row = AssistUsage.objects.get()
    assert (row.status, row.model, row.provider_role, row.fallback_reason) == ("ok", BACKUP, "backup", reason)


@pytest.mark.parametrize("kind,status", [("auth", 401), ("auth", 403), ("model_not_found", 404),
                                         ("tools_unsupported", 400), ("other", 400), ("other", None)])
def test_config_errors_do_not_switch(soul, fake_adapters, kind, status):
    """401 / 404 / 不支持工具 / 配置错误:备用救不了,也不该把错误藏起来。"""
    _, client = soul
    _backup()
    FakeProvider.script = [{"raise": "x", "kind": kind, "status": status}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["备用"]}]}
    events = _events(_stream(client))
    assert [e for e, _ in events] == ["meta", "error"]
    assert [c["model"] for c in FakeProvider.calls] == [PRIMARY]
    assert failover.failures(config.effective().connection) == 0


def test_the_non_streaming_path_switches_too(soul, fake_adapters):
    _, client = soul
    _backup()
    FakeProvider.script = [{"raise": "x", "kind": "other", "status": 503}]
    FakeProvider.scripts = {BACKUP: [{"text": "备用答"}]}
    response = client.post(ASK, {"question": "q", "screen": "applications"}, format="json")
    assert response.status_code == 200 and response.data["answer"]["content"] == "备用答"


def test_without_a_backup_nothing_changes(soul):
    """没配备用:与之前一样 503 / error,首字截止就是整整 22 秒,不数断路器。"""
    _, client = soul
    FakeProvider.script = [{"raise": "x", "kind": "connection"}]
    assert client.post(ASK, {"question": "q", "screen": "applications"}, format="json").status_code == 503
    assert failover.failures(config.effective().connection) == 0


def test_tokens_the_primary_spent_before_failing_are_booked_to_the_primary(soul, fake_adapters):
    _, client = soul
    _backup()
    FakeProvider.script = [{"tools": ["me"]}, {"raise": "x", "kind": "timeout"}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["好"]}]}
    _events(_stream(client))
    rows = {r.status: r for r in AssistUsage.objects.all()}
    assert set(rows) == {"failed_over", "ok"}
    assert (rows["failed_over"].provider_role, rows["failed_over"].model) == ("primary", PRIMARY)
    assert rows["ok"].provider_role == "backup"


# ── 截止时刻 ──────────────────────────────────────────────────────────────


def test_deadlines_first_token_and_total_with_and_without_a_backup(soul, fake_adapters, monkeypatch, settings):
    """没有备用:首字 22、总 60。有备用:主用首字 12,备用首字仍是 22,总 60。非流式:22(有备用时主用 12)。
    变异:主用不设 12 秒上限 → 红。"""
    now = [100.0]
    monkeypatch.setattr(service.time, "monotonic", lambda: now[0])
    account, client = soul
    _events(_stream(client))
    call = FakeProvider.calls[-1]
    assert (call["first_token_deadline"], call["deadline"]) == (122.0, 160.0)

    _backup()
    FakeProvider.script = [{"raise": "x", "kind": "timeout"}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["好"]}]}
    FakeProvider.calls = []
    _events(_stream(client))
    primary, backup = FakeProvider.calls
    assert (primary["first_token_deadline"], primary["deadline"]) == (112.0, 160.0)
    assert (backup["first_token_deadline"], backup["deadline"]) == (122.0, 160.0)

    FakeProvider.calls = []
    client.post(ASK, {"question": "q", "screen": "applications"}, format="json")
    assert [c["deadline"] for c in FakeProvider.calls] == [112.0, 122.0]


# ── 断路器 ────────────────────────────────────────────────────────────────


def test_the_breaker_opens_after_three_failures_and_half_opens_after_sixty_seconds(soul, fake_adapters, monkeypatch):
    """变异:THRESHOLD 判断写成 `>`(第 4 次才开)→ 第四问仍调主用 → 红;打开时把计数清零 → 半开那次失败
    不会立刻再断开 → 红。"""
    clock = [1000.0]
    monkeypatch.setattr(failover.time, "time", lambda: clock[0])
    _, client = soul
    _backup()
    FakeProvider.script = [{"raise": "x", "kind": "connection"}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["备"]}]}

    def ask():
        FakeProvider.calls = []
        _events(_stream(client))
        return [c["model"] for c in FakeProvider.calls]

    assert ask() == [PRIMARY, BACKUP]
    assert ask() == [PRIMARY, BACKUP]
    assert ask() == [PRIMARY, BACKUP]
    assert ask() == [BACKUP]  # 开着:主用不试
    assert AssistUsage.objects.order_by("-id").first().fallback_reason == "circuit_open"
    clock[0] += 59
    assert ask() == [BACKUP]
    clock[0] += 2  # 过了 60 秒:半开,再试主用
    assert ask() == [PRIMARY, BACKUP]
    assert ask() == [BACKUP]  # 半开那次失败 → 立刻又断开
    clock[0] += 61
    FakeProvider.script = [{"deltas": ["主"]}]
    assert ask() == [PRIMARY]  # 主用好了:清零
    assert failover.failures(config.effective().connection) == 0
    FakeProvider.script = [{"raise": "x", "kind": "connection"}]
    assert ask() == [PRIMARY, BACKUP]  # 重新从 1 数起,不是立刻断开


# ── 花费归属 ──────────────────────────────────────────────────────────────


def test_the_backup_is_priced_with_its_own_prices_and_counts_toward_the_cap(soul, fake_adapters):
    from apps.soul_assist import usage

    _, client = soul
    _backup(prices={BACKUP: {"input": 1_000_000, "output": 0}})  # 每 token 1 元,FakeProvider 用 1 个输入 token
    row = AssistConfig.objects.get(pk=1)
    row.values = {**row.values, "prices": {PRIMARY: {"input": 3_000_000, "output": 0}}}
    row.save()
    config.invalidate()
    _events(_stream(client))  # 主用答:3
    FakeProvider.script = [{"raise": "x", "kind": "rate_limited", "status": 429}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["备"]}]}
    _events(_stream(client))  # 备用答:1

    eff = config.effective()
    prices = usage.Prices(eff.prices, eff.backup_prices)
    report = usage.report(prices)
    by_role = {p["role"]: p for p in report["by_provider"]}
    assert (by_role["primary"]["cost"], by_role["backup"]["cost"]) == (3.0, 1.0)
    assert report["spent"] == 4.0 == usage.month_spend(prices)["cost"]
    assert report["fallbacks"]["count"] == 1 and report["fallbacks"]["by_reason"]["rate_limited"] == 1
    # 只按主用的价目表算:备用那一行是「未定价」,不是 3 元
    assert usage.month_spend(eff.prices)["unpriced_models"] == [BACKUP]


def test_fallbacks_count_only_what_the_backup_answered_and_by_day_splits_the_roles(soul, fake_adapters):
    """Design 7a:「只统计由备用成功答出的提问。备用也失败的算作失败,不计入这一行。」"""
    from apps.soul_assist import usage

    _, client = soul
    _backup(prices={BACKUP: {"input": 1_000_000, "output": 0}})
    row = AssistConfig.objects.get(pk=1)
    row.values = {**row.values, "prices": {PRIMARY: {"input": 3_000_000, "output": 0}}}
    row.save()
    config.invalidate()
    _events(_stream(client))  # 主用答:3
    FakeProvider.script = [{"raise": "x", "kind": "rate_limited", "status": 429}]
    FakeProvider.scripts = {BACKUP: [{"deltas": ["备"]}]}
    _events(_stream(client))  # 备用答:1
    FakeProvider.script = [{"raise": "x", "kind": "connection"}]
    FakeProvider.scripts = {BACKUP: [{"raise": "y", "kind": "connection"}]}
    assert _events(_stream(client))[-1][1]["kind"] == "unavailable"  # 主、备都失败
    assert AssistUsage.objects.filter(provider_role="backup", status="unavailable", fallback_reason="connection").exists()

    eff = config.effective()
    report = usage.report(usage.Prices(eff.prices, eff.backup_prices))
    assert report["fallbacks"]["count"] == 1
    assert report["fallbacks"]["by_reason"]["rate_limited"] == 1 and report["fallbacks"]["by_reason"]["connection"] == 0
    [day] = report["by_day"]
    assert (day["primary_cost"], day["backup_cost"], day["cost"]) == (3.0, 1.0, 4.0)
    assert day["fallbacks"] == 1 and day["fallback_reasons"]["rate_limited"] == 1
    assert day["fallback_reasons"]["connection"] == 0


def test_a_day_without_the_backup_has_no_backup_cost(db):
    from datetime import timedelta

    from django.utils import timezone

    from apps.soul_assist import usage

    usage.record("soul", None, "ok", PRIMARY, {"input": 1}, provider_role="primary")
    usage.record("soul", None, "ok", BACKUP, {"input": 1}, provider_role="backup", fallback_reason="timeout")
    now = timezone.localtime()
    other = now - timedelta(days=1) if now.day > 1 else now + timedelta(days=1)
    AssistUsage.objects.filter(provider_role="primary").update(created_at=other)
    prices = usage.Prices({PRIMARY: {"input": 1_000_000, "output": 0}}, {BACKUP: {"input": 2_000_000, "output": 0}})
    days = {d["date"]: d for d in usage.report(prices)["by_day"]}
    quiet, busy = days[other.date()], days[now.date()]
    assert (quiet["primary_cost"], quiet["backup_cost"], quiet["fallbacks"]) == (1.0, 0.0, 0)
    assert not any(quiet["fallback_reasons"].values())
    assert (busy["primary_cost"], busy["backup_cost"], busy["fallbacks"]) == (0.0, 2.0, 1)
    assert busy["fallback_reasons"]["timeout"] == 1


# ── 名额 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("script", [
    [{"deltas": ["好"]}],
    [{"raise": "x", "kind": "auth"}],
    [{"deltas": ["半"], "more": True}, {"raise": "x", "kind": "connection"}],
])
def test_the_slot_is_released_on_every_ending(soul, script):
    _, client = soul
    FakeProvider.script = script
    _events(_stream(client))
    assert _inflight() == 0


def test_the_slot_is_held_for_the_whole_stream(soul):
    account, _ = soul
    FakeProvider.script = [{"deltas": ["一", "二"]}]
    events = service.answer(account, "q", "applications", locale="zh-Hans", stream=True)
    seen = []
    for event in events:
        seen.append((event["event"], _inflight()))
    assert seen == [("meta", 1), ("delta", 1), ("delta", 1), ("done", 1)]
    assert _inflight() == 0


def test_a_continued_conversation_is_announced_in_meta(soul):
    _, client = soul
    first = _events(_stream(client))[-1][1]["conversation_id"]
    again = _events(_stream(client))
    assert again[0][1]["conversation_id"] == first == again[-1][1]["conversation_id"]
    assert AssistConversation.objects.count() == 1
