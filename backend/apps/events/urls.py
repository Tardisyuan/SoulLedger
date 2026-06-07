from rest_framework import routers

from apps.events.views import SoulEventViewSet

router = routers.DefaultRouter()
router.register("", SoulEventViewSet, basename="event")
urlpatterns = router.urls
