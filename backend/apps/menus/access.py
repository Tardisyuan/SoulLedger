"""The single place a menu's ``roles`` column is turned into a decision.

WHY THIS MODULE EXISTS. ``roles`` was written on every menu row and consulted
on exactly one code path. ``MenuViewSet.tree`` filtered by it; ``get_queryset``
— which is what the sidebar actually calls, via ``menusApi.list()`` — returned
``Menu.objects.filter(is_active=True)`` with no role filter at all. Measured
rather than read: a VIEWER holding ``menu.read`` got HTTP 200 and 15 rows
including ``/tenants`` and ``/organizations``, both ``roles=["ADMIN"]``.

That was not a data leak — every one of those routes 403s on its own API — but
it advertised the administrative surface of the product to every authenticated
user, and it made ``roles`` a column that looked load-bearing and was not on
the path that mattered.

Consolidating rather than adding a second copy is the point. This codebase's
tenant-isolation gaps arrived in batches precisely because the same four-line
idiom was pasted into ten ``get_queryset`` bodies (see ``apps/core/tenant.py``'s
header). A role filter written once in ``tree`` and once in ``get_queryset``
would be the same wager.

TWO THINGS THAT LOOK LIKE OVERSIGHTS AND ARE NOT:

* **An empty ``roles`` means visible to everyone**, not visible to no-one. That
  is ``tree``'s established reading (``is_public = not menu.roles``) and this
  keeps it. It is also load-bearing today: 3 of the 14 seeded rows carry
  ``roles=[]`` — ``/social``, ``/social/follows``, and one DIRECTORY that
  parents other rows. A filter that treated empty as "nobody" would have
  deleted those three from every sidebar in the product, including ADMIN's,
  and orphaned that directory's children.

* **The filter runs in Python, not in SQL.** ``roles`` is a ``JSONField`` and
  Django's ``contains`` lookup is unsupported on SQLite, which is what the test
  suite runs on; a ``roles__contains=[role]`` filter passes in production and
  raises ``NotSupportedError`` in every test. The table is reference data —
  fourteen rows — so the cost of evaluating it in Python is nil and the
  behaviour is identical on both backends.
"""

ADMIN_ROLE = "ADMIN"


def is_menu_admin(user) -> bool:
    """True for the one role that sees every menu regardless of ``roles``.

    ``getattr`` rather than ``user.role``: ``AnonymousUser`` has no ``role``
    attribute, and the same mistake in ``apps/core/mixins.py`` used to raise
    ``AttributeError`` before its own guard was added.
    """
    return getattr(user, "role", None) == ADMIN_ROLE


def menu_is_visible_to(menu, user) -> bool:
    """Whether ``user`` may see ``menu`` at all.

    Note this answers *visibility*, not *authority*. A visible menu still leads
    to an endpoint that enforces its own codename — ``/corpus`` is
    ``judgment.read`` — so this is about not advertising a door somebody cannot
    open, not about the lock on it.

    Three ways in, any one suffices (2026-09-17, for the scheduler page):

    1. ``roles`` admits the caller's role — the original rule, unchanged,
       including "empty means everyone".
    2. ``menu.permission`` is set and the caller HOLDS that codename. This is
       what makes a grant in the permission matrix show up in the sidebar
       without also editing the menu row: ``/scheduler`` carries
       ``roles=["ADMIN"]`` and ``permission="scheduler.read"``, so a VIEWER
       given ``scheduler.read`` sees it and a VIEWER without it does not.
       ``permission`` had been written on rows since 0013 and read by nothing
       on the visibility path; this is its first consumer. Rows whose
       ``permission`` is empty are unaffected — no codename, no second door.
    3. A DIRECTORY is visible when any active child is, so a page you may see
       is never orphaned behind a group you may not. Only the directory
       itself is admitted this way — its *other* children are still judged
       one by one (``get_children`` / ``tree`` filter each through this same
       function), so opening ``系统设置`` for one page does not open ``/users``.

    Every seeded row today has ``permission`` empty or held by exactly the
    roles already in ``roles``, so on the current data this changes nothing
    (asserted by tests/test_menu_visibility_follows_the_codename.py).
    """
    # First, and before the ADMIN short-circuit: `Menu._default_manager` is the
    # unfiltered `all_objects`, so every reverse `children` manager (and the
    # prefetch built on it) still yields binned rows. Measured 2026-09-17 on
    # main: `/menus/` and `/menus/list-public/` listed a soft-deleted child to
    # ADMIN and VIEWER alike. ADMIN's `?show_deleted=true` does not come
    # through here -- `visible_menus` returns its queryset untouched.
    if getattr(menu, "is_deleted", False):
        return False
    if is_menu_admin(user):
        return True
    if not menu.roles:
        return True
    role = getattr(user, "role", None)
    if bool(role) and role in menu.roles:
        return True
    if menu.permission:
        from apps.core.permissions import user_has_permission

        if user_has_permission(user, menu.permission):
            return True
    if menu.menu_type == "DIRECTORY":
        # `children.all()` off the prefetched manager where the caller
        # prefetched (`_MENU_PREFETCH` in views.py); one query per directory
        # otherwise — six directories, reference data.
        return any(child.is_active and menu_is_visible_to(child, user) for child in menu.children.all())
    return False


def visible_menus(queryset, user):
    """Narrow ``queryset`` to the rows ``user`` may see. Fails closed.

    Returns ``queryset.none()`` for an unauthenticated caller rather than the
    unfiltered set, matching ``apps/core/tenant.py``'s stance: no resolvable
    identity means nothing, never everything.
    """
    if not getattr(user, "is_authenticated", False):
        return queryset.none()
    if is_menu_admin(user):
        return queryset
    keep = [m.pk for m in queryset if menu_is_visible_to(m, user)]
    return queryset.filter(pk__in=keep)
