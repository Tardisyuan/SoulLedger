"""SNAPSHOT OF THE DEFECT — do not read this file as a specification.

Everything asserted below is what SoulLedger does *today*, defects included.
Where this file says a VIEWER may create a cross-tenant dispatch record,
approve it, execute it, and delete the audit-bearing row afterwards, it is not
saying that is correct. It is saying a real JWT through the real URLconf
produces those codes right now, and pinning them so that switching enforcement
on arrives as a reviewed diff to this file — someone looking at a 201 becoming
a 403 and saying "yes, that one" — instead of a behaviour change nobody
noticed. A failure here is not automatically a regression; it is a question.

This is the same instrument as ``apps/perm/test_matrix_snapshot.py`` (read that
first), built for the apps that file does not reach. Nothing here is policy:
none of these apps has ``CodenamePermission`` attached, so **not one** of the
codes below was produced by the codename system. They come from
``TenantPermission`` (authenticated + has a tenant), from ``IsAdminUser``
(Django ``is_staff``), from ``APIKeyAuthentication``, or from nothing at all.

Scope — why these apps and not others
-------------------------------------
The step-4 rollout enforces app by app. ``souls`` and ``ledger`` went first;
``judgment``/``disposition``/``workflow`` are a separate concurrent tranche and
are deliberately absent here. What was left was a set of apps with live write
endpoints and *no* non-ADMIN write coverage anywhere in the suite — so
enforcement could be switched on and every test would still pass. The routes
below were enumerated by walking ``config.urls`` with the resolver, not from
any inventory; two earlier passes found the audit's own list had drifted in
both directions.

27 write endpoints × 5 roles = 135 cases.

What each app turned out to be
------------------------------
* ``reincarnation`` — 5 writable endpoints, all open to all five roles.
* ``dispatch`` — 11 writable endpoints across two viewsets, all open to all
  five roles. This is the sharpest set in the file: a VIEWER proposes a
  cross-tenant soul transfer, approves it, and executes it, which moves the
  soul's ``tenant`` FK to another civilization.
* ``notifications`` — 5 writable endpoints. Every action is scoped to
  ``user=request.user`` by ``get_queryset``, so this is a person's own inbox
  and the open codes are not a cross-user hole. ``POST /notifications/`` is a
  different problem: see NOTIFICATION_CREATE below.
* ``org`` — 3 writable endpoints and **no codename declared at all**
  (``OrganizationViewSet`` does not use ``CodenameViewSetMixin``). Blocker.
* ``death_sync`` — has genuine write endpoints, but none is reachable by a
  role. ``api-keys`` is ``IsAdminUser`` (403 for all five, ADMIN included —
  that flag is ``is_staff``, not ``role == 'ADMIN'``); ``register`` and
  ``webhooks`` accept only ``APIKeyAuthentication``, so a Bearer JWT is not a
  credential there and every role gets 401. Covered so the fact is pinned,
  not because a codename could change it.
* ``audit`` — **nothing to cover.** ``AuditLogViewSet`` is a
  ``ReadOnlyModelViewSet``; the router publishes no create/update/destroy
  route, so there is no non-ADMIN write to characterize. Its reads are already
  in ``test_matrix_snapshot.py``. This absence is deliberate and is asserted
  by ``test_audit_app_publishes_no_write_routes``.

Blockers — routes whose declared codename cannot gate anything
--------------------------------------------------------------
These are what a ``permission_codename = None`` exemption looks like from the
outside, and each one must be answered before its app can be enforced:

1. ``OrganizationViewSet`` (POST/PATCH/DELETE ``/api/v1/organizations/``)
   declares no codename and has no ``get_required_permissions()``.
   ``CodenamePermission`` is deliberately permissive when a view declares
   nothing, so attaching it to this viewset changes *nothing* — org would look
   enforced and be wide open. Someone has to choose an ``org.*`` family first;
   none exists in ``DEFAULT_PERMISSIONS``.
2. ``ExternalApiKeyViewSet`` (POST ``/api/v1/death-sync/api-keys/``) declares
   no codename either. It is closed today only by ``IsAdminUser``, and closed
   so far that ADMIN cannot use it. Not urgent, but it is a write endpoint
   gated by an unrelated concept.
3. ``DeathRegistrationViewSet`` / ``WebhookViewSet`` declare no codename and
   authenticate by API key alone. Codenames are the wrong tool here; recorded
   so nobody adds one expecting it to fire.

No route in this file declares a codename that no role holds — every codename
that *is* declared (``reincarnation.manage``/``.complete``/``.reborn``,
``dispatch.manage``/``.approve``/``.reject``/``.execute``,
``notification.read``) has at least one holder. That is asserted, not assumed,
by ``test_declared_codenames_have_at_least_one_holder``.

Findings that are not permission bugs but were measured here
------------------------------------------------------------
* ``POST /api/v1/notifications/`` cannot succeed for anyone. See
  NOTIFICATION_CREATE.
* ``apps/notifications/views.py`` carries a comment saying "only ADMIN and
  MODERATOR hold notification.read, so under enforcement JUDGE, GUARDIAN and
  VIEWER lose their own inbox". That is not true of ``ROLE_PERMISSIONS`` as it
  stands — all five roles hold ``notification.read``, which is why enforcing
  ``notifications`` moves nothing. ``test_notification_read_is_held_by_every_role``
  pins the fact so the stale comment cannot be acted on by mistake.

The prediction
--------------
Every expectation carries the codename its route declares and the roles that
hold it per ``ROLE_PERMISSIONS``. Both halves are machine-checked rather than
merely written down: ``test_recorded_codename_matches_what_the_view_declares``
asks each viewset what it would require, and
``test_recorded_holders_match_role_permissions`` derives the holders from the
dict. ``test_predicted_moves_when_enforcement_arrives`` then computes, from
those two, exactly which (role, endpoint) codes turn into 403 the day
``CodenamePermission`` is attached — 34 of the 135. Whoever enforces these apps
next should be able to read that test's output and know in advance what moves.
"""
import uuid

import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

ROLES = ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"]

# The shape that dominates this file: the endpoint declares a codename (or
# none), nothing consults it, everyone gets in.
ALL_201 = dict.fromkeys(ROLES, 201)
ALL_200 = dict.fromkeys(ROLES, 200)
ALL_204 = dict.fromkeys(ROLES, 204)
ALL_403 = dict.fromkeys(ROLES, 403)
ALL_401 = dict.fromkeys(ROLES, 401)


