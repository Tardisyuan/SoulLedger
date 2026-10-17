"""跨域审判的结束与取消(第四十批 W-a)。

* 取消:理由必填;只有召集人(建会审的人)或发起殿的管理员(ADMIN / 殿主);已结束 / 已取消答 409。
* 取消后席上各站只读(`sentence/` 拒收),原审判照常结案(`check_cross_judgment` 不挡)。
* 结束:与取消同一道权限(参与方 403);取消会通知席上各方(含理由)。
* 结束:说明随结论记下;详情的 `can_end` 只对能做的人为 true,结束后对谁都是 false。
"""
import pytest

from apps.authentication.models import User
from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, JudgmentStatus
from apps.judgment.models import Judgment, Verdict
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
CJ = "/api/v1/dispatch/cross-tenant-judgments/"


def _tenant(code):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": code})[0]


def _user(tenant, name, role="JUDGE"):
    return User.objects.create_user(username=name, password="x", role=role, tenant=tenant)


@pytest.fixture
def bench():
    cn, eg = _tenant("CN_DIYU"), _tenant("EG_DUAT")
    soul = Soul.objects.create(name="案主", tenant=cn, current_state=SoulState.JUDGING)
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn)
    convener = officer_client(_user(cn, "cj_convener"))
    resp = convener.post(CJ, {"title": "三殿会审", "description": "d", "judgment": str(case.pk)}, format="json")
    assert resp.status_code == 201, resp.data
    cj = CrossTenantJudgment.objects.get(pk=resp.data["id"])
    CrossTenantJudgmentParticipant.objects.create(judgment=cj, participant_tenant=eg, role="ADVISOR", tenant=eg)
    return {
        "cj": cj, "case": case, "cn": cn, "eg": eg,
        "convener": convener,
        "colleague": officer_client(_user(cn, "cj_colleague")),
        "moderator": officer_client(_user(cn, "cj_moderator", role="MODERATOR")),
        "participant": officer_client(_user(eg, "cj_eg_judge")),
    }


def _cancel(client, cj, body=None):
    return client.post(f"{CJ}{cj.pk}/cancel/", body if body is not None else {"reason": "原审判已撤回"}, format="json")


def test_the_convener_cancels_with_a_reason(bench):
    resp = _cancel(bench["convener"], bench["cj"])
    assert resp.status_code == 200, resp.data
    assert resp.data["status"] == JudgmentStatus.CANCELLED
    assert resp.data["cancel_reason"] == "原审判已撤回"
    assert resp.data["ended_by_name"] == "cj_convener"
    assert resp.data["can_end"] is False
    assert resp.data["conclusion_type"] is None


def test_a_reason_is_required(bench):
    for body in ({}, {"reason": "   "}):
        resp = _cancel(bench["convener"], bench["cj"], body)
        assert resp.status_code == 400, resp.data
    bench["cj"].refresh_from_db()
    assert bench["cj"].status == JudgmentStatus.PROPOSED


@pytest.mark.parametrize("who", ["colleague", "participant"])
def test_others_cannot_cancel(bench, who):
    resp = _cancel(bench[who], bench["cj"])
    assert resp.status_code == 403, resp.data
    bench["cj"].refresh_from_db()
    assert bench["cj"].status == JudgmentStatus.PROPOSED
    assert bench["cj"].cancel_reason == ""


def test_the_halls_admin_can_cancel(bench):
    assert _cancel(bench["moderator"], bench["cj"]).status_code == 200


def test_cancelling_twice_or_after_the_end_is_a_conflict(bench):
    assert _cancel(bench["convener"], bench["cj"]).status_code == 200
    again = _cancel(bench["convener"], bench["cj"])
    assert again.status_code == 409 and again.data["code"] == "not_cancellable"


def test_can_end_is_true_only_for_who_can_end(bench):
    url = f"{CJ}{bench['cj'].pk}/"
    assert bench["convener"].get(url).data["can_end"] is True
    assert bench["moderator"].get(url).data["can_end"] is True
    assert bench["colleague"].get(url).data["can_end"] is False
    assert bench["participant"].get(url).data["can_end"] is False


def test_after_cancel_the_seats_are_read_only(bench):
    seat = bench["cj"].participants.get()
    assert _cancel(bench["convener"], bench["cj"]).status_code == 200
    resp = bench["participant"].post(
        f"{CJ}{bench['cj'].pk}/sentence/",
        {"participant": str(seat.pk), "realm_code": "X", "sentence_years": 1},
        format="json",
    )
    assert resp.status_code == 400
    assert bench["cj"].participants.count() == 1, "cancelling dropped the seats"


def test_the_original_judgment_concludes_after_cancel(bench):
    from apps.sentence_plan.services import CrossJudgmentOpenError

    with pytest.raises(CrossJudgmentOpenError):
        bench["case"].conclude(Verdict.PASSED, "")
    assert _cancel(bench["convener"], bench["cj"]).status_code == 200
    bench["case"].conclude(Verdict.PASSED, "")
    bench["case"].refresh_from_db()
    assert bench["case"].is_final


def test_the_end_note_is_kept(bench):
    cj = bench["cj"]  # 只有顾问席:没有要先填的站
    assert bench["convener"].post(f"{CJ}{cj.pk}/activate/", {}, format="json").status_code == 200
    resp = bench["convener"].post(
        f"{CJ}{cj.pk}/conclude/", {"conclusion_type": "PASS", "note": "三殿意见一致"}, format="json",
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["conclusion_note"] == "三殿意见一致"
    assert resp.data["ended_by_name"] == "cj_convener"
    assert resp.data["cancel_reason"] == ""
    assert _cancel(bench["convener"], cj).status_code == 409


def test_a_participant_cannot_conclude(bench):
    cj = bench["cj"]
    assert bench["convener"].post(f"{CJ}{cj.pk}/activate/", {}, format="json").status_code == 200
    for who in ("participant", "colleague"):
        resp = bench[who].post(f"{CJ}{cj.pk}/conclude/", {"conclusion_type": "PASS"}, format="json")
        assert resp.status_code == 403, resp.data
    cj.refresh_from_db()
    assert cj.status == JudgmentStatus.ACTIVE


def test_the_halls_admin_can_conclude(bench):
    cj = bench["cj"]
    assert bench["convener"].post(f"{CJ}{cj.pk}/activate/", {}, format="json").status_code == 200
    resp = bench["moderator"].post(f"{CJ}{cj.pk}/conclude/", {"conclusion_type": "PASS"}, format="json")
    assert resp.status_code == 200, resp.data


def test_cancelling_tells_the_seated_tenants_with_the_reason(bench, django_capture_on_commit_callbacks):
    from apps.notifications.models import UserNotification

    with django_capture_on_commit_callbacks(execute=True):
        assert _cancel(bench["convener"], bench["cj"], {"reason": "原审判已撤回"}).status_code == 200
    row = UserNotification.objects.get(user__username="cj_eg_judge", notification_type="JUDGMENT_CONCLUDED")
    assert "三殿会审" in row.message and "原审判已撤回" in row.message
    assert row.params["kind"] == "cross_judgment_cancelled"


def test_a_refused_cancel_tells_no_one(bench, django_capture_on_commit_callbacks):
    from apps.notifications.models import UserNotification

    with django_capture_on_commit_callbacks(execute=True):
        assert _cancel(bench["participant"], bench["cj"]).status_code == 403
    assert not UserNotification.objects.filter(notification_type="JUDGMENT_CONCLUDED").exists()
