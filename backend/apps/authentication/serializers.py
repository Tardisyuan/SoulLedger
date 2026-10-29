"""
Auth serializers: register, login, user profile.
"""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.serializers import TokenRefreshSerializer as SimpleJWTTokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as simplejwt_settings

from apps.core.tenant import is_tenant_exempt

from . import signin_sessions
from .models import OfficerMfa
from .passwords import RoleMinimumLengthValidator, password_change_required, weak_password_reasons
from .tokens import RefreshToken

User = get_user_model()


class UserTenantRefSerializer(serializers.Serializer):
    """The three keys `UserManagementSerializer.get_tenant` returns.

    Schema-only, never instantiated — the method builds the dict by hand. This
    is a **reference**, not the full tenant: it carries id, code and
    display_name and nothing else, which is what the user-management screens
    need to label a row without a second request.
    """

    id = serializers.IntegerField()
    code = serializers.CharField()
    display_name = serializers.CharField()


class UserOrganizationRefSerializer(serializers.Serializer):
    """The three keys `UserManagementSerializer.get_organization` returns.

    Note the third key is `name`, not `display_name` as on the tenant beside it.
    That asymmetry is in the models and is reproduced here rather than tidied,
    because this class's whole job is to say what the endpoint actually sends.
    """

    id = serializers.IntegerField()
    code = serializers.CharField()
    name = serializers.CharField()


# ---------------------------------------------------------------------------
# Role privilege ranking — guards role assignment in the user-management API
# (UserCreateSerializer, UserUpdateSerializer, UserViewSet.assign_roles).
#
# Lower rank = more privileged. Mirrors the breadth of
# apps.perm.models.ROLE_PERMISSIONS (MODERATOR is tenant/realm-scoped but
# nearly as broad as ADMIN within its own tenant, so it ranks just under
# ADMIN). A role missing from this dict — including one not yet wired into
# UserRole.choices — ranks below VIEWER so an unrecognized caller role can
# never be used to escalate anything.
# ---------------------------------------------------------------------------
ROLE_HIERARCHY = {
    "ADMIN": 0,
    "MODERATOR": 10,
    "JUDGE": 20,
    "GUARDIAN": 30,
    "VIEWER": 40,
}
_UNRANKED_ROLE = 999


def role_rank(role):
    """Return the privilege rank for `role` (lower = more privileged)."""
    return ROLE_HIERARCHY.get(role, _UNRANKED_ROLE)


def may_assign_role(caller, role) -> bool:
    """Whether `caller` may give someone `role`: never a role more privileged than its own, and ADMIN only
    from the hall-less ADMIN. A hall's ADMIN appointing another ADMIN is not escalation inside the hall, but
    it is the one role whose holder could later be made global (2026-10-29: hall admins are hall-scoped)."""
    if role_rank(getattr(caller, 'role', None)) > role_rank(role):
        return False
    return role != 'ADMIN' or is_tenant_exempt(caller)


# ---------------------------------------------------------------------------
# Email uniqueness — one rule, every write path (BP-04)
#
# `User.email` carries no unique constraint (it is `AbstractUser`'s field; only
# `username` is unique). Registration checked for duplicates; nothing else did.
# So any logged-in user could `PATCH /auth/profile/ {"email": <a victim's>}`
# and get 200 — and from then on the victim's password reset answered "code
# sent" and sent nothing, because `reset_password_request` issues a code only
# when exactly one account holds the address and deliberately reports success
# either way. Silent, permanent, and invisible to the victim.
#
# Case-insensitive: an address differing only in case is the same mailbox, and
# the registration check was already `iexact`.
#
# NOT a database constraint: a
# `unique=True` migration would have to run against a column that may already
# hold duplicates and holds `""` for every account created without an address.
# This closes the paths that create NEW duplicates; a constraint needs a data
# migration first, and two requests racing can still both pass this check.
# ---------------------------------------------------------------------------


def email_already_registered(email, *, exclude_pk=None) -> bool:
    """Whether an account other than `exclude_pk` already holds `email`.

    Blank is never a duplicate: `create_user` defaults `email` to `""`, so
    counting empty strings would reject every account after the first one
    created without an address.
    """
    if not email:
        return False
    qs = User.objects.filter(email__iexact=email)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()


def validate_email_is_unclaimed(value, instance=None):
    """Shared body for `validate_email` — excludes the record being edited, so
    re-saving (or re-casing) one's own address is not a collision."""
    if email_already_registered(value, exclude_pk=getattr(instance, "pk", None)):
        raise serializers.ValidationError("该邮箱已被注册")
    return value


class LoginTenantRefSerializer(serializers.Serializer):
    """The user's tenant in the login payload and on `GET /auth/profile/`
    (no `id`, unlike `UserTenantRefSerializer`).

    `civilization` picks the Web's 匾 skin; `seal_glyphs` are the 1–2 admin-set
    seal characters, empty meaning "use the civilization default"."""

    code = serializers.CharField()
    display_name = serializers.CharField()
    civilization = serializers.CharField()
    seal_glyphs = serializers.ListField(child=serializers.CharField())


def user_tenant_ref(user):
    return LoginTenantRefSerializer(user.tenant).data if user.tenant_id else None


