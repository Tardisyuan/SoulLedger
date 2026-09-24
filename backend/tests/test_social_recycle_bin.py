"""Officer-deleted 朋友圈 posts and comments go to the recycle bin (2026-09-25).

A soul deleting its own post or comment is not a moderation decision: it is
not listed in the bin, and the bin's restore cannot bring it back.
"""
import pytest

from apps.core.recycle_bin import list_bin_entries, restore_cascade
from apps.social import moderation as mod
from apps.social.models import Comment, Post, Visibility
from tests.soul_social_support import SOCIAL, feed_ids, officer_client, post, soul

pytestmark = pytest.mark.django_db
BIN = "/api/v1/recycle-bin/"


@pytest.fixture
def cn_moderator(db, django_user_model, cn_tenant):
    return django_user_model.objects.create(username="bin_moderator", role="MODERATOR", tenant=cn_tenant)


def _comment_on(target, client, text):
    res = client.post(f"{SOCIAL}/posts/{target.pk}/comments/", {"content": text}, format="json")
    assert res.status_code == 201, res.content
    return Comment.objects.get(content=text)


def _bin(admin_user):
    res = officer_client(admin_user).get(BIN)
    assert res.status_code == 200, res.content
    return {(r["entity_type"], str(r["id"])): r for r in res.json()["results"]}


def test_officer_deleted_post_and_comment_are_listed_and_restorable(cn_tenant, cn_moderator, admin_user):
    author, _ = soul(cn_tenant, "作者")
    _, reader = soul(cn_tenant, "读者")
    target = post(author, "要被删的帖子", Visibility.PUBLIC)
    other = post(author, "留着的帖子", Visibility.PUBLIC)
    comment = _comment_on(other, reader, "要被删的评论")

    mod.moderate_content(target, "DELETE", actor=cn_moderator, reason="违规")
    mod.moderate_content(comment, "DELETE", actor=cn_moderator, reason="辱骂")

    rows = _bin(admin_user)
    p = rows[("social_post", str(target.pk))]
    c = rows[("social_comment", str(comment.pk))]
    assert (p["kind"], p["deleted_by"], p["delete_reason"], p["label"]) == (
        "reference", "bin_moderator", "违规", "要被删的帖子"
    )
    assert (c["kind"], c["delete_reason"]) == ("reference", "辱骂")
    assert str(target.pk) not in feed_ids(reader)

    admin = officer_client(admin_user)
    for row in (p, c):
        res = admin.post(f"{BIN}restore/", {"cascade_id": row["cascade_id"]}, format="json")
        assert res.status_code == 200 and res.json() == {"restored": 1}, res.content
    assert not Post.all_objects.get(pk=target.pk).is_deleted
    assert not Comment.all_objects.get(pk=comment.pk).is_deleted
    assert str(target.pk) in feed_ids(reader)
    rows = _bin(admin_user)
    assert ("social_post", str(target.pk)) not in rows and ("social_comment", str(comment.pk)) not in rows


def test_a_souls_own_delete_is_not_in_the_bin_and_cannot_be_restored_through_it(cn_tenant, admin_user):
    author, author_client = soul(cn_tenant, "自删者")
    own = post(author, "我自己删的帖子", Visibility.PUBLIC)
    live = post(author, "有评论的帖子", Visibility.PUBLIC)
    own_comment = _comment_on(live, author_client, "我自己删的评论")

    assert author_client.delete(f"{SOCIAL}/posts/{own.pk}/").status_code == 204
    assert author_client.delete(f"{SOCIAL}/comments/{own_comment.pk}/").status_code == 204
    own = Post.all_objects.get(pk=own.pk)
    own_comment = Comment.all_objects.get(pk=own_comment.pk)
    assert own.is_deleted and own_comment.is_deleted

    rows = _bin(admin_user)
    assert ("social_post", str(own.pk)) not in rows
    assert ("social_comment", str(own_comment.pk)) not in rows

    for row in (own, own_comment):
        res = officer_client(admin_user).post(f"{BIN}restore/", {"cascade_id": str(row.delete_cascade_id)}, format="json")
        assert res.status_code == 404, res.content
    assert Post.all_objects.get(pk=own.pk).is_deleted
    assert Comment.all_objects.get(pk=own_comment.pk).is_deleted


def test_the_bin_listing_is_tenant_scoped_for_social_rows(cn_tenant, eu_tenant, cn_moderator, django_user_model):
    eu_mod = django_user_model.objects.create(username="eu_bin_mod", role="MODERATOR", tenant=eu_tenant)
    cn_author, _ = soul(cn_tenant, "地府作者")
    eu_author, _ = soul(eu_tenant, "欧洲作者")
    cn_post = post(cn_author, "地府的帖子", Visibility.PUBLIC)
    eu_post = post(eu_author, "欧洲的帖子", Visibility.PUBLIC)
    mod.moderate_content(cn_post, "DELETE", actor=cn_moderator)
    mod.moderate_content(eu_post, "DELETE", actor=eu_mod)

    listed = {str(e["id"]) for e in list_bin_entries(tenant=cn_tenant) if e["entity_type"] == "social_post"}
    assert listed == {str(cn_post.pk)}
    assert restore_cascade(Post.all_objects.get(pk=eu_post.pk).delete_cascade_id) == 1
