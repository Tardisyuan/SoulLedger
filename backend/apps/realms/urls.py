from rest_framework import routers
from apps.realms.views import RealmViewSet

router = routers.DefaultRouter()
router.register("realms", RealmViewSet, basename="realm")
urlpatterns = router.urls
