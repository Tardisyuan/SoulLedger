"""
URL configuration for dispatch app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.dispatch.views import DispatchRecordViewSet, CrossTenantJudgmentViewSet

router = DefaultRouter()
router.register(r"records", DispatchRecordViewSet, basename="dispatch")

judgment_router = DefaultRouter()
judgment_router.register(r"cross-tenant-judgments", CrossTenantJudgmentViewSet, basename="cross-tenant-judgment")

urlpatterns = [
    path("", include(router.urls)),
    path("", include(judgment_router.urls)),
]