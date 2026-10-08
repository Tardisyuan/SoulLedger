"""给已经打开邮件通知、却没有 `preferences.email_opted_at` 的官员补上这个时刻。

此前打开开关才会写它(`authentication/views.py` PATCH 偏好),更早打开的老账号没有,邮件任务对他们退回
「24 小时内」窗口(`notifications/tasks.py::_opted_since`)。补成**迁移那一刻**之后,老账号与新账号同一条规则:
只发开关之后产生的通知,不再依赖一个滑动的 24 小时窗口。

可逆:补的同时写一个标记 `email_opted_backfilled`,反向只删带标记的人的这两个键 —— 不碰自己打开开关而
有真实时刻的账号。标记与时刻同生同灭;之后用户关了再开,视图会重写时刻并去掉标记(见 views.py),
反向就不会误删那个真实时刻。
"""
from django.db import migrations
from django.utils import timezone


def stamp(apps, schema_editor):
    User = apps.get_model("authentication", "User")
    now = timezone.now().isoformat()
    for user in User._base_manager.filter(preferences__email_notifications=True):
        prefs = user.preferences or {}
        if prefs.get("email_opted_at"):
            continue
        user.preferences = {**prefs, "email_opted_at": now, "email_opted_backfilled": True}
        user.save(update_fields=["preferences"])


def unstamp(apps, schema_editor):
    User = apps.get_model("authentication", "User")
    for user in User._base_manager.filter(preferences__email_opted_backfilled=True):
        prefs = dict(user.preferences or {})
        prefs.pop("email_opted_at", None)
        prefs.pop("email_opted_backfilled", None)
        user.preferences = prefs
        user.save(update_fields=["preferences"])


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0017_user_preferences"),
    ]

    operations = [migrations.RunPython(stamp, unstamp)]
