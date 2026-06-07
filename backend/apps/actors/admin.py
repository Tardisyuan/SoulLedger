from django.contrib import admin

from apps.actors.models import Actor


@admin.register(Actor)
class ActorAdmin(admin.ModelAdmin):
    list_display = ["name", "civilization", "role", "realm", "is_active"]
    list_filter = ["civilization", "role", "is_active"]
    search_fields = ["name", "title"]
