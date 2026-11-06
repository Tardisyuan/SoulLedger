"""Rename ``EU_PLATO_MEADOW`` to ``GR_PLATO_MEADOW`` (user decision 2026-11-07).

The meadow of Gorgias 524a has been GREEK since realms/0018; its code kept the
``EU_`` prefix only because renaming a realm_code is a join-key change. The user
decided the code should say what owns it, so this migration moves every place
the string is stored, the way realms/0015 did for ``EG_DEVOURER``:

1. ``Realm.realm_code`` — renamed in place; the row keeps its pk, so every
   ForeignKey (``SoulPathEntry.realm``, ``Disposition.destination_realm``,
   ``Actor.realm``, ``Judgment.realm``, ``parent_realm`` …) follows untouched.
2. Plain-text columns holding a realm code, which do NOT follow a rename:
   ``Reincarnation.target_realm`` / ``previous_realm``, ``SentenceNode.realm_code``,
   ``CrossTenantJudgmentParticipant.sentence_realm_code``.
3. JSON that quotes the code: ``SoulEvent.payload`` (timeline events),
   ``Statute.payload_json`` (``meadow_realm_code`` / ``venue_realm_code``),
   ``SentencePlanRequest.changes`` and ``SoulCensusSnapshot.by_realm`` keys.

``EventWebhookDelivery.payload_json`` is left alone on purpose: it is the record
of what was already sent to a subscriber, and rewriting it would falsify that.

Reversible: ``backwards`` runs the same rewrite with the codes swapped. Rows
access goes through ``_base_manager`` (no tenant in context under a migration).
"""
import json

from django.db import migrations

OLD_CODE = "EU_PLATO_MEADOW"
NEW_CODE = "GR_PLATO_MEADOW"

TEXT_COLUMNS = [
    ("realms", "Realm", "realm_code"),
    ("reincarnation", "Reincarnation", "target_realm"),
    ("reincarnation", "Reincarnation", "previous_realm"),
    ("sentence_plan", "SentenceNode", "realm_code"),
    ("dispatch", "CrossTenantJudgmentParticipant", "sentence_realm_code"),
]

JSON_COLUMNS = [
    ("events", "SoulEvent", "payload"),
    ("judgment", "Statute", "payload_json"),
    ("sentence_plan", "SentencePlanRequest", "changes"),
    ("ledger", "SoulCensusSnapshot", "by_realm"),
]


def _rename(apps, alias, old, new):
    for app, model, field in TEXT_COLUMNS:
        manager = apps.get_model(app, model)._base_manager.using(alias)
        manager.filter(**{field: old}).update(**{field: new})

    for app, model, field in JSON_COLUMNS:
        cls = apps.get_model(app, model)
        manager = cls._base_manager.using(alias)
        # ponytail: whole-table scan in Python; the string is a unique realm code,
        # so a textual replace cannot hit anything else. Fine at test-environment size.
        for pk, value in manager.values_list("pk", field).iterator():
            text = json.dumps(value, ensure_ascii=False)
            if old in text:
                manager.filter(pk=pk).update(**{field: json.loads(text.replace(old, new))})


def forwards(apps, schema_editor):
    _rename(apps, schema_editor.connection.alias, OLD_CODE, NEW_CODE)


def backwards(apps, schema_editor):
    _rename(apps, schema_editor.connection.alias, NEW_CODE, OLD_CODE)


class Migration(migrations.Migration):

    dependencies = [
        ("realms", "0031_realm_names_follow_the_docs"),
        ("reincarnation", "0014_rebirth_continent"),
        ("sentence_plan", "0002_relax_home_node_first"),
        ("dispatch", "0014_backfill_source_owner_org"),
        ("events", "0032_workflow_terminated"),
        ("judgment", "0051_v4_fail_reasons_deadline_doc_tz"),
        ("ledger", "0003_soul_census_snapshot"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
