"""
REST views for Actors app.
"""
from django.db.models import F, IntegerField
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast
from rest_framework import viewsets

from apps.actors.filters import ActorFilter
from apps.actors.models import Actor
from apps.actors.serializers import ActorListSerializer, ActorLocalizedSerializer, ActorSerializer
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin


class ActorViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    Read-only actor listing and detail.
    Use '?localized=true' query param to get display_name resolved by Accept-Language.
    """
    # Declared `actors` and enforced nothing. Latent rather than leaking today
    # -- every role holds `actors.read` -- but "the codename happens to be
    # universal" is not a permission check. See apps/audit/views.py for the
    # sibling that was leaking.
    permission_classes = [TenantPermission, CodenamePermission]
    # Plural, matching the seeded `actors.read` in DEFAULT_PERMISSIONS — same
    # singular/plural mismatch as realms had. Renaming the view is free;
    # renaming the Permission rows would need another data migration.
    # Read-only viewset: `actors.read` is the whole family, no write codename.
    permission_codename = "actors"
    queryset = Actor.objects.filter(is_active=True)
    filterset_class = ActorFilter
    search_fields = ActorFilter.search_fields
    ordering_fields = ActorFilter.ordering_fields

    def get_queryset(self):
        """Default ordering, with the bench of 42 in the order the text seats them.

        WHY HERE AND NOT `Actor.Meta.ordering`. The model default is
        ["civilization", "role", "name"], which sorts the assessors
        alphabetically — Aati is 17th in the Papyrus of Nebseni and 1st in the
        alphabet, so the wrong order looks entirely plausible. The fix belongs
        at the API boundary rather than on the model for three reasons:

        1. `Meta.ordering` is global. Every `Actor.objects...` in the codebase
           inherits it — admin lists, the judgment and workflow lookups, the
           seeder's own comparisons — and each would start paying a JSON key
           extraction and a cast on every row, including the ~99% of actors
           that hold no seat.
        2. Ordering on a JSON key is a display concern of this list. The
           canonical seat lives in `powers_json`, which is not a column and
           carries no index; making the model's default depend on it couples
           every query to a payload shape the model does not otherwise know.
        3. The blast radius of getting it wrong is one endpoint instead of the
           whole ORM surface.

        Non-assessors sort first (`nulls_first`) so Osiris and Anubis still
        head the Egyptian JUDGE block rather than trailing 42 minor gods. An
        explicit `?ordering=` still wins: OrderingFilter runs after this and
        replaces the clause.
        """
        return super().get_queryset().annotate(
            assessor_seat=Cast(
                KeyTextTransform("assessor_index", "powers_json"), IntegerField()
            )
        ).order_by(
            "civilization", "role", F("assessor_seat").asc(nulls_first=True), "name"
        )

    def get_serializer_class(self):
        if self.request.query_params.get("localized"):
            return ActorLocalizedSerializer
        if self.action == "list":
            return ActorListSerializer
        return ActorSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context
