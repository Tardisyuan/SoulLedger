import logging

from django.apps import AppConfig
from django.conf import settings

logger = logging.getLogger(__name__)

#: 与 `MATRIX_JWT_SECRET`(Synapse 登录)分开的两把(审计 2026-11-11 A2-07)。没设时各自退回
#: `MATRIX_JWT_SECRET` —— 过渡用,让已部署的环境不改配置照常运行;上线前必须分别设置。
SPLIT_SECRETS = ("MATRIX_HOOK_SECRET", "MATRIX_GRANT_SECRET")


def secrets_falling_back():
    """开着聊天、却还在退回 `MATRIX_JWT_SECRET` 的那几项。"""
    if not settings.MATRIX_ENABLED:
        return []
    return [name for name in SPLIT_SECRETS if not getattr(settings, name, "")]


class ChatConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.chat"
    verbose_name = "Soul chat (Matrix)"

    def ready(self):
        # images:删图片行时收文件的 post_delete 接收器;不在这里导入就只有 urls 加载后才挂上。
        from . import images, signals  # noqa: F401

        fallback = secrets_falling_back()
        if fallback:
            logger.warning("chat: %s 未设置,退回 MATRIX_JWT_SECRET(一把密钥三种用途);上线前必须分别设置 —— "
                           "见 docs/DEPLOYMENT.md「灵魂聊天」", "、".join(fallback))
