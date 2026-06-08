"""
Tests for social domain business logic services.
"""
import pytest
from django.contrib.auth import get_user_model

from apps.social.models import (
    Comment,
    Follow,
    Post,
    Reaction,
    ReactionType,
    UserProfile,
)
from apps.social.services import (
    CommentService,
    FollowService,
    PostService,
    ReactionService,
)
from apps.tenants.models import Tenant

User = get_user_model()


@pytest.mark.django_db
class TestPostService:
    """Test PostService denormalized counter methods."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="PSVC_T", defaults={"display_name": "PostService Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="psauthor", password="test123"
        )
        self.post = Post.objects.create(
            author=self.user, content="Service test", tenant=self.tenant
        )

    def test_increment_comment_count(self):
        assert self.post.comment_count == 0
        PostService.increment_comment_count(self.post.pk)
        self.post.refresh_from_db()
        assert self.post.comment_count == 1

    def test_decrement_comment_count(self):
        Post.objects.filter(pk=self.post.pk).update(comment_count=3)
        self.post.refresh_from_db()
        assert self.post.comment_count == 3
        PostService.decrement_comment_count(self.post.pk)
        self.post.refresh_from_db()
        assert self.post.comment_count == 2

    def test_decrement_comment_count_floor_at_zero(self):
        assert self.post.comment_count == 0
        PostService.decrement_comment_count(self.post.pk)
        self.post.refresh_from_db()
        assert self.post.comment_count == 0

    def test_increment_reaction_count(self):
        assert self.post.reaction_count == 0
        PostService.increment_reaction_count(self.post.pk)
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1

    def test_decrement_reaction_count(self):
        Post.objects.filter(pk=self.post.pk).update(reaction_count=5)
        self.post.refresh_from_db()
        PostService.decrement_reaction_count(self.post.pk)
        self.post.refresh_from_db()
        assert self.post.reaction_count == 4

    def test_decrement_reaction_count_floor_at_zero(self):
        assert self.post.reaction_count == 0
        PostService.decrement_reaction_count(self.post.pk)
        self.post.refresh_from_db()
        assert self.post.reaction_count == 0

    def test_increment_post_count_creates_profile(self):
        PostService.increment_post_count(self.user.pk)
        profile = UserProfile.objects.get(user=self.user)
        assert profile.post_count == 1

    def test_increment_post_count_increments(self):
        PostService.increment_post_count(self.user.pk)
        PostService.increment_post_count(self.user.pk)
        profile = UserProfile.objects.get(user=self.user)
        assert profile.post_count == 2


@pytest.mark.django_db
class TestCommentService:
    """Test CommentService create and delete with counter sync."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="CSVC_T", defaults={"display_name": "CommentService Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="csauthor", password="test123"
        )
        self.post = Post.objects.create(
            author=self.user, content="Parent post", tenant=self.tenant
        )

    def test_create_comment_increments_count(self):
        assert self.post.comment_count == 0
        comment = CommentService.create_comment(
            author=self.user,
            post=self.post,
            content="New comment",
            tenant=self.tenant,
        )
        self.post.refresh_from_db()
        assert self.post.comment_count == 1
        assert comment.content == "New comment"
        assert comment.post_id == self.post.pk

    def test_create_multiple_comments_increments(self):
        CommentService.create_comment(
            author=self.user, post=self.post,
            content="C1", tenant=self.tenant,
        )
        CommentService.create_comment(
            author=self.user, post=self.post,
            content="C2", tenant=self.tenant,
        )
        self.post.refresh_from_db()
        assert self.post.comment_count == 2

    def test_create_comment_with_parent(self):
        parent = CommentService.create_comment(
            author=self.user, post=self.post,
            content="Parent", tenant=self.tenant,
        )
        child = CommentService.create_comment(
            author=self.user, post=self.post,
            content="Child", parent=parent, tenant=self.tenant,
        )
        assert child.parent_id == parent.pk

    def test_delete_comment_decrements_count(self):
        comment = CommentService.create_comment(
            author=self.user, post=self.post,
            content="To delete", tenant=self.tenant,
        )
        self.post.refresh_from_db()
        assert self.post.comment_count == 1
        CommentService.delete_comment(comment)
        self.post.refresh_from_db()
        assert self.post.comment_count == 0

    def test_delete_comment_soft_deletes(self):
        """SoftDeleteMixin: delete() sets is_deleted=True instead of removing."""
        comment = CommentService.create_comment(
            author=self.user, post=self.post,
            content="Soft deleted", tenant=self.tenant,
        )
        comment_id = comment.pk
        CommentService.delete_comment(comment)
        comment.refresh_from_db()
        assert comment.is_deleted is True
        assert Comment.objects.filter(pk=comment_id).exists()

    def test_delete_comment_does_not_go_negative(self):
        assert self.post.comment_count == 0
        comment = Comment.objects.create(
            author=self.user, post=self.post,
            content="Zero count", tenant=self.tenant,
        )
        CommentService.delete_comment(comment)
        self.post.refresh_from_db()
        assert self.post.comment_count == 0


