"""后端与 Synapse 之间的唯一一层。除这个文件外没有代码发 HTTP 到 Synapse。

**两种身份,两种用途:**

* **服务账号**(`MATRIX_SERVICE_LOCALPART`)是 admin,**每一个房间都由它创建**。
  Synapse 侧 `config/synapse/soulledger_policy.py` 拒绝其他任何本地用户建房、邀请、
  建别名、发状态事件 —— 于是「房间只能经后端创建」不是一条约定,是服务端的拒绝。
* **灵魂本人**:后端偶尔代其发言(被节流的私聊请求)。**不用管理 API 冒充**,而是用
  后端自己签的 JWT 正常登录一次 —— 登录凭据的签发者本来就是后端,这条路没有额外权力,
  发出的消息 sender 也是灵魂自己而不是服务账号。

**启动自举**:服务账号用 `registration_shared_secret` 注册成 admin 一次
(`/_synapse/admin/v1/register`),之后一律 JWT 登录。所以除了 compose 里的两个密钥,
运维不需要手工建任何账号。access token 存 Django 缓存(生产是 Redis,多进程共用一张)。

密码从不在这条路径上出现:注册时那一次是随机的、用完即弃,此后没有任何地方需要它
(homeserver 模板里 `password_config.enabled: false`)。
"""
import hashlib
import hmac
import logging
import secrets
import time
import uuid

import jwt
import requests
from django.conf import settings
from django.core.cache import cache
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)

#: 一次请求最多等多久。Synapse 建房会写好几条事件,比读慢。
TIMEOUT = (5, 20)
#: access token 在 Synapse 里不过期;缓存只是为了少一次登录往返,过期了重新登录即可。
TOKEN_CACHE_SECONDS = 3600
ADMIN_TOKEN_KEY = "chat:matrix:admin_token"


class MatrixError(Exception):
    """Synapse 拒绝了,或者根本没答。`errcode` 是 Matrix 的 M_* 码(连不上时为空)。"""

    def __init__(self, message, *, errcode="", status=0):
        super().__init__(message)
        self.errcode = errcode
        self.status = status


class MatrixNotConfigured(MatrixError):
    """聊天没打开或缺密钥。视图把它答成 503,而不是 500 —— 这不是故障,是没部署。"""


def login_jwt(localpart, *, ttl=None):
    """给 `localpart` 签一张 Synapse 认的登录凭据。

    这是 **App 拿到的那张**,也是后端自己代发消息时用的那张。有效期短到只够一次登录
    往返:它等价于该灵魂的聊天身份,转手给别人就是转手了账号。
    """
    now = int(time.time())
    return jwt.encode(
        {
            "sub": localpart,
            "iss": "soulledger",
            "aud": "synapse",
            "iat": now,
            "exp": now + (ttl if ttl is not None else settings.MATRIX_LOGIN_TOKEN_TTL_SECONDS),
        },
        settings.MATRIX_JWT_SECRET,
        algorithm="HS256",
    )


