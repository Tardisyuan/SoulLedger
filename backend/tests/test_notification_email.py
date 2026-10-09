"""官员邮件通道(apps/notifications/tasks.py)与它的偏好(`email_notifications`,默认关)。

只有开了开关、有邮箱、本租户的官员收到;没邮箱的跳过且不留行;发送失败记在行上并由
`/notifications/email-status/` 给 /profile 显示;语言按 `email_locale`,没有就按所属文明。
"""
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.authentication.models import User
from apps.notifications.models import NotificationEmail, UserNotification
from apps.notifications.tasks import email_action_needed_for_tenant, email_action_needed_global
from apps.tenants.managers import get_current_tenant

pytestmark = pytest.mark.django_db

PREFS = "/api/v1/auth/profile/preferences/"
STATUS = "/api/v1/notifications/email-status/"
DEFAULTS = {"default_view": None, "onboarded": False, "email_notifications": False, "email_locale": None}


def _officer(tenant, name, *, email=None, opted=True, locale=None, role="ADMIN"):
    """邮箱按名字派生(`unique_user_email_among_live_rows`);`email=""` 是「没有邮箱」。"""
    prefs = {"email_notifications": opted}
    if locale:
        prefs["email_locale"] = locale
    address = f"{name}@example.com" if email is None else email
    return User.objects.create_user(username=name, password="x", role=role, tenant=tenant, email=address, preferences=prefs)


def _notify(user, kind="PASSWORD_HELP_REQUESTED", **extra):
    params = {"username": "lost-officer", "hall": None, "role": "JUDGE", "count_24h": 1}
    return UserNotification.objects.create(
        user=user, title="重设密码求助", message="有人在登录页以账号「lost-officer」请求重设密码。",
        notification_type=kind, params=params if kind == "PASSWORD_HELP_REQUESTED" else {}, **extra,
    )


# ── 偏好 ─────────────────────────────────────────────────────────────────


def test_the_preference_defaults_off_and_round_trips(api_client, judge_user):
    api_client.force_authenticate(judge_user)
    assert api_client.get(PREFS).data == DEFAULTS
    on = api_client.patch(PREFS, {"email_notifications": True, "email_locale": "en"}, format="json")
    assert on.status_code == 200 and on.data == {**DEFAULTS, "email_notifications": True, "email_locale": "en"}
    judge_user.refresh_from_db()
    stored = dict(judge_user.preferences)
    opted_at = stored.pop("email_opted_at")  # 打开开关的时刻:邮件通道只发它之后的通知
    assert stored == {"email_notifications": True, "email_locale": "en"}
    assert "email_opted_at" not in on.data  # 内部字段,不出现在偏好的读写形状里
    # 开着时再 PATCH(例如前端同步语言)不重置时刻;关了再开才重新记。
    api_client.patch(PREFS, {"email_locale": "zh-Hans"}, format="json")
    judge_user.refresh_from_db()
    assert judge_user.preferences["email_opted_at"] == opted_at
    api_client.patch(PREFS, {"email_notifications": False}, format="json")
    api_client.patch(PREFS, {"email_notifications": True}, format="json")
    judge_user.refresh_from_db()
    assert judge_user.preferences["email_opted_at"] > opted_at
    assert api_client.patch(PREFS, {"email_notifications": False}, format="json").data["email_notifications"] is False
    assert api_client.patch(PREFS, {"email_locale": "egy"}, format="json").status_code == 400


# ── 任务 ─────────────────────────────────────────────────────────────────


def test_only_opted_in_officers_with_an_address_in_this_tenant_are_emailed(cn_tenant, eu_tenant):
    opted = _officer(cn_tenant, "opted")
    off = _officer(cn_tenant, "off", opted=False)
    no_address = _officer(cn_tenant, "noaddr", email="")
    elsewhere = _officer(eu_tenant, "eu")
    for user in (opted, off, no_address, elsewhere):
        _notify(user)
    _notify(opted, kind="JUDGMENT_CONCLUDED")  # 结论类:不发

    result = email_action_needed_for_tenant(str(cn_tenant.pk))

    assert result == {"tenant": cn_tenant.code, "sent": 1, "failed": 0}
    assert [m.to for m in mail.outbox] == [["opted@example.com"]]
    assert "重设密码求助" in mail.outbox[0].subject
    assert "lost-officer" in mail.outbox[0].body and "待你处理" in mail.outbox[0].body
    rows = NotificationEmail.objects.select_related("notification__user")
    assert [(r.notification.user.username, r.sent) for r in rows] == [("opted", True)]
    # 没邮箱的:跳过,不记录;别的租户的:这一轮不碰。
    assert not NotificationEmail.objects.filter(notification__user__in=[no_address, elsewhere]).exists()
    # 再跑一遍不重发。
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert len(mail.outbox) == 1
    assert get_current_tenant() is None


def test_read_or_stale_notifications_are_not_emailed(cn_tenant):
    user = _officer(cn_tenant, "opted")
    _notify(user, is_read=True)
    stale = _notify(user)
    UserNotification.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(hours=25))
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert mail.outbox == []


def test_a_failure_is_recorded_and_shown_on_the_status_endpoint(cn_tenant, api_client, monkeypatch):
    import apps.authentication.mail as mail_module

    user = _officer(cn_tenant, "opted")
    _notify(user)

    def boom(*args, **kwargs):
        raise ConnectionRefusedError("smtp down")

    monkeypatch.setattr(mail_module, "send_neutral_mail", boom)
    result = email_action_needed_for_tenant(str(cn_tenant.pk))
    assert result["failed"] == 1 and result["sent"] == 0
    row = NotificationEmail.objects.get()
    assert row.sent is False and row.error == "smtp down"

    api_client.force_authenticate(user)
    status = api_client.get(STATUS)
    assert status.status_code == 200
    assert status.data["last_failure"]["error"] == "smtp down" and status.data["last_failure"]["at"]

    # 别人的失败不显示给我;没失败过是 null。
    other = _officer(cn_tenant, "other")
    api_client.force_authenticate(other)
    assert api_client.get(STATUS).data == {"last_failure": None}


