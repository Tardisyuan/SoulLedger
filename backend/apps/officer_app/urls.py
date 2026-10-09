from django.urls import path

from apps.officer_app import views

urlpatterns = [
    path("todo/", views.TodoView.as_view(), name="officer-app-todo"),
    path("items/<str:kind>/<uuid:item_id>/", views.TodoItemView.as_view(), name="officer-app-item"),
    path("items/<str:kind>/<uuid:item_id>/cosigners/", views.CosignView.as_view(), name="officer-app-cosign"),
    path("signer-candidates/", views.SignerCandidatesView.as_view(), name="officer-app-signer-candidates"),
    path("push-tokens/", views.PushTokenView.as_view(), name="officer-app-push-tokens"),
    path("push-tokens/unregister/", views.PushTokenUnregisterView.as_view(), name="officer-app-push-unregister"),
]
