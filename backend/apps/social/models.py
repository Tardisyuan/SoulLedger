"""
Social domain models: Post, Comment, Reaction, Follow, UserProfile.
"""
import uuid
from django.db import models
from django.core.exceptions import ValidationError
from apps.core.models import AuditUserFields


class Visibility(models.TextChoices):
    PUBLIC = "PUBLIC", "Public"
    TENANT = "TENANT", "Tenant Only"
    FOLLOWERS = "FOLLOWERS", "Followers Only"
    PRIVATE = "PRIVATE", "Private"


class ReactionType(models.TextChoices):
    LIKE = "LIKE", "Like"
    LOVE = "LOVE", "Love"
    RESPECT = "RESPECT", "Respect"
    SYMPATHY = "SYMPATHY", "Sympathy"
    ETERNAL_LIGHT = "ETERNAL_LIGHT", "Eternal Light"


class Post(AuditUserFields, models.Model):
    """
    A social post by a user within a tenant.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_posts",
    )
    content = models.TextField()
    visibility = models.CharField(
        max_length=12,
        choices=Visibility.choices,
        default=Visibility.PUBLIC,
    )
    comment_count = models.PositiveIntegerField(default=0)
    reaction_count = models.PositiveIntegerField(default=0)
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="social_posts",
    )

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Post"
        verbose_name_plural = "Posts"
        indexes = [
            models.Index(fields=["tenant", "create_time"]),
            models.Index(fields=["author", "create_time"]),
        ]

    def __str__(self):
        return f"Post({self.pk}) by {self.author_id}"

    def save(self, *args, **kwargs):
        # Auto-set tenant from request context on first save
        if self._state.adding and self.tenant_id is None:
            from apps.core.request_local import get_current_request
            request = get_current_request()
            if request:
                tenant = getattr(request, "tenant", None)
                if tenant:
                    self.tenant = tenant
        super().save(*args, **kwargs)


class Comment(AuditUserFields, models.Model):
    """
    A comment on a post, with optional nesting via parent.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(
        Post,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    author = models.ForeignKey(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_comments",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="replies",
    )
    content = models.TextField()
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="social_comments",
    )

    class Meta:
        ordering = ["create_time"]
        verbose_name = "Comment"
        verbose_name_plural = "Comments"
        indexes = [
            models.Index(fields=["post", "create_time"]),
            models.Index(fields=["parent"]),
        ]

    def __str__(self):
        return f"Comment({self.pk}) on {self.post_id}"

    def save(self, *args, **kwargs):
        if self._state.adding and self.tenant_id is None:
            from apps.core.request_local import get_current_request
            request = get_current_request()
            if request:
                tenant = getattr(request, "tenant", None)
                if tenant:
                    self.tenant = tenant
        super().save(*args, **kwargs)


class Reaction(AuditUserFields, models.Model):
    """
    A reaction on a post or comment. Exactly one of post/comment must be set.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_reactions",
    )
    post = models.ForeignKey(
        Post,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="reactions",
    )
    comment = models.ForeignKey(
        Comment,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="reactions",
    )
    reaction_type = models.CharField(
        max_length=15,
        choices=ReactionType.choices,
        default=ReactionType.LIKE,
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="social_reactions",
    )

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Reaction"
        verbose_name_plural = "Reactions"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "post"],
                condition=models.Q(post__isnull=False),
                name="unique_reaction_per_post",
            ),
            models.UniqueConstraint(
                fields=["user", "comment"],
                condition=models.Q(comment__isnull=False),
                name="unique_reaction_per_comment",
            ),
            models.CheckConstraint(
                check=(
                    models.Q(post__isnull=False, comment__isnull=True)
                    | models.Q(post__isnull=True, comment__isnull=False)
                ),
                name="reaction_exactly_one_target",
            ),
        ]

    def __str__(self):
        target = self.post_id or self.comment_id
        return f"Reaction({self.reaction_type}) by {self.user_id} on {target}"

    def clean(self):
        super().clean()
        if bool(self.post) == bool(self.comment):
            raise ValidationError("Exactly one of post or comment must be set.")

    def save(self, *args, **kwargs):
        if self._state.adding and self.tenant_id is None:
            from apps.core.request_local import get_current_request
            request = get_current_request()
            if request:
                tenant = getattr(request, "tenant", None)
                if tenant:
                    self.tenant = tenant
        super().save(*args, **kwargs)


class Follow(AuditUserFields, models.Model):
    """
    A follow relationship between two users within a tenant.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    follower = models.ForeignKey(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_following",
    )
    following = models.ForeignKey(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_followers",
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="social_follows",
    )

    class Meta:
        ordering = ["-create_time"]
        verbose_name = "Follow"
        verbose_name_plural = "Follows"
        constraints = [
            models.UniqueConstraint(
                fields=["follower", "following"],
                name="unique_follow_relationship",
            ),
            models.CheckConstraint(
                check=~models.Q(follower=models.F("following")),
                name="no_self_follow",
            ),
        ]

    def __str__(self):
        return f"Follow({self.follower_id} -> {self.following_id})"

    def clean(self):
        super().clean()
        if self.follower_id == self.following_id:
            raise ValidationError("Users cannot follow themselves.")

    def save(self, *args, **kwargs):
        if self._state.adding and self.tenant_id is None:
            from apps.core.request_local import get_current_request
            request = get_current_request()
            if request:
                tenant = getattr(request, "tenant", None)
                if tenant:
                    self.tenant = tenant
        super().save(*args, **kwargs)


class UserProfile(models.Model):
    """
    Extended profile for social features. One-to-one with User.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_profile",
    )
    bio = models.TextField(blank=True, default="")
    avatar_url = models.URLField(blank=True, default="")
    followers_count = models.PositiveIntegerField(default=0)
    following_count = models.PositiveIntegerField(default=0)
    post_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "User Profile"
        verbose_name_plural = "User Profiles"

    def __str__(self):
        return f"Profile({self.user_id})"
