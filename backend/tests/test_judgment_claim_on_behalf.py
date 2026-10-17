"""Design 第四十批 O-a:管理员替别人「改派 / 放回 / 暂缓 / 取消暂缓」,原认领人收到一条带理由的通知;
以及同批后端的两件小事:灵魂详情不论账号权限都带编号(第四节 4),官员端待办多一组受刑计划变更请求(O-f)。

通知在提交之后才发(`transaction.on_commit`),所以每条都包在 `django_capture_on_commit_callbacks(execute=True)` 里。
"""
import pytest

from apps.notifications.models import UserNotification
from tests.soul_account_support import officer_client
from tests.test_judgment_claim import _case, _fresh, _post, world  # noqa: F401

TYPE = "JUDGMENT_CLAIM_CHANGED"
TODO = "/api/v1/officer-app/todo/"


def _notes(user):
    return list(UserNotification.objects.filter(notification_type=TYPE, user=user).order_by("pk"))


def _claimed_by_a(world):  # noqa: F811
    case = _case(world.cn, name="张三")
    assert _post(world.clients["a"], case, "claim").status_code == 200
    return case


@pytest.mark.django_db
class TestTheHolderHears:
    def test_reassign_tells_the_holder_who_took_it_where_and_why(self, world, django_capture_on_commit_callbacks):  # noqa: F811
        case = _claimed_by_a(world)
        world.users["mod"].display_name = "崔珏"
        world.users["mod"].save()
        with django_capture_on_commit_callbacks(execute=True):
            response = _post(world.clients["mod"], case, "reassign", {"to": world.users["b"].pk, "reason": "下周轮值"})
        assert response.status_code == 200, response.data
        assert _fresh(case).claimed_by_id == world.users["b"].pk
        [note] = _notes(world.users["a"])
        assert note.params["kind"] == "judgment_reassigned_away"
        assert note.params["reason"] == "下周轮值" and note.params["to"] == world.users["b"].username
        assert note.message == f"崔珏 把你手上的案件 张三 改派给了 {world.users['b'].username}。理由：下周轮值"
        assert (note.related_resource, note.related_id) == ("judgment", str(case.pk))
        # 接手的人不收这一条(他收的是别的),改派人自己也不收。
        assert _notes(world.users["b"]) == [] and _notes(world.users["mod"]) == []

    def test_release_for_someone_else_carries_the_reason(self, world, django_capture_on_commit_callbacks):  # noqa: F811
        case = _claimed_by_a(world)
        with django_capture_on_commit_callbacks(execute=True):
            assert _post(world.clients["mod"], case, "release", {"reason": "请假"}).status_code == 200
        [note] = _notes(world.users["a"])
        assert note.params["kind"] == "judgment_released_for_you" and note.params["reason"] == "请假"

    def test_defer_and_undefer_for_someone_else_both_tell_them(self, world, django_capture_on_commit_callbacks):  # noqa: F811
        case = _claimed_by_a(world)
        with django_capture_on_commit_callbacks(execute=True):
            assert _post(world.clients["mod"], case, "defer", {"reason": "等证据"}).status_code == 200
            assert _post(world.clients["mod"], case, "undefer", {"reason": "证据到了"}).status_code == 200
        kinds = [(n.params["kind"], n.params["reason"]) for n in _notes(world.users["a"])]
        assert kinds == [("judgment_deferred_for_you", "等证据"), ("judgment_undeferred_for_you", "证据到了")]

    def test_doing_it_to_your_own_case_tells_nobody(self, world, django_capture_on_commit_callbacks):  # noqa: F811
        case = _claimed_by_a(world)
        with django_capture_on_commit_callbacks(execute=True):
            assert _post(world.clients["a"], case, "defer", {"reason": "自己暂缓"}).status_code == 200
            assert _post(world.clients["a"], case, "undefer").status_code == 200
            assert _post(world.clients["a"], case, "release").status_code == 200
        assert UserNotification.objects.filter(notification_type=TYPE).count() == 0

    def test_the_web_reassign_without_a_reason_still_tells_them(self, world, django_capture_on_commit_callbacks):  # noqa: F811
        """网页的改派不带理由:通知照发,理由写「—」,不留一个空着的「理由：」。"""
        case = _claimed_by_a(world)
        with django_capture_on_commit_callbacks(execute=True):
            assert _post(world.clients["mod"], case, "reassign", {"to": world.users["b"].pk}).status_code == 200
        [note] = _notes(world.users["a"])
        assert note.params["reason"] == "—"

    def test_a_judge_still_cannot_act_on_a_colleagues_case(self, world):  # noqa: F811
        case = _claimed_by_a(world)
        assert _post(world.clients["b"], case, "release", {"reason": "x"}).status_code == 403
        assert _post(world.clients["b"], case, "reassign", {"to": world.users["b"].pk, "reason": "x"}).status_code == 403
        assert _fresh(case).claimed_by_id == world.users["a"].pk

    def test_a_reason_longer_than_the_column_is_refused(self, world):  # noqa: F811
        case = _claimed_by_a(world)
        assert _post(world.clients["mod"], case, "release", {"reason": "x" * 501}).status_code == 400
        assert _fresh(case).claimed_by_id == world.users["a"].pk

    def test_the_request_names_who_asked(self, world):  # noqa: F811
        case = _claimed_by_a(world)
        world.users["a"].display_name = "王判官"
        world.users["a"].save()
        _post(world.clients["a"], case, "request-reassign", {"reason": "轮值"})
        body = world.clients["mod"].get(f"/api/v1/judgment/{case.pk}/").data
        assert body["reassign_requested_by_name"] == "王判官" and body["reassign_reason"] == "轮值"


