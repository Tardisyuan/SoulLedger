"""
Menu views — tree structure with button resources.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin

from .access import menu_is_visible_to, visible_menus
from .button_access import visible_buttons
from .models import Menu, MenuButton
from .serializers import (
    MenuButtonCreateUpdateSerializer,
    MenuButtonSerializer,
    MenuCreateUpdateSerializer,
    MenuSerializer,
    MenuTreeSerializer,
)

#: What `MenuSerializer` reaches for on every row it renders.
#:
#: `GET /menus/` measured **37 queries** for ~16 menu rows on 2026-08-29 —
#: `get_children` and `get_buttons` each issued one per node, recursively — and
#: the sidebar calls this endpoint on every page load. `GET /menus/tree/` was
#: 15, because `tree` had already built a `children_map` by hand.
#:
#: Two levels of `children` because the seeded tree is two deep. A third level
#: would fall back to per-node queries — slower, never wrong — rather than
#: silently returning less.
_MENU_PREFETCH = (
    "buttons",
    "children",
    "children__buttons",
    "children__children",
    "children__children__buttons",
)


class MenuViewSet(AuditUserViewSetMixin, CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    Menu CRUD ViewSet — supports tree structure with button resources.
    """
    permission_classes = [TenantPermission, CodenamePermission]
    # Reads and writes split deliberately, because this viewset is not
    # ADMIN-only: reads serve the navigation tree to every authenticated role
    # (get_queryset merely hides inactive menus from non-ADMIN), while only
    # ADMIN holds menu.manage below — CodenamePermission is now the real gate
    # on create/update/destroy, replacing the hardcoded `role != 'ADMIN'`
    # checks that used to live in perform_create/update/destroy. Binding
    # everything to the ADMIN-only menu.manage would deny `list` to every
    # non-ADMIN and take the whole navigation with it.
    #
    # menu.read is seeded and granted to all five roles by perm migration 0017;
    # menu.manage keeps the writes. The three read-only custom actions are
    # mapped explicitly — without an entry the mixin would derive menu.all /
    # menu.tree / menu.list_public, none of which exist.
    permission_codename = "menu"
    extra_permissions = {
        "create": ["menu.manage"],
        "update": ["menu.manage"],
        "partial_update": ["menu.manage"],
        "destroy": ["menu.manage"],
        "all": ["menu.read"],
        "tree": ["menu.read"],
        "list_public": ["menu.read"],
    }
    queryset = Menu.objects.all()
    serializer_class = MenuSerializer

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return MenuCreateUpdateSerializer
        return MenuSerializer

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return Menu.objects.none()
        # ?show_deleted=true — the recycle bin's "show deleted" toggle
        # convention (Stage 4 §4.7). ADMIN-only: a non-ADMIN caller only
        # ever sees is_active menus regardless, so there's nothing for the
        # toggle to reveal there and Menu.all_objects is not exposed to it.
        show_deleted = self.request.query_params.get('show_deleted', '').lower() in ('1', 'true', 'yes')
        if getattr(user, 'role', None) == 'ADMIN':
            base = Menu.all_objects if show_deleted else Menu.objects
            return base.all().prefetch_related(*_MENU_PREFETCH)
        # `roles` was consulted by `tree` and ignored here — and here is what the
        # sidebar calls (`useSidebarMenus` -> `menusApi.list()`), so a VIEWER was
        # served /tenants and /organizations, both roles=["ADMIN"]. Measured, not
        # inferred: 200 with 15 rows. Only ADMIN holds `menu.manage`, so no
        # non-ADMIN write path narrows with it.
        return visible_menus(
            Menu.objects.filter(is_active=True).prefetch_related(*_MENU_PREFETCH),
            user,
        )

    def destroy(self, request, *args, **kwargs):
        """Soft-delete, recording who and why. The default ModelViewSet
        path (instance.delete() -> SoftDeleteMixin.delete()) calls
        soft_delete() with no arguments, so deleted_by/delete_reason are
        never set — fine for a model nothing reads those on, but this is
        the recycle bin's reference-data example (Stage 4 §4.7) and the bin
        listing shows both."""
        menu = self.get_object()
        reason = request.data.get("reason", "") if hasattr(request, "data") else ""
        menu.soft_delete(user=request.user, reason=reason)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"])
    def all(self, request):
        """GET /api/v1/menus/all/ - Get all menus (ADMIN only)"""
        if request.user.role != "ADMIN":
            return Response(
                {"error": "Only ADMIN can view all menus"},
                status=status.HTTP_403_FORBIDDEN
            )
        menus = Menu.objects.filter(parent__isnull=True).order_by("order")
        # With no context, `MenuSerializer._caller()` finds no user and both
        # `get_children` and `get_buttons` fail closed — so this endpoint
        # returned every menu with empty children and empty buttons, which a
        # client cannot tell apart from a menu that genuinely has neither.
        # The two other call sites (`tree` below, and the recursive one in
        # `get_children`) always passed it.
        serializer = MenuSerializer(
            menus, many=True, context=self.get_serializer_context()
        )
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="tree")
    def tree(self, request):
        """
        GET /api/v1/menus/tree/ — 完整资源树（含按钮），按角色过滤。

        返回当前用户可访问的菜单树，包含每层菜单的按钮资源。
        ADMIN 看到全部菜单和按钮。
        非 ADMIN 用户：菜单按 roles 过滤，按钮按 permission codename 过滤。
        """
        user = request.user
        user_role = getattr(user, 'role', None)

        # ADMIN sees everything
        if user_role == 'ADMIN':
            top_menus = Menu.objects.filter(
                parent__isnull=True, is_active=True
            ).order_by("order")
            # Pre-fetch all menus to avoid N+1 queries
            all_menus = Menu.objects.filter(is_active=True).prefetch_related('buttons')
            children_map = {}
            for menu in all_menus:
                if menu.parent_id:
                    children_map.setdefault(menu.parent_id, []).append(menu)
            serializer = MenuTreeSerializer(
                top_menus, many=True, context={'user': user, 'children_map': children_map}
            )
            return Response(serializer.data)

        # Non-admin: filter by role
        top_menus = Menu.objects.filter(
            parent__isnull=True, is_active=True
        ).order_by("order")
        # Same rule as get_queryset, from the same function. Written twice it
        # would drift, which is how this gap opened in the first place: `tree`
        # honoured `roles` and `get_queryset` did not.
        accessible = [m for m in top_menus if menu_is_visible_to(m, user)]

        # Pre-fetch all menus to avoid N+1 queries
        all_menus = Menu.objects.filter(is_active=True).prefetch_related('buttons')
        children_map = {}
        for menu in all_menus:
            # Children were attached unfiltered, so an ADMIN-only child under a
            # shared parent reached every role that could see the parent. The
            # top-level filter alone was never the whole rule.
            if menu.parent_id and menu_is_visible_to(menu, user):
                children_map.setdefault(menu.parent_id, []).append(menu)

        serializer = MenuTreeSerializer(
            accessible, many=True, context={'user': user, 'children_map': children_map}
        )
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="list-public")
    def list_public(self, request):
        """GET /api/v1/menus/list-public/ - Get accessible menus by role

        The role test used to be spelled out inline here -- `is_public = not
        menu.roles`, then `user_role in menu.roles or user_role == "ADMIN"` --
        which was the **third** hand-written copy of a rule
        `apps/menus/access.py` exists to hold one copy of. It agreed with the
        others on top-level menus and, because it serialised through
        `MenuSerializer`, leaked ADMIN-only *children* exactly as `/menus/` did.

        Now it asks `menu_is_visible_to` and hands the request down in the
        serializer context so `get_children` can filter too.
        """
        top_menus = Menu.objects.filter(parent__isnull=True, is_active=True).order_by("order")
        accessible_menus = [
            MenuSerializer(menu, context={"request": request}).data
            for menu in top_menus
            if menu_is_visible_to(menu, request.user)
        ]
        return Response(accessible_menus)


