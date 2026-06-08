"""
Tests for social domain permission classes.
"""
from unittest.mock import MagicMock

import pytest
from django.contrib.auth import get_user_model

from apps.social.models import (
    Follow,
    Post,
    Reaction,
    ReactionType,
    UserProfile,
)
from apps.social.permissions import (
    IsAuthorOrReadOnly,
    IsFollowOwnerOrReadOnly,
    IsProfileOwnerOrReadOnly,
    IsReactionOwnerOrReadOnly,
)
from apps.tenants.models import Tenant

User = get_user_model()


@pytest.mark.django_db
class TestIsAuthorOrReadOnly:
    """Test IsAuthorOrReadOnly permission class."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="PERM_T1", defaults={"display_name": "Perm Test Tenant"}
        )[0]
        self.author = User.objects.create_user(
            username="author1", password="test123"
        )
        self.other = User.objects.create_user(
            username="other1", password="test123"
        )
        self.post = Post.objects.create(
            author=self.author, content="My post", tenant=self.tenant
        )
        self.perm = IsAuthorOrReadOnly()

    def _make_request(self, user, method="GET"):
        req = MagicMock()
        req.user = user
        req.method = method
        return req

    def test_author_can_edit(self):
        req = self._make_request(self.author, "PUT")
        assert self.perm.has_object_permission(req, None, self.post) is True

    def test_author_can_delete(self):
        req = self._make_request(self.author, "DELETE")
        assert self.perm.has_object_permission(req, None, self.post) is True

    def test_other_cannot_edit(self):
        req = self._make_request(self.other, "PUT")
        assert self.perm.has_object_permission(req, None, self.post) is False

    def test_other_cannot_delete(self):
        req = self._make_request(self.other, "DELETE")
        assert self.perm.has_object_permission(req, None, self.post) is False

    def test_anyone_can_read(self):
        req = self._make_request(self.other, "GET")
        assert self.perm.has_object_permission(req, None, self.post) is True

    def test_anyone_can_list(self):
        req = self._make_request(self.other, "OPTIONS")
        assert self.perm.has_object_permission(req, None, self.post) is True

    def test_no_author_field_returns_true(self):
        obj = MagicMock(spec=[])
        req = self._make_request(self.other, "DELETE")
        assert self.perm.has_object_permission(req, None, obj) is True


@pytest.mark.django_db
class TestIsReactionOwnerOrReadOnly:
    """Test IsReactionOwnerOrReadOnly permission class."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="PERM_T2", defaults={"display_name": "Perm Test Tenant 2"}
        )[0]
        self.owner = User.objects.create_user(
            username="reactionowner", password="test123"
        )
        self.other = User.objects.create_user(
            username="reactionother", password="test123"
        )
        self.post = Post.objects.create(
            author=self.owner, content="Post", tenant=self.tenant
        )
        self.reaction = Reaction.objects.create(
            user=self.owner, post=self.post,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        self.perm = IsReactionOwnerOrReadOnly()

    def _make_request(self, user, method="GET"):
        req = MagicMock()
        req.user = user
        req.method = method
        return req

    def test_owner_can_delete(self):
        req = self._make_request(self.owner, "DELETE")
        assert self.perm.has_object_permission(req, None, self.reaction) is True

    def test_owner_can_edit(self):
        req = self._make_request(self.owner, "PATCH")
        assert self.perm.has_object_permission(req, None, self.reaction) is True

    def test_other_cannot_delete(self):
        req = self._make_request(self.other, "DELETE")
        assert self.perm.has_object_permission(req, None, self.reaction) is False

    def test_other_cannot_edit(self):
        req = self._make_request(self.other, "PATCH")
        assert self.perm.has_object_permission(req, None, self.reaction) is False

    def test_anyone_can_read(self):
        req = self._make_request(self.other, "GET")
        assert self.perm.has_object_permission(req, None, self.reaction) is True


@pytest.mark.django_db
class TestIsFollowOwnerOrReadOnly:
    """Test IsFollowOwnerOrReadOnly permission class."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="PERM_T3", defaults={"display_name": "Perm Test Tenant 3"}
        )[0]
        self.follower = User.objects.create_user(
            username="the_follower", password="test123"
        )
        self.following = User.objects.create_user(
            username="the_following", password="test123"
        )
        self.other = User.objects.create_user(
            username="followother", password="test123"
        )
        self.follow = Follow.objects.create(
            follower=self.follower, following=self.following, tenant=self.tenant
        )
        self.perm = IsFollowOwnerOrReadOnly()

    def _make_request(self, user, method="GET"):
        req = MagicMock()
        req.user = user
        req.method = method
        return req

    def test_follower_can_delete_own_follow(self):
        req = self._make_request(self.follower, "DELETE")
        assert self.perm.has_object_permission(req, None, self.follow) is True

    def test_other_cannot_delete_follow(self):
        req = self._make_request(self.other, "DELETE")
        assert self.perm.has_object_permission(req, None, self.follow) is False

    def test_followed_user_cannot_delete(self):
        req = self._make_request(self.following, "DELETE")
        assert self.perm.has_object_permission(req, None, self.follow) is False

    def test_anyone_can_read(self):
        req = self._make_request(self.other, "GET")
        assert self.perm.has_object_permission(req, None, self.follow) is True


@pytest.mark.django_db
class TestIsProfileOwnerOrReadOnly:
    """Test IsProfileOwnerOrReadOnly permission class."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.owner = User.objects.create_user(
            username="profileowner", password="test123"
        )
        self.other = User.objects.create_user(
            username="profileother", password="test123"
        )
        self.profile = UserProfile.objects.create(
            user=self.owner, bio="My bio",
        )
        self.perm = IsProfileOwnerOrReadOnly()

    def _make_request(self, user, method="GET"):
        req = MagicMock()
        req.user = user
        req.method = method
        return req

    def test_owner_can_update(self):
        req = self._make_request(self.owner, "PUT")
        assert self.perm.has_object_permission(req, None, self.profile) is True

    def test_owner_can_patch(self):
        req = self._make_request(self.owner, "PATCH")
        assert self.perm.has_object_permission(req, None, self.profile) is True

    def test_other_cannot_update(self):
        req = self._make_request(self.other, "PUT")
        assert self.perm.has_object_permission(req, None, self.profile) is False

    def test_other_cannot_patch(self):
        req = self._make_request(self.other, "PATCH")
        assert self.perm.has_object_permission(req, None, self.profile) is False

    def test_anyone_can_read(self):
        req = self._make_request(self.other, "GET")
        assert self.perm.has_object_permission(req, None, self.profile) is True
