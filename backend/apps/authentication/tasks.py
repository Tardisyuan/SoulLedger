"""Celery tasks for authentication."""
from datetime import timedelta

from celery import shared_task
from django.core.management import call_command
from django.utils import timezone


@shared_task(name="authentication.flush_expired_tokens")
def flush_expired_tokens():
    """Delete expired refresh-token rows (IS-18).

    Every refresh rotates and blacklists, so the simplejwt outstanding and
    blacklisted tables gain a row pair per refresh and nothing removed them.
    Blacklisted rows cascade from their outstanding row. Scheduled by
    `manage.py setup_scheduled_tasks` (apps/scheduler/registry.py).
    """
    call_command("flushexpiredtokens")


#: 灵魂端「最近登录」和登录设备只保留这么久(Design 第二十八批 S1);超过的每天清掉。
SOUL_SIGN_IN_KEEP_DAYS = 90


@shared_task(name="authentication.prune_soul_sign_ins")
def prune_soul_sign_ins():
    """删 90 天前的灵魂登录记录(`LoginLog` 里 `soul:` 开头的行)和早已不活动的登录设备行。

    官员的 `LoginLog` 是审计的一部分,按 `LOGIN_LOG_RETENTION_DAYS` 另管(默认不清),这里不碰。
    `_raw_delete` 同 `audit/retention.py`:LoginLog 是被审计的模型,逐行 delete 会为每一行再写一条审计。
    """
    from apps.audit.retention import _purge

    from .models import LoginLog, SignInSession

    cutoff = timezone.now() - timedelta(days=SOUL_SIGN_IN_KEEP_DAYS)
    logs = _purge(LoginLog.all_objects.filter(timestamp__lt=cutoff, username__startswith="soul:"), 5000)
    sessions = _purge(SignInSession.objects.filter(last_seen_at__lt=cutoff), 5000)
    return {"sign_in_logs": logs, "sessions": sessions}


@shared_task(name="authentication.prune_expired_push_registrations")
def prune_expired_push_registrations():
    """登录已到期、又没人在那台手机上重新登录的推送登记:停用,锁屏不再收到。

    官员端(24 小时刷新令牌)与灵魂端(`JWT_REFRESH_LIFETIME`)各按自己的有效期判;判定见
    `signin_sessions.expired_devices`。发送路径同样跳过它们,所以这个任务只是把行收拾干净。"""
    from apps.officer_app.models import OfficerPushDevice
    from apps.soul_push.models import DeviceInvalidReason, PushDevice

    from . import signin_sessions as ss

    officer = ss.expired_devices(OfficerPushDevice.objects.filter(is_active=True), user_field="user_id",
                                 lifetime=ss.officer_app_lifetime()).update(is_active=False)
    soul = ss.expired_devices(PushDevice.objects.filter(is_active=True), user_field="account__user_id",
                              lifetime=ss.soul_lifetime()).update(
        is_active=False, invalid_reason=DeviceInvalidReason.UNREGISTERED)
    return {"officer": officer, "soul": soul}


#: Who hears about 「忘记密码」 in the account's own tenant: its administrators
#: and its realm leads (殿主, `UserRole.MODERATOR`). See `notify_password_help`.
PASSWORD_HELP_TENANT_ROLES = ("ADMIN", "MODERATOR")

#: The window of the 「近 24 小时第 N 次」 count on a password-help notification.
PASSWORD_HELP_COUNT_WINDOW = timedelta(hours=24)


@shared_task(name="authentication.notify_password_help")
def notify_password_help(username, ip_address=None, user_agent=""):
    """「忘记密码」: tell the account's administrators and realm leads, and write it down.

    WHY THE LOOKUP HAPPENS HERE AND NOT IN THE VIEW. `password_help_request`
    enqueues this for every username it is given — known, unknown, inactive —
    and answers the same 200 without reading the user table. Everything that
    differs between those cases (a query that finds a row, the notification
    inserts, the audit insert) happens in the worker, after the response has
    gone. So the endpoint cannot say whether an account exists either in its
    body or in how long it takes to answer.

    RECIPIENTS: the active ADMINs and MODERATORs (殿主) of the account's own
    tenant — MODERATOR since 2026-09-25, the product owner's decision: the
    realm lead is who knows the officer in person. If that tenant has
    neither — or the account has no tenant, i.e. it is itself a global
    ADMIN — the global ADMINs (tenant NULL, the only role `scope_to_tenant`
    lets across tenants). The fallback is ADMIN only: a MODERATOR is a
    tenant role, and one without a tenant speaks for no hall. Never anyone
    of another tenant: they cannot manage this user
    (`UserViewSet.get_queryset` scopes them out), and the request names an
    account in a tenant that is not theirs. The requester is never their own
    recipient.

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

    active = User.objects.filter(is_active=True).exclude(pk=user.pk)
    recipients = (
        list(active.filter(role__in=PASSWORD_HELP_TENANT_ROLES, tenant=user.tenant).order_by("pk"))
        if user.tenant_id
        else []
    )
    if not recipients:
        recipients = list(active.filter(role="ADMIN", tenant__isnull=True).order_by("pk"))

    # 「近 24 小时第 N 次」: this request's place among the account's requests in
    # the last 24 hours. Read from the audit rows this task writes below, so the
    # count is of requests that reached a real account — the only ones recorded.
    recent = AuditLog.objects.filter(
        resource="password_help",
        resource_id=str(user.pk),
        timestamp__gte=timezone.now() - PASSWORD_HELP_COUNT_WINDOW,
    ).count()
    context = {
        # {locale: hall name}; the serializer picks the reader's language.
        "hall": user.tenant.hall_names if user.tenant_id else None,
        "role": user.role,
        "count_24h": recent + 1,
    }

    for admin in recipients:
        # A MODERATOR cannot open user management (ADMIN only), so theirs says
        # to ask an administrator. Written into `params` so the read-time
        # re-render (`kind_for`) picks the same text in every language.
        params = {"username": user.username, **context}
        if admin.role != "ADMIN":
            params["kind"] = "password_help_requested_moderator"
        title, message = render(DEFAULT_LOCALE, params.get("kind", "password_help_requested"), params)
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
        description=f"忘记密码求助:{user.username},已通知 {len(recipients)} 位管理员或殿主"[:500],
        changes={"notified_admin_ids": [admin.pk for admin in recipients]},
        ip_address=ip_address,
        user_agent=(user_agent or "")[:500],
    )
    return len(recipients)


@shared_task(name="authentication.send_officer_reset_mail")
def send_officer_reset_mail(identifier, ip_address=None, user_agent=""):
    """官员「忘记密码」的查人与发信,放在 worker 里 —— 与 `notify_password_help` 同一理由:
    申请端不读用户表,应答与耗时都不因账号存在与否而不同。见 `officer_reset.py`。"""
    from .officer_reset import send_reset_mail_if_eligible

    return send_reset_mail_if_eligible(identifier, ip=ip_address, ua=user_agent)
