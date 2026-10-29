"""The target tenant can act on a dispatch, and a participant on a judgment.

These are the paths `apps/dispatch/tests.py` has 767 lines about and never
exercised: every user in that file is `role="ADMIN"`, and ADMIN
short-circuits `TenantPermission.has_object_permission` before any tenant
comparison happens. `test_target_can_approve` there proves that ADMIN can
approve, not that the target tenant can.

Instrumenting the whole suite on 2026-08-29 put a number on it: of 328 test
functions that reach `has_object_permission`, 224 take the ADMIN bypass on
every single call, and **zero** exercise both paths. So no test could go red
for a regression on the non-ADMIN side.

What was actually broken: `DispatchService.propose()` stamps
`DispatchRecord.tenant` from `source_tenant`, and the generic object check
compares that column -- so the target tenant, the only party entitled to
approve or execute, was 403'd by `get_object()` before
`views.py`'s "Only target tenant can approve" ever ran. Same shape on
`CrossTenantJudgment`, where `tenant` is the initiator's and participants were
403'd on retrieve/participate/conclude, i.e. on the whole point of the model.

Every user here is deliberately NOT ADMIN.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    DispatchRecord,
    DispatchStatus,
)
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
BASE = "/api/v1/dispatch"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def both_sides(db):
    a = Tenant.objects.get_or_create(code="TT_A", defaults={"display_name": "TT A"})[0]
    b = Tenant.objects.get_or_create(code="TT_B", defaults={"display_name": "TT B"})[0]
    c = Tenant.objects.get_or_create(code="TT_C", defaults={"display_name": "TT C"})[0]
    # MODERATOR holds dispatch.manage/approve/reject/execute; not ADMIN.
    mod_a = User.objects.create_user(
        username="tt_mod_a", password="x", role="MODERATOR", tenant=a
    )
    mod_b = User.objects.create_user(
        username="tt_mod_b", password="x", role="MODERATOR", tenant=b
    )
    mod_c = User.objects.create_user(
        username="tt_mod_c", password="x", role="MODERATOR", tenant=c
    )
    soul = Soul.objects.create(name="TravellingSoul", current_state=SoulState.ALIVE, tenant=a)
    record = DispatchRecord.objects.create(
        source_tenant=a, target_tenant=b, soul=soul,
        dispatched_by=mod_a, status=DispatchStatus.PROPOSED, tenant=a,
    )
    return {
        "a": a, "b": b, "c": c, "soul": soul, "record": record,
        "client_a": _jwt_client(mod_a, a),
        "client_b": _jwt_client(mod_b, b),
        "client_c": _jwt_client(mod_c, c),
    }


@pytest.mark.django_db
def test_the_target_tenant_can_retrieve_the_dispatch_it_must_decide(both_sides):
    resp = both_sides["client_b"].get(f"{BASE}/records/{both_sides['record'].pk}/")
    assert resp.status_code == 200, (
        f"the target tenant got {resp.status_code} on a dispatch addressed to "
        f"it. `tenant` on this row is the SOURCE tenant, so a check that "
        f"compares that column locks out the only party entitled to act."
    )


@pytest.mark.django_db
def test_the_target_tenant_can_approve(both_sides):
    resp = both_sides["client_b"].post(
        f"{BASE}/records/{both_sides['record'].pk}/approve/", {}, format="json"
    )
    assert resp.status_code == 200, (
        f"approve returned {resp.status_code} to the target tenant. The comment "
        f"'Only target tenant can approve' sits below code that never ran."
    )
    both_sides["record"].refresh_from_db()
    assert both_sides["record"].status == DispatchStatus.APPROVED


@pytest.mark.django_db
def test_the_source_tenant_still_cannot_approve_its_own_proposal(both_sides):
    """The action-level rule must survive the object-level fix.

    Reachability is not authority. Opening `get_object()` to both parties has
    to leave "only the target may approve" standing, or this trades a lockout
    for a self-approval.
    """
    resp = both_sides["client_a"].post(
        f"{BASE}/records/{both_sides['record'].pk}/approve/", {}, format="json"
    )
    assert resp.status_code == 403, (
        f"the source tenant approved its own dispatch ({resp.status_code})"
    )
    both_sides["record"].refresh_from_db()
    assert both_sides["record"].status == DispatchStatus.PROPOSED


@pytest.mark.django_db
def test_an_uninvolved_tenant_reaches_nothing(both_sides):
    """End-to-end negative control.

    NOTE ON WHAT THIS DOES *NOT* PROVE. Mutating the permission class to
    `return True` -- i.e. "any tenant may act on any dispatch" -- leaves this
    test green. `get_queryset()` filters the record out first, so an
    uninvolved tenant gets its 404 from the queryset and the permission class
    is never consulted. This assertion is satisfied for the right reason today
    and for a different reason than it appears to be.

    That is worth stating rather than deleting: defence in depth is the point,
    and this pins the outer layer. The permission class itself is pinned
    directly below, where a mutation *does* go red.
    """
    resp = both_sides["client_c"].get(f"{BASE}/records/{both_sides['record'].pk}/")
    assert resp.status_code in (403, 404), (
        f"a tenant that is neither source nor target got {resp.status_code}"
    )
    resp = both_sides["client_c"].post(
        f"{BASE}/records/{both_sides['record'].pk}/approve/", {}, format="json"
    )
    assert resp.status_code in (403, 404)


@pytest.mark.django_db
def test_a_participant_tenant_can_retrieve_a_cross_tenant_judgment(both_sides):
    judgment = CrossTenantJudgment.objects.create(
        title="Joint", description="d",
        initiating_tenant=both_sides["a"], tenant=both_sides["a"],
    )
    CrossTenantJudgmentParticipant.objects.create(
        judgment=judgment, participant_tenant=both_sides["b"], role="CO_JUDGE",
    )
    resp = both_sides["client_b"].get(
        f"{BASE}/cross-tenant-judgments/{judgment.pk}/"
    )
    assert resp.status_code == 200, (
        f"a participating tenant got {resp.status_code} on the judgment it was "
        f"added to. Joint cross-tenant judgment is what this model is for."
    )


@pytest.mark.django_db
def test_a_non_participant_tenant_still_cannot(both_sides):
    """Negative control for the judgment side."""
    judgment = CrossTenantJudgment.objects.create(
        title="Closed", description="d",
        initiating_tenant=both_sides["a"], tenant=both_sides["a"],
    )
    resp = both_sides["client_c"].get(
        f"{BASE}/cross-tenant-judgments/{judgment.pk}/"
    )
    assert resp.status_code in (403, 404), (
        f"a tenant that neither opened nor joined the judgment got "
        f"{resp.status_code}"
    )


# ---------------------------------------------------------------------------
# The permission classes, called directly.
#
# Everything above goes through the API, where `get_queryset()` filters first.
# That makes the end-to-end negative controls unable to fail when the object
# rule is loosened -- measured: replacing both `has_object_permission` bodies
# with `return True` left all six API tests green. A guard that cannot be made
# to fail has not been shown to guard anything, so the rule gets its own test
# at the layer it lives on.
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_the_dispatch_object_rule_admits_exactly_the_two_parties(both_sides):
    from apps.dispatch.permissions import DispatchPartyPermission

    rule = DispatchPartyPermission()
    record = both_sides["record"]

    class _Req:
        def __init__(self, user, tenant):
            self.user = user
            self.tenant = tenant

    def _may(tenant_key, username):
        user = User.objects.get(username=username)
        return rule.has_object_permission(
            _Req(user, both_sides[tenant_key]), None, record
        )

    assert _may("a", "tt_mod_a") is True, "the source tenant is a party"
    assert _may("b", "tt_mod_b") is True, "the target tenant is a party"
    assert _may("c", "tt_mod_c") is False, (
        "a tenant that is neither source nor target was admitted -- "
        "'either party' has become 'anyone'"
    )


@pytest.mark.django_db
def test_the_judgment_object_rule_admits_initiator_and_participants_only(both_sides):
    from apps.dispatch.permissions import CrossJudgmentPartyPermission

    judgment = CrossTenantJudgment.objects.create(
        title="Direct", description="d",
        initiating_tenant=both_sides["a"], tenant=both_sides["a"],
    )
    CrossTenantJudgmentParticipant.objects.create(
        judgment=judgment, participant_tenant=both_sides["b"], role="CO_JUDGE",
    )
    rule = CrossJudgmentPartyPermission()

    class _Req:
        def __init__(self, user, tenant):
            self.user = user
            self.tenant = tenant

    def _may(tenant_key, username):
        user = User.objects.get(username=username)
        return rule.has_object_permission(
            _Req(user, both_sides[tenant_key]), None, judgment
        )

    assert _may("a", "tt_mod_a") is True, "the initiating tenant"
    assert _may("b", "tt_mod_b") is True, "a participating tenant"
    assert _may("c", "tt_mod_c") is False, (
        "an uninvolved tenant was admitted to a cross-tenant judgment"
    )


@pytest.mark.django_db
def test_no_tenant_on_the_request_is_refused_by_both_rules(both_sides):
    """`request.tenant` is None whenever the caller skipped TenantMiddleware.

    Fail-closed is the only safe answer there, and it is the answer the generic
    TenantPermission gives -- these subclasses must not have relaxed it.
    """
    from apps.dispatch.permissions import (
        CrossJudgmentPartyPermission,
        DispatchPartyPermission,
    )

    class _Req:
        def __init__(self, user):
            self.user = user
            self.tenant = None

    user = User.objects.get(username="tt_mod_b")
    assert (
        DispatchPartyPermission().has_object_permission(
            _Req(user), None, both_sides["record"]
        )
        is False
    )
    judgment = CrossTenantJudgment.objects.create(
        title="NoTenant", description="d",
        initiating_tenant=both_sides["a"], tenant=both_sides["a"],
    )
    assert (
        CrossJudgmentPartyPermission().has_object_permission(
            _Req(user), None, judgment
        )
        is False
    )


@pytest.mark.django_db
def test_the_target_tenant_cannot_rewrite_the_proposers_reason(both_sides):
    """Reachability is not authority for CRUD either: the target decides, it does not edit the source's reason."""
    record = both_sides["record"]
    record.reason = "original"
    record.save(update_fields=["reason"])
    url = f"{BASE}/records/{record.pk}/"
    resp = both_sides["client_b"].patch(url, {"reason": "rewritten by target"}, format="json")
    assert resp.status_code == 403, resp.status_code
    record.refresh_from_db()
    assert record.reason == "original"
    resp = both_sides["client_a"].patch(url, {"reason": "clarified by source"}, format="json")
    assert resp.status_code == 200, resp.content
    record.refresh_from_db()
    assert record.reason == "clarified by source"


