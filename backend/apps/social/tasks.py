"""朋友圈的定时任务。登记在 apps/scheduler/registry.py,由调度基类记 TaskRun、加锁、告警。"""
from celery import shared_task


@shared_task(name="social.cleanup_orphan_post_media")
def cleanup_orphan_post_media():
    """上传超过 24 小时仍未挂到帖子的图片与无主文件,删掉。与 `manage.py cleanup_orphan_post_media`
    同一个函数。GLOBAL:孤儿图片没有帖子,也就没有租户(租户经帖子);无主文件更没有。"""
    from apps.social.media import cleanup_orphans

    return cleanup_orphans()