# ---------------------------------------------------------------------------
# The declared-codename table.
#
# key -> (view class, DRF action, codenames the view requires for that action)
#
# `None` for the codename list means the view has no get_required_permissions()
# at all — a blocker, not an empty requirement. It is spelled differently from
# `[]` on purpose: `[]` would mean "declares the machinery, requires nothing",
# and no route here is in that state.
#
# This table is not documentation. test_recorded_codename_matches_what_the_view
# _declares instantiates each viewset, sets .action, and asserts these exact
# lists — so renaming a codename in a view breaks this file rather than
# silently invalidating every comment in it.
# ---------------------------------------------------------------------------
def _views():
    from apps.death_sync.views import DeathRegistrationViewSet, ExternalApiKeyViewSet, WebhookViewSet
    from apps.dispatch.views import CrossTenantJudgmentViewSet, DispatchRecordViewSet
    from apps.notifications.views import NotificationViewSet
    from apps.org.views import OrganizationViewSet
    from apps.reincarnation.views import ReincarnationViewSet

    return {
        "reincarnation": ReincarnationViewSet,
        "dispatch_record": DispatchRecordViewSet,
        "cross_tenant_judgment": CrossTenantJudgmentViewSet,
        "notification": NotificationViewSet,
        "organization": OrganizationViewSet,
        "external_api_key": ExternalApiKeyViewSet,
        "death_registration": DeathRegistrationViewSet,
        "webhook": WebhookViewSet,
    }


DECLARED = {
    # ── reincarnation ────────────────────────────────────────────────────
    # reincarnation.manage is held by ADMIN, MODERATOR, JUDGE, GUARDIAN.
    # VIEWER holds reincarnation.read and stops there.
    "POST /reincarnation/": ("reincarnation", "create", ["reincarnation.manage"]),
    "PATCH /reincarnation/{id}/": ("reincarnation", "partial_update", ["reincarnation.manage"]),
    "DELETE /reincarnation/{id}/": ("reincarnation", "destroy", ["reincarnation.manage"]),
    # reincarnation.complete / .reborn are held by ADMIN and MODERATOR only.
    # JUDGE and GUARDIAN hold `manage` but not these two — editing the record
    # of a rebirth and performing one are separated on purpose.
    "POST /reincarnation/{id}/complete/": ("reincarnation", "complete", ["reincarnation.complete"]),
    "POST /reincarnation/reborn/": ("reincarnation", "reborn", ["reincarnation.reborn"]),
    # ── dispatch: DispatchRecordViewSet ──────────────────────────────────
    # dispatch.manage is held by ADMIN, MODERATOR, GUARDIAN. JUDGE does not
    # hold any dispatch codename at all; VIEWER does not either.
    "POST /dispatch/records/": ("dispatch_record", "create", ["dispatch.manage"]),
    "PATCH /dispatch/records/{id}/": ("dispatch_record", "partial_update", ["dispatch.manage"]),
    "DELETE /dispatch/records/{id}/": ("dispatch_record", "destroy", ["dispatch.manage"]),
    # approve / reject / execute are held by ADMIN and MODERATOR only —
    # GUARDIAN may propose and edit a dispatch but not decide one.
    "POST /dispatch/records/{id}/approve/": ("dispatch_record", "approve", ["dispatch.approve"]),
    "POST /dispatch/records/{id}/reject/": ("dispatch_record", "reject", ["dispatch.reject"]),
    "POST /dispatch/records/{id}/execute/": ("dispatch_record", "execute", ["dispatch.execute"]),
    # ── dispatch: CrossTenantJudgmentViewSet ─────────────────────────────
    # Same `dispatch` family. The unused cross_judgment.* family in
    # DEFAULT_PERMISSIONS looks written for this viewset but is declared by no
    # view; moving to it would take cross-tenant judgment reads away from
    # GUARDIAN and hand them to JUDGE, which is a policy change and not this
    # file's business. Recorded as-declared.
    "POST /dispatch/cross-tenant-judgments/": ("cross_tenant_judgment", "create", ["dispatch.manage"]),
    "PATCH /dispatch/cross-tenant-judgments/{id}/": (
        "cross_tenant_judgment", "partial_update", ["dispatch.manage"],
    ),
    "DELETE /dispatch/cross-tenant-judgments/{id}/": ("cross_tenant_judgment", "destroy", ["dispatch.manage"]),
    "POST /dispatch/cross-tenant-judgments/{id}/participate/": (
        "cross_tenant_judgment", "participate", ["dispatch.manage"],
    ),
    "POST /dispatch/cross-tenant-judgments/{id}/conclude/": (
        "cross_tenant_judgment", "conclude", ["dispatch.manage"],
    ),
    # ── notifications ────────────────────────────────────────────────────
    # notification.read is held by all five roles, so enforcing this app moves
    # nothing. Covered anyway: an app where enforcement is a no-op is worth
    # being able to prove is a no-op.
    "POST /notifications/": ("notification", "create", ["notification.read"]),
    "PATCH /notifications/{id}/": ("notification", "partial_update", ["notification.read"]),
    "DELETE /notifications/{id}/": ("notification", "destroy", ["notification.read"]),
    "POST /notifications/{id}/mark_read/": ("notification", "mark_read", ["notification.read"]),
    "POST /notifications/mark_all_read/": ("notification", "mark_all_read", ["notification.read"]),
    # ── org — BLOCKER, declares nothing ──────────────────────────────────
    "POST /organizations/": ("organization", "create", None),
    "PATCH /organizations/{id}/": ("organization", "partial_update", None),
    "DELETE /organizations/{id}/": ("organization", "destroy", None),
    # ── death_sync — BLOCKER-adjacent, declares nothing, gated elsewhere ──
    "POST /death-sync/api-keys/": ("external_api_key", "create", None),
    "POST /death-sync/register/": ("death_registration", "create", None),
    "POST /death-sync/webhooks/": ("webhook", "create", None),
}


# ---------------------------------------------------------------------------
# The measured codes. One constant per endpoint, keyed the same as DECLARED.
# ---------------------------------------------------------------------------

# reincarnation.manage — ADMIN/MODERATOR/JUDGE/GUARDIAN hold it, VIEWER does
# not. Open to all five today; a VIEWER writes a rebirth record for any soul
# in its tenant.
REINCARNATION_CREATE = ALL_201
REINCARNATION_PATCH = ALL_200
REINCARNATION_DELETE = ALL_204

# reincarnation.complete — ADMIN and MODERATOR. This one has teeth: it walks
# the soul DISPOSED -> REINCARNATING -> ALIVE and writes the next life's
# identity. A VIEWER does it today.
REINCARNATION_COMPLETE = ALL_200

