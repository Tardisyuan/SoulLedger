"""灵魂朋友圈与官员审核后台的路由。

两份 urlpatterns 在同一个文件里,因为它们是同一条规则的两面:灵魂写、官员审。
挂载点在 `config/urls.py` —— `/api/v1/me/social/` 与 `/api/v1/social-moderation/`。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.social import soul_views as sv
from apps.social.moderation_views import (
    HandledContentViewSet,
    ModeratedCommentViewSet,
    ModeratedPostViewSet,
    ReportViewSet,
    SensitiveWordViewSet,
    SocialMuteViewSet,
)

me_social_urlpatterns = [
    path("status/", sv.MeSocialStatusView.as_view(), name="me-social-status"),
    path("feed/", sv.MeSocialFeedView.as_view(), name="me-social-feed"),
    path("posts/<uuid:post_id>/", sv.MeSocialPostView.as_view(), name="me-social-post"),
    path("posts/<uuid:post_id>/comments/", sv.MeSocialCommentsView.as_view(), name="me-social-comments"),
    path("posts/<uuid:post_id>/reaction/", sv.MeSocialReactionView.as_view(), name="me-social-reaction"),
    path("comments/<uuid:comment_id>/", sv.MeSocialCommentView.as_view(), name="me-social-comment"),
    path("profile/", sv.MeSocialMyProfileView.as_view(), name="me-social-my-profile"),
    path("search/", sv.MeSocialSearchView.as_view(), name="me-social-search"),
    path("following/", sv.MeSocialFollowingView.as_view(), name="me-social-following"),
    path("followers/", sv.MeSocialFollowersView.as_view(), name="me-social-followers"),
    path("users/<int:user_id>/", sv.MeSocialProfileView.as_view(), name="me-social-profile"),
    path("users/<int:user_id>/follow/", sv.MeSocialFollowView.as_view(), name="me-social-follow"),
    path("reports/", sv.MeSocialReportView.as_view(), name="me-social-report"),
]

moderation_router = DefaultRouter()
moderation_router.register(r"reports", ReportViewSet, basename="social-moderation-report")
moderation_router.register(r"posts", ModeratedPostViewSet, basename="social-moderation-post")
moderation_router.register(r"comments", ModeratedCommentViewSet, basename="social-moderation-comment")
moderation_router.register(r"sensitive-words", SensitiveWordViewSet, basename="social-moderation-word")
moderation_router.register(r"mutes", SocialMuteViewSet, basename="social-moderation-mute")
moderation_router.register(r"handled", HandledContentViewSet, basename="social-moderation-handled")

moderation_urlpatterns = [path("", include(moderation_router.urls))]
