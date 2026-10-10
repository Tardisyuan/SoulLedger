"""助手管理页「供应商」区块:平台预设、获取模型、参考价、测试时探测工具(设计稿 provider-platforms,2026-09-30)。

全部离线:出网的 `platforms._get` 在根 conftest 里被换成「连不上」,要响应的测试自己装假的;
供应商是 `FakeProvider` 一族。
"""
import pytest
import requests
from cryptography.fernet import Fernet

from apps.authentication.models import User
from apps.soul_assist import config, platforms
from apps.soul_assist.providers import Answer, FakeProvider, ProviderError
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

BASE = "/api/v1/assist-admin/"
KEY = "sk-live-THE-SAVED-KEY-5678"


@pytest.fixture(autouse=True)
def assistant_on(settings):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_MODEL = "env-model"
    settings.ASSISTANT_BASE_URL = ""
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    FakeProvider.script = [{"text": "OK"}]
    FakeProvider.calls = []
    yield
    FakeProvider.script = []
    FakeProvider.calls = []


@pytest.fixture
def api(cn_tenant):
    return officer_client(User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=None))


class Resp:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


@pytest.fixture
def net(monkeypatch):
    """装一个假的 `_get`:按 URL 前缀给响应,记下每次请求(URL 与请求头)。"""
    calls, routes = [], {}

    def fake(url, headers, timeout):
        calls.append({"url": url, "headers": dict(headers), "timeout": timeout})
        for prefix, answer in routes.items():
            if url.startswith(prefix):
                if isinstance(answer, Exception):
                    raise answer
                return answer
        raise requests.ConnectionError(url)

    monkeypatch.setattr(platforms, "_get", fake)
    return calls, routes


def _save_key(api):
    assert api.post(f"{BASE}config/test/", {"api_key": KEY}, format="json").data["ok"] is True
    assert api.patch(f"{BASE}config/", {"api_key": KEY}, format="json").status_code == 200


def _models(api, **body):
    return api.post(f"{BASE}config/models/", body, format="json")


# ── 预设表 ──────────────────────────────────────────────────────────────────


def test_the_preset_table_is_the_verified_one():
    """钉住读过文档的那张表(platforms.py 顶部注释):地址或适配器被改动,要连同文档一起重读。"""
    assert {pid: (p.provider, p.base_url, p.tools, p.needs_key) for pid, p in platforms.PLATFORMS.items()} == {
        "deepseek": ("openai_compatible", "https://api.deepseek.com", "yes", True),
        "openai": ("openai_compatible", "https://api.openai.com/v1", "yes", True),
        "anthropic": ("anthropic", "https://api.anthropic.com", "yes", True),
        "qwen": ("openai_compatible", "https://dashscope.aliyuncs.com/compatible-mode/v1", "yes", True),
        "kimi": ("openai_compatible", "https://api.moonshot.cn/v1", "yes", True),
        "glm": ("openai_compatible", "https://open.bigmodel.cn/api/paas/v4", "yes", True),
        "doubao": ("openai_compatible", "https://ark.cn-beijing.volces.com/api/v3", "model", True),
        "gemini": ("openai_compatible", "https://generativelanguage.googleapis.com/v1beta/openai", "yes", True),
        "siliconflow": ("openai_compatible", "https://api.siliconflow.cn/v1", "model", True),
        "openrouter": ("openai_compatible", "https://openrouter.ai/api/v1", "model", True),
        "ollama": ("openai_compatible", "http://localhost:11434/v1", "model", False),
        "custom": (None, None, "model", True),
    }
    assert all(p.provider in config.PROVIDERS for pid, p in platforms.PLATFORMS.items() if pid != "custom")


def test_the_config_lists_the_presets_and_recognises_the_current_one(api, settings):
    body = api.get(f"{BASE}config/").data
    assert [p["id"] for p in body["platforms"]] == list(platforms.PLATFORMS)
    assert body["platform"] == "custom"  # FakeProvider + 空地址不是任何预设
    settings.ASSISTANT_PROVIDER = config.PROVIDERS["openai_compatible"]
    settings.ASSISTANT_BASE_URL = "https://api.deepseek.com/"
    assert api.get(f"{BASE}config/").data["platform"] == "deepseek"  # 末尾斜杠不影响认出


