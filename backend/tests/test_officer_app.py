"""官员端 App 的后端:免选殿登录、「待我处理」、详情、决定失败码、加签候选人、推送。

设计见 docs/design-handoff/v3-pages/A13-officer-app.md。
"""
import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.authentication.serializers import OfficerTokenObtainPairSerializer
from apps.officer_app import push
from apps.officer_app.models import OfficerPushDevice
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
from tests.soul_account_support import dead_soul, officer_client, rebirth_ready_soul
from tests.soul_push_support import FakeSender, push_on  # noqa: F401

pytestmark = pytest.mark.django_db

LOGIN = "/api/v1/auth/officer-login/"
TODO = "/api/v1/officer-app/todo/"
TOKEN = "ExponentPushToken[officer0000000000000a]"


@pytest.fixture(autouse=True)
def _clear_login_counters():
    from django.core.cache import cache

    cache.clear()


def _login(username, password, **extra):
    return APIClient().post(LOGIN, {"username": username, "password": password, **extra}, format="json")


def _plain_workflow(tenant, role="JUDGE", name="普通审批"):
    soul = dead_soul(tenant, name="审批灵魂")
    wf = ApprovalWorkflow.objects.create(soul=soul, workflow_name=name, case_type="STANDARD",
                                         status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=tenant)
    node = ApprovalNode.objects.create(workflow=wf, node_name="初审", node_order=1, node_type="EVALUATION",
                                       approver_type="ROLE", approver_role=role, status=NodeStatus.PENDING,
                                       activated_at=timezone.now())
    wf.current_node = node
    wf.save(update_fields=["current_node"])
    return wf, node


# ── 登录 ────────────────────────────────────────────────────────────────


def test_login_finds_the_hall_from_the_account(judge_user):
    response = _login("judge", "judge123")
    assert response.status_code == 200, response.data
    assert response.data["user"]["tenant"]["code"] == "CN_DIYU"
    assert response.data["access"] and response.data["refresh"]


def test_wrong_password_and_unknown_user_answer_the_same(judge_user):
    wrong, unknown = _login("judge", "nope"), _login("nobody", "nope")
    assert wrong.status_code == unknown.status_code == 401
    assert {k: v for k, v in wrong.data.items() if k != "remaining_attempts"} == \
        {k: v for k, v in unknown.data.items() if k != "remaining_attempts"}


def test_a_soul_account_is_refused_with_the_generic_error(cn_tenant):
    User.objects.create_user(username="soul1", password="pw-soul-1", role="SOUL", tenant=cn_tenant)
    refused, wrong = _login("soul1", "pw-soul-1"), _login("soul1", "bad")
    assert refused.status_code == 401
    assert refused.data["detail"] == wrong.data["detail"]


def test_login_is_logged_and_throttled_like_the_web_login(judge_user):
    from apps.authentication.models import LoginLog

    assert _login("judge", "judge123").status_code == 200
    assert _login("judge", "bad").status_code == 401
    assert list(LoginLog.objects.order_by("id").values_list("status", flat=True)) == ["SUCCESS", "FAILED"]
    for _ in range(5):
        _login("judge", "bad")
    assert _login("judge", "judge123").status_code == 429


def test_a_tenant_code_hint_that_does_not_match_is_the_generic_failure(judge_user):
    assert _login("judge", "judge123", tenant_code="EU_HEAVEN_HELL").status_code == 401
    assert _login("judge", "judge123", tenant_code="CN_DIYU").status_code == 200


