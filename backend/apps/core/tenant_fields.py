"""Write-side tenant checks for related fields.

Why this module exists
----------------------
`scope_to_tenant` guards the READ side: it is called from `get_queryset`, and
`tests/test_tenant_scoping_contract.py` walks the URLconf to prove every viewset
calls it. That contract says of itself (`:24-30`) that it does not cover write
paths — and the write side had no equivalent.

The gap is not theoretical. A `PrimaryKeyRelatedField` declared as::

    soul = serializers.PrimaryKeyRelatedField(queryset=Soul.objects.all())

resolves against `TenantManager`, which filters `is_deleted` and **nothing
else** (`apps/tenants/managers.py:35-53`). At POST time there is no
`get_queryset()` in the path at all, so any tenant's primary key validates.
Measured 2026-09-07: five serializers had this shape across judgment,
reincarnation, disposition, workflow and org. On `POST /judgment/` the
consequence was not merely a bad row — `perform_create` then called
`soul.transition_to(JUDGING)`, moving another tenant's soul out of ALIVE.

Four sibling serializers had already been fixed one at a time
(`ApprovalNodeSerializer.validate_workflow`, `DispositionSerializer.validate_soul`,
and three in social). This module is that fix stated once so the sixth occurrence
does not have to be found by another audit.

ADMIN is exempt, for the same reason it is exempt in `apps/core/tenant.py`:
it is the one globally scoped role, and that module is where the decision lives.

The tenant is read from the request, falling back to the user's own column —
`force_authenticate` (used by 105 tests) never runs `TenantMiddleware`, so
`request.tenant` is unset there while `user.tenant` is not. Without the
fallback this check would be silently inert in half the suite.
"""

from rest_framework import serializers


def same_tenant_or_404_message(value, context, what: str):
    """Raise unless `value` belongs to the requester's tenant.

    `what` names the thing in the error, which is phrased as "no such X" rather
    than "wrong tenant": a write must not confirm that another tenant's row
    exists, for the same reason `tests/test_tenant_isolation.py` pins reads at
    404 rather than 403.
    """
    if value is None:
        return value

    request = context.get("request")
    user = getattr(request, "user", None)
    if getattr(user, "role", None) == "ADMIN":
        return value

    tenant = getattr(request, "tenant", None) or getattr(user, "tenant", None)
    value_tenant_id = getattr(value, "tenant_id", None)

    # A model with no tenant column is global by construction (menus, perm).
    # `TenantPermission.has_object_permission` makes the same distinction, and
    # for the same reason: absent column and NULL column are different facts.
    if not hasattr(value, "tenant_id"):
        return value

    if tenant is None or value_tenant_id != tenant.pk:
        raise serializers.ValidationError(
            f"No such {what} in this tenant."
        )
    return value


def tenant_scoped(what: str):
    """Build a `validate_<field>` method that checks tenant ownership.

    Used as::

        validate_soul = tenant_scoped("soul")

    rather than a custom field class, because DRF resolves the PK against the
    field's own queryset before any field-level hook runs — the check has to
    happen after resolution, and `validate_<field>` is where that is.
    """

    def _validate(self, value):
        return same_tenant_or_404_message(value, self.context, what)

    _validate.__name__ = f"validate_{what}"
    _validate.__doc__ = (
        f"Reject a `{what}` belonging to another tenant. See "
        "apps/core/tenant_fields.py for why the field's own queryset cannot "
        "do this."
    )
    return _validate
