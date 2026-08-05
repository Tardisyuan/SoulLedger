"""
Menu views — tree structure with button resources.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin

from .models import Menu, MenuButton
from .serializers import (
    MenuButtonCreateUpdateSerializer,
    MenuButtonSerializer,
    MenuCreateUpdateSerializer,
    MenuSerializer,
    MenuTreeSerializer,
)


class MenuViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
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
        if getattr(user, 'role', None) == 'ADMIN':
            return Menu.objects.all()
        return Menu.objects.filter(is_active=True)

    @action(detail=False, methods=["get"])
    def all(self, request):
        """GET /api/v1/menus/all/ - Get all menus (ADMIN only)"""
        if request.user.role != "ADMIN":
            return Response(
                {"error": "Only ADMIN can view all menus"},
                status=status.HTTP_403_FORBIDDEN
            )
        menus = Menu.objects.filter(parent__isnull=True).order_by("order")
        serializer = MenuSerializer(menus, many=True)
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
        is_authenticated = getattr(user, 'is_authenticated', False)
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
        accessible = []
        for menu in top_menus:
            is_public = not menu.roles
            if is_public:
                accessible.append(menu)
            elif is_authenticated and user_role:
                if user_role in menu.roles:
                    accessible.append(menu)

        # Pre-fetch all menus to avoid N+1 queries
        all_menus = Menu.objects.filter(is_active=True).prefetch_related('buttons')
        children_map = {}
        for menu in all_menus:
            if menu.parent_id:
                children_map.setdefault(menu.parent_id, []).append(menu)

        serializer = MenuTreeSerializer(
            accessible, many=True, context={'user': user, 'children_map': children_map}
        )
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="list-public")
    def list_public(self, request):
        """GET /api/v1/menus/list-public/ - Get accessible menus by role"""
        is_authenticated = getattr(request.user, 'is_authenticated', False)
        user_role = getattr(request.user, 'role', None)
        top_menus = Menu.objects.filter(parent__isnull=True, is_active=True).order_by("order")
        accessible_menus = []
        for menu in top_menus:
            is_public = not menu.roles
            if is_public:
                accessible_menus.append(MenuSerializer(menu).data)
            elif is_authenticated and user_role:
                if user_role in menu.roles or user_role == "ADMIN":
                    accessible_menus.append(MenuSerializer(menu).data)
        return Response(accessible_menus)


class MenuButtonViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
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
        # Tenant filtering for non-ADMIN users
        if getattr(user, 'role', None) != 'ADMIN':
            tenant = getattr(self.request, 'tenant', None)
            if tenant:
                qs = qs.filter(menu__tenant=tenant)
            else:
                return MenuButton.objects.none()
        # Filter by menu_id if provided
        menu_id = self.request.query_params.get('menu_id')
        if menu_id:
            qs = qs.filter(menu_id=menu_id)
        return qs

