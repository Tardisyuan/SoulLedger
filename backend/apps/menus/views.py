"""
Menu views
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Menu
from .serializers import MenuSerializer, MenuCreateUpdateSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_menus(request):
    """
    GET /api/v1/menus/
    获取用户可访问的菜单树（根据角色过滤）
    """
    user_role = request.user.role

    # 获取顶级菜单（没有父菜单的）
    top_menus = Menu.objects.filter(parent__isnull=True, is_active=True).order_by("order")

    # 过滤出用户角色可访问的菜单
    accessible_menus = []
    for menu in top_menus:
        if not menu.roles or user_role in menu.roles or user_role == "ADMIN":
            menu_data = MenuSerializer(menu).data
            accessible_menus.append(menu_data)

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


@api_view(["PUT", "DELETE"])
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

    if request.method == "PUT":
        serializer = MenuCreateUpdateSerializer(menu, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        menu.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