class UserWithTenantSerializer(serializers.ModelSerializer):
    """User serializer with tenant info + role permissions for login response."""
    tenant = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    # 两步验证(A12):`mfa_required` 是角色被殿设置要求(ADMIN 始终);不挡登录,前端据此挂常驻提示条。
    mfa_enabled = serializers.SerializerMethodField()
    mfa_required = serializers.SerializerMethodField()
    # 密码须先改(首次登录 / 管理员重置 / 超期):登录照常成功,但除改密码外的接口 403 `password_change_required`。
    password_change_required = serializers.SerializerMethodField()
    # 必需角色而未开两步验证(2026-10-29):登录照常成功,但除设置两步验证 / 退出 / 读自己外的接口 403 `mfa_setup_required`。
    mfa_setup_required = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "tenant", "display_name", "permissions", "mfa_enabled", "mfa_required",
                  "password_change_required", "mfa_setup_required"]

    def get_mfa_setup_required(self, obj) -> bool:
        from apps.authentication import mfa

        return mfa.setup_required(obj)

    def get_password_change_required(self, obj) -> bool:
        return password_change_required(obj)

    def get_mfa_enabled(self, obj) -> bool:
        from apps.authentication import mfa

        return mfa.is_enabled(obj)

    def get_mfa_required(self, obj) -> bool:
        from apps.authentication import mfa

        return mfa.is_required(obj)

    @extend_schema_field(LoginTenantRefSerializer(allow_null=True))
    def get_tenant(self, obj):
        return user_tenant_ref(obj)

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_permissions(self, obj):
        """What the server will actually allow this user, asked of the checker.

        This list is the login payload's `user.permissions`. It lands in
        `usePermissions`, so every codename here is a control the UI offers and
        every one missing is a control it hides.

        It used to resolve the question itself, and it resolved it differently
        from `apps/perm/checker.py`, which is what decides the answer the
        server gives. Any RolePermission row at all switched the
        ROLE_PERMISSIONS fallback off for the whole role, so on a
        partially-seeded database — a migrate-only one, which is what CI builds
        — it reported ADMIN 7 codenames against the checker's 40, GUARDIAN 1
        against 14, VIEWER 1 against 8. Users were shown almost nothing while
        the server went on permitting them everything. That is the permission
        audit's §2 finding; this serializer is its "login list" column.

        It survived a fix to the same defect in `apps/perm/views.py` because
        the two were separate copies of one rule, and because the rehydrate
        fetch in `frontend/src/contexts/TenantContext.tsx` replaces this list
        on the next page load — which bounded the damage to the first render
        after login, but bounded it with a frontend behaviour rather than
        anything in the permission layer. Trusting the login payload again
        would have restored the divergence at full size.

        `rbac_role` is deliberately no longer consulted. `check_permission`
        resolves off `obj.role` and never reads the FK, so preferring the FK
        here made the reported list depend on which of two role fields happened
        to be populated — a divergence in its own right. The FK still drives
        the WebSocket permission set (`apps/core/ws_permissions.py`), which is
        a fourth answer to this same question and is not reconciled yet.
        """
        from apps.perm.services import get_role_permission_codenames
        return get_role_permission_codenames(obj.role, obj.extra_roles)


class LoginHallSerializer(serializers.Serializer):
    code = serializers.CharField()
    display_name = serializers.CharField()


class LoginResponseSerializer(serializers.Serializer):
    """Doc-only: the 200 body of `LoginView` — simplejwt's `access`/`refresh`
    plus the `user` that `CustomTokenObtainPairSerializer.validate` adds.

    The view inherits `serializer_class = CustomTokenObtainPairSerializer`, so
    without this the schema published that serializer's *input* fields
    (username/password) as the response.
    """

    access = serializers.CharField()
    refresh = serializers.CharField()
    user = UserWithTenantSerializer()


class MfaRequiredResponseSerializer(serializers.Serializer):
    """Doc-only: the 200 body of `LoginView` when the password was right but the
    account has two-step verification on and this browser holds no valid
    「不再询问」 device cookie. No tokens: `pending_token` (5 minutes, type
    `mfa_pending`, usable nowhere else) goes to `/auth/mfa/verify/`.
    """

    mfa_required = serializers.BooleanField()
    pending_token = serializers.CharField()
    username = serializers.CharField()


class LoginFailedResponseSerializer(serializers.Serializer):
    """Doc-only: the 401 body of `LoginView` for wrong credentials.

    `remaining_attempts` is how many more failures this client IP may make
    before the next request is refused with 429 (0 means the next one is).
    """

    detail = serializers.CharField()
    remaining_attempts = serializers.IntegerField(required=False)


class LoginLockedResponseSerializer(serializers.Serializer):
    """Doc-only: the 429 body of `LoginView` once the limiter has tripped.

    `code` is always `login_locked`; `retry_after` is seconds until the
    window ends (also sent as the `Retry-After` header).
    """

    error = serializers.CharField()
    code = serializers.CharField()
    retry_after = serializers.IntegerField()


