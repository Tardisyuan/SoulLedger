"""The permission matrix's write path, its "what breaks" probe, and the role
reference counts the role table shows.

WHY PER-CHANGE, NOT ALL-OR-NOTHING
----------------------------------
`assign_role_permissions` replaces one role's whole grant set, so the matrix
used to save by looping it once per role from the browser. A failure half-way
left the server changed and the screen saying "failed" (see
`frontend/src/components/permissions/useMatrixSave.ts::savedBeforeFailure`).
`apply_changes` below is the server-side answer: one request, one result per
cell.

The alternative, all-or-nothing plus a dry-run validate endpoint, was rejected
for two reasons, both about this codebase:

* **Validation cannot be done ahead of time.** The only refusals that exist
  (below) are about state: the role and permission rows existing, and the
  role's optimistic-lock `version`. A dry run answers them for the moment it
  ran, and the save can still disagree a second later. The one case where
  that matters most — `version_conflict` — can only be decided under the row
  lock, inside the write.
* **The cache follows commits, not requests.** `check_permission` caches
  (role, codename) for 300s, and the invalidation must happen after the grant
  is visible to other connections. Each role here is its own transaction, and
  its cache is invalidated in `transaction.on_commit` for exactly the roles
  whose transaction committed. A cell whose savepoint rolled back has no row
  change, so whatever the cache holds for it (fresh, or re-read from the
  database) is still the truth. That is what makes "已存 2 项，失败 1 项"
  true of the cache as well as of the table.

Within a role, each cell is a savepoint: one failing cell rolls back alone and
the rest of that role still commits, with one `version` bump for the role.

REFUSAL RULES — ONLY THE ONES THAT ALREADY EXIST
------------------------------------------------
Each code below is a refusal `assign_role_permissions` already makes:

* ``role_not_found``        its 404
* ``permission_not_found``  its 400 "Permission IDs not found"
* ``version_conflict``      its 409 (per role, when `expected_versions` names it)
* ``admin_only_permission`` its 400: granting one of `ADMIN_ONLY_CODENAMES`
  to any role but ADMIN (maintainer decision, 2026-09-25: recycle-bin restore
  and hard delete are ADMIN-only as a server rule, and `RecycleBinViewSet`
  also checks the role, so a stray grant in the table does nothing).
  Revoking them is never refused.

And one refusal that is a rule rather than a restated 4xx:

* ``admin_always_all`` a revoke on an ADMIN cell (maintainer decision,
  2026-09-25). ADMIN always has everything — `check_permission` answers True
  for it before reading any grant — so an unticked ADMIN cell would be a
  statement the server does not honour. Nothing is written.
"""
from django.db import DatabaseError, transaction

from apps.perm.cache import invalidate_role_permissions
from apps.perm.checker import check_permission
from apps.perm.models import Permission, Role, RolePermission
from apps.perm.services import RoleHolder

GRANT = "grant"
REVOKE = "revoke"

SAVED = "saved"
UNCHANGED = "unchanged"
REFUSED = "refused"
FAILED = "failed"

ROLE_NOT_FOUND = "role_not_found"
PERMISSION_NOT_FOUND = "permission_not_found"
VERSION_CONFLICT = "version_conflict"
DATABASE_ERROR = "database_error"
ADMIN_ONLY_PERMISSION = "admin_only_permission"
ADMIN_ALWAYS_ALL = "admin_always_all"

ADMIN_ROLE_NAME = "ADMIN"
#: Codenames only the ADMIN role may hold.
ADMIN_ONLY_CODENAMES = frozenset({"recycle_bin.restore", "recycle_bin.hard_delete"})


def admin_only_violations(role_name, codenames):
    """The codenames in `codenames` that `role_name` may not be granted."""
    return set() if role_name == ADMIN_ROLE_NAME else ADMIN_ONLY_CODENAMES & set(codenames)

# Choice sets for the serializers and for ENUM_NAME_OVERRIDES in settings.
ACTIONS = [GRANT, REVOKE]
STATUSES = [SAVED, UNCHANGED, REFUSED, FAILED]
RESULT_CODES = [
    ROLE_NOT_FOUND, PERMISSION_NOT_FOUND, VERSION_CONFLICT, DATABASE_ERROR, ADMIN_ONLY_PERMISSION,
    ADMIN_ALWAYS_ALL,
]
ROLE_DELETE_REFUSAL_CODES = ["builtin_role", "role_in_use", "role_referenced_by_workflow_templates"]


