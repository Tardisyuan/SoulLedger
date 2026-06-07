"""
Menu URL routing — includes MenuButton ViewSet.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

app_name = "menus"

router = DefaultRouter()
router.register(r"buttons", views.MenuButtonViewSet, basename="menu-button")
router.register(r"", views.MenuViewSet, basename="menu")

urlpatterns = [
    path("", include(router.urls)),
]
