"""Channel naming for the realtime layer.

WHAT WAS HERE. `RealtimeEventPublisher`, a "backward-compatible facade" whose
five static methods each forwarded straight to `event_bus`, and which its own
docstring marked Deprecated. Excluding comments and docstrings it had **zero**
production callers and three test files; a naive `grep -rl` reported six
production files, every one of which merely mentioned it in prose explaining
the design.

It was not inert. `apps/workflow/services.py:564` records the incident it
belongs to: `RealtimeEventPublisher.publish_workflow` and
`event_bus.publish_workflow` both had no callers, workflow events never reached
`SoulEvent`, and six tests calling those functions directly stayed green the
whole time. A second, callable, equivalent way to publish is how that happens
twice — so the facade went and `event_bus` is now the only door.

Channel naming convention (unchanged):
  rt:tenant:{code}    — tenant-wide broadcast (all users in tenant)
  rt:user:{user_id}   — per-user targeted delivery
"""
import logging

logger = logging.getLogger(__name__)




class ChannelNaming:
    """
    Standardized channel naming conventions.

    Groups:
      rt_tenant_{code}   — all users in a tenant
      rt_user_{user_id}  — single user

    Note: Channel layer group names must be ASCII alphanumerics, hyphens,
    underscores, or periods (no colons allowed).
    """

    @staticmethod
    def tenant_group(tenant_code: str) -> str:
        """Channel group name for tenant-wide broadcast."""
        return f"rt_tenant_{tenant_code}"

    @staticmethod
    def user_group(user_id: int) -> str:
        """Channel group name for per-user delivery."""
        return f"rt_user_{user_id}"

    #: Every officer socket, whatever its hall: what a grant change is broadcast to (`push_permission_refresh`).
    OFFICERS_GROUP = "rt_officers"


# 服务端因「登录已结束」主动关闭 socket 用的关闭码。**不是 4001**:4001 是「你的令牌不行」,
# 客户端不重连;这条要客户端带着(可能已换新的)令牌重连 —— 当前设备拿到新令牌就连得上,
# 被踢的设备重连被握手拒绝(4001),随后走「登录已失效」。见 packages/core/src/ws/client.ts。
WS_CLOSE_SESSION_ENDED = 4002


def close_user_sockets(user_id: int, min_version: int | None = None) -> None:
    """事务提交后,关闭该用户所有「过时」的实时连接。

    `min_version`:`User.session_version` 的新值 —— 握手时版本低于它的连接关闭(改密码、邮箱重置);
    `None` 表示该用户的全部连接都关(停用账号)。发送失败不影响业务。
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    from django.db import transaction

    def _send():
        try:
            async_to_sync(get_channel_layer().group_send)(
                ChannelNaming.user_group(user_id),
                {"type": "session_ended", "min_version": min_version},
            )
        except Exception:
            logger.warning("close_user_sockets: publish failed for user %s", user_id, exc_info=True)

    transaction.on_commit(_send)


def push_permission_refresh(user_id: int | None = None) -> None:
    """事务提交后,让已开的实时连接按此刻的角色与授予重算权限集(第 10 条 / M-1,不断开)。

    `user_id`:这个人的角色变了(改角色、兼任) —— 他的每个连接重算并回一帧 `permission.refreshed`。
    `None`:角色的授予变了(权限矩阵、分配、导入、权限码增删改,经 `apps/perm/cache.py` 的失效函数) ——
    广播给所有官员连接,各连接自己重算,**只有权限集真的变了**才回帧(持该角色或兼任它的人)。
    前端收到那一帧就重取本人权限(`TenantContext.refreshFromServer`)。发送失败不影响业务。
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    from django.db import transaction

    group = ChannelNaming.user_group(user_id) if user_id is not None else ChannelNaming.OFFICERS_GROUP

    def _send():
        try:
            async_to_sync(get_channel_layer().group_send)(
                group, {"type": "permission_refresh", "targeted": user_id is not None},
            )
        except Exception:
            logger.warning("push_permission_refresh: publish failed for %s", group, exc_info=True)

    try:
        transaction.on_commit(_send)
    except Exception:
        # No database to wait on (a cache flush outside any request, e.g. the test suite's per-test reset of the
        # permission cache): nothing was committed, so nobody's permissions changed and there is nothing to push.
        logger.debug("push_permission_refresh: no transaction to wait on; skipped", exc_info=True)
