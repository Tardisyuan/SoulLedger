"""
URL configuration for workflow app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.workflow.views import ApprovalWorkflowViewSet, ApprovalNodeViewSet, WorkflowTemplateViewSet

router = DefaultRouter()
router.register(r"workflows", ApprovalWorkflowViewSet, basename="approval-workflow")
router.register(r"nodes", ApprovalNodeViewSet, basename="approval-node")
router.register(r"workflow/templates", WorkflowTemplateViewSet, basename="workflow-template")

urlpatterns = [
    path("", include(router.urls)),
]
