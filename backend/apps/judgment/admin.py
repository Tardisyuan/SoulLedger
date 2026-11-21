from django.contrib import admin

from apps.judgment.models import Judgment


@admin.register(Judgment)
class JudgmentAdmin(admin.ModelAdmin):
    list_display = ["soul", "civilization", "court", "verdict", "is_final", "created_at"]
    list_filter = ["civilization", "verdict", "is_final"]
    search_fields = ["soul__name", "court"]
    # 裁决只经 `conclude/` 写,归档只经 `archive/`(只收有裁决的):这里可写的话,超级用户能做出「已归档的未结案件」,
    # 「未结」判断(`OPEN_Q`)不看 `is_archived` 的前提就不成立(审计 2026-11-20 §4 #3)。
    readonly_fields = ["verdict", "is_final", "is_archived", "archived_at", "archived_by", "archive_reason"]

    def has_delete_permission(self, request, obj=None):
        # A judgment's delete cascades to its approval workflow, which a rebirth application holds with a
        # bare-id PROTECT since stage 2 (RebirthApplication.appeal_workflow): the admin's confirmation page
        # cannot see that and the delete would 500 (tests/test_bare_ids.py). Same as SoulAdmin.
        return False
