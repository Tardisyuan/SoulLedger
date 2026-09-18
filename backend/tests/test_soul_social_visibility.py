"""灵魂朋友圈看得见什么 —— 每一条都断言**看不见**,不只是断言看得见。

「正确的那条在列表里」这个断言,在错误的那条挨着它的时候照样是绿的
(CLAUDE.md「Assert absence as well as presence」)。所以下面每个用例都是一对:
本文明的在、另一个文明的不在。

**文明按「当前所在」算**(2026-09-17 用户决定):暂居的灵魂看暂居地,
与 App 的换肤规则一致。`test_a_residing_soul_lives_in_the_civilization_it_is_in`
是这条规则唯一会红的地方 —— 它把 `Soul.tenant` 与 `Soul.home_tenant` 岔开。
"""
import pytest

from apps.social import soul_circle as circle
from apps.social.models import ModerationStatus, Post, Visibility
from tests.soul_social_support import SOCIAL, feed_ids, follow, post, soul

pytestmark = pytest.mark.django_db


# ── 跨文明 ────────────────────────────────────────────────────────────────


def test_a_soul_cannot_see_another_civilizations_posts(cn_tenant, eu_tenant):
    mine, client = soul(cn_tenant, "地府甲")
    theirs, _ = soul(eu_tenant, "天堂乙")
    ours = post(mine, "本文明", Visibility.PUBLIC)
    hers = post(theirs, "另一个文明", Visibility.PUBLIC)

    ids = feed_ids(client)
    assert str(ours.pk) in ids
    assert str(hers.pk) not in ids, "另一个文明的 PUBLIC 帖子进了动态流"
    # 详情也是同一个答案,不是「列表里没有但按 id 能打开」。
    assert client.get(f"{SOCIAL}/posts/{hers.pk}/").status_code == 404


def test_a_soul_cannot_search_another_civilization(cn_tenant, eu_tenant):
    _, client = soul(cn_tenant, "地府甲")
    mate, _ = soul(cn_tenant, "地府同乡")
    stranger, _ = soul(eu_tenant, "地府同乡")  # 同名,只有文明不同

    res = client.get(f"{SOCIAL}/search/", {"q": "地府同乡"})
    assert res.status_code == 200, res.content
    ids = {row["user_id"] for row in res.json()}
    assert mate.user_id in ids
    assert stranger.user_id not in ids, "另一个文明的同名灵魂出现在搜索结果里"


def test_a_soul_cannot_follow_another_civilization(cn_tenant, eu_tenant):
    _, client = soul(cn_tenant, "地府甲")
    stranger, _ = soul(eu_tenant, "天堂乙")

    res = client.post(f"{SOCIAL}/users/{stranger.user_id}/follow/")
    # 404 而不是 403:「这个 id 在别的文明存在」本身不该是可探测的。
    assert res.status_code == 404, res.content
    assert res.json()["code"] == "not_found"


def test_a_residing_soul_lives_in_the_civilization_it_is_in(cn_tenant, eu_tenant):
    """暂居的灵魂:原属 CN、此刻在 EU。朋友圈按**此刻**算。"""
    guest, guest_client = soul(eu_tenant, "客居者", home_tenant=cn_tenant)
    assert guest.soul.is_residing and guest.soul.home_civilization != guest.soul.civilization

    eu_local, _ = soul(eu_tenant, "天堂乙")
    cn_local, _ = soul(cn_tenant, "地府甲")
    eu_post = post(eu_local, "暂居地的帖子", Visibility.PUBLIC)
    cn_post = post(cn_local, "原属地的帖子", Visibility.PUBLIC)

    ids = feed_ids(guest_client)
    assert str(eu_post.pk) in ids, "暂居的灵魂看不到暂居地 —— 文明按原属算了"
    assert str(cn_post.pk) not in ids, "暂居的灵魂还看得到原属地 —— 文明按 home_tenant 算了"

    # 关注也按此刻:暂居地的能关注,原属地的不能。
    assert guest_client.post(f"{SOCIAL}/users/{eu_local.user_id}/follow/").status_code == 200
    assert guest_client.post(f"{SOCIAL}/users/{cn_local.user_id}/follow/").status_code == 404


# ── 四档可见性 ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "visibility,stranger_sees,follower_sees",
    [
        (Visibility.PUBLIC, True, True),
        (Visibility.TENANT, True, True),
        (Visibility.FOLLOWERS, False, True),
        (Visibility.PRIVATE, False, False),
    ],
)
def test_the_four_visibility_levels(cn_tenant, visibility, stranger_sees, follower_sees):
    author, author_client = soul(cn_tenant, "作者")
    _, stranger_client = soul(cn_tenant, "路人")
    fan, fan_client = soul(cn_tenant, "粉丝")
    follow(fan, author)

    row = post(author, "一条", visibility)
    assert str(row.pk) in feed_ids(author_client), "作者本人看不到自己的帖子"
    assert (str(row.pk) in feed_ids(stranger_client)) is stranger_sees
    assert (str(row.pk) in feed_ids(fan_client)) is follower_sees


