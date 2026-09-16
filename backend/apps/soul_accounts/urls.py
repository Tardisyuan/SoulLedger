from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.soul_accounts import me_views
from apps.soul_accounts.views import (
    InitialCredentialViewSet,
    OfficerRebirthApplicationViewSet,
    SoulAccountViewSet,
)

officer_router = DefaultRouter()
officer_router.register(r"accounts", SoulAccountViewSet, basename="soul-account")
officer_router.register(r"credentials", InitialCredentialViewSet, basename="soul-credential")
officer_router.register(r"rebirth-applications", OfficerRebirthApplicationViewSet, basename="soul-rebirth-application")

officer_urlpatterns = [path("", include(officer_router.urls))]

soul_auth_urlpatterns = [
    path("login/", me_views.SoulLoginView.as_view(), name="soul-login"),
    path("refresh/", me_views.SoulRefreshView.as_view(), name="soul-refresh"),
    path("logout/", me_views.SoulLogoutView.as_view(), name="soul-logout"),
]

me_urlpatterns = [
    path("", me_views.MeView.as_view(), name="me"),
    path("password/", me_views.MePasswordView.as_view(), name="me-password"),
    path("life/", me_views.MeLifeView.as_view(), name="me-life"),
    path("past-lives/", me_views.MePastLivesView.as_view(), name="me-past-lives"),
    path("rebirth-applications/", me_views.MeRebirthApplicationsView.as_view(), name="me-rebirth-applications"),
    path("rebirth-applications/<uuid:application_id>/", me_views.MeRebirthApplicationDetailView.as_view(),
         name="me-rebirth-application"),
    path("rebirth-applications/<uuid:application_id>/appeal/", me_views.MeRebirthAppealView.as_view(),
         name="me-rebirth-appeal"),
]
