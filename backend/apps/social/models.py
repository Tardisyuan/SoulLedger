"""
Social domain models: Post, Comment, Reaction, Follow, UserProfile.
"""
import uuid

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.models import AuditUserFields


class Visibility(models.TextChoices):
    PUBLIC = "PUBLIC", "Public"
    TENANT = "TENANT", "Tenant Only"
    FOLLOWERS = "FOLLOWERS", "Followers Only"
    PRIVATE = "PRIVATE", "Private"


class ModerationStatus(models.TextChoices):
    """帖子与评论的审核状态(2026-09-17 用户决定:先发后审 + 举报 + 敏感词)。

    PUBLISHED 是默认:发出即可见。命中本文明敏感词表的内容写成 PENDING,审核通过前
    除作者本人外谁都看不见。HIDDEN 是官员处置的结果,可恢复;删除走软删除,不是一个状态。
    """
    PUBLISHED = "PUBLISHED", "Published"
    PENDING = "PENDING", "Pending review"
    HIDDEN = "HIDDEN", "Hidden"


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
    moderation_status = models.CharField(
        max_length=10,
        choices=ModerationStatus.choices,
        default=ModerationStatus.PUBLISHED,
        db_index=True,
    )
    # 最近一次**审核决定**(隐藏 / 通过 / 恢复)的出处 ——「已处理」列表读它。命中 HIDE 动作
    # 的敏感词在写入时自动隐藏:`moderated_by` 为空、理由是 `sensitive_word:<词>`。
    # 删除不写这里:软删除自己有 deleted_by / deleted_at / delete_reason。
    moderated_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    moderated_at = models.DateTimeField(null=True, blank=True)
    moderation_reason = models.CharField(max_length=500, blank=True, default="")
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
    moderation_status = models.CharField(
        max_length=10,
        choices=ModerationStatus.choices,
        default=ModerationStatus.PUBLISHED,
        db_index=True,
    )
    # 同 Post.moderated_*。
    moderated_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    moderated_at = models.DateTimeField(null=True, blank=True)
    moderation_reason = models.CharField(max_length=500, blank=True, default="")
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
                # Scoped to live rows. Without this, soft-deleting a row leaves
                # its key occupied by something no filtered queryset can see:
                # re-creating the same key then fails a uniqueness check
                # against a row that is invisible to every read path.
                # See tests/test_soft_delete_frees_unique_keys.py.
                # The `post__isnull` half was here; `is_deleted` was not. Measured
                # 2026-08-29: like -> unlike -> like returned 500, permanently,
                # and so did switching reaction type afterwards. DRF generates
                # a uniqueness validator for `unique_together` but not for
                # `Meta.constraints`, so there was no 400 in front of it.
                condition=models.Q(post__isnull=False, is_deleted=False),
                name="unique_reaction_per_post",
            ),
            models.UniqueConstraint(
                fields=["user", "comment"],
                # Scoped to live rows. Without this, soft-deleting a row leaves
                # its key occupied by something no filtered queryset can see:
                # re-creating the same key then fails a uniqueness check
                # against a row that is invisible to every read path.
                # See tests/test_soft_delete_frees_unique_keys.py.
                condition=models.Q(comment__isnull=False, is_deleted=False),
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
                # Scoped to live rows. Without this, soft-deleting a row leaves
                # its key occupied by something no filtered queryset can see:
                # re-creating the same key then fails a uniqueness check
                # against a row that is invisible to every read path.
                # See tests/test_soft_delete_frees_unique_keys.py.
                # `POST /follows/toggle/` was unaffected because
                # `FollowService.unfollow` uses a queryset `.delete()`, which
                # bypasses the model's soft delete entirely. `DELETE
                # /follows/{id}/` went through the model and soft-deleted, so
                # re-following afterwards raised IntegrityError. One meaning,
                # two paths, opposite behaviour.
                condition=models.Q(is_deleted=False),
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

    No avatar of its own: the avatar is `User.avatar`, uploaded through
    `POST /api/v1/social/profiles/me/avatar/`. There was an `avatar_url` here,
    a free-text link to anywhere — blocked by the production CSP
    (`img-src 'self' data:`) and a tracking pixel wherever it was not. One
    account, one avatar; social migration 0005 removed the column.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="social_profile",
    )
    bio = models.TextField(blank=True, default="")
    followers_count = models.PositiveIntegerField(default=0)
    following_count = models.PositiveIntegerField(default=0)
    post_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "User Profile"
        verbose_name_plural = "User Profiles"

    def __str__(self):
        return f"Profile({self.user_id})"


