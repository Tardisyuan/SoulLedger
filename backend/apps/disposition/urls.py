from rest_framework import routers
from apps.disposition.views import DispositionViewSet

router = routers.DefaultRouter()
router.register("", DispositionViewSet, basename="disposition")
urlpatterns = router.urls
