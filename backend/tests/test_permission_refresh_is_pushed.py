"""降级 / 撤码后服务端主动推权限刷新(2026-10-29 用户决定第 10 条;rbac-be3 M-1)。

此前握手后的权限集只在**客户端**发 `permission.refresh` 时重算,服务端从不发(全仓 grep 只有消费端):
被降级的人只要不发 refresh,按 `_permission` 门控的事件一直收到。现在:

- 改角色(assign_roles、PATCH role)→ 推给那个人(`push_permission_refresh(user_id)`),连接重算并回一帧;
- 改授予(权限矩阵、分配、导入、权限码增删改,都经 `apps/perm/cache.py` 的失效函数)→ 广播给所有官员连接,
  各自重算,**权限集变了的**才回帧。不断开连接。
"""
import pytest
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.events.realtime import ChannelNaming
from apps.tenants.models import Tenant


@database_sync_to_async
def _token(user, tenant_code):
    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = tenant_code
    return str(refresh.access_token)


@database_sync_to_async
def _world():
    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    judge = User.objects.create_user(username="ws_push_judge", password="x", role="JUDGE", tenant=tenant)
    viewer = User.objects.create_user(username="ws_push_viewer", password="x", role="VIEWER", tenant=tenant)
    admin = User.objects.create_user(username="ws_push_admin", password="x", role="ADMIN", tenant=None)
    return tenant, judge, viewer, admin


async def _connect(user, tenant_code):
    from config.asgi import application

    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={await _token(user, tenant_code)}")
    connected, _ = await comm.connect()
    assert connected
    frame = await comm.receive_json_from(timeout=10)
    assert frame["type"] == "connected"
    return comm, set(frame["permissions"])


@database_sync_to_async
def _api(admin, method, url, body):
    c = APIClient()
    c.force_authenticate(admin)
    return getattr(c, method)(url, body, format="json").status_code


GATED = {"type": "realtime_event", "data": {"_permission": "judgment.execute", "hello": 1}}


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_assigning_a_lower_role_refreshes_the_open_socket_without_closing_it():
    tenant, judge, _viewer, admin = await _world()
    comm, before = await _connect(judge, tenant.code)
    try:
        assert "judgment.execute" in before  # precondition
        assert await _api(admin, "post", f"/api/v1/users/{judge.pk}/assign_roles/", {"role": "VIEWER"}) == 200

        frame = await comm.receive_json_from(timeout=5)
        assert frame["type"] == "permission.refreshed"
        assert "judgment.execute" not in frame["permissions"] and set(frame["permissions"]) < before

        # The server-side gate moved too, with no client message at all; and the socket is still open.
        await get_channel_layer().group_send(ChannelNaming.tenant_group(tenant.code), GATED)
        assert await comm.receive_nothing(timeout=1.5)
        await get_channel_layer().group_send(ChannelNaming.user_group(judge.pk),
                                             {"type": "realtime_event", "data": {"hello": 2}})
        assert (await comm.receive_json_from(timeout=3))["hello"] == 2
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_patching_the_role_refreshes_too():
    tenant, judge, _viewer, admin = await _world()
    comm, _ = await _connect(judge, tenant.code)
    try:
        assert await _api(admin, "patch", f"/api/v1/users/{judge.pk}/", {"role": "VIEWER"}) == 200
        frame = await comm.receive_json_from(timeout=5)
        assert frame["type"] == "permission.refreshed" and "judgment.execute" not in frame["permissions"]
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_grant_change_reaches_holders_of_that_role_and_no_one_else():
    """Revoking a JUDGE grant through the role-permission API: the judge's socket hears it, the viewer's
    (whose set did not change) hears nothing."""
    from apps.perm.models import Permission

    tenant, judge, viewer, admin = await _world()

    @database_sync_to_async
    def grant_one_row_backed_code():
        # transaction=True flushes the seeded rows: give JUDGE one code through a real row.
        from apps.perm.models import Role, RolePermission

        role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "判官"})
        perm, _ = Permission.objects.get_or_create(codename="judgment.execute", defaults={"name": "执行审判", "category": "judgment"})
        RolePermission.objects.get_or_create(role=role, permission=perm)

    await grant_one_row_backed_code()
    j_comm, j_before = await _connect(judge, tenant.code)
    assert "judgment.execute" in j_before
    v_comm, _ = await _connect(viewer, tenant.code)
    try:
        keep = []  # JUDGE keeps only what the dict fallback gives; the one row-backed grant goes
        assert await _api(admin, "post", "/api/v1/perm/role-permissions/assign/",
                          {"role": "JUDGE", "permission_ids": keep}) == 200
        frame = await j_comm.receive_json_from(timeout=5)
        assert frame["type"] == "permission.refreshed" and "judgment.execute" not in frame["permissions"]
        assert await v_comm.receive_nothing(timeout=1.5)
    finally:
        await j_comm.disconnect()
        await v_comm.disconnect()


@pytest.mark.django_db
def test_assign_roles_publishes_after_commit_to_that_user_only(admin_user, django_user_model, cn_tenant,
                                                               django_capture_on_commit_callbacks, monkeypatch):
    """No socket needed: the publish names the user's own group, and only once the role is committed."""
    from apps.events import realtime

    sent = []
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda: type(
        "L", (), {"group_send": staticmethod(_record(sent))})())
    judge = django_user_model.objects.create_user(username="pp_judge", password="x", role="JUDGE", tenant=cn_tenant)
    c = APIClient()
    c.force_authenticate(admin_user)
    with django_capture_on_commit_callbacks(execute=True):
        assert c.post(f"/api/v1/users/{judge.pk}/assign_roles/", {"role": "VIEWER"}, format="json").status_code == 200
    assert (realtime.ChannelNaming.user_group(judge.pk), {"type": "permission_refresh", "targeted": True}) in sent
    sent.clear()
    with django_capture_on_commit_callbacks(execute=True):
        assert c.patch(f"/api/v1/users/{judge.pk}/", {"position": "录事"}, format="json").status_code == 200
    assert not [g for g, _ in sent if g == realtime.ChannelNaming.user_group(judge.pk)]  # no role change, no push


def _record(sent):
    async def group_send(group, message):
        sent.append((group, message))
    return group_send
