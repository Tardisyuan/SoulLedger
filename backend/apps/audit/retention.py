"""Retention for `AuditLog` and `LoginLog`: delete rows older than N days, in batches.

Both windows default to 0 = keep forever (settings `AUDIT_LOG_RETENTION_DAYS`,
`LOGIN_LOG_RETENTION_DAYS`), so installing this deletes nothing until someone
sets a number. Each run that deletes something leaves one `AuditLog` row
(resource `audit_retention`) saying how many rows, which tenant and the cutoff.

Tenant scope: `AuditLog` has a `tenant` column. `LoginLog` has none, so its
tenant is the user's (`user__tenant`). Rows that belong to no tenant -- audit
rows with `tenant=NULL`, login rows with no user (failed attempts on an unknown
username, soul logins) or a tenant-less user -- are swept by the GLOBAL job
(`tenant=None`), never by a tenant's job.

Deletes go through `_raw_delete`: `QuerySet.delete()` would send one
`post_delete` per row, and `LoginLog` is an audited model, so pruning N login
rows would write N new audit rows. Neither model has anything cascading from it.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

BATCH_SIZE = 5000


def _days(name: str) -> int:
    return max(int(getattr(settings, name, 0) or 0), 0)


def _purge(queryset, batch_size: int) -> int:
    deleted = 0
    while True:
        pks = list(queryset.order_by("pk").values_list("pk", flat=True)[:batch_size])
        if not pks:
            return deleted
        # Each batch is its own statement/transaction: no long lock on a large backlog.
        deleted += queryset.filter(pk__in=pks)._raw_delete(queryset.db)


def prune_logs(tenant=None, *, now=None, batch_size: int = BATCH_SIZE) -> dict:
    """Prune one tenant's rows (`tenant=None`: the rows that have no tenant)."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.authentication.models import LoginLog

    now = now or timezone.now()
    label = tenant.code if tenant is not None else "(none)"
    result = {"tenant": label, "audit_deleted": 0, "login_deleted": 0, "audit_cutoff": None, "login_cutoff": None}

    audit_days, login_days = _days("AUDIT_LOG_RETENTION_DAYS"), _days("LOGIN_LOG_RETENTION_DAYS")
    if not audit_days and not login_days:
        logger.info("audit retention: no retention days set, nothing deleted (%s)", label)
        return result

    if audit_days:
        cutoff = now - timedelta(days=audit_days)
        result["audit_cutoff"] = cutoff.isoformat()
        rows = AuditLog.all_objects.filter(timestamp__lt=cutoff, tenant=tenant)
        result["audit_deleted"] = _purge(rows, batch_size)
    if login_days:
        cutoff = now - timedelta(days=login_days)
        result["login_cutoff"] = cutoff.isoformat()
        if tenant is not None:
            rows = LoginLog.all_objects.filter(timestamp__lt=cutoff, user__tenant=tenant)
        else:
            rows = LoginLog.all_objects.filter(timestamp__lt=cutoff).filter(
                Q(user__isnull=True) | Q(user__tenant__isnull=True)
            )
        result["login_deleted"] = _purge(rows, batch_size)

    logger.info("audit retention: %s", result)
    if result["audit_deleted"] or result["login_deleted"]:
        AuditLog.objects.create(
            tenant=tenant,
            action=AuditAction.DELETE,
            resource="audit_retention",
            description=(
                f"retention: deleted {result['audit_deleted']} audit rows, "
                f"{result['login_deleted']} login rows"
            ),
            changes=result,
        )
    return result
