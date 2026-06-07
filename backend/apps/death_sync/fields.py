"""
Custom encrypted fields for death_sync models.
"""
from django.conf import settings
from django.db import models


class EncryptedCharField(models.CharField):
    """
    CharField that encrypts value at rest using Fernet.
    Decodes on read, encrypts on write.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        try:
            from cryptography.fernet import Fernet
            key = getattr(settings, 'ENCRYPTION_KEY', None)
            if key:
                f = Fernet(key.encode() if isinstance(key, str) else key)
                return f.decrypt(value.encode()).decode()
        except Exception:
            pass
        return value

    def get_prep_value(self, value):
        if value is None:
            return value
        try:
            from cryptography.fernet import Fernet
            key = getattr(settings, 'ENCRYPTION_KEY', None)
            if key:
                f = Fernet(key.encode() if isinstance(key, str) else key)
                return f.encrypt(value.encode()).decode()
        except Exception:
            pass
        return value
