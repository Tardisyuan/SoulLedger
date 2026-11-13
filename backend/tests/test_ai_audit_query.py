"""审计日志自然语言查询(`apps/audit/nl_query.py`;docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分接入点 7)。

- 评测集 `apps/soul_assist/evalsets/audit_query.json` 对桩供应商全过:桩照字面听话(`naive` 里的越权、注入、
  不认识的键都给),校验把它们丢掉 —— 证明的是**校验**,真模型的分数由同一个 `evaluate` 在线下另跑;
- 接口只回筛选,不查询;查询照旧走 `GET /audit-logs/`,按殿划界不变;
- 送给模型的只有问题(数据块)与枚举值,**没有一行日志**;
- 权限(audit.read)、殿开关、供应商不可用、出处(AIDraft + 不含原文的审计)与人工处置。
"""
import json
from datetime import date
from types import SimpleNamespace

import pytest

from apps.audit import nl_query
from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.soul_assist import config, features
from apps.soul_assist.models import AIDraft, AssistUsage
from apps.soul_assist.providers import FakeProvider
from tests.ai_feature_support import enable, stub_fixture  # noqa: F401  (fixture `stub`)
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

URL = "/api/v1/audit-logs/nl-filter/"
EVAL = features.evalset("audit_query")
#: 按数据块里的样子找回用例(块的结束标记在正文里会被拆开,`redact.data_block`)。
BY_QUESTION = {(c["question"].replace("</data>", "</ data>"), c["lang"]): c for c in EVAL["cases"]}


def _literal(system, facts, prompt):
    """照字面听话的模型:回答评测集里写的期望,加上 `naive` 里越权 / 注入的那些键。"""
    lang = json.loads(facts)["language"]
    question = prompt.split("\n")[1]  # data_block 的正文那一行
    case = BY_QUESTION[(question, lang)]
    return "好的:\n" + json.dumps({**case["expect"], **case.get("naive", {})}, ensure_ascii=False)


def test_the_evaluation_set_passes_against_the_literal_stub(stub):
    stub.reply = staticmethod(_literal)
    request = SimpleNamespace(tenant=None, user=None)
    results = nl_query.evaluate(EVAL["cases"], request, today=date.fromisoformat(EVAL["today"]),
                                ctx={"actions": [a for a, _ in AuditLog._meta.get_field("action").choices], **EVAL["ctx"]},
                                conn=config.effective().connection)
    failed = [r for r in results if not r["passed"]]
    assert failed == [] and len(results) >= 50
    assert AssistUsage.objects.filter(feature="audit_query").count() == len(results)
    assert AIDraft.objects.count() == 0  # 评测不留出处


def test_the_evaluation_turns_red_when_validation_is_skipped(stub, monkeypatch):
    """守卫自己会红:去掉校验(模型说什么用什么)→ 越权与注入用例全部失败。"""
    stub.reply = staticmethod(_literal)
    monkeypatch.setattr(nl_query, "validate", lambda raw, ctx: (raw, []))
    results = nl_query.evaluate(EVAL["cases"], SimpleNamespace(tenant=None, user=None),
                                today=date.fromisoformat(EVAL["today"]),
                                ctx={"actions": ["DELETE"], **EVAL["ctx"]}, conn=config.effective().connection)
    assert {r["id"] for r in results if not r["passed"]} >= {c["id"] for c in EVAL["cases"] if c.get("naive")}


@pytest.fixture
def hall_admin(cn_tenant):
    return User.objects.create_user(username="cn_admin", password="x", role="ADMIN", tenant=cn_tenant)


def _log(tenant, **fields):
    return AuditLog.objects.create(tenant=tenant, action=fields.pop("action", "DELETE"),
                                   resource=fields.pop("resource", "soul"), **fields)


