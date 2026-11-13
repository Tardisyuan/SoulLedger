"""JWTs signed with a key in SECRET_KEY_FALLBACKS stay valid until they expire (docs/DEPLOYMENT.md「密钥轮换」).

SimpleJWT signs with SIGNING_KEY, which defaults to SECRET_KEY, and knows nothing of Django's
SECRET_KEY_FALLBACKS: rotating SECRET_KEY would log out every officer and every soul app at once. This backend
signs with the current key exactly as before and, only when that signature check fails, tries the fallbacks.
An expired token is refused as expired whichever key signed it; a token no key signed is refused as before.

SimpleJWT exposes no setting for its backend class (`TOKEN_BACKEND_CLASS` is in its removed-settings list);
every token resolves `rest_framework_simplejwt.state.token_backend` lazily on first use, so `install()` swaps
that one object, from `SoulAccountsConfig.ready()` — before any request is served.

It is also where `JWT_SIGNING=ES256` (config/settings.py, off by default) takes effect: with an asymmetric
algorithm every token gets the `aud` of its kind (officer, or soul for `soul_*` token types), `iss`, and a `kid`
header naming the key `/.well-known/jwks.json` publishes; a token whose `aud` does not match its `token_type` is
refused. Under HS256 none of this runs and tokens are exactly what SimpleJWT has always written.
"""
import hashlib
import json
from functools import lru_cache

import jwt
from django.conf import settings
from django.http import Http404, JsonResponse
from jwt.algorithms import ECAlgorithm
from jwt.utils import base64url_encode
from rest_framework_simplejwt.backends import TokenBackend
from rest_framework_simplejwt.exceptions import TokenBackendError, TokenBackendExpiredToken
from rest_framework_simplejwt.settings import api_settings


class FallbackTokenBackend(TokenBackend):
    def _fallbacks(self):
        # Only meaningful while the signing key IS SECRET_KEY; a separately configured SIGNING_KEY rotates alone.
        if self.signing_key != settings.SECRET_KEY:
            return []
        return [
            TokenBackend(self.algorithm, key, self.verifying_key, self.audience, self.issuer, None, self.leeway,
                         self.json_encoder)
            for key in getattr(settings, "SECRET_KEY_FALLBACKS", [])
        ]

    def _audience_for(self, payload):
        kind = "soul" if str(payload.get(api_settings.TOKEN_TYPE_CLAIM, "")).startswith("soul_") else "officer"
        return settings.JWT_AUDIENCES[kind]

    def encode(self, payload):
        if self.algorithm.startswith("HS"):
            return super().encode(payload)
        claims = {**payload, "aud": self._audience_for(payload), "iss": self.issuer}
        return jwt.encode(claims, self.prepared_signing_key, algorithm=self.algorithm,
                          headers={"kid": public_jwk(self.verifying_key)["kid"]}, json_encoder=self.json_encoder)

    def decode(self, token, verify=True):
        if not self.algorithm.startswith("HS"):
            payload = super().decode(token, verify=verify)
            if verify and payload.get("aud") != self._audience_for(payload):
                raise TokenBackendError("Token is invalid")
            return payload
        try:
            return super().decode(token, verify=verify)
        except TokenBackendExpiredToken:
            raise
        except TokenBackendError:
            if not verify or not self.algorithm.startswith("HS"):
                raise
            for backend in self._fallbacks():
                try:
                    return backend.decode(token, verify=True)
                except TokenBackendExpiredToken:
                    raise
                except TokenBackendError:
                    continue
            raise


def install():
    from rest_framework_simplejwt import state

    if isinstance(state.token_backend, FallbackTokenBackend):
        return
    old = state.token_backend
    new = FallbackTokenBackend(old.algorithm, old.signing_key, old.verifying_key, old.audience, old.issuer, None,
                               old.leeway, old.json_encoder)
    new.jwks_client = old.jwks_client
    state.token_backend = new


@lru_cache(maxsize=4)
def public_jwk(public_pem):
    """The public key as a JWK, `kid` = its RFC 7638 thumbprint."""
    jwk = ECAlgorithm.to_jwk(ECAlgorithm(ECAlgorithm.SHA256).prepare_key(public_pem), as_dict=True)
    canonical = json.dumps({k: jwk[k] for k in ("crv", "kty", "x", "y")}, separators=(",", ":"), sort_keys=True)
    kid = base64url_encode(hashlib.sha256(canonical.encode()).digest()).decode()
    return {**jwk, "kid": kid, "use": "sig", "alg": "ES256"}


def jwks_view(request):
    """`/.well-known/jwks.json`: the verifying key for third parties. 404 while signing is HS256 (the default)."""
    from rest_framework_simplejwt import state

    backend = state.token_backend
    if backend.algorithm.startswith("HS"):
        raise Http404
    return JsonResponse({"keys": [public_jwk(backend.verifying_key)]},
                        headers={"Cache-Control": "public, max-age=3600"})
