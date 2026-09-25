"""殿司收件箱「标给同僚」(`apps/chat/inbox.py::assign`)。

会话不换殿(2026-09-25 决定):经办人只能是**收件殿司**里持有 `soul_inbox.reply` 的在职官员,
规则与审判改派同一个函数(`apps/judgment/claims.py::is_assignable`)。经办人是殿司共享的 ——
与未读 / 归档 / 草稿那些私人状态相反。

租户隔离用非 ADMIN 测:ADMIN 绕过租户范围,看不出隔离是否在起作用。
"""
import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.chat.models import Conversation, ConversationKind
from apps.notifications.models import UserNotification
from tests.soul_account_support import dead_soul, officer_client

pytestmark = pytest.mark.django_db

INBOX = "/api/v1/chat/inbox/"


def _officer(tenant, username, role="MODERATOR", display_name=""):
    return User.objects.create_user(
        username=username, password="x", role=role, tenant=tenant, display_name=display_name or username
    )


def _letter(tenant, name="甲", **fields):
    soul = dead_soul(tenant, name=name)
    return Conversation.objects.create(
        kind=ConversationKind.OFFICER_INBOX, room_id=f"!{name}:x", soul_a=soul, tenant=tenant,
        last_from="soul", last_soul_message_at=timezone.now(), last_message_at=timezone.now(), **fields,
    )


def _ids(api, **params):
    response = api.get(INBOX, params)
    assert response.status_code == 200, response.data
    return {r["id"] for r in response.data["results"]}


@pytest.fixture
def hall(cn_tenant, eu_tenant):
    class Hall:
        pass

    h = Hall()
    h.me = _officer(cn_tenant, "cui", display_name="崔珏")
    h.colleague = _officer(cn_tenant, "zhong", display_name="钟馗")
    h.judge = _officer(cn_tenant, "judge_only", role="JUDGE")       # 同殿,但没有 soul_inbox.reply
    h.foreign = _officer(eu_tenant, "minos", display_name="Minos")   # 能回信,但在别的殿司
    h.letter = _letter(cn_tenant)
    h.api = officer_client(h.me)
    h.colleague_api = officer_client(h.colleague)
    h.eu_api = officer_client(h.foreign)
    return h


def _assign(api, conversation, user_id):
    return api.post(f"{INBOX}{conversation.pk}/assign/", {"user_id": user_id}, format="json")


def test_assigning_a_colleague_is_shared_and_lands_in_their_folder(hall):
    response = _assign(hall.api, hall.letter, hall.colleague.pk)
    assert response.status_code == 200, response.data
    assert response.data["assignee"] == {"user_id": hall.colleague.pk, "display_name": "钟馗"}
    # 殿司共享:另一位官员看到的是同一个经办人。
    row = next(r for r in hall.colleague_api.get(INBOX).data["results"] if r["id"] == str(hall.letter.pk))
    assert row["assignee"]["user_id"] == hall.colleague.pk
    assert _ids(hall.colleague_api, folder="assigned_to_me") == {str(hall.letter.pk)}
    assert _ids(hall.api, folder="assigned_to_me") == set()
    assert hall.colleague_api.get(f"{INBOX}folders/").data["assigned_to_me"] == 1
    assert hall.api.get(f"{INBOX}folders/").data["assigned_to_me"] == 0


def test_the_assignee_is_notified_through_the_officer_notification_path(hall):
    _assign(hall.api, hall.letter, hall.colleague.pk)
    note = UserNotification.objects.get(user=hall.colleague, notification_type="SOUL_INBOX_ASSIGNED")
    assert note.params == {"soul": "甲", "by": "崔珏"}
    assert "甲" in note.message and "崔珏" in note.message
    assert (note.related_resource, note.related_id) == ("soul_inbox", str(hall.letter.pk))
    assert not UserNotification.objects.filter(user=hall.me).exists()


def test_taking_it_yourself_sends_no_notification(hall):
    assert _assign(hall.api, hall.letter, hall.me.pk).status_code == 200
    assert not UserNotification.objects.filter(notification_type="SOUL_INBOX_ASSIGNED").exists()
    assert _ids(hall.api, folder="assigned_to_me") == {str(hall.letter.pk)}