class SynapseClient:
    """真实实现。测试走 `settings.MATRIX_CLIENT` 换成假的,于是单元测试一条 HTTP 都不发。"""

    def __init__(self):
        missing = [
            name for name in (
                "MATRIX_INTERNAL_URL", "MATRIX_PUBLIC_BASEURL", "MATRIX_SERVER_NAME",
                "MATRIX_JWT_SECRET", "MATRIX_REGISTRATION_SHARED_SECRET", "MATRIX_USER_SALT",
            ) if not getattr(settings, name, "")
        ]
        if missing:
            raise MatrixNotConfigured(f"聊天未配置:缺 {', '.join(missing)}")
        self.base = settings.MATRIX_INTERNAL_URL.rstrip("/")
        self.server_name = settings.MATRIX_SERVER_NAME
        self.service_user = f"@{settings.MATRIX_SERVICE_LOCALPART}:{self.server_name}"
        self._session = requests.Session()

    # ── 底层 ──────────────────────────────────────────────────────────────

    def _request(self, method, path, *, token=None, json=None, params=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            response = self._session.request(
                method, f"{self.base}{path}", headers=headers, json=json, params=params, timeout=TIMEOUT
            )
        except requests.RequestException as exc:
            raise MatrixError(f"Synapse 无法访问:{type(exc).__name__}") from exc
        if response.status_code >= 400:
            try:
                body = response.json()
            except ValueError:
                body = {}
            raise MatrixError(
                body.get("error", response.text[:200]),
                errcode=body.get("errcode", ""),
                status=response.status_code,
            )
        return response.json() if response.content else {}

    def _token_for(self, localpart):
        key = f"chat:matrix:token:{localpart}"
        token = cache.get(key)
        if token:
            return token
        data = self._request(
            "POST", "/_matrix/client/v3/login",
            json={"type": "org.matrix.login.jwt", "token": login_jwt(localpart, ttl=60)},
        )
        cache.set(key, data["access_token"], TOKEN_CACHE_SECONDS)
        return data["access_token"]

    def _admin_token(self):
        token = cache.get(ADMIN_TOKEN_KEY)
        if token:
            return token
        localpart = settings.MATRIX_SERVICE_LOCALPART
        try:
            nonce = self._request("GET", "/_synapse/admin/v1/register")["nonce"]
            password = secrets.token_urlsafe(32)
            mac = hmac.new(
                settings.MATRIX_REGISTRATION_SHARED_SECRET.encode(),
                b"\x00".join([nonce.encode(), localpart.encode(), password.encode(), b"admin"]),
                hashlib.sha1,
            ).hexdigest()
            data = self._request("POST", "/_synapse/admin/v1/register", json={
                "nonce": nonce, "username": localpart, "password": password,
                "admin": True, "mac": mac,
            })
            token = data["access_token"]
        except MatrixError as exc:
            # 已经建过了 —— 正常路径,不是错误。此后走 JWT 登录。
            if exc.errcode not in ("M_USER_IN_USE", "M_EXCLUSIVE"):
                raise
            token = self._token_for(localpart)
        cache.set(ADMIN_TOKEN_KEY, token, TOKEN_CACHE_SECONDS)
        return token

    def _admin(self, method, path, **kwargs):
        return self._request(method, path, token=self._admin_token(), **kwargs)

    # ── 用户 ──────────────────────────────────────────────────────────────

    def user_id(self, localpart):
        return f"@{localpart}:{self.server_name}"

    def ensure_user(self, localpart, displayname):
        """幂等。已存在就只更新显示名并确保未停用。"""
        self._admin("PUT", f"/_synapse/admin/v2/users/{self.user_id(localpart)}",
                    json={"displayname": displayname, "deactivated": False})
        return self.user_id(localpart)

    def deactivate_user(self, localpart):
        """停用并踢出所有房间。`erase: false` —— 历史留给审核,不抹掉别人的会话。

        Synapse 的 deactivate 本身就会让该用户离开所有房间,所以「踢出房间」不是
        另一步:它是这一步的一部分(集成测试断言了这件事)。
        """
        self._admin("POST", f"/_synapse/admin/v1/deactivate/{self.user_id(localpart)}",
                    json={"erase": False})

    # ── 房间 ──────────────────────────────────────────────────────────────

    def create_room(self, *, name, power_levels):
        data = self._admin("POST", "/_matrix/client/v3/createRoom", json={
            "name": name,
            "preset": "private_chat",
            "visibility": "private",
            "power_level_content_override": power_levels,
            # 不带 initial invite:成员由 force_join 直接加进来(见 services.py)。
            "creation_content": {"m.federate": False},
        })
        return data["room_id"]

    def force_join(self, room_id, user_id):
        self._admin("POST", f"/_synapse/admin/v1/join/{room_id}", json={"user_id": user_id})

    def set_power_level(self, room_id, user_id, level):
        content = self._admin("GET", f"/_matrix/client/v3/rooms/{room_id}/state/m.room.power_levels")
        content.setdefault("users", {})[user_id] = level
        self._admin("PUT", f"/_matrix/client/v3/rooms/{room_id}/state/m.room.power_levels", json=content)

    def send_message(self, room_id, body, *, as_localpart, extra=None):
        token = self._token_for(as_localpart)
        content = {"msgtype": "m.text", "body": body, **(extra or {})}
        data = self._request(
            "PUT", f"/_matrix/client/v3/rooms/{room_id}/send/m.room.message/{uuid.uuid4().hex}",
            token=token, json=content,
        )
        return data["event_id"]

    def recent_messages(self, room_id, *, limit=50):
        """最近的消息,新的在前。官员收件箱读的就是这条;判断「对方回过话没有」也是。"""
        data = self._admin("GET", f"/_matrix/client/v3/rooms/{room_id}/messages",
                           params={"dir": "b", "limit": limit})
        return [
            {
                "event_id": event["event_id"],
                "sender": event["sender"],
                "body": event.get("content", {}).get("body", ""),
                "officer": event.get("content", {}).get("io.soulledger.officer", ""),
                "timestamp": event["origin_server_ts"],
            }
            for event in data.get("chunk", [])
            if event.get("type") == "m.room.message"
        ]


def get_client():
    """`settings.MATRIX_CLIENT` 指向的实现。关掉聊天时抛 `MatrixNotConfigured`。"""
    if not settings.MATRIX_ENABLED:
        raise MatrixNotConfigured("聊天未启用(MATRIX_ENABLED)。")
    return import_string(settings.MATRIX_CLIENT)()
