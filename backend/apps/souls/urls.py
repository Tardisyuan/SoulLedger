from rest_framework import routers
from apps.souls.views import SoulViewSet

router = routers.DefaultRouter()
router.register("souls", SoulViewSet, basename="soul")
urlpatterns = router.urls
