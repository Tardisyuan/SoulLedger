"""Dante's Minos: JUDGE → CONDUIT on rows already seeded (user 2026-10-28; Christ is the only European JUDGE,
docs/01_欧洲天堂地狱整体架构.md v2.1, docs/02_天使九级 hierarchy.md §四).

`seed_mythology` is create-only by default, so the corrected row in `actors_european.py` reaches new halls only;
this moves the existing ones. Only EUROPEAN rows named Minos still on JUDGE are touched — Plato's Minos is GREEK
and stays JUDGE — and the reverse puts back only rows still on CONDUIT. Seats already held on a cross-hall bench
are left as they are (same as 0013).
"""
from django.db import migrations


def forward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    Actor.all_objects.using(alias).filter(civilization="EUROPEAN", name="Minos", role="JUDGE").update(role="CONDUIT")


def backward(apps, schema_editor):
    alias = schema_editor.connection.alias
    Actor = apps.get_model("actors", "Actor")
    Actor.all_objects.using(alias).filter(civilization="EUROPEAN", name="Minos", role="CONDUIT").update(role="JUDGE")


class Migration(migrations.Migration):
    dependencies = [
        ("actors", "0013_anubis_is_a_conduit"),
    ]
    operations = [migrations.RunPython(forward, backward)]
