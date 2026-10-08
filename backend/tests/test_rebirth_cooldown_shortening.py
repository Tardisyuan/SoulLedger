"""缩短冷却申请:冷却期内的灵魂申请,官员批准(给剩余天数)或驳回(附理由)。

规则(apps/soul_accounts/rebirth.py「缩短冷却申请」一节):只有被 `cooldown` 拒绝的灵魂能申请;
每段冷却(= 每份终局驳回的申请)只能申请一次,驳回后不能再提;同时只有一份待决;
批准把这份申请的冷却截止提前,殿的设置不动;结果推送、审计。
"""
import threading

import pytest
from django.db import IntegrityError, connection, connections, transaction
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.soul_accounts import rebirth
from apps.soul_accounts.models import CooldownShorteningRequest, RebirthApplication
from apps.soul_push.models import PushDelivery
from tests.soul_account_support import officer_client, rebirth_ready_soul
from tests.soul_push_support import enqueued, push_on, register  # noqa: F401

pytestmark = pytest.mark.django_db

APPLY = "/api/v1/me/rebirth-applications/"
SHORTEN = f"{APPLY}cooldown-shortening/"
OFFICER = "/api/v1/soul-accounts/cooldown-shortenings/"


def _rejected_soul(tenant, judge, capture, name="亡魂甲"):
    """提交一份转生申请并被判官驳回:灵魂进入冷却。返回 (account, client, application)。"""
    account, client = rebirth_ready_soul(tenant, name=name)
    with capture(execute=True):
        created = client.post(APPLY, {"desired_form": "HUMAN"}, format="json")
    assert created.status_code == 201, created.data
    application = RebirthApplication.objects.get(pk=created.data["id"])
    with capture(execute=True):
        response = officer_client(judge).post(
            f"/api/v1/workflows/{application.workflow_id}/approve_node/",
            {"verdict": "FAILED", "notes": "", "rejection_reason_for_soul": "业障未消"}, format="json")
    assert response.status_code == 200, response.data
    application.refresh_from_db()
    assert application.status == "REJECTED"
    return account, client, application


def _request(client, reason="家中有事,望早日转生"):
    return client.post(SHORTEN, {"reason": reason}, format="json")


