"""Custom encrypted fields for death_sync models."""
import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)


def get_fernet():
    """The configured Fernet, or None when no key is set.

    None is a DEBUG-only state: `config/settings.py` refuses to start with an
    empty `ENCRYPTION_KEY` when DEBUG is off, and warns when it is on (IS-02).
    A malformed key raises here rather than being treated as absent — the
    distinction that `except Exception: pass` used to erase.
    """
    key = getattr(settings, "ENCRYPTION_KEY", None)
    if not key:
        return None
    return Fernet(key.encode() if isinstance(key, str) else key)


class EncryptedCharField(models.CharField):
    """CharField encrypted at rest with Fernet.

    Both directions used to be wrapped in `except Exception: pass`, so a
    missing key, a malformed key, a wrong key and a corrupt value all ended in
    the same branch: store/return the plaintext. That made the one state worth
    shouting about — "this secret is in the clear" — indistinguishable from
    normal operation (IS-02).

    Only `InvalidToken` is caught now, and only on read, where it has one
    expected cause: a row written before a key was configured. Everything else
    (a bad key, above all) raises.
    """

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        fernet = get_fernet()
        if fernet is None:
            return value
        try:
            return fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            logger.warning(
                "%s: stored value is not a Fernet token; returning it unchanged "
                "(written before ENCRYPTION_KEY was set?)",
                type(self).__name__,
            )
            return value

    def get_prep_value(self, value):
        if value is None:
            return value
        fernet = get_fernet()
        if fernet is None:
            return value
        return fernet.encrypt(str(value).encode()).decode()