class HallChoiceResponseSerializer(serializers.Serializer):
    """Doc-only: the 409 body of the officer login (`code` is `hall_required`)."""

    code = serializers.CharField()
    detail = serializers.CharField()
    halls = LoginHallSerializer(many=True)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Add tenant info to JWT + response.

    NO `tenant_code` INPUT, deliberately. A user has exactly one tenant — the
    `User.tenant` FK, null for the global ADMINs — and the token's
    `tenant_code` claim is copied from it in `get_token` below, which is the
    only place `TenantMiddleware` learns a tenant from. There is no membership
    table, no second tenant a user may act in, and no header that selects one
    (FL-12 deleted `X-Tenant-ID`). A tenant chosen at login could therefore
    only be refused or ignored; the login page's civilization rows are
    informational and read `/auth/civilizations/`.
    """

    token_class = RefreshToken
    #: True on the officer App's login: its refresh token gets the shorter App lifetime (tokens.py).
    officer_app = False

    # 「在此设备上保持登录 30 天」. See `tokens.py` for why the choice is a
    # claim in the refresh token rather than a flag the server remembers.
    remember = serializers.BooleanField(default=False, write_only=True)

    @classmethod
    def get_token(cls, user):
        # 灵魂账号不能登录 Web 后台(2026-09-17 用户决定)。放在 get_token 而不是
        # validate 之后:密码已校验通过,但令牌与 last_login 都还没写。
        # 答的是与「密码错」同一句话 —— 这个端点不替人确认某个灵魂账号的密码是对的。
        if getattr(user, "role", None) == "SOUL":
            from rest_framework.exceptions import AuthenticationFailed

            raise AuthenticationFailed(
                cls.default_error_messages["no_active_account"], "no_active_account"
            )
        token = super().get_token(user)
        if user.tenant:
            token["tenant_code"] = user.tenant.code
        token["sv"] = user.session_version
        return token

    def validate(self, attrs):
        # TokenObtainPairSerializer.validate, restated so the token can be
        # marked *before* it is serialised: `super().validate` would hand back
        # strings already carrying the default expiry.
        super(TokenObtainPairSerializer, self).validate(attrs)
        return self._finish(attrs)

    def _finish(self, attrs):
        """Password settled for `self.user`: a second step if they have 2FA, else tokens."""
        from apps.authentication import mfa

        request = self.context.get("request")
        remembered = mfa.is_enabled(self.user) and mfa.device_remembered(request, self.user)
        if mfa.is_enabled(self.user) and not remembered:
            # 第二步:密码对了,令牌还不发。`remember` 随待验证令牌走,验码后照样生效。
            pending = mfa.PendingToken.for_user(self.user)
            pending["remember"] = bool(attrs.get("remember"))
            pending["officer_app"] = self.officer_app
            return {"mfa_required": True, "pending_token": str(pending), "username": self.user.username}
        # 靠「30 天内不再询问」cookie 跳过了第二步:会话记着那枚设备令牌,退出这台时一并作废。
        trust = mfa._hash_device(request.COOKIES[mfa.DEVICE_COOKIE]) if remembered else ""
        session = signin_sessions.start(self.user, request, officer_app=self.officer_app, trust_hash=trust)
        return issue_tokens(self.user, remember=bool(attrs.get("remember")), officer_app=self.officer_app,
                            session=session)


def issue_tokens(user, *, remember: bool, officer_app: bool = False, session=None) -> dict:
    """登录成功的那份响应:access / refresh / user。密码登录与两步验证第二步共用。
    `session`(`SignInSession`)的 `sid` 写进刷新令牌,这台设备整条轮换血统共用它。"""
    refresh = CustomTokenObtainPairSerializer.get_token(user)
    if session is not None:
        signin_sessions.attach(refresh, session)
    if officer_app:
        refresh.for_officer_app()
    elif remember:
        refresh.remember()
    data = {"refresh": str(refresh), "access": str(refresh.access_token)}
    if simplejwt_settings.UPDATE_LAST_LOGIN:
        from django.contrib.auth.models import update_last_login

        update_last_login(None, user)
    data["user"] = UserWithTenantSerializer(user).data
    return data


def reissue_for_device(user, previous, session=None) -> dict:
    """A new `{access, refresh}` for the device that held `previous` (its refresh token), after
    `end_sessions` bumped the user's `session_version`. The device keeps the lifetime it logged
    in with: the officer App's short one, or 「保持登录 30 天」."""
    refresh = CustomTokenObtainPairSerializer.get_token(user)
    if session is not None:
        signin_sessions.attach(refresh, session)
    if previous.payload.get("officer_app") is True:
        refresh.for_officer_app()
    elif previous.payload.get("remember") is True:
        refresh.remember()
    return {"refresh": str(refresh), "access": str(refresh.access_token)}


class HallChoiceRequired(APIException):
    """409 for the officer app's login: the password matched officers in more than
    one hall. The body lists only those halls; the client retries with `tenant_code`."""

    status_code = 409
    default_code = "hall_required"

    def __init__(self, halls):
        super().__init__({"code": "hall_required", "detail": "请选择所属殿。", "halls": halls})


