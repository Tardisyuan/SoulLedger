from rest_framework import routers
from apps.souls.views import SoulViewSet

router = routers.DefaultRouter()
router.register("", SoulViewSet, basename="soul")
urlpatterns = router.urls
