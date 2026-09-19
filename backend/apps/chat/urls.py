from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.chat import views

#: 灵魂侧,挂在 `/api/v1/me/` 之下(与 apps/soul_push 同一前缀、同一 SoulAPIView 分界)。
me_urlpatterns = [
    path("chat/session/", views.MeChatSessionView.as_view(), name="me-chat-session"),
    path("chat/conversations/", views.MeChatConversationsView.as_view(), name="me-chat-conversations"),
    path("chat/conversations/<uuid:conversation_id>/messages/", views.MeChatMessagesView.as_view(),
         name="me-chat-messages"),
    path("chat/lookup/", views.MeChatLookupView.as_view(), name="me-chat-lookup"),
]

officer_router = DefaultRouter()
officer_router.register(r"inbox", views.OfficerInboxViewSet, basename="soul-inbox")

#: 官员侧,挂在 `/api/v1/chat/`。
officer_urlpatterns = [
    # Synapse 模块的新消息回调:只认签名(apps/chat/hook.py),不认令牌。
    path("hooks/new-message/", views.ChatPushHookView.as_view(), name="chat-push-hook"),
    path("", include(officer_router.urls)),
]