class OfficerTokenObtainPairSerializer(CustomTokenObtainPairSerializer):
    """Officer-app login: username + password, **no hall chosen** (2026-10-09).

    The app is in the stores, so the hall is found from the account. `User.username`
    is globally unique today, so the account names exactly one hall and this behaves
    as the Web login does; the `hall_required` branch is the contract for the day
    that stops being true (and is what `tenant_code` answers). The password is
    verified BEFORE any hall is revealed, and every failure is the same
    `no_active_account` — a wrong password, an unknown name, a soul account and a
    hall hint that does not match are indistinguishable from outside.
    """

    tenant_code = serializers.CharField(required=False, allow_blank=True, write_only=True)
    officer_app = True

    @staticmethod
    def accounts_named(username):
        return list(User.objects.filter(username=username).select_related("tenant"))

    def validate(self, attrs):
        from rest_framework.exceptions import AuthenticationFailed

        refused = AuthenticationFailed(self.default_error_messages["no_active_account"], "no_active_account")
        hint = (attrs.get("tenant_code") or "").strip()
        accounts = self.accounts_named(attrs["username"])
        if len(accounts) > 1:
            matches = [u for u in accounts
                       if u.is_active and u.role != "SOUL" and u.check_password(attrs["password"])]
            if hint:
                matches = [u for u in matches if u.tenant_id and u.tenant.code == hint]
            if not matches:
                raise refused
            if len(matches) > 1:
                raise HallChoiceRequired([
                    {"code": u.tenant.code, "display_name": u.tenant.display_name}
                    for u in matches if u.tenant_id
                ])
            self.user = matches[0]
        else:
            super(TokenObtainPairSerializer, self).validate(attrs)  # authenticates → self.user
            if hint and not (self.user.tenant_id and self.user.tenant.code == hint):
                raise refused
        if self.user.role == "SOUL":
            raise refused
        return self._finish(attrs)  # 2FA (feat/officer-2fa): same mfa_required + pending_token step as /auth/login/


class TokenRefreshSerializer(signin_sessions.SessionAwareRefreshMixin, SimpleJWTTokenRefreshSerializer):
    """SimpleJWT's refresh, on this app's token class — the one whose
    `set_exp` honours the `remember` claim on rotation (see `tokens.py`).
    Same class name as SimpleJWT's so the schema component stays
    `TokenRefresh`."""

    token_class = RefreshToken


class UserSerializer(serializers.ModelSerializer):
    """The serializer behind `PATCH /auth/profile/` — what a user may change
    about themselves.

    `role` and `tenant` were already locked. `organization` was not, and it is
    a foreign key with no tenant check: measured, a VIEWER could
    `PATCH /auth/profile/ {"organization": <an org belonging to tenant B>}`
    and get 200. A tenant check here closed that first.

    Since 2026-10-16 (user decision) `organization` and `position` are read-only
    here altogether: only an admin assigns them, through `UserUpdateSerializer`
    (`PATCH /users/{id}/`). Sending either with a *different* value is a 400
    naming the field (`to_internal_value`) — silently dropping it would read
    as a saved change. The unchanged value is accepted, so a client echoing
    back the profile it read is not refused.
    """

    #: Read-only, same shape as the login payload's `user.tenant` —
    #: the Web re-reads civilization / seal_glyphs here after an admin edit.
    tenant = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "email_verified", "role", "tenant", "first_name", "last_name", "is_active", "display_name", "organization", "position", "mfa_enabled", "mfa_required", "password_change_required", "mfa_setup_required"]
        read_only_fields = ["id", "is_active", "username", "role", "organization", "position"]

    #: 邮箱已验证(官员邮箱重置密码的前提);改邮箱即变回 false。见 `User.email_verified`。
    email_verified = serializers.BooleanField(read_only=True)
    mfa_enabled = serializers.SerializerMethodField()
    mfa_required = serializers.SerializerMethodField()
    password_change_required = serializers.SerializerMethodField()
    mfa_setup_required = serializers.SerializerMethodField()

    def get_password_change_required(self, obj) -> bool:
        return password_change_required(obj)

    def get_mfa_setup_required(self, obj) -> bool:
        from apps.authentication import mfa

        return mfa.setup_required(obj)

    def get_mfa_enabled(self, obj) -> bool:
        from apps.authentication import mfa

        return mfa.is_enabled(obj)

    def get_mfa_required(self, obj) -> bool:
        from apps.authentication import mfa

        return mfa.is_required(obj)

    @extend_schema_field(LoginTenantRefSerializer(allow_null=True))
    def get_tenant(self, obj):
        return user_tenant_ref(obj)

    def validate_email(self, value):
        """See `validate_email_is_unclaimed`. This is the path the attack used:
        `email` was writable here with no check at all."""
        return validate_email_is_unclaimed(value, self.instance)

    def validate_display_name(self, value):
        """改名时不许改成空:导航栏与官员端「我的」把它当名字显示。只在请求带了这个字段时才走到这里
        (`partial=True`);首尾空白已被 CharField 的 `trim_whitespace` 去掉,所以全是空格的也算空。"""
        if not value:
            raise serializers.ValidationError("显示名不能为空。")
        return value

    def to_internal_value(self, data):
        # 组织与职务只有管理员能改(用户 2026-10-16 定):值变了就 400 并点名字段,和
        # `UserUpdateSerializer` 拒 `password` 同一个样子;原样回传不算改。
        if self.instance is not None and hasattr(data, "get"):
            current = {
                "organization": self.instance.organization_id,
                "position": self.instance.position,
            }
            changed = {
                field: "Only an administrator can change this."
                for field, now in current.items()
                if field in data and str(data.get(field) or "") != str(now or "")
            }
            if changed:
                raise serializers.ValidationError(changed)
        return super().to_internal_value(data)


# ---------------------------------------------------------------------------
# User Management API Serializers (Tenant Admin)
# ---------------------------------------------------------------------------


class UserMfaRefSerializer(serializers.Serializer):
    """The 「两步验证」 column of the users list."""

    enabled = serializers.BooleanField()
    required = serializers.BooleanField()
    confirmed_at = serializers.DateTimeField(allow_null=True)
    last_used_at = serializers.DateTimeField(allow_null=True)


