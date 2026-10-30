"""官员端帖子与评论随行带「我的表态」(`my_reaction`)与评论的表态数(`reaction_count`)。

此前前端每张帖子卡、每条评论各拉一次 `/social/reactions/?post=|comment=` 再在里面找自己 ——
一页 N 张卡就是 N 次请求,且表态多过一页时「我的表态」要翻页才找得到。现在由服务端一个子查询
注解(与灵魂端 `soul_circle.annotate_posts_for` 同一个 `my_reaction_of`)。

反面:别人的表态不当成我的;撤回(软删)的不算;一页的查询数不随条数增长。
"""
import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.social.models import Comment, Follow, Post, Reaction

User = get_user_model()
POSTS = "/api/v1/social/posts/"
COMMENTS = "/api/v1/social/comments/"

pytestmark = pytest.mark.django_db


def _crowd(tenant, n, **target):
    """n 个别人先表态 —— 我的表态在表态列表里排到第一页之后。"""
    for i in range(n):
        someone = User.objects.create_user(username=f"crowd{i}", password="x", role="VIEWER", tenant=tenant)
        Reaction.objects.create(user=someone, reaction_type="LIKE", tenant=tenant, **target)


def _row(response, pk):
    assert response.status_code == 200, response.data
    return next(r for r in response.data["results"] if r["id"] == str(pk))


def test_my_reaction_on_a_post_shows_even_after_a_page_of_other_reactions(auth_client, other_client, user, tenant, post):
    _crowd(tenant, 25, post=post)
    Reaction.objects.create(user=user, post=post, reaction_type="LOVE", tenant=tenant)

    assert _row(auth_client.get(POSTS), post.pk)["my_reaction"] == "LOVE"
    assert auth_client.get(f"{POSTS}{post.pk}/").data["my_reaction"] == "LOVE"
    # 别人看同一条:不是我的 LOVE。
    assert _row(other_client.get(POSTS), post.pk)["my_reaction"] is None


def test_my_reaction_on_a_post_on_page_two_of_the_list(auth_client, user, tenant):
    oldest = Post.objects.create(author=user, content="oldest", tenant=tenant)
    for i in range(25):
        Post.objects.create(author=user, content=f"p{i}", tenant=tenant)
    Reaction.objects.create(user=user, post=oldest, reaction_type="RESPECT", tenant=tenant)

    first = auth_client.get(POSTS)
    assert str(oldest.pk) not in {r["id"] for r in first.data["results"]}
    assert {r["my_reaction"] for r in first.data["results"]} == {None}
    assert _row(auth_client.get(POSTS, {"page": 2}), oldest.pk)["my_reaction"] == "RESPECT"


def test_feed_rows_carry_my_reaction(other_client, other_user, user, tenant, post):
    Follow.objects.create(follower=other_user, following=user, tenant=tenant)
    Reaction.objects.create(user=other_user, post=post, reaction_type="ETERNAL_LIGHT", tenant=tenant)
    Reaction.objects.create(user=user, post=post, reaction_type="LIKE", tenant=tenant)
    assert _row(other_client.get(f"{POSTS}feed/"), post.pk)["my_reaction"] == "ETERNAL_LIGHT"


def test_a_withdrawn_reaction_is_not_mine(auth_client, user, tenant, post):
    Reaction.objects.create(user=user, post=post, reaction_type="LOVE", tenant=tenant, is_deleted=True)
    assert _row(auth_client.get(POSTS), post.pk)["my_reaction"] is None


def test_comment_rows_carry_reaction_count_and_my_reaction(auth_client, other_client, user, other_user, tenant, post, comment):
    _crowd(tenant, 25, comment=comment)
    Reaction.objects.create(user=user, comment=comment, reaction_type="SYMPATHY", tenant=tenant)
    Reaction.objects.create(user=other_user, comment=comment, reaction_type="LOVE", tenant=tenant, is_deleted=True)
    bare = Comment.objects.create(post=post, author=other_user, content="bare", tenant=tenant)
    # 帖子上的表态不算到评论上。
    Reaction.objects.create(user=user, post=post, reaction_type="LIKE", tenant=tenant)

    rows = auth_client.get(COMMENTS, {"post": str(post.pk)})
    mine = _row(rows, comment.pk)
    assert mine["reaction_count"] == 26
    assert mine["my_reaction"] == "SYMPATHY"
    assert _row(rows, bare.pk)["reaction_count"] == 0
    assert _row(rows, bare.pk)["my_reaction"] is None
    assert auth_client.get(f"{COMMENTS}{comment.pk}/").data["my_reaction"] == "SYMPATHY"
    # 别人的视角:撤回的 LOVE 不是他的表态,也不进计数。
    theirs = _row(other_client.get(COMMENTS, {"post": str(post.pk)}), comment.pk)
    assert theirs["my_reaction"] is None
    assert theirs["reaction_count"] == 26


def _queries(client, url, params, rows):
    client.get(url, params)  # 第一次请求带登录 / 权限缓存的查询
    with CaptureQueriesContext(connection) as ctx:
        res = client.get(url, params)
        assert res.status_code == 200
        assert len(res.data["results"]) == rows
    return len(ctx.captured_queries)


def _react_all(users, tenant, **target):
    for u in users:
        Reaction.objects.create(user=u, reaction_type="LOVE", tenant=tenant, **target)


def test_a_page_of_posts_does_not_ask_once_per_row(auth_client, user, other_user, tenant):
    """变异:把 `PostSerializer.my_reaction` 改成每行现查 → 条数随行数增长,红。"""
    def make(n):
        for i in range(n):
            p = Post.objects.create(author=user, content=f"q{i}", tenant=tenant)
            _react_all([user, other_user], tenant, post=p)

    make(3)
    few = _queries(auth_client, POSTS, {}, 3)
    make(9)
    many = _queries(auth_client, POSTS, {}, 12)
    assert many == few, (few, many)


def test_a_page_of_comments_does_not_ask_once_per_row(auth_client, user, other_user, tenant, post):
    def make(n):
        for i in range(n):
            c = Comment.objects.create(post=post, author=user, content=f"c{i}", tenant=tenant)
            _react_all([user, other_user], tenant, comment=c)

    make(3)
    few = _queries(auth_client, COMMENTS, {"post": str(post.pk)}, 3)
    make(9)
    many = _queries(auth_client, COMMENTS, {"post": str(post.pk)}, 12)
    assert many == few, (few, many)
