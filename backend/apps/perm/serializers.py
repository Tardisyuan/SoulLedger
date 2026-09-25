"""
Permission serializers
"""
from rest_framework import serializers

from .matrix import ACTIONS, RESULT_CODES, ROLE_DELETE_REFUSAL_CODES, STATUSES
from .models import Permission, Role, RolePermission


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "codename", "name", "category"]


class PermissionCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["codename", "name", "category"]

    def validate_codename(self, value):
        if not value.replace(".", "").replace("_", "").isalnum():
            raise serializers.ValidationError(
                "codename must contain only letters, digits, dots, and underscores"
            )
        return value


class RolePermissionSerializer(serializers.ModelSerializer):
    permission = PermissionSerializer(read_only=True)

    class Meta:
        model = RolePermission
        fields = ["id", "role", "permission"]


class RolePermissionAssignSerializer(serializers.Serializer):
    role = serializers.CharField(max_length=20)
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=True
    )
    # Optional so existing callers keep working unchanged. When present,
    # assign_role_permissions rejects the call with 409 if it doesn't match
    # the role's current `version` — the Stage 7 permissions-matrix screen's
    # stale-write guard: two admins editing the same role's grants at once,
    # and the replace-not-diff semantics of this endpoint mean the second
    # save silently reverts the first rather than conflicting visibly.
    expected_version = serializers.IntegerField(required=False)


class RoleSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source='organization.name', read_only=True)
    # How many users this role's name is currently assigned to
    # (User.role is a plain CharField, not a FK to Role — no join needed).
    # Exists for the Stage 7 permissions-matrix screen's save-confirmation
    # guard: "N users are affected" is what turns a grant/removal from an
    # abstract diff into a consequence worth reading before confirming.
    user_count = serializers.SerializerMethodField()
    # The role table's three columns. `member_count` differs from `user_count`
    # on purpose: it counts every non-deleted holder, active or not — the
    # number `update_delete_role` refuses a delete over — while `user_count`
    # stays what the matrix's "N users affected" guard has always shown.
    member_count = serializers.SerializerMethodField()
    # RolePermission rows, i.e. the ticks the matrix shows for this role. Not
    # the effective set: ADMIN is allowed everything by the checker's
    # short-circuit whatever this says.
    permission_count = serializers.SerializerMethodField()
    # Templates whose stored steps designate this role (approver_type ROLE).
    # See apps/perm/matrix.py::role_template_references.
    workflow_template_count = serializers.SerializerMethodField()
    # True for the five `UserRole` constants: the server refuses to bin them.
    is_builtin = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id", "name", "display_name", "description", "scope", "organization", "organization_name",
            "user_count", "member_count", "permission_count", "workflow_template_count",
            "is_builtin", "version", "update_time",
        ]
        read_only_fields = ["version", "update_time"]

    def get_is_builtin(self, obj) -> bool:
        return obj.is_builtin

    # The three counts below read a value `list_roles` annotated or put in the
    # context when there is one, so the list is not three queries per row.
    def get_member_count(self, obj) -> int:
        annotated = getattr(obj, "member_count_annotated", None)
        if annotated is not None:
            return annotated
        from apps.authentication.models import User
        return User.objects.filter(role=obj.name).count()

    def get_permission_count(self, obj) -> int:
        annotated = getattr(obj, "permission_count_annotated", None)
        if annotated is not None:
            return annotated
        return RolePermission.objects.filter(role=obj).count()

    def get_workflow_template_count(self, obj) -> int:
        refs = self.context.get("template_refs")
        if refs is None:
            from .matrix import role_template_references
            refs = role_template_references()
        return len(refs.get(obj.name, []))

    # `-> int` is load-bearing for the document, not decoration. This method
    # was invisible to drf-spectacular for as long as `list_roles` was an
    # unintrospectable view: the moment the view got a declared response, the
    # generator reached this field and typed a count as `string`. It is the
    # 20th SerializerMethodField in that state — the other 19 were found in
    # 0779d6b, and this one was hiding behind the error channel.
    def get_user_count(self, obj) -> int:
        from apps.authentication.models import User
        return User.objects.filter(role=obj.name, is_active=True).count()


class RoleCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["name", "display_name", "description", "scope", "organization"]

    def validate_name(self, value):
        # Only allow uppercase letters and underscores
        if not value.replace("_", "").isalpha():
            raise serializers.ValidationError(
                "Role name must contain only letters and underscores"
            )
        value = value.upper()
        # The role code is fixed once the row exists — built-in or not. Sending
        # the current name back is fine (the edit form does); a different one
        # is refused here, before the view is reached.
        if self.instance is not None and value != self.instance.name:
            raise serializers.ValidationError(
                "A role's code cannot be changed after creation; "
                "use 'copy as new role' to get the same grants under another code.",
                code="immutable",
            )
        return value


# ── Matrix save / impact ────────────────────────────────────────────────


class MatrixChangeSerializer(serializers.Serializer):
    role = serializers.CharField(max_length=20)
    permission_id = serializers.IntegerField()
    action = serializers.ChoiceField(choices=ACTIONS)


class MatrixChangesRequestSerializer(serializers.Serializer):
    """Body of `role-permissions/changes/` and `role-permissions/impact/`."""

    changes = MatrixChangeSerializer(many=True, allow_empty=False, max_length=2000)
    # {role name: version the client loaded}. A role named here whose version
    # moved has all its cells refused `version_conflict`; roles not named are
    # not checked, as with `assign`'s optional `expected_version`.
    expected_versions = serializers.DictField(child=serializers.IntegerField(), required=False)
    # `changes/` only: without it, a revoke the impact analysis names as a
    # conflict's cause is refused `conflict_unacknowledged`. `impact/` ignores it.
    acknowledge_conflicts = serializers.BooleanField(required=False, default=False)

    def validate_changes(self, value):
        seen = set()
        for change in value:
            cell = (change["role"], change["permission_id"])
            if cell in seen:
                raise serializers.ValidationError(
                    f"Cell {cell[0]}/{cell[1]} appears more than once; send one change per cell."
                )
            seen.add(cell)
        return value


class MatrixChangeResultSerializer(serializers.Serializer):
    index = serializers.IntegerField(help_text="Position of the change in the request.")
    role = serializers.CharField()
    permission_id = serializers.IntegerField()
    codename = serializers.CharField(allow_null=True)
    action = serializers.ChoiceField(choices=ACTIONS)
    status = serializers.ChoiceField(choices=STATUSES)
    code = serializers.ChoiceField(choices=RESULT_CODES, allow_null=True)
    detail = serializers.CharField(allow_null=True)


class MatrixChangesResultSerializer(serializers.Serializer):
    saved = serializers.IntegerField()
    unchanged = serializers.IntegerField()
    refused = serializers.IntegerField()
    failed = serializers.IntegerField()
    results = MatrixChangeResultSerializer(many=True)
    # Every role the request named that exists: its version after the call —
    # the value to send as `expected_versions[role]` next time.
    versions = serializers.DictField(child=serializers.IntegerField())


class WorkflowStepRefSerializer(serializers.Serializer):
    step_order = serializers.IntegerField()
    step_name = serializers.CharField()


class TemplateRefFieldsSerializer(serializers.Serializer):
    template_id = serializers.UUIDField()
    template_name = serializers.CharField()
    tenant_id = serializers.IntegerField(allow_null=True)
    civilization = serializers.CharField()
    is_active = serializers.BooleanField()


class RoleTemplateReferenceSerializer(TemplateRefFieldsSerializer):
    steps = WorkflowStepRefSerializer(many=True)


class MatrixConflictCauseSerializer(serializers.Serializer):
    index = serializers.IntegerField()
    role = serializers.CharField()
    permission_id = serializers.IntegerField()
    codename = serializers.CharField()


class MatrixConflictSerializer(TemplateRefFieldsSerializer):
    step_order = serializers.IntegerField()
    step_name = serializers.CharField()
    approver_roles = serializers.ListField(child=serializers.CharField())
    caused_by = MatrixConflictCauseSerializer(many=True)


