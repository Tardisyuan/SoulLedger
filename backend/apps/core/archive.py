"""
Archive support for judicial-process records.

Stage 4 design (§4.7): reference/config data (menus, roles, workflow
templates) is soft-deletable with a 30-day recycle-bin window and a hard
delete for administrators after that. Domain records that participate in a
judicial process — souls, judgments, dispositions — are different once a
verdict exists: they are not deletable at all, only archivable. Archiving
removes a record from normal lists without pretending the history it
represents can be unwound. Nothing was ever hidden from the record itself,
only from the working views of it, so `unarchive()` (batch 34) only flips the
flag back.

`ArchivableMixin` is deliberately separate from `SoftDeleteMixin`
(soft_delete.py) even though both models normally carry it too — archiving
and soft-deleting are different operations with different reversal stories,
and a record can only ever go through one of them (see `guard_deletion`
below, which is what decides which).
"""
from django.conf import settings
from django.db import models
from django.utils import timezone
from rest_framework import serializers


class ArchivableMixin(models.Model):
    """
    Adds archive capability to judgment-adjacent models (Soul, Judgment,
    Disposition). An archived record is removed from normal lists but is
    never deleted, soft or otherwise — its history stays exactly as it was.
    """
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="%(class)s_archived",
        editable=False,
    )
    archive_reason = models.CharField(max_length=500, blank=True)

    class Meta:
        abstract = True

    def archive(self, user=None, reason=""):
        """Mark this record archived. Does not touch is_deleted — archiving
        and soft-deleting are mutually exclusive outcomes of one delete
        request (see guard_deletion), never both at once."""
        self.is_archived = True
        self.archived_at = timezone.now()
        if user:
            self.archived_by = user
        self.archive_reason = reason
        self.save(update_fields=['is_archived', 'archived_at', 'archived_by', 'archive_reason'])


    def unarchive(self):
        """Undo archive(): the record returns to normal lists. The archive
        columns are cleared (the audit log keeps who archived and why)."""
        self.is_archived = False
        self.archived_at = None
        self.archived_by = None
        self.archive_reason = ""
        self.save(update_fields=['is_archived', 'archived_at', 'archived_by', 'archive_reason'])


class ArchiveSerializerMixin(serializers.Serializer):
    """The four archive columns a detail page needs for its banner. Add
    `ARCHIVE_FIELDS` to the subclass's Meta.fields."""
    archived_by_name = serializers.SerializerMethodField()

    def get_archived_by_name(self, obj) -> str | None:
        user = obj.archived_by
        return None if user is None else (user.display_name or user.username)


ARCHIVE_FIELDS = ["is_archived", "archived_at", "archived_by_name", "archive_reason"]


class DeletionNotAllowedError(Exception):
    """Raised when a record must be archived instead of (soft-)deleted.

    `archivable=True` tells the caller an archive() call is the right
    follow-up rather than a dead end — the record isn't protected outright,
    it just isn't reached through the delete verb once a verdict exists.
    """

    def __init__(self, message, archivable=False):
        super().__init__(message)
        self.archivable = archivable
