from django.urls import path
from apps.karma.views import (
    KarmaBalanceView,
    KarmaRecalculateView,
    KarmaEffectiveView,
    KarmaInheritanceView,
    KarmaOverviewStatsView,
)

urlpatterns = [
    path("stats/overview/", KarmaOverviewStatsView.as_view(), name="karma-stats-overview"),
    path("balance/<uuid:soul_id>/", KarmaBalanceView.as_view(), name="karma-balance"),
    path("calculate/<uuid:soul_id>/", KarmaRecalculateView.as_view(), name="karma-recalculate"),
    path("effective/<uuid:soul_id>/", KarmaEffectiveView.as_view(), name="karma-effective"),
    path("inheritance/<uuid:soul_id>/", KarmaInheritanceView.as_view(), name="karma-inheritance"),
]
