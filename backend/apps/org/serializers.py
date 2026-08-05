"""
Organization serializers.
"""
from rest_framework import serializers

from apps.org.models import Organization


class OrganizationSerializer(serializers.ModelSerializer):
    # Read-only: TenantCreateMixin stamps this from the request on create, the
    # same pattern SoulSerializer uses. Not client-settable — accepting it as
    # input would let a write bypass TenantQuerySetMixin's scoping by pointing
    # an org at a tenant other than the caller's own.
    tenant = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Organization
        fields = ["id", "name", "code", "category", "parent", "level", "sort", "tenant"]
