from django.apps import AppConfig


class SocialConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.social"
    verbose_name = "Social"

    def ready(self):
        # Officer-deleted 朋友圈 posts and comments go to the global recycle bin
        # (maintainer decision, 2026-09-25), under the same rules as every other
        # reference type: restorable, hard-deletable after 30 days. A soul's own
        # delete is not listed and cannot be restored through the bin.
        from apps.core.recycle_bin import register_bin_type

        from .models import DELETED_BY_OFFICER, Comment, Post

        register_bin_type("social_post", Post, "reference", lambda p: p.content[:50], DELETED_BY_OFFICER)
        register_bin_type("social_comment", Comment, "reference", lambda c: c.content[:50], DELETED_BY_OFFICER)
