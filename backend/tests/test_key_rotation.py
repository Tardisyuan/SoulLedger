"""Key rotation without downtime (docs/DEPLOYMENT.md「密钥轮换」).

* ENCRYPTION_KEY: reads try ENCRYPTION_KEY then ENCRYPTION_KEY_FALLBACKS, writes use ENCRYPTION_KEY only;
  `manage.py rotate_encryption_key` rewrites the stored values under the new key.
* SECRET_KEY: Django's SECRET_KEY_FALLBACKS, plus JWTs signed with a fallback key still verify
  (apps/core/jwt_fallback.py) until they expire.

The settings-parsing cases run in a subprocess for the reason test_encryption_key_is_required.py gives.
"""
import subprocess
import sys
from datetime import timedelta

import pytest
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.management import CommandError, call_command
from django.db import connection
from django.test import override_settings

from tests.test_encryption_key_is_required import BACKEND, _env

OLD, NEW, LOST = (Fernet.generate_key().decode() for _ in range(3))


def _keys(primary, *fallbacks):
    # Rows the suite itself may have written under the environment's key stay readable.
    extra = [settings.ENCRYPTION_KEY] if settings.ENCRYPTION_KEY else []
    return override_settings(ENCRYPTION_KEY=primary, ENCRYPTION_KEY_FALLBACKS=[*fallbacks, *extra])


@pytest.fixture
def hook(db):
    from apps.death_sync.models import ExternalApiKey, WebhookConfig
    from apps.tenants.models import Tenant

    tenant, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    key = ExternalApiKey.objects.create(tenant=tenant, name="k", system_type="CUSTOM", key_hash="rot", key_prefix="slk_rot")

    def make(cipher_key, secret):
        with _keys(cipher_key):
            return WebhookConfig.objects.create(tenant=tenant, api_key=key, url="https://example.invalid/x",
                                                signing_secret=secret)
    return make


def _raw(row):
    table = row._meta.db_table
    with connection.cursor() as cursor:
        cursor.execute(f"SELECT signing_secret FROM {connection.ops.quote_name(table)} WHERE id = %s",
                       # The pk as this backend stores it: a UUID on PostgreSQL, 32 hex chars on SQLite (whose
                       # driver refuses a bare `uuid.UUID`: "type 'UUID' is not supported").
                       [row._meta.pk.get_db_prep_value(row.pk, connection)])
        return cursor.fetchone()[0]


def _read(row):
    return type(row)._base_manager.get(pk=row.pk).signing_secret


def test_a_fallback_key_reads_and_the_rotation_moves_the_value_to_the_new_key(hook):
    from apps.death_sync.management.commands.rotate_encryption_key import rotate

    row = hook(OLD, "s3cret")
    assert Fernet(OLD).decrypt(_raw(row).encode()) == b"s3cret"

    with _keys(NEW):  # the old key forgotten too early: the value does not come back
        assert _read(row) != "s3cret"
    with _keys(NEW, OLD):
        assert _read(row) == "s3cret"
        assert rotate(dry_run=True)["death_sync.WebhookConfig.signing_secret"] == (1, 0)
        assert Fernet(OLD).decrypt(_raw(row).encode()) == b"s3cret"  # dry run wrote nothing

        assert rotate()["death_sync.WebhookConfig.signing_secret"] == (1, 0)

    raw = _raw(row)
    assert Fernet(NEW).decrypt(raw.encode()) == b"s3cret"
    with pytest.raises(InvalidToken):
        Fernet(OLD).decrypt(raw.encode())
    with _keys(NEW):  # the fallback can go now
        assert _read(row) == "s3cret"


def test_a_value_no_key_reads_is_left_alone_and_the_command_fails(hook):
    row = hook(LOST, "gone")
    before = _raw(row)
    with _keys(NEW, OLD), pytest.raises(CommandError, match="Do NOT drop"):
        call_command("rotate_encryption_key")
    assert _raw(row) == before  # not encrypted a second time


def test_the_encrypted_json_field_rotates_too(db):
    from apps.death_sync.management.commands.rotate_encryption_key import encrypted_fields

    labels = {f"{m._meta.label}.{f}" for m, names in encrypted_fields() for f in names}
    assert "death_sync.DeathRegistrationRequest.source_payload" in labels
    assert "death_sync.WebhookConfig.signing_secret" in labels
    assert not any(label.startswith("events.SoulEvent") for label in labels)


