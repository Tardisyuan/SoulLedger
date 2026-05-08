from django.db import models


class Tenant(models.Model):
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
