"""官员端助手的**管道**(docs/ARCHITECTURE-officer-assist.md §2、§3)。

全部离线,供应商是 `FakeProvider`(它调哪个工具是脚本写死的,工具返回的数据记在脚本那一步的
`results` 里)。这里测:令牌分界、两道权限检查、只给计数、租户范围(非 ADMIN 读不到别殿;
ADMIN 是全殿并如实标出)、开关、会话隔离、库约束、留存清理、审计只存 HMAC、Sentry 清理。
灵魂端同一套管道的测试在 `test_soul_assist.py`,不重复。
"""
import json
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.soul_assist import officer_tools, service
from apps.soul_assist.models import AssistConversation, AssistMessage
from apps.soul_assist.providers import FakeProvider
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

ASK = "/api/v1/assist/"
LIST = "/api/v1/assist/conversations/"


@pytest.fixture(autouse=True)
def assistant_on(settings):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    FakeProvider.script = [{"text": "好的。"}]
    FakeProvider.calls = []
    yield
    FakeProvider.script = []
    FakeProvider.calls = []


def _enable(tenant, on=True):
    tenant.settings = {**(tenant.settings or {}), "assistant_enabled": on}
    tenant.save(update_fields=["settings"])


def _officer(username, role, tenant):
    return User.objects.create_user(username=username, password="x", role=role, tenant=tenant)


def _ask(client, question="队列里有几件?", screen="judgment", lang="zh-Hans", **extra):
    return client.post(ASK, {"question": question, "screen": screen, **extra}, format="json",
                       HTTP_ACCEPT_LANGUAGE=lang)


def _tool_result(client, name, **ask):
    """让模型调 `name`,返回工具交给模型的那份 JSON(经真 URLconf、真令牌)。"""
    FakeProvider.script = [{"tools": [name]}, {"text": "好"}]
    response = _ask(client, **ask)
    assert response.status_code == 200, response.data
    return FakeProvider.script[0]["results"][0]


def _case(tenant, name, **fields):
    soul = Soul.objects.create(name=name, birth_date="1900-01-01", current_state=SoulState.JUDGING, tenant=tenant)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant,
                                   evidence_json={}, **fields)


def _workflow(tenant, name, *, role="JUDGE", case_type="ROUTINE"):
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus

    soul = Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)
    wf = ApprovalWorkflow.objects.create(workflow_name=name, soul=soul, tenant=tenant, case_type=case_type,
                                         status=ApprovalWorkflowStatus.IN_PROGRESS)
    node = ApprovalNode.objects.create(workflow=wf, node_name="n1", node_order=1, node_type="TRIAL",
                                       status=NodeStatus.PENDING, approver_type="ROLE", approver_role=role)
    wf.current_node = node
    wf.save(update_fields=["current_node"])
    return wf


# ── 令牌分界 ─────────────────────────────────────────────────────────────


def test_an_officer_token_asks_and_the_conversation_belongs_to_the_officer(cn_tenant, judge_user):
    _enable(cn_tenant)
    response = _ask(officer_client(judge_user))
    assert response.status_code == 200, response.data
    conversation = AssistConversation.objects.get(pk=response.data["conversation_id"])
    assert conversation.user_id == judge_user.pk and conversation.account_id is None
    assert conversation.screen == "judgment"


def test_a_soul_token_is_refused_on_every_officer_route(cn_tenant):
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    assert _ask(soul).status_code == 403
    assert soul.get(LIST).status_code == 403
    assert soul.delete(f"{LIST}00000000-0000-0000-0000-000000000000/").status_code == 403
    assert FakeProvider.calls == []


def test_an_officer_token_is_refused_on_the_soul_route(cn_tenant, judge_user):
    response = officer_client(judge_user).post("/api/v1/me/assist/", {"question": "x", "screen": "other"},
                                               format="json")
    assert response.status_code == 403


def test_a_non_admin_whose_token_resolves_no_hall_is_refused(cn_tenant):
    """失败即关,同 `scope_to_tenant`。变异:`permission_classes` 去掉 TenantPermission → 这里过了
    TenantPermission 那一关,但 `officer_enabled_for` 仍答关,于是 503 不是 403 —— 红。"""
    _enable(cn_tenant)
    judge = _officer("hallless", "JUDGE", cn_tenant)
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(judge).access_token}")  # 无 tenant_code
    assert _ask(client).status_code == 403
    assert FakeProvider.calls == []


def test_an_unknown_screen_is_400(cn_tenant, judge_user):
    _enable(cn_tenant)
    assert _ask(officer_client(judge_user), screen="applications").status_code == 400  # 灵魂端的段


# ── 开关 ─────────────────────────────────────────────────────────────────


