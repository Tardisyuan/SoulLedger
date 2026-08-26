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
    """
    if is_menu_admin(user):
        return True
    if not menu.roles:
        return True
    role = getattr(user, "role", None)
    return bool(role) and role in menu.roles


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