def _write_change(role, permission, action):
    """One cell. `.create()` and a queryset `.delete()` rather than the bulk
    forms, so `apps/audit/signals.py::_invalidate_permission_cache` fires for
    each: that receiver writes the per-grant PERMISSION_CHANGE row, and both
    halves (grant and revoke) are recorded — the thing `bulk_create` cannot do
    (see the note in `assign_role_permissions`)."""
    if action == GRANT:
        RolePermission.objects.create(role=role, permission=permission)
    else:
        RolePermission.objects.filter(role=role, permission=permission).delete()


def apply_changes(changes, expected_versions=None):
    """Apply matrix cells independently. Returns (results, versions).

    `changes` is a list of {"role", "permission_id", "action"}; `results` has
    one entry per change, in request order, with the change's `index`.
    `versions` maps every role that exists to its version after this call.
    """
    expected_versions = expected_versions or {}
    results = [None] * len(changes)
    permissions = Permission.objects.in_bulk({c["permission_id"] for c in changes})

    by_role = {}
    for index, change in enumerate(changes):
        by_role.setdefault(change["role"], []).append(index)

    def result(index, status, code=None, detail=None, codename=None):
        change = changes[index]
        results[index] = {
            "index": index,
            "role": change["role"],
            "permission_id": change["permission_id"],
            "codename": codename,
            "action": change["action"],
            "status": status,
            "code": code,
            "detail": detail,
        }

    versions = {}
    for role_name, indices in by_role.items():
        try:
            with transaction.atomic():
                role = Role.objects.select_for_update().filter(name=role_name).first()
                if role is None:
                    for i in indices:
                        result(i, REFUSED, ROLE_NOT_FOUND, f"Role '{role_name}' not found")
                    continue
                expected = expected_versions.get(role_name)
                if expected is not None and role.version != expected:
                    for i in indices:
                        result(
                            i, REFUSED, VERSION_CONFLICT,
                            f"Role has been modified since it was loaded "
                            f"(expected version {expected}, current {role.version}).",
                        )
                    versions[role_name] = role.version
                    continue

                held = set(
                    RolePermission.objects.filter(role=role).values_list("permission_id", flat=True)
                )
                saved_any = False
                for i in indices:
                    change = changes[i]
                    permission = permissions.get(change["permission_id"])
                    if permission is None:
                        result(i, REFUSED, PERMISSION_NOT_FOUND,
                               f"Permission ID {change['permission_id']} not found")
                        continue
                    want = change["action"] == GRANT
                    if not want and role_name == ADMIN_ROLE_NAME:
                        result(i, REFUSED, ADMIN_ALWAYS_ALL,
                               "ADMIN always holds every permission", permission.codename)
                        continue
                    if want and admin_only_violations(role_name, [permission.codename]):
                        result(i, REFUSED, ADMIN_ONLY_PERMISSION,
                               f"{permission.codename} can only be granted to ADMIN", permission.codename)
                        continue
                    if (permission.pk in held) == want:
                        result(i, UNCHANGED, codename=permission.codename)
                        continue
                    try:
                        with transaction.atomic():
                            _write_change(role, permission, change["action"])
                    except DatabaseError as exc:
                        result(i, FAILED, DATABASE_ERROR, str(exc)[:200], permission.codename)
                        continue
                    (held.add if want else held.discard)(permission.pk)
                    result(i, SAVED, codename=permission.codename)
                    saved_any = True

                if saved_any:
                    # Advances `version` (AuditUserFields.save) once per role,
                    # however many cells moved — the same unit `assign` bumps.
                    role.save()
                    # After commit, not now: until then another connection
                    # reads the old grants and could re-cache them.
                    transaction.on_commit(lambda name=role_name: invalidate_role_permissions(name))
                versions[role_name] = role.version
        except DatabaseError as exc:
            # The role's own transaction failed to commit (or to lock): nothing
            # of it is in the table, whatever the per-cell loop recorded.
            for i in indices:
                if results[i] is None or results[i]["status"] == SAVED:
                    result(i, FAILED, DATABASE_ERROR, str(exc)[:200],
                           results[i]["codename"] if results[i] else None)
            versions.pop(role_name, None)
    return results, versions


# ── Workflow templates: who is named, and who could approve ─────────────


def approve_codenames():
    """The codenames `approve_node` demands, read off the view that demands
    them rather than restated here."""
    from apps.workflow.views import ApprovalWorkflowViewSet

    return list(ApprovalWorkflowViewSet.extra_permissions["approve_node"])


def _templates():
    from apps.workflow.models import WorkflowTemplate

    # `objects` drops soft-deleted rows; no tenant filter on purpose — roles
    # are global rows and every caller here is ADMIN (tenant-exempt), so a
    # template in any tenant that names a role is a reference to that role.
    return list(WorkflowTemplate.objects.order_by("name", "id"))


