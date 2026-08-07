"""
Encrypted JSON field for death_sync models.
"""
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models


class EncryptedJSONField(models.JSONField):
    """
    JSONField that encrypts value at rest using Fernet.
    Falls back to plain JSON if no encryption key is configured.
    """

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        try:
            from cryptography.fernet import Fernet
            from django.conf import settings
            key = getattr(settings, 'ENCRYPTION_KEY', None)
            if key:
                f = Fernet(key.encode() if isinstance(key, str) else key)
                decrypted = f.decrypt(value.encode()).decode()
                return json.loads(decrypted)
        except Exception:
            pass
        # If not encrypted or decryption fails, try parsing as JSON
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
        try:
            from cryptography.fernet import Fernet
            from django.conf import settings
            key = getattr(settings, 'ENCRYPTION_KEY', None)
            if key:
                f = Fernet(key.encode() if isinstance(key, str) else key)
                return f.encrypt(json_str.encode()).decode()
        except Exception:
            pass
        return json_str
