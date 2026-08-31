"""
Menu serializers — tree structure with button resources.
"""
from rest_framework import serializers

from .models import Menu, MenuButton


class MenuButtonSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuButton
        fields = ["id", "name", "code", "permission", "order", "is_active"]


class MenuTreeSerializer(serializers.ModelSerializer):
    """Recursive tree serializer — includes children and buttons filtered by user permissions."""
    children = serializers.SerializerMethodField()
    buttons = serializers.SerializerMethodField()

    class Meta:
        model = Menu
        fields = [
            "id", "name", "path", "icon", "order", "parent",
            "menu_type", "permission", "roles", "is_active",
            "visible", "cache", "component", "children", "buttons",
        ]

    def get_children(self, obj):
        children_map = self.context.get('children_map', {})
        children = children_map.get(obj.id, [])
        # Sort by order (already filtered by is_active in the view)
        children = sorted(children, key=lambda m: m.order)
        return MenuTreeSerializer(children, many=True, context=self.context).data

    def get_buttons(self, obj):
        """Filter buttons by user's role permissions."""
        from apps.core.permissions import user_has_permission

        buttons = obj.buttons.filter(is_active=True).order_by("order")
        user = self.context.get('user')

        if not user or not user.is_authenticated:
            # Unauthenticated: return buttons without permission check (UI decides)
            return MenuButtonSerializer(buttons, many=True).data

        # ADMIN sees all buttons
        if getattr(user, 'role', None) == 'ADMIN':
            return MenuButtonSerializer(buttons, many=True).data

        # Filter buttons by user's role permissions
        filtered_buttons = []
        for button in buttons:
            if not button.permission or user_has_permission(user, button.permission):
                filtered_buttons.append(button)

        return MenuButtonSerializer(filtered_buttons, many=True).data


class MenuSerializer(serializers.ModelSerializer):
    """Flat serializer — includes buttons but not recursive children."""
    children = serializers.SerializerMethodField()
    buttons = serializers.SerializerMethodField()

    class Meta:
        model = Menu
        fields = [
            "id", "name", "path", "icon", "order", "parent",
            "menu_type", "permission", "roles", "is_active",
            "visible", "cache", "component", "children", "buttons",
            # Recycle bin (Stage 4 §4.7): the "show deleted" toggle on the
            # menus list page renders a deleted row via these three —
            # ink-subtle + strikethrough-on-name + "已删除" badge — rather
            # than hiding it outright.
            "is_deleted", "deleted_at", "delete_reason",
        ]

    def get_children(self, obj):
        """Children the caller may see -- **not** every active child.

        This was `obj.children.filter(is_active=True)` with no `roles` filter,
        which is the same defect `MenuViewSet.tree` already carries a comment
        about ("Children were attached unfiltered, so an ADMIN-only child under
        a shared parent reached every role that could see the parent"). It was
        fixed there and left standing here, and `/menus/` -- the endpoint the
        sidebar actually calls -- goes through this serializer.

        Measured as JUDGE before this change:

            GET /menus/       top level had no `secret`, but children carried
                              ADMIN-only rows:
                              [('zzparent','zzADMINCHILD',['ADMIN']),
                               ('概览','业力统计',['ADMIN'])]
            GET /menus/tree/  ADMIN-only nodes visible to JUDGE: []   <- clean

        `概览 → 业力统计` is a real seeded row, not a fixture.

        Routed through `apps/menus/access.py` rather than re-deriving the rule,
        because that module's docstring says converging on one implementation
        is the point of the module -- and this was the fourth copy.
        """
        from apps.menus.access import menu_is_visible_to

        # Filtered in Python off the prefetched related manager, not with a
        # fresh `obj.children.filter(...)`. The queryset version issued one
        # query per node and recursed: `GET /menus/` was 37 queries for ~16
        # rows, on the endpoint the sidebar hits every page load. See
        # `_MENU_PREFETCH` in views.py.
        #
        # `menu_is_visible_to` is the same predicate `visible_menus` applies
        # row by row, so the answer is identical — `visible_menus` already
        # evaluates `roles` in Python (JSONField `contains` is unsupported on
        # SQLite; see apps/menus/access.py's header).
        caller = self._caller()
        if not getattr(caller, "is_authenticated", False):
            # Fails closed, matching `visible_menus`.
            return []
        children = sorted(
            (
                child
                for child in obj.children.all()
                if child.is_active and menu_is_visible_to(child, caller)
            ),
            key=lambda m: (m.order, m.pk),
        )
        return MenuSerializer(children, many=True, context=self.context).data

    def get_buttons(self, obj):
        """Buttons the caller may see. Same shape as `MenuTreeSerializer`'s.

        Two exits for one dataset, one filtered and one not, is what M39 was:
        `JUDGE GET /menus/buttons/ -> 200, n=1, ['tenant.delete']`, a button
        hanging off a `roles=["ADMIN"]` menu.
        """
        from apps.menus.button_access import button_is_visible_to

        # Python-side for the same reason as `get_children` above.
        caller = self._caller()
        if not getattr(caller, "is_authenticated", False):
            return []
        buttons = sorted(
            (
                button
                for button in obj.buttons.all()
                if button.is_active and button_is_visible_to(button, caller)
            ),
            key=lambda b: (b.order, b.pk),
        )
        return MenuButtonSerializer(buttons, many=True).data

    def _caller(self):
        """The user this serialisation is for.

        `context["user"]` is what `MenuTreeSerializer` is given; DRF's generic
        views put the request in `context["request"]`. Read both -- a serializer
        that silently sees no user fails **open** in `get_children` unless
        `visible_menus` fails closed, and it does, but relying on that would
        make an empty sidebar the symptom of a wiring mistake.
        """
        user = self.context.get("user")
        if user is not None:
            return user
        request = self.context.get("request")
        return getattr(request, "user", None)


class MenuCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Menu
        fields = [
            "id", "name", "path", "icon", "order", "parent",
            "menu_type", "permission", "roles", "is_active",
            "visible", "cache", "component",
        ]
        extra_kwargs = {
            "icon": {"required": False, "allow_blank": True},
            "component": {"required": False, "allow_blank": True},
            "order": {"required": False},
            "permission": {"required": False, "allow_blank": True},
            "menu_type": {"required": False},
            "visible": {"required": False},
            "cache": {"required": False},
        }


class MenuButtonCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuButton
        fields = ["id", "menu", "name", "code", "permission", "order", "is_active"]