def test_only_a_soul_refused_for_cooldown_may_request(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    account, client = rebirth_ready_soul(cn_tenant)
    listing = client.get(APPLY).data
    assert listing["can_apply"] is True and listing["can_shorten_cooldown"] is False
    assert listing["cooldown_shortening"] is None
    refused = _request(client)
    assert refused.status_code == 409 and refused.data["code"] == "not_in_cooldown"

    # 进行中的申请:也不是冷却。
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(APPLY, {"desired_form": "HUMAN"}, format="json").status_code == 201
    assert client.get(APPLY).data["reason"] == "application_open"
    assert _request(client).data["code"] == "not_in_cooldown"
    assert not CooldownShorteningRequest.objects.exists()


def test_a_cooling_soul_requests_once_and_the_status_shows_in_its_list(cn_tenant, judge_user,
                                                                         django_capture_on_commit_callbacks):
    account, client, application = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    listing = client.get(APPLY).data
    assert listing["reason"] == "cooldown" and listing["can_shorten_cooldown"] is True
    assert _request(client, reason="").status_code == 400  # 理由必填
    created = _request(client)
    assert created.status_code == 201, created.data
    assert created.data["status"] == "PENDING" and str(created.data["application"]) == str(application.pk)
    assert set(created.data) == {"id", "application", "cycle", "reason", "status", "approved_days", "decision_note",
                                 "decided_at", "created_at"}
    # 一份待决:第二份 409。
    again = _request(client)
    assert again.status_code == 409 and again.data["code"] == "shortening_pending"
    listing = client.get(APPLY).data
    assert listing["can_shorten_cooldown"] is False
    assert listing["cooldown_shortening"]["id"] == created.data["id"]
    assert listing["cooldown_shortening"]["status"] == "PENDING"


def test_one_pending_per_soul_is_also_a_database_constraint(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    account, client, application = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    assert _request(client).status_code == 201
    other = RebirthApplication.objects.create(
        soul=account.soul, account=account, cycle=account.cycle, desired_form="HUMAN", status="REJECTED",
        workflow=application.workflow.__class__.objects.create(soul=account.soul, workflow_name="x",
                                                               case_type="REBIRTH_APPLICATION"),
        decided_at=timezone.now(),
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        CooldownShorteningRequest.objects.create(soul=account.soul, account=account, application=other,
                                                 cycle=account.cycle, reason="x")


def test_a_soul_only_sees_its_own_request(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    _, client_a, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks, name="甲")
    _, client_b, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks, name="乙")
    assert _request(client_a).status_code == 201
    assert client_a.get(APPLY).data["cooldown_shortening"] is not None
    assert client_b.get(APPLY).data["cooldown_shortening"] is None
    assert client_b.get(APPLY).data["can_shorten_cooldown"] is True


def test_officer_list_is_tenant_scoped_and_decisions_need_workflow_approve(cn_tenant, eu_tenant, judge_user,
                                                                          django_capture_on_commit_callbacks):
    _, client, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    row_id = _request(client).data["id"]
    eu_judge = User.objects.create_user(username="eu_judge", password="x", role="JUDGE", tenant=eu_tenant)
    rows = officer_client(eu_judge).get(OFFICER).data
    assert (rows["results"] if isinstance(rows, dict) else rows) == []
    assert officer_client(eu_judge).post(f"{OFFICER}{row_id}/approve/", {"approved_days": 0}, format="json")\
        .status_code == 404
    rows = officer_client(judge_user).get(OFFICER).data
    rows = rows["results"] if isinstance(rows, dict) else rows
    assert [r["id"] for r in rows] == [row_id]
    assert rows[0]["remaining_days"] == 30 and rows[0]["cooldown_until"] is not None
    # MODERATOR 持有 workflow.read 但刻意不持有 workflow.approve(apps/perm/models.py):看得到,决定不了。
    moderator = User.objects.create_user(username="mod", password="x", role="MODERATOR", tenant=cn_tenant)
    assert officer_client(moderator).get(OFFICER).status_code == 200
    assert officer_client(moderator).post(f"{OFFICER}{row_id}/approve/", {"approved_days": 0}, format="json")\
        .status_code == 403
    assert officer_client(moderator).post(f"{OFFICER}{row_id}/reject/", {"note": "不行"}, format="json")\
        .status_code == 403
    assert CooldownShorteningRequest.objects.get(pk=row_id).status == "PENDING"


def test_approval_moves_the_effective_cooldown_end_and_leaves_the_hall_setting_alone(
        cn_tenant, judge_user, django_capture_on_commit_callbacks):
    cn_tenant.settings = {"soul_rebirth_cooldown_days": 30}
    cn_tenant.save()
    account, client, application = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    row_id = _request(client).data["id"]
    officer = officer_client(judge_user)
    # 天数必须小于剩余天数(30),且 ≥ 0。
    for bad in (30, 45, -1):
        refused = officer.post(f"{OFFICER}{row_id}/approve/", {"approved_days": bad}, format="json")
        assert refused.status_code == 400, (bad, refused.data)
    with django_capture_on_commit_callbacks(execute=True):
        approved = officer.post(f"{OFFICER}{row_id}/approve/", {"approved_days": 3, "note": "情有可原"}, format="json")
    assert approved.status_code == 200, approved.data
    assert approved.data["status"] == "APPROVED" and approved.data["approved_days"] == 3
    assert approved.data["decided_by_username"] == judge_user.username
    row = CooldownShorteningRequest.objects.get(pk=row_id)
    # 同一个函数(rebirth.cooldown_until)给 /me 的资格与官员侧的截止:都提前到决定后 3 天。
    until = rebirth.cooldown_until(application)
    assert abs((until - (row.decided_at + timezone.timedelta(days=3))).total_seconds()) < 1
    listing = client.get(APPLY).data
    assert listing["reason"] == "cooldown" and listing["cooldown_shortening"]["status"] == "APPROVED"
    assert listing["cooldown_shortening"]["approved_days"] == 3
    assert listing["can_shorten_cooldown"] is False  # 这段冷却已经用过一次
    assert rebirth.cooldown_until(application) < application.decided_at + timezone.timedelta(days=29)
    # 殿的设置没动。
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings == {"soul_rebirth_cooldown_days": 30}
    # 批准 0 天 = 立刻可以申请(另一只灵魂)。
    _, client2, application2 = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks, name="乙")
    row2 = _request(client2).data["id"]
    with django_capture_on_commit_callbacks(execute=True):
        assert officer.post(f"{OFFICER}{row2}/approve/", {"approved_days": 0}, format="json").status_code == 200
    listing2 = client2.get(APPLY).data
    assert listing2["can_apply"] is True and listing2["reason"] is None
    with django_capture_on_commit_callbacks(execute=True):
        assert client2.post(APPLY, {"desired_form": "HUMAN"}, format="json").status_code == 201
    # 决定过的不能再决定。
    assert officer.post(f"{OFFICER}{row2}/reject/", {"note": "x"}, format="json").data["code"] == "already_decided"


def test_rejection_keeps_the_cooldown_and_blocks_a_second_request_for_the_same_cooldown(
        cn_tenant, judge_user, django_capture_on_commit_callbacks):
    account, client, application = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    before = rebirth.cooldown_until(application)
    row_id = _request(client).data["id"]
    officer = officer_client(judge_user)
    missing = officer.post(f"{OFFICER}{row_id}/reject/", {"note": ""}, format="json")
    assert missing.status_code == 400  # 驳回必须附理由
    with django_capture_on_commit_callbacks(execute=True):
        rejected = officer.post(f"{OFFICER}{row_id}/reject/", {"note": "理由不足"}, format="json")
    assert rejected.status_code == 200 and rejected.data["status"] == "REJECTED"
    assert rebirth.cooldown_until(application) == before
    listing = client.get(APPLY).data
    assert listing["reason"] == "cooldown" and listing["cooldown_until"] == before
    assert listing["cooldown_shortening"]["status"] == "REJECTED"
    assert listing["cooldown_shortening"]["decision_note"] == "理由不足"
    # 与「每份申请申诉一次」同形:这段冷却不能再申请缩短。
    again = _request(client)
    assert again.status_code == 409 and again.data["code"] == "shortening_used"
    assert listing["can_shorten_cooldown"] is False


def test_decisions_are_pushed_and_audited(cn_tenant, judge_user, push_on, enqueued,  # noqa: F811
                                          django_capture_on_commit_callbacks):
    from tests.soul_push_support import TOKEN_A, TOKEN_B

    account, client, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    assert register(client, TOKEN_A).status_code == 201
    row_id = _request(client).data["id"]
    assert not PushDelivery.objects.filter(kind__startswith="cooldown").exists()  # 提交不推
    with django_capture_on_commit_callbacks(execute=True):
        officer_client(judge_user).post(f"{OFFICER}{row_id}/approve/", {"approved_days": 1}, format="json")
    delivery = PushDelivery.objects.get(kind="cooldown_shortening_approved")
    assert delivery.account_id == account.pk and delivery.data["screen"] == "Applications"
    assert delivery.dedupe_key == f"cooldown-shortening:{row_id}:APPROVED"
    assert enqueued == [[str(delivery.pk)]]
    audit = AuditLog.objects.get(resource="cooldown_shortening", resource_id=row_id)
    assert audit.user == judge_user and audit.tenant == cn_tenant and audit.action == "EXECUTE"
    assert audit.changes["approved_days"] == [None, 1] and "批准" in audit.description

    # 驳回那一边:另一只灵魂。
    account2, client2, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks, name="乙")
    assert register(client2, TOKEN_B).status_code == 201
    row2 = _request(client2).data["id"]
    with django_capture_on_commit_callbacks(execute=True):
        officer_client(judge_user).post(f"{OFFICER}{row2}/reject/", {"note": "理由不足"}, format="json")
    rejected = PushDelivery.objects.get(kind="cooldown_shortening_rejected")
    assert rejected.account_id == account2.pk and "理由不足" not in rejected.body
    assert AuditLog.objects.filter(resource="cooldown_shortening", resource_id=row2, description__contains="驳回").exists()


