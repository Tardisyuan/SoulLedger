"""The web circle (`/api/v1/social/…`) puts its changes on the bus, so the web feed's realtime handlers
(`frontend/lib/events/eventHandlers.ts::handleSocialEvent`) have something to receive.

Until 2026-10-31 nothing published POST_* / COMMENT_* / USER_(UN)FOLLOWED: the handlers waited for frames
that never came, and another officer's post appeared only on a manual refresh. The soul circle announces
its own way (SOCIAL_* to the souls concerned, `test_soul_circle_relations.py`).

Counter-cases: a post others cannot see (PRIVATE, held for review) is not broadcast; a follow goes only to
the two people concerned; nothing is published before commit.
"""
from unittest import mock

import pytest

from apps.social.models import Comment, Follow, ModerationStatus, Post, Visibility

POSTS = "/api/v1/social/posts/"
COMMENTS = "/api/v1/social/comments/"
FOLLOWS = "/api/v1/social/follows/"

pytestmark = pytest.mark.django_db


def _published(publish):
    return [(c.kwargs["event_type"], c.kwargs["user_ids"], c.kwargs["payload"]) for c in publish.call_args_list]


@pytest.fixture
def announced(django_capture_on_commit_callbacks):
    """`with announced() as publish:` — the on-commit callbacks run when the block exits, so assert after it."""
    from contextlib import contextmanager

    @contextmanager
    def capture():
        with (
            mock.patch("apps.events.event_bus.event_bus.publish") as publish,
            django_capture_on_commit_callbacks(execute=True),
        ):
            yield publish

    return capture


def test_a_post_others_can_see_is_announced_to_the_tenant_on_create_edit_and_delete(auth_client, user, tenant, announced):
    with announced() as publish:
        created = auth_client.post(POSTS, {"content": "公开的帖", "visibility": Visibility.PUBLIC}, format="json")
        assert created.status_code == 201, created.data
        pk = Post.objects.get(author=user).pk
        assert auth_client.patch(f"{POSTS}{pk}/", {"content": "改过的帖"}, format="json").status_code == 200
        assert auth_client.delete(f"{POSTS}{pk}/").status_code == 204

    ids = {"post_id": str(pk), "user_id": str(user.pk)}
    assert _published(publish) == [
        ("POST_CREATED", None, ids), ("POST_UPDATED", None, ids), ("POST_DELETED", None, ids),
    ]
    assert all(c.kwargs["domain"] == "social" and c.kwargs["tenant_code"] == tenant.code
               for c in publish.call_args_list)


def test_a_private_post_is_never_broadcast_but_making_it_private_is(auth_client, user, announced):
    with announced() as publish:
        auth_client.post(POSTS, {"content": "只给自己", "visibility": Visibility.PRIVATE}, format="json")
    assert publish.call_count == 0

    shown = Post.objects.create(author=user, content="原来公开", visibility=Visibility.PUBLIC, tenant=user.tenant)
    with announced() as publish:
        auth_client.patch(f"{POSTS}{shown.pk}/", {"visibility": Visibility.PRIVATE}, format="json")
        # Others must drop it from their feeds, so the edit that hides it is announced; the delete of a now
        # private post is not.
        auth_client.delete(f"{POSTS}{shown.pk}/")
    assert [e for e, _, _ in _published(publish)] == ["POST_UPDATED"]


def test_a_post_held_for_review_is_not_announced(auth_client, user, announced):
    with announced() as publish, mock.patch("apps.social.views.screen_content") as screen:
        screen.return_value = mock.Mock(content="待审", status=ModerationStatus.PENDING, moderation_fields={},
                                        hit_ids=[], outcome="review")
        assert auth_client.post(POSTS, {"content": "待审", "visibility": Visibility.PUBLIC}, format="json").status_code == 201
    assert Post.objects.filter(author=user).count() == 1
    assert publish.call_count == 0


def test_comments_on_a_visible_post_are_announced_and_on_a_private_one_are_not(
    auth_client, other_client, user, other_user, tenant, announced,
):
    shown = Post.objects.create(author=user, content="公开", visibility=Visibility.PUBLIC, tenant=tenant)
    hidden = Post.objects.create(author=user, content="私密", visibility=Visibility.PRIVATE, tenant=tenant)

    with announced() as publish:
        assert other_client.post(COMMENTS, {"post": str(shown.pk), "content": "评论"}, format="json").status_code == 201
        assert auth_client.post(COMMENTS, {"post": str(hidden.pk), "content": "自言自语"}, format="json").status_code == 201
        comment = Comment.objects.get(post=shown)
        assert other_client.delete(f"{COMMENTS}{comment.pk}/").status_code == 204

    ids = {"post_id": str(shown.pk), "comment_id": str(comment.pk), "user_id": str(other_user.pk)}
    assert _published(publish) == [("COMMENT_CREATED", None, ids), ("COMMENT_DELETED", None, ids)]


def test_follow_and_unfollow_go_to_the_two_people_only_on_every_path(auth_client, user, other_user, announced):
    ids = {"follower_id": str(user.pk), "following_id": str(other_user.pk)}
    pair = [user.pk, other_user.pk]

    with announced() as publish:
        assert auth_client.post(f"{FOLLOWS}toggle/", {"following": other_user.pk}, format="json").data == {"following": True}
        assert auth_client.post(f"{FOLLOWS}toggle/", {"following": other_user.pk}, format="json").data == {"following": False}
        assert auth_client.post(FOLLOWS, {"following": other_user.pk}, format="json").status_code == 201
        row = Follow.objects.get(follower=user, following=other_user)
        assert auth_client.delete(f"{FOLLOWS}{row.pk}/").status_code == 204

    assert _published(publish) == [
        ("USER_FOLLOWED", pair, ids), ("USER_UNFOLLOWED", pair, ids),
        ("USER_FOLLOWED", pair, ids), ("USER_UNFOLLOWED", pair, ids),
    ]


def test_nothing_is_published_when_the_write_rolls_back(auth_client, user, django_capture_on_commit_callbacks):
    with (
        mock.patch("apps.events.event_bus.event_bus.publish") as publish,
        mock.patch("apps.social.views.post_media.attach", side_effect=RuntimeError("disk")),
        django_capture_on_commit_callbacks(execute=True),
        pytest.raises(RuntimeError),
    ):
        auth_client.post(POSTS, {"content": "挂图失败", "visibility": Visibility.PUBLIC}, format="json")
    assert publish.call_count == 0
    assert not Post.objects.filter(author=user).exists()
