"""`DeathRegistrationRequest.source_payload`: what the column holds and what a read returns (review 2026-10-31 A2).

The old field (a JSONField) JSON-encoded its own output a second time, so the column held a JSON *string
scalar*: with a key, reads worked only because Fernet's base64 decode drops the quotes; without one they
returned a `str`, and `retry_failed` turned every retryable row into VALIDATION_ERROR. The column is text
now, holding a Fernet token or (no key) plain JSON text, and `death_sync/0010` converts the old rows.
"""
import json
from datetime import date

import pytest
from cryptography.fernet import Fernet
from django.db import connection
from django.test import override_settings

from apps.death_sync.models import DeathRegistrationRequest

SQLITE = connection.vendor == "sqlite"
KEY = Fernet.generate_key().decode()
PAYLOAD = {"soul_lookup": {"name": "张三"}, "death_date": date(2026, 6, 1)}
STORED = {"soul_lookup": {"name": "张三"}, "death_date": "2026-06-01"}


def _row(tenant, idem="enc-1", payload=PAYLOAD):
    return DeathRegistrationRequest.objects.create(
        tenant=tenant, source_system="test-source", idempotency_key=idem, source_payload=payload)


def _raw(row):
    table = connection.ops.quote_name(DeathRegistrationRequest._meta.db_table)
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT source_payload FROM {table} WHERE id = %s", [row.pk.hex if SQLITE else row.pk])
        return cursor.fetchone()[0]


def _read(row):
    return DeathRegistrationRequest._base_manager.get(pk=row.pk).source_payload


@pytest.mark.django_db
def test_with_a_key_the_column_holds_the_bare_token_and_reads_back_a_dict(cn_tenant):
    with override_settings(ENCRYPTION_KEY=KEY):
        row = _row(cn_tenant)
        raw = _raw(row)
        assert raw.startswith("gAAAA"), raw[:16]  # not '"gAAAA…"', a JSON string
        assert json.loads(Fernet(KEY).decrypt(raw.encode())) == STORED
        assert "张三" not in raw
        assert _read(row) == STORED


@pytest.mark.django_db
def test_without_a_key_the_column_holds_plain_json_and_reads_back_a_dict(cn_tenant):
    with override_settings(ENCRYPTION_KEY=""):
        row = _row(cn_tenant)
        assert json.loads(_raw(row)) == STORED  # an object, not a string holding one
        value = _read(row)
    assert isinstance(value, dict) and value == STORED


@pytest.mark.django_db
def test_a_plain_row_reads_back_under_a_key_and_the_rotation_encrypts_it(cn_tenant):
    from apps.death_sync.fields import strict_reads
    from apps.death_sync.management.commands.rotate_encryption_key import rotate

    with override_settings(ENCRYPTION_KEY=""):
        row = _row(cn_tenant)
    with override_settings(ENCRYPTION_KEY=KEY):
        assert _read(row) == STORED
        token = strict_reads.set(True)
        try:
            assert _read(row) == STORED  # plain JSON is not "unreadable" to the rotation
        finally:
            strict_reads.reset(token)
        assert rotate()["death_sync.DeathRegistrationRequest.source_payload"] == (1, 0)
        raw = _raw(row)
        assert raw.startswith("gAAAA") and "张三" not in raw
        assert _read(row) == STORED


@pytest.mark.django_db
@pytest.mark.skipif(SQLITE, reason="the column's PostgreSQL type, and jsonb_typeof, exist only on PostgreSQL")
def test_the_postgresql_column_is_text_holding_a_token_or_a_json_object(cn_tenant):
    table = connection.ops.quote_name(DeathRegistrationRequest._meta.db_table)
    with override_settings(ENCRYPTION_KEY=KEY):
        sealed = _row(cn_tenant, "enc-sealed")
    with override_settings(ENCRYPTION_KEY=""):
        plain = _row(cn_tenant, "enc-plain")
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT id, pg_typeof(source_payload)::text, left(source_payload::text, 5) FROM {table}"
            " WHERE id IN (%s, %s)", [sealed.pk, plain.pk])
        shapes = {str(pk): (kind, head) for pk, kind, head in cursor.fetchall()}
        cursor.execute(f"SELECT jsonb_typeof(source_payload::jsonb) FROM {table} WHERE id = %s", [plain.pk])
        plain_json = cursor.fetchone()[0]
    assert shapes[str(sealed.pk)] == ("text", "gAAAA")
    assert shapes[str(plain.pk)][0] == "text"
    assert plain_json == "object"  # not "string"


