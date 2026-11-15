from django.contrib import admin

from apps.judgment.models import Judgment


@admin.register(Judgment)
class JudgmentAdmin(admin.ModelAdmin):
    list_display = ["soul", "civilization", "court", "verdict", "is_final", "created_at"]
    list_filter = ["civilization", "verdict", "is_final"]
    search_fields = ["soul__name", "court"]

    def has_delete_permission(self, request, obj=None):
        # A judgment's delete cascades to its approval workflow, which a rebirth application holds with a
        # bare-id PROTECT since stage 2 (RebirthApplication.appeal_workflow): the admin's confirmation page
        # cannot see that and the delete would 500 (tests/test_bare_ids.py). Same as SoulAdmin.
        return False
