"""转生申请:复用审批工作流;一份进行中、申诉一次、冷却、前世只读、跨文明由判官初审决定。"""
import json
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.events.models import SoulEvent
from apps.notifications.models import UserNotification
from apps.soul_accounts.models import RebirthApplication, RebirthApplicationStatus
from apps.workflow.models import ApprovalWorkflow, CaseType
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

APPLY = "/api/v1/me/rebirth-applications/"


@pytest.fixture
def cn_admin(cn_tenant):
    return User.objects.create_user(username="yanluo", password="x", role="ADMIN", tenant=cn_tenant)


def _decide(officer, application, verdict, *, appeal=False, notes="", reason="", capture):
    """用官员的真实接口走完当前节点。驳回默认附一段给灵魂的理由。"""
    application.refresh_from_db()
    workflow = application.appeal_workflow if appeal else application.workflow
    if verdict not in ("PASSED", "CONFIRMED") and not reason:
        reason = "默认给灵魂的理由"
    with capture(execute=True):
        response = officer_client(officer).post(
            f"/api/v1/workflows/{workflow.pk}/approve_node/",
            {"verdict": verdict, "notes": notes, "rejection_reason_for_soul": reason}, format="json",
        )
    assert response.status_code == 200, response.data
    application.refresh_from_db()
    return application


def _submit(client, capture, form="HUMAN"):
    with capture(execute=True):
        response = client.post(APPLY, {"desired_form": form, "statement": "愿为人"}, format="json")
    return response


