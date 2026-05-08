from rest_framework import routers
from apps.judgment.views import JudgmentViewSet

router = routers.DefaultRouter()
router.register("judgment", JudgmentViewSet, basename="judgment")
urlpatterns = router.urls
