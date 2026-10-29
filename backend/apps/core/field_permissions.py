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

    def _get_user(self):
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            return request.user
        return None

    def _apply_field_permissions(self):
        """Apply field-level permissions for every role the user holds.

        The primary role plus live extra roles (用户决定第 27 条:字段权限认兼任角色), combined like grants
        are — the most open role wins: a field is hidden only when every role hides it, read-only only when
        every role locks it, and a role with no rule for this model leaves every field as it is.
        """
        model_name = self._get_field_permission_model_name()
        user = self._get_user()
        user_role = getattr(user, 'role', None)

        if not model_name or not user_role:
            return  # No model or user — skip

        # ADMIN bypasses field permissions
        if user_role == 'ADMIN':
            return

        from apps.perm.checker import _live_extra_roles

        rule_sets = [FieldPermission.get_field_rules(role, model_name) for role in [user_role, *_live_extra_roles(user)]]
        if not all(rule_sets):
            return  # Some role has no rules here — it sees and edits every field

        fields_to_remove = []
        for field_name, field in self.fields.items():
            outcomes = [_outcome(rules, field_name) for rules in rule_sets]
            if not any(visible for visible, _ in outcomes):
                fields_to_remove.append(field_name)
            elif all(locked for _, locked in outcomes):
                field.read_only = True

        # Remove invisible fields
        for field_name in fields_to_remove:
            del self.fields[field_name]


def _outcome(rules, field_name):
    """(visible, locked) for one role: the field's own rule, else the role's wildcard `*`, else open."""
    wildcard = rules.get('*', {})
    rule = rules.get(field_name, wildcard)
    visible = rule.get('visible', wildcard.get('visible', True))
    locked = rule.get('read_only', wildcard.get('read_only', False)) or not rule.get('editable', wildcard.get('editable', True))
    return visible, locked
