"""
Add signed year/month/day columns for BC-capable dates.

These sit alongside the existing birth_date/death_date/event_date
DateFields for now; 0020 copies data across and 0021 drops the old
columns. Splitting into three migrations keeps each step independently
reversible and lets the data migration run against a stable schema.
"""
import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('souls', '0018_alter_soul_managers'),
    ]

    operations = [
        migrations.AddField(
            model_name='soul',
            name='birth_year',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='soul',
            name='birth_month',
            field=models.SmallIntegerField(
                blank=True, null=True,
                validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(12)],
            ),
        ),
        migrations.AddField(
            model_name='soul',
            name='birth_day',
            field=models.SmallIntegerField(
                blank=True, null=True,
                validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(31)],
            ),
        ),
        migrations.AddField(
            model_name='soul',
            name='death_year',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='soul',
            name='death_month',
            field=models.SmallIntegerField(
                blank=True, null=True,
                validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(12)],
            ),
        ),
        migrations.AddField(
            model_name='soul',
            name='death_day',
            field=models.SmallIntegerField(
                blank=True, null=True,
                validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(31)],
            ),
        ),
        migrations.AddField(
            model_name='soulrecord',
            name='event_year',
            field=models.IntegerField(blank=True, help_text='Signed year the event occurred, e.g. -612 = 612 BCE', null=True),
        ),
        migrations.AddField(
            model_name='soulrecord',
            name='event_month',
            field=models.SmallIntegerField(
                blank=True, null=True,
                validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(12)],
            ),
        ),
        migrations.AddField(
            model_name='soulrecord',
            name='event_day',
            field=models.SmallIntegerField(
                blank=True, null=True,
                validators=[django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(31)],
            ),
        ),
    ]