@pytest.mark.django_db
class TestReactionService:
    """Test ReactionService add, toggle, and update."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="RSVC_T", defaults={"display_name": "ReactionService Tenant"}
        )[0]
        self.user = User.objects.create_user(
            username="rsauthor", password="test123"
        )
        self.other_user = User.objects.create_user(
            username="rsother", password="test123"
        )
        self.post = Post.objects.create(
            author=self.user, content="React target", tenant=self.tenant
        )

    def test_add_reaction_creates(self):
        reaction, created = ReactionService.add_reaction(
            user=self.user,
            reaction_type=ReactionType.LIKE,
            post=self.post,
            tenant=self.tenant,
        )
        assert created is True
        assert reaction.reaction_type == ReactionType.LIKE
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1

    def test_add_same_reaction_toggles_off(self):
        ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.LIKE,
            post=self.post, tenant=self.tenant,
        )
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1
        reaction, created = ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.LIKE,
            post=self.post, tenant=self.tenant,
        )
        assert created is False
        self.post.refresh_from_db()
        assert self.post.reaction_count == 0

    def test_add_different_reaction_updates(self):
        ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.LIKE,
            post=self.post, tenant=self.tenant,
        )
        reaction, created = ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.LOVE,
            post=self.post, tenant=self.tenant,
        )
        assert created is False
        assert reaction.reaction_type == ReactionType.LOVE
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1

    def test_add_reaction_on_comment(self):
        comment = Comment.objects.create(
            author=self.other_user, post=self.post,
            content="Reactable", tenant=self.tenant,
        )
        reaction, created = ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.RESPECT,
            comment=comment, tenant=self.tenant,
        )
        assert created is True
        assert reaction.comment_id == comment.pk

    def test_remove_reaction_on_post(self):
        ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.LIKE,
            post=self.post, tenant=self.tenant,
        )
        self.post.refresh_from_db()
        assert self.post.reaction_count == 1
        removed = ReactionService.remove_reaction(
            user=self.user, post=self.post,
        )
        assert removed is True
        self.post.refresh_from_db()
        assert self.post.reaction_count == 0

    def test_remove_nonexistent_reaction(self):
        removed = ReactionService.remove_reaction(
            user=self.user, post=self.post,
        )
        assert removed is False

    def test_multiple_users_can_react(self):
        ReactionService.add_reaction(
            user=self.user, reaction_type=ReactionType.LIKE,
            post=self.post, tenant=self.tenant,
        )
        ReactionService.add_reaction(
            user=self.other_user, reaction_type=ReactionType.LOVE,
            post=self.post, tenant=self.tenant,
        )
        self.post.refresh_from_db()
        assert self.post.reaction_count == 2
        assert Reaction.objects.filter(post=self.post).count() == 2


@pytest.mark.django_db
class TestFollowService:
    """Test FollowService follow, unfollow, and is_following."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.get_or_create(
            code="FSVC_T", defaults={"display_name": "FollowService Tenant"}
        )[0]
        self.user1 = User.objects.create_user(
            username="fsuser1", password="test123"
        )
        self.user2 = User.objects.create_user(
            username="fsuser2", password="test123"
        )

    def test_follow_creates_relationship(self):
        follow, created = FollowService.follow(
            self.user1, self.user2, self.tenant,
        )
        assert created is True
        assert follow.follower_id == self.user1.pk
        assert follow.following_id == self.user2.pk

    def test_follow_increments_counters(self):
        FollowService.follow(self.user1, self.user2, self.tenant)
        profile1 = UserProfile.objects.get(user=self.user1)
        profile2 = UserProfile.objects.get(user=self.user2)
        assert profile1.following_count == 1
        assert profile2.followers_count == 1

    def test_follow_idempotent(self):
        FollowService.follow(self.user1, self.user2, self.tenant)
        follow, created = FollowService.follow(
            self.user1, self.user2, self.tenant,
        )
        assert created is False
        profile1 = UserProfile.objects.get(user=self.user1)
        assert profile1.following_count == 1

    def test_follow_self_raises(self):
        with pytest.raises(ValueError):
            FollowService.follow(self.user1, self.user1, self.tenant)

    def test_unfollow_deletes_relationship(self):
        FollowService.follow(self.user1, self.user2, self.tenant)
        deleted = FollowService.unfollow(self.user1, self.user2, self.tenant)
        assert deleted is True
        assert not Follow.objects.filter(
            follower=self.user1, following=self.user2, tenant=self.tenant,
        ).exists()

    def test_unfollow_decrements_counters(self):
        FollowService.follow(self.user1, self.user2, self.tenant)
        FollowService.unfollow(self.user1, self.user2, self.tenant)
        profile1 = UserProfile.objects.get(user=self.user1)
        profile2 = UserProfile.objects.get(user=self.user2)
        assert profile1.following_count == 0
        assert profile2.followers_count == 0

    def test_unfollow_nonexistent_returns_false(self):
        deleted = FollowService.unfollow(self.user1, self.user2, self.tenant)
        assert deleted is False

    def test_is_following_true(self):
        FollowService.follow(self.user1, self.user2, self.tenant)
        assert FollowService.is_following(
            self.user1.pk, self.user2.pk, self.tenant,
        ) is True

    def test_is_following_false(self):
        assert FollowService.is_following(
            self.user1.pk, self.user2.pk, self.tenant,
        ) is False

    def test_follow_counter_accuracy_multiple_follows(self):
        user3 = User.objects.create_user(
            username="fsuser3", password="test123"
        )
        FollowService.follow(self.user1, self.user2, self.tenant)
        FollowService.follow(self.user1, user3, self.tenant)
        profile1 = UserProfile.objects.get(user=self.user1)
        assert profile1.following_count == 2

        profile2 = UserProfile.objects.get(user=self.user2)
        assert profile2.followers_count == 1
