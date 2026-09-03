"""
REST views for Judgment app.
"""
import uuid

from django.db.models import Count
from django_filters import rest_framework as filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant, tenant_aggregate_filter
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment.models import Judgment, Statute
from apps.judgment.serializers import (
    JudgmentCitationSerializer,
    JudgmentCitationWriteSerializer,
    JudgmentConcludeSerializer,
    JudgmentQueueCursorSerializer,
    JudgmentSerializer,
    StatuteSerializer,
)
from apps.judgment.services import (
    CitationRefusedError,
    JudgmentNotConcludableError,
    StatuteCitationService,
)
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
        # Reading the grounds is a read; entering or withdrawing one is an act
        # on the case, the same call `conclude` maps to. GET and POST share one
        # route (DRF `mapping`) but NOT one codename — declaring both on a
        # single action would make the cumulative check in CodenamePermission
        # demand judgment.execute in order to *read* the grounds, which is the
        # opposite of the split next_pending exists to preserve.
        'citations': ['judgment.read'],
        'cite_statute': ['judgment.execute'],
        'uncite': ['judgment.execute'],
    }
    queryset = (
        Judgment.objects
        .select_related("soul", "soul__tenant", "tenant")
        .prefetch_related("citations__statute", "citations__statute__source_actor")
        .all()
    )
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

    @extend_schema(responses=JudgmentQueueCursorSerializer)
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

    # ------------------------------------------------------------------
    # Cited grounds
    # ------------------------------------------------------------------

    @extend_schema(responses=JudgmentCitationSerializer(many=True))
    @action(
        detail=True,
        methods=["get"],
        url_path="citations",
        # The grounds of one judgment are a handful of rows and are returned
        # whole. Said explicitly because drf-spectacular documents any
        # `many=True` response on a paginated viewset as a page envelope,
        # and this action returns a bare array.
        pagination_class=None,
    )
    def citations(self, request, pk=None):
        """The articles this verdict rests on, in their corpus's own order.

        `GET /api/v1/judgment/{id}/citations/`

        Reached through `self.get_object()`, so the judgment is tenant-scoped
        by the same DataScopeViewSetMixin path as every other action here;
        citations hang off it and inherit that scope rather than being queried
        (and separately scoped) on their own.
        """
        judgment = self.get_object()
        return Response(
            JudgmentCitationSerializer(
                judgment.citations.select_related("statute", "statute__source_actor"),
                many=True,
                context=self.get_serializer_context(),
            ).data
        )

    @extend_schema(
        request=JudgmentCitationWriteSerializer,
        responses={201: JudgmentCitationSerializer},
    )
    @citations.mapping.post
    def cite_statute(self, request, pk=None):
        """Record one article as a ground of this judgment.

        `POST /api/v1/judgment/{id}/citations/` `{"statute": "<uuid>", "note": ""}`

        409, not 400, on a refusal about the judgment's *state* ("already
        concluded") — that is the same distinction `destroy` draws for an
        archivable judgment: the request is well-formed and the caller is
        allowed, the record is simply past the point where it accepts this.
        A refusal about the statute itself stays a 400.
        """
        judgment = self.get_object()
        serializer = JudgmentCitationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            StatuteCitationService.assert_amendable(judgment)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_409_CONFLICT)
        try:
            citation = StatuteCitationService.cite(
                judgment,
                serializer.validated_data["statute"],
                serializer.validated_data.get("note", ""),
            )
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            JudgmentCitationSerializer(citation, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "statute_id",
                OpenApiTypes.UUID,
                OpenApiParameter.PATH,
                description=(
                    "The Statute to withdraw as a ground. Not inferable: the "
                    "generator resolves path parameters against the viewset's "
                    "model, and `Judgment` has no `statute_id` — the citation "
                    "is a row in between. Defaults to `string` without this."
                ),
            )
        ]
    )
    @action(
        detail=True,
        methods=["delete"],
        url_path=r"citations/(?P<statute_id>[^/.]+)",
    )
    def uncite(self, request, pk=None, statute_id=None):
        """Withdraw a ground from a judgment that has not been concluded."""
        judgment = self.get_object()
        try:
            StatuteCitationService.assert_amendable(judgment)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_409_CONFLICT)
        try:
            removed = StatuteCitationService.uncite(judgment, statute_id)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not removed:
            return Response(
                {"error": "This judgment does not cite that statute."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a judgment with a verdict.
        Calls Judgment.conclude() which creates disposition and transitions soul to DISPOSED.
        Optionally creates an ApprovalWorkflow if create_workflow=true.

        `statute_ids` files the grounds with the verdict, in one transaction —
        an unciteable article aborts the whole conclusion rather than leaving a
        concluded judgment whose stated basis never landed.
        """
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")
        create_workflow = serializer.validated_data.get("create_workflow", False)
        statute_ids = serializer.validated_data.get("statute_ids") or []

        try:
            judgment.conclude(
                verdict, notes, create_workflow=create_workflow, statute_ids=statute_ids
            )
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except JudgmentNotConcludableError as exc:
            # The soul cannot make the move a conclusion requires — it is not
            # under judgment. This used to be **silent**: `transition_to`'s
            # answer was dropped, so the endpoint answered 200 with a judgment
            # marked final, a disposition created, and a soul still ALIVE.
            # 400, not 500: the caller asked for something the case's state
            # does not allow, and the message says which state it is in.
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        judgment.refresh_from_db()
        return Response(
            JudgmentSerializer(judgment, context=self.get_serializer_context()).data
        )


class StatuteViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin,
                     viewsets.ReadOnlyModelViewSet):
    """The articles a verdict can be founded on — read-only reference data.

    Read-only on purpose. These rows are seeded from documents whose provenance
    is recorded on every row (`source`, `source_notes`); an API that let an
    operator type a new "冥律 article" would produce exactly the fabricated
    statutes this feature was specified not to have. Corrections go through
    `manage.py seed_mythology --update`, next to the text they came from.

    `permission_codename = "judgment"` rather than a new `statute.*` family:
    reading the rulebook is part of reading a case, the codename is already
    defined and granted, and inventing `statute.read` would seed an orphan no
    role holds (apps/perm/test_codename_coverage.py catches exactly that).
    """
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "judgment"
    queryset = Statute.objects.select_related("source_actor", "tenant").all()
    serializer_class = StatuteSerializer
    filterset_fields = ["civilization", "corpus", "polarity", "code"]
    search_fields = ["code", "title_zh", "title_en", "text_zh", "text_en"]
    ordering_fields = ["ordinal", "code", "citation_count"]

    def get_queryset(self):
        """Scoped articles, each carrying how many times *this tenant* cited it.

        The corpus browser ranks articles by how often they have actually been
        relied on, which is the one number that separates a rulebook from a
        list. It has to be an annotation: `JudgmentCitation` is a through-model
        with its own rows, so there is nothing on `Statute` to read it from.

        `super()` is `TenantQuerySetMixin`, so the article rows are scoped
        through `apps/core/tenant.py` — `tests/test_tenant_scoping_contract.py`
        walks every routed viewset and fails a tenant-bearing model whose
        `get_queryset` does not. The annotation needs its own filter for a
        reason that scoping the queryset does not cover: a reverse aggregate is
        resolved against the relation, not through the related model's manager,
        so a bare `Count("citations")` would report every tenant's citations on
        a correctly-scoped row. `tenant_aggregate_filter` is that filter, kept
        in the same module for the same reason the scoping is.

        `distinct=True` because `filterset_fields`/`search_fields` can add a
        join before the aggregate runs, and a multiplied join silently inflates
        a COUNT rather than failing.

        `order_by` restates `Statute.Meta.ordering` because **`annotate()` with
        an aggregate discards it**. Django drops the model default rather than
        let it join the GROUP BY, so the annotated queryset comes back with
        `.ordered == False` and no ORDER BY in the SQL — measured, not assumed.
        Un-ordered pagination is not a cosmetic warning: page 2 of the corpus
        is computed from a fresh LIMIT/OFFSET over a set the database may order
        differently each time, so articles repeat on one page and vanish from
        another. With 172 rows and a browser that pages through them, that is
        the whole feature. Keep this list identical to `Meta.ordering`;
        `tests/test_judgment_statutes.py::TestCitationCount` pins the pair.
        """
        return (
            super()
            .get_queryset()
            .annotate(
                citation_count=Count(
                    "citations",
                    filter=tenant_aggregate_filter(
                        self.request, field="citations__tenant"
                    ),
                    distinct=True,
                )
            )
            .order_by(*Statute._meta.ordering)
        )