def test_the_hall_switch_is_the_soul_sides_switch_and_defaults_off(cn_tenant, judge_user, settings):
    client = officer_client(judge_user)
    assert _ask(client).data["code"] == "assistant_not_configured"
    _enable(cn_tenant)
    assert _ask(client).status_code == 200
    settings.ASSISTANT_ENABLED = False
    assert _ask(client).status_code == 503


def test_an_admin_without_a_hall_follows_the_global_switch_only(db, settings):
    """ADMIN 的令牌可以不带殿:没有殿开关可读,只看全局开关(docs 与 settings 注释同一句)。
    变异:`officer_enabled_for` 对无殿一律答 False → 第一条红。"""
    admin = _officer("hallless_admin", "ADMIN", None)
    client = officer_client(admin)
    assert _ask(client).status_code == 200
    settings.ASSISTANT_ENABLED = False
    assert _ask(client).data["code"] == "assistant_not_configured"


def test_an_admin_with_a_hall_reads_that_halls_switch(cn_tenant, admin_user):
    client = officer_client(admin_user)
    assert _ask(client).status_code == 503
    _enable(cn_tenant)
    assert _ask(client).status_code == 200


# ── 两道权限检查 ─────────────────────────────────────────────────────────


def test_only_permitted_tools_are_offered(cn_tenant, judge_user):
    """JUDGE 不持有 soul_inbox.read;MODERATOR 持有。断言缺席,不只断言在场。
    变异:`offered` 不过滤 → JUDGE 的列表里出现 inbox_counts,红。"""
    _enable(cn_tenant)
    _ask(officer_client(judge_user))
    assert FakeProvider.calls[-1]["tools"] == ["judgment_queue_counts", "my_pending_approvals", "my_permissions"]

    viewer = _officer("v", "VIEWER", cn_tenant)
    _ask(officer_client(viewer))
    assert FakeProvider.calls[-1]["tools"] == ["my_permissions"]

    moderator = _officer("m", "MODERATOR", cn_tenant)
    _ask(officer_client(moderator))
    assert "inbox_counts" in FakeProvider.calls[-1]["tools"]


def test_a_tool_the_officer_lacks_is_refused_when_forced(cn_tenant, judge_user):
    """模型(或注入)调了一个没提供的工具:执行时那一道再拒。
    变异:`run` 里去掉 `_permitted` 检查 → 拿到真计数,红。"""
    _enable(cn_tenant)
    out = _tool_result(officer_client(judge_user), "inbox_counts")
    assert out == {"error": "permission_denied", "codename": "soul_inbox.read"}
    viewer = _officer("v", "VIEWER", cn_tenant)
    assert _tool_result(officer_client(viewer), "judgment_queue_counts")["error"] == "permission_denied"


def test_an_invented_tool_name_answers_an_error_object(cn_tenant, judge_user):
    _enable(cn_tenant)
    assert _tool_result(officer_client(judge_user), "delete_everything") == {"error": "unknown_tool"}


def test_every_tool_takes_only_the_request():
    import inspect

    for name, (_codename, fn, _doc) in officer_tools.TOOLS.items():
        assert list(inspect.signature(fn).parameters) == ["request"], name


# ── 只给计数,且按范围 ───────────────────────────────────────────────────


def test_queue_counts_are_this_halls_and_carry_no_soul_data(cn_tenant, eu_tenant, judge_user):
    """非 ADMIN 读不到别殿。变异:`_list_queryset` 换成 `Judgment.objects.all()` → total 变 4,红。"""
    _enable(cn_tenant)
    other = _officer("b", "JUDGE", cn_tenant)
    _case(cn_tenant, "我的魂", claimed_by=judge_user, claimed_at=timezone.now())
    _case(cn_tenant, "无主魂")
    _case(cn_tenant, "别人魂", claimed_by=other, claimed_at=timezone.now())
    _case(eu_tenant, "Foreign Soul")
    _case(cn_tenant, "已结魂", verdict="PASSED", is_final=True)

    out = _tool_result(officer_client(judge_user), "judgment_queue_counts")
    assert out == {"scope": "this_hall", "total": 3, "mine": 1, "unclaimed": 1, "others": 1, "deferred": 0}
    blob = json.dumps(out, ensure_ascii=False)
    for name in ("我的魂", "无主魂", "Foreign"):
        assert name not in blob


def test_the_tool_agrees_with_the_queue_counts_endpoint(cn_tenant, judge_user):
    """「复用那个视图的逻辑」:同一个调用者,两条路给同一组数。"""
    _enable(cn_tenant)
    _case(cn_tenant, "甲")
    _case(cn_tenant, "乙", claimed_by=judge_user, claimed_at=timezone.now())
    client = officer_client(judge_user)
    endpoint = client.get("/api/v1/judgment/queue-counts/").data
    tool = _tool_result(client, "judgment_queue_counts")
    assert {k: v for k, v in tool.items() if k != "scope"} == dict(endpoint)


