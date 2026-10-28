"""
REST views for Reincarnation app.
"""
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.reincarnation.models import Reincarnation
from apps.reincarnation.serializers import (
    DrinkSoupResultSerializer,
    DrinkSoupSerializer,
    RebirthQuotaUsageSerializer,
    RebirthRequestSerializer,
    ReincarnationSerializer,
)


def _state_conflict(soul, target_state):
    """409 for a transition Soul.can_transition_to refuses.

    409 rather than 400: the request is well formed and the soul exists, it is
    the soul's *current state* that the operation conflicts with — the same
    reasoning RebirthNotApplicable documents. The two stay tellable apart by
    their bodies rather than their status: this one names the states, and
    RebirthNotApplicable names the civilization and says there is no next life.
    That distinction only survives because the cosmology is asked *first* at
    the call site below; asked second, every terminal soul would come back
    as a generic state-machine refusal instead of the specific fact.

    Keeps the {"error", "message"} shape the rest of this viewset already
    returns, which is also what the frontend's toast handler reads.
    """
    return Response(
        {
            "error": "INVALID_STATE_TRANSITION",
            "message": (
                f"Cannot move soul from {soul.current_state} to {target_state}."
            ),
            "current_state": soul.current_state,
            "target_state": str(target_state),
        },
        status=status.HTTP_409_CONFLICT,
    )