class UserMfaResetSerializer(serializers.Serializer):
    """`POST /users/{id}/reset-mfa/`: the reason is audited, and required."""

    reason = serializers.CharField(max_length=200, allow_blank=False, trim_whitespace=True)


class UserDeactivateSerializer(serializers.Serializer):
    """`POST /users/{id}/deactivate/`: an officer who still holds open work is refused (409 `officer_has_open_work`)
    unless `handover_to` names the officer of the same hall who takes it; the handover and the deactivation are one
    transaction (`apps/judgment/handover.py`)."""

    handover_to = serializers.IntegerField(required=False, allow_null=True)


class OpenWorkSerializer(serializers.Serializer):
    """What an officer still holds: the counts of `handover.preview(source, None)`."""

    judgments = serializers.IntegerField()
    appeals = serializers.IntegerField()
    appeals_returned_to_pool = serializers.IntegerField()
    city_gods = serializers.ListField(child=serializers.CharField())
    letters = serializers.IntegerField()


class OfficerHasOpenWorkSerializer(serializers.Serializer):
    """409 of a single deactivation. `open_work` is keyed by user id (one key)."""

    error = serializers.CharField()
    code = serializers.ChoiceField(["officer_has_open_work"])
    open_work = serializers.DictField(child=OpenWorkSerializer())


class UserManagementSerializer(serializers.ModelSerializer):
    """User serializer for list/retrieve operations in user management API."""
    tenant = serializers.SerializerMethodField()
    organization = serializers.SerializerMethodField()
    # 助手管理造的评测官员(apps/soul_assist/eval_identities.py):显示、打「评测专用 · 不能登录」标签
    # (用户 2026-09-29 定)。id 在共用的 context 里缓存,一次请求只查一次。
    is_eval_identity = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'tenant', 'organization', 'position', 'is_active', 'create_time', 'avatar', 'is_eval_identity', 'extra_roles', 'mfa', 'invite_pending']
        read_only_fields = ['id', 'create_time', 'extra_roles']

    # 两步验证列(A12):三态 = enabled / required。`get_queryset` 把 `mfa` 行 select_related 进来,这里不另查。
    mfa = serializers.SerializerMethodField()

    @extend_schema_field(UserMfaRefSerializer())
    def get_mfa(self, obj):
        from apps.authentication import mfa as mfa_rules

        try:
            row = obj.mfa
        except OfficerMfa.DoesNotExist:
            row = None
        enabled = row is not None and row.enabled
        return {
            "enabled": enabled,
            "required": mfa_rules.is_required(obj),
            "confirmed_at": row.confirmed_at if enabled else None,
            "last_used_at": row.last_used_at if enabled else None,
        }

    # 邀请了、还没设密码(第五十四批,用户 2026-10-26 定):列表打「待接受邀请」,同一邮箱再邀请一次即重发。
    # 评测官员同样没有可用密码,但不是被邀请的人,除外。
    invite_pending = serializers.SerializerMethodField()

    def get_invite_pending(self, obj) -> bool:
        from apps.authentication.officer_invite import is_pending

        return is_pending(obj) and not self.get_is_eval_identity(obj)

    def get_is_eval_identity(self, obj) -> bool:
        from apps.soul_assist.eval_identities import tagged_ids

        return obj.pk == tagged_ids(self.context)[1]

    @extend_schema_field(UserTenantRefSerializer(allow_null=True))
    def get_tenant(self, obj):
        if obj.tenant:
            return {"id": obj.tenant.id, "code": obj.tenant.code, "display_name": obj.tenant.display_name}
        return None

    @extend_schema_field(UserOrganizationRefSerializer(allow_null=True))
    def get_organization(self, obj):
        if obj.organization:
            return {"id": obj.organization.id, "code": obj.organization.code, "name": obj.organization.name}
        return None


def organization_in_tenant(organization, tenant_id):
    """An organization may only hang under an account of its own tenant (shared by user create and update)."""
    if organization.tenant_id != tenant_id:
        raise serializers.ValidationError(
            f"组织 {organization.code} 属于另一个租户,不能挂到这个账号下。"
        )
    return organization


class UserCreateSerializer(serializers.ModelSerializer):
    """User serializer for creation with password handling.

    Callers other than the hall-less ADMIN (an ADMIN bound to a hall included) are constrained two ways (see ROLE_HIERARCHY above):
    - `tenant` is forced to the caller's own tenant — a client-supplied
      value for another tenant is rejected rather than silently honored.
    - `role` can never be more privileged than the caller's own role, which
      is what blocks a non-ADMIN from creating an ADMIN account (themselves
      or anyone else).
    The hall-less ADMIN keeps the unrestricted behavior (any tenant, any role).
    """
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name', 'role', 'tenant', 'organization', 'position', 'is_active']

    def validate_email(self, value):
        """See `validate_email_is_unclaimed` (BP-04)."""
        return validate_email_is_unclaimed(value, self.instance)

    def validate(self, attrs):
        request = self.context.get('request')
        caller = getattr(request, 'user', None) if request is not None else None

        # 只有没绑殿的全局 ADMIN 可以把人建在任意殿;绑殿的 ADMIN 与其他角色一样只能建在本殿(2026-10-29)。
        if not is_tenant_exempt(caller):
            caller_tenant = getattr(request, 'tenant', None) if request is not None else None
            target_tenant = attrs.get('tenant')
            if target_tenant is None:
                if caller_tenant is None:
                    raise serializers.ValidationError(
                        {'tenant': 'No tenant context available for this request.'}
                    )
                attrs['tenant'] = caller_tenant
            elif target_tenant != caller_tenant:
                raise serializers.ValidationError(
                    {'tenant': 'Cannot create a user in another tenant.'}
                )

            target_role = attrs.get('role', 'VIEWER')
            if not may_assign_role(caller, target_role):
                raise serializers.ValidationError(
                    {'role': 'Cannot assign a role more privileged than your own.'}
                )

        organization = attrs.get('organization')
        if organization is not None:
            tenant = attrs.get('tenant')
            try:
                organization_in_tenant(organization, getattr(tenant, 'pk', None))
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({'organization': exc.detail}) from None

        try:
            RoleMinimumLengthValidator().validate(
                attrs['password'], User(username=attrs.get('username', ''), role=attrs.get('role', 'VIEWER')))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': [{'code': e.code, 'message': ' '.join(e.messages)}
                                                            for e in exc.error_list]}) from None
        return attrs

    def create(self, validated_data):
        # An admin chose the password: the officer picks their own at first login.
        return User.objects.create_user(**validated_data, must_change_password=True)


