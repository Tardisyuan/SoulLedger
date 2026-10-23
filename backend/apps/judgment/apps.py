from django.apps import AppConfig


class JudgmentConfig(AppConfig):
    name = "apps.judgment"

    def ready(self):
        # 删附件行时收文件的 post_delete 接收器。此前只靠 views.py 被 urls 导入才挂上,
        # worker 与 management command 里的级联删会留下孤儿文件。
        from . import attachments  # noqa: F401
