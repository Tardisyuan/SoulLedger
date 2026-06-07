from django.contrib import admin

from apps.judgment.models import Judgment


@admin.register(Judgment)
class JudgmentAdmin(admin.ModelAdmin):
    list_display = ["soul", "civilization", "court", "verdict", "is_final", "created_at"]
    list_filter = ["civilization", "verdict", "is_final"]
    search_fields = ["soul__name", "court"]
