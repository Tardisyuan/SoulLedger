"""备用供应商的管理接口:`/api/v1/assist-admin/config/backup/`(docs/ARCHITECTURE-soul-assist.md §13)。

草稿 → 测试 → 保存,与主用同一套规则;key 密文存库、只写不读、审计里没有。非 ADMIN 403 由
`test_assist_admin.py::test_every_route_refuses_every_non_admin_role` 按 URLconf 覆盖。
"""
import json

import pytest
from cryptography.fernet import Fernet
from django.db import connection

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.soul_assist import config
from apps.soul_assist.models import AssistConfig
from apps.soul_assist.providers import FakeProvider
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

BASE = "/api/v1/assist-admin/config/"
KEY = "sk-backup-THE-SECRET-VALUE-9876"
DRAFT = {"platform": "deepseek", "api_key": KEY, "model": "deepseek-chat"}


class BackupFake(FakeProvider):
    """「另一家」的适配器:测试不许连外网。"""


@pytest.fixture(autouse=True)
def assistant_on(settings, monkeypatch):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_MODEL = "env-model"
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    for name in config.PROVIDERS:
        monkeypatch.setitem(config.PROVIDERS, name, f"{__name__}.BackupFake")
    FakeProvider.script = [{"text": "OK"}]
    FakeProvider.calls = []
    yield
    FakeProvider.script = []


@pytest.fixture
def api():
    return officer_client(User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=None))


def _save(api, body=None, *, test=True):
    body = body or DRAFT
    if test:
        assert api.post(f"{BASE}backup/test/", body, format="json").data["ok"] is True
    return api.patch(f"{BASE}backup/", body, format="json")


def test_nothing_is_configured_at_first(api):
    body = api.get(f"{BASE}backup/").data
    assert body["configured"] is False and body["model"] is None and body["api_key"]["set"] is False
    assert body["breaker"] == {"open": False, "open_until": None, "consecutive_failures": 0, "threshold": 3,
                               "open_seconds": 60}
    assert body["primary_first_token_seconds"] == 12.0
    assert config.effective().backup is None


def test_the_backup_must_pass_its_own_test_before_it_is_saved(api):
    """变异:BackupView 不查 `was_tested` → 未测也能存 → 红。"""
    untested = _save(api, test=False)
    assert untested.status_code == 400 and untested.data["code"] == "untested_connection"
    saved = _save(api)
    assert saved.status_code == 200, saved.data
    assert (saved.data["configured"], saved.data["platform"], saved.data["model"]) == (True, "deepseek", "deepseek-chat")
    assert saved.data["base_url"] == "https://api.deepseek.com"
    backup = config.effective().backup
    assert (backup.model, backup.api_key, backup.base_url) == ("deepseek-chat", KEY, "https://api.deepseek.com")
    # 另一套(换了模型)没测过 → 拒
    other = api.patch(f"{BASE}backup/", {"model": "deepseek-reasoner"}, format="json")
    assert other.data["code"] == "untested_connection"


def test_the_backup_key_is_encrypted_never_echoed_and_not_in_the_audit(api):
    response = _save(api)
    assert KEY not in json.dumps(response.data)
    assert response.data["api_key"]["last4"] == KEY[-4:] and response.data["api_key"]["set"] is True
    with connection.cursor() as cursor:
        cursor.execute("select api_keys from soul_assist_assistconfig")
        stored = cursor.fetchone()[0]
    assert KEY not in stored and stored
    audit = AuditLog.objects.filter(resource="assistant_config").latest("id")
    assert KEY not in json.dumps(audit.changes) and audit.changes["api_keys"] == {"deepseek": "replaced"}
    assert audit.changes["backup"][0] is None and audit.changes["backup"][1]["model"] == "deepseek-chat"


def test_a_new_platform_needs_a_key_and_a_model(api):
    no_key = api.post(f"{BASE}backup/test/", {"platform": "deepseek", "model": "m"}, format="json")
    assert no_key.status_code == 400 and no_key.data["code"] == "api_key_required"
    no_model = api.post(f"{BASE}backup/test/", {"platform": "deepseek", "api_key": KEY}, format="json")
    assert no_model.status_code == 400 and no_model.data["code"] == "backup_incomplete"


