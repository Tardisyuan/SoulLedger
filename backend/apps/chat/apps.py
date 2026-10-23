from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.chat"
    verbose_name = "Soul chat (Matrix)"

    def ready(self):
        # images:删图片行时收文件的 post_delete 接收器;不在这里导入就只有 urls 加载后才挂上。
        from . import images, signals  # noqa: F401
