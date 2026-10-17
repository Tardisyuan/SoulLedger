# 第四十批 S-c:推送设置加「朋友圈」一组(评论和回复、审核结果)。手写,与 models.PushPreference 逐字对应。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("soul_push", "0004_push_device_session"),
    ]

    operations = [
        migrations.AddField(
            model_name="pushpreference",
            name="social_comments",
            field=models.BooleanField(default=True, help_text="朋友圈:别人评论了我的帖子、回复了我的评论"),
        ),
        migrations.AddField(
            model_name="pushpreference",
            name="social_review",
            field=models.BooleanField(default=True, help_text="朋友圈:我的帖子 / 评论的审核结果(隐藏、删除、通过、恢复)"),
        ),
    ]
