"""
Auth serializers: register, login, user profile.
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.serializers import TokenRefreshSerializer as SimpleJWTTokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as simplejwt_settings

from .models import OfficerMfa
from .passwords import weak_password_reasons
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
# NOT a database constraint, for the reason `RegisterSerializer` records: a
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

    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "tenant", "display_name", "permissions", "mfa_enabled", "mfa_required"]

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
        if mfa.is_enabled(self.user) and not mfa.device_remembered(request, self.user):
            # 第二步:密码对了,令牌还不发。`remember` 随待验证令牌走,验码后照样生效。
            pending = mfa.PendingToken.for_user(self.user)
            pending["remember"] = bool(attrs.get("remember"))
            pending["officer_app"] = self.officer_app
            return {"mfa_required": True, "pending_token": str(pending), "username": self.user.username}
        return issue_tokens(self.user, remember=bool(attrs.get("remember")), officer_app=self.officer_app)


def issue_tokens(user, *, remember: bool, officer_app: bool = False) -> dict:
    """登录成功的那份响应:access / refresh / user。密码登录与两步验证第二步共用。"""
    refresh = CustomTokenObtainPairSerializer.get_token(user)
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


def reissue_for_device(user, previous) -> dict:
    """A new `{access, refresh}` for the device that held `previous` (its refresh token), after
    `end_sessions` bumped the user's `session_version`. The device keeps the lifetime it logged
    in with: the officer App's short one, or 「保持登录 30 天」."""
    refresh = CustomTokenObtainPairSerializer.get_token(user)
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


class TokenRefreshSerializer(SimpleJWTTokenRefreshSerializer):
    """SimpleJWT's refresh, on this app's token class — the one whose
    `set_exp` honours the `remember` claim on rotation (see `tokens.py`).
    Same class name as SimpleJWT's so the schema component stays
    `TokenRefresh`."""

    token_class = RefreshToken


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
        required=True,
        style={"input_type": "password"},
    )

    class Meta:
        model = User
        # FIX: removed 'role' — role is always set to VIEWER on creation
        # this prevents mass assignment of privileged roles during registration
        fields = ["username", "email", "password", "first_name", "last_name"]

    def validate_password(self, value):
        validate_password(value)
        return value

    def validate_email(self, value):
        """Refuse an address that already has an account.

        This endpoint is `AllowAny`, so without the check anyone could register
        a second account on someone else's address and take that address's
        password reset offline permanently. The rule itself now lives in
        `validate_email_is_unclaimed` above, because this was the only write
        path that had it — profile, admin create/update and CSV import all let
        a duplicate through (BP-04).
        """
        return validate_email_is_unclaimed(value, self.instance)

    def create(self, validated_data):
        # role is always VIEWER on registration — never user-controlled
        validated_data.pop("role", None)
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
            role="VIEWER",  # always VIEWER on self-registration
            first_name=validated_data.get("first_name", ""),
            last_name=validated_data.get("last_name", ""),
        )
        return user


