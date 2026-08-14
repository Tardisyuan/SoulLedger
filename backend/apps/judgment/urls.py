"""
URL configuration for judgment app.
"""
from rest_framework import routers

from apps.judgment.views import JudgmentViewSet, StatuteViewSet

router = routers.DefaultRouter()
# `statutes` MUST be registered before the judgment viewset. JudgmentViewSet is
# mounted at the empty prefix, so its detail route is `^(?P<pk>[^/.]+)/$` — a
# pattern that happily matches the literal segment `statutes/`. Router order is
# URL order, so registering statutes second would make every request to
# /api/v1/judgment/statutes/ resolve to "retrieve the judgment whose pk is
# 'statutes'", i.e. a 404 that looks like missing data rather than a routing
# mistake.
router.register("statutes", StatuteViewSet, basename="statute")
router.register("", JudgmentViewSet, basename="judgment")
urlpatterns = router.urls