@pytest.mark.django_db
def test_the_source_tenant_cannot_reject_its_own_proposal(both_sides):
    """RBAC 严查 2026-10-29 M4:驳回只许目标殿,与 approve / execute 同一条。撤回走 `cancel`。"""
    from apps.notifications.models import UserNotification

    record = both_sides["record"]
    url = f"{BASE}/records/{record.pk}/reject/"
    resp = both_sides["client_a"].post(url, {"reason": "self-rejected"}, format="json")
    assert resp.status_code == 403, resp.status_code
    record.refresh_from_db()
    assert record.status == DispatchStatus.PROPOSED and record.decided_by_id is None
    assert not UserNotification.objects.filter(notification_type="DISPATCH_REJECTED").exists()

    resp = both_sides["client_b"].post(url, {"reason": "not ours"}, format="json")
    assert resp.status_code == 200, resp.content
    record.refresh_from_db()
    assert record.status == DispatchStatus.REJECTED


@pytest.mark.django_db
@pytest.mark.parametrize("decided", [DispatchStatus.APPROVED, DispatchStatus.EXECUTED])
def test_the_reason_is_locked_once_the_target_has_decided(both_sides, decided):
    """RBAC 严查 2026-10-29 L2:对方据以批准的理由,批准 / 执行后发起殿不能再改。"""
    record = both_sides["record"]
    DispatchRecord.objects.filter(pk=record.pk).update(status=decided, reason="what they approved")
    resp = both_sides["client_a"].patch(f"{BASE}/records/{record.pk}/", {"reason": "rewritten later"}, format="json")
    assert resp.status_code == 409, resp.status_code
    assert resp.data["code"] == "reason_locked"
    record.refresh_from_db()
    assert record.reason == "what they approved"


