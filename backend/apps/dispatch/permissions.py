"""Object-level permissions for records that two tenants share by design.

`apps.core.permissions.TenantPermission.has_object_permission` compares
`obj.tenant` to `request.tenant`. That is the right rule for every model whose
`tenant` column means "who owns this". It is the wrong rule for the two models
in this app, where that column records *provenance* -- which tenant opened the
record -- and access belongs to two tenants at once.

The consequences ran in both directions at once, from one line:

  * `DispatchRecord.tenant` is stamped from `source_tenant` by
    `DispatchService.propose()`. So for a real A->B dispatch the target tenant
    B never matched, and `retrieve`, `approve`, `reject` and `execute` all
    returned 403 to the only tenant entitled to call them. Measured
    2026-08-29: B could LIST the record and see it in `/proposed/`, then got
    403 on every action. The comments at `views.py` "Only target tenant can
    approve" and "Verify executor is from target tenant" sat below code that
    could not be reached, because `get_object()` refused first.

  * The same comparison is what made the soul-theft chain work. An attacker
    seeds a self-dispatch (source == target == own tenant), which pins
    `obj.tenant` to themselves, and then re-points `soul`/`source_tenant`
    underneath a check that keeps passing. That half is closed in
    `serializers.py`; this file closes the other half.

  * `CrossTenantJudgment.tenant` is likewise the initiator's. Participants
    could list a judgment and were then 403'd on `retrieve`, `participate` and
    `conclude` -- the entire purpose of the model. It also made
    `participate()`'s own `is_initiating or is_participant` guard unreachable:
    the callers it was written to reject are stopped upstream, and the callers
    it would accept can never arrive.

Why 767 lines of tests did not catch either: every user in
`apps/dispatch/tests.py` is `role="ADMIN"`, and ADMIN short-circuits
`has_object_permission`. `test_target_can_approve` proves that ADMIN can
approve, not that the target tenant can. Instrumenting the whole suite put a
number on how general that is: of 328 test functions that reach
`has_object_permission`, 224 take the ADMIN bypass on every single call, and
**zero** exercise both paths.

`tests/test_tenant_scoping_contract.py` already lists exactly these two
viewsets in its `EXEMPT` dict, with a note saying their whole reason for
existing is to be cross-tenant. That fact was recorded and never carried over
to the object layer.
"""
from apps.core.permissions import TenantPermission


class DispatchPartyPermission(TenantPermission):
    """Either party to a dispatch may act on it.

    `has_permission` is inherited unchanged -- the tenant-context and
    authentication rules are the same as everywhere else. Only the object rule
    differs, and it mirrors what `DispatchRecordViewSet.get_queryset()` already
    does with `Q(source_tenant=tenant) | Q(target_tenant=tenant)`. The two were
    disagreeing: the queryset handed a record to the target tenant and the
    object check then refused it.

    This grants *reachability*, not authority. Which of the two parties may
    approve or execute is still decided in the actions themselves -- and those
    checks can finally run.
    """

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False
        if getattr(request.user, "role", None) == "ADMIN":
            return True
        tenant = getattr(request, "tenant", None)
        if tenant is None:
            return False
        return tenant.pk in (obj.source_tenant_id, obj.target_tenant_id)


class CrossJudgmentPartyPermission(TenantPermission):
    """The initiating tenant and every participating tenant may act on it.

    Mirrors `CrossTenantJudgmentViewSet.get_queryset()`'s
    `Q(initiating_tenant=tenant) | Q(participants__participant_tenant=tenant)`,
    for the same reason as above.
    """

    def has_object_permission(self, request, view, obj):
        if not request.user or not request.user.is_authenticated:
            return False
        if getattr(request.user, "role", None) == "ADMIN":
            return True
        tenant = getattr(request, "tenant", None)
        if tenant is None:
            return False
        if obj.initiating_tenant_id == tenant.pk:
            return True
        return obj.participants.filter(participant_tenant=tenant).exists()
