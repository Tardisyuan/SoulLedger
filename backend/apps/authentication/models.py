"""
Custom user model for SoulLedger.
"""
from django.contrib.auth.models import AbstractUser
from django.db import models
from apps.core.models import AuditUserFields


class UserRole(models.TextChoices):
    ADMIN = "ADMIN", "Administrator (阎罗王)"
    JUDGE = "JUDGE", "Judge (判官)"
    GUARDIAN = "GUARDIAN", "Guardian (牛头马面)"
    VIEWER = "VIEWER", "Viewer (访客)"


class User(AuditUserFields, AbstractUser):
    """
    Custom user with role field.
    """
    display_name = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Display name shown in the navbar (e.g. 系统管理员)",
    )
    role = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.VIEWER,
    )
    # RBAC role FK — bridges to the full perm.Role model with hierarchy/inheritance.
    # Once fully migrated, `role` CharField can be deprecated.
    rbac_role = models.ForeignKey(
        "perm.Role",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
        help_text="RBAC role with hierarchy and permission inheritance",
    )
    # For API display — linked to an Actor in the underworld system
    tenant = models.ForeignKey(
        "tenants.Tenant",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tenant_users",
    )
    actor = models.ForeignKey(
        "actors.Actor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="users",
        help_text="Linked underworld actor (e.g. Yanluo Wang as ADMIN)",
    )
    organization = models.ForeignKey(
        "org.Organization",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
        help_text="所属组织：如 第一殿、冥王厅",
    )
    position = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="职位：如 第一殿殿主",
    )
    avatar = models.ImageField(upload_to='avatars/%Y/%m/', null=True, blank=True)

    class Meta:
        verbose_name = "User"
        verbose_name_plural = "Users"

    def __str__(self):
        return f"{self.username} ({self.role})"


class LoginLog(AuditUserFields, models.Model):
    """
    登录日志 - 记录每次登录行为（成功/失败）
    Inherits AuditUserFields for audit trail and soft delete.
    """
    user = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        related_name="login_logs",
        null=True,
    )
    username = models.CharField(max_length=150)  # 可以是未成功登录时的用户名
    status = models.CharField(
        max_length=10,
        choices=[("SUCCESS", "成功"), ("FAILED", "失败")],
    )
    ip_address = models.GenericIPAddressField(null=True)
    user_agent = models.CharField(max_length=500, blank=True)
    failure_reason = models.CharField(max_length=200, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]
        verbose_name = "Login Log"
        verbose_name_plural = "Login Logs"
        indexes = [
            models.Index(fields=["user", "timestamp"]),
            models.Index(fields=["username", "timestamp"]),
            models.Index(fields=["status", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.username} {self.status} at {self.timestamp}"
