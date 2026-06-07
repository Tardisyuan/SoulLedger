from rest_framework import routers

from apps.reincarnation.views import ReincarnationViewSet

router = routers.DefaultRouter()
router.register("", ReincarnationViewSet, basename="reincarnation")
urlpatterns = router.urls
