"""
REST views for Judgment app.
"""
import uuid

from django_filters import rest_framework as filters
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment.models import Judgment
from apps.judgment.serializers import JudgmentConcludeSerializer, JudgmentSerializer
from apps.ledger.services import LedgerService
from apps.realms.models import Realm
from apps.realms.serializers import RealmLocalizedSerializer
from apps.reincarnation.serializers import ReincarnationSerializer
from apps.souls.models import SoulState
from apps.souls.serializers import SoulSerializer

#: Upper bound on how many ids a caller may ask us to skip in one request.
#: The skip set is session state the *client* holds (see `next_pending`), so
#: it arrives on every poll and would otherwise grow without limit into the
#: `NOT IN (...)` clause. 200 is well past any single sitting at a queue.
QUEUE_SKIP_LIMIT = 200


class JudgmentFilter(filters.FilterSet):
    """Custom filter for Judgment - handles verdict=null for pending judgments."""
    has_verdict = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull", exclude=True)
    verdict_null = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull")

    class Meta:
        model = Judgment
        fields = ["soul", "civilization", "verdict", "is_final"]


class JudgmentViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Judgment CRUD + conclude action.
    Tenant-isolated via TenantPermission.
    """
    # CodenamePermission is what finally enforces the codenames below. Until it
    # was added they were declarative only: PermissionMiddleware never saw
    # self.action, so any role reaching this viewset with a tenant could open a
    # judgment proceeding against a soul — and perform_create then walks that
    # soul ALIVE -> JUDGING, so the write landed on two tables. GUARDIAN and
    # VIEWER hold no judgment.* codename at all and are now refused both the
    # list and the create. See apps/core/permissions.py for why middleware
    # could not do this.
    permission_classes = [TenantPermission, CodenamePermission]
    # The judgment family is read / create / execute — those three exist and
    # are granted; there is no judgment.update or judgment.delete anywhere, yet
    # this is a ModelViewSet and the mixin was generating both.
    #
    # They map to judgment.execute. The choice between judgment.execute and
    # judgment.create is not a guess and cannot go wrong: both are held by
    # exactly {ADMIN, JUDGE, MODERATOR}, so no role's access differs between
    # them. execute is the closer fit — amending or withdrawing a filed
    # judgment is an act on the case, and conclude already maps here.
    permission_codename = "judgment"
    extra_permissions = {
        'conclude': ['judgment.execute'],
        # Reading the head of the triage queue is a read. It deliberately does
        # NOT require judgment.execute: an operator who may look at the queue
        # but not rule on it still gets the screen, and the verdict button is
        # then the thing they cannot use — CodenameViewSetMixin's default for
        # an unmapped action would have generated `judgment.next_pending`,
        # which no role holds and no migration seeds, so the queue would have
        # 403'd for everyone including ADMIN.
        'next_pending': ['judgment.read'],
        'update': ['judgment.execute'],
        'partial_update': ['judgment.execute'],
        'destroy': ['judgment.execute'],
        'archive': ['judgment.execute'],
    }
    queryset = Judgment.objects.select_related("soul", "soul__tenant", "tenant").all()
    serializer_class = JudgmentSerializer
    filterset_class = JudgmentFilter
    ordering_fields = ["created_at", "concluded_at"]

    def perform_create(self, serializer):
        judgment = serializer.save()
        soul = judgment.soul
        if soul.current_state == SoulState.ALIVE:
            soul.transition_to(SoulState.JUDGING, f"Judgment {judgment.id} initiated")

    def destroy(self, request, *args, **kwargs):
        """Soft-delete a pending judgment, or refuse with a clear reason
        once it carries a verdict (Stage 4 §4.7: archivable instead)."""
        judgment = self.get_object()
        reason = request.data.get("reason", "") if hasattr(request, "data") else ""
        try:
            judgment.delete_or_raise(user=request.user, reason=reason)
        except DeletionNotAllowedError as exc:
            return Response(
                {"error": str(exc), "archivable": exc.archivable},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """Archive a judgment that carries a verdict and so cannot be
        deleted. See Judgment.can_delete."""
        judgment = self.get_object()
        if judgment.can_delete:
            return Response(
                {"error": "This judgment has no verdict; delete it instead of archiving."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("reason", "")
        judgment.archive(user=request.user, reason=reason)
        return Response(JudgmentSerializer(judgment).data)

    def _pending_queue(self):
        """Every judgment awaiting a verdict that this caller may see, oldest first.

        Built on `self.get_queryset()` rather than on `Judgment.objects`, so
        the tenant isolation is exactly the one every other action on this
        viewset gets: DataScopeViewSetMixin.get_queryset() runs
        `apps.core.tenant.scope_to_tenant` (plus the row-level DataScope
        rules) and fails closed. Nothing below the viewset would scope this —
        TenantManager only applies `is_deleted=False`.

        FIFO on `created_at`, not the model's default `-created_at`: a queue a
        user works through must not reshuffle under them when someone else
        opens a new proceeding, and the oldest pending case is the one that has
        been waiting longest.
        """
        return (
            self.get_queryset()
            .filter(verdict__isnull=True, is_final=False, is_archived=False)
            .order_by("created_at")
        )

    @staticmethod
    def _requested_skips(request):
        """The client's session-local skip set, from `?skip=` (repeatable, and
        comma-separated within one value).

        Skipping is deliberately NOT persisted. "Defer this one" is a statement
        about the operator's sitting, not about the case: nothing on the
        judgment changes, no audit row is written, and the item is back in the
        queue for the next person (or for the same person after a reload).
        Holding that state on the server would make it a data change, which is
        precisely what §4.2's "skip or defer" must not be.

        Unparseable ids are dropped rather than 400'd — the parameter is an
        optimisation of the caller's own view, and a stale or truncated entry
        should show the item again, never fail the request that renders it.
        """
        raw: list[str] = []
        for value in request.query_params.getlist("skip"):
            raw.extend(part.strip() for part in value.split(","))
        seen: list[uuid.UUID] = []
        for part in raw:
            if not part:
                continue
            try:
                seen.append(uuid.UUID(part))
            except (ValueError, AttributeError, TypeError):
                continue
            if len(seen) >= QUEUE_SKIP_LIMIT:
                break
        return seen

    @action(detail=False, methods=["get"], url_path="next")
    def next_pending(self, request):
        """The next case to rule on, with everything needed to rule on it.

        `GET /api/v1/judgment/next/?skip=<id>&skip=<id>,<id>`

        BRIEF §4.2 decided a queue/triage mode over multi-select: each verdict
        is a judgement call, so the cost to remove is the cost of moving
        *between* items. The paginated list this app already had cannot do
        that — it answers "which judgments exist", not "what do I decide next
        and what do I need in front of me to decide it". Hence one response
        carrying the whole decision surface instead of the five round-trips
        (judgment, soul, ledger, prior cycles, realms) the detail page makes:

          judgment      — the proceeding itself (JudgmentSerializer)
          soul          — identity, dates, state, karmic_balance (SoulSerializer)
          ledger        — the merit/demerit reading, decayed, from
                          LedgerService.get_ledger_summary — the same body
                          /souls/{id}/karma/ returns
          prior_cycles  — previous reincarnations, newest first
          realm_options — the realms this soul's civilization can send it to

        Every one of those is an existing serializer/service called as-is;
        nothing here re-implements a read that already exists elsewhere.

        Progress. `total` is how many cases are pending in scope right now,
        `remaining` how many of those the caller has not skipped, and
        `position` = total - remaining + 1, i.e. "the Nth of M". These are
        counts of live rows, so `total` falls by one each time a verdict lands
        — the client should latch the first `total` it sees if it wants a
        denominator that stays put for the sitting.

        An empty queue is a 200 with `judgment: null`, not a 404. "You are
        done" is a successful, renderable answer and the counts still matter
        (they say whether the queue was empty or merely skipped dry); a 404
        would drive the client's error boundary instead.
        """
        queue = self._pending_queue()
        total = queue.count()

        skips = self._requested_skips(request)
        remaining_qs = queue.exclude(id__in=skips) if skips else queue
        remaining = remaining_qs.count()

        payload = {
            "total": total,
            "remaining": remaining,
            # What the caller actually skipped *within this scope* — not
            # len(skips), which would count ids that are already concluded,
            # deleted, or another tenant's.
            "skipped": total - remaining,
            "position": total - remaining + 1 if remaining else None,
            "judgment": None,
            "soul": None,
            "ledger": None,
            "prior_cycles": [],
            "realm_options": [],
        }

        # `?at=<id>` — enter the queue on a named case (the "open in the
        # judgment queue" link on a soul's lifecycle spine). It is a preference,
        # not a filter: an id that is concluded, deleted, skipped or another
        # tenant's simply falls through to the head of the queue rather than
        # 404ing, because the caller's intent ("work this queue, starting
        # here") is still satisfiable and the alternative is a dead end on a
        # link that was valid when the page rendered.
        cursor = remaining_qs.select_related("soul", "soul__tenant")
        at = request.query_params.get("at")
        judgment = None
        if at:
            try:
                judgment = cursor.filter(id=uuid.UUID(at)).first()
            except (ValueError, AttributeError, TypeError):
                judgment = None
            if judgment is not None:
                # Jumping the queue means `position` is no longer "the first
                # one left"; report where this case actually sits so N-of-M
                # stays true rather than convenient.
                ahead = remaining_qs.filter(created_at__lt=judgment.created_at).count()
                payload["position"] = total - remaining + ahead + 1
        if judgment is None:
            judgment = cursor.first()
        if judgment is None:
            return Response(payload)

        soul = judgment.soul
        context = self.get_serializer_context()
        payload["judgment"] = JudgmentSerializer(judgment, context=context).data
        payload["soul"] = SoulSerializer(soul, context=context).data
        payload["ledger"] = LedgerService.get_ledger_summary(soul)
        payload["prior_cycles"] = ReincarnationSerializer(
            soul.reincarnations.all().order_by("-cycle_count"),
            many=True,
            context=context,
        ).data
        # Realms are reference data but they are tenant-owned rows (RealmViewSet
        # scopes them the same way), so the options offered here go through the
        # same helper rather than being handed out unfiltered.
        realms = scope_to_tenant(
            Realm.objects.filter(civilization=soul.civilization), request
        )
        payload["realm_options"] = RealmLocalizedSerializer(
            realms.order_by("tier", "realm_code"), many=True, context=context
        ).data
        return Response(payload)

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a judgment with a verdict.
        Calls Judgment.conclude() which creates disposition and transitions soul to DISPOSED.
        Optionally creates an ApprovalWorkflow if create_workflow=true.
        """
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")
        create_workflow = serializer.validated_data.get("create_workflow", False)

        judgment.conclude(verdict, notes, create_workflow=create_workflow)
        return Response(JudgmentSerializer(judgment).data)
