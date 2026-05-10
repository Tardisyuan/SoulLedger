"""
Audit URL routing
"""
from django.urls import path
from . import views

app_name = "audit"

urlpatterns = [
    path("", views.list_audit_logs, name="list"),
    path("create/", views.create_audit_log, name="create"),
]
