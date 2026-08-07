"""
Business logic for the social domain.
Handles denormalized counters, follow/unfollow, and profile sync.
"""
from django.db import transaction
from django.db.models import F

from apps.social.models import Comment, Follow, Post, Reaction, UserProfile


class PostService:
    """Service for post-related business logic."""

    @staticmethod
    def increment_comment_count(post_id, tenant=None):
        """
        Increment the denormalized comment count on a post.

        `tenant` is optional but should be supplied by any caller that has
        one in scope — when present, a post_id belonging to a different
        tenant is silently skipped (the filter simply matches nothing)
        rather than updated, mirroring the explicit tenant_id check in
        apps.ledger.tasks.recalculate_soul_ledger_task. Optional because
        some callers (e.g. tests exercising the counter directly) have no
        tenant in scope and the old untenanted behavior must keep working
        for them.
        """
        qs = Post.objects.filter(pk=post_id)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        qs.update(comment_count=F("comment_count") + 1)

    @staticmethod
    def decrement_comment_count(post_id, tenant=None):
        """Decrement the denormalized comment count on a post."""
        qs = Post.objects.filter(pk=post_id, comment_count__gt=0)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        qs.update(comment_count=F("comment_count") - 1)

    @staticmethod
    def increment_reaction_count(post_id, tenant=None):
        """Increment the denormalized reaction count on a post."""
        qs = Post.objects.filter(pk=post_id)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        qs.update(reaction_count=F("reaction_count") + 1)

    @staticmethod
    def decrement_reaction_count(post_id, tenant=None):
        """Decrement the denormalized reaction count on a post."""
        qs = Post.objects.filter(pk=post_id, reaction_count__gt=0)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        qs.update(reaction_count=F("reaction_count") - 1)

    @staticmethod
    def increment_post_count(user_id):
        """Increment the user's post count in their profile."""
        profile, _ = UserProfile.objects.get_or_create(user_id=user_id)
        profile.post_count = F("post_count") + 1
        profile.save(update_fields=["post_count"])


class CommentService:
    """Service for comment-related business logic."""

    @staticmethod
    @transaction.atomic
    def create_comment(author, post, content, parent=None, tenant=None):
        """
        Create a comment and increment the post's comment count.
        """
        comment = Comment.objects.create(
            author=author,
            post=post,
            content=content,
            parent=parent,
            tenant=tenant or post.tenant,
        )
        PostService.increment_comment_count(post.pk, tenant=post.tenant)
        return comment

    @staticmethod
    @transaction.atomic
    def delete_comment(comment):
        """
        Delete a comment and decrement the post's comment count.
        """
        post_id = comment.post_id
        post_tenant = comment.tenant
        comment.delete()
        PostService.decrement_comment_count(post_id, tenant=post_tenant)


class ReactionService:
    """Service for reaction-related business logic."""

    @staticmethod
    @transaction.atomic
    def add_reaction(user, reaction_type, post=None, comment=None, tenant=None):
        """
        Add or update a reaction. Returns (reaction, created).

        `target_kwargs` pins the lookup/create to a specific already-resolved
        post or comment row, so a bare user+target filter cannot cross a
        tenant boundary on its own — the target itself is the tenant
        boundary. `tenant` (falling back to the target's own tenant) is
        still threaded through to the counter updates below so that a
        mismatched/stale tenant value never causes a *different* post's
        counter to move.
        """
        target_kwargs = {}
        if post:
            target_kwargs["post"] = post
            post_id = post.pk
        else:
            target_kwargs["comment"] = comment
            post_id = None

        target = post or comment
        effective_tenant = tenant or target.tenant

        existing = Reaction.objects.filter(user=user, **target_kwargs).first()
        if existing:
            if existing.reaction_type == reaction_type:
                # Same reaction — remove (toggle off)
                existing.delete()
                if post_id:
                    PostService.decrement_reaction_count(post_id, tenant=effective_tenant)
                return existing, False
            # Different reaction — update
            existing.reaction_type = reaction_type
            existing.save(update_fields=["reaction_type"])
            return existing, False

        # New reaction
        reaction = Reaction.objects.create(
            user=user,
            reaction_type=reaction_type,
            tenant=effective_tenant,
            **target_kwargs,
        )
        if post_id:
            PostService.increment_reaction_count(post_id, tenant=effective_tenant)
        return reaction, True

    @staticmethod
    def remove_reaction(user, post=None, comment=None, tenant=None):
        """Remove a user's reaction from a post or comment."""
        kwargs = {"user": user}
        if post:
            kwargs["post"] = post
        else:
            kwargs["comment"] = comment

        reaction = Reaction.objects.filter(**kwargs).first()
        if reaction:
            post_id = reaction.post_id
            reaction_tenant = tenant or reaction.tenant
            reaction.delete()
            if post_id:
                PostService.decrement_reaction_count(post_id, tenant=reaction_tenant)
            return True
        return False


class FollowService:
    """Service for follow/unfollow business logic."""

    @staticmethod
    @transaction.atomic
    def follow(follower, following, tenant):
        """
        Create a follow relationship. Returns (follow, created).
        Updates denormalized counters on both users' profiles.
        """
        if follower.pk == following.pk:
            raise ValueError("Users cannot follow themselves.")

        follow, created = Follow.objects.get_or_create(
            follower=follower,
            following=following,
            tenant=tenant,
        )
        if created:
            # Increment follower's following_count
            follower_profile, _ = UserProfile.objects.get_or_create(user=follower)
            UserProfile.objects.filter(pk=follower_profile.pk).update(
                following_count=F("following_count") + 1
            )
            # Increment target's followers_count
            following_profile, _ = UserProfile.objects.get_or_create(user=following)
            UserProfile.objects.filter(pk=following_profile.pk).update(
                followers_count=F("followers_count") + 1
            )
        return follow, created

    @staticmethod
    @transaction.atomic
    def unfollow(follower, following, tenant):
        """
        Remove a follow relationship. Updates denormalized counters.
        """
        deleted, _ = Follow.objects.filter(
            follower=follower,
            following=following,
            tenant=tenant,
        ).delete()
        if deleted:
            # Decrement follower's following_count
            UserProfile.objects.filter(user=follower).update(
                following_count=F("following_count") - 1
            )
            # Decrement target's followers_count
            UserProfile.objects.filter(user=following).update(
                followers_count=F("followers_count") - 1
            )
        return deleted > 0

    @staticmethod
    def is_following(follower_id, following_id, tenant):
        """Check if follower is following the target user."""
        return Follow.objects.filter(
            follower_id=follower_id,
            following_id=following_id,
            tenant=tenant,
        ).exists()