def test_several_halls_with_a_matching_password_list_only_those_halls(monkeypatch, cn_tenant, eu_tenant):
    # username 现在全局唯一,所以多殿同名在库里造不出来 —— 用查找缝合成两个同名账号。
    a = User.objects.create_user(username="dup_a", password="same-pw-1", role="JUDGE", tenant=cn_tenant)
    b = User.objects.create_user(username="dup_b", password="same-pw-1", role="JUDGE", tenant=eu_tenant)
    c = User.objects.create_user(username="dup_c", password="other-pw", role="JUDGE", tenant=cn_tenant)
    monkeypatch.setattr(OfficerTokenObtainPairSerializer, "accounts_named", staticmethod(lambda _u: [a, b, c]))

    ambiguous = _login("dup", "same-pw-1")
    assert ambiguous.status_code == 409
    assert ambiguous.data["code"] == "hall_required"
    assert {h["code"] for h in ambiguous.data["halls"]} == {"CN_DIYU", "EU_HEAVEN_HELL"}
    assert all(set(h) == {"code", "display_name"} for h in ambiguous.data["halls"])

    assert _login("dup", "same-pw-1", tenant_code="EU_HEAVEN_HELL").data["user"]["id"] == b.pk
    # 密码都不对:不透露任何殿。
    nothing = _login("dup", "wrong")
    assert nothing.status_code == 401 and "halls" not in nothing.data


def test_an_officer_with_2fa_gets_the_pending_token_step_after_the_hall_is_found(judge_user):
    from tests.test_officer_mfa import _enable

    _enable(judge_user)
    wrong = _login("judge", "bad")
    assert wrong.status_code == 401 and "pending_token" not in wrong.data
    step = _login("judge", "judge123")
    assert step.status_code == 200
    assert step.data["mfa_required"] is True and step.data["pending_token"]
    assert "access" not in step.data and "refresh" not in step.data


def test_the_hall_choice_comes_before_the_second_step(monkeypatch, cn_tenant, eu_tenant):
    from tests.test_officer_mfa import _enable

    a = User.objects.create_user(username="m_a", password="same-pw-2", role="JUDGE", tenant=cn_tenant)
    b = User.objects.create_user(username="m_b", password="same-pw-2", role="JUDGE", tenant=eu_tenant)
    _enable(b)
    monkeypatch.setattr(OfficerTokenObtainPairSerializer, "accounts_named", staticmethod(lambda _u: [a, b]))
    assert _login("m", "same-pw-2").status_code == 409
    assert _login("m", "same-pw-2", tenant_code="EU_HEAVEN_HELL").data["mfa_required"] is True
    assert "access" in _login("m", "same-pw-2", tenant_code="CN_DIYU").data


# ── 待我处理 ────────────────────────────────────────────────────────────


def test_todo_lists_the_four_kinds_scoped_to_the_hall_and_the_role(cn_tenant, eu_tenant, judge_user,
                                                                   django_capture_on_commit_callbacks):
    wf, node = _plain_workflow(cn_tenant)
    _plain_workflow(cn_tenant, role="ADMIN", name="别人的节点")
    _plain_workflow(eu_tenant, name="别殿的节点")
    _, soul_client = rebirth_ready_soul(cn_tenant, name="转生甲")
    with django_capture_on_commit_callbacks(execute=True):
        assert soul_client.post("/api/v1/me/rebirth-applications/", {"desired_form": "HUMAN"}, format="json")\
            .status_code == 201

    data = officer_client(judge_user).get(TODO).data
    assert data["approvals"]["count"] == 1
    assert data["approvals"]["items"][0]["target"] == {"kind": "approval", "id": str(wf.pk)}
    assert data["approvals"]["items"][0]["node_name"] == "初审"
    # 转生申请的工作流只算转生申请,不在审批节点里重复。
    assert data["rebirths"]["count"] == 1
    assert data["rebirths"]["items"][0]["kind"] == "rebirth"
    assert data["cooldowns"]["count"] == 0 and data["reassignments"]["count"] == 0

    viewer = User.objects.create_user(username="v", password="x", role="VIEWER", tenant=cn_tenant)
    empty = officer_client(viewer).get(TODO).data
    assert [g["count"] for g in empty.values()] == [0, 0, 0, 0]


def test_todo_counts_dispatch_proposals_for_the_target_hall(cn_tenant, eu_tenant, judge_user):
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    soul = dead_soul(eu_tenant, name="待调拨")
    record = DispatchRecord.objects.create(source_tenant=eu_tenant, target_tenant=cn_tenant, soul=soul,
                                           status=DispatchStatus.PROPOSED, tenant=eu_tenant)
    data = officer_client(judge_user).get(TODO).data
    assert [i["id"] for i in data["reassignments"]["items"]] == [str(record.pk)]
    eu_judge = User.objects.create_user(username="eu_j", password="x", role="JUDGE", tenant=eu_tenant)
    assert officer_client(eu_judge).get(TODO).data["reassignments"]["count"] == 0


