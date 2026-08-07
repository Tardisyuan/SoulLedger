"""
Serializers for the social domain.
"""
from rest_framework import serializers

from apps.social.models import Comment, Follow, Post, Reaction, ReactionType, UserProfile, Visibility

# ---------------------------------------------------------------------------
# Post serializers
# ---------------------------------------------------------------------------

class PostSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.display_name", read_only=True, default="")
    author_username = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = Post
        fields = [
            "id",
            "author",
            "author_name",
            "author_username",
            "content",
            "visibility",
            "comment_count",
            "reaction_count",
            "tenant",
            "create_time",
            "update_time",
        ]
        read_only_fields = [
            "id",
            "author",
            "comment_count",
            "reaction_count",
            "tenant",
            "create_time",
            "update_time",
        ]

    def validate_visibility(self, value):
        if value not in Visibility.values:
            raise serializers.ValidationError(f"Invalid visibility: {value}")
        return value


class PostCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating posts — only content + visibility needed."""

    class Meta:
        model = Post
        fields = ["id", "content", "visibility"]
        read_only_fields = ["id"]


class PostListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing posts."""

    author_name = serializers.CharField(source="author.display_name", read_only=True, default="")
    author_username = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = Post
        fields = [
            "id",
            "author",
            "author_name",
            "author_username",
            "content",
            "visibility",
            "comment_count",
            "reaction_count",
            "create_time",
        ]


# ---------------------------------------------------------------------------
# Comment serializers
# ---------------------------------------------------------------------------

class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.display_name", read_only=True, default="")
    author_username = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = Comment
        fields = [
            "id",
            "post",
            "author",
            "author_name",
            "author_username",
            "parent",
            "content",
            "tenant",
            "create_time",
            "update_time",
        ]
        read_only_fields = ["id", "author", "tenant", "create_time", "update_time"]


class CommentCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating comments."""

    class Meta:
        model = Comment
        fields = ["id", "post", "parent", "content"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """`post` and `parent` are plain PrimaryKeyRelatedFields — DRF's
        field-level validation only confirms the row exists, not that it
        belongs to the caller's tenant. Left unchecked, a user in tenant A
        could comment on (or reply into) tenant B's content by ID: the
        ViewSet's tenant filtering only narrows `get_queryset()` for reads,
        it never touches this write-time field validation, and
        `CommentService.create_comment` stamps the new row with the
        *caller's* tenant regardless of which tenant `post`/`parent`
        actually belong to — so the hole is a comment whose `tenant` FK
        disagrees with its `post`/`parent` FK, not just a permission gap.

        No ADMIN carve-out here: unlike the read-side tenant bypasses
        elsewhere (e.g. `UserProfileViewSet.get_queryset`), there is no
        existing precedent in this codebase for ADMIN writing content that
        references another tenant's objects, so this defaults to the
        strict check for every role.
        """
        request = self.context.get("request")
        tenant = getattr(request, "tenant", None) if request else None
        if tenant is not None:
            post = attrs.get("post")
            if post is not None and str(post.tenant_id) != str(tenant.pk):
                raise serializers.ValidationError(
                    "Cannot comment on a post from another tenant."
                )
            parent = attrs.get("parent")
            if parent is not None and str(parent.tenant_id) != str(tenant.pk):
                raise serializers.ValidationError(
                    "Cannot reply to a comment from another tenant."
                )
        return attrs


class CommentListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing comments."""

    author_name = serializers.CharField(source="author.display_name", read_only=True, default="")
    author_username = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = Comment
        fields = [
            "id",
            "post",
            "author",
            "author_name",
            "author_username",
            "parent",
            "content",
            "create_time",
        ]


# ---------------------------------------------------------------------------
# Reaction serializers
# ---------------------------------------------------------------------------

class ReactionSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.display_name", read_only=True, default="")

    class Meta:
        model = Reaction
        fields = [
            "id",
            "user",
            "user_name",
            "post",
            "comment",
            "reaction_type",
            "tenant",
            "create_time",
        ]
        read_only_fields = ["id", "user", "tenant", "create_time"]

    def validate_reaction_type(self, value):
        if value not in ReactionType.values:
            raise serializers.ValidationError(f"Invalid reaction type: {value}")
        return value

    def validate(self, attrs):
        post = attrs.get("post")
        comment = attrs.get("comment")
        if bool(post) == bool(comment):
            raise serializers.ValidationError(
                "Exactly one of 'post' or 'comment' must be provided."
            )
        return attrs


class ReactionCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating reactions."""

    class Meta:
        model = Reaction
        fields = ["id", "post", "comment", "reaction_type"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """Same hole as `CommentCreateSerializer.validate` above, one model
        over: `post`/`comment` are unscoped PrimaryKeyRelatedFields, and
        `ReactionService.add_reaction` stamps the new row with the caller's
        tenant regardless of which tenant the target actually belongs to.
        Both `Post` and `Comment` carry their own `tenant` FK directly, so
        whichever target is supplied is checked straight off that field —
        no need to go through `comment.post.tenant`.

        No ADMIN carve-out — see the note in CommentCreateSerializer.validate.
        """
        request = self.context.get("request")
        tenant = getattr(request, "tenant", None) if request else None
        if tenant is not None:
            post = attrs.get("post")
            if post is not None and str(post.tenant_id) != str(tenant.pk):
                raise serializers.ValidationError(
                    "Cannot react to a post from another tenant."
                )
            comment = attrs.get("comment")
            if comment is not None and str(comment.tenant_id) != str(tenant.pk):
                raise serializers.ValidationError(
                    "Cannot react to a comment from another tenant."
                )
        return attrs


# ---------------------------------------------------------------------------
# Follow serializers
# ---------------------------------------------------------------------------

class FollowSerializer(serializers.ModelSerializer):
    follower_name = serializers.CharField(source="follower.display_name", read_only=True, default="")
    following_name = serializers.CharField(source="following.display_name", read_only=True, default="")

    class Meta:
        model = Follow
        fields = [
            "id",
            "follower",
            "follower_name",
            "following",
            "following_name",
            "tenant",
            "create_time",
        ]
        read_only_fields = ["id", "follower", "tenant", "create_time"]

    def validate(self, attrs):
        follower = attrs.get("follower")
        following = attrs.get("following")
        if follower and following and follower == following:
            raise serializers.ValidationError("Users cannot follow themselves.")
        return attrs


class FollowCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating follow relationships."""

    class Meta:
        model = Follow
        fields = ["id", "following"]
        read_only_fields = ["id"]


# ---------------------------------------------------------------------------
# UserProfile serializers
# ---------------------------------------------------------------------------

class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "user",
            "username",
            "bio",
            "avatar_url",
            "followers_count",
            "following_count",
            "post_count",
        ]
        read_only_fields = [
            "id",
            "user",
            "followers_count",
            "following_count",
            "post_count",
        ]


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating profile bio and avatar."""

    class Meta:
        model = UserProfile
        fields = ["id", "bio", "avatar_url"]
        read_only_fields = ["id"]
