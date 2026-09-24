"""The officer console's refresh token: SimpleJWT's, plus 「保持登录 30 天」.

WHY A SUBCLASS AND NOT A SECOND SETTING. SimpleJWT has one refresh lifetime
(`SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]`, 7 days here) and computes every `exp`
from it — including on rotation: `TokenRefreshSerializer.validate` calls
`refresh.set_exp()` with no lifetime, so a 30-day token handed to the stock
serializer comes back as a 7-day one on its first refresh. "Remember me" would
then last exactly one access-token lifetime (30 minutes) longer than not
remembering.

So the choice travels **inside the token** as the `remember` claim, and
`set_exp` reads it. Rotation copies every claim except exp/jti/iat, so the
claim survives each refresh and each rotated token again gets the 30-day
lifetime from the moment it is issued — the same sliding behaviour a 7-day
token has always had. Blacklisting is untouched: the token is still a
`RefreshToken`, still in the outstanding table, still blacklisted on rotation.

The claim is kept out of the access token (`no_copy_claims`): nothing that
authenticates a request needs it, and an access token lives 30 minutes either
way.
"""
from datetime import timedelta

from rest_framework_simplejwt.tokens import RefreshToken as SimpleJWTRefreshToken

#: The claim that records the login-time choice.
REMEMBER_CLAIM = "remember"

#: Refresh lifetime when the operator ticked 「在此设备上保持登录 30 天」.
REMEMBER_REFRESH_LIFETIME = timedelta(days=30)


class RefreshToken(SimpleJWTRefreshToken):
    no_copy_claims = (*SimpleJWTRefreshToken.no_copy_claims, REMEMBER_CLAIM)

    def set_exp(self, claim="exp", from_time=None, lifetime=None):
        if lifetime is None and claim == "exp" and self.payload.get(REMEMBER_CLAIM) is True:
            lifetime = REMEMBER_REFRESH_LIFETIME
        super().set_exp(claim=claim, from_time=from_time, lifetime=lifetime)

    def remember(self):
        """Mark a freshly issued token as remembered and move its expiry out.

        `for_user` has already written this token's row into the outstanding
        table with the default expiry, so the row is moved too:
        `flushexpiredtokens` deletes by that column, and a remembered token
        whose row vanished at day 7 would no longer be listed for the
        revocation `apps/soul_accounts/services.py::_revoke_refresh_tokens`
        performs.
        """
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        from rest_framework_simplejwt.utils import datetime_from_epoch

        self.payload[REMEMBER_CLAIM] = True
        self.set_exp()
        OutstandingToken.objects.filter(jti=self.payload["jti"]).update(
            expires_at=datetime_from_epoch(self.payload["exp"]), token=str(self)
        )
