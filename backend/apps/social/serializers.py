"""
Serializers for the social domain.
"""
from rest_framework import serializers
from apps.social.models import Post, Comment, Reaction, Follow, UserProfile, ReactionType, Visibility


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
