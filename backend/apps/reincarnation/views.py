"""
REST views for Reincarnation app.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import CodenameViewSetMixin, DataScopeViewSetMixin
from apps.reincarnation.models import Reincarnation
from apps.reincarnation.serializers import ReincarnationSerializer


def _state_conflict(soul, target_state):
    """409 for a transition Soul.can_transition_to refuses.

    409 rather than 400: the request is well formed and the soul exists, it is
    the soul's *current state* that the operation conflicts with — the same
    reasoning RebirthNotApplicable documents. The two stay tellable apart by
    their bodies rather than their status: this one names the states, and
    RebirthNotApplicable names the civilization and says there is no next life.
    That distinction only survives because the cosmology is asked *first* at
    both call sites below; asked second, every terminal soul would come back
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


class ReincarnationViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, viewsets.ModelViewSet):
    queryset = Reincarnation.objects.select_related("soul", "disposition", "tenant").all()
    serializer_class = ReincarnationSerializer
    # CodenamePermission is what finally enforces the codenames below; before
    # it, PermissionMiddleware never saw self.action and they gated nothing.
    #
    # Nine codes move here, all on the two named actions. reincarnation.manage
    # is held by ADMIN, MODERATOR, JUDGE and GUARDIAN, so create/partial_update/
    # destroy lose only VIEWER — three codes. reincarnation.complete and
    # .reborn are held by ADMIN and MODERATOR alone, so JUDGE, GUARDIAN and
    # VIEWER lose both — six more. That split is the declared policy and the
    # reason this app was worth enforcing: `complete` and `reborn` walk a soul
    # DISPOSED -> REINCARNATING -> ALIVE, rewrite its name, and reset its
    # merit/demerit from the ledger. Editing the record of a rebirth and
    # performing one are separated on purpose, and until now they were not.
    #
    # CHECKED AND ABSENT: this viewset has the precondition for the bypass
    # tranche 2 found — a narrow codename on a custom action while a strictly
    # WIDER one covers the CRUD route — and the bypass does not exist anyway.
    # Everything complete/reborn do to the soul lives in
    # ReincarnationService.complete_rebirth, and Reincarnation has no signals
    # and no save() override, so the CRUD route reaches none of it. Driven and
    # asserted, not inferred: the soul is untouched after a successful PATCH.
    # The pattern needs the same FIELDS reachable, not merely the same app.
    #
    # Separately, and NOT the same finding: ReincarnationSerializer declares no
    # read_only_fields, so cycle_count (which complete_rebirth derives) and the
    # `soul` FK itself are writable under reincarnation.manage. That is record
    # integrity, not authorization — do not "fix" it by narrowing a codename.
    # Both are characterized in
    # backend/tests/test_perm_write_snapshot_outside_matrix.py.
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY: read / manage, plus the two named actions. The dict spells the
    # pair out — reincarnation.read and reincarnation.manage — with no
    # create/update/delete family, so the CRUD codenames the mixin was
    # generating (reincarnation.create/.update/.delete) existed nowhere and
    # were held by nobody. They map to reincarnation.manage, which is exactly
    # what "manage" was defined to cover and is already granted to every role
    # that holds read except VIEWER.
    permission_codename = "reincarnation"
    extra_permissions = {
        'complete': ['reincarnation.complete'],
        'reborn': ['reincarnation.reborn'],
        'create': ['reincarnation.manage'],
        'update': ['reincarnation.manage'],
        'partial_update': ['reincarnation.manage'],
        'destroy': ['reincarnation.manage'],
    }
    filterset_fields = ["soul", "rebirth_form", "cycle_count"]
    ordering_fields = ["reincarnated_at", "cycle_count"]

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """
        Complete a reincarnation — create rebirth record, reset soul to ALIVE.
        POST /reincarnation/{id}/complete/
        Body: { "new_identity": "...", "rebirth_form": "HUMAN", "notes": "..." }
        """
        reincarnation = self.get_object()
        soul = reincarnation.soul

        from apps.ledger.services import LedgerService
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import SoulState
        disposition = reincarnation.disposition

        new_identity = request.data.get("new_identity", reincarnation.new_identity)
        rebirth_form = request.data.get("rebirth_form", reincarnation.rebirth_form)
        notes = request.data.get("notes", "")

        # Ask the cosmology before touching the soul's state, not after.
        #
        # complete_rebirth asks too, but by then the move to REINCARNATING has
        # already been written, and REINCARNATING's only exit is a rebirth this
        # cosmology refuses forever — so an Egyptian or European soul that was
        # merely DISPOSED came out of this endpoint stranded in a state
        # describing someone else's afterlife, which is the exact outcome
        # SoulState.SETTLED exists to prevent. (A soul whose disposition was
        # actually executed is already SETTLED and never reached this branch;
        # this is the not-yet-executed path.) Raising here answers 409
        # REBIRTH_NOT_APPLICABLE and leaves the soul where it was.
        LedgerService.assert_rebirth_capable(soul)

        # Ask the state machine for the move rather than assigning it.
        # DISPOSED → REINCARNATING is legal and goes through as before; every
        # other starting state is now refused instead of being written, and
        # SETTLED and LOST are absorbing precisely so that nothing can walk a
        # closed case back open.
        if soul.current_state != SoulState.REINCARNATING:
            moved = soul.transition_to(
                SoulState.REINCARNATING,
                f"Rebirth requested via reincarnation {reincarnation.id}",
            )
            if not moved:
                return _state_conflict(soul, SoulState.REINCARNATING)

        ReincarnationService.complete_rebirth(
            soul=soul,
            disposition=disposition,
            new_identity=new_identity,
            rebirth_form=rebirth_form,
            notes=notes,
        )

        # Refresh reincarnation record
        reincarnation.refresh_from_db()
        return Response(ReincarnationSerializer(reincarnation).data)

    @action(detail=False, methods=["post"])
    def reborn(self, request):
        """
        Create a new reincarnation for a soul and immediately complete it.
        POST /reincarnation/reborn/
        Body: { "soul_id": "...", "disposition_id": "...", "new_identity": "...", "rebirth_form": "HUMAN" }
        """
        from apps.disposition.models import Disposition
        from apps.ledger.services import LedgerService
        from apps.reincarnation.services import ReincarnationService
        from apps.souls.models import Soul, SoulState

        soul_id = request.data.get("soul_id")
        disposition_id = request.data.get("disposition_id")
        new_identity = request.data.get("new_identity", "")
        rebirth_form = request.data.get("rebirth_form", "HUMAN")

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
            disp_qs = Disposition.objects.all()
            if getattr(request.user, 'role', None) != 'ADMIN' and user_tenant:
                disp_qs = disp_qs.filter(tenant=user_tenant)
            try:
                disposition = disp_qs.get(id=disposition_id)
            except Disposition.DoesNotExist:
                return Response(
                    {"error": "NOT_FOUND", "message": "Disposition not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # Same two gates as `complete`, in the same order and for the same
        # reasons: the cosmology first so a terminal soul gets the specific
        # 409 and no write, then the state machine instead of a direct
        # assignment. This branch used to force DISPOSED → REINCARNATING and
        # answer 400 for everything else; the 400 becomes a 409 because the
        # request was never malformed, only in conflict with the soul's state.
        LedgerService.assert_rebirth_capable(soul)

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
        )

        return Response(ReincarnationSerializer(reincarnation).data, status=status.HTTP_201_CREATED)
