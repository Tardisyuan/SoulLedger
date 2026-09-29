from django.urls import path

from apps.soul_assist import admin_views, views

#: 挂在 `/api/v1/me/` 之下(与 apps/chat、apps/soul_push 同一前缀、同一 SoulAPIView 分界)。
urlpatterns = [
    path("assist/", views.MeAssistView.as_view(), name="me-assist"),
    path("assist/conversations/", views.MeAssistConversationsView.as_view(), name="me-assist-conversations"),
    path("assist/conversations/<uuid:conversation_id>/", views.MeAssistConversationDetailView.as_view(),
         name="me-assist-conversation"),
]

#: 挂在 `/api/v1/assist/` 之下(官员令牌;不在 /me/ 下,那是灵魂令牌的前缀)。
officer_urlpatterns = [
    path("", views.OfficerAssistView.as_view(), name="officer-assist"),
    path("conversations/", views.OfficerAssistConversationsView.as_view(), name="officer-assist-conversations"),
    path("conversations/<uuid:conversation_id>/", views.OfficerAssistConversationDetailView.as_view(),
         name="officer-assist-conversation"),
]

#: 挂在 `/api/v1/assist-admin/` 之下:助手管理页,只许 ADMIN(docs/ARCHITECTURE-assist-admin.md)。
admin_urlpatterns = [
    path("config/", admin_views.ConfigView.as_view(), name="assist-admin-config"),
    path("config/test/", admin_views.ConfigTestView.as_view(), name="assist-admin-config-test"),
    path("halls/", admin_views.HallListView.as_view(), name="assist-admin-halls"),
    path("halls/<int:tenant_id>/", admin_views.HallDetailView.as_view(), name="assist-admin-hall"),
    path("eval/cases/", admin_views.EvalCaseListView.as_view(), name="assist-admin-eval-cases"),
    path("eval/cases/<int:pk>/", admin_views.EvalCaseDetailView.as_view(), name="assist-admin-eval-case"),
    path("eval/identities/", admin_views.EvalIdentitiesView.as_view(), name="assist-admin-eval-identities"),
    path("eval/preview/", admin_views.EvalPreviewView.as_view(), name="assist-admin-eval-preview"),
    path("eval/runs/", admin_views.EvalRunListView.as_view(), name="assist-admin-eval-runs"),
    path("eval/runs/<int:pk>/", admin_views.EvalRunDetailView.as_view(), name="assist-admin-eval-run"),
    path("try/", admin_views.TryView.as_view(), name="assist-admin-try"),
    path("usage/", admin_views.UsageView.as_view(), name="assist-admin-usage"),
    path("corpus/", admin_views.CorpusView.as_view(), name="assist-admin-corpus"),
    path("embedding/", admin_views.EmbeddingView.as_view(), name="assist-admin-embedding"),
    path("embedding/test/", admin_views.EmbeddingTestView.as_view(), name="assist-admin-embedding-test"),
    path("embedding/rebuild/", admin_views.EmbeddingRebuildView.as_view(), name="assist-admin-embedding-rebuild"),
]
