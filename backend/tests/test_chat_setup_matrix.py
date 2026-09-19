"""`manage.py setup_matrix`:服务账号注册成 admin + 免限速,幂等。

测的是真 `SynapseClient`,只把 HTTP 那一层(`_request`)换成**照 Synapse 规矩拒绝**的替身:
共享密钥注册校验 HMAC、同名二次注册答 `M_USER_IN_USE`、admin API 只认 admin 的 token ——
与 2026-09-19 对真 Synapse v1.161(本机,见 test_chat_synapse_integration.py 文件头)跑同一条
命令时看到的一致。
"""
import hashlib
import hmac
import secrets

import jwt
import pytest
from django.core.cache import cache
from django.core.management import CommandError, call_command

from apps.chat.matrix import MatrixError, SynapseClient

SHARED = "shared-secret-for-tests"
JWT_SECRET = "jwt-secret-for-tests-0123456789abcdef"


class SynapseLike:
    """够 setup_matrix 用的那几条端点,按 Synapse 的规矩答。"""

    def __init__(self):
        self.users = {}      # mxid -> {"admin": bool}
        self.tokens = {}     # token -> mxid
        self.nonces = set()
        self.overrides = {}  # mxid -> body

    def _issue(self, mxid):
        token = secrets.token_hex(8)
        self.tokens[token] = mxid
        return token

    def __call__(self, method, path, *, token=None, json=None, params=None):
        if path == "/_synapse/admin/v1/register" and method == "GET":
            nonce = secrets.token_hex(8)
            self.nonces.add(nonce)
            return {"nonce": nonce}
        if path == "/_synapse/admin/v1/register":
            if json["nonce"] not in self.nonces:
                raise MatrixError("unrecognised nonce", errcode="M_UNKNOWN", status=400)
            self.nonces.discard(json["nonce"])
            mac = hmac.new(SHARED.encode(), b"\x00".join([
                json["nonce"].encode(), json["username"].encode(), json["password"].encode(),
                b"admin" if json["admin"] else b"notadmin"]), hashlib.sha1).hexdigest()
            if not hmac.compare_digest(mac, json["mac"]):
                raise MatrixError("HMAC incorrect", errcode="M_FORBIDDEN", status=403)
            mxid = f"@{json['username']}:x"
            if mxid in self.users:
                raise MatrixError("User ID already taken.", errcode="M_USER_IN_USE", status=400)
            self.users[mxid] = {"admin": json["admin"]}
            return {"user_id": mxid, "access_token": self._issue(mxid)}
        if path == "/_matrix/client/v3/login":
            claims = jwt.decode(json["token"], JWT_SECRET, algorithms=["HS256"], audience="synapse")
            mxid = f"@{claims['sub']}:x"
            self.users.setdefault(mxid, {"admin": False})
            return {"user_id": mxid, "access_token": self._issue(mxid)}
        if path.startswith("/_synapse/admin/"):
            caller = self.tokens.get(token)
            if caller is None:
                raise MatrixError("Missing access token", errcode="M_MISSING_TOKEN", status=401)
            if not self.users[caller]["admin"]:
                raise MatrixError("You are not a server admin", errcode="M_FORBIDDEN", status=403)
            target = path.split("/users/")[1].rsplit("/override_ratelimit", 1)[0]
            if target not in self.users:
                raise MatrixError("User not found", errcode="M_NOT_FOUND", status=404)
            self.overrides[target] = json
            return json
        raise AssertionError(f"unexpected {method} {path}")


@pytest.fixture
def synapse(settings, monkeypatch):
    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = "apps.chat.matrix.SynapseClient"
    settings.MATRIX_INTERNAL_URL = "http://synapse.invalid"
    settings.MATRIX_PUBLIC_BASEURL = "https://matrix.invalid/"
    settings.MATRIX_SERVER_NAME = "x"
    settings.MATRIX_JWT_SECRET = JWT_SECRET
    settings.MATRIX_REGISTRATION_SHARED_SECRET = SHARED
    settings.MATRIX_USER_SALT = "salt"
    settings.MATRIX_SERVICE_LOCALPART = "soulledger"
    server = SynapseLike()
    monkeypatch.setattr(SynapseClient, "_request", lambda self, *a, **kw: server(*a, **kw))
    cache.clear()
    yield server
    cache.clear()


def test_first_run_registers_an_admin_and_lifts_its_ratelimit(synapse, capsys):
    """变异:去掉 setup_service_account 里的 override_ratelimit → overrides 为空,红。"""
    call_command("setup_matrix")
    assert synapse.users == {"@soulledger:x": {"admin": True}}
    assert synapse.overrides == {"@soulledger:x": {"messages_per_second": 0, "burst_count": 0}}
    assert "@soulledger:x" in capsys.readouterr().out


def test_rerun_is_harmless(synapse):
    """第二次(缓存已空,如重启后):注册答 M_USER_IN_USE,改走 JWT 登录,仍是 admin,照样成功。"""
    call_command("setup_matrix")
    cache.clear()
    synapse.overrides.clear()
    call_command("setup_matrix")
    assert synapse.users == {"@soulledger:x": {"admin": True}}
    assert "@soulledger:x" in synapse.overrides


def test_wrong_shared_secret_fails_loudly(synapse, settings):
    settings.MATRIX_REGISTRATION_SHARED_SECRET = "not-the-one-synapse-has"
    with pytest.raises(CommandError, match="M_FORBIDDEN"):
        call_command("setup_matrix")
    assert synapse.users == {} and synapse.overrides == {}


def test_chat_disabled_is_a_command_error_not_a_traceback(synapse, settings):
    settings.MATRIX_ENABLED = False
    with pytest.raises(CommandError, match="MATRIX_ENABLED"):
        call_command("setup_matrix")
