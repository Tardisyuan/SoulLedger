"""
Auth URL routes.
"""
from django.urls import path
from .views import LoginView, RefreshView, logout_view, register_view, profile_view

urlpatterns = [
    path("register/", register_view, name="register"),
    path("login/", LoginView.as_view(), name="login"),
    path("refresh/", RefreshView.as_view(), name="token_refresh"),
    path("logout/", logout_view, name="logout"),
    path("profile/", profile_view, name="profile"),
]
