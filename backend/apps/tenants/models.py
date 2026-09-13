from django.db import models

from apps.core.models import AuditUserFields


class Tenant(AuditUserFields, models.Model):
    """A tenant represents a civilization's afterlife system (Chinese Diyu, European Heaven-Hell, Egyptian Duat)."""

    code = models.CharField(max_length=50, unique=True, db_index=True)
    display_name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    settings = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    dispatch_enabled = models.BooleanField(default=False)
    api_endpoint = models.URLField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "Tenant"
        verbose_name_plural = "Tenants"

    def __str__(self):
        return self.code


    # `Notification` (in-app notification for dispatch invitations, judgment
    # results, etc.) lived here — deleted 2026-09-13 (BP-13). It had four
    # writers, all in `apps/dispatch/services.py`, and no reader anywhere in
    # the repository: no serializer, no view, no consumer, no test besides the
    # one that pinned its row count at 0. `apps.notifications.UserNotification`
    # is the model actually served (serializer + viewset + WS consumer + page).
    # See `backend/tests/test_a_dispatch_notification_reaches_a_reader.py` for
    # the incident this model was the cause of, and migration 0010 for the
    # table drop.
