"""
Audit URL routing
"""
from rest_framework.routers import DefaultRouter
from .views import AuditLogViewSet

app_name = "audit"

router = DefaultRouter()
router.register("", AuditLogViewSet, basename="audit-log")

urlpatterns = router.urls
