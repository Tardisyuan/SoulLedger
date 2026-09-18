from rest_framework import routers

from apps.sentence_plan.views import SentencePlanViewSet

router = routers.DefaultRouter()
router.register("", SentencePlanViewSet, basename="sentence-plan")
urlpatterns = router.urls
