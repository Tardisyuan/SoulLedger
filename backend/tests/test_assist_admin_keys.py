"""API key 按平台存(用户 2026-10-01 定;`config.stored_key`、`platforms.key_slot`、迁移 0009)。

每个平台一格:换到 Kimi 要贴 Kimi 的 key;换回 DeepSeek 不必重贴。「自定义」按主机分格。
一个 key 只会发回存它时的那台主机。页面与审计里永远没有 key 本身。
"""
import importlib
import json

import pytest
from cryptography.fernet import Fernet
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.soul_assist import config, platforms
from apps.soul_assist.providers import FakeProvider
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

BASE = "/api/v1/assist-admin/config/"
DEEPSEEK = "sk-deepseek-SECRET-aaaa-9b89"
KIMI = "sk-kimi-SECRET-bbbb-1111"
CUSTOM = "sk-custom-SECRET-cccc-2222"
ENV = "sk-env-SECRET-dddd-3333"
SECRETS = (DEEPSEEK, KIMI, CUSTOM, ENV)


class KeyFake(FakeProvider):
    """两个适配器都换成它:测试不连外网。"""


@pytest.fixture(autouse=True)
def assistant_on(settings, monkeypatch):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_MODEL = "env-model"
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    monkeypatch.setitem(config.PROVIDERS, "openai_compatible", f"{__name__}.KeyFake")
    monkeypatch.setitem(config.PROVIDERS, "anthropic", f"{__name__}.KeyFake2")
    FakeProvider.script = [{"text": "OK"}]
    yield
    FakeProvider.script = []


class KeyFake2(FakeProvider):
    pass


@pytest.fixture
def api():
    return officer_client(User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=None))


def _switch(api, body, *, test=True):
    """草稿 → 测试 → 保存。"""
    if test:
        tested = api.post(f"{BASE}test/", body, format="json")
        if tested.status_code != 200:
            return tested
        assert tested.data["ok"] is True
    return api.patch(BASE, body, format="json")


def _no_secret(*payloads):
    blob = json.dumps(payloads, default=str)
    return not any(secret in blob for secret in SECRETS)


def test_each_platform_keeps_its_own_key_and_switching_back_needs_no_repaste(api):
    """变异:`candidate` 换平台时不查已存的格子(直接 KeyRequiredError)→ 换回 DeepSeek 400 → 红;
    `key_slot` 恒返回同一格 → Kimi 的 key 覆盖掉 DeepSeek 的 → 红。"""
    assert _switch(api, {"platform": "deepseek", "api_key": DEEPSEEK, "model": "deepseek-chat"}).status_code == 200
    assert _switch(api, {"platform": "kimi", "api_key": KIMI, "model": "kimi-k2"}).status_code == 200
    body = api.get(BASE).data
    assert body["api_key_slot"] == "kimi" and body["api_key"]["last4"] == KIMI[-4:]
    assert {k: v["last4"] for k, v in body["api_keys"].items()} == {"deepseek": "9b89", "kimi": "1111"}
    assert config.effective().connection.api_key == KIMI

    back = _switch(api, {"platform": "deepseek", "model": "deepseek-chat"})  # 不贴 key
    assert back.status_code == 200, back.data
    assert back.data["api_key_slot"] == "deepseek" and back.data["api_key"]["last4"] == "9b89"
    assert config.effective().connection.api_key == DEEPSEEK


def test_a_platform_with_no_saved_key_still_requires_one(api):
    _switch(api, {"platform": "deepseek", "api_key": DEEPSEEK, "model": "deepseek-chat"})
    for path, method in (("test/", "post"), ("models/", "post"), ("", "patch")):
        response = getattr(api, method)(f"{BASE}{path}", {"platform": "glm", "model": "glm-4"}, format="json")
        assert response.status_code == 400 and response.data["code"] == "api_key_required", path
    assert config.effective().connection.api_key == DEEPSEEK


def test_custom_endpoints_are_keyed_by_host_and_a_key_never_goes_to_another_host(api):
    first = {"platform": "custom", "provider": "openai_compatible", "base_url": "https://llm.internal.example/v1",
             "api_key": CUSTOM, "model": "m"}
    assert _switch(api, first).status_code == 200
    assert config.key_slot(config.effective().connection) == "custom:llm.internal.example"
    # 同一主机、换了路径:同一格
    same_host = {"platform": "custom", "base_url": "https://llm.internal.example/v2", "model": "m"}
    assert _switch(api, same_host).status_code == 200 and config.effective().connection.api_key == CUSTOM
    # 别的主机,包括把可信主机名写进 userinfo 的:没有它的格子 → 要 key
    for url in ("https://other.example/v1", "https://llm.internal.example@evil.example/v1",
                "https://llm.internal.example.evil.example/v1", "https://llm.internal.example:8443/v1"):
        response = api.post(f"{BASE}test/", {"platform": "custom", "base_url": url}, format="json")
        assert response.data.get("code") == "api_key_required", url


def test_key_slots_follow_the_host(settings):
    def slot(provider, url):
        return platforms.key_slot(config.Connection(config.provider_path(provider), url, "", "", "", ""))

    assert slot("openai_compatible", "https://api.deepseek.com") == "deepseek"
    assert slot("openai_compatible", "https://API.DeepSeek.com/v1/") == "deepseek"
    assert slot("anthropic", "https://api.deepseek.com/anthropic") == "deepseek"  # 同一家、同一个 key
    assert slot("openai_compatible", "http://localhost:11434/v1") == "ollama"
    assert slot("openai_compatible", "http://localhost:8080/v1") == "custom:localhost:8080"


