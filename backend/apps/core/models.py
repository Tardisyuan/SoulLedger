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
    — a `contextvar` (`apps/core/request_local.py`), not thread-local, and set
    by `AuditUserViewSetMixin` (`apps/core/viewsets.py`), not by middleware.
    The HTTP `PermissionMiddleware` this docstring used to name was deleted on
    2026-08-28; it had never set anything here.

    **So a viewset that does not carry that mixin writes rows with
    `create_user = None`** — measured on eight of them 2026-08-29. That is
    what `tests/test_every_writable_audit_viewset_sets_the_user.py` now walks
    the real URLconf to prevent.
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

        # A partial save persists the bookkeeping too (2026-10-30). Before, `save(update_fields=[...])` bumped
        # `version` and set `update_user` in memory only and left `update_time` as it was, so e.g. a role
        # relabelled by `perm/export.py` kept its optimistic-lock version, and callers had to remember to list
        # the three themselves (judgment kept three copies of that list). An empty list stays a no-op.
        update_fields = kwargs.get("update_fields")
        if update_fields:
            own = {f.name for f in self._meta.concrete_fields}
            kwargs["update_fields"] = {*update_fields, *(n for n in self.BOOKKEEPING_FIELDS if n in own)}

        super().save(*args, **kwargs)

    #: Written by every save, partial saves included.
    BOOKKEEPING_FIELDS = ("version", "update_user", "update_time")

    class Meta:
        abstract = True
