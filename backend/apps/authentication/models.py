"""
Custom user model for SoulLedger.
"""
import uuid

from django.contrib.auth.models import AbstractUser, UserManager
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone

from apps.core.models import AuditUserFields
from apps.death_sync.fields import EncryptedCharField


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
    refuses to bin them. Since 2026-09-24 no role's name can change after
    creation, built-in or custom (`RoleCreateUpdateSerializer.validate_name`);
    "copy as new role" is the way to the same grants under another code.

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
    # 灵魂本人(灵魂端 App)。不是官职:**不可分配**(`is_assignable_role` 对它答
    # False,于是用户管理的创建 / 更新 / assign_roles / CSV 导入都拒绝它),
    # 只由 `apps/soul_accounts/services.py::provision_account` 创建;
    # `check_permission` 对它恒答 False;默认认证类
    # (`apps/soul_accounts/authentication.py::OfficerJWTAuthentication`)把它挡在
    # 全部官员接口之外;不在 ROLE_HIERARCHY 里,于是排名低于 VIEWER。
    SOUL = "SOUL", "Soul (灵魂)"


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
    if not name or name == UserRole.SOUL:
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
    # 兼任的其它角色(角色名列表)。权限 = `role` 与这里每个角色的并集,
    # 并集只在 `apps/perm/checker.py::check_permission` 里算一次。
    # 不含 ADMIN / SOUL(`UserViewSet.assign_roles` 拒绝,检查器也无视),
    # 主角色 `role` 仍是唯一决定 ADMIN 旁路、租户豁免、排名的那一个。
    extra_roles = models.JSONField(default=list, blank=True)
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
    # Per-user console settings that should follow the operator to another
    # browser. Shape and allowed keys: `UserPreferencesSerializer`; served by
    # `GET/PATCH /auth/profile/preferences/`, and only for `request.user`.
    preferences = models.JSONField(default=dict, blank=True)
    # 邮箱验证(2026-10-09,官员邮箱重置密码的前提)。存的是**被验证的那个地址**而不是一个布尔:
    # 改邮箱的任何路径(资料页、用户管理、CSV 导入)都不必记得去清标志 —— 地址一变,
    # `email_verified` 立刻为假。`email_verified_at` 只用来展示。
    email_verified_address = models.EmailField(blank=True, default="")
    email_verified_at = models.DateTimeField(null=True, blank=True)
    # 会话代数(2026-10-10)。官员的 access / refresh 都带 `sv` 声明 = 签发时的这个数;
    # 改密码、邮箱重置密码时 +1,于是**所有旧令牌立刻作废**(HTTP 与 WebSocket 握手都比对),
    # 不必等 access 自然过期。不带 `sv` 的旧令牌按 0 算,上线不会让任何人掉线。
    session_version = models.PositiveIntegerField(default=0)
    # 官员密码策略(2026-10-15):上一次设密码的时间(`passwords.set_officer_password` 写),
    # 与「必须先改密码」标记 —— 管理员开通 / 重置密码时置真,本人改密码时清。
    # 迁移给存量用户填迁移那一刻,上线时没有人因 `OFFICER_PASSWORD_MAX_AGE_DAYS` 而过期。
    password_changed_at = models.DateTimeField(default=timezone.now)
    must_change_password = models.BooleanField(default=False)

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

    @property
    def email_verified(self) -> bool:
        return bool(self.email) and self.email_verified_address.lower() == self.email.lower()

    def __str__(self):
        return f"{self.username} ({self.role})"


class PasswordHistory(models.Model):
    """官员用过的旧密码(只存哈希)。`passwords.set_officer_password` 在换掉旧哈希时写入,
    并只保留最近 `PASSWORD_HISTORY_KEEP` 条;新密码不能与它们、也不能与当前密码相同。"""

    user = models.ForeignKey("authentication.User", on_delete=models.CASCADE, related_name="password_history")
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "-created_at"])]


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
    #: 成功登录用的办法(`SignInMethod`);灵魂端「最近登录」显示它。失败的行留空,按 `failure_reason` 推。
    method = models.CharField(max_length=16, blank=True, default="")
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


