"""官员邮件通道:把**待你处理**的站内通知再发一封到邮箱。

只发「要人去做点什么」的那几种(`EMAILED_TYPES`):待审批与审批超时(`WORKFLOW_ASSIGNED`,
`ApprovalWorkflow` 的指派与 `timeouts.py` 的转交 / 提醒都写它)、改派请求、密码求助。
结论类(审判结束、受刑节点)不发:站内看得到,邮箱里只会是噪音。

谁收:本租户、在职、`preferences.email_notifications` 为真(默认关,`UserPreferencesSerializer`)
且有邮箱的官员。没邮箱的跳过,不记录 —— 没有尝试就没有结果。
发什么:标题与正文按收件人语言重渲染(`messages.render`,与站内读时一致),加一行「去站内处理」。
**不带密钥**:这几种通知的 params 里只有用户名、灵魂名、殿名与计数;密码求助说的是「有人求助」,
不含任何密码。标题 / 正文之外不附任何别的字段。
每条通知最多一行 `NotificationEmail`(成功或失败),失败不重试。只看未读且 24 小时内的:
worker 停了两天,积压的那些已经过了「待处理」的时效,不再追发。
按租户一行(apps/scheduler/registry.py),与别的租户任务一样先设租户 contextvar。
"""
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

EMAILED_TYPES = ("WORKFLOW_ASSIGNED", "JUDGMENT_REASSIGN_REQUESTED", "PASSWORD_HELP_REQUESTED")
WINDOW = timedelta(hours=24)

MESSAGES = {
    "zh-Hans": {"subject": "SoulLedger {{title}}", "act": "这件事待你处理。打开 SoulLedger，在「通知」里查看。"},
    "en": {"subject": "SoulLedger {{title}}", "act": "This needs your action. Open SoulLedger and see it under Notifications."},
}


def email_locale(user):
    from apps.authentication.mail import mail_locale

    locale = (user.preferences or {}).get("email_locale") or mail_locale(user=user)
    return locale if locale in MESSAGES else "en"


def render_email(notification, locale):
    """`(subject, text, title, body)`,按收件人语言;没有分语言文案的类型用存下来的原文。"""
    from apps.notifications import messages

    kind = messages.kind_for(notification.notification_type, notification.params)
    if kind and notification.params and locale in messages.MESSAGES:
        title, body = messages.render(locale, kind, notification.params)
    else:
        title, body = notification.title, notification.message
    pack = MESSAGES[locale]
    subject = pack["subject"].replace("{{title}}", title)
    return subject, f"{body}\n{pack['act']}", title, body


@shared_task(name="notifications.email_action_needed_for_tenant")
def email_action_needed_for_tenant(tenant_id: str):
    from apps.authentication.mail import send_neutral_mail
    from apps.authentication.models import User
    from apps.notifications.models import NotificationEmail, UserNotification
    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    tenant = Tenant.objects.get(id=tenant_id)
    set_current_tenant(tenant)
    try:
        recipients = (
            User.objects.filter(tenant_id=tenant_id, is_active=True, preferences__email_notifications=True)
            .exclude(email="")
        )
        pending = (
            UserNotification.objects.filter(
                user__in=recipients, notification_type__in=EMAILED_TYPES, is_read=False,
                created_at__gte=timezone.now() - WINDOW, email__isnull=True,
            )
            .select_related("user")
            .order_by("created_at")
        )
        sent = failed = 0
        for notification in pending:
            locale = email_locale(notification.user)
            subject, text, title, body = render_email(notification, locale)
            try:
                send_neutral_mail(
                    subject, text, heading=title, rows=[], notes=[body, MESSAGES[locale]["act"]],
                    to=[notification.user.email], locale=locale,
                )
            except Exception as exc:  # noqa: BLE001 — 一封失败不拦下一封;原因记在行上
                NotificationEmail.objects.create(notification=notification, sent=False, error=str(exc)[:300])
                failed += 1
            else:
                NotificationEmail.objects.create(notification=notification, sent=True)
                sent += 1
        return {"tenant": tenant.code, "sent": sent, "failed": failed}
    finally:
        clear_current_tenant()
