from django.contrib import admin
from apps.disposition.models import Disposition


@admin.register(Disposition)
class DispositionAdmin(admin.ModelAdmin):
    list_display = ["soul", "destination_realm", "memory_reset", "is_eternal", "is_executed", "created_at"]
    list_filter = ["memory_reset", "is_eternal", "is_executed"]