class UserUpdateSerializer(serializers.ModelSerializer):
    """User serializer for updates (email, role, is_active, organization, position).

    `tenant` is deliberately not in `fields` — a user's tenant can't be
    changed through this path at all, by ADMIN or otherwise.
    """

    class Meta:
        model = User
        fields = ['email', 'first_name', 'last_name', 'role', 'is_active', 'organization', 'position']

    def validate_email(self, value):
        """See `validate_email_is_unclaimed` (BP-04). `self.instance` is the
        user being edited, so keeping their own address is not a collision."""
        return validate_email_is_unclaimed(value, self.instance)

    def to_internal_value(self, data):
        # 这条路径不改密码:未知字段本来被静默丢掉,操作员以为改成了。
        # 改密只走 `POST /users/{id}/reset_password/`(随机口令、首登必改、其余设备退出)。
        if 'password' in data:
            raise serializers.ValidationError(
                {'password': 'Passwords are not changed here; use /users/{id}/reset_password/.'}
            )
        return super().to_internal_value(data)

    def validate_organization(self, value):
        """The organization must be in the edited user's own tenant (user, 2026-10-16).

        `PrimaryKeyRelatedField` resolves the FK against the whole table, and an
        ADMIN reaches users of every tenant, so nothing else stops an admin from
        hanging a user under another tenant's organization. Checked against the
        user being edited, not the caller: the user's tenant does not change here.
        """
        if value is None or self.instance is None:
            return value
        return organization_in_tenant(value, self.instance.tenant_id)

    def validate_role(self, value):
        request = self.context.get('request')
        caller = getattr(request, 'user', None) if request is not None else None
        # Echoing the unchanged role back is not an assignment.
        if self.instance is not None and value == self.instance.role:
            return value
        if not may_assign_role(caller, value):
            raise serializers.ValidationError(
                'Cannot assign a role more privileged than your own.'
            )
        return value


class PasswordReasonSerializer(serializers.Serializer):
    """Doc-only: one reason a new password was refused. `code` is Django's validator code
    (`password_too_short` / `password_too_common` / `password_entirely_numeric` /
    `password_too_similar`); `message` is its English sentence, a fallback for clients."""

    code = serializers.CharField()
    message = serializers.CharField()


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer for changing password with old password verification.

    `refresh` is this device's refresh token: the change ends every OTHER session, and the
    response carries a fresh pair for this one, with the same 7 / 30 day lifetime this
    device logged in with. Without it, this device is signed out too.
    """
    old_password = serializers.CharField(write_only=True, required=True)
    new_password = serializers.CharField(write_only=True, required=True, max_length=128)
    refresh = serializers.CharField(write_only=True, required=False, allow_blank=True)
    token = serializers.CharField(
        write_only=True, required=False, allow_blank=True, max_length=255,
        help_text="Officer app only: this device's Expo push token. Every other push registration of "
                  "the user is deleted with the sessions; without it (the web) all of them are.",
    )

    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("旧密码不正确")
        return value

    def validate_new_password(self, value):
        # Reasons one by one, each with the validator's code: `new_password: [{code, message}]`.
        reasons = weak_password_reasons(value, self.context['request'].user)
        if reasons:
            raise serializers.ValidationError(reasons)
        return value


class ChangePasswordRefusalSerializer(serializers.Serializer):
    """Doc-only 400 body: `old_password` is a list of sentences, `new_password` a list of reasons."""

    old_password = serializers.ListField(child=serializers.CharField(), required=False)
    new_password = PasswordReasonSerializer(many=True, required=False)
    refresh = serializers.ListField(child=serializers.CharField(), required=False)


class ChangePasswordResponseSerializer(serializers.Serializer):
    """200 body. `access` / `refresh` are this device's new pair (absent when no `refresh` was sent)."""

    detail = serializers.CharField()
    access = serializers.CharField(required=False)
    refresh = serializers.CharField(required=False)


class ResetPasswordSerializer(serializers.Serializer):
    """Serializer for requesting password reset."""
    email = serializers.EmailField()