def test_writes_use_the_first_key_only(db):
    from apps.death_sync.fields import get_fernet

    with _keys(NEW, OLD):
        token = get_fernet().encrypt(b"x")
    assert Fernet(NEW).decrypt(token) == b"x"
    with pytest.raises(InvalidToken):
        Fernet(OLD).decrypt(token)


# ── SECRET_KEY / JWT ────────────────────────────────────────────────────────

OLD_SECRET = "an-old-secret-key-that-is-at-least-32-bytes-long"


def _token_signed_with(key, *, lifetime=timedelta(minutes=5)):
    from rest_framework_simplejwt.backends import TokenBackend
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.authentication.models import User

    user = User.objects.create_user(username="rot_jwt", password="x", role="MODERATOR")
    token = AccessToken.for_user(user)
    token.set_exp(lifetime=lifetime)
    return TokenBackend("HS256", key).encode(token.payload)


def test_a_jwt_signed_with_a_fallback_secret_still_verifies(db):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    raw = _token_signed_with(OLD_SECRET)
    with override_settings(SECRET_KEY_FALLBACKS=[]), pytest.raises(TokenError):
        AccessToken(raw)
    with override_settings(SECRET_KEY_FALLBACKS=[OLD_SECRET]):
        assert AccessToken(raw)["user_id"]
    # A token nobody we know signed stays refused while fallbacks exist.
    with override_settings(SECRET_KEY_FALLBACKS=[OLD_SECRET]), pytest.raises(TokenError):
        AccessToken(_token_signed_with_other())


def _token_signed_with_other():
    from rest_framework_simplejwt.backends import TokenBackend

    return TokenBackend("HS256", "x" * 40).encode({"token_type": "access", "user_id": "1", "exp": 4102444800,
                                                   "jti": "j"})


def test_an_expired_fallback_token_is_refused_as_expired(db):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    raw = _token_signed_with(OLD_SECRET, lifetime=timedelta(seconds=-60))
    with override_settings(SECRET_KEY_FALLBACKS=[OLD_SECRET]), pytest.raises(TokenError, match="expired"):
        AccessToken(raw)


def test_new_tokens_are_signed_with_the_current_secret_only(db):
    from rest_framework_simplejwt import state
    from rest_framework_simplejwt.backends import TokenBackend
    from rest_framework_simplejwt.exceptions import TokenBackendError
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.authentication.models import User
    from apps.core.jwt_fallback import FallbackTokenBackend

    assert isinstance(state.token_backend, FallbackTokenBackend)
    user = User.objects.create_user(username="rot_new", password="x", role="MODERATOR")
    with override_settings(SECRET_KEY_FALLBACKS=[OLD_SECRET]):
        raw = str(AccessToken.for_user(user))
    assert TokenBackend("HS256", settings.SECRET_KEY).decode(raw)["user_id"]
    with pytest.raises(TokenBackendError):
        TokenBackend("HS256", OLD_SECRET).decode(raw)


def _settings_probe(**env):
    code = ("import django; django.setup(); from django.conf import settings as s; "
            "print(s.SECRET_KEY_FALLBACKS, len(s.ENCRYPTION_KEY_FALLBACKS))")
    return subprocess.run([sys.executable, "-W", "ignore", "-c", code], cwd=BACKEND,
                          env=_env("false", NEW, **env), capture_output=True, text=True, timeout=120)


def test_the_fallback_variables_are_parsed_and_validated():
    ok = _settings_probe(SECRET_KEY_FALLBACKS=" a , b ,", ENCRYPTION_KEY_FALLBACKS=f"{OLD},{LOST}")
    assert ok.returncode == 0, ok.stderr[-2000:]
    assert ok.stdout.strip() == "['a', 'b'] 2"

    bad = _settings_probe(ENCRYPTION_KEY_FALLBACKS="not-a-fernet-key")
    assert bad.returncode != 0 and "ENCRYPTION_KEY_FALLBACKS is not a valid Fernet key" in bad.stderr

    orphan = subprocess.run([sys.executable, "-W", "ignore", "-c", "import django; django.setup()"], cwd=BACKEND,
                            env=_env("true", "", ENCRYPTION_KEY_FALLBACKS=OLD), capture_output=True, text=True,
                            timeout=120)
    assert orphan.returncode != 0 and "the new key goes first" in orphan.stderr