# ── death_sync/0010 ─────────────────────────────────────────────────────────

MIG_KEY = Fernet.generate_key()
LEGACY = {
    # A token the old field double-encoded: jsonb '"gAAAA…"'.
    "token": ("enc-mig-token", lambda: json.dumps(Fernet(MIG_KEY).encrypt(b'{"a": 1}').decode())),
    # Plain JSON written with no key, double-encoded: jsonb '"{\"a\": 2}"'.
    "plain": ("enc-mig-plain", lambda: json.dumps(json.dumps({"a": 2}))),
    # Already an object (written before the encrypted field, or by hand).
    "object": ("enc-mig-object", lambda: json.dumps({"a": 3})),
}


def _decode(stored):
    """(kind, value) of a stored source_payload in any of the shapes, before or after 0010."""
    try:
        value = json.loads(stored)
    except json.JSONDecodeError:
        value = stored  # a bare token: after 0010
    if isinstance(value, str):
        try:
            return "token", json.loads(Fernet(MIG_KEY).decrypt(value.encode()))
        except Exception:  # not a token: double-encoded plain JSON
            return "plain", json.loads(value)
    return "plain", value


def _stored_by_idem(state):
    reg = state.get_model("death_sync", "DeathRegistrationRequest")
    table = connection.ops.quote_name(reg._meta.db_table)
    cast = "source_payload" if SQLITE else "source_payload::text"
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT idempotency_key, {cast} FROM {table} WHERE idempotency_key LIKE 'enc-mig-%%'")
        return dict(cursor.fetchall())


@pytest.mark.django_db(transaction=True)
def test_0010_converts_every_legacy_shape_without_the_key(migration_round_trip):
    def seed(state):
        tenant = state.get_model("tenants", "Tenant")._base_manager.create(code="ENC_MIG", display_name="x")
        reg = state.get_model("death_sync", "DeathRegistrationRequest")
        table = connection.ops.quote_name(reg._meta.db_table)
        value = "%s" if SQLITE else "CAST(%s AS jsonb)"
        for idem, stored in LEGACY.values():
            reg._base_manager.create(tenant=tenant, source_system="test-source", idempotency_key=idem,
                                     source_payload={})
            with connection.cursor() as cursor:
                cursor.execute(f"UPDATE {table} SET source_payload = {value} WHERE idempotency_key = %s",
                               [stored(), idem])

    def snapshot(state):
        # The stored text too, except for the double-encoded plain row: the reverse brings that one back as an
        # object (the shape the old field read correctly), so only its kind and value are restored.
        return {idem: {**dict(zip(("kind", "value"), _decode(s), strict=True)),
                       "stored": None if idem == "enc-mig-plain" else s}
                for idem, s in _stored_by_idem(state).items()}

    def check_forward(state):
        stored = _stored_by_idem(state)
        token = stored["enc-mig-token"]
        assert token.startswith("gAAAA"), token[:16]
        assert json.loads(Fernet(MIG_KEY).decrypt(token.encode())) == {"a": 1}
        assert json.loads(stored["enc-mig-plain"]) == {"a": 2}
        assert json.loads(stored["enc-mig-object"]) == {"a": 3}

    def check_reverse(state):
        stored = _stored_by_idem(state)
        assert json.loads(stored["enc-mig-token"]).startswith("gAAAA")  # a JSON string again
        assert json.loads(stored["enc-mig-plain"]) == {"a": 2}  # an object: what the old field read correctly
        assert json.loads(stored["enc-mig-object"]) == {"a": 3}

    with override_settings(ENCRYPTION_KEY=""):  # the migration must not need the key
        migration_round_trip(
            before=("death_sync", "0009_drop_unwritten_statuses"),
            after=("death_sync", "0010_encrypted_json_in_a_text_column"),
            seed=seed,
            snapshot=snapshot,
            check_forward=check_forward,
            check_reverse=check_reverse,
        )