# reincarnation.reborn — ADMIN and MODERATOR. Same side effect as `complete`,
# reachable without an existing Reincarnation row.
REINCARNATION_REBORN = ALL_201

# dispatch.manage — ADMIN, MODERATOR, GUARDIAN. JUDGE and VIEWER hold nothing
# in the dispatch family, and both can create, edit and delete records today.
DISPATCH_RECORD_CREATE = ALL_201
DISPATCH_RECORD_PATCH = ALL_200
DISPATCH_RECORD_DELETE = ALL_204

# dispatch.approve / .reject / .execute — ADMIN and MODERATOR only.
# `execute` is the one that matters: it reassigns the soul's tenant FK, i.e.
# moves a soul out of one civilization's jurisdiction into another's. Today a
# VIEWER can do that, provided its own tenant is the dispatch's target — which
# it is for anything proposed *to* its realm.
DISPATCH_APPROVE = ALL_200
DISPATCH_REJECT = ALL_200
DISPATCH_EXECUTE = ALL_200

# dispatch.manage again, via CrossTenantJudgmentViewSet.
CTJ_CREATE = ALL_201
CTJ_PATCH = ALL_200
CTJ_DELETE = ALL_204
CTJ_PARTICIPATE = ALL_200
CTJ_CONCLUDE = ALL_200

# notification.read — held by every role, so these five stay exactly as they
# are under enforcement. Not a hole either way: get_queryset() pins every
# action to the caller's own rows.
NOTIFICATION_PATCH = ALL_200
NOTIFICATION_DELETE = ALL_204
NOTIFICATION_MARK_READ = ALL_200
NOTIFICATION_MARK_ALL_READ = ALL_200

# POST /notifications/ is routed and reachable and cannot succeed for anybody.
# UserNotificationSerializer marks `user` read-only and NotificationViewSet has
# no perform_create, so the default save() writes a row with user_id NULL and
# the DB refuses it. Every role gets an uncaught IntegrityError, which is a 500
# in production. Recorded as an exception rather than a status code because
# that is literally what the endpoint does — DRF never converts it.
#
# Consequence for enforcement, which is the reason it is in this file: the
# route is a broken write, not an absent one, so a reviewer skimming for
# "which writes exist" will find it. Enforcing `notification.read` does not
# change it (all five roles hold that codename); fixing it is a separate job
# and not one this file is entitled to do.

# org and death_sync: no codename anywhere, so enforcement cannot move these.
ORGANIZATION_CREATE = ALL_201
ORGANIZATION_PATCH = ALL_200
ORGANIZATION_DELETE = ALL_204
# IsAdminUser == Django is_staff. None of the five role users is staff, so
# even ADMIN is refused — the same split test_matrix_snapshot.py records for
# GET /death-sync/api-keys/.
DEATH_SYNC_API_KEY_CREATE = ALL_403
# APIKeyAuthentication is the only authenticator on these two, so a Bearer JWT
# is not a credential at all and DRF answers 401 before any permission runs.
DEATH_SYNC_REGISTER = ALL_401
DEATH_SYNC_WEBHOOK_CREATE = ALL_401


EXPECTED = {
    "POST /reincarnation/": REINCARNATION_CREATE,
    "PATCH /reincarnation/{id}/": REINCARNATION_PATCH,
    "DELETE /reincarnation/{id}/": REINCARNATION_DELETE,
    "POST /reincarnation/{id}/complete/": REINCARNATION_COMPLETE,
    "POST /reincarnation/reborn/": REINCARNATION_REBORN,
    "POST /dispatch/records/": DISPATCH_RECORD_CREATE,
    "PATCH /dispatch/records/{id}/": DISPATCH_RECORD_PATCH,
    "DELETE /dispatch/records/{id}/": DISPATCH_RECORD_DELETE,
    "POST /dispatch/records/{id}/approve/": DISPATCH_APPROVE,
    "POST /dispatch/records/{id}/reject/": DISPATCH_REJECT,
    "POST /dispatch/records/{id}/execute/": DISPATCH_EXECUTE,
    "POST /dispatch/cross-tenant-judgments/": CTJ_CREATE,
    "PATCH /dispatch/cross-tenant-judgments/{id}/": CTJ_PATCH,
    "DELETE /dispatch/cross-tenant-judgments/{id}/": CTJ_DELETE,
    "POST /dispatch/cross-tenant-judgments/{id}/participate/": CTJ_PARTICIPATE,
    "POST /dispatch/cross-tenant-judgments/{id}/conclude/": CTJ_CONCLUDE,
    # POST /notifications/ is deliberately absent: it has no status code.
    "PATCH /notifications/{id}/": NOTIFICATION_PATCH,
    "DELETE /notifications/{id}/": NOTIFICATION_DELETE,
    "POST /notifications/{id}/mark_read/": NOTIFICATION_MARK_READ,
    "POST /notifications/mark_all_read/": NOTIFICATION_MARK_ALL_READ,
    "POST /organizations/": ORGANIZATION_CREATE,
    "PATCH /organizations/{id}/": ORGANIZATION_PATCH,
    "DELETE /organizations/{id}/": ORGANIZATION_DELETE,
    "POST /death-sync/api-keys/": DEATH_SYNC_API_KEY_CREATE,
    "POST /death-sync/register/": DEATH_SYNC_REGISTER,
    "POST /death-sync/webhooks/": DEATH_SYNC_WEBHOOK_CREATE,
}


# ---------------------------------------------------------------------------
# Fixtures. Real RefreshToken JWTs carrying the tenant_code claim
# TenantMiddleware reads, driven through config.urls with DRF's APIClient.
# Nothing is mocked and no middleware is patched — a snapshot that mocked the
# permission layer would inherit exactly the blindness it exists to cover.
# ---------------------------------------------------------------------------
@pytest.fixture
def snapshot_tenants(db):
    """Home tenant (every role user lives here) plus one to dispatch against.

    CN_DIYU is deliberate: it is the only rebirth-capable cosmology
    (REBIRTH_CAPABLE_CIVILIZATIONS in apps/ledger/services.py), so the
    reincarnation endpoints reach their real side effects instead of stopping
    at a 409 that would hide whether a permission gate ran.
    """
    from apps.tenants.managers import clear_current_tenant
    from apps.tenants.models import Tenant

    clear_current_tenant()
    home, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "Chinese Diyu"})
    other, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
    )
    yield home, other
    clear_current_tenant()


