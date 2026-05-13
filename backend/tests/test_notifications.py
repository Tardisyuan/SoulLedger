"""
Tests for notifications functionality.
"""
import os
import pytest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient
    return APIClient()


@pytest.fixture
def cn_tenant(db):
    """Create a tenant for testing."""
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(code="CN_NOTIF_TEST", defaults={"display_name": "Test Diyu"})
    return tenant


@pytest.fixture
def admin_user(db, django_user_model, cn_tenant):
    """Create admin user with tenant."""
    user = django_user_model.objects.create_user(
        username="notif_admin", password="admin123", role="ADMIN", tenant=cn_tenant
    )
    return user


@pytest.fixture
def judge_user(db, django_user_model, cn_tenant):
    """Create judge user with tenant."""
    user = django_user_model.objects.create_user(
        username="notif_judge", password="judge123", role="JUDGE", tenant=cn_tenant
    )
    return user


@pytest.fixture
def auth_client(api_client, admin_user):
    """APIClient authenticated as admin_user."""
    import contextlib
    from apps.core import request_local as rl_module

    api_client.force_authenticate(user=admin_user)
    rl_module.set_current_user(admin_user)
    rl_module.set_current_request(None)

    yield api_client

    rl_module.clear_current_user()


@pytest.fixture
def judge_client(api_client, judge_user):
    """APIClient authenticated as judge_user."""
    import contextlib
    from apps.core import request_local as rl_module

    api_client.force_authenticate(user=judge_user)
    rl_module.set_current_user(judge_user)
    rl_module.set_current_request(None)

    yield api_client

    rl_module.clear_current_user()


@pytest.mark.django_db
class TestNotificationModel:
    """Test UserNotification model."""

    def test_create_notification(self, admin_user, cn_tenant):
        """Creating a notification should work."""
        from apps.notifications.models import UserNotification, NotificationType

        notification = UserNotification.objects.create(
            user=admin_user,
            title="Test Notification",
            message="This is a test message",
            notification_type=NotificationType.SYSTEM,
        )

        assert notification.id is not None
        assert notification.user == admin_user
        assert notification.title == "Test Notification"
        assert notification.notification_type == NotificationType.SYSTEM
        assert notification.is_read is False

    def test_notify_user_helper(self, admin_user):
        """notify_user helper function should create notification."""
        from apps.notifications.models import notify_user, NotificationType

        notification = notify_user(
            user=admin_user,
            title="Helper Test",
            message="Created via helper",
            notification_type=NotificationType.WORKFLOW_ASSIGNED,
            related_resource="workflow",
            related_id="123",
        )

        assert notification.id is not None
        assert notification.title == "Helper Test"
        assert notification.notification_type == NotificationType.WORKFLOW_ASSIGNED
        assert notification.related_resource == "workflow"
        assert notification.related_id == "123"


