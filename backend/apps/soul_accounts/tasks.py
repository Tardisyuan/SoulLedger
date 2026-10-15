"""灵魂账号的后台任务:个人资料导出的生成,以及它的每日清理。规则在 `data_export.py`。"""
from celery import shared_task


@shared_task(name="soul_accounts.build_data_export")
def build_data_export(export_id):
    """生成一份已排队的导出。申请提交后入队(`data_export.enqueue`);不是 QUEUED 的(重复投递)什么也不做。
    这是一次性任务,不登记在定时表里 —— 没有 beat 它照样跑,只需要 worker。"""
    from apps.soul_accounts import data_export

    export = data_export.build(export_id)
    return {"skipped": True} if export is None else {"status": export.status}


@shared_task(name="soul_accounts.prune_data_exports")
def prune_data_exports():
    """每日:过期的导出文件删掉、行标 EXPIRED;卡住的重新入队 / 标失败。登记在 apps/scheduler/registry.py。
    GLOBAL:`SoulDataExport` 没有租户列(租户经 `soul__home_tenant`),本来就要扫全部。"""
    from apps.soul_accounts import data_export

    return data_export.prune_expired()
