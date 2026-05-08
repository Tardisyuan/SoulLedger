from rest_framework import routers
from apps.actors.views import ActorViewSet

router = routers.DefaultRouter()
router.register("actors", ActorViewSet, basename="actor")
urlpatterns = router.urls
