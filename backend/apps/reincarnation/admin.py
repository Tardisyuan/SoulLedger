from django.contrib import admin

from apps.reincarnation.models import Reincarnation


@admin.register(Reincarnation)
class ReincarnationAdmin(admin.ModelAdmin):
    list_display = ["soul", "target_realm", "rebirth_form", "cycle_count", "reincarnated_at"]
    list_filter = ["rebirth_form", "cycle_count"]