class MenuButtonViewSet(AuditUserViewSetMixin, CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    MenuButton CRUD — 按钮资源管理。

    绑定到 Menu 上的操作按钮，每个按钮关联一个 permission codename。
    """
    permission_classes = [TenantPermission, CodenamePermission]
    # Same split as MenuViewSet above: every role needs to read the button
    # resources to render its navigation, only ADMIN holds menu.manage, so
    # CodenamePermission is now the real gate on create/update/destroy —
    # replacing the hardcoded `role != 'ADMIN'` checks that used to live in
    # perform_create/update/destroy.
    permission_codename = "menu"
    extra_permissions = {
        "create": ["menu.manage"],
        "update": ["menu.manage"],
        "partial_update": ["menu.manage"],
        "destroy": ["menu.manage"],
    }
    queryset = MenuButton.objects.select_related("menu").all()
    serializer_class = MenuButtonSerializer

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return MenuButtonCreateUpdateSerializer
        return MenuButtonSerializer

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return MenuButton.objects.none()
        qs = super().get_queryset()
        # No tenant filtering here, deliberately: Menu and MenuButton are
        # global navigation metadata shared by every tenant — neither model
        # has a `tenant` field, and MenuViewSet above filters by role rather
        # than tenant for the same reason (M15 confirmed this as intended
        # design, not a gap). What stood here was a non-ADMIN-only
        # `qs.filter(menu__tenant=tenant)`, which could only ever raise
        # (FieldError/ValueError -> 500) because `Menu.tenant` does not
        # exist; every existing test authenticated as ADMIN and returned
        # before reaching it, so the suite stayed green while all four
        # non-ADMIN roles got a 500 from GET /menus/buttons/. Access is
        # already gated by menu.read / menu.manage via CodenameViewSetMixin.
        # Role/codename visibility, converged with the tree serializer.
        # `MenuTreeSerializer.get_buttons` filtered by `user_has_permission`
        # while this listed everything: two exits for one dataset, one filtered
        # and one not. Measured as JUDGE: `GET /menus/buttons/ -> 200, n=1`
        # showing `tenant.delete`, a button under a `roles=["ADMIN"]` menu.
        qs = visible_buttons(qs, user)

        # Filter by menu_id if provided
        menu_id = self.request.query_params.get('menu_id')
        if menu_id:
            qs = qs.filter(menu_id=menu_id)
        return qs