def test_a_preset_fixes_the_adapter_and_address(api, net):
    """选预设 = 由它定适配器与地址;请求里另给一个不同的地址 → 400,什么都没发出去。"""
    calls, routes = net
    routes["https://api.deepseek.com/models"] = Resp(200, {"data": [{"id": "deepseek-flash"}]})
    assert _models(api, platform="deepseek", api_key="sk-draft").data["status"] == "ok"
    assert calls[-1]["url"] == "https://api.deepseek.com/models"
    n = len(calls)
    refused = _models(api, platform="deepseek", base_url="https://attacker.example/v1", api_key="sk-draft")
    assert refused.status_code == 400 and "base_url" in refused.data
    assert len(calls) == n


def test_a_saved_preset_is_stored_and_read_back(api, monkeypatch):
    for name in config.PROVIDERS:  # 测通要真的建客户端:指向假实现,不出网
        monkeypatch.setitem(config.PROVIDERS, name, "apps.soul_assist.providers.FakeProvider")
    body = {"platform": "kimi", "api_key": "sk-kimi-key-000000"}
    assert api.patch(f"{BASE}config/", body, format="json").data["code"] == "untested_connection"
    assert api.post(f"{BASE}config/test/", body, format="json").data["ok"] is True
    saved = api.patch(f"{BASE}config/", body, format="json").data
    assert saved["platform"] == "kimi" and saved["base_url"] == "https://api.moonshot.cn/v1"
    # 之后改成自定义地址而不说平台:显示按连接认,不再是一个对不上的「kimi」
    move = {"base_url": "https://llm.internal.example/v1", "api_key": "k"}
    assert api.post(f"{BASE}config/test/", move, format="json").data["ok"] is True
    assert api.patch(f"{BASE}config/", move, format="json").data["platform"] == "custom"


# ── 获取模型 ────────────────────────────────────────────────────────────────


def test_fetching_models_uses_the_saved_key_on_the_server_and_never_returns_it(api, net, settings):
    calls, routes = net
    settings.ASSISTANT_BASE_URL = "https://saved.example/v1"
    _save_key(api)
    routes["https://saved.example/v1/models"] = Resp(200, {"data": [{"id": "b-model", "context_length": 131072}, {"id": "a-model"}]})
    response = _models(api, model="whatever")
    assert response.status_code == 200
    assert response.data == {"status": "ok", "error_kind": None,
                              "models": [{"name": "a-model", "context": None}, {"name": "b-model", "context": 131072}]}
    assert calls[-1]["headers"] == {"Authorization": f"Bearer {KEY}"}
    assert KEY not in response.content.decode()


def test_fetching_models_uses_the_draft_key_when_given(api, net):
    calls, routes = net
    _save_key(api)
    routes["https://api.deepseek.com"] = Resp(200, {"data": []})
    _models(api, platform="deepseek", api_key="sk-draft-key")
    assert calls[-1]["headers"] == {"Authorization": "Bearer sk-draft-key"}


def test_a_new_platform_without_a_key_never_gets_the_saved_one(api, net):
    calls, _ = net
    _save_key(api)
    refused = _models(api, platform="openai")
    assert refused.status_code == 400 and refused.data["code"] == "api_key_required"
    assert calls == []


def test_anthropic_lists_through_its_own_api(api, net):
    calls, routes = net
    routes["https://api.anthropic.com/v1/models"] = Resp(200, {"data": [{"id": "claude-x", "max_input_tokens": 200000}]})
    body = _models(api, platform="anthropic", api_key="sk-ant").data
    assert body["models"] == [{"name": "claude-x", "context": 200000}]
    assert calls[-1]["url"] == "https://api.anthropic.com/v1/models?limit=1000"
    assert calls[-1]["headers"] == {"x-api-key": "sk-ant", "anthropic-version": "2023-06-01"}


