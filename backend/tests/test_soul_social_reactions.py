"""朋友圈表态与「关注」子页。

表态通则:每人每帖一条,五种互相替换,再点同一种即取消。长明灯例外:点了就锁死 ——
取消与换成别的都由后端拒绝(2026-09-24 用户决定),不靠 App 藏入口。
每条都断言「拒绝」,也断言另外四种仍然可取消、可改:只测前者,一个把所有表态都锁死的
实现照样是绿的。
"""
import pytest

from apps.social.models import Reaction, ReactionType, Visibility
from tests.soul_social_support import SOCIAL, feed_ids, follow, post, soul

pytestmark = pytest.mark.django_db

ORDINARY = [ReactionType.LIKE, ReactionType.LOVE, ReactionType.RESPECT, ReactionType.SYMPATHY]


def react(client, row, kind):
    return client.post(f"{SOCIAL}/posts/{row.pk}/reaction/", {"reaction_type": kind}, format="json")


def stored(account, row):
    return list(Reaction.objects.filter(user=account.user, post=row).values_list("reaction_type", flat=True))


@pytest.mark.parametrize("kind", ORDINARY)
def test_an_ordinary_reaction_can_be_switched_and_removed(cn_tenant, kind):
    author, _ = soul(cn_tenant, "作者")
    me, client = soul(cn_tenant, "读者")
    row = post(author)
    other = next(k for k in ORDINARY if k != kind)

    assert react(client, row, kind).json() == {"reacted": True, "reaction_type": kind}
    assert react(client, row, other).json() == {"reacted": True, "reaction_type": other}
    assert stored(me, row) == [other], "换一种应替换,不是再加一条"
    assert react(client, row, other).json() == {"reacted": False, "reaction_type": None}
    assert stored(me, row) == []
    # 普通表态之后仍可点长明灯。
    assert react(client, row, kind).status_code == 200
    assert react(client, row, ReactionType.ETERNAL_LIGHT).json()["reaction_type"] == ReactionType.ETERNAL_LIGHT


@pytest.mark.parametrize("kind", [*ORDINARY, ReactionType.ETERNAL_LIGHT])
def test_an_eternal_light_cannot_be_removed_or_switched(cn_tenant, kind):
    author, _ = soul(cn_tenant, "作者")
    me, client = soul(cn_tenant, "读者")
    row = post(author)
    assert react(client, row, ReactionType.ETERNAL_LIGHT).status_code == 200

    res = react(client, row, kind)
    assert res.status_code == 409, res.content
    assert res.json()["code"] == "eternal_light_locked"
    assert stored(me, row) == [ReactionType.ETERNAL_LIGHT]
    assert client.get(f"{SOCIAL}/posts/{row.pk}/").json()["reaction_count"] == 1


def test_one_souls_eternal_light_does_not_lock_anyone_else(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    _, lit = soul(cn_tenant, "点灯的")
    _, other = soul(cn_tenant, "别人")
    row = post(author)
    react(lit, row, ReactionType.ETERNAL_LIGHT)

    assert react(other, row, ReactionType.LIKE).status_code == 200
    assert react(other, row, ReactionType.LIKE).json()["reacted"] is False


def test_the_following_feed_holds_me_and_followed_authors(cn_tenant):
    me, client = soul(cn_tenant, "我")
    followed, _ = soul(cn_tenant, "关注的")
    stranger, _ = soul(cn_tenant, "陌生人")
    follow(me, followed)
    theirs = post(followed, visibility=Visibility.PUBLIC)
    strangers = post(stranger, visibility=Visibility.PUBLIC)
    mine = post(me, visibility=Visibility.PUBLIC)

    assert feed_ids(client) == {str(theirs.pk), str(strangers.pk), str(mine.pk)}
    assert feed_ids(client, following="true") == {str(theirs.pk), str(mine.pk)}


def test_a_past_life_profile_says_it_is_not_active(cn_tenant):
    """App 看 `is_active` 决定藏不藏关注按钮和「⋯」。"""
    from django.utils import timezone

    past, _ = soul(cn_tenant, "前世")
    live, _ = soul(cn_tenant, "今世")
    type(past).objects.filter(pk=past.pk).update(retired_at=timezone.now())
    _, client = soul(cn_tenant, "读者")

    assert client.get(f"{SOCIAL}/users/{past.user_id}/").json()["is_active"] is False
    assert client.get(f"{SOCIAL}/users/{live.user_id}/").json()["is_active"] is True
