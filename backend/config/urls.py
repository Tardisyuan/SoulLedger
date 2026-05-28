"""
URL configuration for SoulLedger project.
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from apps.authentication.views import UserViewSet
from apps.core.health import HealthCheck, HealthCheckDetailed

# User management router (registered at api/v1/users/ via path)
user_router = DefaultRouter()
user_router.register(r'', UserViewSet, basename='user')

urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", HealthCheck.as_view(), name="health"),
    path("health/detailed/", HealthCheckDetailed.as_view(), name="health_detailed"),
    path("api/v1/auth/", include("apps.authentication.urls")),
    path("api/v1/users/", include(user_router.urls)),
    path("api/v1/tenants/", include("apps.tenants.urls")),
    path("api/v1/souls/", include("apps.souls.urls")),
    path("api/v1/judgment/", include("apps.judgment.urls")),
    path("api/v1/disposition/", include("apps.disposition.urls")),
    path("api/v1/karma/", include("apps.karma.urls")),
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
    # API docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
