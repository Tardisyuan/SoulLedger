"""
REST serializers for Events app (audit log).
"""
import re

from rest_framework import serializers

from apps.events.models import SoulEvent

_ACTOR_RE = re.compile(r"^(.+) \(([^()]+)\)$")


def actor_username(actor: str) -> str:
    """`actor` is `User.__str__` ("alice (JUDGE)") or a bare username/"system"."""
    m = _ACTOR_RE.match(actor or "")
    return m.group(1) if m else (actor or "")


class SoulEventSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    # Read-only display of the free-text `actor`; resolved from `context["actor_users"]`
    # ({username: (display_name, role)}, one query per page, see the view).
    actor_display_name = serializers.SerializerMethodField()
    actor_role = serializers.SerializerMethodField()

    def _actor_user(self, obj):
        return self.context.get("actor_users", {}).get(actor_username(obj.actor))

    def get_actor_display_name(self, obj) -> str:
        u = self._actor_user(obj)
        return (u[0] if u else "") or ""

    def get_actor_role(self, obj) -> str:
        u = self._actor_user(obj)
        return u[1] if u else ""

    class Meta:
        model = SoulEvent
        fields = ["id", "soul", "soul_name", "event_type", "payload", "actor", "actor_display_name", "actor_role", "create_time"]
