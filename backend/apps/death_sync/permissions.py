"""API-key capability flags, actually enforced.

`ExternalApiKey` carries three capability booleans. Only one of them was ever
read. Measured 2026-08-29 with `grep -rn --include="*.py"`:

    can_register_death     4 hits -- model, migration, serializer, and the
                                     check in DeathRegistrationViewSet.create
    can_manage_webhooks    3 hits -- model, migration, serializer. Zero
                                     enforcement sites.
    can_query_status       2 hits -- model and serializer. Zero.

and end to end: a key with `can_manage_webhooks=False` POSTed to
`/api/v1/death-sync/webhooks/` and got **201**. Since a WebhookConfig decides
where this system sends outbound HTTP, any valid key could aim the
application's own requests.

The check goes in a permission class rather than an `if` at the top of
`create()`, which is how `can_register_death` is done: `list`, `retrieve`,
`update` and `destroy` need it too, and a check written into one method is a
check the other five do not have.
"""
from apps.core.permissions import HasValidApiKey


class HasApiKeyCapability(HasValidApiKey):
    """Requires a valid API key that also carries a named capability.

    Subclasses set `capability`. Inherits the key-presence check from
    `HasValidApiKey` rather than restating it -- restating it is how the two
    would drift.
    """

    capability = None

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        api_key = getattr(request, "api_key", None)
        if api_key is None:
            return False
        assert self.capability, "subclass must name a capability"
        return bool(getattr(api_key, self.capability, False))

    def has_object_permission(self, request, view, obj):
        return self.has_permission(request, view)


class CanManageWebhooks(HasApiKeyCapability):
    capability = "can_manage_webhooks"


class CanQueryStatus(HasApiKeyCapability):
    capability = "can_query_status"


__all__ = ["CanManageWebhooks", "CanQueryStatus", "HasApiKeyCapability"]