@pytest.mark.django_db
class TestNotificationAPI:
    """Test Notification API endpoints."""

    def test_list_notifications_authenticated(self, auth_client, admin_user):
        """GET /api/v1/notifications/ should return user's notifications."""
        from apps.notifications.models import UserNotification, NotificationType

        # Create some notifications
        UserNotification.objects.create(
            user=admin_user,
            title="Notification 1",
            message="Message 1",
            notification_type=NotificationType.SYSTEM,
        )
        UserNotification.objects.create(
            user=admin_user,
            title="Notification 2",
            message="Message 2",
            notification_type=NotificationType.WORKFLOW_ASSIGNED,
        )

        response = auth_client.get("/api/v1/notifications/")

        assert response.status_code == 200
        assert len(response.data) == 2

    def test_list_notifications_unauthenticated(self, api_client):
        """GET /api/v1/notifications/ without auth should return 401."""
        response = api_client.get("/api/v1/notifications/")
        assert response.status_code == 401

    def test_user_cannot_see_other_users_notifications(self, auth_client, judge_user, admin_user):
        """User should not see other users' notifications."""
        from apps.notifications.models import UserNotification, NotificationType

        # Create notification for judge_user
        UserNotification.objects.create(
            user=judge_user,
            title="Judge Notification",
            message="This belongs to judge",
            notification_type=NotificationType.SYSTEM,
        )

        # admin_user should not see it
        response = auth_client.get("/api/v1/notifications/")
        assert response.status_code == 200
        # Check that no notification with title "Judge Notification" appears
        titles = [n["title"] for n in response.data]
        assert "Judge Notification" not in titles

    def test_mark_notification_as_read(self, auth_client, admin_user):
        """POST /api/v1/notifications/{id}/mark_read/ should mark as read."""
        from apps.notifications.models import UserNotification, NotificationType

        notification = UserNotification.objects.create(
            user=admin_user,
            title="To Be Read",
            message="Mark me as read",
            notification_type=NotificationType.SYSTEM,
        )

        assert notification.is_read is False

        response = auth_client.post(f"/api/v1/notifications/{notification.id}/mark_read/")

        assert response.status_code == 200
        assert response.data["is_read"] is True

        notification.refresh_from_db()
        assert notification.is_read is True

    def test_mark_all_notifications_as_read(self, auth_client, admin_user):
        """POST /api/v1/notifications/mark_all_read/ should mark all as read."""
        from apps.notifications.models import UserNotification, NotificationType

        # Create multiple notifications
        for i in range(3):
            UserNotification.objects.create(
                user=admin_user,
                title=f"Notification {i}",
                message=f"Message {i}",
                notification_type=NotificationType.SYSTEM,
            )

        response = auth_client.post("/api/v1/notifications/mark_all_read/")

        assert response.status_code == 200
        assert response.data["marked_read"] == 3

        # Verify all are read
        unread = UserNotification.objects.filter(user=admin_user, is_read=False).count()
        assert unread == 0

    def test_notification_types(self, auth_client, admin_user):
        """All notification types should be creatable."""
        from apps.notifications.models import UserNotification, NotificationType

        types = [
            NotificationType.WORKFLOW_ASSIGNED,
            NotificationType.JUDGMENT_COMPLETED,
            NotificationType.SYSTEM,
            NotificationType.APPEAL_REQUIRED,
            NotificationType.REINCARNATION_COMPLETE,
            NotificationType.KARMIC_UPDATE,
            NotificationType.ROLE_ASSIGNED,
        ]

        for ntype in types:
            notification = UserNotification.objects.create(
                user=admin_user,
                title=f"Test {ntype}",
                message="Test message",
                notification_type=ntype,
            )
            assert notification.notification_type == ntype

    def test_notification_ordering(self, auth_client, admin_user):
        """Notifications should be ordered by created_at descending."""
        from apps.notifications.models import UserNotification, NotificationType
        import time

        n1 = UserNotification.objects.create(
            user=admin_user,
            title="First",
            message="First",
            notification_type=NotificationType.SYSTEM,
        )
        time.sleep(0.01)  # Small delay to ensure different timestamps
        n2 = UserNotification.objects.create(
            user=admin_user,
            title="Second",
            message="Second",
            notification_type=NotificationType.SYSTEM,
        )

        response = auth_client.get("/api/v1/notifications/")

        assert response.status_code == 200
        assert response.data[0]["title"] == "Second"
        assert response.data[1]["title"] == "First"


@pytest.mark.django_db
class TestNotificationEdgeCases:
    """Test edge cases for notifications."""

    def test_mark_read_non_existent_notification(self, auth_client):
        """Marking non-existent notification should return 404."""
        response = auth_client.post("/api/v1/notifications/99999/mark_read/")
        assert response.status_code == 404

    def test_cannot_mark_other_users_notification_read(self, auth_client, judge_user, admin_user):
        """User cannot mark another user's notification as read via API."""
        from apps.notifications.models import UserNotification, NotificationType

        notification = UserNotification.objects.create(
            user=judge_user,
            title="Judge's Notification",
            message="This is the judge's",
            notification_type=NotificationType.SYSTEM,
        )

        # admin_user tries to mark judge's notification as read
        response = auth_client.post(f"/api/v1/notifications/{notification.id}/mark_read/")
        assert response.status_code == 404

    def test_empty_notification_list(self, auth_client):
        """Empty notification list should return empty array."""
        response = auth_client.get("/api/v1/notifications/")
        assert response.status_code == 200
        assert response.data == []
