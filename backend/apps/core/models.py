"""
Core mixins for SoulLedger models.
"""
from django.db import models
from django.utils import timezone

from .request_local import get_current_user
from .soft_delete import SoftDeleteMixin


class AuditUserFields(SoftDeleteMixin, models.Model):
    """
    Adds create_user, create_time, update_user, update_time fields.
    These coexist with any existing created_at/updated_at fields.

    Auto-populates create_user/update_user from the current request context
    (thread-local storage set by PermissionMiddleware).
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
        current_user = get_current_user()

        # Set create_time and create_user on first save
        # Use _state.adding instead of not pk because UUIDs are set at instance creation
        if self._state.adding:
            if not self.create_time:
                self.create_time = timezone.now()
            # Auto-fill create_user from current request context
            if not self.create_user and current_user and current_user.is_authenticated:
                self.create_user = current_user

        # Auto-fill update_user from current request context
        if current_user and current_user.is_authenticated:
            self.update_user = current_user

        # Increment version on every update (optimistic locking)
        if self.pk:
            self.version += 1

        super().save(*args, **kwargs)

    class Meta:
        abstract = True