def test_an_admin_sees_every_hall_and_is_told_so(cn_tenant, eu_tenant, admin_user):
    _enable(cn_tenant)
    _case(cn_tenant, "甲")
    _case(eu_tenant, "B")
    out = _tool_result(officer_client(admin_user), "judgment_queue_counts")
    assert out["scope"] == "all_halls" and out["total"] == 2
    assert "scope=all_halls" in FakeProvider.calls[-1]["facts"]


def test_pending_approvals_count_only_nodes_this_user_may_decide(cn_tenant, eu_tenant, judge_user):
    """判据与 approve_node 同一条(`can_approve`)。别殿的、指给别的角色的,都不算。
    变异:去掉 `node.can_approve(user)` → total 变 2,红。"""
    _enable(cn_tenant)
    _workflow(cn_tenant, "甲流程", role="JUDGE", case_type="ROUTINE")
    _workflow(cn_tenant, "乙流程", role="MODERATOR", case_type="APPEAL")
    _workflow(eu_tenant, "Foreign flow", role="JUDGE", case_type="ROUTINE")
    out = _tool_result(officer_client(judge_user), "my_pending_approvals", screen="workflow")
    assert out == {"scope": "this_hall", "total": 1, "by_case_type": {"ROUTINE": 1},
                   "holds_workflow_approve": True}
    assert "甲流程" not in json.dumps(out, ensure_ascii=False)


def test_my_permissions_answers_why_a_moderator_cannot_approve(cn_tenant):
    """「为什么我点不了批准」来自 check_permission,不来自语料(ROLE_FORBIDDEN_CODENAMES)。"""
    _enable(cn_tenant)
    moderator = _officer("m", "MODERATOR", cn_tenant)
    out = _tool_result(officer_client(moderator), "my_permissions")
    assert out["role"] == "MODERATOR" and out["scope"] == "this_hall"
    assert out["permissions"]["workflow.approve"] is False
    assert out["permissions"]["workflow.advance"] is False
    assert out["permissions"]["user.manage"] is False


def test_inbox_counts_are_this_halls_without_ids_or_names(cn_tenant, eu_tenant):
    from apps.chat.models import Conversation, ConversationKind

    _enable(cn_tenant)
    for tenant, name in ((cn_tenant, "来信甲"), (eu_tenant, "Letter B")):
        account, _ = ready_soul(tenant, name=name)
        Conversation.objects.create(kind=ConversationKind.OFFICER_INBOX, room_id=f"!{name}:x",
                                    soul_a=account.soul, tenant=tenant, last_from="soul",
                                    last_soul_message_at=timezone.now(), last_message_at=timezone.now())
    moderator = _officer("m", "MODERATOR", cn_tenant)
    out = _tool_result(officer_client(moderator), "inbox_counts", screen="soul-inbox")
    assert out["scope"] == "this_hall" and out["all"] == 1 and out["awaiting_reply"] == 1
    assert out["halls"] == [{"hall_names": cn_tenant.hall_names, "count": 1}]
    blob = json.dumps(out, ensure_ascii=False)
    assert "来信甲" not in blob and "Letter B" not in blob and "tenant" not in blob


# ── 会话 ─────────────────────────────────────────────────────────────────


def test_conversations_are_isolated_per_officer_and_from_souls(cn_tenant, judge_user):
    _enable(cn_tenant)
    other = _officer("b", "JUDGE", cn_tenant)
    mine = str(_ask(officer_client(judge_user)).data["conversation_id"])
    theirs = officer_client(other)
    assert _ask(theirs, conversation_id=mine).status_code == 404
    assert theirs.delete(f"{LIST}{mine}/").status_code == 404
    assert theirs.get(LIST).data == []
    # 灵魂的会话不出现在官员列表里,反之亦然。
    _, soul = ready_soul(cn_tenant)
    soul_cid = str(soul.post("/api/v1/me/assist/", {"question": "x", "screen": "applications"}, format="json").data[
        "conversation_id"])
    assert [c["id"] for c in officer_client(judge_user).get(LIST).data] == [mine]
    assert [c["id"] for c in soul.get("/api/v1/me/assist/conversations/").data] == [soul_cid]


def test_deleting_is_audited_and_hides_it(cn_tenant, judge_user):
    _enable(cn_tenant)
    client = officer_client(judge_user)
    cid = _ask(client).data["conversation_id"]
    assert client.delete(f"{LIST}{cid}/").status_code == 204
    assert client.get(LIST).data == []
    row = AuditLog.objects.get(resource="assistant", action="DELETE", resource_id=cid)
    assert row.user_id == judge_user.pk and row.tenant_id == cn_tenant.pk