@pytest.fixture
def role_clients(db, django_user_model, snapshot_tenants):
    """One authenticated APIClient per role, plus the User behind each."""
    home, _ = snapshot_tenants
    clients, users = {}, {}
    for role in ROLES:
        user, _ = django_user_model.objects.get_or_create(
            username=f"wsnap_{role.lower()}",
            defaults={"role": role, "tenant": home},
        )
        token = RefreshToken.for_user(user)
        token["tenant_code"] = home.code
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        clients[role] = client
        users[role] = user
    return clients, users


def _soul(tenant, name, state="ALIVE"):
    from apps.souls.models import Soul

    return Soul.objects.create(name=name, tenant=tenant, current_state=state)


def _reincarnation(tenant, soul):
    from apps.reincarnation.models import Reincarnation

    return Reincarnation.objects.create(soul=soul, target_realm="人间", tenant=tenant)


def _dispatch_record(home, other, soul, status="PROPOSED"):
    """A record proposed BY `other` TO `home`.

    Built in this direction on purpose. The view's own checks require the
    caller's tenant to be the target before approve/reject/execute will run,
    and `tenant` must equal the caller's tenant for TenantPermission's object
    check to pass. Pointing it the other way would produce a 403 from the
    tenant layer and the snapshot would be measuring tenant isolation instead
    of the missing codename gate.
    """
    from apps.dispatch.models import DispatchRecord

    return DispatchRecord.objects.create(
        source_tenant=other,
        target_tenant=home,
        soul=soul,
        status=status,
        reason="write-snapshot fixture",
        tenant=home,
    )


def _cross_tenant_judgment(home, status="PROPOSED"):
    from apps.dispatch.models import CrossTenantJudgment

    return CrossTenantJudgment.objects.create(
        title=f"wsnap-{uuid.uuid4().hex[:8]}",
        description="write-snapshot fixture",
        initiating_tenant=home,
        status=status,
        tenant=home,
    )


def _notification(user):
    from apps.notifications.models import UserNotification

    return UserNotification.objects.create(user=user, title="wsnap", message="wsnap")


def _organization(code):
    from apps.org.models import Organization

    return Organization.objects.create(name="wsnap", code=code, category="CHINESE")


def _is_deleted(model, pk):
    """Soft delete is the only kind here, so `gone` means is_deleted=True."""
    return model.all_objects.get(pk=pk).is_deleted


# ---------------------------------------------------------------------------
# reincarnation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_reincarnation_create(role_clients, snapshot_tenants, role):
    """reincarnation.manage (ADMIN/MODERATOR/JUDGE/GUARDIAN). VIEWER creates one anyway."""
    from apps.reincarnation.models import Reincarnation

    clients, _ = role_clients
    home, _o = snapshot_tenants
    soul = _soul(home, f"wsnap-rc-{role}")
    response = clients[role].post(
        "/api/v1/reincarnation/",
        {"soul": str(soul.id), "target_realm": "人间"},
        format="json",
    )
    assert response.status_code == REINCARNATION_CREATE[role], _msg(
        role, "POST /reincarnation/", response
    )
    # A denial that still wrote the row would be the worst of both worlds, so
    # assert the table and not just the status line.
    assert Reincarnation.objects.filter(soul=soul).exists() == (REINCARNATION_CREATE[role] == 201)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_reincarnation_partial_update(role_clients, snapshot_tenants, role):
    """reincarnation.manage. VIEWER rewrites the notes on someone else's rebirth."""
    from apps.reincarnation.models import Reincarnation

    clients, _ = role_clients
    home, _o = snapshot_tenants
    record = _reincarnation(home, _soul(home, f"wsnap-rp-{role}"))
    response = clients[role].patch(
        f"/api/v1/reincarnation/{record.id}/", {"notes": f"EDITED_BY_{role}"}, format="json"
    )
    assert response.status_code == REINCARNATION_PATCH[role], _msg(
        role, "PATCH /reincarnation/{id}/", response
    )
    expected_notes = f"EDITED_BY_{role}" if REINCARNATION_PATCH[role] == 200 else ""
    assert Reincarnation.objects.get(pk=record.pk).notes == expected_notes


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_reincarnation_destroy(role_clients, snapshot_tenants, role):
    """reincarnation.manage. VIEWER soft-deletes a rebirth record."""
    from apps.reincarnation.models import Reincarnation

    clients, _ = role_clients
    home, _o = snapshot_tenants
    record = _reincarnation(home, _soul(home, f"wsnap-rd-{role}"))
    response = clients[role].delete(f"/api/v1/reincarnation/{record.id}/")
    assert response.status_code == REINCARNATION_DELETE[role], _msg(
        role, "DELETE /reincarnation/{id}/", response
    )
    assert _is_deleted(Reincarnation, record.pk) == (REINCARNATION_DELETE[role] == 204)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_reincarnation_complete(role_clients, snapshot_tenants, role):
    """reincarnation.complete (ADMIN/MODERATOR). All five walk a soul into its next life."""
    from apps.souls.models import Soul, SoulState

    clients, _ = role_clients
    home, _o = snapshot_tenants
    soul = _soul(home, f"wsnap-rcm-{role}", state=SoulState.DISPOSED)
    record = _reincarnation(home, soul)
    response = clients[role].post(
        f"/api/v1/reincarnation/{record.id}/complete/",
        {"new_identity": f"REBORN_BY_{role}", "rebirth_form": "HUMAN"},
        format="json",
    )
    assert response.status_code == REINCARNATION_COMPLETE[role], _msg(
        role, "POST /reincarnation/{id}/complete/", response
    )
    # The rebirth actually lands: DISPOSED -> REINCARNATING -> ALIVE, and the
    # soul is renamed to the new identity. Asserted so a future 403 has to
    # prove it prevented the write, not merely reported one.
    expected_state = SoulState.ALIVE if REINCARNATION_COMPLETE[role] == 200 else SoulState.DISPOSED
    assert Soul.objects.get(pk=soul.pk).current_state == expected_state


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_reincarnation_reborn(role_clients, snapshot_tenants, role):
    """reincarnation.reborn (ADMIN/MODERATOR). Same side effect, no existing record needed."""
    from apps.souls.models import Soul, SoulState

    clients, _ = role_clients
    home, _o = snapshot_tenants
    soul = _soul(home, f"wsnap-rb-{role}", state=SoulState.DISPOSED)
    response = clients[role].post(
        "/api/v1/reincarnation/reborn/",
        {"soul_id": str(soul.id), "new_identity": f"REBORN_BY_{role}", "rebirth_form": "HUMAN"},
        format="json",
    )
    assert response.status_code == REINCARNATION_REBORN[role], _msg(
        role, "POST /reincarnation/reborn/", response
    )
    expected_state = SoulState.ALIVE if REINCARNATION_REBORN[role] == 201 else SoulState.DISPOSED
    assert Soul.objects.get(pk=soul.pk).current_state == expected_state


