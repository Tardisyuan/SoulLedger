"""
URL configuration for SoulLedger project.
"""
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/", include("apps.authentication.urls")),
    path("api/v1/souls/", include("apps.souls.urls")),
    path("api/v1/judgment/", include("apps.judgment.urls")),
    path("api/v1/disposition/", include("apps.disposition.urls")),
    path("api/v1/karma/", include("apps.karma.urls")),
    path("api/v1/reincarnation/", include("apps.reincarnation.urls")),
    path("api/v1/realms/", include("apps.realms.urls")),
    path("api/v1/actors/", include("apps.actors.urls")),
    path("api/v1/events/", include("apps.events.urls")),
]
