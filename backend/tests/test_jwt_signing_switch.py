"""`JWT_SIGNING` (config/settings.py): HS256 by default and unchanged; ES256 is built but off (user 2026-11-14:
「没有第三方验签方之前先不启用」).

Default: tokens are SimpleJWT's HS256 tokens exactly as before — no `aud`, no `iss`, no `kid`, and the JWKS
endpoint is a 404. With ES256 (a throwaway key pair, swapped into `state.token_backend` the way
`jwt_fallback.install()` does): officer and soul tokens verify with the public key alone, each carries its own
`aud` plus `iss`, neither kind is accepted where the other is expected, a token whose `aud` contradicts its
`token_type` is refused even with a valid signature, and an HS256 token is refused. Settings refuse to load
ES256 without a matching key pair — in a subprocess, for the reason test_encryption_key_is_required.py gives.
"""
import subprocess
import sys

import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings
from django.test import override_settings

from tests.test_encryption_key_is_required import BACKEND, _env

AUDIENCES = {"officer": "soulledger-officer", "soul": "soulledger-soul"}


def _pair():
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
    public = key.public_key().public_bytes(serialization.Encoding.PEM,
                                           serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    return private, public


@pytest.fixture
def user(db):
    from apps.authentication.models import User

    return User.objects.create_user(username="jwt_switch", password="x", role="MODERATOR")


@pytest.fixture
def es256(monkeypatch):
    from rest_framework_simplejwt import state

    from apps.core.jwt_fallback import FallbackTokenBackend

    private, public = _pair()
    old = state.token_backend
    backend = FallbackTokenBackend("ES256", private, public, tuple(AUDIENCES.values()), "soulledger", None,
                                   old.leeway, old.json_encoder)
    monkeypatch.setattr(state, "token_backend", backend)
    with override_settings(JWT_AUDIENCES=AUDIENCES):
        yield private, public


def test_the_default_is_hs256_and_tokens_are_unchanged(user, client):
    from rest_framework_simplejwt import state
    from rest_framework_simplejwt.backends import TokenBackend
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.soul_accounts.authentication import SoulAccessToken

    assert settings.JWT_SIGNING == "HS256" and settings.JWT_AUDIENCES == {}
    assert state.token_backend.algorithm == "HS256" and state.token_backend.signing_key == settings.SECRET_KEY
    for raw in (str(AccessToken.for_user(user)), str(SoulAccessToken.for_user(user))):
        assert jwt.get_unverified_header(raw) == {"alg": "HS256", "typ": "JWT"}
        claims = TokenBackend("HS256", settings.SECRET_KEY).decode(raw)
        assert "aud" not in claims and "iss" not in claims
    assert client.get("/.well-known/jwks.json").status_code == 404


@pytest.mark.usefixtures("es256")
def test_es256_tokens_carry_their_own_audience_and_verify_with_the_public_key(user, client):
    from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

    from apps.soul_accounts.authentication import SoulAccessToken, SoulRefreshToken

    jwks = client.get("/.well-known/jwks.json")
    assert jwks.status_code == 200
    (jwk,) = jwks.json()["keys"]
    public = jwt.PyJWK(jwk).key

    cases = [
        (str(AccessToken.for_user(user)), "officer"),
        (str(RefreshToken.for_user(user).access_token), "officer"),
        (str(SoulAccessToken.for_user(user)), "soul"),
        (str(SoulRefreshToken.for_user(user).access_token), "soul"),
    ]
    for raw, kind in cases:
        assert jwt.get_unverified_header(raw)["kid"] == jwk["kid"]
        claims = jwt.decode(raw, public, algorithms=["ES256"], audience=AUDIENCES[kind], issuer="soulledger")
        assert claims["aud"] == AUDIENCES[kind]
        with pytest.raises(jwt.InvalidAudienceError):
            other = "soul" if kind == "officer" else "officer"
            jwt.decode(raw, public, algorithms=["ES256"], audience=AUDIENCES[other])


@pytest.mark.usefixtures("es256")
def test_es256_rejects_the_wrong_kind_a_contradicting_aud_and_hs256(user):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.soul_accounts.authentication import SoulAccessToken

    officer, soul = str(AccessToken.for_user(user)), str(SoulAccessToken.for_user(user))
    assert AccessToken(officer)["user_id"] and SoulAccessToken(soul)["user_id"]
    with pytest.raises(TokenError):
        SoulAccessToken(officer)
    with pytest.raises(TokenError):
        AccessToken(soul)

    # Validly signed, but the soul token_type is stamped with the officer audience.
    from rest_framework_simplejwt import state

    backend = state.token_backend
    forged = jwt.encode({**SoulAccessToken(soul).payload, "aud": AUDIENCES["officer"]},
                        backend.prepared_signing_key, algorithm="ES256")
    with pytest.raises(TokenError):
        SoulAccessToken(forged)

    hs = jwt.encode(dict(AccessToken(officer).payload), settings.SECRET_KEY, algorithm="HS256")
    with pytest.raises(TokenError):
        AccessToken(hs)


def _probe(**env):
    code = "import django; django.setup(); from django.conf import settings as s; print(s.SIMPLE_JWT.get('ALGORITHM'))"
    return subprocess.run([sys.executable, "-W", "ignore", "-c", code], cwd=BACKEND,
                          env=_env("true", Fernet.generate_key().decode(), **env), capture_output=True, text=True,
                          timeout=120)


def test_settings_refuse_es256_without_a_matching_key_pair(tmp_path):
    private, public = _pair()
    _, stranger = _pair()
    key_file = tmp_path / "jwt.key"
    key_file.write_text(private)

    ok = _probe(JWT_SIGNING="es256", JWT_PRIVATE_KEY=str(key_file), JWT_PUBLIC_KEY=public)
    assert ok.returncode == 0 and ok.stdout.strip() == "ES256", ok.stderr[-2000:]

    for env, message in [
        ({"JWT_SIGNING": "ES256"}, "needs JWT_PRIVATE_KEY"),
        ({"JWT_SIGNING": "ES256", "JWT_PRIVATE_KEY": private}, "needs JWT_PUBLIC_KEY"),
        ({"JWT_SIGNING": "ES256", "JWT_PRIVATE_KEY": private, "JWT_PUBLIC_KEY": stranger}, "not the public half"),
        ({"JWT_SIGNING": "RS256"}, "must be HS256 or ES256"),
    ]:
        bad = _probe(**env)
        assert bad.returncode != 0 and "ImproperlyConfigured" in bad.stderr and message in bad.stderr, env