class MatrixWorkflowConflictSerializer(serializers.Serializer):
    """A live workflow's pending ROLE node that would lose every approver."""

    workflow_id = serializers.UUIDField()
    workflow_name = serializers.CharField()
    tenant_id = serializers.IntegerField(allow_null=True)
    status = serializers.CharField()
    node_order = serializers.IntegerField()
    node_name = serializers.CharField()
    approver_roles = serializers.ListField(child=serializers.CharField())
    caused_by = MatrixConflictCauseSerializer(many=True)


class MatrixImpactResultSerializer(serializers.Serializer):
    # The codenames `approve_node` requires — the only grants whose revocation
    # can leave a step without an approver.
    required_codenames = serializers.ListField(child=serializers.CharField())
    conflicts = MatrixConflictSerializer(many=True)
    workflow_conflicts = MatrixWorkflowConflictSerializer(many=True)


class RoleDeleteRefusalSerializer(serializers.Serializer):
    """400 body of `DELETE /perm/roles/<pk>/`. `user_count` comes with
    `role_in_use`, `templates` with `role_referenced_by_workflow_templates`."""

    error = serializers.CharField()
    code = serializers.ChoiceField(choices=ROLE_DELETE_REFUSAL_CODES)
    user_count = serializers.IntegerField(required=False)
    templates = RoleTemplateReferenceSerializer(many=True, required=False)


# ── Doc-only response shapes ─────────────────────────────────────────────
#
# Everything below describes a dict a view in apps/perm/views.py builds by
# hand. None of it is instantiated at runtime; see apps/core/schema.py for why
# these exist at all and what that costs.


class RolePermissionsSerializer(serializers.Serializer):
    """`get_role_permissions` and `get_permissions_for_role`.

    One shape for both, because the views say so in their own docstring
    ("响应结构与 get_role_permissions 一致") and both build it from the same
    three expressions. `permissions` is the codename list resolved through
    `check_permission`; `details` is the subset of those codenames that has a
    Permission row — a codename living only in the DEFAULT_PERMISSIONS dict
    appears in `permissions` and NOT in `details`, so the two lists are not
    guaranteed to be the same length.
    """

    role = serializers.CharField()
    permissions = serializers.ListField(child=serializers.CharField())
    details = PermissionSerializer(many=True)


class RolePermissionAssignResultSerializer(serializers.Serializer):
    """200 body of `assign_role_permissions`.

    `permission_ids` is the *validated* set — the ids that matched a
    Permission row — and `version` is the value AFTER `role.save()` bumped it,
    i.e. the one to send as `expected_version` next time, not the one just
    checked against.
    """

    role = serializers.CharField()
    assigned_count = serializers.IntegerField()
    permission_ids = serializers.ListField(child=serializers.IntegerField())
    version = serializers.IntegerField()


class RoleVersionConflictSerializer(serializers.Serializer):
    """409 body of `assign_role_permissions` — a stale-write rejection.

    Distinct from `ErrorResponseSerializer` because the two extra members are
    the entire point: a client that only reads `error` cannot show the
    operator what moved underneath it.
    """

    error = serializers.CharField()
    expected_version = serializers.IntegerField()
    current_version = serializers.IntegerField()


class InitRolesResultSerializer(serializers.Serializer):
    """200 body of `init_roles`. `total` is every Role row, not the count created."""

    message = serializers.CharField()
    total = serializers.IntegerField()


class InitRolePermissionsResultSerializer(serializers.Serializer):
    """200 body of `init_role_permissions`.

    `roles` maps a role name to a human sentence — "Assigned 7 permissions" or
    "Role not found". It is a per-role status string and not a count; the view
    builds it that way and a client cannot parse a number out of it safely.
    """

    message = serializers.CharField()
    permissions_added = serializers.IntegerField()
    permissions_total = serializers.IntegerField()
    roles = serializers.DictField(child=serializers.CharField())


# ── Export / import payload ──────────────────────────────────────────────


class ExportedPermissionSerializer(serializers.Serializer):
    codename = serializers.CharField()
    name = serializers.CharField()
    category = serializers.CharField()


class ExportedRoleSerializer(serializers.Serializer):
    name = serializers.CharField()
    display_name = serializers.CharField()
    scope = serializers.CharField(required=False)


