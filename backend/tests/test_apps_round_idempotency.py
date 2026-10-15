"""App 重发不重复:官员回信、灵魂发帖与评论带的 `txn_id`;灵魂找人翻页。

丢了响应的重发(手机断网后续送、请求成功而响应没回来)回第一次的结果,不再写第二条。
每条都断言「只有一条」,也断言换一个 txn_id 照样发得出去:只测前者,一个把所有第二次都当重发的实现照样绿。
"""
import pytest

from apps.social.models import Comment, Post
from tests.chat_support import FakeMatrix, matrix  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_social_support import SOCIAL, post, soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
INBOX = "/api/v1/chat/inbox/"


def _inbox_with_a_letter(cn_tenant):
    from apps.authentication.models import User

    _, client = ready_soul(cn_tenant, name="甲")
    inbox = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json").data
    assert client.post(f"{CONVERSATIONS}{inbox['id']}/messages/", {"body": "我要申诉"}, format="json").status_code == 201
    officer = User.objects.create_user(username="cn_mod", password="x", role="ADMIN", tenant=cn_tenant)
    return inbox, officer_client(officer)


def test_a_resent_officer_reply_is_not_sent_twice(cn_tenant, matrix):  # noqa: F811
    """变异:`reply` 里不读缓存(去掉 `cache.get` 那一支)→ 第二次又发一条,Synapse 收到两条,红。
    变异:缓存键不含 txn_id → 第三封(新 txn)被当成重发,红。"""
    inbox, officer = _inbox_with_a_letter(cn_tenant)
    url = f"{INBOX}{inbox['id']}/reply/"
    first = officer.post(url, {"body": "已收", "txn_id": "r1.a"}, format="json")
    again = officer.post(url, {"body": "已收", "txn_id": "r1.a"}, format="json")
    assert first.status_code == again.status_code == 201
    assert again.data["event_id"] == first.data["event_id"]
    assert [m["body"] for m in matrix.rooms[inbox["room_id"]]["messages"] if m["body"] == "已收"] == ["已收"]

    other = officer.post(url, {"body": "已收", "txn_id": "r1.b"}, format="json")
    assert other.status_code == 201 and other.data["event_id"] != first.data["event_id"]


def test_two_officers_with_the_same_txn_id_do_not_share_a_reply(cn_tenant, matrix):  # noqa: F811
    from apps.authentication.models import User

    inbox, one = _inbox_with_a_letter(cn_tenant)
    two = officer_client(User.objects.create_user(username="cn_mod2", password="x", role="ADMIN", tenant=cn_tenant))
    url = f"{INBOX}{inbox['id']}/reply/"
    a = one.post(url, {"body": "甲答", "txn_id": "same"}, format="json")
    b = two.post(url, {"body": "乙答", "txn_id": "same"}, format="json")
    assert a.data["event_id"] != b.data["event_id"]


def test_a_reply_without_a_txn_id_is_still_sent_every_time(cn_tenant, matrix):  # noqa: F811
    inbox, officer = _inbox_with_a_letter(cn_tenant)
    url = f"{INBOX}{inbox['id']}/reply/"
    ids = {officer.post(url, {"body": "再答"}, format="json").data["event_id"] for _ in range(2)}
    assert len(ids) == 2


def test_a_resent_post_is_not_posted_twice(cn_tenant):
    """变异:`post` 里不读缓存 → 第二次又建一条帖子,红。"""
    me, client = soul(cn_tenant, "甲")
    first = client.post(f"{SOCIAL}/feed/", {"content": "今天", "txn_id": "p1"}, format="json")
    again = client.post(f"{SOCIAL}/feed/", {"content": "今天", "txn_id": "p1"}, format="json")
    assert first.status_code == again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    assert Post.objects.filter(author=me.user).count() == 1

    assert client.post(f"{SOCIAL}/feed/", {"content": "今天", "txn_id": "p2"}, format="json").status_code == 201
    assert Post.objects.filter(author=me.user).count() == 2


def test_a_resent_comment_is_not_added_twice(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    me, client = soul(cn_tenant, "读者")
    row = post(author)
    url = f"{SOCIAL}/posts/{row.pk}/comments/"
    first = client.post(url, {"content": "好", "txn_id": "c1"}, format="json")
    again = client.post(url, {"content": "好", "txn_id": "c1"}, format="json")
    assert first.status_code == again.status_code == 201
    assert again.json()["id"] == first.json()["id"]
    assert Comment.objects.filter(post=row, author=me.user).count() == 1

    assert client.post(url, {"content": "好", "txn_id": "c2"}, format="json").status_code == 201
    assert Comment.objects.filter(post=row, author=me.user).count() == 2


def test_soul_search_pages_without_repeating_or_skipping(cn_tenant):
    """变异:不排序或页码不进切片 → 第二页和第一页重叠或为空,红。"""
    _, client = soul(cn_tenant, "搜")
    for i in range(23):
        soul(cn_tenant, f"同名{i:02d}")
    first = client.get(f"{SOCIAL}/search/", {"q": "同名"}).json()
    second = client.get(f"{SOCIAL}/search/", {"q": "同名", "page": 2}).json()
    assert len(first) == 20 and len(second) == 3
    assert not {r["user_id"] for r in first} & {r["user_id"] for r in second}