def test_the_language_follows_the_preference_then_the_civilization(cn_tenant, eu_tenant):
    zh = _officer(cn_tenant, "zh")
    en = _officer(cn_tenant, "en", locale="en")
    eu = _officer(eu_tenant, "eu")
    for user in (zh, en, eu):
        _notify(user)
    email_action_needed_for_tenant(str(cn_tenant.pk))
    email_action_needed_for_tenant(str(eu_tenant.pk))
    by_to = {m.to[0]: m for m in mail.outbox}
    assert by_to["zh@example.com"].subject == "SoulLedger 重设密码求助"
    assert by_to["en@example.com"].subject == "SoulLedger Password reset help"
    assert "This needs your action" in by_to["en@example.com"].body
    assert by_to["eu@example.com"].subject == "SoulLedger Password reset help"  # 欧洲文明默认 en


# ── 全局管理员(tenant=None)─────────────────────────────────────────────


def test_a_global_admin_is_emailed_by_the_global_run_and_only_that_one(cn_tenant):
    glob = _officer(None, "globaladmin")
    local = _officer(cn_tenant, "local")
    _notify(glob)
    _notify(local)

    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert [m.to for m in mail.outbox] == [["local@example.com"]]

    result = email_action_needed_global()
    assert result == {"tenant": None, "sent": 1, "failed": 0}
    assert [m.to for m in mail.outbox][-1] == ["globaladmin@example.com"]
    email_action_needed_global()
    assert len(mail.outbox) == 2  # 每条通知最多一封


def test_the_global_run_is_registered_as_a_five_minutely_global_job():
    from apps.scheduler import registry

    spec = registry.get("notifications.email_action_needed_global")
    assert (spec.scope, spec.cron) == (registry.GLOBAL, "*/5 * * * *")
    assert registry.get("notifications.email_action_needed_for_tenant").scope == registry.TENANT


# ── 积压与开关时刻 ───────────────────────────────────────────────────────


def _opted_at(user, when):
    user.preferences = {**user.preferences, "email_opted_at": when.isoformat()}
    user.save(update_fields=["preferences"])


def test_a_backlog_older_than_24h_is_sent_if_it_postdates_the_opt_in(cn_tenant):
    """worker 停了几天:开关之后产生、还没发过的照发。变异:把 created_at__gte 改回 24 小时 → 红。"""
    user = _officer(cn_tenant, "opted")
    _opted_at(user, timezone.now() - timedelta(days=10))
    old = _notify(user)
    UserNotification.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=3))
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert len(mail.outbox) == 1 and NotificationEmail.objects.get().sent is True


def test_notifications_from_before_the_opt_in_are_never_emailed(cn_tenant):
    """后来才打开开关,不把旧历史倒出去。变异:去掉 created_at__gte=_opted_since → 红。"""
    user = _officer(cn_tenant, "opted")
    _opted_at(user, timezone.now() - timedelta(hours=1))
    ancient = _notify(user)
    UserNotification.objects.filter(pk=ancient.pk).update(created_at=timezone.now() - timedelta(days=40))
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert mail.outbox == [] and not NotificationEmail.objects.exists()
    _notify(user)  # 开关之后的:发
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert len(mail.outbox) == 1


# ── 迁移 0018:给老账号补开关时刻 ─────────────────────────────────────────


def _backfill():
    import importlib

    from django.apps import apps

    return importlib.import_module("apps.authentication.migrations.0018_backfill_email_opted_at"), apps


def test_backfill_stamps_only_opted_in_officers_without_a_moment_and_reverses_only_its_own(cn_tenant):
    mod, apps = _backfill()
    old = _officer(cn_tenant, "old")
    off = _officer(cn_tenant, "off", opted=False)
    real = _officer(cn_tenant, "real")
    _opted_at(real, timezone.now() - timedelta(days=9))
    real_at = real.preferences["email_opted_at"]
    mod.stamp(apps, None)
    for u in (old, off, real):
        u.refresh_from_db()
    assert old.preferences["email_opted_at"] and old.preferences["email_opted_backfilled"] is True
    assert "email_opted_at" not in off.preferences  # 没开开关的不动
    assert real.preferences["email_opted_at"] == real_at  # 有真实时刻的不覆盖
    assert "email_opted_backfilled" not in real.preferences
    stamped = old.preferences["email_opted_at"]
    mod.stamp(apps, None)  # 幂等
    old.refresh_from_db()
    assert old.preferences["email_opted_at"] == stamped
    mod.unstamp(apps, None)
    for u in (old, real):
        u.refresh_from_db()
    assert "email_opted_at" not in old.preferences and "email_opted_backfilled" not in old.preferences
    assert real.preferences["email_opted_at"] == real_at  # 反向不碰自己打开的


def test_turning_the_switch_on_again_replaces_a_backfilled_moment_and_drops_the_marker(api_client, cn_tenant):
    user = _officer(cn_tenant, "again", opted=False)
    user.preferences = {"email_notifications": False, "email_opted_at": "2026-01-01T00:00:00+00:00",
                        "email_opted_backfilled": True}
    user.save(update_fields=["preferences"])
    api_client.force_authenticate(user)
    assert api_client.patch(PREFS, {"email_notifications": True}, format="json").status_code == 200
    user.refresh_from_db()
    assert user.preferences["email_opted_at"] > "2026-01-01" and "email_opted_backfilled" not in user.preferences