# ── 审核(灵魂朋友圈,2026-09-17)────────────────────────────────────────────
#
# 这几张表不继承 AuditUserFields:举报、禁言、敏感词的变动是「动作」,由
# apps/social/moderation.py 显式写一条说清谁对什么做了什么的 AuditLog,
# 而不是一串通用字段 diff(与 apps/soul_accounts 同一理由)。


class ReportTargetType(models.TextChoices):
    POST = "POST", "Post"
    COMMENT = "COMMENT", "Comment"
    USER = "USER", "User"


class ReportReason(models.TextChoices):
    SPAM = "SPAM", "Spam"
    ABUSE = "ABUSE", "Abuse"
    SEXUAL = "SEXUAL", "Sexual content"
    ILLEGAL = "ILLEGAL", "Illegal or harmful"
    OTHER = "OTHER", "Other"


class ReportStatus(models.TextChoices):
    OPEN = "OPEN", "Open"
    RESOLVED = "RESOLVED", "Resolved"
    DISMISSED = "DISMISSED", "Dismissed"


class ReportResolution(models.TextChoices):
    HIDE = "HIDE", "Hide content"
    DELETE = "DELETE", "Delete content"
    MUTE = "MUTE", "Mute author"
    DISMISS = "DISMISS", "Dismiss"


class Report(models.Model):
    """对一个对象的举报。**同一对象同时只有一条 OPEN 的举报**,多个灵魂举报它合并到这一行,
    `report_count` 是去重后的举报人数(每人一条 ReportEntry)。处置后关闭;之后再被举报开新行。

    `target_user` 总是填:举报帖子 / 评论时是其作者,举报用户时是那个用户 ——
    官员「禁言」一步就知道对谁。
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="social_reports")
    target_type = models.CharField(max_length=10, choices=ReportTargetType.choices)
    post = models.ForeignKey(Post, null=True, blank=True, on_delete=models.CASCADE, related_name="reports")
    comment = models.ForeignKey(Comment, null=True, blank=True, on_delete=models.CASCADE, related_name="reports")
    target_user = models.ForeignKey(
        "authentication.User", on_delete=models.CASCADE, related_name="social_reports_against"
    )
    status = models.CharField(max_length=10, choices=ReportStatus.choices, default=ReportStatus.OPEN)
    report_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    last_reported_at = models.DateTimeField(auto_now_add=True)
    resolution = models.CharField(max_length=10, choices=ReportResolution.choices, blank=True, default="")
    resolution_note = models.CharField(max_length=500, blank=True, default="")
    resolved_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_reported_at"]
        indexes = [models.Index(fields=["tenant", "status", "last_reported_at"])]
        constraints = [
            # 三条而不是一条 (target_type, post, comment, target_user):PostgreSQL 的唯一约束里
            # NULL 互不相等,举报用户时 post/comment 都是 NULL,一条合并约束永远不会冲突。
            models.UniqueConstraint(
                fields=["post"], condition=models.Q(status="OPEN", target_type="POST"),
                name="social_report_one_open_per_post",
            ),
            models.UniqueConstraint(
                fields=["comment"], condition=models.Q(status="OPEN", target_type="COMMENT"),
                name="social_report_one_open_per_comment",
            ),
            models.UniqueConstraint(
                fields=["target_user"], condition=models.Q(status="OPEN", target_type="USER"),
                name="social_report_one_open_per_user",
            ),
        ]


class ReportEntry(models.Model):
    """一个灵魂对一条 Report 的一次举报。同一人对同一条举报只算一次。"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="entries")
    reporter = models.ForeignKey("authentication.User", on_delete=models.CASCADE, related_name="social_report_entries")
    reason = models.CharField(max_length=10, choices=ReportReason.choices)
    detail = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["reporter", "created_at"])]
        constraints = [
            models.UniqueConstraint(fields=["report", "reporter"], name="social_report_entry_once_per_reporter"),
        ]


