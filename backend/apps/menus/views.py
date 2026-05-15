"""
Menu views
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from .models import Menu
from .serializers import MenuSerializer, MenuCreateUpdateSerializer


@api_view(["GET"])
@permission_classes([AllowAny])
def list_menus(request):
    """
    GET /api/v1/menus/
    获取用户可访问的菜单树（根据角色过滤）
    空 roles 的菜单对所有用户公开，包括未认证用户
    """
    # 判断用户是否已认证（登录）
    is_authenticated = getattr(request.user, 'is_authenticated', False)
    user_role = getattr(request.user, 'role', None)

    # 获取顶级菜单（没有父菜单的）
    top_menus = Menu.objects.filter(parent__isnull=True, is_active=True).order_by("order")

    # 过滤出用户角色可访问的菜单
    # 规则：
    #   - roles 为空表示公开菜单，所有人可见（包括未登录）
    #   - roles 非空：仅已认证用户才能访问，且角色必须在 roles 中
    accessible_menus = []
    for menu in top_menus:
        is_public = not menu.roles  # 空 roles 表示公开
        if is_public:
            # 公开菜单：所有人可见
            accessible_menus.append(MenuSerializer(menu).data)
        elif is_authenticated and user_role:
            # 已认证用户：检查角色是否匹配
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
