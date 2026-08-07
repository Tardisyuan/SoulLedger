"""
URL configuration for SoulLedger project.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from apps.authentication.views import UserViewSet
from apps.core.health import HealthCheck, HealthCheckDetailed
from apps.core.recycle_bin_views import RecycleBinViewSet

# User management router (registered at api/v1/users/ via path)
user_router = DefaultRouter()
user_router.register(r'', UserViewSet, basename='user')

# Global recycle bin router (registered at api/v1/recycle-bin/ via path) —
# not model-backed, so it's routed the same standalone way as UserViewSet
# rather than through an app-local urls.py. See apps/core/recycle_bin_views.py.
recycle_bin_router = DefaultRouter()
recycle_bin_router.register(r'', RecycleBinViewSet, basename='recycle-bin')

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", HealthCheck.as_view(), name="health"),
    path("health/detailed/", HealthCheckDetailed.as_view(), name="health_detailed"),
    path("api/v1/auth/", include("apps.authentication.urls")),
    path("api/v1/users/", include(user_router.urls)),
    path("api/v1/recycle-bin/", include(recycle_bin_router.urls)),
    path("api/v1/tenants/", include("apps.tenants.urls")),
    path("api/v1/souls/", include("apps.souls.urls")),
    path("api/v1/judgment/", include("apps.judgment.urls")),
    path("api/v1/disposition/", include("apps.disposition.urls")),
    path("api/v1/ledger/", include("apps.ledger.urls")),
    path("api/v1/reincarnation/", include("apps.reincarnation.urls")),
    path("api/v1/realms/", include("apps.realms.urls")),
    path("api/v1/actors/", include("apps.actors.urls")),
    path("api/v1/events/", include("apps.events.urls")),
    path("api/v1/perm/", include("apps.perm.urls")),
    path("api/v1/menus/", include("apps.menus.urls")),
    path("api/v1/audit-logs/", include("apps.audit.urls")),
    path("api/v1/", include("apps.workflow.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/dispatch/", include("apps.dispatch.urls")),
    path("api/v1/death-sync/", include("apps.death_sync.urls")),
    path("api/v1/organizations/", include("apps.org.urls")),
    path("api/v1/social/", include("apps.social.urls")),
    # API docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
