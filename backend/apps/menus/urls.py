"""
Menu URL routing
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

app_name = "menus"

router = DefaultRouter()
router.register(r"", views.MenuViewSet, basename="menu")

urlpatterns = [
    path("", include(router.urls)),
]