# ---------------------------------------------------------------------------
# dispatch — DispatchRecordViewSet
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_dispatch_record_create(role_clients, snapshot_tenants, role):
    """dispatch.manage (ADMIN/MODERATOR/GUARDIAN). JUDGE holds no dispatch codename at all."""
    from apps.dispatch.models import DispatchRecord

    clients, _ = role_clients
    home, other = snapshot_tenants
    soul = _soul(home, f"wsnap-dc-{role}")
    response = clients[role].post(
        "/api/v1/dispatch/records/",
        {
            "source_tenant": home.id,
            "target_tenant": other.id,
            "soul": str(soul.id),
            "reason": f"proposed by {role}",
        },
        format="json",
    )
    assert response.status_code == DISPATCH_RECORD_CREATE[role], _msg(
        role, "POST /dispatch/records/", response
    )
    assert DispatchRecord.objects.filter(soul=soul).exists() == (DISPATCH_RECORD_CREATE[role] == 201)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_dispatch_record_partial_update(role_clients, snapshot_tenants, role):
    """dispatch.manage. The stated reason for a soul transfer is editable by anyone."""
    from apps.dispatch.models import DispatchRecord

    clients, _ = role_clients
    home, other = snapshot_tenants
    record = _dispatch_record(home, other, _soul(other, f"wsnap-dp-{role}"))
    response = clients[role].patch(
        f"/api/v1/dispatch/records/{record.id}/", {"reason": f"REWRITTEN_BY_{role}"}, format="json"
    )
    assert response.status_code == DISPATCH_RECORD_PATCH[role], _msg(
        role, "PATCH /dispatch/records/{id}/", response
    )
    expected_reason = (
        f"REWRITTEN_BY_{role}" if DISPATCH_RECORD_PATCH[role] == 200 else "write-snapshot fixture"
    )
    assert DispatchRecord.objects.get(pk=record.pk).reason == expected_reason


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_dispatch_record_destroy(role_clients, snapshot_tenants, role):
    """dispatch.manage. A VIEWER erases the record of a proposed transfer."""
    from apps.dispatch.models import DispatchRecord

    clients, _ = role_clients
    home, other = snapshot_tenants
    record = _dispatch_record(home, other, _soul(other, f"wsnap-dd-{role}"))
    response = clients[role].delete(f"/api/v1/dispatch/records/{record.id}/")
    assert response.status_code == DISPATCH_RECORD_DELETE[role], _msg(
        role, "DELETE /dispatch/records/{id}/", response
    )
    assert _is_deleted(DispatchRecord, record.pk) == (DISPATCH_RECORD_DELETE[role] == 204)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_dispatch_approve(role_clients, snapshot_tenants, role):
    """dispatch.approve (ADMIN/MODERATOR). GUARDIAN may propose but not decide — today it decides."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    clients, _ = role_clients
    home, other = snapshot_tenants
    record = _dispatch_record(home, other, _soul(other, f"wsnap-da-{role}"))
    response = clients[role].post(f"/api/v1/dispatch/records/{record.id}/approve/", {}, format="json")
    assert response.status_code == DISPATCH_APPROVE[role], _msg(
        role, "POST /dispatch/records/{id}/approve/", response
    )
    expected = DispatchStatus.APPROVED if DISPATCH_APPROVE[role] == 200 else DispatchStatus.PROPOSED
    assert DispatchRecord.objects.get(pk=record.pk).status == expected


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_dispatch_reject(role_clients, snapshot_tenants, role):
    """dispatch.reject (ADMIN/MODERATOR). Refusing another realm's request is also a decision."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    clients, _ = role_clients
    home, other = snapshot_tenants
    record = _dispatch_record(home, other, _soul(other, f"wsnap-dr-{role}"))
    response = clients[role].post(
        f"/api/v1/dispatch/records/{record.id}/reject/", {"reason": f"refused by {role}"}, format="json"
    )
    assert response.status_code == DISPATCH_REJECT[role], _msg(
        role, "POST /dispatch/records/{id}/reject/", response
    )
    expected = DispatchStatus.REJECTED if DISPATCH_REJECT[role] == 200 else DispatchStatus.PROPOSED
    assert DispatchRecord.objects.get(pk=record.pk).status == expected


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_dispatch_execute(role_clients, snapshot_tenants, role):
    """dispatch.execute (ADMIN/MODERATOR). The sharpest row in this file.

    Executing a dispatch reassigns the soul's tenant FK — it moves a soul out
    of one civilization's jurisdiction and into another's, which is the single
    largest data-ownership change the API can make. Every role can do it today
    for anything proposed to its own realm.
    """
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.souls.models import Soul

    clients, _ = role_clients
    home, other = snapshot_tenants
    soul = _soul(other, f"wsnap-de-{role}")
    record = _dispatch_record(home, other, soul, status=DispatchStatus.APPROVED)
    response = clients[role].post(f"/api/v1/dispatch/records/{record.id}/execute/", {}, format="json")
    assert response.status_code == DISPATCH_EXECUTE[role], _msg(
        role, "POST /dispatch/records/{id}/execute/", response
    )
    executed = DISPATCH_EXECUTE[role] == 200
    assert DispatchRecord.objects.get(pk=record.pk).status == (
        DispatchStatus.EXECUTED if executed else DispatchStatus.APPROVED
    )
    # The soul actually changes hands. Pinned separately from the status code:
    # a 200 that did not move the soul, or a 403 that did, are both findings.
    assert Soul.objects.get(pk=soul.pk).tenant_id == (home.id if executed else other.id)