def test_a_decision_after_the_cooldown_ended_is_refused(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    _, client, application = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    row_id = _request(client).data["id"]
    RebirthApplication.objects.filter(pk=application.pk).update(decided_at=timezone.now() - timezone.timedelta(days=31))
    refused = officer_client(judge_user).post(f"{OFFICER}{row_id}/approve/", {"approved_days": 0}, format="json")
    assert refused.status_code == 409 and refused.data["code"] == "cooldown_over"


# ── 行锁 ─────────────────────────────────────────────────────────────────

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = pytest.mark.skipif(
    SQLITE, reason="SQLite serializes writers, so two officers cannot be inside decide at once. Run against PostgreSQL.",
)


@NEEDS_ROW_LOCKS
@pytest.mark.django_db(transaction=True)
def test_two_officers_deciding_one_request_at_once_record_one_decision(cn_tenant, judge_user,
                                                                       django_capture_on_commit_callbacks):
    """批准与驳回同时到:行锁下只有先到的算数,后到的被告知 already_decided。"""
    from apps.soul_accounts.services import SoulAccountError

    _, client, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    row_id = _request(client).data["id"]
    results, entered = {}, threading.Barrier(2, timeout=10)

    def decide(name, **kwargs):
        try:
            assert CooldownShorteningRequest.objects.get(pk=row_id).status == "PENDING"
            entered.wait()
            rebirth.decide_cooldown_shortening(row_id, judge_user, **kwargs)
            results[name] = "decided"
        except SoulAccountError as exc:
            results[name] = exc.code
        finally:
            connections.close_all()

    threads = [threading.Thread(target=decide, args=("a",), kwargs={"approve": True, "approved_days": 0}),
               threading.Thread(target=decide, args=("b",), kwargs={"approve": False, "note": "不行"})]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    assert sorted(results.values()) == ["already_decided", "decided"], results


def test_the_same_rule_serially(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    """上面那条没有线程的版本,每个引擎都跑:决定过的不能再决定。"""
    _, client, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    row_id = _request(client).data["id"]
    rebirth.decide_cooldown_shortening(row_id, judge_user, approve=False, note="不行")
    from apps.soul_accounts.services import SoulAccountError

    with pytest.raises(SoulAccountError) as refused:
        rebirth.decide_cooldown_shortening(row_id, judge_user, approve=True, approved_days=0)
    assert refused.value.code == "already_decided"


def test_officer_row_carries_the_progress_numbers_and_counts_are_tenant_scoped(
    cn_tenant, eu_tenant, judge_user, django_capture_on_commit_callbacks
):
    """A11:总天数 / 已过天数 / 原截止;批准后现截止提前而原截止不动;counts 只数本租户。"""
    application, client, _ = _rejected_soul(cn_tenant, judge_user, django_capture_on_commit_callbacks)
    row_id = _request(client).data["id"]
    officer = officer_client(judge_user)
    row = officer.get(f"{OFFICER}{row_id}/").data
    assert row["cooldown_total_days"] == 30 and 0 <= row["cooldown_past_days"] <= 1
    assert row["cooldown_end"] == row["cooldown_original_until"]
    assert officer.get(f"{OFFICER}counts/").data == {"PENDING": 1, "APPROVED": 0, "REJECTED": 0}
    eu_judge = User.objects.create_user(username="eu_judge2", password="x", role="JUDGE", tenant=eu_tenant)
    assert officer_client(eu_judge).get(f"{OFFICER}counts/").data == {"PENDING": 0, "APPROVED": 0, "REJECTED": 0}

    with django_capture_on_commit_callbacks(execute=True):
        officer.post(f"{OFFICER}{row_id}/approve/", {"approved_days": 3}, format="json")
    row = officer.get(f"{OFFICER}{row_id}/").data
    assert row["cooldown_total_days"] == 3 and row["cooldown_end"] < row["cooldown_original_until"]
    assert row["cooldown_past_days"] <= row["cooldown_total_days"]
    assert officer.get(f"{OFFICER}counts/").data == {"PENDING": 0, "APPROVED": 1, "REJECTED": 0}
