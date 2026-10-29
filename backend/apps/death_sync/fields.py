"""Custom encrypted fields for death_sync models."""
import contextvars
import logging

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)


#: Set by `manage.py rotate_encryption_key`: a value no key can decrypt raises `InvalidToken` instead of being
#: returned as-is, so the command can tell "re-encrypt this" from "leave this alone" (a ciphertext under a key
#: that is not configured would otherwise come back as a string and be encrypted a second time).
strict_reads: contextvars.ContextVar[bool] = contextvars.ContextVar("strict_reads", default=False)


def _fernet(key):
    return Fernet(key.encode() if isinstance(key, str) else key)


def get_fernet():
    """The configured cipher, or None when no key is set.

    None is a DEBUG-only state: `config/settings.py` refuses to start with an
    empty `ENCRYPTION_KEY` when DEBUG is off, and warns when it is on (IS-02).
    A malformed key raises here rather than being treated as absent — the
    distinction that `except Exception: pass` used to erase.

    A MultiFernet over ENCRYPTION_KEY then ENCRYPTION_KEY_FALLBACKS: encrypt uses the first key only, decrypt
    tries each in turn — which is what lets the key be rotated without downtime (docs/DEPLOYMENT.md「密钥轮换」).
    """
    key = getattr(settings, "ENCRYPTION_KEY", None)
    if not key:
        return None
    return MultiFernet([_fernet(k) for k in [key, *getattr(settings, "ENCRYPTION_KEY_FALLBACKS", [])]])


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
            if strict_reads.get():
                raise
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
