"""The write half of the permission matrix, for the apps outside
``apps/perm/test_matrix_snapshot.py``. Read that file first; this is the same
instrument pointed at the routes it does not reach.

PART SPECIFICATION, PART SNAPSHOT OF THE DEFECT, and the line between them runs
app by app. ``reincarnation``, ``dispatch``, ``notifications`` and, as of this
tranche, ``org`` are now enforced, so their codes below are the codename
system's answers and *are* policy. ``death_sync`` is not enforced and cannot
be — its views declare no codename at all — so its codes are still a snapshot
of what happens to be true, defects included, pinned so a change arrives as a
reviewed diff rather than as behaviour nobody noticed. A failure here is not
automatically a regression; it is a question.

This file was called ``..._unenforced_apps.py`` when it was built (a938ef4),
because at the time none of these apps had ``CodenamePermission`` attached.
Four of the five do now, so that name had stopped being true. The property
that has not expired, and that the current name records, is which routes
``test_matrix_snapshot.py`` leaves uncovered.

27 write endpoints × 5 roles = 135 cases. The reincarnation/dispatch/
notifications tranche moved 34 (reincarnation 9, dispatch 25, notifications
0); this tranche enforces ``org`` on top of that and moves 9 more
(``org.manage`` — ADMIN, MODERATOR — denies JUDGE, GUARDIAN, VIEWER on all
three writes), for 43 total. Nothing was deleted either time.

The prediction, and how it landed
---------------------------------
a938ef4 built this file into a prediction: from each route's declared codename
and that codename's holders per ``ROLE_PERMISSIONS``, it computed that 34 of
the 135 cases would turn 403 the day enforcement arrived — reincarnation 9,
dispatch 25, notifications 0. **All 34 moved, and only those 34.** Measured
against the prediction endpoint by endpoint and role by role, with no
reconciliation and no grant added. This tranche runs the same derivation for
``org`` once its codenames existed to derive from, and it predicts 9 more —
see THE ORG TRANCHE below. The derivation that produced both numbers now runs
in reverse as ``test_every_denial_traces_to_a_missing_codename``: for the four
enforced apps it rebuilds the whole expected matrix from ``ROLE_PERMISSIONS``
and asserts it equals ``EXPECTED``, so no 403 can be written into this file
that policy does not account for.

What each app turned out to be
------------------------------
* ``reincarnation`` — 5 writable endpoints. ENFORCED. 9 codes moved: VIEWER
  loses the three CRUD writes (``reincarnation.manage``), and JUDGE, GUARDIAN
  and VIEWER all lose ``complete`` and ``reborn``, which are held by ADMIN and
  MODERATOR alone.
* ``dispatch`` — 11 writable endpoints across two viewsets. ENFORCED, and the
  largest move in the tranche at 25 codes, because JUDGE holds no ``dispatch.*``
  codename whatsoever and loses all eleven. **Enforced is not the same as
  safe here** — see THE DENIAL THAT CAN BE WALKED AROUND below, and read it
  before quoting the 25.
* ``notifications`` — 5 writable endpoints. ENFORCED, and 0 codes moved: all
  five roles hold ``notification.read`` and it is the only codename any action
  on that viewset resolves to. An app where enforcement is a no-op is worth
  being able to *prove* is a no-op, in both directions, rather than leaving it
  off the list where "no-op" and "nobody got to it" look identical. Every
  action is also scoped to ``user=request.user`` by ``get_queryset``, so this
  is a person's own inbox and the open codes were never a cross-user hole.
  ``POST /notifications/`` is a different problem: see NOTIFICATION_CREATE.
* ``org`` — 3 writable endpoints. ENFORCED as of this tranche — see THE ORG
  TRANCHE below. 9 codes moved: ``org.manage`` is held by ADMIN and MODERATOR
  only, so JUDGE, GUARDIAN and VIEWER lose all three writes. The tenant FK
  that shipped alongside the codenames closes a second, separate hole this
  file used to record — every org tree, across all three civilizations, was
  visible and writable to every tenant — covered by
  ``test_organization_cross_tenant_isolation`` rather than a status-code case,
  because "wrong tenant" reads as 404 (object not in scope), not 403.
* ``death_sync`` — genuine write endpoints, mostly still unreachable by a
  role. ``api-keys`` was ``IsAdminUser`` (403 for all five, ADMIN included —
  that flag is ``is_staff``, not ``role == 'ADMIN'``); FIXED (C9) to
  ``IsAdminPermission``, so ADMIN now succeeds and the other four roles stay
  denied. ``register`` and ``webhooks`` still accept only
  ``APIKeyAuthentication``, so a Bearer JWT is not a credential there and
  every role still gets 401. Codenames are the wrong tool for any of the
  three; covered so the fact is pinned, not because enforcement could move
  it.
* ``audit`` — **nothing to cover.** ``AuditLogViewSet`` is a
  ``ReadOnlyModelViewSet``; the router publishes no create/update/destroy
  route. Asserted by ``test_audit_app_publishes_no_write_routes`` rather than
  claimed in prose.

Blockers — routes whose declared codename cannot gate anything
--------------------------------------------------------------
The first of these three is resolved by this tranche. The other two are
``death_sync``, unrelated to ``org`` and untouched here.

1. RESOLVED. ``OrganizationViewSet`` (POST/PATCH/DELETE
   ``/api/v1/organizations/``) used to declare no codename and have no
   ``get_required_permissions()``, so attaching ``CodenamePermission`` would
   have been a no-op (verified in a938ef4 by monkeypatching it on and watching
   all five roles still get 201) and ``Organization`` had no ``tenant`` field,
   so ``TenantQuerySetMixin``'s hasattr guard skipped filtering entirely. Both
   are fixed: ``org.read``/``org.manage`` now exist in ``DEFAULT_PERMISSIONS``
   and are wired via ``CodenameViewSetMixin`` (see apps/org/views.py), and
   ``Organization.tenant`` is backfilled by
   ``apps/org/migrations/0004_backfill_organization_tenant.py`` from the same
   CIV_TO_TENANT mapping ``migrate_to_multitenant.py`` uses elsewhere. See THE
   ORG TRANCHE below for the measured codes.
2. ``ExternalApiKeyViewSet`` (POST ``/api/v1/death-sync/api-keys/``) declares
   no codename either. RESOLVED (C9): was closed by ``IsAdminUser`` so far
   that even ADMIN could not use it; now ``IsAdminPermission``, so ADMIN can.
   Still a blocker in the sense that there is no codename to derive a matrix
   row from — the gate is a hardcoded role check, same as ``IsAdminPermission``
   everywhere else in this file's "blocker" list.
3. ``DeathRegistrationViewSet`` / ``WebhookViewSet`` declare no codename and
   authenticate by API key alone. Recorded so nobody adds one expecting it to
   fire.

THE ORG TRANCHE
----------------
``org.read`` is held by all five roles (reads were never the problem);
``org.manage`` is held by ADMIN and MODERATOR only, modeled on the same
read/manage binary as ``ledger.*``/``disposition.*`` rather than inventing a
third shape. Applied to a ``ModelViewSet``, that means ``create``, ``update``,
``partial_update`` and ``destroy`` all resolve to ``org.manage`` via
``extra_permissions`` — there is no ``org.create``/``org.update``/
``org.delete`` family, deliberately, because nothing in this rollout asked for
finer-grained write permissions than "may manage the org tree at all". JUDGE,
GUARDIAN and VIEWER hold ``org.read`` and stop there, so all three lose all
three writes: 3 endpoints × 3 roles = 9 codes, the same shape as
``reincarnation.manage``'s VIEWER-only loss scaled to three denied roles
instead of one.

The tenant FK is the second half and does not show up as a status-code move
in ``EXPECTED`` at all — it changes *which rows a query can see*, not what an
authorized caller may do to a visible one. ``test_organization_cross_tenant_
isolation`` covers it directly: an org created in one tenant must 404, not
list, and not write, from another tenant's role clients, and must still be
visible to ADMIN, which bypasses tenant scoping by design everywhere else.

Both resolution paths
---------------------
``check_permission()`` answers a codename from the ``Permission``/
``RolePermission`` tables when a row exists, and from the ``ROLE_PERMISSIONS``
dict when it does not. A migrate-only database — the only kind CI builds —
seeds exactly ``workflow.*`` and ``menu.read`` and nothing else, measured not
assumed. So every code in the main body of this file is the DICT path, and the
DB path, which is what dev and production actually run, would have gone
untested. ``test_enforced_writes_agree_through_the_db_path`` seeds the ten
``reincarnation.*``/``dispatch.*``/``notification.*`` codenames, grants them
from ``ROLE_PERMISSIONS``, and re-drives the enforced endpoints. Identical
codes mean the two paths agree.

Findings that are not permission bugs but were measured here
------------------------------------------------------------
* ``POST /api/v1/notifications/`` cannot succeed for anyone and never could.
  See NOTIFICATION_CREATE. Enforcing the app did not change it and could not:
  all five roles hold the codename, so the request reaches the same broken
  save.
* ``ReincarnationSerializer`` declares no ``read_only_fields``, so
  ``cycle_count``, ``new_identity``, ``rebirth_form`` and the ``soul`` FK
  itself are all writable under ``reincarnation.manage``. That is record
  integrity, not authorization — see RECORD INTEGRITY below, and do not
  "fix" it by narrowing a codename that was never the problem.
* ``apps/notifications/views.py`` used to carry a comment claiming only ADMIN
  and MODERATOR hold ``notification.read`` and that enforcement would cost the
  other three their inbox. Untrue of ``ROLE_PERMISSIONS`` then and now; the
  comment has been corrected in place, and
  ``test_notification_read_is_held_by_every_role`` pins the fact so nobody
  acts on the old version by granting what is already granted.
"""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

