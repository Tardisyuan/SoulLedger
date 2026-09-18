"""官员审核后台的序列化器(`/api/v1/social-moderation/`)。

**内容摘要而不是全文**:举报队列一屏要看很多条,`content_excerpt` 截到 200 字。
点进详情看的是帖子 / 评论本身(`ModeratedPostViewSet` / `ModeratedCommentViewSet`)。

作者只给 `user_id` 与 `display_name`,不给灵魂编号、不给联系方式 —— 官员要看这些
走 `soul_account.read`(`/api/v1/soul-accounts/`),那是一条单独授权、单独审计的门。
审核一条内容不需要知道作者的登录名。
"""
from rest_framework import serializers

from apps.social.models import (
    ModerationStatus,
    Report,
    ReportReason,
    ReportResolution,
    SensitiveWord,
    SocialMute,
)

EXCERPT = 200


def _author(user):
    if user is None:
        return None
    return {"user_id": user.pk, "display_name": user.display_name}


class ModerationAuthorSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    display_name = serializers.CharField()


class ReportEntrySerializer(serializers.Serializer):
    reporter = ModerationAuthorSerializer(allow_null=True)
    reason = serializers.ChoiceField(choices=ReportReason.choices)
    detail = serializers.CharField()
    created_at = serializers.DateTimeField()


class ReportSerializer(serializers.ModelSerializer):
    target_user = serializers.SerializerMethodField()
    content_excerpt = serializers.SerializerMethodField()
    content_status = serializers.SerializerMethodField()
    entries = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            "id", "target_type", "post", "comment", "target_user", "status", "report_count",
            "content_excerpt", "content_status", "entries",
            "created_at", "last_reported_at", "resolution", "resolution_note", "resolved_at",
        ]
        read_only_fields = fields

    def get_target_user(self, report) -> dict | None:
        return _author(report.target_user)

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

    def get_entries(self, report) -> list:
        return ReportEntrySerializer(
            [
                {"reporter": _author(e.reporter), "reason": e.reason, "detail": e.detail, "created_at": e.created_at}
                for e in report.entries.all()
            ],
            many=True,
        ).data


class ResolveReportSerializer(serializers.Serializer):
    resolution = serializers.ChoiceField(choices=ReportResolution.choices)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    mute_days = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=365)


class ModeratedContentSerializer(serializers.Serializer):
    """帖子与评论共用一份形状 —— 审核队列对两者做的是同一件事。"""

    id = serializers.UUIDField()
    author = serializers.SerializerMethodField()
    content = serializers.CharField()
    moderation_status = serializers.ChoiceField(choices=ModerationStatus.choices)
    open_report_count = serializers.SerializerMethodField()
    create_time = serializers.DateTimeField()

    def get_author(self, row) -> dict | None:
        return _author(row.author)

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
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = SensitiveWord
        fields = ["id", "word", "created_by", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]

    def get_created_by(self, row) -> dict | None:
        return _author(row.created_by)


class SocialMuteSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = SocialMute
        fields = ["id", "user", "until", "reason", "created_at", "lifted_at", "is_active"]
        read_only_fields = fields

    def get_user(self, row) -> dict | None:
        return _author(row.user)

    def get_is_active(self, row) -> bool:
        from django.utils import timezone

        return row.lifted_at is None and row.until > timezone.now()


class MuteCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    days = serializers.IntegerField(min_value=1, max_value=365)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")


class ModerationErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.CharField()

