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
    #: 殿司展示名:灵魂写信的收件方在 App 与官员收件箱里叫什么(如「第五殿」)。与 `display_name`
    #: 分开 —— 那一个是租户的管理名(「Chinese Afterlife」),不是灵魂认得的殿名。三语各一份;
    #: 空着就退回 zh,再退回 `display_name`(`hall_names`)。四文明的默认值与出处见 tenants/0012。
    hall_name = models.CharField(max_length=60, blank=True, default="", help_text="殿司展示名(简体中文)")
    hall_name_en = models.CharField(max_length=80, blank=True, default="", help_text="殿司展示名(English)")
    hall_name_egy = models.CharField(max_length=80, blank=True, default="", help_text="殿司展示名(egy)")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "Tenant"
        verbose_name_plural = "Tenants"

    def __str__(self):
        return self.code

    @property
    def hall_names(self):
        """{locale: 殿司展示名},键与 App 的三个语言包同名。空的退回 zh,再退回 `display_name`。"""
        zh = self.hall_name or self.display_name
        return {"zh-Hans": zh, "en": self.hall_name_en or zh, "egy": self.hall_name_egy or zh}


    # `Notification` (in-app notification for dispatch invitations, judgment
    # results, etc.) lived here — deleted 2026-09-13 (BP-13). It had four
    # writers, all in `apps/dispatch/services.py`, and no reader anywhere in
    # the repository: no serializer, no view, no consumer, no test besides the
    # one that pinned its row count at 0. `apps.notifications.UserNotification`
    # is the model actually served (serializer + viewset + WS consumer + page).
    # See `backend/tests/test_a_dispatch_notification_reaches_a_reader.py` for
    # the incident this model was the cause of, and migration 0010 for the
    # table drop.
