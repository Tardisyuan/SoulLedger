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


# ── 发信(perf-audit A4,2026-10-30):请求只入队,SMTP 在 worker 里;消息里只有账号 / 凭据的 id ──────────


@shared_task(name="soul_accounts.send_contact_email_code")
def send_contact_email_code(account_id):
    """改联系邮箱的验证码:码与新地址从缓存读(`contact_email._keys`),不进 broker。"""
    from apps.soul_accounts import contact_email

    return contact_email.send_pending_code(account_id)


@shared_task(name="soul_accounts.send_contact_email_changed")
def send_contact_email_changed(account_id):
    """改好之后通知旧邮箱;旧地址与打码的新地址在缓存里(确认那一步写的)。"""
    from apps.soul_accounts import contact_email

    return contact_email.send_changed_notice(account_id)


@shared_task(name="soul_accounts.send_credential")
def send_credential(credential_id):
    """初始密码:明文在库里那一行(加密列),按 id 取。失败照旧记成待交付(`services.send_credential`)。"""
    from apps.soul_accounts import services

    credential = services.send_credential(credential_id)
    return None if credential is None else credential.status
