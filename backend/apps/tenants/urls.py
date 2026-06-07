from rest_framework.routers import DefaultRouter

from apps.tenants.views import TenantViewSet

router = DefaultRouter()
router.register("", TenantViewSet, basename="tenant")

urlpatterns = router.urls
