"""
Menu serializers
"""
from rest_framework import serializers
from .models import Menu


class MenuSerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()

    class Meta:
        model = Menu
        fields = ["id", "name", "path", "icon", "order", "parent", "roles", "is_active", "component", "children"]

    def get_children(self, obj):
        children = obj.children.filter(is_active=True).order_by("order")
        return MenuSerializer(children, many=True).data


class MenuCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Menu
        fields = ["id", "name", "path", "icon", "order", "parent", "roles", "is_active", "component"]
        extra_kwargs = {
            "icon": {"required": False, "allow_blank": True},
            "component": {"required": False, "allow_blank": True},
            "order": {"required": False},
        }