def test_a_soul_token_cannot_read_the_officer_app(cn_tenant):
    _, client = rebirth_ready_soul(cn_tenant)
    assert client.get(TODO).status_code in (401, 403)


# ── 单条详情:还能不能处理 / 谁处理了 ───────────────────────────────────


def test_item_detail_says_actionable_then_who_handled_it(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)
    other = User.objects.create_user(username="judge2", password="x", role="JUDGE", tenant=cn_tenant,
                                     display_name="乙判官")
    url = f"/api/v1/officer-app/items/approval/{wf.pk}/"
    mine = officer_client(judge_user).get(url).data
    assert mine["actionable"] is True and mine["state"] == "actionable" and mine["node_id"] == str(node.pk)

    done = officer_client(other).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                      {"node_id": str(node.pk), "verdict": "PASSED"}, format="json")
    assert done.status_code == 200, done.data
    after = officer_client(judge_user).get(url).data
    assert after["actionable"] is False and after["state"] == "already_handled"
    assert after["handled_by"] == {"id": other.pk, "name": "乙判官"}


def test_item_detail_is_404_outside_the_hall(cn_tenant, eu_tenant):
    wf, _ = _plain_workflow(cn_tenant)
    eu_judge = User.objects.create_user(username="eu_j2", password="x", role="JUDGE", tenant=eu_tenant)
    assert officer_client(eu_judge).get(f"/api/v1/officer-app/items/approval/{wf.pk}/").status_code == 404
    assert officer_client(eu_judge).get(f"/api/v1/officer-app/items/nonsense/{wf.pk}/").status_code == 404


# ── 决定失败码 ──────────────────────────────────────────────────────────


def test_reject_without_a_reason_is_reason_required_only_when_the_app_asks(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)
    client = officer_client(judge_user)
    url = f"/api/v1/workflows/{wf.pk}/approve_node/"
    blank = client.post(url, {"node_id": str(node.pk), "verdict": "REJECTED", "notes": "  ",
                              "require_reason": True}, format="json")
    assert blank.status_code == 400 and blank.data["code"] == "reason_required"
    node.refresh_from_db()
    assert node.status == NodeStatus.PENDING
    # 桌面端不传 require_reason:行为不变。
    assert client.post(url, {"node_id": str(node.pk), "verdict": "REJECTED"}, format="json").status_code == 200


def test_a_second_decision_gets_already_handled_with_who(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)
    other = User.objects.create_user(username="judge3", password="x", role="JUDGE", tenant=cn_tenant,
                                     display_name="丙判官")
    assert officer_client(other).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                      {"node_id": str(node.pk), "verdict": "PASSED"}, format="json").status_code == 200
    late = officer_client(judge_user).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                           {"node_id": str(node.pk), "verdict": "PASSED"}, format="json")
    assert late.status_code == 400
    assert late.data["code"] == "already_handled" and late.data["handled_by"]["name"] == "丙判官"


def test_a_timed_out_node_is_deadline_passed(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)
    node.status, node.timed_out_at = NodeStatus.REJECTED, timezone.now()  # 超时自动驳回:无人决定
    node.save()
    late = officer_client(judge_user).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                           {"node_id": str(node.pk), "verdict": "PASSED"}, format="json")
    assert late.data["code"] == "deadline_passed"
    assert officer_client(judge_user).get(f"/api/v1/officer-app/items/approval/{wf.pk}/").data["state"] \
        == "deadline_passed"


def test_a_node_that_is_no_longer_mine_is_permission_changed(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant, role="ADMIN")
    refused = officer_client(judge_user).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                              {"node_id": str(node.pk), "verdict": "PASSED"}, format="json")
    assert refused.status_code == 403 and refused.data["code"] == "permission_changed"


# ── 加签候选人:只限本殿 ─────────────────────────────────────────────────


