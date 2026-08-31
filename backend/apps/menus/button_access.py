"""Who may see which MenuButton.

Split out for the same reason `apps/menus/access.py` exists: the rule was
implemented twice and the two copies disagreed.

    MenuTreeSerializer.get_buttons   filtered by `user_has_permission`
    MenuButtonViewSet.get_queryset   filtered by `menu_id` only
    MenuSerializer.get_buttons       not filtered at all

Measured as JUDGE: `GET /menus/buttons/ -> 200, n=1`, showing `tenant.delete`
-- a button hanging off a menu whose `roles` is `["ADMIN"]`. Information only
(the endpoints those buttons call enforce their own codenames), but it hands
out the complete codename table and the shape of the admin surface.
"""
from apps.menus.access import is_menu_admin, menu_is_visible_to


def button_is_visible_to(button, user) -> bool:
    """A button is visible when its menu is visible **and** its codename is held.

    Both halves matter and they answer different questions. The menu check is
    "is this door advertised to you"; the codename check is "can you work this
    control". A button on an invisible menu was the leak; a button whose
    codename you lack was already filtered in the tree serializer.
    """
    from apps.core.permissions import user_has_permission

    if not getattr(user, "is_authenticated", False):
        return False
    if is_menu_admin(user):
        return True
    menu = getattr(button, "menu", None)
    if menu is not None and not menu_is_visible_to(menu, user):
        return False
    if not button.permission:
        return True
    return user_has_permission(user, button.permission)


def visible_buttons(queryset, user):
    """Narrow ``queryset`` to what ``user`` may see. Fails closed.

    Same stance as `visible_menus`: an unauthenticated caller gets nothing,
    never everything.
    """
    if not getattr(user, "is_authenticated", False):
        return queryset.none()
    if is_menu_admin(user):
        return queryset
    keep = [b.pk for b in queryset.select_related("menu") if button_is_visible_to(b, user)]
    return queryset.filter(pk__in=keep)