class SensitiveWordCategory(models.TextChoices):
    """分类只是给官员看的标签,不影响匹配。中文名在 i18n 包里(`social_moderation.word_category`),
    不进数据库。空串 = 未分类(0007 之前加的词)。"""
    PRIVACY = "PRIVACY", "Privacy"
    ABUSE = "ABUSE", "Abuse"
    INDUCEMENT = "INDUCEMENT", "Boundary-crossing inducement"
    CONFIDENTIAL = "CONFIDENTIAL", "Confidential"
    OFFICIAL_DEFAMATION = "OFFICIAL_DEFAMATION", "Defaming officials"


class SensitiveWordAction(models.TextChoices):
    """命中后对帖子 / 评论做什么(apps/social/moderation.py::screen_content)。

    一条内容命中多个词时取最重的:HIDE > REVIEW > MASK;MASK 的词无论如何都在写入时替换成 ***。
    """
    REVIEW = "REVIEW", "Send to review"
    HIDE = "HIDE", "Hide"
    MASK = "MASK", "Mask with ***"


class SensitiveWord(models.Model):
    """本文明的敏感词。按小写存、按小写子串匹配(apps/social/moderation.py::screen_content)。"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="social_sensitive_words")
    word = models.CharField(max_length=50)
    category = models.CharField(max_length=24, choices=SensitiveWordCategory.choices, blank=True, default="")
    # 默认 REVIEW:0007 之前的词一直是「命中进待审」,迁移后行为不变。
    action = models.CharField(max_length=10, choices=SensitiveWordAction.choices, default=SensitiveWordAction.REVIEW)
    created_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["word"]
        constraints = [
            models.UniqueConstraint(fields=["tenant", "word"], name="social_sensitive_word_unique_per_tenant"),
        ]


class SensitiveWordDailyHit(models.Model):
    """一个词在一天(UTC 日期)里被命中的次数。「近 30 天命中」= 这个词最近 30 行的和。

    为什么按天分桶而不是一次命中一行:读是审核后台每次打开词表都要做的,按天分桶让
    每个词最多读 30 行(唯一约束 (word, day) 即索引),与命中量无关;写是命中那一刻
    对一行 `count = count + 1`。不在 SensitiveWord 上放一个计数列:滚动窗口要能「过期」,
    单个计数列做不到。删词时一并级联删掉。
    """
    id = models.BigAutoField(primary_key=True)
    word = models.ForeignKey(SensitiveWord, on_delete=models.CASCADE, related_name="daily_hits")
    day = models.DateField()
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["word", "day"], name="social_sensitive_word_hit_one_row_per_day"),
        ]


class SocialMute(models.Model):
    """禁言:`until` 之前该用户在朋友圈只读。解除写 `lifted_at`,行不删(审计与禁言历史)。

    挂在 User(即某一世的账号)上:转世后的新账号不继承禁言 —— 与「社交内容随账号」同一规则。
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.CASCADE, related_name="social_mutes")
    user = models.ForeignKey("authentication.User", on_delete=models.CASCADE, related_name="social_mutes")
    until = models.DateTimeField()
    reason = models.CharField(max_length=500, blank=True, default="")
    created_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    lifted_at = models.DateTimeField(null=True, blank=True)
    lifted_by = models.ForeignKey(
        "authentication.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "until"])]
