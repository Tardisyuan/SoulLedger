from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tenants', '0027_saga_dead_letters_and_claim_txn'),
    ]

    operations = [
        migrations.AddField(
            model_name='shardinbox',
            name='refused',
            field=models.BooleanField(default=False),
        ),
    ]
