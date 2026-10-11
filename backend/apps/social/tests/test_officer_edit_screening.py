"""
官员的发帖 / 改帖 / 评论与灵魂端走同一道词表(`moderation.screen_content`),
以及 `edited_at` 只在作者改**正文**时写入。
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.social.models import (
    Comment,
    ModerationStatus,
    Post,
    SensitiveWord,
    SensitiveWordAction,
    SensitiveWordDailyHit,
)
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/social"


def _client(user, tenant):
    from rest_framework_simplejwt.tokens import RefreshToken

    c = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return c


@pytest.fixture
def world(db):
    tenant = Tenant.objects.get_or_create(code="OES_T", defaults={"display_name": "Edit Screening"})[0]
    author = User.objects.create_user(username="oes_a", password="x", role="ADMIN", tenant=tenant)
    other = User.objects.create_user(username="oes_b", password="x", role="ADMIN", tenant=tenant)
    return tenant, author, other


def _word(tenant, word, action):
    return SensitiveWord.objects.create(tenant=tenant, word=word, action=action)


def test_create_with_review_word_starts_pending_and_counts_the_hit(world):
    tenant, author, _ = world
    _word(tenant, "badword", SensitiveWordAction.REVIEW)
    r = _client(author, tenant).post(f"{BASE}/posts/", {"content": "a BadWord here"}, format="json")
    assert r.status_code == 201
    post = Post.objects.get(author=author)
    assert post.moderation_status == ModerationStatus.PENDING
    assert post.moderation_reason == "sensitive_word:badword"
    assert SensitiveWordDailyHit.objects.get().count == 1


def test_create_with_mask_word_is_published_masked(world):
    tenant, author, _ = world
    _word(tenant, "badword", SensitiveWordAction.MASK)
    _client(author, tenant).post(f"{BASE}/posts/", {"content": "a badword here"}, format="json")
    post = Post.objects.get(author=author)
    assert post.moderation_status == ModerationStatus.PUBLISHED
    assert "badword" not in post.content


def test_create_clean_post_is_untouched(world):
    tenant, author, _ = world
    _word(tenant, "badword", SensitiveWordAction.HIDE)
    _client(author, tenant).post(f"{BASE}/posts/", {"content": "fine"}, format="json")
    post = Post.objects.get(author=author)
    assert (post.content, post.moderation_status) == ("fine", ModerationStatus.PUBLISHED)
    assert post.edited_at is None


def test_edit_clean_to_hit_is_hidden_and_stamps_edited_at(world):
    tenant, author, _ = world
    _word(tenant, "badword", SensitiveWordAction.HIDE)
    post = Post.objects.create(author=author, content="fine", tenant=tenant)
    r = _client(author, tenant).patch(f"{BASE}/posts/{post.pk}/", {"content": "now badword"}, format="json")
    assert r.status_code == 200
    post.refresh_from_db()
    assert post.moderation_status == ModerationStatus.HIDDEN
    assert post.edited_at is not None
    assert r.data["edited_at"] is not None


def test_edit_visibility_only_does_not_screen_or_stamp(world):
    tenant, author, _ = world
    post = Post.objects.create(author=author, content="old badword", tenant=tenant)
    _word(tenant, "badword", SensitiveWordAction.HIDE)  # 词表后来才加:未改正文就不重筛
    r = _client(author, tenant).patch(f"{BASE}/posts/{post.pk}/", {"visibility": "PRIVATE"}, format="json")
    assert r.status_code == 200
    post.refresh_from_db()
    assert post.moderation_status == ModerationStatus.PUBLISHED
    assert post.edited_at is None
    assert SensitiveWordDailyHit.objects.count() == 0


def test_same_content_patch_does_not_stamp(world):
    tenant, author, _ = world
    post = Post.objects.create(author=author, content="same", tenant=tenant)
    _client(author, tenant).patch(f"{BASE}/posts/{post.pk}/", {"content": "same"}, format="json")
    post.refresh_from_db()
    assert post.edited_at is None


def test_clean_edit_stamps_but_keeps_an_officers_hide(world):
    tenant, author, _ = world
    post = Post.objects.create(
        author=author, content="o", tenant=tenant, moderation_status=ModerationStatus.HIDDEN
    )
    _client(author, tenant).patch(f"{BASE}/posts/{post.pk}/", {"content": "typo fixed"}, format="json")
    post.refresh_from_db()
    assert post.edited_at is not None
    assert post.moderation_status == ModerationStatus.HIDDEN


def test_other_people_interacting_never_stamps(world):
    tenant, author, other = world
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    c = _client(other, tenant)
    c.post(f"{BASE}/comments/", {"post": str(post.pk), "content": "hi"}, format="json")
    c.post(f"{BASE}/reactions/", {"post": str(post.pk), "reaction_type": "LIKE"}, format="json")
    post.refresh_from_db()
    assert post.edited_at is None


def test_edited_at_is_in_list_and_detail(world):
    tenant, author, _ = world
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    c = _client(author, tenant)
    assert c.get(f"{BASE}/posts/{post.pk}/").data["edited_at"] is None
    assert c.get(f"{BASE}/posts/").data["results"][0]["edited_at"] is None


def test_officer_comment_with_review_word_starts_pending(world):
    tenant, author, other = world
    _word(tenant, "badword", SensitiveWordAction.REVIEW)
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    r = _client(other, tenant).post(f"{BASE}/comments/", {"post": str(post.pk), "content": "badword"}, format="json")
    assert r.status_code == 201
    assert Comment.objects.get().moderation_status == ModerationStatus.PENDING
    assert SensitiveWordDailyHit.objects.get().count == 1


# ── 响应里的 screening:告诉本人结果,不泄露命中的词 ───────────────────────────


@pytest.mark.parametrize(
    "action,expected",
    [
        (SensitiveWordAction.MASK, "masked"),
        (SensitiveWordAction.REVIEW, "pending_review"),
        (SensitiveWordAction.HIDE, "hidden"),
    ],
)
def test_post_comment_and_edit_responses_carry_the_outcome_and_never_the_word(world, action, expected):
    tenant, author, other = world
    _word(tenant, "secretword", action)
    c = _client(author, tenant)
    created = c.post(f"{BASE}/posts/", {"content": "has secretword"}, format="json")
    assert created.data["screening"] == expected
    clean = Post.objects.create(author=author, content="fine", tenant=tenant)
    edited = c.patch(f"{BASE}/posts/{clean.pk}/", {"content": "now secretword"}, format="json")
    assert edited.data["screening"] == expected
    # 评论的目标帖:换一条公开的干净帖,免得被上面的编辑送审后 other 看不见
    target = Post.objects.create(author=author, content="open", tenant=tenant)
    commented = _client(other, tenant).post(
        f"{BASE}/comments/", {"post": str(target.pk), "content": "secretword"}, format="json"
    )
    assert commented.status_code == 201
    assert commented.data["screening"] == expected
    for r in (created, edited, commented):
        assert "secretword" not in str(r.data["screening"]), "只给结果,不给词"


def test_clean_and_visibility_only_responses(world):
    tenant, author, _ = world
    c = _client(author, tenant)
    assert c.post(f"{BASE}/posts/", {"content": "fine"}, format="json").data["screening"] == "clean"
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    assert c.patch(f"{BASE}/posts/{post.pk}/", {"visibility": "PRIVATE"}, format="json").data["screening"] is None
    assert c.get(f"{BASE}/posts/{post.pk}/").data["screening"] is None


def test_comment_count_follows_the_comments_status_for_everyone_including_the_author(world):
    from apps.social.moderation import moderate_content

    tenant, author, other = world
    _word(tenant, "badword", SensitiveWordAction.REVIEW)
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    _client(other, tenant).post(f"{BASE}/comments/", {"post": str(post.pk), "content": "ok"}, format="json")
    _client(other, tenant).post(f"{BASE}/comments/", {"post": str(post.pk), "content": "badword"}, format="json")
    pending = Comment.objects.get(content="badword")

    def counts():
        return {
            who: (
                _client(who, tenant).get(f"{BASE}/posts/{post.pk}/").data["comment_count"],
                _client(who, tenant).get(f"{BASE}/posts/").data["results"][0]["comment_count"],
            )
            for who in (author, other)
        }

    assert counts() == {author: (1, 1), other: (1, 1)}, "待审的那条不进任何人的计数"
    moderate_content(pending, "APPROVE", actor=author)
    assert counts() == {author: (2, 2), other: (2, 2)}
    moderate_content(pending, "HIDE", actor=author)
    assert counts() == {author: (1, 1), other: (1, 1)}


def test_comment_serializers_carry_moderation_status_for_the_author(world):
    tenant, author, other = world
    _word(tenant, "badword", SensitiveWordAction.REVIEW)
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    c = _client(other, tenant)
    c.post(f"{BASE}/comments/", {"post": str(post.pk), "content": "badword"}, format="json")
    rows = c.get(f"{BASE}/comments/", {"post": str(post.pk)}).data["results"]
    assert [r["moderation_status"] for r in rows] == ["PENDING"]
    assert _client(author, tenant).get(f"{BASE}/comments/", {"post": str(post.pk)}).data["results"] == []


def test_authors_pending_post_is_visible_to_the_author_only(world):
    tenant, author, other = world
    _word(tenant, "badword", SensitiveWordAction.REVIEW)
    r = _client(author, tenant).post(f"{BASE}/posts/", {"content": "badword", "visibility": "PUBLIC"}, format="json")
    assert r.status_code == 201
    pid = str(Post.objects.get(author=author).pk)

    def ids(who):
        return {p["id"] for p in _client(who, tenant).get(f"{BASE}/posts/").data["results"]}

    assert pid in ids(author)
    assert pid not in ids(other)
    assert _client(other, tenant).get(f"{BASE}/posts/{pid}/").status_code == 404