class ExportedRolePermissionSerializer(serializers.Serializer):
    # Flattened by export_permissions: role__name → role,
    # permission__codename → permission. Names, not ids — an import into a
    # different database has different ids.
    role = serializers.CharField()
    permission = serializers.CharField()
    # Optional members below mirror the `.get(key, default)` reads in
    # `import_permissions` exactly: this serializer now VALIDATES the import
    # body (it used to be documentation only), so anything it marks required
    # is a 400 for a hand-written document the importer would have accepted.
    conditions = serializers.JSONField(required=False)


class ExportedFieldPermissionSerializer(serializers.Serializer):
    role = serializers.CharField()
    model_name = serializers.CharField()
    field_name = serializers.CharField()
    visible = serializers.BooleanField(required=False)
    read_only = serializers.BooleanField(required=False)
    editable = serializers.BooleanField(required=False)


class ExportedDataScopeSerializer(serializers.Serializer):
    role = serializers.CharField()
    civilization = serializers.CharField(allow_null=True, required=False)
    model_name = serializers.CharField()
    filter_conditions = serializers.JSONField(required=False)
    scope_type = serializers.CharField()
    priority = serializers.IntegerField(required=False)
    is_active = serializers.BooleanField(required=False)


class StrictBooleanField(serializers.BooleanField):
    """A JSON boolean and nothing else.

    DRF's BooleanField reads "false", "0", "no" as False — which is friendlier
    than the bug it replaces, but `overwrite` deletes every grant in the
    database, and a client that sends a string here has already misread the
    contract once. Refuse rather than guess.
    """

    def to_internal_value(self, data):
        if isinstance(data, bool):
            return data
        raise serializers.ValidationError("Must be a JSON boolean (true or false).")


class PermissionExportSerializer(serializers.Serializer):
    """Body of GET /perm/export/ — served as a JSON file attachment.

    `version` is the export format's version string ("1.0"), unrelated to
    `Role.version`, which is the optimistic-lock counter.
    """

    version = serializers.CharField()
    permissions = ExportedPermissionSerializer(many=True)
    roles = ExportedRoleSerializer(many=True)
    role_permissions = ExportedRolePermissionSerializer(many=True)
    field_permissions = ExportedFieldPermissionSerializer(many=True)
    data_scopes = ExportedDataScopeSerializer(many=True)


class PermissionImportRequestSerializer(serializers.Serializer):
    """Body of POST /perm/import/ — an export document, plus `overwrite`.

    Every member is optional because `import_permissions` reads each one with
    `data.get(key, [])`: a document carrying only `roles` imports only roles.
    The view's own check is `if not data` — an empty body, nothing narrower.

    This is the serializer the view VALIDATES WITH, not just what it documents.
    Until 2026-09-12 it was never instantiated: `overwrite` came straight off
    `request.data`, so the string "false" was truthy and cleared every
    RolePermission with a 200, and a permission entry missing `name` was a
    KeyError 500 raised after the overwrite deletes had already run. See
    tests/test_perm_import_is_validated.py.
    """

    version = serializers.CharField(required=False)
    permissions = ExportedPermissionSerializer(many=True, required=False)
    roles = ExportedRoleSerializer(many=True, required=False)
    role_permissions = ExportedRolePermissionSerializer(many=True, required=False)
    field_permissions = ExportedFieldPermissionSerializer(many=True, required=False)
    data_scopes = ExportedDataScopeSerializer(many=True, required=False)
    # Deletes FieldPermission / RowLevelDataScope / RolePermission wholesale
    # before importing. Read off the same body as the document itself.
    overwrite = StrictBooleanField(required=False, default=False)


class PermissionImportStatsSerializer(serializers.Serializer):
    """Rows CREATED per table — `get_or_create` misses are not counted."""

    permissions = serializers.IntegerField()
    roles = serializers.IntegerField()
    role_permissions = serializers.IntegerField()
    field_permissions = serializers.IntegerField()
    data_scopes = serializers.IntegerField()


class PermissionImportResultSerializer(serializers.Serializer):
    message = serializers.CharField()
    stats = PermissionImportStatsSerializer()
