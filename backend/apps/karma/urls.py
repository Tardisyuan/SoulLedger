from django.urls import path
from apps.karma.views import KarmaBalanceView, KarmaRecalculateView

urlpatterns = [
    path("balance/<uuid:soul_id>/", KarmaBalanceView.as_view(), name="karma-balance"),
    path("calculate/<uuid:soul_id>/", KarmaRecalculateView.as_view(), name="karma-recalculate"),
]
