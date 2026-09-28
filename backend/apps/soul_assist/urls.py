from django.urls import path

from apps.soul_assist import views

#: 挂在 `/api/v1/me/` 之下(与 apps/chat、apps/soul_push 同一前缀、同一 SoulAPIView 分界)。
urlpatterns = [
    path("assist/", views.MeAssistView.as_view(), name="me-assist"),
    path("assist/conversations/", views.MeAssistConversationsView.as_view(), name="me-assist-conversations"),
    path("assist/conversations/<uuid:conversation_id>/", views.MeAssistConversationDetailView.as_view(),
         name="me-assist-conversation"),
]