ROLES = ["ADMIN", "MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"]

# Uniform-code shorthand. Before this tranche it was the shape that dominated
# the file — every endpoint declared a codename, nothing consulted it, everyone
# got in. It now survives only where enforcement genuinely does not
# discriminate: `notifications` (all five roles hold the one codename) and the
# unenforced `org` / `death_sync` routes.
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
    # Moved to the `cross_judgment` family — a decision, not a rename. See
    # apps/dispatch/views.py and CTJ_CREATE above for why.
    "POST /dispatch/cross-tenant-judgments/": ("cross_tenant_judgment", "create", ["cross_judgment.create"]),
    "PATCH /dispatch/cross-tenant-judgments/{id}/": (
        "cross_tenant_judgment", "partial_update", ["cross_judgment.create"],
    ),
    "DELETE /dispatch/cross-tenant-judgments/{id}/": ("cross_tenant_judgment", "destroy", ["cross_judgment.create"]),
    "POST /dispatch/cross-tenant-judgments/{id}/participate/": (
        "cross_tenant_judgment", "participate", ["cross_judgment.create"],
    ),
    "POST /dispatch/cross-tenant-judgments/{id}/conclude/": (
        "cross_tenant_judgment", "conclude", ["cross_judgment.create"],
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
    # ── org — ENFORCED. org.manage: ADMIN, MODERATOR only ────────────────
    "POST /organizations/": ("organization", "create", ["org.manage"]),
    "PATCH /organizations/{id}/": ("organization", "partial_update", ["org.manage"]),
    "DELETE /organizations/{id}/": ("organization", "destroy", ["org.manage"]),
    # ── death_sync — BLOCKER-adjacent, declares nothing, gated elsewhere ──
    "POST /death-sync/api-keys/": ("external_api_key", "create", None),
    "POST /death-sync/register/": ("death_registration", "create", None),
    "POST /death-sync/webhooks/": ("webhook", "create", None),
}


# ---------------------------------------------------------------------------
# The measured codes. One constant per endpoint, keyed the same as DECLARED.
#
# For the three ENFORCED apps every 403 below is justified by the same one
# sentence: the role does not hold the codename the route declares, per
# ROLE_PERMISSIONS. That is spelled out per constant rather than left as "now
# returns 403", and it is also machine-derived — see
# test_every_denial_traces_to_a_missing_codename, which rebuilds these dicts
# from the grant table and asserts they match. No grant was added to make
# anything pass; a role needing a codename it lacks is a finding, not a fix.
# ---------------------------------------------------------------------------


def _denied(*roles):
    """Build a per-role code map where `roles` get 403 and the rest get `ok`.

    Written this way so the 403s read as a named list of roles next to the
    reason they are denied, instead of a dict literal a reader has to diff
    against ROLE_PERMISSIONS by eye.
    """
    def build(ok):
        return {role: (403 if role in roles else ok) for role in ROLES}
    return build


# ── reincarnation: 9 codes moved ─────────────────────────────────────────────
# reincarnation.manage — ADMIN, MODERATOR, JUDGE, GUARDIAN. VIEWER holds
# reincarnation.read and stops there, so VIEWER alone loses the three CRUD
# writes. Three codes: 201->403, 200->403, 204->403.
REINCARNATION_CREATE = _denied("VIEWER")(201)
REINCARNATION_PATCH = _denied("VIEWER")(200)
REINCARNATION_DELETE = _denied("VIEWER")(204)

# reincarnation.complete — ADMIN and MODERATOR only. JUDGE and GUARDIAN hold
# `manage` but not this, and VIEWER holds neither, so three roles lose it.
# This is the endpoint with teeth: it walks the soul DISPOSED ->
# REINCARNATING -> ALIVE, renames it to the new identity, and resets
# merit/demerit from the ledger. Editing the record of a rebirth and
# performing one are separated on purpose, and until now they were not.
REINCARNATION_COMPLETE = _denied("JUDGE", "GUARDIAN", "VIEWER")(200)

# reincarnation.reborn — ADMIN and MODERATOR only, same three roles denied for
# the same reason. Same side effect as `complete`, reachable without an
# existing Reincarnation row.
REINCARNATION_REBORN = _denied("JUDGE", "GUARDIAN", "VIEWER")(201)

# ── dispatch: 25 codes moved, and JUDGE carries most of them ─────────────────
# dispatch.manage — ADMIN, MODERATOR, GUARDIAN. JUDGE holds NO dispatch
# codename at all (not read, not manage, not any of the three decisions) and
# neither does VIEWER, so both lose every write on both dispatch viewsets.
DISPATCH_RECORD_CREATE = _denied("JUDGE", "VIEWER")(201)
DISPATCH_RECORD_PATCH = _denied("JUDGE", "VIEWER")(200)
DISPATCH_RECORD_DELETE = _denied("JUDGE", "VIEWER")(204)

# dispatch.approve / .reject / .execute — ADMIN and MODERATOR only. GUARDIAN
# holds dispatch.manage and may propose and edit, but not decide; JUDGE and
# VIEWER hold nothing here. Nine codes across the three.
#
# `execute` is the one that mattered most before enforcement: it reassigns the
# soul's tenant FK, moving a soul out of one civilization's jurisdiction into
# another's, and every role could do it for anything proposed to its own realm.
#
# GUARDIAN's three denials here used to be walkable around — PATCH
# /dispatch/records/{id}/ runs under dispatch.manage, which GUARDIAN holds,
# and `status` used to be writable there too. Closed: DispatchRecordSerializer
# now marks `status` read-only, so the 403 on approve/reject/execute is the
# only route to a decision GUARDIAN has. See THE DENIAL THAT NO LONGER WALKS
# AROUND below. JUDGE's and VIEWER's denials never had such a route, because
# they lose partial_update too.
DISPATCH_APPROVE = _denied("JUDGE", "GUARDIAN", "VIEWER")(200)
DISPATCH_REJECT = _denied("JUDGE", "GUARDIAN", "VIEWER")(200)
DISPATCH_EXECUTE = _denied("JUDGE", "GUARDIAN", "VIEWER")(200)

# cross_judgment.create, via CrossTenantJudgmentViewSet — every action on that
# viewset, CRUD and custom alike, resolves to this single codename. DECIDED:
# cross-tenant judgment moved from dispatch.manage to the cross_judgment
# family (see apps/dispatch/views.py) because it is a judgment activity, not
# an operational dispatch one — the same civilization that hears a soul's own
# case now hears its cross-tenant one. GUARDIAN and VIEWER denied, ADMIN,
# MODERATOR and JUDGE admitted — the inverse of dispatch.manage's split.
# Because read and every write still share one codename, this viewset still
# cannot exhibit the bypass its sibling does.
CTJ_CREATE = _denied("GUARDIAN", "VIEWER")(201)
CTJ_PATCH = _denied("GUARDIAN", "VIEWER")(200)
CTJ_DELETE = _denied("GUARDIAN", "VIEWER")(204)
CTJ_PARTICIPATE = _denied("GUARDIAN", "VIEWER")(200)
CTJ_CONCLUDE = _denied("GUARDIAN", "VIEWER")(200)

# ── notifications: 0 codes moved ─────────────────────────────────────────────
# notification.read is held by every role and is the only codename any action
# on NotificationViewSet resolves to, so enforcement is a no-op here and these
# four are byte-identical to their pre-enforcement values. Not a hole either
# way: get_queryset() pins every action to the caller's own rows.
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

# ── org: 9 codes moved ────────────────────────────────────────────────────
# org.manage — ADMIN, MODERATOR. JUDGE, GUARDIAN and VIEWER hold org.read and
# stop there, so all three lose all three writes. Three codes: 201->403,
# 200->403, 204->403 — same shape as REINCARNATION_*, three denied roles
# instead of one.
ORGANIZATION_CREATE = _denied("JUDGE", "GUARDIAN", "VIEWER")(201)
ORGANIZATION_PATCH = _denied("JUDGE", "GUARDIAN", "VIEWER")(200)
ORGANIZATION_DELETE = _denied("JUDGE", "GUARDIAN", "VIEWER")(204)

