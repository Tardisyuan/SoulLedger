from django.apps import AppConfig


class JudgmentConfig(AppConfig):
    name = "apps.judgment"

    def ready(self):
        from apps.tenants.global_codes import connect_open_case_release

        # 删附件行时收文件的 post_delete 接收器。此前只靠 views.py 被 urls 导入才挂上,
        # worker 与 management command 里的级联删会留下孤儿文件。
        from . import attachments  # noqa: F401

        # 分库第 4 阶段 C:结案(或撤案)的审判在提交后交还它的「一魂一案」认领(apps/tenants/global_codes.py)。
        connect_open_case_release()
