from django.contrib import admin

from apps.realms.models import Realm


@admin.register(Realm)
class RealmAdmin(admin.ModelAdmin):
    list_display = ["realm_code", "name_en", "civilization", "realm_type", "tier", "is_eternal"]
    list_filter = ["civilization", "realm_type"]
    search_fields = ["realm_code", "name_en", "name_local"]
    ordering = ["civilization", "tier"]
