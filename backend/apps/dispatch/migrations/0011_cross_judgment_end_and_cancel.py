import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('dispatch', '0010_split_decision_reason_out_of_reason'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='crosstenantjudgment',
            name='conclusion_note',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='crosstenantjudgment',
            name='cancel_reason',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='crosstenantjudgment',
            name='ended_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cross_judgments_ended', to=settings.AUTH_USER_MODEL),
        ),
    ]
