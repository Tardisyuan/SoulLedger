"""
Field-Level Permission Mixin for DRF Serializers.

Dynamically filters serializer fields based on user's role and FieldPermission rules.
Supports:
- Hiding fields (visible=False)
- Making fields read-only (read_only=True)
- Disabling field editing (editable=False)

Usage:
    class SoulSerializer(FieldPermissionMixin, serializers.ModelSerializer):
        class Meta:
            model = Soul
            fields = "__all__"
            # Optional: specify which model name to use for FieldPermission lookup
            field_permission_model = "Soul"
"""
from apps.perm.models import FieldPermission


class FieldPermissionMixin:
    """
    Serializer mixin that dynamically filters fields based on FieldPermission rules.

    The mixin checks the user's role against FieldPermission entries for the model.
    If no rules exist, all fields are visible and editable (default behavior).

    Priority: specific (field_name) > wildcard (field_name="*")
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._apply_field_permissions()

    def _get_field_permission_model_name(self):
        """Get the model name for FieldPermission lookup."""
        meta = getattr(self, 'Meta', None)
        # Check for explicit field_permission_model
        if meta and hasattr(meta, 'field_permission_model'):
            return meta.field_permission_model
        # Fall back to model class name
        if meta and hasattr(meta, 'model'):
            return meta.model.__name__
        return None

    def _get_user_role(self):
        """Get the current user's role from context."""
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            return getattr(request.user, 'role', None)
        return None

    def _apply_field_permissions(self):
        """Apply field-level permissions based on user's role."""
        model_name = self._get_field_permission_model_name()
        user_role = self._get_user_role()

        if not model_name or not user_role:
            return  # No model or user — skip

        # ADMIN bypasses field permissions
        if user_role == 'ADMIN':
            return

        rules = FieldPermission.get_field_rules(user_role, model_name)
        if not rules:
            return  # No rules defined — all fields visible/editable

        # Get wildcard rules (field_name="*")
        wildcard_rules = rules.get('*', {})
        wildcard_visible = wildcard_rules.get('visible', True)
        wildcard_read_only = wildcard_rules.get('read_only', False)
        wildcard_editable = wildcard_rules.get('editable', True)

        # Apply rules to each field
        fields_to_remove = []
        for field_name, field in self.fields.items():
            # Get specific rule or fall back to wildcard
            field_rule = rules.get(field_name, wildcard_rules)
            if not field_rule:
                continue  # No rule — keep default

            # Handle visibility
            visible = field_rule.get('visible', wildcard_visible)
            if not visible:
                fields_to_remove.append(field_name)
                continue

            # Handle read_only
            read_only = field_rule.get('read_only', wildcard_read_only)
            if read_only:
                field.read_only = True

            # Handle editable (set read_only if not editable)
            editable = field_rule.get('editable', wildcard_editable)
            if not editable:
                field.read_only = True

        # Remove invisible fields
        for field_name in fields_to_remove:
            del self.fields[field_name]


class FieldPermissionSerializerMixin(FieldPermissionMixin):
    """
    Alias for FieldPermissionMixin — for explicit naming in ViewSets.

    Usage:
        class SoulViewSet(viewsets.ModelViewSet):
            serializer_class = SoulSerializer
            # The serializer automatically applies field permissions
    """
    pass