class SetNewPasswordSerializer(serializers.Serializer):
    """Serializer for setting new password via code."""
    email = serializers.EmailField()
    code = serializers.CharField(min_length=6, max_length=6)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_code(self, value):
        """Ensure code is exactly 6 digits."""
        if not value.isdigit() or len(value) != 6:
            raise serializers.ValidationError("验证码必须是6位数字")
        return value


#: Every `code` a refusal of `/auth/reset-password/` or `/auth/set-new-password/`
#: carries. Clients branch on these, never on the `error` sentence beside them.
PASSWORD_RESET_REFUSAL_CODES = [
    ("rate_limited", "throttled; `retry_after` says for how long"),
    ("reset_code_expired", "no live code for this address"),
    ("reset_code_wrong", "the code does not match"),
    ("reset_code_attempts_exceeded", "too many wrong codes; the code was deleted"),
    ("weak_password", "the password validators refused the new password"),
    ("no_soul_account", "no soul account has this address (no longer returned: answered as reset_code_wrong)"),
    ("ambiguous_email", "several accounts share this address (no longer returned: answered as reset_code_wrong)"),
]


class PasswordResetRefusalSerializer(serializers.Serializer):
    """Doc-only: every refusal of the two email-reset endpoints.

    `error` is for people and may be reworded; `code` is the contract.
    `retry_after` (seconds, also the `Retry-After` header) is present exactly
    when `code` is `rate_limited`.
    """

    error = serializers.CharField()
    code = serializers.ChoiceField(choices=PASSWORD_RESET_REFUSAL_CODES)
    retry_after = serializers.IntegerField(required=False)
    #: Present exactly when `code` is `reset_code_wrong`: further checks this code will take.
    attempts_left = serializers.IntegerField(required=False)


class LoginLogSerializer(serializers.ModelSerializer):
    """Serializer for login log entries."""
    class Meta:
        from .models import LoginLog
        model = LoginLog
        fields = ["id", "user", "username", "status", "ip_address",
                  "user_agent", "failure_reason", "timestamp"]
        read_only_fields = fields


class LogoutRequestSerializer(serializers.Serializer):
    """Body of POST /auth/logout/.

    `required=False` is not a courtesy: `logout_view` reads
    `request.data.get("refresh")` and returns 200 "Logged out successfully"
    when it is absent, blacklisting nothing. Declaring it required would
    document a rejection the view does not perform.
    """

    refresh = serializers.CharField(required=False)


class UserBatchUpdateResultSerializer(serializers.Serializer):
    """`{"updated": N}` — what `batch_activate` and `batch_deactivate` return.

    Schema-only, never instantiated. `updated` is the row count from a single
    `QuerySet.update()`, so it counts rows the tenant filter actually reached,
    not the ids the caller sent — a caller passing ids from another tenant gets
    a smaller number, not an error.
    """

    updated = serializers.IntegerField()


class HeldOfficerSerializer(serializers.Serializer):
    """One officer a batch deactivation left active because they still hold open work."""

    id = serializers.CharField()
    username = serializers.CharField()
    open_work = OpenWorkSerializer()


class UserBatchDeactivateResultSerializer(UserBatchUpdateResultSerializer):
    """`batch_deactivate`: everyone without open work is deactivated (`updated`); the officers who still hold work
    stay active and are listed in `held`, to be deactivated one at a time with a handover (2026-10-27)."""

    held = HeldOfficerSerializer(many=True)


class UserImportResultSerializer(serializers.Serializer):
    """`{"created": N, "errors": [...]}` — the CSV import summary.

    Schema-only. `errors` is truncated to the first 50 rows by the view, so an
    empty list means "no failures" but a 50-long list does **not** mean exactly
    fifty; `created` is the only exact figure in this body.

    With `?dry_run=1` (the web import's preview step, batch 34) the same action answers the preview shape instead
    -- `total` / `ok_count` / `error_count` / `rows`, nothing written. One action, two bodies, so every field is
    optional here and the client picks by mode.
    """

    created = serializers.IntegerField(required=False)
    # 其中不写密码、改发邀请信的行数(2026-10-25);预览里每行另有 `delivery`: password / invite。
    invited = serializers.IntegerField(required=False)
    errors = serializers.ListField(child=serializers.CharField(), required=False)
    total = serializers.IntegerField(required=False)
    ok_count = serializers.IntegerField(required=False)
    error_count = serializers.IntegerField(required=False)
    rows = serializers.ListField(child=serializers.DictField(), required=False)


class UserRoleSerializer(serializers.Serializer):
    """`{"role": "...", "extra_roles": [...]}` — the body `own_roles` returns.

    Schema-only. `role` is the primary role (ADMIN bypass, ranking); the
    permissions a user holds are the union of `role` and `extra_roles`.
    """

    role = serializers.CharField()
    extra_roles = serializers.ListField(child=serializers.CharField())


class AssignRolesSerializer(serializers.Serializer):
    """Body of `POST /users/{id}/assign_roles/`. At least one field.

    `role` replaces the primary role, `extra_roles` replaces the whole list of
    additional roles (send `[]` to clear it). ADMIN and SOUL are refused as
    additional roles; the view checks each name against the role table and
    against the caller's own rank.
    """

    role = serializers.CharField(required=False)
    extra_roles = serializers.ListField(child=serializers.CharField(), required=False)


class PasswordResetResultSerializer(serializers.Serializer):
    """`{"password": "..."}` — the generated password `reset_password` returns.

    Schema-only. The plaintext is in the response body because this is the only
    time it exists; it is never stored and cannot be read back.
    """

    password = serializers.CharField()


