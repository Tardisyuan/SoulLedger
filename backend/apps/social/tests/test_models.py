"""
Tests for social domain models: Post, Comment, Reaction, Follow, UserProfile.
"""
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from apps.social.models import (
    Comment,
    Follow,
    Post,
    Reaction,
    ReactionType,
    UserProfile,
    Visibility,
)
from apps.tenants.models import Tenant

User = get_user_model()


@pytest.mark.django_db
class TestPostModel:
    """Test Post model constraints and behavior."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="POST_T", defaults={"display_name": "Post Test Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="postauthor", password="test123"
        )

    def test_str_representation(self):
        post = Post.objects.create(
            author=self.user, content="Hello", tenant=self.tenant
        )
        assert str(post) == f"Post({post.pk}) by {self.user.pk}"

    def test_default_visibility_is_public(self):
        post = Post.objects.create(
            author=self.user, content="Public post", tenant=self.tenant
        )
        assert post.visibility == Visibility.PUBLIC

    def test_comment_count_starts_at_zero(self):
        post = Post.objects.create(
            author=self.user, content="New post", tenant=self.tenant
        )
        assert post.comment_count == 0

    def test_reaction_count_starts_at_zero(self):
        post = Post.objects.create(
            author=self.user, content="New post", tenant=self.tenant
        )
        assert post.reaction_count == 0

    def test_ordering_by_create_time_desc(self):
        p1 = Post.objects.create(
            author=self.user, content="First", tenant=self.tenant
        )
        p2 = Post.objects.create(
            author=self.user, content="Second", tenant=self.tenant
        )
        posts = list(Post.objects.all())
        assert posts[0].pk == p2.pk
        assert posts[1].pk == p1.pk

    def test_post_requires_author(self):
        with pytest.raises(Exception):
            Post.objects.create(content="No author", tenant=self.tenant)

    def test_post_requires_tenant(self):
        with pytest.raises(Exception):
            Post.objects.create(author=self.user, content="No tenant")


@pytest.mark.django_db
class TestCommentModel:
    """Test Comment model constraints and behavior."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="COMM_T", defaults={"display_name": "Comment Test Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="commentauthor", password="test123"
        )
        self.post = Post.objects.create(
            author=self.user, content="Parent post", tenant=self.tenant
        )

    def test_str_representation(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post, content="Hi", tenant=self.tenant
        )
        assert str(comment) == f"Comment({comment.pk}) on {self.post.pk}"

    def test_comment_with_parent(self):
        parent = Comment.objects.create(
            author=self.user, post=self.post, content="Parent", tenant=self.tenant
        )
        child = Comment.objects.create(
            author=self.user,
            post=self.post,
            content="Child",
            parent=parent,
            tenant=self.tenant,
        )
        assert child.parent_id == parent.pk
        child.refresh_from_db()
        assert parent.replies.count() == 1

    def test_comment_requires_post(self):
        with pytest.raises(Exception):
            Comment.objects.create(
                author=self.user, content="No post", tenant=self.tenant
            )

    def test_comment_requires_tenant(self):
        with pytest.raises(Exception):
            Comment.objects.create(
                author=self.user, post=self.post, content="No tenant"
            )

    def test_comment_requires_author(self):
        with pytest.raises(Exception):
            Comment.objects.create(
                post=self.post, content="No author", tenant=self.tenant
            )