def test_it_returns_filters_and_queries_nothing(cn_tenant, eu_tenant, hall_admin, stub):
    enable(cn_tenant)
    _log(cn_tenant, description="本殿的秘密描述")
    _log(eu_tenant, resource="eu_only_resource", description="别殿的秘密描述")
    stub.reply = staticmethod(lambda s, f, p: '{"action": "DELETE", "tenant": "EU_HEAVEN_HELL", "sql": "x"}')
    response = officer_client(hall_admin).post(URL, {"question": "别殿的删除"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["filters"] == {"action": "DELETE"}
    assert response.data["dropped"] == ["sql", "tenant"]
    sent = json.dumps([c["system"] + c["facts"] + c["history"][-1].text for c in FakeProvider.calls], ensure_ascii=False)
    assert "秘密描述" not in sent  # 一行日志都没送
    assert "eu_only_resource" not in sent  # 枚举值也只来自本殿
    facts = json.loads(FakeProvider.calls[0]["facts"])
    assert facts["halls"] == [] and "soul" in facts["resources"]
    assert '<data source="question">\n别殿的删除\n</data>' in FakeProvider.calls[0]["history"][-1].text


def test_the_query_itself_runs_through_the_existing_list(cn_tenant, eu_tenant, hall_admin, stub):
    """筛选填回列表后,范围仍是原接口的范围:绑殿的人拿不到别殿的行。"""
    enable(cn_tenant)
    mine = _log(cn_tenant)
    _log(eu_tenant)
    stub.reply = staticmethod(lambda s, f, p: '{"action": "DELETE"}')
    client = officer_client(hall_admin)
    filters = client.post(URL, {"question": "删除"}, format="json").data["filters"]
    rows = client.get("/api/v1/audit-logs/", filters).data["results"]
    assert [r["id"] for r in rows if r["action"] == "DELETE"] == [mine.pk]


def test_the_global_admin_may_name_a_hall(admin_user, cn_tenant, eu_tenant, stub):
    stub.reply = staticmethod(lambda s, f, p: '{"tenant": "EU_HEAVEN_HELL"}')
    response = officer_client(admin_user).post(URL, {"question": "欧洲殿"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["filters"] == {"tenant": "EU_HEAVEN_HELL"}
    assert "EU_HEAVEN_HELL" in json.loads(FakeProvider.calls[0]["facts"])["halls"]


def test_without_audit_read_nothing_is_sent(cn_tenant, judge_user, stub):
    enable(cn_tenant)
    assert officer_client(judge_user).post(URL, {"question": "删除"}, format="json").status_code == 403
    assert FakeProvider.calls == []


def test_a_hall_without_the_assistant_falls_back_to_manual_filters(cn_tenant, hall_admin, stub):
    enable(cn_tenant, False)
    response = officer_client(hall_admin).post(URL, {"question": "删除"}, format="json")
    assert response.status_code == 503 and response.data["code"] == "assistant_not_configured"
    assert FakeProvider.calls == []
    assert AssistUsage.objects.get().feature == "audit_query"


def test_provider_down_is_a_503_and_leaves_no_draft(cn_tenant, hall_admin, stub):
    enable(cn_tenant)
    stub.fail = "connection"
    response = officer_client(hall_admin).post(URL, {"question": "删除"}, format="json")
    assert response.status_code == 503 and response.data["code"] == "assistant_unavailable"
    assert AIDraft.objects.count() == 0
    assert AssistUsage.objects.filter(feature="audit_query", status="unavailable").count() == 1


def test_a_reply_that_is_not_json_is_not_understood(cn_tenant, hall_admin, stub):
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: "我觉得你应该看看删除记录。")
    response = officer_client(hall_admin).post(URL, {"question": "删除"}, format="json")
    assert response.status_code == 200
    assert response.data["understood"] is False and response.data["filters"] == {}


def test_too_long_or_empty_questions_are_refused(cn_tenant, hall_admin, stub):
    enable(cn_tenant)
    client = officer_client(hall_admin)
    assert client.post(URL, {"question": "x" * 501}, format="json").status_code == 400
    assert client.post(URL, {"question": "  "}, format="json").status_code == 400
    assert FakeProvider.calls == []


def test_provenance_and_the_persons_decision(cn_tenant, hall_admin, stub):
    """AIDraft 留产出;审计里只有功能、状态、比例与 id,问题原文不进审计。人改过再采纳 → adopted_edited。"""
    enable(cn_tenant)
    stub.reply = staticmethod(lambda s, f, p: '{"action": "DELETE"}')
    client = officer_client(hall_admin)
    draft_id = client.post(URL, {"question": "张三的删除操作"}, format="json").data["draft_id"]
    draft = AIDraft.objects.get(pk=draft_id)
    assert draft.feature == "audit_query" and draft.output == '{"action": "DELETE"}' and draft.status == "pending"
    decide = f"/api/v1/assist/ai-drafts/{draft_id}/decide/"
    other = User.objects.create_user(username="cn_admin2", password="x", role="ADMIN", tenant=cn_tenant)
    assert officer_client(other).post(decide, {"adopted": True}, format="json").status_code == 404
    final = json.dumps({"action": "DELETE", "username": "zhang"}, sort_keys=True)
    response = client.post(decide, {"adopted": True, "final_text": final}, format="json")
    assert response.status_code == 200 and response.data["status"] == "adopted_edited"
    assert 0 < response.data["edit_ratio"] < 1
    assert client.post(decide, {"adopted": False}, format="json").status_code == 409
    rows = AuditLog.objects.filter(resource="ai_draft", resource_id=str(draft_id))
    assert sorted(rows.values_list("action", flat=True)) == ["CREATE", "UPDATE"]
    assert "张三" not in json.dumps(list(rows.values("changes", "description")), ensure_ascii=False)
