"""
Tests for social domain API views.
Uses JWT auth with tenant_code so TenantMiddleware sets request.tenant.
"""
import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from apps.social.models import (
    Comment,
    Follow,
    Post,
    Reaction,
    UserProfile,
    Visibility,
)
from apps.social.views import CommentViewSet, FollowViewSet, PostViewSet, ReactionViewSet
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/social"


def _jwt_client(user, tenant):
    """Return APIClient authenticated via JWT with tenant_code claim."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
class TestPostCRUD:
    """Post list, create, retrieve, update, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VP_T1", defaults={"display_name": "Post View Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="vuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.other = User.objects.create_user(
            username="vuser1b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_list_empty(self):
        resp = self.client.get(f"{BASE}/posts/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["count"] == 0

    def test_list_returns_posts(self):
        Post.objects.create(author=self.user, content="P1", tenant=self.tenant)
        Post.objects.create(author=self.user, content="P2", tenant=self.tenant)
        resp = self.client.get(f"{BASE}/posts/")
        assert resp.data["count"] == 2
        assert len(resp.data["results"]) == 2

    def test_create_post(self):
        resp = self.client.post(
            f"{BASE}/posts/", {"content": "New", "visibility": "PUBLIC"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert resp.data["content"] == "New"
        assert Post.objects.filter(author=self.user).count() == 1

    def test_create_post_increments_profile_count(self):
        self.client.post(
            f"{BASE}/posts/", {"content": "P", "visibility": "PUBLIC"}, format="json",
        )
        assert UserProfile.objects.get(user=self.user).post_count == 1

    def test_retrieve_post(self):
        post = Post.objects.create(author=self.user, content="R", tenant=self.tenant)
        resp = self.client.get(f"{BASE}/posts/{post.pk}/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["content"] == "R"

    def test_retrieve_nonexistent(self):
        resp = self.client.get(f"{BASE}/posts/{uuid.uuid4()}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_author_can_update(self):
        post = Post.objects.create(author=self.user, content="O", tenant=self.tenant)
        resp = self.client.patch(
            f"{BASE}/posts/{post.pk}/", {"content": "U"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        post.refresh_from_db()
        assert post.content == "U"

    def test_non_author_cannot_update(self):
        post = Post.objects.create(author=self.user, content="O", tenant=self.tenant)
        resp = _jwt_client(self.other, self.tenant).patch(
            f"{BASE}/posts/{post.pk}/", {"content": "H"}, format="json",
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_author_can_delete(self):
        post = Post.objects.create(author=self.user, content="D", tenant=self.tenant)
        resp = self.client.delete(f"{BASE}/posts/{post.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        post.refresh_from_db()
        assert post.is_deleted is True

    def test_non_author_cannot_delete(self):
        post = Post.objects.create(author=self.user, content="P", tenant=self.tenant)
        resp = _jwt_client(self.other, self.tenant).delete(f"{BASE}/posts/{post.pk}/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestPostFeed:
    """GET /api/v1/social/posts/feed/"""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VP_T6", defaults={"display_name": "Feed Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="vuser6", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.followed = User.objects.create_user(
            username="vuser6b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_feed_empty_when_not_following(self):
        resp = self.client.get(f"{BASE}/posts/feed/")
        results = resp.data.get("results", resp.data)
        assert len(results) == 0

    def test_feed_includes_followed_users_posts(self):
        Follow.objects.create(follower=self.user, following=self.followed, tenant=self.tenant)
        Post.objects.create(author=self.followed, content="Followed", tenant=self.tenant)
        results = self.client.get(f"{BASE}/posts/feed/").data.get("results", [])
        assert len(results) == 1
        assert results[0]["content"] == "Followed"

    def test_feed_excludes_private_posts(self):
        Follow.objects.create(follower=self.user, following=self.followed, tenant=self.tenant)
        Post.objects.create(
            author=self.followed, content="S",
            visibility=Visibility.PRIVATE, tenant=self.tenant,
        )
        results = self.client.get(f"{BASE}/posts/feed/").data.get("results", [])
        assert len(results) == 0


@pytest.mark.django_db
class TestCommentCRUD:
    """Comment create, list, delete."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VC_T1", defaults={"display_name": "Comment View Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="vcuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.other = User.objects.create_user(
            username="vcuser1b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.post = Post.objects.create(
            author=self.user, content="Commentable", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_create_comment(self):
        resp = self.client.post(
            f"{BASE}/comments/",
            {"post": str(self.post.pk), "content": "Great!"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        self.post.refresh_from_db()
        assert self.post.comment_count == 1

    def test_list_comments(self):
        Comment.objects.create(author=self.user, post=self.post, content="C", tenant=self.tenant)
        resp = self.client.get(f"{BASE}/comments/", {"post": str(self.post.pk)})
        results = resp.data.get("results", resp.data)
        assert len(results) == 1

    def test_delete_comment_decrements_count(self):
        self.client.post(
            f"{BASE}/comments/",
            {"post": str(self.post.pk), "content": "Temp"}, format="json",
        )
        comment = Comment.objects.filter(post=self.post, author=self.user).first()
        self.post.refresh_from_db()
        assert self.post.comment_count == 1
        resp = self.client.delete(f"{BASE}/comments/{comment.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        self.post.refresh_from_db()
        assert self.post.comment_count == 0

    def test_non_author_cannot_delete_comment(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post, content="M", tenant=self.tenant,
        )
        resp = _jwt_client(self.other, self.tenant).delete(f"{BASE}/comments/{comment.pk}/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestReactionCRUD:
    """Reaction create and delete (toggle behavior)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VR_T1", defaults={"display_name": "Reaction View Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="vruser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.other = User.objects.create_user(
            username="vruser1b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.post = Post.objects.create(
            author=self.user, content="Reactable", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_create_reaction(self):
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LIKE"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1

    def test_same_reaction_toggles_off(self):
        self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LIKE"}, format="json",
        )
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LIKE"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        self.post.refresh_from_db()
        assert self.post.reaction_count == 0

    def test_different_reaction_updates(self):
        self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LIKE"}, format="json",
        )
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LOVE"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1

    def test_list_reactions_for_post(self):
        self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LIKE"}, format="json",
        )
        resp = self.client.get(f"{BASE}/reactions/", {"post": str(self.post.pk)})
        results = resp.data.get("results", resp.data)
        assert len(results) == 1

    def test_delete_reaction(self):
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "RESPECT"}, format="json",
        )
        reaction_id = resp.data["id"]
        resp = self.client.delete(f"{BASE}/reactions/{reaction_id}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        # Soft-deleted rows are excluded from the default (filtered) manager;
        # use all_objects to fetch it and confirm it's marked deleted.
        assert Reaction.all_objects.get(pk=reaction_id).is_deleted is True

    def test_non_owner_cannot_delete_reaction(self):
        resp = _jwt_client(self.other, self.tenant).post(
            f"{BASE}/reactions/",
            {"post": str(self.post.pk), "reaction_type": "LIKE"}, format="json",
        )
        reaction_id = resp.data["id"]
        resp = self.client.delete(f"{BASE}/reactions/{reaction_id}/")
        assert resp.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestFollowCRUD:
    """Follow create, toggle, following, followers."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VF_T1", defaults={"display_name": "Follow View Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="vfuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.target = User.objects.create_user(
            username="vfuser1b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.client = _jwt_client(self.user, self.tenant)

    def test_create_follow(self):
        resp = self.client.post(
            f"{BASE}/follows/", {"following": str(self.target.pk)}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert Follow.objects.filter(
            follower=self.user, following=self.target, tenant=self.tenant,
        ).exists()

    def test_follow_increments_counters(self):
        self.client.post(
            f"{BASE}/follows/", {"following": str(self.target.pk)}, format="json",
        )
        assert UserProfile.objects.get(user=self.user).following_count == 1
        assert UserProfile.objects.get(user=self.target).followers_count == 1

    def test_toggle_follow_on(self):
        resp = self.client.post(
            f"{BASE}/follows/toggle/", {"following": str(self.target.pk)}, format="json",
        )
        assert resp.data["following"] is True

    def test_toggle_follow_off(self):
        self.client.post(
            f"{BASE}/follows/toggle/", {"following": str(self.target.pk)}, format="json",
        )
        resp = self.client.post(
            f"{BASE}/follows/toggle/", {"following": str(self.target.pk)}, format="json",
        )
        assert resp.data["following"] is False

    def test_toggle_missing_field(self):
        resp = self.client.post(f"{BASE}/follows/toggle/", {}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    def test_toggle_nonexistent_user(self):
        resp = self.client.post(
            f"{BASE}/follows/toggle/", {"following": 999999}, format="json",
        )
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_following_list(self):
        self.client.post(
            f"{BASE}/follows/", {"following": str(self.target.pk)}, format="json",
        )
        resp = self.client.get(f"{BASE}/follows/following/")
        assert len(resp.data) == 1

    def test_followers_list(self):
        _jwt_client(self.target, self.tenant).post(
            f"{BASE}/follows/", {"following": str(self.user.pk)}, format="json",
        )
        resp = self.client.get(f"{BASE}/follows/followers/")
        assert len(resp.data) == 1

    def test_unfollow_via_delete(self):
        self.client.post(
            f"{BASE}/follows/", {"following": str(self.target.pk)}, format="json",
        )
        follow = Follow.objects.get(follower=self.user, following=self.target, tenant=self.tenant)
        resp = self.client.delete(f"{BASE}/follows/{follow.pk}/")
        assert resp.status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.django_db
class TestUserProfileCRUD:
    """Profile retrieve, update, and /me/ endpoint."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VU_T1", defaults={"display_name": "Profile View Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="vuuser1", password="test123", role="ADMIN", tenant=self.tenant
        )
        self.other = User.objects.create_user(
            username="vuuser1b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.profile = UserProfile.objects.create(user=self.user, bio="Original bio")
        self.client = _jwt_client(self.user, self.tenant)

    def test_me_endpoint(self):
        resp = self.client.get(f"{BASE}/profiles/me/")
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["bio"] == "Original bio"

    def test_me_creates_profile_if_missing(self):
        UserProfile.objects.filter(user=self.other).delete()
        resp = _jwt_client(self.other, self.tenant).get(f"{BASE}/profiles/me/")
        assert resp.status_code == status.HTTP_200_OK

    def test_retrieve_profile(self):
        resp = self.client.get(f"{BASE}/profiles/{self.profile.pk}/")
        assert resp.data["bio"] == "Original bio"

    def test_owner_can_update(self):
        resp = self.client.patch(
            f"{BASE}/profiles/{self.profile.pk}/", {"bio": "Updated"}, format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        self.profile.refresh_from_db()
        assert self.profile.bio == "Updated"

    def test_non_owner_cannot_update(self):
        resp = _jwt_client(self.other, self.tenant).patch(
            f"{BASE}/profiles/{self.profile.pk}/", {"bio": "H"}, format="json",
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_list_profiles(self):
        assert self.client.get(f"{BASE}/profiles/").status_code == status.HTTP_200_OK


@pytest.mark.django_db
class TestVisibilityAndTenantIsolation:
    """Posts filtered by visibility and tenant isolation."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="VV_T1", defaults={"display_name": "Vis Tenant"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="VV_T2", defaults={"display_name": "Other Tenant"}
        )[0]
        # VIEWER, not ADMIN: this class pins tenant-scoped list/visibility
        # behavior, and ADMIN now bypasses tenant scoping entirely in
        # PostViewSet.get_queryset() (same idiom as UserProfileViewSet), so
        # an ADMIN-role user here would see across tenants and defeat the
        # isolation this class checks. permission_codename is None for every
        # social viewset (see module docstring), so role otherwise has no
        # bearing on what these tests exercise.
        self.user = User.objects.create_user(
            username="vvuser1", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.other = User.objects.create_user(
            username="vvuser1b", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.foreign = User.objects.create_user(
            username="vvforeign", password="test123", role="VIEWER", tenant=self.tenant_b,
        )
        self.client = _jwt_client(self.user, self.tenant)
        self.other_client = _jwt_client(self.other, self.tenant)
        self.foreign_client = _jwt_client(self.foreign, self.tenant_b)

    def _count(self, client):
        return client.get(f"{BASE}/posts/").data["count"]

    def test_public_visible_to_all(self):
        Post.objects.create(author=self.user, content="P", visibility=Visibility.PUBLIC, tenant=self.tenant)
        assert self._count(self.other_client) == 1

    def test_tenant_post_visible_in_same_tenant(self):
        Post.objects.create(author=self.user, content="T", visibility=Visibility.TENANT, tenant=self.tenant)
        assert self._count(self.other_client) == 1

    def test_followers_post_visible_to_follower(self):
        Follow.objects.create(follower=self.other, following=self.user, tenant=self.tenant)
        Post.objects.create(author=self.user, content="F", visibility=Visibility.FOLLOWERS, tenant=self.tenant)
        assert self._count(self.other_client) == 1

    def test_followers_post_hidden_from_non_follower(self):
        Post.objects.create(author=self.user, content="F", visibility=Visibility.FOLLOWERS, tenant=self.tenant)
        assert self._count(self.other_client) == 0

    def test_private_post_hidden_from_others(self):
        Post.objects.create(author=self.user, content="P", visibility=Visibility.PRIVATE, tenant=self.tenant)
        assert self._count(self.other_client) == 0

    def test_private_post_visible_to_author(self):
        Post.objects.create(author=self.user, content="P", visibility=Visibility.PRIVATE, tenant=self.tenant)
        assert self._count(self.client) == 1

    def test_tenant_a_cannot_see_tenant_b_posts(self):
        Post.objects.create(author=self.foreign, content="B", tenant=self.tenant_b)
        assert self._count(self.client) == 0

    def test_tenant_b_sees_own_posts(self):
        Post.objects.create(author=self.foreign, content="B", tenant=self.tenant_b)
        assert self._count(self.foreign_client) == 1

    def test_cross_tenant_comment_isolation(self):
        post_a = Post.objects.create(author=self.user, content="A", tenant=self.tenant)
        resp = self.foreign_client.get(f"{BASE}/comments/", {"post": str(post_a.pk)})
        results = resp.data.get("results", resp.data)
        assert len(results) == 0


@pytest.mark.django_db
class TestCrossTenantWriteIsolation:
    """
    `CommentCreateSerializer`/`ReactionCreateSerializer` used to accept a
    `post`/`comment`/`parent` ID belonging to *any* tenant — DRF's default
    PrimaryKeyRelatedField only checks that the row exists, and the
    ViewSet's tenant filtering only narrows `get_queryset()` for reads.
    These tests pin the write-time fix: a cross-tenant target is rejected
    with 400, and same-tenant writes are unaffected.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="XW_T1", defaults={"display_name": "Cross-Write Tenant A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="XW_T2", defaults={"display_name": "Cross-Write Tenant B"}
        )[0]
        self.user = User.objects.create_user(
            username="xwuser1", password="test123", role="VIEWER", tenant=self.tenant
        )
        self.foreign = User.objects.create_user(
            username="xwforeign", password="test123", role="VIEWER", tenant=self.tenant_b,
        )
        self.post_a = Post.objects.create(author=self.user, content="A", tenant=self.tenant)
        self.post_b = Post.objects.create(author=self.foreign, content="B", tenant=self.tenant_b)
        self.comment_b = Comment.objects.create(
            author=self.foreign, post=self.post_b, content="CB", tenant=self.tenant_b,
        )
        self.client = _jwt_client(self.user, self.tenant)

    # -- comments: cross-tenant `post` -----------------------------------

    def test_create_comment_on_foreign_post_rejected(self):
        resp = self.client.post(
            f"{BASE}/comments/",
            {"post": str(self.post_b.pk), "content": "sneaky"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert not Comment.objects.filter(post=self.post_b, author=self.user).exists()

    def test_create_comment_on_own_tenant_post_still_works(self):
        resp = self.client.post(
            f"{BASE}/comments/",
            {"post": str(self.post_a.pk), "content": "fine"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert Comment.objects.filter(post=self.post_a, author=self.user).exists()

    # -- comments: cross-tenant `parent` ----------------------------------

    def test_reply_to_foreign_comment_rejected(self):
        resp = self.client.post(
            f"{BASE}/comments/",
            {
                "post": str(self.post_a.pk),
                "parent": str(self.comment_b.pk),
                "content": "sneaky reply",
            },
            format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert not Comment.objects.filter(parent=self.comment_b).exists()

    def test_reply_to_own_tenant_comment_still_works(self):
        parent = Comment.objects.create(
            author=self.user, post=self.post_a, content="parent", tenant=self.tenant,
        )
        resp = self.client.post(
            f"{BASE}/comments/",
            {"post": str(self.post_a.pk), "parent": str(parent.pk), "content": "reply"},
            format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert Comment.objects.filter(parent=parent).exists()

    # -- reactions: cross-tenant `post` -----------------------------------

    def test_react_to_foreign_post_rejected(self):
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post_b.pk), "reaction_type": "LIKE"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert not Reaction.objects.filter(post=self.post_b, user=self.user).exists()

    def test_react_to_own_tenant_post_still_works(self):
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"post": str(self.post_a.pk), "reaction_type": "LIKE"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert Reaction.objects.filter(post=self.post_a, user=self.user).exists()

    # -- reactions: cross-tenant `comment` ---------------------------------

    def test_react_to_foreign_comment_rejected(self):
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"comment": str(self.comment_b.pk), "reaction_type": "LIKE"}, format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert not Reaction.objects.filter(comment=self.comment_b, user=self.user).exists()

    def test_react_to_own_tenant_comment_still_works(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post_a, content="c", tenant=self.tenant,
        )
        resp = self.client.post(
            f"{BASE}/reactions/",
            {"comment": str(comment.pk), "reaction_type": "LIKE"}, format="json",
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert Reaction.objects.filter(comment=comment, user=self.user).exists()


@pytest.mark.django_db
class TestUserProfileTenantIsolation:
    """UserProfileViewSet.get_queryset() must scope profiles by tenant (C1).

    Pre-fix, get_queryset() was `UserProfile.objects.select_related("user").
    all()` filtered only by the optional `?user=` query param — no tenant
    filter at all, so GET /profiles/ (and GET /profiles/{id}/, since retrieve
    uses the same get_queryset()) let any authenticated user enumerate and
    read every tenant's profiles. Writes were already safe
    (IsProfileOwnerOrReadOnly), so this covers the read leak specifically.
    """

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="UPI_T1", defaults={"display_name": "Profile Isolation A"}
        )[0]
        self.tenant_b = Tenant.objects.get_or_create(
            code="UPI_T2", defaults={"display_name": "Profile Isolation B"}
        )[0]
        self.user = User.objects.create_user(
            username="upiuser1", password="test123", role="VIEWER", tenant=self.tenant,
        )
        self.foreign = User.objects.create_user(
            username="upiforeign", password="test123", role="VIEWER", tenant=self.tenant_b,
        )
        self.admin = User.objects.create_user(
            username="upiadmin", password="test123", role="ADMIN", tenant=self.tenant,
        )
        self.profile = UserProfile.objects.create(user=self.user, bio="Home bio")
        self.foreign_profile = UserProfile.objects.create(user=self.foreign, bio="Foreign bio")
        self.client = _jwt_client(self.user, self.tenant)
        self.admin_client = _jwt_client(self.admin, self.tenant)

    def test_list_excludes_other_tenant_profiles(self):
        resp = self.client.get(f"{BASE}/profiles/")
        assert resp.status_code == status.HTTP_200_OK
        ids = {row["id"] for row in resp.data["results"]}
        assert str(self.profile.pk) in ids
        assert str(self.foreign_profile.pk) not in ids, (
            "A VIEWER listed a profile belonging to another tenant."
        )

    def test_list_user_filter_cannot_bypass_tenant_scope(self):
        """The `?user=` filter narrows within the tenant scope, it does not widen it."""
        resp = self.client.get(f"{BASE}/profiles/", {"user": str(self.foreign.pk)})
        assert resp.status_code == status.HTTP_200_OK
        results = resp.data.get("results", resp.data)
        assert len(results) == 0

    def test_retrieve_other_tenant_profile_404s(self):
        resp = self.client.get(f"{BASE}/profiles/{self.foreign_profile.pk}/")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_admin_sees_profiles_across_all_tenants(self):
        resp = self.admin_client.get(f"{BASE}/profiles/")
        assert resp.status_code == status.HTTP_200_OK
        ids = {row["id"] for row in resp.data["results"]}
        assert str(self.profile.pk) in ids
        assert str(self.foreign_profile.pk) in ids


# ---------------------------------------------------------------------------
# Gap 2 — Post/Comment/Reaction/FollowViewSet.get_queryset() must fail closed
#
# Pre-fix, all four did `if tenant: qs = qs.filter(tenant=tenant)` with no
# `else` branch — a non-ADMIN caller whose request.tenant resolved to None
# fell through to the *unfiltered* queryset (every tenant's posts/comments/
# reactions/follows), not an empty one. TenantPermission.has_permission
# already denies such a request at the permission layer before dispatch()
# ever calls get_queryset() (a non-ADMIN with no request.tenant gets 403),
# so this can't be reproduced through a real HTTP call — these tests call
# get_queryset() directly, bypassing permission_classes entirely, to pin the
# method's own behavior as defense in depth: if anything upstream ever
# changed and let a tenant-less request through, the queryset itself must
# still come back empty for a non-ADMIN caller rather than leaking
# everyone's data. Same shape as UserProfileViewSet.get_queryset(), fixed
# earlier for the identical gap.
# ---------------------------------------------------------------------------

def _get_queryset_bare(view_cls, user, tenant, action="list"):
    """Instantiate view_cls and call get_queryset() directly against a bare
    request carrying only `.user` and `.tenant` — no dispatch(), no
    permission_classes, no authentication middleware."""
    request = APIRequestFactory().get("/")
    request.user = user
    request.tenant = tenant
    view = view_cls()
    view.request = request
    view.action = action
    view.format_kwarg = None
    return view.get_queryset()


@pytest.mark.django_db
class TestSocialViewSetsFailClosedWithoutTenant:
    """Post/Comment/Reaction/FollowViewSet.get_queryset() must return
    qs.none() for a non-ADMIN caller when request.tenant is falsy — not the
    unfiltered queryset."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="FC_T1", defaults={"display_name": "Fail Closed Tenant"}
        )[0]
        self.other_tenant = Tenant.objects.get_or_create(
            code="FC_T2", defaults={"display_name": "Fail Closed Tenant 2"}
        )[0]
        self.user = User.objects.create_user(
            username="fcuser1", password="test123", role="VIEWER", tenant=self.tenant,
        )
        self.other_user = User.objects.create_user(
            username="fcuser2", password="test123", role="VIEWER", tenant=self.other_tenant,
        )
        # Data across two tenants, so a fall-through-to-unfiltered bug would
        # show up as a non-zero count instead of 0.
        self.post = Post.objects.create(author=self.user, content="P", tenant=self.tenant)
        Post.objects.create(author=self.other_user, content="OP", tenant=self.other_tenant)
        Comment.objects.create(author=self.user, post=self.post, content="C", tenant=self.tenant)
        Reaction.objects.create(user=self.user, post=self.post, tenant=self.tenant)
        Follow.objects.create(follower=self.user, following=self.other_user, tenant=self.tenant)

    def test_post_queryset_none_without_tenant(self):
        qs = _get_queryset_bare(PostViewSet, self.user, None)
        assert qs.count() == 0

    def test_comment_queryset_none_without_tenant(self):
        qs = _get_queryset_bare(CommentViewSet, self.user, None)
        assert qs.count() == 0

    def test_reaction_queryset_none_without_tenant(self):
        qs = _get_queryset_bare(ReactionViewSet, self.user, None)
        assert qs.count() == 0

    def test_follow_queryset_none_without_tenant(self):
        qs = _get_queryset_bare(FollowViewSet, self.user, None)
        assert qs.count() == 0

    def test_post_queryset_still_scoped_normally_when_tenant_present(self):
        """Sanity check: the fix narrows the no-tenant case only — a request
        with a real tenant still gets that tenant's (visible) posts, not an
        unconditional qs.none()."""
        qs = _get_queryset_bare(PostViewSet, self.user, self.tenant)
        assert list(qs) == [self.post]
