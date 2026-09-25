from django.apps import AppConfig


class DispatchConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.dispatch"
    verbose_name = "Dispatch"

    def ready(self):
        # 放弃的调拨草稿进全局回收站(设计稿「放弃…」:草稿会移入回收站)。只列草稿:
        # 其余状态的调拨记录是审批流的一部分,删除照旧、不进回收站。"reference" 与朋友圈
        # 被删帖同一类 —— 可恢复,30 天后可永久删除;草稿不是审判记录。
        from django.db.models import Q

        from apps.core.recycle_bin import register_bin_type
        from apps.souls.models import TENANT_CIVILIZATION

        from .models import DispatchRecord, DispatchStatus

        def label(record):
            soul = record.soul.name if record.soul_id else "—"
            target = record.target_tenant.code if record.target_tenant_id else "—"
            return f"{soul} → {target}"

        def location(record):
            civilization = TENANT_CIVILIZATION.get(record.source_tenant.code)
            return {"kind": "civilization", "value": civilization} if civilization else None

        register_bin_type(
            "dispatch_draft", DispatchRecord, "reference", label,
            listable=Q(status=DispatchStatus.DRAFT), location=location,
        )
