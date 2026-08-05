"""
Views for notifications.
"""
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin
from apps.notifications.models import UserNotification
from apps.notifications.serializers import UserNotificationListSerializer, UserNotificationSerializer


class NotificationViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    ViewSet for user notifications.

    list: GET /api/v1/notifications/ - List user's notifications
    mark_read: POST /api/v1/notifications/{id}/mark_read/ - Mark single notification as read
    mark_all_read: POST /api/v1/notifications/mark_all_read/ - Mark all notifications as read
    """
    # CodenamePermission is what finally enforces the codename below; before
    # it, PermissionMiddleware never saw self.action and it gated nothing.
    #
    # ZERO codes move. All five roles hold notification.read and it is the only
    # codename any action here resolves to, so every case that succeeded before
    # succeeds after. That is worth attaching anyway rather than skipping: an
    # app left off the enforced list is indistinguishable from one nobody got
    # to, and the next reader would have to re-derive that this one is a no-op.
    # Proved rather than claimed, in both directions, by
    # backend/tests/test_perm_write_snapshot_outside_matrix.py.
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY on `notification.read`, the only notification codename that
    # exists. Not a CRUD family, and deliberately so: get_queryset() below
    # filters to `user=request.user`, so every action on this viewset — listing,
    # marking read, deleting — operates on the caller's own inbox and never on
    # anyone else's. The codename therefore means "may use my notification
    # inbox", not "may edit notifications", and one codename covers it.
    #
    # This replaces notification.create/update/delete, which existed nowhere
    # and were held by nobody, so mark_read was gated on a codename that could
    # only answer no.
    #
    # A previous version of this comment said only ADMIN and MODERATOR hold
    # notification.read, and that under enforcement JUDGE, GUARDIAN and VIEWER
    # would lose their own inbox. That was never true of ROLE_PERMISSIONS: all
    # five roles hold it. Corrected rather than deleted because the false
    # version read as a reason to add grants before enforcing this app, and no
    # grant is needed. Enforcement is now attached and moved nothing.
    # test_notification_read_is_held_by_every_role pins the fact.
    permission_codename = "notification"
    extra_permissions = {
        'mark_read': ['notification.read'],
        'mark_all_read': ['notification.read'],
        'create': ['notification.read'],
        'update': ['notification.read'],
        'partial_update': ['notification.read'],
        'destroy': ['notification.read'],
    }
    serializer_class = UserNotificationSerializer
    # pagination_class = None  # Removed: paginate to prevent large payloads

    def get_serializer_class(self):
        if self.action == "list":
            return UserNotificationListSerializer
        return UserNotificationSerializer

    def perform_create(self, serializer):
        """Force `user` to the caller — POST /notifications/ never had this and 500'd.

        `UserNotificationSerializer` marks `user` read-only and this viewset had
        no perform_create, so the default ModelViewSet.create() called
        serializer.save() with no `user` kwarg, writing user_id NULL and letting
        the database's NOT NULL constraint raise an uncaught IntegrityError — a
        500 for every role, always. See
        backend/tests/test_perm_write_snapshot_outside_matrix.py,
        test_notification_create_cannot_succeed_for_anyone (pre-fix version).

        Fixed as self-notify only: request.user, never a client-supplied
        target. The alternative — letting a caller name an arbitrary
        recipient — would be gated by `notification.read` per the
        extra_permissions mapping below, and that codename is held by all
        five roles, so it would let anyone spam anyone else's inbox. That is
        a privilege decision nothing in this file's history establishes, so
        it was not made here. Self-notify matches the codename's own meaning
        as documented in this class's `permission_codename` comment above:
        "may use my notification inbox" already covers creating in it, and
        get_queryset() already scopes every other action on this viewset to
        the caller's own rows.
        """
        serializer.save(user=self.request.user)

    def get_queryset(self):
        """Return only the current user's notifications, tenant-scoped."""
        if not self.request.user.is_authenticated:
            return UserNotification.objects.none()

        qs = UserNotification.objects.filter(user=self.request.user).select_related("user")

        # Defense-in-depth: ensure user belongs to the current tenant
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            qs = qs.filter(user__tenant=tenant)
        return qs

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        """Mark a single notification as read."""
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        return Response(UserNotificationSerializer(notification).data)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        """Mark all of the user's notifications as read."""
        updated = self.get_queryset().update(is_read=True)
        return Response({"marked_read": updated})
