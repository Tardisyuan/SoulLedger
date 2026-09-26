"""
Django admin registrations for Souls app.
"""
from django.contrib import admin, messages

from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord


@admin.register(Soul)
class SoulAdmin(admin.ModelAdmin):
    list_display = ["name", "current_state", "karmic_balance", "death_date", "create_time", "tenant"]
    list_filter = ["current_state", "tenant"]
    search_fields = ["name", "birth_name"]
    readonly_fields = ["id", "karmic_balance", "merit_score", "demerit_score", "create_time", "update_time"]
    ordering = ["-create_time"]

    def save_model(self, request, obj, form, change):
        # 联系邮箱的写者之一:和 apply_contacts 一样同步到本世账号的登录邮箱。
        old_email = Soul.all_objects.filter(pk=obj.pk).values_list("contact_email", flat=True).first() or ""
        super().save_model(request, obj, form, change)
        if "contact_email" in form.changed_data:
            from apps.soul_accounts.services import sync_login_email

            if sync_login_email(obj, old_email) == "taken":
                self.message_user(request, "联系邮箱已被其他账号占用,未同步为登录邮箱;该灵魂只能由官员重置密码。",
                                  level=messages.WARNING)


@admin.register(SoulRecord)
class SoulRecordAdmin(admin.ModelAdmin):
    list_display = ["soul", "record_type", "weight", "recorded_at"]
    list_filter = ["record_type"]
    search_fields = ["soul__name", "description"]
