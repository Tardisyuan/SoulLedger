"""Deactivating a user must revoke the WebSocket feed, not only REST.

`rest_framework_simplejwt`'s authentication enforces `CHECK_USER_IS_ACTIVE`
(on by default), so `POST /users/{id}/deactivate/` cut off REST immediately.
`apps.core.ws_auth.JWTAuthMiddleware._authenticate_token` did a bare
`User.objects.get(id=user_id)` and checked nothing.

Measured 2026-08-29: the same token was 401 over HTTP and authenticated fine
over WebSocket. So deactivation left the event feed -- notifications,
dispatch, judgment, workflow -- running for the remainder of the access
token's life, and an already-open socket running indefinitely.

Both halves are asserted. Checking only the refusal would pass against a
middleware that refuses everyone, and the point is that the two transports
give the same answer.
"""
import pytest
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.core.ws_auth import JWTAuthMiddleware
from apps.tenants.models import Tenant

User = get_user_model()


def _token(user, tenant):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    return str(token.access_token)


@pytest.fixture
def tenant(db):
    return Tenant.objects.get_or_create(
        code="DA_WS", defaults={"display_name": "Deactivation"}
    )[0]


#: `transaction=True`,不是普通的 `django_db`。
#:
#: `middleware._authenticate_token` 经 `database_sync_to_async` 跑在**另一个线程、
#: 另一条数据库连接**上。普通 `django_db` 把测试包在一个不提交的事务里 ——
#: 在 PostgreSQL 上那条连接**看不见**本测试刚建的用户,于是认证返回 None,
#: 正对照红。SQLite 内存库共用同一条连接,所以它在本地一直是绿的。
#:
#: 2026-08-31 全量在真 PostgreSQL 上跑时抓到:`assert None is not None`,
#: 报错信息是「an active user was refused」—— 一条**因为环境而红、看起来像产品
#: 缺陷**的失败。它在 SQLite 上通过的理由,在真数据库上不存在。


def _ws_authenticate(raw_token):
    middleware = JWTAuthMiddleware(lambda scope, receive, send: None)
    return async_to_sync(middleware._authenticate_token)(raw_token)


@pytest.mark.django_db(transaction=True)
def test_an_active_user_passes_both(tenant):
    """Positive control, and the one that fails if this becomes deny-all."""
    user = User.objects.create_user(
        username="da_active", password="x", role="VIEWER", tenant=tenant
    )
    raw = _token(user, tenant)

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    assert client.get("/api/v1/souls/").status_code == 200

    assert _ws_authenticate(raw) is not None, "an active user was refused"


@pytest.mark.django_db(transaction=True)
def test_a_deactivated_user_is_refused_by_both(tenant):
    user = User.objects.create_user(
        username="da_inactive", password="x", role="VIEWER", tenant=tenant
    )
    raw = _token(user, tenant)

    # The token was minted while the account was live -- which is the whole
    # situation: deactivation has to take effect on credentials already issued.
    user.is_active = False
    user.save(update_fields=["is_active"])

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    assert client.get("/api/v1/souls/").status_code == 401, (
        "HTTP let a deactivated user in; this test's premise is that it does not"
    )

    assert _ws_authenticate(raw) is None, (
        "WebSocket authenticated a deactivated user. HTTP refuses the same "
        "token, so deactivation revoked REST and left the event feed -- "
        "notifications, dispatch, judgment, workflow -- running."
    )
