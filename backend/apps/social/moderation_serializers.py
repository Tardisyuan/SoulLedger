"""官员审核后台的序列化器(`/api/v1/social-moderation/`)。

**内容摘要而不是全文**:举报队列一屏要看很多条,`content_excerpt` 截到 200 字。
点进详情看的是帖子 / 评论本身(`ModeratedPostViewSet` / `ModeratedCommentViewSet`)。

作者只给 `user_id` 与 `display_name`,不给灵魂编号、不给联系方式 —— 官员要看这些
走 `soul_account.read`(`/api/v1/soul-accounts/`),那是一条单独授权、单独审计的门。
审核一条内容不需要知道作者的登录名。
"""
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.social.models import (
    ModerationStatus,
    Report,
    ReportReason,
    ReportResolution,
    ReportTargetType,
    SensitiveWord,
    SensitiveWordAction,
    SensitiveWordCategory,
    SocialMute,
)

EXCERPT = 200


class ModerationAuthorSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(source="pk")
    display_name = serializers.CharField()


class ReportEntrySerializer(serializers.Serializer):
    reporter = ModerationAuthorSerializer(allow_null=True)
    reason = serializers.ChoiceField(choices=ReportReason.choices)
    detail = serializers.CharField()
    created_at = serializers.DateTimeField()


class ReportSerializer(serializers.ModelSerializer):
    target_user = ModerationAuthorSerializer(read_only=True)
    content_excerpt = serializers.SerializerMethodField()
    content_status = serializers.SerializerMethodField()
    entries = ReportEntrySerializer(many=True, read_only=True)

    class Meta:
        model = Report
        fields = [
            "id", "target_type", "post", "comment", "target_user", "status", "report_count",
            "content_excerpt", "content_status", "entries",
            "created_at", "last_reported_at", "resolution", "resolution_note", "resolved_at",
        ]
        read_only_fields = fields

    def _content(self, report):
        return report.post if report.target_type == "POST" else report.comment

    def get_content_excerpt(self, report) -> str:
        content = self._content(report)
        return "" if content is None else content.content[:EXCERPT]

    def get_content_status(self, report) -> str:
        content = self._content(report)
        if content is None:
            return ""
        return "DELETED" if content.is_deleted else content.moderation_status


class ResolveReportSerializer(serializers.Serializer):
    resolution = serializers.ChoiceField(choices=ReportResolution.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    mute_days = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=365)


class ModeratedContentSerializer(serializers.Serializer):
    """帖子与评论共用一份形状 —— 审核队列对两者做的是同一件事。"""

    id = serializers.UUIDField()
    author = ModerationAuthorSerializer()
    content = serializers.CharField()
    moderation_status = serializers.ChoiceField(choices=ModerationStatus.choices)
    open_report_count = serializers.SerializerMethodField()
    create_time = serializers.DateTimeField()

    def get_open_report_count(self, row) -> int:
        return getattr(row, "open_report_count", 0) or 0


class ModeratedPostSerializer(ModeratedContentSerializer):
    visibility = serializers.CharField()
    comment_count = serializers.IntegerField()


class ModeratedCommentSerializer(ModeratedContentSerializer):
    post = serializers.UUIDField(source="post_id")


class ModerationActionSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class SensitiveWordSerializer(serializers.ModelSerializer):
    """`category` 空串 = 未分类(0007 之前加的词);中文名在 i18n 包 `social_moderation.word_category`。
    `hits_30d` 只在列表里有值(`moderation.with_recent_hits` 注解),新建返回 0。"""

    created_by = ModerationAuthorSerializer(read_only=True, allow_null=True)
    category = serializers.ChoiceField(
        choices=SensitiveWordCategory.choices, required=False, allow_blank=True, default=""
    )
    action = serializers.ChoiceField(
        choices=SensitiveWordAction.choices, required=False, default=SensitiveWordAction.REVIEW
    )
    hits_30d = serializers.SerializerMethodField()

    class Meta:
        model = SensitiveWord
        fields = ["id", "word", "category", "action", "hits_30d", "created_by", "created_at"]
        read_only_fields = ["id", "hits_30d", "created_by", "created_at"]

    def get_hits_30d(self, row) -> int:
        return getattr(row, "hits_30d", 0) or 0


class SensitiveWordBatchDeleteSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=200)


class SensitiveWordBatchDeleteResultSerializer(serializers.Serializer):
    deleted = serializers.IntegerField()


class SocialMuteSerializer(serializers.ModelSerializer):
    """`created_at` 是开始,`until` 是结束(没有永久禁言:天数 1–365,`until` 永不为空)。
    `created_by` 是执行人,`lifted_by` 是解除人;两者都可能为空(账号被删)。"""

    user = ModerationAuthorSerializer(read_only=True)
    created_by = ModerationAuthorSerializer(read_only=True, allow_null=True)
    lifted_by = ModerationAuthorSerializer(read_only=True, allow_null=True)
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = SocialMute
        fields = [
            "id", "user", "until", "reason", "created_at", "created_by", "lifted_at", "lifted_by", "is_active",
        ]
        read_only_fields = fields

    def get_is_active(self, row) -> bool:
        from django.utils import timezone

        return row.lifted_at is None and row.until > timezone.now()


class MuteCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    days = serializers.IntegerField(min_value=1, max_value=365)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


HANDLING_CHOICES = [("HIDDEN", "Hidden"), ("DELETED", "Deleted")]
HANDLED_TYPES = [(ReportTargetType.POST, "Post"), (ReportTargetType.COMMENT, "Comment")]


class HandledContentSerializer(serializers.Serializer):
    """「已处理」的一行,帖子与评论同一形状(见 moderation_views.HandledContentViewSet)。

    * `handling`:HIDDEN 可经 `POST {posts|comments}/{id}/restore/` 恢复可见;DELETED 走回收站的
      规则(帖子与评论目前不在回收站里,所以没有恢复入口)。
    * `handled_by` 为空:系统处理(命中 HIDE 动作的敏感词,`reason` 是 `sensitive_word:<词>`),
      或处理人的账号已不存在。
    * `post`:评论所在的帖子;帖子行是它自己。
    """

    type = serializers.ChoiceField(choices=HANDLED_TYPES, source="row_type")
    id = serializers.UUIDField(source="row_id")
    post = serializers.UUIDField(source="post_ref")
    author = serializers.SerializerMethodField()
    excerpt = serializers.CharField()
    handling = serializers.ChoiceField(choices=HANDLING_CHOICES)
    reason = serializers.CharField(source="handled_reason")
    handled_by = serializers.SerializerMethodField()
    handled_at = serializers.DateTimeField(allow_null=True)

    @extend_schema_field(ModerationAuthorSerializer)
    def get_author(self, row):
        return {"user_id": row["author_ref"], "display_name": row["author_name"]}

    @extend_schema_field(ModerationAuthorSerializer(allow_null=True))
    def get_handled_by(self, row):
        if row["handled_by_ref"] is None:
            return None
        return {"user_id": row["handled_by_ref"], "display_name": row["handled_by_name"]}


class ModerationErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()

