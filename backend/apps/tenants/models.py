from django.db import models


class Tenant(models.Model):
    """A tenant represents a civilization's afterlife system (Chinese Diyu, European Heaven-Hell, Egyptian Duat)."""

    code = models.CharField(max_length=50, unique=True, db_index=True)
    display_name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    settings = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    dispatch_enabled = models.BooleanField(default=False)
    api_endpoint = models.URLField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "Tenant"
        verbose_name_plural = "Tenants"

    def __str__(self):
        return self.code


class Notification(models.Model):
    """In-app notification for dispatch invitations, judgment results, etc. (SPEC §7.7)."""

    recipient = models.ForeignKey(
        "authentication.User",
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(
        max_length=50,
        choices=[
            ("DISPATCH_PROPOSED", "外派提议"),
            ("DISPATCH_APPROVED", "外派批准"),
            ("DISPATCH_REJECTED", "外派拒绝"),
            ("CROSS_JUDGMENT_INVITED", "联合审判邀请"),
            ("JUDGMENT_CONCLUDED", "审判结束"),
            ("KARMA_THRESHOLD", "业力阈值"),
            ("SYSTEM", "系统消息"),
        ],
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    related_object_id = models.CharField(max_length=100, blank=True, default="")
    related_object_type = models.CharField(max_length=50, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Notification"
        verbose_name_plural = "Notifications"

    def __str__(self):
        return f"[{self.notification_type}] {self.title}"
