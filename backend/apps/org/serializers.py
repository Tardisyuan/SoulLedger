"""
Organization serializers.
"""
from rest_framework import serializers

from apps.core.tenant_fields import tenant_scoped
from apps.org.models import Organization


class OrganizationSerializer(serializers.ModelSerializer):
    # Read-only: TenantCreateMixin stamps this from the request on create, the
    # same pattern SoulSerializer uses. Not client-settable — accepting it as
    # input would let a write bypass TenantQuerySetMixin's scoping by pointing
    # an org at a tenant other than the caller's own.
    tenant = serializers.PrimaryKeyRelatedField(read_only=True)

    # `tenant` being read-only closes one door and leaves the next one open:
    # `parent` is still a plain related field resolved against a manager that
    # does not scope, so `org.manage` (ADMIN/MODERATOR) could hang this tenant's
    # org under another tenant's node. See apps/core/tenant_fields.py.
    validate_parent = tenant_scoped("parent")

    class Meta:
        model = Organization
        fields = ["id", "name", "code", "category", "parent", "level", "sort", "tenant"]