def test_ollama_needs_no_key(api, net):
    calls, routes = net
    routes["http://localhost:11434/v1/models"] = Resp(200, {"data": [{"id": "qwen3:32b"}]})
    assert _models(api, platform="ollama", api_key="").data["models"] == [{"name": "qwen3:32b", "context": None}]
    assert calls[-1]["headers"] == {}


@pytest.mark.parametrize("answer, expected", [
    (Resp(404), ("no_list", None)),
    (Resp(405), ("no_list", None)),
    (Resp(200, {"object": "list"}), ("no_list", None)),
    (Resp(401), ("failed", "auth")),
    (Resp(403), ("failed", "auth")),
    (Resp(429), ("failed", "rate_limited")),
    (Resp(402), ("failed", "rate_limited")),
    (Resp(500), ("failed", "other")),
    (requests.Timeout(), ("failed", "timeout")),
    (requests.ConnectionError(), ("failed", "connection")),
])
def test_list_outcomes_map_to_the_existing_kinds(api, net, answer, expected):
    """「平台不提供模型列表」不是错误(no_list、没有 error_kind);其余按连通测试已有的原因归类。"""
    _, routes = net
    routes["https://ark.cn-beijing.volces.com"] = answer
    body = _models(api, platform="doubao", api_key="k").data
    assert (body["status"], body["error_kind"]) == expected and body["models"] == []


def test_the_list_timeout_is_ten_seconds(api, net):
    calls, routes = net
    routes[""] = Resp(200, {"data": []})
    _models(api, platform="glm", api_key="k")
    assert calls[-1]["timeout"] == 10


def test_the_real_network_is_blocked_in_tests(api):
    """根 conftest 的 autouse fixture:没装假的就像连不上,绝不真的出网。"""
    assert _models(api, platform="openai", api_key="k").data == {"status": "failed", "error_kind": "connection",
                                                                  "models": []}
    assert api.get(f"{BASE}config/price/", {"platform": "openai", "model": "gpt-4o"}).data["found"] is False


@pytest.mark.parametrize("path, method", [("config/models/", "post"), ("config/price/", "get")])
def test_non_admins_cannot_list_or_price(cn_tenant, net, path, method):
    calls, _ = net
    client = officer_client(User.objects.create_user(username="mod", password="x", role="MODERATOR",
                                                     tenant=cn_tenant))
    assert getattr(client, method)(f"{BASE}{path}", {"platform": "openai", "model": "m"}).status_code == 403
    assert calls == []


# ── 参考价 ──────────────────────────────────────────────────────────────────

TABLE = {
    "sample_spec": {"input_cost_per_token": "x"},
    "deepseek/deepseek-chat": {"input_cost_per_token": 2.8e-07, "output_cost_per_token": 4.2e-07,
                               "cache_read_input_token_cost": 2.8e-08},
    "gpt-4o": {"input_cost_per_token": 2.5e-06, "output_cost_per_token": 1e-05},
    "image-only": {"output_cost_per_image": 0.04},
}


def _price(api, platform, model):
    return api.get(f"{BASE}config/price/", {"platform": platform, "model": model}).data


def test_reference_prices_are_per_million_tokens_with_a_date(api, net):
    _, routes = net
    routes[platforms.LITELLM_URL] = Resp(200, TABLE)
    body = _price(api, "deepseek", "deepseek-chat")
    assert body["found"] is True and body["as_of"]
    assert (body["input"], body["output"], body["cache_read"]) == (0.28, 0.42, 0.028)
    # 预设没有前缀的平台按模型名本身查;没有缓存读价就是 null
    assert _price(api, "openai", "gpt-4o") | {"as_of": None} == {
        "found": True, "input": 2.5, "output": 10.0, "cache_read": None, "as_of": None}


def test_a_model_not_in_the_table_is_not_found(api, net):
    _, routes = net
    routes[platforms.LITELLM_URL] = Resp(200, TABLE)
    assert _price(api, "custom", "qwen3-32b-awq")["found"] is False
    assert _price(api, "custom", "image-only")["found"] is False


