"""
Custom user model for SoulLedger.
"""
from django.contrib.auth.models import AbstractUser, UserManager
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

from apps.core.models import AuditUserFields


class SoftDeleteUserManager(UserManager):
    """UserManager (keeps create_user/create_superuser) that also excludes soft-deleted users."""

    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)


class UserRole(models.TextChoices):
    """The BUILT-IN roles — constants the code compares against directly.

    Since 2026-09-12 (BP-06/07/11) this is no longer the set of values
    `User.role` may hold: that is "any built-in, or any non-deleted row in
    `perm.Role`" — see `validate_assignable_role`. These five stay as an enum
    because the code compares them as literals (`role == 'ADMIN'` in the
    checker, the tenant scoping, IsAdminPermission, ROLE_HIERARCHY, ...), which
    is exactly why `PUT /perm/roles/<pk>/` refuses to rename them and DELETE
    refuses to bin them. A custom role has none of those comparisons and can
    be renamed freely, with `User.role` cascaded.

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


def is_assignable_role(name) -> bool:
    """Whether `name` is a role a user may hold right now.

    A built-in (constant, cannot be deleted or renamed) or a `perm.Role` row
    that is not soft-deleted. The default manager already hides deleted rows,
    so a role sitting in the recycle bin is not assignable — the other half of
    "validated against the table".

    The built-ins are accepted without a query on purpose: they are the roles
    `check_permission` can answer for from `ROLE_PERMISSIONS` even before the
    table is seeded, and every fixture in this repo creates ADMIN/JUDGE users
    long before any Role row exists.
    """
    if not name:
        return False
    if name in UserRole.values:
        return True
    from apps.perm.models import Role

    return Role.objects.filter(name=name).exists()


def validate_assignable_role(value):
    """Model-field validator for `User.role` — picked up by every
    ModelSerializer built on `User`, so UserCreate/UserUpdate get it for free.

    Replaces `choices=UserRole.choices`, which made a role created through
    `POST /perm/roles/create/` unholdable by anyone (BP-11)."""
    if not is_assignable_role(value):
        raise ValidationError(
            f"'{value}' is not a role: built-in roles are {', '.join(UserRole.values)}; "
            "a custom role must exist in the role table and not be deleted."
        )


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
    # No `choices`: the value set is the Role table (see validate_assignable_role).
    role = models.CharField(
        max_length=20,
        default=UserRole.VIEWER,
        validators=[validate_assignable_role],
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
        constraints = [
            # BP-04 left the uniqueness in the serializer only, so two
            # concurrent PATCHes could both pass the check and both write the
            # victim's address. Soft-deleted rows are excluded so deactivating
            # a user frees their address; "" is excluded because 97 of the 100
            # rows on the shared box have no email at all (measured 2026-09-12,
            # zero case-insensitive duplicates — this index can be added
            # without a data migration).
            models.UniqueConstraint(
                Lower("email"),
                condition=Q(is_deleted=False) & ~Q(email=""),
                name="unique_user_email_among_live_rows",
            ),
        ]

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