# READ-ONLY (2026-10-27, review business #8). A Reincarnation row is produced only by
# ReincarnationService.complete_rebirth — via `reborn` here, or the sentence plan / disposition paths
# that call it. The CRUD writes and the `{id}/complete/` action are gone:
#   * `POST /reincarnation/` wrote a row by hand. The row moves `Soul.life_index` (= the count of these
#     rows), so the soul's own deeds vanished from `current_life_records()` at once, and the row took a
#     place in this month's quota (quota_usage counts this table) — with no rebirth behind it.
#   * `complete` took an existing row and called complete_rebirth, which always *creates* a row, so every
#     rebirth through it wrote two and moved life_index by 2. Updating the row in place instead is not
#     well defined: there is no "pending" status, and once rows are written only by complete_rebirth every
#     row already *is* a completed rebirth — "complete it" could only mean overwriting a past life.
# So the one way to rebirth a soul over HTTP is `reborn`. `reincarnation.complete` stays seeded (removing
# a codename is a grant migration) but no route asks for it any more.
class ReincarnationViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ReadOnlyModelViewSet):
    queryset = Reincarnation.objects.select_related("soul", "disposition", "tenant").all()
    serializer_class = ReincarnationSerializer
    permission_classes = [TenantPermission, CodenamePermission]
    # read / manage plus the named actions. `reborn` is ADMIN and MODERATOR only; `drink_soup` is any
    # holder of reincarnation.manage.
    permission_codename = "reincarnation"
    extra_permissions = {
        'reborn': ['reincarnation.reborn'],
        'quota': ['reincarnation.read'],
        'drink_soup': ['reincarnation.manage'],
    }
    filterset_fields = ["soul", "rebirth_form", "cycle_count"]
    ordering_fields = ["reincarnated_at", "cycle_count"]

    @extend_schema(request=DrinkSoupSerializer, responses={200: DrinkSoupResultSerializer})
    @action(detail=False, methods=["post"], url_path="drink-soup")
    def drink_soup(self, request):
        """POST /reincarnation/drink-soup/ {soul_id} — 记下这一世已饮孟婆汤(地府,候转世的灵魂;2026-10-25)。
        地府的灵魂没饮过,`reborn` 答 409 `soup_not_taken`。别的殿的灵魂答 404。"""
        from apps.core.tenant import scope_to_tenant
        from apps.reincarnation.services import drink_soup
        from apps.souls.models import Soul

        body = DrinkSoupSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        soul = scope_to_tenant(Soul.objects.all(), request).filter(pk=body.validated_data["soul_id"]).first()
        if soul is None:
            return Response({"error": "NOT_FOUND", "message": "Soul not found"}, status=status.HTTP_404_NOT_FOUND)
        soul = drink_soup(soul)
        return Response({"soul_id": str(soul.pk), "soup_taken_at": soul.soup_taken_at})

    @extend_schema(responses=RebirthQuotaUsageSerializer(many=True))
    @action(detail=False, methods=["get"])
    def quota(self, request):
        """This hall's rebirth quota for the current month, per path: `limit` null = unlimited (2026-10-24)."""
        from apps.reincarnation.services import quota_usage

        tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
        if tenant is None:
            return Response([])
        return Response([{"rebirth_form": form, **row} for form, row in quota_usage(tenant).items()])

    @action(detail=False, methods=["post"])
    def reborn(self, request):
        """
        Create a new reincarnation for a soul and immediately complete it.
        POST /reincarnation/reborn/
        Body: { "soul_id": "...", "disposition_id": "...", "new_identity": "...", "rebirth_form": "HUMAN",
                "rebirth_form_reason": "..." }
        `rebirth_form` 省略 = 灵魂已批准申请里的意愿(没有申请时地府为人道);与意愿不同须写 `rebirth_form_reason`。
        """
        from apps.disposition.models import Disposition
        from apps.ledger.services import LedgerService
        from apps.reincarnation.services import (
            ReincarnationService,
            assert_continent_applies,
            assert_may_be_reborn,
            resolve_rebirth_form,
        )
        from apps.souls.models import Soul, SoulState

        # Body first, before the soul and disposition lookups: a malformed
        # rebirth_form is a 400 whether or not the referenced soul exists, and
        # validating here guarantees no write can precede the refusal. See
        # RebirthRequestSerializer for what was reaching the column before.
        # soul_id/disposition_id stay resolved by hand below — they answer 404
        # with this viewset's {"error", "message"} shape and are tenant-scoped,
        # neither of which a PrimaryKeyRelatedField would reproduce.
        payload = RebirthRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        soul_id = request.data.get("soul_id")
        disposition_id = request.data.get("disposition_id")
        new_identity = payload.validated_data.get("new_identity", "")
        rebirth_form = payload.validated_data.get("rebirth_form")
        rebirth_continent = payload.validated_data.get("rebirth_continent", "")

        # Tenant-isolated: filter soul by tenant (ADMIN bypasses)
        user_tenant = getattr(request, "tenant", None)
        soul_qs = Soul.objects.all()
        if getattr(request.user, 'role', None) != 'ADMIN' and user_tenant:
            soul_qs = soul_qs.filter(tenant=user_tenant)

        try:
            soul = soul_qs.get(id=soul_id)
        except Soul.DoesNotExist:
            return Response(
                {"error": "NOT_FOUND", "message": "Soul not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        disposition = None
        if disposition_id:
            # 只认这个灵魂自己的处置:别人的处置会把别人的去向与清记忆写到这个灵魂身上(2026-10-27)。
            disp_qs = Disposition.objects.filter(soul=soul)
            if getattr(request.user, 'role', None) != 'ADMIN' and user_tenant:
                disp_qs = disp_qs.filter(tenant=user_tenant)
            try:
                disposition = disp_qs.get(id=disposition_id)
            except Disposition.DoesNotExist:
                return Response(
                    {"error": "NOT_FOUND", "message": "Disposition not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # The cosmology first, so a terminal soul gets the specific 409 and no
        # write: asked after the move to REINCARNATING, that move would already
        # be written, and REINCARNATING's only exit is a rebirth this cosmology
        # refuses forever. Then the state machine instead of a direct
        # assignment. This branch used to force DISPOSED → REINCARNATING and
        # answer 400 for everything else; the 400 becomes a 409 because the
        # request was never malformed, only in conflict with the soul's state.
        LedgerService.assert_rebirth_capable(soul)
        assert_may_be_reborn(soul, disposition)
        # 希腊灵魂指定了六道、改了灵魂所愿却没写原因:400,在动状态之前。没指定就按灵魂已批准的申请(2026-10-29)。
        rebirth_form_reason = payload.validated_data.get("rebirth_form_reason", "")
        chosen_form, _, _ = resolve_rebirth_form(soul, rebirth_form, rebirth_form_reason)
        assert_continent_applies(soul, chosen_form, rebirth_continent)  # 同上:部洲只在人道

        if soul.current_state != SoulState.REINCARNATING:
            moved = soul.transition_to(
                SoulState.REINCARNATING, "Rebirth requested via /reincarnation/reborn/"
            )
            if not moved:
                return _state_conflict(soul, SoulState.REINCARNATING)

        reincarnation = ReincarnationService.complete_rebirth(
            soul=soul,
            disposition=disposition,
            new_identity=new_identity,
            rebirth_form=rebirth_form,
            rebirth_continent=rebirth_continent,
            rebirth_form_reason=rebirth_form_reason,
        )

        return Response(ReincarnationSerializer(reincarnation).data, status=status.HTTP_201_CREATED)
