from rest_framework import routers
from apps.realms.views import RealmViewSet

router = routers.DefaultRouter()
router.register("", RealmViewSet, basename="realm")
urlpatterns = router.urls
