"""Encrypted JSON field for death_sync models."""
import json
import logging

from cryptography.fernet import InvalidToken
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from apps.death_sync.fields import get_fernet, strict_reads

logger = logging.getLogger(__name__)


def decode_stored(value):
    """The Python value of what an `EncryptedJSONTextField` column holds: a Fernet token, or plain JSON text.

    The two never collide: a token is urlsafe base64 starting "gAAAA", which is not JSON. So plain JSON (a row
    written while DEBUG ran without a key) is recognised without a key and even under `strict_reads` —
    `rotate_encryption_key` then encrypts it. Only a token no configured key opens is unreadable: under
    `strict_reads` that raises `InvalidToken`; otherwise it is logged and returned as the raw string.
    """
    fernet = get_fernet()
    if fernet is not None:
        try:
            return json.loads(fernet.decrypt(value.encode()).decode())
        except InvalidToken:
            pass
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        pass
    if strict_reads.get():
        raise InvalidToken
    logger.warning("EncryptedJSONTextField: a stored token could not be decrypted with any configured key")
    return value


class EncryptedJSONTextField(models.TextField):
    """JSON encrypted at rest with Fernet, in a text column.

    The column holds exactly one of: the Fernet token of the JSON text, or (no key configured — DEBUG only,
    `config/settings.py`) the JSON text itself. Reads return the Python value either way.

    It replaced `EncryptedJSONField` (below), a JSONField whose `get_prep_value` returned a string that
    JSONField then JSON-encoded a second time: the column held a JSON *string scalar*. With a key, reads
    worked only because Fernet's base64 decode drops the quotes; without one they returned a `str`, so
    `DeathSyncService.retry_failed` failed every row with VALIDATION_ERROR (review 2026-10-31 A2).
    `death_sync/0010` moved the existing rows over.

    Same narrowing as `EncryptedCharField` (IS-02): only `InvalidToken` is caught, and a bad key raises.
    """

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return decode_stored(value)

    def to_python(self, value):
        # A Python JSON value, not text: TextField.to_python would str() a dict (full_clean).
        return value

    def value_to_string(self, obj):
        return self.value_from_object(obj)

    def get_prep_value(self, value):
        if value is None:
            return value
        # DjangoJSONEncoder: source_payload can be a DRF validated_data dict, where a DateField is a real
        # `date` (DeathRegistrationViewSet.create -> DeathSyncService.register_death); json.dumps raises on it.
        json_str = json.dumps(value, cls=DjangoJSONEncoder)
        fernet = get_fernet()
        if fernet is None:
            return json_str
        return fernet.encrypt(json_str.encode()).decode()


class EncryptedJSONField(models.JSONField):
    """Superseded by `EncryptedJSONTextField`; kept only because migrations 0002–0009 name it.

    Changing this class in place would rewrite those migrations' history (a fresh database would get a
    text column at 0002 and 0010 would have nothing to alter). No model uses it.
    """