def test_changing_only_the_prices_needs_no_new_test(api):
    _save(api)
    res = api.patch(f"{BASE}backup/", {"prices": {"deepseek-chat": {"input": 1, "output": 2}}}, format="json")
    assert res.status_code == 200 and res.data["prices"]["deepseek-chat"]["output"] == 2
    assert config.effective().backup_prices == {"deepseek-chat": {"input": 1.0, "output": 2.0}}


def test_a_monthly_cap_needs_the_backup_model_priced_too(api):
    _save(api)
    AssistConfig.objects.filter(pk=1).update(values={**AssistConfig.objects.get(pk=1).values,
                                                     "prices": {"env-model": {"input": 1, "output": 1}}})
    config.invalidate()
    capped = api.patch(BASE, {"monthly_cap": 10}, format="json")
    assert capped.status_code == 400 and capped.data["code"] == "unpriced_backup_model"
    api.patch(f"{BASE}backup/", {"prices": {"deepseek-chat": {"input": 1, "output": 1}}}, format="json")
    assert api.patch(BASE, {"monthly_cap": 10}, format="json").status_code == 200
    # 上限在:备用换成没定价的模型 → 拒
    draft = {**DRAFT, "model": "deepseek-reasoner"}
    assert _save(api, draft).data["code"] == "unpriced_backup_model"


def test_deleting_the_backup_removes_it_but_keeps_the_platform_key(api):
    """key 按平台存、主用可能正用着同一格:删备用不删 key。重新配同一平台的备用不必再填。"""
    _save(api)
    res = api.delete(f"{BASE}backup/")
    assert res.status_code == 200 and res.data["configured"] is False
    assert config.effective().backup is None and AssistConfig.objects.get(pk=1).values["backup"] is None
    assert "api_keys" not in _last_changes()
    assert config.effective().keys["deepseek"]["key"] == KEY
    again = {k: v for k, v in DRAFT.items() if k != "api_key"}
    assert _save(api, again).status_code == 200 and config.effective().backup.api_key == KEY


def _last_changes():
    return AuditLog.objects.filter(resource="assistant_config").latest("id").changes


def test_credentials_in_the_backup_url_are_redacted(api):
    body = {"provider": "openai_compatible", "base_url": "https://user:pw@llm.example/v1", "api_key": KEY,
            "model": "m"}
    assert _save(api, body).data["base_url"] == "https://llm.example/v1"
    assert "pw" not in json.dumps(_last_changes())
    # 整表回传去敏地址 = 没改:不要求重填 key、也不要求重测
    again = api.patch(f"{BASE}backup/", {"base_url": "https://llm.example/v1", "model": "m"}, format="json")
    assert again.status_code == 200 and config.effective().backup.base_url == "https://user:pw@llm.example/v1"


def test_the_try_endpoint_streams(api, cn_tenant):
    ids = api.post("/api/v1/assist-admin/eval/identities/").data
    assert ids["eval_soul_account"]
    FakeProvider.script = [{"deltas": ["试", "问"]}]
    response = api.post("/api/v1/assist-admin/try/", {"side": "soul", "question": "q", "stream": True}, format="json")
    raw = b"".join(response.streaming_content).decode()
    events = [json.loads(block.split("\n")[1].removeprefix("data: ")) for block in raw.strip().split("\n\n")]
    assert [e["event"] for e in events] == ["meta", "delta", "delta", "done"]
    done = events[-1]
    assert (done["answer"], done["provider_role"], done["fallback_reason"], done["model"]) == ("试问", "primary", None,
                                                                                                "env-model")


def test_the_usage_report_splits_primary_and_backup(api):
    body = api.get("/api/v1/assist-admin/usage/").data
    assert body["fallbacks"]["count"] == 0 and set(body["fallbacks"]["by_reason"]) == {
        "connection", "timeout", "rate_limited", "server_error", "quota", "circuit_open"}
    assert body["by_provider"] == [] and {"stopped", "interrupted"} <= set(body["by_status"])
