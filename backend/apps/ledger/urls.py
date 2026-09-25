from django.urls import path

from apps.ledger.views import (
    LedgerBalanceView,
    LedgerEffectiveView,
    LedgerExportStatsView,
    LedgerInheritanceView,
    LedgerJournalExportView,
    LedgerJournalView,
    LedgerOverviewStatsView,
    LedgerRecalculateView,
)

urlpatterns = [
    path("journal/", LedgerJournalView.as_view(), name="ledger-journal"),
    path("journal/export/", LedgerJournalExportView.as_view(), name="ledger-journal-export"),
    path("stats/overview/", LedgerOverviewStatsView.as_view(), name="ledger-stats-overview"),
    path("stats/export/", LedgerExportStatsView.as_view(), name="ledger-stats-export"),
    path("balance/<uuid:soul_id>/", LedgerBalanceView.as_view(), name="ledger-balance"),
    path("calculate/<uuid:soul_id>/", LedgerRecalculateView.as_view(), name="ledger-recalculate"),
    path("effective/<uuid:soul_id>/", LedgerEffectiveView.as_view(), name="ledger-effective"),
    path("inheritance/<uuid:soul_id>/", LedgerInheritanceView.as_view(), name="ledger-inheritance"),
]
