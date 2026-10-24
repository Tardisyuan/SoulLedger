"""通知类别(apps/notifications/categories.py):每个类型有归属、站内 / 邮件各管各的通道、锁定格关不掉。"""
import pytest
from django.core import mail

from apps.authentication.models import User
from apps.notifications import categories
from apps.notifications.models import NotificationType, UserNotification, notify_user
from apps.notifications.tasks import email_action_needed_for_tenant

PREFS = "/api/v1/auth/profile/preferences/"


# ── 守卫:新类型必须作出选择 ──────────────────────────────────────────────


def test_every_notification_type_has_a_category_decision():
    """变异:往 `NotificationType` 加一个没登记的类型 → 这条红(验过)。"""
    declared = {value for value, _ in NotificationType.choices}
    assert declared - set(categories.CATEGORY_BY_TYPE) == set(), "new NotificationType needs a row in CATEGORY_BY_TYPE"
    assert set(categories.CATEGORY_BY_TYPE) - declared == set(), "CATEGORY_BY_TYPE names a type that no longer exists"
    assert set(categories.CATEGORY_BY_TYPE.values()) - {None} <= set(categories.CATEGORIES)


def test_the_emailed_types_all_have_a_category_and_overrides_are_real():
    from apps.notifications.tasks import EMAILED_TYPES

    for kind in EMAILED_TYPES:
        assert categories.CATEGORY_BY_TYPE[kind] is not None, kind
    for kind, extra in categories.OVERRIDES.items():
        assert kind in categories.CATEGORY_BY_TYPE and extra <= set(categories.CATEGORIES)
    assert set(categories.LOCKED) <= set(categories.CATEGORIES)


def test_the_serializer_fields_are_the_categories():
    from apps.authentication.serializers import NotificationPrefsSerializer

    assert tuple(NotificationPrefsSerializer().fields) == categories.CATEGORIES


# ── API:校验 ─────────────────────────────────────────────────────────────


@pytest.mark.django_db
@pytest.mark.parametrize("category, channel", [
    ("account_security", "site"), ("account_security", "mail"), ("password_help", "site"),
    ("password_help", "mail"), ("approval_timeout", "site"),
])
def test_a_locked_cell_cannot_be_turned_off(api_client, judge_user, category, channel):
    api_client.force_authenticate(judge_user)
    response = api_client.patch(PREFS, {"notifications": {category: {channel: False}}}, format="json")
    assert response.status_code == 400
    judge_user.refresh_from_db()
    assert not (judge_user.preferences or {}).get("notifications")
    assert api_client.patch(PREFS, {"notifications": {category: {channel: True}}}, format="json").status_code == 200
    assert api_client.get(PREFS).data["notifications"][category][channel] is True


@pytest.mark.django_db
def test_unknown_categories_channels_and_the_old_switch_are_refused(api_client, judge_user):
    api_client.force_authenticate(judge_user)
    for body in (
        {"notifications": {"spam": {"site": False}}},
        {"notifications": {"approval": {"sms": True}}},
        {"email_notifications": True},
    ):
        assert api_client.patch(PREFS, body, format="json").status_code == 400, body


# ── 站内:关了就不写行、不推;邮件列不受影响 ─────────────────────────────


def _set(user, **cells):
    user.preferences = {**(user.preferences or {}), "notifications": cells}
    user.save(update_fields=["preferences"])


def _send(user, kind, **params):
    notify_user(user, title="t", message="m", notification_type=kind, params=params or None)


@pytest.mark.django_db
@pytest.mark.parametrize("kind, category", [
    ("WORKFLOW_ASSIGNED", "approval"),
    ("JUDGMENT_REASSIGN_REQUESTED", "reassign"),
    ("DISPATCH_PROPOSED", "dispatch"),
    ("DISPATCH_CANCELLED", "dispatch"),
    ("SOUL_INBOX_ASSIGNED", "letter_handoff"),
    ("CITY_GOD_CASE_RECEIVED", "city_god"),
])
def test_site_off_suppresses_exactly_that_category(judge_user, kind, category):
    _set(judge_user, **{category: {"site": False}})
    _send(judge_user, kind)
    _send(judge_user, "SYSTEM")  # 不分类:照旧送达
    other = "dispatch" if category != "dispatch" else "approval"
    _send(judge_user, {"dispatch": "DISPATCH_APPROVED", "approval": "WORKFLOW_ASSIGNED"}[other])  # 别的类别照常
    kinds = sorted(UserNotification.objects.filter(user=judge_user).values_list("notification_type", flat=True))
    assert kind not in kinds and "SYSTEM" in kinds and len(kinds) == 2


@pytest.mark.django_db
def test_a_suppressed_notification_writes_no_row_and_flags_the_envelope(judge_user):
    from apps.events.event_bus import EventEnvelope
    from apps.events.handlers.notification_handler import NotificationHandler

    _set(judge_user, approval={"site": False})
    env = EventEnvelope(
        "NOTIFICATION_CREATED",
        {"user_id": judge_user.id, "title": "t", "message": "m", "notification_type": "WORKFLOW_ASSIGNED"},
        "notification",
    )
    NotificationHandler().handle(env)
    assert env.payload.get("_suppressed") is True and not UserNotification.objects.exists()


@pytest.mark.django_db
def test_the_websocket_handler_skips_a_suppressed_envelope(monkeypatch):
    from apps.events.event_bus import EventEnvelope
    from apps.events.handlers.websocket_handler import WebSocketHandler

    called = []
    monkeypatch.setattr("channels.layers.get_channel_layer", lambda: called.append(1))
    WebSocketHandler().handle(EventEnvelope("X", {"_suppressed": True}, "notification", user_ids=[1]))
    assert called == []


