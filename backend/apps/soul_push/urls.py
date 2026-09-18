from django.urls import path

from apps.soul_push import views

urlpatterns = [
    path("push-tokens/", views.MePushTokensView.as_view(), name="me-push-tokens"),
    path("push-tokens/unregister/", views.MePushTokenUnregisterView.as_view(), name="me-push-token-unregister"),
    path("notification-settings/", views.MeNotificationSettingsView.as_view(), name="me-notification-settings"),
]
