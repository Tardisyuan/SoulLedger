"""Encrypted JSON field for death_sync models."""
import json
import logging

from cryptography.fernet import InvalidToken
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from apps.death_sync.fields import get_fernet

logger = logging.getLogger(__name__)


class EncryptedJSONField(models.JSONField):
    """JSONField encrypted at rest with Fernet.

    Same narrowing as `EncryptedCharField` (IS-02): the old `except Exception:
    pass` turned a bad key into "no encryption configured" and wrote the
    payload — which is the PII an external death-registration feed sent us —
    to the column in the clear, with nothing logged.
    """

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        fernet = get_fernet()
        if fernet is not None and isinstance(value, str):
            try:
                return json.loads(fernet.decrypt(value.encode()).decode())
            except InvalidToken:
                logger.warning(
                    "EncryptedJSONField: stored value is not a Fernet token; reading it "
                    "as plain JSON (written before ENCRYPTION_KEY was set?)"
                )
        # No key configured, or a row that predates one.
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                pass
        return value

    def get_prep_value(self, value):
        if value is None:
            return value
        # DjangoJSONEncoder, not plain json.dumps: source_payload can carry
        # a validated_data dict straight from a DRF serializer (see
        # DeathRegistrationViewSet.create -> DeathSyncService.register_death),
        # where a DateField becomes a real `date` object, not a string.
        # Plain json.dumps raises TypeError on that — this field's own
        # serialization, unrelated to which DB backend is behind it, so no
        # backend was ever going to save a real single-registration payload.
        json_str = json.dumps(value, cls=DjangoJSONEncoder)
        fernet = get_fernet()
        if fernet is None:
            return json_str
        return fernet.encrypt(json_str.encode()).decode()
