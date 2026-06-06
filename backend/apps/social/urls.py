"""
URL configuration for the social domain.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.social.views import (
    PostViewSet,
    CommentViewSet,
    ReactionViewSet,
    FollowViewSet,
    UserProfileViewSet,
)

router = DefaultRouter()
router.register(r"posts", PostViewSet, basename="social-post")
router.register(r"comments", CommentViewSet, basename="social-comment")
router.register(r"reactions", ReactionViewSet, basename="social-reaction")
router.register(r"follows", FollowViewSet, basename="social-follow")
router.register(r"profiles", UserProfileViewSet, basename="social-profile")

urlpatterns = [
    path("", include(router.urls)),
]