def _steps(template):
    from apps.workflow.node_shape import normalize_template_node

    nodes = template.nodes_json if isinstance(template.nodes_json, list) else []
    return [
        normalize_template_node(node, position)
        for position, node in enumerate(nodes, start=1)
        if isinstance(node, dict)
    ]


def _template_ref(template):
    return {
        "template_id": str(template.pk),
        "template_name": template.name,
        "tenant_id": template.tenant_id,
        "civilization": template.civilization,
        "is_active": template.is_active,
    }


def role_template_references(templates=None):
    """{role name: [template ref + its `steps`]} for every template whose
    stored nodes designate that role (`approver_type == "ROLE"` and a
    non-empty `approver_role` — the pair `_resolve_approver` reads).

    This is the stored configuration, not what a workflow built today would
    resolve to: a ROLE node whose label also names a cast member becomes an
    ACTOR node at creation (see `impact_of_changes`). It is still a
    reference — delete the role and the template's fallback points at nothing.
    """
    refs = {}
    for template in templates if templates is not None else _templates():
        per_role = {}
        for step in _steps(template):
            role = step.get("approver_role") or ""
            if step.get("approver_type") == "ROLE" and role:
                per_role.setdefault(role, []).append(
                    {"step_order": step["node_order"], "step_name": step["node_name"]}
                )
        for role, steps in per_role.items():
            refs.setdefault(role, []).append({**_template_ref(template), "steps": steps})
    return refs


def _approver_roles(step, template):
    """The roles whose holders could decide a node built from this step today.

    Asks `WorkflowService._resolve_approver` — the function that turns the
    step into approver columns — so this cannot disagree with it about which
    steps are ROLE, ACTOR or SYSTEM. Then mirrors `ApprovalNode.can_approve`:
    a ROLE node is decided by that role; an ACTOR node by the active users
    linked to that actor, i.e. by their roles; SYSTEM by nobody.
    """
    from apps.authentication.models import User
    from apps.workflow.services import WorkflowService

    resolved = WorkflowService._resolve_approver(step, template.civilization, template.tenant_id)
    if resolved["approver_type"] == "ROLE":
        return {resolved["approver_role"]}
    if resolved["approver_type"] == "ACTOR":
        return set(
            User.objects.filter(actor=resolved["approver_actor"], is_active=True)
            .values_list("role", flat=True)
        )
    return set()


def impact_of_changes(changes):
    """For each proposed revoke, the template steps it leaves with no role
    able to approve them. Reads only; writes nothing.

    A step "can be approved by role R" when R holds every codename
    `approve_node` requires (today: `workflow.approve`). A step is reported
    when at least one of its approver roles could approve it before the
    changes and none can after. Each conflict names the revokes that cause it
    — every revoke, in this request, of a required codename from one of the
    step's approver roles.
    """
    required = approve_codenames()
    required_ids = dict(
        Permission.objects.filter(codename__in=required).values_list("codename", "id")
    )
    id_to_codename = {pid: codename for codename, pid in required_ids.items()}

    # (role, codename) -> [(index, change)] for the changes that touch a
    # required codename. Other changes cannot change who may approve.
    touching = {}
    for index, change in enumerate(changes):
        codename = id_to_codename.get(change["permission_id"])
        if codename is not None:
            touching.setdefault((change["role"], codename), []).append((index, change))

    before_cache = {}

    def holds(role, codename, after):
        if (role, codename) not in before_cache:
            before_cache[(role, codename)] = check_permission(RoleHolder(role), codename)
        held = before_cache[(role, codename)]
        if not after or role in ("ADMIN", "SOUL"):
            # check_permission short-circuits these two before reading any
            # grant, so no change to their rows moves the answer.
            return held
        for _, change in touching.get((role, codename), []):
            held = change["action"] == GRANT
        return held

    def can(role, after):
        return all(holds(role, codename, after) for codename in required)

    if not touching:
        return []

    conflicts = []
    for template in _templates():
        for step in _steps(template):
            roles = _approver_roles(step, template)
            if not roles or not any(can(r, False) for r in roles):
                continue
            if any(can(r, True) for r in roles):
                continue
            causes = [
                {"index": index, "role": change["role"],
                 "permission_id": change["permission_id"], "codename": codename}
                for role in sorted(roles)
                for codename in required
                for index, change in touching.get((role, codename), [])
                if change["action"] == REVOKE
            ]
            conflicts.append({
                **_template_ref(template),
                "step_order": step["node_order"],
                "step_name": step["node_name"],
                "approver_roles": sorted(roles),
                "caused_by": causes,
            })
    return conflicts
