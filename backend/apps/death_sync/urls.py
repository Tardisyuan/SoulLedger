"""
URL configuration for death_sync app.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.death_sync.views import (
    DeathRegistrationViewSet,
    DeathSyncHealthView,
    ExternalApiKeyViewSet,
    WebhookViewSet,
)

router = DefaultRouter()
router.register(r'api-keys', ExternalApiKeyViewSet, basename='api-key')
router.register(r'register', DeathRegistrationViewSet, basename='death-register')
router.register(r'webhooks', WebhookViewSet, basename='webhook')

urlpatterns = [
    path('', include(router.urls)),
    path('health/', DeathSyncHealthView.as_view(), name='death-sync-health'),
]
