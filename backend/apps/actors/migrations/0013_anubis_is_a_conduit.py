"""Anubis: JUDGE → CONDUIT on rows already seeded (docs/01_埃及冥界整体架构.md §1.2: 「他不是判官，他是执秤者」).

`seed_mythology` is create-only by default, so the corrected row in `actors_egyptian.py` reaches new halls only;
this moves the existing ones. Only Egyptian rows named Anubis still on JUDGE are touched, and the reverse puts
back only rows still on CONDUIT. Seats already held on a cross-hall bench are left as they are.
"""
from django.db import migrations


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    Actor.all_objects.using(alias).filter(civilization="EGYPTIAN", name="Anubis", role="JUDGE").update(role="CONDUIT")


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    Actor.all_objects.using(alias).filter(civilization="EGYPTIAN", name="Anubis", role="CONDUIT").update(role="JUDGE")


class Migration(migrations.Migration):
    dependencies = [
        ("actors", "0012_retire_the_pantheon_the_corpus_does_not_name"),
    ]
    operations = [migrations.RunPython(forward, backward)]
