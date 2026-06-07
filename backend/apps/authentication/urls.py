"""
Auth URL routes.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    LoginLogViewSet,
    LoginView,
    RefreshView,
    change_password,
    logout_view,
    profile_view,
    register_view,
    reset_password_request,
    set_new_password,
)

router = DefaultRouter()
router.register(r"login-logs", LoginLogViewSet, basename="login-logs")

urlpatterns = [
    path("register/", register_view, name="register"),
    path("login/", LoginView.as_view(), name="login"),
    path("refresh/", RefreshView.as_view(), name="token_refresh"),
    path("logout/", logout_view, name="logout"),
    path("profile/", profile_view, name="profile"),
    path("change-password/", change_password, name="change-password"),
    path("reset-password/", reset_password_request, name="reset-password"),
    path("set-new-password/", set_new_password, name="set-new-password"),
    path("", include(router.urls)),
]