# ---------------------------------------------------------------------------
# Login page: civilizations, password help. Account: preferences.
# ---------------------------------------------------------------------------


class PublicCivilizationSerializer(serializers.Serializer):
    """One row of `GET /auth/civilizations/` — the login page's civilization list.

    PUBLIC, SO ONLY WHAT THE PAGE DRAWS. The page draws a shape mark and the
    civilization's name, and both are looked up client-side from
    `civilization` (`CIVILIZATION_MARK`, `organization.civilizations.*`), so
    the row carries the tenant code and the civilization and nothing else —
    not `display_name` (an administrative label the page never shows), not
    `settings`, `api_endpoint`, `dispatch_enabled` or any count.
    """

    code = serializers.CharField()
    civilization = serializers.CharField()


class PasswordHelpRequestSerializer(serializers.Serializer):
    """`POST /auth/password-help/` — 「忘记密码」 on an admin-provisioned console."""

    username = serializers.CharField(max_length=150, trim_whitespace=True)


#: 官员邮件的两种语言(apps/notifications/tasks.py 的文案只写了这两种)。与 `EvalCase.locale`
#: 是同一个选项集,schema 里钉成同一个名字(settings `ENUM_NAME_OVERRIDES`)。
EMAIL_LOCALES = ("zh-Hans", "en")


class _StrictSerializer(serializers.Serializer):
    """Unknown keys are refused rather than dropped (a JSON column: a client that believes it saved should hear it did not)."""

    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = sorted(set(data) - set(self.fields))
            if unknown:
                raise serializers.ValidationError({key: ["Unknown preference."] for key in unknown})
        return super().to_internal_value(data)


class ChannelPrefsSerializer(_StrictSerializer):
    """One category's two channels."""

    site = serializers.BooleanField(required=False)
    mail = serializers.BooleanField(required=False)


class NotificationPrefsSerializer(_StrictSerializer):
    """`preferences.notifications`: one `ChannelPrefsSerializer` per category in `apps/notifications/categories.py`."""

    account_security = ChannelPrefsSerializer(required=False)
    approval = ChannelPrefsSerializer(required=False)
    approval_timeout = ChannelPrefsSerializer(required=False)
    reassign = ChannelPrefsSerializer(required=False)
    password_help = ChannelPrefsSerializer(required=False)
    dispatch = ChannelPrefsSerializer(required=False)
    letter_handoff = ChannelPrefsSerializer(required=False)
    city_god = ChannelPrefsSerializer(required=False)

    def validate(self, attrs):
        from apps.notifications.categories import LOCKED

        errors = {
            category: {channel: ["Always on."] for channel in LOCKED.get(category, ()) if cell.get(channel) is False}
            for category, cell in attrs.items()
        }
        errors = {c: e for c, e in errors.items() if e}
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class UserPreferencesSerializer(serializers.Serializer):
    """`User.preferences`, as the API reads and writes it.

    Four keys. Language and theme are not here: both are browser-side
    settings with no server home (the locale is a cookie the middleware reads,
    the theme a localStorage key), and moving them is a separate decision.
    """

    DEFAULT_VIEWS = ("operator", "admin")

    #: 操作员 → /judgment/queue, 管理员 → /dashboard (`frontend/src/lib/defaultView.ts`).
    #: Null until the operator picks one.
    default_view = serializers.ChoiceField(choices=DEFAULT_VIEWS, allow_null=True, required=False)
    #: /welcome 的首次设置做完或跳过了没有(`WelcomeSetup.tsx`)。Unset reads as false;
    #: `default` is only the read-side fallback — a partial PATCH never applies it.
    onboarded = serializers.BooleanField(required=False, default=False)
    #: 官员通知偏好:类别 × 站内 / 邮件(`apps/notifications/categories.py`)。读到的永远是整张表
    #: (锁定的格恒为开);PATCH 只写给出的格,锁定的格不能关。取代了旧的 `email_notifications` 总开关。
    notifications = NotificationPrefsSerializer(required=False)
    #: 邮件用哪种语言。官员没有别的存下来的语言偏好(见 apps/notifications/messages.py),
    #: 所以 /profile 开开关时把当时的界面语言记在这里;空则按所属文明(`mail_locale`)。
    #: 只有 zh-Hans 与 en:官员邮件文案只写了这两种(egy 界面落到 en)。
    email_locale = serializers.ChoiceField(choices=EMAIL_LOCALES, allow_null=True, required=False)

    def to_internal_value(self, data):
        # Unknown keys are refused rather than silently dropped: this is a
        # JSON column, and a client that believes it saved `theme` should hear
        # that it did not.
        if isinstance(data, dict):
            unknown = sorted(set(data) - set(self.fields))
            if unknown:
                raise serializers.ValidationError({key: ["Unknown preference."] for key in unknown})
        return super().to_internal_value(data)


class OfficerInviteSerializer(serializers.Serializer):
    """`POST /users/invite/`(ADMIN):邀请一位官员。`tenant` 是殿的 code,只给没有殿的全局管理员用;
    缺省是调用者自己的殿。`username` 缺省取邮箱 @ 前那段(重名时加数字)。"""

    email = serializers.EmailField()
    role = serializers.CharField(max_length=20)
    username = serializers.CharField(max_length=150, required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    tenant = serializers.CharField(max_length=50, required=False, allow_blank=True)