@pytest.mark.django_db
def test_locked_site_cells_are_delivered_even_if_the_stored_value_says_off(judge_user):
    """Server-side enforcement: a hand-edited column cannot silence a locked cell."""
    _set(judge_user, approval_timeout={"site": False}, password_help={"site": False})
    _send(judge_user, "PASSWORD_HELP_REQUESTED", username="u")
    _send(judge_user, "WORKFLOW_ASSIGNED", category="approval_timeout")
    assert UserNotification.objects.filter(user=judge_user).count() == 2


@pytest.mark.django_db
def test_only_a_timeout_sender_can_pick_the_timeout_category():
    assert categories.category_of("WORKFLOW_ASSIGNED", {"category": "approval_timeout"}) == "approval_timeout"
    assert categories.category_of("WORKFLOW_ASSIGNED", {"category": "dispatch"}) == "approval"
    assert categories.category_of("DISPATCH_PROPOSED", {"category": "approval_timeout"}) == "dispatch"


@pytest.mark.django_db
def test_the_timeout_processor_writes_the_timeout_category(judge_user):
    from types import SimpleNamespace
    from unittest.mock import patch

    from apps.workflow.services import WorkflowService

    wf = SimpleNamespace(id=1, pk=1, tenant_id=judge_user.tenant_id, workflow_name="w", soul=SimpleNamespace(name="s"),
                         case_type="GENERAL")
    node = SimpleNamespace(node_name="n")
    with patch.object(WorkflowService, "designated_users", return_value=[judge_user]):
        WorkflowService.notify_designated(wf, node, kind="workflow_timeout_reminder", hours=1, category="approval_timeout")
        WorkflowService.notify_designated(wf, node, kind="workflow_node_passed")
    rows = list(UserNotification.objects.filter(user=judge_user).order_by("id"))
    assert [categories.category_of(r.notification_type, r.params) for r in rows] == ["approval_timeout", "approval"]


# ── 邮件:只管邮件列 ─────────────────────────────────────────────────────


def _row(user, kind, **extra):
    return UserNotification.objects.create(user=user, title="请求改派", message="a 请求改派案件 s",
                                           notification_type=kind, params={"by": "a", "soul": "s"}, **extra)


@pytest.mark.django_db
def test_mail_off_suppresses_mail_but_not_the_site_row(cn_tenant):
    user = User.objects.create_user(username="m1", password="x", role="ADMIN", tenant=cn_tenant, email="m1@example.com",
                                    preferences={"notifications": {"reassign": {"site": True, "mail": False}}})
    _row(user, "JUDGMENT_REASSIGN_REQUESTED")
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert mail.outbox == [] and UserNotification.objects.filter(user=user).count() == 1


@pytest.mark.django_db
def test_mail_on_sends_even_with_site_off_and_only_for_that_category(cn_tenant):
    user = User.objects.create_user(
        username="m2", password="x", role="ADMIN", tenant=cn_tenant, email="m2@example.com",
        preferences={"notifications": {"reassign": {"site": False, "mail": True, "mail_since": "2020-01-01T00:00:00+00:00"}}},
    )
    _row(user, "JUDGMENT_REASSIGN_REQUESTED")
    _row(user, "WORKFLOW_ASSIGNED")  # approval 邮件列没开
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert len(mail.outbox) == 1 and "请求改派" in mail.outbox[0].subject


@pytest.mark.django_db
def test_locked_mail_is_sent_without_any_opt_in(cn_tenant):
    """密码求助的邮件列锁定:没开过任何开关的管理员也收到(24 小时窗口内)。变异:让 `wants` 不看 LOCKED → 红。"""
    user = User.objects.create_user(username="m3", password="x", role="ADMIN", tenant=cn_tenant, email="m3@example.com",
                                    preferences={"notifications": {"password_help": {"mail": False}}})
    UserNotification.objects.create(
        user=user, title="重设密码求助", message="x", notification_type="PASSWORD_HELP_REQUESTED",
        params={"username": "u", "hall": None, "role": "JUDGE", "count_24h": 1},
    )
    email_action_needed_for_tenant(str(cn_tenant.pk))
    assert len(mail.outbox) == 1


# ── 旧的总开关怎么迁 ─────────────────────────────────────────────────────


@pytest.mark.django_db
def test_the_old_switch_is_the_default_for_unset_mail_cells_only(cn_tenant, api_client):
    on = User.objects.create_user(username="old_on", password="x", role="ADMIN", tenant=cn_tenant, email="a@example.com",
                                  preferences={"email_notifications": True})
    off = User.objects.create_user(username="old_off", password="x", role="ADMIN", tenant=cn_tenant, email="b@example.com",
                                   preferences={"email_notifications": False})
    for user, mail_on in ((on, True), (off, False)):
        api_client.force_authenticate(user)
        table = api_client.get(PREFS).data["notifications"]
        assert "email_notifications" not in api_client.get(PREFS).data
        assert {c: table[c]["mail"] for c in ("approval", "approval_timeout", "reassign", "dispatch", "letter_handoff")} == {
            c: mail_on for c in ("approval", "approval_timeout", "reassign", "dispatch", "letter_handoff")}
        assert all(table[c]["site"] for c in table)
        assert table["account_security"] == table["password_help"] == {"site": True, "mail": True}
    # 存过的格压过旧开关。
    api_client.force_authenticate(on)
    assert api_client.patch(PREFS, {"notifications": {"dispatch": {"mail": False}}}, format="json").data["notifications"][
        "dispatch"]["mail"] is False
