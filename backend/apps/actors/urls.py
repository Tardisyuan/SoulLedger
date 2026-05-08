from rest_framework import routers
from apps.actors.views import ActorViewSet

router = routers.DefaultRouter()
router.register("", ActorViewSet, basename="actor")
urlpatterns = router.urls
