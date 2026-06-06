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
        ]

    def get_children(self, obj):
        children = obj.children.filter(is_active=True).order_by("order")
        return MenuSerializer(children, many=True).data

    def get_buttons(self, obj):
        buttons = obj.buttons.filter(is_active=True).order_by("order")
        return MenuButtonSerializer(buttons, many=True).data


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
