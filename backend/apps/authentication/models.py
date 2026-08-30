"""
Custom user model for SoulLedger.
"""
from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models

from apps.core.models import AuditUserFields


class SoftDeleteUserManager(UserManager):
    """UserManager (keeps create_user/create_superuser) that also excludes soft-deleted users."""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class UserRole(models.TextChoices):
    """The roles a `User.role` may hold.

    MODERATOR was missing here while three other places already knew about it:
    `apps/perm/models.py::ROLE_PERMISSIONS` grants it a strictly larger set
    than JUDGE (dispatch.approve/reject/execute, ledger.manage, org.manage,
    soul.create), `apps/authentication/serializers.py::ROLE_HIERARCHY` ranks it
    at 10, and migration 0017 seeds its grants. `check_permission` honoured all
    of that, because it reads the `Role` table.

    What did not honour it was every path that validates the field: this
    enum, and two hand-written copies of it in `views.py`. So
    `POST /users/{id}/assign_roles/ {"role": "MODERATOR"}` answered
    400 "Invalid role", `import_csv` rejected it identically, and any write
    through `full_clean()`/a ModelForm/a DRF ChoiceField refused it -- while
    192.168.2.115 carried two MODERATOR users that no API path could have
    created. The role worked and could not be legitimately assigned.

    Adding it here rather than deleting it from ROLE_PERMISSIONS: several of
    the cross-tenant defects this audit measured were demonstrated *as*
    MODERATOR precisely because it is the role deliberately denied
    `workflow.approve` and `workflow.advance` while holding `workflow.update`.
    That distinction is doing real work in the permission design; removing it
    would mean conceding that design.
    """

    ADMIN = "ADMIN", "Administrator (阎罗王)"
    MODERATOR = "MODERATOR", "Realm Lead (殿主)"
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

    # Declared first so it becomes _base_manager (used by refresh_from_db(),
    # etc) — keeps create_user/create_superuser and stays unfiltered so
    # soft-deleted users can still be refreshed/looked up internally.
    all_objects = UserManager()
    objects = SoftDeleteUserManager()

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
