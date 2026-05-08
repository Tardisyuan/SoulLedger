"""
Django admin registrations for Souls app.
"""
from django.contrib import admin
from apps.souls.models import Soul
from apps.souls.record_models import SoulRecord


@admin.register(Soul)
class SoulAdmin(admin.ModelAdmin):
    list_display = ["name", "current_state", "karmic_balance", "death_date", "created_at", "tenant"]
    list_filter = ["current_state", "tenant"]
    search_fields = ["name", "birth_name"]
    readonly_fields = ["id", "karmic_balance", "merit_score", "demerit_score", "created_at", "updated_at"]
    ordering = ["-created_at"]


@admin.register(SoulRecord)
class SoulRecordAdmin(admin.ModelAdmin):
    list_display = ["soul", "record_type", "weight", "recorded_at"]
    list_filter = ["record_type"]
    search_fields = ["soul__name", "description"]