def test_followers_only_means_the_author_is_followed_not_the_reverse(cn_tenant):
    """FOLLOWERS 是「我关注了作者」,不是「作者关注了我」。方向反了照样能读出一个
    看起来合理的列表 —— 所以两个方向各建一条边,只该有一条看得见。"""
    author, _ = soul(cn_tenant, "作者")
    fan, fan_client = soul(cn_tenant, "粉丝")
    other, other_client = soul(cn_tenant, "被作者关注的人")
    follow(fan, author)
    follow(author, other)

    row = post(author, "只给关注者", Visibility.FOLLOWERS)
    assert str(row.pk) in feed_ids(fan_client)
    assert str(row.pk) not in feed_ids(other_client), "方向反了:作者关注谁就给谁看"


# ── 审核状态 ─────────────────────────────────────────────────────────────


def test_pending_and_hidden_content_is_invisible_to_everyone_but_its_author(cn_tenant):
    author, author_client = soul(cn_tenant, "作者")
    _, other_client = soul(cn_tenant, "路人")

    pending = post(author, "待审", Visibility.PUBLIC)
    hidden = post(author, "被隐藏", Visibility.PUBLIC)
    Post.objects.filter(pk=pending.pk).update(moderation_status=ModerationStatus.PENDING)
    Post.objects.filter(pk=hidden.pk).update(moderation_status=ModerationStatus.HIDDEN)

    others = feed_ids(other_client)
    assert str(pending.pk) not in others
    assert str(hidden.pk) not in others
    # 本人看得见,并且看得见状态 —— 否则「发出去了没有」无从判断。
    mine = author_client.get(f"{SOCIAL}/feed/").json()["results"]
    assert {r["id"]: r["moderation_status"] for r in mine} == {
        str(pending.pk): "PENDING", str(hidden.pk): "HIDDEN"
    }


def test_a_pending_comment_does_not_leak_through_the_count(cn_tenant):
    """计数是最容易漏的那条路径:内容藏住了,而「有 1 条评论」把它的存在说了出去。"""
    author, _ = soul(cn_tenant, "作者")
    commenter, commenter_client = soul(cn_tenant, "评论者")
    _, reader_client = soul(cn_tenant, "读者")
    row = post(author, "帖子", Visibility.PUBLIC)

    circle.create_comment(commenter.user, row.pk, "看得见的")
    pending = circle.create_comment(commenter.user, row.pk, "待审的")
    type(pending).objects.filter(pk=pending.pk).update(moderation_status=ModerationStatus.PENDING)

    seen = reader_client.get(f"{SOCIAL}/posts/{row.pk}/").json()
    assert seen["comment_count"] == 1, "待审评论被计数泄露了"
    listed = reader_client.get(f"{SOCIAL}/posts/{row.pk}/comments/").json()["results"]
    assert [c["content"] for c in listed] == ["看得见的"]


# ── 只读:前世账号与禁言 ──────────────────────────────────────────────────


def test_a_retired_account_cannot_reach_the_circle_at_all(cn_tenant):
    """前世账号:令牌在认证层就被拒(`SoulJWTAuthentication` 401),所以连只读都没有。
    它的**内容**留着,对别人按可见性仍可见 —— 下面一条测那个。"""
    from django.utils import timezone

    account, client = soul(cn_tenant, "前世")
    type(account).objects.filter(pk=account.pk).update(retired_at=timezone.now())

    assert client.get(f"{SOCIAL}/feed/").status_code == 401
    assert client.post(f"{SOCIAL}/feed/", {"content": "还想发帖"}, format="json").status_code == 401


def test_a_past_lifes_posts_stay_visible_and_read_only(cn_tenant):
    """社交内容随账号:前世的帖子不跟到新账号,但也不消失。"""
    from django.utils import timezone

    past, _ = soul(cn_tenant, "前世")
    old = post(past, "上一世写的", Visibility.PUBLIC)
    type(past).objects.filter(pk=past.pk).update(retired_at=timezone.now())

    _, reader = soul(cn_tenant, "读者")
    assert str(old.pk) in feed_ids(reader), "前世的帖子不见了"
    # 新一世从零开始:新账号不是旧帖子的作者。
    assert reader.get(f"{SOCIAL}/posts/{old.pk}/").json()["is_mine"] is False


def test_a_muted_soul_is_read_only(cn_tenant):
    from datetime import timedelta

    from django.utils import timezone

    from apps.social.models import SocialMute

    muted, client = soul(cn_tenant, "被禁言的")
    other, _ = soul(cn_tenant, "别人")
    existing = post(muted, "禁言前发的", Visibility.PUBLIC)
    SocialMute.objects.create(tenant=cn_tenant, user=muted.user, until=timezone.now() + timedelta(days=3))

    # 读:照常。
    assert str(existing.pk) in feed_ids(client)
    # 写:每一条都 403 muted,而不是某几条。
    for method, path, body in [
        ("post", f"{SOCIAL}/feed/", {"content": "新帖"}),
        ("post", f"{SOCIAL}/posts/{existing.pk}/comments/", {"content": "评论"}),
        ("post", f"{SOCIAL}/posts/{existing.pk}/reaction/", {"reaction_type": "LIKE"}),
        ("post", f"{SOCIAL}/users/{other.user_id}/follow/", {}),
        ("delete", f"{SOCIAL}/posts/{existing.pk}/", None),
    ]:
        res = getattr(client, method)(path, body, format="json") if body is not None else client.delete(path)
        assert res.status_code == 403, f"{method} {path} 在禁言期间没有被拒:{res.status_code}"
        assert res.json()["code"] == "muted"
        assert "muted_until" in res.json()

    status = client.get(f"{SOCIAL}/status/").json()
    assert status["can_write"] is False and status["muted_until"] is not None
