from celery import shared_task


@shared_task(name="soul_assist.purge_history")
def purge_history():
    """超过留存期的助手会话真删。登记在 apps/scheduler/registry.py。"""
    from apps.soul_assist import service

    return service.purge_history()


@shared_task(name="soul_assist.run_eval")
def run_eval(run_id):
    """管理页的一次评测运行(docs/ARCHITECTURE-assist-admin.md §3.2)。按需触发,不上定时表。"""
    from apps.soul_assist import evals

    return evals.execute(run_id)
