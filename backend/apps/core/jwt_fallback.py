"""JWTs signed with a key in SECRET_KEY_FALLBACKS stay valid until they expire (docs/DEPLOYMENT.md「密钥轮换」).

SimpleJWT signs with SIGNING_KEY, which defaults to SECRET_KEY, and knows nothing of Django's
SECRET_KEY_FALLBACKS: rotating SECRET_KEY would log out every officer and every soul app at once. This backend
signs with the current key exactly as before and, only when that signature check fails, tries the fallbacks.
An expired token is refused as expired whichever key signed it; a token no key signed is refused as before.

SimpleJWT exposes no setting for its backend class (`TOKEN_BACKEND_CLASS` is in its removed-settings list);
every token resolves `rest_framework_simplejwt.state.token_backend` lazily on first use, so `install()` swaps
that one object, from `SoulAccountsConfig.ready()` — before any request is served.
"""
from django.conf import settings
from rest_framework_simplejwt.backends import TokenBackend
from rest_framework_simplejwt.exceptions import TokenBackendError, TokenBackendExpiredToken


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

    def decode(self, token, verify=True):
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