def _global_admin_client(username="tt_global_admin"):
    from rest_framework_simplejwt.tokens import RefreshToken

    admin = User.objects.create_user(username=username, password="x", role="ADMIN", tenant=None)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(admin).access_token}")
    return client


@pytest.mark.django_db
def test_a_hall_less_admin_approves_and_executes(both_sides):
    """决定 25:无殿 ADMIN 做批准 / 执行,目标殿判断视为满足(与取消、建单一致)。此前它没有 request.tenant,永远 403。"""
    record = both_sides["record"]
    client = _global_admin_client()
    resp = client.post(f"{BASE}/records/{record.pk}/approve/", {}, format="json")
    assert resp.status_code == 200, resp.content
    record.refresh_from_db()
    assert record.status == DispatchStatus.APPROVED
    resp = client.post(f"{BASE}/records/{record.pk}/execute/", {}, format="json")
    assert resp.status_code == 200, resp.content
    record.refresh_from_db()
    assert record.status == DispatchStatus.EXECUTED


@pytest.mark.django_db
def test_a_hall_less_admin_rejects(both_sides):
    record = both_sides["record"]
    resp = _global_admin_client().post(f"{BASE}/records/{record.pk}/reject/", {"reason": "no"}, format="json")
    assert resp.status_code == 200, resp.content
    record.refresh_from_db()
    assert record.status == DispatchStatus.REJECTED


