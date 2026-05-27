"""
Menu views
"""
from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import Menu
from .serializers import MenuSerializer, MenuCreateUpdateSerializer
from apps.core.viewsets import CodenameViewSetMixin


class MenuViewSet(CodenameViewSetMixin, viewsets.ModelViewSet):
    """
    Menu CRUD ViewSet.
    """
    permission_classes = [IsAuthenticated]
    permission_codename = "menu"
    extra_permissions = {
        'all': ['menu.read'],
        'create_menu': ['menu.create'],
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

    def perform_create(self, serializer):
        if getattr(self.request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only ADMIN can create menus")
        serializer.save()

    def perform_update(self, serializer):
        if getattr(self.request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only ADMIN can modify menus")
        serializer.save()

    def perform_destroy(self, instance):
        if getattr(self.request.user, 'role', None) != 'ADMIN':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Only ADMIN can delete menus")
        instance.delete()

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


# ---------------------------------------------------------------------------
# Legacy function-based views (kept for backward compatibility)
# ---------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([AllowAny])
def list_menus(request):
    """
    GET /api/v1/menus/
    获取用户可访问的菜单树（根据角色过滤）
    空 roles 的菜单对所有用户公开，包括未认证用户
    """
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def all_menus(request):
    """
    GET /api/v1/menus/all/
    获取所有菜单（仅 ADMIN）
    """
    if request.user.role != "ADMIN":
        return Response(
            {"error": "Only ADMIN can view all menus"},
            status=status.HTTP_403_FORBIDDEN
        )
    menus = Menu.objects.filter(parent__isnull=True).order_by("order")
    serializer = MenuSerializer(menus, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_menu(request):
    """
    POST /api/v1/menus/create/
    创建菜单（仅 ADMIN）
    """
    if request.user.role != "ADMIN":
        return Response(
            {"error": "Only ADMIN can create menus"},
            status=status.HTTP_403_FORBIDDEN
        )
    serializer = MenuCreateUpdateSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def update_delete_menu(request, pk):
    """
    PUT /api/v1/menus/<id>/
    DELETE /api/v1/menus/<id>/
    更新/删除菜单（仅 ADMIN）
    """
    if request.user.role != "ADMIN":
        return Response(
            {"error": "Only ADMIN can modify menus"},
            status=status.HTTP_403_FORBIDDEN
        )
    try:
        menu = Menu.objects.get(pk=pk)
    except Menu.DoesNotExist:
        return Response(
            {"error": "Menu not found"},
            status=status.HTTP_404_NOT_FOUND
        )
    if request.method == "GET":
        serializer = MenuSerializer(menu)
        return Response(serializer.data)
    if request.method in ["PUT", "PATCH"]:
        serializer = MenuCreateUpdateSerializer(menu, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    elif request.method == "DELETE":
        menu.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
