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
from apps.chat import urls as chat_urls
from apps.core.health import HealthCheck, HealthCheckDetailed
from apps.core.recycle_bin_views import RecycleBinViewSet
from apps.social import soul_urls as social_urls
from apps.soul_accounts import urls as soul_account_urls

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
    # 受刑计划(docs/ARCHITECTURE-sentence-plan.md)。阶段 1 只读。
    path("api/v1/sentence-plans/", include("apps.sentence_plan.urls")),
    path("api/v1/death-sync/", include("apps.death_sync.urls")),
    path("api/v1/organizations/", include("apps.org.urls")),
    path("api/v1/social/", include("apps.social.urls")),
    path("api/v1/scheduler/", include("apps.scheduler.urls")),
    # 灵魂端(2026-09-17)。三段前缀对应三种调用者:官员管理灵魂账号、灵魂换令牌、
    # 灵魂读写本人数据。认证分界见 apps/soul_accounts/authentication.py。
    path("api/v1/soul-accounts/", include(soul_account_urls.officer_urlpatterns)),
    path("api/v1/soul-auth/", include(soul_account_urls.soul_auth_urlpatterns)),
    path("api/v1/me/", include(soul_account_urls.me_urlpatterns)),
    # 推送设备与偏好(apps/soul_push)。同一个 /me/ 前缀、同一个 SoulAPIView 分界。
    path("api/v1/me/", include("apps.soul_push.urls")),
    # 聊天(apps/chat)。灵魂侧同样在 /me/ 之下;/chat/ 是官员的殿司收件箱,走官员令牌。
    path("api/v1/me/", include(chat_urls.me_urlpatterns)),
    path("api/v1/chat/", include(chat_urls.officer_urlpatterns)),
    # 灵魂朋友圈(2026-09-17)。灵魂侧在 /me/ 之下,与上面两段同一条认证分界;
    # 官员审核后台是另一段前缀、另一套码名(social.moderate),两者不共用路由。
    path("api/v1/me/social/", include(social_urls.me_social_urlpatterns)),
    path("api/v1/social-moderation/", include(social_urls.moderation_urlpatterns)),
    # API docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

# Uploaded avatars under DEBUG. `static()` returns [] unless DEBUG is on; in
# production nginx serves /media/ from the shared volume and this adds nothing.
#
# THIS LINE WAS ONCE THE HOLE (BP-05). It used to sit here with neither setting
# defined, so Django's defaults applied: MEDIA_URL "/" and MEDIA_ROOT "" — the
# process's working directory. Under DEBUG that served `backend/` as a static
# tree: `GET /config/settings.py` answered 200, and `GET /.env` would have
# handed over the database and Redis credentials, unauthenticated. It was
# removed, and came back on 2026-09-14 only together with an explicit
# MEDIA_URL "/media/" and a MEDIA_ROOT of its own (config/settings.py).
# tests/test_debug_does_not_serve_the_source_tree.py runs a DEBUG child process
# and asserts both halves: the source tree is 404, and /media/ reaches
# MEDIA_ROOT and nothing beside it (django.views.static.serve joins with
# safe_join, so `..` cannot climb out).
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

