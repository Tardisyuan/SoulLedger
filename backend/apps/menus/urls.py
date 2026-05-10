"""
Menu URL routing
"""
from django.urls import path
from . import views

app_name = "menus"

urlpatterns = [
    path("", views.list_menus, name="list"),
    path("all/", views.all_menus, name="all"),
    path("create/", views.create_menu, name="create"),
    path("<int:pk>/", views.update_delete_menu, name="detail"),
]