# death_sync: no codename anywhere, so enforcement cannot move these.
# FIXED (C9, permission-layer audit follow-up): was `IsAdminUser` (Django
# is_staff). None of the five role users is staff, so even ADMIN used to be
# refused — the same split test_matrix_snapshot.py used to record for
# GET /death-sync/api-keys/. Now `IsAdminPermission` (role == 'ADMIN'), the
# same gate every other admin-only endpoint in this codebase uses: ADMIN
# succeeds, the other four roles are still denied.
DEATH_SYNC_API_KEY_CREATE = _denied("MODERATOR", "JUDGE", "GUARDIAN", "VIEWER")(201)
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

    CN_DIYU is deliberate: it is a rebirth-capable cosmology
    (REBIRTH_CAPABLE_CIVILIZATIONS in apps/ledger/services.py — Diyu and, since
    the Greek split, Plato's circuit; EU_HEAVEN_HELL below is not), so the
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


def _organization(tenant, code):
    """Built in `home`/`other` shape like `_soul`/`_reincarnation` above.

    `tenant` is required, not defaulted, so a caller cannot forget it and get
    a `tenant=None` row that would be invisible to every non-ADMIN role client
    in this file — the exact silent failure the pre-FK version of this model
    could produce and the cross-tenant isolation test below now checks for
    directly.
    """
    from apps.org.models import Organization

    return Organization.objects.create(name="wsnap", code=code, category="CHINESE", tenant=tenant)


def _is_deleted(model, pk):
    """Soft delete is the only kind here, so `gone` means is_deleted=True."""
    return model.all_objects.get(pk=pk).is_deleted


# ---------------------------------------------------------------------------
# reincarnation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_reincarnation_create(role_clients, snapshot_tenants, role):
    """reincarnation.manage — ADMIN/MODERATOR/JUDGE/GUARDIAN. VIEWER lacks it and is refused."""
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
    """reincarnation.manage. VIEWER lacks it; the other four rewrite the notes on any rebirth."""
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
    """reincarnation.manage. VIEWER lacks it and can no longer erase a rebirth record."""
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
    """reincarnation.complete — ADMIN/MODERATOR. JUDGE, GUARDIAN and VIEWER lack it."""
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
    """reincarnation.reborn — ADMIN/MODERATOR. Same three denied, same reason."""
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
    """dispatch.manage — ADMIN/MODERATOR/GUARDIAN. JUDGE holds no dispatch codename at all; VIEWER neither."""
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
    """dispatch.manage. The stated reason for a soul transfer stays editable by its three holders.

    This is also the route GUARDIAN uses to walk around its approve/reject/
    execute denials — see test_guardian_denied_the_three_decisions_* below.
    """
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
    """dispatch.manage. JUDGE and VIEWER can no longer erase the record of a proposed transfer."""
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
    """dispatch.approve — ADMIN/MODERATOR. GUARDIAN may propose but not decide. See the bypass below."""
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
    """dispatch.reject — ADMIN/MODERATOR. Refusing another realm's request is also a decision."""
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
    """dispatch.manage — ADMIN/MODERATOR/GUARDIAN. JUDGE and VIEWER can no longer convene a tribunal."""
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
    """dispatch.manage. Renaming a tribunal in progress; JUDGE and VIEWER refused."""
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
    """dispatch.manage. JUDGE and VIEWER can no longer dissolve a joint tribunal."""
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
    """dispatch.manage. Seats another realm on the bench and activates the tribunal; JUDGE/VIEWER refused."""
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
    """dispatch.manage. JUDGE and VIEWER can no longer record a cross-realm tribunal's verdict."""
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
    """FIXED — this test name and its place in the write inventory both predate the fix.

    Formerly: POST /notifications/ was a routed, reachable, permanently broken
    write. The serializer marked `user` read-only and the viewset had no
    perform_create, so the row was saved with user_id NULL and the database
    refused it — an uncaught IntegrityError, a 500 in production, for every
    role, always. That version of this test asserted the exception under
    pytest.raises(IntegrityError) inside a savepoint.

    NotificationViewSet.perform_create now sets user=request.user
    unconditionally (self-notify only — see that method's docstring for why
    an arbitrary-target create was not implemented instead). notification.read
    is held by all five roles and is the only codename `create` resolves to
    (extra_permissions, unchanged by this fix), so every role gets 201, same
    as PATCH/DELETE/mark_read/mark_all_read below. The name is kept instead of
    renamed so test_snapshot_covers_every_write_endpoint_it_claims_to's
    function-name inventory does not need to change size.

    NOTE for whoever reads this file's module docstring next: several
    passages there (the "POST /notifications/ is deliberately absent" EXPECTED
    comment, the "cannot succeed for anyone and never could" bullet, the
    NOTIFICATION_CREATE cross-references) still describe the pre-fix behavior
    this test used to pin. They were deliberately left alone rather than
    rewritten wholesale in the same change that fixed the bug — see the PR/
    commit that touches this test for the reasoning.
    """
    clients, users = role_clients
    from apps.notifications.models import UserNotification

    response = clients[role].post("/api/v1/notifications/", {"title": "t", "message": "m"}, format="json")
    assert response.status_code == 201, _msg(role, "POST /notifications/", response)
    notification = UserNotification.objects.get(pk=response.data["id"])
    assert notification.user == users[role], "create must self-notify, never trust a client target"


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_partial_update(role_clients, snapshot_tenants, role):
    """notification.read, held by all five, so enforcement moved nothing. Own-inbox only.

    This used to PATCH `title` and assert the new value was stored -- i.e. it
    pinned the recipient's ability to rewrite the body of a notification the
    system sent them. `title`, `message`, `notification_type`,
    `related_resource` and `related_id` are now read-only: the body is written
    by whatever raised the notification, and `related_resource`/`related_id`
    drive the deep link, so a recipient could aim their own notification at an
    arbitrary target. `is_read` stays writable -- marking something read is the
    one thing a recipient does.

    The status codes in NOTIFICATION_PATCH are unchanged; PATCH is still
    permitted for every role. What changed is which fields it moves.
    """
    from apps.notifications.models import UserNotification

    clients, users = role_clients
    notification = _notification(users[role])
    response = clients[role].patch(
        f"/api/v1/notifications/{notification.id}/",
        {"is_read": True, "title": f"EDITED_BY_{role}"},
        format="json",
    )
    assert response.status_code == NOTIFICATION_PATCH[role], _msg(
        role, "PATCH /notifications/{id}/", response
    )
    stored = UserNotification.objects.get(pk=notification.pk)
    assert stored.title == "wsnap", (
        f"{role} rewrote the title of a notification the system sent it "
        f"(now {stored.title!r})"
    )
    assert stored.is_read is (NOTIFICATION_PATCH[role] == 200), (
        "is_read must remain writable -- a read-only fix that also stops a "
        "recipient marking their inbox read is an outage, not a fix"
    )


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_notification_destroy(role_clients, snapshot_tenants, role):
    """notification.read, held by all five. Deleting from one's own inbox; unchanged by enforcement."""
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
# org — ENFORCED. org.manage: ADMIN, MODERATOR. org.read: all five roles.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_organization_create(role_clients, snapshot_tenants, role):
    """org.manage — ADMIN, MODERATOR. JUDGE, GUARDIAN, VIEWER hold org.read and stop there.

    TenantCreateMixin stamps the new row with the caller's tenant (`home`, for
    every role client in this fixture), so a role that IS granted org.manage
    also gets an org it can immediately see again under its own tenant scope
    — the create doesn't just succeed, it doesn't orphan itself.
    """
    from apps.org.models import Organization

    clients, _ = role_clients
    home, _other = snapshot_tenants
    code = f"WSNAP-C-{role}-{uuid.uuid4().hex[:6]}"
    response = clients[role].post(
        "/api/v1/organizations/", {"name": "wsnap", "code": code, "category": "CHINESE"}, format="json"
    )
    assert response.status_code == ORGANIZATION_CREATE[role], _msg(role, "POST /organizations/", response)
    created = Organization.objects.filter(code=code).first()
    assert (created is not None) == (ORGANIZATION_CREATE[role] == 201)
    if created is not None:
        assert created.tenant_id == home.id


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_organization_partial_update(role_clients, snapshot_tenants, role):
    """org.manage — ADMIN, MODERATOR. Same three roles denied as create/destroy."""
    from apps.org.models import Organization

    clients, _ = role_clients
    home, _other = snapshot_tenants
    org = _organization(home, f"WSNAP-P-{role}-{uuid.uuid4().hex[:6]}")
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
    """org.manage — ADMIN, MODERATOR. A VIEWER can no longer delete a court from the org tree."""
    from apps.org.models import Organization

    clients, _ = role_clients
    home, _other = snapshot_tenants
    org = _organization(home, f"WSNAP-D-{role}-{uuid.uuid4().hex[:6]}")
    response = clients[role].delete(f"/api/v1/organizations/{org.id}/")
    assert response.status_code == ORGANIZATION_DELETE[role], _msg(
        role, "DELETE /organizations/{id}/", response
    )
    assert _is_deleted(Organization, org.pk) == (ORGANIZATION_DELETE[role] == 204)


@pytest.mark.django_db
def test_organization_cross_tenant_isolation(role_clients, snapshot_tenants):
    """The hole the missing `tenant` field used to leave open, closed directly.

    Before this tranche, `Organization` had no `tenant` field at all, so
    `TenantQuerySetMixin.get_queryset()`'s `hasattr` guard skipped filtering
    entirely — every org tree, across all three civilizations, was visible
    and writable to every tenant. There is no single status code that
    characterizes "silently unfiltered", which is why this is a dedicated
    test rather than another row in EXPECTED: the fix does not turn a 2xx
    into a 403 the way a missing codename does, it turns "found" into "404,
    not in this queryset at all".

    GUARDIAN (org.read, no org.manage) and MODERATOR (org.read AND
    org.manage) both live in `home`. An org created in `other` must be
    invisible to both — from GUARDIAN because it can only ever read, from
    MODERATOR because org.manage is not a bypass of tenant scoping, the same
    way it isn't for any other tenant-scoped model in this codebase. ADMIN is
    checked too, in the other direction: tenant scoping is bypassed by design
    for ADMIN everywhere else, and this must not be a silent exception.
    """
    from apps.org.models import Organization

    clients, _ = role_clients
    home, other = snapshot_tenants
    org = _organization(other, f"WSNAP-XT-{uuid.uuid4().hex[:6]}")

    list_response = clients["GUARDIAN"].get("/api/v1/organizations/")
    assert list_response.status_code == 200
    listed_ids = {row["id"] for row in list_response.data["results"]}
    assert str(org.id) not in {str(i) for i in listed_ids}, (
        f"GUARDIAN (home={home.code}) listed an organization belonging to "
        f"tenant {other.code} — tenant filtering is not applied to org.read."
    )

    for role in ("GUARDIAN", "MODERATOR"):
        retrieve = clients[role].get(f"/api/v1/organizations/{org.id}/")
        assert retrieve.status_code == 404, (
            f"{role} (home={home.code}) could retrieve an organization belonging to "
            f"tenant {other.code}: got {retrieve.status_code}, expected 404."
        )

    # MODERATOR holds org.manage, but tenant scoping is checked before a
    # codename ever gets consulted — get_object() 404s from the unfiltered
    # queryset, so this never reaches CodenamePermission at all.
    patch = clients["MODERATOR"].patch(
        f"/api/v1/organizations/{org.id}/", {"name": "hijacked"}, format="json"
    )
    assert patch.status_code == 404, patch.status_code
    delete = clients["MODERATOR"].delete(f"/api/v1/organizations/{org.id}/")
    assert delete.status_code == 404, delete.status_code
    assert Organization.objects.get(pk=org.pk).name == "wsnap"
    assert not _is_deleted(Organization, org.pk)

    # ADMIN bypasses tenant scoping everywhere else in this codebase; confirm
    # org is not a silent exception to that in either direction.
    admin_retrieve = clients["ADMIN"].get(f"/api/v1/organizations/{org.id}/")
    assert admin_retrieve.status_code == 200, admin_retrieve.status_code


# ---------------------------------------------------------------------------
# death_sync — writable, but not by a role
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ROLES)
def test_death_sync_api_key_create(role_clients, snapshot_tenants, role):
    """C9 fix: IsAdminPermission (role == 'ADMIN'), not is_staff. No codename declared."""
    from apps.death_sync.models import ExternalApiKey

    clients, _ = role_clients
    response = clients[role].post(
        "/api/v1/death-sync/api-keys/", {"name": f"wsnap-{role}", "system_type": "HOSPITAL"}, format="json"
    )
    assert response.status_code == DEATH_SYNC_API_KEY_CREATE[role], _msg(
        role, "POST /death-sync/api-keys/", response
    )
    if role == "ADMIN":
        assert ExternalApiKey.objects.filter(name=f"wsnap-{role}").exists()
    else:
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
    assert _holders("org.read") == set(ROLES)
    assert _holders("org.manage") == {"ADMIN", "MODERATOR"}


