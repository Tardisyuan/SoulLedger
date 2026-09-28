from celery import shared_task


@shared_task(name="soul_assist.purge_history")
def purge_history():
    """超过留存期的助手会话真删。登记在 apps/scheduler/registry.py。"""
    from apps.soul_assist import service

    return service.purge_history()
