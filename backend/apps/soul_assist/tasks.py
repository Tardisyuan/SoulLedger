from celery import shared_task

from apps.scheduler.registry import time_limits


@shared_task(name="soul_assist.purge_history", **time_limits("soul_assist.purge_history"))
def purge_history():
    """超过留存期的助手会话真删。登记在 apps/scheduler/registry.py。"""
    from apps.soul_assist import service

    return service.purge_history()


# 全局限时 300 s(config/settings.py CELERY_TASK_SOFT_TIME_LIMIT)对它太短:每一问最多 ASSISTANT_TIMEOUT_SECONDS,
# 一次运行是「候选 × 用例」问。一小时是上限,不是估计。
@shared_task(name="soul_assist.run_eval", soft_time_limit=3600, time_limit=3660)
def run_eval(run_id):
    """管理页的一次评测运行(docs/ARCHITECTURE-assist-admin.md §3.2)。按需触发,不上定时表。"""
    from apps.soul_assist import evals

    return evals.execute(run_id)
