"""`ENCRYPTION_KEY` missing must stop the process, not silently store plaintext (IS-02).

`settings.ENCRYPTION_KEY` defaulted to `""`, and both encrypted fields read it
as "encryption is optional": no key meant the value went to the database in the
clear. The two fields are `WebhookConfig.signing_secret` — the HMAC secret that
authenticates outgoing webhooks — and `DeathRegistrationRequest.source_payload`,
the PII a hospital feed sends us. Nothing anywhere said the key was missing:
`README` and `SECURITY` both describe these columns as Fernet-encrypted (DE-03).

Worse, each field wrapped its crypto in `except Exception: pass`, so a wrong
key, a malformed key and a corrupted value were all indistinguishable from
"no encryption configured" — and all of them ended in the plaintext branch.

So: with DEBUG off, an empty key is a refusal to start (the shape
`settings.py` already uses for `SECRET_KEY` and `ALLOWED_HOSTS`); with DEBUG on
it is allowed and warned about once; and the fields catch `InvalidToken` only —
values written before a key existed still read back, and a configuration error
is raised instead of being turned into plaintext.

The startup cases run in a subprocess with an explicit environment: settings
load once per process, so they cannot be exercised in-process, and every
variable that matters is passed so that `load_dotenv` — which never overrides
an already-set variable — cannot pull in a real `.env`.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from django.db import connection
from django.test import override_settings

BACKEND = Path(__file__).resolve().parents[1]

LOAD_SETTINGS = "import django; django.setup(); print('SETTINGS OK')"


def _env(debug, key, **overrides):
    env = {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": str(BACKEND),
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "SECRET_KEY": "test-only-not-a-secret",
        "DEBUG": debug,
        "ALLOWED_HOSTS": "example.test",
        # Never SQLite here: with DEBUG off, settings refuses SQLite *before*
        # it reaches the encryption key, and this file would then be asserting
        # the wrong refusal. Port 1 is closed; nothing connects at import time.
        "DATABASE_URL": "postgres://u:p@127.0.0.1:1/none",
        "REDIS_URL": "redis://127.0.0.1:1/0",
        "CELERY_BROKER_URL": "redis://127.0.0.1:1/1",
        "CELERY_RESULT_BACKEND": "redis://127.0.0.1:1/2",
        "ENCRYPTION_KEY": key,
        "SENTRY_DSN": "",
        "TRUSTED_PROXY_COUNT": "0",
    }
    env.update(overrides)
    return env


def _load(debug, key):
    return subprocess.run(
        [sys.executable, "-c", LOAD_SETTINGS], cwd=BACKEND, env=_env(debug, key),
        capture_output=True, text=True, timeout=120,
    )


class TestStartup:
    def test_production_without_a_key_refuses_to_start(self):
        proc = _load("false", "")
        assert proc.returncode != 0, proc.stdout
        assert "SETTINGS OK" not in proc.stdout
        # The right refusal, not merely a refusal.
        assert "ENCRYPTION_KEY" in proc.stderr, proc.stderr[-2000:]

    def test_production_with_a_key_starts(self):
        """Positive control: the same environment, one variable different."""
        proc = _load("false", Fernet.generate_key().decode())
        assert proc.returncode == 0, proc.stderr[-2000:]
        assert "SETTINGS OK" in proc.stdout

    def test_production_refuses_a_malformed_key(self):
        proc = _load("false", "not-a-fernet-key")
        assert proc.returncode != 0, proc.stdout
        assert "ENCRYPTION_KEY" in proc.stderr, proc.stderr[-2000:]

    def test_debug_without_a_key_starts_but_warns(self):
        proc = _load("true", "")
        assert proc.returncode == 0, proc.stderr[-2000:]
        assert "SETTINGS OK" in proc.stdout
        assert "ENCRYPTION_KEY" in proc.stderr, (
            "development is allowed to run without a key, but not silently"
        )


@pytest.fixture
def webhook(db, cn_tenant):
    from apps.death_sync.models import ExternalApiKey, WebhookConfig

    _, key_hash, key_prefix = ExternalApiKey.generate_key()
    api_key = ExternalApiKey.objects.create(
        tenant=cn_tenant, name="enc", system_type="HOSPITAL",
        key_hash=key_hash, key_prefix=key_prefix,
    )

    def make(secret="whsec_super_secret_value"):
        return WebhookConfig.objects.create(
            tenant=cn_tenant, api_key=api_key,
            url="https://example.com/hook", signing_secret=secret,
        )

    return make


def _stored_secrets():
    from apps.death_sync.models import WebhookConfig

    with connection.cursor() as cur:
        cur.execute(f"select signing_secret from {WebhookConfig._meta.db_table}")  # noqa: S608
        return [row[0] for row in cur.fetchall()]


@pytest.mark.django_db
class TestWhatReachesTheColumn:
    SECRET = "whsec_super_secret_value"

    def test_with_a_key_the_column_does_not_hold_the_plaintext(self, webhook):
        with override_settings(ENCRYPTION_KEY=Fernet.generate_key().decode()):
            config = webhook(self.SECRET)
            (stored,) = _stored_secrets()
            assert self.SECRET not in stored, "the secret is in the clear on disk"
            assert stored.startswith("gAAAA"), stored[:16]
            # Presence: encrypting into something unreadable would pass the line
            # above and break every webhook signature.
            config.refresh_from_db()
            assert config.signing_secret == self.SECRET

    def test_a_value_written_before_any_key_still_reads_back(self, webhook):
        """Legacy plaintext rows must survive turning encryption on — that is
        the whole reason `InvalidToken` is caught rather than left to raise.

        The "before" state is set explicitly. It used to be ambient — the write
        below simply inherited whatever `ENCRYPTION_KEY` the developer's
        `backend/.env` carried, which was nothing on the machine this was
        written on. The moment someone followed `.env.example` and configured a
        key, this row was written encrypted under *their* key, read back under
        the generated one on the next line, and the InvalidToken fallback
        returned ciphertext — a red that points at encryption and not at the
        test's own assumption. CI has no `.env`, so it would have stayed green.
        """
        with override_settings(ENCRYPTION_KEY=""):
            config = webhook(self.SECRET)  # no key configured: stored in the clear
        with override_settings(ENCRYPTION_KEY=Fernet.generate_key().decode()):
            config.refresh_from_db()
            assert config.signing_secret == self.SECRET

    def test_a_malformed_key_is_raised_not_swallowed_into_plaintext(self, webhook):
        """`except Exception: pass` made a broken key look like no key, and the
        plaintext branch was the landing place for both.

        The raise is the evidence: a write that fails cannot also have stored
        the secret in the clear. Deliberately no query afterwards — the insert
        failed inside this test's atomic block, so reading the table here would
        raise TransactionManagementError and say nothing about encryption.
        """
        with (
            override_settings(ENCRYPTION_KEY="not-a-fernet-key"),
            pytest.raises(ValueError) as caught,
        ):
            webhook(self.SECRET)
        # Not InvalidToken: that is the single failure this field is allowed to
        # absorb (a row written before any key existed). Absorbing a malformed
        # key under the same branch is precisely the defect being fixed.
        assert "InvalidToken" not in type(caught.value).__name__
        assert "Fernet key" in str(caught.value), caught.value


@pytest.mark.django_db
class TestTheJsonPayloadToo:
    PAYLOAD = {"name": "Zhang San", "id_number": "310101199001011234"}

    def test_with_a_key_the_payload_column_is_not_readable(self, db, cn_tenant):
        from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey

        _, key_hash, key_prefix = ExternalApiKey.generate_key()
        api_key = ExternalApiKey.objects.create(
            tenant=cn_tenant, name="enc2", system_type="HOSPITAL",
            key_hash=key_hash, key_prefix=key_prefix,
        )
        with override_settings(ENCRYPTION_KEY=Fernet.generate_key().decode()):
            row = DeathRegistrationRequest.objects.create(
                tenant=cn_tenant, api_key=api_key, source_payload=self.PAYLOAD,
            )
            with connection.cursor() as cur:
                cur.execute(  # noqa: S608
                    f"select source_payload from {DeathRegistrationRequest._meta.db_table}"
                )
                (stored,) = cur.fetchone()
            assert "310101199001011234" not in str(stored), "PII is in the clear on disk"
            row.refresh_from_db()
            assert json.loads(json.dumps(row.source_payload)) == self.PAYLOAD
