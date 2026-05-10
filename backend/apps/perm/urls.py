"""
Permission URL routing
"""
from django.urls import path
from . import views

app_name = "perm"

urlpatterns = [
    path("permissions/", views.list_permissions, name="list"),
    path("role-permissions/", views.get_role_permissions, name="role-permissions"),
    path("init/", views.init_permissions, name="init"),
]
