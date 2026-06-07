"""
Organization serializers.
"""
from rest_framework import serializers

from apps.org.models import Organization


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "code", "category", "parent", "tenant"]