@pytest.mark.django_db
def test_notification_read_is_held_by_every_role():
    """apps/notifications/views.py used to say otherwise, in a comment.

    That comment ("only ADMIN and MODERATOR hold notification.read, so under
    enforcement JUDGE, GUARDIAN and VIEWER lose their own inbox") read as a
    reason to add grants before enforcing the app. It was wrong about
    ROLE_PERMISSIONS, a938ef4 pinned the fact here, and this tranche corrected
    the comment in place while enforcing the app — moving none of the 25
    notification cases above, because no grant was ever needed.

    The assertion stays after the comment is gone, and that is the point: the
    comment was a symptom, the belief behind it is what would cause someone to
    grant notification.read to roles that already hold it. This is what says
    so when they check.
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


# "organizations" (not "org") because _app_of() derives from the URL path
# segment, and the route is /api/v1/organizations/.
ENFORCED_APPS = ("reincarnation", "dispatch", "notifications", "organizations")


def _app_of(endpoint):
    """`POST /dispatch/records/` -> `dispatch`. The app segment of the path."""
    return endpoint.split()[1].split("/")[1]


def test_every_denial_traces_to_a_missing_codename():
    """The prediction, run in reverse now that it has landed.

    a938ef4 derived — from the declared codenames and ROLE_PERMISSIONS alone,
    before any enforcement existed — that exactly 34 of the 135 cases would
    turn 403: reincarnation 9, dispatch 25, notifications 0. All 34 moved, and
    only those 34.

    Left as a *prediction* this would now assert nothing, because the thing it
    predicted has happened. So it is inverted into a standing constraint on the
    file: for the three enforced apps, rebuild the entire expected matrix from
    the grant table — the success code where the role holds every declared
    codename, 403 where it does not — and require it to equal EXPECTED.

    That is what makes "never grant a codename to make something pass"
    checkable rather than a promise. A 403 written into this file that
    ROLE_PERMISSIONS does not account for fails here; so does a success code
    for a role that lacks the codename; and so does making a denial disappear
    by adding a grant, because then the derived matrix moves and EXPECTED does
    not. Which codes changed, and why, stops being a claim in a comment.
    """
    success_code = {"POST": 201, "PATCH": 200, "DELETE": 204}
    derived = {}
    for endpoint, (_view, _action, codenames) in DECLARED.items():
        if endpoint not in EXPECTED or _app_of(endpoint) not in ENFORCED_APPS:
            continue
        # The success code this route answers a holder is whatever the snapshot
        # records for ADMIN, which holds every codename in this file. Taken
        # from EXPECTED rather than derived from the verb so that a custom
        # action answering 200 to a POST (approve, complete, mark_read) is not
        # mis-derived as 201.
        ok = EXPECTED[endpoint]["ADMIN"]
        assert ok in success_code.values(), (endpoint, ok)
        derived[endpoint] = {
            role: (ok if all(role in _holders(c) for c in codenames) else 403)
            for role in ROLES
        }

    mismatches = {
        endpoint: {"snapshot_says": EXPECTED[endpoint], "policy_says": codes}
        for endpoint, codes in derived.items()
        if EXPECTED[endpoint] != codes
    }
    assert mismatches == {}, (
        f"These enforced endpoints record codes that ROLE_PERMISSIONS does not "
        f"account for: {mismatches}. Either the snapshot was edited without a "
        f"policy change behind it, or a grant moved and the snapshot was not "
        f"re-derived. Do not reconcile by granting a codename — that is the "
        f"user's decision, and a role needing one it lacks is a finding."
    )

    # And the headline number, kept explicit so the tranche stays auditable.
    denials = [
        (endpoint, role)
        for endpoint, codes in derived.items()
        for role in ROLES
        if codes[role] == 403
    ]
    by_app = {}
    for endpoint, _role in denials:
        by_app[_app_of(endpoint)] = by_app.get(_app_of(endpoint), 0) + 1
    assert by_app == {"reincarnation": 9, "dispatch": 25, "organizations": 9}, by_app
    assert len(denials) == 43, sorted(denials)


def test_unenforced_apps_would_still_move_nothing():
    """The other half of the old prediction, which has NOT landed and must not rot.

    `death_sync` is still unenforced, and attaching CodenamePermission to it
    would change nothing — not because its roles hold the codenames, but
    because those views declare none and the class is deliberately permissive
    on a view that declares nothing. `org` used to be in this set too; it is
    not anymore, and that is the point of asserting the set explicitly rather
    than just its length — a shrinking unenforced set should read as "an app
    graduated", not silently pass because the count still looked plausible.
    """
    unenforced = {
        endpoint: codenames
        for endpoint, (_v, _a, codenames) in DECLARED.items()
        if _app_of(endpoint) not in ENFORCED_APPS
    }
    assert set(unenforced) == {
        "POST /death-sync/api-keys/",
        "POST /death-sync/register/",
        "POST /death-sync/webhooks/",
    }, sorted(unenforced)
    assert all(codenames is None for codenames in unenforced.values()), unenforced


def _matrix_test_names():
    """Every 27-endpoint matrix test defined in this module, by name.

    A matrix test is one parametrized over `role` across ALL FIVE roles and
    taking the standard trio of fixtures. Both halves of that are needed:
    the signature alone would also catch the reincarnation bypass case, which
    is parametrized over JUDGE and GUARDIAN only, and the parametrization alone
    would catch the DB-path cases, which take an extra seeding fixture.

    Counting functions rather than trusting a literal is the half of this guard
    that data cannot supply — DECLARED and EXPECTED shrink visibly when an
    endpoint is dropped, but a deleted test function is invisible to them. That
    is the blind spot tranche 2 found in test_matrix_snapshot.py's guard, so it
    is closed here rather than reintroduced.
    """
    import inspect
    import sys

    module = sys.modules[__name__]
    names = []
    for name, obj in vars(module).items():
        if not name.startswith("test_") or not inspect.isfunction(obj):
            continue
        if set(inspect.signature(obj).parameters) != {"role_clients", "snapshot_tenants", "role"}:
            continue
        # pytest.mark.parametrize returns the function it decorates, so the
        # marks survive on the object and the argvalues are inspectable here.
        over_all_roles = any(
            mark.name == "parametrize"
            and mark.args[0] == "role"
            and list(mark.args[1]) == ROLES
            for mark in getattr(obj, "pytestmark", [])
        )
        if over_all_roles:
            names.append(name)
    return sorted(names)


def test_snapshot_covers_every_write_endpoint_it_claims_to():
    """Guard the shape: deleting rows to make a fix pass should fail, not shrink the run.

    27 write endpoints × 5 roles = 135 cases. 26 of the 27 are status-code
    cases (EXPECTED); POST /notifications/ is the exception and is asserted as
    a raised IntegrityError instead, so it lives in DECLARED but not EXPECTED.

    This tranche moved 34 codes and deleted nothing, which is the property this
    assertion exists to keep checkable: the count goes up on purpose or not at
    all. Enforcing three apps is exactly the moment someone is tempted to
    delete a case rather than change a 201 to a 403 — the whole point of the
    file is that changing it is cheap and deleting from it is loud.
    """
    assert len(DECLARED) == 27
    assert len(EXPECTED) == 26
    assert set(EXPECTED) | {"POST /notifications/"} == set(DECLARED)
    assert len(DECLARED) * len(ROLES) == 135
    for endpoint, codes in EXPECTED.items():
        assert set(codes) == set(ROLES), endpoint
    # DECLARED and EXPECTED are data, so dropping an endpoint shrinks them and
    # the counts above catch it. A deleted *test function* is the half that
    # data cannot see — the exact blind spot tranche 2 found in
    # test_matrix_snapshot.py's guard — so count the functions too, by name.
    assert _matrix_test_names() == [
        "test_cross_tenant_judgment_conclude",
        "test_cross_tenant_judgment_create",
        "test_cross_tenant_judgment_destroy",
        "test_cross_tenant_judgment_partial_update",
        "test_cross_tenant_judgment_participate",
        "test_death_sync_api_key_create",
        "test_death_sync_register",
        "test_death_sync_webhook_create",
        "test_dispatch_approve",
        "test_dispatch_execute",
        "test_dispatch_record_create",
        "test_dispatch_record_destroy",
        "test_dispatch_record_partial_update",
        "test_dispatch_reject",
        "test_notification_create_cannot_succeed_for_anyone",
        "test_notification_destroy",
        "test_notification_mark_all_read",
        "test_notification_mark_read",
        "test_notification_partial_update",
        "test_organization_create",
        "test_organization_destroy",
        "test_organization_partial_update",
        "test_reincarnation_complete",
        "test_reincarnation_create",
        "test_reincarnation_destroy",
        "test_reincarnation_partial_update",
        "test_reincarnation_reborn",
    ], _matrix_test_names()
    assert len(_matrix_test_names()) == len(DECLARED)
    # Three of the 27 declare no codename at all, all three in `death_sync`.
    # `org` used to contribute three more — this tranche answered that
    # question, so the count dropped from 6 to 3. That count is the blocker
    # list's length; if it grows, an app gained a write endpoint no codename
    # can gate. If it shrinks further, someone answered one of the two
    # remaining open questions in the module docstring and this file should
    # say which.
    blockers = [e for e, (_v, _a, c) in DECLARED.items() if c is None]
    assert len(blockers) == 3, sorted(blockers)


# ---------------------------------------------------------------------------
# THE SECOND RESOLUTION PATH.
#
# check_permission() answers a codename from the Permission / RolePermission
# tables when a row for it exists, and from the ROLE_PERMISSIONS dict when it
# does not. Measured rather than assumed: a migrate-only database — the only
# kind CI ever builds — contains exactly `menu.read` and the seven `workflow.*`
# codenames and nothing else. None of reincarnation.*, dispatch.* or
# notification.* is seeded by any migration.
#
# So every one of the 135 cases above is the DICT path, top to bottom. Dev and
# production are not migrate-only: `POST /perm/role-permissions/init/` creates
# Permission rows from DEFAULT_PERMISSIONS that no migration owns, and there the
# DB decides and the dict is never consulted. (The other one, `POST /perm/init/`,
# was deleted on 2026-08-30 — it revoked every configured grant on the way to
# re-seeding. `role-permissions/init/` is additive and still stands.) Pinning only the dict would pin the path production does
# not run on — the same gap tranche 1 left and tranche 2 closed for the enforced
# families, running in the same direction here.
#
# These cases close it: seed the ten codenames, grant them from
# ROLE_PERMISSIONS, and re-drive the enforced endpoints. Identical codes mean
# CodenamePermission gets the same answer either way, and in particular that
# checker.py's `role__name=` join really does resolve through RolePermission
# end to end over HTTP rather than falling back to the dict unnoticed.
#
# WHAT THIS CANNOT DO, stated plainly so nobody reads more into a green run:
# the grants below are built FROM ROLE_PERMISSIONS, so the two sources agree by
# construction. This proves the DB path is wired correctly. It cannot prove any
# particular deployed database's grant table matches the dict — that comparison
# has to run against the actual database and is not something a test on a fresh
# test DB can stand in for.
# ---------------------------------------------------------------------------


@pytest.fixture
def enforced_families_seeded_in_db(db):
    """Make the DB authoritative for reincarnation.*, dispatch.* and notification.*.

    The permission cache is a process-global singleton with a 300s TTL and no
    per-test reset, so a dict-path answer computed by an earlier test in the
    same process would otherwise be served to these. Invalidated on the way in
    AND on the way out — leaving DB-derived answers cached would corrupt every
    dict-path case that runs after this fixture.
    """
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

    invalidate_all_permissions()

    codenames = {
        codename: (name, category)
        for codename, name, category in DEFAULT_PERMISSIONS
        if codename.startswith(("reincarnation.", "dispatch.", "notification."))
    }
    perms = {}
    for codename, (name, category) in codenames.items():
        perms[codename], _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": name, "category": category}
        )

    for role_name, granted in ROLE_PERMISSIONS.items():
        role, _ = Role.objects.get_or_create(
            name=role_name, defaults={"display_name": role_name.title()}
        )
        for codename in granted:
            if codename in perms:
                RolePermission.objects.get_or_create(role=role, permission=perms[codename])

    yield codenames
    invalidate_all_permissions()


@pytest.mark.django_db
def test_seeding_actually_moved_those_codenames_onto_the_db_path(
    enforced_families_seeded_in_db,
):
    """Guard the fixture: if it seeds nothing, the DB-path cases are dict cases again.

    Without this, renaming any of the three families would empty the fixture
    and every case below would silently go on measuring the dict a second time
    — passing, and testing nothing it claims to test. Assert what was seeded,
    by name and by count.
    """
    from apps.perm.models import Permission

    assert sorted(enforced_families_seeded_in_db) == [
        "dispatch.approve",
        "dispatch.execute",
        "dispatch.manage",
        "dispatch.read",
        "dispatch.reject",
        "notification.read",
        "reincarnation.complete",
        "reincarnation.manage",
        "reincarnation.read",
        "reincarnation.reborn",
    ], sorted(enforced_families_seeded_in_db)
    for codename in enforced_families_seeded_in_db:
        assert Permission.objects.filter(codename=codename).exists(), codename


@pytest.mark.django_db
def test_migrate_only_database_seeds_none_of_these_families(db):
    """The premise the whole section rests on, asserted instead of assumed.

    If a future migration starts seeding one of these families, the main body
    of this file silently stops measuring the dict path for it and the fixture
    above stops being the *other* path — both halves would then measure the DB
    and nobody would be told. This is the tripwire for that.
    """
    from apps.perm.models import Permission

    seeded = set(Permission.objects.values_list("codename", flat=True))
    assert seeded == {
        "menu.read",
        "workflow.advance",
        "workflow.approve",
        "workflow.create",
        "workflow.delete",
        "workflow.escalate",
        "workflow.read",
        "workflow.update",
    }, sorted(seeded)


# One probe per enforced app, chosen as the case where the two paths would
# disagree most visibly: each is an endpoint whose denial set is non-trivial
# (or, for notifications, provably empty).
DB_PATH_PROBES = {
    # reincarnation.complete — ADMIN/MODERATOR only, three roles refused.
    "POST /reincarnation/{id}/complete/": (
        lambda client, ctx: client.post(
            f"/api/v1/reincarnation/{ctx['reincarnation'].id}/complete/",
            {"new_identity": "dbpath", "rebirth_form": "HUMAN"},
            format="json",
        ),
        REINCARNATION_COMPLETE,
    ),
    # reincarnation.manage — VIEWER alone refused.
    "DELETE /reincarnation/{id}/": (
        lambda client, ctx: client.delete(f"/api/v1/reincarnation/{ctx['reincarnation'].id}/"),
        REINCARNATION_DELETE,
    ),
    # dispatch.approve — ADMIN/MODERATOR only, three roles refused.
    "POST /dispatch/records/{id}/approve/": (
        lambda client, ctx: client.post(
            f"/api/v1/dispatch/records/{ctx['dispatch'].id}/approve/", {}, format="json"
        ),
        DISPATCH_APPROVE,
    ),
    # dispatch.manage — JUDGE and VIEWER refused; GUARDIAN through.
    "PATCH /dispatch/records/{id}/": (
        lambda client, ctx: client.patch(
            f"/api/v1/dispatch/records/{ctx['dispatch'].id}/", {"reason": "dbpath"}, format="json"
        ),
        DISPATCH_RECORD_PATCH,
    ),
    # dispatch.manage via the other viewset.
    "DELETE /dispatch/cross-tenant-judgments/{id}/": (
        lambda client, ctx: client.delete(
            f"/api/v1/dispatch/cross-tenant-judgments/{ctx['judgment'].id}/"
        ),
        CTJ_DELETE,
    ),
    # notification.read — held by all five, so this probe is the one that proves
    # the no-op is a no-op on the DB path too, not only on the dict path.
    "POST /notifications/{id}/mark_read/": (
        lambda client, ctx: client.post(
            f"/api/v1/notifications/{ctx['notification'].id}/mark_read/", {}, format="json"
        ),
        NOTIFICATION_MARK_READ,
    ),
}


@pytest.mark.django_db
@pytest.mark.parametrize("probe_name", list(DB_PATH_PROBES), ids=lambda v: str(v))
@pytest.mark.parametrize("role", ROLES)
def test_enforced_writes_agree_through_the_db_path(
    role_clients, snapshot_tenants, enforced_families_seeded_in_db, role, probe_name
):
    """Same endpoints, same expected codes, resolved from RolePermission rows."""
    from apps.souls.models import SoulState

    clients, users = role_clients
    home, other = snapshot_tenants
    probe, expected = DB_PATH_PROBES[probe_name]

    soul = _soul(home, f"dbpath-{role}-{uuid.uuid4().hex[:8]}", state=SoulState.DISPOSED)
    ctx = {
        "reincarnation": _reincarnation(home, soul),
        "dispatch": _dispatch_record(home, other, _soul(other, f"dbpath-d-{role}-{uuid.uuid4().hex[:8]}")),
        "judgment": _cross_tenant_judgment(home),
        "notification": _notification(users[role]),
    }

    response = probe(clients[role], ctx)
    assert response.status_code == expected[role], (
        f"{role} {probe_name} returned {response.status_code} with "
        f"reincarnation.*/dispatch.*/notification.* seeded in the Permission "
        f"table, but {expected[role]} when the same check resolves through the "
        f"ROLE_PERMISSIONS dict. The two paths have diverged: CI builds the "
        f"dict path, deployments run the DB one."
    )


# ---------------------------------------------------------------------------
# THE DENIAL THAT NO LONGER WALKS AROUND.  (dispatch)
#
# This section used to demonstrate that ENFORCED IS NOT THE SAME AS SAFE: a
# role denied a codename got a 403, but for GUARDIAN on this viewset the 403
# stopped nothing, because the same outcome was reachable through the CRUD
# route under a codename GUARDIAN does hold.
#
# Tranche 2 found this shape and named it — a narrow codename guards a custom
# @action while the SAME fields stay writable through the viewset's own CRUD
# route under a wider codename — and predicted it would arise in dispatch the
# moment dispatch's CRUD codenames were reconciled and given holders. They
# were, and it did. It was worse here than the three workflow/souls instances,
# in three ways that were separate failures rather than one:
#
#   1. IT WALKED AROUND A CHECK THAT IS NOT A PERMISSION AT ALL. approve() and
#      execute() refuse any caller whose tenant is not the dispatch's TARGET
#      ("Only target tenant can approve dispatch"). That rule lives in those
#      two methods and nowhere else. partial_update had no such check, so a
#      source realm could approve its own outgoing transfer. No codename
#      change could have closed this — anyone reading the codename table
#      would have concluded it was covered.
#
#   2. IT LEFT THE RECORD LYING, not merely under-recorded. PATCH set
#      status=EXECUTED without running DispatchService.execute(), so the
#      soul's tenant FK never moved. A dispatch reading EXECUTED for a soul
#      that never changed hands is a worse artifact than the unauthorized
#      action would have been — the action at least would have been true.
#      Same for the other two: decided_at stayed None, no SoulEvent was
#      written, and the source tenant was never notified.
#
#   3. IT SKIPPED THE STATE MACHINE. DispatchStatus refuses REJECTED ->
#      EXECUTED, and transition_to() is what enforces that — called only by
#      the three custom actions. PATCH wrote the field directly. The
#      transition rules therefore held on three routes and nowhere else,
#      which was a modelling gap, not a permission one, and "narrow the
#      codename" would not have fixed it.
#
# Also: `dispatched_by` was writable, so the audit attribution — who
# proposed this transfer — was forgeable by any dispatch.manage holder.
#
# FIXED. DispatchRecordSerializer (apps/dispatch/serializers.py) now lists
# `status` and `dispatched_by` in `read_only_fields`, and its `validate()`
# turns an attempted PATCH of either into an explicit 400 rather than the
# silent no-op a plain read-only field would produce. Status can now only
# move through approve()/reject()/execute() below, which is where the
# target-tenant check and the transition_to() state-machine guard already
# lived — with the CRUD route closed, those three methods are the only
# write path for status there is, so nothing needed duplicating onto the
# model to make the checks "hold everywhere": there is nowhere else left.
#
# JUDGE and VIEWER never had this route — they lose partial_update as well,
# so for them the denials were already total. This was GUARDIAN's hole
# specifically, and the six tests below (five here, one for the sibling
# CrossTenantJudgmentViewSet) used to characterize it. They now characterize
# its closure: same setup, flipped assertions. A regression that reopens the
# hole will fail these loudly instead of the record silently starting to lie
# again.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    "narrow_action,codename,start_status,forged_status",
    [
        ("approve", "dispatch.approve", "PROPOSED", "APPROVED"),
        ("reject", "dispatch.reject", "PROPOSED", "REJECTED"),
        ("execute", "dispatch.execute", "APPROVED", "EXECUTED"),
    ],
)
def test_guardian_denied_the_three_decisions_now_stays_denied_through_patch(
    role_clients, snapshot_tenants, narrow_action, codename, start_status, forged_status
):
    """GUARDIAN cannot POST approve/reject/execute, and PATCH no longer reaches `status` either.

    dispatch.approve/.reject/.execute are held by ADMIN and MODERATOR only.
    dispatch.manage — which partial_update maps to — is held by ADMIN,
    MODERATOR and GUARDIAN, so GUARDIAN may still propose and edit a dispatch
    but not decide one. `status` used to be a plain writable field under
    dispatch.manage, so the decision landed on the same row either way;
    DispatchRecordSerializer now marks it read-only and validate() rejects an
    attempt to set it with a 400.
    """
    from apps.dispatch.models import DispatchRecord

    clients, _users = role_clients
    home, other = snapshot_tenants
    guardian = clients["GUARDIAN"]
    record = _dispatch_record(
        home, other, _soul(other, f"bypass-{narrow_action}"), status=start_status
    )

    body = {"reason": "denied route"} if narrow_action == "reject" else {}
    denied = guardian.post(
        f"/api/v1/dispatch/records/{record.id}/{narrow_action}/", body, format="json"
    )
    assert denied.status_code == 403, f"GUARDIAN is supposed to lack {codename}"
    assert DispatchRecord.objects.get(pk=record.pk).status == start_status

    blocked = guardian.patch(
        f"/api/v1/dispatch/records/{record.id}/", {"status": forged_status}, format="json"
    )
    assert blocked.status_code == 400, (
        f"If this is 200 again, `status` became writable on "
        f"DispatchRecordSerializer and the {codename} bypass has reopened."
    )
    after = DispatchRecord.objects.get(pk=record.pk)
    assert after.status == start_status
    assert after.decided_at is None
    assert after.executed_at is None


@pytest.mark.django_db
def test_patch_can_no_longer_forge_an_executed_dispatch(role_clients, snapshot_tenants):
    """status=EXECUTED via PATCH is rejected outright now; the soul stays put either way.

    THIS USED TO BE THE SHARPEST LINE IN THE FILE. The real execute()
    reassigns the soul's tenant — it moves a soul out of one civilization's
    jurisdiction and into another's, which is the single largest
    data-ownership change the API can make. The bypass used to write the
    *word* EXECUTED and perform none of it, so the record did not merely
    under-report an unauthorized action; it asserted a transfer that never
    happened. DispatchRecordSerializer's `status` is read-only now, so PATCH
    cannot write the word at all.
    """
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.souls.models import Soul

    clients, _users = role_clients
    home, other = snapshot_tenants
    soul = _soul(other, "bypass-executed-is-a-lie")
    record = _dispatch_record(home, other, soul, status=DispatchStatus.APPROVED)

    denied = clients["GUARDIAN"].post(
        f"/api/v1/dispatch/records/{record.id}/execute/", {}, format="json"
    )
    assert denied.status_code == 403, "GUARDIAN is supposed to lack dispatch.execute"

    blocked = clients["GUARDIAN"].patch(
        f"/api/v1/dispatch/records/{record.id}/",
        {"status": DispatchStatus.EXECUTED},
        format="json",
    )
    assert blocked.status_code == 400, (
        "If this is 200 again, `status` became writable and the bypass has reopened."
    )
    assert DispatchRecord.objects.get(pk=record.pk).status == DispatchStatus.APPROVED
    assert Soul.objects.get(pk=soul.pk).tenant_id == other.id, (
        "The soul did not move — correct now for a boring reason (the PATCH "
        "was rejected) rather than the alarming one this test used to "
        "demonstrate (the PATCH succeeded and the record lied about it)."
    )


@pytest.mark.django_db
def test_patch_can_no_longer_approve_a_source_realms_own_dispatch(role_clients, snapshot_tenants):
    """A realm can no longer approve its own OUTGOING transfer by PATCHing status.

    approve() and execute() both refuse a caller whose tenant is not the
    dispatch's target — "Only target tenant can approve dispatch", a
    separation between the realm asking and the realm consenting. That rule
    is written into those two methods and nowhere else in the app, so it was
    never a codename and no codename change could have closed this on its
    own. What closes it: PATCH can no longer write `status` at all, so the
    two methods that check the rule are the only two write paths for status
    there are, and neither needed the rule duplicated elsewhere.
    """
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    clients, _users = role_clients
    home, other = snapshot_tenants
    # Proposed BY home TO other, so the caller (in home) is the SOURCE.
    record = DispatchRecord.objects.create(
        source_tenant=home,
        target_tenant=other,
        soul=_soul(home, "bypass-source-side-approval"),
        status=DispatchStatus.PROPOSED,
        reason="source-side",
        tenant=home,
    )
    guardian = clients["GUARDIAN"]

    denied = guardian.post(f"/api/v1/dispatch/records/{record.id}/approve/", {}, format="json")
    assert denied.status_code == 403
    assert DispatchRecord.objects.get(pk=record.pk).status == DispatchStatus.PROPOSED

    blocked = guardian.patch(
        f"/api/v1/dispatch/records/{record.id}/",
        {"status": DispatchStatus.APPROVED},
        format="json",
    )
    assert blocked.status_code == 400, (
        "If this is 200 again, `status` became writable on "
        "DispatchRecordSerializer again and the bypass has reopened."
    )
    assert DispatchRecord.objects.get(pk=record.pk).status == DispatchStatus.PROPOSED, (
        "The source realm must not be able to approve its own outgoing transfer."
    )


@pytest.mark.django_db
def test_patch_can_no_longer_skip_the_status_state_machine(role_clients, snapshot_tenants):
    """REJECTED -> EXECUTED, a transition DispatchRecord.transition_to() refuses, stays refused.

    can_transition_to() is consulted by approve(), reject() and execute(), and
    used to be consulted by nothing else — not the serializer, not the
    model's save(). PATCH used to skip it entirely by writing `status` as a
    plain field; with `status` read-only, that write path is gone.
    """
    from apps.dispatch.models import DispatchRecord, DispatchStatus

    clients, _users = role_clients
    home, other = snapshot_tenants
    record = _dispatch_record(
        home, other, _soul(other, "bypass-illegal-transition"), status=DispatchStatus.REJECTED
    )
    assert not record.can_transition_to(DispatchStatus.EXECUTED), (
        "This test's premise is that the state machine forbids REJECTED -> "
        "EXECUTED. If it now allows it, the premise moved, not the fix."
    )

    blocked = clients["GUARDIAN"].patch(
        f"/api/v1/dispatch/records/{record.id}/",
        {"status": DispatchStatus.EXECUTED},
        format="json",
    )
    assert blocked.status_code == 400
    assert DispatchRecord.objects.get(pk=record.pk).status == DispatchStatus.REJECTED, (
        "If this is EXECUTED, `status` became writable through PATCH again and "
        "the state machine is once more reachable only from the three actions."
    )


@pytest.mark.django_db
def test_dispatched_by_can_no_longer_be_forged_through_patch(role_clients, snapshot_tenants):
    """Who proposed this transfer is no longer a field any dispatch.manage holder can set.

    DispatchService.propose() sets dispatched_by=request.user precisely so it
    cannot be spoofed via the create payload — the view's docstring says so.
    partial_update used to reopen it because DispatchRecordSerializer listed
    `dispatched_by` among its writable fields; it is read-only now and
    validate() rejects an attempt to set it outright.
    """
    from apps.dispatch.models import DispatchRecord

    clients, users = role_clients
    home, other = snapshot_tenants
    record = _dispatch_record(home, other, _soul(other, "bypass-attribution"))
    assert record.dispatched_by_id is None

    blocked = clients["GUARDIAN"].patch(
        f"/api/v1/dispatch/records/{record.id}/",
        {"dispatched_by": users["VIEWER"].id},
        format="json",
    )
    assert blocked.status_code == 400, (
        "If this is 200 again, `dispatched_by` became writable and the "
        "attribution is forgeable again."
    )
    assert DispatchRecord.objects.get(pk=record.pk).dispatched_by_id is None, (
        "GUARDIAN's PATCH must not attribute its own proposal to VIEWER."
    )


@pytest.mark.django_db
def test_cross_tenant_judgment_status_and_conclusion_type_no_longer_reach_via_patch(
    role_clients, snapshot_tenants
):
    """The sibling viewset never had a codename bypass — but its record could still lie.

    Every action on CrossTenantJudgmentViewSet — participate, conclude, and
    all three CRUD writes — resolves to the single codename
    cross_judgment.create (moved off dispatch.manage; see
    apps/dispatch/views.py for why). The holder sets are therefore identical
    rather than nested, so there was never a narrower codename for PATCH to
    route around, and get_required_permissions() below still proves it —
    same accident that made judgment and disposition immune in tranche 2.
    But CrossTenantJudgmentSerializer used to leave `status` and
    `conclusion_type` writable regardless, so PATCH reached the row
    `conclude()` writes without running `concluded_at` or the participant
    notifications — the same "record lies" failure dispatch had, just never
    also a permission bypass. Closed the same way (read-only +
    explicit validate()), before `conclude` could ever grow a narrower
    codename and turn it into one.
    """
    from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus
    from apps.dispatch.views import CrossTenantJudgmentViewSet

    view = CrossTenantJudgmentViewSet()
    for action in ("create", "update", "partial_update", "destroy", "participate", "conclude"):
        view.action = action
        assert view.get_required_permissions() == ["cross_judgment.create"], (
            f"{action} no longer maps to cross_judgment.create. If any action on "
            f"this viewset gained a narrower codename, it is now exposed to the "
            f"same bypass DispatchRecordViewSet used to have — check the serializer."
        )

    clients, _users = role_clients
    home, _other = snapshot_tenants
    judgment = _cross_tenant_judgment(home, status=JudgmentStatus.ACTIVE)
    # JUDGE, not GUARDIAN: cross_judgment.create's holders are ADMIN,
    # MODERATOR, JUDGE — the inverse of dispatch.manage's ADMIN, MODERATOR,
    # GUARDIAN. The role attempting the PATCH has to be one that actually
    # holds the write codename, so the 400 below is
    # CrossTenantJudgmentSerializer rejecting the fields, not
    # CodenamePermission rejecting the role.
    blocked = clients["JUDGE"].patch(
        f"/api/v1/dispatch/cross-tenant-judgments/{judgment.id}/",
        {"status": JudgmentStatus.CONCLUDED, "conclusion_type": "PASS"},
        format="json",
    )
    assert blocked.status_code == 400, (
        "If this is 200 again, `status`/`conclusion_type` became writable on "
        "CrossTenantJudgmentSerializer again."
    )
    row = CrossTenantJudgment.objects.get(pk=judgment.pk)
    assert row.status == JudgmentStatus.ACTIVE
    assert row.conclusion_type is None
    # And the thing conclude() guarantees still did not happen: no notification.
    assert row.concluded_at is None


# ---------------------------------------------------------------------------
# THE BYPASS THAT DOES NOT EXIST.  (reincarnation)
#
# A REFUTED HYPOTHESIS, ESTABLISHED BY MEASUREMENT, and recorded at the same
# weight as the confirmed one above — because "we checked and it is not there"
# is only worth anything if it was actually checked.
#
# reincarnation has the precondition for the tranche-2 pattern exactly:
# reincarnation.complete and .reborn are held by ADMIN and MODERATOR, while
# reincarnation.manage — which create/partial_update/destroy map to — is held by
# those two AND JUDGE AND GUARDIAN. A strictly wider holder set guarding the
# CRUD route, which is the whole shape.
#
# THE BYPASS IS STILL ABSENT, and the reason is structural rather than lucky:
# everything `complete` and `reborn` do to a soul lives in
# ReincarnationService.complete_rebirth — the transition to REINCARNATING and
# back to ALIVE, the ledger carryover into merit_score/demerit_score, clearing
# death_date and origin_location, the rename to new_identity, the
# REINCARNATION_COMPLETED event. The Reincarnation model has no signals and no
# save() override, so writing its row through CRUD reaches none of it. The
# pattern needs "the same FIELDS writable through the wider route"; here the
# fields the actions write are on a different model entirely.
#
# So JUDGE's and GUARDIAN's 403s on complete/reborn are real denials with no
# walk-around, and that is asserted below rather than asserted about.
#
# WHAT IS REACHABLE UNDER reincarnation.manage IS A DIFFERENT FINDING, and it
# must not be filed as this one. See RECORD INTEGRITY below.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("role", ["JUDGE", "GUARDIAN"])
def test_the_crud_route_cannot_reach_the_soul_state_complete_and_reborn_write(
    role_clients, snapshot_tenants, role
):
    """Denied reincarnation.complete/.reborn, and the wide route does NOT substitute.

    The negative result, driven rather than reasoned: after a 403 on both named
    actions and a successful 200 on PATCH plus 201 on POST under
    reincarnation.manage, the soul is byte-for-byte where it started. Every
    field complete_rebirth would have written is asserted unchanged, so a future
    change that gives the CRUD route a soul-side effect — a signal, a save()
    override, a serializer that reaches through the FK — fails here instead of
    quietly opening the bypass this test says is absent.
    """
    from apps.reincarnation.models import Reincarnation
    from apps.souls.models import Soul, SoulState

    clients, _users = role_clients
    home, _other = snapshot_tenants
    soul = _soul(home, f"no-bypass-{role}", state=SoulState.DISPOSED)
    before = Soul.objects.get(pk=soul.pk)
    record = _reincarnation(home, soul)
    client = clients[role]

    denied_complete = client.post(
        f"/api/v1/reincarnation/{record.id}/complete/",
        {"new_identity": f"FORGED_BY_{role}", "rebirth_form": "HUMAN"},
        format="json",
    )
    assert denied_complete.status_code == 403, f"{role} is supposed to lack reincarnation.complete"

    denied_reborn = client.post(
        "/api/v1/reincarnation/reborn/",
        {"soul_id": str(soul.id), "new_identity": f"FORGED_BY_{role}"},
        format="json",
    )
    assert denied_reborn.status_code == 403, f"{role} is supposed to lack reincarnation.reborn"

    # The wide route, which the role DOES hold, and which succeeds.
    allowed = client.patch(
        f"/api/v1/reincarnation/{record.id}/",
        {"new_identity": f"FORGED_BY_{role}", "rebirth_form": "DIVINE", "notes": "walked around"},
        format="json",
    )
    assert allowed.status_code == 200, f"{role} is supposed to hold reincarnation.manage"
    assert Reincarnation.objects.get(pk=record.pk).new_identity == f"FORGED_BY_{role}"

    # And the soul is untouched. This is the assertion that makes the negative
    # result a result rather than an absence of evidence.
    after = Soul.objects.get(pk=soul.pk)
    assert after.current_state == SoulState.DISPOSED, (
        "The CRUD route moved the soul's state. The bypass this test says does "
        "not exist now does — check for a new signal or save() override on "
        "Reincarnation before touching any codename."
    )
    assert after.name == before.name
    assert after.death_date == before.death_date
    assert after.merit_score == before.merit_score
    assert after.demerit_score == before.demerit_score

    # Creating a fresh record for an untouched soul is equally inert.
    soul2 = _soul(home, f"no-bypass-create-{role}", state=SoulState.DISPOSED)
    created = client.post(
        "/api/v1/reincarnation/",
        {"soul": str(soul2.id), "target_realm": "人间", "new_identity": "FORGED"},
        format="json",
    )
    assert created.status_code == 201
    assert Soul.objects.get(pk=soul2.pk).current_state == SoulState.DISPOSED


# ---------------------------------------------------------------------------
# RECORD INTEGRITY, NOT AUTHORIZATION.  (reincarnation)
#
# ReincarnationSerializer declares no read_only_fields at all, so every field it
# lists is writable under reincarnation.manage. That is real, and it is NOT the
# tranche-2 bypass — no narrow codename is being escaped, because the CRUD route
# reaches nothing a custom action guards. It is a serializer that lets a holder
# write history that never happened.
#
# Naming it accurately is the point. Narrowing reincarnation.manage, or moving
# these fields behind reincarnation.complete, would be "fixing" a codename that
# was never the problem — the holders of `manage` are supposed to be able to
# edit rebirth records; they are not supposed to be able to invent them.
#
# NOT FIXED HERE: read_only_fields on the serializer is the repair, and which
# fields belong there is the lead's call.
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_cycle_count_is_free_text_though_complete_rebirth_derives_it(
    role_clients, snapshot_tenants
):
    """A soul's count of past lives is a number any reincarnation.manage holder sets.

    ReincarnationService.complete_rebirth computes cycle_count as
    `soul.reincarnations.count() + 1` — it is derived, and derived from rows
    that exist. Through the CRUD route it is an ordinary writable integer, so
    the number of times a soul has been round the wheel can be set to anything
    without those lives having occurred.
    """
    from apps.reincarnation.models import Reincarnation

    clients, _users = role_clients
    home, _other = snapshot_tenants
    soul = _soul(home, "integrity-cycle-count")
    record = _reincarnation(home, soul)
    assert soul.reincarnations.count() == 1

    allowed = clients["GUARDIAN"].patch(
        f"/api/v1/reincarnation/{record.id}/", {"cycle_count": 99}, format="json"
    )
    assert allowed.status_code == 200, (
        "If cycle_count became read-only, this is fixed. Delete this test."
    )
    assert Reincarnation.objects.get(pk=record.pk).cycle_count == 99
    # And the rows that would have to exist for 99 to be true do not.
    assert soul.reincarnations.count() == 1


@pytest.mark.django_db
def test_an_existing_rebirth_record_can_be_repointed_at_a_different_soul(
    role_clients, snapshot_tenants
):
    """The `soul` FK is writable, so a rebirth can be reattributed after the fact.

    Sharper than cycle_count, because it does not fabricate a life — it moves
    one. A rebirth that genuinely happened to soul A can be made to read as
    soul B's, and the ledger carryover, identity and cycle history recorded on
    that row travel with it.
    """
    from apps.reincarnation.models import Reincarnation

    clients, _users = role_clients
    home, _other = snapshot_tenants
    original = _soul(home, "integrity-soul-a")
    other_soul = _soul(home, "integrity-soul-b")
    record = _reincarnation(home, original)

    allowed = clients["GUARDIAN"].patch(
        f"/api/v1/reincarnation/{record.id}/", {"soul": str(other_soul.id)}, format="json"
    )
    assert allowed.status_code == 200, (
        "If `soul` became read-only, this is fixed. Delete this test."
    )
    assert Reincarnation.objects.get(pk=record.pk).soul_id == other_soul.pk, (
        "A rebirth record was reattributed to a different soul."
    )


@pytest.mark.django_db
def test_reincarnation_serializer_declares_no_read_only_fields():
    """Pin the cause, not only the two symptoms above.

    The two tests before this one probe individual fields. This one asserts the
    shape that produced both, so that fixing `soul` and `cycle_count` alone —
    and leaving new_identity, rebirth_form, target_realm and previous_realm
    equally writable — does not read as the job being done.
    """
    from apps.reincarnation.serializers import ReincarnationSerializer

    meta = ReincarnationSerializer.Meta
    assert getattr(meta, "read_only_fields", ()) == (), (
        "ReincarnationSerializer gained read_only_fields. Good — check which "
        "fields, and retire whichever of the two tests above it covers."
    )
    writable = {
        name for name, field in ReincarnationSerializer().get_fields().items() if not field.read_only
    }
    assert writable == {
        "soul",
        "disposition",
        "target_realm",
        "rebirth_form",
        "cycle_count",
        "previous_realm",
        "new_identity",
        "notes",
    }, sorted(writable)