@pytest.mark.django_db
def test_the_soul_detail_carries_the_code_without_account_permissions(world):  # noqa: F811
    from apps.souls.models import Soul
    from apps.souls.serializers import SoulSerializer

    soul = _case(world.cn).soul
    Soul.objects.filter(pk=soul.pk).update(soul_code="S00420031")
    soul.refresh_from_db()
    assert SoulSerializer(soul, context={}).data["soul_code"] == "S00420031"
    fresh = _case(world.cn).soul
    assert SoulSerializer(fresh, context={}).data["soul_code"] is None


@pytest.mark.django_db
def test_sentence_change_requests_are_a_todo_group_of_their_own(world):  # noqa: F811
    from apps.officer_app import todo
    from apps.sentence_plan.models import SentencePlan, SentencePlanRequest, SentencePlanStatus
    from apps.souls.models import Soul, SoulState

    soul = Soul.objects.create(name="李四", tenant=world.cn, current_state=SoulState.DISPOSED)
    plan = SentencePlan.objects.create(soul=soul, tenant=world.cn, status=SentencePlanStatus.ACTIVE)
    req = SentencePlanRequest.objects.create(plan=plan, from_tenant_code="EU_HEAVEN_HELL", kind="AMEND")
    other = SentencePlan.objects.create(
        soul=Soul.objects.create(name="王五", tenant=world.cn, current_state=SoulState.DISPOSED),
        tenant=world.cn, status=SentencePlanStatus.ACTIVE)
    SentencePlanRequest.objects.create(plan=other, from_tenant_code="X", kind="REOPEN", status="REJECTED")

    body = officer_client(world.users["a"]).get(TODO).data
    group = body["sentence_changes"]
    assert group["count"] == 1
    [item] = group["items"]
    assert (item["kind"], item["id"], item["title"], item["request_kind"]) == ("sentence_change", str(req.pk), "李四", "AMEND")
    # 计入角标(`total()`):就是各组之和,除了未分配的书信。
    assert todo.total(world.users["a"]) == sum(g["count"] for f, g in body.items() if f != "unassigned_letters")
    # 别的殿看不到,也没有 `judgment.execute` 的人看不到。
    assert officer_client(world.users["eu_judge"]).get(TODO).data["sentence_changes"]["count"] == 0
    assert officer_client(world.users["viewer"]).get(TODO).data["sentence_changes"]["count"] == 0
