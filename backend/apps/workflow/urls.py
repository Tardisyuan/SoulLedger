"""
URL configuration for workflow app.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.workflow.views import ApprovalNodeViewSet, ApprovalWorkflowViewSet, WorkflowTemplateViewSet

router = DefaultRouter()
router.register(r"workflows", ApprovalWorkflowViewSet, basename="approval-workflow")
router.register(r"nodes", ApprovalNodeViewSet, basename="approval-node")
router.register(r"workflow/templates", WorkflowTemplateViewSet, basename="workflow-template")

urlpatterns = [
    path("", include(router.urls)),
]
