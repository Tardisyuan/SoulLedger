"""
Auth URL routes.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import mfa_views
from .views import (
    LoginLogViewSet,
    LoginView,
    RefreshView,
    change_password,
    civilizations_view,
    logout_view,
    password_help_request,
    preferences_view,
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
    path("profile/preferences/", preferences_view, name="preferences"),
    path("civilizations/", civilizations_view, name="civilizations"),
    path("password-help/", password_help_request, name="password-help"),
    path("change-password/", change_password, name="change-password"),
    path("reset-password/", reset_password_request, name="reset-password"),
    path("set-new-password/", set_new_password, name="set-new-password"),
    # 两步验证(A12)。见 mfa_views.py 的模块注释。
    path("mfa/verify/", mfa_views.verify_view, name="mfa-verify"),
    path("mfa/status/", mfa_views.status_view, name="mfa-status"),
    path("mfa/setup/", mfa_views.setup_view, name="mfa-setup"),
    path("mfa/confirm/", mfa_views.confirm_view, name="mfa-confirm"),
    path("mfa/complete/", mfa_views.complete_view, name="mfa-complete"),
    path("mfa/recovery-codes/", mfa_views.recovery_codes_view, name="mfa-recovery-codes"),
    path("mfa/disable/", mfa_views.disable_view, name="mfa-disable"),
    path("", include(router.urls)),
]
