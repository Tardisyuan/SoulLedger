"""
URL configuration for the social domain.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.social.views import (
    CommentViewSet,
    FollowViewSet,
    PostMediaItemView,
    PostMediaUploadView,
    PostViewSet,
    ReactionViewSet,
    UserProfileViewSet,
)

router = DefaultRouter()
router.register(r"posts", PostViewSet, basename="social-post")
router.register(r"comments", CommentViewSet, basename="social-comment")
router.register(r"reactions", ReactionViewSet, basename="social-reaction")
router.register(r"follows", FollowViewSet, basename="social-follow")
router.register(r"profiles", UserProfileViewSet, basename="social-profile")

urlpatterns = [
    path("media/", PostMediaUploadView.as_view(), name="social-media-upload"),
    path("media/<uuid:media_id>/", PostMediaItemView.as_view(), name="social-media-item"),
    path("", include(router.urls)),
]
