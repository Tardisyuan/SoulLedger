"""Celery tasks for authentication."""
from celery import shared_task
from django.core.management import call_command


@shared_task(name="authentication.flush_expired_tokens")
def flush_expired_tokens():
    """Delete expired refresh-token rows (IS-18).

    Every refresh rotates and blacklists, so the simplejwt outstanding and
    blacklisted tables gain a row pair per refresh and nothing removed them.
    Blacklisted rows cascade from their outstanding row. Scheduled by
    `manage.py setup_scheduled_tasks` (apps/scheduler/registry.py).
    """
    call_command("flushexpiredtokens")


@shared_task(name="authentication.notify_password_help")
def notify_password_help(username, ip_address=None, user_agent=""):
    """「忘记密码」: tell the account's administrators, and write it down.

    WHY THE LOOKUP HAPPENS HERE AND NOT IN THE VIEW. `password_help_request`
    enqueues this for every username it is given — known, unknown, inactive —
    and answers the same 200 without reading the user table. Everything that
    differs between those cases (a query that finds a row, the notification
    inserts, the audit insert) happens in the worker, after the response has
    gone. So the endpoint cannot say whether an account exists either in its
    body or in how long it takes to answer.

    RECIPIENTS: the active ADMINs of the account's own tenant. If that tenant
    has none — or the account has no tenant, i.e. it is itself a global
    ADMIN — the global ADMINs (tenant NULL, the only role `scope_to_tenant`
    lets across tenants). Never an ADMIN of another tenant: they cannot manage
    this user (`UserViewSet.get_queryset` scopes them out), and the request
    names an account in a tenant that is not theirs. The requester is never
    their own recipient.

    Soul accounts are skipped: their password is reset through
    `/soul-accounts/` (72 hours, forced change on first login), not by an
    officer reading a notification.
    """
    from django.contrib.auth import get_user_model

    from apps.audit.models import AuditAction, AuditLog
    from apps.notifications.messages import DEFAULT_LOCALE, render
    from apps.notifications.models import NotificationType, notify_user

    User = get_user_model()
    user = (
        User.objects.filter(username=username, is_active=True)
        .exclude(role="SOUL")
        .select_related("tenant")
        .first()
    )
    if user is None:
        return 0

    admins = User.objects.filter(role="ADMIN", is_active=True).exclude(pk=user.pk)
    recipients = list(admins.filter(tenant=user.tenant)) if user.tenant_id else []
    if not recipients:
        recipients = list(admins.filter(tenant__isnull=True))

    params = {"username": user.username}
    title, message = render(DEFAULT_LOCALE, "password_help_requested", params)
    for admin in recipients:
        notify_user(
            admin,
            title=title,
            message=message,
            notification_type=NotificationType.PASSWORD_HELP_REQUESTED,
            related_resource="user",
            related_id=str(user.pk),
            params=params,
        )

    AuditLog.objects.create(
        tenant=user.tenant,
        user=None,  # nobody is signed in; the account is the subject, not the actor
        action=AuditAction.EXECUTE,
        resource="password_help",
        resource_id=str(user.pk),
        description=f"忘记密码求助:{user.username},已通知 {len(recipients)} 位管理员"[:500],
        changes={"notified_admin_ids": [admin.pk for admin in recipients]},
        ip_address=ip_address,
        user_agent=(user_agent or "")[:500],
    )
    return len(recipients)
