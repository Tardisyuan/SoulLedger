"""
URL configuration for death_sync app.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.death_sync.views import (
    AdminWebhookDeliveryViewSet,
    AdminWebhookViewSet,
    DeathRegistrationReadViewSet,
    DeathRegistrationViewSet,
    DeathSyncHealthView,
    ExternalApiKeyViewSet,
    WebhookViewSet,
)

router = DefaultRouter()
router.register(r'api-keys', ExternalApiKeyViewSet, basename='api-key')
router.register(r'register', DeathRegistrationViewSet, basename='death-register')
# Browser-facing read of the same rows. `register/` replaces
# authentication_classes with APIKeyAuthentication and so answers 401 to
# every JWT -- the /death-sync page was calling it and showed an empty
# state to everyone, ADMIN included.
router.register(
    r'registrations', DeathRegistrationReadViewSet, basename='death-registration'
)
router.register(r'webhooks', WebhookViewSet, basename='webhook')
# Browser-facing management of the same rows, plus their delivery log.
# `webhooks/` is the external system's self-service door (API key only) and
# answers 401 to every JWT; these two are the operator's (JWT, ADMIN).
router.register(r'admin-webhooks', AdminWebhookViewSet, basename='admin-webhook')
router.register(
    r'webhook-deliveries', AdminWebhookDeliveryViewSet, basename='webhook-delivery'
)

urlpatterns = [
    path('', include(router.urls)),
    path('health/', DeathSyncHealthView.as_view(), name='death-sync-health'),
]
