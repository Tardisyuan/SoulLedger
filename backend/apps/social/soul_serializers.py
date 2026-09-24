"""灵魂朋友圈接口的序列化器。**字段是白名单**:灵魂互相看得到的只有这里列出的东西。

不出现、且由测试断言不出现的:灵魂编号(登录名)、联系方式、审判 / 功过 / 处置细节、
`username`(内含灵魂编号)、租户、官员侧的计数列。
"""
from rest_framework import serializers

from apps.social.models import ModerationStatus, ReactionType, ReportReason, ReportTargetType, Visibility

CONTENT_MAX = 2000
COMMENT_MAX = 500


class SoulCardSerializer(serializers.Serializer):
    """一个灵魂在朋友圈里的名片。`user_id` 是这一世账号的 id —— 关注、主页、聊天都用它。"""
    user_id = serializers.IntegerField(source="pk")
    display_name = serializers.CharField()
    avatar = serializers.ImageField(read_only=True, allow_null=True)
    is_active = serializers.SerializerMethodField(help_text="false:前世账号,只读、不可关注。")

    def get_is_active(self, user) -> bool:
        account = getattr(user, "soul_account", None)
        return bool(account is not None and account.retired_at is None and user.is_active)


class SoulSearchResultSerializer(SoulCardSerializer):
    is_following = serializers.BooleanField()


class SoulProfileSerializer(SoulCardSerializer):
    is_self = serializers.BooleanField()
    is_following = serializers.BooleanField()
    is_followed_by = serializers.BooleanField()
    is_mutual = serializers.BooleanField()
    followers_count = serializers.IntegerField()
    following_count = serializers.IntegerField()
    post_count = serializers.IntegerField(help_text="当前查看者看得见的帖子数。")


class SoulReactionCountsSerializer(serializers.Serializer):
    """五种表态各自的数。读 `annotate_posts_for` 的 `reactions_<type>` 注解。"""
    LIKE = serializers.IntegerField(source="reactions_like")
    LOVE = serializers.IntegerField(source="reactions_love")
    RESPECT = serializers.IntegerField(source="reactions_respect")
    SYMPATHY = serializers.IntegerField(source="reactions_sympathy")
    ETERNAL_LIGHT = serializers.IntegerField(source="reactions_eternal_light")


class SoulPostSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    author = SoulCardSerializer()
    content = serializers.CharField()
    visibility = serializers.ChoiceField(choices=Visibility.choices)
    moderation_status = serializers.ChoiceField(
        choices=ModerationStatus.choices,
        help_text="非 PUBLISHED 只会出现在作者本人看到的数据里:PENDING=审核中,HIDDEN=已被隐藏。",
    )
    comment_count = serializers.IntegerField(source="visible_comment_count")
    reaction_count = serializers.IntegerField(source="visible_reaction_count")
    reaction_counts = SoulReactionCountsSerializer(source="*")
    my_reaction = serializers.ChoiceField(choices=ReactionType.choices, allow_null=True)
    is_mine = serializers.SerializerMethodField()
    create_time = serializers.DateTimeField()

    def get_is_mine(self, post) -> bool:
        return post.author_id == self.context["viewer"].pk


class SoulCommentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    post = serializers.UUIDField(source="post_id")
    parent = serializers.UUIDField(source="parent_id", allow_null=True)
    author = SoulCardSerializer()
    content = serializers.CharField()
    moderation_status = serializers.ChoiceField(choices=ModerationStatus.choices)
    is_mine = serializers.SerializerMethodField()
    create_time = serializers.DateTimeField()

    def get_is_mine(self, comment) -> bool:
        return comment.author_id == self.context["viewer"].pk


class SoulPostCreateSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=CONTENT_MAX, trim_whitespace=True)
    visibility = serializers.ChoiceField(choices=Visibility.choices, default=Visibility.TENANT)


class SoulCommentCreateSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=COMMENT_MAX, trim_whitespace=True)
    parent = serializers.UUIDField(required=False, allow_null=True)


class SoulReactionRequestSerializer(serializers.Serializer):
    reaction_type = serializers.ChoiceField(choices=ReactionType.choices, default=ReactionType.LIKE)


class SoulReactionStateSerializer(serializers.Serializer):
    reacted = serializers.BooleanField()
    reaction_type = serializers.ChoiceField(choices=ReactionType.choices, allow_null=True)


class SoulFollowStateSerializer(serializers.Serializer):
    following = serializers.BooleanField()


class SoulReportRequestSerializer(serializers.Serializer):
    target_type = serializers.ChoiceField(choices=ReportTargetType.choices)
    target_id = serializers.CharField(max_length=64, help_text="帖子 / 评论的 UUID,或用户的 user_id。")
    reason = serializers.ChoiceField(choices=ReportReason.choices)
    detail = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        import uuid

        target_id = attrs["target_id"]
        try:
            attrs["target_id"] = int(target_id) if attrs["target_type"] == ReportTargetType.USER else uuid.UUID(target_id)
        except ValueError:
            raise serializers.ValidationError({"target_id": "格式不对。"}) from None
        return attrs


class SoulReportResultSerializer(serializers.Serializer):
    counted = serializers.BooleanField(help_text="false:你已经举报过这条,本次不重复计数。")
    reports_remaining = serializers.IntegerField()


class SoulSocialStatusSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    can_write = serializers.BooleanField()
    muted_until = serializers.DateTimeField(allow_null=True)
    reports_remaining = serializers.IntegerField()


class SoulSocialErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()
    muted_until = serializers.DateTimeField(required=False)
