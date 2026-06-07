"""
Organization URL routing.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.org.views import OrganizationViewSet

router = DefaultRouter()
router.register(r'', OrganizationViewSet, basename='organization')

urlpatterns = [
    path('', include(router.urls)),
]
