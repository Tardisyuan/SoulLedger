"""官员端帖子(列表、详情、关注流)带五种表态各自的数 —— `reaction_counts`,
与灵魂端、审核后台读同一份注解(`soul_circle.reaction_kind_counts`)。

反面:撤回(软删)的表态不算;评论上的表态不算到帖子上;别的帖子的表态不串过来。
"""
import pytest

from apps.social.models import Comment, Follow, Post, Reaction

BASE = "/api/v1/social/posts/"
ZERO = {"LIKE": 0, "LOVE": 0, "RESPECT": 0, "SYMPATHY": 0, "ETERNAL_LIGHT": 0}


@pytest.fixture
def reacted(user, other_user, third_user, tenant, post):
    Reaction.objects.create(user=user, post=post, reaction_type="LIKE", tenant=tenant)
    Reaction.objects.create(user=other_user, post=post, reaction_type="ETERNAL_LIGHT", tenant=tenant)
    Reaction.objects.create(user=third_user, post=post, reaction_type="ETERNAL_LIGHT", tenant=tenant)
    # 撤回的不算。
    Reaction.objects.create(user=user, post=post, reaction_type="LOVE", tenant=tenant, is_deleted=True)
    # 评论上的表态不是帖子的。
    comment = Comment.objects.create(post=post, author=user, content="c", tenant=tenant)
    Reaction.objects.create(user=other_user, comment=comment, reaction_type="SYMPATHY", tenant=tenant)
    # 另一条帖子的表态不串过来。
    elsewhere = Post.objects.create(author=other_user, content="other", tenant=tenant)
    Reaction.objects.create(user=user, post=elsewhere, reaction_type="RESPECT", tenant=tenant)
    return post


EXPECTED = {**ZERO, "LIKE": 1, "ETERNAL_LIGHT": 2}


@pytest.mark.django_db
def test_list_rows_carry_per_type_counts(auth_client, reacted):
    response = auth_client.get(BASE)
    assert response.status_code == 200, response.data
    row = next(r for r in response.data["results"] if r["id"] == str(reacted.pk))
    assert row["reaction_counts"] == EXPECTED


@pytest.mark.django_db
def test_detail_carries_per_type_counts(auth_client, reacted):
    response = auth_client.get(f"{BASE}{reacted.pk}/")
    assert response.status_code == 200, response.data
    assert response.data["reaction_counts"] == EXPECTED


@pytest.mark.django_db
def test_feed_rows_carry_per_type_counts(other_client, other_user, user, tenant, reacted):
    Follow.objects.create(follower=other_user, following=user, tenant=tenant)
    response = other_client.get(f"{BASE}feed/")
    assert response.status_code == 200, response.data
    row = next(r for r in response.data["results"] if r["id"] == str(reacted.pk))
    assert row["reaction_counts"] == EXPECTED


@pytest.mark.django_db
def test_a_post_nobody_reacted_to_is_all_zero(auth_client, post):
    row = next(r for r in auth_client.get(BASE).data["results"] if r["id"] == str(post.pk))
    assert row["reaction_counts"] == ZERO
