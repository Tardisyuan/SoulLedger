"""
URL configuration for judgment app.
"""
from django.urls import path
from rest_framework import routers

from apps.judgment.appeal_views import JudgmentAppealViewSet
from apps.judgment.city_god_views import CityGodCaseViewSet, CityGodViewSet
from apps.judgment.handover_views import HandoverCommitView, HandoverOfficersView, HandoverPreviewView
from apps.judgment.views import JudgmentViewSet, StatuteViewSet
from apps.judgment.wangsi_views import WangsiViewSet

router = routers.DefaultRouter()
# `statutes` MUST be registered before the judgment viewset. JudgmentViewSet is
# mounted at the empty prefix, so its detail route is `^(?P<pk>[^/.]+)/$` — a
# pattern that happily matches the literal segment `statutes/`. Router order is
# URL order, so registering statutes second would make every request to
# /api/v1/judgment/statutes/ resolve to "retrieve the judgment whose pk is
# 'statutes'", i.e. a 404 that looks like missing data rather than a routing
# mistake.
router.register("statutes", StatuteViewSet, basename="statute")
# 同上:`appeals` 也在空前缀的审判之前。
router.register("appeals", JudgmentAppealViewSet, basename="judgment-appeal")
router.register("city-gods", CityGodViewSet, basename="city-god")
router.register("city-god-cases", CityGodCaseViewSet, basename="city-god-case")
router.register("wangsi", WangsiViewSet, basename="judgment-wangsi")
router.register("", JudgmentViewSet, basename="judgment")
# 交接在路由之前:空前缀的详情路由会把 `handover/` 当成一件审判的 pk。
urlpatterns = [
    path("handover/preview/", HandoverPreviewView.as_view(), name="judgment-handover-preview"),
    path("handover/officers/", HandoverOfficersView.as_view(), name="judgment-handover-officers"),
    path("handover/", HandoverCommitView.as_view(), name="judgment-handover"),
    *router.urls,
]