def test_the_backup_on_the_primarys_platform_reuses_its_key(api):
    _switch(api, {"platform": "deepseek", "api_key": DEEPSEEK, "model": "deepseek-chat"})
    draft = {"platform": "deepseek", "model": "deepseek-reasoner"}
    assert api.post(f"{BASE}backup/test/", draft, format="json").data["ok"] is True
    saved = api.patch(f"{BASE}backup/", draft, format="json")
    assert saved.status_code == 200 and saved.data["api_key_slot"] == "deepseek"
    assert saved.data["api_key"]["last4"] == "9b89" and config.effective().backup.api_key == DEEPSEEK
    # 备用换到没存过 key 的平台 → 要 key
    other = api.post(f"{BASE}backup/test/", {"platform": "kimi", "model": "k"}, format="json")
    assert other.data["code"] == "api_key_required"


def test_the_env_key_belongs_to_the_env_platform(api, settings):
    settings.ASSISTANT_PROVIDER = f"{__name__}.KeyFake"  # env 配的是 DeepSeek(适配器换成假的,不连外网)
    settings.ASSISTANT_BASE_URL = "https://api.deepseek.com"
    settings.ASSISTANT_API_KEY = ENV
    config.invalidate()
    body = api.get(BASE).data
    assert body["api_key"]["source"] == "env" and body["api_keys"]["deepseek"]["source"] == "env"
    assert _switch(api, {"platform": "kimi", "api_key": KIMI, "model": "k"}).status_code == 200
    back = _switch(api, {"platform": "deepseek", "model": "deepseek-chat"})
    assert back.status_code == 200 and config.effective().connection.api_key == ENV
    assert back.data["api_key"]["source"] == "env"


def test_nothing_the_page_or_the_audit_shows_contains_a_key(api):
    _switch(api, {"platform": "deepseek", "api_key": DEEPSEEK, "model": "deepseek-chat"})
    _switch(api, {"platform": "kimi", "api_key": KIMI, "model": "kimi-k2"})
    api.post(f"{BASE}backup/test/", {"platform": "deepseek", "model": "r"}, format="json")
    api.patch(f"{BASE}backup/", {"platform": "deepseek", "model": "r"}, format="json")
    responses = [api.get(BASE).data, api.get(f"{BASE}backup/").data]
    audits = list(AuditLog.objects.filter(resource="assistant_config").values_list("changes", flat=True))
    assert _no_secret(responses, audits)


def test_the_audit_says_replaced_or_cleared_per_platform(api):
    _switch(api, {"platform": "deepseek", "api_key": DEEPSEEK, "model": "deepseek-chat"})
    _switch(api, {"platform": "kimi", "api_key": KIMI, "model": "kimi-k2"})
    api.patch(BASE, {"api_key": ""}, format="json")  # 只清当前平台:不必先测
    rows = list(AuditLog.objects.filter(resource="assistant_config").order_by("id").values_list("changes", flat=True))
    assert [r["api_keys"] for r in rows] == [{"deepseek": "replaced"}, {"kimi": "replaced"}, {"kimi": "cleared"}]
    keys = config.effective().keys
    assert keys["kimi"]["key"] == "" and keys["deepseek"]["key"] == DEEPSEEK
    # 清除过的格子 = 没有 key:换回来要重贴
    _switch(api, {"platform": "deepseek", "model": "deepseek-chat"})
    assert api.post(f"{BASE}test/", {"platform": "kimi", "model": "k"}, format="json").data["code"] == "api_key_required"


MIGRATION = importlib.import_module("apps.soul_assist.migrations.0009_per_platform_api_keys")


def test_0009_moves_the_single_key_into_its_platforms_slot(migration_round_trip, settings):
    """115 的配置早于「平台」字段,只存了地址:key 落在 `deepseek` 那一格(与运行时找 key 的规则相同)。"""
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    set_at = timezone.now().replace(microsecond=0)

    def seed(state):
        state.get_model("soul_assist", "AssistConfig").objects.create(
            pk=1, values={"provider": "openai_compatible", "base_url": "https://api.deepseek.com", "model": "x"},
            api_key=DEEPSEEK, api_key_set_at=set_at)

    def snapshot(state):  # 两边的列不同:之前是单个 key,之后是按平台的 JSON
        row = state.get_model("soul_assist", "AssistConfig").objects.get(pk=1)
        keys = getattr(row, "api_keys", None)
        return {"key": getattr(row, "api_key", None), "set_at": getattr(row, "api_key_set_at", None),
                "keys": json.loads(keys) if keys else None}

    def check_forward(state):
        row = state.get_model("soul_assist", "AssistConfig").objects.get(pk=1)
        assert json.loads(row.api_keys) == {"deepseek": {"key": DEEPSEEK, "set_at": set_at.isoformat()}}

    migration_round_trip(before=("soul_assist", "0008_streaming_failover"),
                         after=("soul_assist", "0009_per_platform_api_keys"),
                         seed=seed, snapshot=snapshot, check_forward=check_forward)
