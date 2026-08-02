"""
Permission URL routing
"""
from django.urls import path

from . import views

app_name = "perm"

urlpatterns = [
    path("permissions/", views.list_permissions, name="list"),
    path("permissions/create/", views.create_permission, name="create"),
    path("permissions/<int:pk>/", views.update_delete_permission, name="detail"),
    path("role-permissions/", views.get_role_permissions, name="role-permissions"),
    path("role-permissions/assign/", views.assign_role_permissions, name="assign"),
    path("role-permissions/init/", views.init_role_permissions, name="init-role-permissions"),
    path("roles/", views.list_roles, name="list-roles"),
    path("roles/create/", views.create_role, name="create-role"),
    # Declared before the <int:pk> detail route so "create"/"init" style
    # segments keep matching their literal paths above.
    path(
        "roles/<str:name>/permissions/",
        views.get_permissions_for_role,
        name="role-permissions-detail",
    ),
    path("roles/<int:pk>/", views.update_delete_role, name="detail-role"),
    path("roles/init/", views.init_roles, name="init-roles"),
    path("init/", views.init_permissions, name="init"),
    path("export/", views.export_permissions, name="export"),
    path("import/", views.import_permissions, name="import"),
]