def test_signer_candidates_are_the_same_hall_only(cn_tenant, eu_tenant, judge_user):
    mate = User.objects.create_user(username="mate", password="x", role="JUDGE", tenant=cn_tenant, display_name="同殿")
    User.objects.create_user(username="stranger", password="x", role="JUDGE", tenant=eu_tenant)
    User.objects.create_user(username="ghost", password="x", role="SOUL", tenant=cn_tenant)
    rows = officer_client(judge_user).get("/api/v1/officer-app/signer-candidates/").data
    assert [r["id"] for r in rows] == [mate.pk]
    assert officer_client(judge_user).get("/api/v1/officer-app/signer-candidates/?q=zzz").data == []


# ── 推送 ────────────────────────────────────────────────────────────────


def test_register_and_unregister_a_device(judge_user):
    client = officer_client(judge_user)
    body = {"token": TOKEN, "platform": "IOS"}
    assert client.post("/api/v1/officer-app/push-tokens/", body, format="json").status_code == 201
    assert client.post("/api/v1/officer-app/push-tokens/", body, format="json").status_code == 200
    assert client.post("/api/v1/officer-app/push-tokens/", {"token": "bad", "platform": "IOS"},
                       format="json").status_code == 400
    assert client.post("/api/v1/officer-app/push-tokens/unregister/", {"token": TOKEN}, format="json")\
        .status_code == 204
    assert not OfficerPushDevice.objects.get(token=TOKEN).is_active


def test_a_token_moves_to_the_officer_who_registers_it_last(cn_tenant, judge_user):
    other = User.objects.create_user(username="j9", password="x", role="JUDGE", tenant=cn_tenant)
    push.register_device(judge_user, TOKEN, "IOS")
    push.register_device(other, TOKEN, "ANDROID")
    assert OfficerPushDevice.objects.get(token=TOKEN).user_id == other.pk
    # 别人注销不了不属于自己的 token。
    push.unregister_device(judge_user, TOKEN)
    assert OfficerPushDevice.objects.get(token=TOKEN).is_active


def test_the_lock_screen_text_is_a_bare_count(cn_tenant, judge_user, push_on):  # noqa: F811
    _plain_workflow(cn_tenant, name="机密案由")
    _plain_workflow(cn_tenant, name="另一件")
    push.register_device(judge_user, TOKEN, "IOS")
    assert push.send_to_user(judge_user, sender=FakeSender()) == 1
    (message,) = FakeSender.batches[0]
    assert message["body"] == "有 2 件待你处理" and message["data"] == {"category": "officer_todo"}
    assert "机密" not in str(message) and "审批灵魂" not in str(message)


def test_nothing_waiting_means_no_push(cn_tenant, judge_user, push_on):  # noqa: F811
    push.register_device(judge_user, TOKEN, "IOS")
    assert push.send_to_user(judge_user, sender=FakeSender()) == 0
    assert FakeSender.batches == []


def test_an_unregistered_device_is_switched_off(cn_tenant, judge_user, push_on):  # noqa: F811
    _plain_workflow(cn_tenant)
    push.register_device(judge_user, TOKEN, "IOS")
    FakeSender.script = [lambda msgs: [{"status": "error", "details": {"error": "DeviceNotRegistered"}}]]
    push.send_to_user(judge_user, sender=FakeSender())
    assert not OfficerPushDevice.objects.get(token=TOKEN).is_active


def test_a_new_node_for_a_role_queues_a_push_for_the_officers_with_devices(
        cn_tenant, judge_user, monkeypatch, django_capture_on_commit_callbacks):
    sent = []
    monkeypatch.setattr(push.send_todo_push, "delay", lambda ids: sent.append(list(ids)))
    push.register_device(judge_user, TOKEN, "IOS")
    User.objects.create_user(username="no_device", password="x", role="JUDGE", tenant=cn_tenant)
    wf, node = _plain_workflow(cn_tenant)
    from apps.workflow.services import WorkflowService

    with django_capture_on_commit_callbacks(execute=True):
        WorkflowService.announce(wf, created=True)
    assert sent == [[judge_user.pk]]


def test_soul_push_tables_are_untouched_by_officer_devices(judge_user):
    from apps.soul_push.models import PushDevice

    push.register_device(judge_user, TOKEN, "IOS")
    assert PushDevice.objects.count() == 0
