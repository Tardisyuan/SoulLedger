"""
Core mixins for SoulLedger models.
"""
from django.db import models
from django.utils import timezone

from .soft_delete import SoftDeleteMixin


class AuditUserFields(SoftDeleteMixin, models.Model):
    """
    Adds create_user, create_time, update_user, update_time fields.
    These coexist with any existing created_at/updated_at fields.
    """
    create_user = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        related_name="%(class)s_created",
        null=True,
        blank=True,
        editable=False,
    )
    create_time = models.DateTimeField(
        default=timezone.now,
        editable=False,
    )
    update_user = models.ForeignKey(
        "authentication.User",
        on_delete=models.SET_NULL,
        related_name="%(class)s_updated",
        null=True,
        blank=True,
        editable=False,
    )
    update_time = models.DateTimeField(auto_now=True, editable=False)
    version = models.IntegerField(default=0, editable=False)
    sort_code = models.IntegerField(
        default=0,
        db_index=True,
        help_text="Sort order for admin lists"
    )

    def save(self, *args, **kwargs):
        # Set create_time on first save if not set
        if not self.pk and not self.create_time:
            self.create_time = timezone.now()
        # Increment version on every update (optimistic locking)
        if self.pk:
            self.version += 1
        super().save(*args, **kwargs)

    class Meta:
        abstract = True
        indexes = [
            models.Index(fields=["version"]),
        ]