def test_the_table_is_fetched_once_and_cached(api, net):
    calls, routes = net
    routes[platforms.LITELLM_URL] = Resp(200, TABLE)
    _price(api, "deepseek", "deepseek-chat")
    _price(api, "openai", "gpt-4o")
    assert [c["url"] for c in calls] == [platforms.LITELLM_URL]
    assert calls[0]["timeout"] == platforms.LITELLM_TIMEOUT_SECONDS


def test_an_unreachable_table_is_remembered_briefly_and_is_not_found(api, net, monkeypatch):
    calls, routes = net
    routes[platforms.LITELLM_URL] = requests.Timeout()
    ttls = []
    real_set = platforms.cache.set
    monkeypatch.setattr(platforms.cache, "set", lambda k, v, t: (
        # `cache` is the shared default cache: the rate-limit counters write to it too.
        ttls.append(t) if not k.startswith("throttle_") else None, real_set(k, v, t)))
    assert _price(api, "deepseek", "deepseek-chat")["found"] is False
    assert _price(api, "deepseek", "deepseek-chat")["found"] is False
    assert len(calls) == 1 and ttls == [platforms.PRICE_FAIL_SECONDS]


def test_a_price_keeps_its_source_across_a_save(api):
    prices = {"env-model": {"input": 0.28, "output": 0.42, "source": "litellm", "as_of": "2026-09-30"},
              "other": {"input": 1, "output": 2, "source": "manual"}}
    assert api.patch(f"{BASE}config/", {"prices": prices}, format="json").status_code == 200
    got = api.get(f"{BASE}config/").data["prices"]
    assert got["env-model"]["source"] == "litellm" and got["env-model"]["as_of"] == "2026-09-30"
    assert got["other"]["source"] == "manual"
    bad = api.patch(f"{BASE}config/", {"prices": {"m": {"input": 1, "output": 1, "source": "guess"}}}, format="json")
    assert bad.status_code == 400


# ── 测试连接顺带探测工具 ─────────────────────────────────────────────────────


class RefusesTools(FakeProvider):
    """平台以「不支持工具」拒收带工具的请求;不带工具就答。"""

    def answer(self, *, tools, **kwargs):
        type(self).calls.append({"tools": [t.name for t in tools]})
        if tools:
            raise ProviderError("400 tools", "tools_unsupported")
        return Answer(text="OK", usage={"input": 3, "output": 1})


def _test(api, **body):
    return api.post(f"{BASE}config/test/", body, format="json").data


def test_a_model_that_calls_the_tool_is_connected_with_tools(api):
    FakeProvider.script = [{"tools": ["ping"]}, {"text": "OK"}]
    body = _test(api)
    assert body["ok"] is True and body["tools"] is True
    assert FakeProvider.calls[0]["tools"] == ["ping"]


def test_a_model_that_answers_without_calling_is_connected_without_tools(api):
    body = _test(api)
    assert body["ok"] is True and body["tools"] is False


def test_a_platform_that_refuses_tools_is_connected_without_tools_and_can_be_saved(api, settings):
    """4c:连通 · 工具 ✕ —— 可以保存。变异:不重试(把 tools_unsupported 当失败)→ ok 为假、保存被拒,红。"""
    settings.ASSISTANT_PROVIDER = f"{__name__}.RefusesTools"
    RefusesTools.calls = []
    body = _test(api, model="no-tools-model")
    assert body["ok"] is True and body["tools"] is False and body["error_kind"] is None
    assert [c["tools"] for c in RefusesTools.calls] == [["ping"], []]
    assert api.patch(f"{BASE}config/", {"model": "no-tools-model"}, format="json").status_code == 200


def test_a_failed_test_has_no_tool_result(api):
    FakeProvider.script = [{"raise": "401", "kind": "auth"}]
    body = _test(api, model="m2")
    assert body["ok"] is False and body["error_kind"] == "auth" and body["tools"] is None
