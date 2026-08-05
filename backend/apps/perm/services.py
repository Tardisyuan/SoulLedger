"""One answer to "what may this role do?", for everything that has to report it.

This lives here rather than in apps/perm/views.py because it has two callers in
two apps now — the permission endpoints and the login serializer — and a
serializer reaching into a views module for a private helper is not a
dependency either side should have. It is deliberately not in checker.py:
check_permission answers one codename and is on the request path for every
enforcement decision; this enumerates, and enumeration is a reporting concern.

The rule itself is not reimplemented here. That is the whole point — see
get_role_permission_codenames.
"""
from apps.perm.checker import check_permission
from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission


class RoleHolder:
    """A stand-in subject carrying nothing but a role name.

    check_permission() reads exactly two attributes off the user it is given —
    `is_authenticated` and `role` — so this is a faithful subject for it, and
    apps/perm/test_reported_matches_granted.py pins that by driving real users
    through both reporting paths and comparing against
    check_permission(real_user, ...).

    It exists because the permission endpoints answer per ROLE, not per user:
    get_permissions_for_role reports a role the caller is not a member of, and
    on a fresh deployment there may be no user holding it at all. Routing every
    caller through one probe means the admin's role editor, a user's own
    permission list and the login payload cannot disagree about the same role.
    """

    is_authenticated = True

    def __init__(self, role_name):
        self.role = role_name


def get_role_permission_codenames(role_name):
    """Codenames this role effectively holds — answered by check_permission itself.

    This is what fills the frontend's permission list, by both routes that
    deliver it: the login response (apps/authentication/serializers.py) and the
    rehydrate fetch against /perm/role-permissions/. Every codename returned is
    a control the UI will offer; every one omitted is a control it will hide.
    Disagreement with apps/perm/checker.py means the interface lies about what
    the server will do, in one direction or the other.

    Three separate implementations of the resolution rule existed before this,
    and all three had drifted from the checker in a different way:

    - per role, all-or-nothing — a single RolePermission row switched the
      ROLE_PERMISSIONS fallback off for the entire role, so a partially-seeded
      database reported VIEWER as holding one codename against the checker's
      eight;
    - per codename but without the ADMIN short-circuit — ADMIN reported 39 of
      40, dropping workflow.escalate, which is seeded, not granted to the ADMIN
      role, and allowed by the server regardless;
    - the login serializer, which was the first shape and outlived the fix to
      the second: ADMIN 7 against 40, GUARDIAN 1 against 14.

    A second copy of a rule is how they drifted; a third is how the fix to the
    second missed the first. So the rule lives in exactly one place now and
    this asks it. The only decision left here is which codenames to ask about:

    - DEFAULT_PERMISSIONS, the declared catalogue — what the frontend gates on;
    - every Permission row, so a codename an admin created through
      create_permission and granted is reported rather than silently dropped;
    - ROLE_PERMISSIONS[role], whose unseeded entries the checker still answers
      from the dict and which have no Permission row to be found by.

    ADMIN needs no special case: check_permission short-circuits it to True
    before consulting either source, so asking models the short-circuit for
    free. An admin who revokes a codename from the ADMIN role keeps seeing that
    button, which is the truth — the server will not refuse them.

    Cost: one query for the Permission rows, then check_permission per
    codename. ADMIN answers from the short-circuit without touching the
    database at all; every other role costs at most two queries per codename on
    a cold cache and none on a warm one. That cache is keyed (role, codename)
    with a 300s TTL, which is why the write endpoints in views.py invalidate
    explicitly — see the note on assign_role_permissions.
    """
    candidates = (
        {codename for codename, _, _ in DEFAULT_PERMISSIONS}
        | set(Permission.objects.values_list("codename", flat=True))
        | set(ROLE_PERMISSIONS.get(role_name, []))
    )
    holder = RoleHolder(role_name)
    return sorted(codename for codename in candidates if check_permission(holder, codename))