@pytest.mark.django_db
def test_an_admin_bound_to_the_source_hall_still_cannot_decide(both_sides):
    """放行只给无殿 ADMIN:源殿的 ADMIN 不能借 ADMIN 身份替目标殿批自己的提案。"""
    record = both_sides["record"]
    admin_a = User.objects.create_user(username="tt_admin_a", password="x", role="ADMIN", tenant=both_sides["a"])
    client = _jwt_client(admin_a, both_sides["a"])
    for verb in ("approve", "reject"):
        resp = client.post(f"{BASE}/records/{record.pk}/{verb}/", {"reason": "x"}, format="json")
        assert resp.status_code == 403, (verb, resp.status_code)
    record.refresh_from_db()
    assert record.status == DispatchStatus.PROPOSED


@pytest.mark.django_db
def test_each_side_reads_the_other_halls_name_not_its_people(both_sides):
    """决定 24:调拨跨殿读只给对方殿名。发起人是源殿的人、拍板人是目标殿的人,对方读到 null。"""
    record = both_sides["record"]
    url = f"{BASE}/records/{record.pk}/"
    theirs = both_sides["client_b"].get(url).data
    assert (theirs["dispatched_by"], theirs["dispatched_by_name"]) == (None, None)
    assert theirs["source_tenant_code"] == "TT_A"
    ours = both_sides["client_a"].get(url).data
    assert ours["dispatched_by_name"] == "tt_mod_a"

    approved = both_sides["client_b"].post(f"{url}approve/", {}, format="json").data
    # 动作的响应同样按请求的殿收(此前这些响应不带请求上下文)。
    assert approved["decided_by_name"] == "tt_mod_b" and approved["dispatched_by_name"] is None
    ours = both_sides["client_a"].get(url).data
    assert (ours["decided_by"], ours["decided_by_name"]) == (None, None)
    assert ours["dispatched_by_name"] == "tt_mod_a"
    # 无殿 ADMIN 看全部。
    full = _global_admin_client("tt_global_reader").get(url).data
    assert (full["dispatched_by_name"], full["decided_by_name"]) == ("tt_mod_a", "tt_mod_b")