# ---------------------------------------------------------------------------
# dispatch — CrossTenantJudgmentViewSet
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_cross_tenant_judgment_create(role_clients, snapshot_tenants, role):
    """dispatch.manage (ADMIN/MODERATOR/GUARDIAN). A VIEWER convenes a joint tribunal."""
    from apps.dispatch.models import CrossTenantJudgment

    clients, _ = role_clients
    home, _o = snapshot_tenants
    title = f"wsnap-ctj-{role}-{uuid.uuid4().hex[:6]}"
    response = clients[role].post(
        "/api/v1/dispatch/cross-tenant-judgments/",
        {"title": title, "description": f"convened by {role}", "initiating_tenant": home.id},
        format="json",
    )
    assert response.status_code == CTJ_CREATE[role], _msg(
        role, "POST /dispatch/cross-tenant-judgments/", response
    )
    assert CrossTenantJudgment.objects.filter(title=title).exists() == (CTJ_CREATE[role] == 201)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_cross_tenant_judgment_partial_update(role_clients, snapshot_tenants, role):
    """dispatch.manage. Renaming a tribunal in progress."""
    from apps.dispatch.models import CrossTenantJudgment

    clients, _ = role_clients
    home, _o = snapshot_tenants
    judgment = _cross_tenant_judgment(home)
    original = judgment.title
    response = clients[role].patch(
        f"/api/v1/dispatch/cross-tenant-judgments/{judgment.id}/",
        {"title": f"RETITLED_BY_{role}"},
        format="json",
    )
    assert response.status_code == CTJ_PATCH[role], _msg(
        role, "PATCH /dispatch/cross-tenant-judgments/{id}/", response
    )
    expected = f"RETITLED_BY_{role}" if CTJ_PATCH[role] == 200 else original
    assert CrossTenantJudgment.objects.get(pk=judgment.pk).title == expected


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_cross_tenant_judgment_destroy(role_clients, snapshot_tenants, role):
    """dispatch.manage. A VIEWER dissolves a joint tribunal."""
    from apps.dispatch.models import CrossTenantJudgment

    clients, _ = role_clients
    home, _o = snapshot_tenants
    judgment = _cross_tenant_judgment(home)
    response = clients[role].delete(f"/api/v1/dispatch/cross-tenant-judgments/{judgment.id}/")
    assert response.status_code == CTJ_DELETE[role], _msg(
        role, "DELETE /dispatch/cross-tenant-judgments/{id}/", response
    )
    assert _is_deleted(CrossTenantJudgment, judgment.pk) == (CTJ_DELETE[role] == 204)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_cross_tenant_judgment_participate(role_clients, snapshot_tenants, role):
    """dispatch.manage. Seats another realm on the bench, and activates the tribunal."""
    from apps.dispatch.models import CrossTenantJudgment, CrossTenantJudgmentParticipant, JudgmentStatus

    clients, _ = role_clients
    home, other = snapshot_tenants
    judgment = _cross_tenant_judgment(home)
    response = clients[role].post(
        f"/api/v1/dispatch/cross-tenant-judgments/{judgment.id}/participate/",
        {"participant_tenant": other.id, "role": "CO_JUDGE"},
        format="json",
    )
    assert response.status_code == CTJ_PARTICIPATE[role], _msg(
        role, "POST /dispatch/cross-tenant-judgments/{id}/participate/", response
    )
    joined = CTJ_PARTICIPATE[role] == 200
    assert (
        CrossTenantJudgmentParticipant.objects.filter(judgment=judgment, participant_tenant=other).exists()
        == joined
    )
    # participate() also transitions PROPOSED -> ACTIVE via activate().
    assert CrossTenantJudgment.objects.get(pk=judgment.pk).status == (
        JudgmentStatus.ACTIVE if joined else JudgmentStatus.PROPOSED
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_cross_tenant_judgment_conclude(role_clients, snapshot_tenants, role):
    """dispatch.manage. A VIEWER records the verdict of a cross-realm tribunal."""
    from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus

    clients, _ = role_clients
    home, _o = snapshot_tenants
    judgment = _cross_tenant_judgment(home, status=JudgmentStatus.ACTIVE)
    response = clients[role].post(
        f"/api/v1/dispatch/cross-tenant-judgments/{judgment.id}/conclude/",
        {"conclusion_type": "PASS"},
        format="json",
    )
    assert response.status_code == CTJ_CONCLUDE[role], _msg(
        role, "POST /dispatch/cross-tenant-judgments/{id}/conclude/", response
    )
    concluded = CTJ_CONCLUDE[role] == 200
    row = CrossTenantJudgment.objects.get(pk=judgment.pk)
    assert row.status == (JudgmentStatus.CONCLUDED if concluded else JudgmentStatus.ACTIVE)
    assert row.conclusion_type == ("PASS" if concluded else None)


# ---------------------------------------------------------------------------
# notifications
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_create_cannot_succeed_for_anyone(role_clients, snapshot_tenants, role):
    """POST /notifications/ is a routed, reachable, permanently broken write.

    Not a permission finding — a shape finding, recorded here because this is
    the file that enumerates the app's write surface. The serializer marks
    `user` read-only and the viewset has no perform_create, so the row is saved
    with user_id NULL and the database refuses it. DRF does not convert
    IntegrityError, so it escapes the view: a 500 in production, and an
    exception through the test client here.

    Wrapped in a savepoint so the failed statement does not poison the
    surrounding test transaction.
    """
    clients, _ = role_clients
    with pytest.raises(IntegrityError), transaction.atomic():
        clients[role].post("/api/v1/notifications/", {"title": "t", "message": "m"}, format="json")


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_partial_update(role_clients, snapshot_tenants, role):
    """notification.read, held by all five. Own-inbox only — get_queryset pins user=request.user."""
    from apps.notifications.models import UserNotification

    clients, users = role_clients
    notification = _notification(users[role])
    response = clients[role].patch(
        f"/api/v1/notifications/{notification.id}/", {"title": f"EDITED_BY_{role}"}, format="json"
    )
    assert response.status_code == NOTIFICATION_PATCH[role], _msg(
        role, "PATCH /notifications/{id}/", response
    )
    expected = f"EDITED_BY_{role}" if NOTIFICATION_PATCH[role] == 200 else "wsnap"
    assert UserNotification.objects.get(pk=notification.pk).title == expected


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_destroy(role_clients, snapshot_tenants, role):
    """notification.read, held by all five. Deleting from one's own inbox."""
    from apps.notifications.models import UserNotification

    clients, users = role_clients
    notification = _notification(users[role])
    response = clients[role].delete(f"/api/v1/notifications/{notification.id}/")
    assert response.status_code == NOTIFICATION_DELETE[role], _msg(
        role, "DELETE /notifications/{id}/", response
    )
    assert _is_deleted(UserNotification, notification.pk) == (NOTIFICATION_DELETE[role] == 204)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_mark_read(role_clients, snapshot_tenants, role):
    """notification.read, held by all five."""
    from apps.notifications.models import UserNotification

    clients, users = role_clients
    notification = _notification(users[role])
    response = clients[role].post(f"/api/v1/notifications/{notification.id}/mark_read/", {}, format="json")
    assert response.status_code == NOTIFICATION_MARK_READ[role], _msg(
        role, "POST /notifications/{id}/mark_read/", response
    )
    assert UserNotification.objects.get(pk=notification.pk).is_read == (NOTIFICATION_MARK_READ[role] == 200)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_mark_all_read(role_clients, snapshot_tenants, role):
    """notification.read, held by all five."""
    from apps.notifications.models import UserNotification

    clients, users = role_clients
    for _ in range(3):
        _notification(users[role])
    response = clients[role].post("/api/v1/notifications/mark_all_read/", {}, format="json")
    assert response.status_code == NOTIFICATION_MARK_ALL_READ[role], _msg(
        role, "POST /notifications/mark_all_read/", response
    )
    unread = UserNotification.objects.filter(user=users[role], is_read=False).count()
    assert unread == (0 if NOTIFICATION_MARK_ALL_READ[role] == 200 else 3)


# ---------------------------------------------------------------------------
# org — BLOCKER: declares no codename, so enforcement here is a no-op
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_organization_create(role_clients, snapshot_tenants, role):
    """No codename declared. Attaching CodenamePermission would change nothing.

    Organization has no `tenant` field either, so TenantQuerySetMixin's
    hasattr guard leaves the queryset unfiltered: every role sees, and writes,
    every civilization's org tree.
    """
    from apps.org.models import Organization

    clients, _ = role_clients
    code = f"WSNAP-C-{role}-{uuid.uuid4().hex[:6]}"
    response = clients[role].post(
        "/api/v1/organizations/", {"name": "wsnap", "code": code, "category": "CHINESE"}, format="json"
    )
    assert response.status_code == ORGANIZATION_CREATE[role], _msg(role, "POST /organizations/", response)
    assert Organization.objects.filter(code=code).exists() == (ORGANIZATION_CREATE[role] == 201)


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_organization_partial_update(role_clients, snapshot_tenants, role):
    """No codename declared."""
    from apps.org.models import Organization

    clients, _ = role_clients
    org = _organization(f"WSNAP-P-{role}-{uuid.uuid4().hex[:6]}")
    response = clients[role].patch(
        f"/api/v1/organizations/{org.id}/", {"name": f"RENAMED_BY_{role}"}, format="json"
    )
    assert response.status_code == ORGANIZATION_PATCH[role], _msg(
        role, "PATCH /organizations/{id}/", response
    )
    expected = f"RENAMED_BY_{role}" if ORGANIZATION_PATCH[role] == 200 else "wsnap"
    assert Organization.objects.get(pk=org.pk).name == expected


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_organization_destroy(role_clients, snapshot_tenants, role):
    """No codename declared. A VIEWER deletes a court from the org tree."""
    from apps.org.models import Organization

    clients, _ = role_clients
    org = _organization(f"WSNAP-D-{role}-{uuid.uuid4().hex[:6]}")
    response = clients[role].delete(f"/api/v1/organizations/{org.id}/")
    assert response.status_code == ORGANIZATION_DELETE[role], _msg(
        role, "DELETE /organizations/{id}/", response
    )
    assert _is_deleted(Organization, org.pk) == (ORGANIZATION_DELETE[role] == 204)


# ---------------------------------------------------------------------------
# death_sync — writable, but not by a role
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_death_sync_api_key_create(role_clients, snapshot_tenants, role):
    """IsAdminUser == Django is_staff, so ADMIN is refused too. No codename declared."""
    from apps.death_sync.models import ExternalApiKey

    clients, _ = role_clients
    response = clients[role].post(
        "/api/v1/death-sync/api-keys/", {"name": f"wsnap-{role}", "system_type": "HOSPITAL"}, format="json"
    )
    assert response.status_code == DEATH_SYNC_API_KEY_CREATE[role], _msg(
        role, "POST /death-sync/api-keys/", response
    )
    assert not ExternalApiKey.objects.filter(name=f"wsnap-{role}").exists()


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_death_sync_register(role_clients, snapshot_tenants, role):
    """APIKeyAuthentication only — a Bearer JWT is not a credential here, so 401 before permissions."""
    clients, _ = role_clients
    response = clients[role].post("/api/v1/death-sync/register/", {"name": f"wsnap-{role}"}, format="json")
    assert response.status_code == DEATH_SYNC_REGISTER[role], _msg(
        role, "POST /death-sync/register/", response
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_death_sync_webhook_create(role_clients, snapshot_tenants, role):
    """APIKeyAuthentication only. Same 401, same reason."""
    clients, _ = role_clients
    response = clients[role].post(
        "/api/v1/death-sync/webhooks/", {"url": "https://example.invalid/hook"}, format="json"
    )
    assert response.status_code == DEATH_SYNC_WEBHOOK_CREATE[role], _msg(
        role, "POST /death-sync/webhooks/", response
    )


def _msg(role, endpoint, response):
    """One assertion message shape, carrying the codename and its holders.

    The point of the message is that a failure tells the reader whether it is
    the expected consequence of enforcement or something else: it names the
    codename the route declares and who holds it, so the answer to "should
    this role have been refused?" is on screen.
    """
    _view_key, _action, codenames = DECLARED[endpoint]
    if codenames is None:
        declared = "NO CODENAME DECLARED (blocker — see module docstring)"
    else:
        declared = ", ".join(f"{c} held by {sorted(_holders(c)) or 'NOBODY'}" for c in codenames)
    return (
        f"{role} {endpoint} returned {response.status_code}, snapshot says "
        f"{EXPECTED[endpoint][role]}. Declared: {declared}. "
        f"If enforcement caused this, update the snapshot deliberately."
    )


def _holders(codename):
    """Roles holding `codename` per ROLE_PERMISSIONS — the dict, not the DB.

    The dict is the path CI exercises: check_permission() answers from the DB
    only when a Permission row exists, and a migrate-only database seeds
    neither reincarnation.* nor dispatch.* nor notification.*.
    """
    from apps.perm.models import ROLE_PERMISSIONS

    return {role for role, granted in ROLE_PERMISSIONS.items() if codename in granted}


# ---------------------------------------------------------------------------
# The instrument's own guards.
#
# Everything above is measurement. Everything below asserts that the
# measurement is still describing the thing it claims to describe — that the
# codenames written into DECLARED are the ones the views actually require,
# that the holders quoted in the comments are the ones ROLE_PERMISSIONS
# actually grants, and that nobody quietly deleted rows to make a later change
# pass.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("endpoint", sorted(DECLARED), ids=lambda v: str(v))
def test_recorded_codename_matches_what_the_view_declares(endpoint):
    """Ask each viewset what it would require, and compare with DECLARED.

    Without this, renaming a codename in a view would leave every comment in
    this file quietly wrong while the status codes stayed green — which is
    precisely the failure mode a snapshot exists to prevent.
    """
    view_key, action, expected_codenames = DECLARED[endpoint]
    view = _views()[view_key]()
    get_perms = getattr(view, "get_required_permissions", None)

    if expected_codenames is None:
        assert get_perms is None, (
            f"{endpoint} is recorded as declaring no codename, but "
            f"{view.__class__.__name__} now has get_required_permissions(). If that app "
            f"gained a codename family, this file's blocker list is out of date."
        )
        return

    assert callable(get_perms), (
        f"{endpoint} is recorded as declaring {expected_codenames}, but "
        f"{view.__class__.__name__} no longer has get_required_permissions()."
    )
    view.action = action
    assert get_perms() == expected_codenames, (
        f"{endpoint} (action={action}) now requires {get_perms()}, not {expected_codenames}. "
        f"Every holder comment in this file was written against the old list."
    )


@pytest.mark.django_db
def test_declared_codenames_have_at_least_one_holder():
    """A codename no role holds is a blocker: enforcing it denies everyone.

    None of the routes in this file is in that state today. This is the
    assertion that keeps the module docstring's claim honest — and that would
    fire the moment a grant is removed from ROLE_PERMISSIONS without anyone
    checking which endpoints go dark.
    """
    orphans = {}
    for endpoint, (_view, _action, codenames) in DECLARED.items():
        for codename in codenames or []:
            if not _holders(codename):
                orphans.setdefault(codename, []).append(endpoint)
    assert orphans == {}, (
        f"Codenames declared by these routes are held by no role in ROLE_PERMISSIONS: "
        f"{orphans}. Enforcing those apps would deny every role, ADMIN included."
    )


@pytest.mark.django_db
def test_recorded_holders_match_role_permissions():
    """Pin the grant table the comments above were written against.

    Each entry is quoted verbatim in the per-endpoint docstrings. If a grant
    moves, those docstrings become misleading, and this is what says so.
    """
    assert _holders("reincarnation.manage") == {"ADMIN", "MODERATOR", "JUDGE", "GUARDIAN"}
    assert _holders("reincarnation.complete") == {"ADMIN", "MODERATOR"}
    assert _holders("reincarnation.reborn") == {"ADMIN", "MODERATOR"}
    assert _holders("dispatch.manage") == {"ADMIN", "MODERATOR", "GUARDIAN"}
    assert _holders("dispatch.approve") == {"ADMIN", "MODERATOR"}
    assert _holders("dispatch.reject") == {"ADMIN", "MODERATOR"}
    assert _holders("dispatch.execute") == {"ADMIN", "MODERATOR"}


@pytest.mark.django_db
def test_notification_read_is_held_by_every_role():
    """apps/notifications/views.py says otherwise, in a comment. The comment is stale.

    That comment ("only ADMIN and MODERATOR hold notification.read, so under
    enforcement JUDGE, GUARDIAN and VIEWER lose their own inbox") reads as a
    reason to add grants before enforcing the app. No grant is needed: all five
    roles already hold it, which is why enforcing `notifications` moves none of
    the 25 notification cases above. Asserted so nobody acts on the comment.
    """
    assert _holders("notification.read") == set(ROLES)


@pytest.mark.django_db
def test_audit_app_publishes_no_write_routes():
    """`audit` is in scope and has nothing to cover. Prove it rather than assert it in prose.

    AuditLogViewSet is a ReadOnlyModelViewSet, so DefaultRouter publishes no
    create/update/partial_update/destroy route. If that ever changes, this file
    is incomplete and should say so out loud instead of silently not covering
    the new endpoint.
    """
    from apps.audit.urls import router

    write_actions = {"create", "update", "partial_update", "destroy"}
    published = set()
    for url in router.urls:
        published |= set(getattr(url.callback, "actions", {}).values())
    assert not (published & write_actions), (
        f"apps.audit now routes write actions {sorted(published & write_actions)}. "
        f"This file was written on the premise that it routes none, and no longer covers the app."
    )


def test_predicted_moves_when_enforcement_arrives():
    """The prediction, derived rather than asserted from memory.

    For every (endpoint, role) that currently succeeds, a role that does not
    hold the endpoint's declared codename will be refused the day
    CodenamePermission is attached to that view. That is 34 of the 135 cases.
    The breakdown is checked per app so a single number cannot drift quietly.

    Nothing moves in `notifications` (every role holds notification.read), in
    `org` or in `death_sync` (no codename declared, so attaching the class is a
    no-op there — which is the blocker, restated as arithmetic).
    """
    moves = []
    for endpoint, (_view, _action, codenames) in DECLARED.items():
        if codenames is None or endpoint not in EXPECTED:
            continue
        for role in ROLES:
            if EXPECTED[endpoint][role] not in (200, 201, 204):
                continue
            if any(role not in _holders(codename) for codename in codenames):
                moves.append((endpoint, role))

    by_app = {}
    for endpoint, _role in moves:
        app = endpoint.split()[1].split("/")[1]
        by_app[app] = by_app.get(app, 0) + 1

    assert by_app == {"reincarnation": 9, "dispatch": 25}, by_app
    assert len(moves) == 34, sorted(moves)


def test_snapshot_covers_every_write_endpoint_it_claims_to():
    """Guard the shape: deleting rows to make a fix pass should fail, not shrink the run.

    27 write endpoints × 5 roles = 135 cases. 26 of the 27 are status-code
    cases (EXPECTED); POST /notifications/ is the exception and is asserted as
    a raised IntegrityError instead, so it lives in DECLARED but not EXPECTED.
    """
    assert len(DECLARED) == 27
    assert len(EXPECTED) == 26
    assert set(EXPECTED) | {"POST /notifications/"} == set(DECLARED)
    assert len(DECLARED) * len(ROLES) == 135
    for endpoint, codes in EXPECTED.items():
        assert set(codes) == set(ROLES), endpoint
    # Six of the 27 declare no codename at all — three in `org`, three in
    # `death_sync`. That count is the blocker list's length; if it grows, an
    # app gained a write endpoint no codename can gate. If it shrinks, someone
    # answered one of the three open questions in the module docstring and this
    # file should say which.
    blockers = [e for e, (_v, _a, c) in DECLARED.items() if c is None]
    assert len(blockers) == 6, sorted(blockers)
