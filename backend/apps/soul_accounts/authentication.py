"""灵魂令牌与官员令牌的分界。

**令牌类型不同,是这条分界的主体。** 灵魂登录签发 `soul_access` / `soul_refresh`,
官员登录签发 simplejwt 默认的 `access` / `refresh`。simplejwt 校验 `token_type`
claim,所以:

* 项目默认认证类只认 `access`,灵魂令牌在类型校验上就被拒;
* `TenantMiddleware`、WebSocket 中间件都用 `AccessToken(...)` 解析,同样拒;
* 官员的 `/auth/refresh/` 用 `RefreshToken`,换不出灵魂令牌,反之亦然。

在此之上,两个认证类把「令牌是真的、只是走错了门」答成 **403** 而不是 401:
401 在 App 与 Web 端都意味着「去刷新 / 重新登录」,而这里不是会话过期,是越界。

第二道(`OfficerJWTAuthentication.get_user`)按 **角色** 挡:即使有人拿到了一张
写着 SOUL 用户 id 的 `access` 型令牌(例如测试里直接 `RefreshToken.for_user`),
官员接口也不认。两道各自有变异测试(tests/test_soul_auth_boundary.py)。
"""
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

SOUL_ROLE = "SOUL"


class SoulAccessToken(AccessToken):
    token_type = "soul_access"


class SoulRefreshToken(RefreshToken):
    token_type = "soul_refresh"
    access_token_class = SoulAccessToken


def session_is_current(token, user) -> bool:
    """官员令牌的 `sv` 声明还等于用户当前的 `session_version`(缺省都按 0)。"""
    from apps.authentication.signin_sessions import is_revoked

    # 另:这台设备在「登录设备」里被退出(`sid` 指向的会话已标 revoked),它的 access 也当场失效。
    return token.get("sv", 0) == getattr(user, "session_version", 0) and not is_revoked(token)


def _parses_as(token_class, raw) -> bool:
    try:
        token_class(raw)
        return True
    except TokenError:
        return False


class OfficerJWTAuthentication(JWTAuthentication):
    """项目默认认证类(`REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES`)。"""

    def authenticate(self, request):
        # `TenantMiddleware` already decoded and verified this header's token with the same class
        # (`AUTH_TOKEN_CLASSES` is AccessToken alone); reuse it instead of decoding it a second time.
        from apps.tenants.middleware import DECODED_ACCESS_ATTR

        self._decoded = getattr(request, DECODED_ACCESS_ATTR, None)
        result = super().authenticate(request)
        if result is not None:
            from apps.authentication import impersonation

            if impersonation.is_impersonation(result[1]):
                impersonation.enforce(request, *result)
            else:
                self._enforce_password_change(request, result[0])
                self._enforce_mfa_setup(request, result[0])
        return result

    @staticmethod
    def _enforce_mfa_setup(request, user):
        """角色要求两步验证而本人没开:只放行设置两步验证、退出、读自己,其余 403 `mfa_setup_required`
        (与上面改密码同一个形状;规则在 `apps/authentication/mfa.py::setup_required`)。"""
        from apps.authentication import mfa

        if (request.method, request.path) in mfa.MFA_SETUP_ALLOWED or not mfa.setup_required(user):
            return
        raise PermissionDenied({"detail": "请先开启两步验证。", "code": "mfa_setup_required"})

    @staticmethod
    def _enforce_password_change(request, user):
        """首次登录 / 管理员重置 / 超期:只放行改密码、退出、读资料,其余 403 `password_change_required`
        (灵魂端 `SoulAPIView` 对 `must_change_password` 的同一个形状)。刷新令牌的接口不经过这里。"""
        from apps.authentication.passwords import PASSWORD_CHANGE_ALLOWED, password_change_required

        if (request.method, request.path) in PASSWORD_CHANGE_ALLOWED or not password_change_required(user):
            return
        raise PermissionDenied({"detail": "请先修改密码。", "code": "password_change_required"})

    def get_validated_token(self, raw_token):
        decoded = getattr(self, "_decoded", None)
        raw = raw_token.decode() if isinstance(raw_token, bytes) else raw_token
        if decoded is not None and decoded[0] == raw:
            return decoded[1]
        try:
            return super().get_validated_token(raw_token)
        except InvalidToken:
            if _parses_as(SoulAccessToken, raw_token):
                raise PermissionDenied("灵魂账号不能访问官员接口。") from None
            raise

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if getattr(user, "role", None) == SOUL_ROLE:
            raise PermissionDenied("灵魂账号不能访问官员接口。")
        # 改密码 / 邮箱重置后 `session_version` 已 +1:更早签发的 access 立刻 401,不等它过期。
        if not session_is_current(validated_token, user):
            raise AuthenticationFailed("登录已失效,请重新登录。", code="session_revoked")
        return user


class SoulJWTAuthentication(JWTAuthentication):
    """只挂在 `/api/v1/me/` 各视图上(`apps/soul_accounts/me_views.py::SoulAPIView`)。"""

    def get_validated_token(self, raw_token):
        try:
            return SoulAccessToken(raw_token)
        except TokenError as exc:
            if _parses_as(AccessToken, raw_token):
                raise PermissionDenied("官员令牌不能访问灵魂接口。") from None
            raise InvalidToken({"detail": str(exc), "code": "token_not_valid"}) from None

    def get_user(self, validated_token):
        # 父类已检查 is_active:转世停用的账号在这里就是 401。
        user = super().get_user(validated_token)
        if getattr(user, "role", None) != SOUL_ROLE:
            raise PermissionDenied("官员账号不能访问灵魂接口。")
        account = getattr(user, "soul_account", None)
        if account is None or account.retired_at is not None:
            raise AuthenticationFailed("账号已停用。", code="account_retired")
        # 官员关闭两步验证、重置密码、改密码、邮箱重置、转世都会 `session_version`+1:更早签发的 access 立刻 401。
        if not session_is_current(validated_token, user):
            raise AuthenticationFailed("登录已失效,请重新登录。", code="session_revoked")
        return user
