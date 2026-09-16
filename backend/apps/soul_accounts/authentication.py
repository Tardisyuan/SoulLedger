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


def _parses_as(token_class, raw) -> bool:
    try:
        token_class(raw)
        return True
    except TokenError:
        return False


class OfficerJWTAuthentication(JWTAuthentication):
    """项目默认认证类(`REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES`)。"""

    def get_validated_token(self, raw_token):
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
        return user
