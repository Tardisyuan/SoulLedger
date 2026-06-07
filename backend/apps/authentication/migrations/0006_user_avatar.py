# Generated manually for avatar field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('authentication', '0005_user_delete_reason_user_deleted_at_user_deleted_by_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='avatar',
            field=models.ImageField(blank=True, null=True, upload_to='avatars/%Y/%m/'),
        ),
    ]