class UserSerializer(serializers.ModelSerializer):
    """The serializer behind `PATCH /auth/profile/` — what a user may change
    about themselves.

    `role` and `tenant` were already locked. `organization` was not, and it is
    a foreign key with no tenant check: measured, a VIEWER could
    `PATCH /auth/profile/ {"organization": <an org belonging to tenant B>}`
    and get 200. Nothing downstream widened that into data access
    (`apps/perm/filters.py` never mentions `organization`, so `DataScopeFilter`
    does not read it), which is why this is a write-integrity hole rather than
    a privilege escalation — but "the field nobody reads today" is not a
    permission model.

    Kept writable rather than made read-only: moving between the organizations
    of one's own tenant is what this field is for. The scoping happens in
    `validate_organization`.
    """

    #: Read-only, same shape as the login payload's `user.tenant` —
    #: the Web re-reads civilization / seal_glyphs here after an admin edit.
    tenant = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "email_verified", "role", "tenant", "first_name", "last_name", "is_active", "display_name", "organization", "position", "mfa_enabled", "mfa_required"]
        read_only_fields = ["id", "is_active", "username", "role"]

    #: 邮箱已验证(官员邮箱重置密码的前提);改邮箱即变回 false。见 `User.email_verified`。
    email_verified = serializers.BooleanField(read_only=True)
    mfa_enabled = serializers.SerializerMethodField()
    mfa_required = serializers.SerializerMethodField()

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

    def validate_organization(self, value):
        """Refuse an organization belonging to somebody else's tenant.

        `PrimaryKeyRelatedField` resolves the FK against the whole table — the
        queryset it builds from the model field has no tenant contextvar and no
        request. So the check has to be here, against the caller's own tenant,
        and it has to read the tenant off the request rather than off
        `self.instance` (a user with no tenant must not be able to claim one by
        way of an organization).
        """
        if value is None:
            return value
        request = self.context.get("request")
        user = getattr(request, "user", None)
        tenant = getattr(request, "tenant", None) or getattr(user, "tenant", None)
        if tenant is None:
            raise serializers.ValidationError(
                "无法确定当前租户,不能设置组织。"
            )
        if value.tenant_id != tenant.id:
            raise serializers.ValidationError(
                f"组织 {value.code} 属于另一个租户,不能挂到当前账号下。"
            )
        return value


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


class UserManagementSerializer(serializers.ModelSerializer):
    """User serializer for list/retrieve operations in user management API."""
    tenant = serializers.SerializerMethodField()
    organization = serializers.SerializerMethodField()
    # 助手管理造的评测官员(apps/soul_assist/eval_identities.py):显示、打「评测专用 · 不能登录」标签
    # (用户 2026-09-29 定)。id 在共用的 context 里缓存,一次请求只查一次。
    is_eval_identity = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'tenant', 'organization', 'position', 'is_active', 'create_time', 'avatar', 'is_eval_identity', 'extra_roles', 'mfa']
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


class UserCreateSerializer(serializers.ModelSerializer):
    """User serializer for creation with password handling.

    Non-ADMIN callers are constrained two ways (see ROLE_HIERARCHY above):
    - `tenant` is forced to the caller's own tenant — a client-supplied
      value for another tenant is rejected rather than silently honored.
    - `role` can never be more privileged than the caller's own role, which
      is what blocks a non-ADMIN from creating an ADMIN account (themselves
      or anyone else).
    ADMIN keeps its existing unrestricted behavior (any tenant, any role).
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
        caller_role = getattr(caller, 'role', None)

        if caller_role != 'ADMIN':
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
            if role_rank(caller_role) > role_rank(target_role):
                raise serializers.ValidationError(
                    {'role': 'Cannot assign a role more privileged than your own.'}
                )

        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


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

    def validate_role(self, value):
        request = self.context.get('request')
        caller = getattr(request, 'user', None) if request is not None else None
        caller_role = getattr(caller, 'role', None)
        if caller_role != 'ADMIN' and role_rank(caller_role) > role_rank(value):
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
    ("no_soul_account", "no soul account has this address"),
    ("ambiguous_email", "several accounts share this address"),
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


class UserImportResultSerializer(serializers.Serializer):
    """`{"created": N, "errors": [...]}` — the CSV import summary.

    Schema-only. `errors` is truncated to the first 50 rows by the view, so an
    empty list means "no failures" but a 50-long list does **not** mean exactly
    fifty; `created` is the only exact figure in this body.
    """

    created = serializers.IntegerField()
    errors = serializers.ListField(child=serializers.CharField())


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
    #: 官员邮件通道(apps/notifications/tasks.py):待你处理的站内通知再发一封到邮箱。
    #: 默认关;开着而账号没有邮箱,什么也不发。
    email_notifications = serializers.BooleanField(required=False, default=False)
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
