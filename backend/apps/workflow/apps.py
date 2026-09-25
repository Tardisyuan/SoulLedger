from django.apps import AppConfig


class WorkflowConfig(AppConfig):
    name = "apps.workflow"

    def ready(self):
        # 删除的审批流模板进全局回收站(维护者决定,2026-09-25),与菜单、角色同属
        # "reference":可恢复,30 天后可永久删除。恢复时引用的角色已不存在则拒绝 ——
        # 那道检查注册在 apps/perm/apps.py(`template_role_missing`)。
        from apps.core.recycle_bin import register_bin_type

        from .models import WorkflowTemplate

        register_bin_type(
            "workflow_template", WorkflowTemplate, "reference", lambda tpl: tpl.name,
            location=lambda tpl: {"kind": "civilization", "value": tpl.civilization},
        )
