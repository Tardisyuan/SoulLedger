from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.scheduler.views import ScheduledJobViewSet, TaskRunViewSet

router = DefaultRouter()
router.register(r"jobs", ScheduledJobViewSet, basename="scheduler-job")
router.register(r"runs", TaskRunViewSet, basename="scheduler-run")

urlpatterns = [
    path("", include(router.urls)),
]
