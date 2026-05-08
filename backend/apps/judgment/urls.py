"""
URL configuration for judgment app.
"""
from rest_framework import routers
from apps.judgment.views import JudgmentViewSet

router = routers.DefaultRouter()
router.register("", JudgmentViewSet, basename="judgment")
urlpatterns = router.urls