@pytest.mark.parametrize("who", ["foreign", "judge", "soul", "missing", "inactive"])
def test_an_invalid_assignee_is_a_400_and_nothing_is_written(hall, cn_tenant, who):
    if who == "soul":
        target_id = User.objects.create_user(username="s", password="x", role="SOUL", tenant=cn_tenant).pk
    elif who == "missing":
        target_id = 999_999
    elif who == "inactive":
        target = _officer(cn_tenant, "retired")
        User.objects.filter(pk=target.pk).update(is_active=False)
        target_id = target.pk
    else:
        target_id = getattr(hall, who).pk
    response = _assign(hall.api, hall.letter, target_id)
    assert response.status_code == 400, response.data
    assert response.data["code"] == "invalid_assignee"
    hall.letter.refresh_from_db()
    assert hall.letter.assignee_id is None
    assert not UserNotification.objects.exists()


def test_another_hall_cannot_see_or_assign_the_letter(hall):
    assert _assign(hall.eu_api, hall.letter, hall.foreign.pk).status_code == 404
    assert hall.eu_api.get(f"{INBOX}{hall.letter.pk}/assignable/").status_code == 404
    assert hall.eu_api.post(f"{INBOX}{hall.letter.pk}/unassign/").status_code == 404
    hall.letter.refresh_from_db()
    assert hall.letter.assignee_id is None


def test_the_picker_lists_exactly_who_assign_accepts(hall):
    listed = hall.api.get(f"{INBOX}{hall.letter.pk}/assignable/")
    assert listed.status_code == 200
    ids = {row["user_id"] for row in listed.data}
    assert ids == {hall.me.pk, hall.colleague.pk}
    assert hall.judge.pk not in ids and hall.foreign.pk not in ids
    for user_id in ids:
        assert _assign(hall.api, hall.letter, user_id).status_code == 200


def test_unassign_clears_it_for_everyone(hall):
    _assign(hall.api, hall.letter, hall.colleague.pk)
    response = hall.api.post(f"{INBOX}{hall.letter.pk}/unassign/")
    assert response.status_code == 200 and response.data["assignee"] is None
    assert _ids(hall.colleague_api, folder="assigned_to_me") == set()


def test_a_closed_letter_takes_no_assignee(hall):
    Conversation.objects.filter(pk=hall.letter.pk).update(closed_at=timezone.now())
    response = _assign(hall.api, hall.letter, hall.colleague.pk)
    assert response.status_code == 409 and response.data["code"] == "closed"


def test_assigning_needs_soul_inbox_reply(hall, cn_tenant):
    viewer = officer_client(_officer(cn_tenant, "v", role="VIEWER"))
    assert _assign(viewer, hall.letter, hall.colleague.pk).status_code == 403
    assert viewer.get(f"{INBOX}{hall.letter.pk}/assignable/").status_code == 403


def test_assigned_to_me_cuts_across_the_other_folders_and_counts_match(hall, cn_tenant):
    """「交给我的」是横切「全部」的视图,不是划分的一块:它 ⊆ 全部、与归档不相交,计数 = 列表条数。"""
    mine_waiting = hall.letter
    mine_replied = _letter(cn_tenant, "乙")
    Conversation.objects.filter(pk=mine_replied.pk).update(last_from="hall")
    mine_archived = _letter(cn_tenant, "丙")
    not_mine = _letter(cn_tenant, "丁")
    for c in (mine_waiting, mine_replied, mine_archived):
        _assign(hall.api, c, hall.colleague.pk)
    _assign(hall.api, not_mine, hall.me.pk)
    hall.colleague_api.post(f"{INBOX}{mine_archived.pk}/archive/")

    api = hall.colleague_api
    got = {f: _ids(api, folder=f) for f in ("all", "awaiting_reply", "replied", "archived", "assigned_to_me")}
    assert got["assigned_to_me"] == {str(mine_waiting.pk), str(mine_replied.pk)}
    assert got["assigned_to_me"] <= got["all"]
    assert not got["assigned_to_me"] & got["archived"]
    assert str(not_mine.pk) not in got["assigned_to_me"]
    assert got["assigned_to_me"] & got["awaiting_reply"] == {str(mine_waiting.pk)}
    assert got["assigned_to_me"] & got["replied"] == {str(mine_replied.pk)}
    assert api.get(f"{INBOX}folders/").data["assigned_to_me"] == len(got["assigned_to_me"])
