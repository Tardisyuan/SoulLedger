"""
Soft delete mixin for SoulLedger models.
Provides safe deletion with audit trail.
"""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class SoftDeleteQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(is_deleted=False)

    def dead(self):
        return self.filter(is_deleted=True)


class SoftDeleteManager(models.Manager):
    """Default manager for soft-deletable models — excludes is_deleted=True."""

    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db).filter(is_deleted=False)


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
    # Written on every row a single delete operation touches — the row the
    # user directly targeted and every dependent row cascaded alongside it
    # (see apps.core.recycle_bin.cascade_soft_delete). A shared id rather than
    # just comparing deleted_at timestamps, because two rows deleted
    # separately but in the same second are not the same delete, and a
    # dependent deleted on its own last week must not be swept up when its
    # parent is restored today. NULL for a row that was never part of a
    # cascaded delete (deleted directly, or never deleted at all).
    delete_cascade_id = models.UUIDField(null=True, blank=True, db_index=True)

    # Declaration order matters: Django uses the FIRST manager declared as
    # _base_manager (used internally for refresh_from_db(), etc). Keep the
    # unfiltered manager first so those internal operations can still see
    # soft-deleted rows; `.objects` (filtered) remains the one application
    # code and DRF ViewSets use for normal queries.
    all_objects = models.Manager()  # unfiltered — includes soft-deleted records
    objects = SoftDeleteManager()

    class Meta:
        abstract = True

    def delete(self, using=None, keep_parents=False):
        """Override to perform soft delete instead of hard delete."""
        self.soft_delete()

    def soft_delete(self, user=None, reason="", cascade_id=None):
        """Mark this record as deleted without actually removing it.

        `cascade_id` ties this row to every other row a single delete
        operation touches — pass the same uuid to every dependent row so
        restore_cascade() (apps.core.recycle_bin) can reverse exactly that
        set later, and the recycle bin can count them as one entry rather
        than several. Defaults to a fresh id for a standalone delete with no
        dependents, so `delete_cascade_id` is never left NULL on a row that
        went through this path — a NULL would be unrestorable by cascade and
        unlistable as its own bin entry.
        """
        self.is_deleted = True
        self.deleted_at = timezone.now()
        if user:
            self.deleted_by = user
        self.delete_reason = reason
        self.delete_cascade_id = cascade_id or uuid.uuid4()
        self.save(update_fields=[
            'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason', 'delete_cascade_id',
        ])

    def restore(self):
        """Restore a soft-deleted record."""
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.delete_reason = ""
        self.delete_cascade_id = None
        self.save(update_fields=[
            'is_deleted', 'deleted_at', 'deleted_by', 'delete_reason', 'delete_cascade_id',
        ])
