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

    #: Fields a hiding rule leaves in place because the serializer redacts them itself
    #: (`SoulSerializer.records`: rows kept, weights null — 用户 2026-11-11).
    field_permission_redacted = ()

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
        rule_sets = role_rule_sets(self._get_user(), self._get_field_permission_model_name())
        if rule_sets is None:
            return

        fields_to_remove = []
        for field_name, field in self.fields.items():
            outcomes = [_outcome(rules, field_name) for rules in rule_sets]
            if not any(visible for visible, _ in outcomes):
                if field_name not in self.field_permission_redacted:
                    fields_to_remove.append(field_name)
            elif all(locked for _, locked in outcomes):
                field.read_only = True

        # Remove invisible fields
        for field_name in fields_to_remove:
            del self.fields[field_name]


def role_rule_sets(user, model_name):
    """The FieldPermission rules of every role `user` holds for `model_name`, or None when nothing is narrowed.

    The primary role plus live extra roles (用户决定第 27 条:字段权限认兼任角色), combined like grants
    are — the most open role wins: a field is hidden only when every role hides it, read-only only when
    every role locks it, and a role with no rule for this model leaves every field as it is. ADMIN, an
    anonymous caller and a missing model name are never narrowed.
    """
    role = getattr(user, "role", None)
    if not model_name or not role or role == "ADMIN" or not getattr(user, "is_authenticated", False):
        return None

    from apps.perm.checker import live_extra_roles

    rule_sets = [FieldPermission.get_field_rules(r, model_name) for r in [role, *live_extra_roles(user)]]
    if not all(rule_sets):
        return None  # Some role has no rules here — it sees and edits every field
    return rule_sets


def hidden_fields(user, model_name, field_names) -> frozenset:
    """Which of `field_names` the FieldPermission rules hide from `user` — the one answer the detail
    serializers (through the mixin), the soul list, every CSV export and the ledger bodies (`souls/{id}/karma/`
    and friends) share (audit 2026-11-11 P-11: only the four detail serializers used to apply it).
    One query per role: compute once per response, not per row."""
    rule_sets = role_rule_sets(user, model_name)
    if rule_sets is None:
        return frozenset()
    return frozenset(n for n in field_names if not any(_outcome(rules, n)[0] for rules in rule_sets))


#: `withhold(..., blank=DROP)` removes the key instead of blanking it — what the serializers do.
DROP = object()


def withhold(row: dict, hidden, blank=None) -> dict:
    """`row` with every key in `hidden` set to `blank` (CSV: "" — the column stays, the cell is empty;
    JSON bodies: None) or removed (`DROP`). A copy when anything changes: callers pass cached bodies."""
    if not hidden or not hidden.intersection(row):
        return row
    if blank is DROP:
        return {k: v for k, v in row.items() if k not in hidden}
    return {k: (blank if k in hidden else v) for k, v in row.items()}


class SoulFieldRulesMixin:
    """For a serializer of a row that *quotes* its soul (a case's `soul_name`, a disposition's, a dispatch's, a
    sentence plan's): each key in `soul_field_keys` follows the **Soul** FieldPermission rule of the field it
    copies, and is absent when that rule hides it — the soul list's reading (用户 2026-11-11, P-11). Without this
    a rule hiding `Soul.name` was walked around by every queue that prints the name beside the case.
    Worked out once per serializer instance (a page reuses one child). Put it before `ModelSerializer`."""

    #: serializer key -> the Soul field it copies
    soul_field_keys: dict = {}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not hasattr(self, "_soul_hidden_keys"):
            request = self.context.get("request")
            hidden = hidden_fields(getattr(request, "user", None), "Soul", set(self.soul_field_keys.values()))
            self._soul_hidden_keys = frozenset(k for k, f in self.soul_field_keys.items() if f in hidden)
        return withhold(data, self._soul_hidden_keys, DROP)


def _outcome(rules, field_name):
    """(visible, locked) for one role: the field's own rule, else the role's wildcard `*`, else open."""
    wildcard = rules.get('*', {})
    rule = rules.get(field_name, wildcard)
    visible = rule.get('visible', wildcard.get('visible', True))
    locked = rule.get('read_only', wildcard.get('read_only', False)) or not rule.get('editable', wildcard.get('editable', True))
    return visible, locked
