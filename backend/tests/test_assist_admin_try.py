"""§3.3 试问:`POST /api/v1/assist-admin/try/`(docs/ARCHITECTURE-assist-admin.md)。

以配置里的评测身份问一句,走正式的 `service.ask`:数据范围、审计照常;会话与用量都标 `is_eval`
(不进本人列表、不计用量与月度上限)。全部离线,供应商是 `FakeProvider`。
"""
import json

import pytest
from cryptography.fernet import Fernet
from django.core.cache import cache

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.soul_accounts.models import SoulAccount
from apps.soul_assist import admin_views, config
from apps.soul_assist.models import AssistConversation, AssistUsage
from apps.soul_assist.providers import FakeProvider
from tests.soul_account_support import officer_client, ready_soul, soul_client

pytestmark = pytest.mark.django_db

URL = "/api/v1/assist-admin/try/"
KEY = "sk-live-THE-SECRET-VALUE-1234"
NEW_KEY = "sk-candidate-OTHER-SECRET-5678"


class OtherFake(FakeProvider):
    """「另一家供应商」:测试里不许真的连外网。"""


@pytest.fixture(autouse=True)
def assistant_on(settings, monkeypatch):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_MODEL = "env-model"
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    for name in config.PROVIDERS:
        monkeypatch.setitem(config.PROVIDERS, name, f"{__name__}.OtherFake")
    FakeProvider.script = [{"text": "好的。"}]
    FakeProvider.calls = []
    cache.clear()  # 节流计数
    yield
    FakeProvider.script = []
    FakeProvider.calls = []


@pytest.fixture
def admin(cn_tenant):
    return User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=None)


@pytest.fixture
def api(admin):
    return officer_client(admin)


@pytest.fixture
def ids(api):
    return api.post("/api/v1/assist-admin/eval/identities/").data


def _try(api, **body):
    return api.post(URL, body, format="json", HTTP_ACCEPT_LANGUAGE="zh-Hans")


def test_the_soul_side_asks_as_the_eval_soul_and_is_marked_eval_everywhere(api, ids, cn_tenant):
    """变异:`try_question` 不传 `is_eval` → 用量记成正式、会话进本人列表,红。"""
    FakeProvider.script = [{"tools": ["rebirth"]}, {"text": "可以申诉。"}]
    res = _try(api, side="soul", question="我为什么不能申请?")
    assert res.status_code == 200, res.data
    assert res.data["answer"] == "可以申诉。" and res.data["tools_called"] == ["rebirth"]
    assert isinstance(res.data["latency_ms"], int) and res.data["tokens"] == {"input": 1, "output": 1}
    assert (res.data["side"], res.data["model"]) == ("soul", "env-model")
    # 工具只给名字:结果(灵魂的数据)不在响应里
    assert set(res.data) == {"side", "answer", "tools_called", "retrieval", "retrieved_entries", "latency_ms", "tokens",
                             "provider", "model", "provider_role", "fallback_reason"}
    assert (res.data["provider_role"], res.data["fallback_reason"]) == ("primary", None)
    account = SoulAccount.objects.get(pk=ids["eval_soul_account"])
    assert AssistConversation.objects.filter(account=account, is_eval=True).count() == 1
    assert not AssistConversation.objects.filter(is_eval=False).exists()
    assert soul_client(account).get("/api/v1/me/assist/conversations/").data == []
    assert list(AssistUsage.objects.values_list("is_eval", flat=True)) == [True]
    assert api.get("/api/v1/assist-admin/usage/").data["requests"] == 0
    row = AuditLog.objects.get(resource="assistant", description="assistant answer")
    assert row.user == account.user and row.changes["eval"] is True
    assert "我为什么不能申请" not in json.dumps(row.changes, ensure_ascii=False)