# ── 两步验证(A12,2026-10-09)────────────────────────────────────────────────
# 官员专用:灵魂账号(role=SOUL)走 apps/soul_accounts 的登录,不经过这里。
# 规则与数字(窗口、锁定、恢复码)在 apps/authentication/mfa.py;这里只有存法。


class OfficerMfa(models.Model):
    """一个官员一行。`confirmed_at` 为空 = 向导没走到「完成」,等于没开启;
    `secret` 用 death_sync 的 Fernet 字段加密落库(没配 ENCRYPTION_KEY 时明文,
    settings.py 在 DEBUG=False 下拒绝那种配置)。"""

    user = models.OneToOneField("authentication.User", on_delete=models.CASCADE, related_name="mfa")
    secret = EncryptedCharField(max_length=255)
    #: 向导第三步验过一次动态码(恢复码已生成),还没按「完成」。
    verified_at = models.DateTimeField(null=True, blank=True)
    #: 按下「完成」的时刻;有值才算开启。
    confirmed_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    last_used_method = models.CharField(max_length=10, blank=True, default="")
    #: 最近一次验证通过的 TOTP 时间步 —— 同一个码不能用第二次。
    last_step = models.BigIntegerField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Officer MFA"

    @property
    def enabled(self) -> bool:
        return self.confirmed_at is not None


class MfaRecoveryCode(models.Model):
    """恢复码:像密码一样只存哈希(`make_password`),一次一用。"""

    mfa = models.ForeignKey(OfficerMfa, on_delete=models.CASCADE, related_name="recovery_codes")
    code_hash = models.CharField(max_length=128)
    used_at = models.DateTimeField(null=True, blank=True)


class MfaRememberedDevice(models.Model):
    """「在此设备上 30 天内不再询问」的设备令牌。与「保持登录 30 天」的刷新令牌**无关**:
    浏览器只拿到 httpOnly cookie 里的随机值,这里存它的 sha256;登出不清它,管理员重置清它。"""

    user = models.ForeignKey("authentication.User", on_delete=models.CASCADE, related_name="mfa_devices")
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)


class SignInMethod(models.TextChoices):
    PASSWORD = "password", "密码"
    FACE = "face", "面容/指纹"
    RECOVERY = "recovery", "恢复码"


class SignInSession(models.Model):
    """一台设备的一次登录 = 一条刷新令牌的「血统」。

    SimpleJWT 每次刷新都轮换刷新令牌、把旧的拉黑,一台设备于是留下一串 `OutstandingToken`,
    没有哪一条能代表「这台设备」。这一行在登录时建好,把 `id` 作为 `sid` 声明写进刷新令牌;
    轮换会原样复制声明(`no_copy_claims` 里没有它),access 也带着,所以整条血统与每个 access
    都认得自己属于哪台设备。官员与灵魂共用:灵魂账号也是一个 `User`。

    退出一台 = `revoked_at` 有值(`session_is_current` 立刻拒掉它的 access、刷新被拒)+ 当前刷新令牌
    进黑名单 + 它记着的「30 天内不再询问」设备作废。没有位置字段:没有可靠的地理来源。
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("authentication.User", on_delete=models.CASCADE, related_name="sign_in_sessions")
    #: 「macOS · Safari」「官员 App · iPhone」。登录时由 User-Agent 推出(`signin_sessions.label_for`)。
    label = models.CharField(max_length=80, blank=True)
    method = models.CharField(max_length=16, choices=SignInMethod.choices, default=SignInMethod.PASSWORD)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    #: 这条血统当前的刷新令牌 jti(每次刷新更新),退出时据此拉黑。
    refresh_jti = models.CharField(max_length=255, blank=True)
    #: 「30 天内不再询问」设备令牌的 sha256(官员的 `MfaRememberedDevice` 或灵魂的 `SoulMfaDevice`,
    #: 两张表的 `token_hash` 都是这个值);不用外键,免得 authentication 反向依赖 soul_accounts。
    trust_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "revoked_at", "last_seen_at"])]

    def __str__(self):
        return f"{self.user_id} {self.label} {self.id}"
from apps.authentication.impersonation_models import Impersonation  # noqa: E402,F401  (Django 只从 models 模块发现模型)
