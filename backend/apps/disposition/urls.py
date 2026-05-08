from rest_framework import routers
from apps.disposition.views import DispositionViewSet

router = routers.DefaultRouter()
router.register("disposition", DispositionViewSet, basename="disposition")
urlpatterns = router.urls