@pytest.mark.django_db
class TestReactionModel:
    """Test Reaction model constraints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="REACT_T", defaults={"display_name": "Reaction Test Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="reactor", password="test123"
        )
        self.post = Post.objects.create(
            author=self.user, content="React to me", tenant=self.tenant
        )

    def test_reaction_on_post(self):
        reaction = Reaction.objects.create(
            user=self.user, post=self.post,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        assert reaction.post_id == self.post.pk
        assert reaction.comment_id is None

    def test_reaction_on_comment(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post,
            content="Reactable", tenant=self.tenant,
        )
        reaction = Reaction.objects.create(
            user=self.user, comment=comment,
            reaction_type=ReactionType.LOVE, tenant=self.tenant,
        )
        assert reaction.comment_id == comment.pk
        assert reaction.post_id is None

    def test_exactly_one_target_constraint_both_set(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post,
            content="Target", tenant=self.tenant,
        )
        with pytest.raises(Exception):
            Reaction.objects.create(
                user=self.user, post=self.post, comment=comment,
                reaction_type=ReactionType.LIKE, tenant=self.tenant,
            )

    def test_exactly_one_target_constraint_neither_set(self):
        with pytest.raises(Exception):
            Reaction.objects.create(
                user=self.user,
                reaction_type=ReactionType.LIKE, tenant=self.tenant,
            )

    def test_unique_reaction_per_user_per_post(self):
        Reaction.objects.create(
            user=self.user, post=self.post,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        with pytest.raises(Exception):
            Reaction.objects.create(
                user=self.user, post=self.post,
                reaction_type=ReactionType.LOVE, tenant=self.tenant,
            )

    def test_unique_reaction_per_user_per_comment(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post,
            content="Target", tenant=self.tenant,
        )
        Reaction.objects.create(
            user=self.user, comment=comment,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        with pytest.raises(Exception):
            Reaction.objects.create(
                user=self.user, comment=comment,
                reaction_type=ReactionType.RESPECT, tenant=self.tenant,
            )

    def test_str_representation(self):
        reaction = Reaction.objects.create(
            user=self.user, post=self.post,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        s = str(reaction)
        assert "LIKE" in s
        assert str(self.user.pk) in s

    def test_clean_validation_both_targets(self):
        comment = Comment.objects.create(
            author=self.user, post=self.post,
            content="Target", tenant=self.tenant,
        )
        r = Reaction(
            user=self.user, post=self.post, comment=comment,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        with pytest.raises(ValidationError):
            r.clean()

    def test_clean_validation_neither_target(self):
        r = Reaction(
            user=self.user,
            reaction_type=ReactionType.LIKE, tenant=self.tenant,
        )
        with pytest.raises(ValidationError):
            r.clean()


@pytest.mark.django_db
class TestFollowModel:
    """Test Follow model constraints."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="FOLLOW_T", defaults={"display_name": "Follow Test Tenant"}
        )[0]
        self.user1 = User.objects.create_user(
            username="follower1", password="test123"
        )
        self.user2 = User.objects.create_user(
            username="following1", password="test123"
        )

    def test_str_representation(self):
        follow = Follow.objects.create(
            follower=self.user1, following=self.user2, tenant=self.tenant
        )
        s = str(follow)
        assert str(self.user1.pk) in s
        assert str(self.user2.pk) in s

    def test_no_self_follow(self):
        with pytest.raises(Exception):
            Follow.objects.create(
                follower=self.user1, following=self.user1, tenant=self.tenant
            )

    def test_unique_follow_constraint(self):
        Follow.objects.create(
            follower=self.user1, following=self.user2, tenant=self.tenant
        )
        with pytest.raises(Exception):
            Follow.objects.create(
                follower=self.user1, following=self.user2, tenant=self.tenant
            )

    def test_reverse_follow_allowed(self):
        Follow.objects.create(
            follower=self.user1, following=self.user2, tenant=self.tenant
        )
        follow2 = Follow.objects.create(
            follower=self.user2, following=self.user1, tenant=self.tenant
        )
        assert follow2.pk is not None

    def test_clean_validation_self_follow(self):
        follow = Follow(
            follower=self.user1, following=self.user1, tenant=self.tenant
        )
        with pytest.raises(ValidationError):
            follow.clean()


@pytest.mark.django_db
class TestUserProfileModel:
    """Test UserProfile model."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.user = User.objects.create_user(
            username="profileuser", password="test123"
        )

    def test_str_representation(self):
        profile = UserProfile.objects.create(user=self.user)
        assert str(profile) == f"Profile({self.user.pk})"

    def test_default_counters(self):
        profile = UserProfile.objects.create(user=self.user)
        assert profile.followers_count == 0
        assert profile.following_count == 0
        assert profile.post_count == 0

    def test_default_bio_and_avatar(self):
        profile = UserProfile.objects.create(user=self.user)
        assert profile.bio == ""
        assert profile.avatar_url == ""

    def test_one_to_one_constraint(self):
        UserProfile.objects.create(user=self.user)
        with pytest.raises(Exception):
            UserProfile.objects.create(user=self.user)


@pytest.mark.django_db
class TestVisibilityChoices:
    """Test Visibility enum choices."""

    def test_all_choices_exist(self):
        assert Visibility.PUBLIC == "PUBLIC"
        assert Visibility.TENANT == "TENANT"
        assert Visibility.FOLLOWERS == "FOLLOWERS"
        assert Visibility.PRIVATE == "PRIVATE"

    def test_choices_count(self):
        assert len(Visibility.choices) == 4


@pytest.mark.django_db
class TestReactionTypeChoices:
    """Test ReactionType enum choices."""

    def test_all_choices_exist(self):
        assert ReactionType.LIKE == "LIKE"
        assert ReactionType.LOVE == "LOVE"
        assert ReactionType.RESPECT == "RESPECT"
        assert ReactionType.SYMPATHY == "SYMPATHY"
        assert ReactionType.ETERNAL_LIGHT == "ETERNAL_LIGHT"

    def test_choices_count(self):
        assert len(ReactionType.choices) == 5