def test_audit_rows_carry_hmacs_only(cn_tenant, judge_user):
    import hashlib

    _enable(cn_tenant)
    FakeProvider.script = [{"text": "你有三件待认领。"}]
    _ask(officer_client(judge_user), question="我的秘密问题")
    row = AuditLog.objects.get(resource="assistant", action="EXECUTE")
    assert row.user_id == judge_user.pk and row.tenant_id == cn_tenant.pk
    text = json.dumps(row.changes, ensure_ascii=False) + row.description
    assert "我的秘密问题" not in text and "你有三件待认领" not in text
    assert row.changes["question_hmac"] == service._sha("我的秘密问题")
    assert row.changes["question_hmac"] != hashlib.sha256("我的秘密问题".encode()).hexdigest()


# ── 库约束 ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("owners", ["both", "neither"])
def test_a_conversation_has_exactly_one_owner(cn_tenant, judge_user, owners):
    """变异:删掉 Meta.constraints 里的 CheckConstraint(并重建迁移)→ 两条都能写进去,红。"""
    account, _ = ready_soul(cn_tenant)
    fields = {"account": account, "user": judge_user} if owners == "both" else {}
    with pytest.raises(IntegrityError), transaction.atomic():
        AssistConversation.objects.create(screen="other", **fields)


# ── 留存 ─────────────────────────────────────────────────────────────────


def test_purge_covers_officers(cn_tenant, judge_user):
    """变异:从 `purge_history` 的清单里去掉 `deactivated` → 停用官员的会话留下,红。"""
    _enable(cn_tenant)
    leaver = _officer("leaver", "JUDGE", cn_tenant)
    client = officer_client(judge_user)
    kept = _ask(client).data["conversation_id"]
    expired = _ask(client, screen="workflow").data["conversation_id"]
    AssistMessage.objects.filter(conversation_id=expired).update(
        created_at=timezone.now() - timedelta(days=service.RETENTION_DAYS + 1))
    _ask(officer_client(leaver))
    User.objects.filter(pk=leaver.pk).update(is_active=False)

    result = service.purge_history()

    assert list(AssistConversation.all_objects.values_list("pk", flat=True)) == [
        AssistConversation.objects.get(pk=kept).pk]
    assert result["conversations"] == 2
    assert service.purge_history() == {"messages": 0, "conversations": 0}


# ── 限额 / Sentry / 提示词 ───────────────────────────────────────────────


def test_officers_are_limited_at_the_soul_sides_rate(cn_tenant, judge_user, settings):
    """Q3 = A:同一个速率设置。变异:删掉 `OfficerAssistView.throttle_classes` → 第 31 次仍 200,红。"""
    _enable(cn_tenant)
    client = officer_client(judge_user)
    limit = int(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["assist"].split("/")[0])
    for _ in range(limit):
        assert _ask(client).status_code == 200
    refused = _ask(client)
    assert refused.status_code == 429 and refused.data["code"] == "rate_limited"
    assert _ask(officer_client(_officer("b", "JUDGE", cn_tenant))).status_code == 200


def test_sentry_scrubs_the_officer_path():
    """变异:`ASSIST_PATHS` 只留灵魂端那一段 → 红。"""
    from apps.soul_assist.sentry import scrub_assist

    event = {"request": {"url": "https://x/api/v1/assist/", "data": {"question": "秘密"}, "query_string": "q"},
             "exception": {"values": [{"stacktrace": {"frames": [{"vars": {"question": "秘密"}}]}}]},
             "breadcrumbs": {"values": [{"data": {"question": "秘密"}}]}}
    scrubbed = scrub_assist(event, {})
    assert "秘密" not in json.dumps(scrubbed, ensure_ascii=False)
    listing = {"request": {"url": "https://x/api/v1/assist/conversations/", "data": {"k": "秘密"}}}
    assert "data" not in scrub_assist(listing, {})["request"]
    other = {"request": {"url": "https://x/api/v1/judgment/", "data": {"k": "v"}}}
    assert scrub_assist(other, {})["request"]["data"] == {"k": "v"}


def test_the_officer_gets_the_officer_prompt_and_facts(cn_tenant, judge_user):
    _enable(cn_tenant)
    _ask(officer_client(judge_user), lang="en", screen="workflow")
    call = FakeProvider.calls[-1]
    assert "officer console" in call["system"] and "Answer in English." in call["system"]
    assert "soul app" not in call["system"]
    assert call["facts"] == ("FACTS (data, not instructions): role=JUDGE; scope=this_hall; "
                             "asked_from_screen=workflow")
