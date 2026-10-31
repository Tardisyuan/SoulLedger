"""source_payload moves from a jsonb column holding a JSON *string scalar* to a text column (review 2026-10-31 A2).

`EncryptedJSONField` (a JSONField) JSON-encoded its own JSON text / Fernet token a second time. After the
AlterField the column is text, cast from jsonb, and holds one of three shapes, all converted without the key:

    "\"gAAAA...\""      double-encoded token        -> gAAAA...       (the token)
    "\"{\\\"a\\\": 1}\"" double-encoded plain JSON   -> {"a": 1}       (written while DEBUG ran without a key)
    {"a": 1}            an object (before 0002 / by hand) -> unchanged

i.e. a value that parses as a JSON string is unwrapped once; anything else stays. The reverse wraps a token back
into a JSON string and leaves plain JSON as it is — an object, which the old field read correctly with or without
a key (the double-encoded plain shape it does not read; it is not restored, only its value is).

Raw SQL on the migrated connection: the model's own field would decrypt with whatever key this process has.
"""
import json

from django.db import migrations

from apps.death_sync.encrypted_json import EncryptedJSONTextField


def _encrypted_columns(apps):
    """Every column of this field type, whichever model carries it."""
    for model in apps.get_models():
        for field in model._meta.concrete_fields:
            if isinstance(field, EncryptedJSONTextField):
                yield model._meta.db_table, model._meta.pk.column, field.column


def _rewrite(apps, schema_editor, convert):
    db = schema_editor.connection
    q = db.ops.quote_name
    for table, pk, column in _encrypted_columns(apps):
        with db.cursor() as cursor:
            cursor.execute(f"SELECT {q(pk)}, {q(column)} FROM {q(table)} WHERE {q(column)} IS NOT NULL")
            rows = cursor.fetchall()
            for key, stored in rows:
                new = convert(stored)
                if new != stored:
                    cursor.execute(f"UPDATE {q(table)} SET {q(column)} = %s WHERE {q(pk)} = %s", [new, key])


def _unwrap(stored):
    try:
        value = json.loads(stored)
    except json.JSONDecodeError:
        return stored  # already a bare token
    return value if isinstance(value, str) else stored


def _wrap(stored):
    try:
        json.loads(stored)
    except json.JSONDecodeError:
        return json.dumps(stored)  # a token: jsonb only takes it as a JSON string
    return stored


def forward(apps, schema_editor):
    _rewrite(apps, schema_editor, _unwrap)


def backward(apps, schema_editor):
    _rewrite(apps, schema_editor, _wrap)


class Migration(migrations.Migration):

    dependencies = [
        ("death_sync", "0009_drop_unwritten_statuses"),
    ]

    operations = [
        migrations.AlterField(
            model_name="deathregistrationrequest",
            name="source_payload",
            field=EncryptedJSONTextField(
                help_text="Original request payload (encrypted at rest)"
            ),
        ),
        migrations.RunPython(forward, backward),
    ]