def test_submit_creates_a_rebirth_workflow_and_shows_only_the_role(cn_tenant, judge_user,
                                                                  django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    response = _submit(client, django_capture_on_commit_callbacks)
    assert response.status_code == 201, response.data
    application = RebirthApplication.objects.get(pk=response.data["id"])
    workflow = application.workflow
    assert workflow.case_type == CaseType.REBIRTH_APPLICATION and workflow.soul_id == account.soul_id
    assert [(n.approver_type, n.approver_role) for n in workflow.nodes.order_by("node_order")] == [
        ("ROLE", "JUDGE"), ("ROLE", "ADMIN")]
    assert response.data["status"] == "UNDER_REVIEW"
    assert response.data["current_step"] == {"node_type": "EVALUATION", "approver_role": "JUDGE",
                                             "is_appeal": False}
    assert set(response.data) == {
        "id", "cycle", "desired_form", "statement", "appeal_statement", "status", "cross_civilization",
        "rejection_reason", "decided_at", "first_rejection_reason", "first_decided_at", "current_step", "can_appeal",
        "created_at", "updated_at"}
    assert set(response.data["current_step"]) == {"node_type", "approver_role", "is_appeal"}
    assert SoulEvent.objects.filter(soul=account.soul, event_type="REBIRTH_APPLICATION_SUBMITTED").exists()


def test_only_one_open_application_at_a_time(cn_tenant, django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    assert _submit(client, django_capture_on_commit_callbacks).status_code == 201
    second = _submit(client, django_capture_on_commit_callbacks, form="DIVINE")
    assert second.status_code == 409 and second.data["code"] == "application_open"
    listing = client.get(APPLY).data
    assert listing["can_apply"] is False and listing["reason"] == "application_open"
    assert RebirthApplication.objects.filter(soul=account.soul).count() == 1


def test_the_open_application_rule_is_also_a_database_constraint(cn_tenant, django_capture_on_commit_callbacks):
    from django.db import IntegrityError, transaction

    account, client = ready_soul(cn_tenant)
    _submit(client, django_capture_on_commit_callbacks)
    existing = RebirthApplication.objects.get(soul=account.soul)
    with pytest.raises(IntegrityError), transaction.atomic():
        RebirthApplication.objects.create(
            soul=account.soul, account=account, cycle=account.cycle, desired_form="HUMAN",
            status=RebirthApplicationStatus.APPEALING,
            workflow=ApprovalWorkflow.objects.create(soul=account.soul, workflow_name="x",
                                                     case_type=CaseType.REBIRTH_APPLICATION),
        )
    assert existing.status == "UNDER_REVIEW"


def test_approval_flows_through_the_workflow_and_notifies_the_soul(cn_tenant, judge_user, cn_admin,
                                                                   django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    application = _decide(judge_user, application, "PASSED", capture=django_capture_on_commit_callbacks)
    assert application.status == "UNDER_REVIEW"
    assert client.get(f"{APPLY}{application.pk}/").data["current_step"]["approver_role"] == "ADMIN"
    application = _decide(cn_admin, application, "PASSED", capture=django_capture_on_commit_callbacks)
    assert application.status == "APPROVED" and application.decided_at is not None
    assert UserNotification.objects.filter(user=account.user, related_id=str(application.pk)).exists()
    assert SoulEvent.objects.filter(soul=account.soul, event_type="REBIRTH_STATUS_CHANGED").exists()
    assert client.get(APPLY).data["reason"] == "application_approved"


def test_appeal_once_then_cooldown(cn_tenant, judge_user, cn_admin, django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    application = _decide(judge_user, application, "FAILED", notes="内部备注:此魂可疑", reason="业障未消",
                          capture=django_capture_on_commit_callbacks)
    assert application.status == "REJECTED" and application.rejection_reason == "业障未消"
    detail = client.get(f"{APPLY}{application.pk}/").data
    assert detail["can_appeal"] is True and detail["rejection_reason"] == "业障未消"
    for url in (f"{APPLY}{application.pk}/", APPLY, "/api/v1/me/life/"):
        assert "内部备注" not in json.dumps(client.get(url).data, ensure_ascii=False, default=str), url
    # 驳回后立即重新提交:冷却中。
    again = _submit(client, django_capture_on_commit_callbacks)
    assert again.status_code == 409 and again.data["code"] == "cooldown"

    with django_capture_on_commit_callbacks(execute=True):
        appealed = client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "请复核"}, format="json")
    assert appealed.status_code == 200 and appealed.data["status"] == "APPEALING"
    assert appealed.data["current_step"] == {"node_type": "APPEAL", "approver_role": "JUDGE", "is_appeal": True}
    application.refresh_from_db()
    assert application.appeal_workflow.is_appeal and application.appeal_workflow.original_workflow_id == \
        application.workflow_id

    second_appeal = client.post(f"{APPLY}{application.pk}/appeal/", {}, format="json")
    assert second_appeal.status_code == 409 and second_appeal.data["code"] == "appeal_used"

    application = _decide(judge_user, application, "FAILED", appeal=True, notes="内部备注:申诉无新证",
                          reason="维持原判", capture=django_capture_on_commit_callbacks)
    assert application.status == "APPEAL_REJECTED" and application.rejection_reason == "维持原判"
    assert "内部备注" not in json.dumps(client.get(f"{APPLY}{application.pk}/").data, ensure_ascii=False)
    third = client.post(f"{APPLY}{application.pk}/appeal/", {}, format="json")
    assert third.status_code == 409 and third.data["code"] == "appeal_used"

    listing = client.get(APPLY).data
    assert listing["can_apply"] is False and listing["reason"] == "cooldown"
    until = listing["cooldown_until"]
    assert timedelta(days=29, hours=23) < until - timezone.now() <= timedelta(days=30)

    # 冷却按租户可配;过了冷却可以重新申请。
    cn_tenant.settings = {"soul_rebirth_cooldown_days": 7}
    cn_tenant.save()
    RebirthApplication.objects.filter(pk=application.pk).update(decided_at=timezone.now() - timedelta(days=8))
    assert _submit(client, django_capture_on_commit_callbacks).status_code == 201


def test_past_life_applications_are_read_only(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    application = _decide(judge_user, application, "FAILED", capture=django_capture_on_commit_callbacks)
    # 假装这份申请属于前世:本世账号不能替前世申诉。
    RebirthApplication.objects.filter(pk=application.pk).update(cycle=account.cycle + 1)
    response = client.post(f"{APPLY}{application.pk}/appeal/", {}, format="json")
    assert response.status_code == 403 and response.data["code"] == "past_life_read_only"


def test_terminal_cosmologies_and_wrong_states_cannot_apply(eu_tenant, cn_tenant,
                                                           django_capture_on_commit_callbacks):
    _, eu_client = ready_soul(eu_tenant, name="Virgil")
    response = _submit(eu_client, django_capture_on_commit_callbacks)
    assert response.status_code == 409 and response.data["code"] == "terminal_cosmology"
    _, settled = ready_soul(cn_tenant, name="已安息", state="SETTLED")
    assert _submit(settled, django_capture_on_commit_callbacks).data["code"] == "soul_state"
    assert _submit(settled, django_capture_on_commit_callbacks, form="OTHER").status_code == 400


def test_cross_civilization_is_decided_by_the_initial_reviewer_only(cn_tenant, judge_user, cn_admin,
                                                                    django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    url = f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/cross-civilization/"
    guardian = User.objects.create_user(username="g", password="x", role="GUARDIAN", tenant=cn_tenant)
    assert officer_client(guardian).post(url, {"cross_civilization": True}, format="json").status_code == 403
    # ADMIN 持有 workflow.approve,但不是初审节点指定的角色。
    refused = officer_client(cn_admin).post(url, {"cross_civilization": True}, format="json")
    assert refused.status_code == 403 and refused.data["code"] == "not_the_approver"

    decided = officer_client(judge_user).post(url, {"cross_civilization": True}, format="json")
    assert decided.status_code == 200 and decided.data["cross_civilization"] is True
    application.refresh_from_db()
    assert application.workflow.cross_civilization is True
    assert SoulEvent.objects.filter(soul=account.soul, event_type="REBIRTH_CROSS_CIV_DECIDED").exists()
    assert client.get(f"{APPLY}{application.pk}/").data["cross_civilization"] is True

    _decide(judge_user, application, "PASSED", capture=django_capture_on_commit_callbacks)
    late = officer_client(judge_user).post(url, {"cross_civilization": False}, format="json")
    assert late.status_code == 409 and late.data["code"] == "not_in_initial_review"


def test_officer_rebirth_list_is_tenant_scoped(cn_tenant, eu_tenant, judge_user,
                                               django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    _submit(client, django_capture_on_commit_callbacks)
    eu_judge = User.objects.create_user(username="eu_judge", password="x", role="JUDGE", tenant=eu_tenant)
    rows = officer_client(eu_judge).get("/api/v1/soul-accounts/rebirth-applications/").data
    rows = rows["results"] if isinstance(rows, dict) else rows
    assert rows == []
    rows = officer_client(judge_user).get("/api/v1/soul-accounts/rebirth-applications/").data
    rows = rows["results"] if isinstance(rows, dict) else rows
    assert len(rows) == 1


def test_rejecting_a_rebirth_application_requires_a_reason_for_the_soul(cn_tenant, judge_user,
                                                                      django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    url = f"/api/v1/workflows/{application.workflow_id}/approve_node/"
    for body in ({"verdict": "FAILED", "notes": "只有内部备注"},
                 {"verdict": "REJECTED", "rejection_reason_for_soul": "   "}):
        response = officer_client(judge_user).post(url, body, format="json")
        assert response.status_code == 400, body
    application.refresh_from_db()
    assert application.status == "UNDER_REVIEW"
    assert application.workflow.nodes.get(node_order=1).status == "PENDING", "被拒的请求不能留下决定"
    # 通过不需要理由。
    with django_capture_on_commit_callbacks(execute=True):
        assert officer_client(judge_user).post(url, {"verdict": "PASSED"}, format="json").status_code == 200


def test_other_workflows_do_not_require_the_soul_reason(cn_tenant, judge_user):
    from apps.souls.models import Soul
    from apps.workflow.models import ApprovalNode, NodeStatus

    soul = Soul.objects.create(name="普通案件", tenant=cn_tenant, current_state="JUDGING")
    workflow = ApprovalWorkflow.objects.create(soul=soul, workflow_name="x", tenant=cn_tenant, status="IN_PROGRESS")
    node = ApprovalNode.objects.create(workflow=workflow, node_name="n", node_order=1, approver_type="ROLE",
                                       approver_role="JUDGE", status=NodeStatus.PENDING)
    workflow.current_node = node
    workflow.save()
    response = officer_client(judge_user).post(f"/api/v1/workflows/{workflow.pk}/approve_node/",
                                               {"verdict": "FAILED"}, format="json")
    assert response.status_code == 200, response.data


OFFICER_KEYS = {
    "id", "soul", "soul_code", "soul_name", "account", "cycle", "desired_form", "statement", "appeal_statement",
    "status", "workflow", "appeal_workflow", "cross_civilization", "rejection_reason", "decided_at",
    "first_rejection_reason", "first_decided_at",
    "current_step", "can_appeal", "cooldown_until", "can_decide_cross_civilization", "created_at", "updated_at",
}


def test_officer_view_carries_the_same_derived_fields_as_me(cn_tenant, judge_user,
                                                            django_capture_on_commit_callbacks):
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    officer_url = f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/"
    officer = officer_client(judge_user)

    under_review = officer.get(officer_url).data
    assert set(under_review) == OFFICER_KEYS
    assert under_review["current_step"] == client.get(f"{APPLY}{application.pk}/").data["current_step"] == {
        "node_type": "EVALUATION", "approver_role": "JUDGE", "is_appeal": False}
    assert under_review["can_appeal"] is False and under_review["cooldown_until"] is None

    application = _decide(judge_user, application, "FAILED", notes="内部备注:不给灵魂看", reason="给灵魂的理由",
                          capture=django_capture_on_commit_callbacks)
    rejected = officer.get(officer_url).data
    me = client.get(f"{APPLY}{application.pk}/").data
    assert rejected["can_appeal"] is me["can_appeal"] is True
    assert rejected["current_step"] is None and me["current_step"] is None
    assert rejected["rejection_reason"] == "给灵魂的理由"
    assert "内部备注" not in json.dumps(rejected, ensure_ascii=False, default=str)
    until = rejected["cooldown_until"]
    assert until is not None and timedelta(days=29, hours=23) < until - timezone.now() <= timedelta(days=30)

    cn_tenant.settings = {"soul_rebirth_cooldown_days": 0}
    cn_tenant.save()
    assert officer.get(officer_url).data["cooldown_until"] is None

    with django_capture_on_commit_callbacks(execute=True):
        client.post(f"{APPLY}{application.pk}/appeal/", {}, format="json")
    appealing = officer.get(officer_url).data
    assert appealing["can_appeal"] is False
    assert appealing["current_step"] == {"node_type": "APPEAL", "approver_role": "JUDGE", "is_appeal": True}


def _cross_case_initial(cn_tenant, judge_user, capture):
    account, client = ready_soul(cn_tenant)
    return RebirthApplication.objects.get(pk=_submit(client, capture).data["id"]), client


def _cross_case_past_initial(cn_tenant, judge_user, capture):
    application, client = _cross_case_initial(cn_tenant, judge_user, capture)
    return _decide(judge_user, application, "PASSED", capture=capture), client


def _cross_case_appeal(cn_tenant, judge_user, capture):
    application, client = _cross_case_initial(cn_tenant, judge_user, capture)
    application = _decide(judge_user, application, "FAILED", capture=capture)
    with capture(execute=True):
        assert client.post(f"{APPLY}{application.pk}/appeal/", {}, format="json").status_code == 200
    application.refresh_from_db()
    return application, client


@pytest.mark.parametrize("stage,who,expected", [
    ("initial", "judge", (True, 200)),
    ("initial", "admin", (False, 403)),         # 持有 workflow.approve,不是初审节点的角色
    ("initial", "moderator", (False, 403)),     # 没有 workflow.approve
    ("past_initial", "judge", (False, 409)),
    ("appeal", "judge", (False, 409)),
])
def test_can_decide_cross_civilization_agrees_with_the_endpoint(stage, who, expected, cn_tenant, judge_user, cn_admin,
                                                                 django_capture_on_commit_callbacks):
    """字段与端点是同一个判定:字段说能,端点就 200;字段说不能,端点就拒绝。"""
    build = {"initial": _cross_case_initial, "past_initial": _cross_case_past_initial,
             "appeal": _cross_case_appeal}[stage]
    application, _ = build(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    user = {"judge": judge_user, "admin": cn_admin,
            "moderator": User.objects.create_user(username="mod", password="x", role="MODERATOR",
                                                  tenant=cn_tenant)}[who]
    base = f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/"
    field = officer_client(user).get(base).data["can_decide_cross_civilization"]
    listed = [row for row in _rows(officer_client(user).get("/api/v1/soul-accounts/rebirth-applications/").data)
              if row["id"] == str(application.pk)]
    response = officer_client(user).post(f"{base}cross-civilization/", {"cross_civilization": True}, format="json")
    assert (field, response.status_code) == expected
    assert [row["can_decide_cross_civilization"] for row in listed] == [field]
    if field:
        assert response.data["can_decide_cross_civilization"] is True


def _rows(data):
    return data["results"] if isinstance(data, dict) and "results" in data else data


def test_appeal_keeps_the_first_rejection_and_cooldown_starts_from_the_latest(
        cn_tenant, judge_user, cn_admin, django_capture_on_commit_callbacks):
    """申诉时首次驳回的理由与时间留档;申诉被驳回后两次理由都在;冷却起点是最近一次终局驳回。"""
    from django.utils.dateparse import parse_datetime

    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    application = _decide(judge_user, application, "FAILED", reason="业障未消",
                          capture=django_capture_on_commit_callbacks)
    first_at = timezone.now() - timedelta(days=10)
    RebirthApplication.objects.filter(pk=application.pk).update(decided_at=first_at)

    with django_capture_on_commit_callbacks(execute=True):
        appealed = client.post(f"{APPLY}{application.pk}/appeal/", {"statement": "请复核"}, format="json")
    assert appealed.status_code == 200
    officer_url = f"/api/v1/soul-accounts/rebirth-applications/{application.pk}/"
    for data in (client.get(f"{APPLY}{application.pk}/").data, officer_client(judge_user).get(officer_url).data):
        assert data["status"] == "APPEALING"
        assert data["first_rejection_reason"] == "业障未消" and parse_datetime(data["first_decided_at"]) == first_at
        assert data["rejection_reason"] == "" and data["decided_at"] is None

    application = _decide(judge_user, application, "FAILED", appeal=True, reason="维持原判",
                          capture=django_capture_on_commit_callbacks)
    for data in (client.get(f"{APPLY}{application.pk}/").data, officer_client(judge_user).get(officer_url).data):
        assert data["status"] == "APPEAL_REJECTED"
        assert (data["first_rejection_reason"], data["rejection_reason"]) == ("业障未消", "维持原判")
        assert parse_datetime(data["first_decided_at"]) == first_at < parse_datetime(data["decided_at"])
    until = officer_client(judge_user).get(officer_url).data["cooldown_until"]
    # 从申诉驳回算起约 30 天;若从首次驳回(10 天前)算,只剩约 20 天。
    assert timedelta(days=29, hours=23) < until - timezone.now() <= timedelta(days=30)
    listing = client.get(APPLY).data
    assert listing["reason"] == "cooldown" and listing["cooldown_until"] == until


def test_backfill_restores_the_first_decision_time_of_existing_appeals(cn_tenant, judge_user,
                                                                        django_capture_on_commit_callbacks):
    import importlib

    from django.apps import apps as django_apps

    migration = importlib.import_module("apps.soul_accounts.migrations.0002_rebirth_first_rejection")
    account, client = ready_soul(cn_tenant)
    application = RebirthApplication.objects.get(pk=_submit(client, django_capture_on_commit_callbacks).data["id"])
    application = _decide(judge_user, application, "FAILED", capture=django_capture_on_commit_callbacks)
    with django_capture_on_commit_callbacks(execute=True):
        client.post(f"{APPLY}{application.pk}/appeal/", {}, format="json")
    # 模拟旧代码留下的行:首次驳回没有留档。
    RebirthApplication.objects.filter(pk=application.pk).update(first_decided_at=None, first_rejection_reason="")
    application.refresh_from_db()

    migration.backfill(django_apps, None)

    application.refresh_from_db()
    assert application.workflow.completed_at is not None
    assert application.first_decided_at == application.workflow.completed_at
    assert application.first_rejection_reason == ""
