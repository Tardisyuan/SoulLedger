"""书信的定时任务。登记在 apps/scheduler/registry.py,由调度基类记 TaskRun、加锁、告警。"""
from celery import shared_task


class InboxReconcileError(Exception):
    """有房间读不到 —— 让这次运行记 FAILURE 并告警。"""


@shared_task(name="chat.reconcile_inbox")
def reconcile_inbox():
    """每天把殿司收件箱的「谁最后说话」按 Synapse 对一遍(`services.reconcile_all_inboxes`)。

    聊天没配置(`MATRIX_ENABLED` 关着 —— 测试里、115 上都是)不是故障:什么也不做,返回
    `skipped`,于是这次运行记 SUCCESS、不告警。Synapse 配了却连不上、或有房间读不到,才是失败。
    """
    from apps.chat import services
    from apps.chat.matrix import MatrixNotConfiguredError, get_client

    try:
        client = get_client()
    except MatrixNotConfiguredError:
        return {"skipped": "chat_not_configured"}
    done, failed = services.reconcile_all_inboxes(client)
    if failed:
        sample = "; ".join(f"{room}: {err}" for room, err in list(failed.items())[:5])
        raise InboxReconcileError(f"{len(failed)} of {done + len(failed)} inbox room(s) unreadable: {sample}")
    return {"reconciled": done}
