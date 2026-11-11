"""A cross-tenant transfer is proposed by the tenant that holds the soul.

BD-02 (P0), 2026-09-12. `DispatchRecordViewSet.create` handed the client's
`source_tenant` straight to `DispatchService.propose`, and `propose` checked
only that the soul belongs to *that* source tenant — never that the source
tenant is the requester's. So a CN MODERATOR could send three requests:

    POST /dispatch/records/          {source_tenant: EU, target_tenant: CN, soul: <EU soul>}
    POST /dispatch/records/{id}/approve/     (CN is the target — allowed)
    POST /dispatch/records/{id}/execute/     (CN is the target — allowed)

and the EU soul was CN's, every response 2xx. `DispatchPartyPermission` was
satisfied throughout because CN genuinely was a party to the record — CN wrote
itself in as one.

The rule the user set: cross-tenant transfer is allowed, and it is the soul's
own tenant that proposes it. ADMIN keeps the global exemption it has everywhere
else in this codebase.

BD-16 is in the same file because it is the same service: `execute` dropped
`transition_to`'s return value, so a record whose status had moved under it
(cancelled from another session between the caller's read and the execute)
still transferred the soul and returned 200 with the record reading CANCELLED.

Clients are each hall's own ADMIN — holds dispatch.manage/approve/execute and,
bound to a hall, is not tenant-exempt (2026-10-29) — carrying a JWT with
`tenant_code`, so `request.tenant` is set the way TenantMiddleware sets it in
production. MODERATOR played this part until 2026-11-07 (perm/0036).
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()
URL = "/api/v1/dispatch/records/"


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def realms(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})[0]
    eu = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
    )[0]
    cn_mod = User.objects.create_user(username="dp_cn_mod", password="x", role="ADMIN", tenant=cn)
    eu_mod = User.objects.create_user(username="dp_eu_mod", password="x", role="ADMIN", tenant=eu)
    cn_admin = User.objects.create_user(username="dp_cn_admin", password="x", role="ADMIN", tenant=None)
    return {
        "cn": cn,
        "eu": eu,
        "cn_mod": cn_mod,
        "eu_mod": eu_mod,
        "cn_soul": Soul.objects.create(name="CN Soul", current_state=SoulState.JUDGING, tenant=cn),
        "eu_soul": Soul.objects.create(name="EU Soul", current_state=SoulState.JUDGING, tenant=eu),
        "client_cn": _jwt_client(cn_mod, cn),
        "client_eu": _jwt_client(eu_mod, eu),
        "client_admin": _jwt_client(cn_admin, cn),
    }


# ---------------------------------------------------------------------------
# BD-02
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_a_tenant_cannot_propose_another_tenants_soul_to_itself(realms):
    eu_soul = realms["eu_soul"]
    resp = realms["client_cn"].post(URL, {
        "source_tenant": realms["eu"].pk,
        "target_tenant": realms["cn"].pk,
        "soul": str(eu_soul.id),
        "reason": "come here, the soul is wanted in this hall",
    }, format="json")

    assert resp.status_code == 403, resp.data
    # The whole point: no record for CN to approve and execute a moment later.
    assert not DispatchRecord.all_objects.filter(soul=eu_soul).exists()
    eu_soul.refresh_from_db()
    assert eu_soul.tenant_id == realms["eu"].pk


@pytest.mark.django_db
def test_nor_propose_it_to_a_third_tenant(realms):
    """Same forgery with CN as neither party in the body — source must still be CN."""
    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Egyptian Duat"})[0]
    eu_soul = realms["eu_soul"]
    resp = realms["client_cn"].post(URL, {
        "source_tenant": realms["eu"].pk,
        "target_tenant": eg.pk,
        "soul": str(eu_soul.id),
        "reason": "go there, the soul is wanted in that hall",
    }, format="json")

    assert resp.status_code == 403, resp.data
    assert not DispatchRecord.all_objects.filter(soul=eu_soul).exists()


@pytest.mark.django_db
def test_the_souls_own_tenant_still_proposes_and_the_transfer_still_completes(realms):
    """Positive control, end to end: cross-tenant transfer is allowed — by the
    right party. CN proposes its own soul to EU; EU approves and executes."""
    cn_soul = realms["cn_soul"]
    resp = realms["client_cn"].post(URL, {
        "source_tenant": realms["cn"].pk,
        "target_tenant": realms["eu"].pk,
        "soul": str(cn_soul.id),
        "reason": "exchange between the two halls, as agreed",
    }, format="json")
    assert resp.status_code == 201, resp.data
    record_id = resp.data["id"]

    assert realms["client_eu"].post(f"{URL}{record_id}/approve/", {}, format="json").status_code == 200
    assert realms["client_eu"].post(f"{URL}{record_id}/execute/", {}, format="json").status_code == 200
    cn_soul.refresh_from_db()
    assert cn_soul.tenant_id == realms["eu"].pk


@pytest.mark.django_db
def test_admin_keeps_the_global_exemption(realms):
    eu_soul = realms["eu_soul"]
    resp = realms["client_admin"].post(URL, {
        "source_tenant": realms["eu"].pk,
        "target_tenant": realms["cn"].pk,
        "soul": str(eu_soul.id),
        "reason": "admin moves it under the global exemption",
    }, format="json")
    assert resp.status_code == 201, resp.data


@pytest.mark.django_db
def test_the_party_rules_on_the_three_decisions_are_unchanged(realms):
    """With source pinned to the proposer, the decision rules still hold:
    only the target approves and executes; the source cannot approve its own
    proposal. Restated here so a later change to `create` cannot loosen them
    unnoticed."""
    record = DispatchService.propose(realms["cn"], realms["eu"], realms["cn_soul"], realms["cn_mod"], "r")

    assert realms["client_cn"].post(f"{URL}{record.pk}/approve/", {}, format="json").status_code == 403
    assert realms["client_cn"].post(f"{URL}{record.pk}/execute/", {}, format="json").status_code == 403
    record.refresh_from_db()
    assert record.status == DispatchStatus.PROPOSED


# ---------------------------------------------------------------------------
# BD-16
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_execute_refuses_when_the_record_moved_underneath_it(realms):
    """The caller read APPROVED; the record is CANCELLED by the time the
    locked transition runs. `can_transition_to` on the stale in-memory row
    passes; `transition_to` on the locked DB row returns False. That False
    used to be dropped — soul moved, status stayed CANCELLED, 200."""
    record = DispatchService.propose(realms["cn"], realms["eu"], realms["cn_soul"], realms["cn_mod"], "r")
    DispatchService.approve(record, realms["eu_mod"])
    stale = DispatchRecord.all_objects.get(pk=record.pk)
    assert stale.status == DispatchStatus.APPROVED

    # Another session withdraws it.
    DispatchService.cancel(DispatchRecord.all_objects.get(pk=record.pk), realms["cn_mod"])

    with pytest.raises(ValueError, match="Cannot execute"):
        DispatchService.execute(stale, realms["eu_mod"])

    soul = Soul.objects.get(pk=realms["cn_soul"].pk)
    assert soul.tenant_id == realms["cn"].pk, "the soul changed hands on a refused execute"
    record.refresh_from_db()
    assert record.status == DispatchStatus.CANCELLED
    assert record.executed_at is None


@pytest.mark.django_db
def test_the_api_reports_that_refusal_not_success(realms):
    record = DispatchService.propose(realms["cn"], realms["eu"], realms["cn_soul"], realms["cn_mod"], "r")
    DispatchService.approve(record, realms["eu_mod"])
    DispatchService.cancel(DispatchRecord.all_objects.get(pk=record.pk), realms["cn_mod"])

    resp = realms["client_eu"].post(f"{URL}{record.pk}/execute/", {}, format="json")
    assert resp.status_code == 400, resp.data
    soul = Soul.objects.get(pk=realms["cn_soul"].pk)
    assert soul.tenant_id == realms["cn"].pk


# ---------------------------------------------------------------------------
# Audit 2026-11-11 A1-03
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_a_direct_proposal_honours_the_callers_data_scope(realms):
    """The draft path checked the soul's data scope (`tenant_scoped("soul")`); the direct POST did not, so an
    officer narrowed to one organisation proposed a soul of another. Now both answer the same 400."""
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import Permission, Role, RolePermission
    from tests.data_scope_support import org, scope

    invalidate_all_permissions()
    role = Role.objects.create(name="DISPATCH_CLERK", display_name="DISPATCH_CLERK")
    for codename in ("dispatch.read", "dispatch.manage"):
        perm, _ = Permission.objects.get_or_create(codename=codename,
                                                   defaults={"name": codename, "category": "dispatch"})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    cn = realms["cn"]
    mine, theirs = org(cn, "本司"), org(cn, "他司")
    clerk = User.objects.create_user(username="dp_clerk", password="x", role="DISPATCH_CLERK", tenant=cn,
                                     organization=mine)
    scope("DISPATCH_CLERK", "ORG")
    outside = Soul.objects.create(name="范围外魂", current_state=SoulState.JUDGING, tenant=cn, owner_org=theirs)
    inside = Soul.objects.create(name="范围内魂", current_state=SoulState.JUDGING, tenant=cn, owner_org=mine)
    client = _jwt_client(clerk, cn)

    def post(soul):
        return client.post(URL, {"source_tenant": cn.pk, "target_tenant": realms["eu"].pk, "soul": str(soul.pk),
                                 "reason": "exchange between the two halls, as agreed"}, format="json")

    resp = post(outside)
    assert resp.status_code == 400 and "soul" in resp.data, resp.data
    assert not DispatchRecord.all_objects.filter(soul=outside).exists()
    assert post(inside).status_code == 201
    invalidate_all_permissions()


@pytest.mark.django_db
def test_the_hall_less_admin_without_a_source_hall_gets_a_400_not_a_500(realms):
    resp = realms["client_admin"].post(URL, {
        "target_tenant": realms["cn"].pk,
        "soul": str(realms["eu_soul"].id),
        "reason": "admin forgot to say where the soul is",
    }, format="json")
    assert resp.status_code == 400 and resp.data["code"] == "source_tenant_required", resp.data
    assert not DispatchRecord.all_objects.filter(soul=realms["eu_soul"]).exists()
