from django.contrib import admin

from apps.disposition.models import Disposition


@admin.register(Disposition)
class DispositionAdmin(admin.ModelAdmin):
    list_display = ["soul", "destination_realm", "memory_reset", "is_eternal", "is_executed", "expired_at", "created_at"]
    list_filter = ["memory_reset", "is_eternal", "is_executed"]
    actions = ["run_expiry_check"]

    @admin.action(description="Run the expiry check for the selected rows' tenants")
    def run_expiry_check(self, request, queryset):
        """The daily `disposition.expire_due_for_tenant` job, run now for every
        tenant the selection touches. It checks the whole tenant, not only the
        selected rows — the job has one definition of "due", and a second,
        selection-shaped one would be a place for the two to disagree."""
        from apps.disposition.tasks import expire_due_dispositions_for_tenant

        tenant_ids = queryset.exclude(tenant__isnull=True).values_list("tenant_id", flat=True).distinct()
        total = 0
        for tenant_id in tenant_ids:
            total += expire_due_dispositions_for_tenant(tenant_id=str(tenant_id))["expired"]
        self.message_user(request, f"Expired {total} disposition(s).")
