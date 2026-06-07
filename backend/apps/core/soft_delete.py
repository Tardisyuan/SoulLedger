"""
Soft delete mixin for SoulLedger models.
Provides safe deletion with audit trail.
"""
from django.conf import settings
from django.db import models
from django.utils import timezone


class SoftDeleteMixin(models.Model):
    """
    Adds soft delete capability to models.
    When deleted, sets is_deleted=True instead of actually deleting.
    """
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="%(class)s_deleted",
        editable=False,
    )
    delete_reason = models.CharField(max_length=500, blank=True)

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False):
        """Override to perform soft delete instead of hard delete."""
        self.soft_delete()

    def soft_delete(self, user=None, reason=""):
        """Mark this record as deleted without actually removing it."""
        self.is_deleted = True
        self.deleted_at = timezone.now()
        if user:
            self.deleted_by = user
        self.delete_reason = reason
        self.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'])

    def restore(self):
        """Restore a soft-deleted record."""
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.delete_reason = ""
        self.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'delete_reason'])