def test_the_officer_side_asks_as_the_eval_officer_with_its_own_scope(api, ids, cn_tenant, eu_tenant):
    from apps.judgment.models import Judgment
    from apps.souls.models import Soul, SoulState

    for tenant in (cn_tenant, eu_tenant, eu_tenant):
        soul = Soul.objects.create(name="x", tenant=tenant, current_state=SoulState.JUDGING)
        Judgment.objects.create(soul=soul, civilization=soul.civilization, court="一", tenant=tenant,
                                evidence_json={})
    FakeProvider.script = [{"tools": ["judgment_queue_counts"]}, {"text": "一件。"}]
    res = _try(api, side="officer", question="队列里有几件?")
    assert res.status_code == 200, res.data
    assert res.data["tools_called"] == ["judgment_queue_counts"]
    counts = FakeProvider.script[0]["results"][0]
    assert counts["scope"] == "this_hall" and counts["total"] == 1  # 评测官员是 CN 的:看不到 EU 的两件
    assert AssistConversation.objects.get(is_eval=True).user_id == ids["eval_officer"]


def test_a_missing_identity_is_a_named_400_and_nothing_is_asked(api):
    """变异:删掉缺身份的检查 → 500 而不是具名的 400,红。"""
    for side in ("soul", "officer"):
        res = _try(api, side=side, question="Q")
        assert res.status_code == 400 and res.data["code"] == f"no_eval_{side}"
    assert FakeProvider.calls == [] and not AssistUsage.objects.exists()


def test_a_deactivated_identity_is_missing_too(api, ids):
    User.objects.filter(pk=ids["eval_officer"]).update(is_active=False)
    assert _try(api, side="officer", question="Q").data["code"] == "no_eval_officer"
    assert _try(api, side="soul", question="Q").status_code == 200


def test_a_candidate_is_used_and_its_key_never_leaks(api, ids):
    """候选配置发给供应商;候选的 key 与已存的 key 都不在响应与审计里(断言缺席)。"""
    res = _try(api, side="soul", question="Q", candidate={"model": "cand-b", "api_key": NEW_KEY})
    assert res.status_code == 200 and res.data["model"] == "cand-b"
    assert [c["model"] for c in FakeProvider.calls] == ["cand-b"]
    for text in (json.dumps(res.data), json.dumps(list(AuditLog.objects.values("changes", "description")),
                                                  ensure_ascii=False, default=str)):
        assert NEW_KEY not in text and KEY not in text
    assert config.effective().connection.model == "env-model"  # 试问不保存候选


def test_a_candidate_moving_the_endpoint_needs_the_key(api, ids):
    """与连通测试、预估同一条规则:已存的 key 不发往新地址。"""
    res = _try(api, side="soul", question="Q", candidate={"base_url": "https://attacker.example/v1"})
    assert res.status_code == 400 and res.data["code"] == "api_key_required"
    assert FakeProvider.calls == []


def test_a_provider_failure_is_a_503_recorded_as_eval(api, ids):
    FakeProvider.script = [{"raise": "down", "kind": "connection"}]
    res = _try(api, side="soul", question="Q")
    assert res.status_code == 503 and res.data["code"] == "assistant_unavailable"
    assert list(AssistUsage.objects.values_list("status", "is_eval")) == [("unavailable", True)]


@pytest.mark.parametrize("role", ["MODERATOR", "JUDGE", "VIEWER"])
def test_only_the_admin_may_try(cn_tenant, ids, role):
    user = User.objects.create_user(username=f"u-{role}", password="x", role=role, tenant=cn_tenant)
    assert officer_client(user).post(URL, {"side": "soul", "question": "Q"}, format="json").status_code == 403
    _, soul = ready_soul(cn_tenant)
    assert soul.post(URL, {"side": "soul", "question": "Q"}, format="json").status_code == 403
    assert FakeProvider.calls == []


def test_tries_are_throttled_per_admin(api, ids, monkeypatch):
    """变异:去掉 `throttle_classes` → 第三次仍是 200,红。"""
    monkeypatch.setattr(admin_views.TryThrottle, "rate", "2/hour")
    assert [_try(api, side="soul", question="Q").status_code for _ in range(2)] == [200, 200]
    res = _try(api, side="soul", question="Q")
    assert res.status_code == 429 and res.data["code"] == "rate_limited"
    assert len(FakeProvider.calls) == 2


def test_the_switches_are_not_consulted(api, ids):
    """与评测一样:管理员要在打开之前先试。"""
    api.patch("/api/v1/assist-admin/config/", {"enabled": False}, format="json")
    assert _try(api, side="soul", question="Q").status_code == 200
