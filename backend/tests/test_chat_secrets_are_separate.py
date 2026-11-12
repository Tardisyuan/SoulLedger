"""登录、发言凭据、回调签名各用一把密钥(审计 2026-11-11 A2-07,用户 11-11 定)。

此前三处共用 `MATRIX_JWT_SECRET`:任一份副本泄漏,就既能冒任何灵魂登录 Synapse、又能伪造新消息回调。
现在 `MATRIX_JWT_SECRET`(登录)、`MATRIX_GRANT_SECRET`(`apps/chat/grant.py`)、`MATRIX_HOOK_SECRET`
(`apps/chat/hook.py`)分开;后两项没设时退回 `MATRIX_JWT_SECRET` 并在启动时警告(过渡)。
"""
import jwt
import pytest
from django.apps import apps

from apps.chat import grant, hook
from apps.chat.matrix import login_jwt
from tests.chat_support import PUSH_URL, FakeModuleApi, follow, matrix, mxid, policy, run_coroutine  # noqa: F401
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
HOOK = "/api/v1/chat/hooks/new-message/"
JWT = "jwt-secret-for-tests-0123456789abcdef"
GRANT = "grant-secret-for-tests-0123456789abcdef"
HOOK_SECRET = "hook-secret-for-tests-0123456789abcdef"


@pytest.fixture
def split(settings, matrix):  # noqa: F811
    settings.MATRIX_JWT_SECRET = JWT
    settings.MATRIX_GRANT_SECRET = GRANT
    settings.MATRIX_HOOK_SECRET = HOOK_SECRET
    return settings


def _login_secret_ok(secret):
    try:
        jwt.decode(login_jwt("soul_x"), secret, algorithms=["HS256"], audience="synapse")
    except jwt.InvalidSignatureError:
        return False
    return True


def _hook_status(client, secret):
    body = hook.sign(secret, "!nowhere:x", "$e", "@a:x")
    return client.post(HOOK, body, content_type="application/json").status_code


def _request_grant(cn_tenant, matrix):  # noqa: F811
    """经后端发一条被节流的私聊请求,返回模块会看到的那张发言凭据。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    follow(a, b)
    opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
    assert opened["throttled"] is True
    sent = a_client.post(f"{CONVERSATIONS}{opened['id']}/messages/", {"body": "打扰一下"}, format="json")
    assert sent.status_code == 201, sent.data
    _, message = matrix.sent[-1]
    return opened["room_id"], mxid(a), message["grant"]


def test_each_use_signs_with_its_own_secret(cn_tenant, split, matrix, client):  # noqa: F811
    """变异:`services._send_request` 用回 `MATRIX_JWT_SECRET` 签凭据 → 凭据用 GRANT 验不过,红。
    变异:`ChatPushHookView` 用回 `MATRIX_JWT_SECRET` 验签 → JWT 签的回调被接受、HOOK 签的被拒,红。
    变异:`login_jwt` 改用 `MATRIX_GRANT_SECRET` → 登录凭据用 JWT 验不过,红。"""
    assert _login_secret_ok(JWT) and not _login_secret_ok(GRANT) and not _login_secret_ok(HOOK_SECRET)

    room_id, sender, issued = _request_grant(cn_tenant, matrix)
    assert grant.verify(GRANT, room_id, sender, issued)
    assert not grant.verify(JWT, room_id, sender, issued)

    assert _hook_status(client, HOOK_SECRET) == 200
    assert _hook_status(client, JWT) == 403
    assert _hook_status(client, GRANT) == 403


def test_rotating_one_secret_leaves_the_other_two_working(cn_tenant, split, matrix, client):  # noqa: F811
    """换掉回调那把:回调只认新的;登录与发言凭据照旧。"""
    split.MATRIX_HOOK_SECRET = "hook-secret-rotated-0123456789abcdefgh"
    assert _hook_status(client, "hook-secret-rotated-0123456789abcdefgh") == 200
    assert _hook_status(client, HOOK_SECRET) == 403
    assert _login_secret_ok(JWT)
    room_id, sender, issued = _request_grant(cn_tenant, matrix)
    assert grant.verify(GRANT, room_id, sender, issued)


def test_unset_new_secrets_fall_back_to_the_jwt_secret_and_warn(settings, matrix, client, monkeypatch):  # noqa: F811
    """过渡:115 与现有部署不改配置照常运行,而启动日志说清楚还在共用。
    变异:`hook.secret` 去掉 `or settings.MATRIX_JWT_SECRET` → 回调 503(没有密钥),红。
    变异:`ChatConfig.ready` 去掉警告 → 没有那一行,红。"""
    from apps.chat import apps as chat_apps

    warned = []
    # "apps" logger 不向根传播(settings.LOGGING),caplog 收不到;直接接住这一条。
    monkeypatch.setattr(chat_apps.logger, "warning", lambda msg, *args: warned.append(msg % args))
    settings.MATRIX_GRANT_SECRET = ""
    settings.MATRIX_HOOK_SECRET = ""
    assert grant.secret() == hook.secret() == settings.MATRIX_JWT_SECRET
    assert _hook_status(client, settings.MATRIX_JWT_SECRET) == 200

    apps.get_app_config("chat").ready()
    assert len(warned) == 1 and "MATRIX_HOOK_SECRET、MATRIX_GRANT_SECRET 未设置" in warned[0]

    settings.MATRIX_GRANT_SECRET = GRANT
    settings.MATRIX_HOOK_SECRET = HOOK_SECRET
    apps.get_app_config("chat").ready()
    assert len(warned) == 1


def test_the_module_signs_callbacks_with_hook_secret_and_falls_back_to_grant_secret(split, matrix):  # noqa: F811
    """Synapse 那一侧:回调用 `hook_secret` 签;配置里没写(还没改 homeserver.yaml 的部署)时用 `grant_secret`。
    变异:模块 `_push` 用回 `self._secret` → 第一段红。
    变异:去掉 `config.get("hook_secret") or self._secret` 的退回 → 旧式配置 KeyError / 签空,红。"""
    module, api = policy()  # 不接后端:回调记下 body 后失败,模块吞掉
    run_coroutine(module._push("!r:x", "$e", "@a:x"))
    [(_, body)] = api.posts
    assert hook.verify(HOOK_SECRET, body) and not hook.verify(GRANT, body)

    cls = type(module)
    old_api = FakeModuleApi()
    old_style = cls(cls.parse_config({"service_user": module._service, "grant_secret": GRANT, "push_url": PUSH_URL}),
                    old_api)
    run_coroutine(old_style._push("!r:x", "$e", "@a:x"))
    assert hook.verify(GRANT, old_api.posts[0][1])

    with pytest.raises(ValueError, match="hook_secret"):
        cls.parse_config({"service_user": "@s:x", "grant_secret": GRANT, "hook_secret": "short"})
